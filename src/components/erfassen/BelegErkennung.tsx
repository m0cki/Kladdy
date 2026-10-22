/* Belegerkennung in der Erfassen-Schublade (§6.4 „Drag & Drop auf das Fenster“): oben ein Kasten mit der Zusammenfassung
 * („Erkannt: 47,83 € · 14.09.2026 · Bauhaus · Produkte & Material“, solange gelesen wird „Beleg wird gelesen …“), an jedem
 * übernommenen Feld die Marke „aus PDF“ / „aus Dateiname“ (wie „Vorschlag“ bei der Kategorie), bis der Wert geändert wird.
 * Das Ergebnis kommt über useErfassen.erkennung (lib/belegablage.ts); übernommen wird nur in leere bzw. unveränderte
 * Felder (lib/erkennung/anwenden.ts), gesperrte Einträge bleiben unberührt. Optik wie .bu-recog im Prototyp
 * (referenz/prototyp/js/pages/buchungen.js, renderRecog). */
import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Info, LoaderCircle, Sparkles, X } from 'lucide-react';
import type { FormFeld, Formular, KategorieWahl } from '../../lib/buchungen';
import { useErfassen, type ErkennungsStand } from '../../lib/erfassen';
import { erkennungAnwenden, vorschlagAktiv, type VorschlagFeld, type Vorschlaege } from '../../lib/erkennung/anwenden';

/** Fehlermeldung, die ein gefülltes Feld erledigt. */
const FEHLER_FELD: Partial<Record<VorschlagFeld, FormFeld>> = {
  betrag: 'betrag',
  kategorieId: 'kategorie',
  zahlungsdatum: 'zahlungsdatum',
  beschreibung: 'beschreibung',
  wer: 'wer',
};

export interface ErkennungAnsicht {
  /** Kasten oben in der Schublade (null = nichts zu zeigen) */
  kopf: ReactNode;
  /** Marke „aus PDF“ / „aus Dateiname“ an einem Feld, solange der erkannte Wert unverändert drinsteht (sonst null) */
  marke: (feld: VorschlagFeld) => ReactNode;
  /** Rechnungsdatum bei Lastschrift – wird als Belegdatum gespeichert, solange das erkannte Zahlungsdatum drinsteht */
  belegdatum: string | null;
}

interface Optionen {
  /** Auftrag der Schublade (useErfassen.auftrag.n) */
  auftragN: number;
  /** Formular geladen und gehört zu diesem Auftrag */
  bereit: boolean;
  form: Formular | null;
  /** Schlüssel des Ausgangsformulars (wechselt beim Laden und bei „Speichern & neu“) */
  start: string;
  /** neuer Eintrag (nicht bearbeiten) */
  neu: boolean;
  nurLesen: boolean;
  katGewaehlt: boolean;
  kategorien: readonly KategorieWahl[] | undefined;
  setForm: Dispatch<SetStateAction<Formular | null>>;
  fehlerWeg: (k: FormFeld) => void;
}

