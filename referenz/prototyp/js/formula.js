/* Kladdy – Prototyp · Formel-Engine
 * Kleine, sichere Formelsprache für Kennzahlen in deutscher Excel-Schreibweise, z. B.
 *   TEILEN(GEWINN(); EINNAHMEN(); 0)  ·  AUSGABEN(kategorie: "Material"; zeitraum: JAHR)  ·  [Überschuss] * 30 %
 * Ablauf: tokenize → parse (rekursiver Abstieg → AST, gecacht) → evaluate / explain / check.
 * Kein eval, kein new Function, kein with – ein eigener kleiner Interpreter über dem AST.
 * Daten in CENT, Formeln rechnen in EURO. Datum immer 'YYYY-MM-DD'.
 * „Nicht berechenbar“ (Division durch 0, leerer Durchschnitt) → NaN; echte Fehler → FormulaError mit Position.
 */
window.Formula = (() => {
  'use strict';

  /* ---------- Fehler ---------- */
  class FormulaError extends Error {
    constructor(message, start = 0, end = start, hint = '') {
      super(message);
      this.name = 'FormulaError';
      this.start = start;
      this.end = end;
      this.hint = hint || '';
    }
  }
  /* Wirft einen FormulaError an der Stelle at ({ start, end }) */
  function fail(message, at, hint) {
    throw new FormulaError(message, at ? at.start : 0, at ? at.end : 0, hint);
  }

  /* ---------- Datum (UTC → keine Sommerzeit-Effekte) ---------- */
  const DAY = 86400000;
  const MONATSNAMEN = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const parts = (s) => [+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10)];
  const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayNo = (s) => { const [y, m, d] = parts(s); return Date.UTC(y, m - 1, d) / DAY; };
  const days = (a, b) => dayNo(b) - dayNo(a);
  const addDays = (s, n) => { const t = new Date((dayNo(s) + n) * DAY); return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
  /* Monat darf über-/unterlaufen (m = 0 → Dezember Vorjahr), Tag wird aufs Monatsende gekappt */
  const ymd = (y, m, d) => { y += Math.floor((m - 1) / 12); m = (((m - 1) % 12) + 12) % 12 + 1; return `${pad(y, 4)}-${pad(m)}-${pad(Math.min(d, dim(y, m)))}`; };
  const deDate = (s) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  /* ---------- Zeiträume ---------- */
  class Zeitraum { constructor(von, bis) { this.von = von; this.bis = bis; } }
  /* Anzahl ganzer Monate (1. bis Monatsletzter), sonst 0 */
  function ganzeMonate(p) {
    const [yv, mv, dv] = parts(p.von), [yb, mb, db] = parts(p.bis);
    return dv === 1 && db === dim(yb, mb) ? (yb - yv) * 12 + mb - mv + 1 : 0;
  }
  function vorperiode(p) {
    const n = ganzeMonate(p);
    if (n > 0) { const [yv, mv] = parts(p.von), [yb, mb] = parts(p.bis); return new Zeitraum(ymd(yv, mv - n, 1), ymd(yb, mb - n, 31)); }
    const len = days(p.von, p.bis) + 1;
    return new Zeitraum(addDays(p.von, -len), addDays(p.bis, -len));
  }
  function vorjahr(p) {
    const [yv, mv, dv] = parts(p.von), [yb, mb, db] = parts(p.bis);
    return new Zeitraum(ymd(yv - 1, mv, dv), ymd(yb - 1, mb, db === dim(yb, mb) ? 31 : db)); // Monatsende bleibt Monatsende
  }
  /* Lesbare Beschreibung: „Oktober 2026“, „Q3 2026“, „2026“ oder „01.01.2026 – 09.10.2026“ */
  function describe(p) {
    const n = ganzeMonate(p), [yv, mv] = parts(p.von);
    if (n === 1) return `${MONATSNAMEN[mv - 1]} ${yv}`;
    if (n === 3 && mv % 3 === 1) return `Q${(mv + 2) / 3} ${yv}`;
    if (n === 12 && mv === 1) return String(yv);
    return p.von === p.bis ? deDate(p.von) : `${deDate(p.von)} – ${deDate(p.bis)}`;
  }
  /* Zeitraum-Konstanten – immer relativ zum Ende (bis) des aktuell gültigen Zeitraums */
  const KONST = new Map([
    ['MONAT', (e) => { const [y, m] = parts(e.bis); return new Zeitraum(ymd(y, m, 1), ymd(y, m, 31)); }],
    ['QUARTAL', (e) => { const [y, m] = parts(e.bis), q = m - ((m - 1) % 3); return new Zeitraum(ymd(y, q, 1), ymd(y, q + 2, 31)); }],
    ['JAHR', (e) => { const y = parts(e.bis)[0]; return new Zeitraum(ymd(y, 1, 1), ymd(y, 12, 31)); }],
    ['YTD', (e) => new Zeitraum(ymd(parts(e.bis)[0], 1, 1), e.bis)],
    ['VORMONAT', (e) => { const [y, m] = parts(e.bis); return new Zeitraum(ymd(y, m - 1, 1), ymd(y, m - 1, 31)); }],
    ['VORJAHR_GESAMT', (e) => { const y = parts(e.bis)[0] - 1; return new Zeitraum(ymd(y, 1, 1), ymd(y, 12, 31)); }]
  ]);
  const MENGEN = new Set(['BUCHUNGEN', 'RECHNUNGEN']);

  const CONSTANTS = [
    { name: 'MONAT', desc: 'Kalendermonat, in dem der gewählte Zeitraum endet' },
    { name: 'QUARTAL', desc: 'Quartal, in dem der gewählte Zeitraum endet' },
    { name: 'JAHR', desc: 'Kalenderjahr, in dem der gewählte Zeitraum endet' },
    { name: 'YTD', desc: 'Jahresbeginn bis Ende des gewählten Zeitraums' },
    { name: 'VORMONAT', desc: 'Kalendermonat vor dem Monat, in dem der Zeitraum endet' },
    { name: 'VORJAHR_GESAMT', desc: 'Komplettes Vorjahr (1.1.–31.12.)' },
    { name: 'BUCHUNGEN', desc: 'Alle Buchungen – nur als erstes Argument von ANZAHL, SUMME, DURCHSCHNITT' },
    { name: 'RECHNUNGEN', desc: 'Rechnungen & Quittungen ohne Entwürfe/Stornos – nur als erstes Argument von ANZAHL, SUMME, DURCHSCHNITT' }
  ];

  /* ---------- Filter ---------- */
  const FILTERS = [
    { name: 'kategorie', desc: 'Kategorie: ID oder Name, ein Teil des Namens genügt – z. B. kategorie: "Material"' },
    { name: 'kunde', desc: 'Kunde: ID oder Teil des Namens – z. B. kunde: "Hausverwaltung"' },
    { name: 'kontakt', desc: 'Kunde: ID oder Teil des Namens' },
    { name: 'zahlungsart', desc: 'Zahlungsweg: bar, bank (Überweisung) oder paypal' },
    { name: 'typ', desc: 'Buchungstyp: einnahme oder ausgabe (nur BUCHUNGEN)' },
    { name: 'status', desc: 'Rechnungsstatus: entwurf, offen, bezahlt, storniert (nur RECHNUNGEN)' },
    { name: 'art', desc: 'Belegart: rechnung, quittung, angebot, eigenbeleg (nur RECHNUNGEN)' },
    { name: 'zeitraum', desc: 'Anderer Zeitraum statt des gewählten – z. B. zeitraum: JAHR' }
  ];
  const FILTER_NAMEN = FILTERS.map((f) => f.name);
  const TEXT_FILTER = new Set(['kategorie', 'kunde', 'kontakt', 'zahlungsart', 'typ', 'status', 'art']);
  const F_BUCH = ['kategorie', 'kunde', 'kontakt', 'zahlungsart', 'zeitraum'];
  const F_MENGE = { BUCHUNGEN: [...F_BUCH, 'typ'], RECHNUNGEN: ['kunde', 'kontakt', 'zahlungsart', 'status', 'art', 'zeitraum'] };
  const ZAHLUNGSARTEN = ['bar', 'bank', 'paypal'];
  const TYPEN = ['einnahme', 'ausgabe'];
  const STATUS = ['entwurf', 'offen', 'bezahlt', 'storniert'];
  const ARTEN = ['rechnung', 'quittung', 'angebot', 'eigenbeleg'];

  /* ---------- Vorschläge (Damerau-Levenshtein) ---------- */
  function dist(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i++) d[i] = [i];
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }
  /* Ähnlichsten Namen finden (ohne Groß-/Kleinschreibung); Präfix ab 3 Zeichen zählt auch */
  function suggest(name, candidates) {
    const q = String(name == null ? '' : name).trim().toLowerCase();
    if (!q) return null;
    const list = candidates || [...FUNCTIONS.map((f) => f.name), ...CONSTANTS.map((c) => c.name)];
    const max = q.length <= 3 ? 1 : q.length <= 6 ? 2 : 3;
    let best = null, bestD = Infinity;
    for (const c of list) {
      const s = String(c), l = s.toLowerCase();
      let dd = Math.abs(l.length - q.length) > max && !l.startsWith(q) ? Infinity : dist(q, l);
      if (dd > max && q.length >= 3 && l.startsWith(q)) dd = max;
      if (dd <= max && dd < bestD) { best = s; bestD = dd; }
    }
    return best;
  }

  /* ---------- Tokenizer (wirft nie, deckt den ganzen Text ab → Syntax-Hervorhebung) ---------- */
  const RE_WS = /\s+/y;
  const RE_NUM = /\d+(?:[.,]\d+)*/y;
  const RE_ID = /[\p{L}_][\p{L}\p{M}0-9_]*/uy;
  const ZEICHEN_HINWEIS = {
    ',': 'Argumente mit ; trennen – das Komma nur als Dezimalzeichen zwischen Ziffern (0,3)',
    '.': 'Dezimalpunkt nur zwischen Ziffern, z. B. 0.3',
    '!': 'Ungleich schreibt man <>',
    '&': 'Bedingungen mit UND(…; …) verknüpfen',
    '|': 'Bedingungen mit ODER(…; …) verknüpfen',
    "'": 'Texte in doppelte Anführungszeichen setzen: "…"',
    '{': 'Kennzahlen mit eckigen Klammern einbinden: [Gewinn]',
    '}': 'Kennzahlen mit eckigen Klammern einbinden: [Gewinn]',
    ']': 'Zu dieser „]“ fehlt die öffnende „[“',
    '€': 'Beträge ohne €-Zeichen schreiben, z. B. 1500',
    '−': 'Normales Minuszeichen „-“ verwenden',
    '×': 'Malzeichen ist „*“',
    '÷': 'Geteilt-Zeichen ist „/“'
  };
  const grab = (re, s, i) => { re.lastIndex = i; const m = re.exec(s); return m ? m[0] : null; };

  function tokenize(src) {
    src = src == null ? '' : String(src);
    const out = [];
    let i = 0, m;
    const add = (type, end, extra) => { out.push(Object.assign({ type, text: src.slice(i, end), start: i, end }, extra)); i = end; };
    while (i < src.length) {
      const c = src[i], c2 = src[i + 1];
      if ((m = grab(RE_WS, src, i))) add('ws', i + m.length);
      else if ((m = grab(RE_NUM, src, i))) {
        if (/[.,].*[.,]/.test(m)) add('error', i + m.length, { message: `Ungültige Zahl „${m}“`, hint: 'Ohne Tausendertrennzeichen schreiben, z. B. 1500,50' });
        else add('num', i + m.length, { value: parseFloat(m.replace(',', '.')) });
      } else if ((m = grab(RE_ID, src, i))) {
        let j = i + m.length;
        while (j < src.length && /\s/.test(src[j])) j++;
        add(src[j] === '(' ? 'func' : 'name', i + m.length);
      } else if ('"„“”'.includes(c)) {
        // "…" mit "" als Escape; typografische „…“ / “…” werden ebenfalls akzeptiert
        const gerade = c === '"';
        let j = i + 1, val = '', zu = false;
        while (j < src.length) {
          const ch = src[j];
          if (gerade ? ch === '"' : '"“”'.includes(ch)) {
            if (gerade && src[j + 1] === '"') { val += '"'; j += 2; continue; }
            zu = true; j++; break;
          }
          val += ch; j++;
        }
        if (zu) add('str', j, { value: val });
        else add('error', src.length, { message: 'Text ohne schließendes Anführungszeichen', hint: 'Den Text mit " abschließen' });
      } else if (c === '[') {
        const j = src.indexOf(']', i + 1);
        if (j < 0) add('error', src.length, { message: 'Fehlende schließende eckige Klammer „]“', hint: 'Kennzahlen so einbinden: [Gewinn]' });
        else add('ref', j + 1, { value: src.slice(i + 1, j).trim() });
      } else if ((c === '<' && (c2 === '=' || c2 === '>')) || (c === '>' && c2 === '=')) add('op', i + 2);
      else if ('+-*/^=<>'.includes(c)) add('op', i + 1);
      else if (c === '(' || c === ')') add('paren', i + 1);
      else if (c === ';') add('sep', i + 1);
      else if (c === ':') add('colon', i + 1);
      else if (c === '%') add('pct', i + 1);
      else {
        const ch = String.fromCodePoint(src.codePointAt(i));
        add('error', i + ch.length, { message: `Unerwartetes Zeichen „${ch}“`, hint: ZEICHEN_HINWEIS[ch] || 'Dieses Zeichen ist in Formeln nicht erlaubt' });
      }
    }
    return out;
  }

  /* ---------- Parser (rekursiver Abstieg) ----------
   * Knoten: num, str, name, ref, neg, pct, bin, call – jeweils mit start, end, text (Quelltext-Ausschnitt).
   * call: { key, pos: [Knoten], named: [{ key, expr, … }], set: 'BUCHUNGEN' | 'RECHNUNGEN' | null } */
  const CMP = new Set(['=', '<>', '<', '>', '<=', '>=']);
  const MAX_TIEFE = 64, MAX_TOKENS = 1000;
  const kurz = (t) => (t.text.length > 24 ? `${t.text.slice(0, 22)}…` : t.text);

  function parseNow(src) {
    const toks = tokenize(src).filter((t) => t.type !== 'ws');
    const bad = toks.find((t) => t.type === 'error');
    if (bad) fail(bad.message, bad, bad.hint);
    if (!toks.length) fail('Formel ist leer', { start: 0, end: src.length }, 'Zum Beispiel: EINNAHMEN() - AUSGABEN()');
    if (toks.length > MAX_TOKENS) fail('Formel ist zu lang', { start: 0, end: src.length }, `Höchstens ${MAX_TOKENS} Bausteine`);
    let i = 0, tiefe = 0;
    const peek = (k = 0) => toks[i + k];
    const isOp = (t, ...ops) => t && t.type === 'op' && ops.includes(t.text);
    const isP = (t, p) => t && t.type === 'paren' && t.text === p;
    const mk = (t, start, end, props) => Object.assign({ t, start, end, text: src.slice(start, end) }, props);
    const tiefer = () => { if (++tiefe > MAX_TIEFE) fail('Formel ist zu tief verschachtelt', peek() || toks[toks.length - 1], `Höchstens ${MAX_TIEFE} Ebenen`); };

    function unexpected(t, hint) {
      if (!t) { const p = toks[toks.length - 1]; fail('Formel ist unvollständig', p, `Nach „${kurz(p)}“ fehlt noch etwas`); }
      if (isP(t, ')')) fail('Überzählige schließende Klammer „)“', t, 'Zu dieser „)“ gibt es keine öffnende Klammer');
      if (t.type === 'sep') fail('Unerwartetes „;“', t, 'Das Semikolon trennt Argumente einer Funktion, z. B. MAX(1; 2)');
      if (t.type === 'colon') fail('Unerwarteter Doppelpunkt', t, 'Filter stehen in Datenfunktionen, z. B. EINNAHMEN(kategorie: "Material")');
      if (t.type === 'pct') fail('Unerwartetes „%“', t, 'Prozent steht direkt hinter einer Zahl, z. B. 30 %');
      fail(`Unerwartetes „${kurz(t)}“`, t, hint || 'Fehlt ein Rechenzeichen wie + oder * davor?');
    }

    function ausdruck() {
      const a = summe(), t = peek();
      if (!(t && t.type === 'op' && CMP.has(t.text))) return a;
      i++;
      const b = summe(), t2 = peek();
      if (t2 && t2.type === 'op' && CMP.has(t2.text)) fail('Vergleiche lassen sich nicht verketten', t2, 'Mehrere Bedingungen mit UND(…; …) verbinden');
      return mk('bin', a.start, b.end, { op: t.text, a, b });
    }
    function summe() {
      let a = produkt();
      while (isOp(peek(), '+', '-')) { const op = toks[i++].text, b = produkt(); a = mk('bin', a.start, b.end, { op, a, b }); }
      return a;
    }
    function produkt() {
      let a = potenz();
      while (isOp(peek(), '*', '/')) { const op = toks[i++].text, b = potenz(); a = mk('bin', a.start, b.end, { op, a, b }); }
      return a;
    }
    function potenz() {
      const a = unaer();
      if (!isOp(peek(), '^')) return a;
      i++;
      tiefer();
      try { const b = potenz(); return mk('bin', a.start, b.end, { op: '^', a, b }); } finally { tiefe--; }
    }
    function unaer() {
      tiefer();
      try {
        const t = peek();
        if (isOp(t, '-', '+')) {
          i++;
          const a = unaer();
          return t.text === '-' ? mk('neg', t.start, a.end, { a }) : Object.assign({}, a, { start: t.start, text: src.slice(t.start, a.end) });
        }
        const a = primaer();
        if (peek() && peek().type === 'pct') { const p = toks[i++]; return mk('pct', a.start, p.end, { a }); }
        return a;
      } finally { tiefe--; }
    }
    function primaer() {
      const t = peek();
      if (!t) unexpected(t);
      if (t.type === 'num') { i++; return mk('num', t.start, t.end, { v: t.value }); }
      if (t.type === 'str') { i++; return mk('str', t.start, t.end, { v: t.value }); }
      if (t.type === 'ref') {
        i++;
        if (!t.value) fail('Leerer Kennzahl-Bezug „[]“', t, 'Namen einer Kennzahl eintragen, z. B. [Gewinn]');
        return mk('ref', t.start, t.end, { name: t.value });
      }
      if (t.type === 'func') return call();
      if (t.type === 'name') {
        i++;
        const key = t.text.toUpperCase();
        if (MENGEN.has(key)) fail(`${key} geht nur als erstes Argument von ANZAHL, SUMME oder DURCHSCHNITT`, t, `z. B. ANZAHL(${key})`);
        return mk('name', t.start, t.end, { name: t.text, key });
      }
      if (isP(t, '(')) {
        i++;
        const a = ausdruck(), c = peek();
        if (!c) fail('Fehlende schließende Klammer', t, 'Zur markierten „(“ fehlt die passende „)“');
        if (!isP(c, ')')) unexpected(c, 'Fehlt ein Rechenzeichen oder eine „)“?');
        i++;
        return Object.assign({}, a, { start: t.start, end: c.end, text: src.slice(t.start, c.end) });
      }
      if (t.type === 'sep' || isP(t, ')')) { const p = toks[i - 1]; fail(`Wert fehlt vor „${t.text}“`, t, p ? `Nach „${kurz(p)}“ fehlt ein Wert` : 'Hier fehlt ein Wert'); }
      unexpected(t, 'Hier fehlt ein Wert');
    }
    function call() {
      const nt = toks[i++], key = nt.text.toUpperCase(), def = FN.get(key);
      if (!def) {
        if (KONST.has(key) || MENGEN.has(key)) fail(`„${nt.text}“ ist keine Funktion`, nt, `Ohne Klammern schreiben: ${key}`);
        const s = suggest(key, FN_NAMEN);
        fail(`Unbekannte Funktion „${nt.text}“`, nt, s ? `Meintest du ${s}?` : 'Die verfügbaren Funktionen stehen in der Formel-Hilfe');
      }
      const open = toks[i++]; // „(“ – vom Tokenizer garantiert
      const pos = [], named = [];
      let set = null, close = null;
      const offen = () => fail('Fehlende schließende Klammer', open, 'Zur markierten „(“ fehlt die passende „)“');
      if (isP(peek(), ')')) close = toks[i++];
      while (!close) {
        const t = peek();
        if (!t) offen();
        if (t.type === 'sep' || isP(t, ')')) fail('Argument fehlt', t, 'Zwischen den „;“ muss ein Wert stehen');
        if (t.type === 'name' && peek(1) && peek(1).type === 'colon') {
          // benannter Filter: name: ausdruck
          i += 2;
          const fk = t.text.toLowerCase();
          if (!FILTER_NAMEN.includes(fk)) {
            const s = suggest(fk, FILTER_NAMEN), erlaubt = filterFuer(def, set);
            fail(`Filter „${t.text}“ unbekannt${s ? ` – meintest du ${s}?` : ''}`, t, erlaubt.length ? `Mögliche Filter: ${erlaubt.join(', ')}` : `${def.name} hat keine Filter`);
          }
          if (named.some((a) => a.key === fk)) fail(`Filter „${fk}“ ist doppelt angegeben`, t, 'Jeden Filter nur einmal verwenden');
          const expr = ausdruck();
          if (expr.t === 'name' && TEXT_FILTER.has(fk)) expr.quote = true;
          named.push({ key: fk, start: t.start, end: expr.end, nameEnd: t.end, text: src.slice(t.start, expr.end), expr });
        } else if (def.set && !set && !pos.length && t.type === 'name' && MENGEN.has(t.text.toUpperCase())) {
          i++;
          set = t.text.toUpperCase();
        } else {
          const e = ausdruck();
          if (e.t === 'name' && def.quote) e.quote = true;
          pos.push(e);
        }
        const s = peek();
        if (!s) offen();
        if (s.type === 'sep') { i++; continue; }
        if (isP(s, ')')) { close = toks[i++]; break; }
        unexpected(s, 'Fehlt ein „;“ zwischen den Argumenten?');
      }
      const n = mk('call', nt.start, close.end, { name: nt.text, key, pos, named, set });
      pruefeAufruf(n, def);
      return n;
    }

    const ast = ausdruck();
    if (i < toks.length) unexpected(toks[i]);
    ast.src = src;
    return ast;
  }

  const F_MENGE_ALLE = [...new Set([...F_MENGE.BUCHUNGEN, ...F_MENGE.RECHNUNGEN])];
  const filterFuer = (def, set) => (def.set ? (set ? F_MENGE[set] : F_MENGE_ALLE) : def.filters);
  const arg = (k) => (k === 1 ? '1 Argument' : `${k} Argumente`);

  /* Statische Prüfung eines Aufrufs: Anzahl Argumente, passende Filter, BUCHUNGEN/RECHNUNGEN */
  function pruefeAufruf(n, def) {
    const nm = def.name, k = n.pos.length;
    if (def.set && !n.set) {
      if (nm === 'ANZAHL' || !k) fail(`${nm} erwartet BUCHUNGEN oder RECHNUNGEN als erstes Argument`, n.pos[0] || n, `z. B. ${nm}(RECHNUNGEN; status: "bezahlt")`);
      if (n.named.length) { const a = n.named[0]; fail(`Filter gehen bei ${nm} nur zusammen mit BUCHUNGEN oder RECHNUNGEN`, { start: a.start, end: a.nameEnd }, `z. B. ${nm}(BUCHUNGEN; ${a.key}: …)`); }
      return; // Zahlen-Form: SUMME(a; b; …) / DURCHSCHNITT(a; b; …)
    }
    const erlaubt = filterFuer(def, n.set);
    for (const a of n.named) {
      if (erlaubt.includes(a.key)) continue;
      fail(erlaubt.length ? `Filter „${a.key}“ passt nicht zu ${nm}${n.set ? `(${n.set})` : ''}` : `${nm} hat keine Filter`,
        { start: a.start, end: a.nameEnd }, erlaubt.length ? `Möglich: ${erlaubt.join(', ')}` : '');
    }
    if (def.set) {
      const max = nm === 'DURCHSCHNITT' ? 1 : 0;
      if (k > max) fail(`${nm}(${n.set}; …) erwartet ${max ? 'ein Feld und Filter' : 'nur Filter'}`, n.pos[max], `z. B. ${def.example}`);
    } else if (def.max === 0 && k > 0) {
      fail(def.filters.length ? `${nm} erwartet nur Filter` : `${nm}() erwartet keine Argumente`, n.pos[0], def.filters.length ? `z. B. ${def.example}` : `Einfach ${nm}() schreiben`);
    } else if (k < def.min) {
      fail(`${nm} braucht ${def.min === def.max ? 'genau' : 'mindestens'} ${arg(def.min)}`, n, `Schreibweise: ${def.sig}`);
    } else if (k > def.max) {
      fail(`${nm} erwartet höchstens ${arg(def.max)}`, n.pos[def.max], `Schreibweise: ${def.sig}`);
    }
  }

  /* AST-Cache nach Quelltext (Kennzahlen werden oft für viele Zeiträume ausgewertet) */
  const cache = new Map();
  function parse(src) {
    src = src == null ? '' : String(src);
    let ast = cache.get(src);
    if (!ast) {
      ast = parseNow(src);
      if (cache.size >= 500) cache.clear();
      cache.set(src, ast);
    }
    return ast;
  }

  /* ---------- Auswertung ---------- */
  const fin = (x) => (Number.isFinite(x) ? x : NaN);
  const eur = (x) => `${x.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const zeig = (v) => (v instanceof Zeitraum ? describe(v) : v);
  const nahe = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));

  function toNum(v, at) {
    if (typeof v === 'number') return v;
    if (v instanceof Zeitraum) fail('Zeitraum kann nicht gerechnet werden', at, 'Zeiträume nur als Filter oder in IM(…) verwenden, z. B. EINNAHMEN(zeitraum: JAHR)');
    if (typeof v === 'string') fail('Text kann nicht gerechnet werden', at, 'Text in Anführungszeichen ist für Filter gedacht, z. B. kategorie: "Material"');
    return fail('Wert kann nicht gerechnet werden', at);
  }
  function toText(v, a) {
    if (typeof v !== 'string') fail(`${a.key}: erwartet einen Text in Anführungszeichen`, a.expr, `z. B. ${a.key}: "…"`);
    if (!v.trim()) fail(`${a.key}: Text ist leer`, a.expr);
    return v.trim();
  }

  /* Umgebung je Auswertung: Zeitraum, vorbereitete Daten, Variablen, Kennzahlen */
  function mkEnv(ctx, ast) {
    ctx = ctx || {};
    const data = ctx.data || (typeof window !== 'undefined' && window.DATA) || {};
    const heute = String(ctx.heute || data.TODAY || todayIso());
    const bis = String(ctx.bis || heute);
    const von = String(ctx.von || `${bis.slice(0, 4)}-01-01`);
    const ganz = { start: 0, end: ast.end };
    for (const [k, v] of [['von', von], ['bis', bis], ['heute', heute]]) if (!ISO.test(v)) fail(`Ungültiges Datum für ${k}: „${v}“`, ganz, 'Format JJJJ-MM-TT');
    if (von > bis) fail('Zeitraum ungültig: Beginn liegt nach dem Ende', ganz);
    const vars = new Map(), varNamen = [];
    const quelle = ctx.vars != null ? ctx.vars : data.VARIABLEN;
    const setVar = (k, w) => { vars.set(String(k).toUpperCase(), Number(w)); varNamen.push(String(k)); };
    if (Array.isArray(quelle)) quelle.forEach((v) => v && v.name != null && setVar(v.name, v.wert));
    else if (quelle && typeof quelle === 'object') Object.keys(quelle).forEach((k) => setVar(k, quelle[k]));
    const kats = Array.isArray(data.KATEGORIEN) ? data.KATEGORIEN : [];
    const rech = Array.isArray(data.rechnungen) ? data.rechnungen : [];
    const d = {
      buch: Array.isArray(data.buchungen) ? data.buchungen : [],
      rech, kats, kat: new Map(kats.map((k) => [k.id, k])),
      kontakte: Array.isArray(data.KONTAKTE) ? data.KONTAKTE : [],
      params: data.PARAMS || {},
      rsum: typeof data.rechnungSumme === 'function' ? data.rechnungSumme
        : (r) => (Array.isArray(r.positionen) ? r.positionen.reduce((s, p) => s + Math.round((+p.menge || 0) * (+p.preis || 0)), 0) : +r.summe || 0),
      status: [...new Set([...STATUS, ...rech.map((r) => r.status).filter(Boolean)])],
      arten: [...new Set([...ARTEN, ...rech.map((r) => r.art).filter(Boolean)])]
    };
    return {
      von, bis, heute, d, vars, varNamen,
      kpis: Array.isArray(ctx.kennzahlen) ? ctx.kennzahlen : Array.isArray(data.KENNZAHLEN) ? data.KENNZAHLEN : [],
      stack: ctx.name ? [{ key: String(ctx.name).trim().toLowerCase(), name: String(ctx.name).trim() }] : [],
      memo: new Map(), tr: null
    };
  }
  const imZeitraum = (env, p) => Object.assign({}, env, { von: p.von, bis: p.bis });

  /* Knoten auswerten – bei explain() wird nebenbei ein Erklärbaum aufgebaut */
  function ev(n, env) {
    if (!env.tr || n.t === 'str') return run(n, env);
    return traced(env, n.text, () => run(n, env), zeig);
  }
  function traced(env, label, fn, fmt) {
    const tr = env.tr;
    if (!tr) return fn();
    const rec = { label: label.replace(/\s+/g, ' ').trim(), value: null, children: [] };
    const cur = tr.cur, prev = tr.rec;
    cur.push(rec);
    tr.cur = rec.children; tr.rec = rec;
    try { const v = fn(); rec.value = fmt(v); return v; } finally { tr.cur = cur; tr.rec = prev; }
  }
  /* Zusatzinfo für den Erklärbaum (nur berechnet, wenn erklärt wird) */
  const note = (env, fn) => { if (env.tr && env.tr.rec) env.tr.rec.note = fn(); };

  function run(n, env) {
    switch (n.t) {
      case 'num': case 'str': return n.v;
      case 'name': return evalName(n, env);
      case 'ref': return evalRef(n, env);
      case 'neg': { const x = toNum(ev(n.a, env), n.a); return x === 0 ? 0 : -x; }
      case 'pct': return toNum(ev(n.a, env), n.a) / 100;
      case 'bin': return evalBin(n, env);
      case 'call': return FN.get(n.key).run(n, env);
      default: return fail('Interner Fehler: unbekannter Knoten', n);
    }
  }

  function evalBin(n, env) {
    const a = ev(n.a, env), b = ev(n.b, env);
    if (CMP.has(n.op)) return vergleich(n, a, b);
    const x = toNum(a, n.a), y = toNum(b, n.b);
    switch (n.op) {
      case '+': return fin(x + y);
      case '-': return fin(x - y);
      case '*': return fin(x * y);
      case '/': return y === 0 ? NaN : fin(x / y);
      default: return fin(Math.pow(x, y));
    }
  }
  function vergleich(n, a, b) {
    const sa = typeof a === 'string', sb = typeof b === 'string';
    let c;
    if (sa && sb) c = a.localeCompare(b, 'de', { sensitivity: 'accent' });
    else {
      const x = sa ? a : toNum(a, n.a), y = sb ? b : toNum(b, n.b);
      if (sa || sb) fail('Text und Zahl lassen sich nicht vergleichen', n);
      if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
      c = nahe(x, y) ? 0 : x < y ? -1 : 1;
    }
    switch (n.op) {
      case '=': return +(c === 0);
      case '<>': return +(c !== 0);
      case '<': return +(c < 0);
      case '>': return +(c > 0);
      case '<=': return +(c <= 0);
      default: return +(c >= 0);
    }
  }

  function findKpi(env, name) {
    const q = String(name).trim().toLowerCase();
    return env.kpis.find((k) => k && String(k.name).trim().toLowerCase() === q) || env.kpis.find((k) => k && k.id != null && String(k.id).toLowerCase() === q);
  }

  function evalName(n, env) {
    const k = n.key;
    if (KONST.has(k)) return KONST.get(k)(env);
    if (env.vars.has(k)) return env.vars.get(k);
    if (FN.has(k)) fail(`Fehlende Klammern bei „${n.name}“`, n, `Funktionen brauchen Klammern: ${k}()`);
    const kz = findKpi(env, n.name);
    if (kz) fail(`Unbekannte Variable „${n.name}“`, n, `Kennzahlen in eckigen Klammern schreiben: [${kz.name}]`);
    const s = suggest(n.name, [...KONST.keys(), ...env.varNamen]);
    fail(`Unbekannte Variable „${n.name}“`, n, n.quote ? `Text in Anführungszeichen setzen: "${n.name}"`
      : s ? `Meintest du ${s}?` : 'Erlaubt sind Variablen, Zeiträume wie JAHR und Funktionen mit Klammern');
  }

  /* [Kennzahl] – Formel der Kennzahl im selben Zeitraum auswerten, Zirkelbezüge erkennen */
  function evalRef(n, env) {
    const kz = findKpi(env, n.name);
    if (!kz) { const s = suggest(n.name, env.kpis.filter((k) => k && k.name != null).map((k) => k.name)); fail(`Unbekannte Kennzahl [${n.name}]`, n, s ? `Meintest du [${s}]?` : 'Namen einer vorhandenen Kennzahl in eckige Klammern setzen'); }
    const name = String(kz.name).trim(), key = name.toLowerCase();
    const at = env.stack.findIndex((s) => s.key === key);
    if (at >= 0) {
      const kette = [...env.stack.slice(at).map((s) => s.name), name].map((x) => `[${x}]`).join(' → ');
      const e = new FormulaError(`Zirkelbezug: ${kette}`, n.start, n.end, 'Eine Kennzahl darf sich nicht (auch nicht über Umwege) selbst verwenden');
      e.zirkel = true;
      throw e;
    }
    const mkey = `${key}|${env.von}|${env.bis}`;
    if (!env.tr && env.memo.has(mkey)) return env.memo.get(mkey);
    let v;
    try {
      const ast = parse(kz.formel == null ? '' : String(kz.formel));
      v = toNum(ev(ast, Object.assign({}, env, { stack: [...env.stack, { key, name }] })), ast);
    } catch (e) {
      if (!(e instanceof FormulaError)) throw e;
      // Position auf den Bezug in der äußeren Formel umbiegen
      const w = new FormulaError(e.zirkel || e.imBezug ? e.message : `In Kennzahl [${name}]: ${e.message}`, n.start, n.end, e.hint);
      w.zirkel = e.zirkel; w.imBezug = true;
      throw w;
    }
    env.memo.set(mkey, v);
    return v;
  }

  /* ---------- Datenzugriff ---------- */
  function matchKategorie(d, t, at) {
    const q = t.toLowerCase(), stufen = [[], [], []];
    for (const k of d.kats) {
      const id = String(k.id).toLowerCase(), nm = String(k.name || '').toLowerCase();
      const s = id === q || nm === q ? 0 : nm.startsWith(q) ? 1 : nm.includes(q) ? 2 : -1;
      if (s >= 0) stufen[s].push(k);
    }
    const hit = stufen.find((x) => x.length);
    if (!hit) {
      const s = suggest(q, d.kats.flatMap((k) => [String(k.id), String(k.name)]));
      const k = s && d.kats.find((x) => String(x.id) === s || String(x.name) === s);
      fail(`Kategorie „${t}“ nicht gefunden`, at, k ? `Meintest du „${k.name}“?` : 'Name oder ID einer Kategorie angeben, z. B. "Material"');
    }
    return { ids: new Set(hit.map((k) => k.id)), label: hit.map((k) => k.name).join(', ') };
  }
  function matchKontakt(d, t) {
    const q = t.toLowerCase();
    const hit = d.kontakte.filter((k) => String(k.id).toLowerCase() === q || String(k.name || '').toLowerCase().includes(q));
    return { ids: new Set(hit.map((k) => k.id)), q, label: hit.length ? hit.map((k) => k.name).join(', ') : `„${t}“ (kein Kunde gefunden)` };
  }
  /* Kunde passt über die Kontakt-ID oder – bei Quittungen ohne Kontakt – über den freien Kundennamen */
  const kontaktOk = (f, x) => f.kon.every((m) => m.ids.has(x.kontakt) || (typeof x.kunde === 'string' && x.kunde.toLowerCase().includes(m.q)));
  function wort(v, a, liste, was) {
    const t = toText(v, a).toLowerCase();
    if (liste.includes(t)) return t;
    const s = suggest(t, liste);
    return fail(`${was} „${t}“ unbekannt${s ? ` – meintest du ${s}?` : ''}`, a.expr, `Möglich: ${liste.join(', ')}`);
  }

  /* Benannte Filter eines Aufrufs auswerten */
  function readFilters(n, env) {
    const f = { von: env.von, bis: env.bis, kat: null, kon: [], za: null, typ: null, status: null, art: null };
    for (const a of n.named) {
      traced(env, a.text, () => {
        const v = ev(a.expr, env);
        switch (a.key) {
          case 'zeitraum':
            if (!(v instanceof Zeitraum)) fail('zeitraum: erwartet einen Zeitraum', a.expr, 'z. B. zeitraum: JAHR, VORMONAT oder LETZTE_TAGE(30)');
            f.von = v.von; f.bis = v.bis;
            return describe(v);
          case 'kategorie': f.kat = matchKategorie(env.d, toText(v, a), a.expr); return f.kat.label;
          case 'kunde': case 'kontakt': { const m = matchKontakt(env.d, toText(v, a)); f.kon.push(m); return m.label; }
          case 'zahlungsart': return (f.za = wort(v, a, ZAHLUNGSARTEN, 'Zahlungsart'));
          case 'typ': return (f.typ = wort(v, a, TYPEN, 'Typ'));
          case 'status': return (f.status = wort(v, a, env.d.status, 'Status'));
          default: return (f.art = wort(v, a, env.d.arten, 'Art'));
        }
      }, (x) => x);
    }
    return f;
  }
  function eachBuchung(env, f, cb) {
    for (const b of env.d.buch) {
      if (!(b.datum >= f.von && b.datum <= f.bis)) continue;
      if (f.typ && b.typ !== f.typ) continue;
      if (f.kat && !f.kat.ids.has(b.kat)) continue;
      if (f.za && b.zahlungsart !== f.za) continue;
      if (f.kon.length && !kontaktOk(f, b)) continue;
      cb(b);
    }
  }
  /* Standard: Rechnungen + Quittungen, ohne Entwürfe/Stornos – außer art:/status: sagt etwas anderes */
  function eachRechnung(env, f, cb) {
    for (const r of env.d.rech) {
      if (!(r.datum >= f.von && r.datum <= f.bis)) continue;
      if (f.art ? r.art !== f.art : r.art !== 'rechnung' && r.art !== 'quittung') continue;
      if (f.status ? r.status !== f.status : r.status === 'entwurf' || r.status === 'storniert') continue;
      if (f.za && r.zahlungsart !== f.za) continue;
      if (f.kon.length && !kontaktOk(f, r)) continue;
      cb(r);
    }
  }
  /* Abziehbarer Anteil einer Ausgabe (Cent): ohne Privatanteil, mit Abzugsquote der Kategorie –
   * je Ausgabe auf ganze Cent gerundet, genau wie App.summen() und die EÜR (sonst weichen Summen um Cent-Bruchteile ab) */
  const abziehbar = (b, d) => {
    const k = d.kat.get(b.kat), q = k && k.abziehbar != null ? +k.abziehbar : 100;
    return Math.round(b.betrag * (1 - (+b.privat || 0) / 100) * q / 100);
  };
  const anzahl = (c, wort1, wortN) => `${c} ${c === 1 ? wort1 : wortN}`;

  /* Summe über Buchungen; pick liefert Cent oder null (= zählt nicht) */
  const sumBuch = (pick) => (n, env) => {
    const f = readFilters(n, env);
    let s = 0, c = 0;
    eachBuchung(env, f, (b) => { const v = pick(b, env.d); if (v !== null) { s += v; c++; } });
    note(env, () => `${describe(f)} · ${anzahl(c, 'Buchung', 'Buchungen')}`);
    return s / 100;
  };
  const pickEin = (b) => (b.typ === 'einnahme' ? b.betrag : null);
  const pickAus = (b, d) => (b.typ === 'ausgabe' ? abziehbar(b, d) : null);
  const pickBrutto = (b) => (b.typ === 'ausgabe' ? b.betrag : null);
  const pickKu = (b, d) => { const k = d.kat.get(b.kat); return b.typ === 'einnahme' && k && k.ku ? b.betrag : null; };

  function runGewinn(n, env) {
    const f = readFilters(n, env);
    let ein = 0, aus = 0;
    eachBuchung(env, f, (b) => { if (b.typ === 'einnahme') ein += b.betrag; else if (b.typ === 'ausgabe') aus += abziehbar(b, env.d); });
    note(env, () => `${describe(f)} · Einnahmen ${eur(ein / 100)} − Ausgaben ${eur(aus / 100)}`);
    return ein / 100 - aus / 100;
  }
  /* Offene Rechnungen zum Stichtag (Ende des Zeitraums): offen, oder erst nach dem Stichtag bezahlt */
  function runOffen(n, env) {
    const f = readFilters(n, env);
    let s = 0, c = 0;
    for (const r of env.d.rech) {
      if (r.art !== 'rechnung' || !(r.datum <= f.bis)) continue;
      if (!(r.status === 'offen' || (r.status === 'bezahlt' && r.bezahltAm && r.bezahltAm > f.bis))) continue;
      if (f.kon.length && !kontaktOk(f, r)) continue;
      s += env.d.rsum(r); c++;
    }
    note(env, () => `Stand ${deDate(f.bis)} · ${anzahl(c, 'Rechnung', 'Rechnungen')}`);
    return s / 100;
  }
  /* ANZAHL / SUMME / DURCHSCHNITT über BUCHUNGEN bzw. RECHNUNGEN (oder einfache Zahlen-Form) */
  const runMenge = (art) => (n, env) => {
    if (!n.set) {
      const xs = n.pos.map((a) => toNum(ev(a, env), a)), s = xs.reduce((p, x) => p + x, 0);
      return fin(art === 'summe' ? s : s / xs.length);
    }
    const f = readFilters(n, env), istB = n.set === 'BUCHUNGEN';
    let feld = 'betrag';
    if (n.pos.length) {
      const a = n.pos[0], v = ev(a, env);
      if (typeof v !== 'string') fail('Feld als Text angeben', a, 'z. B. "betrag" oder "zahlungsdauer"');
      feld = v.trim().toLowerCase();
      if (feld !== 'betrag' && feld !== 'zahlungsdauer') { const s = suggest(feld, ['betrag', 'zahlungsdauer']); fail(`Unbekanntes Feld „${v}“`, a, s ? `Meintest du "${s}"?` : 'Möglich: "betrag", "zahlungsdauer"'); }
      if (feld === 'zahlungsdauer' && istB) fail('Feld „zahlungsdauer“ gibt es nur bei RECHNUNGEN', a, 'DURCHSCHNITT(RECHNUNGEN; "zahlungsdauer")');
    }
    let s = 0, c = 0;
    if (istB) eachBuchung(env, f, (b) => { s += b.betrag; c++; });
    else if (feld === 'zahlungsdauer') eachRechnung(env, f, (r) => { if (typeof r.bezahltAm === 'string' && ISO.test(r.bezahltAm)) { s += days(r.datum, r.bezahltAm); c++; } });
    else eachRechnung(env, f, (r) => { s += env.d.rsum(r); c++; });
    note(env, () => `${describe(f)} · ${istB ? anzahl(c, 'Buchung', 'Buchungen') : anzahl(c, 'Rechnung', 'Rechnungen')}`);
    const wert = feld === 'zahlungsdauer' ? s : s / 100;
    return art === 'anzahl' ? c : art === 'summe' ? wert : c ? wert / c : NaN;
  };

  /* ---------- Funktionstabelle ---------- */
  const FN = new Map();
  const FUNCTIONS = [];
  function def(name, sig, group, desc, example, spec) {
    FN.set(name, Object.assign({ name, sig, example, min: 0, max: 0, filters: [] }, spec));
    FUNCTIONS.push({ name, sig, group, desc, example });
  }
  const zahl = (n, env, k = 0) => toNum(ev(n.pos[k], env), n.pos[k]);
  const zahlen = (n, env) => n.pos.map((a) => toNum(ev(a, env), a));
  const optZeitraum = (n, env) => {
    if (!n.pos.length) return new Zeitraum(env.von, env.bis);
    const p = ev(n.pos[0], env);
    if (!(p instanceof Zeitraum)) fail(`${n.key} erwartet einen Zeitraum`, n.pos[0], `z. B. ${n.key}(JAHR)`);
    return p;
  };
  function runden(x, st) {
    if (!Number.isFinite(x) || !Number.isFinite(st)) return NaN;
    st = Math.max(-300, Math.min(15, Math.trunc(st)));
    const f = Math.pow(10, Math.abs(st)), a = Math.abs(x) * (1 + 2 * Number.EPSILON); // kaufmännisch, robust gegen 1,005
    const v = Math.sign(x) * (st >= 0 ? Math.round(a * f) / f : Math.round(a / f) * f);
    return v === 0 ? 0 : fin(v);
  }

  // Daten
  def('EINNAHMEN', 'EINNAHMEN(filter…)', 'Daten', 'Summe der Einnahmen im Zeitraum in €.', 'EINNAHMEN(zahlungsart: "bar")', { filters: F_BUCH, run: sumBuch(pickEin) });
  def('AUSGABEN', 'AUSGABEN(filter…)', 'Daten', 'Abziehbare Betriebsausgaben in € (ohne Privatanteil und nicht abziehbare Anteile).', 'AUSGABEN(kategorie: "Sprit")', { filters: F_BUCH, run: sumBuch(pickAus) });
  def('AUSGABEN_BRUTTO', 'AUSGABEN_BRUTTO(filter…)', 'Daten', 'Ausgaben zum vollen Betrag, ohne Abzüge.', 'AUSGABEN_BRUTTO(zahlungsart: "bar")', { filters: F_BUCH, run: sumBuch(pickBrutto) });
  def('GEWINN', 'GEWINN(filter…)', 'Daten', 'Einnahmen minus abziehbare Ausgaben (EÜR).', 'GEWINN(zeitraum: YTD)', { filters: F_BUCH, run: runGewinn });
  def('KU_UMSATZ', 'KU_UMSATZ(filter…)', 'Daten', 'Umsatz, der für die Kleinunternehmergrenze zählt.', 'KU_UMSATZ(zeitraum: JAHR)', { filters: F_BUCH, run: sumBuch(pickKu) });
  def('OFFEN', 'OFFEN(filter…)', 'Daten', 'Offene Rechnungen zum Ende des Zeitraums (Stichtag), unabhängig vom Beginn.', 'OFFEN(kunde: "Hausverwaltung")', { filters: ['kunde', 'kontakt', 'zeitraum'], run: runOffen });
  def('ANZAHL', 'ANZAHL(BUCHUNGEN | RECHNUNGEN; filter…)', 'Daten', 'Anzahl der Buchungen bzw. Rechnungen im Zeitraum.', 'ANZAHL(RECHNUNGEN; status: "bezahlt")', { set: true, run: runMenge('anzahl') });
  def('SUMME', 'SUMME(BUCHUNGEN | RECHNUNGEN; filter…)', 'Daten', 'Summe der Beträge in € – oder SUMME(a; b; …) für Zahlen.', 'SUMME(BUCHUNGEN; typ: "ausgabe"; zahlungsart: "bar")', { set: true, run: runMenge('summe') });
  def('DURCHSCHNITT', 'DURCHSCHNITT(BUCHUNGEN | RECHNUNGEN; "feld"; filter…)', 'Daten', 'Durchschnitt von "betrag" (€) oder "zahlungsdauer" (Tage bis zur Zahlung, nur Rechnungen).', 'DURCHSCHNITT(RECHNUNGEN; "zahlungsdauer")', { set: true, quote: true, run: runMenge('schnitt') });
  // Zeitraum
  def('VORPERIODE', 'VORPERIODE(ausdruck)', 'Zeitraum', 'Wert im gleich langen Zeitraum direkt davor (Monat → Vormonat, Quartal → Vorquartal).', 'EINNAHMEN() - VORPERIODE(EINNAHMEN())', {
    min: 1, max: 1, run: (n, env) => { const p = vorperiode(new Zeitraum(env.von, env.bis)); note(env, () => describe(p)); return ev(n.pos[0], imZeitraum(env, p)); }
  });
  def('VORJAHR', 'VORJAHR(ausdruck)', 'Zeitraum', 'Wert im gleichen Zeitraum ein Jahr früher.', 'TEILEN(EINNAHMEN(); VORJAHR(EINNAHMEN()); 0) - 1', {
    min: 1, max: 1, run: (n, env) => { const p = vorjahr(new Zeitraum(env.von, env.bis)); note(env, () => describe(p)); return ev(n.pos[0], imZeitraum(env, p)); }
  });
  def('IM', 'IM(zeitraum; ausdruck)', 'Zeitraum', 'Wert in einem anderen Zeitraum.', 'IM(VORMONAT; EINNAHMEN())', {
    min: 2, max: 2, run: (n, env) => {
      const p = ev(n.pos[0], env);
      if (!(p instanceof Zeitraum)) fail('IM erwartet als erstes Argument einen Zeitraum', n.pos[0], 'z. B. IM(VORMONAT; EINNAHMEN())');
      note(env, () => describe(p));
      return ev(n.pos[1], imZeitraum(env, p));
    }
  });
  def('LETZTE_TAGE', 'LETZTE_TAGE(n)', 'Zeitraum', 'Zeitraum der letzten n Tage bis zum Ende des gewählten Zeitraums.', 'EINNAHMEN(zeitraum: LETZTE_TAGE(30))', {
    min: 1, max: 1, run: (n, env) => {
      const k = zahl(n, env);
      if (!(k >= 1 && k <= 36600)) fail('LETZTE_TAGE braucht eine Anzahl Tage ab 1', n.pos[0], 'z. B. LETZTE_TAGE(30)');
      return new Zeitraum(addDays(env.bis, 1 - Math.round(k)), env.bis);
    }
  });
  def('TAGE', 'TAGE()', 'Zeitraum', 'Anzahl der Tage im Zeitraum (auch TAGE(zeitraum)).', 'EINNAHMEN() / TAGE()', {
    max: 1, run: (n, env) => { const p = optZeitraum(n, env); return days(p.von, p.bis) + 1; }
  });
  def('MONATE', 'MONATE()', 'Zeitraum', 'Anzahl der Monate im Zeitraum; angebrochene anteilig (auch MONATE(zeitraum)).', 'AUSGABEN() / MONATE()', {
    max: 1, run: (n, env) => { const p = optZeitraum(n, env); return ganzeMonate(p) || (days(p.von, p.bis) + 1) / 30.4375; }
  });
  def('MONATE_VERGANGEN', 'MONATE_VERGANGEN()', 'Zeitraum', 'Im Jahr bereits vergangene Monate bis heute, anteilig (9. Oktober → 9,29).', 'KU_UMSATZ(zeitraum: YTD) / MONATE_VERGANGEN() * 12', {
    run: (n, env) => {
      const stand = env.bis < env.heute ? env.bis : env.heute, [y, m, t] = parts(stand);
      note(env, () => `Stand ${deDate(stand)}`);
      return y < parts(env.bis)[0] ? 0 : m - 1 + t / dim(y, m);
    }
  });
  // Logik
  def('WENN', 'WENN(bedingung; dann; sonst)', 'Logik', 'Liefert „dann“, wenn die Bedingung erfüllt (≠ 0) ist, sonst „sonst“ (Standard 0).', 'WENN(GEWINN() > 0; GEWINN() * STEUERQUOTE; 0)', {
    min: 2, max: 3, run: (n, env) => {
      const c = zahl(n, env);
      if (Number.isNaN(c)) return NaN;
      return c !== 0 ? ev(n.pos[1], env) : n.pos[2] ? ev(n.pos[2], env) : 0;
    }
  });
  const logik = (fn) => (n, env) => { const xs = zahlen(n, env); return xs.some(Number.isNaN) ? NaN : +fn(xs); };
  def('UND', 'UND(a; b; …)', 'Logik', '1, wenn alle Bedingungen erfüllt sind, sonst 0.', 'UND(EINNAHMEN() > 0; GEWINN() > 0)', { min: 1, max: Infinity, run: logik((xs) => xs.every((x) => x !== 0)) });
  def('ODER', 'ODER(a; b; …)', 'Logik', '1, wenn mindestens eine Bedingung erfüllt ist, sonst 0.', 'ODER(OFFEN() > 1000; GEWINN() < 0)', { min: 1, max: Infinity, run: logik((xs) => xs.some((x) => x !== 0)) });
  def('NICHT', 'NICHT(a)', 'Logik', 'Kehrt eine Bedingung um: 0 → 1, sonst 0.', 'NICHT(GEWINN() < 0)', { min: 1, max: 1, run: logik((xs) => xs[0] === 0) });
  // Mathe
  def('MIN', 'MIN(a; b; …)', 'Mathe', 'Kleinster Wert.', 'MIN(GEWINN(); 10000)', { min: 1, max: Infinity, run: (n, env) => Math.min(...zahlen(n, env)) });
  def('MAX', 'MAX(a; b; …)', 'Mathe', 'Größter Wert.', 'MAX(0; GEWINN())', { min: 1, max: Infinity, run: (n, env) => Math.max(...zahlen(n, env)) });
  def('ABS', 'ABS(x)', 'Mathe', 'Betrag ohne Vorzeichen.', 'ABS(GEWINN())', { min: 1, max: 1, run: (n, env) => Math.abs(zahl(n, env)) });
  def('RUNDEN', 'RUNDEN(x; stellen)', 'Mathe', 'Kaufmännisch runden auf „stellen“ Nachkommastellen (Standard 0, negativ = auf Zehner/Hunderter).', 'RUNDEN(GEWINN() * STEUERQUOTE; -2)', {
    min: 1, max: 2, run: (n, env) => runden(zahl(n, env), n.pos[1] ? zahl(n, env, 1) : 0)
  });
  def('WURZEL', 'WURZEL(x)', 'Mathe', 'Quadratwurzel (negativ → nicht berechenbar).', 'WURZEL(16)', { min: 1, max: 1, run: (n, env) => fin(Math.sqrt(zahl(n, env))) });
  def('TEILEN', 'TEILEN(a; b; ersatz)', 'Mathe', 'a ÷ b – bei b = 0 oder nicht berechenbar stattdessen „ersatz“ (Standard 0).', 'TEILEN(GEWINN(); EINNAHMEN(); 0)', {
    min: 2, max: 3, run: (n, env) => {
      const a = zahl(n, env), b = zahl(n, env, 1);
      if (b === 0 || Number.isNaN(b)) return n.pos[2] ? zahl(n, env, 2) : 0;
      return fin(a / b);
    }
  });
  // Parameter
  def('PARAM', 'PARAM("name")', 'Parameter', 'Steuer-Kennwert für das Jahr, in dem der Zeitraum endet.', 'PARAM("ku_grenze_vorjahr")', {
    min: 1, max: 1, quote: true, run: (n, env) => {
      const a = n.pos[0], v = ev(a, env);
      if (typeof v !== 'string') fail('PARAM erwartet einen Namen in Anführungszeichen', a, 'z. B. PARAM("ku_grenze_vorjahr")');
      const P = env.d.params, y = parts(env.bis)[0];
      const jahre = Object.keys(P).map(Number).filter(Number.isFinite).sort((p, q) => p - q);
      if (!jahre.length) fail('Keine Steuer-Kennwerte vorhanden', n);
      const jahr = jahre.includes(y) ? y : jahre.filter((x) => x <= y).pop() || jahre[0]; // sonst nächstes passendes Jahr
      const zeile = P[jahr] || {}, keys = Object.keys(zeile), q = v.trim().toLowerCase();
      const k = keys.find((x) => x === v) || keys.find((x) => x.toLowerCase() === q);
      if (!k) { const s = suggest(q, keys); fail(`Parameter „${v}“ unbekannt`, a, s ? `Meintest du ${s}?` : `Vorhanden: ${keys.join(', ')}`); }
      note(env, () => `${k} (${jahr})`);
      return Number(zeile[k]);
    }
  });
  const FN_NAMEN = [...FN.keys()];

  /* ---------- Öffentliche API ---------- */
  function toAst(x) {
    if (x && typeof x === 'object' && typeof x.t === 'string') return x;
    return parse(x == null ? '' : String(x));
  }
  function auswerten(srcOrAst, ctx, erklaeren) {
    const ast = toAst(srcOrAst);
    try {
      const env = mkEnv(ctx, ast);
      if (erklaeren) env.tr = { cur: [], rec: null };
      const v = toNum(ev(ast, env), ast);
      return erklaeren ? env.tr.cur[0] : v;
    } catch (e) {
      if (e instanceof FormulaError) throw e;
      const w = new FormulaError(`Interner Fehler: ${e && e.message ? e.message : e}`, 0, ast.end);
      w.cause = e;
      throw w;
    }
  }
  const evaluate = (srcOrAst, ctx) => auswerten(srcOrAst, ctx, false);
  const explain = (src, ctx) => auswerten(src, ctx, true);
  function check(src, ctx) {
    try {
      return { ok: true, value: evaluate(src, ctx) };
    } catch (e) {
      const f = e instanceof FormulaError ? e : new FormulaError(`Interner Fehler: ${e && e.message ? e.message : e}`, 0, typeof src === 'string' ? src.length : 0);
      return { ok: false, error: { message: f.message, start: f.start, end: f.end, hint: f.hint } };
    }
  }

  return { tokenize, parse, evaluate, explain, check, suggest, FUNCTIONS, CONSTANTS, FILTERS, FormulaError };
})();
