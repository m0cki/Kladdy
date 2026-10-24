/* „Beleg zum Ertrag“ in der Erfassen-Schublade (§6.4 Punkt 6, Prototyp buchungen.js renderBeleg/docPanelHTML/offenHTML):
 * drei Wege als Kacheln – Beleg erstellen (Standard) · Offene Rechnung zuordnen · Ohne eigenen Beleg.
 * - Beleg erstellen: Art Quittung | Rechnung (Vorauswahl aus Einstellungen › Belege), angezeigte Nummer, Vorlage, bei
 *   Rechnung „bereits bezahlt | noch offen“, Anschrift (sofern nicht in der Kundenkartei), Leistung, Hinweis zu § 35a und
 *   Schritt 2 „Unterschriebenes Exemplar anhängen“ (eine Datei, wird nach dem Ausstellen an den Beleg gehängt).
 * - Offene Rechnung zuordnen: Liste der offenen Rechnungen; die Wahl übernimmt Betrag, Text und Kunde.
 * - Ohne eigenen Beleg: die Dateifläche darunter (zeichnet die Schublade selbst).
 * Logik in lib/ertrag.ts, gespeichert wird in ErfassenSchublade (beleg_ausstellen bzw. beleg_bezahlt). */
import { Clock, FileText, Info, Paperclip, Receipt, TriangleAlert, Upload, User } from 'lucide-react';
import type { Formular } from '../../lib/buchungen';
import type { VorgemerkterBeleg } from '../../lib/belege';
import {
  ERTRAG_ART_TIPP,
  belegHinweis,
  hinweis35a,
  karteiAnschrift,
  naechsteBelegNummer,
  offenFaellig,
  rechnungOffen,
  vorlageFuer,
  type Ertrag,
  type ErtragsArt,
  type Ertragsweg,
} from '../../lib/ertrag';
import { formatBetrag } from '../../lib/money';
import type { ErtragStamm } from '../../lib/queries/ertrag';
import { anschriftText, type BelegZeile } from '../../lib/rechnungen';
import { heute } from '../../lib/zeitraum';
import { Seg } from '../ui/Seg';
import { BelegDropzone, VorgemerkteBelege } from '../belege/BelegDateien';

interface Props {
  form: Formular;
  ertrag: Ertrag;
  setErtrag: (teil: Partial<Ertrag>) => void;
  /** null: konnte nicht geladen werden (dann geht nur „Ohne eigenen Beleg“) */
  stamm: ErtragStamm | null;
  ladeFehler: string | null;
  belege: readonly VorgemerkterBeleg[];
  nimmtBelege: boolean;
  /** Fehler zu „Offene Rechnung“ bzw. zum unterschriebenen Exemplar */
  fehler?: string;
  onWeg: (weg: Ertragsweg) => void;
  onOffen: (z: BelegZeile) => void;
}

const ART_ICON = { quittung: Receipt, rechnung: FileText } as const;

export function BelegZumErtrag({ form, ertrag, setErtrag, stamm, ladeFehler, belege, nimmtBelege, fehler, onWeg, onOffen }: Props) {
  const h = heute();
  const art = ertrag.art;
  const ArtIcon = ART_ICON[art];
  const naechste = stamm ? naechsteBelegNummer(stamm.kreise, art, form.zahlungsdatum, h) : null;
  const offene = stamm?.offene ?? [];
  const wege: { weg: Ertragsweg; icon: typeof Clock; label: string; sub: string }[] = [
    { weg: 'beleg', icon: ArtIcon, label: 'Beleg erstellen', sub: naechste ?? (art === 'rechnung' ? 'Rechnung' : 'Quittung') },
    { weg: 'offen', icon: Clock, label: 'Offene Rechnung zuordnen', sub: offene.length ? `${offene.length} offen` : 'keine offen' },
    { weg: 'ohne', icon: Upload, label: 'Ohne eigenen Beleg', sub: 'Datei anhängen' },
  ];

  return (
    <>
      <div className="bu-ew" role="radiogroup" aria-label="Beleg zum Ertrag">
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
          Belege konnten nicht geladen werden: {ladeFehler} – „Ohne eigenen Beleg“ geht trotzdem.
        </p>
      ) : null}
      {stamm && ertrag.weg === 'beleg' ? (
        <BelegKasten form={form} ertrag={ertrag} setErtrag={setErtrag} stamm={stamm} naechste={naechste} belege={belege} nimmtBelege={nimmtBelege} fehler={fehler} />
      ) : null}
      {stamm && ertrag.weg === 'offen' ? <OffeneListe offene={offene} ertrag={ertrag} heute={h} fehler={fehler} onOffen={onOffen} /> : null}
    </>
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
}: Pick<Props, 'form' | 'ertrag' | 'setErtrag' | 'belege' | 'nimmtBelege' | 'fehler'> & { stamm: ErtragStamm; naechste: string | null }) {
  const art = ertrag.art;
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
                  <Receipt />
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
            value={vorlage.design}
            onChange={(e) => {
              const v = vorlagen.find((x) => x.design === e.target.value);
              if (v) setErtrag({ vorlage: { id: v.id, design: v.design } });
            }}
          >
            {vorlagen.map((v) => (
              <option key={v.design} value={v.design}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        {rechnung ? (
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
        <div className="field full">
          <label className="field-label" htmlFor="bf-leistung">
            Leistung
            <small className="muted">steht auf dem Beleg</small>
          </label>
          <input
            id="bf-leistung"
            className="input"
            autoComplete="off"
            placeholder={form.beschreibung.trim() || 'wie Beschreibung'}
            value={ertrag.leistung}
            onChange={(e) => setErtrag({ leistung: e.target.value })}
          />
        </div>
      </div>
      <p className="hint bu-doc-hint">{belegHinweis(ertrag)}</p>
      {nimmtBelege ? (
        <details className="bu-scan" open={belege.length > 0 || Boolean(fehler)}>
          <summary>
            <Paperclip />
            Unterschriebenes Exemplar anhängen
            <small>(optional)</small>
          </summary>
          <div className="bu-scan-body">
            <VorgemerkteBelege belege={belege} wann={offen ? 'wird nach dem Ausstellen an die Rechnung gehängt' : 'wird nach dem Ausstellen an den Beleg gehängt'} />
            {belege.length ? null : <BelegDropzone kompakt titel="Scan oder Foto der unterschriebenen Fassung hierher ziehen oder klicken" text="" />}
            {fehler ? (
              <p className="hint neg bu-err" role="alert">
                {fehler}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
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
