import { describe, expect, it } from 'vitest';
import { TAG_MS, defaultPrefs, fortschritt, loadPrefs, savePrefs, shouldAutoCheck, UPDATES_KEY } from './updates';

const mem = (init: Record<string, string> = {}) => {
  const data = { ...init };
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v), data };
};

describe('shouldAutoCheck', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  it('prüft beim ersten Start', () => {
    expect(shouldAutoCheck(defaultPrefs(), now)).toBe(true);
  });
  it('höchstens einmal pro Tag', () => {
    expect(shouldAutoCheck({ auto: true, lastCheck: new Date(now - 3_600_000).toISOString() }, now)).toBe(false);
    expect(shouldAutoCheck({ auto: true, lastCheck: new Date(now - TAG_MS).toISOString() }, now)).toBe(true);
  });
  it('nie, wenn ausgeschaltet', () => {
    expect(shouldAutoCheck({ auto: false, lastCheck: null }, now)).toBe(false);
  });
  it('prüft, wenn die letzte Prüfung in der Zukunft liegt (Uhr verstellt)', () => {
    expect(shouldAutoCheck({ auto: true, lastCheck: new Date(now + TAG_MS).toISOString() }, now)).toBe(true);
  });
});

describe('Prefs speichern', () => {
  it('Standard: automatisch an, noch nie geprüft', () => {
    expect(loadPrefs(mem())).toEqual({ auto: true, lastCheck: null });
    expect(loadPrefs(undefined)).toEqual({ auto: true, lastCheck: null });
  });
  it('liest Gespeichertes und verwirft Kaputtes', () => {
    const s = mem();
    savePrefs(s, { auto: false, lastCheck: '2026-10-01T08:00:00.000Z' });
    expect(loadPrefs(s)).toEqual({ auto: false, lastCheck: '2026-10-01T08:00:00.000Z' });
    expect(loadPrefs(mem({ [UPDATES_KEY]: '{"auto":"ja","lastCheck":"gestern"}' }))).toEqual({ auto: true, lastCheck: null });
    expect(loadPrefs(mem({ [UPDATES_KEY]: 'kaputt' }))).toEqual({ auto: true, lastCheck: null });
  });
});

describe('fortschritt', () => {
  it('rechnet 0–1 und kennt unbekannte Größen', () => {
    expect(fortschritt(50, 200)).toBe(0.25);
    expect(fortschritt(300, 200)).toBe(1);
    expect(fortschritt(10, undefined)).toBeNull();
    expect(fortschritt(10, 0)).toBeNull();
  });
});
