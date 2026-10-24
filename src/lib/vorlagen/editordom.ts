/* DOM des Format-Editors (components/belege/FormatEditor.tsx) ⇄ Läufe (formatierung.ts), ohne echte DOM-Abhängigkeit:
 * gearbeitet wird über die schmale Schnittstelle `Knoten`, die echte DOM-Knoten erfüllen (Tests mit nachgebauten Bäumen).
 *
 * Lesen nimmt, was WebKit in einem contenteditable erzeugt, und macht daraus Läufe:
 * - Textknoten (ohne Null-Breite-Leerzeichen U+200B/U+FEFF, die der Editor hinter Platzhalter-Chips setzt),
 * - b/strong, i/em, u/ins und Inline-Stile (font-weight, font-style, text-decoration) als Formatierung,
 * - Platzhalter-Chips über `data-ph`, sonstige nicht bearbeitbare Elemente fallen weg,
 * - br und Blöcke (div, p …) als Zeilenumbruch; ein br am Ende eines Blocks ist nur Platzhalter des Browsers.
 * Stellen (Schreibmarke) werden beim Lesen mitgezählt: Platzhalter = 1 Zeichen, Umbruch = 1 Zeichen.
 * Tests: editordom.test.ts */
import { istPlatzhalter, type PlatzhalterName } from './dokument';
import { OHNE_STIL, platzhalterErkennen, type Lauf, type Stil } from './formatierung';

export interface Knoten {
  /** 1 = Element, 3 = Text */
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<Knoten>;
  getAttribute?(name: string): string | null;
  style?: { fontWeight?: string; fontStyle?: string; textDecoration?: string; textDecorationLine?: string };
}

/** Stelle im DOM wie bei Selection/Range: Textknoten + Zeichen bzw. Element + Kindindex. */
export interface DomStelle {
  knoten: Knoten;
  offset: number;
}

const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'TABLE', 'TR']);
const WEG = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'HEAD', 'META', 'TITLE']);
const UNSICHTBAR = /[​﻿]/g;

const istText = (k: Knoten) => k.nodeType === 3;
const istElement = (k: Knoten) => k.nodeType === 1;
const name = (k: Knoten) => k.nodeName.toUpperCase();
const istBlock = (k: Knoten) => istElement(k) && BLOCK.has(name(k));
const sichtbarerText = (k: Knoten) => (k.nodeValue ?? '').replace(UNSICHTBAR, '');

/** Platzhalter-Chip (data-ph mit bekanntem Namen) ⇒ Name. */
export function chipName(k: Knoten): PlatzhalterName | null {
  if (!istElement(k)) return null;
  const n = k.getAttribute?.('data-ph') ?? null;
  return n && istPlatzhalter(n) ? n : null;
}
const nichtBearbeitbar = (k: Knoten) => istElement(k) && k.getAttribute?.('contenteditable') === 'false';

/** Formatierung, die ein Element setzt bzw. aufhebt (aus Tag und Inline-Stil). */
export function elementStil(k: Knoten, s: Stil): Stil {
  const n = name(k);
  const out = { ...s };
  if (n === 'B' || n === 'STRONG') out.fett = true;
  if (n === 'I' || n === 'EM') out.kursiv = true;
  if (n === 'U' || n === 'INS') out.unterstrichen = true;
  const st = k.style;
  if (st) {
    const w = (st.fontWeight ?? '').trim().toLowerCase();
    if (w === 'bold' || w === 'bolder' || (/^\d+$/.test(w) && Number(w) >= 600)) out.fett = true;
    else if (w === 'normal' || w === 'lighter' || (/^\d+$/.test(w) && Number(w) < 600)) out.fett = false;
    const f = (st.fontStyle ?? '').trim().toLowerCase();
    if (f.startsWith('italic') || f.startsWith('oblique')) out.kursiv = true;
    else if (f === 'normal') out.kursiv = false;
    const d = `${st.textDecorationLine ?? ''} ${st.textDecoration ?? ''}`.toLowerCase();
    if (d.includes('underline')) out.unterstrichen = true;
    else if (/\bnone\b/.test(d)) out.unterstrichen = false;
  }
  return out;
}

/** Hat der Knoten sichtbaren Inhalt (Text, Umbruch, Chip, Block)? */
function hatInhalt(k: Knoten): boolean {
  if (istText(k)) return sichtbarerText(k).length > 0;
  if (!istElement(k) || WEG.has(name(k))) return false;
  if (name(k) === 'BR' || chipName(k) || istBlock(k)) return true;
  if (nichtBearbeitbar(k)) return false;
  return Array.from(k.childNodes).some(hatInhalt);
}

/** Liegt die Stelle in diesem Teilbaum? */
function enthaelt(k: Knoten, ziel: Knoten): boolean {
  if (k === ziel) return true;
  return Array.from(k.childNodes).some((c) => enthaelt(c, ziel));
}

export interface Gelesen {
  laeufe: Lauf[];
  /** Stellen zu den übergebenen DOM-Stellen (null = nicht im Editor gefunden) */
  stellen: (number | null)[];
  /** {namen} aus getipptem Text wurden zu Platzhaltern (der DOM zeigt sie noch als Text) */
  umgewandelt: boolean;
}

