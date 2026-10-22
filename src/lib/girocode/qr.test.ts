import { describe, expect, it } from 'vitest';
import { BEISPIEL_FIRMA, testbeleg } from '../vorlagen/beispiel';
import { girocodeFuer } from './girocode';
import { qrKodieren, qrPfad, qrSvg } from './qr';

type Matrix = readonly (readonly boolean[])[];

/* ---------- Tabellen aus ISO/IEC 18004 (unabhängig vom Encoder abgeschrieben), Version 1–14 ---------- */

/** Codewörter gesamt (Tabelle 1) */
const CODEWOERTER = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581];
/** Restbits nach den Codewörtern (Tabelle 1) */
const RESTBITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0, 0, 0, 0, 3];
/** Stufe M: [EC-Codewörter je Block, Anzahl Blöcke] (Tabelle 9) */
const BLOECKE_M: readonly (readonly [number, number])[] = [
  [0, 0], [10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4], [18, 4], [22, 4], [22, 5], [26, 5], [30, 5], [22, 8], [22, 9], [24, 9],
];
/** Byte-Kapazität bei Stufe M (Tabelle 7) */
const KAPAZITAET_M = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362];
/** Mittelpunkte der Ausrichtungsmuster (Anhang E) */
const AUSRICHTUNG: readonly (readonly number[])[] = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58],
  [6, 34, 62], [6, 26, 46, 66],
];

/* ---------- Hilfen ---------- */

/** GF(256) mit x⁸ + x⁴ + x³ + x² + 1, ohne Tabellen (anders als der Encoder) */
function gfMal(a: number, b: number): number {
  let p = 0;
  while (b) {
    if (b & 1) p ^= a;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
    b >>= 1;
  }
  return p;
}

/** Rest einer Polynomdivision über GF(2) (BCH-Prüfung von Format- und Versionsinfo) */
function polyRest(wert: number, generator: number): number {
  const grad = (x: number) => 31 - Math.clz32(x);
  while (wert && grad(wert) >= grad(generator)) wert ^= generator << (grad(wert) - grad(generator));
  return wert;
}

/** Masken nach der Norm: i = Zeile, j = Spalte */
const MASKE: readonly ((i: number, j: number) => boolean)[] = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (_, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
];

/** Funktionsbereiche (Finder + Trenner + Formatinfo, Timing, Ausrichtung, Versionsinfo) */
function funktionsBereiche(v: number): boolean[][] {
  const n = 4 * v + 17;
  const f = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const rechteck = (x0: number, y0: number, b: number, h: number) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + b; x++) f[y][x] = true;
  };
  rechteck(0, 0, 9, 9);
  rechteck(n - 8, 0, 8, 9);
  rechteck(0, n - 8, 9, 8);
  rechteck(6, 0, 1, n);
  rechteck(0, 6, n, 1);
  const a = AUSRICHTUNG[v];
  const letzte = a[a.length - 1];
  for (const ay of a) {
    for (const ax of a) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === letzte) || (ax === letzte && ay === 6)) continue;
      rechteck(ax - 2, ay - 2, 5, 5);
    }
  }
  if (v >= 7) {
    rechteck(n - 11, 0, 3, 6);
    rechteck(0, n - 11, 6, 3);
  }
  return f;
}

/** 15 Bit Formatinfo (Bit 0 … 14) aus Kopie 1 (um den Finder oben links) oder Kopie 2 (rechts oben/links unten) */
function formatWort(m: Matrix, kopie: 1 | 2): number {
  const n = m.length;
  const pos: [number, number][] = [];
  if (kopie === 1) {
    for (let i = 0; i <= 5; i++) pos.push([8, i]);
    pos.push([8, 7], [8, 8], [7, 8]);
    for (let i = 9; i < 15; i++) pos.push([14 - i, 8]);
  } else {
    for (let i = 0; i < 8; i++) pos.push([n - 1 - i, 8]);
    for (let i = 8; i < 15; i++) pos.push([8, n - 15 + i]);
  }
  return pos.reduce((w, [x, y], i) => w | ((m[y][x] ? 1 : 0) << i), 0);
}

