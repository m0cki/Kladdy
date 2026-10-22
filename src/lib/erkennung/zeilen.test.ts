import { describe, expect, it } from 'vitest';
import { zeilenAus, type Textstueck } from './zeilen';

/** Textstück wie von pdf.js: Schriftgröße h, Lage x/y, Breite w */
const s = (str: string, x: number, y: number, w: number, h = 10): Textstueck => ({ str, transform: [h, 0, 0, h, x, y], width: w, height: h });

describe('zeilenAus', () => {
  it('Zeilen von oben nach unten, Stücke von links nach rechts', () => {
    expect(zeilenAus([s('unten', 0, 100, 25), s('rechts', 60, 200, 30), s('links', 0, 200, 25)])).toEqual(['links  rechts', 'unten']);
  });

  it('fast gleiche Grundlinie (halbe Schrifthöhe) = eine Zeile', () => {
    expect(zeilenAus([s('Summe', 0, 200, 30), s('47,83', 150, 202, 25)])).toEqual(['Summe  47,83']);
    expect(zeilenAus([s('oben', 0, 200, 20), s('darunter', 0, 192, 40)])).toEqual(['oben', 'darunter']);
  });

  it('Spaltenwechsel ab 0,8 em ⇒ zwei Leerzeichen, Wortabstand ⇒ eins, direkt anschließend ⇒ keins', () => {
    // Courier: Wortabstand 0,6 em – pdf.js trennt dort schon in eigene Stücke
    expect(zeilenAus([s('Ponal', 0, 100, 30), s('Holzleim', 36, 100, 48), s('9,99', 120, 100, 24)])).toEqual(['Ponal Holzleim  9,99']);
    expect(zeilenAus([s('St.', 0, 100, 18), s('12,49', 18, 100, 30)])).toEqual(['St.12,49']);
  });

  it('Leerzeichen-Stücke zählen nicht, ein Leerzeichen am Ende wird nicht verdoppelt', () => {
    expect(zeilenAus([s('Blumenerde 40 l', 11, 394, 65.5, 9), s(' ', 76.8, 394, 96.6, 9), s('13,98', 192.8, 394, 22.5, 9)])).toEqual(['Blumenerde 40 l  13,98']);
    expect(zeilenAus([s('Lavendel im ', 0, 100, 60), s('T', 62, 100, 6), s('opf', 68, 100, 18)])).toEqual(['Lavendel im Topf']);
  });

  it('Doppeldruck (Fett-Simulation) zählt einmal', () => {
    expect(zeilenAus([s('BAUHAUS', 50, 300, 70, 20), s('BAUHAUS', 50.4, 300, 70, 20)])).toEqual(['BAUHAUS']);
  });

  it('gedrehter Text kommt ans Ende, leere und kaputte Stücke fallen weg', () => {
    const quer: Textstueck = { str: 'Randvermerk', transform: [0, 8, -8, 0, 10, 50], width: 60, height: 8 };
    const kaputt: Textstueck = { str: 'NaN', transform: [10, 0, 0, 10, Number.NaN, 5], width: 5, height: 10 };
    expect(zeilenAus([quer, s('Text', 0, 100, 20), s('', 0, 80, 0), kaputt])).toEqual(['Text', 'Randvermerk']);
  });

  it('ohne Höhe zählt die Schriftgröße aus der Matrix', () => {
    expect(zeilenAus([{ str: 'A', transform: [12, 0, 0, 12, 0, 100], width: 8, height: 0 }, { str: 'B', transform: [12, 0, 0, 12, 30, 103], width: 8, height: 0 }])).toEqual(['A  B']);
  });

  it('nichts ⇒ keine Zeilen', () => {
    expect(zeilenAus([])).toEqual([]);
  });
});
