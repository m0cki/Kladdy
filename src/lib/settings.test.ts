import { describe, expect, it } from 'vitest';
import {
  FARBSCHEMATA,
  SETTINGS_KEY,
  akzentPapier,
  defaultSettings,
  effectiveMode,
  kontrast,
  loadSettings,
  luminance,
  mischen,
  onAccent,
  palette,
  sanitizeSettings,
  saveSettings,
  textAkzent,
  withSetting,
  withTheme,
  type KeyValueStore,
} from './settings';

const memoryStore = (init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = v) };
};

describe('settings', () => {
  it('Standard: wie der Mac, Farbschema Petrol, keine eigene Akzentfarbe', () => {
    const d = defaultSettings();
    expect(d.mode).toBe('system');
    expect(d.theme).toBe('petrol');
    expect(d.akzent).toBeNull();
    expect(defaultSettings(true).motion).toBe('reduced');
  });

  it('speichert und lädt verlustfrei', () => {
    const store = memoryStore();
    const s = { ...withTheme(defaultSettings(), 'pflaume'), mode: 'light' as const, radius: 8, glass: false, akzent: '#123456' };
    saveSettings(store, s);
    expect(JSON.parse(store.data[SETTINGS_KEY])).toEqual(s);
    expect(loadSettings(store)).toEqual(s);
  });

  it('fällt bei kaputten oder fremden Werten auf den Standard zurück', () => {
    expect(loadSettings(memoryStore({ [SETTINGS_KEY]: '{kein json' }))).toEqual(defaultSettings());
    expect(loadSettings(undefined)).toEqual(defaultSettings());
    const s = sanitizeSettings({ mode: 'blau', akzent: 'red', radius: 99, fontScale: '110', glass: 'ja', theme: 'xyz' });
    expect(s.mode).toBe('system');
    expect(s.akzent).toBeNull();
    expect(s.radius).toBe(24);
    expect(s.fontScale).toBe(110);
    expect(s.glass).toBe(true);
    expect(s.theme).toBe('petrol');
  });

  it('übernimmt alte Stände: alte Themes werden Petrol, ein eigenes Theme behält seine Farbe', () => {
    const alt = sanitizeSettings({ theme: 'indigo', accent: '#6366f1', tintH: 240, tintS: 14, aurora: true });
    expect(alt.theme).toBe('petrol');
    expect(alt.akzent).toBeNull();
    expect(alt).not.toHaveProperty('aurora');
    expect(sanitizeSettings({ theme: 'custom', accent: '#FF8800' }).akzent).toBe('#ff8800');
  });

  it('Farbschemata: vier, Petrol zuerst; Schemawechsel behält die eigene Akzentfarbe', () => {
    expect(FARBSCHEMATA.map((t) => t.id)).toEqual(['petrol', 'kladde', 'pflaume', 'bernstein']);
    const s = withSetting(defaultSettings(), 'akzent', '#aa0000');
    expect(withTheme(s, 'kladde')).toMatchObject({ theme: 'kladde', akzent: '#aa0000' });
    expect(withTheme(s, 'gibtsnicht')).toBe(s);
  });

  it('jedes Schema: Akzent als Schrift erreicht 4,5:1, Schrift auf dem Akzent mindestens 4,5:1', () => {
    for (const th of FARBSCHEMATA) {
      for (const [modus, grund] of [['light', '#eef1f2'], ['dark', '#1d2427']] as const) {
        const p = palette({ theme: th.id, akzent: null }, modus);
        expect(kontrast(textAkzent(p.akzent, modus), grund), `${th.id} ${modus} Text`).toBeGreaterThanOrEqual(4.5);
        expect(kontrast(onAccent(p.akzent), p.akzent), `${th.id} ${modus} Knopf`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('eigene Akzentfarbe: im Dunkeln aufgehellt, auf Papier immer die helle', () => {
    const s = { theme: 'petrol', akzent: '#1e3a8a' };
    expect(palette(s, 'light').akzent).toBe('#1e3a8a');
    expect(kontrast(palette(s, 'dark').akzent, '#151b1d')).toBeGreaterThanOrEqual(4.5);
    expect(akzentPapier(s)).toBe('#1e3a8a');
    expect(akzentPapier({ theme: 'petrol', akzent: null })).toBe('#0b6a77');
  });

  it('Textfarbe auf dem Akzent nach Kontrast, Mischen und Luminanz', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('#000000')).toBe(0);
    expect(onAccent('#0b6a77')).toBe('#ffffff');
    expect(onAccent('#3cc3cf')).toBe('#111114');
    expect(onAccent('#eab308')).toBe('#111114');
    expect(mischen('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(kontrast('#ffffff', '#000000')).toBeCloseTo(21);
  });

  it('System-Modus folgt dem Betriebssystem', () => {
    const s = { ...defaultSettings(), mode: 'system' as const };
    expect(effectiveMode(s, true)).toBe('dark');
    expect(effectiveMode(s, false)).toBe('light');
  });
});
