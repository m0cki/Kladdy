/* Formatierung in Texten der Bausteine (ANLEITUNG §7.0 „Formatierung“): fett, kursiv, unterstrichen.
 *
 * Gespeichert wird sie in den Text-Einstellungen selbst als winziges Markup mit genau drei Tags ohne Attribute:
 * `<b>…</b>` (fett), `<i>…</i>` (kursiv), `<u>…</u>` (unterstrichen), verschachtelbar. Sonst nichts.
 * - Alte Texte ohne Tags bleiben, wie sie sind. Unbekannte oder unausgeglichene Tags sind einfach Text (nie ein Fehler).
 * - Das Markup gilt nur im Vorlagentext, nie in Werten: Es wird VOR dem Ersetzen der Platzhalter gelesen. Ein Kunde
 *   „<b>Müller</b> & Co“ bleibt Text (HTML: React maskiert, LaTeX: escape.ts).
 * - `serialisieren` schreibt immer dieselbe Form (`normalisieren`): leere Tags fallen weg, gleiche Nachbarn verschmelzen,
 *   Reihenfolge b › i › u, Zeilenumbrüche stehen außerhalb der Tags (jede Zeile ist für sich vollständig). So bleiben
 *   gespeicherte Texte stabil und Protokoll-Einträge klein.
 * - Rechnen mit Stellen (Editor): Ein Platzhalter zählt als ein Zeichen, ein Zeilenumbruch auch.
 * Tests: formatierung.test.ts */
import { zerlegen, type PlatzhalterName, type Textteil } from './dokument';

export interface Stil {
  fett: boolean;
  kursiv: boolean;
  unterstrichen: boolean;
}
export type Eigenschaft = keyof Stil;
export const EIGENSCHAFTEN: readonly Eigenschaft[] = ['fett', 'kursiv', 'unterstrichen'];
export const OHNE_STIL: Readonly<Stil> = { fett: false, kursiv: false, unterstrichen: false };

/** Ein Stück Text oder ein Platzhalter mit seiner Formatierung. */
export type Lauf = Textteil & Stil;

const TAG: Readonly<Record<string, Eigenschaft>> = { b: 'fett', i: 'kursiv', u: 'unterstrichen' };
const ZU_TAG: Readonly<Record<Eigenschaft, string>> = { fett: 'b', kursiv: 'i', unterstrichen: 'u' };

const stilVon = (s: Stil): Stil => ({ fett: s.fett, kursiv: s.kursiv, unterstrichen: s.unterstrichen });
export const gleicherStil = (a: Stil, b: Stil): boolean => a.fett === b.fett && a.kursiv === b.kursiv && a.unterstrichen === b.unterstrichen;
export const hatFormat = (s: Stil): boolean => s.fett || s.kursiv || s.unterstrichen;

/* ---------- Lesen ---------- */

/** Markup ⇒ Läufe (Platzhalter erkannt wie `zerlegen`). Nie ein Fehler: Unpassendes bleibt Text. */
export function parsen(markup: string): Lauf[] {
  const text = String(markup ?? '');
  const muster = /<(\/?)([biu])>/g;
  const tokens: { pos: number; ende: number; zu: boolean; eig: Eigenschaft }[] = [];
  for (let m = muster.exec(text); m; m = muster.exec(text)) tokens.push({ pos: m.index, ende: m.index + m[0].length, zu: m[1] === '/', eig: TAG[m[2]] });
  // Paare finden: ein schließendes Tag gehört zum letzten noch offenen gleicher Art; übrige Tags sind Text
  const gepaart = new Array<boolean>(tokens.length).fill(false);
  const offen: Record<Eigenschaft, number[]> = { fett: [], kursiv: [], unterstrichen: [] };
  tokens.forEach((t, i) => {
    if (!t.zu) offen[t.eig].push(i);
    else {
      const j = offen[t.eig].pop();
      if (j !== undefined) {
        gepaart[i] = true;
        gepaart[j] = true;
      }
    }
  });
  const roh: Lauf[] = [];
  const tiefe: Record<Eigenschaft, number> = { fett: 0, kursiv: 0, unterstrichen: 0 };
  const stil = (): Stil => ({ fett: tiefe.fett > 0, kursiv: tiefe.kursiv > 0, unterstrichen: tiefe.unterstrichen > 0 });
  let puffer = '';
  const leeren = () => {
    if (puffer) roh.push({ art: 'text', text: puffer, ...stil() });
    puffer = '';
  };
  let pos = 0;
  tokens.forEach((t, i) => {
    puffer += text.slice(pos, t.pos);
    pos = t.ende;
    if (!gepaart[i]) {
      puffer += text.slice(t.pos, t.ende);
      return;
    }
    leeren();
    tiefe[t.eig] += t.zu ? -1 : 1;
  });
  puffer += text.slice(pos);
  leeren();
  return platzhalterErkennen(roh).laeufe;
}

