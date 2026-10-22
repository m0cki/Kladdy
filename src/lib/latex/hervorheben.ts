/* Einfache Hervorhebung für die Experten-Ansicht „LaTeX“ der Vorlagen-Seite (ANLEITUNG §7.0; Prototyp hiLatex()).
 * Zerlegt main.tex in Teile: Kommentar (% bis Zeilenende), Befehl (\name oder \ + ein Zeichen, z. B. \% oder \\),
 * Klammer ({ } [ ]) und übrigen Text. Die Seite rendert die Teile als Text-Knoten (kein innerHTML).
 * Ein maskiertes \% ist ein Befehl, kein Kommentar. Tests: hervorheben.test.ts */

export type TexTeilArt = 'kommentar' | 'befehl' | 'klammer' | 'text';

export interface TexTeil {
  art: TexTeilArt;
  text: string;
}

const MUSTER = /%[^\n]*|\\(?:[A-Za-z@]+|[^A-Za-z@])|[{}[\]]/g;

export function texTeile(src: string): TexTeil[] {
  const teile: TexTeil[] = [];
  let pos = 0;
  for (const m of src.matchAll(MUSTER)) {
    const i = m.index ?? pos;
    if (i > pos) teile.push({ art: 'text', text: src.slice(pos, i) });
    const t = m[0];
    teile.push({ art: t.startsWith('%') ? 'kommentar' : t.startsWith('\\') ? 'befehl' : 'klammer', text: t });
    pos = i + t.length;
  }
  if (pos < src.length) teile.push({ art: 'text', text: src.slice(pos) });
  return teile;
}
