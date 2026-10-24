import { describe, expect, it } from 'vitest';
import { BEISPIEL_FIRMA, testbeleg } from './beispiel';
import { platzhalterWerte, type PlatzhalterName } from './dokument';
import {
  OHNE_STIL,
  bereichErsetzen,
  ersetzteZeilen,
  formatieren,
  hatFormatierung,
  hatStil,
  klartext,
  laenge,
  normalisieren,
  parsen,
  platzhalterErkennen,
  serialisieren,
  stilBei,
  textLaeufe,
  trimmen,
  zeichenLoeschen,
  zeilenMarkup,
  type Lauf,
} from './formatierung';

const F = { ...OHNE_STIL, fett: true };
const K = { ...OHNE_STIL, kursiv: true };
const U = { ...OHNE_STIL, unterstrichen: true };
const t = (text: string, stil = OHNE_STIL): Lauf => ({ art: 'text', text, ...stil });
const p = (name: PlatzhalterName, stil = OHNE_STIL): Lauf => ({ art: 'platzhalter', name, ...stil });

describe('Markup lesen', () => {
  it('Text ohne Tags bleibt ein Textlauf, Platzhalter wie zerlegen', () => {
    expect(parsen('Hallo {kunde}, {unbekannt}!')).toEqual([t('Hallo '), p('kunde'), t(', {unbekannt}!')]);
    expect(parsen('')).toEqual([]);
  });

  it('b, i, u und Verschachtelung', () => {
    expect(parsen('a<b>b<i>c</i></b><u>d</u>')).toEqual([t('a'), t('b', F), t('c', { ...F, kursiv: true }), t('d', U)]);
    // überlappend ist erlaubt (jede Art für sich)
    expect(parsen('<b>a<i>b</b>c</i>')).toEqual([t('a', F), t('b', { ...F, kursiv: true }), t('c', K)]);
    expect(parsen('<b><b>x</b></b>')).toEqual([t('x', F)]);
  });

  it('unausgeglichene und unbekannte Tags bleiben Text, nie ein Fehler', () => {
    expect(parsen('a <b> b')).toEqual([t('a <b> b')]);
    expect(parsen('a </i> b')).toEqual([t('a </i> b')]);
    expect(parsen('<b>a<b>b</b>')).toEqual([t('<b>a'), t('b', F)]);
    expect(parsen('<B>x</B> <strong>y</strong> <b class="x">z</b> <br>')).toEqual([t('<B>x</B> <strong>y</strong> <b class="x">z</b> <br>')]);
    expect(parsen('x < y > z')).toEqual([t('x < y > z')]);
  });

  it('Platzhalter mit Formatierung; über Tags hinweg ist es kein Platzhalter', () => {
    expect(parsen('<b>{kunde}</b>')).toEqual([p('kunde', F)]);
    expect(parsen('{<b>kunde</b>}')).toEqual([t('{'), t('kunde', F), t('}')]);
  });
});

