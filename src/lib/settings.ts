/* Darstellungs-Einstellungen (ANLEITUNG §6.10 „Darstellung“, §9.1).
 * Werden im localStorage gespeichert und als data-Attribute bzw. CSS-Variablen an <html> gesetzt.
 * Farbe: ein Farbschema (FARBSCHEMATA, Standard Petrol) mit eigener Palette für Hell und Dunkel, optional eine eigene
 * Akzentfarbe. Aus Akzent und Modus entstehen --accent (Flächen), --on-accent (Schrift darauf) und --accent-text
 * (Akzent als Schrift, mindestens 4,5:1 auf den Flächen). Belege auf Papier nutzen immer die helle Akzentfarbe.
 * Reine Funktionen (sanitize, luminance, kontrast, palette) sind mit Vitest getestet. */

export type Mode = 'light' | 'dark' | 'system';
export type Density = 'compact' | 'normal' | 'cozy';
export type Motion = 'full' | 'reduced' | 'off';
export type PosNeg = 'greenred' | 'blueorange' | 'tealpink';
export type NumFont = 'sans' | 'mono';

export interface Settings {
  mode: Mode;
  /** ID aus FARBSCHEMATA */
  theme: string;
  /** eigene Akzentfarbe (#rrggbb) statt der des Schemas; null = die des Schemas */
  akzent: string | null;
  radius: number; // 0–24 (px)
  fontScale: number; // 85–120 (%)
  density: Density;
  motion: Motion;
  glass: boolean;
  posneg: PosNeg;
  numFont: NumFont;
}

/** Farben eines Modus: Akzent und Tönung der neutralen Flächen (Farbton, Sättigung in %). */
export interface Palette {
  akzent: string;
  tintH: number;
  tintS: number;
}

export interface Farbschema {
  id: string;
  name: string;
  beschreibung: string;
  hell: Palette;
  dunkel: Palette;
}

export const FARBSCHEMATA: readonly Farbschema[] = [
  {
    id: 'petrol',
    name: 'Petrol',
    beschreibung: 'Schiefergrau mit Petrol, sachlich',
    hell: { akzent: '#0b6a77', tintH: 195, tintS: 16 },
    dunkel: { akzent: '#2fb0bc', tintH: 195, tintS: 20 },
  },
  {
    id: 'kladde',
    name: 'Kladde',
    beschreibung: 'Papierweiß mit Tintenblau, klassisch',
    hell: { akzent: '#2b55b8', tintH: 42, tintS: 22 },
    dunkel: { akzent: '#7ea2f2', tintH: 45, tintS: 10 },
  },
  {
    id: 'pflaume',
    name: 'Pflaume',
    beschreibung: 'Warme Neutraltöne mit Pflaumenviolett',
    hell: { akzent: '#7b3a86', tintH: 320, tintS: 14 },
    dunkel: { akzent: '#d39adf', tintH: 320, tintS: 12 },
  },
  {
    id: 'bernstein',
    name: 'Graphit & Bernstein',
    beschreibung: 'Neutrales Graphit mit kräftigem Bernstein',
    hell: { akzent: '#d18b0f', tintH: 40, tintS: 4 },
    dunkel: { akzent: '#f0a92b', tintH: 40, tintS: 4 },
  },
];

export const STANDARD_SCHEMA = 'petrol';

export const SETTINGS_KEY = 'kladdy.settings.v1';

