/* UI-Zustand (zustand): Darstellung, Seitenleiste, Schubladen, Toasts, Rückweg aus den Einstellungen. Daten kommen ab Phase 1 aus SQLite. */
import { flushSync } from 'react-dom';
import { create } from 'zustand';
import {
  applySettings,
  defaultSettings,
  effectiveMode,
  loadSettings,
  saveSettings,
  withSetting,
  withTheme,
  type Settings,
} from '../lib/settings';

const UI_KEY = 'kladdy.ui.v1';

const storage = (): Storage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};
const mq = (q: string): MediaQueryList | undefined =>
  typeof matchMedia === 'undefined' ? undefined : matchMedia(q);

export const systemDarkQuery = mq('(prefers-color-scheme: dark)');
const reducedMotion = mq('(prefers-reduced-motion: reduce)')?.matches ?? false;

function loadSidebar(): boolean {
  try {
    const raw = storage()?.getItem(UI_KEY);
    return raw ? Boolean(JSON.parse(raw).sidebarCollapsed) : false;
  } catch {
    return false;
  }
}

export type DrawerId = 'update-notes' | null;
export type ToastIcon = 'check' | 'info' | 'warn' | 'download';
export interface ToastAction {
  label: string;
  run: () => void;
}
export interface Toast {
  id: number;
  text: string;
  icon?: ToastIcon;
  /** gleicher Schlüssel ersetzt den bestehenden Toast an Ort und Stelle (z. B. Update-Fortschritt) */
  key?: string;
  actions?: ToastAction[];
  /** bleibt stehen, bis er geschlossen oder ersetzt wird */
  sticky?: boolean;
  /** Fortschrittsbalken: 0–1, null = unbestimmt, undefined = keiner */
  progress?: number | null;
}

interface UiState {
  settings: Settings;
  systemDark: boolean;
  sidebarCollapsed: boolean;
  drawer: DrawerId;
  toasts: Toast[];
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setTheme: (id: string) => void;
  resetSettings: () => void;
  setSystemDark: (dark: boolean) => void;
  toggleSidebar: () => void;
  openDrawer: (id: Exclude<DrawerId, null>) => void;
  closeDrawer: () => void;
  toast: (text: string, icon?: ToastIcon) => void;
  showToast: (t: Omit<Toast, 'id'>) => number;
  dismissToast: (id: number) => void;
  /** Letzte Seite außerhalb der Einstellungen (⚙ oder Esc führt dorthin zurück) */
  zurueck: string;
  setZurueck: (path: string) => void;
}

let toastId = 0;

export const useUi = create<UiState>((set, get) => {
  const commit = (settings: Settings) => {
    saveSettings(storage(), settings);
    set({ settings });
  };
  return {
    settings: loadSettings(storage(), defaultSettings(reducedMotion)),
    systemDark: systemDarkQuery?.matches ?? true,
    sidebarCollapsed: loadSidebar(),
    drawer: null,
    toasts: [],
    setSetting: (key, value) => commit(withSetting(get().settings, key, value)),
    setTheme: (id) => commit(withTheme(get().settings, id)),
    resetSettings: () => commit(defaultSettings(reducedMotion)),
    setSystemDark: (systemDark) => set({ systemDark }),
    toggleSidebar: () => {
      const sidebarCollapsed = !get().sidebarCollapsed;
      try {
        storage()?.setItem(UI_KEY, JSON.stringify({ sidebarCollapsed }));
      } catch {
        /* egal */
      }
      set({ sidebarCollapsed });
    },
    openDrawer: (drawer) => set({ drawer }),
    closeDrawer: () => set({ drawer: null }),
    toast: (text, icon = 'check') => {
      const id = ++toastId;
      set({ toasts: [...get().toasts, { id, text, icon }] });
    },
    showToast: (t) => {
      const existing = t.key ? get().toasts.find((x) => x.key === t.key) : undefined;
      if (existing) {
        set({ toasts: get().toasts.map((x) => (x.id === existing.id ? { ...t, id: existing.id } : x)) });
        return existing.id;
      }
      const id = ++toastId;
      set({ toasts: [...get().toasts, { icon: 'check', ...t, id }] });
      return id;
    },
    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    zurueck: '',
    setZurueck: (zurueck) => set({ zurueck }),
  };
});

/** Aktueller Modus (Hell/Dunkel) unter Berücksichtigung von „System“. */
export const useEffectiveMode = () => useUi((s) => effectiveMode(s.settings, s.systemDark));

/** Einstellungen an <html> anwenden – sofort und bei jeder Änderung. */
export function bindSettingsToDocument(root: HTMLElement = document.documentElement): () => void {
  const apply = () => {
    const { settings, systemDark } = useUi.getState();
    applySettings(settings, root, systemDark);
  };
  apply();
  const unsub = useUi.subscribe((s, prev) => {
    if (s.settings !== prev.settings || s.systemDark !== prev.systemDark) apply();
  });
  const onSystem = (e: MediaQueryListEvent) => useUi.getState().setSystemDark(e.matches);
  systemDarkQuery?.addEventListener('change', onSystem);
  return () => {
    unsub();
    systemDarkQuery?.removeEventListener('change', onSystem);
  };
}

/** Hell/Dunkel umschalten mit kreisförmiger Enthüllung vom Klickpunkt (View Transitions API, 600 ms, §9.5). */
export function toggleMode(origin?: { x: number; y: number }): void {
  const { settings, systemDark, setSetting } = useUi.getState();
  const next = effectiveMode(settings, systemDark) === 'dark' ? 'light' : 'dark';
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  // flushSync: auch React (Sonne/Mond-Symbol) ist im neuen Schnappschuss schon umgestellt
  const run = () => flushSync(() => setSetting('mode', next));
  if (!doc.startViewTransition || settings.motion !== 'full') {
    run();
    return;
  }
  const x = origin?.x || innerWidth - 60; // Tastatur-Klick liefert 0/0 → oben rechts
  const y = origin?.y || 30;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const tr = doc.startViewTransition(run);
  tr.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' },
      );
    })
    .catch(() => {
      /* Übergang abgebrochen – Modus ist trotzdem umgeschaltet */
    });
}