describe('Markup schreiben (feste Form)', () => {
  it('Texte ohne Tags bleiben unverändert', () => {
    for (const s of ['', 'Hallo {kunde}', 'Mit freundlichen Grüßen\n{inhaber}', 'a <b> b', '50 % & "x" {unbekannt}', '  Rand  \n\n'])
      expect(normalisieren(s)).toBe(s);
  });

  it('leere Tags fallen weg, Nachbarn verschmelzen, neue Tags in der Reihenfolge b › i › u', () => {
    expect(normalisieren('a<b></b>b')).toBe('ab');
    expect(normalisieren('<b>a</b><b>b</b>')).toBe('<b>ab</b>');
    expect(normalisieren('<u><i><b>x</b></i></u>')).toBe('<b><i><u>x</u></i></b>');
    expect(normalisieren('<b>a</b><b><i>b</i></b>')).toBe('<b>a<i>b</i></b>');
    // offene Tags bleiben offen, wenn es passt (kürzeste Form)
    expect(normalisieren('<i>a</i><b><i>b</i></b>')).toBe('<i>a<b>b</b></i>');
    expect(normalisieren('<b>{kunde}</b><b> & Co</b>')).toBe('<b>{kunde} & Co</b>');
  });

  it('Zeilenumbrüche stehen außerhalb der Tags (jede Zeile vollständig)', () => {
    expect(normalisieren('<b>a\nb</b>')).toBe('<b>a</b>\n<b>b</b>');
    expect(zeilenMarkup('<b>a\r\nb</b>\nc')).toEqual(['<b>a</b>', '<b>b</b>', 'c']);
  });

  it('Rundreise: lesen ∘ schreiben ist stabil (auch bei wirrem Markup)', () => {
    const faelle = [
      '<b>a<i>b</b>c</i>',
      '<b>a<b>b</b>',
      '</b><b>x</b></b>',
      '<i><b>{nr}</b></i> {datum}',
      '<u>a\n\n<b>b</b></u>',
      'x <b> y </i> <u>z</u> <i>',
    ];
    for (const s of faelle) {
      const n = normalisieren(s);
      expect(normalisieren(n), s).toBe(n);
      expect(klartext(n), s).toBe(klartext(s));
    }
    // zufällige Folgen aus Tags, Text und Platzhaltern
    const stuecke = ['<b>', '</b>', '<i>', '</i>', '<u>', '</u>', 'a', ' ', '\n', '{kunde}', '{x}', '<', '>'];
    let saat = 7;
    const zufall = () => (saat = (saat * 1103515245 + 12345) % 2147483648) % stuecke.length;
    for (let n = 0; n < 500; n++) {
      const s = Array.from({ length: 12 }, () => stuecke[zufall()]).join('');
      const a = normalisieren(s);
      expect(normalisieren(a), s).toBe(a);
      expect(klartext(a), s).toBe(klartext(s));
      expect(serialisieren(parsen(a)), s).toBe(a);
    }
  });

  it('Klartext ohne Tags, Platzhalter als {name}; hatFormatierung', () => {
    expect(klartext('<b>Umsatzsteuerfrei</b> gemäß <u>§ 19</u> UStG, {kunde}')).toBe('Umsatzsteuerfrei gemäß § 19 UStG, {kunde}');
    expect(hatFormatierung('a <b> b')).toBe(false);
    expect(hatFormatierung('<i>x</i>')).toBe(true);
  });
});