/** 18 Bit Versionsinfo aus dem Block oben rechts bzw. unten links */
function versionsWort(m: Matrix, untenLinks: boolean): number {
  const n = m.length;
  let w = 0;
  for (let i = 0; i < 18; i++) {
    const a = n - 11 + (i % 3);
    const b = Math.floor(i / 3);
    if (untenLinks ? m[a][b] : m[b][a]) w |= 1 << i;
  }
  return w;
}

interface Dekodiert {
  version: number;
  stufe: number;
  maske: number;
  text: string;
}

/** Kleiner Decoder für Byte-Modus und Stufe M: Formatinfo, Demaskieren, Zickzack, Blöcke, Reed-Solomon, Daten. */
function dekodiere(m: Matrix): Dekodiert {
  const n = m.length;
  const v = (n - 17) / 4;
  expect(Number.isInteger(v) && v >= 1 && v <= 14, `Kantenlänge ${n}`).toBe(true);
  for (const z of m) expect(z.length).toBe(n);

  // Formatinfo: beide Kopien gleich, BCH(15,5) gültig
  const f1 = formatWort(m, 1);
  expect(formatWort(m, 2)).toBe(f1);
  const format = f1 ^ 0x5412;
  expect(polyRest(format, 0x537)).toBe(0);
  const stufe = format >> 13;
  const maske = (format >> 10) & 7;

  // Versionsinfo ab V7: beide Blöcke gleich, BCH(18,6) gültig
  if (v >= 7) {
    const w = versionsWort(m, false);
    expect(versionsWort(m, true)).toBe(w);
    expect(w >> 12).toBe(v);
    expect(polyRest(w, 0x1f25)).toBe(0);
  }

  // Demaskieren und Bits im Zickzack lesen (Spaltenpaare von rechts, abwechselnd hoch/runter, Spalte 6 aus)
  const fb = funktionsBereiche(v);
  const bits: number[] = [];
  let hoch = true;
  for (let rechts = n - 1; rechts >= 1; rechts -= 2) {
    if (rechts === 6) rechts = 5;
    for (let k = 0; k < n; k++) {
      const y = hoch ? n - 1 - k : k;
      for (const x of [rechts, rechts - 1]) {
        if (fb[y][x]) continue;
        bits.push(m[y][x] !== MASKE[maske](y, x) ? 1 : 0);
      }
    }
    hoch = !hoch;
  }
  expect(bits.length).toBe(CODEWOERTER[v] * 8 + RESTBITS[v]);
  const cw: number[] = [];
  for (let i = 0; i < CODEWOERTER[v]; i++) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i * 8 + k];
    cw.push(b);
  }

  // Blöcke entschränken (kurze Blöcke zuerst) und Reed-Solomon prüfen: alle Syndrome S0 … S(ec−1) = 0
  const [ec, nb] = BLOECKE_M[v];
  const kurz = Math.floor(CODEWOERTER[v] / nb) - ec;
  const nKurz = nb - (CODEWOERTER[v] % nb);
  const datenLaenge = (k: number) => kurz + (k < nKurz ? 0 : 1);
  const bloecke = Array.from({ length: nb }, (): number[] => []);
  let p = 0;
  for (let i = 0; i <= kurz; i++) for (let k = 0; k < nb; k++) if (i < datenLaenge(k)) bloecke[k].push(cw[p++]);
  for (let i = 0; i < ec; i++) for (let k = 0; k < nb; k++) bloecke[k].push(cw[p++]);
  expect(p).toBe(CODEWOERTER[v]);
  for (const blk of bloecke) {
    const syndrome: number[] = [];
    for (let j = 0, alpha = 1; j < ec; j++, alpha = gfMal(alpha, 2)) {
      let s = 0;
      for (const c of blk) s = gfMal(s, alpha) ^ c;
      syndrome.push(s);
    }
    expect(syndrome.every((s) => s === 0)).toBe(true);
  }

  // Datenbits: Modus Byte (0100), Länge, Bytes; danach Terminator, Nullen bis zur Bytegrenze, Füllbytes EC/11
  const daten = bloecke.flatMap((b, k) => b.slice(0, datenLaenge(k)));
  let pos = 0;
  const lies = (anzahl: number) => {
    let w = 0;
    for (let i = 0; i < anzahl; i++, pos++) w = (w << 1) | ((daten[pos >> 3] >> (7 - (pos & 7))) & 1);
    return w;
  };
  expect(lies(4)).toBe(0b0100);
  const laenge = lies(v < 10 ? 8 : 16);
  const bytes = new Uint8Array(laenge);
  for (let i = 0; i < laenge; i++) bytes[i] = lies(8);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const ende = daten.length * 8;
  expect(lies(Math.min(4, ende - pos))).toBe(0);
  if (pos % 8) expect(lies(8 - (pos % 8))).toBe(0);
  for (let i = 0; pos < ende; i++) expect(lies(8)).toBe(i % 2 ? 0x11 : 0xec);

  return { version: v, stufe, maske, text };
}

