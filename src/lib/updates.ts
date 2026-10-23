/* Updates aus der App heraus (§3.2): tauri-plugin-updater + tauri-plugin-process.
 * - Automatisch beim Start höchstens einmal pro Tag, nur wenn „Automatisch nach Updates suchen“ an ist (Standard: an).
 * - Von Hand über das Menü „Nach Updates suchen …“ und den Knopf in den Einstellungen.
 * - Neue Version ⇒ Toast „Version X ist da“ · „Was ist neu?“ · „Jetzt aktualisieren“ ⇒ laden und installieren mit
 *   Fortschritt (man kann weiterarbeiten) ⇒ Toast „Update bereit“ · „Jetzt neu starten“ · „Später“.
 *   Neu gestartet wird nur auf Klick; „Später“ ⇒ die neue Version ist beim nächsten Start einfach da.
 * - Entwicklerversion (`npm run tauri dev`, Debug-Build) installiert nie, sie meldet nur die neue Version.
 * Außerhalb von Tauri (npm run dev im Browser) passiert nichts – höchstens ein Hinweis bei manueller Prüfung.
 * Reine Funktionen (Laden/Speichern, Tagesgrenze, Fortschritt, Installieren erlaubt) sind mit Vitest getestet. */
import { getVersion } from '@tauri-apps/api/app';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { create } from 'zustand';
import { version as PAKET_VERSION } from '../../package.json';
import type { KeyValueStore } from './settings';
import { useUi } from '../store/ui';

export const UPDATES_KEY = 'kladdy.updates.v1';
export const TAG_MS = 24 * 60 * 60 * 1000;
const UPDATE_TOAST = 'update';

/* ---------- Einstellungen (localStorage; ab Phase 1 ggf. Tabelle einstellungen) ---------- */
export interface UpdatePrefs {
  auto: boolean;
  /** Zeitpunkt der letzten erfolgreichen Prüfung (ISO) */
  lastCheck: string | null;
}

export const defaultPrefs = (): UpdatePrefs => ({ auto: true, lastCheck: null });

export function loadPrefs(store: KeyValueStore | undefined): UpdatePrefs {
  try {
    const raw = store?.getItem(UPDATES_KEY);
    const r = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const last = typeof r.lastCheck === 'string' && !Number.isNaN(Date.parse(r.lastCheck)) ? r.lastCheck : null;
    return { auto: typeof r.auto === 'boolean' ? r.auto : true, lastCheck: last };
  } catch {
    return defaultPrefs();
  }
}

export function savePrefs(store: KeyValueStore | undefined, p: UpdatePrefs): void {
  try {
    store?.setItem(UPDATES_KEY, JSON.stringify(p));
  } catch {
    /* Speicher gesperrt – dann eben wieder beim nächsten Start */
  }
}

/** Automatisch prüfen? Nur wenn eingeschaltet und die letzte Prüfung mindestens einen Tag her ist (oder in der Zukunft liegt). */
export function shouldAutoCheck(p: UpdatePrefs, now: number): boolean {
  if (!p.auto) return false;
  if (!p.lastCheck) return true;
  const last = Date.parse(p.lastCheck);
  if (Number.isNaN(last) || last > now) return true;
  return now - last >= TAG_MS;
}

/** Fortschritt 0–1 oder null (Größe unbekannt). */
export function fortschritt(geladen: number, gesamt: number | undefined): number | null {
  if (!gesamt || gesamt <= 0) return null;
  return Math.min(1, Math.max(0, geladen / gesamt));
}

/* ---------- Zustand ---------- */
/** `ready`: geladen und installiert, wartet auf den Neustart. */
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'restarting' | 'error';

/** Darf „Jetzt aktualisieren“ laden und installieren? Nie in der Entwicklerversion, nur bei gefundener Version. */
export function kannInstallieren(status: UpdateStatus, entwickler: boolean): boolean {
  return !entwickler && status === 'available';
}

interface UpdateState extends UpdatePrefs {
  status: UpdateStatus;
  /** gefundene neue Version */
  version?: string;
  notes?: string;
  date?: string;
  progress: number | null;
  /** Debug-Build (`npm run tauri dev`): dort wird nie installiert */
  entwickler: boolean;
  setAuto: (auto: boolean) => void;
}

const storage = (): Storage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

