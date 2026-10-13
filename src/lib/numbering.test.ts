import { describe, expect, it } from 'vitest';
import {
  KREIS_NAMEN,
  STANDARD_MUSTER,
  formatNummer,
  istJahresabhaengig,
  musterFehler,
  naechsteNummer,
  vorschau,
  type NummernkreisId,
} from './numbering';
import standarddaten from '../../src-tauri/migrations/0002_standarddaten.sql?raw';

describe('formatNummer', () => {
  it('Standardmuster wie in der Anleitung', () => {
    expect(formatNummer(STANDARD_MUSTER.quittung, 2026, 105)).toBe('QU-2026-105');
    expect(formatNummer(STANDARD_MUSTER.rechnung, 2026, 14)).toBe('RE-2026-014');
    expect(formatNummer(STANDARD_MUSTER.angebot, 2026, 1)).toBe('AN-2026-001');
    expect(formatNummer(STANDARD_MUSTER.eigenbeleg, 2026, 7)).toBe('EB-2026-007');
    expect(formatNummer(STANDARD_MUSTER.buchung, 2026, 1)).toBe('2026-0001');
    expect(formatNummer(STANDARD_MUSTER.kunde, 0, 12)).toBe('K-0012');
  });

  it('schneidet große Nummern nicht ab', () => {
    expect(formatNummer('RE-{JJJJ}-{NNN}', 2026, 1000)).toBe('RE-2026-1000');
    expect(formatNummer('K-{NNNN}', 0, 123456)).toBe('K-123456');
  });

  it('zweistelliges Jahr, beliebige Stellen, Platzhalter an jeder Stelle', () => {
    expect(formatNummer('R{JJ}/{NNNNN}', 2026, 42)).toBe('R26/00042');
    expect(formatNummer('{N}', 0, 3)).toBe('3');
    expect(formatNummer('{NNN}-{JJJJ}', 2030, 9)).toBe('009-2030');
    expect(formatNummer('R{JJ}-{NN}', 2005, 1)).toBe('R05-01');
  });

  it('wirft bei ungültigen Eingaben', () => {
    expect(() => formatNummer('RE-{JJJJ}', 2026, 1)).toThrow(/laufende Nummer/);
    expect(() => formatNummer('RE-{NNN}', 2026, 0)).toThrow(RangeError);
    expect(() => formatNummer('RE-{NNN}', 2026, 1.5)).toThrow(RangeError);
    expect(() => formatNummer('RE-{JJJJ}-{NNN}', 0, 1)).toThrow(/Jahr 0/);
    expect(() => formatNummer('RE-{JJJJ}-{NNN}', 26, 1)).toThrow(RangeError);
  });
});

