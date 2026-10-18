/* LaTeX-Escaping für alle Nutzerwerte (ANLEITUNG §7.1, CLAUDE.md „LaTeX: Nutzerwerte immer über lib/latex/escape.ts“).
 * - `\` → `\textbackslash{}`, `& % $ # _ { }` → mit `\` davor, `~` → `\textasciitilde{}`, `^` → `\textasciicircum{}`.
 * - `"` → `\textquotedbl{}`: mit babel/ngerman ist `"` ein aktives Kürzel („"a“ = ä), das Nutzertext nie auslösen darf.
 * - TeX-Ligaturen aus Satzzeichen („--“, „,,“, „<<“ …) werden mit `{}` getrennt, damit genau der eingegebene Text erscheint.
 * - Zeilenumbrüche (z. B. in Adressen) ⇒ `\\{}` (das `{}` schützt davor, dass ein folgendes `[` oder `*` als Argument von
 *   `\\` gelesen wird); Leerzeilen am Anfang und Ende entfallen, `einzeilig` macht aus Umbrüchen Leerzeichen.
 * - Steuerzeichen werden entfernt, Tabulatoren zu Leerzeichen.
 * Beträge formatiert `betragLatex` fertig (`1.234,50\,€`). Tests: escape.test.ts */
import { formatBetrag } from '../money';

export interface EscapeOptionen {
  /** Zeilenumbruch: `\\{}` (Standard), `\newline{}` (in Tabellenzellen und Spalten, wo `\\` die Zeile beenden würde)
   * oder ein Leerzeichen (`einzeilig`). */
  umbruch?: 'zeile' | 'newline' | 'einzeilig';
}

const ZEICHEN: Readonly<Record<string, string>> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '"': '\\textquotedbl{}',
};

/** Zeichen, die mit dem Folgezeichen eine TeX-Ligatur bilden können (Ligatures=TeX: -- --- ,, << >> `` '' !` ?`). */
const LIGATUR = new Set(['-', ',', '<', '>', '`', "'", '!', '?']);
const LIGATUR_FOLGE = new Set(['-', ',', '<', '>', '`', "'"]);

/** Ein Textstück ohne Umbrüche escapen, ohne zu trimmen (für Texte aus Baustein-Einstellungen zwischen Platzhaltern). */
export function escapeStueck(stueck: string): string {
  return zeileEscapen(stueck.replace(/[\n\r\t]/g, ' ').replace(/[\u0000-\u001f\u007f\ufffd]/g, ''));
}

/** Eine Zeile (ohne Umbrüche) escapen. */
function zeileEscapen(zeile: string): string {
  let out = '';
  const z = [...zeile];
  for (let i = 0; i < z.length; i++) {
    const c = z[i];
    out += ZEICHEN[c] ?? c;
    if (LIGATUR.has(c) && i + 1 < z.length && LIGATUR_FOLGE.has(z[i + 1])) out += '{}';
  }
  return out;
}

/** Nutzerwert ⇒ sicherer LaTeX-Text. */
export function escapeLatex(wert: string | null | undefined, optionen: EscapeOptionen = {}): string {
  const umbruch = optionen.umbruch ?? 'zeile';
  const text = String(wert ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    // Steuerzeichen (außer Zeilenumbruch) und das Unicode-Ersatzzeichen haben in einem Beleg nichts zu suchen
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\ufffd]/g, '');
  const zeilen = text.split('\n').map((z) => z.replace(/[ \u00a0]+$/, ''));
  while (zeilen.length && !zeilen[0].trim()) zeilen.shift();
  while (zeilen.length && !zeilen[zeilen.length - 1].trim()) zeilen.pop();
  const trenner = umbruch === 'einzeilig' ? ' ' : umbruch === 'newline' ? '\\newline{}' : '\\\\{}';
  return zeilen.map(zeileEscapen).join(trenner);
}

/** Betrag in Cent ⇒ `1.234,50\,€` (echtes Minus bei negativen Beträgen). Enthält nur Ziffern, Punkt, Komma und −. */
export function betragLatex(cent: number): string {
  return `${formatBetrag(cent, { waehrung: false })}\\,€`;
}
