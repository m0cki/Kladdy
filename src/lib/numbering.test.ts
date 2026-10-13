import { describe, expect, it } from 'vitest';
import {
  KREIS_NAMEN,
  STANDARD_MUSTER,
  ZAEHLER_MAX,
  formatNummer,
  hoechsteLaufende,
  istJahresabhaengig,
  musterFehler,
  musterKollidieren,
  musterRegex,
  musterWechselFehler,
  naechsteNummer,
  vorschau,
  zaehlerErhoehen,
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

describe('musterRegex / hoechsteLaufende', () => {
  it('erkennt Nummern des Musters im Jahr', () => {
    const re = musterRegex('RE-{JJJJ}-{NNN}', 2026);
    expect(re.exec('RE-2026-014')?.[1]).toBe('014');
    expect(re.test('RE-2026-1000')).toBe(true);
    expect(re.test('RE-2025-014')).toBe(false);
    expect(re.test('RE-2026-14')).toBe(false);
    expect(re.test('XRE-2026-014')).toBe(false);
  });

  it('maskiert Sonderzeichen im Muster', () => {
    expect(musterRegex('R.{JJ}/{NN}', 2026).test('R.26/07')).toBe(true);
    expect(musterRegex('R.{JJ}/{NN}', 2026).test('RX26/07')).toBe(false);
  });

  it('höchste vergebene Nummer', () => {
    const nummern = ['QU-2026-001', 'QU-2026-105', 'QU-2025-300', 'RE-2026-200', 'QU-2026-009'];
    expect(hoechsteLaufende('QU-{JJJJ}-{NNN}', 2026, nummern)).toBe(105);
    expect(hoechsteLaufende('QU-{JJJJ}-{NNN}', 2027, nummern)).toBe(0);
    expect(hoechsteLaufende('K-{NNNN}', 2026, ['K-0001', 'K-0220'])).toBe(220);
  });
});

describe('musterKollidieren', () => {
  it('gleiche Form = Gefahr doppelter Nummern', () => {
    expect(musterKollidieren('RE-{JJJJ}-{NNN}', 'RE-{JJJJ}-{NNNN}')).toBe(true);
    expect(musterKollidieren('RE-{JJ}-{NNN}', 'RE-{JJJJ}-{NNN}')).toBe(true);
    expect(musterKollidieren('RE-{JJJJ}-{NNN}', 'QU-{JJJJ}-{NNN}')).toBe(false);
  });
});

describe('musterWechselFehler', () => {
  const kreis = { muster: 'RE-{JJJJ}-{NNN}', jahr: 2026, naechste: 15 };

  it('neues Muster ohne Überschneidung ist in Ordnung', () => {
    expect(musterWechselFehler(kreis, 'R{JJ}-{NNNN}', 2026, ['RE-2026-001', 'RE-2026-014'])).toBeNull();
  });

  it('ungültiges Muster', () => {
    expect(musterWechselFehler(kreis, 'RE-{JJJJ}', 2026, [])).toMatch(/laufende Nummer/);
  });

  it('zurück zu einem alten Muster, mit dem schon höhere Nummern vergeben sind', () => {
    const nummern = ['R26-0001', 'R26-0030', 'RE-2026-014'];
    expect(musterWechselFehler(kreis, 'R{JJ}-{NNNN}', 2026, nummern)).toBe(
      'Mit diesem Muster wäre R26-0015 schon vergeben (bis R26-0030). Nummern werden nie wiederverwendet.',
    );
  });

  it('gleiches Schema wie ein anderer Kreis derselben Tabelle', () => {
    expect(musterWechselFehler(kreis, 'QU-{JJJJ}-{NNNN}', 2026, [], [{ name: 'Quittung', muster: 'QU-{JJJJ}-{NNN}' }])).toMatch(
      /Quittung/,
    );
  });

  it('Kreis steht schon in einem späteren Jahr', () => {
    expect(musterWechselFehler({ ...kreis, jahr: 2027 }, 'R{JJ}-{NNNN}', 2026, [])).toMatch(/2027/);
  });
});

describe('zaehlerErhoehen', () => {
  const kreis = { muster: 'RE-{JJJJ}-{NNN}', jahr: 2026, naechste: 15 };

  it('nur nach oben', () => {
    expect(zaehlerErhoehen(kreis, 40, 2026)).toEqual({ stand: { jahr: 2026, naechste: 40 } });
    expect(zaehlerErhoehen(kreis, 14, 2026)).toEqual({ fehler: 'Kleiner als 15 geht nicht: Nummern werden nie wiederverwendet.' });
    expect(zaehlerErhoehen(kreis, 15, 2026)).toEqual({ fehler: 'RE-2026-015 ist schon die nächste Nummer.' });
  });

  it('neues Jahr: Kreis begänne bei 1, Erhöhen setzt das Jahr mit', () => {
    expect(zaehlerErhoehen(kreis, 5, 2027)).toEqual({ stand: { jahr: 2027, naechste: 5 } });
    expect(zaehlerErhoehen({ muster: 'QU-{JJJJ}-{NNN}', jahr: 0, naechste: 1 }, 105, 2026)).toEqual({ stand: { jahr: 2026, naechste: 105 } });
  });

  it('Kreis ohne Jahr behält jahr = 0', () => {
    expect(zaehlerErhoehen({ muster: 'K-{NNNN}', jahr: 0, naechste: 221 }, 300, 2026)).toEqual({ stand: { jahr: 0, naechste: 300 } });
  });

  it('nie unter eine schon vergebene Nummer', () => {
    expect(zaehlerErhoehen(kreis, 20, 2026, ['RE-2026-025'])).toEqual({ fehler: 'RE-2026-025 ist schon vergeben.' });
  });

  it('ungültige Eingaben', () => {
    expect(zaehlerErhoehen(kreis, 20.5, 2026)).toHaveProperty('fehler');
    expect(zaehlerErhoehen(kreis, ZAEHLER_MAX + 1, 2026)).toEqual({ fehler: 'Bitte eine ganze Zahl von 1 bis 99.999.999 eintragen.' });
    expect(zaehlerErhoehen({ ...kreis, jahr: 2027 }, 20, 2026)).toHaveProperty('fehler');
  });
});
