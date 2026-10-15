import { describe, expect, it } from 'vitest';
import { datenbank, datenbankVerfuegbar, nacheinander, sqlWert, sqlWerte, zeitstempel } from './db';

describe('sqlWert', () => {
  it('wandelt Wahrheitswerte und undefined', () => {
    expect(sqlWert(true)).toBe(1);
    expect(sqlWert(false)).toBe(0);
    expect(sqlWert(undefined)).toBeNull();
    expect(sqlWert(null)).toBeNull();
  });

  it('lässt Text und Zahlen unverändert', () => {
    expect(sqlWert('2026-10-13')).toBe('2026-10-13');
    expect(sqlWert('')).toBe('');
    expect(sqlWert(123456)).toBe(123456);
    expect(sqlWert(-5)).toBe(-5);
    expect(sqlWert(1.5)).toBe(1.5); // z. B. rechnungspositionen.menge (REAL)
  });

  it('wirft bei NaN und Infinity', () => {
    expect(() => sqlWert(Number.NaN)).toThrow(RangeError);
    expect(() => sqlWert(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('ganze Liste', () => {
    expect(sqlWerte([1, true, undefined, 'x'])).toEqual([1, 1, null, 'x']);
  });
});

describe('zeitstempel', () => {
  it('ISO 8601 in UTC ohne Millisekunden', () => {
    expect(zeitstempel(new Date(Date.UTC(2026, 9, 13, 20, 15, 7, 999)))).toBe('2026-10-13T20:15:07Z');
    expect(zeitstempel()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe('datenbank', () => {
  it('außerhalb der App mit klarer Meldung abgelehnt', async () => {
    await expect(datenbank()).rejects.toThrow(/nur in der App/);
    expect(datenbankVerfuegbar()).toBe(false);
  });
});

describe('nacheinander', () => {
  it('führt Aufträge strikt nacheinander aus, auch nach einem Fehler', async () => {
    const log: string[] = [];
    const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const a = nacheinander(async () => {
      log.push('a+');
      await warte(10);
      log.push('a-');
      return 1;
    });
    const b = nacheinander(async () => {
      log.push('b');
      throw new Error('kaputt');
    });
    const c = nacheinander(async () => {
      log.push('c');
      return 3;
    });
    await expect(a).resolves.toBe(1);
    await expect(b).rejects.toThrow('kaputt');
    await expect(c).resolves.toBe(3);
    expect(log).toEqual(['a+', 'a-', 'b', 'c']);
  });
});