export function defaultSettings(prefersReducedMotion = false): Settings {
  return {
    mode: 'system',
    theme: STANDARD_SCHEMA,
    akzent: null,
    radius: 14,
    fontScale: 100,
    density: 'normal',
    motion: prefersReducedMotion ? 'reduced' : 'full',
    glass: true,
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

/** Gespeicherte (evtl. alte oder kaputte) Werte prüfen; Unbekanntes fällt auf den Standard zurück.
 * Alte Stände (vor den Farbschemata): ein „Eigenes Theme“ behält seine Akzentfarbe, alte Theme-IDs werden Petrol. */
export function sanitizeSettings(raw: unknown, defaults: Settings = defaultSettings()): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const altEigen = r.theme === 'custom' && isHex(r.accent) ? r.accent.toLowerCase() : null;
  return {
    mode: oneOf(r.mode, ['light', 'dark', 'system'] as const, defaults.mode),
    theme: oneOf(r.theme, FARBSCHEMATA.map((t) => t.id), defaults.theme),
    akzent: isHex(r.akzent) ? r.akzent.toLowerCase() : (altEigen ?? defaults.akzent),
    radius: clampInt(r.radius, 0, 24, defaults.radius),
    fontScale: clampInt(r.fontScale, 85, 120, defaults.fontScale),
    density: oneOf(r.density, ['compact', 'normal', 'cozy'] as const, defaults.density),
    motion: oneOf(r.motion, ['full', 'reduced', 'off'] as const, defaults.motion),
    glass: typeof r.glass === 'boolean' ? r.glass : defaults.glass,
    posneg: oneOf(r.posneg, ['greenred', 'blueorange', 'tealpink'] as const, defaults.posneg),
    numFont: oneOf(r.numFont, ['sans', 'mono'] as const, defaults.numFont),
  };
}

export const schemaVon = (s: Pick<Settings, 'theme'>): Farbschema =>
  FARBSCHEMATA.find((t) => t.id === s.theme) ?? FARBSCHEMATA[0];

/** Farbschema wählen; eine eigene Akzentfarbe bleibt bestehen (über „Farbe des Schemas“ zurücknehmen). */
export function withTheme(s: Settings, id: string): Settings {
  return FARBSCHEMATA.some((t) => t.id === id) ? { ...s, theme: id } : s;
}

export function withSetting<K extends keyof Settings>(s: Settings, key: K, value: Settings[K]): Settings {
  return { ...s, [key]: value };
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

/** Textfarbe auf dem Akzent: Weiß oder Fast-Schwarz, je nachdem, was mehr Kontrast hat (§9.1). */
export const onAccent = (accent: string): string => (kontrast(accent, '#ffffff') >= kontrast(accent, '#111114') ? '#ffffff' : '#111114');

/** Kontrast nach WCAG zwischen zwei #rrggbb. */
export function kontrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
/** #rrggbb um `anteil` (0–1) zu Weiß bzw. Schwarz mischen. */
export function mischen(hex: string, ziel: '#ffffff' | '#000000', anteil: number): string {
  const n = parseInt(hex.slice(1), 16);
  const z = ziel === '#ffffff' ? 255 : 0;
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c + (z - c) * anteil);
  return `#${ch.map(hex2).join('')}`;
}

/** Ungünstigste Fläche, auf der Akzent als Schrift steht (Seite bzw. Karte des Modus). */
const TEXT_GRUND = { light: '#eef1f2', dark: '#1d2427' } as const;

/** Akzent als Schrift: so weit abgedunkelt (hell) bzw. aufgehellt (dunkel), dass er 4,5:1 erreicht. */
export function textAkzent(akzent: string, modus: 'light' | 'dark'): string {
  const ziel = modus === 'light' ? '#000000' : '#ffffff';
  let f = akzent;
  for (let i = 1; i <= 20 && kontrast(f, TEXT_GRUND[modus]) < 4.6; i++) f = mischen(akzent, ziel, i * 0.05);
  return f;
}

/** Palette für den Modus; eine eigene Akzentfarbe ersetzt den Akzent (im Dunkeln bei Bedarf aufgehellt). */
export function palette(s: Pick<Settings, 'theme' | 'akzent'>, modus: 'light' | 'dark'): Palette {
  const schema = schemaVon(s);
  const p = modus === 'light' ? schema.hell : schema.dunkel;
  if (!s.akzent) return p;
  let akzent = s.akzent;
  if (modus === 'dark') {
    for (let i = 1; i <= 10 && kontrast(akzent, '#151b1d') < 4.5; i++) akzent = mischen(s.akzent, '#ffffff', i * 0.06);
  }
  return { ...p, akzent };
}

/** Akzentfarbe für Belege auf weißem Papier (Vorschau und PDF): immer die helle. */
export const akzentPapier = (s: Pick<Settings, 'theme' | 'akzent'>): string => palette(s, 'light').akzent;

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
  const modus = effectiveMode(s, systemDark);
  const p = palette(s, modus);
  d.mode = modus;
  d.density = s.density;
  d.motion = s.motion;
  d.numfont = s.numFont;
  d.posneg = s.posneg;
  d.glass = s.glass ? 'on' : 'off';
  root.style.setProperty('--accent', p.akzent);
  root.style.setProperty('--on-accent', onAccent(p.akzent));
  root.style.setProperty('--accent-text', textAkzent(p.akzent, modus));
  root.style.setProperty('--tint-h', String(p.tintH));
  root.style.setProperty('--tint-s', `${p.tintS}%`);
  root.style.setProperty('--radius', `${s.radius}px`);
  root.style.setProperty('--font-scale', String(s.fontScale / 100));
}
