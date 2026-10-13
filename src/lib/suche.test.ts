import { describe, expect, it } from 'vitest';
import { gruppiere, normalize, normalizeWithMap, parseAnfrage, suche, teile, type SuchEintrag } from './suche';

const E = (id: string, label: string, extra: Partial<SuchEintrag> = {}): SuchEintrag => ({
  id,
  label,
  art: 'einstellung',
  gruppe: 'Einstellungen',
  ...extra,
});

const LISTE: SuchEintrag[] = [
  E('schrift', 'Schriftgröße'),
  E('akzent', 'Akzentfarbe', { keywords: ['Farbe', 'Accent'] }),
  E('theme', 'Farbthema', { keywords: ['Theme', 'Preset'] }),
  E('modus', 'Hell/Dunkel', { keywords: ['Modus', 'Dark Mode'] }),
  E('auto', 'Automatisch nach Updates suchen'),
  E('suchen', 'Nach Updates suchen', { art: 'befehl', gruppe: 'Befehle' }),
  E('ein', 'Ein- & Ausgänge', { art: 'seite', gruppe: 'Seiten' }),
  E('liq', 'Liquidität', { art: 'seite', gruppe: 'Seiten', sub: 'Auswertung' }),
];

const ids = (q: string) => suche(LISTE, q).map((t) => t.eintrag.id);

describe('normalize', () => {
  it('ignoriert Groß/klein und Umlaute/Akzente', () => {
    expect(normalize('Schriftgröße')).toBe('schriftgrosse');
    expect(normalize('ÄÖÜ äöü Café')).toBe('aou aou cafe');
  });
  it('merkt sich die Originalpositionen (auch bei ß → ss)', () => {
    const { text, map } = normalizeWithMap('Größe');
    expect(text).toBe('grosse');
    expect(map).toEqual([0, 1, 2, 3, 3, 4, 5]);
  });
});

describe('parseAnfrage', () => {
  it('erkennt „>“ für Befehle und zerlegt in Wörter', () => {
    expect(parseAnfrage('> Nach  Updates')).toEqual({ nurBefehle: true, woerter: ['nach', 'updates'] });
    expect(parseAnfrage('  Größe')).toEqual({ nurBefehle: false, woerter: ['grosse'] });
  });
});

describe('suche', () => {
  it('findet unabhängig von Umlauten und Groß/klein', () => {
    expect(ids('schriftgrosse')).toEqual(['schrift']);
    expect(ids('GRÖSSE')).toEqual(['schrift']);
    expect(ids('liquiditat')).toEqual(['liq']);
    expect(ids('ausgange')).toEqual(['ein']);
  });
  it('sucht auch in Stichwörtern und Untertitel', () => {
    expect(ids('theme')).toEqual(['theme']);
    expect(ids('dark')).toEqual(['modus']);
    expect(ids('auswertung')).toEqual(['liq']);
  });
  it('verlangt alle Wörter', () => {
    expect(ids('updates automatisch')).toEqual(['auto']);
    expect(ids('updates xyz')).toEqual([]);
  });
  it('bewertet Anfang vor Wortanfang vor Teilstück und Label vor Stichwort', () => {
    // „farb“: Farbthema (Anfang) vor Akzentfarbe (Teilstück im Label)
    expect(ids('farb')).toEqual(['theme', 'akzent']);
    // Exakter Treffer schlägt längere Labels
    expect(ids('nach updates suchen')[0]).toBe('suchen');
  });
  it('liefert bei „>“ nur Befehle', () => {
    expect(ids('>updates')).toEqual(['suchen']);
    expect(ids('>')).toEqual(['suchen']);
  });
  it('liefert bei leerer Anfrage alles in Originalreihenfolge', () => {
    expect(ids('')).toEqual(LISTE.map((e) => e.id));
  });
  it('markiert Treffer im Originallabel', () => {
    const [t] = suche(LISTE, 'grosse');
    expect(teile(t.eintrag.label, t.marks)).toEqual([
      { text: 'Schrift', mark: false },
      { text: 'größe', mark: true },
    ]);
  });
});

describe('gruppiere', () => {
  it('bündelt nach Gruppe in Reihenfolge des besten Treffers', () => {
    const g = gruppiere(suche(LISTE, 'updates'));
    expect(g.map((x) => x.gruppe)).toEqual(['Befehle', 'Einstellungen']);
  });
});
