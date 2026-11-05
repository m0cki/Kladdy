/* Papierblatt eines Belegs aus Bausteinen (ANLEITUNG §7.0 HTML-Vorschau; Prototyp App.sheet.html/mount).
 * Gleiche Bausteine und Daten wie das PDF (src/lib/latex/vorlage.ts + daten.ts), damit Vorschau und PDF übereinstimmen.
 * - Leere Bausteine fallen weg (im Editor: grauer Platzhalter), ausgeblendete (`aus`) immer.
 * - Fußzeile und Unterschrift „am Seitenende“ sitzen unten (.sh-unten), Wasserzeichen ENTWURF/STORNIERT.
 * - Rahmen: liegt um das Blatt (.sh-rahmen, SVG), unabhängig von seiner Stelle in der Liste.
 * - GiroCode im Baustein „Zahlung“: dieselbe Modulmatrix wie girocode.png im PDF (lib/girocode).
 * - Firmenlogo im Baustein „Kopf“: die Datei aus `doc.logo` (ausgestellte Belege: die aus dem Schnappschuss), im Editor
 *   ohne Logo ein Platzhalter.
 * - Texte aus den Einstellungen tragen ihre Formatierung (<b>/<i>/<u> ⇒ <strong>/<em>/<u>, lib/vorlagen/formatierung.ts);
 *   gelesen wird sie im Vorlagentext vor dem Ersetzen der Platzhalter, Werte bleiben immer Text.
 * - Vorlagen-Seite (`bearbeitung`): Ein Text aus einer Einstellung (.blk-tx, data-feld = Schlüssel, im .blk mit
 *   data-blk = Index) wird per Klick an derselben Stelle zum FormatEditor. Feste Texte („Rechnungs-Nr.“ usw.) nicht.
 * - Blanko-Formular (`doc.blanko`, Vorlagen-Seite): Firmendaten wie immer, Werte des Belegs als Schreiblinien (auch
 *   Platzhalter wie {datum}, dokument.ts `luecken`), Ankreuzfelder leer, „Ort, Datum“ leer, kein Wasserzeichen.
 * - BlattVorschau skaliert das Blatt auf die verfügbare Breite (wie mount() im Prototyp).
 * Stile: src/styles/blatt.css */
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { formatBetrag } from '../../lib/money';
import { BAUSTEINE, istTextFeld, istUmrandet, istUnten, quittungAngaben, sichtbare, type Aufgeloest, type Baustein, type BausteinTyp } from '../../lib/vorlagen/bausteine';
import { ersetzteZeilen, type Segment } from '../../lib/vorlagen/formatierung';
import { FormatEditor } from './FormatEditor';
import {
  ARTEN,
  belegSumme,
  datumText,
  eigenbelegGrundText,
  empfaenger,
  formatVon,
  gebuchtText,
  gedruckterZahlungsweg,
  istEntwurf,
  leistungLabel,
  luecken,
  leistungText,
  mengeText,
  platzhalterWerte,
  positionBetrag,
  quittiertText,
  quittungFuer,
  unterschriftDatum,
  zahlungswegText,
  ZAHLUNGSWEGE,
  type BelegDokument,
  type BelegPosition,
  type Empfaenger,
  type PlatzhalterName,
} from '../../lib/vorlagen/dokument';
import { betragInWorten } from '../../lib/latex/zahl-in-worten';
import { ibanFormat } from '../../lib/firma';
import { girocodeFuer, qrGroesseMm } from '../../lib/girocode/girocode';
import { qrPfad } from '../../lib/girocode/qr';
import { useLogoUrl } from '../../lib/logoablage';
import { sichtbareZeilen } from '../../lib/vorlagen/firmenblock';

/** Text mit Zeilenumbrüchen ⇒ Knoten mit <br>. */
function zeilen(text: string): ReactNode {
  const z = text.split('\n');
  return z.map((zeile, i) => (
    <Fragment key={i}>
      {zeile}
      {i < z.length - 1 && <br />}
    </Fragment>
  ));
}

/** Ein Stück Text mit Formatierung; fehlende Nummer grau „Entwurf“, im Blanko-Formular eine kurze Schreiblinie. */
function segment(s: Segment, key: number): ReactNode {
  let n: ReactNode = s.luecke ? <Luecke /> : s.entwurf ? <span className="blk-leer">Entwurf</span> : s.text;
  if (s.unterstrichen) n = <u>{n}</u>;
  if (s.kursiv) n = <em>{n}</em>;
  if (s.fett) n = <strong>{n}</strong>;
  return <Fragment key={key}>{n}</Fragment>;
}

