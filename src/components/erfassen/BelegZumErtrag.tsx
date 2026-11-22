/* „Beleg zum Ertrag“ in der Erfassen-Schublade (§6.4 Punkt 6, Prototyp buchungen.js renderBeleg/docPanelHTML/offenHTML):
 * drei Wege als Kacheln – Beleg erstellen (Standard) · Offene Rechnung zuordnen · Ohne eigenen Beleg.
 * - Beleg erstellen: Art Quittung | Rechnung (Vorauswahl aus Einstellungen › Belege), angezeigte Nummer, Vorlage, bei
 *   Rechnung „bereits bezahlt | noch offen“ samt Hinweisen zur Bankverbindung, Anschrift (sofern nicht in der
 *   Kundenkartei), Positionen (PositionenEditor wie in der Maske; die Summe ist der Betrag oben), Hinweis zu § 35a und
 *   Schritt 2 „Unterschriebenes Exemplar anhängen“ (eine Datei, wird nach dem Ausstellen an den Beleg gehängt).
 *   Umschalter für die Live-Vorschau (BlattVorschau, ErfassenSchublade). Die Datumsfelder des Belegs (Leistungsdatum,
 *   Zeitraum, Zahlungsziel) stehen links unter dem Datum: BelegDatumFelder.
 * - Offene Rechnung zuordnen: Liste der offenen Rechnungen; die Wahl übernimmt Betrag, Text und Kunde.
 * - Ohne eigenen Beleg: die Dateifläche darunter (zeichnet die Schublade selbst).
 * Nachträglich (`buchung` gesetzt, „Buchung bearbeiten“ einer Einnahme ohne eigenen Beleg): nur „Beleg erstellen“ und
 * „Ohne eigenen Beleg“; Rechnung nur „bereits bezahlt“; die Positionen müssen den Betrag der Einnahme genau ergeben
 * (summenAbweichung) – gespeichert über beleg_zu_buchung, es entsteht keine zweite Einnahme.
 * Logik in lib/ertrag.ts, gespeichert wird in ErfassenSchublade (beleg_ausstellen bzw. beleg_bezahlt). */
import { CircleCheck, Clock, Eye, EyeOff, FileText, Info, Landmark, NotebookPen, Paperclip, ReceiptEuro, TriangleAlert, User } from 'lucide-react';
import type { Formular } from '../../lib/buchungen';
import type { VorgemerkterBeleg } from '../../lib/belege';
import {
  ERTRAG_ART_TIPP,
  belegHinweis,
  ertragFaellig,
  ertragSumme,
  ertragZielTage,
  hinweis35a,
  karteiAnschrift,
  naechsteBelegNummer,
  offenFaellig,
  papierGewaehlt,
  rechnungOffen,
  summenAbweichung,
  vorlageFuer,
  type BelegVorbereitet,
  type Ertrag,
  type ErtragFehler,
  type ErtragsArt,
  type Ertragsweg,
} from '../../lib/ertrag';
import { formatBetrag, parseBetrag } from '../../lib/money';
import type { ErtragStamm } from '../../lib/queries/ertrag';
import { anschriftText, type BelegZeile, type PositionFormular } from '../../lib/rechnungen';
import { heute } from '../../lib/zeitraum';
import { waehlbar, wahlName } from '../../lib/vorlagen/eigene';
import { Seg } from '../ui/Seg';
import { BelegDropzone, VorgemerkteBelege } from '../belege/BelegDateien';
import { PositionenEditor } from '../belege/PositionenEditor';

