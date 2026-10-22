/* QR-Code-Encoder für den GiroCode (ANLEITUNG §6.6; Port von referenz/prototyp/js/qr.js, dort gegen zwei
 * unabhängige Decoder getestet). ISO/IEC 18004: Byte-Modus (UTF-8, ohne ECI), Version 1–40, Fehlerkorrektur
 * L/M/Q/H, Reed-Solomon über GF(256), alle acht Masken mit Strafpunkt-Wertung (oder eine erzwungene Maske).
 * - Ergebnis: Modulmatrix `module[y][x]` (true = dunkel) ohne Ruhezone – Vorschau als SVG (hier), PDF als PNG (png.ts).
 * - Abhängigkeitsfrei und rein: gleiche Eingabe ⇒ gleiche Matrix (Vorschau und PDF zeigen denselben Code).
 * Tests: qr.test.ts (Aufbau und Rück-Dekodierung mit eigenem Decoder) */

export type Stufe = 'L' | 'M' | 'Q' | 'H';

/** Kennung der Stufe in der Formatinfo */
const STUFE_BITS: Readonly<Record<Stufe, number>> = { L: 1, M: 0, Q: 3, H: 2 };

/* ---------- Tabellen (Index = Version 1–40, Index 0 unbenutzt) ---------- */

/** EC-Codewörter je Block */
const EC_LAENGE: Readonly<Record<Stufe, readonly number[]>> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

/** Anzahl Fehlerkorrektur-Blöcke */
const BLOECKE: Readonly<Record<Stufe, readonly number[]>> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

/* ---------- Galois-Feld GF(256), Primitivpolynom 0x11D ---------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = EXP[i + 255] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
const mal = (a: number, b: number): number => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/* ---------- Reed-Solomon ---------- */

/** Generator (x − α⁰)(x − α¹)…(x − αⁿ⁻¹): Koeffizienten absteigend, führende 1 weggelassen */
function rsGenerator(grad: number): number[] {
  const g = new Array<number>(grad).fill(0);
  g[grad - 1] = 1;
  for (let i = 0, wurzel = 1; i < grad; i++, wurzel = mal(wurzel, 2)) {
    for (let j = 0; j < grad; j++) g[j] = mal(g[j], wurzel) ^ (j + 1 < grad ? g[j + 1] : 0);
  }
  return g;
}

/** Rest der Polynomdivision = EC-Codewörter */
function rsRest(daten: readonly number[], g: readonly number[]): number[] {
  const r = new Array<number>(g.length).fill(0);
  for (const b of daten) {
    const f = b ^ (r.shift() ?? 0);
    r.push(0);
    g.forEach((c, i) => {
      r[i] ^= mal(c, f);
    });
  }
  return r;
}

/* ---------- Geometrie & Kapazität ---------- */

/** Module für Daten + EC (alles außer Funktionsmustern, Format- und Versionsinfo) */
function rohModule(v: number): number {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const a = Math.floor(v / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (v >= 7) n -= 36;
  }
  return n;
}

const datenBytes = (v: number, s: Stufe): number => (rohModule(v) >> 3) - EC_LAENGE[s][v] * BLOECKE[s][v];

/** Mittelpunkte der Ausrichtungsmuster (je Achse) */
function ausrichtung(v: number): number[] {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const schritt = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const pos = [6];
  for (let p = v * 4 + 10; pos.length < n; p -= schritt) pos.splice(1, 0, p);
  return pos;
}

/* ---------- Masken (x = Spalte, y = Zeile) ---------- */

const MASKEN: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

const anzahl = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