/** Bearbeiten im Blatt (Vorlagen-Seite): welcher Text gerade bearbeitet wird und wohin Änderungen gehen. */
export interface BlattBearbeitung {
  /** Baustein-Index und Schlüssel der Einstellung im Editor; null = keiner */
  aktiv: { index: number; key: string } | null;
  /** Klickpunkt beim Öffnen (Schreibmarke dorthin) */
  klick: { x: number; y: number } | null;
  starten: (index: number, key: string, klick: { x: number; y: number }) => void;
  ende: () => void;
  setze: (index: number, key: string, wert: string) => void;
}

interface Ctx {
  doc: BelegDokument;
  werte: Record<PlatzhalterName, string>;
  /** Platzhalter, die als Schreiblinie gedruckt werden (nur Blanko-Formular) */
  luecken: ReadonlySet<PlatzhalterName>;
  empf: Empfaenger;
  summe: number;
  editable: boolean;
  /** Blob-URL des Firmenlogos (null = keins oder noch nicht geladen) */
  logoUrl: string | null;
  /** Index des Bausteins in der Vorlage */
  index: number;
  bearbeitung: BlattBearbeitung | null;
}

/** Platzhalter ersetzen wie `ersetzen` (Ränder getrimmt), mit Formatierung, fehlende Nummer grau; null = nichts zu drucken. */
function ph(text: string, x: Ctx): ReactNode | null {
  const z = ersetzteZeilen(text, x.werte, x.luecken);
  if (!z) return null;
  return z.map((zeile, i) => (
    <Fragment key={i}>
      {zeile.map(segment)}
      {i < z.length - 1 && <br />}
    </Fragment>
  ));
}

/**
 * Text einer Einstellung. Ohne Bearbeitung wie `ph`; auf der Vorlagen-Seite anklickbar (.blk-tx) bzw. – wenn gerade
 * dieser bearbeitet wird – der Editor an derselben Stelle (auch bei leerem Text, damit er beim Tippen nicht verschwindet).
 * `inhalt`: eigene Darstellung (Firmenkopf: nur sichtbare Zeilen), `block`: als div statt span.
 */
function feld(b: Aufgeloest, x: Ctx, key: string, inhalt: ReactNode | null = ph(b.text(key), x), block = false): ReactNode | null {
  const bt = x.bearbeitung;
  const f = bt ? istTextFeld(b.typ, key) : null;
  if (!bt || !f) return inhalt;
  if (bt.aktiv?.index === x.index && bt.aktiv.key === key) {
    return (
      <FormatEditor
        wert={b.text(key)}
        onChange={(w) => bt.setze(x.index, key, w)}
        mehrzeilig={f.typ === 'textarea'}
        leiste="schwebend"
        onEnde={bt.ende}
        autoFokus
        klick={bt.klick}
        als={block ? 'div' : 'span'}
        label={`${BAUSTEINE[b.typ].name}: ${f.label}`}
        className="blk-edit"
      />
    );
  }
  if (inhalt == null) return null;
  const Tag = block ? 'div' : 'span';
  return (
    <Tag className="blk-tx" data-feld={key} title={`${f.label} bearbeiten`} onClick={(e) => bt.starten(x.index, key, { x: e.clientX, y: e.clientY })}>
      {inhalt}
    </Tag>
  );
}

const mitText = (s: string): ReactNode | null => (s.trim() ? zeilen(s.replace(/\r\n?/g, '\n')) : null);

function Feld({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="blk-feld">
      <small>{label}</small>
      <div>{children}</div>
    </div>
  );
}

/** Kurze Schreiblinie im Text (Platzhalter im Blanko-Formular), wie \KLuecke im PDF */
function Luecke() {
  return <span className="blk-luecke" />;
}

/** Schreiblinie über die ganze Breite zum Ausfüllen von Hand (Blanko-Formular), wie \KSchreib im PDF; `euro` = „€“ dahinter */
function Schreiben({ euro = false }: { euro?: boolean }) {
  return (
    <span className="blk-schreib">
      <i />
      {euro && <span>€</span>}
    </span>
  );
}

/** Ankreuzfeld (Quittung „Formular“): angekreuzt mit einem Kreuz – nie nur über Farbe. */
function Kaestchen({ an }: { an: boolean }) {
  return (
    <svg className="blk-box" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="0.5" y="0.5" width="11" height="11" />
      {an && <path d="M3 3 9 9M9 3 3 9" />}
    </svg>
  );
}

/** Zahlungswege zum Ankreuzen; `weg` = angekreuzter (null = keiner, Blanko-Formular) */
function Kreuze({ weg }: { weg: string | null }) {
  return ZAHLUNGSWEGE.map((z) => (
    <span key={z} className="blk-kreuz">
      <Kaestchen an={weg === z} />
      {zahlungswegText(z)}
    </span>
  ));
}