/** Text mit genau `n` Bytes (gemischte ASCII-Zeichen, deterministisch) */
const textMit = (n: number) => Array.from({ length: n }, (_, i) => 'ABCxyz0189 -.:/\n'[(i * 7 + 3) % 16]).join('');

/** kleinste Version, deren Kapazität (Stufe M) reicht */
const sollVersion = (bytes: number) => KAPAZITAET_M.findIndex((k, v) => v > 0 && k >= bytes);

/* ---------- Tests ---------- */

describe('QR-Encoder: Aufbau', () => {
  it('Kantenlänge 4 · Version + 17, Finder mit Trenner, Timing, dunkles Modul', () => {
    for (const laenge of [5, 60, 200]) {
      const q = qrKodieren(textMit(laenge));
      const m = q.module;
      const n = m.length;
      expect(n).toBe(q.groesse);
      expect(n).toBe(4 * q.version + 17);
      for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) expect(m[cy + dy][cx + dx]).toBe(Math.max(Math.abs(dx), Math.abs(dy)) !== 2);
        }
      }
      // Trenner hell
      for (let i = 0; i < 8; i++) {
        expect(m[7][i]).toBe(false);
        expect(m[i][7]).toBe(false);
        expect(m[7][n - 1 - i]).toBe(false);
        expect(m[n - 8][i]).toBe(false);
      }
      for (let i = 8; i < n - 8; i++) {
        expect(m[6][i]).toBe(i % 2 === 0);
        expect(m[i][6]).toBe(i % 2 === 0);
      }
      expect(m[n - 8][8]).toBe(true);
    }
  });

  it('Ausrichtungsmuster an den Positionen aus Anhang E', () => {
    for (const laenge of [30, 130, 300]) {
      const q = qrKodieren(textMit(laenge));
      const a = AUSRICHTUNG[q.version];
      const letzte = a[a.length - 1];
      for (const ay of a) {
        for (const ax of a) {
          if ((ax === 6 && ay === 6) || (ax === 6 && ay === letzte) || (ax === letzte && ay === 6)) continue;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) expect(q.module[ay + dy][ax + dx]).toBe(Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }
  });

  it('Datenbereich = Codewörter · 8 + Restbits (Tabelle 1)', () => {
    // prüft die Tabellen dieses Tests gegeneinander (der Decoder unten verlässt sich darauf)
    for (let v = 1; v <= 14; v++) {
      const frei = funktionsBereiche(v).reduce((s, z) => s + z.filter((x) => !x).length, 0);
      expect(frei, `Version ${v}`).toBe(CODEWOERTER[v] * 8 + RESTBITS[v]);
      const [ec, nb] = BLOECKE_M[v];
      // Datencodewörter − 2 bzw. 3 Byte für Modus und Länge = Byte-Kapazität (Tabelle 7)
      expect(CODEWOERTER[v] - ec * nb - (v < 10 ? 2 : 3), `Version ${v}`).toBe(KAPAZITAET_M[v]);
    }
  });

  it('Versionsinfo V7 = 0x07C94 (Tabelle D.1)', () => {
    const q = qrKodieren(textMit(110));
    expect(q.version).toBe(7);
    expect(versionsWort(q.module, false)).toBe(0x07c94);
    expect(versionsWort(q.module, true)).toBe(0x07c94);
  });

  it('Formatinfo Stufe M, Maske 0 = 0x5412 (nur die Maske)', () => {
    const q = qrKodieren('GiroCode', { maske: 0 });
    expect(formatWort(q.module, 1)).toBe(0x5412);
    expect(formatWort(q.module, 2)).toBe(0x5412);
  });

  it('zu lang für Version 40 ⇒ Fehler', () => {
    expect(() => qrKodieren('x'.repeat(2332))).toThrow(/zu lang/);
    expect(qrKodieren('x'.repeat(2331)).version).toBe(40);
  });
});

