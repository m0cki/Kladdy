/* Aktionen zu einem Termin mit Toast und „Rückgängig“ (§6.5, Prototyp termine.js abhaken/ohneBelegAbschliessen/
 * nichtErledigt/absagen): Seite Termine, Termin-Schublade und Kunden-Schublade nutzen dieselben Wege.
 * Geschrieben wird nur über Rust (lib/queries/termine.ts → src-tauri/src/termine.rs); „Rückgängig“ setzt den Stand vor
 * dem Vorgang zurück und legt verworfene Entwürfe wieder an (termin_zuruecksetzen). Den Beleg stellt immer die eine
 * Erfassen-Schublade aus (erfassen mit `termin` und `entwurf`). */
import { useUi, type ToastAction, type ToastIcon } from '../store/ui';
import { bearbeiten, erfassen } from './erfassen';
import type { ErtragsArt } from './ertrag';
import { fehlerText } from './fehler';
import { ladeBeleg } from './queries/rechnungen';
import {
  terminAbsagen,
  terminErledigt,
  terminLoeschen,
  terminNichtErledigt,
  terminOhneBeleg,
  terminSpeichern,
  terminZuruecksetzen,
  type TerminErgebnis,
  type TerminStamm,
} from './queries/termine';
import { formularAusEntwurf, type BelegFormular } from './rechnungen';
import { terminFlash, terminSchliessen } from './termin-schublade';
import {
  ART_LABEL,
  ausstellArt,
  ausstellLabel,
  kannAusstellen,
  terminDatenAus,
  vorbelegungZumAusstellen,
  vorbereitungDaten,
  type Termin,
} from './termine';
import { heute } from './zeitraum';

/** Toast, dessen Knöpfe ihn auch schließen. */
function toastMit(text: string, aktionen: ToastAction[], icon: ToastIcon = 'check'): void {
  let id = 0;
  id = useUi.getState().showToast({
    text,
    icon,
    actions: aktionen.map((a) => ({
      label: a.label,
      run: () => {
        useUi.getState().dismissToast(id);
        a.run();
      },
    })),
  });
}

const warnen = (e: unknown): void => {
  useUi.getState().showToast({ text: fehlerText(e), icon: 'warn', sticky: true });
};

/** Nach jedem Schreiben: Listen und Zähler neu laden, Termin hervorheben. */
function geaendert(id: number): void {
  useUi.getState().datenGeaendert();
  terminFlash(id);
}

const verworfenText = (r: TerminErgebnis): string => {
  const art = r.verworfen[0]?.art;
  return art === 'quittung' || art === 'rechnung' ? ` · vorbereitete ${ART_LABEL[art]} verworfen` : '';
};

/** Stand vor dem Vorgang wiederherstellen (verworfene Entwürfe kommen neu angelegt zurück). */
async function zurueck(r: TerminErgebnis, text: string): Promise<void> {
  if (!r.vorher) return;
  try {
    await terminZuruecksetzen(r.id, r.vorher, r.verworfen);
    geaendert(r.id);
    useUi.getState().showToast({ text, icon: 'info' });
  } catch (e) {
    warnen(e);
  }
}

/** „✓ Erledigt“: nur abhaken – keine Navigation; der Toast bietet gleich „Quittung ausstellen“ an. */
export async function abhaken(t: Termin, standard: ErtragsArt): Promise<void> {
  try {
    const r = await terminErledigt(t.id, heute());
    geaendert(t.id);
    const erledigt: Termin = { ...t, status: 'erledigt', ohne_beleg: 0 };
    const aktionen: ToastAction[] = [];
    if (kannAusstellen(erledigt)) aktionen.push({ label: ausstellLabel(ausstellArt(t, standard)), run: () => belegAusstellen(erledigt, standard) });
    aktionen.push({ label: 'Rückgängig', run: () => void zurueck(r, 'Termin wieder geplant') });
    toastMit('Termin erledigt', aktionen);
  } catch (e) {
    warnen(e);
  }
}

/** „Quittung ausstellen“ bzw. „Rechnung schreiben“: die eine Erfassen-Schublade, vorbefüllt aus Termin und Entwurf. */
export function belegAusstellen(t: Termin, standard: ErtragsArt): void {
  if (!kannAusstellen(t)) return;
  erfassen(vorbelegungZumAusstellen(t, standard, heute()));
}

