import { describe, expect, it } from 'vitest';
import { adler32, crc32, pngAusMatrix } from './png';
import { qrKodieren } from './qr';

type Matrix = readonly (readonly boolean[])[];

/* ---------- unabhängige Prüfsummen (bitweise, ohne Tabelle) ---------- */

function crcBitweise(d: Uint8Array): number {
  let c = ~0;
  for (const b of d) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function adlerEinfach(d: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of d) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return b * 65536 + a;
}

const u32 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(o);
const text = (d: Uint8Array) => String.fromCharCode(...Array.from(d));

interface Chunk {
  typ: string;
  daten: Uint8Array;
}

/** PNG in Chunks zerlegen und jede CRC prüfen */
function chunks(png: Uint8Array): Chunk[] {
  expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const out: Chunk[] = [];
  let o = 8;
  while (o < png.length) {
    const laenge = u32(png, o);
    const typ = text(png.subarray(o + 4, o + 8));
    const daten = png.subarray(o + 8, o + 8 + laenge);
    expect(u32(png, o + 8 + laenge), `CRC ${typ}`).toBe(crcBitweise(png.subarray(o + 4, o + 8 + laenge)));
    out.push({ typ, daten });
    o += 12 + laenge;
  }
  expect(o).toBe(png.length);
  return out;
}

/** zlib-Strom mit „stored“-Blöcken entpacken (anderes kann der Schreiber nicht) und Adler-32 prüfen */
function entpacken(z: Uint8Array): Uint8Array {
  expect(z[0] & 0x0f).toBe(8); // Deflate
  expect((z[0] * 256 + z[1]) % 31).toBe(0);
  expect(z[1] & 0x20).toBe(0); // kein Wörterbuch
  const teile: number[] = [];
  let o = 2;
  for (;;) {
    const kopf = z[o];
    expect((kopf >> 1) & 3).toBe(0); // stored
    const len = z[o + 1] | (z[o + 2] << 8);
    const nlen = z[o + 3] | (z[o + 4] << 8);
    expect(len ^ nlen).toBe(0xffff);
    for (let i = 0; i < len; i++) teile.push(z[o + 5 + i]);
    o += 5 + len;
    if (kopf & 1) break;
  }
  const roh = Uint8Array.from(teile);
  expect(u32(z, o)).toBe(adlerEinfach(roh));
  expect(o + 4).toBe(z.length);
  return roh;
}

/** PNG lesen (1 Bit, Palette, Filter 0) ⇒ Pixel als Paletten-Index je Zeile */
function lesen(png: Uint8Array) {
  const c = chunks(png);
  expect(c.map((x) => x.typ)).toEqual(['IHDR', 'PLTE', 'IDAT', 'IEND']);
  const ihdr = c[0].daten;
  expect(ihdr.length).toBe(13);
  const breite = u32(ihdr, 0);
  const hoehe = u32(ihdr, 4);
  expect(Array.from(ihdr.subarray(8))).toEqual([1, 3, 0, 0, 0]); // 1 Bit, Palette, Deflate, Filter 0, kein Interlace
  const palette = Array.from(c[1].daten);
  expect(c[3].daten.length).toBe(0);
  const roh = entpacken(c[2].daten);
  const zeile = 1 + Math.ceil(breite / 8);
  expect(roh.length).toBe(zeile * hoehe);
  // jede Zeile mit Filter „None“
  expect(Array.from({ length: hoehe }, (_, y) => roh[y * zeile]).every((f) => f === 0)).toBe(true);
  const pixel = (x: number, y: number) => (roh[y * zeile + 1 + (x >> 3)] >> (7 - (x & 7))) & 1;
  return { breite, hoehe, palette, pixel };
}

function pruefeBild(png: Uint8Array, m: Matrix, px: number, rand: number) {
  const { breite, hoehe, palette, pixel } = lesen(png);
  const n = m.length;
  expect(breite).toBe((n + 2 * rand) * px);
  expect(hoehe).toBe(breite);
  expect(palette).toEqual([0xff, 0xff, 0xff, 0x11, 0x11, 0x11]);
  for (let y = 0; y < hoehe; y++) {
    for (let x = 0; x < breite; x++) {
      const my = Math.floor(y / px) - rand;
      const mx = Math.floor(x / px) - rand;
      const dunkel = my >= 0 && my < n && mx >= 0 && mx < n && m[my][mx];
      if (pixel(x, y) !== (dunkel ? 1 : 0)) throw new Error(`Pixel ${x},${y} falsch`);
    }
  }
}

describe('Prüfsummen', () => {
  it('CRC-32 und Adler-32 mit bekannten Werten', () => {
    const neun = new TextEncoder().encode('123456789');
    expect(crc32(neun)).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe(0x11e60398);
    expect(adler32(new Uint8Array(0))).toBe(1);
    const zufall = Uint8Array.from({ length: 5000 }, (_, i) => (i * 131 + 7) & 0xff);
    expect(crc32(zufall)).toBe(crcBitweise(zufall));
    expect(adler32(zufall)).toBe(adlerEinfach(zufall));
  });
});

describe('PNG aus der Modulmatrix', () => {
  it('Signatur, IHDR, Palette, CRCs; Pixel = Matrix (10 px je Modul)', () => {
    const m = qrKodieren('BCD\n002\n1\nSCT\nCOBADEFFXXX\nMustermann\nDE89370400440532013000\nEUR153.00').module;
    pruefeBild(pngAusMatrix(m), m, 10, 0);
  });

  it('andere Modulgröße und Ruhezone, Breite kein Vielfaches von 8', () => {
    const m = qrKodieren('A').module; // 21 Module
    pruefeBild(pngAusMatrix(m, { modulPx: 3, rand: 4 }), m, 3, 4);
    pruefeBild(pngAusMatrix(m, { modulPx: 1 }), m, 1, 0);
  });

  it('große Bilder: mehrere stored-Blöcke (je ≤ 65 535 Byte)', () => {
    const m = qrKodieren('x'.repeat(331)).module; // Version 13, 69 Module
    const png = pngAusMatrix(m, { modulPx: 12 });
    const idat = chunks(png).find((c) => c.typ === 'IDAT');
    expect(idat?.daten.length ?? 0).toBeGreaterThan(65535);
    pruefeBild(png, m, 12, 0);
  });

  it('ungültige Eingaben', () => {
    expect(() => pngAusMatrix([])).toThrow(RangeError);
    expect(() => pngAusMatrix([[true, false]])).toThrow(RangeError);
    expect(() => pngAusMatrix([[true]], { modulPx: 0 })).toThrow(RangeError);
    expect(() => pngAusMatrix([[true]], { modulPx: 2.5 })).toThrow(RangeError);
    expect(() => pngAusMatrix([[true]], { rand: -1 })).toThrow(RangeError);
  });
});
