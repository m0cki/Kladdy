import { describe, expect, it } from 'vitest';
import {
  KENNWERTE,
  anzeigeJahr,
  jahrFehler,
  jahrVorschlag,
  kennwertAlsEingabe,
  kennwertAusText,
  kennwerteNachJahr,
  kennwertLesen,
  kopierQuelle,
} from './steuer-kennwerte';

describe('KENNWERTE', () => {
  it('eindeutige Schlüssel, Einheit passt zum Namen', () => {
    const s = KENNWERTE.map((k) => k.schluessel);
    expect(new Set(s).size).toBe(s.length);
    for (const k of KENNWERTE) expect(k.schluessel.endsWith(k.einheit === 'cent' ? '_cent' : '_prozent')).toBe(true);
  });
});

describe('gespeicherte Werte', () => {
  it('liest nur ganze, nicht negative Zahlen', () => {
    expect(kennwertAusText('2500000')).toBe(2500000);
    expect(kennwertAusText(' 70 ')).toBe(70);
    expect(kennwertAusText('0.3')).toBeNull();
    expect(kennwertAusText('-5')).toBeNull();
    expect(kennwertAusText('')).toBeNull();
    expect(kennwertAusText(null)).toBeNull();
    expect(kennwertAusText('99999999999999999999')).toBeNull();
  });

  it('gruppiert nach Jahr, aufsteigend', () => {
    const m = kennwerteNachJahr([
      { jahr: 2026, schluessel: 'km_pauschale_cent', wert: '30' },
      { jahr: 2025, schluessel: 'km_pauschale_cent', wert: '30' },
      { jahr: 2026, schluessel: 'bewirtung_abziehbar_prozent', wert: '70' },
      { jahr: 2026, schluessel: 'kaputt', wert: 'abc' },
    ]);
    expect([...m.keys()]).toEqual([2025, 2026]);
    expect(m.get(2026)).toEqual({ km_pauschale_cent: 30, bewirtung_abziehbar_prozent: 70 });
  });
});

describe('Eingabe', () => {
  it('zeigt Cent als Betrag ohne €, Prozent als Zahl', () => {
    expect(kennwertAlsEingabe(2500000, 'cent')).toBe('25.000,00');
    expect(kennwertAlsEingabe(30, 'cent')).toBe('0,30');
    expect(kennwertAlsEingabe(70, 'prozent')).toBe('70');
  });

  it('liest Beträge in Cent', () => {
    expect(kennwertLesen('25.000', 'cent')).toEqual({ wert: 2500000 });
    expect(kennwertLesen('0,30', 'cent')).toEqual({ wert: 30 });
    expect(kennwertLesen('1.260,00 €', 'cent')).toEqual({ wert: 126000 });
    expect(kennwertLesen('0', 'cent')).toEqual({ wert: 0 });
    expect(kennwertLesen('−5', 'cent')).toEqual({ fehler: 'Der Betrag darf nicht negativ sein.' });
    expect(kennwertLesen('abc', 'cent')).toHaveProperty('fehler');
    expect(kennwertLesen('  ', 'cent')).toHaveProperty('fehler');
  });

  it('liest ganze Prozent bis 100', () => {
    expect(kennwertLesen('70', 'prozent')).toEqual({ wert: 70 });
    expect(kennwertLesen('70 %', 'prozent')).toEqual({ wert: 70 });
    expect(kennwertLesen('70,5', 'prozent')).toHaveProperty('fehler');
    expect(kennwertLesen('101', 'prozent')).toEqual({ fehler: 'Höchstens 100 %.' });
  });
});

describe('Jahr anlegen', () => {
  it('schlägt das aktuelle Jahr vor, sonst das nächste', () => {
    expect(jahrVorschlag([2026], 2027)).toBe(2027);
    expect(jahrVorschlag([2026], 2026)).toBe(2027);
    expect(jahrVorschlag([2025, 2026, 2027], 2026)).toBe(2028);
    expect(jahrVorschlag([], 2026)).toBe(2026);
  });

  it('prüft das Jahr', () => {
    expect(jahrFehler(2027, [2026])).toBeNull();
    expect(jahrFehler(2026, [2026])).toMatch(/schon/);
    expect(jahrFehler(1999, [])).toMatch(/zwischen/);
    expect(jahrFehler(2026.5, [])).toMatch(/zwischen/);
    expect(jahrFehler(2026, [2026])).toBe('Für 2026 gibt es schon Kennwerte.');
    expect(jahrFehler(2026, [2026], 'eine EÜR-Zuordnung')).toBe('Für 2026 gibt es schon eine EÜR-Zuordnung.');
  });

  it('übernimmt die Werte aus dem nächstälteren Jahr, sonst aus dem ältesten', () => {
    expect(kopierQuelle([2025, 2026], 2027)).toBe(2026);
    expect(kopierQuelle([2024, 2026], 2025)).toBe(2024);
    expect(kopierQuelle([2026, 2027], 2025)).toBe(2026);
    expect(kopierQuelle([], 2026)).toBeNull();
  });

  it('zeigt das laufende Jahr, wenn es Werte hat, sonst das neueste', () => {
    expect(anzeigeJahr([2025, 2026], 2026)).toBe(2026);
    expect(anzeigeJahr([2025, 2026], 2027)).toBe(2026);
    expect(anzeigeJahr([2026, 2028], 2027)).toBe(2028);
    expect(anzeigeJahr([], 2026)).toBeNull();
  });
});
