import { describe, expect, it } from 'vitest';
import {
  SETTINGS_KEY,
  THEMES,
  defaultSettings,
  effectiveMode,
  loadSettings,
  luminance,
  onAccent,
  sanitizeSettings,
  saveSettings,
  withSetting,
  withTheme,
  type KeyValueStore,
} from './settings';

const memoryStore = (init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = v) };
};

describe('settings', () => {
  it('Standard ist Dunkel, Theme Indigo', () => {
    const d = defaultSettings();
    expect(d.mode).toBe('dark');
    expect(d.theme).toBe('indigo');
    expect(d.accent).toBe('#6366f1');
    expect(defaultSettings(true).motion).toBe('reduced');
  });

  it('speichert und lädt verlustfrei', () => {
    const store = memoryStore();
    const s = { ...withTheme(defaultSettings(), 'terminal'), mode: 'light' as const, radius: 8, glass: false };
    saveSettings(store, s);
    expect(JSON.parse(store.data[SETTINGS_KEY])).toEqual(s);
    expect(loadSettings(store)).toEqual(s);
  });

  it('fällt bei kaputten oder fremden Werten auf den Standard zurück', () => {
    expect(loadSettings(memoryStore({ [SETTINGS_KEY]: '{kein json' }))).toEqual(defaultSettings());
    expect(loadSettings(undefined)).toEqual(defaultSettings());
    const s = sanitizeSettings({ mode: 'blau', accent: 'red', radius: 99, fontScale: '110', tintH: -5, glass: 'ja', theme: 'xyz' });
    expect(s.mode).toBe('dark');
    expect(s.accent).toBe('#6366f1');
    expect(s.radius).toBe(24);
    expect(s.fontScale).toBe(110);
    expect(s.tintH).toBe(0);
    expect(s.glass).toBe(true);
    expect(s.theme).toBe('indigo');
  });

  it('Theme-Presets und „Eigenes Theme“', () => {
    expect(THEMES).toHaveLength(8);
    const t = withTheme(defaultSettings(), 'terminal');
    expect(t).toMatchObject({ theme: 'terminal', accent: '#22c55e', tintH: 140, tintS: 22, numFont: 'mono' });
    expect(withTheme(t, 'ocean').numFont).toBe('sans');
    expect(withSetting(t, 'accent', '#ff0000').theme).toBe('custom');
    expect(withSetting(t, 'radius', 4).theme).toBe('terminal');
  });

  it('Textfarbe auf dem Akzent nach Luminanz', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('#000000')).toBe(0);
    expect(onAccent('#6366f1')).toBe('#ffffff');
    expect(onAccent('#eab308')).toBe('#111114');
  });

  it('System-Modus folgt dem Betriebssystem', () => {
    const s = { ...defaultSettings(), mode: 'system' as const };
    expect(effectiveMode(s, true)).toBe('dark');
    expect(effectiveMode(s, false)).toBe('light');
  });
});
