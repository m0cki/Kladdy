/* Suche/Befehlspalette (§6.2) – reine Logik: Normalisieren, Treffer bewerten, sortieren, begrenzen, markieren.
 * Quellen: Seiten, Einstellungen, Befehle (components/shell/Suche.tsx) und Daten (Ein- & Ausgänge, Belege, Termine,
 * Kunden, Kennzahlen aus lib/suche-daten.ts) – alles SuchEintraege mit eigener `gruppe`. Mit `>` am Anfang zählen nur
 * Einträge der Art 'befehl'. Einträge gelten als unveränderlich: ihre normalisierten Texte werden je Objekt gemerkt
 * (WeakMap), damit Tippen bei ~1000 Einträgen nichts neu rechnet. Mit Vitest getestet (suche.test.ts). */

export type SuchArt = 'seite' | 'einstellung' | 'befehl' | 'daten';

export interface SuchEintrag {
  id: string;
  art: SuchArt;
  /** Überschrift der Gruppe im Dropdown, z. B. „Seiten“ */
  gruppe: string;
  label: string;
  sub?: string;
  keywords?: readonly string[];
}

export interface Treffer<T extends SuchEintrag = SuchEintrag> {
  eintrag: T;
  score: number;
  /** Markierte Bereiche im Label (Start/Ende im Original, Ende exklusiv) */
  marks: [number, number][];
}

export interface Anfrage {
  /** nur Befehle (Eingabe begann mit „>“) */
  nurBefehle: boolean;
  /** normalisierte Suchwörter */
  woerter: string[];
}

/** Ein Zeichen vereinfachen: klein, ohne Akzente (ä→a, é→e), ß→ss. */
function foldChar(ch: string): string {
  const c = ch.charCodeAt(0);
  if (c < 128) return c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : ch; // ASCII: schneller Weg
  if (ch === 'ß' || ch === 'ẞ') return 'ss';
  return ch
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Text vereinfachen und zu jeder Stelle im Ergebnis die Stelle im Original merken. */
export function normalizeWithMap(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) map.push(i);
    text += f;
    i += ch.length;
  }
  map.push(i); // Endposition
  return { text, map };
}

/** Groß/klein und Akzente egal: „Schriftgröße“ → „schriftgrosse“. */
export const normalize = (s: string): string => normalizeWithMap(s).text;

/** Ein Betrag mit Dezimalkomma („49,90“, „1.234,5“) bleibt ein Wort; sonst trennt das Komma. */
const BETRAG_WORT = /^\d[\d.]*,\d{1,2}$/;

export function parseAnfrage(raw: string): Anfrage {
  const t = raw.trimStart();
  const nurBefehle = t.startsWith('>');
  const rest = nurBefehle ? t.slice(1) : t;
  const woerter = normalize(rest)
    .split(/[\s·/]+/)
    .flatMap((w) => (BETRAG_WORT.test(w) ? [w] : w.split(',')))
    .filter(Boolean);
  return { nurBefehle, woerter };
}

interface Vorbereitet {
  label: { text: string; map: number[] };
  sub: string;
  keywords: string[];
}

const vorbereitetCache = new WeakMap<SuchEintrag, Vorbereitet>();

/** Normalisierte Texte eines Eintrags (einmal je Objekt). */
function vorbereitet(e: SuchEintrag): Vorbereitet {
  let v = vorbereitetCache.get(e);
  if (!v) {
    v = { label: normalizeWithMap(e.label), sub: e.sub ? normalize(e.sub) : '', keywords: (e.keywords ?? []).map(normalize) };
    vorbereitetCache.set(e, v);
  }
  return v;
}

const isWordStart = (text: string, at: number) => at === 0 || /[^a-z0-9]/.test(text[at - 1]);

/** Bestes Vorkommen eines Wortes in einem (normalisierten) Text: [Punkte, Position] oder null. */
function bestIn(text: string, wort: string): [number, number] | null {
  if (text === wort) return [100, 0];
  if (text.startsWith(wort)) return [80, 0];
  let pos = text.indexOf(wort);
  const firstPos = pos;
  while (pos > 0) {
    if (isWordStart(text, pos)) return [60, pos];
    pos = text.indexOf(wort, pos + 1);
  }
  return firstPos >= 0 ? [35, firstPos] : null;
}

