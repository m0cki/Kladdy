/* Papierblatt eines Belegs aus Bausteinen (ANLEITUNG §7.0 HTML-Vorschau; Prototyp App.sheet.html/mount).
 * Gleiche Bausteine und Daten wie das PDF (src/lib/latex/vorlage.ts + daten.ts), damit Vorschau und PDF übereinstimmen.
 * - Leere Bausteine fallen weg (im Editor: grauer Platzhalter), ausgeblendete (`aus`) immer.
 * - Fußzeile und Unterschrift „am Seitenende“ sitzen unten (.sh-unten), Wasserzeichen ENTWURF/STORNIERT.
 * - GiroCode im Baustein „Zahlung“: dieselbe Modulmatrix wie girocode.png im PDF (lib/girocode).
 * - BlattVorschau skaliert das Blatt auf die verfügbare Breite (wie mount() im Prototyp).
 * Stile: src/styles/blatt.css */
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { formatBetrag } from '../../lib/money';
import { BAUSTEINE, istUnten, sichtbare, type Aufgeloest, type Baustein, type BausteinTyp } from '../../lib/vorlagen/bausteine';
import {
  ARTEN,
  belegSumme,
  datumText,
  eigenbelegGrundText,
  empfaenger,
  formatVon,
  gebuchtText,
  istEntwurf,
  leistungLabel,
  leistungText,
  mengeText,
  platzhalterWerte,
  positionBetrag,
  quittiertText,
  quittungFuer,
  unterschriftDatum,
  zahlungswegText,
  zerlegen,
  type BelegDokument,
  type BelegPosition,
  type Empfaenger,
  type PlatzhalterName,
} from '../../lib/vorlagen/dokument';
import { betragInWorten } from '../../lib/latex/zahl-in-worten';
import { ibanFormat } from '../../lib/firma';
import { girocodeFuer, qrGroesseMm } from '../../lib/girocode/girocode';
import { qrPfad } from '../../lib/girocode/qr';

/** Markiert die fehlende Nummer im Text (wird zum grauen „Entwurf“). */
const ENTWURF = '\u0000';

/** Text mit Zeilenumbrüchen ⇒ Knoten mit <br>. */
function zeilen(text: string): ReactNode {
  const z = text.split('\n');
  return z.map((zeile, i) => (
    <Fragment key={i}>
      {zeile.split(ENTWURF).map((teil, j) => (
        <Fragment key={j}>
          {j > 0 && <span className="blk-leer">Entwurf</span>}
          {teil}
        </Fragment>
      ))}
      {i < z.length - 1 && <br />}
    </Fragment>
  ));
}

interface Ctx {
  doc: BelegDokument;
  werte: Record<PlatzhalterName, string>;
  empf: Empfaenger;
  summe: number;
  editable: boolean;
}

/** Platzhalter ersetzen wie `ersetzen` (Ränder getrimmt), fehlende Nummer grau; null = nichts zu drucken. */
function ph(text: string, x: Ctx): ReactNode | null {
  const roh = zerlegen(text)
    .map((t) => {
      if (t.art === 'text') return t.text.split(ENTWURF).join('');
      if (t.name === 'nr' && !x.werte.nr) return ENTWURF;
      return x.werte[t.name].split(ENTWURF).join('');
    })
    .join('')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/^\n+|\n+$/g, '');
  return roh.trim() ? zeilen(roh) : null;
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