/** Strafpunkte N1–N4 (ISO 18004, Tabelle 11); entscheidet nur, welche Maske gewählt wird. */
function strafpunkte(mod: readonly (readonly boolean[])[]): number {
  const n = mod.length;
  const zeilen = mod.map((z) => z.map((d) => (d ? '1' : '0')).join(''));
  const spalten = zeilen.map((_, x) => zeilen.map((z) => z[x]).join(''));
  let p = 0;
  for (const linie of zeilen.concat(spalten)) {
    // N1: 3 + (Länge − 5) je Lauf von fünf und mehr gleichen Modulen
    for (const lauf of linie.match(/0{5,}|1{5,}/g) ?? []) p += lauf.length - 2;
    // N3: 1:1:3:1:1 mit vier hellen Modulen davor oder danach (Rand = Ruhezone = hell), je Vorkommen einmal
    const s = `0000${linie}0000`;
    p += (anzahl(s, /(?=00001011101|10111010000)/g) - anzahl(s, /(?=000010111010000)/g)) * 40;
  }
  // N2: 2×2-Blöcke gleicher Farbe
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) {
      const c = zeilen[y][x];
      if (c === zeilen[y][x + 1] && c === zeilen[y + 1][x] && c === zeilen[y + 1][x + 1]) p += 3;
    }
  }
  // N4: je 5 % Abweichung des Dunkelanteils von 50 %
  const dunkel = zeilen.join('').split('1').length - 1;
  const gesamt = n * n;
  return p + (Math.ceil(Math.abs(dunkel * 20 - gesamt * 10) / gesamt) - 1) * 10;
}

/* ---------- Encoder ---------- */

export interface QrCode {
  version: number;
  /** Kantenlänge in Modulen (4 · Version + 17) */
  groesse: number;
  stufe: Stufe;
  maske: number;
  /** module[y][x], true = dunkel; ohne Ruhezone */
  module: boolean[][];
}

export interface QrOptionen {
  /** Fehlerkorrektur, Standard M (GiroCode) */
  stufe?: Stufe;
  minVersion?: number;
  /** 0–7 erzwingt eine Maske (Tests), sonst die mit den wenigsten Strafpunkten */
  maske?: number;
}

/** Text (UTF-8, Byte-Modus) als QR-Code. Wirft, wenn er auch in Version 40 nicht passt. */
export function qrKodieren(text: string, { stufe = 'M', minVersion = 1, maske = -1 }: QrOptionen = {}): QrCode {
  const bytes = new TextEncoder().encode(text);

  // kleinste passende Version (Zeichenzahl-Feld: 8 Bit bis V9, sonst 16 Bit)
  let v = Math.max(1, Math.min(40, minVersion | 0));
  while (v <= 40 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > datenBytes(v, stufe) * 8) v++;
  if (v > 40) throw new RangeError('Daten zu lang für einen QR-Code');

  // Bitstrom: Modus 0100, Zeichenzahl, Daten, Terminator, Auffüllen auf Byte, Füllbytes EC/11
  const kap = datenBytes(v, stufe) * 8;
  const bits: number[] = [];
  const put = (wert: number, laenge: number) => {
    for (let i = laenge - 1; i >= 0; i--) bits.push((wert >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, kap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let fuell = 0xec; bits.length < kap; fuell ^= 0xec ^ 0x11) put(fuell, 8);
  const daten: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    daten.push(byte);
  }

  // Blöcke bilden, EC berechnen, verschränken (kurze Blöcke zuerst)
  const nb = BLOECKE[stufe][v];
  const ecLaenge = EC_LAENGE[stufe][v];
  const roh = rohModule(v) >> 3;
  const nKurz = nb - (roh % nb);
  const kurzLaenge = Math.floor(roh / nb) - ecLaenge;
  const gen = rsGenerator(ecLaenge);
  const dBloecke: number[][] = [];
  const eBloecke: number[][] = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const laenge = kurzLaenge + (i < nKurz ? 0 : 1);
    dBloecke.push(daten.slice(k, k + laenge));
    k += laenge;
    eBloecke.push(rsRest(dBloecke[i], gen));
  }
  const cw: number[] = [];
  for (let i = 0; i <= kurzLaenge; i++) for (const d of dBloecke) if (i < d.length) cw.push(d[i]);
  for (let i = 0; i < ecLaenge; i++) for (const e of eBloecke) cw.push(e[i]);

  // Matrix + Merker für Funktionsmodule
  const n = v * 4 + 17;
  const mod: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const fn: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const setze = (x: number, y: number, dunkel: boolean) => {
    mod[y][x] = dunkel;
    fn[y][x] = true;
  };

  // Timing
  for (let i = 0; i < n; i++) {
    setze(6, i, i % 2 === 0);
    setze(i, 6, i % 2 === 0);
  }
  // Finder inkl. Trenner
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < n && y >= 0 && y < n) setze(x, y, d !== 2 && d !== 4);
      }
    }
  }
  // Ausrichtung (nicht auf den Findern)
  const ap = ausrichtung(v);
  const letzte = ap.length - 1;
  ap.forEach((ay, i) =>
    ap.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === letzte) || (i === letzte && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setze(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }),
  );

  // Formatinfo: 5 Bit (Stufe + Maske) + BCH(15,5), XOR 0x5412, zweifach; dazu das dunkle Modul
  const formatZeichnen = (m: number) => {
    const d = (STUFE_BITS[stufe] << 3) | m;
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const f = ((d << 10) | r) ^ 0x5412;
    const bit = (i: number) => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) setze(8, i, bit(i));
    setze(8, 7, bit(6));
    setze(8, 8, bit(7));
    setze(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setze(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setze(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setze(8, n - 15 + i, bit(i));
    setze(8, n - 8, true);
  };
  formatZeichnen(0); // reserviert die Bereiche vor dem Platzieren der Daten

  // Versionsinfo ab V7: 6 Bit + BCH(18,6), je ein 6×3-Block oben rechts und unten links
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) {
      const dunkel = ((b >>> i) & 1) === 1;
      const a = n - 11 + (i % 3);
      const c = Math.floor(i / 3);
      setze(a, c, dunkel);
      setze(c, a, dunkel);
    }
  }

  // Daten im Zickzack platzieren (Spaltenpaare von rechts, Spalte 6 überspringen); Restbits bleiben hell
  for (let rechts = n - 1, k = 0; rechts >= 1; rechts -= 2) {
    if (rechts === 6) rechts = 5;
    const hoch = ((rechts + 1) & 2) === 0;
    for (let i = 0; i < n; i++) {
      const y = hoch ? n - 1 - i : i;
      for (let x = rechts; x > rechts - 2; x--) {
        if (fn[y][x] || k >= cw.length * 8) continue;
        mod[y][x] = ((cw[k >> 3] >>> (7 - (k & 7))) & 1) === 1;
        k++;
      }
    }
  }

  // Maske wählen (wenigste Strafpunkte) oder die erzwungene verwenden
  const maskieren = (m: number) => {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!fn[y][x] && MASKEN[m](x, y)) mod[y][x] = !mod[y][x];
  };
  let beste = Number.isInteger(maske) && maske >= 0 && maske <= 7 ? maske : -1;
  if (beste < 0) {
    let min = Infinity;
    for (let m = 0; m < 8; m++) {
      maskieren(m);
      formatZeichnen(m);
      const p = strafpunkte(mod);
      if (p < min) {
        min = p;
        beste = m;
      }
      maskieren(m); // zurücknehmen (XOR)
    }
  }
  maskieren(beste);
  formatZeichnen(beste);
  return { version: v, groesse: n, stufe, maske: beste, module: mod };
}