export const useUpdates = create<UpdateState>((set, get) => ({
  ...loadPrefs(storage()),
  status: 'idle',
  progress: null,
  entwickler: false,
  setAuto: (auto) => {
    set({ auto });
    savePrefs(storage(), { auto, lastCheck: get().lastCheck });
  },
}));

function markChecked(): void {
  const lastCheck = new Date().toISOString();
  useUpdates.setState({ lastCheck });
  savePrefs(storage(), { auto: useUpdates.getState().auto, lastCheck });
}

/* ---------- Version ---------- */
/** Version der laufenden App (in Tauri aus tauri.conf.json, sonst aus package.json). */
export async function appVersion(): Promise<string> {
  if (!isTauri()) return PAKET_VERSION;
  try {
    return await getVersion();
  } catch {
    return PAKET_VERSION;
  }
}

let entwicklerAbfrage: Promise<boolean> | null = null;
/** Läuft ein Debug-Build? Entscheidet Rust (`ist_entwicklerversion`). Im Zweifel ja – lieber nicht installieren. */
export function entwicklerversion(): Promise<boolean> {
  entwicklerAbfrage ??= (isTauri() ? invoke<boolean>('ist_entwicklerversion') : Promise.resolve(false))
    .catch(() => true)
    .then((entwickler) => {
      useUpdates.setState({ entwickler });
      return entwickler;
    });
  return entwicklerAbfrage;
}

/* ---------- Ablauf ---------- */
let pending: Update | null = null;

/** Nach Updates suchen. `manual`: Ergebnis immer melden (auch „aktuell“ und Fehler); automatisch nur bei neuer Version. */
export async function checkForUpdate({ manual }: { manual: boolean }): Promise<void> {
  const ui = useUi.getState();
  if (!isTauri()) {
    if (manual) ui.toast('Updates gibt es nur in der Mac-App', 'info');
    return;
  }
  const { status } = useUpdates.getState();
  if (status === 'checking' || status === 'downloading' || status === 'restarting') return;
  // Schon installiert: eine neue Prüfung fände dieselbe Version noch einmal (es läuft ja noch die alte).
  if (status === 'ready') {
    if (manual) zeigeBereitToast();
    return;
  }
  if (status === 'available' && pending) {
    if (manual) zeigeUpdateToast();
    return;
  }

  useUpdates.setState({ status: 'checking' });
  try {
    await entwicklerversion();
    const update = await check({ timeout: 20_000 });
    markChecked();
    if (!update) {
      useUpdates.setState({ status: 'idle', version: undefined, notes: undefined, date: undefined });
      if (manual) ui.toast(`Kladdy ist aktuell (Version ${await appVersion()})`);
      return;
    }
    pending = update;
    useUpdates.setState({ status: 'available', version: update.version, notes: update.body?.trim() || undefined, date: update.date });
    zeigeUpdateToast();
  } catch (err) {
    useUpdates.setState({ status: 'idle' });
    console.warn('Update-Prüfung fehlgeschlagen', err);
    if (manual) ui.toast('Update-Prüfung hat nicht geklappt. Besteht eine Internetverbindung? Später noch einmal versuchen.', 'warn');
  }
}

/** Beim Start: höchstens einmal pro Tag und nur, wenn eingeschaltet. */
let startGeprueft = false;
export function autoCheckOnStart(now = Date.now()): void {
  if (startGeprueft || !isTauri()) return;
  startGeprueft = true;
  void entwicklerversion();
  if (!shouldAutoCheck(useUpdates.getState(), now)) return;
  void checkForUpdate({ manual: false });
}

const notizenAktion = { label: 'Was ist neu?', run: () => useUi.getState().openDrawer('update-notes') };

function zeigeUpdateToast(): void {
  const { version, entwickler } = useUpdates.getState();
  if (!version) return;
  useUi.getState().showToast({
    key: UPDATE_TOAST,
    text: entwickler ? `Version ${version} ist da (in der Entwicklerversion wird nicht installiert)` : `Version ${version} ist da`,
    icon: entwickler ? 'info' : 'download',
    sticky: true,
    actions: entwickler ? [notizenAktion] : [notizenAktion, { label: 'Jetzt aktualisieren', run: () => void installUpdate() }],
  });
}

function zeigeBereitToast(): void {
  const { version } = useUpdates.getState();
  const ui = useUi.getState();
  ui.showToast({
    key: UPDATE_TOAST,
    text: `Update bereit: Version ${version ?? ''} startet mit dem nächsten Neustart`,
    icon: 'check',
    sticky: true,
    actions: [
      { label: 'Jetzt neu starten', run: () => void neuStarten() },
      { label: 'Später', run: schliesseUpdateToast },
    ],
  });
}