/** Editor-Inhalt lesen. `wurzel` ist das contenteditable-Element selbst. */
export function lesen(wurzel: Knoten, stellen: readonly DomStelle[] = []): Gelesen {
  const roh: Lauf[] = [];
  let n = 0;
  let umbruchOffen = false;
  const gefunden: (number | null)[] = stellen.map(() => null);
  const merke = (k: Knoten, offset: number, wert: number) => {
    stellen.forEach((s, i) => {
      if (gefunden[i] === null && s.knoten === k && s.offset === offset) gefunden[i] = wert;
    });
  };
  const umbruch = () => {
    roh.push({ art: 'text', text: '\n', ...OHNE_STIL });
    n++;
  };
  const vorInhalt = () => {
    if (umbruchOffen) {
      umbruchOffen = false;
      umbruch();
    }
  };
  const endetMitUmbruch = () => {
    const l = roh[roh.length - 1];
    return !l || (l.art === 'text' && l.text.endsWith('\n'));
  };

  const gehe = (k: Knoten, stil: Stil, folgtNoch: () => boolean) => {
    const kinder = Array.from(k.childNodes);
    const block = k !== wurzel && istBlock(k);
    if (block) {
      if (umbruchOffen || !endetMitUmbruch()) {
        umbruchOffen = false;
        umbruch();
      }
    }
    kinder.forEach((c, i) => {
      merke(k, i, n);
      const danach = () => kinder.slice(i + 1).some(hatInhalt) || (k !== wurzel && !istBlock(k) && folgtNoch());
      if (istText(c)) {
        const roherText = c.nodeValue ?? '';
        const text = roherText.replace(UNSICHTBAR, '');
        if (text) vorInhalt();
        // Stellen im Textknoten: Null-Breite-Zeichen zählen nicht
        stellen.forEach((s, j) => {
          if (gefunden[j] === null && s.knoten === c) gefunden[j] = n + roherText.slice(0, s.offset).replace(UNSICHTBAR, '').length;
        });
        if (text) {
          roh.push({ art: 'text', text, ...stil });
          n += text.length;
        }
        return;
      }
      if (!istElement(c) || WEG.has(name(c))) return;
      const ph = chipName(c);
      if (ph) {
        vorInhalt();
        const vorher = n;
        roh.push({ art: 'platzhalter', name: ph, ...elementStil(c, stil) });
        n++;
        // Marke im Chip ⇒ dahinter
        stellen.forEach((s, j) => {
          if (gefunden[j] === null && s.knoten !== k && enthaelt(c, s.knoten)) gefunden[j] = vorher + 1;
        });
        return;
      }
      if (nichtBearbeitbar(c)) return;
      if (name(c) === 'BR') {
        // br am Ende eines Blocks (bzw. des Editors) ist nur der Platzhalter des Browsers für die leere Zeile
        if (danach()) {
          vorInhalt();
          umbruch();
        }
        return;
      }
      gehe(c, elementStil(c, stil), danach);
    });
    merke(k, kinder.length, n);
    if (block) umbruchOffen = true;
  };
  gehe(wurzel, { ...OHNE_STIL }, () => false);

  const roheStellen = gefunden.map((g) => g ?? -1);
  const r = platzhalterErkennen(roh, roheStellen.map((s) => (s < 0 ? 0 : s)));
  return { laeufe: r.laeufe, stellen: gefunden.map((g, i) => (g === null ? null : r.stellen[i])), umgewandelt: r.geaendert };
}

/**
 * Stelle ⇒ DOM-Stelle im vom Editor aufgebauten DOM (Text, br, b/i/u, Chips, U+200B hinter Chips). Bei einer Grenze
 * gewinnt das Ende des Textknotens davor (getippter Text übernimmt so die Formatierung des Zeichens davor), nach einem
 * Umbruch der Anfang der neuen Zeile.
 */
export function domStelle(wurzel: Knoten, stelle: number): DomStelle {
  let n = 0;
  let treffer: DomStelle | null = null;
  const gehe = (k: Knoten): boolean => {
    const kinder = Array.from(k.childNodes);
    for (let i = 0; i < kinder.length; i++) {
      const c = kinder[i];
      if (istText(c)) {
        const roh = c.nodeValue ?? '';
        const len = roh.replace(UNSICHTBAR, '').length;
        if (stelle >= n && stelle <= n + len) {
          // Index im Rohtext: so viele sichtbare Zeichen wie nötig, danach folgende Null-Breite-Zeichen überspringen
          let sichtbar = 0;
          let j = 0;
          while (j < roh.length && sichtbar < stelle - n) {
            if (!/[​﻿]/.test(roh[j])) sichtbar++;
            j++;
          }
          while (j < roh.length && /[​﻿]/.test(roh[j])) j++;
          treffer = { knoten: c, offset: j };
          return true;
        }
        n += len;
        continue;
      }
      if (!istElement(c)) continue;
      if (chipName(c) || name(c) === 'BR') {
        if (stelle === n) {
          treffer = { knoten: k, offset: i };
          return true;
        }
        n++;
        continue;
      }
      if (nichtBearbeitbar(c)) continue;
      if (gehe(c)) return true;
    }
    return false;
  };
  if (gehe(wurzel) && treffer) return treffer;
  return { knoten: wurzel, offset: wurzel.childNodes.length };
}

/** Besteht der DOM nur aus dem, was der Editor selbst aufbaut? Sonst baut er neu auf (z. B. nach WebKit-Stil-spans). */
export function istKanonisch(wurzel: Knoten): boolean {
  const ok = (k: Knoten): boolean => {
    if (istText(k)) return true;
    if (!istElement(k)) return true;
    if (chipName(k)) return true;
    const n = name(k);
    if (n === 'BR') return true;
    if (n !== 'B' && n !== 'I' && n !== 'U') return false;
    if (k.getAttribute?.('style')) return false;
    return Array.from(k.childNodes).every(ok);
  };
  return Array.from(wurzel.childNodes).every(ok);
}