/* ---------- SVG ---------- */

/** Ein Pfad für alle dunklen Module (waagerechte Läufe zusammengefasst), `rand` = Ruhezone in Modulen. */
export function qrPfad(module: readonly (readonly boolean[])[], rand = 0): string {
  let d = '';
  module.forEach((zeile, y) => {
    for (let x = 0; x < zeile.length; x++) {
      if (!zeile[x]) continue;
      const x0 = x;
      while (x < zeile.length && zeile[x]) x++;
      d += `M${x0 + rand} ${y + rand}h${x - x0}v1h-${x - x0}z`;
    }
  });
  return d;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface SvgOptionen {
  /** Ruhezone in Modulen (Standard 0: auf dem Blatt sorgt der weiße Rand drumherum dafür) */
  rand?: number;
  /** Farbe der dunklen Module; Standard currentColor = Farbe aus dem CSS (Blatt: var(--qr)) */
  farbe?: string;
  titel?: string;
}

/** SVG-Text; Größe kommt von außen (CSS), `shape-rendering="crispEdges"` hält die Kanten scharf. */
export function qrSvg(module: readonly (readonly boolean[])[], { rand = 0, farbe = 'currentColor', titel = '' }: SvgOptionen = {}): string {
  const m = Math.max(0, rand | 0);
  const n = module.length + m * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img"` +
    (titel ? ` aria-label="${esc(titel)}"><title>${esc(titel)}</title>` : '>') +
    `<path fill="${esc(farbe)}" d="${qrPfad(module, m)}"/></svg>`
  );
}