function schliesseUpdateToast(): void {
  const ui = useUi.getState();
  const t = ui.toasts.find((x) => x.key === UPDATE_TOAST);
  if (t) ui.dismissToast(t.id);
}

/** Update laden und installieren. Neu gestartet wird erst über `neuStarten()` (Klick im Toast oder in den Einstellungen). */
export async function installUpdate(): Promise<void> {
  const update = pending;
  const ui = useUi.getState();
  const entwickler = await entwicklerversion();
  if (!update || !kannInstallieren(useUpdates.getState().status, entwickler)) {
    if (update && entwickler) zeigeUpdateToast();
    return;
  }
  // Nur die „Was ist neu?“-Schublade schließen – eine andere mit Eingaben bleibt offen, man arbeitet ja weiter.
  if (ui.drawer === 'update-notes') ui.closeDrawer();

  const zeige = (text: string, progress: number | null) =>
    useUi.getState().showToast({ key: UPDATE_TOAST, text, icon: 'download', sticky: true, progress, actions: [] });

  try {
    // TODO(Phase 5): Vor dem Laden eine Datensicherung anlegen (§3.2 Punkt 5, §6.10): Rust-Command `backup_erstellen`
    // (VACUUM INTO + Belege als ZIP) aufrufen und bei Fehler abbrechen. Bis dahin wird hier bewusst keine
    // „Sicherung …“-Meldung gezeigt – es gibt noch keine.
    useUpdates.setState({ status: 'downloading', progress: null });

    let gesamt: number | undefined;
    let geladen = 0;
    zeige(`Version ${update.version} wird geladen …`, null);
    await update.download((ev: DownloadEvent) => {
      if (ev.event === 'Started') gesamt = ev.data.contentLength;
      else if (ev.event === 'Progress') {
        geladen += ev.data.chunkLength;
        const p = fortschritt(geladen, gesamt);
        useUpdates.setState({ progress: p });
        zeige(`Version ${update.version} wird geladen …${p === null ? '' : ` ${Math.round(p * 100)} %`}`, p);
      } else if (ev.event === 'Finished') {
        useUpdates.setState({ progress: 1 });
      }
    });

    zeige('Wird installiert …', 1);
    await update.install();
    useUpdates.setState({ status: 'ready', progress: 1 });
    zeigeBereitToast();
  } catch (err) {
    console.error('Update fehlgeschlagen', err);
    useUpdates.setState({ status: 'available', progress: null });
    ui.showToast({
      key: UPDATE_TOAST,
      text: 'Das Update hat nicht geklappt. Kladdy läuft unverändert weiter.',
      icon: 'warn',
      sticky: true,
      actions: [{ label: 'Erneut versuchen', run: () => void installUpdate() }],
    });
  }
}

/** Nach dem Installieren neu starten. Nie automatisch; bei ungespeicherten Eingaben in einer Schublade erst nachfragen. */
export async function neuStarten({ trotzdem = false }: { trotzdem?: boolean } = {}): Promise<void> {
  const ui = useUi.getState();
  if (useUpdates.getState().status !== 'ready') return;
  if (ui.ungespeichert && !trotzdem) {
    ui.showToast({
      key: UPDATE_TOAST,
      text: 'In der offenen Schublade sind ungespeicherte Eingaben. Beim Neustart gehen sie verloren.',
      icon: 'warn',
      sticky: true,
      actions: [
        { label: 'Trotzdem neu starten', run: () => void neuStarten({ trotzdem: true }) },
        { label: 'Zurück', run: zeigeBereitToast },
      ],
    });
    return;
  }
  try {
    useUpdates.setState({ status: 'restarting' });
    ui.showToast({ key: UPDATE_TOAST, text: 'Kladdy startet neu …', icon: 'download', sticky: true, progress: 1, actions: [] });
    await relaunch();
  } catch (err) {
    console.error('Neustart fehlgeschlagen', err);
    useUpdates.setState({ status: 'ready' });
    ui.showToast({
      key: UPDATE_TOAST,
      text: 'Neustart hat nicht geklappt. Das Update ist installiert: Kladdy beenden (⌘Q) und wieder öffnen.',
      icon: 'warn',
      sticky: true,
      actions: [],
    });
  }
}