/**
 * Platzhalter in Textläufen erkennen (gleiche Formatierung, wie `zerlegen`). `stellen` (Zeichenstellen in den
 * übergebenen Läufen) werden mit umgerechnet; eine Stelle mitten in einem erkannten {namen} landet dahinter.
 */
export function platzhalterErkennen(laeufe: readonly Lauf[], stellen: readonly number[] = []): { laeufe: Lauf[]; stellen: number[]; geaendert: boolean } {
  // gleiche Textnachbarn zuerst verbinden ({ku + nde} aus zwei Textknoten)
  const verbunden: Lauf[] = [];
  for (const l of laeufe) {
    const v = verbunden[verbunden.length - 1];
    if (l.art === 'text' && !l.text) continue;
    if (l.art === 'text' && v?.art === 'text' && gleicherStil(v, l)) verbunden[verbunden.length - 1] = { ...v, text: v.text + l.text };
    else verbunden.push(l);
  }
  const out: Lauf[] = [];
  // abbildung[alt] = neu für jede Stelle 0 … Länge
  const abbildung: number[] = [];
  let alt = 0;
  let neu = 0;
  let geaendert = false;
  for (const l of verbunden) {
    if (l.art === 'platzhalter') {
      abbildung[alt] = neu;
      out.push(l);
      alt++;
      neu++;
      continue;
    }
    for (const t of zerlegen(l.text)) {
      if (t.art === 'text') {
        for (let k = 0; k < t.text.length; k++) abbildung[alt + k] = neu + k;
        alt += t.text.length;
        neu += t.text.length;
        const v = out[out.length - 1];
        // unbekannte {namen} trennt zerlegen ab – als Text gehören sie zum Nachbarn
        if (v?.art === 'text' && gleicherStil(v, l)) out[out.length - 1] = { ...v, text: v.text + t.text };
        else out.push({ ...t, ...stilVon(l) });
      } else {
        const n = t.name.length + 2;
        abbildung[alt] = neu;
        for (let k = 1; k < n; k++) abbildung[alt + k] = neu + 1;
        alt += n;
        neu += 1;
        geaendert = true;
        out.push({ ...t, ...stilVon(l) });
      }
    }
  }
  abbildung[alt] = neu;
  return { laeufe: out, stellen: stellen.map((s) => abbildung[Math.max(0, Math.min(alt, s))]), geaendert };
}

/* ---------- Schreiben ---------- */

/** Ein Zeichen (UTF-16-Einheit wie Stellen im DOM) bzw. Platzhalter mit Formatierung – für Rechnen mit Stellen. */
type Zeichen = Stil & ({ z: string; ph?: undefined } | { z?: undefined; ph: PlatzhalterName });

function zuZeichen(laeufe: readonly Lauf[]): Zeichen[] {
  const out: Zeichen[] = [];
  for (const l of laeufe) {
    if (l.art === 'platzhalter') out.push({ ph: l.name, ...stilVon(l) });
    else for (let k = 0; k < l.text.length; k++) out.push({ z: l.text[k], ...stilVon(l) });
  }
  return out;
}

function ausZeichen(zeichen: readonly Zeichen[]): Lauf[] {
  const out: Lauf[] = [];
  for (const c of zeichen) {
    const v = out[out.length - 1];
    if (c.ph !== undefined) out.push({ art: 'platzhalter', name: c.ph, ...stilVon(c) });
    else if (v?.art === 'text' && gleicherStil(v, c)) v.text += c.z;
    else out.push({ art: 'text', text: c.z, ...stilVon(c) });
  }
  return out;
}

/** Zusammenfassen: leere Texte fallen weg, Zeilenumbrüche ohne Format, gleiche Nachbarn verschmelzen. */
export function zusammenfassen(laeufe: readonly Lauf[]): Lauf[] {
  return ausZeichen(zuZeichen(laeufe).map((c) => (c.z === '\n' ? { z: '\n', ...OHNE_STIL } : c)));
}

