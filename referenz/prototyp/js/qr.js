/* Kladdy – Prototyp · QR-Code (GiroCode/EPC)
 * Abhängigkeitsfreier QR-Encoder nach ISO/IEC 18004: Byte-Modus (UTF-8), Version 1–40,
 * Fehlerkorrektur L/M/Q/H, Reed-Solomon über GF(256), alle 8 Masken mit Strafpunkt-Wertung.
 * Dazu SVG-Ausgabe und EPC069-12-Payload („GiroCode“ für SEPA-Überweisungen per Banking-App).
 * Achtung: epc({ betrag }) erwartet EURO (z. B. 1280 oder 1280.5), nicht Cent.
 */
window.QR = (() => {
  'use strict';

  /* ---------- Tabellen (Index = Version 1–40, Index 0 unbenutzt) ---------- */
  const ECL = { L: 0, M: 1, Q: 2, H: 3 };
  const ECL_BITS = [1, 0, 3, 2]; // Kennung der Stufe in der Formatinfo (L, M, Q, H)
  // EC-Codewörter je Block
  const ECC_LEN = [
    [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  // Anzahl Fehlerkorrektur-Blöcke
  const BLOCKS = [
    [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];

  /* ---------- Galois-Feld GF(256), Primitivpolynom 0x11D ---------- */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = EXP[i + 255] = x; LOG[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11D;
  }
  const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

  /* ---------- Reed-Solomon ---------- */
  // Generator (x − α⁰)(x − α¹)…(x − αⁿ⁻¹): Koeffizienten absteigend, führende 1 weggelassen
  const rsGen = (n) => {
    const g = new Array(n).fill(0); g[n - 1] = 1;
    for (let i = 0, root = 1; i < n; i++, root = mul(root, 2)) {
      for (let j = 0; j < n; j++) g[j] = mul(g[j], root) ^ (j + 1 < n ? g[j + 1] : 0);
    }
    return g;
  };
  // Rest der Polynomdivision = EC-Codewörter
  const rsRem = (data, g) => {
    const r = new Array(g.length).fill(0);
    for (const b of data) {
      const f = b ^ r.shift(); r.push(0);
      g.forEach((c, i) => { r[i] ^= mul(c, f); });
    }
    return r;
  };

  /* ---------- Geometrie & Kapazität ---------- */
  // Module für Daten + EC (alles außer Funktionsmustern, Format- und Versionsinfo)
  const rawModules = (v) => {
    let n = (16 * v + 128) * v + 64;
    if (v >= 2) {
      const a = Math.floor(v / 7) + 2;
      n -= (25 * a - 10) * a - 55;
      if (v >= 7) n -= 36;
    }
    return n;
  };
  const dataBytes = (v, e) => (rawModules(v) >> 3) - ECC_LEN[e][v] * BLOCKS[e][v];
  // Mittelpunkte der Ausrichtungsmuster (je Achse)
  const alignPos = (v) => {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2;
    const step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const res = [6];
    for (let p = v * 4 + 10; res.length < n; p -= step) res.splice(1, 0, p);
    return res;
  };

  /* ---------- Masken (x = Spalte, y = Zeile) ---------- */
  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
  ];

  // Strafpunkte N1–N4 (ISO 18004, Tabelle 11)
  const count = (s, re) => (s.match(re) || []).length;
  const penalty = (mod) => {
    const size = mod.length;
    const rows = mod.map((r) => r.map(Number).join(''));
    const cols = rows.map((_, x) => rows.map((r) => r[x]).join(''));
    let p = 0;
    for (const line of rows.concat(cols)) {
      for (const run of line.match(/0{5,}|1{5,}/g) || []) p += run.length - 2; // N1: 3 + (Länge − 5)
      // N3: 1:1:3:1:1 mit 4 hellen Modulen davor oder danach (Rand = Ruhezone = hell), je Vorkommen einmal
      const s = `0000${line}0000`;
      p += (count(s, /(?=00001011101|10111010000)/g) - count(s, /(?=000010111010000)/g)) * 40;
    }
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = rows[y][x];
        if (c === rows[y][x + 1] && c === rows[y + 1][x] && c === rows[y + 1][x + 1]) p += 3; // N2
      }
    }
    const dark = rows.join('').split('1').length - 1, total = size * size;
    return p + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10; // N4: je 5 % Abweichung
  };

  /* ---------- Encoder ---------- */
  const encode = (text, { ecl = 'M', minVersion = 1, mask = -1 } = {}) => {
    const e = ECL[String(ecl).toUpperCase()];
    if (e === undefined) throw new Error(`Unbekannte Fehlerkorrektur-Stufe: ${ecl}`);
    const bytes = new TextEncoder().encode(String(text));

    // kleinste passende Version (Zeichenzahl-Feld: 8 Bit bis V9, sonst 16 Bit)
    let v = Math.max(1, Math.min(40, minVersion | 0));
    while (v <= 40 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataBytes(v, e) * 8) v++;
    if (v > 40) throw new Error('Daten zu lang für einen QR-Code');

    // Bitstrom: Modus 0100, Zeichenzahl, Daten, Terminator, Auffüllen auf Byte, Füllbytes EC/11
    const cap = dataBytes(v, e) * 8, bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
    put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

    // Blöcke bilden, EC berechnen, verschränken (kurze Blöcke zuerst)
    const nb = BLOCKS[e][v], eccLen = ECC_LEN[e][v], raw = rawModules(v) >> 3;
    const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb) - eccLen;
    const gen = rsGen(eccLen), dBlocks = [], eBlocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const len = shortLen + (i < nShort ? 0 : 1);
      dBlocks.push(data.slice(k, k + len)); k += len;
      eBlocks.push(rsRem(dBlocks[i], gen));
    }
    const cw = [];
    for (let i = 0; i <= shortLen; i++) dBlocks.forEach((d) => { if (i < d.length) cw.push(d[i]); });
    for (let i = 0; i < eccLen; i++) eBlocks.forEach((b) => cw.push(b[i]));

    // Matrix + Merker für Funktionsmodule
    const size = v * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };

    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); } // Timing
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) { // Finder inkl. Separator
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
          if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
        }
      }
    }
    const ap = alignPos(v), last = ap.length - 1; // Ausrichtung (nicht auf den Findern)
    ap.forEach((ay, i) => ap.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }));

    // Formatinfo: 5 Bit (Stufe + Maske) + BCH(15,5), XOR 0x5412, zweifach; dazu dunkles Modul
    const drawFormat = (m) => {
      const d = (ECL_BITS[e] << 3) | m;
      let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412, bit = (i) => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    drawFormat(0); // reserviert die Bereiche vor dem Platzieren der Daten

    // Versionsinfo ab V7: 6 Bit + BCH(18,6), je ein 6×3-Block oben rechts und unten links
    if (v >= 7) {
      let r = v;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const b = (v << 12) | r;
      for (let i = 0; i < 18; i++) {
        const dark = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3);
        set(a, c, dark); set(c, a, dark);
      }
    }

    // Daten im Zickzack platzieren (Spaltenpaare von rechts, Spalte 6 überspringen); Restbits bleiben hell
    for (let right = size - 1, k = 0; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const up = ((right + 1) & 2) === 0;
      for (let n = 0; n < size; n++) {
        const y = up ? size - 1 - n : n;
        for (let x = right; x > right - 2; x--) {
          if (fn[y][x] || k >= cw.length * 8) continue;
          mod[y][x] = ((cw[k >> 3] >>> (7 - (k & 7))) & 1) === 1; k++;
        }
      }
    }

    // Maske wählen (geringste Strafpunkte) oder erzwungene verwenden
    const applyMask = (m) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x];
    };
    let best = Number.isInteger(mask) && mask >= 0 && mask <= 7 ? mask : -1;
    if (best < 0) {
      let min = Infinity;
      for (let m = 0; m < 8; m++) {
        applyMask(m); drawFormat(m);
        const p = penalty(mod);
        if (p < min) { min = p; best = m; }
        applyMask(m); // zurücknehmen (XOR)
      }
    }
    applyMask(best); drawFormat(best);
    return { version: v, size, ecl: 'LMQH'[e], mask: best, modules: mod };
  };

  /* ---------- SVG ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  // Ein <path> für alle dunklen Module (waagerechte Läufe zusammengefasst); Größe per CSS
  const toSVG = (text, { ecl = 'M', margin = 4, dark = 'currentColor', light = null, title = '', ...opts } = {}) => {
    const { size, modules } = encode(text, { ecl, ...opts });
    const m = Math.max(0, margin | 0), n = size + m * 2;
    let d = '';
    modules.forEach((row, y) => {
      for (let x = 0; x < size; x++) {
        if (!row[x]) continue;
        const x0 = x;
        while (x < size && row[x]) x++;
        d += `M${x0 + m} ${y + m}h${x - x0}v1h-${x - x0}z`;
      }
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img"`
      + (title ? ` aria-label="${esc(title)}"><title>${esc(title)}</title>` : '>')
      + (light ? `<rect width="${n}" height="${n}" fill="${esc(light)}"/>` : '')
      + `<path fill="${esc(dark)}" d="${d}"/></svg>`;
  };

  /* ---------- IBAN ---------- */
  const compact = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase();
  // Rest mod 97 einer alphanumerischen Zeichenkette (A = 10 … Z = 35), ziffernweise
  const mod97 = (s) => [...s].reduce((r, c) => { const n = parseInt(c, 36); return ((n > 9 ? r * 100 : r * 10) + n) % 97; }, 0);
  const ibanValid = (iban) => {
    const s = compact(iban);
    return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s) && mod97(s.slice(4) + s.slice(0, 4)) === 1;
  };
  const ibanFormat = (iban) => compact(iban).replace(/(.{4})(?=.)/g, '$1 ');

  /* ---------- EPC069-12 „GiroCode“ (Version 002, UTF-8, SCT) ---------- */
  const epc = ({ name, iban, bic = '', betrag, zweck = '', referenz = '' } = {}) => {
    const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
    const len = (s) => [...s].length;
    const fehler = [], ib = compact(iban), bc = compact(bic), ref = compact(referenz);
    name = clean(name); zweck = clean(zweck);

    if (!name) fehler.push('Name fehlt');
    else if (len(name) > 70) fehler.push('Name zu lang (max. 70 Zeichen)');
    if (!ib) fehler.push('IBAN fehlt');
    else if (!ibanValid(ib)) fehler.push('IBAN ungültig (Prüfsumme)');
    if (bc && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bc)) fehler.push('BIC ungültig');

    // Betrag in Euro; deutsche Schreibweise „1.280,50“ wird akzeptiert. Leer/0 → ohne Betrag
    let summe = '';
    const b = typeof betrag === 'string' && betrag.includes(',') ? betrag.replace(/\./g, '').replace(',', '.') : betrag;
    if (b != null && String(b).trim() !== '' && Number(b) !== 0) {
      const cent = Math.round(Number(b) * 100);
      if (cent >= 1 && cent <= 99999999999) summe = `EUR${(cent / 100).toFixed(2)}`;
      else fehler.push('Betrag ungültig (0,01 bis 999.999.999,99 €)');
    }

    if (ref && zweck) fehler.push('Nur Referenz oder Verwendungszweck angeben, nicht beides');
    if (len(ref) > 35) fehler.push('Referenz zu lang (max. 35 Zeichen)');
    if (len(zweck) > 140) fehler.push('Verwendungszweck zu lang (max. 140 Zeichen)');

    // Zeilen: Kennung, Version, Zeichensatz, Art, BIC, Name, IBAN, Betrag, Zweckcode, Referenz, Text
    const lines = ['BCD', '002', '1', 'SCT', bc, name, ib, summe, '', ref, zweck];
    while (lines[lines.length - 1] === '') lines.pop();
    const payload = lines.join('\n');
    if (new TextEncoder().encode(payload).length > 331) fehler.push('GiroCode zu lang (max. 331 Byte)');
    return { ok: fehler.length === 0, payload: fehler.length ? '' : payload, fehler };
  };

  return { encode, toSVG, epc, ibanValid, ibanFormat };
})();
