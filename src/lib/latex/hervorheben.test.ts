import { describe, expect, it } from 'vitest';
import { BELEGARTEN } from '../vorlagen/dokument';
import { standardVorlage } from '../vorlagen/standard';
import { texTeile } from './hervorheben';
import { mainTex } from './vorlage';

describe('texTeile', () => {
  it('Befehle, Klammern, Kommentare und Text', () => {
    expect(texTeile(String.raw`\textbf{Hallo} % Gruß`)).toEqual([
      { art: 'befehl', text: String.raw`\textbf` },
      { art: 'klammer', text: '{' },
      { art: 'text', text: 'Hallo' },
      { art: 'klammer', text: '}' },
      { art: 'text', text: ' ' },
      { art: 'kommentar', text: '% Gruß' },
    ]);
  });
  it('\\% ist kein Kommentar, \\\\ ist ein Befehl', () => {
    expect(texTeile(String.raw`50\,\% Rabatt\\`)).toEqual([
      { art: 'text', text: '50' },
      { art: 'befehl', text: String.raw`\,` },
      { art: 'befehl', text: String.raw`\%` },
      { art: 'text', text: ' Rabatt' },
      { art: 'befehl', text: String.raw`\\` },
    ]);
  });
  it('Kommentar endet an der Zeile, optionale Argumente sind Klammern', () => {
    expect(texTeile('% eins\n\\usepackage[ngerman]{babel}').map((t) => t.art)).toEqual([
      'kommentar',
      'text',
      'befehl',
      'klammer',
      'text',
      'klammer',
      'klammer',
      'text',
      'klammer',
    ]);
  });
  it('verliert kein Zeichen (alle Standardvorlagen)', () => {
    for (const art of BELEGARTEN) {
      const { tex } = mainTex(art, standardVorlage(art), '#6366f1');
      expect(
        texTeile(tex)
          .map((t) => t.text)
          .join(''),
      ).toBe(tex);
    }
    expect(texTeile('')).toEqual([]);
    expect(texTeile('ende\\')).toEqual([{ art: 'text', text: 'ende\\' }]);
  });
});
