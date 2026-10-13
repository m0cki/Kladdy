import { describe, expect, it } from 'vitest';
import { MINUS, anteil, betragAlsEingabe, formatBetrag, parseBetrag, pruefeCent, summe } from './money';

const NBSP = ' ';

describe('parseBetrag', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12,50', 1250],
    ['12,05', 1205],
    ['0,01', 1],
    [',5', 50],
    ['5,', 500],
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['1.234', 123400],
    ['1.234.567,89', 123456789],
    ['12.5', 1250],
    ['12.50', 1250],
    ['1,234.56', 123456],
    ['0', 0],
    ['007,10', 710],
  ])('„%s“ → %i Cent', (eingabe, cent) => {
    expect(parseBetrag(eingabe)).toBe(cent);
  });

  it('versteht Vorzeichen, echtes Minus eingeschlossen', () => {
    expect(parseBetrag('−3')).toBe(-300);
    expect(parseBetrag('-3')).toBe(-300);
    expect(parseBetrag('+3')).toBe(300);
    expect(parseBetrag('−1.234,56 €')).toBe(-123456);
    expect(parseBetrag('-0')).toBe(0);
    expect(Object.is(parseBetrag('-0,00'), 0)).toBe(true);
  });

  it('ignoriert Leerzeichen und €', () => {
    expect(parseBetrag(' 47,83 € ')).toBe(4783);
    expect(parseBetrag('€ 5')).toBe(500);
    expect(parseBetrag(`1${NBSP}234,56${NBSP}€`)).toBe(123456);
    expect(parseBetrag('1 234,56')).toBe(123456);
    expect(parseBetrag(formatBetrag(-123456))).toBe(-123456);
  });

  it('leer ⇒ null', () => {
    expect(parseBetrag('')).toBeNull();
    expect(parseBetrag('   ')).toBeNull();
    expect(parseBetrag(null)).toBeNull();
    expect(parseBetrag(undefined)).toBeNull();
  });

  it.each(['1,234', '12,345', '1.23,45', '1,2,3', '1.234.56', '12,3,4', 'abc', '12a', '1e3', '--3', '−', '€', '.', ',',
    '1..2', '12,5.3', '0x10', 'NaN', 'Infinity', '1.2345,00'])('Tippfehler „%s“ ⇒ null', (eingabe) => {
    expect(parseBetrag(eingabe)).toBeNull();
  });

  it('rechnet ohne Float-Fehler', () => {
    // 0,1 + 0,2 als Float wäre 0,30000000000000004; hier zählen nur Ziffern
    expect(parseBetrag('0,29')).toBe(29);
    expect(parseBetrag('1,15')).toBe(115); // 1.15 * 100 = 114.99999999999999
    expect(parseBetrag('4,35')).toBe(435); // 4.35 * 100 = 434.99999999999994
    expect(parseBetrag('90.071.992.547.409,91')).toBe(9007199254740991);
    expect(parseBetrag('90.071.992.547.409,92')).toBeNull(); // jenseits von Number.MAX_SAFE_INTEGER
  });
});

