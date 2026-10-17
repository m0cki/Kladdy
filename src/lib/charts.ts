/* Diagramme (ANLEITUNG §9.6, §9.5) – reine Mathematik ohne DOM, portiert aus referenz/prototyp/js/charts.js:
 * runde Achsenteilung, Pfade (Linie, Treppe, Balken mit Rundung nur am Datenende, Donut-Bögen), Beschriftung der
 * Achse (de-DE, kompakt „12 Tsd.“, echtes Minus), Hochzählen (ease-out cubic) und die Wahl der X-Beschriftungen.
 * Werte bleiben Cent (ganze Zahlen); formatiert wird erst bei der Anzeige. Tests: charts.test.ts */
import { MINUS } from './money';

export interface Achse {
  lo: number;
  hi: number;
  ticks: number[];
}

/**
 * Runde Achsenteilung: Schritt 1/2/5 × 10^n, `lo`/`hi` auf ganze Schritte erweitert.
 * `minSchritt` (z. B. 100 = ein Euro bei Cent-Werten) verhindert krumme Teilungen bei sehr kleinen Werten.
 */
export function niceTicks(min: number, max: number, anzahl = 4, minSchritt = 0): Achse {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    max = min + Math.max(1, minSchritt);
    if (min !== 0) min -= Math.max(1, minSchritt);
  }
  const roh = (max - min) / anzahl;
  const mag = Math.pow(10, Math.floor(Math.log10(roh)));
  const n = roh / mag;
  let schritt = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  if (schritt < minSchritt) schritt = minSchritt;
  const lo = Math.floor(min / schritt + 1e-9) * schritt;
  const hi = Math.ceil(max / schritt - 1e-9) * schritt;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + schritt * 1e-6; v += schritt) ticks.push(Math.abs(v) < schritt * 1e-9 ? 0 : Number(v.toPrecision(12)));
  return { lo: ticks[0], hi: ticks[ticks.length - 1], ticks };
}

/** Achse für Geldwerte in Cent: Schritte in ganzen Euro, 0 immer enthalten. */
export const geldAchse = (werte: readonly (number | null)[], anzahl = 4): Achse => {
  const v = werte.filter((x): x is number => x != null && Number.isFinite(x));
  return niceTicks(Math.min(0, ...v), Math.max(0, ...v), anzahl, 100);
};

/** Lineare Abbildung Wert → Pixel (y wächst nach unten). */
export const skala = (lo: number, hi: number, oben: number, hoehe: number) => (v: number): number =>
  oben + hoehe - ((v - lo) / (hi - lo || 1)) * hoehe;

const zahl0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const zahl1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const minus = (s: string) => s.replace('-', MINUS);

/**
 * Beschriftung der Y-Achse für Cent-Werte (Einheit „in €“ steht im Kartenkopf, wie im Prototyp):
 * „1.200“, „−300“, ab 100.000 € bei Schritten ≥ 1.000 € „120 Tsd.“. Alle Ticks einer Achse gleich formatiert.
 */
export function achsenText(cent: number, schrittCent: number): string {
  const euro = Math.round(cent / 100);
  if (Math.abs(euro) >= 100_000 && schrittCent >= 100_000) return `${minus(zahl0.format(Math.round(euro / 1000)))} Tsd.`;
  return minus(zahl0.format(euro));
}

/** Prozent mit einer Nachkommastelle, Vorzeichen immer (▲/▼ setzt die Anzeige davor): „+12,3 %“, „−4,0 %“. */
export const prozentText = (anteil: number): string => {
  const p = Math.round(anteil * 1000) / 10;
  if (p === 0) return '0,0 %';
  return `${p > 0 ? '+' : MINUS}${zahl1.format(Math.abs(p))} %`;
};

/* ================= Pfade ================= */

export type Punkt = readonly [number, number];
const f2 = (n: number) => n.toFixed(2);

/** Linie durch die Punkte; `glatt` = monotone kubische Interpolation (keine Überschwinger). */
export function linePath(pts: readonly Punkt[], glatt = false): string {
  if (!pts.length) return '';
  if (!glatt || pts.length < 3) return 'M' + pts.map((p) => `${f2(p[0])},${f2(p[1])}`).join('L');
  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  const t: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++)
    t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  let d = `M${f2(pts[0][0])},${f2(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f2(pts[i][0] + h)},${f2(pts[i][1] + t[i] * h)} ${f2(pts[i + 1][0] - h)},${f2(pts[i + 1][1] - t[i + 1] * h)} ${f2(pts[i + 1][0])},${f2(pts[i + 1][1])}`;
  }
  return d;
}

