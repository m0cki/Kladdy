import { describe, expect, it } from 'vitest';
import { domStelle, elementStil, istKanonisch, lesen, type Knoten } from './editordom';
import { OHNE_STIL, laenge, serialisieren } from './formatierung';

/* Nachgebaute DOM-Bäume (Vitest läuft ohne Browser): dieselben Eigenschaften, die echte Knoten haben. */
type Stil = NonNullable<Knoten['style']>;
const txt = (v: string): Knoten => ({ nodeType: 3, nodeName: '#text', nodeValue: v, childNodes: [] });
const el = (name: string, kinder: Knoten[] = [], attr: Record<string, string> = {}, style?: Stil): Knoten => ({
  nodeType: 1,
  nodeName: name.toUpperCase(),
  nodeValue: null,
  childNodes: kinder,
  getAttribute: (n: string) => attr[n] ?? null,
  style: style ?? {},
});
const chip = (name: string) => el('span', [txt(`{${name}}`)], { 'data-ph': name, contenteditable: 'false' });
const root = (...kinder: Knoten[]) => el('div', kinder);
const markup = (r: Knoten) => serialisieren(lesen(r).laeufe);

describe('Editor-DOM lesen', () => {
  it('eigener Aufbau: Text, b/i/u, Chips, br, Null-Breite-Zeichen hinter Chips', () => {
    const r = root(txt('ab'), el('b', [txt('cd'), el('i', [txt('e')])]), chip('kunde'), txt('​'), el('br'), el('u', [txt('f')]));
    expect(markup(r)).toBe('ab<b>cd<i>e</i></b>{kunde}\n<u>f</u>');
  });

  it('was WebKit erzeugt: strong/em/ins, Stil-spans, Aufheben per font-weight: normal', () => {
    const r = root(
      el('strong', [txt('a')]),
      el('em', [txt('b')]),
      el('ins', [txt('c')]),
      el('span', [txt('d')], { style: 'font-weight: bold' }, { fontWeight: 'bold' }),
      el('span', [txt('e')], {}, { fontWeight: '700', fontStyle: 'italic' }),
      el('span', [txt('f')], {}, { textDecorationLine: 'underline' }),
      el('b', [txt('g'), el('span', [txt('h')], {}, { fontWeight: 'normal' })]),
      el('font', [txt('i')]),
    );
    expect(markup(r)).toBe('<b>a</b><i>b</i><u>c</u><b>d<i>e</i></b><u>f</u><b>g</b>hi');
    expect(elementStil(el('span', [], {}, { fontWeight: '400' }), { ...OHNE_STIL, fett: true }).fett).toBe(false);
    expect(elementStil(el('span', [], {}, { textDecoration: 'none' }), { ...OHNE_STIL, unterstrichen: true }).unterstrichen).toBe(false);
  });

  it('Blöcke und br wie im Browser: div/p = Zeile, br am Blockende nur Platzhalter', () => {
    expect(markup(root(txt('a'), el('div', [txt('b')]), el('div', [el('br')]), el('div', [txt('c')])))).toBe('a\nb\n\nc');
    expect(markup(root(el('div', [txt('a')]), el('div', [el('br')])))).toBe('a\n');
    expect(markup(root(el('div', [el('br')]), el('div', [txt('b')])))).toBe('\nb');
    expect(markup(root(txt('a'), el('br')))).toBe('a');
    expect(markup(root(txt('a'), el('br'), el('br')))).toBe('a\n');
    expect(markup(root(el('b', [txt('a'), el('br')])))).toBe('<b>a</b>');
    expect(markup(root(el('b', [txt('a'), el('br')]), txt('b')))).toBe('<b>a</b>\nb');
    expect(markup(root(el('p', [txt('a')]), el('p', [txt('b')])))).toBe('a\nb');
    expect(markup(root(el('div', [txt('a')]), txt('b')))).toBe('a\nb');
  });

  it('nicht Bearbeitbares ohne Platzhalter, Skripte und unbekannte Chips fallen weg', () => {
    const r = root(txt('a'), el('span', [txt('x')], { contenteditable: 'false' }), el('script', [txt('alert(1)')]), el('span', [txt('{foo}')], { 'data-ph': 'foo' }), txt('b'));
    // data-ph mit unbekanntem Namen ist ein normales span: sein Text bleibt
    expect(markup(r)).toBe('a{foo}b');
  });

  it('getippte {namen} werden Platzhalter (umgewandelt)', () => {
    const g = lesen(root(txt('Hallo {kun'), txt('de}')));
    expect(serialisieren(g.laeufe)).toBe('Hallo {kunde}');
    expect(g.umgewandelt).toBe(true);
    expect(lesen(root(txt('Hallo'))).umgewandelt).toBe(false);
  });
});

