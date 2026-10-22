/* Belege ablegen – der Ablauf (§6.4 „Drag & Drop auf das Fenster“, ⌘O „Beleg importieren …“, „Beleg anhängen …“).
 * Datei aufs Fenster gezogen oder im Dialog gewählt ⇒ beleg_pruefen (Rust, nur lesen) ⇒
 *   - offene Erfassen-Schublade, die Dateien annimmt (neu, bearbeiten oder festgeschrieben ansehen): dort vormerken;
 *   - sonst: Erfassen-Schublade als Ausgabe mit den Dateien öffnen (der eine Erfassen-Weg, nur vorbelegt).
 * Ungültige Dateien ⇒ ein Warn-Toast mit dem Text aus Rust. Doppelte Dateien zeigt die Schublade als Hinweis.
 * Danach läuft im Hintergrund die Belegerkennung für die erste PDF (sonst die erste Datei, dann nur der Dateiname):
 * lib/erkennung/erkennen.ts; das Ergebnis geht an useErfassen.erkennung, die Schublade füllt damit leere Felder.
 * Nur in der Mac-App; im Browser passiert beim Ziehen nichts. */
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import { create } from 'zustand';
import { useUi } from '../store/ui';
import { DIALOG_FILTER, abgelehntText, angehaengtText, dateiArt, doppeltText, pruefungAuswerten, type VorgemerkterBeleg } from './belege';
import { typName, type BuchungTyp } from './buchungen';
import { belegeLeeren, belegeVormerken, erfassen, erkennungBeginnen, erkennungFertig, useErfassen } from './erfassen';
import { belegErkennen } from './erkennung/erkennen';
import { fehlerText } from './fehler';
import { inTauri } from './menu';
import { belegAnhaengen, belegPruefen } from './queries/belege';

/** Wird gerade eine Datei über das Fenster gezogen? (Overlay bzw. Dropzone „.over“) */
export const useBelegZiehen = create<{ ziehen: boolean }>(() => ({ ziehen: false }));

const warn = (text: string) => useUi.getState().showToast({ text, icon: 'warn', sticky: true });

/** Dateien prüfen; ungültige melden, gültige zurückgeben. */
async function pruefen(pfade: string[]): Promise<VorgemerkterBeleg[]> {
  if (!pfade.length) return [];
  try {
    const { gueltig, abgelehnt } = pruefungAuswerten(await belegPruefen(pfade));
    const t = abgelehntText(abgelehnt);
    if (t) warn(t);
    return gueltig;
  } catch (e) {
    warn(`Beleg konnte nicht gelesen werden: ${fehlerText(e)}`);
    return [];
  }
}

/** Nimmt die offene Erfassen-Schublade gerade Dateien an? */
export function schubladeNimmtBelege(): boolean {
  const e = useErfassen.getState();
  return useUi.getState().drawer === 'erfassen' && e.auftrag !== null && e.nimmtBelege;
}

/** Gemeinsamer Ablauf für Drop und Dialog. */
export async function belegeUebernehmen(pfade: string[]): Promise<void> {
  const gueltig = await pruefen(pfade);
  if (!gueltig.length) return;
  if (schubladeNimmtBelege()) belegeVormerken(gueltig);
  else erfassen({ typ: 'ausgabe', belege: gueltig });
  erkennen(gueltig);
}

/** Erkennung für die erste PDF (sonst die erste Datei) – nur wenn die Schublade sie vorgemerkt hat, ohne auf sie zu warten. */
function erkennen(dateien: readonly VorgemerkterBeleg[]): void {
  const datei = dateien.find((b) => dateiArt(b.name, b.mime) === 'pdf') ?? dateien[0];
  const id = datei ? erkennungBeginnen(datei.pfad) : null;
  if (!datei || id === null) return;
  void belegErkennen(datei).then((ergebnis) => erkennungFertig(id, ergebnis));
}

/** Nativer Datei-Dialog (mehrere Dateien, nur erlaubte Typen). Leer bei Abbruch. */
async function dateienWaehlen(title: string): Promise<string[]> {
  const r: string | string[] | null = await open({ title, multiple: true, directory: false, filters: [DIALOG_FILTER] });
  return r == null ? [] : Array.isArray(r) ? r : [r];
}