interface Props {
  form: Formular;
  ertrag: Ertrag;
  setErtrag: (teil: Partial<Ertrag>) => void;
  /** null: konnte nicht geladen werden (dann geht nur „Ohne eigenen Beleg“) */
  stamm: ErtragStamm | null;
  ladeFehler: string | null;
  belege: readonly VorgemerkterBeleg[];
  nimmtBelege: boolean;
  /** Fehler zu „Offene Rechnung“, den Positionen bzw. zum unterschriebenen Exemplar */
  fehler?: ErtragFehler;
  /** Beleg wie er ausgestellt würde (Bank-Hinweise, Buchungstext); null solange nicht berechenbar */
  vorbereitet: BelegVorbereitet | null;
  onPositionen: (p: PositionFormular[]) => void;
  /** Live-Vorschau neben dem Formular ein-/ausblenden */
  vorschau: boolean;
  onVorschau: (an: boolean) => void;
  onWeg: (weg: Ertragsweg) => void;
  onOffen: (z: BelegZeile) => void;
  /** „Nur buchen“: Nummer der Papierquittung (Formularfeld belegnummer) */
  onNummer: (nummer: string) => void;
  /** Nummer der schon gebuchten Einnahme: Beleg nachträglich (keine offene Rechnung, kein zweites Buchen) */
  buchung?: string | null;
}

const ART_ICON = { quittung: ReceiptEuro, rechnung: FileText } as const;

export function BelegZumErtrag(props: Props) {
  const { form, ertrag, setErtrag, stamm, ladeFehler, fehler, onWeg, onOffen, onNummer, buchung } = props;
  const h = heute();
  const art = ertrag.art;
  const ArtIcon = ART_ICON[art];
  const naechste = stamm ? naechsteBelegNummer(stamm.kreise, art, form.zahlungsdatum, h) : null;
  const offene = stamm?.offene ?? [];
  const alleWege: { weg: Ertragsweg; icon: typeof Clock; label: string; sub: string }[] = [
    { weg: 'beleg', icon: ArtIcon, label: 'Beleg erstellen', sub: naechste ?? (art === 'rechnung' ? 'Rechnung' : 'Quittung') },
    { weg: 'offen', icon: Clock, label: 'Offene Rechnung zuordnen', sub: offene.length ? `${offene.length} offen` : 'keine offen' },
    buchung
      ? { weg: 'ohne', icon: NotebookPen, label: 'Ohne eigenen Beleg', sub: 'bleibt wie gebucht' }
      : { weg: 'ohne', icon: NotebookPen, label: 'Nur buchen', sub: 'Papier oder Datei' },
  ];
  // nachträglich: das Geld ist schon gebucht – eine offene Rechnung zuzuordnen hieße, es doppelt zu buchen
  const wege = buchung ? alleWege.filter((w) => w.weg !== 'offen') : alleWege;

  return (
    <>
      <div className="bu-ew" role="radiogroup" aria-label="Beleg zur Einnahme">
        {wege.map(({ weg, icon: Icon, label, sub }) => {
          const an = ertrag.weg === weg;
          const gesperrt = !stamm && weg !== 'ohne';
          return (
            <button
              key={weg}
              type="button"
              className={`bu-zw-opt ${an ? 'on' : ''}`}
              role="radio"
              aria-checked={an}
              disabled={gesperrt}
              title={gesperrt ? 'Belege konnten nicht geladen werden' : undefined}
              onClick={() => onWeg(weg)}
            >
              <Icon />
              <b>{label}</b>
              <small className={weg === 'beleg' && naechste ? 'mono' : undefined}>{sub}</small>
            </button>
          );
        })}
      </div>
      {ladeFehler ? (
        <p className="hint warn">
          <TriangleAlert />
          Belege konnten nicht geladen werden: {ladeFehler} – „Nur buchen“ geht trotzdem.
        </p>
      ) : null}
      {stamm && ertrag.weg === 'beleg' ? (
        <BelegKasten {...props} stamm={stamm} naechste={naechste} />
      ) : null}
      {stamm && ertrag.weg === 'offen' ? <OffeneListe offene={offene} ertrag={ertrag} heute={h} fehler={fehler?.text} onOffen={onOffen} /> : null}
      {ertrag.weg === 'ohne' && !buchung ? (
        <NurBuchen
          buchung={stamm ? naechsteBelegNummer(stamm.kreise, 'buchung', h, h) : null}
          papier={papierGewaehlt(ertrag, form.zahlungsart)}
          nummer={form.belegnummer}
          onPapier={(papier) => {
            setErtrag({ papier });
            if (!papier) onNummer('');
          }}
          onNummer={onNummer}
        />
      ) : null}
    </>
  );
}