/** Erledigt, aber bewusst ohne Beleg (Nachbesserung, kostenlos): der vorbereitete Entwurf wird verworfen. */
export async function ohneBelegAbschliessen(t: Termin): Promise<void> {
  try {
    const r = await terminOhneBeleg(t.id);
    geaendert(t.id);
    toastMit(`Ohne Beleg abgeschlossen${verworfenText(r)}`, [{ label: 'Rückgängig', run: () => void zurueck(r, 'Termin wieder ohne Abschluss') }]);
  } catch (e) {
    warnen(e);
  }
}

/** „Doch nicht erledigt“: zurück auf geplant. */
export async function nichtErledigt(t: Termin): Promise<void> {
  try {
    const r = await terminNichtErledigt(t.id);
    geaendert(t.id);
    toastMit('Termin wieder offen', [{ label: 'Rückgängig', run: () => void zurueck(r, 'Termin wieder erledigt') }], 'info');
  } catch (e) {
    warnen(e);
  }
}

/** Absagen: Grund an die Notiz, vorbereiteter Entwurf verworfen – kein Storno nötig. */
export async function absagen(t: Pick<Termin, 'id'>, grund: string): Promise<boolean> {
  try {
    const r = await terminAbsagen(t.id, grund.trim() || null, heute());
    geaendert(t.id);
    toastMit(`Termin abgesagt${verworfenText(r)}`, [{ label: 'Rückgängig', run: () => void zurueck(r, 'Absage zurückgenommen – Termin wieder geplant') }], 'info');
    return true;
  } catch (e) {
    warnen(e);
    return false;
  }
}

/** Abgesagten Termin löschen (im Protokoll). */
export async function loeschen(t: Pick<Termin, 'id'>): Promise<void> {
  try {
    await terminLoeschen(t.id);
    useUi.getState().datenGeaendert();
    terminSchliessen();
    useUi.getState().showToast({ text: 'Termin gelöscht (im Protokoll)', icon: 'info' });
  } catch (e) {
    warnen(e);
  }
}

/** „Quittung vorbereiten“ aus dem Menü: Entwurf ohne Nummer zum Termin (Art aus Einstellungen › Belege). */
export async function vorbereiten(t: Termin, stamm: Pick<TerminStamm, 'belegArt' | 'zielTage' | 'vorlagen'>, oeffnen: (belegId: number) => void): Promise<void> {
  const art = stamm.belegArt;
  const h = heute();
  const entwurf = vorbereitungDaten({
    art,
    termin: { datum: t.datum, leistung: t.leistung, betrag: t.betrag_geschaetzt_cent },
    vorhanden: null,
    altLeistung: t.leistung,
    zielTage: stamm.zielTage,
    vorlageId: stamm.vorlagen[art].id,
    vorlageDesign: stamm.vorlagen[art].design,
    heute: h,
  });
  if (!entwurf) return;
  try {
    const r = await terminSpeichern(t.id, terminDatenAus(t, art, h), entwurf);
    geaendert(t.id);
    const id = r.entwurf_id;
    const aktionen: ToastAction[] = [];
    if (id != null) aktionen.push({ label: 'Öffnen', run: () => oeffnen(id) });
    aktionen.push({
      label: 'Rückgängig',
      run: () =>
        void terminSpeichern(t.id, terminDatenAus(t, 'keinen', heute()), null).then(
          () => geaendert(t.id),
          (e: unknown) => warnen(e),
        ),
    });
    toastMit(`${ART_LABEL[art]} vorbereitet – Entwurf ohne Nummer`, aktionen);
  } catch (e) {
    warnen(e);
  }
}

/** Einnahme „bezahlt ohne Beleg“ in der Erfassen-Schublade öffnen. */
export function einnahmeOeffnen(t: Termin): void {
  if (t.einnahme) bearbeiten(t.einnahme.id);
}

/** Vorbereiteten Beleg (Entwurf ohne Nummer) als Formular der Beleg-Maske laden; null, wenn er schon ausgestellt ist. */
export async function entwurfFormular(id: number, h: string): Promise<BelegFormular | null> {
  const b = await ladeBeleg(id);
  if (!b || b.beleg.nummer) return null;
  return formularAusEntwurf(b.beleg, b.positionen, h);
}