const nurMacApp = () => useUi.getState().toast('Belege ablegen geht nur in der Mac-App (npm run tauri dev).', 'info');

/** ⌘O / Menü „Beleg importieren …“ / Klick auf die Dropzone: Dialog, dann wie ein Drop. */
export async function belegImportieren(): Promise<void> {
  if (!inTauri()) return nurMacApp();
  try {
    const pfade = await dateienWaehlen('Beleg importieren');
    if (pfade.length) await belegeUebernehmen(pfade);
  } catch (e) {
    warn(fehlerText(e));
  }
}

export interface AnhangZiel {
  id: number;
  nummer: string;
  typ: BuchungTyp;
}

/** Schon geprüfte Dateien an eine bestehende Buchung hängen (Rust beleg_anhaengen). true bei Erfolg. */
export async function anhaengen(ziel: AnhangZiel, belege: readonly VorgemerkterBeleg[]): Promise<boolean> {
  if (!belege.length) return false;
  const ui = useUi.getState();
  try {
    const { ids } = await belegAnhaengen(ziel.id, belege.map((b) => b.pfad));
    ui.datenGeaendert();
    const d = belege.length === 1 ? doppeltText(belege[0].doppelt) : null;
    ui.showToast({ text: `${angehaengtText(ids.length, `${typName(ziel.typ)} ${ziel.nummer}`)}${d ? ` · ${d.charAt(0).toLowerCase()}${d.slice(1)}` : ''}`, icon: 'check' });
    return true;
  } catch (e) {
    warn(`Beleg anhängen ging nicht: ${fehlerText(e)}`);
    return false;
  }
}

/** Zeilenmenü „Beleg anhängen …“ in Ein- & Ausgänge: Dialog, prüfen, anhängen. */
export async function belegAnhaengenDialog(ziel: AnhangZiel): Promise<void> {
  if (!inTauri()) return nurMacApp();
  try {
    const pfade = await dateienWaehlen(`Beleg an ${ziel.nummer} anhängen`);
    const gueltig = await pruefen(pfade);
    await anhaengen(ziel, gueltig);
  } catch (e) {
    warn(fehlerText(e));
  }
}

/** Vorgemerkte Dateien der offenen Schublade an deren (festgeschriebene) Buchung hängen, danach Vormerkung leeren. */
export async function vorgemerkteAnhaengen(ziel: AnhangZiel): Promise<void> {
  if (await anhaengen(ziel, useErfassen.getState().belege)) belegeLeeren();
}

/** Eigenes Ziel einer Seite für Datei-Drops aufs Fenster (Beleg-Maske: unterschriebenes Exemplar); null = wie üblich. */
let dropZiel: ((pfade: string[]) => void) | null = null;
export function setzeDropZiel(ziel: ((pfade: string[]) => void) | null): void {
  dropZiel = ziel;
}

/** Drag & Drop aufs Fenster beobachten (Tauri-Webview-Ereignisse). Gibt eine Abmelde-Funktion zurück. */
export function watchBelegDrop(): () => void {
  if (!inTauri()) return () => {};
  let cancelled = false;
  let unlisten: (() => void) | null = null;
  const setZiehen = (ziehen: boolean) => {
    if (useBelegZiehen.getState().ziehen !== ziehen) useBelegZiehen.setState({ ziehen });
  };
  getCurrentWebview()
    .onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === 'enter') setZiehen(p.paths.length > 0);
      else if (p.type === 'leave') setZiehen(false);
      else if (p.type === 'drop') {
        setZiehen(false);
        if (!p.paths.length) return;
        if (dropZiel) dropZiel(p.paths);
        else void belegeUebernehmen(p.paths);
      }
    })
    .then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    })
    .catch(() => {
      /* ohne Webview-Ereignisse (z. B. Tests) einfach nichts tun */
    });
  return () => {
    cancelled = true;
    unlisten?.();
    setZiehen(false);
  };
}
