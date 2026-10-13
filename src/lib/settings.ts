/* Darstellungs-Einstellungen (ANLEITUNG §6.10 „Darstellung“, §9.1).
 * Werden im localStorage gespeichert und als data-Attribute bzw. CSS-Variablen an <html> gesetzt.
 * Reine Funktionen (sanitize, luminance, onAccent) sind mit Vitest getestet. */

export type Mode = 'light' | 'dark' | 'system';
export type Density = 'compact' | 'normal' | 'cozy';
export type Motion = 'full' | 'reduced' | 'off';
export type PosNeg = 'greenred' | 'blueorange' | 'tealpink';
export type NumFont = 'sans' | 'mono';

export interface Settings {
  mode: Mode;
  theme: string; // Theme-ID oder 'custom' („Eigenes Theme“)
  accent: string; // #rrggbb
  tintH: number; // 0–360
  tintS: number; // 0–40 (%)
  radius: number; // 0–24 (px)
  fontScale: number; // 85–120 (%)
  density: Density;
  motion: Motion;
  glass: boolean;
  aurora: boolean;
  posneg: PosNeg;
  numFont: NumFont;
}

export interface Theme {
  id: string;
  name: string;
  accent: string;
  tintH: number;
  tintS: number;
  numFont?: NumFont;
}

export const THEMES: readonly Theme[] = [
  { id: 'indigo', name: 'Indigo', accent: '#6366f1', tintH: 240, tintS: 14 },
  { id: 'ocean', name: 'Ozean', accent: '#0ea5e9', tintH: 210, tintS: 20 },
  { id: 'emerald', name: 'Smaragd', accent: '#10b981', tintH: 165, tintS: 14 },
  { id: 'sunset', name: 'Sonnenuntergang', accent: '#f97316', tintH: 20, tintS: 12 },
  { id: 'rose', name: 'Rosé', accent: '#ec4899', tintH: 330, tintS: 12 },
  { id: 'gold', name: 'Gold', accent: '#eab308', tintH: 45, tintS: 10 },
  { id: 'graphite', name: 'Graphit', accent: '#94a3b8', tintH: 220, tintS: 6 },
  { id: 'terminal', name: 'Terminal', accent: '#22c55e', tintH: 140, tintS: 22, numFont: 'mono' },
];

export const SETTINGS_KEY = 'kladdy.settings.v1';

export function defaultSettings(prefersReducedMotion = false): Settings {
  return {
    mode: 'dark',
    theme: 'indigo',
    accent: '#6366f1',
    tintH: 240,
    tintS: 14,
    radius: 14,
    fontScale: 100,
    density: 'normal',
    motion: prefersReducedMotion ? 'reduced' : 'full',
    glass: true,
    aurora: true,
    posneg: 'greenred',
    numFont: 'sans',
  };
}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Gespeicherte (evtl. alte oder kaputte) Werte prüfen; Unbekanntes fällt auf den Standard zurück. */
export function sanitizeSettings(raw: unknown, defaults: Settings = defaultSettings()): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const themeIds = [...THEMES.map((t) => t.id), 'custom'];
  return {
    mode: oneOf(r.mode, ['light', 'dark', 'system'] as const, defaults.mode),
    theme: oneOf(r.theme, themeIds, defaults.theme),
    accent: isHex(r.accent) ? r.accent.toLowerCase() : defaults.accent,
    tintH: clampInt(r.tintH, 0, 360, defaults.tintH),
    tintS: clampInt(r.tintS, 0, 40, defaults.tintS),
    radius: clampInt(r.radius, 0, 24, defaults.radius),
    fontScale: clampInt(r.fontScale, 85, 120, defaults.fontScale),
    density: oneOf(r.density, ['compact', 'normal', 'cozy'] as const, defaults.density),
    motion: oneOf(r.motion, ['full', 'reduced', 'off'] as const, defaults.motion),
    glass: typeof r.glass === 'boolean' ? r.glass : defaults.glass,
    aurora: typeof r.aurora === 'boolean' ? r.aurora : defaults.aurora,
    posneg: oneOf(r.posneg, ['greenred', 'blueorange', 'tealpink'] as const, defaults.posneg),
    numFont: oneOf(r.numFont, ['sans', 'mono'] as const, defaults.numFont),
  };
}

/** Theme-Preset übernehmen (Akzent, Farbton, Sättigung, ggf. Monospace-Zahlen). */
export function withTheme(s: Settings, id: string): Settings {
  const th = THEMES.find((t) => t.id === id);
  if (!th) return s;
  return { ...s, theme: th.id, accent: th.accent, tintH: th.tintH, tintS: th.tintS, numFont: th.numFont ?? 'sans' };
}

/** Einzelwert ändern; Akzent oder Farbton machen daraus „Eigenes Theme“ (§9.1). */
export function withSetting<K extends keyof Settings>(s: Settings, key: K, value: Settings[K]): Settings {
  const next = { ...s, [key]: value };
  if (key === 'accent' || key === 'tintH' || key === 'tintS') next.theme = 'custom';
  return next;
}

/** Relative Luminanz nach WCAG für #rrggbb. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Textfarbe auf dem Akzent (§9.1: Luminanz > 0.45 ⇒ dunkel). */
export const onAccent = (accent: string): string => (luminance(accent) > 0.45 ? '#111114' : '#ffffff');

export function effectiveMode(s: Settings, systemDark: boolean): 'light' | 'dark' {
  return s.mode === 'system' ? (systemDark ? 'dark' : 'light') : s.mode;
}

/* ---------- Speichern ---------- */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadSettings(store: KeyValueStore | undefined, defaults: Settings = defaultSettings()): Settings {
  if (!store) return defaults;
  try {
    const raw = store.getItem(SETTINGS_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : {}, defaults);
  } catch {
    return defaults;
  }
}

export function saveSettings(store: KeyValueStore | undefined, s: Settings): void {
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* Speicher voll oder gesperrt – Einstellungen gelten dann nur bis zum Neustart */
  }
}

/* ---------- Anwenden ---------- */
export function applySettings(s: Settings, root: HTMLElement, systemDark: boolean): void {
  const d = root.dataset;
  d.mode = effectiveMode(s, systemDark);
  d.density = s.density;
  d.motion = s.motion;
  d.numfont = s.numFont;
  d.posneg = s.posneg;
  d.glass = s.glass ? 'on' : 'off';
  d.aurora = s.aurora ? 'on' : 'off';
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--on-accent', onAccent(s.accent));
  root.style.setProperty('--tint-h', String(s.tintH));
  root.style.setProperty('--tint-s', `${s.tintS}%`);
  root.style.setProperty('--radius', `${s.radius}px`);
  root.style.setProperty('--font-scale', String(s.fontScale / 100));
}
