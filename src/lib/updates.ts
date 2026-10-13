/* Updates aus der App heraus (§3.2): tauri-plugin-updater + tauri-plugin-process.
 * - Automatisch beim Start höchstens einmal pro Tag, nur wenn „Automatisch nach Updates suchen“ an ist (Standard: an).
 * - Von Hand über das Menü „Nach Updates suchen …“ und den Knopf in den Einstellungen.
 * - Neue Version ⇒ Toast „Version X ist da“ · „Was ist neu?“ · „Jetzt aktualisieren“ ⇒ Download mit Fortschritt ⇒ Neustart.
 * Außerhalb von Tauri (npm run dev im Browser) passiert nichts – höchstens ein Hinweis bei manueller Prüfung.
 * Reine Funktionen (Laden/Speichern, Tagesgrenze, Fortschritt) sind mit Vitest getestet (updates.test.ts). */
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
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
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'restarting' | 'error';

interface UpdateState extends UpdatePrefs {
  status: UpdateStatus;
  /** gefundene neue Version */
  version?: string;
  notes?: string;
  date?: string;
  progress: number | null;
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
  if (status === 'available' && pending) {
    if (manual) zeigeUpdateToast();
    return;
  }

  useUpdates.setState({ status: 'checking' });
  try {
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
  if (!shouldAutoCheck(useUpdates.getState(), now)) return;
  void checkForUpdate({ manual: false });
}

function zeigeUpdateToast(): void {
  const { version } = useUpdates.getState();
  if (!version) return;
  useUi.getState().showToast({
    key: UPDATE_TOAST,
    text: `Version ${version} ist da`,
    icon: 'download',
    sticky: true,
    actions: [
      { label: 'Was ist neu?', run: () => useUi.getState().openDrawer('update-notes') },
      { label: 'Jetzt aktualisieren', run: () => void installUpdate() },
    ],
  });
}

/**
 * TODO(Phase 5): Vor jedem Update automatisch eine Datensicherung anlegen (§3.2 Punkt 5, §6.10 Datensicherung):
 * Rust-Command `backup_erstellen` (VACUUM INTO + Belege als ZIP) aufrufen und bei Fehler das Update abbrechen.
 * Bis es eine Datenbank gibt (Phase 1) bzw. die Sicherung gebaut ist (Phase 5), gibt es nichts zu sichern.
 */
async function vorUpdateSichern(): Promise<void> {
  return Promise.resolve();
}

/** Update laden, installieren und Kladdy neu starten. */
export async function installUpdate(): Promise<void> {
  const update = pending;
  const ui = useUi.getState();
  if (!update || useUpdates.getState().status === 'downloading') return;
  useUi.getState().closeDrawer();

  const zeige = (text: string, progress: number | null) =>
    ui.showToast({ key: UPDATE_TOAST, text, icon: 'download', sticky: true, progress, actions: [] });

  try {
    useUpdates.setState({ status: 'downloading', progress: null });
    zeige('Sicherung vor dem Update …', null);
    await vorUpdateSichern();

    let gesamt: number | undefined;
    let geladen = 0;
    zeige(`Version ${update.version} wird geladen …`, null);
    await update.downloadAndInstall((ev: DownloadEvent) => {
      if (ev.event === 'Started') gesamt = ev.data.contentLength;
      else if (ev.event === 'Progress') {
        geladen += ev.data.chunkLength;
        const p = fortschritt(geladen, gesamt);
        useUpdates.setState({ progress: p });
        zeige(`Version ${update.version} wird geladen …${p === null ? '' : ` ${Math.round(p * 100)} %`}`, p);
      } else if (ev.event === 'Finished') {
        useUpdates.setState({ progress: 1 });
        zeige('Wird installiert …', 1);
      }
    });

    useUpdates.setState({ status: 'restarting' });
    zeige('Kladdy startet neu …', 1);
    await relaunch();
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
