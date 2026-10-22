import { beforeEach, describe, expect, it, vi } from 'vitest';

// Datenbank nachgebildet (einstellungen als Map, alle Schreibvorgänge mitgeschrieben), Rust-Commands über invoke
const db = vi.hoisted(() => ({ zeilen: new Map<string, string>(), sql: [] as { sql: string; werte: unknown[] }[] }));
const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../db', async (original) => ({
  ...(await original<typeof import('../db')>()),
  eine: vi.fn(async (_sql: string, [k]: [string]) => (db.zeilen.has(k) ? { wert: db.zeilen.get(k) } : null)),
  ausfuehren: vi.fn(async (sql: string, werte: unknown[]) => {
    db.sql.push({ sql, werte });
    if (sql.startsWith('INSERT INTO einstellungen')) db.zeilen.set(werte[0] as string, werte[1] as string);
    return { geaendert: 1, id: db.sql.length };
  }),
}));
vi.mock('@tauri-apps/api/core', async (original) => ({
  ...(await original<typeof import('@tauri-apps/api/core')>()),
  invoke: tauri.invoke,
}));

import { ladeFirmenlogo, logoAblegen, logoBytes, speichereFirmenlogo } from './firmenlogo';

const NAME = `logo-${'a1'.repeat(32)}.png`;
const protokoll = () => db.sql.filter((x) => x.sql.includes('protokoll')).map((x) => x.werte);

beforeEach(() => {
  db.zeilen.clear();
  db.sql.length = 0;
  tauri.invoke.mockReset();
});

describe('Einstellung firmenlogo', () => {
  it('ohne Einstellung oder mit fremdem Wert: App-Symbol', async () => {
    expect(await ladeFirmenlogo()).toBe('');
    db.zeilen.set('firmenlogo', JSON.stringify('../../kladdy.db'));
    expect(await ladeFirmenlogo()).toBe('');
    db.zeilen.set('firmenlogo', '{kaputt');
    expect(await ladeFirmenlogo()).toBe('');
  });

  it('setzen und zurücksetzen landen im Protokoll', async () => {
    expect(await speichereFirmenlogo(NAME)).toBe(true);
    expect(await ladeFirmenlogo()).toBe(NAME);
    expect(await speichereFirmenlogo(NAME)).toBe(false);
    expect(await speichereFirmenlogo('')).toBe(true);
    expect(await ladeFirmenlogo()).toBe('');
    const p = protokoll();
    expect(p).toHaveLength(2);
    expect(JSON.stringify(p[0])).toContain(NAME);
    expect(JSON.stringify(p[1])).toContain('geaendert');
  });
});

describe('Rust-Commands', () => {
  it('PNG als Zahlenliste an firmenlogo_ablegen', async () => {
    tauri.invoke.mockResolvedValueOnce({ name: NAME, neu: true });
    expect(await logoAblegen(new Uint8Array([137, 80, 78, 71]))).toEqual({ name: NAME, neu: true });
    expect(tauri.invoke).toHaveBeenCalledWith('firmenlogo_ablegen', { png: [137, 80, 78, 71] });
  });

  it('Bytes je Name einmal gelesen, Fehler werden nicht gemerkt', async () => {
    const name = `logo-${'b2'.repeat(32)}.png`;
    tauri.invoke.mockRejectedValueOnce('Die Logo-Datei fehlt');
    await expect(logoBytes(name)).rejects.toBe('Die Logo-Datei fehlt');
    tauri.invoke.mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer);
    expect(Array.from(await logoBytes(name))).toEqual([1, 2, 3]);
    expect(Array.from(await logoBytes(name))).toEqual([1, 2, 3]);
    expect(tauri.invoke).toHaveBeenCalledTimes(2);
    expect(tauri.invoke).toHaveBeenLastCalledWith('firmenlogo_lesen', { name });
  });
});