describe('Rechnen mit Stellen (Editor)', () => {
  const L = parsen('ab<b>cd</b>{kunde}\nef');

  it('Länge: Platzhalter und Umbruch zählen je 1', () => {
    expect(laenge(L)).toBe(8);
  });

  it('Stil an der Schreibmarke: Zeichen davor, am Zeilenanfang das danach', () => {
    expect(stilBei(L, 3).fett).toBe(true);
    expect(stilBei(L, 2).fett).toBe(false);
    expect(stilBei(L, 0).fett).toBe(false);
    expect(stilBei(parsen('<i>x</i>'), 0).kursiv).toBe(true);
    expect(stilBei(L, 6)).toEqual(OHNE_STIL); // nach dem Umbruch: e
  });

  it('formatieren und hatStil (Umbrüche zählen nicht)', () => {
    const f = formatieren(L, 0, 4, 'fett', true);
    expect(serialisieren(f)).toBe('<b>abcd</b>{kunde}\nef');
    expect(hatStil(f, 0, 4, 'fett')).toBe(true);
    expect(hatStil(f, 0, 5, 'fett')).toBe(false);
    const u = formatieren(f, 2, 8, 'unterstrichen', true);
    expect(serialisieren(u)).toBe('<b>ab<u>cd</u></b><u>{kunde}</u>\n<u>ef</u>');
    expect(hatStil(u, 2, 8, 'unterstrichen')).toBe(true);
    expect(serialisieren(formatieren(u, 0, 8, 'fett', false))).toBe('ab<u>cd{kunde}</u>\n<u>ef</u>');
  });

  it('einfügen, ersetzen, löschen (Platzhalter als Ganzes, Emoji als Paar)', () => {
    expect(serialisieren(bereichErsetzen(L, 2, 2, textLaeufe('X', F)))).toBe('ab<b>Xcd</b>{kunde}\nef');
    expect(serialisieren(bereichErsetzen(L, 1, 5, []))).toBe('a\nef');
    expect(serialisieren(bereichErsetzen(L, 8, 8, [p('nr')]))).toBe('ab<b>cd</b>{kunde}\nef{nr}');
    const weg = zeichenLoeschen(L, 5, -1);
    expect(serialisieren(weg.laeufe)).toBe('ab<b>cd</b>\nef');
    expect(weg.stelle).toBe(4);
    expect(zeichenLoeschen(L, 0, -1)).toEqual({ laeufe: L, stelle: 0 });
    expect(serialisieren(zeichenLoeschen(L, 4, 1).laeufe)).toBe('ab<b>cd</b>\nef');
    const emoji = parsen('a😀b');
    expect(serialisieren(zeichenLoeschen(emoji, 3, -1).laeufe)).toBe('ab');
    expect(serialisieren(zeichenLoeschen(emoji, 1, 1).laeufe)).toBe('ab');
  });

  it('getippte {namen} werden Platzhalter, Stellen werden umgerechnet', () => {
    const r = platzhalterErkennen([t('Hallo {ku'), t('nde}!')], [0, 8, 13, 14]);
    expect(r.laeufe).toEqual([t('Hallo '), p('kunde'), t('!')]);
    expect(r.stellen).toEqual([0, 7, 7, 8]);
    expect(r.geaendert).toBe(true);
    expect(platzhalterErkennen([t('ohne')], [2]).geaendert).toBe(false);
  });

  it('trimmen über Läufe hinweg', () => {
    expect(serialisieren(trimmen(parsen('<b>  Tel. </b>{telefon} '))) ).toBe('<b>Tel. </b>{telefon}');
    expect(trimmen(parsen(' <i> </i> '))).toEqual([]);
  });
});

describe('Vorschau: Platzhalter ersetzen mit Formatierung (ohne HTML)', () => {
  const doc = testbeleg('rechnung', BEISPIEL_FIRMA, 'klein', '2026-10-18');
  const werte = platzhalterWerte(doc);

  it('Formatierung aus der Vorlage, Werte bleiben Text (auch mit <b>)', () => {
    const w = { ...werte, kunde: '<b>Müller</b> & Co' };
    expect(ersetzteZeilen('Hallo <b>{kunde}</b>!', w)).toEqual([
      [
        { text: 'Hallo ', entwurf: false, ...OHNE_STIL },
        { text: '<b>Müller</b> & Co', entwurf: false, ...F },
        { text: '!', entwurf: false, ...OHNE_STIL },
      ],
    ]);
  });

  it('Zeilen, Ränder wie ersetzen, leere Ergebnisse ⇒ null, fehlende Nummer ⇒ Entwurf', () => {
    expect(ersetzteZeilen('\n<i>a \nb</i>\n\n', werte)).toEqual([
      [{ text: 'a', entwurf: false, ...K }],
      [{ text: 'b', entwurf: false, ...K }],
    ]);
    expect(ersetzteZeilen('<b>{schlusstext}</b>', { ...werte, schlusstext: '' })).toBeNull();
    expect(ersetzteZeilen('<b> </b>', werte)).toBeNull();
    expect(ersetzteZeilen('Nr. <u>{nr}</u>', { ...werte, nr: '' })).toEqual([
      [
        { text: 'Nr. ', entwurf: false, ...OHNE_STIL },
        { text: 'Entwurf', entwurf: true, ...U },
      ],
    ]);
  });

  it('Werte mit Zeilenumbrüchen werden Zeilen', () => {
    const z = ersetzteZeilen('<b>{einleitung}</b>', { ...werte, einleitung: 'eins\r\nzwei' });
    expect(z?.map((zeile) => zeile.map((s) => s.text).join(''))).toEqual(['eins', 'zwei']);
    expect(z?.[1][0].fett).toBe(true);
  });
});