describe('QR-Encoder: Rück-Dekodierung', () => {
  it('verschiedene Längen und Versionen 1–13 (kleinste passende Version)', () => {
    for (const laenge of [0, 1, 14, 15, 26, 27, 42, 62, 63, 84, 106, 107, 122, 152, 153, 180, 181, 213, 251, 252, 287, 300, 331]) {
      const text = textMit(laenge);
      const q = qrKodieren(text);
      const d = dekodiere(q.module);
      expect(d.text, `Länge ${laenge}`).toBe(text);
      expect(d.version, `Länge ${laenge}`).toBe(Math.max(1, sollVersion(laenge)));
      expect(d.stufe).toBe(0); // M
      expect(d.maske).toBe(q.maske);
    }
  });

  it('alle acht Masken', () => {
    const text = 'BCD\n002\n1\nSCT\nCOBADEFFXXX\nMüller & Söhne\nDE89370400440532013000\nEUR153.00\n\n\nRE-2026-014';
    for (let maske = 0; maske < 8; maske++) {
      const q = qrKodieren(text, { maske });
      expect(q.maske).toBe(maske);
      const d = dekodiere(q.module);
      expect(d.maske).toBe(maske);
      expect(d.text).toBe(text);
    }
  });

  it('UTF-8: Umlaute, €, Gedankenstrich zählen als Bytes', () => {
    const text = 'Grüße – 5 € für Müller & Söhne 100%';
    const q = qrKodieren(text);
    expect(dekodiere(q.module).text).toBe(text);
    const bytes = new TextEncoder().encode('ä'.repeat(8)).length; // 16 Byte ⇒ Version 2
    expect(qrKodieren('ä'.repeat(8)).version).toBe(sollVersion(bytes));
  });

  it('GiroCode der Testrechnung lässt sich lesen', () => {
    const doc = { ...testbeleg('rechnung', BEISPIEL_FIRMA, 'klein', '2026-10-18'), nummer: 'RE-2026-014' };
    const g = girocodeFuer(doc);
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const d = dekodiere(g.matrix);
    expect(d.text).toBe(g.payload);
    expect(d.text.split('\n')).toEqual([
      'BCD',
      '002',
      '1',
      'SCT',
      'COBADEFFXXX',
      'Mustermann Haus- & Gartenservice',
      'DE89370400440532013000',
      'EUR162.98',
      '',
      '',
      'RE-2026-014',
    ]);
  });

  it('gleicher Text ⇒ gleiche Matrix', () => {
    expect(qrKodieren('RE-2026-014').module).toEqual(qrKodieren('RE-2026-014').module);
  });
});

describe('SVG', () => {
  it('Pfad deckt genau die dunklen Module ab', () => {
    const q = qrKodieren('BCD\n002\n1\nSCT');
    const n = q.groesse;
    const nach = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
    for (const t of qrPfad(q.module).matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      const [x, y, b, zurueck] = [t[1], t[2], t[3], t[4]].map(Number);
      expect(zurueck).toBe(b);
      for (let i = 0; i < b; i++) {
        expect(nach[y][x + i]).toBe(false);
        nach[y][x + i] = true;
      }
    }
    expect(nach).toEqual(q.module);
  });

  it('Rand verschiebt den Pfad, viewBox und crispEdges', () => {
    const q = qrKodieren('A');
    const svg = qrSvg(q.module, { rand: 4, titel: 'Giro <Code>' });
    expect(svg).toContain(`viewBox="0 0 ${q.groesse + 8} ${q.groesse + 8}"`);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('fill="currentColor"');
    expect(svg).toContain('aria-label="Giro &#60;Code&#62;"');
    expect(svg).toContain('d="M4 4h7');
    const ohne = qrSvg(q.module);
    expect(ohne).toContain(`viewBox="0 0 ${q.groesse} ${q.groesse}"`);
    expect(ohne).toContain('d="M0 0h7');
  });
});