/** Läufe ⇒ Markup in der festen Form (siehe oben). */
export function serialisieren(laeufe: readonly Lauf[]): string {
  let out = '';
  const offen: Eigenschaft[] = [];
  const schliessenBis = (n: number) => {
    while (offen.length > n) out += `</${ZU_TAG[offen.pop() as Eigenschaft]}>`;
  };
  const stueck = (s: Stil, inhalt: string) => {
    // längster Anfang der offenen Tags, die bleiben dürfen; der Rest wird geschlossen, Fehlendes in Reihenfolge b › i › u geöffnet
    let n = 0;
    while (n < offen.length && s[offen[n]]) n++;
    schliessenBis(n);
    for (const e of EIGENSCHAFTEN) {
      if (s[e] && !offen.includes(e)) {
        offen.push(e);
        out += `<${ZU_TAG[e]}>`;
      }
    }
    out += inhalt;
  };
  for (const l of zusammenfassen(laeufe)) {
    if (l.art === 'platzhalter') {
      stueck(l, `{${l.name}}`);
      continue;
    }
    for (const teil of l.text.split(/(\n)/)) {
      if (!teil) continue;
      if (teil === '\n') {
        schliessenBis(0);
        out += '\n';
      } else stueck(l, teil);
    }
  }
  schliessenBis(0);
  return out;
}

/** Markup in die feste Form bringen (idempotent; Texte ohne Tags bleiben unverändert). */
export const normalisieren = (markup: string): string => serialisieren(parsen(markup));

/** Text ohne Formatierung, Platzhalter als {name} (für Pflichtangaben-Check, Bausteinliste usw.). */
export const klartext = (markup: string): string => parsen(markup).map((l) => (l.art === 'text' ? l.text : `{${l.name}}`)).join('');

/** Enthält das Markup Formatierung? */
export const hatFormatierung = (markup: string): boolean => parsen(markup).some(hatFormat);

/* ---------- Rechnen mit Stellen (Editor) ---------- */

/** Anzahl Stellen (Platzhalter = 1). */
export const laenge = (laeufe: readonly Lauf[]): number => laeufe.reduce((n, l) => n + (l.art === 'text' ? l.text.length : 1), 0);

/** Text (mit Umbrüchen) als Läufe mit einer Formatierung; {namen} werden Platzhalter. */
export const textLaeufe = (text: string, stil: Stil = OHNE_STIL): Lauf[] => zerlegen(text).map((t) => ({ ...t, ...stilVon(stil) }));

/** Formatierung an der Schreibmarke: die des Zeichens davor (am Anfang bzw. nach einem Umbruch: des Zeichens danach). */
export function stilBei(laeufe: readonly Lauf[], stelle: number): Stil {
  const z = zuZeichen(laeufe);
  const vor = z[stelle - 1];
  if (vor && vor.z !== '\n') return stilVon(vor);
  const nach = z[stelle];
  return nach && nach.z !== '\n' ? stilVon(nach) : { ...OHNE_STIL };
}

/** Haben alle Zeichen in [von, bis) die Eigenschaft? (Umbrüche zählen nicht; leerer Bereich ⇒ stilBei) */
export function hatStil(laeufe: readonly Lauf[], von: number, bis: number, eig: Eigenschaft): boolean {
  if (bis <= von) return stilBei(laeufe, von)[eig];
  const z = zuZeichen(laeufe).slice(von, bis).filter((c) => c.z !== '\n');
  return z.length > 0 && z.every((c) => c[eig]);
}

/** Eigenschaft im Bereich [von, bis) setzen bzw. entfernen. */
export function formatieren(laeufe: readonly Lauf[], von: number, bis: number, eig: Eigenschaft, an: boolean): Lauf[] {
  return ausZeichen(zuZeichen(laeufe).map((c, i) => (i >= von && i < bis ? { ...c, [eig]: an } : c)));
}

/** Bereich [von, bis) durch `neu` ersetzen (Einfügen: von = bis, Löschen: neu = []). */
export function bereichErsetzen(laeufe: readonly Lauf[], von: number, bis: number, neu: readonly Lauf[]): Lauf[] {
  const z = zuZeichen(laeufe);
  const a = Math.max(0, Math.min(von, z.length));
  const b = Math.max(a, Math.min(bis, z.length));
  return ausZeichen([...z.slice(0, a), ...zuZeichen(neu), ...z.slice(b)]);
}