/** „Bezeichnung: Wert“ (Quittung „Formular“); `schreib` = Wert ist eine Schreiblinie (Blanko-Formular) */
function FormZeile({ label, children, schreib = false }: { label: ReactNode; children: ReactNode; schreib?: boolean }) {
  return (
    <div className={`blk-form-z${schreib ? ' schreib' : ''}`}>
      <b>{label}:</b> {children}
    </div>
  );
}

function MetaTabelle({ rows }: { rows: readonly [string, ReactNode][] }) {
  return (
    <table className="blk-meta">
      <tbody>
        {rows.map(([l, v]) => (
          <tr key={l}>
            <td>{l}</td>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Leere Zeilen der Positionstabelle im Blanko-Formular (wie im PDF) */
const BLANKO_POSITIONEN = 4;

function PosMini({ positionen }: { positionen: readonly BelegPosition[] }) {
  return (
    <table className="blk-posmini">
      <tbody>
        {positionen.map((p, i) => (
          <tr key={i}>
            <td>
              {mengeText(p.menge)}
              {p.einheit.trim() ? ` ${p.einheit.trim()}` : ''} ×
            </td>
            <td>{zeilen(p.beschreibung)}</td>
            <td>{formatBetrag(positionBetrag(p))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Quittungsangaben im Blanko-Formular: dieselben Angaben und Stile, statt Werten Schreiblinien, Kästchen leer. */
function quittungBlanko(b: Aufgeloest, x: Ctx): ReactNode {
  const a = quittungAngaben(b);
  if (a.formular) {
    return (
      <div className="blk-form">
        <div className="blk-form-kopf">
          {a.datum && (
            <FormZeile label="Datum" schreib>
              <Schreiben />
            </FormZeile>
          )}
          <FormZeile label="Nr." schreib>
            <Schreiben />
          </FormZeile>
        </div>
        {a.kunde && (
          <FormZeile label={feld(b, x, 'von')} schreib>
            <Schreiben />
          </FormZeile>
        )}
        {a.zweck && (
          <FormZeile label={feld(b, x, 'fuer')} schreib>
            <Schreiben />
          </FormZeile>
        )}
        <FormZeile label="Buchungs-Nr." schreib>
          <Schreiben />
        </FormZeile>
        {a.zahlungsart && (
          <FormZeile label="Zahlungsart">
            <Kreuze weg={null} />
          </FormZeile>
        )}
        {a.betrag && (
          <div className="blk-form-summe schreib">
            <b>Gesamtbetrag:</b>
            <Schreiben euro />
          </div>
        )}
        {a.worte && (
          <p className="blk-form-worte schreib">
            <span>in Worten:</span>
            <Schreiben />
          </p>
        )}
      </div>
    );
  }
  const kacheln = [
    a.betrag && (
      <Feld key="betrag" label="Betrag">
        <Schreiben euro />
      </Feld>
    ),
    a.datum && (
      <Feld key="datum" label="Datum">
        <Schreiben />
      </Feld>
    ),
    a.zahlungsart && (
      <Feld key="zahlungsart" label="Zahlungsart">
        <span className="blk-kreuze">
          <Kreuze weg={null} />
        </span>
      </Feld>
    ),
  ].filter(Boolean);
  return (
    <>
      {kacheln.length > 0 && <div className={`blk-grid ${kacheln.length === 3 ? 'c3' : 'c2'}`}>{kacheln}</div>}
      {a.worte && (
        <Feld label="Betrag in Worten">
          <Schreiben />
        </Feld>
      )}
      {a.kunde && (
        <Feld label={feld(b, x, 'von')}>
          <Schreiben />
        </Feld>
      )}
      {a.zweck && (
        <Feld label={feld(b, x, 'fuer')}>
          <Schreiben />
        </Feld>
      )}
      <Feld label="Buchungs-Nr. (aus Kladdy)">
        <Schreiben />
      </Feld>
    </>
  );
}

const BLOCK: Readonly<Record<BausteinTyp, (b: Aufgeloest, x: Ctx) => ReactNode | null>> = {
  kopf(b, x) {
    const claim = feld(b, x, 'claim');
    // Firmenlogo wie \LogoDatei im PDF; ohne Logo im Editor nur der Platzhalter
    const logo = !b.an('logo') ? null : x.logoUrl ? <img src={x.logoUrl} alt="" /> : x.editable ? <span className="blk-logo-slot">Logo</span> : null;
    return (
      <div className="blk-kopf">
        <div className="blk-kopf-l">
          <div className="blk-firma">{x.doc.firma.name}</div>
          {claim && <div className="blk-claim">{claim}</div>}
        </div>
        {logo && <div className="blk-logo">{logo}</div>}
      </div>
    );
  },
  firmenblock(b, x) {
    const name = feld(b, x, 'name');
    const zeilenVon = (key: string) => {
      const z = sichtbareZeilen(b.text(key), x.werte, x.luecken).map((zeile, i) => <div key={i}>{ph(zeile.text, x)}</div>);
      return feld(b, x, key, z.length ? z : null, true);
    };
    const untertitel = zeilenVon('untertitel');
    const kontakt = zeilenVon('zeilen');
    const logo = !b.an('logo') ? null : x.logoUrl ? <img src={x.logoUrl} alt="" /> : x.editable ? <span className="blk-logo-slot">Logo</span> : null;
    if (!name && !untertitel && !kontakt && !logo) return null;
    return (
      <div className={`blk-fk${b.an('linie') ? ' linie' : ''}`}>
        <div className="blk-fk-l">
          {name && <div className={`blk-fk-name${b.an('versal') ? ' versal' : ''}`}>{name}</div>}
          {untertitel && <div className="blk-fk-sub">{untertitel}</div>}
          {kontakt && <div className="blk-fk-z">{kontakt}</div>}
        </div>
        {logo && <div className="blk-logo">{logo}</div>}
      </div>
    );
  },
  absenderzeile(b, x) {
    const h = feld(b, x, 'text');
    return h && <div className={`blk-absender${b.an('linie') ? ' linie' : ''}`}>{h}</div>;
  },
  anschrift_meta(b, x) {
    const { doc, empf: e } = x;
    const A = ARTEN[doc.art];
    const rows: [string, ReactNode][] = [];
    if (doc.blanko) {
      // Blanko: drei Zeilen für den Empfänger, rechts kurze Linien für Nummer, Datum usw.
      if (b.an('nr')) rows.push([A.nrLabel, <Luecke />]);
      if (b.an('datum')) rows.push(['Datum', <Luecke />]);
      if (b.an('leistung') && doc.art !== 'angebot') rows.push(['Leistungsdatum', <Luecke />]);
      if (b.an('kundennr')) rows.push(['Kunden-Nr.', <Luecke />]);
      if (b.an('faellig')) rows.push([doc.art === 'angebot' ? 'Gültig bis' : 'Fällig am', <Luecke />]);
      return (
        <>
          <div className="blk-adr">
            <Schreiben />
            <Schreiben />
            <Schreiben />
          </div>
          {rows.length > 0 && <MetaTabelle rows={rows} />}
        </>
      );
    }
    if (b.an('nr')) rows.push([A.nrLabel, doc.nummer ? <b>{doc.nummer}</b> : <span className="blk-leer">Entwurf</span>]);
    if (b.an('datum')) rows.push(['Datum', datumText(doc.datum)]);
    if (b.an('leistung') && doc.art !== 'angebot' && doc.leistung_von) rows.push([leistungLabel(doc), leistungText(doc)]);
    if (b.an('kundennr') && e.nummer) rows.push(['Kunden-Nr.', e.nummer]);
    if (b.an('faellig') && doc.faellig_am) rows.push([doc.art === 'angebot' ? 'Gültig bis' : 'Fällig am', datumText(doc.faellig_am)]);
    const adr = [e.anzeige, ...e.zeilen].filter(Boolean);
    return (
      <>
        <div className="blk-adr">{adr.length ? adr.map((l, i) => <div key={i}>{l}</div>) : <div className="blk-leer">Empfänger</div>}</div>
        {rows.length > 0 && <MetaTabelle rows={rows} />}
      </>
    );
  },
  titel(b, x) {
    const rechts = feld(b, x, 'rechts');
    return (
      <>
        <div className={`blk-titel-row${b.text('stil') === 'akzent' ? ' akzent' : ''}${b.an('versal') ? ' versal' : ''}`}>
          <h1>{feld(b, x, 'text')}</h1>
          {rechts && <div className="blk-titel-r">{rechts}</div>}
        </div>
        {b.an('linie') && <div className="blk-akzentlinie" />}
      </>
    );
  },
  betreff(b, x) {
    const h = feld(b, x, 'text');
    return h && <p className="blk-betreff">{h}</p>;
  },
  text(b, x) {
    const h = feld(b, x, 'text');
    return h && <p className={`blk-text ${b.text('groesse') || 'normal'}`}>{h}</p>;
  },
  datenschutz(b, x) {
    const h = feld(b, x, 'text');
    return h && <p className="blk-text grau blk-ds">{h}</p>;
  },
  steuerhinweis(b, x) {
    const h = feld(b, x, 'text');
    return h && <p className={`blk-text ${b.text('groesse') || 'normal'}`}>{h}</p>;
  },
  gruss(b, x) {
    const h = feld(b, x, 'text');
    return h && <p className="blk-text">{h}</p>;
  },
  positionen(b, x) {
    const pos = x.doc.positionen;
    const mitPos = b.an('pos');
    const mitEp = b.an('einzelpreis');
    const spalten = 3 + (mitPos ? 1 : 0) + (mitEp ? 1 : 0);
    return (
      <table className="blk-pos">
        <thead>
          <tr>
            {mitPos && <th className="r p">Pos.</th>}
            <th className="l">Beschreibung</th>
            <th className="r">Menge</th>
            {mitEp && <th className="r">Einzelpreis</th>}
            <th className="r">Gesamt</th>
          </tr>
        </thead>
        <tbody>
          {x.doc.blanko ? (
            Array.from({ length: BLANKO_POSITIONEN }, (_, i) => (
              <tr key={i} className="blanko">
                {mitPos && <td className="r p" />}
                <td className="l">{'\u00a0'}</td>
                <td className="r" />
                {mitEp && <td className="r" />}
                <td className="r" />
              </tr>
            ))
          ) : pos.length ? (
            pos.map((p, i) => (
              <tr key={i}>
                {mitPos && <td className="r p">{i + 1}</td>}
                <td className="l">{zeilen(p.beschreibung)}</td>
                <td className="r">
                  {mengeText(p.menge)}
                  {b.an('einheit') && p.einheit.trim() ? ` ${p.einheit.trim()}` : ''}
                </td>
                {mitEp && <td className="r">{formatBetrag(p.einzelpreis_cent)}</td>}
                <td className="r">{formatBetrag(positionBetrag(p))}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="l blk-leer" colSpan={spalten}>
                Noch keine Positionen
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  },
  summe(b, x) {
    return (
      <div className="blk-summe-row">
        <span>{feld(b, x, 'label')}</span>
        <b>
          {x.doc.blanko ? (
            <>
              <Luecke /> €
            </>
          ) : (
            formatBetrag(x.summe)
          )}
        </b>
      </div>
    );
  },
  betrag_worte(b, x) {
    const label = feld(b, x, 'label');
    if (x.doc.blanko)
      return (
        <p className="blk-worte schreib">
          {label && <span>{label}:</span>}
          <Schreiben />
        </p>
      );
    return (
      <p className="blk-worte">
        {label && <span>{label}:</span>} {betragInWorten(x.summe)}
      </p>
    );
  },
  zahlung(b, x) {
    const { doc } = x;
    const F = doc.firma;
    // Schon bei Ausstellung bezahlt: kein Zahlungsaufruf, keine Bankverbindung, kein GiroCode
    const q = quittiertText(doc);
    if (q) return <p className="blk-text">{q}</p>;
    const txt = feld(b, x, 'text');
    const bank = b.an('bank') ? (
      <div className="blk-bank">
        <b>Bankverbindung</b>
        <dl>
          <dt>Empfänger</dt>
          <dd>{F.name}</dd>
          <dt>IBAN</dt>
          <dd className="blk-iban">{F.iban ? ibanFormat(F.iban) : ''}</dd>
          <dt>BIC</dt>
          <dd>
            {F.bic}
            {F.bank ? ` · ${F.bank}` : ''}
          </dd>
          <dt>Betrag</dt>
          <dd>
            <b>{formatBetrag(x.summe)}</b>
          </dd>
          <dt>Verwendungszweck</dt>
          <dd>{doc.nummer || <span className="blk-leer">Rechnungsnummer</span>}</dd>
        </dl>
      </div>
    ) : null;
    // GiroCode (EPC-QR) nur auf Rechnungen; ungültige Daten (z. B. IBAN-Prüfsumme) zeigt das Formular, das Blatt nichts
    let qr: ReactNode = null;
    if (b.an('qr') && doc.art === 'rechnung') {
      const g = girocodeFuer(doc);
      if (g.ok) {
        const mm = qrGroesseMm(b.text('qrgroesse'));
        const n = g.matrix.length;
        // Größe ist Geometrie, keine Farbe: Inline-Stil wie im Prototyp; die Modulfarbe kommt aus blatt.css (--qr)
        qr = (
          <figure className="blk-qr">
            <div className="blk-qr-code" style={{ width: `${mm}mm`, height: `${mm}mm` }}>
              <svg viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="GiroCode">
                <path fill="currentColor" d={qrPfad(g.matrix)} />
              </svg>
            </div>
            <figcaption>
              Mit der Banking-App
              <br />
              scannen und bezahlen
            </figcaption>
          </figure>
        );
      }
    }
    if (!txt && !bank && !qr) return null;
    return (
      <>
        {txt && <p className="blk-text">{txt}</p>}
        {(bank || qr) && (
          <div className={`blk-pay${bank ? ' box' : ''}`}>
            {bank ?? <div className="blk-pay-sp" />}
            {qr}
          </div>
        )}
      </>
    );
  },
  quittung_felder(b, x) {
    const { doc, empf: e } = x;
    // jede Angabe einzeln abschaltbar; alle aus ⇒ nichts (wie im PDF)
    const a = quittungAngaben(b);
    if (a.leer) return null;
    if (doc.blanko) return quittungBlanko(b, x);
    const pos = doc.positionen;
    const fuer =
      pos.length > 1 ? (
        <>
          {doc.betreff.trim() && <div>{zeilen(doc.betreff)}</div>}
          <PosMini positionen={pos} />
        </>
      ) : (
        zeilen(quittungFuer(doc))
      );
    const kunde = (
      <>
        {e.anzeige}
        {e.zeilen.length ? `, ${e.zeilen.join(', ')}` : ''}
      </>
    );
    if (a.formular) {
      const weg = gedruckterZahlungsweg(doc);
      return (
        <div className="blk-form">
          <div className="blk-form-kopf">
            {a.datum && <FormZeile label="Datum">{datumText(doc.datum)}</FormZeile>}
            <FormZeile label="Nr.">{doc.nummer || <span className="blk-leer">Entwurf</span>}</FormZeile>
          </div>
          {a.kunde && <FormZeile label={feld(b, x, 'von')}>{kunde}</FormZeile>}
          {a.zweck && <FormZeile label={feld(b, x, 'fuer')}>{fuer}</FormZeile>}
          {a.zahlungsart && (
            <FormZeile label="Zahlungsart">
              <Kreuze weg={weg} />
            </FormZeile>
          )}
          {a.betrag && (
            <div className="blk-form-summe">
              <b>Gesamtbetrag:</b> <b>{formatBetrag(x.summe)}</b>
            </div>
          )}
          {a.worte && (
            <p className="blk-form-worte">
              <span>in Worten:</span> {betragInWorten(x.summe)}
            </p>
          )}
        </div>
      );
    }
    // Kacheln: drei nebeneinander (1,35 : 1 : 1), sonst zwei gleich breite Spalten wie im PDF (raster)
    const kacheln = [
      a.betrag && (
        <Feld key="betrag" label="Betrag">
          <b className="blk-big">{formatBetrag(x.summe)}</b>
        </Feld>
      ),
      a.datum && (
        <Feld key="datum" label="Datum">
          {datumText(doc.datum)}
        </Feld>
      ),
      a.zahlungsart && (
        <Feld key="zahlungsart" label="Zahlungsart">
          {zahlungswegText(gedruckterZahlungsweg(doc))}
        </Feld>
      ),
    ].filter(Boolean);
    return (
      <>
        {kacheln.length > 0 && <div className={`blk-grid ${kacheln.length === 3 ? 'c3' : 'c2'}`}>{kacheln}</div>}
        {a.worte && <Feld label="Betrag in Worten">{betragInWorten(x.summe)}</Feld>}
        {a.kunde && <Feld label={feld(b, x, 'von')}>{kunde}</Feld>}
        {a.zweck && <Feld label={feld(b, x, 'fuer')}>{fuer}</Feld>}
      </>
    );
  },
  eigenbeleg_felder(b, x) {
    const { doc, empf: e } = x;
    const sub = feld(b, x, 'untertitel');
    if (doc.blanko) {
      return (
        <>
          {sub && <p className="blk-sub">{sub}</p>}
          <div className="blk-grid c3">
            <Feld label="Betrag">
              <Schreiben euro />
            </Feld>
            <Feld label="Datum der Zahlung">
              <Schreiben />
            </Feld>
            <Feld label="Zahlungsart">
              <span className="blk-kreuze">
                <Kreuze weg={null} />
              </span>
            </Feld>
          </div>
          {b.an('worte') && (
            <Feld label="Betrag in Worten">
              <Schreiben />
            </Feld>
          )}
          <div className="blk-grid c2">
            <Feld label="Zahlungsempfänger">
              <Schreiben />
            </Feld>
            <Feld label="Grund für den Eigenbeleg">
              <Schreiben />
            </Feld>
          </div>
          <Feld label="Gegenstand / Zweck der Ausgabe">
            <Schreiben />
          </Feld>
        </>
      );
    }
    const gebucht = gebuchtText(doc);
    return (
      <>
        {sub && <p className="blk-sub">{sub}</p>}
        <div className="blk-grid c3">
          <Feld label="Betrag">
            <b className="blk-big">{formatBetrag(x.summe)}</b>
          </Feld>
          <Feld label="Datum der Zahlung">{datumText(doc.datum)}</Feld>
          <Feld label="Zahlungsart">{zahlungswegText(doc.zahlungsweg)}</Feld>
        </div>
        {b.an('worte') && <Feld label="Betrag in Worten">{betragInWorten(x.summe)}</Feld>}
        <div className="blk-grid c2">
          <Feld label="Zahlungsempfänger">
            {e.name ? (
              <>
                {e.name}
                {e.zeilen.length > 0 && <small>{e.zeilen.join(', ')}</small>}
              </>
            ) : (
              <span className="blk-leer">fehlt</span>
            )}
          </Feld>
          <Feld label="Grund für den Eigenbeleg">{eigenbelegGrundText(doc)}</Feld>
        </div>
        <Feld label="Gegenstand / Zweck der Ausgabe">{mitText(doc.betreff) ?? <span className="blk-leer">fehlt</span>}</Feld>
        {gebucht && <p className="blk-text grau">Gebucht als {gebucht}</p>}
      </>
    );
  },
  unterschrift(b, x) {
    if (b.text('stil') === 'eine') {
      return (
        <div className="blk-sign1">
          <b>{feld(b, x, 'rechts')}</b>
          <i />
        </div>
      );
    }
    const ort = x.doc.firma.ort.trim();
    const datum = unterschriftDatum(x.doc);
    // Blanko: „Ort, Datum“ schreibt man von Hand (das Datum hat das Formular nicht)
    const vor = b.an('vorbelegen') && datum && !x.doc.blanko ? [ort, datum].filter(Boolean).join(', ') : '';
    return (
      <div className="blk-sign">
        <div>
          <span>{vor}</span>
          <i />
          <small>{feld(b, x, 'links')}</small>
        </div>
        <div>
          <span />
          <i />
          <small>{feld(b, x, 'rechts')}</small>
        </div>
      </div>
    );
  },
  trennlinie: (b) => <hr className={`blk-hr ${b.text('farbe') || 'grau'}`} />,
  abstand: (b) => <div className={`blk-space ${b.text('groesse') || 'mittel'}`} />,
  // liegt um das Blatt (Blatt ⇒ .sh-rahmen), nicht im Fluss
  rahmen: () => null,
  fusszeile(b, x) {
    const F = x.doc.firma;
    const z = (l: (string | false)[]) => {
      const da = l.filter((s): s is string => !!s && !!s.trim());
      return da.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {s}
        </Fragment>
      ));
    };
    const ortZeile = [F.plz.trim(), F.ort.trim()].filter(Boolean).join(' ');
    const sp: ReactNode[] = [];
    if (b.an('adresse'))
      sp.push(
        <div key="a">
          <b>{F.name}</b>
          {(F.inhaber.trim() || F.strasse.trim() || ortZeile) && <br />}
          {z([F.inhaber, F.strasse, ortZeile])}
        </div>,
      );
    if (b.an('kontakt'))
      sp.push(<div key="k">{z([!!F.telefon.trim() && `Tel. ${F.telefon}`, F.email, F.web, !!F.steuernummer.trim() && `Steuernr. ${F.steuernummer}`])}</div>);
    if (b.an('bank')) sp.push(<div key="b">{z([F.bank, !!F.iban.trim() && `IBAN ${ibanFormat(F.iban)}`, !!F.bic.trim() && `BIC ${F.bic}`])}</div>);
    return sp.length ? <div className={`blk-fuss n${sp.length}`}>{sp}</div> : null;
  },
};

export interface BlattProps {
  doc: BelegDokument;
  bausteine: readonly Baustein[];
  /** Vorlagen-Editor: leere Bausteine als Platzhalter zeigen, Auswahl per Klick */
  editable?: boolean;
  ausgewaehlt?: number | null;
  onWaehle?: (index: number) => void;
  /** Vorlagen-Seite: Texte der Einstellungen direkt im Blatt bearbeiten (nur mit `editable`) */
  bearbeitung?: BlattBearbeitung;
  /** Skalierung in der Vorschau (0 = noch nicht gemessen ⇒ unsichtbar), ohne = Originalgröße */
  skala?: number;
  ref?: Ref<HTMLElement>;
}

/** Das Blatt in Originalgröße (210 mm breit). */
export function Blatt({ doc, bausteine, editable = false, ausgewaehlt = null, onWaehle, bearbeitung, skala, ref }: BlattProps) {
  const logoUrl = useLogoUrl(doc.logo);
  const basis: Ctx = {
    doc,
    werte: platzhalterWerte(doc),
    luecken: luecken(doc),
    empf: empfaenger(doc),
    summe: belegSumme(doc),
    editable,
    logoUrl,
    index: -1,
    bearbeitung: editable ? (bearbeitung ?? null) : null,
  };
  const format = formatVon(doc.art);
  const oben: ReactNode[] = [];
  const unten: ReactNode[] = [];
  const rahmen: ReactNode[] = [];
  for (const { index, b } of sichtbare(bausteine)) {
    if (istUmrandet(b)) {
      // Rahmen wie im PDF 4 mm außerhalb des Satzspiegels; Klick auf die Linie wählt den Baustein
      const sel = ausgewaehlt === index ? ' sel' : '';
      rahmen.push(
        <svg key={index} className={`sh-rahmen ${b.text('linie') === 'durchgezogen' ? 'voll' : 'strich'}${sel}`} data-blk={index} aria-hidden="true">
          <rect width="100%" height="100%" />
          {onWaehle && <rect className="sh-rahmen-griff" width="100%" height="100%" onClick={() => onWaehle(index)} />}
        </svg>,
      );
      continue;
    }
    let inhalt: ReactNode | null = null;
    try {
      inhalt = BLOCK[b.typ](b, { ...basis, index });
    } catch (e) {
      console.warn('Baustein', b.typ, e);
    }
    if (inhalt == null || inhalt === false) {
      if (!editable) continue;
      inhalt = <div className="blk-platz">{BAUSTEINE[b.typ].name} – leer</div>;
    }
    const stil = BAUSTEINE[b.typ].felder.some((f) => f.key === 'stil') ? ` stil-${b.text('stil')}` : '';
    const klasse = `blk blk-${b.typ}${stil}${ausgewaehlt === index ? ' blk-sel' : ''}`;
    const knoten = (
      <div key={index} className={klasse} data-blk={index} onClick={onWaehle ? () => onWaehle(index) : undefined}>
        {inhalt}
      </div>
    );
    (istUnten(b) ? unten : oben).push(knoten);
  }
  const wm = doc.storniert ? 'STORNIERT' : istEntwurf(doc) ? 'ENTWURF' : '';
  const klassen = ['sheet', `sh-${format}`, wm === 'ENTWURF' && 'is-draft', doc.storniert && 'is-storno', editable && 'editable'].filter(Boolean).join(' ');
  return (
    <article
      ref={ref}
      className={klassen}
      data-format={format}
      data-art={doc.art}
      lang="de"
      style={skala === undefined ? undefined : skala ? { transform: `scale(${skala})` } : { visibility: 'hidden' }}
    >
      {format === 'a4' && (
        <>
          <i className="sh-mark falz1" />
          <i className="sh-mark falz2" />
          <i className="sh-mark loch" />
        </>
      )}
      {rahmen}
      {wm && (
        <div className="sh-wm" aria-hidden="true">
          <span>{wm}</span>
        </div>
      )}
      <div className="sh-main">{oben}</div>
      {unten.length > 0 && <div className="sh-unten">{unten}</div>}
    </article>
  );
}

/** Skalierte Vorschau auf einem „Schreibtisch“: Blatt passt in die Breite (höchstens `maxScale`). */
export function BlattVorschau({ maxScale = 1.5, className = '', ...props }: Omit<BlattProps, 'ref' | 'skala'> & { maxScale?: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const blatt = useRef<HTMLElement>(null);
  const [mass, setMass] = useState<{ s: number; w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const h = host.current;
    const sh = blatt.current;
    if (!h || !sh) return;
    const fit = () => {
      const cs = getComputedStyle(h);
      const breite = h.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const w = sh.offsetWidth;
      const hoehe = sh.offsetHeight;
      if (!w || breite <= 0) return;
      const s = Math.max(0.15, Math.min(breite / w, maxScale));
      setMass((p) => (p && p.s === s && p.w === w && p.h === hoehe ? p : { s, w, h: hoehe }));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(h);
    ro.observe(sh);
    return () => ro.disconnect();
  }, [maxScale]);

  // Skalierung ist Geometrie, keine Farbe: Inline-Stil wie im Prototyp (mount ⇒ fit)
  return (
    <div ref={host} className={`sheet-desk ${className}`.trim()}>
      <div className="sheet-stage" style={mass ? { width: Math.round(mass.w * mass.s), height: Math.ceil(mass.h * mass.s) } : undefined}>
        <Blatt {...props} ref={blatt} skala={mass?.s ?? 0} />
      </div>
    </div>
  );
}