export function useBelegErkennung(o: Optionen): ErkennungAnsicht {
  const stand = useErfassen((s) => s.erkennung);
  const aktiv = stand && stand.fuer === o.auftragN ? stand : null;
  const [werte, setWerte] = useState<{ fuer: number; vorschlaege: Vorschlaege } | null>(null);
  /** Kennung der ausgeblendeten Zusammenfassung */
  const [zu, setZu] = useState<number | null>(null);
  const basis = useRef<Formular | null>(null);
  const angewendet = useRef(0);

  // Ausgangsformular merken, sobald ein Formular steht (Laden, „Speichern & neu“): unveränderte Felder gelten als frei
  useEffect(() => {
    if (o.bereit) basis.current = o.form;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur bei neuem Formular
  }, [o.bereit, o.start, o.auftragN]);

  // keine Erkennung mehr (Schublade zu, „Speichern & neu“, Datei herausgenommen) ⇒ Marken weg, Werte bleiben
  useEffect(() => {
    if (!aktiv) setWerte(null);
  }, [aktiv]);

  // Ergebnis übernehmen – einmal je Erkennung, sobald das Formular steht
  useEffect(() => {
    if (!aktiv || aktiv.status !== 'fertig' || !o.bereit || !o.form || !basis.current || angewendet.current === aktiv.id) return;
    angewendet.current = aktiv.id;
    if (o.nurLesen) return;
    const r = erkennungAnwenden(o.form, aktiv.ergebnis, {
      basis: basis.current,
      neu: o.neu,
      katGewaehlt: o.katGewaehlt,
      kategorien: o.kategorien ?? [],
      bisher: werte?.fuer === aktiv.fuer ? werte.vorschlaege : undefined,
    });
    if (r.gefuellt.length) o.setForm(r.form);
    setWerte({ fuer: aktiv.fuer, vorschlaege: r.vorschlaege });
    for (const k of r.gefuellt) {
      const f = FEHLER_FELD[k];
      if (f) o.fehlerWeg(f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur bei neuem Ergebnis bzw. sobald das Formular steht
  }, [aktiv, o.bereit]);

  const vorschlaege = aktiv && werte?.fuer === aktiv.fuer ? werte.vorschlaege : null;
  const form = o.form;
  const marke = (feld: VorschlagFeld): ReactNode => {
    const v = vorschlaege && form ? vorschlagAktiv(form, vorschlaege, feld) : null;
    if (!v) return null;
    const unsicher = v.sicherheit === 'niedrig';
    return (
      <span className={`sugg-tag ${unsicher ? 'low' : ''}`} title={unsicher ? 'Unsicher erkannt – bitte prüfen' : 'Automatisch erkannt – bitte kurz prüfen'}>
        <Sparkles />
        {v.quelle === 'dateiname' ? 'aus Dateiname' : 'aus PDF'}
      </span>
    );
  };
  const rechnungsdatum = aktiv?.status === 'fertig' ? (aktiv.ergebnis.felder.belegdatum ?? null) : null;
  const belegdatum = rechnungsdatum && vorschlaege && form && vorschlagAktiv(form, vorschlaege, 'zahlungsdatum') ? rechnungsdatum : null;
  const kopf = aktiv && zu !== aktiv.id ? <ErkennungKasten stand={aktiv} onZu={() => setZu(aktiv.id)} /> : null;
  return { kopf, marke, belegdatum };
}

/* ---------- Kasten oben: liest … · Erkannt … · Nichts erkannt ---------- */

function ErkennungKasten({ stand, onZu }: { stand: ErkennungsStand; onZu: () => void }) {
  if (stand.status === 'laeuft')
    return (
      <div className="bu-recog loading" role="status">
        <LoaderCircle className="ic spin" />
        <div className="bu-recog-main">
          <div className="bu-recog-head">
            <b>Beleg wird gelesen …</b>
            <span className="muted">Betrag, Datum, Geschäft</span>
          </div>
        </div>
      </div>
    );
  const e = stand.ergebnis;
  const nichts = !e.zusammenfassung;
  return (
    <div className={`bu-recog ${nichts ? 'none' : ''}`} role="status">
      {nichts ? <Info /> : <Sparkles />}
      <div className="bu-recog-main">
        <div className="bu-recog-head">
          {nichts ? (
            <b>Nichts erkannt</b>
          ) : (
            <span>
              <b>Erkannt:</b> {e.zusammenfassung.replace(/^Erkannt:\s*/, '')}
            </span>
          )}
          {e.quelle !== 'keine' ? <span className="muted">{e.quelle === 'pdf' ? 'aus dem PDF' : 'aus dem Dateinamen'} · bitte kurz prüfen</span> : null}
        </div>
        {nichts ? <p className="hint">Bitte Betrag, Datum und Geschäft selbst eintragen.</p> : null}
        {e.hinweise.length ? (
          <ul className="bu-recog-hints">
            {e.hinweise.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <button type="button" className="icon-btn sm" title="Ausblenden" aria-label="Erkennung ausblenden" onClick={onZu}>
        <X />
      </button>
    </div>
  );
}
