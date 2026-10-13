import { beforeEach, describe, expect, it, vi } from 'vitest';

// Datenbank nachgebildet: einstellungen als Map, alle Aufrufe mitgeschrieben
const db = vi.hoisted(() => ({ zeilen: new Map<string, string>(), sql: [] as { sql: string; werte: unknown[] }[] }));
vi.mock('../db', async (original) => ({
  ...(await original<typeof import('../db')>()),
  eine: vi.fn(async (_sql: string, [k]: [string]) => (db.zeilen.has(k) ? { wert: db.zeilen.get(k) } : null)),
  ausfuehren: vi.fn(async (sql: string, werte: unknown[]) => {
    db.sql.push({ sql, werte });
    if (sql.startsWith('INSERT INTO einstellungen')) db.zeilen.set(werte[0] as string, werte[1] as string);
    return { geaendert: 1, id: db.sql.length };
  }),
}));

import { leereFirma } from '../firma';
import { einstellungSchreiben, ladeFirma, protokollFuerEinstellung, speichereFirma, ustModusAusWert, wertLesen } from './einstellungen';

beforeEach(() => {
  db.zeilen.clear();
  db.sql.length = 0;
});

describe('wertLesen', () => {
  it('JSON lesen, Kaputtes ⇒ null', () => {
    expect(wertLesen('{"name":"A"}')).toEqual({ name: 'A' });
    expect(wertLesen('"klein"')).toBe('klein');
    expect(wertLesen('{kaputt')).toBeNull();
    expect(wertLesen(null)).toBeNull();
  });
});

describe('protokollFuerEinstellung', () => {
  it('neu, wenn es die Einstellung noch nicht gab', () => {
    expect(protokollFuerEinstellung('ust_modus', undefined, 'regel')).toEqual({
      tabelle: 'einstellungen',
      schluessel: 'ust_modus',
      aktion: 'neu',
      neu: { wert: 'regel' },
    });
  });

  it('geändert: nur die geänderten Felder', () => {
    expect(protokollFuerEinstellung('firma', { name: 'A', ort: 'X' }, { name: 'B', ort: 'X' })).toEqual({
      tabelle: 'einstellungen',
      schluessel: 'firma',
      aktion: 'geaendert',
      alt: { name: 'A' },
      neu: { name: 'B' },
    });
    expect(protokollFuerEinstellung('ust_modus', 'klein', 'regel')).toMatchObject({ alt: { wert: 'klein' }, neu: { wert: 'regel' } });
  });

  it('nichts geändert ⇒ null', () => {
    expect(protokollFuerEinstellung('ust_modus', 'klein', 'klein')).toBeNull();
    expect(protokollFuerEinstellung('firma', { name: 'A' }, { name: 'A' })).toBeNull();
  });
});

describe('ustModusAusWert', () => {
  it('Standard Kleinunternehmer', () => {
    expect(ustModusAusWert('regel')).toBe('regel');
    expect(ustModusAusWert('klein')).toBe('klein');
    expect(ustModusAusWert(undefined)).toBe('klein');
    expect(ustModusAusWert(42)).toBe('klein');
  });
});

describe('einstellungSchreiben', () => {
  it('speichert und protokolliert; ohne Änderung passiert nichts', async () => {
    expect(await einstellungSchreiben('ust_modus', 'regel')).toBe(true);
    expect(db.zeilen.get('ust_modus')).toBe('"regel"');
    expect(db.sql.map((s) => s.sql.split(' (')[0])).toEqual(['INSERT INTO einstellungen', 'INSERT INTO protokoll']);
    expect(db.sql[1].werte.slice(1)).toEqual(['einstellungen', 0, 'neu', null, '{"wert":"regel"}', 'ust_modus']);

    expect(await einstellungSchreiben('ust_modus', 'regel')).toBe(false);
    expect(db.sql).toHaveLength(2);
  });

  it('Firma: Änderung einzelner Felder landet als Differenz im Protokoll', async () => {
    const f = { ...leereFirma(), name: 'Mustermann', ort: 'Musterstadt' };
    await speichereFirma(f);
    await speichereFirma({ ...f, ort: 'Neustadt' });
    const letzte = db.sql[db.sql.length - 1];
    expect(letzte.werte.slice(3)).toEqual(['geaendert', '{"ort":"Musterstadt"}', '{"ort":"Neustadt"}', 'firma']);
    expect((await ladeFirma()).ort).toBe('Neustadt');
  });
});