const BLOCK: Readonly<Record<BausteinTyp, (b: Aufgeloest, x: Ctx) => ReactNode | null>> = {
  kopf(b, x) {
    const claim = b.text('claim') ? ph(b.text('claim'), x) : null;
    // Firmenlogo folgt mit der Logo-Ablage; bis dahin im Editor nur der Platzhalter
    const logo = b.an('logo') && x.editable ? <span className="blk-logo-slot">Logo</span> : null;
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
  absenderzeile(b, x) {
    const h = ph(b.text('text'), x);
    return h && <div className={`blk-absender${b.an('linie') ? ' linie' : ''}`}>{h}</div>;
  },
  anschrift_meta(b, x) {
    const { doc, empf: e } = x;
    const A = ARTEN[doc.art];
    const rows: [string, ReactNode][] = [];
    if (b.an('nr')) rows.push([A.nrLabel, doc.nummer ? <b>{doc.nummer}</b> : <span className="blk-leer">Entwurf</span>]);
    if (b.an('datum')) rows.push(['Datum', datumText(doc.datum)]);
    if (b.an('leistung') && doc.art !== 'angebot' && doc.leistung_von) rows.push([leistungLabel(doc), leistungText(doc)]);
    if (b.an('kundennr') && e.nummer) rows.push(['Kunden-Nr.', e.nummer]);
    if (b.an('faellig') && doc.faellig_am) rows.push([doc.art === 'angebot' ? 'Gültig bis' : 'Fällig am', datumText(doc.faellig_am)]);
    const adr = [e.anzeige, ...e.zeilen].filter(Boolean);
    return (
      <>
        <div className="blk-adr">{adr.length ? adr.map((l, i) => <div key={i}>{l}</div>) : <div className="blk-leer">Empfänger</div>}</div>
        {rows.length > 0 && (
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
        )}
      </>
    );
  },
  titel(b, x) {
    const rechts = b.text('rechts') ? ph(b.text('rechts'), x) : null;
    return (
      <>
        <div className={`blk-titel-row${b.text('stil') === 'akzent' ? ' akzent' : ''}`}>
          <h1>{ph(b.text('text'), x)}</h1>
          {rechts && <div className="blk-titel-r">{rechts}</div>}
        </div>
        {b.an('linie') && <div className="blk-akzentlinie" />}
      </>
    );
  },
  betreff(b, x) {
    const h = ph(b.text('text'), x);
    return h && <p className="blk-betreff">{h}</p>;
  },
  text(b, x) {
    const h = ph(b.text('text'), x);
    return h && <p className={`blk-text ${b.text('groesse') || 'normal'}`}>{h}</p>;
  },
  datenschutz(b, x) {
    const h = ph(b.text('text'), x);
    return h && <p className="blk-text grau blk-ds">{h}</p>;
  },
  steuerhinweis(b, x) {
    const h = ph(b.text('text'), x);
    return h && <p className={`blk-text ${b.text('groesse') || 'normal'}`}>{h}</p>;
  },
  gruss(b, x) {
    const h = ph(b.text('text'), x);
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
          {pos.length ? (
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
        <span>{ph(b.text('label'), x)}</span>
        <b>{formatBetrag(x.summe)}</b>
      </div>
    );
  },
  betrag_worte(b, x) {
    const label = b.text('label') ? ph(b.text('label'), x) : null;
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
    const txt = b.text('text') ? ph(b.text('text'), x) : null;
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
    const za = b.an('zahlungsart');
    return (
      <>
        <div className={`blk-grid ${za ? 'c3' : 'c2'}`}>
          <Feld label="Betrag">
            <b className="blk-big">{formatBetrag(x.summe)}</b>
          </Feld>
          <Feld label="Datum">{datumText(doc.datum)}</Feld>
          {za && <Feld label="Zahlungsart">{zahlungswegText(doc.quittiert?.zahlungsweg ?? doc.zahlungsweg)}</Feld>}
        </div>
        {b.an('worte') && <Feld label="Betrag in Worten">{betragInWorten(x.summe)}</Feld>}
        <Feld label={ph(b.text('von'), x)}>
          {e.anzeige}
          {e.zeilen.length ? `, ${e.zeilen.join(', ')}` : ''}
        </Feld>
        <Feld label={ph(b.text('fuer'), x)}>{fuer}</Feld>
      </>
    );
  },
  eigenbeleg_felder(b, x) {
    const { doc, empf: e } = x;
    const sub = b.text('untertitel') ? ph(b.text('untertitel'), x) : null;
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
    const ort = x.doc.firma.ort.trim();
    const datum = unterschriftDatum(x.doc);
    const vor = b.an('vorbelegen') && datum ? [ort, datum].filter(Boolean).join(', ') : '';
    return (
      <div className="blk-sign">
        <div>
          <span>{vor}</span>
          <i />
          <small>{ph(b.text('links'), x)}</small>
        </div>
        <div>
          <span />
          <i />
          <small>{ph(b.text('rechts'), x)}</small>
        </div>
      </div>
    );
  },
  trennlinie: (b) => <hr className={`blk-hr ${b.text('farbe') || 'grau'}`} />,
  abstand: (b) => <div className={`blk-space ${b.text('groesse') || 'mittel'}`} />,
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
  /** Skalierung in der Vorschau (0 = noch nicht gemessen ⇒ unsichtbar), ohne = Originalgröße */
  skala?: number;
  ref?: Ref<HTMLElement>;
}

/** Das Blatt in Originalgröße (210 mm breit). */
export function Blatt({ doc, bausteine, editable = false, ausgewaehlt = null, onWaehle, skala, ref }: BlattProps) {
  const x: Ctx = { doc, werte: platzhalterWerte(doc), empf: empfaenger(doc), summe: belegSumme(doc), editable };
  const format = formatVon(doc.art);
  const oben: ReactNode[] = [];
  const unten: ReactNode[] = [];
  for (const { index, b } of sichtbare(bausteine)) {
    let inhalt: ReactNode | null = null;
    try {
      inhalt = BLOCK[b.typ](b, x);
    } catch (e) {
      console.warn('Baustein', b.typ, e);
    }
    if (inhalt == null || inhalt === false) {
      if (!editable) continue;
      inhalt = <div className="blk-platz">{BAUSTEINE[b.typ].name} – leer</div>;
    }
    const klasse = `blk blk-${b.typ}${ausgewaehlt === index ? ' blk-sel' : ''}`;
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