/** Bewertung eines Eintrags; null = passt nicht (jedes Wort muss im Label, Untertitel oder in den Stichwörtern vorkommen). */
export function bewerte<T extends SuchEintrag>(eintrag: T, anfrage: Anfrage): Treffer<T> | null {
  if (anfrage.nurBefehle && eintrag.art !== 'befehl') return null;
  if (anfrage.woerter.length === 0) return { eintrag, score: 0, marks: [] };
  const { label, keywords, sub } = vorbereitet(eintrag);
  let score = 0;
  const marks: [number, number][] = [];
  for (const w of anfrage.woerter) {
    const inLabel = bestIn(label.text, w);
    if (inLabel) {
      score += inLabel[0];
      marks.push([label.map[inLabel[1]], label.map[inLabel[1] + w.length]]);
      continue;
    }
    let best = 0;
    for (const k of keywords) {
      const hit = bestIn(k, w);
      if (hit) best = Math.max(best, hit[0] === 100 ? 50 : hit[0] >= 60 ? 30 : 15);
    }
    if (!best && sub) {
      const hit = bestIn(sub, w);
      if (hit) best = hit[0] >= 60 ? 20 : 10;
    }
    if (!best) return null;
    score += best;
  }
  return { eintrag, score, marks: mergeMarks(marks) };
}

function mergeMarks(marks: [number, number][]): [number, number][] {
  const sorted = [...marks].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else out.push([m[0], m[1]]);
  }
  return out;
}

/** Alle passenden Einträge, beste zuerst. Bei Gleichstand: kürzeres Label, dann ursprüngliche Reihenfolge – zwischen
 *  zwei Daten-Einträgen (art 'daten') nur die ursprüngliche Reihenfolge, die Quellen liefern neueste zuerst. */
export function suche<T extends SuchEintrag>(eintraege: readonly T[], raw: string, limit = 30): Treffer<T>[] {
  const anfrage = parseAnfrage(raw);
  const treffer: { t: Treffer<T>; i: number }[] = [];
  eintraege.forEach((e, i) => {
    const t = bewerte(e, anfrage);
    if (t) treffer.push({ t, i });
  });
  if (anfrage.woerter.length > 0) {
    const laenge = (a: T, b: T) => (a.art === 'daten' && b.art === 'daten' ? 0 : a.label.length - b.label.length);
    treffer.sort((a, b) => b.t.score - a.t.score || laenge(a.t.eintrag, b.t.eintrag) || a.i - b.i);
  }
  return treffer.slice(0, limit).map((x) => x.t);
}

/** Höchstens `limits[gruppe]` Treffer je Gruppe (Gruppen ohne Eintrag unbegrenzt), insgesamt höchstens `gesamt`.
 *  Die Reihenfolge bleibt erhalten. */
export function begrenze<T extends SuchEintrag>(
  treffer: readonly Treffer<T>[],
  limits: Readonly<Record<string, number>>,
  gesamt = Infinity,
): Treffer<T>[] {
  const zaehler = new Map<string, number>();
  const out: Treffer<T>[] = [];
  for (const t of treffer) {
    if (out.length >= gesamt) break;
    const g = t.eintrag.gruppe;
    const n = zaehler.get(g) ?? 0;
    if (n >= (limits[g] ?? Infinity)) continue;
    zaehler.set(g, n + 1);
    out.push(t);
  }
  return out;
}

/** Markierte Bereiche eines beliebigen Textes (z. B. Untertitel) für die Wörter einer Eingabe. */
export function markiere(text: string, raw: string): [number, number][] {
  const { woerter } = parseAnfrage(raw);
  if (!woerter.length || !text) return [];
  const n = normalizeWithMap(text);
  const marks: [number, number][] = [];
  for (const w of woerter) {
    const hit = bestIn(n.text, w);
    if (hit) marks.push([n.map[hit[1]], n.map[hit[1] + w.length]]);
  }
  return mergeMarks(marks);
}

/** Treffer nach Gruppe bündeln; Gruppen in der Reihenfolge ihres besten Treffers. */
export function gruppiere<T extends SuchEintrag>(treffer: readonly Treffer<T>[]): { gruppe: string; treffer: Treffer<T>[] }[] {
  const map = new Map<string, Treffer<T>[]>();
  for (const t of treffer) {
    const g = map.get(t.eintrag.gruppe);
    if (g) g.push(t);
    else map.set(t.eintrag.gruppe, [t]);
  }
  return [...map].map(([gruppe, list]) => ({ gruppe, treffer: list }));
}

/** Label in Stücke zerlegen: markiert/unmarkiert (für <mark>). */
export function teile(label: string, marks: readonly [number, number][]): { text: string; mark: boolean }[] {
  const out: { text: string; mark: boolean }[] = [];
  let pos = 0;
  for (const [a, b] of marks) {
    if (a > pos) out.push({ text: label.slice(pos, a), mark: false });
    if (b > a) out.push({ text: label.slice(a, b), mark: true });
    pos = Math.max(pos, b);
  }
  if (pos < label.length) out.push({ text: label.slice(pos), mark: false });
  return out;
}