/** Treppenlinie: der Wert springt an den Punkten (Liquidität). */
export function stepPath(pts: readonly Punkt[]): string {
  if (!pts.length) return '';
  let d = `M${f2(pts[0][0])},${f2(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `H${f2(pts[i][0])}V${f2(pts[i][1])}`;
  return d;
}

/** Fläche unter einer Linie bis zur Grundlinie `y0`. */
export const areaPath = (pts: readonly Punkt[], y0: number, glatt = false): string =>
  pts.length ? `${linePath(pts, glatt)}L${f2(pts[pts.length - 1][0])},${f2(y0)}L${f2(pts[0][0])},${f2(y0)}Z` : '';

/** Balken von der Nulllinie `y0` bis `y1`, 4 px Rundung nur am Datenende. Leer, wenn kaum sichtbar (< 0,5 px). */
export function barPath(x: number, w: number, y0: number, y1: number): string {
  const h = Math.abs(y1 - y0);
  if (h < 0.5 || w <= 0) return '';
  const r = Math.min(4, w / 2, h);
  const a = (n: number) => f2(n);
  if (y1 < y0)
    return `M${a(x)},${a(y0)}V${a(y1 + r)}Q${a(x)},${a(y1)} ${a(x + r)},${a(y1)}H${a(x + w - r)}Q${a(x + w)},${a(y1)} ${a(x + w)},${a(y1 + r)}V${a(y0)}Z`;
  return `M${a(x)},${a(y0)}V${a(y1 - r)}Q${a(x)},${a(y1)} ${a(x + r)},${a(y1)}H${a(x + w - r)}Q${a(x + w)},${a(y1)} ${a(x + w)},${a(y1 - r)}V${a(y0)}Z`;
}

export interface Balkenraster {
  /** Breite je Monat/Gruppe */
  band: number;
  /** Breite der Balkengruppe */
  gruppe: number;
  /** Breite eines Balkens */
  balken: number;
}

/** Gruppierte Balken (§9.6 Regel 4): höchstens 26 px breit, 2 px Abstand, Gruppe höchstens 72 % des Bands. */
export function balkenraster(breite: number, anzahl: number, serien: number): Balkenraster {
  const band = breite / Math.max(1, anzahl);
  const gruppe = Math.min(band * 0.72, serien * 26 + (serien - 1) * 2);
  return { band, gruppe, balken: Math.max(0, (gruppe - (serien - 1) * 2) / serien) };
}

/* ================= Donut ================= */

export interface Segment {
  a1: number;
  a2: number;
  /** Anteil 0–1 */
  anteil: number;
}

/** Winkel je Segment ab 12 Uhr im Uhrzeigersinn, mit kleiner Fuge zwischen mehreren Segmenten. Nur positive Werte zählen. */
export function donutSegmente(werte: readonly number[], fuge = 0.012): Segment[] {
  const pos = werte.map((w) => (w > 0 ? w : 0));
  const total = pos.reduce((s, w) => s + w, 0);
  const mehrere = pos.filter((w) => w > 0).length > 1;
  let a = -Math.PI / 2;
  return pos.map((w) => {
    const anteil = total ? w / total : 0;
    const a1 = a;
    const a2 = a + anteil * Math.PI * 2 - (mehrere && w > 0 ? fuge : 0);
    a += anteil * Math.PI * 2;
    return { a1, a2: Math.max(a1 + (w > 0 ? 0.001 : 0), a2), anteil };
  });
}

/** Ringstück von a1 bis a2 (Bogenmaß) um (c, c) mit Außenradius R und Innenradius r. */
export function donutBogen(c: number, R: number, r: number, a1: number, a2: number): string {
  if (a2 - a1 >= Math.PI * 2 - 1e-6) a2 = a1 + Math.PI * 2 - 1e-4; // voller Kreis: SVG-Bogen braucht zwei Punkte
  const gross = a2 - a1 > Math.PI ? 1 : 0;
  const p = (rad: number, a: number) => `${f2(c + rad * Math.cos(a))},${f2(c + rad * Math.sin(a))}`;
  return `M${p(R, a1)}A${R},${R} 0 ${gross} 1 ${p(R, a2)}L${p(r, a2)}A${r},${r} 0 ${gross} 0 ${p(r, a1)}Z`;
}

/** Ganze Prozent je Anteil, Summe genau 100 (größter Rest bekommt die fehlenden Punkte). */
export function prozenteGanz(werte: readonly number[]): number[] {
  const pos = werte.map((w) => (w > 0 ? w : 0));
  const total = pos.reduce((s, w) => s + w, 0);
  if (!total) return pos.map(() => 0);
  const roh = pos.map((w) => (w / total) * 100);
  const ganz = roh.map(Math.floor);
  let rest = 100 - ganz.reduce((s, x) => s + x, 0);
  const reihenfolge = roh.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of reihenfolge) {
    if (rest <= 0) break;
    if (pos[i] > 0) {
      ganz[i] += 1;
      rest -= 1;
    }
  }
  return ganz;
}

/* ================= Beschriftung & Bewegung ================= */

/**
 * Welche X-Beschriftungen gezeigt werden: bei Platzmangel jede k-te, gezählt vom letzten Eintrag aus
 * (der jüngste Monat ist immer beschriftet). `abstand` = Pixel je Eintrag, `mindestens` = Platz je Beschriftung.
 */
export function xBeschriftungen(anzahl: number, abstand: number, mindestens = 46): number[] {
  if (anzahl <= 0) return [];
  const jede = Math.max(1, Math.ceil(mindestens / Math.max(1, abstand)));
  const out: number[] = [];
  for (let i = 0; i < anzahl; i++) if ((anzahl - 1 - i) % jede === 0) out.push(i);
  return out;
}

/** Nächster Index zu einer Pixelposition (Fadenkreuz), begrenzt auf 0 … anzahl−1. */
export const naechsterIndex = (x: number, links: number, breite: number, anzahl: number): number =>
  Math.max(0, Math.min(anzahl - 1, Math.round(((x - links) / Math.max(1, breite)) * (anzahl - 1))));

/** Index des Bands unter einer Pixelposition (Balken). */
export const bandIndex = (x: number, links: number, band: number, anzahl: number): number =>
  Math.max(0, Math.min(anzahl - 1, Math.floor((x - links) / Math.max(1e-9, band))));

/** ease-out cubic (§9.5): 0 → 0, 1 → 1, am Anfang schnell. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** Zwischenwert beim Hochzählen, auf ganze Einheiten (Cent bzw. Stück) gerundet; am Ende genau das Ziel. */
export const hochzaehlWert = (ziel: number, t: number): number => (t >= 1 ? ziel : Math.round(ziel * easeOutCubic(t)));

/** Ungefähre Breite einer Beschriftungs-Pille (11 px Schrift). */
export const pillBreite = (text: string): number => Math.round(text.length * 6.2 + 14);