describe('Stellen ⇄ DOM', () => {
  it('Stellen in Text, an Elementgrenzen, in Chips und ohne Null-Breite-Zeichen', () => {
    const a = txt('ab');
    const c = chip('kunde');
    const z = txt('​');
    const b = el('b', [txt('cd')]);
    const r = root(a, b, c, z, el('br'), txt('ef'));
    const g = lesen(r, [
      { knoten: a, offset: 1 },
      { knoten: r, offset: 1 }, // vor <b>
      { knoten: c.childNodes[0], offset: 2 }, // im Chip ⇒ dahinter
      { knoten: z, offset: 1 }, // hinter dem Null-Breite-Zeichen
      { knoten: r, offset: 6 }, // ganz am Ende
      { knoten: txt('fremd'), offset: 0 },
    ]);
    expect(g.stellen).toEqual([1, 2, 5, 5, 8, null]);
  });

  it('domStelle ist die Umkehrung von lesen (jede Stelle, eigener Aufbau)', () => {
    const r = root(
      txt('ab'),
      el('b', [txt('cd'), el('i', [txt('e')])]),
      chip('kunde'),
      txt('​'),
      el('br'),
      el('br'),
      chip('nr'),
      el('u', [txt('fg')]),
      el('br'),
      el('br'),
    );
    const n = laenge(lesen(r).laeufe);
    expect(n).toBe(12);
    for (let i = 0; i <= n; i++) expect(lesen(r, [domStelle(r, i)]).stellen[0], `Stelle ${i}`).toBe(i);
  });

  it('Grenzen: Ende des Textes davor gewinnt, nach einem Umbruch der Zeilenanfang', () => {
    const a = txt('ab');
    const fett = txt('cd');
    const nach = txt('ef');
    const r = root(a, el('b', [fett]), el('br'), nach);
    expect(domStelle(r, 2)).toEqual({ knoten: a, offset: 2 });
    expect(domStelle(r, 4)).toEqual({ knoten: fett, offset: 2 });
    expect(domStelle(r, 5)).toEqual({ knoten: nach, offset: 0 });
    // Chip am Zeilenanfang: vor dem Chip
    const r2 = root(chip('kunde'), txt('x'));
    expect(domStelle(r2, 0)).toEqual({ knoten: r2, offset: 0 });
    // Null-Breite-Zeichen hinter einem Chip: Marke dahinter
    const z = txt('​');
    const r3 = root(chip('kunde'), z);
    expect(domStelle(r3, 1)).toEqual({ knoten: z, offset: 1 });
  });

  it('istKanonisch: nur Text, b/i/u ohne Stil, br und Chips', () => {
    expect(istKanonisch(root(txt('a'), el('b', [el('i', [txt('b')])]), el('br'), chip('nr')))).toBe(true);
    expect(istKanonisch(root(el('span', [txt('a')], { style: 'font-weight: bold' })))).toBe(false);
    expect(istKanonisch(root(el('div', [txt('a')])))).toBe(false);
    expect(istKanonisch(root(el('b', [txt('a')], { style: 'color: red' })))).toBe(false);
  });
});