/* ---------- Nur buchen ---------- */

/** Papier-Weg: buchen ohne Beleg aus Kladdy. Gibt es eine Papierquittung, trägt sie entweder ihre eigene Nummer (hier
 *  eintragen) oder die Buchungsnummer (Feld leer lassen) – so findet man Zettel und Buchung wieder. */
function NurBuchen({
  buchung,
  papier,
  nummer,
  onPapier,
  onNummer,
}: {
  buchung: string | null;
  papier: boolean;
  nummer: string;
  onPapier: (papier: boolean) => void;
  onNummer: (nummer: string) => void;
}) {
  return (
    <div className="bu-nur">
      {/* ein Haken statt zweier Optionen: abgeheftet oder nicht */}
      <label className="bu-nur-opt">
        <input type="checkbox" checked={papier} onChange={(e) => onPapier(e.target.checked)} />
        <span>
          <b>Papierquittung im Ordner</b>
          <small>
            Auf den Zettel ins Feld „Buchungs-Nr.“ kommt {buchung ? <span className="mono bu-nur-nr">{buchung}</span> : 'die Buchungsnummer'}.
          </small>
        </span>
      </label>
      {papier ? (
        <input
          className="input bu-nr-in bu-nur-in"
          aria-label="Nummer der Papierquittung"
          placeholder="Eigene Nr. der Quittung (optional)"
          autoComplete="off"
          spellCheck={false}
          value={nummer}
          onChange={(e) => onNummer(e.target.value)}
        />
      ) : null}
    </div>
  );
}

/* ---------- Beleg erstellen ---------- */