/** Ein Zeichen vor (-1) bzw. hinter (1) der Stelle löschen; Ersatzpaare (Emoji) als Ganzes. ⇒ neue Läufe und Stelle */
export function zeichenLoeschen(laeufe: readonly Lauf[], stelle: number, richtung: -1 | 1): { laeufe: Lauf[]; stelle: number } {
  const z = zuZeichen(laeufe);
  let a = richtung < 0 ? stelle - 1 : stelle;
  let b = a + 1;
  if (a < 0 || b > z.length) return { laeufe: ausZeichen(z), stelle };
  const hoch = (c: Zeichen | undefined) => !!c?.z && /[\ud800-\udbff]/.test(c.z);
  const tief = (c: Zeichen | undefined) => !!c?.z && /[\udc00-\udfff]/.test(c.z);
  if (tief(z[a]) && hoch(z[a - 1])) a--;
  if (hoch(z[b - 1]) && tief(z[b])) b++;
  return { laeufe: ausZeichen([...z.slice(0, a), ...z.slice(b)]), stelle: a };
}

/** Leerraum am Anfang und Ende entfernen (für Zeilen des Firmenkopfs). */
export function trimmen(laeufe: readonly Lauf[]): Lauf[] {
  const z = zuZeichen(laeufe);
  const leer = (c: Zeichen) => c.z !== undefined && /\s/.test(c.z);
  let a = 0;
  let b = z.length;
  while (a < b && leer(z[a])) a++;
  while (b > a && leer(z[b - 1])) b--;
  return ausZeichen(z.slice(a, b));
}

/** Markup in Zeilen (jede für sich vollständiges Markup). */
export function zeilenMarkup(markup: string): string[] {
  return normalisieren(String(markup ?? '').replace(/\r\n?/g, '\n')).split('\n');
}

/* ---------- Ersetzen für die Vorschau (unabhängig von HTML) ---------- */

/** Ein Stück der fertigen Zeile: Text mit Formatierung; `entwurf` = fehlende Nummer ({nr} im Entwurf, grau „Entwurf“). */
export interface Segment extends Stil {
  text: string;
  entwurf: boolean;
}

type Druckzeichen = Stil & { z: string; entwurf: boolean };

/**
 * Platzhalter ersetzen wie `ersetzen` in dokument.ts, aber mit Formatierung: Umbrüche als `\r\n` vereinheitlicht,
 * Leerzeichen vor Umbrüchen und Leerzeilen am Rand entfernt. Ergebnis: Zeilen aus Segmenten, null = nichts zu drucken.
 */
export function ersetzteZeilen(markup: string, werte: Readonly<Record<PlatzhalterName, string>>): Segment[][] | null {
  const z: Druckzeichen[] = [];
  for (const l of parsen(markup)) {
    const s = stilVon(l);
    if (l.art === 'platzhalter' && l.name === 'nr' && !werte.nr) {
      z.push({ z: '\u0000', entwurf: true, ...s });
      continue;
    }
    const text = (l.art === 'text' ? l.text : werte[l.name]).replace(/\r\n?/g, '\n');
    for (let k = 0; k < text.length; k++) z.push({ z: text[k], entwurf: false, ...s });
  }
  // Leerzeichen/Tabs vor einem Umbruch weg
  const weg = new Array<boolean>(z.length).fill(false);
  for (let i = 0; i < z.length; i++) {
    if (z[i].z !== '\n') continue;
    for (let j = i - 1; j >= 0 && (z[j].z === ' ' || z[j].z === '\t') && !z[j].entwurf; j--) weg[j] = true;
  }
  let rest = z.filter((_, i) => !weg[i]);
  let a = 0;
  let b = rest.length;
  while (a < b && rest[a].z === '\n') a++;
  while (b > a && rest[b - 1].z === '\n') b--;
  rest = rest.slice(a, b);
  if (!rest.some((c) => c.entwurf || c.z.trim())) return null;
  const zeilen: Segment[][] = [[]];
  for (const c of rest) {
    const zeile = zeilen[zeilen.length - 1];
    if (c.z === '\n') {
      zeilen.push([]);
      continue;
    }
    if (c.entwurf) {
      zeile.push({ text: 'Entwurf', entwurf: true, ...stilVon(c) });
      continue;
    }
    const v = zeile[zeile.length - 1];
    if (v && !v.entwurf && gleicherStil(v, c)) v.text += c.z;
    else zeile.push({ text: c.z, entwurf: false, ...stilVon(c) });
  }
  return zeilen;
}