describe('formatBetrag', () => {
  it('de-DE mit Tausenderpunkt, Komma und geschütztem Leerzeichen', () => {
    expect(formatBetrag(123456)).toBe(`1.234,56${NBSP}€`);
    expect(formatBetrag(0)).toBe(`0,00${NBSP}€`);
    expect(formatBetrag(5)).toBe(`0,05${NBSP}€`);
    expect(formatBetrag(100)).toBe(`1,00${NBSP}€`);
    expect(formatBetrag(123456789)).toBe(`1.234.567,89${NBSP}€`);
  });

  it('entspricht Intl.NumberFormat für EUR (bis auf das Minus)', () => {
    const intl = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
    for (const cent of [0, 1, 99, 100, 123456, 9999999, 100000000]) {
      expect(formatBetrag(cent)).toBe(intl.format(cent / 100));
    }
  });

  it('echtes Minuszeichen U+2212', () => {
    expect(formatBetrag(-300)).toBe(`${MINUS}3,00${NBSP}€`);
    expect(formatBetrag(-300)).not.toContain('-');
    expect(MINUS).toBe('−');
  });

  it('Vorzeichen-Optionen', () => {
    expect(formatBetrag(300, { vorzeichen: 'immer' })).toBe(`+3,00${NBSP}€`);
    expect(formatBetrag(-300, { vorzeichen: 'immer' })).toBe(`${MINUS}3,00${NBSP}€`);
    expect(formatBetrag(0, { vorzeichen: 'immer' })).toBe(`0,00${NBSP}€`);
    expect(formatBetrag(-300, { vorzeichen: 'nie' })).toBe(`3,00${NBSP}€`);
  });

  it('ohne Währung und ohne Nachkommastellen', () => {
    expect(formatBetrag(123456, { waehrung: false })).toBe('1.234,56');
    expect(formatBetrag(123456, { nachkomma: 0 })).toBe(`1.235${NBSP}€`);
    expect(formatBetrag(123449, { nachkomma: 0 })).toBe(`1.234${NBSP}€`);
    expect(formatBetrag(-150, { nachkomma: 0 })).toBe(`${MINUS}2${NBSP}€`);
    expect(formatBetrag(-49, { nachkomma: 0 })).toBe(`0${NBSP}€`);
  });

  it('lehnt Nicht-Cent ab', () => {
    expect(() => formatBetrag(12.5)).toThrow(RangeError);
    expect(() => formatBetrag(Number.NaN)).toThrow(RangeError);
    expect(() => formatBetrag(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe('betragAlsEingabe', () => {
  it('Cent → Formularwert, der wieder gelesen werden kann', () => {
    expect(betragAlsEingabe(123456)).toBe('1234,56');
    expect(betragAlsEingabe(5)).toBe('0,05');
    expect(betragAlsEingabe(-300)).toBe('-3,00');
    for (const cent of [0, 1, 99, 100, 123456, -98765]) expect(parseBetrag(betragAlsEingabe(cent))).toBe(cent);
  });
});

describe('summe', () => {
  it('addiert Cent exakt', () => {
    expect(summe([])).toBe(0);
    expect(summe([10, 20])).toBe(30);
    expect(summe([1999, -500, 1])).toBe(1500);
    expect(summe(new Set([1, 2, 3]))).toBe(6);
    // tausendmal 0,10 € bleibt 100,00 €
    expect(summe(Array.from({ length: 1000 }, () => 10))).toBe(10000);
  });

  it('wirft bei Floats und Überlauf', () => {
    expect(() => summe([10, 0.5])).toThrow(RangeError);
    expect(() => summe([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
  });
});

describe('anteil', () => {
  it('Prozent mit kaufmännischer Rundung', () => {
    expect(anteil(10000, 70)).toBe(7000);
    expect(anteil(1999, 70)).toBe(1399); // 1399,3
    expect(anteil(1995, 70)).toBe(1397); // 1396,5 ⇒ aufrunden
    expect(anteil(5, 50)).toBe(3); // 2,5 ⇒ 3
    expect(anteil(-5, 50)).toBe(-3); // vom Nullpunkt weg
    expect(anteil(1234, 100)).toBe(1234);
    expect(anteil(1234, 0)).toBe(0);
    expect(Object.is(anteil(-1, 10), 0)).toBe(true);
  });

  it('nur Ganzzahlen', () => {
    expect(() => anteil(100, 12.5)).toThrow(RangeError);
    expect(() => anteil(1.5, 10)).toThrow(RangeError);
  });
});

describe('pruefeCent', () => {
  it('lässt sichere Ganzzahlen durch', () => {
    expect(pruefeCent(42)).toBe(42);
    expect(() => pruefeCent(4.2, 'Test')).toThrow('Test: 4.2 ist kein ganzer Centbetrag');
  });
});