function BelegKasten({
  form,
  ertrag,
  setErtrag,
  stamm,
  naechste,
  belege,
  nimmtBelege,
  fehler,
  vorbereitet,
  onPositionen,
  vorschau,
  onVorschau,
  buchung,
}: Omit<Props, 'stamm'> & { stamm: ErtragStamm; naechste: string | null }) {
  const art = ertrag.art;
  const abweichung = buchung ? summenAbweichung(ertrag, parseBetrag(form.betrag)) : null;
  const rechnung = art === 'rechnung';
  const vorlagen = stamm.vorlagen[art];
  const vorlage = vorlageFuer(ertrag, stamm.vorlagen);
  const kartei = karteiAnschrift(form, stamm.kunden);
  const tipp35a = hinweis35a(ertrag, form.zahlungsart);
  const offen = rechnungOffen(ertrag);

  return (
    <div className="bu-doc">
      <div className="bu-doc-head">
        <Seg<ErtragsArt>
          className="bu-art"
          ariaLabel="Quittung oder Rechnung"
          value={art}
          // andere Art ⇒ deren aktive Vorlage
          onChange={(a) => setErtrag({ art: a, vorlage: null })}
          options={[
            {
              value: 'quittung',
              label: (
                <>
                  <ReceiptEuro />
                  Quittung
                </>
              ),
            },
            {
              value: 'rechnung',
              label: (
                <>
                  <FileText />
                  Rechnung
                </>
              ),
            },
          ]}
        />
        <span className="q" title={ERTRAG_ART_TIPP} aria-label={ERTRAG_ART_TIPP}>
          ?
        </span>
        <span className="spacer" />
        <span className="bu-doc-nr" title="Die Nummer wird beim Speichern vergeben – fortlaufend, ohne Lücken">
          <small>erhält Nr.</small>
          <b>{naechste ?? '—'}</b>
        </span>
        <button
          type="button"
          className={`icon-btn sm bu-vs-btn ${vorschau ? 'on' : ''}`}
          aria-pressed={vorschau}
          title={vorschau ? 'Vorschau ausblenden' : 'Vorschau des Belegs zeigen'}
          aria-label={vorschau ? 'Vorschau ausblenden' : 'Vorschau des Belegs zeigen'}
          onClick={() => onVorschau(!vorschau)}
        >
          {vorschau ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {tipp35a ? (
        <p className="hint bu-art-hint">
          <Info />
          {tipp35a}
        </p>
      ) : null}
      <div className="form-grid">
        <div className={`field ${rechnung ? '' : 'full'}`}>
          <label className="field-label" htmlFor="bf-vorlage">
            Vorlage
          </label>
          <select
            id="bf-vorlage"
            className="select"
            value={vorlage.schluessel}
            onChange={(e) => {
              const v = vorlagen.find((x) => x.schluessel === e.target.value);
              if (v) setErtrag({ vorlage: { id: v.id, design: v.design } });
            }}
          >
            {waehlbar(vorlagen, vorlage).map((v) => (
              <option key={v.schluessel} value={v.schluessel}>
                {wahlName(v)}
              </option>
            ))}
          </select>
        </div>
        {rechnung && buchung ? (
          <div className="field">
            <span className="field-label">Status</span>
            <p className="hint bu-bezahlt-hint" title="Die Einnahme ist schon gebucht – die Rechnung wird als bezahlt ausgestellt.">
              <CircleCheck />
              bereits bezahlt
            </p>
          </div>
        ) : rechnung ? (
          <div className="field">
            <span className="field-label">Status</span>
            <Seg
              className="full"
              ariaLabel="Rechnung bezahlt oder offen"
              value={ertrag.bezahlt ? 'bezahlt' : 'offen'}
              onChange={(v) => setErtrag({ bezahlt: v === 'bezahlt' })}
              options={[
                { value: 'bezahlt', label: 'bereits bezahlt' },
                { value: 'offen', label: 'noch offen' },
              ]}
            />
          </div>
        ) : null}
        {(vorbereitet?.bank ?? []).map((x) => (
          <p key={x.text} className={`hint full bu-bank-hint ${x.art === 'warn' ? 'warn' : ''}`}>
            {x.art === 'warn' ? <TriangleAlert /> : <Landmark />}
            {x.text}
          </p>
        ))}
        {kartei ? (
          <p className="hint full bu-adr-kartei">
            <User />
            Anschrift aus der Kundenkartei: {anschriftText(kartei).replace(/\n/g, ', ')}
          </p>
        ) : (
          <div className="field full">
            <label className="field-label" htmlFor="bf-adresse">
              Anschrift des Kunden
              <small className="muted">{rechnung ? 'für die Rechnung nötig' : 'optional, Pflicht über 250 €'}</small>
            </label>
            <textarea
              id="bf-adresse"
              className="textarea"
              rows={2}
              placeholder={'Straße Nr.\nPLZ Ort'}
              value={ertrag.adresse}
              onChange={(e) => setErtrag({ adresse: e.target.value })}
            />
          </div>
        )}
        <div className="field full bu-pos">
          <span className="field-label">
            Positionen
            <small className="muted">{buchung ? 'stehen auf dem Beleg · die Summe muss den Betrag ergeben' : 'stehen auf dem Beleg · die Summe ist der Betrag'}</small>
          </span>
          <PositionenEditor
            positionen={ertrag.positionen}
            onChange={onPositionen}
            vorschlaege={stamm.vorschlaege}
            summe={ertragSumme(ertrag)}
            summeHinweis={stamm.ustModus === 'klein' ? 'umsatzsteuerfrei nach § 19 UStG' : undefined}
          />
          {fehler?.feld === 'positionen' ? (
            <p className="hint neg bu-err" role="alert">
              {fehler.text}
            </p>
          ) : abweichung ? (
            <p className="hint warn" role="status">
              <TriangleAlert />
              {abweichung}
            </p>
          ) : vorbereitet && !offen && !buchung ? (
            <p className="hint">Die Einnahme heißt in Ein- &amp; Ausgänge „{vorbereitet.buchungstext}“.</p>
          ) : null}
        </div>
      </div>
      <p className="hint bu-doc-hint">{belegHinweis(ertrag, buchung ?? null)}</p>
      {nimmtBelege ? (
        <details className="bu-scan" open={belege.length > 0 || fehler?.feld === 'dateien'}>
          <summary>
            <Paperclip />
            Unterschriebenes Exemplar anhängen
            <small>(optional)</small>
          </summary>
          <div className="bu-scan-body">
            <VorgemerkteBelege belege={belege} wann={offen ? 'wird nach dem Ausstellen an die Rechnung gehängt' : 'wird nach dem Ausstellen an den Beleg gehängt'} />
            {belege.length ? null : <BelegDropzone kompakt titel="Scan oder Foto der unterschriebenen Fassung hierher ziehen oder klicken" text="" />}
            {fehler?.feld === 'dateien' ? (
              <p className="hint neg bu-err" role="alert">
                {fehler.text}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

/* ---------- Daten des Belegs (links unter dem Datum) ---------- */

const TIP_LEISTUNG =
  'Tag (oder Zeitraum), an dem du die Leistung erbracht hast – Pflichtangabe auf der Rechnung (§ 14 UStG). Meist der Tag der Arbeit, nicht der Tag, an dem du die Rechnung schreibst.';
const TIP_ZIEL = 'Bis wann der Kunde zahlen soll – in Tagen ab Rechnungsdatum. Steht als „fällig am“ auf der Rechnung. Vorgabe aus Einstellungen › Belege.';
const TIP_LEISTUNG_Q = 'Nur nötig, wenn du die Leistung an einem anderen Tag erbracht hast, als du das Geld bekommst – dann steht beides auf der Quittung.';

const DF_WOCHE = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const datumMitTag = (iso: string | null) => (iso ? DF_WOCHE.format(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))) : '—');

/** Leistungsdatum (Rechnung auch als Zeitraum), Zahlungsziel mit „fällig am“ und bei bezahlter Rechnung der Hinweis,
 *  dass Rechnungs- und Zahlungsdatum derselbe Tag sind. Zellen eines .form-grid (zwei Spalten). */
export function BelegDatumFelder({
  form,
  ertrag,
  setErtrag,
  zielStandard,
  nachtraeglich = false,
}: {
  form: Formular;
  ertrag: Ertrag;
  setErtrag: (teil: Partial<Ertrag>) => void;
  zielStandard: number;
  /** Beleg zu einer schon gebuchten Einnahme: das Datum oben ist deren Zahlungstag */
  nachtraeglich?: boolean;
}) {
  const datum = form.zahlungsdatum;
  const von = ertrag.leistungVon || datum;
  // abgeleitet statt eigenem Zustand: „Speichern & neu“ setzt beides mit dem Ertrag zurück
  const zeitraum = ertrag.leistungBis !== '';
  const bisFeld = zeitraum ? (
    <div className="field">
      <label className="field-label" htmlFor="bf-leistung-bis">
        bis
      </label>
      <input id="bf-leistung-bis" type="date" className="input" min={von} value={ertrag.leistungBis} onChange={(e) => setErtrag({ leistungBis: e.target.value || von })} />
    </div>
  ) : null;

  if (ertrag.art === 'quittung')
    return ertrag.leistungVon ? (
      <>
        <div className={zeitraum ? 'field' : 'field full'}>
          <label className="field-label" htmlFor="bf-leistung" title={TIP_LEISTUNG_Q}>
            {zeitraum ? 'Leistung vom' : 'Leistungsdatum'}
            <span className="q" aria-hidden="true">
              ?
            </span>
            <span className="spacer" />
            <button type="button" className="bl-mini" onClick={() => setErtrag({ leistungVon: '', leistungBis: '' })}>
              Gleicher Tag wie die Zahlung
            </button>
          </label>
          <input id="bf-leistung" type="date" className="input" value={von} onChange={(e) => setErtrag({ leistungVon: e.target.value || datum })} />
        </div>
        {bisFeld}
      </>
    ) : (
      <div className="full bu-leistung-aus">
        <button type="button" className="bl-mini" title={TIP_LEISTUNG_Q} onClick={() => setErtrag({ leistungVon: datum })}>
          Leistung an einem anderen Tag?
        </button>
      </div>
    );

  const ziel = ertragZielTage(ertrag, zielStandard);
  const faellig = ertragFaellig(ertrag, datum, zielStandard);
  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor="bf-leistung" title={TIP_LEISTUNG}>
          {zeitraum ? 'Leistung vom' : 'Leistungsdatum'}
          <span className="q" aria-hidden="true">
            ?
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="bl-mini"
            onClick={() => setErtrag(zeitraum ? { leistungVon: von === datum ? '' : von, leistungBis: '' } : { leistungVon: von, leistungBis: von })}
          >
            {zeitraum ? 'Einzelner Tag' : 'Zeitraum'}
          </button>
        </label>
        {/* einzelner Tag gleich dem Rechnungsdatum ⇒ '' (folgt dem Datum oben) */}
        <input
          id="bf-leistung"
          type="date"
          className="input"
          value={von}
          onChange={(e) => {
            const v = e.target.value || datum;
            setErtrag({ leistungVon: v === datum && !zeitraum ? '' : v });
          }}
        />
      </div>
      {bisFeld}
      <div className="field">
        <label className="field-label" htmlFor="bf-ziel" title={TIP_ZIEL}>
          Zahlungsziel
          <span className="q" aria-hidden="true">
            ?
          </span>
        </label>
        <div className="input-wrap">
          <input
            id="bf-ziel"
            type="number"
            className="input num"
            min={0}
            max={365}
            value={ertrag.zielTage}
            placeholder={String(zielStandard)}
            onChange={(e) => setErtrag({ zielTage: e.target.value })}
          />
          <span className="suffix">Tage</span>
        </div>
        <span className="hint">{Number.parseInt(ziel, 10) > 0 ? `fällig am ${datumMitTag(faellig)}` : 'sofort fällig'}</span>
      </div>
      {ertrag.bezahlt ? (
        <p className="hint full bu-bezahlt-hint">
          <CircleCheck />
          {nachtraeglich
            ? 'Bereits bezahlt: Rechnungsdatum = Zahlungstag der Einnahme.'
            : 'Bereits bezahlt: Zahlungsdatum = Rechnungsdatum – die Einnahme wird an diesem Tag gebucht.'}
        </p>
      ) : null}
    </>
  );
}

/* ---------- Offene Rechnung zuordnen ---------- */

function OffeneListe({ offene, ertrag, heute: h, fehler, onOffen }: { offene: readonly BelegZeile[]; ertrag: Ertrag; heute: string; fehler?: string; onOffen: (z: BelegZeile) => void }) {
  return (
    <>
      {offene.length ? (
        <>
          <div className={`bu-offen ${fehler ? 'invalid' : ''}`} role="radiogroup" aria-label="Offene Rechnung">
            {offene.map((z) => {
              const an = ertrag.offenId === z.id;
              const f = offenFaellig(z, h);
              return (
                <button key={z.id} type="button" className={`bu-offen-opt ${an ? 'on' : ''}`} role="radio" aria-checked={an} onClick={() => onOffen(z)}>
                  <span className="bu-nr-chip">{z.nummer}</span>
                  <b>{z.kunde_name ?? 'ohne Kunde'}</b>
                  <span className="num">{formatBetrag(z.summe_cent)}</span>
                  <small>{z.betreff ?? ''}</small>
                  <small className={f.ueberfaellig ? 'neg-t' : undefined}>{f.text}</small>
                </button>
              );
            })}
          </div>
          <p className="hint">Beim Speichern wird die Rechnung als bezahlt markiert und mit dieser Einnahme verknüpft.</p>
        </>
      ) : (
        <div className={`bu-offen-empty ${fehler ? 'invalid' : ''}`}>Keine offenen Rechnungen – alles bezahlt.</div>
      )}
      {fehler ? (
        <p className="hint neg bu-err" role="alert">
          {fehler}
        </p>
      ) : null}
    </>
  );
}
