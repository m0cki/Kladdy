import { describe, expect, it } from 'vitest';
import { betragInWorten, zahlInWorten } from './zahl-in-worten';

describe('zahlInWorten', () => {
  it.each([
    [0, 'null'],
    [1, 'eins'],
    [7, 'sieben'],
    [11, 'elf'],
    [12, 'zwölf'],
    [16, 'sechzehn'],
    [17, 'siebzehn'],
    [20, 'zwanzig'],
    [21, 'einundzwanzig'],
    [30, 'dreißig'],
    [99, 'neunundneunzig'],
    [100, 'einhundert'],
    [101, 'einhunderteins'],
    [111, 'einhundertelf'],
    [153, 'einhundertdreiundfünfzig'],
    [999, 'neunhundertneunundneunzig'],
    [1000, 'eintausend'],
    [1001, 'eintausendeins'],
    [1234, 'eintausendzweihundertvierunddreißig'],
    [21000, 'einundzwanzigtausend'],
    [100000, 'einhunderttausend'],
    [999999, 'neunhundertneunundneunzigtausendneunhundertneunundneunzig'],
    [1000000, 'eine Million'],
    [1000001, 'eine Million eins'],
    [2000000, 'zwei Millionen'],
    [21000000, 'einundzwanzig Millionen'],
    [101000000, 'einhunderteine Millionen'],
    [999999999, 'neunhundertneunundneunzig Millionen neunhundertneunundneunzigtausendneunhundertneunundneunzig'],
  ])('%i ⇒ %s', (n, wort) => {
    expect(zahlInWorten(n)).toBe(wort);
  });

  it('sagt „ein“ vor einem Nomen nur bei genau 1', () => {
    expect(zahlInWorten(1, true)).toBe('ein');
    expect(zahlInWorten(101, true)).toBe('einhunderteins');
    expect(zahlInWorten(21, true)).toBe('einundzwanzig');
  });

  it('lehnt Werte außerhalb des Bereichs ab', () => {
    expect(() => zahlInWorten(-1)).toThrow(RangeError);
    expect(() => zahlInWorten(1.5)).toThrow(RangeError);
    expect(() => zahlInWorten(1_000_000_000)).toThrow(RangeError);
  });
});

describe('betragInWorten', () => {
  it.each([
    [0, 'null Euro'],
    [1, 'ein Cent'],
    [50, 'fünfzig Cent'],
    [100, 'ein Euro'],
    [101, 'ein Euro und ein Cent'],
    [1600, 'sechzehn Euro'],
    [2100, 'einundzwanzig Euro'],
    [10000, 'einhundert Euro'],
    [10100, 'einhunderteins Euro'],
    [15300, 'einhundertdreiundfünfzig Euro'],
    [15350, 'einhundertdreiundfünfzig Euro und fünfzig Cent'],
    [12350, 'einhundertdreiundzwanzig Euro und fünfzig Cent'],
    [100000, 'eintausend Euro'],
    [100100, 'eintausendeins Euro'],
    [25000, 'zweihundertfünfzig Euro'],
    [100000000, 'eine Million Euro'],
  ])('%i Cent ⇒ %s', (cent, wort) => {
    expect(betragInWorten(cent)).toBe(wort);
  });

  it('ignoriert das Vorzeichen', () => {
    expect(betragInWorten(-15350)).toBe('einhundertdreiundfünfzig Euro und fünfzig Cent');
  });

  it('nimmt über 999.999.999 € die Ziffern', () => {
    expect(betragInWorten(100_000_000_000)).toBe('1.000.000.000,00\u00a0€');
  });

  it('wirft bei Nicht-Cent-Beträgen', () => {
    expect(() => betragInWorten(12.5)).toThrow(RangeError);
  });
});
