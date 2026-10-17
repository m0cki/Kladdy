import { describe, expect, it } from 'vitest';
import {
  achsenText,
  areaPath,
  balkenraster,
  bandIndex,
  barPath,
  donutBogen,
  donutSegmente,
  easeOutCubic,
  geldAchse,
  hochzaehlWert,
  linePath,
  naechsterIndex,
  niceTicks,
  prozenteGanz,
  prozentText,
  skala,
  stepPath,
  xBeschriftungen,
} from './charts';

describe('niceTicks', () => {
  it('runde Schritte 1/2/5 × 10^n, Bereich auf ganze Schritte erweitert', () => {
    expect(niceTicks(0, 97)).toEqual({ lo: 0, hi: 100, ticks: [0, 20, 40, 60, 80, 100] });
    expect(niceTicks(0, 1234)).toEqual({ lo: 0, hi: 1500, ticks: [0, 500, 1000, 1500] });
    expect(niceTicks(-130, 410).ticks).toEqual([-200, -100, 0, 100, 200, 300, 400, 500]);
  });
  it('enthält 0 genau (keine −0, keine Rundungsreste)', () => {
    const { ticks } = niceTicks(-0.3, 0.7);
    expect(ticks).toContain(0);
    expect(ticks.every((t) => Object.is(t, -0) === false)).toBe(true);
    expect(niceTicks(0, 0.3).ticks).toEqual([0, 0.1, 0.2, 0.3]);
  });
  it('gleiche Werte ⇒ trotzdem eine Spanne', () => {
    const a = niceTicks(5, 5);
    expect(a.lo).toBeLessThan(5);
    expect(a.hi).toBeGreaterThan(5);
    expect(niceTicks(0, 0).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
  it('vertauschte oder ungültige Grenzen', () => {
    expect(niceTicks(100, 0)).toEqual(niceTicks(0, 100));
    expect(niceTicks(NaN, Infinity).ticks.length).toBeGreaterThan(1);
  });
  it('minSchritt: bei Cent-Werten nie kleiner als ein Euro', () => {
    expect(niceTicks(0, 80, 4, 100).ticks).toEqual([0, 100]);
    expect(niceTicks(0, 0, 4, 100).ticks).toEqual([0, 100]);
  });
});

describe('geldAchse', () => {
  it('0 immer enthalten, ganze Euro-Schritte, null-Werte ignoriert', () => {
    const a = geldAchse([120_000, null, 345_678]);
    expect(a.lo).toBe(0);
    expect(a.hi).toBeGreaterThanOrEqual(345_678);
    expect(a.ticks.every((t) => Number.isInteger(t) && t % 100 === 0)).toBe(true);
  });
  it('negative Werte (Überschuss) ⇒ Achse unter 0', () => {
    const a = geldAchse([-50_000, 200_000]);
    expect(a.lo).toBeLessThanOrEqual(-50_000);
    expect(a.ticks).toContain(0);
  });
  it('keine Werte ⇒ 0 bis 1 €', () => {
    expect(geldAchse([]).ticks).toEqual([0, 100]);
    expect(geldAchse([null]).ticks).toEqual([0, 100]);
  });
});

describe('skala', () => {
  it('lo unten, hi oben', () => {
    const y = skala(0, 100, 10, 200);
    expect(y(0)).toBe(210);
    expect(y(100)).toBe(10);
    expect(y(50)).toBe(110);
  });
  it('lo = hi wirft nicht (keine Division durch 0)', () => {
    expect(Number.isFinite(skala(5, 5, 0, 100)(5))).toBe(true);
  });
});

describe('achsenText', () => {
  it('ganze Euro mit Tausenderpunkt, echtes Minus', () => {
    expect(achsenText(120_000, 50_000)).toBe('1.200');
    expect(achsenText(-30_000, 10_000)).toBe('−300');
    expect(achsenText(0, 10_000)).toBe('0');
  });
  it('ab 100.000 € bei großen Schritten kompakt „Tsd.“', () => {
    expect(achsenText(12_000_000, 2_000_000)).toBe('120 Tsd.');
    expect(achsenText(-15_000_000, 5_000_000)).toBe('−150 Tsd.');
    // kleiner Schritt ⇒ volle Zahl, damit die Ticks unterscheidbar bleiben
    expect(achsenText(10_050_000, 50_000)).toBe('100.500');
  });
});

describe('prozentText', () => {
  it('eine Nachkommastelle, Vorzeichen immer', () => {
    expect(prozentText(0.1234)).toBe('+12,3 %');
    expect(prozentText(-0.04)).toBe('−4,0 %');
    expect(prozentText(0)).toBe('0,0 %');
    expect(prozentText(0.00004)).toBe('0,0 %');
  });
});

describe('Pfade', () => {
  it('linePath gerade', () => {
    expect(linePath([])).toBe('');
    expect(linePath([[0, 0], [10, 5]])).toBe('M0.00,0.00L10.00,5.00');
  });
  it('linePath glatt: kubisch, beginnt und endet an den Punkten', () => {
    const d = linePath([[0, 10], [10, 0], [20, 10], [30, 5]], true);
    expect(d.startsWith('M0.00,10.00C')).toBe(true);
    expect(d.endsWith('30.00,5.00')).toBe(true);
    expect((d.match(/C/g) ?? []).length).toBe(3);
  });
  it('linePath glatt: monoton steigende Punkte ⇒ keine Überschwinger über den Endwert', () => {
    const d = linePath([[0, 100], [10, 50], [20, 40], [30, 0]], true);
    const ys = [...d.matchAll(/(-?\d+\.\d+),(-?\d+\.\d+)/g)].map((m) => Number(m[2]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });
  it('stepPath springt waagerecht, dann senkrecht', () => {
    expect(stepPath([[0, 10], [5, 20], [9, 15]])).toBe('M0.00,10.00H5.00V20.00H9.00V15.00');
    expect(stepPath([])).toBe('');
  });
  it('areaPath schließt zur Grundlinie', () => {
    expect(areaPath([[0, 10], [10, 5]], 50)).toBe('M0.00,10.00L10.00,5.00L10.00,50.00L0.00,50.00Z');
    expect(areaPath([], 50)).toBe('');
  });
  it('barPath: Rundung nur am Datenende, gerade an der Nulllinie', () => {
    const hoch = barPath(10, 20, 100, 40);
    expect(hoch.startsWith('M10.00,100.00V44.00Q10.00,40.00 14.00,40.00')).toBe(true);
    expect(hoch.endsWith('V100.00Z')).toBe(true);
    const runter = barPath(10, 20, 100, 160); // negativer Wert
    expect(runter.startsWith('M10.00,100.00V156.00Q10.00,160.00')).toBe(true);
  });
  it('barPath: unsichtbar kleine Balken entfallen, Rundung höchstens halbe Breite/Höhe', () => {
    expect(barPath(0, 10, 100, 99.8)).toBe('');
    expect(barPath(0, 0, 100, 50)).toBe('');
    expect(barPath(0, 4, 100, 98)).toContain('V100.00Z');
    expect(barPath(0, 4, 100, 98)).toMatch(/^M0.00,100.00V100.00Q0.00,98.00 2.00,98.00/);
  });
});

describe('balkenraster', () => {
  it('höchstens 26 px je Balken, 2 px Abstand', () => {
    const r = balkenraster(1200, 12, 2);
    expect(r.band).toBe(100);
    expect(r.gruppe).toBe(54);
    expect(r.balken).toBe(26);
  });
  it('wenig Platz: Gruppe 72 % des Bands', () => {
    const r = balkenraster(240, 12, 2);
    expect(r.band).toBe(20);
    expect(r.gruppe).toBeCloseTo(14.4);
    expect(r.balken).toBeCloseTo(6.2);
  });
});

describe('Donut', () => {
  it('Segmente beginnen oben, laufen im Uhrzeigersinn, mit Fuge', () => {
    const s = donutSegmente([300, 100]);
    expect(s[0].a1).toBeCloseTo(-Math.PI / 2);
    expect(s[0].anteil).toBe(0.75);
    expect(s[1].a1).toBeCloseTo(-Math.PI / 2 + 1.5 * Math.PI);
    expect(s[0].a2).toBeCloseTo(s[1].a1 - 0.012);
  });
  it('ein Segment ohne Fuge, Nullen und Negative zählen nicht', () => {
    const s = donutSegmente([0, 500, -20]);
    expect(s[1].anteil).toBe(1);
    expect(s[1].a2 - s[1].a1).toBeCloseTo(2 * Math.PI);
    expect(s[0].anteil).toBe(0);
    expect(s[2].anteil).toBe(0);
  });
  it('alles 0 ⇒ keine NaN', () => {
    expect(donutSegmente([0, 0]).every((x) => x.anteil === 0 && Number.isFinite(x.a2))).toBe(true);
  });
  it('donutBogen: Ringstück, voller Kreis bleibt zeichenbar', () => {
    const d = donutBogen(85, 85, 58, -Math.PI / 2, 0);
    expect(d).toBe('M85.00,0.00A85,85 0 0 1 170.00,85.00L143.00,85.00A58,58 0 0 0 85.00,27.00Z');
    expect(donutBogen(85, 85, 58, 0, Math.PI * 1.5)).toContain('A85,85 0 1 1');
    const voll = donutBogen(85, 85, 58, -Math.PI / 2, 1.5 * Math.PI);
    expect(voll).not.toContain('NaN');
    expect(voll).toContain(' 0 1 1 ');
  });
  it('prozenteGanz: Summe genau 100', () => {
    expect(prozenteGanz([1, 1, 1])).toEqual([34, 33, 33]);
    expect(prozenteGanz([5000, 3000, 2000])).toEqual([50, 30, 20]);
    expect(prozenteGanz([0, 0])).toEqual([0, 0]);
    expect(prozenteGanz([999, 1]).reduce((a, b) => a + b)).toBe(100);
  });
});

describe('Beschriftung & Hover', () => {
  it('xBeschriftungen: genug Platz ⇒ alle', () => {
    expect(xBeschriftungen(12, 80)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
  it('xBeschriftungen: wenig Platz ⇒ jede k-te, der letzte immer', () => {
    expect(xBeschriftungen(12, 20)).toEqual([2, 5, 8, 11]);
    expect(xBeschriftungen(0, 20)).toEqual([]);
  });
  it('naechsterIndex und bandIndex begrenzt', () => {
    expect(naechsterIndex(58, 58, 1100, 12)).toBe(0);
    expect(naechsterIndex(58 + 1100, 58, 1100, 12)).toBe(11);
    expect(naechsterIndex(9999, 58, 1100, 12)).toBe(11);
    expect(naechsterIndex(-5, 58, 1100, 12)).toBe(0);
    expect(bandIndex(58 + 250, 58, 100, 12)).toBe(2);
    expect(bandIndex(0, 58, 100, 12)).toBe(0);
    expect(bandIndex(5000, 58, 100, 12)).toBe(11);
  });
});

describe('Hochzählen', () => {
  it('ease-out cubic', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBe(0.875);
    expect(easeOutCubic(2)).toBe(1);
  });
  it('Zwischenwerte ganzzahlig, am Ende genau das Ziel', () => {
    expect(hochzaehlWert(123_457, 0)).toBe(0);
    expect(Number.isInteger(hochzaehlWert(123_457, 0.37))).toBe(true);
    expect(hochzaehlWert(123_457, 1)).toBe(123_457);
    expect(hochzaehlWert(-5_000, 1.2)).toBe(-5_000);
  });
});
