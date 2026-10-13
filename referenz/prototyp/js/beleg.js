/* Kladdy – Prototyp · Belegerkennung
 * Liest einen abgelegten Beleg (PDF oder Bild) und schlägt Buchungsfelder vor.
 * Ohne Bibliotheken: kleiner PDF-Textleser (Objekte, Objekt-Streams, FlateDecode über
 * DecompressionStream, ToUnicode-CMaps, WinAnsi) plus Heuristiken für deutsche Rechnungen
 * und Kassenbons. Bilder: nur Dateiname (OCR kommt in der Mac-App).
 * Geld immer in CENT, Datum immer 'YYYY-MM-DD'. Wirft nie – im Zweifel bleiben Felder null.
 */
window.Beleg = (() => {
  'use strict';

  /* ================= Allgemeine Hilfen ================= */
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const zahl = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
  const latin1 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
  const ohneAkzent = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  // Vergleichsformen: Umlaute ausgeschrieben (norm) bzw. ohne Punkte (norm2)
  const norm = (s) => ohneAkzent(String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')).replace(/[^a-z0-9]+/g, ' ').trim();
  const norm2 = (s) => ohneAkzent(String(s || '').toLowerCase().replace(/ß/g, 'ss')).replace(/[^a-z0-9]+/g, ' ').trim();
  const buchstaben = (s) => (String(s || '').match(/[a-zäöüß]/gi) || []).length;
  const mitZeitlimit = (p, ms, ersatz) => new Promise((ok) => {
    const t = setTimeout(() => ok(ersatz), ms);
    p.then((v) => { clearTimeout(t); ok(v); }, () => { clearTimeout(t); ok(ersatz); });
  });

  /* ================= PDF: Dekompression ================= */
  const MAX_ENTPACKT = 40e6, MAX_SEITEN = 30, MAX_RUNS = 60000;

  function verbinde(teile, len) {
    const out = new Uint8Array(len); let p = 0;
    teile.forEach((t) => { out.set(t, p); p += t.length; });
    return out;
  }
  // Ein Format probieren; bei Fehlern bleibt alles bis dahin Entpackte erhalten
  async function entpacke(u8, fmt) {
    let ds;
    try { ds = new DecompressionStream(fmt); } catch (e) { return null; }
    const w = ds.writable.getWriter(), r = ds.readable.getReader();
    const teile = []; let len = 0;
    const lesen = (async () => {
      try {
        for (;;) {
          const { done, value } = await r.read();
          if (done) break;
          teile.push(value); len += value.length;
          if (len > MAX_ENTPACKT) { r.cancel().catch(() => {}); break; }
        }
      } catch (e) { /* Rest verwerfen */ }
    })();
    try {
      // Ende byteweise schreiben: Müll nach dem Stream-Ende kostet so keine Daten
      const n = u8.length, ende = Math.max(0, n - 64);
      for (let i = 0; i < ende; i += 4096) await w.write(u8.subarray(i, Math.min(i + 4096, ende)));
      for (let i = ende; i < n; i++) await w.write(u8.subarray(i, i + 1));
      await w.close();
    } catch (e) { w.abort().catch(() => {}); }
    await lesen;
    return verbinde(teile, len);
  }
  async function inflate(u8) {
    if (typeof DecompressionStream !== 'function' || !u8 || !u8.length) return null;
    let r = await entpacke(u8, 'deflate');
    if (r && r.length) return r;
    r = await entpacke(u8, 'deflate-raw');
    if (r && r.length) return r;
    if (u8.length > 2) r = await entpacke(u8.subarray(2), 'deflate-raw');
    return r && r.length ? r : null;
  }
  const ahx = (u8) => {
    const h = latin1(u8).split('>')[0].replace(/[^0-9a-fA-F]/g, '');
    const o = new Uint8Array(Math.ceil(h.length / 2));
    for (let i = 0; i < o.length; i++) o[i] = parseInt(h[2 * i] + (h[2 * i + 1] || '0'), 16);
    return o;
  };
  function a85(u8) {
    let s = latin1(u8).replace(/\s/g, '');
    const e = s.indexOf('~>'); if (e >= 0) s = s.slice(0, e);
    s = s.replace(/^<~/, '');
    const out = []; let g = [];
    const block = (k) => { let v = 0; for (const x of g) v = v * 85 + x; out.push(...[v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255].slice(0, k)); };
    for (const ch of s) {
      if (ch === 'z' && !g.length) { out.push(0, 0, 0, 0); continue; }
      const c = ch.charCodeAt(0) - 33; if (c < 0 || c > 84) continue;
      g.push(c); if (g.length === 5) { block(4); g = []; }
    }
    if (g.length > 1) { const k = g.length - 1; while (g.length < 5) g.push(84); block(k); }
    return new Uint8Array(out);
  }

  /* ================= PDF: Lexer ================= */
  class Ref { constructor(n) { this.n = n; } }
  class Str { constructor(s) { this.s = s; } }
  class Op { constructor(v) { this.v = v; } }
  const istDict = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === null;
  const WS = new Uint8Array(256); [0, 9, 10, 12, 13, 32].forEach((c) => { WS[c] = 1; });
  const DL = new Uint8Array(256); '()<>[]{}/%'.split('').forEach((c) => { DL[c.charCodeAt(0)] = 1; });
  const trenner = (c) => c < 256 && (WS[c] || DL[c]);
  const RE_ZAHL = /[+-]?(?:\d+\.?\d*|\.\d+)/y;
  const RE_REF = /\s+(\d+)\s+R(?=[\s()<>[\]{}/%]|$)/y;

  class Leser {
    constructor(s, p = 0) { this.s = s; this.p = p; }
    ws() {
      const s = this.s, n = s.length; let p = this.p;
      while (p < n) {
        const c = s.charCodeAt(p);
        if (c < 256 && WS[c]) p++;
        else if (c === 37) { while (p < n && s.charCodeAt(p) !== 10 && s.charCodeAt(p) !== 13) p++; }
        else break;
      }
      this.p = p;
    }
    // Nächster Wert; Operatoren als Op, Dateiende als undefined
    wert(tiefe = 0) {
      this.ws();
      const s = this.s, p = this.p;
      if (p >= s.length) return undefined;
      if (tiefe > 64) { this.p = s.length; return undefined; }
      const c = s[p], k = s.charCodeAt(p);
      if (c === '/') return this.name();
      if (c === '(') return this.literal();
      if (c === '<') {
        if (s[p + 1] === '<') { this.p = p + 2; return this.dict(tiefe); }
        return this.hex();
      }
      if (c === '[') { this.p = p + 1; return this.array(tiefe); }
      if ((k >= 48 && k <= 57) || c === '+' || c === '-' || c === '.') {
        RE_ZAHL.lastIndex = p;
        const m = RE_ZAHL.exec(s);
        if (m) {
          this.p = p + m[0].length;
          const v = parseFloat(m[0]);
          if (k >= 48 && k <= 57 && m[0].indexOf('.') < 0) {
            RE_REF.lastIndex = this.p;
            if (RE_REF.exec(s)) { this.p = RE_REF.lastIndex; return new Ref(v); }
          }
          return isFinite(v) ? v : 0;
        }
      }
      let q = p;
      while (q < s.length && !trenner(s.charCodeAt(q))) q++;
      if (q === p) { this.p = p + 1; return new Op(c); }
      this.p = q;
      const w = s.slice(p, q);
      if (w === 'true') return true;
      if (w === 'false') return false;
      if (w === 'null') return null;
      return new Op(w);
    }
    name() {
      const s = this.s; let q = this.p + 1;
      while (q < s.length && !trenner(s.charCodeAt(q))) q++;
      let n = s.slice(this.p + 1, q); this.p = q;
      if (n.indexOf('#') >= 0) n = n.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      return '/' + n;
    }
    literal() {
      const s = this.s, n = s.length, out = [];
      let p = this.p + 1, tiefe = 1;
      while (p < n) {
        const c = s[p++];
        if (c === '\\') {
          const e = s[p++];
          if (e === 'n') out.push('\n'); else if (e === 'r') out.push('\r'); else if (e === 't') out.push('\t');
          else if (e === 'b') out.push('\b'); else if (e === 'f') out.push('\f');
          else if (e === '\r') { if (s[p] === '\n') p++; }
          else if (e === '\n') { /* Zeilenfortsetzung */ }
          else if (e >= '0' && e <= '7') {
            let o = e;
            while (o.length < 3 && s[p] >= '0' && s[p] <= '7') o += s[p++];
            out.push(String.fromCharCode(parseInt(o, 8) & 255));
          } else if (e !== undefined) out.push(e);
        } else if (c === '(') { tiefe++; out.push(c); }
        else if (c === ')') { if (--tiefe === 0) break; out.push(c); }
        else out.push(c);
      }
      this.p = p;
      return new Str(out.join(''));
    }
    hex() {
      const s = this.s; let e = s.indexOf('>', this.p + 1);
      if (e < 0) e = s.length;
      const h = s.slice(this.p + 1, e).replace(/[^0-9a-fA-F]/g, '');
      this.p = e + 1;
      let out = '';
      for (let i = 0; i < h.length; i += 2) out += String.fromCharCode(parseInt(h[i] + (h[i + 1] || '0'), 16));
      return new Str(out);
    }
    dict(tiefe) {
      const d = Object.create(null), s = this.s;
      for (let i = 0; i < 100000; i++) {
        this.ws();
        if (this.p >= s.length) break;
        if (s[this.p] === '>' && s[this.p + 1] === '>') { this.p += 2; break; }
        const k = this.wert(tiefe + 1);
        if (typeof k !== 'string') { if (k === undefined || k instanceof Op) break; continue; }
        const v = this.wert(tiefe + 1);
        if (v === undefined) break;
        if (v instanceof Op) { if (v.v === '>' && s[this.p] === '>') this.p++; d[k.slice(1)] = null; break; }
        d[k.slice(1)] = v;
      }
      return d;
    }
    array(tiefe) {
      const a = [], s = this.s;
      for (let i = 0; i < 1e6; i++) {
        this.ws();
        if (this.p >= s.length) break;
        if (s[this.p] === ']') { this.p++; break; }
        const v = this.wert(tiefe + 1);
        if (v === undefined || (v instanceof Op && (v.v === 'endobj' || v.v === 'stream'))) break;
        a.push(v);
      }
      return a;
    }
    // Inline-Bild (BI … ID … EI) überspringen
    inlineBild() {
      for (let i = 0; i < 500; i++) { const v = this.wert(); if (v === undefined) return; if (v instanceof Op && v.v === 'ID') break; }
      const re = /\sEI(?=[\s/[<(]|$)/g;
      re.lastIndex = this.p + 1;
      const m = re.exec(this.s);
      this.p = m ? m.index + 3 : this.s.length;
    }
  }

  /* ================= PDF: Zeichenkodierungen ================= */
  const WINANSI = (() => {
    const t = [];
    for (let i = 0; i < 256; i++) t[i] = i < 32 ? '' : String.fromCharCode(i);
    const hi = '€\u0000‚ƒ„…†‡ˆ‰Š‹Œ\u0000Ž\u0000\u0000‘’“”•–—˜™š›œ\u0000žŸ';
    for (let i = 0; i < 32; i++) t[128 + i] = hi[i] === '\u0000' ? '' : hi[i];
    return t;
  })();
  const MACROMAN = (() => {
    const t = WINANSI.slice(0, 128);
    const hi = 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';
    for (let i = 0; i < 128; i++) t[128 + i] = hi[i] || '';
    return t;
  })();
  const GLYPHEN = {
    space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'",
    quoteright: '’', quoteleft: '‘', parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',',
    hyphen: '-', minus: '-', period: '.', slash: '/', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>',
    question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_',
    grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~', Euro: '€', euro: '€',
    Adieresis: 'Ä', Odieresis: 'Ö', Udieresis: 'Ü', adieresis: 'ä', odieresis: 'ö', udieresis: 'ü', germandbls: 'ß',
    eacute: 'é', egrave: 'è', ecircumflex: 'ê', agrave: 'à', aacute: 'á', acircumflex: 'â', ccedilla: 'ç',
    section: '§', degree: '°', endash: '–', emdash: '—', bullet: '•', quotedblleft: '“',
    quotedblright: '”', quotedblbase: '„', quotesinglbase: '‚', ellipsis: '…', periodcentered: '·',
    multiply: '×', copyright: '©', registered: '®', trademark: '™', fi: 'fi', fl: 'fl', nbspace: ' ',
    nonbreakingspace: ' ', sfthyphen: '', twosuperior: '²', threesuperior: '³', mu: 'µ', onehalf: '½', paragraph: '¶',
    guillemotleft: '«', guillemotright: '»', sterling: '£', yen: '¥', cent: '¢', plusminus: '±', divide: '÷'
  };
  const ZIFFERN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  function glyphZeichen(n) {
    if (!n) return null;
    if (n.indexOf('_') > 0) { const t = n.split('_').map(glyphZeichen); return t.every((x) => x != null) ? t.join('') : null; }
    n = n.split('.')[0];
    if (GLYPHEN[n] !== undefined) return GLYPHEN[n];
    const z = ZIFFERN.indexOf(n);
    if (z >= 0) return String(z);
    if (/^[A-Za-z]$/.test(n)) return n;
    if (/^uni(?:[0-9A-Fa-f]{4})+$/.test(n)) return n.slice(3).match(/.{4}/g).map((h) => String.fromCharCode(parseInt(h, 16))).join('');
    const m = /^u([0-9A-Fa-f]{4,6})$/.exec(n);
    if (m) { const cp = parseInt(m[1], 16); return cp <= 0x10ffff ? String.fromCodePoint(cp) : null; }
    return null;
  }
  // ToUnicode-CMap → Map(code → Text)
  function cmap(s) {
    const map = new Map(); let bytes = 0;
    const hexZahl = (h) => parseInt(h.replace(/\s/g, '') || '0', 16);
    const hexLen = (h) => Math.ceil(h.replace(/\s/g, '').length / 2);
    const utf16 = (h) => {
      h = h.replace(/\s/g, '');
      if (h.length <= 2) return String.fromCharCode(parseInt(h || '0', 16));
      let r = '';
      for (let i = 0; i + 4 <= h.length; i += 4) r += String.fromCharCode(parseInt(h.substr(i, 4), 16));
      return r;
    };
    const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(s);
    if (cs) { const m = /<([0-9a-fA-F]+)>/.exec(cs[1]); if (m) bytes = m[1].length / 2; }
    let blk;
    const reChar = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((blk = reChar.exec(s))) {
      const re = /<([0-9a-fA-F\s]*)>\s*<([0-9a-fA-F\s]*)>/g; let m;
      while ((m = re.exec(blk[1]))) { map.set(hexZahl(m[1]), utf16(m[2])); if (!bytes) bytes = hexLen(m[1]); }
    }
    const reRange = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((blk = reRange.exec(s)) && map.size < 300000) {
      const re = /<([0-9a-fA-F\s]*)>\s*<([0-9a-fA-F\s]*)>\s*(?:<([0-9a-fA-F\s]*)>|\[([^\]]*)\])/g; let m;
      while ((m = re.exec(blk[1]))) {
        const lo = hexZahl(m[1]), hi = Math.min(hexZahl(m[2]), lo + 0xffff);
        if (m[3] != null) {
          const b = utf16(m[3]), pre = b.slice(0, -1), last = b.charCodeAt(b.length - 1) || 0;
          for (let c = lo; c <= hi; c++) map.set(c, pre + String.fromCharCode(last + c - lo));
        } else {
          const re2 = /<([0-9a-fA-F\s]*)>/g; let x, i = 0;
          while ((x = re2.exec(m[4])) && lo + i <= hi) map.set(lo + i++, utf16(x[1]));
        }
        if (!bytes) bytes = hexLen(m[1]);
      }
    }
    return { map, bytes };
  }

  /* ================= PDF: Dokument ================= */
  const ID = [1, 0, 0, 1, 0, 0];
  const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  const z6 = (x) => zahl(x);
  const STANDARD_FONT = { zwei: false, map: null, enc: WINANSI, w: null, dw: 500, fm: 1 };

  class Doc {
    constructor(u8) {
      this.u8 = u8; this.s = latin1(u8);
      this.obj = new Map(); this.fontCache = new Map(); this.fontNamen = new Map();
      this.ersatz = null; this.aktiv = new Set();
    }
    // Alle „n g obj“ einsammeln; Streams über /Length (falls stimmig) oder Suche nach endstream
    indexiere() {
      const s = this.s, re = /(\d+)\s+(\d+)\s+obj\b/g; let m;
      while ((m = re.exec(s))) {
        const n = +m[1], L = new Leser(s, re.lastIndex);
        let val;
        try { val = L.wert(); } catch (e) { continue; }
        if (val === undefined) break;
        const e = { val };
        L.ws();
        if (istDict(val) && s.startsWith('stream', L.p)) {
          let a = L.p + 6;
          if (s[a] === '\r') a++;
          if (s[a] === '\n') a++;
          const len = val.Length; let b;
          if (typeof len === 'number' && len >= 0 && a + len <= s.length && /^\s*endstream/.test(s.substr(a + len, 40))) b = a + len;
          else {
            const k = s.indexOf('endstream', a);
            b = k < 0 ? s.length : k;
            if (s[b - 1] === '\n') b--;
            if (s[b - 1] === '\r') b--;
          }
          e.a = a; e.b = Math.max(a, b);
          re.lastIndex = Math.max(re.lastIndex, e.b);
        } else re.lastIndex = Math.max(re.lastIndex, L.p);
        this.obj.set(n, e);
      }
    }
    aufl(v) {
      for (let i = 0; i < 16 && v instanceof Ref; i++) { const e = this.obj.get(v.n); v = e ? e.val : null; }
      return v === undefined ? null : v;
    }
    eintrag(v) { return v instanceof Ref ? this.obj.get(v.n) || null : null; }
    // Stream-Inhalt als latin1-String (gecacht), null bei Bildfiltern oder Fehlern
    daten(e) {
      if (!e || e.a == null) return Promise.resolve(null);
      if (!e.p) {
        e.p = (async () => {
          try {
            let out = this.u8.subarray(e.a, e.b);
            let f = this.aufl(e.val.Filter);
            if (!Array.isArray(f)) f = f ? [f] : [];
            for (const x of f) {
              const n = this.aufl(x);
              if (n === '/FlateDecode' || n === '/Fl') out = await inflate(out);
              else if (n === '/ASCIIHexDecode' || n === '/AHx') out = ahx(out);
              else if (n === '/ASCII85Decode' || n === '/A85') out = a85(out);
              else out = null; // DCT, JPX, CCITT, JBIG2 (Bilder), LZW: nicht benötigt
              if (!out) break;
            }
            return out ? latin1(out) : null;
          } catch (err) { return null; }
        })();
      }
      return e.p;
    }
    // Objekte aus /Type /ObjStm nachtragen (reguläre Objekte haben Vorrang)
    async objektStreams() {
      const liste = [...this.obj.values()].filter((e) => istDict(e.val) && e.val.Type === '/ObjStm' && e.a != null);
      for (const e of liste.slice(0, 500)) {
        const d = await this.daten(e);
        if (!d) continue;
        const N = zahl(this.aufl(e.val.N)), first = zahl(this.aufl(e.val.First));
        const L = new Leser(d.slice(0, first)), paare = [];
        for (let i = 0; i < N * 2; i++) { const v = L.wert(); if (typeof v !== 'number') break; paare.push(v); }
        for (let i = 0; i + 1 < paare.length; i += 2) {
          if (this.obj.has(paare[i])) continue;
          try { const v = new Leser(d, first + paare[i + 1]).wert(); if (v !== undefined) this.obj.set(paare[i], { val: v }); } catch (err) { /* weiter */ }
        }
      }
    }
    // Seitenbaum ab /Root; sonst alle /Type /Page in Objektreihenfolge
    seiten() {
      const liste = [], gesehen = new Set();
      let root = null;
      const rr = /\/Root\s+(\d+)\s+\d+\s+R/g; let m;
      while ((m = rr.exec(this.s))) if (this.obj.has(+m[1])) root = +m[1];
      const lauf = (ref, res, tiefe) => {
        if (tiefe > 40 || liste.length >= MAX_SEITEN) return;
        if (ref instanceof Ref) { if (gesehen.has(ref.n)) return; gesehen.add(ref.n); }
        const d = this.aufl(ref);
        if (!istDict(d)) return;
        const r = d.Resources !== undefined ? d.Resources : res;
        const kids = this.aufl(d.Kids);
        if (Array.isArray(kids)) kids.forEach((k) => lauf(k, r, tiefe + 1));
        else liste.push({ d, res: r });
      };
      if (root != null) { const cat = this.aufl(new Ref(root)); if (istDict(cat)) lauf(cat.Pages, null, 0); }
      if (!liste.length) {
        [...this.obj.entries()].sort((a, b) => a[0] - b[0]).forEach(([, e]) => {
          if (istDict(e.val) && e.val.Type === '/Page' && liste.length < MAX_SEITEN) liste.push({ d: e.val, res: e.val.Resources });
        });
      }
      return liste;
    }
    async seitenZeilen(seite) {
      const c = this.aufl(seite.d.Contents);
      const refs = Array.isArray(c) ? c : [seite.d.Contents], teile = [];
      for (const r of refs) { const d = await this.daten(this.eintrag(r)); if (d) teile.push(d); }
      const runs = [];
      if (teile.length) await this.inhalt(teile.join('\n'), this.aufl(seite.res), ID, runs, 0);
      return zeilenAus(runs);
    }
    /* ---------- Fonts ---------- */
    async fonts(res, src) {
      const m = new Map(), fd = istDict(res) ? this.aufl(res.Font) : null;
      if (istDict(fd)) {
        for (const k of Object.keys(fd)) {
          const f = await this.font(fd[k]);
          m.set(k, f);
          if (!this.fontNamen.has(k)) this.fontNamen.set(k, f);
        }
      }
      // im Inhalt benutzt, aber nicht in den Ressourcen → gleicher Name woanders oder Sammel-CMap
      const re = /\/([^\s/[\]<>(){}%]+)\s+[-+\d.]+\s+Tf/g; let x;
      while ((x = re.exec(src))) if (!m.has(x[1])) m.set(x[1], this.fontNamen.get(x[1]) || await this.ersatzFont());
      return m;
    }
    font(ref) {
      const key = ref instanceof Ref ? ref.n : null;
      if (key != null && this.fontCache.has(key)) return this.fontCache.get(key);
      const p = this.ladeFont(this.aufl(ref)).catch(() => STANDARD_FONT);
      if (key != null) this.fontCache.set(key, p);
      return p;
    }
    async ladeFont(d) {
      const f = { zwei: false, map: null, enc: WINANSI, w: null, dw: 500, fm: 1 };
      if (!istDict(d)) return f;
      if (d.Subtype === '/Type0') {
        f.zwei = true; f.dw = 1000; f.enc = null;
        const desc = this.aufl((this.aufl(d.DescendantFonts) || [])[0]);
        if (istDict(desc)) { f.dw = zahl(this.aufl(desc.DW), 1000); f.w = this.cidBreiten(this.aufl(desc.W)); }
      } else {
        f.enc = this.kodierung(this.aufl(d.Encoding));
        const w = this.aufl(d.Widths), first = zahl(this.aufl(d.FirstChar));
        if (Array.isArray(w)) { f.w = new Map(); w.forEach((x, i) => f.w.set(first + i, zahl(this.aufl(x)))); }
        const fd = this.aufl(d.FontDescriptor);
        if (istDict(fd)) f.dw = zahl(this.aufl(fd.MissingWidth)) || 500;
        if (d.Subtype === '/Type3') { const fm = this.aufl(d.FontMatrix); if (Array.isArray(fm)) f.fm = zahl(fm[0], 0.001) * 1000; }
      }
      const tu = this.eintrag(d.ToUnicode);
      if (tu) { const cm = await this.daten(tu); if (cm) { const c = cmap(cm); if (c.map.size) f.map = c.map; } }
      return f;
    }
    cidBreiten(W) {
      if (!Array.isArray(W)) return null;
      const m = new Map();
      for (let i = 0; i < W.length && m.size < 200000;) {
        const a = zahl(this.aufl(W[i])), b = this.aufl(W[i + 1]);
        if (Array.isArray(b)) { b.forEach((w, k) => m.set(a + k, zahl(this.aufl(w)))); i += 2; }
        else { const c = zahl(this.aufl(W[i + 2])); for (let k = a; k <= zahl(b) && k - a < 65536; k++) m.set(k, c); i += 3; }
      }
      return m;
    }
    kodierung(enc) {
      let basis = WINANSI, diff = null;
      if (enc === '/MacRomanEncoding') basis = MACROMAN;
      else if (istDict(enc)) {
        if (this.aufl(enc.BaseEncoding) === '/MacRomanEncoding') basis = MACROMAN;
        diff = this.aufl(enc.Differences);
      }
      if (!Array.isArray(diff)) return basis;
      const t = basis.slice(); let code = 0;
      for (const x of diff) {
        const v = this.aufl(x);
        if (typeof v === 'number') code = v;
        else if (typeof v === 'string') { const u = glyphZeichen(v.slice(1)); if (u != null && code < 256) t[code] = u; code++; }
      }
      return t;
    }
    // Notlösung: alle ToUnicode-CMaps der Datei zusammengeführt
    ersatzFont() {
      if (!this.ersatz) {
        this.ersatz = (async () => {
          const zwei = new Map(), eins = new Map();
          for (const e of [...this.obj.values()]) {
            const d = e.val;
            if (!istDict(d) || !d.ToUnicode) continue;
            const cm = await this.daten(this.eintrag(d.ToUnicode));
            if (!cm) continue;
            const c = cmap(cm), ziel = c.bytes === 1 ? eins : zwei;
            c.map.forEach((v, k) => { if (!ziel.has(k)) ziel.set(k, v); });
          }
          return { zwei: zwei.size > 0, map: zwei.size ? zwei : eins, enc: WINANSI, w: null, dw: 500, fm: 1 };
        })().catch(() => STANDARD_FONT);
      }
      return this.ersatz;
    }
    /* ---------- Inhalts-Stream auswerten ---------- */
    async inhalt(src, res, ctm, runs, tiefe) {
      const fonts = await this.fonts(res, src);
      const xo = istDict(res) ? this.aufl(res.XObject) : null;
      let gs = { ctm, font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
      const stapel = [], L = new Leser(src);
      let tm = ID, tlm = ID, args = [];
      const td = (x, y) => { tlm = mul([1, 0, 0, 1, x, y], tlm); tm = tlm; };
      for (let i = 0; i < 3e6 && runs.length < MAX_RUNS; i++) {
        const v = L.wert();
        if (v === undefined) break;
        if (!(v instanceof Op)) { if (args.length < 64) args.push(v); continue; }
        const a = args; args = [];
        switch (v.v) {
          case 'q': if (stapel.length < 256) stapel.push(Object.assign({}, gs)); break;
          case 'Q': if (stapel.length) gs = stapel.pop(); break;
          case 'cm': if (a.length === 6) gs.ctm = mul(a.map(z6), gs.ctm); break;
          case 'BT': tm = tlm = ID; break;
          case 'Tf': gs.font = (typeof a[0] === 'string' && fonts.get(a[0].slice(1))) || null; gs.size = zahl(a[1]); break;
          case 'Tc': gs.tc = zahl(a[0]); break;
          case 'Tw': gs.tw = zahl(a[0]); break;
          case 'Tz': gs.th = zahl(a[0], 100) / 100; break;
          case 'TL': gs.tl = zahl(a[0]); break;
          case 'Ts': gs.rise = zahl(a[0]); break;
          case 'Td': td(zahl(a[0]), zahl(a[1])); break;
          case 'TD': gs.tl = -zahl(a[1]); td(zahl(a[0]), zahl(a[1])); break;
          case 'Tm': if (a.length === 6) tlm = tm = a.map(z6); break;
          case 'T*': td(0, -gs.tl); break;
          case 'Tj': tm = this.zeige(a[0], gs, tm, runs); break;
          case "'": td(0, -gs.tl); tm = this.zeige(a[0], gs, tm, runs); break;
          case '"': gs.tw = zahl(a[0]); gs.tc = zahl(a[1]); td(0, -gs.tl); tm = this.zeige(a[2], gs, tm, runs); break;
          case 'TJ':
            if (Array.isArray(a[0])) {
              for (const x of a[0]) {
                if (typeof x === 'number') tm = mul([1, 0, 0, 1, -x / 1000 * gs.size * gs.th, 0], tm);
                else tm = this.zeige(x, gs, tm, runs);
              }
            }
            break;
          case 'Do': await this.form(xo, a[0], gs.ctm, res, runs, tiefe); break;
          case 'BI': L.inlineBild(); break;
          default: break;
        }
      }
    }
    async form(xo, name, ctm, res, runs, tiefe) {
      if (!istDict(xo) || typeof name !== 'string' || tiefe >= 8) return;
      const ref = xo[name.slice(1)], e = this.eintrag(ref);
      if (!e || !istDict(e.val) || e.val.Subtype !== '/Form' || this.aktiv.has(ref.n)) return;
      this.aktiv.add(ref.n);
      try {
        const d = await this.daten(e);
        if (d) {
          const m = this.aufl(e.val.Matrix);
          const c = Array.isArray(m) && m.length === 6 ? mul(m.map((x) => zahl(this.aufl(x))), ctm) : ctm;
          await this.inhalt(d, this.aufl(e.val.Resources) || res, c, runs, tiefe + 1);
        }
      } finally { this.aktiv.delete(ref.n); }
    }
    // Text ausgeben: dekodieren, Breite aufsummieren, Position merken
    zeige(x, gs, tm, runs) {
      if (!(x instanceof Str)) return tm;
      const f = gs.font || STANDARD_FONT, s = x.s;
      let t = '', adv = 0;
      const glyph = (code, u, sp) => {
        t += u;
        const w = f.w ? (f.w.has(code) ? f.w.get(code) : f.dw) : (sp ? 250 : f.dw);
        adv += ((w * f.fm / 1000) * gs.size + gs.tc + (sp ? gs.tw : 0)) * gs.th;
      };
      if (f.zwei) {
        for (let i = 0; i + 1 < s.length; i += 2) { const c = (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1); glyph(c, (f.map && f.map.get(c)) || '', false); }
      } else {
        for (let i = 0; i < s.length; i++) {
          const c = s.charCodeAt(i);
          glyph(c, (f.map && f.map.has(c) ? f.map.get(c) : f.enc ? f.enc[c] : '') || '', c === 32);
        }
      }
      const m0 = mul(tm, gs.ctm), tm2 = mul([1, 0, 0, 1, adv, 0], tm), m1 = mul(tm2, gs.ctm);
      if (t) {
        runs.push({
          x0: m0[4] + gs.rise * m0[2], x1: m1[4] + gs.rise * m1[2], y: m0[5] + gs.rise * m0[3],
          h: Math.abs(gs.size) * Math.hypot(m0[2], m0[3]) || 1, t,
          quer: Math.abs(m0[1]) > Math.abs(m0[0]) * 2 + 1e-9, n: runs.length
        });
      }
      return tm2;
    }
  }

  // Textstücke nach Grundlinie zu Zeilen bündeln; große Lücken = Spaltenwechsel (2 Leerzeichen)
  function zeilenAus(runs) {
    const gerade = runs.filter((r) => !r.quer), quer = runs.filter((r) => r.quer);
    gerade.sort((a, b) => b.y - a.y || a.x0 - b.x0);
    const zeilen = [];
    for (const r of gerade) {
      const z = zeilen[zeilen.length - 1];
      if (z && Math.abs(z.y - r.y) <= Math.max(1, 0.5 * Math.min(z.h, r.h))) z.runs.push(r);
      else zeilen.push({ y: r.y, h: r.h, runs: [r] });
    }
    const out = zeilen.map((z) => {
      z.runs.sort((a, b) => a.x0 - b.x0 || a.n - b.n);
      let s = '', letzter = null, ende = -Infinity;
      for (const r of z.runs) {
        if (letzter) {
          if (r.t === letzter.t && Math.abs(r.x0 - letzter.x0) < 1) continue; // Doppeldruck (Fett-Simulation)
          const luecke = r.x0 - ende, em = Math.max(letzter.h, r.h);
          if (luecke > em * 0.5) s = s.replace(/\s+$/, '') + '  ';
          else if (luecke > em * 0.12 && !/\s$/.test(s) && !/^\s/.test(r.t)) s += ' ';
        }
        s += r.t; letzter = r; ende = Math.max(ende, r.x1);
      }
      return s;
    });
    quer.sort((a, b) => a.n - b.n).forEach((r) => out.push(r.t));
    return out;
  }
  const aufraeumen = (t) => t.normalize('NFKC')
    .replace(/[­​-‏﻿\r]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f�]/g, '')
    .replace(/\t/g, '  ').replace(/[ ]+$/gm, '').replace(/^[ ]+/gm, '')
    .replace(/\n{3,}/g, '\n\n').trim();

  // PDF lesen → { text, pdf (Struktur erkannt), verschluesselt }
  async function lies(buf) {
    const erg = { text: '', pdf: false, verschluesselt: false };
    try {
      if (!buf) return erg;
      const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      if (!u8.length) return erg;
      const doc = new Doc(u8);
      erg.pdf = doc.s.slice(0, 1024).indexOf('%PDF') >= 0;
      if (/\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(doc.s)) { erg.verschluesselt = true; return erg; }
      doc.indexiere();
      if (!doc.obj.size) return erg;
      erg.pdf = true;
      await doc.objektStreams();
      const zeilen = [];
      for (const seite of doc.seiten()) {
        try { zeilen.push(...await doc.seitenZeilen(seite)); } catch (e) { /* Seite überspringen */ }
      }
      erg.text = aufraeumen(zeilen.join('\n'));
    } catch (e) { /* nie werfen */ }
    return erg;
  }

  /* ================= Erkennung: Bausteine ================= */
  // datum = Zahlungsdatum; rechnungsdatum nur gesetzt, wenn ein abweichender Abbuchungstag (Lastschrift) erkannt wurde
  const leer = () => ({ typ: 'ausgabe', betrag: null, datum: null, rechnungsdatum: null, lieferant: null, kontakt: null, rechnungsnr: null, kategorie: null, text: null });
  const MONAT = {
    jan: 1, januar: 1, january: 1, feb: 2, februar: 2, february: 2, mrz: 3, 'mär': 3, 'märz': 3, maerz: 3, mar: 3, march: 3,
    apr: 4, april: 4, mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, dez: 12, dezember: 12, dec: 12, december: 12
  };
  // Plausibler Zeitraum: höchstens ~3 Jahre zurück, 60 Tage voraus
  function grenzen(D) {
    const t = D && /^\d{4}-\d{2}-\d{2}$/.test(D.TODAY) ? D.TODAY : iso(new Date());
    const [y, m, d] = t.split('-').map(Number);
    return { min: iso(new Date(y - 3, m - 1, d)), max: iso(new Date(y, m - 1, d + 60)) };
  }
  function mkDatum(y, m, d, g) {
    y = +y; m = +m; d = +d;
    if (!y || !m || !d) return null;
    if (y < 100) y += 2000;
    if (m > 12 || d > 31) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    const s = iso(dt);
    return s >= g.min && s <= g.max ? s : null;
  }
  const DATUM_MUSTER = [
    [/(?<!\d)(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})(?!\d)/g, (m) => [m[3], m[2], m[1]]],
    [/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g, (m) => [m[1], m[2], m[3]]],
    [/(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/g, (m) => [m[3], m[2], m[1]]],
    [/(?<!\d)(\d{1,2})(?:\.\s?|\s|-)([A-Za-zÄÖÜäöü]{3,9})\.?(?:\s|-)(\d{4})(?!\d)/g, (m) => [m[3], MONAT[m[2].toLowerCase()], m[1]]],
    [/(?<![A-Za-z])([A-Za-z]{3,9})\.?\s(\d{1,2}),?\s(\d{4})(?!\d)/g, (m) => [m[3], MONAT[m[1].toLowerCase()], m[2]]]
  ];
  function datenIn(z, g) {
    const out = [];
    for (const [re, f] of DATUM_MUSTER) {
      re.lastIndex = 0; let m;
      while ((m = re.exec(z))) {
        const t = f(m), d = t[1] ? mkDatum(t[0], t[1], t[2], g) : null;
        if (d && !out.some((o) => m.index < o.end && o.idx < m.index + m[0].length)) out.push({ d, idx: m.index, end: m.index + m[0].length });
      }
    }
    return out.sort((a, b) => a.idx - b.idx);
  }
  // Datum, Uhrzeit, IBAN, Telefon, Steuernummer ausblenden (gleiche Länge → Indizes bleiben gültig)
  const blank = (m) => ' '.repeat(m.length);
  const maskiere = (z) => z
    .replace(/(?<!\d)\d{1,2}\.\s?\d{1,2}\.\s?(?:\d{4}|\d{2})(?!\d)/g, blank)
    .replace(/(?<!\d)\d{4}-\d{1,2}-\d{1,2}(?!\d)/g, blank)
    .replace(/(?<!\d)\d{1,2}\/\d{1,2}\/\d{2,4}(?!\d)/g, blank)
    .replace(/(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/g, blank)
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b/g, blank)
    .replace(/(?:tel|telefon|fax|mobil|hotline|phone)\.?:?\s*[+\d][\d\s/()-]{4,}\d/gi, blank)
    .replace(/(?<!\d)\d{2,3}\/\d{3}\/\d{4,5}(?!\d)/g, blank);

  // Beträge: 1.234,56 · 1234,56 · 1 234,56 · € 59,49 · 59,49 € · EUR 59,49 · 59.49 · 1,234.56
  const RE_GELD = /(?<![\d,A-Za-wyzÄÖÜäöüß])(?<!\d\.)(-\s?)?(EUR\s?|€\s?)?(-\s?)?(\d{1,3}(?:[. ]\d{3})+(?:,\d{2})?|\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+[.,]\d{2}|\d+)(?!\d|[.,]\d)(\s?(?:EUR|€|Euro)(?![A-Za-z]))?/gi;
  const RE_EINHEIT = /^\s?(?:kg|g|m|cm|mm|m2|m3|qm|lfm|l|ml|std|h|stk|st|x|×|km|kwh|kw|uhr|min|gb|mb|tb|tage?|monate?|jahre?|wochen?|seiten?|pcs|%)(?![a-zäöü])/i;
  function geldWert(k) {
    const s = k.replace(/ /g, ''); let m;
    if ((m = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})$/.exec(s))) return { c: +m[1].replace(/\./g, '') * 100 + +m[2], dez: true };
    if ((m = /^(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/.exec(s))) return { c: +m[1].replace(/,/g, '') * 100 + +m[2], dez: true };
    // „1,866“ ist eher ein Literpreis als 1866 € → nur Punkt-Tausender oder ganze Zahlen
    if (/^\d{1,3}(?:\.\d{3})+$/.test(s) || /^\d{1,3}(?:,\d{3}){2,}$/.test(s) || /^\d+$/.test(s)) return { c: +s.replace(/[.,]/g, '') * 100, dez: false };
    return null;
  }
  function geldIn(z) {
    const zz = maskiere(z), out = [];
    RE_GELD.lastIndex = 0; let m;
    while ((m = RE_GELD.exec(zz))) {
      const v = geldWert(m[4]);
      if (!v) continue;
      const cur = !!(m[2] || m[5]);
      if (!v.dez && !cur) continue; // ganze Zahlen nur mit Währung
      if (!m[5] && RE_EINHEIT.test(zz.slice(m.index + m[0].length))) continue; // Menge/Prozent
      if (v.c <= 0 || v.c > 1e10) continue;
      out.push({ c: (m[1] || m[3]) ? -v.c : v.c, idx: m.index + (m[1] || '').length, end: m.index + m[0].length });
    }
    return out;
  }
  // Spalten: Segmente sind durch ≥ 2 Leerzeichen getrennt
  function segmente(z) { const out = [], re = /\S+(?: \S+)*/g; let m; while ((m = re.exec(z))) out.push({ t: m[0], a: m.index, b: m.index + m[0].length }); return out; }
  const hatWort = (s) => /[a-zäöüß]{2,}/i.test(String(s).replace(/\b(?:eur|euro)\b|€/gi, ''));
  // Beschriftung links vom Treffer (nächstes Segment mit Wörtern)
  function labelLinks(z, idx) {
    const segs = z.slice(0, idx).split(/\s{2,}/);
    while (segs.length) { const l = segs.pop(); if (hatWort(l)) return l.trim(); }
    return '';
  }
  // Tabellenkopf in der Zeile darüber (gleiche Spaltenzahl, sonst rechtsbündig zugeordnet)
  function kopfLabel(Z, i, idx) {
    if (!i) return '';
    const k = segmente(Z[i - 1]), w = segmente(Z[i]);
    if (k.length < 2 || !k.every((s) => buchstaben(s.t) >= 2)) return '';
    const j = w.findIndex((s) => idx >= s.a && idx < s.b);
    if (j < 0) return '';
    if (k.length === w.length) return k[j].t;
    if (w.length < k.length) return k[k.length - (w.length - j)].t;
    return '';
  }
  // Beschriftung in eigener Zeile darüber („Gesamtbetrag:“ ↵ „90,40 €“)
  function vorzeile(Z, i, g) {
    const p = i ? Z[i - 1] : '';
    return p && p.length <= 50 && buchstaben(p) >= 3 && !geldIn(p).length && !datenIn(p, g).length ? p : '';
  }

  /* ---------- Betrag ---------- */
  const KW_TOTAL = /gesamtbetrag|rechnungsbetrag|endbetrag|gesamtsumme|endsumme|rechnungssumme|zahlbetrag|zahlungsbetrag|zu\s*zahlen|bruttobetrag|brutto\s*gesamt|gesamt\s*brutto|summe\s*brutto|grand\s*total|total\s*due|amount\s*due|total\s*amount|invoice\s*total|offener\s*betrag/i;
  const KW_SUMME = /summe|gesamt|brutto|total|betrag|endpreis|zahlung|bezahlt|paid|ec-?karte|girocard|kartenzahlung|kreditkarte|visa|mastercard|amount/i;
  const KW_NICHT = /netto|zwischensumme|sub-?total|mwst|\bust\b|umsatzsteuer|mehrwertsteuer|\bvat\b|\btax\b|steuer|rabatt|skonto|nachlass|r[üu]ckgeld|wechselgeld|gegeben|einzelpreis|e-preis|st[üu]ckpreis|unit\s*price|(?:^|\s)à(?:\s|$)|\bje\b|anzahlung|bereits|trinkgeld|versand|pfand|gutschein|guthaben|ersparnis|gespart/i;
  function betragScore(l) {
    const t = l.toLowerCase(), stark = KW_TOTAL.test(t), mittel = KW_SUMME.test(t);
    let s = stark ? 10 : mittel ? 5 : 0;
    if (KW_NICHT.test(t) && !(/inkl|incl|einschl/.test(t) && (stark || mittel))) s -= stark ? 4 : 8;
    return s;
  }
  function findeBetrag(Z, g) {
    const c = [];
    Z.forEach((z, i) => {
      const geld = geldIn(z);
      geld.forEach((x, j) => {
        if (x.c <= 0) return;
        const l = labelLinks(z, x.idx) || kopfLabel(Z, i, x.idx) || vorzeile(Z, i, g);
        c.push({ c: x.c, s: betragScore(l) - (j < geld.length - 1 ? 1 : 0), i, j });
      });
    });
    if (!c.length) return null;
    const anzahl = {};
    c.forEach((x) => { anzahl[x.c] = (anzahl[x.c] || 0) + 1; });
    c.forEach((x) => { if (anzahl[x.c] > 1) x.s += 1; });
    c.sort((a, b) => b.s - a.s || b.i - a.i || b.j - a.j);
    let best = c[0], s = best.s >= 10 ? 'hoch' : best.s >= 4 ? 'mittel' : 'niedrig';
    if (best.s < 4) { // kein Schlüsselwort: größter plausibler Betrag
      const pool = c.filter((x) => x.s > -4);
      best = (pool.length ? pool : c).reduce((m, x) => (x.c > m.c ? x : m));
      s = 'niedrig';
    }
    // Netto + Steuer = Brutto bestätigt
    const w = c.map((x) => x.c);
    if (s !== 'hoch' && w.some((a, k) => a < best.c && w.some((b, l) => l !== k && a + b === best.c))) s = s === 'niedrig' ? 'mittel' : 'hoch';
    return { c: best.c, s };
  }

  /* ---------- Datum ---------- */
  const KW_D_STARK = /rechnungsdatum|rechnungs-datum|belegdatum|kaufdatum|bondatum|quittungsdatum|ausstellungsdatum|invoice\s*date|datum\s*der\s*rechnung|tag\s*der\s*bewirtung|date\s*of\s*issue|issue\s*date/i;
  const KW_D_SCHWACH = /leistungsdatum|lieferdatum|bestelldatum|order\s*date|leistung/i;
  const KW_D = /datum|\bdate\b|\bvom\b/i;
  const KW_D_NICHT = /f[äa]llig|zahlbar|\bdue\b|\bbis\b|zeitraum|period|g[üu]ltig|valid|unterschrift|geburt|ablauf|expir|erfolgte|abbuchung|einzug|lastschrift/i;
  function datumScore(l) {
    const t = l.toLowerCase();
    let s = KW_D_STARK.test(t) ? 10 : KW_D_SCHWACH.test(t) ? 3 : KW_D.test(t) ? 6 : 0;
    if (KW_D_NICHT.test(t)) s -= 8;
    return s;
  }
  function findeDatum(Z, g) {
    const c = [];
    Z.forEach((z, i) => {
      for (const t of datenIn(z, g)) {
        const l = labelLinks(z, t.idx) || kopfLabel(Z, i, t.idx) || vorzeile(Z, i, g);
        let s = datumScore(l) + 2 * (1 - i / Z.length);
        if (/^\s*\d{1,2}:\d{2}/.test(z.slice(t.end))) s += 4; // Kassenbon: Datum + Uhrzeit
        c.push({ d: t.d, s, i });
      }
    });
    if (!c.length) return null;
    c.sort((a, b) => b.s - a.s || a.i - b.i);
    const n = new Set(c.map((x) => x.d)).size;
    return { d: c[0].d, s: c[0].s >= 9 ? 'hoch' : c[0].s >= 5 || n === 1 ? 'mittel' : 'niedrig' };
  }

  /* ---------- Abbuchungsdatum (Lastschrift) ----------
   * „Der Rechnungsbetrag wird am 20.10.2026 von Ihrem Konto abgebucht“, „Abbuchung am …“, „Lastschrift … am …“, „Einzug am …“.
   * Nach § 11 EStG zählt der Abfluss – dieses Datum ist das Zahlungsdatum. „zahlbar bis“/„fällig“ ist nur eine Frist. */
  const KW_ABBUCHUNG = /abgebucht|abbuchung|lastschrift|bankeinzug|eingezogen|\beinzug\b|belastet/i;
  const KW_FRIST = /zahlbar|f[äa]llig|\bbis\b/i;
  function findeAbbuchung(Z, g) {
    for (const z of Z) {
      if (!KW_ABBUCHUNG.test(z) || KW_FRIST.test(z)) continue;
      const d = datenIn(z, g)[0];
      if (d) return d.d;
    }
    return null;
  }

  /* ---------- Rechnungsnummer ---------- */
  const NR_LABEL = [
    [/rechnungs?\s*-?\s*(?:nummer|nr|no)\b\.?|rechnung\s+(?:nr|no|nummer)\b\.?|\bre\.?\s?-?\s?nr\b\.?|invoice\s*(?:no\b\.?|number|nr\b\.?|#|id\b)/i, 10],
    [/beleg\s*-?\s*(?:nummer|nr\b\.?)|\bbon\s*-?\s*(?:nummer|nr\b\.?)|\bbon\b(?=\s*[#:]?\s*\d)|quittungs?\s*-?\s*(?:nummer|nr\b\.?)|kassenbon\s*-?\s*nr\b\.?|receipt\s*(?:no\b\.?|number|#)|transaktions?\s*-?\s*(?:nummer|nr\b\.?)|vorgangs?\s*-?\s*(?:nummer|nr\b\.?)/i, 7],
    [/^rechnung\s+(?=[a-z]{0,5}-?\d)/i, 5],
    [/bestell\s*-?\s*(?:nummer|nr\b\.?)|auftrags?\s*-?\s*(?:nummer|nr\b\.?)|order\s*(?:no\b\.?|number|#|id\b)/i, 3]
  ];
  function nrToken(t) {
    const m = /^#?\s?([A-Za-z0-9][A-Za-z0-9\-/._]*)/.exec(String(t || '').trim());
    if (!m) return null;
    const v = m[1].replace(/[.,;:/-]+$/, '');
    if (!/\d/.test(v) || v.length < 2 || v.length > 32) return null;
    if (/^\d+[,.]\d{2}$/.test(v) || DATUM_MUSTER.some(([re]) => { re.lastIndex = 0; return re.test(v); })) return null; // Betrag/Datum
    return v;
  }
  function nrWert(Z, i, m) {
    const z = Z[i];
    let rest = z.slice(m.index + m[0].length).replace(/^\s?[:#.]?/, '');
    rest = rest.replace(/^\s*\/\s*[A-Za-z][A-Za-z .]*?(?:no|number|nr|nummer)\b\.?\s?[:#]?/i, ''); // „/ Invoice Number:“
    const direkt = nrToken(rest.trim().split(/\s{2,}/)[0]);
    if (direkt) return direkt;
    if (i + 1 >= Z.length) return null;
    const k = segmente(z), w = segmente(Z[i + 1]);
    const j = k.findIndex((s) => m.index >= s.a && m.index < s.b);
    if (k.length > 1 && j >= 0 && k.length === w.length) return nrToken(w[j].t);
    if (k.length === 1) return nrToken((w[0] || {}).t);
    if (j === k.length - 1 && w.length) return nrToken(w[w.length - 1].t);
    return null;
  }
  function findeNummer(Z) {
    let best = null;
    Z.forEach((z, i) => {
      for (const [re, p] of NR_LABEL) {
        if (best && best.p >= p) continue;
        const m = re.exec(z);
        const w = m && nrWert(Z, i, m);
        if (w) best = { w, p };
      }
    });
    return best ? { w: best.w, s: best.p >= 7 ? 'hoch' : 'mittel' } : null;
  }

  /* ---------- Eigene Firma ---------- */
  function eigenTeile(F) {
    return [F.name, F.inhaber, F.strasse, F.email, F.web, F.telefon, F.plz && F.ort ? `${F.plz} ${F.ort}` : '', F.claim, F.steuernummer]
      .filter((x) => x && x.length >= 4).map((x) => x.toLowerCase());
  }
  // Segment gehört zu uns (Name, Adresse, Claim …)?
  const eigenFilter = (F) => {
    const teile = eigenTeile(F);
    return (s) => { const t = String(s || '').toLowerCase().trim(); return !!t && teile.some((p) => t.includes(p) || (t.length >= 6 && p.includes(t))); };
  };
  // Stammt der Beleg von uns (= eigene Rechnung → Einnahme)?
  function eigenerBeleg(Z, F) {
    if (!F || !F.name) return null;
    const t = Z.join('\n'), name = F.name.toLowerCase(), mitName = t.toLowerCase().includes(name);
    let p = 0;
    if (F.steuernummer && t.includes(F.steuernummer)) p += 3;
    if (F.iban && t.replace(/\s+/g, '').toUpperCase().includes(F.iban.toUpperCase())) p += 3;
    if (Z.slice(0, 3).some((z) => z.toLowerCase().startsWith(name))) p += 2; // Briefkopf
    if (p && mitName && /§\s*19\s*UStG|kleinunternehmer/i.test(t)) p += 1;
    return p >= 5 ? 'hoch' : p >= 3 ? 'mittel' : null;
  }

  /* ---------- Kunden (D.KONTAKTE enthält nur Kunden; Geschäfte siehe findeGeschaeft) ---------- */
  const RECHTSFORM_W = /\b(?:gmbh|ag|ug|kg|ohg|gbr|e v|ev|e k|uc|se|ltd|inc|llc|mbh|co)\b/g;
  const musterCache = new WeakMap();
  // Kunden (oft Personennamen) nur über den vollen Namen – einzelne Wörter wie „Anna“ wären zu unsicher
  function kontaktMuster(k) {
    if (musterCache.has(k)) return musterCache.get(k);
    const ohne = (s) => s.replace(RECHTSFORM_W, ' ').replace(/\s+/g, ' ').trim();
    const m = { voll: ohne(norm(k.name)), voll2: ohne(norm2(k.name)) };
    if (m.voll.length < 3) m.voll = '';
    musterCache.set(k, m);
    return m;
  }
  // Bekannten Kunden im Text suchen; Briefkopf zählt mehr, Bankzeilen weniger, eigene Firmendaten gar nicht
  function findeKontakt(Z, D, typ, nameModus) {
    const K = D && Array.isArray(D.KONTAKTE) ? D.KONTAKTE : [];
    if (!K.length) return null;
    const teile = eigenTeile((D && D.FIRMA) || {});
    const zl = Z.map((z, i) => {
      let t = z.toLowerCase();
      teile.forEach((p) => { t = t.split(p).join(' '); });
      return { a: ` ${norm(t)} `, b: ` ${norm2(t)} `, i, bank: /iban|\bbic\b|bankverbindung|kontonummer|\bblz\b|bank:/i.test(z) };
    });
    let best = null;
    for (const k of K) {
      if (!k || !k.name) continue;
      const m = kontaktMuster(k);
      let s = 0, oben = false;
      for (const z of zl) {
        let t = 0;
        if (m.voll && (z.a.includes(` ${m.voll} `) || z.b.includes(` ${m.voll2} `))) t = 3;
        if (!t) continue;
        if (z.bank) t *= 0.3;
        if (z.i < 6) { t *= 1.5; oben = true; }
        s += t;
      }
      if (s < 1) continue;
      if (!nameModus) {
        if (typ === 'einnahme') s *= 1.5; // eigene Rechnung/Quittung an diesen Kunden
        else if (!oben) continue; // bei Ausgaben zählt ein Kunde nur als Aussteller im Briefkopf
      }
      if (!best || s > best.s) best = { k, s };
    }
    return best;
  }
  const kontaktName = (D, id) => ((D && Array.isArray(D.KONTAKTE) ? D.KONTAKTE : []).find((k) => k.id === id) || {}).name || null;

  /* ---------- Bekanntes Geschäft (Ausgaben): Freitext b.lieferant früherer Ausgaben im Belegkopf suchen ----------
   * Kontakte sind nur Kunden; Geschäfte wie „Aral Tankstelle“ stehen als Freitext an den Ausgaben.
   * Gezählt werden die markanten Wörter des Namens (ohne Rechtsform und Gattungswörter wie „Tankstelle“). */
  const GATTUNG = /^(?:tankstelle|station|baumarkt|markt|gartencenter|filiale|versicherung|werkstatt|deutschland|druckerei|musterstadt)$/;
  function findeGeschaeft(Z, D) {
    const B = D && Array.isArray(D.buchungen) ? D.buchungen : [];
    const namen = [...new Set(B.filter((b) => b && b.typ === 'ausgabe' && b.lieferant).map((b) => String(b.lieferant)))];
    if (!namen.length) return null;
    const kopf = Z.slice(0, 15).map((z) => ` ${norm(z)} `), alle = ` ${norm(Z.join(' '))} `;
    let best = null;
    for (const name of namen) {
      const tok = norm(kurzName(name)).split(' ').filter((w) => w.length >= 4 && !GATTUNG.test(w));
      if (!tok.length) continue;
      let p = 0;
      tok.forEach((w) => { const i = kopf.findIndex((z) => z.includes(` ${w} `)); p += i >= 0 ? (i < 6 ? 3 : 2) : alle.includes(` ${w} `) ? 1 : 0; });
      p /= tok.length;
      if (p >= 1 && (!best || p > best.s)) best = { name, s: p };
    }
    return best;
  }

  /* ---------- Lieferant raten (kein bekannter Kontakt) ---------- */
  const RE_RECHTSFORM = /(?:^|[\s,])(?:GmbH(?:\s?&\s?Co\.?\s?KG)?|AG|UG(?:\s?\(haftungsbeschränkt\))?|KG|OHG|GbR|e\.\s?K\.?|e\.\s?Kfm\.?|e\.\s?Kfr\.?|e\.\s?V\.?|Ltd\.?|Limited|Inc\.?|LLC|SE|UC|B\.V\.|mbH|PartG)(?=$|[\s,.·|)])/;
  const RE_KEIN_NAME = /^(?:rechnung|invoice|quittung|kassenbon|kassenbeleg|beleg|bon|lieferschein|gutschrift|angebot|seite|page|datum|date|tel|fax|e-?mail|www\.|http|kunde|bill\s*to|an:|z\.?\s?hd|herrn?\b|frau\b|firma\b|betreff|steuer|st\.?-?nr|ust|iban|bic|filiale|inh\.?|vielen|danke|sehr\s+geehrte)/i;
  function lieferantRaten(Z, eigen) {
    const segs = [];
    Z.slice(0, 15).forEach((z) => z.split(/\s{2,}|\s[·|•]\s/).forEach((t) => { t = t.trim(); if (t && !eigen(t)) segs.push(t); }));
    const sauber = (t) => {
      t = t.split(/\s[·|•]\s|,\s/)[0].replace(/^(?:inh\.?|inhaber(?:in)?:?)\s+/i, '').trim().slice(0, 60);
      return t === t.toUpperCase() && buchstaben(t) > 3 ? t.toLowerCase().replace(/(^|[\s-])(\S)/g, (_, a, b) => a + b.toUpperCase()) : t;
    };
    const i = segs.findIndex((t) => RE_RECHTSFORM.test(t) && !RE_KEIN_NAME.test(t));
    if (i >= 0) {
      // umbrochene Überschrift: „Gartencenter Blütenreich“ ↵ „GmbH“
      const allein = buchstaben(segs[i].replace(RE_RECHTSFORM, ' ')) < 3;
      return { name: sauber(allein && i > 0 ? `${segs[i - 1]} ${segs[i]}` : segs[i]), s: 'mittel' };
    }
    const name = segs.find((t) => buchstaben(t) >= 3 && t.length <= 50 && (t.match(/\d/g) || []).length <= t.length * 0.2 &&
      !RE_KEIN_NAME.test(t) && !/@|www\.|https?:/.test(t) && !/\d+\s*[a-z]?$/i.test(t) && !/^\d{4,5}\s/.test(t) &&
      !KW_TOTAL.test(t) && !KW_SUMME.test(t) && !/:/.test(t));
    return name ? { name: sauber(name), s: 'niedrig' } : null;
  }
  const kurzName = (n) => String(n || '').replace(/\(.*?\)/g, ' ')
    .replace(/\b(?:GmbH(?:\s?&\s?Co\.?\s?KG)?|AG|UG|KG|OHG|GbR|e\.\s?K\.?|e\.\s?V\.?|Ltd\.?|Inc\.?|LLC|SE|UC|mbH|Systems|Deutschland|Germany|Ireland|Europe|Software|Services)(?=$|[\s,.])/gi, ' ')
    .replace(/\s{2,}/g, ' ').trim().replace(/[,·&-]+$/, '').trim() || String(n || '');

  /* ---------- Kategorie ---------- */
  const KAT_AUS = [
    ['material', /(?:blumen|pflanz|garten|kompost|rasen)erde|d[üu]nger|saatgut|samen\b|rindenmulch|holz|leim|schraube|beschl[äa]g|\black|lasur|beize|wachs(?!tum)|öl\b|oel\b|d[üu]bel|scharnier|eiche|esche\b|buche\b|nussbaum|kiefer|fichte|l[äa]rche|multiplex|sperrholz|spanplatte|\bmdf\b|bohle|schleifpapier|schleifmittel|furnier|kantenumleimer|n[äa]gel\b|schnittholz|plattenwerkstoff|zuschnitt/g],
    ['werkzeug', /werkzeug|schleifer\b|bohrer\b|bohrmaschine|akku|s[äa]ge(?!werk|rau)|fr[äa]se|hobel|zwinge|stechbeitel|schraubendreher|bit-?set|maschine|wasserwaage|zollstock|exzenter/g],
    ['software', /adobe|software|lizenz|\babo\b|abonnement|subscription|cloud|domain|hosting|webspace|microsoft|office\s?365|google workspace|saas|shopify|canva|lexoffice|sevdesk|ionos|strato/g],
    ['telefon', /telekom|vodafone|\bo2\b|1&1|congstar|mobilfunk|festnetz|\bdsl\b|glasfaser|telefonie|internet(?!\s*:)|handyvertrag|magenta/g],
    ['buero', /\bdhl\b|hermes|\bdpd\b|\bgls\b|\bups\b|deutsche post|porto|briefmarke|paketmarke|b[üu]ro|druckerpatrone|toner|(?<!schleif)papier|ordner/g],
    ['bewirtung', /restaurant|bewirtung|caf[eé](?![a-zäöü])|gastst[äa]tte|gasthaus|gasthof|bistro|pizzeria|trattoria|imbiss|trinkgeld|speisen|getr[äa]nke|bedienung(?!s)/g],
    ['versicherung', /versicherung|haftpflicht|police|versicherungsschein/g],
    ['gebuehren', /standgeb[üu]hr|standgeld|marktgeb[üu]hr|geb[üu]hr|etsy|paypal|sumup|kontof[üu]hrung|provision|ebay|kammerbeitrag|\bihk\b|\bhwk\b|handwerkskammer|rundfunkbeitrag/g],
    ['fahrt', /tankstelle|\baral\b|\bshell\b|\besso\b|deutsche bahn|\bdb\b|bahncard|fahrkarte|parkhaus|parkschein|parkgeb|\bparken\b|benzin|diesel|kraftstoff|\d\s?km\b|\bmaut\b|\btaxi\b/g],
    ['fortbildung', /seminar|\bkurs(?:e|es)?\b|kursgeb|schulung|workshop|weiterbildung|fortbildung|lehrgang|webinar|fachbuch/g],
    ['werbung', /werbung|flyer|visitenkarte|druckerei|plakat|banner|anzeige|instagram|google ads|facebook|inserat|werbemittel|vistaprint|flyeralarm|marketing/g],
    ['raum', /miete\b|mietzins|\bpacht\b|nebenkosten/g]
  ];
  const KAT_EIN = [['markt', /quittung|barverkauf|marktverkauf|\bmarkt\b/g], ['shop', /etsy|online-?shop|\bshop\b|bestellung/g], ['auftrag', /rechnung|auftrag|leistung/g]];
  // Interne Liste: Treffer je internem Thema (material, fahrt, bewirtung …)
  function katWoerter(text, typ) {
    const t = String(text || '').toLowerCase(), out = [];
    for (const [kat, re] of typ === 'einnahme' ? KAT_EIN : KAT_AUS) {
      const n = Math.min(6, (t.match(re) || []).length);
      if (n) out.push([kat, n]);
    }
    return out.sort((a, b) => b[1] - a[1]);
  }
  // Nur Kategorien aus den Daten, passend zum Typ – nie eine erfundene id
  const kategorien = (D, typ) => (D && Array.isArray(D.KATEGORIEN) ? D.KATEGORIEN : []).filter((k) => k && k.id && k.typ === typ);
  // Internes Thema auf vorhandene Kategorie abbilden
  function abbilden(thema, typ, KAT) {
    const da = (id) => KAT.find((k) => k.id === id);
    if (da(thema)) return thema;
    if (typ === 'einnahme') return KAT.length ? (KAT.find((k) => k.ku) || KAT[0]).id : null;
    if (thema === 'material') { const w = KAT.find((k) => k.wareneingang); if (w) return w.id; }
    if (thema === 'fahrt') { const f = KAT.find((k) => (k.stichworte || []).some((s) => String(s).toLowerCase() === 'tankstelle')); if (f) return f.id; }
    const s = da('sonstiges') || KAT.find((k) => /^sonst/.test(k.id));
    return s ? s.id : null;
  }
  // Stichwort-Treffer: kurze Wörter nur ganz, längere auch als Wortanfang/-ende (Komposita wie „Blumenerde“)
  const reCache = new Map();
  function stichwortRe(w) {
    if (!reCache.has(w)) {
      const e = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
      // ≤ 4 Zeichen (Marken wie „esso“, „aral“, „obi“) nur als ganzes Wort – sonst träfe „esso“ den „Espresso“
      reCache.set(w, w.length <= 4 ? new RegExp(`(?<![a-zäöüß0-9])${e}(?![a-zäöüß0-9])`, 'g') : new RegExp(`(?<![a-zäöüß])${e}|${e}(?![a-zäöüß])`, 'g'));
    }
    return reCache.get(w);
  }
  // Bank-, Zahlungs- und Registerzeilen sowie Summen-„Total“ tragen nichts zur Kategorie bei
  const stichwortText = (t) => String(t || '').toLowerCase().split('\n')
    .filter((z) => !/iban|\bbic\b|bankverbindung|konto\s*(?:nr|nummer|inhaber)|abgebucht|lastschrift|überweis|amtsgericht|ust-?id|steuer-?n(?:r|ummer)|geschäftsführ/.test(z))
    .join('\n').replace(/\b(?:sub-?)?total\b/g, ' ');
  // Text → { kat, n, q } über Stichworte der Kategorien; interne Liste nur als Rückfall bzw. Stichentscheid
  function katAusText(text, typ, KAT) {
    const t = stichwortText(text), p = {};
    KAT.forEach((k) => (Array.isArray(k.stichworte) ? k.stichworte : []).forEach((w) => {
      w = String(w || '').toLowerCase().trim();
      if (!w) return;
      const n = Math.min(3, (t.match(stichwortRe(w)) || []).length);
      if (n) p[k.id] = (p[k.id] || 0) + n;
    }));
    const intern = {};
    katWoerter(t, typ).forEach(([thema, n]) => { const id = abbilden(thema, typ, KAT); if (id) intern[id] = (intern[id] || 0) + n; });
    const reihe = (o) => Object.keys(o).sort((a, b) => o[b] - o[a] || (intern[b] || 0) - (intern[a] || 0));
    const sw = reihe(p)[0];
    if (sw) return { kat: sw, n: p[sw], q: 'stichwort' };
    const iw = reihe(intern)[0];
    return iw ? { kat: iw, n: intern[iw], q: 'intern' } : null;
  }
  // Kategorie: 1. Historie des Kunden bzw. Geschäfts, 2. Stichworte der Kategorien, 3. interne Wortliste (Text vor Dateiname)
  function katVorschlag(kontakt, typ, texte, D, lieferant = null) {
    const KAT = kategorien(D, typ);
    if (!KAT.length) return null;
    const gueltig = (id) => KAT.some((k) => k.id === id);
    const kw = texte.map(([t, q]) => ({ w: katAusText(t, typ, KAT), q })).find((x) => x.w);
    const vonHier = (b) => (kontakt ? b.kontakt === kontakt : b.lieferant === lieferant);
    if ((kontakt || lieferant) && Array.isArray(D.buchungen)) {
      const h = {}; let n = 0;
      D.buchungen.forEach((b) => { if (b && vonHier(b) && gueltig(b.kat)) { h[b.kat] = (h[b.kat] || 0) + 1; n++; } });
      const top = Object.keys(h).sort((a, b) => h[b] - h[a])[0];
      if (top) {
        if (kw && kw.w.kat !== top && h[kw.w.kat] && kw.w.n >= 2) return { kat: kw.w.kat, q: 'historie', s: 'mittel' };
        return { kat: top, q: 'historie', s: h[top] / n >= 0.75 ? 'hoch' : 'mittel' };
      }
    }
    if (kw) return { kat: kw.w.kat, q: kw.q, s: kw.w.n >= 3 || (kw.w.q === 'stichwort' && kw.w.n >= 2) ? 'mittel' : 'niedrig' };
    // Einnahme ohne Hinweise: einzige bzw. Kleinunternehmer-Einnahmekategorie
    return typ === 'einnahme' ? { kat: abbilden('', typ, KAT), q: (texte[0] || [])[1] || 'text', s: 'niedrig' } : null;
  }
  // Interne Hauptthemen (für den Buchungstext, z. B. Bewirtung)
  const thema = (text) => (katWoerter(stichwortText(text), 'ausgabe')[0] || [])[0] || null;

  /* ---------- Positionen & Buchungstext ---------- */
  const RE_KOPFWORT = /\b(?:pos|artikel|menge|preis|beschreibung|bezeichnung|anzahl|einheit|produkt|product|qty)\b/i;
  // Echtes Wort (≥ 3 Buchstaben, ohne Währung/Einheit) – „x 1,866 EUR/l“ zählt nicht
  const hatBezeichnung = (s) => /[a-zäöüß]{3,}/i.test(s.replace(/\b(?:eur|euro)\b/gi, '')) && !/^(?:zapf)?s[äa]ule\b|^kasse\b|^tisch\b/i.test(s);
  function kurzPosition(segs) {
    let t = segs.find(hatBezeichnung) || '';
    t = t.replace(/^\d{1,3}[.)]?\s+(?=\D)/, '').replace(/^\d+(?:[.,]\d+)?\s*(?:x|×|stk\.?|st\.?)\s+/i, '');
    t = t.split(/\s[/(]|,|\s-\s/)[0];
    const r = [];
    for (const w of t.split(/\s+/)) {
      if (r.length >= 3 || (/\d/.test(w) && !(r.length && /^[A-Za-z]\d{1,3}$/.test(w)))) break; // „Super E10“, „Schleifpapier K120“
      r.push(w);
    }
    return r.join(' ').slice(0, 32).trim();
  }
  function positionen(Z, eigen, g) {
    const out = [];
    for (let i = 0; i < Z.length && out.length < 3; i++) {
      const z = Z[i], geld = geldIn(z);
      if (!geld.length) continue;
      let segs = z.slice(0, geld[0].idx).split(/\s{2,}/).map((s) => s.trim()).filter(Boolean);
      if (!segs.some(hatBezeichnung)) { const p = vorzeile(Z, i, g); if (!p) continue; segs = p.split(/\s{2,}/); }
      const l = segs.join('  ');
      if (/:/.test(l) || KW_TOTAL.test(l) || KW_SUMME.test(l) || KW_NICHT.test(l) || RE_KOPFWORT.test(l) || eigen(l)) continue;
      const n = kurzPosition(segs);
      if (n && buchstaben(n) >= 3 && !out.includes(n)) out.push(n);
    }
    return out;
  }
  function buchungstext(f, pos, betreff, r, th) {
    const kurz = f.lieferant ? kurzName(f.lieferant) : '';
    let t;
    if (f.typ === 'einnahme') {
      const art = (r && r.art === 'quittung') || /^qu-/i.test(f.rechnungsnr || '') ? 'Quittung' : 'Rechnung';
      t = [f.rechnungsnr ? `${art} ${f.rechnungsnr}` : art, (r && r.betreff) || betreff || pos[0] || kurz].filter(Boolean).join(' · ');
    }
    else if (th === 'bewirtung' && kurz) t = `Bewirtung · ${kurz}`;
    else if (kurz && pos.length) t = `${kurz} · ${pos.slice(0, 2).join(', ')}`;
    else if (kurz && f.rechnungsnr) t = `Rechnung ${f.rechnungsnr} · ${kurz}`;
    else t = kurz || pos.slice(0, 2).join(', ');
    return t ? t.slice(0, 80) : null;
  }
  // Kategorie einer eigenen Rechnung/Quittung aus den Daten (immer eine vorhandene id)
  const katVonRechnung = (D, r) => {
    const KAT = kategorien(D, 'einnahme');
    return r.kat && KAT.some((k) => k.id === r.kat) ? r.kat : abbilden(r.art === 'quittung' ? 'markt' : 'auftrag', 'einnahme', KAT);
  };
  const eigeneRechnung = (D, nr) => (nr && D && Array.isArray(D.rechnungen) ? D.rechnungen.find((r) => r.nr && r.nr.toLowerCase() === String(nr).toLowerCase()) || null : null);

  /* ================= Erkennung: Text ================= */
  function zeilenVon(text) {
    return String(text || '').normalize('NFKC').replace(/[­​-‏﻿]/g, '').split(/\r?\n|\r/)
      .map((z) => z.replace(/\t/g, '  ').replace(/[   ]/g, ' ').trim()).filter(Boolean);
  }
  function ausText(text, data) {
    const D = data || {}, F = D.FIRMA || {}, felder = leer(), sich = {}, herkunft = {};
    const erg = { felder, sicherheit: sich, herkunft, pos: [], betreff: null, katText: '' };
    const Z = zeilenVon(text);
    if (!Z.length) return erg;
    const g = grenzen(D), eigen = eigenFilter(F);
    const setze = (k, v, s, q = 'text') => { if (v != null) { felder[k] = v; sich[k] = s; herkunft[k] = q; } };
    const e = eigenerBeleg(Z, F);
    setze('typ', e ? 'einnahme' : 'ausgabe', e || 'mittel');
    const b = findeBetrag(Z, g); if (b) setze('betrag', b.c, b.s);
    const d = findeDatum(Z, g); if (d) setze('datum', d.d, d.s);
    // Lastschrift: Abbuchungstag wird Zahlungsdatum, das Rechnungsdatum bleibt als Info erhalten
    const ab = findeAbbuchung(Z, g);
    if (ab && ab !== felder.datum) { if (felder.datum) setze('rechnungsdatum', felder.datum, sich.datum); setze('datum', ab, 'mittel'); }
    const n = findeNummer(Z); if (n) setze('rechnungsnr', n.w, n.s);
    // Gegenpartei: bekannter Kontakt, eigene Rechnung aus den Daten, sonst geraten
    const r = felder.typ === 'einnahme' ? eigeneRechnung(D, felder.rechnungsnr) : null;
    const k = findeKontakt(Z, D, felder.typ, false);
    if (k) { setze('kontakt', k.k.id, k.s >= 4 ? 'hoch' : 'mittel'); setze('lieferant', k.k.name, sich.kontakt); }
    else if (r && r.kontakt) { setze('kontakt', r.kontakt, 'hoch'); setze('lieferant', kontaktName(D, r.kontakt), 'hoch'); }
    else {
      const gs = felder.typ === 'ausgabe' ? findeGeschaeft(Z, D) : null;
      if (gs) setze('lieferant', gs.name, gs.s >= 2 ? 'hoch' : 'mittel');
      else { const l = lieferantRaten(Z, eigen); if (l) setze('lieferant', l.name, l.s); }
    }
    // Kategorie (eigene Firmendaten aus dem Stichworttext entfernen)
    let kt = Z.join('\n').toLowerCase();
    eigenTeile(F).forEach((p) => { kt = kt.split(p).join(' '); });
    erg.katText = kt;
    const kat = r ? { kat: katVonRechnung(D, r), q: 'text', s: 'hoch' } : katVorschlag(felder.kontakt, felder.typ, [[kt, 'text']], D, felder.lieferant);
    if (kat && kat.kat) setze('kategorie', kat.kat, kat.s, kat.q);
    erg.pos = positionen(Z, eigen, g);
    erg.thema = thema(kt);
    const bz = Z.map((z) => /^(?:betreff|betrifft|betr\.|subject)\s*:?\s*(.+)/i.exec(z)).find(Boolean);
    erg.betreff = bz ? bz[1].split(/\s{2,}/)[0].trim() : null;
    setze('text', buchungstext(felder, erg.pos, erg.betreff, r, erg.thema), 'mittel');
    return erg;
  }

  /* ================= Erkennung: Dateiname ================= */
  const NAME_STOP = new Set(['rechnung', 'rechnungen', 'rechnungsnr', 'nr', 'beleg', 'belege', 'quittung', 'kassenbon', 'bon', 'invoice',
    'receipt', 'scan', 'scanned', 'img', 'image', 'dsc', 'dcim', 'foto', 'photo', 'bild', 'pdf', 'eur', 'euro', 'kopie', 'copy', 'datum',
    'betrag', 'document', 'dokument', 'datei', 'whatsapp', 'screenshot', 'bildschirmfoto', 'und', 'vom', 'fuer', 'für', 'von', 'the',
    'final', 'neu', 'new', 'signed', 'original', 'gutschrift', 'lieferschein', 'auftrag', 'bestellung', 'order', 'brutto', 'netto', 'mwst', 'ust']);
  function ausName(name, data) {
    const D = data || {}, felder = leer(), sich = {}, herkunft = {};
    const erg = { felder, sicherheit: sich, herkunft, pos: [], betreff: null, katText: '' };
    const basis = String(name || '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,5}$/i, '').normalize('NFC').trim();
    if (!basis) return erg;
    const g = grenzen(D);
    const setze = (k, v, s, q = 'dateiname') => { if (v != null) { felder[k] = v; sich[k] = s; herkunft[k] = q; } };
    let rest = ` ${basis.replace(/\+/g, ' ')} `;
    const raus = (m) => { rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length); };
    // Datum
    for (const [re, f] of [
      [/(?<!\d)(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})(?!\d)/, (m) => [m[1], m[2], m[3]]],
      [/(?<!\d)(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2}|\d{2})(?!\d)/, (m) => [m[3], m[2], m[1]]],
      [/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/, (m) => [m[1], m[2], m[3]]]
    ]) {
      const m = re.exec(rest), d = m && mkDatum(...f(m), g);
      if (d) { setze('datum', d, 'mittel'); raus(m); break; }
    }
    // Betrag
    let m = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d+)[,.](\d{2})(?!\d)(\s?(?:€|eur|euro)(?![a-z]))?/i.exec(rest);
    if (m) { setze('betrag', +m[1].replace(/\./g, '') * 100 + +m[2], m[3] ? 'mittel' : 'niedrig'); raus(m); }
    else if ((m = /(?<![\d.,])(\d{1,6})\s?(?:€|eur|euro)(?![a-z])/i.exec(rest))) { setze('betrag', +m[1] * 100, 'mittel'); raus(m); }
    // Rechnungsnummer
    m = /(?:^|[\s_])((?:RE|RG|RN|INV|AR|QU|BN)[-_.]?\d[A-Za-z0-9-]*|R-\d[A-Za-z0-9-]*)(?=[\s_]|$)/i.exec(rest) ||
      /(?:rechnungs?-?nr|rechnungsnummer|rechnung|invoice|beleg|nr\.?)[\s_.:#-]+(?:nr\.?[\s_.:#-]*)?([A-Za-z]{0,4}-?\d[A-Za-z0-9-]*)/i.exec(rest);
    if (m && /\d/.test(m[1]) && m[1].length >= 3) setze('rechnungsnr', m[1], 'mittel');
    // Eigene Rechnung (Nummer aus den Daten, z. B. „RE-2026-009.pdf“)
    const r = (D.rechnungen || []).find((x) => x.nr && basis.toLowerCase().includes(x.nr.toLowerCase()));
    if (r) {
      setze('typ', 'einnahme', 'hoch'); setze('rechnungsnr', r.nr, 'hoch');
      if (felder.betrag == null && typeof D.rechnungSumme === 'function') setze('betrag', D.rechnungSumme(r), 'mittel');
      if (felder.datum == null && r.datum) setze('datum', r.datum, 'mittel');
      if (r.kontakt) { setze('kontakt', r.kontakt, 'hoch'); setze('lieferant', kontaktName(D, r.kontakt), 'hoch'); }
      setze('kategorie', katVonRechnung(D, r), 'hoch');
    }
    // Kontakt bzw. Wörter als Lieferant (nur wenn der Name sonst etwas hergab)
    const worte = rest.replace(/[_]+/g, ' ');
    erg.katText = worte.toLowerCase();
    if (felder.kontakt == null) {
      const k = findeKontakt([worte], D, felder.typ, true);
      const gs = !k && felder.typ !== 'einnahme' ? findeGeschaeft([worte], D) : null;
      if (k) { setze('kontakt', k.k.id, 'mittel'); setze('lieferant', k.k.name, 'mittel'); }
      else if (gs) setze('lieferant', gs.name, 'mittel');
      else if (felder.datum || felder.betrag != null || felder.rechnungsnr) {
        const w = worte.split(/[\s]+/).filter((x) => /^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß&.-]{2,}$/.test(x) && !NAME_STOP.has(x.toLowerCase()) && !MONAT[x.toLowerCase()]).slice(0, 2);
        if (w.length) setze('lieferant', w.map((x) => x[0].toUpperCase() + x.slice(1)).join(' '), 'niedrig');
      }
    }
    // Kategorie nur, wenn der Name auch sonst etwas hergab (sonst wäre „Angebot Holz.docx“ schon „Material“)
    if (felder.kategorie == null && FELDER.some((k) => felder[k] != null)) {
      const kat = katVorschlag(felder.kontakt, felder.typ, [[erg.katText, 'dateiname']], D, felder.lieferant);
      if (kat && kat.kat) setze('kategorie', kat.kat, kat.s, kat.q);
    }
    setze('text', buchungstext(felder, [], null, r), 'niedrig');
    return erg;
  }

  /* ================= Zusammenführen ================= */
  const FELDER = ['betrag', 'datum', 'lieferant', 'kontakt', 'rechnungsnr'];
  const eur = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €';
  function zusammen(erg, A, B, D) {
    const f = erg.felder, h = erg.herkunft, s = erg.sicherheit;
    const fa = A ? A.felder : leer(), fb = B.felder;
    const von = (X, k) => { f[k] = X.felder[k]; h[k] = X.herkunft[k]; s[k] = X.sicherheit[k]; };
    // Typ
    if (A && (fa.typ === 'einnahme' || fb.typ !== 'einnahme')) von(A, 'typ');
    else if (fb.typ === 'einnahme') von(B, 'typ');
    else { f.typ = 'ausgabe'; h.typ = 'standard'; s.typ = 'niedrig'; }
    // Text gewinnt, Dateiname füllt Lücken; Übereinstimmung erhöht die Sicherheit
    ['betrag', 'datum', 'rechnungsnr'].forEach((k) => {
      if (fa[k] != null) { von(A, k); if (fb[k] != null && String(fb[k]).toLowerCase() === String(fa[k]).toLowerCase()) s[k] = 'hoch'; }
      else if (fb[k] != null) von(B, k);
    });
    if (fa.rechnungsdatum != null && f.datum === fa.datum) von(A, 'rechnungsdatum'); // Lastschrift (nur aus dem PDF-Text)
    // Gegenpartei: bekannter Kontakt schlägt geratenen Namen
    const Q = fa.kontakt ? A : fb.kontakt ? B : fa.lieferant ? A : fb.lieferant ? B : null;
    if (Q) { von(Q, 'lieferant'); if (Q.felder.kontakt) von(Q, 'kontakt'); }
    // Kategorie mit endgültigem Kontakt und Typ neu bestimmen
    const r = f.typ === 'einnahme' ? eigeneRechnung(D, f.rechnungsnr) : null;
    if (r && !f.kontakt && r.kontakt) { f.kontakt = r.kontakt; f.lieferant = kontaktName(D, r.kontakt); h.kontakt = h.lieferant = h.rechnungsnr; s.kontakt = s.lieferant = 'hoch'; }
    const texte = (A ? [[A.katText, 'text']] : []).concat([[B.katText, 'dateiname']]);
    const kat = r ? { kat: katVonRechnung(D, r), q: h.rechnungsnr, s: 'hoch' } : katVorschlag(f.kontakt, f.typ, texte, D, f.lieferant);
    if (kat && kat.kat && (A || fb.kategorie)) { f.kategorie = kat.kat; h.kategorie = kat.q; s.kategorie = kat.s; }
    // Buchungstext
    f.text = buchungstext(f, A ? A.pos : [], A ? A.betreff : null, r, A ? A.thema : null);
    if (f.text) { h.text = A ? 'text' : 'dateiname'; s.text = A ? 'mittel' : 'niedrig'; }
    // Quelle und Hinweise
    erg.quelle = A && FELDER.some((k) => fa[k] != null) ? 'pdf-text' : FELDER.some((k) => fb[k] != null) ? 'dateiname' : A ? 'pdf-text' : 'keine';
    if (fa.betrag != null && fb.betrag != null && fa.betrag !== fb.betrag) erg.hinweise.push(`Betrag im Dateinamen (${eur(fb.betrag)}) weicht vom PDF (${eur(fa.betrag)}) ab – bitte prüfen.`);
    if (f.typ === 'einnahme' && h.typ === 'text') erg.hinweise.push('Eigene Rechnung erkannt – als Einnahme vorgeschlagen.');
    if (f.betrag == null) erg.hinweise.push('Kein Betrag erkannt – bitte eintragen.');
  }

  /* ================= Öffentliche API ================= */
  async function leseDatei(f) {
    try {
      if (f instanceof ArrayBuffer) return f;
      if (ArrayBuffer.isView(f)) return f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength);
      if (f && typeof f.arrayBuffer === 'function') return await f.arrayBuffer();
      if (typeof Blob !== 'undefined' && f instanceof Blob) {
        return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ok(null); r.readAsArrayBuffer(f); });
      }
    } catch (e) { /* unlesbar */ }
    return null;
  }
  const istPdfKopf = (buf) => !!buf && latin1(new Uint8Array(buf, 0, Math.min(1024, buf.byteLength))).indexOf('%PDF-') >= 0;

  async function analyse(file, data = window.DATA) {
    const erg = { quelle: 'keine', text: '', felder: leer(), herkunft: {}, sicherheit: {}, hinweise: [] };
    const hinweis = (t) => erg.hinweise.push(t);
    try {
      const D = data || {};
      const name = file && typeof file.name === 'string' ? file.name : '';
      const mime = file && typeof file.type === 'string' ? file.type.toLowerCase() : '';
      const ext = ((/\.([a-z0-9]{2,5})$/i.exec(name) || [])[1] || '').toLowerCase();
      const bild = /^image\//.test(mime) || /^(?:jpe?g|png|gif|webp|heic|heif|tiff?|bmp)$/.test(ext);
      let pdf = mime === 'application/pdf' || ext === 'pdf', buf = null, A = null;
      if (file && !bild) { buf = await leseDatei(file); if (istPdfKopf(buf)) pdf = true; }
      if (!file) hinweis('Keine Datei übergeben.');
      else if (bild) hinweis('Bild – Texterkennung (OCR) kommt in der Mac-App über das Vision-Framework.');
      else if (pdf) {
        const r = await mitZeitlimit(lies(buf), 20000, { text: '', pdf: true, zeit: true });
        erg.text = r.text || '';
        const lesbar = buchstaben(erg.text) >= 12;
        if (r.verschluesselt) hinweis('PDF ist verschlüsselt – Text nicht auslesbar, Werte aus dem Dateinamen.');
        else if (r.zeit) hinweis('PDF-Auswertung abgebrochen (zu groß oder zu komplex) – Werte aus dem Dateinamen.');
        else if (!r.pdf) hinweis('Datei ist kein gültiges PDF – Werte aus dem Dateinamen.');
        else if (!lesbar) hinweis('PDF enthält keinen auslesbaren Text (Scan?) – Werte aus dem Dateinamen.');
        if (lesbar) A = ausText(erg.text, D);
      } else hinweis('Dateityp wird nicht ausgewertet – nur Werte aus dem Dateinamen.');
      zusammen(erg, A, ausName(name, D), D);
    } catch (e) {
      hinweis('Beleg konnte nicht vollständig ausgewertet werden – bitte Felder prüfen.');
    }
    return erg;
  }
  async function pdfText(arrayBuffer) {
    try { return (await mitZeitlimit(lies(arrayBuffer), 20000, { text: '' })).text || ''; } catch (e) { return ''; }
  }
  function parseText(text, data = window.DATA) {
    try { return ausText(text, data).felder; } catch (e) { return leer(); }
  }
  function parseDateiname(name, data = window.DATA) {
    try { return ausName(name, data).felder; } catch (e) { return leer(); }
  }

  return { analyse, pdfText, parseText, parseDateiname };
})();