describe('Startdaten', () => {
  it('Migration 0002 legt dieselben Muster an wie STANDARD_MUSTER', () => {
    const zeilen = [...standarddaten.matchAll(/\('(\w+)',\s*'([^']+)',\s*0,\s*1\)/g)].map(([, id, muster]) => [id, muster]);
    expect(Object.fromEntries(zeilen)).toEqual(STANDARD_MUSTER);
  });
});

describe('musterFehler', () => {
  it('alle Standardmuster sind gültig', () => {
    for (const id of Object.keys(STANDARD_MUSTER) as NummernkreisId[]) {
      expect(musterFehler(STANDARD_MUSTER[id])).toBeNull();
      expect(KREIS_NAMEN[id]).toBeTruthy();
    }
  });

  it.each([
    ['', /leer/],
    ['   ', /leer/],
    ['RE-{JJJJ}', /laufende Nummer/],
    ['RE-{NNN}-{NN}', /nur eine/],
    ['RE-{MM}-{NNN}', /Unbekannter Platzhalter \{MM\}/],
    ['RE-{nnn}', /Unbekannter/],
    ['RE-{NNNNNNNNN}', /Unbekannter/],
    ['RE {NNN}', /keine Leerzeichen/],
    ['RE-{NNN}}', /Geschweifte/],
    ['RE-{{NNN}', /Geschweifte/],
    ['RE\\{NNN}', /Erlaubt sind/],
    ['RE-$-{NNN}', /Erlaubt sind/],
    ['R'.repeat(41) + '{N}', /höchstens 40/],
  ])('„%s“ ⇒ Fehler', (muster, meldung) => {
    expect(musterFehler(muster)).toMatch(meldung);
  });

  it('erlaubt Umlaute, Punkt, Schrägstrich, Unterstrich', () => {
    expect(musterFehler('Gü_{JJ}/{NNN}.x')).toBeNull();
  });
});

describe('istJahresabhaengig / vorschau', () => {
  it('erkennt das Jahr im Muster', () => {
    expect(istJahresabhaengig('RE-{JJJJ}-{NNN}')).toBe(true);
    expect(istJahresabhaengig('R{JJ}{NNN}')).toBe(true);
    expect(istJahresabhaengig('K-{NNNN}')).toBe(false);
  });

  it('Vorschau zeigt die erste Nummer oder null', () => {
    expect(vorschau('QU-{JJJJ}-{NNN}', 2026)).toBe('QU-2026-001');
    expect(vorschau('K-{NNNN}', 2026)).toBe('K-0001');
    expect(vorschau('QU-{JJJJ}', 2026)).toBeNull();
  });
});

describe('naechsteNummer', () => {
  const quittung = { muster: STANDARD_MUSTER.quittung, jahr: 2026, naechste: 105 };

  it('zählt im selben Jahr weiter', () => {
    expect(naechsteNummer(quittung, 2026)).toEqual({
      nummer: 'QU-2026-105',
      laufend: 105,
      stand: { jahr: 2026, naechste: 106 },
    });
  });

  it('beginnt im neuen Jahr bei 1', () => {
    expect(naechsteNummer(quittung, 2027)).toEqual({
      nummer: 'QU-2027-001',
      laufend: 1,
      stand: { jahr: 2027, naechste: 2 },
    });
  });

  it('frischer Kreis (jahr = 0 aus der Startmigration) beginnt bei 1 im laufenden Jahr', () => {
    expect(naechsteNummer({ muster: STANDARD_MUSTER.buchung, jahr: 0, naechste: 1 }, 2026)).toEqual({
      nummer: '2026-0001',
      laufend: 1,
      stand: { jahr: 2026, naechste: 2 },
    });
  });

  it('kein Weiterzählen in einem schon abgeschlossenen Jahr', () => {
    expect(() => naechsteNummer(quittung, 2025)).toThrow(/2025/);
  });

  it('Kundennummern laufen jahresunabhängig weiter', () => {
    const kunde = { muster: STANDARD_MUSTER.kunde, jahr: 0, naechste: 12 };
    expect(naechsteNummer(kunde, 2026)).toEqual({ nummer: 'K-0012', laufend: 12, stand: { jahr: 0, naechste: 13 } });
    expect(naechsteNummer(kunde, 2031).nummer).toBe('K-0012');
  });

  it('lückenlos: mehrfach hintereinander vergeben', () => {
    let kreis = { muster: STANDARD_MUSTER.rechnung, jahr: 0, naechste: 1 };
    const nummern: string[] = [];
    for (const jahr of [2026, 2026, 2026, 2027, 2027]) {
      const v = naechsteNummer(kreis, jahr);
      nummern.push(v.nummer);
      kreis = { ...kreis, ...v.stand };
    }
    expect(nummern).toEqual(['RE-2026-001', 'RE-2026-002', 'RE-2026-003', 'RE-2027-001', 'RE-2027-002']);
  });

  it('wirft bei kaputtem Stand', () => {
    expect(() => naechsteNummer({ ...quittung, naechste: 0 }, 2026)).toThrow(RangeError);
    expect(() => naechsteNummer({ ...quittung, naechste: 2.5 }, 2026)).toThrow(RangeError);
  });
});
