/* Kleiner PNG-Schreiber für girocode.png im PDF-Satz (ANLEITUNG §6.6, §7.1): dieselbe Modulmatrix wie die Vorschau.
 * - 1 Bit je Pixel mit Palette (0 = weiß, 1 = Modulfarbe #111111 wie --qr in blatt.css), jedes Modul als N×N Pixel,
 *   damit PDF-Betrachter beim Vergrößern nicht weichzeichnen.
 * - Ohne Kompression: zlib-Strom (RFC 1950) aus „stored“-Blöcken (RFC 1951, je höchstens 65 535 Byte) mit Adler-32,
 *   CRC-32 je Chunk (PNG-Spezifikation). Ein GiroCode (höchstens Version 13 = 69 Module) wird bei 10 px rund 60 KB.
 * Tests: png.test.ts */

/** Pixel je Modul */
export const PNG_MODUL_PX = 10;
/** Farbe der dunklen Module (wie --qr auf dem Blatt) */
const DUNKEL = [0x11, 0x11, 0x11] as const;

const SIGNATUR = [137, 80, 78, 71, 13, 10, 26, 10];
const STORED_MAX = 65535;

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (ISO 3309, wie zlib/PNG) */
export function crc32(daten: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < daten.length; i++) c = CRC_TABELLE[(c ^ daten[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Adler-32 (RFC 1950) */
export function adler32(daten: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < daten.length; i++) {
    a = (a + daten[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib-Strom ohne Kompression */
function zlibOhneKompression(roh: Uint8Array): Uint8Array {
  const bloecke = Math.max(1, Math.ceil(roh.length / STORED_MAX));
  const out = new Uint8Array(2 + bloecke * 5 + roh.length + 4);
  const dv = new DataView(out.buffer);
  // CMF 0x78 (Deflate, 32-KB-Fenster), FLG 0x01: (CMF · 256 + FLG) ist durch 31 teilbar
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let i = 0; i < bloecke; i++) {
    const teil = roh.subarray(i * STORED_MAX, Math.min(roh.length, (i + 1) * STORED_MAX));
    out[o] = i === bloecke - 1 ? 1 : 0; // BFINAL, BTYPE 00 = stored
    dv.setUint16(o + 1, teil.length, true);
    dv.setUint16(o + 3, ~teil.length & 0xffff, true);
    out.set(teil, o + 5);
    o += 5 + teil.length;
  }
  dv.setUint32(o, adler32(roh));
  return out;
}

function chunk(typ: string, daten: Uint8Array): Uint8Array {
  const c = new Uint8Array(12 + daten.length);
  const dv = new DataView(c.buffer);
  dv.setUint32(0, daten.length);
  for (let i = 0; i < 4; i++) c[4 + i] = typ.charCodeAt(i);
  c.set(daten, 8);
  dv.setUint32(8 + daten.length, crc32(c.subarray(4, 8 + daten.length)));
  return c;
}

export interface PngOptionen {
  /** Pixel je Modul (1–64, Standard 10) */
  modulPx?: number;
  /** Ruhezone in Modulen (Standard 0: im PDF sorgt der weiße Rand drumherum dafür) */
  rand?: number;
}

/** Quadratische Modulmatrix (true = dunkel) als PNG-Datei. */
export function pngAusMatrix(module: readonly (readonly boolean[])[], { modulPx = PNG_MODUL_PX, rand = 0 }: PngOptionen = {}): Uint8Array {
  const n = module.length;
  if (!n || module.some((z) => z.length !== n)) throw new RangeError('PNG: Die Matrix muss quadratisch sein.');
  if (!Number.isInteger(modulPx) || modulPx < 1 || modulPx > 64) throw new RangeError('PNG: 1 bis 64 Pixel je Modul.');
  if (!Number.isInteger(rand) || rand < 0 || rand > 16) throw new RangeError('PNG: Ruhezone 0 bis 16 Module.');

  const breite = (n + 2 * rand) * modulPx;
  const zeilenBytes = 1 + Math.ceil(breite / 8); // Filterbyte 0 („None“) + Pixel
  const roh = new Uint8Array(zeilenBytes * breite);
  for (let y = 0; y < breite; y++) {
    const zeile = module[Math.floor(y / modulPx) - rand] as readonly boolean[] | undefined;
    if (!zeile) continue; // Ruhezone: hell
    const o = y * zeilenBytes + 1;
    for (let x = 0; x < breite; x++) {
      if (zeile[Math.floor(x / modulPx) - rand]) roh[o + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, breite);
  dv.setUint32(4, breite);
  ihdr[8] = 1; // Bittiefe
  ihdr[9] = 3; // Farbtyp: Palette; Kompression, Filter, Interlace = 0
  const teile = [
    Uint8Array.from(SIGNATUR),
    chunk('IHDR', ihdr),
    chunk('PLTE', Uint8Array.of(0xff, 0xff, 0xff, ...DUNKEL)),
    chunk('IDAT', zlibOhneKompression(roh)),
    chunk('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(teile.reduce((s, t) => s + t.length, 0));
  let o = 0;
  for (const t of teile) {
    png.set(t, o);
    o += t.length;
  }
  return png;
}
