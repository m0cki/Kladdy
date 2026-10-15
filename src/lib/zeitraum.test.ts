import { describe, expect, it } from 'vitest';
import { hatNaechsten, heute, imZeitraum, istDatum, naechsterAnker, verschiebe, zeitraum } from './zeitraum';

describe('zeitraum', () => {
  it('Monat mit Label und letztem Tag', () => {
    expect(zeitraum('monat', '2026-10-15')).toEqual({ modus: 'monat', von: '2026-10-01', bis: '2026-10-31', label: 'Oktober 2026' });
    expect(zeitraum('monat', '2028-02-03').bis).toBe('2028-02-29');
    expect(zeitraum('monat', '2026-02-03').bis).toBe('2026-02-28');
    expect(zeitraum('monat', '2026-03-01').label).toBe('März 2026');
  });
  it('Quartal', () => {
    expect(zeitraum('quartal', '2026-08-31')).toEqual({ modus: 'quartal', von: '2026-07-01', bis: '2026-09-30', label: '3. Quartal 2026' });
    expect(zeitraum('quartal', '2026-12-31')).toMatchObject({ von: '2026-10-01', bis: '2026-12-31', label: '4. Quartal 2026' });
    expect(zeitraum('quartal', '2026-01-01').von).toBe('2026-01-01');
  });
  it('Jahr', () => {
    expect(zeitraum('jahr', '2026-06-01')).toEqual({ modus: 'jahr', von: '2026-01-01', bis: '2026-12-31', label: '2026' });
  });
});

describe('verschiebe', () => {
  it('Monat über den Jahreswechsel', () => {
    expect(verschiebe('monat', '2026-01-20', -1)).toBe('2025-12-01');
    expect(verschiebe('monat', '2026-12-05', 1)).toBe('2027-01-01');
  });
  it('Quartal ab beliebigem Tag im Quartal', () => {
    expect(verschiebe('quartal', '2026-08-15', -1)).toBe('2026-04-01');
    expect(verschiebe('quartal', '2026-11-15', 1)).toBe('2027-01-01');
    expect(verschiebe('quartal', '2026-02-15', -1)).toBe('2025-10-01');
  });
  it('Jahr', () => {
    expect(verschiebe('jahr', '2026-10-15', -1)).toBe('2025-01-01');
    expect(verschiebe('jahr', '2026-10-15', 1)).toBe('2027-01-01');
  });
});

describe('Navigation', () => {
  it('kein nächster Zeitraum in der Zukunft', () => {
    expect(hatNaechsten('monat', '2026-10-15', '2026-10-15')).toBe(false);
    expect(hatNaechsten('monat', '2026-09-01', '2026-10-15')).toBe(true);
    expect(hatNaechsten('jahr', '2026-10-15', '2026-10-15')).toBe(false);
  });
  it('zurück im laufenden Zeitraum ⇒ Anker heute', () => {
    expect(naechsterAnker('monat', '2026-09-01', 1, '2026-10-15')).toBe('2026-10-15');
    expect(naechsterAnker('monat', '2026-10-15', -1, '2026-10-15')).toBe('2026-09-01');
  });
  it('imZeitraum', () => {
    const z = zeitraum('monat', '2026-10-01');
    expect(imZeitraum(z, '2026-10-31')).toBe(true);
    expect(imZeitraum(z, '2026-11-01')).toBe(false);
  });
});

describe('heute / istDatum', () => {
  it('lokales Datum', () => {
    expect(heute(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('prüft echte Kalendertage', () => {
    expect(istDatum('2026-02-28')).toBe(true);
    expect(istDatum('2026-02-29')).toBe(false);
    expect(istDatum('2026-13-01')).toBe(false);
    expect(istDatum('26-01-01')).toBe(false);
    expect(istDatum(null)).toBe(false);
  });
});
