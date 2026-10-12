/* Kladdy – Prototyp · Kennzahlen (Formel-Editor)
 * Eigene Kennzahlen per Formel – wie in Excel, nur lesbar:
 * Reiter „Kennzahlen“ der Auswertung (Kopf mit großem Umschalter aus App.auswertungKopf):
 *   links die Liste (Wert im Zeitraum, Vergleich, Ampel, Sparkline; per Ziehen sortierbar, Stern = im Überblick angeheftet),
 *   rechts der Editor: Formelfeld mit Hervorhebung (Textarea über einem <pre>), Autovervollständigung, Parameterhilfe,
 *   Live-Ergebnis, Fehler mit „Übernehmen“, Rechenweg („Erklären“), Darstellung/Ampel und Verlauf.
 * Dazu die Tabs „Variablen“ und „Funktionen“ (Nachschlagewerk) sowie fertige Ideen zum Hinzufügen.
 * Bearbeitet wird immer ein Entwurf (ui.drafts); erst „Speichern“ (⌘S) schreibt nach DATA.KENNZAHLEN.
 */
(() => {
  'use strict';
  const { D, $, $$, esc, icon, fmt, num, deltaHTML, pctChange } = App;
  const U = D.util;
  const F = () => window.Formula;
  const MOD = App.isMac ? '⌘' : 'Strg ';

  /* Zusätzliche Icons (Lucide-Stil, 24er Raster) */
  Object.assign(App.ICONS, {
    kzFx: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M8.5 16.5c1.7 0 2.4-.9 2.7-2.6l.9-4.9c.3-1.6 1.1-2.5 2.9-2.5M9.5 11h5"/>',
    kzVar: '<path d="M8 21s-4-3-4-9 4-9 4-9M16 3s4 3 4 9-4 9-4 9M15 9l-6 6M9 9l6 6"/>',
    kzTree: '<path d="M21 6H9M21 12h-8M21 18h-8M4 3v5a2 2 0 0 0 2 2h3M4 8v8a2 2 0 0 0 2 2h3"/>',
    kzBulb: '<path d="M9 18h6M10 21.5h4M12 2.5a6.5 6.5 0 0 0-4 11.6c.6.5 1 1.2 1 2v.4h6v-.4c0-.8.4-1.5 1-2A6.5 6.5 0 0 0 12 2.5z"/>'
  });

  /* ---------- Konstanten ---------- */
  const GELD_FN = new Set(['EINNAHMEN', 'AUSGABEN', 'AUSGABEN_BRUTTO', 'GEWINN', 'KU_UMSATZ', 'OFFEN']);
  const MENGEN = ['BUCHUNGEN', 'RECHNUNGEN'];
  const MENGEN_FN = ['ANZAHL', 'SUMME', 'DURCHSCHNITT'];
  const ZEIT = ['MONAT', 'QUARTAL', 'JAHR', 'YTD', 'VORMONAT', 'VORJAHR_GESAMT'];
  /* Welche Filter eine Funktion kennt (spiegelt formula.js – dort nicht öffentlich) */
  const F_BUCH = ['kategorie', 'kunde', 'kontakt', 'zahlungsart', 'zeitraum'];
  const FILTER_VON = {
    EINNAHMEN: F_BUCH, AUSGABEN: F_BUCH, AUSGABEN_BRUTTO: F_BUCH, GEWINN: F_BUCH, KU_UMSATZ: F_BUCH, OFFEN: ['kunde', 'kontakt', 'zeitraum'],
    BUCHUNGEN: [...F_BUCH, 'typ'], RECHNUNGEN: ['kunde', 'kontakt', 'zahlungsart', 'status', 'art', 'zeitraum']
  };
  const TEXT_FILTER = ['kategorie', 'kunde', 'kontakt', 'zahlungsart', 'typ', 'status', 'art'];
  const WORTE = {
    zahlungsart: D.ZAHLUNGSARTEN.map((z) => [z.id, z.name]),
    typ: [['einnahme', 'Einnahme'], ['ausgabe', 'Ausgabe']],
    status: [['entwurf', ''], ['offen', ''], ['bezahlt', ''], ['storniert', '']],
    art: [['rechnung', ''], ['quittung', ''], ['angebot', ''], ['eigenbeleg', '']]
  };
  const FORMATE = [['eur', '€'], ['prozent', '%'], ['zahl', 'Zahl'], ['tage', 'Tage']];
  const FORMAT_NAME = { eur: 'Euro', prozent: 'Prozent', zahl: 'Zahl', tage: 'Tage' };
  const VERGLEICHE = [['vorperiode', 'Vorperiode'], ['vorjahr', 'Vorjahr'], ['keiner', 'Keiner']];
  const STELLEN = [['', 'Auto'], ['0', '0'], ['1', '1'], ['2', '2']];
  const AMPEL_TXT = { gruen: 'grün', gelb: 'gelb', rot: 'rot' };
  const KIND = {
    fn: ['ƒ', 'Funktion'], var: ['x', 'Variable'], zeit: ['◷', 'Zeitraum'], menge: ['≡', 'Datenmenge'],
    flt: [':', 'Filter'], kpi: ['Σ', 'Kennzahl'], val: ['"', 'Wert']
  };
  const GRUPPE_IC = { Daten: 'swap', Zeitraum: 'calendar', Logik: 'kzTree', Mathe: 'sigma', Parameter: 'book' };

  /* Ideen-Galerie: fertige Formeln (nur Funktionen aus Formula.FUNCTIONS). {kat:id} wird durch den Namen der
   * Kategorie aus DATA.KATEGORIEN ersetzt – fehlt sie, entfällt die Idee. Jede Idee wird vor dem Anzeigen geprüft. */
  const IDEEN = [
    { name: 'Spritkosten je Auftrag', formel: 'TEILEN(AUSGABEN(kategorie: "{kat:sprit}"); ANZAHL(RECHNUNGEN); 0)', format: 'eur', icon: 'car', text: 'Was dich jede Fahrt zum Kunden im Schnitt an Sprit und Fahrzeug kostet.' },
    { name: 'Ø Auftragswert', formel: 'TEILEN(SUMME(RECHNUNGEN); ANZAHL(RECHNUNGEN); 0)', format: 'eur', icon: 'invoice', text: 'Durchschnittlicher Betrag je Rechnung oder Quittung im Zeitraum.' },
    { name: 'Anteil Barumsatz', formel: 'TEILEN(EINNAHMEN(zahlungsart: "bar"); EINNAHMEN(); 0)', format: 'prozent', icon: 'cash', text: 'Wie viel der Einnahmen bar bezahlt wird.' },
    { name: 'Kosten pro Monat', formel: 'TEILEN(AUSGABEN(); MONATE(); 0)', format: 'eur', icon: 'calendar', text: 'Abziehbare Ausgaben je Monat im Zeitraum – deine laufenden Kosten.' },
    { name: 'Effektiver Stundenlohn', formel: 'TEILEN(GEWINN(zeitraum: JAHR); STUNDEN; 0)', format: 'eur', icon: 'clock', text: 'Jahresgewinn geteilt durch deine geschätzten Arbeitsstunden (Variable STUNDEN).' },
    { name: 'Ø Quittungsbetrag', formel: 'TEILEN(SUMME(RECHNUNGEN; art: "quittung"); ANZAHL(RECHNUNGEN; art: "quittung"); 0)', format: 'eur', icon: 'receipt', text: 'Was eine Quittung im Schnitt bringt.' },
    { name: 'Gewinn pro Monat', formel: 'TEILEN(GEWINN(); MONATE(); 0)', format: 'eur', icon: 'chart', text: 'Durchschnittlicher Gewinn je Monat im Zeitraum.' },
    { name: 'Ø Zahlungsdauer', formel: 'DURCHSCHNITT(RECHNUNGEN; "zahlungsdauer"; status: "bezahlt")', format: 'tage', icon: 'clock', ampel: { gruen: 14, gelb: 21, richtung: 'niedrig' }, text: 'Tage zwischen Rechnungsdatum und Zahlungseingang.' },
    { name: 'Anzahl Belege', formel: 'ANZAHL(RECHNUNGEN)', format: 'zahl', dec: 0, icon: 'file', text: 'Rechnungen und Quittungen im Zeitraum (ohne Entwürfe und Stornos).' },
    { name: 'Produktkosten je Auftrag', formel: 'TEILEN(AUSGABEN(kategorie: "{kat:produkte}"); ANZAHL(RECHNUNGEN); 0)', format: 'eur', icon: 'shop', text: 'Material und Produkte, die im Schnitt in einem Auftrag stecken.' },
    { name: 'Ausgabenquote', formel: 'TEILEN(AUSGABEN(); EINNAHMEN(); 0)', format: 'prozent', icon: 'target', ampel: { gruen: 0.6, gelb: 0.8, richtung: 'niedrig' }, text: 'Welcher Anteil der Einnahmen für Ausgaben draufgeht.' },
    { name: 'Gewinn ggü. Vorjahr', formel: 'GEWINN() - VORJAHR(GEWINN())', format: 'eur', icon: 'swap', text: 'Mehr- oder Mindergewinn im Vergleich zum gleichen Zeitraum des Vorjahres.' },
    { name: 'Anteil PayPal', formel: 'TEILEN(EINNAHMEN(zahlungsart: "paypal"); EINNAHMEN(); 0)', format: 'prozent', icon: 'paypal', text: 'Wie viel der Einnahmen per PayPal reinkommt – dafür fallen Gebühren an.' }
  ];
  /* {kat:id} → "Name der Kategorie"; null, wenn es die Kategorie nicht gibt */
  function ideeFormel(x) {
    let ok = true;
    const f = x.formel.replace(/\{kat:([\w-]+)\}/g, (m, id) => {
      const k = D.KATEGORIEN.find((c) => c.id === id) || D.KATEGORIEN.find((c) => norm(c.name).includes(norm(id)));
      if (!k) ok = false;
      return k ? String(k.name).replace(/"/g, '""') : '';
    });
    return ok ? f : null;
  }

  /* ---------- Zustand (bleibt beim Seitenwechsel erhalten) ---------- */
  const ui = { tab: 'kennzahlen', sel: null, drafts: {}, neu: null, explain: true, ex: {}, fnQuery: '' };
  let ed = null; // Zustand der gerade sichtbaren Ansicht (wird bei jedem Rendern neu angelegt)

  /* ---------- Hilfen ---------- */
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const nf2 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
  const nf4 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 });
  const numDe = (v) => (v == null || !isFinite(v) ? '' : String(+(+v).toFixed(8)).replace('.', ','));
  /* „1.500,50“, „0,25“ oder „0.25“ → Zahl; leer → null */
  function parseDe(s) {
    s = String(s ?? '').trim().replace(/\s/g, '');
    if (!s) return null;
    s = s.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
    const v = Number(s);
    return isFinite(v) ? v : NaN;
  }
  /* Klasse „reveal“ nur beim ersten Aufbau der Seite – Teil-Updates sollen nicht neu einblenden */
  const R = (cls, i) => (ed && ed.anim ? `class="${cls} reveal" style="--i:${i}"` : `class="${cls}"`);
  let fnSetCache = null;
  const fnSet = () => (fnSetCache ||= new Set(F().FUNCTIONS.map((f) => f.name)));
  const fnDef = (n) => F().FUNCTIONS.find((f) => f.name === n);
  const konstSet = () => new Set(F().CONSTANTS.map((c) => c.name));
  const varSet = () => new Set(D.VARIABLEN.map((v) => String(v.name).toUpperCase()));

  /* ---------- Entwürfe ---------- */
  const FIELDS = ['name', 'text', 'formel', 'format', 'dec', 'ampel', 'vergleich'];
  const isNeu = (id) => !!(ui.neu && ui.neu.id === id);
  const saved = (id) => D.KENNZAHLEN.find((k) => k.id === id) || null;
  const liste = () => (ui.neu ? [...D.KENNZAHLEN, ui.neu] : D.KENNZAHLEN.slice());
  function draft(id) {
    if (!id) return null;
    if (isNeu(id)) return ui.neu;
    if (!ui.drafts[id]) { const s = saved(id); if (!s) return null; ui.drafts[id] = clone(s); }
    return ui.drafts[id];
  }
  const sigOf = (k) => JSON.stringify(FIELDS.map((f) => (k[f] === undefined || k[f] === '' ? null : k[f])));
  const dirty = (id) => isNeu(id) || !!(ui.drafts[id] && saved(id) && sigOf(ui.drafts[id]) !== sigOf(saved(id)));
  const shown = (k) => ui.drafts[k.id] || k;
  const nameTaken = (name, id) => liste().some((k) => k.id !== id && norm(shown(k).name).trim() === norm(name).trim());
  function freierName(base) {
    if (!nameTaken(base, null)) return base;
    for (let n = 2; ; n++) if (!nameTaken(`${base} ${n}`, null)) return `${base} ${n}`;
  }
  function nameMsg(k) {
    const n = String(k.name || '').trim();
    if (!n) return 'Name fehlt';
    if (/[[\]]/.test(n)) return 'Eckige Klammern sind im Namen nicht erlaubt';
    if (nameTaken(n, k.id)) return 'Diesen Namen gibt es schon';
    return '';
  }

  /* ---------- Rechnen ---------- */
  /* Kontext für eine Kennzahl: der Entwurf ersetzt die gespeicherte Fassung, damit [Bezüge] und Zirkel stimmen */
  function ctxFor(p, k) {
    const c = App.fctx(p);
    if (k) { c.name = k.name; c.kennzahlen = liste().map((x) => (x.id === k.id ? k : shown(x))); }
    return c;
  }
  function wert(k, p) {
    if (!p || !window.Formula) return NaN;
    try { return F().evaluate(k.formel, ctxFor(p, k)); } catch { return NaN; }
  }
  /* Vergleichszeitraum je Kennzahl: Vorperiode (wie überall), Vorjahr oder keiner */
  function vglOf(k, p) {
    const art = k.vergleich || 'vorperiode';
    if (art === 'keiner') return null;
    if (art === 'vorperiode' || p.typ === 'jahr') return App.vergleich(p);
    const r = App.rangeOf(p.typ, App.shiftAnchor(p.von, 'jahr', -1));
    if (p.von <= D.TODAY && D.TODAY <= p.bis) { r.bis = U.addDays(r.von, U.diffDays(p.von, D.TODAY)); r.teil = true; }
    r.text = r.teil ? 'ggü. Vorjahr (gleich lang)' : 'ggü. Vorjahr';
    return r;
  }
  /* 12 Monate bis zum Ende des gewählten Zeitraums (höchstens bis heute) */
  function monate(p) {
    const end = p.bis > D.TODAY ? D.TODAY : p.bis, out = [];
    for (let n = 11; n >= 0; n--) out.push(App.rangeOf('monat', App.shiftAnchor(end, 'monat', -n)));
    return out;
  }
  function calc(k, p) {
    const val = wert(k, p), vg = vglOf(k, p), prev = vg ? wert(k, vg) : NaN;
    const ms = monate(p);
    return { val, vg, prev, ms, series: ms.map((r) => wert(k, r)), am: App.ampelOf(k, val) };
  }
  /* Wert im Format der Kennzahl, optional mit festen Nachkommastellen */
  function fval(v, k) {
    if (v == null || !isFinite(v)) return '—';
    const d = k.dec === '' || k.dec == null ? null : +k.dec;
    if (d == null) return k.format === 'zahl' && Number.isInteger(v) ? num(v, 0) : fmt.kz(v, k.format); // Anzahl ohne „,0“
    if (k.format === 'prozent') return fmt.pct(v, d);
    if (k.format === 'tage') return num(v, d) + ' Tage';
    if (k.format === 'zahl') return num(v, d);
    return fmt.eurE(v, { dec: d });
  }
  /* Veränderung: bei Prozent-Kennzahlen in Prozentpunkten, sonst relativ; „niedriger ist besser“ dreht die Farbe */
  function deltaOf(k, v, pv) {
    const invert = !!(k.ampel && k.ampel.richtung === 'niedrig');
    if (k.format === 'prozent') return deltaHTML(isFinite(v) && isFinite(pv) ? (v - pv) * 100 : null, { pp: true, invert });
    return deltaHTML(pctChange(v, pv), { invert });
  }

  /* Einheit eines Teilausdrucks (für den Rechenweg): eur, prozent, tage, anzahl, zahl, bool */
  const STAERKE = { eur: 4, prozent: 3, tage: 2, anzahl: 1 };
  const staerkste = (...es) => es.filter(Boolean).sort((a, b) => (STAERKE[b] || 0) - (STAERKE[a] || 0))[0] || 'zahl';
  const geteilt = (a, b) => (a === 'eur' && b === 'eur' ? 'prozent' : a === 'eur' ? 'eur' : a === b && a !== 'zahl' ? 'prozent' : a === 'tage' ? 'tage' : 'zahl');
  function einheit(n) {
    if (!n) return 'zahl';
    switch (n.t) {
      case 'pct': return 'prozent';
      case 'neg': return einheit(n.a);
      case 'ref': {
        const r = liste().map(shown).find((k) => norm(k.name).trim() === norm(n.name).trim());
        return r && ['eur', 'prozent', 'tage'].includes(r.format) ? r.format : 'zahl';
      }
      case 'bin': {
        if (['=', '<>', '<', '>', '<=', '>='].includes(n.op)) return 'bool';
        const a = einheit(n.a), b = einheit(n.b);
        if (n.op === '+' || n.op === '-') return staerkste(a, b);
        if (n.op === '/') return geteilt(a, b);
        if (n.op === '*') return a === 'eur' || b === 'eur' ? 'eur' : a === 'prozent' && b === 'prozent' ? 'prozent' : a === 'prozent' ? b : b === 'prozent' ? a : staerkste(a, b);
        return 'zahl';
      }
      case 'call': {
        const k = n.key, P = n.pos || [];
        if (GELD_FN.has(k)) return 'eur';
        if (k === 'ANZAHL') return 'anzahl';
        if (k === 'SUMME') return n.set ? 'eur' : staerkste(...P.map(einheit));
        if (k === 'DURCHSCHNITT') return n.set ? (P[0] && P[0].t === 'str' && /zahlungsdauer/i.test(P[0].v) ? 'tage' : 'eur') : staerkste(...P.map(einheit));
        if (k === 'TEILEN') return geteilt(einheit(P[0]), einheit(P[1]));
        if (k === 'VORJAHR' || k === 'VORPERIODE') return einheit(P[0]);
        if (k === 'IM') return einheit(P[1]);
        if (k === 'WENN') return staerkste(einheit(P[1]), P[2] ? einheit(P[2]) : null);
        if (['UND', 'ODER', 'NICHT'].includes(k)) return 'bool';
        if (k === 'TAGE') return 'tage';
        if (['ABS', 'RUNDEN', 'WURZEL'].includes(k)) return einheit(P[0]);
        if (k === 'MIN' || k === 'MAX') return staerkste(...P.map(einheit));
        return 'zahl';
      }
      default: return 'zahl';
    }
  }
  function fmtEinheit(v, e) {
    if (v == null || !isFinite(v)) return '—';
    if (e === 'eur') return fmt.eurE(v);
    if (e === 'prozent') return fmt.pct(v, 1);
    if (e === 'tage') return fmt.tage(v);
    if (e === 'bool') return v ? 'wahr' : 'falsch';
    if (e === 'anzahl') return num(v, 0);
    return (Math.abs(v) < 1 ? nf4 : nf2).format(v).replace('-', '−');
  }
  function fmtTeil(label, v) {
    let ast = null;
    try { ast = F().parse(label); } catch { /* Filter-Teil o. Ä. */ }
    return fmtEinheit(v, einheit(ast));
  }

  /* ---------- Syntax-Hervorhebung ---------- */
  function tokCls(t, toks, i, vars) {
    switch (t.type) {
      case 'num': return 'tk-num';
      case 'str': return 'tk-str';
      case 'ref': return 'tk-ref';
      case 'func': return fnSet().has(t.text.toUpperCase()) ? 'tk-fn' : 'tk-fn tk-unk';
      case 'name': {
        let j = i + 1; while (toks[j] && toks[j].type === 'ws') j++;
        if (toks[j] && toks[j].type === 'colon') return 'tk-flt';
        const u = t.text.toUpperCase();
        if (konstSet().has(u)) return 'tk-const';
        return vars.has(u) ? 'tk-var' : 'tk-name';
      }
      case 'op': case 'pct': return 'tk-op';
      case 'paren': return 'tk-par';
      case 'sep': case 'colon': return 'tk-sep';
      case 'error': return 'tk-bad';
      default: return '';
    }
  }
  /* HTML mit Token-Farben; err/hot/match markieren Bereiche (Fehler-Wellenlinie, Rechenweg-Hover, Klammerpaar) */
  function hlHTML(src, o = {}) {
    src = String(src ?? '');
    const toks = F().tokenize(src), vars = varSet(), marks = [];
    const err = o.err && src.trim() ? o.err : null;
    if (err) marks.push([err.start, Math.max(err.end, err.start + 1), 'tk-err']);
    if (o.hot) marks.push([o.hot.start, o.hot.end, 'tk-hot']);
    (o.match || []).forEach((i) => marks.push([i, i + 1, 'tk-match']));
    let html = '';
    toks.forEach((t, i) => {
      const base = tokCls(t, toks, i, vars);
      const cuts = [t.start, t.end];
      marks.forEach(([a, b]) => { if (a > t.start && a < t.end) cuts.push(a); if (b > t.start && b < t.end) cuts.push(b); });
      cuts.sort((x, y) => x - y);
      for (let j = 0; j < cuts.length - 1; j++) {
        const a = cuts[j], b = cuts[j + 1];
        if (a === b) continue;
        const cls = [base, ...marks.filter(([s, e]) => s <= a && e >= b).map((m) => m[2])].filter(Boolean).join(' ');
        const txt = esc(src.slice(a, b));
        html += cls ? `<span class="${cls}">${txt}</span>` : txt;
      }
    });
    if (err && err.start >= src.length) html += '<span class="tk-err tk-eol"> </span>';
    if (o.pad && (!src || src.endsWith('\n'))) html += ' ';
    return html;
  }
  /* Klammerpaar am Cursor */
  function matchAt(src, c) {
    const toks = F().tokenize(src).filter((t) => t.type === 'paren');
    const at = toks.find((t) => t.end === c) || toks.find((t) => t.start === c);
    if (!at) return null;
    const i = toks.indexOf(at), dir = at.text === '(' ? 1 : -1;
    let depth = 0;
    for (let j = i; j >= 0 && j < toks.length; j += dir) {
      depth += toks[j].text === '(' ? dir : -dir;
      if (depth === 0) return [at.start, toks[j].start];
    }
    return [at.start];
  }

  /* ---------- Token-Analyse für Vorschläge und Parameterhilfe ---------- */
  function prevSig(toks, pos) {
    let p = null;
    for (const t of toks) { if (t.end > pos) break; if (t.type !== 'ws') p = t; }
    return p;
  }
  /* Innerster offener Funktionsaufruf vor Position c: { fn, idx (Argument), argStart, open, inner } */
  function callAt(toks, c) {
    const stack = [];
    let prev = null;
    for (const t of toks) {
      if (t.end > c) break;
      if (t.type === 'paren') {
        if (t.text === '(') stack.push({ fn: prev && prev.type === 'func' ? prev.text.toUpperCase() : null, idx: 0, argStart: t.end, open: t.start });
        else stack.pop();
      } else if (t.type === 'sep' && stack.length) { const top = stack[stack.length - 1]; top.idx++; top.argStart = t.end; }
      if (t.type !== 'ws') prev = t;
    }
    for (let i = stack.length - 1; i >= 0; i--) {
      if (!stack[i].fn) continue;
      const s = stack[i];
      s.inner = i === stack.length - 1;
      const ts = toks.filter((t) => t.type !== 'ws' && t.start >= s.argStart && t.start < c);
      s.filter = s.inner && ts[0] && ts[0].type === 'name' && ts[1] && ts[1].type === 'colon' ? ts[0].text.toLowerCase() : null;
      // Datenmenge (BUCHUNGEN/RECHNUNGEN) und bereits benutzte Filter dieses Aufrufs
      let depth = 0, first = null;
      s.used = new Set();
      for (let j = 0; j < toks.length; j++) {
        const t = toks[j];
        if (t.start <= s.open || t.type === 'ws') continue;
        if (t.type === 'paren') { if (t.text === '(') depth++; else if (depth-- === 0) break; continue; }
        if (depth) continue;
        if (!first) first = t;
        if (t.type === 'name') { let k = j + 1; while (toks[k] && toks[k].type === 'ws') k++; if (toks[k] && toks[k].type === 'colon') s.used.add(t.text.toLowerCase()); }
      }
      s.menge = first && first.type === 'name' && MENGEN.includes(first.text.toUpperCase()) ? first.text.toUpperCase() : null;
      return s;
    }
    return null;
  }
  const filterFuer = (call) => {
    if (!call) return [];
    if (MENGEN_FN.includes(call.fn)) return call.menge ? FILTER_VON[call.menge] : [];
    return FILTER_VON[call.fn] || [];
  };

  /* ---------- Vorschlagslisten ---------- */
  const fnItems = () => F().FUNCTIONS.map((f) => ({ kind: 'fn', label: f.name, detail: f.sig, desc: f.desc, example: f.example }));
  const varItems = () => D.VARIABLEN.map((v) => ({ kind: 'var', label: String(v.name).toUpperCase(), detail: `= ${numDe(v.wert)}`, desc: v.text || 'Eigene Variable (Tab „Variablen“)' }));
  const zeitItems = () => F().CONSTANTS.filter((c) => ZEIT.includes(c.name)).map((c) => ({ kind: 'zeit', label: c.name, detail: 'Zeitraum', desc: c.desc }));
  const mengenItems = () => F().CONSTANTS.filter((c) => MENGEN.includes(c.name)).map((c) => ({ kind: 'menge', label: c.name, detail: 'Datenmenge', desc: c.desc }));
  const kpiItems = () => liste().filter((k) => k.id !== ui.sel).map(shown).map((k) => ({
    kind: 'kpi', label: `[${k.name}]`, match: k.name, insert: `[${k.name}]`, detail: ed && ed.vals && k.id in ed.vals ? fval(ed.vals[k.id], k) : FORMAT_NAME[k.format] || '', desc: k.text || k.formel
  }));
  function filterItem(name) {
    const f = F().FILTERS.find((x) => x.name === name) || { desc: '' };
    const text = TEXT_FILTER.includes(name);
    return { kind: 'flt', label: name + ':', match: name, detail: text ? `${name}: "…"` : `${name}: JAHR`, desc: f.desc, insert: text ? `${name}: ""` : `${name}: `, caret: text ? name.length + 3 : name.length + 2, reopen: true };
  }
  /* Werte für Text-Filter, PARAM("…") und DURCHSCHNITT(…; "feld") */
  function textWerte(filter, call) {
    if (filter === 'kategorie') {
      const typ = call && /^(EINNAHMEN|KU_UMSATZ)$/.test(call.fn) ? 'einnahme' : call && /^AUSGABEN/.test(call.fn) ? 'ausgabe' : null;
      const ks = [...D.KATEGORIEN].sort((a, b) => (a.typ === typ ? 0 : 1) - (b.typ === typ ? 0 : 1));
      return ks.map((k) => ({ label: k.name, detail: k.typ === 'einnahme' ? 'Einnahme' : 'Ausgabe' }));
    }
    if (filter === 'kunde' || filter === 'kontakt') {
      const ks = D.KONTAKTE.map((k) => ({ label: k.name, detail: 'Kunde' })); // Kontakte sind nur Kunden
      const frei = [...new Set(D.rechnungen.filter((r) => !r.kontakt && r.kunde).map((r) => String(r.kunde)))].filter((n) => !ks.some((k) => k.label === n));
      return [...ks, ...frei.slice(0, 40).map((n) => ({ label: n, detail: 'Quittung' }))];
    }
    if (WORTE[filter]) return WORTE[filter].map(([w, d]) => ({ label: w, detail: d || filter }));
    if (call && call.fn === 'PARAM') {
      const y = App.period().bis.slice(0, 4), P = (D.PARAMS || {})[y] || Object.values(D.PARAMS || {})[0] || {};
      return Object.keys(P).map((n) => ({ label: n, detail: nf2.format(P[n]) }));
    }
    if (call && call.fn === 'DURCHSCHNITT' && call.idx === 1) return [{ label: 'betrag', detail: '€' }, { label: 'zahlungsdauer', detail: 'Tage bis Zahlung' }];
    return null;
  }
  const valItems = (vals) => vals.map((v) => ({ kind: 'val', label: v.label, detail: v.detail, insert: `"${v.label}"` }));
  function kontextItems(call, prev) {
    if (prev && prev.type === 'colon') return [];
    const out = [];
    const argStart = !prev || prev.type === 'sep' || (prev.type === 'paren' && prev.text === '(');
    if (call && call.inner && argStart) {
      if (MENGEN_FN.includes(call.fn) && call.idx === 0) out.push(...mengenItems());
      out.push(...filterFuer(call).filter((f) => !call.used.has(f)).map(filterItem));
      if (call.fn === 'IM' && call.idx === 0) out.push(...zeitItems());
    }
    out.push(...fnItems(), ...varItems(), ...zeitItems(), ...kpiItems());
    const seen = new Set();
    return out.filter((it) => (seen.has(it.kind + it.label) ? false : seen.add(it.kind + it.label)));
  }
  function rank(items, pre) {
    const q = norm(pre);
    if (!q) return items;
    const a = [], b = [];
    items.forEach((it) => { const l = norm(it.match || it.label); if (l.startsWith(q)) a.push(it); else if (l.includes(q)) b.push(it); });
    return [...a, ...b];
  }
  /* Was passt an Position c? → { from, to, prefix, items } oder null */
  function acCompute(src, c, explicit) {
    const toks = F().tokenize(src);
    const at = toks.find((t) => t.type !== 'ws' && t.start < c && c <= t.end);
    const call = callAt(toks, c);
    // in einem Text "…"
    if (at && ((at.type === 'str' && c < at.end) || (at.type === 'error' && /^["„“”]/.test(at.text)))) {
      const vals = textWerte(call && call.filter, call);
      if (!vals) return null;
      const pre = src.slice(at.start + 1, c);
      return { from: at.start, to: at.type === 'str' ? at.end : c, prefix: pre, items: rank(valItems(vals), pre) };
    }
    // in einem Kennzahl-Bezug [ … ]
    if (at && ((at.type === 'ref' && c < at.end) || (at.type === 'error' && at.text[0] === '['))) {
      const pre = src.slice(at.start + 1, c);
      return { from: at.start, to: at.type === 'ref' ? at.end : c, prefix: pre, items: rank(kpiItems(), pre) };
    }
    // in oder direkt hinter einem Namen
    if (at && (at.type === 'func' || at.type === 'name')) {
      const prev = prevSig(toks, at.start), pre = src.slice(at.start, c);
      if (prev && prev.type === 'colon') {
        const fi = toks[toks.indexOf(prev) - 1] && prevSig(toks, prev.start);
        if (fi && fi.text.toLowerCase() === 'zeitraum') return { from: at.start, to: at.end, prefix: pre, items: rank([...zeitItems(), ...fnItems().filter((f) => f.label === 'LETZTE_TAGE')], pre) };
      }
      const items = rank(kontextItems(call, prev), pre);
      if (items.length === 1 && items[0].label.toUpperCase() === pre.toUpperCase() && at.type === 'func') return null;
      return { from: at.start, to: at.end, prefix: pre, items };
    }
    if (at && !explicit && !['paren', 'sep', 'colon'].includes(at.type)) return null; // z. B. mitten in einer Zahl
    // nach „(“, „;“ oder „filter:“
    const prev = prevSig(toks, c);
    if (prev && prev.type === 'colon') {
      const fi = prevSig(toks, prev.start), f = fi && fi.type === 'name' ? fi.text.toLowerCase() : '';
      if (f === 'zeitraum') return { from: c, to: c, prefix: '', items: [...zeitItems(), ...fnItems().filter((x) => x.label === 'LETZTE_TAGE')] };
      const vals = textWerte(f, call);
      return vals ? { from: c, to: c, prefix: '', items: valItems(vals) } : null;
    }
    const nachKlammer = prev && (prev.type === 'sep' || (prev.type === 'paren' && prev.text === '('));
    if (!explicit && !nachKlammer) return null;
    if (!explicit && call && call.inner && call.idx === 0) { const d = fnDef(call.fn); if (d && /\(\)$/.test(d.sig)) return null; } // TAGE() & Co. brauchen nichts
    return { from: c, to: c, prefix: '', items: kontextItems(call, prev) };
  }

  /* ---------- Fehler → Korrekturvorschlag ---------- */
  function fixOf(e, src) {
    if (!e || /^In Kennzahl \[|^Zirkelbezug/.test(e.message)) return null;
    const t = `${e.hint || ''} ${e.message || ''}`, orig = src.slice(e.start, e.end);
    let m, lit = null, s = null;
    if ((m = /Funktionen brauchen Klammern: (\S+)/.exec(t))) lit = m[1];
    else if ((m = /eckigen Klammern schreiben: (\[[^\]]+\])/.exec(t))) lit = m[1];
    else if ((m = /Anführungszeichen setzen: ("[^"]*")/.exec(t))) lit = m[1];
    else if ((m = /[Mm]eintest du (.+?)\?/.exec(t))) s = m[1].replace(/^[„"[]|[“"\]]$/g, '');
    else lit = { ',': ';', '−': '-', '×': '*', '÷': '/' }[orig] || null;
    if (lit == null && s == null) return null;
    if (lit == null) lit = /^["„“]/.test(orig) ? `"${s}"` : orig.startsWith('[') ? `[${s}]` : s;
    return lit === orig ? null : { start: e.start, end: e.end, text: lit };
  }

  /* ================= Rendern ================= */
  function render(el, route) {
    if (!window.Formula) {
      el.innerHTML = `<div class="page"><div class="card"><div class="empty">${icon('info')}<b>Formel-Engine fehlt</b><span>js/formula.js wurde nicht geladen.</span></div></div></div>`;
      return null;
    }
    const prm = (route && route.params) || {};
    if (prm.k && (saved(prm.k) || isNeu(prm.k))) { ui.sel = prm.k; ui.tab = 'kennzahlen'; }
    if (['kennzahlen', 'variablen', 'funktionen'].includes(prm.tab)) ui.tab = prm.tab;
    if (prm.neu) neueKennzahl();
    if (Object.keys(prm).length) history.replaceState(null, '', '#/kennzahlen');
    if (!ui.sel || !(saved(ui.sel) || isNeu(ui.sel))) ui.sel = (liste()[0] || {}).id || null;

    const root = document.createElement('div');
    root.className = 'page kz-page';
    el.appendChild(root);
    ed = { root, anim: true, err: null, hot: null, ac: null, acOff: false, timer: 0, saveT: 0, vals: {}, fix: null, chartDrawn: false };
    root.innerHTML = `
      ${App.auswertungKopf('kennzahlen', `${App.periodHTML()}<button type="button" class="btn-primary sm" data-action="kz-new">${icon('plus')}Neue Kennzahl</button>`)}
      <div class="kz-tabs reveal" style="--i:1"><div id="kzTabs"></div><span class="kz-tabs-hint" id="kzTabHint"></span></div>
      <div id="kzBody"></div>`;
    renderBody();
    ed.anim = false;
    wire(root);
    const onDocKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (ui.tab === 'kennzahlen') speichern();
        else App.toast(ui.tab === 'variablen' ? 'Variablen werden automatisch gespeichert' : 'Nichts zu speichern', { icon: 'info' });
      }
    };
    document.addEventListener('keydown', onDocKey);
    window.addEventListener('resize', acPlace, { passive: true });
    return () => { document.removeEventListener('keydown', onDocKey); window.removeEventListener('resize', acPlace); if (ed) { clearTimeout(ed.timer); clearTimeout(ed.saveT); } ed = null; };
  }

  function renderBody() {
    const body = $('#kzBody', ed.root), tabs = $('#kzTabs', ed.root);
    // Tabs nur einmal anlegen (sonst springt die Markierung ohne Animation), danach Zähler und Auswahl abgleichen
    if (!tabs.firstElementChild) {
      tabs.innerHTML = App.seg('local', 'kztab', [
        ['kennzahlen', `${icon('sigma')}Kennzahlen <span class="cnt"></span>`],
        ['variablen', `${icon('kzVar')}Variablen <span class="cnt"></span>`],
        ['funktionen', `${icon('kzFx')}Funktionen <span class="cnt">${F().FUNCTIONS.length}</span>`]
      ], ui.tab, 'tabs');
    }
    $$('button', tabs).forEach((b) => { const on = b.dataset.value === ui.tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    $('button[data-value="kennzahlen"] .cnt', tabs).textContent = D.KENNZAHLEN.length;
    $('button[data-value="variablen"] .cnt', tabs).textContent = D.VARIABLEN.length;
    $('#kzTabHint', ed.root).innerHTML = ui.tab === 'kennzahlen'
      ? `<span><kbd>${MOD}S</kbd> speichert</span><span><kbd>Strg</kbd> <kbd>Leertaste</kbd> zeigt Vorschläge</span>`
      : ui.tab === 'variablen' ? `<span>${icon('check')}Änderungen werden sofort gespeichert</span>`
        : `<span>${F().FUNCTIONS.length} Funktionen · ${F().FILTERS.length} Filter · ${F().CONSTANTS.length} Konstanten</span>`;
    if (ui.tab === 'variablen') body.innerHTML = variablenHTML();
    else if (ui.tab === 'funktionen') { body.innerHTML = funktionenHTML(); filterFunktionen(); }
    else {
      body.innerHTML = `<div class="kz-layout">
          <section ${R('card kz-list-card', 2)}>
            <div class="card-head"><div><div class="card-title">${icon('list')}Meine Kennzahlen <span class="muted" id="kzCount"></span></div>
              <div class="card-sub">Ziehen zum Sortieren · ${icon('star')} = im Überblick</div></div></div>
            <ul class="kz-list" id="kzList" role="listbox" aria-label="Kennzahlen"></ul>
          </section>
          <div class="kz-edit" id="kzEdit"></div>
        </div>
        <section class="kz-ideen" id="kzIdeen"></section>`;
      renderList();
      renderEditor();
      $('#kzIdeen').innerHTML = ideenHTML();
    }
    requestAnimationFrame(() => App.updateSegs(ed ? ed.root : document));
  }

  /* ---------- Liste ---------- */
  function itemHTML(k, c, i = 0) {
    const v = shown(k), neu = isNeu(k.id), on = k.id === ui.sel;
    const sub = c.vg ? `${deltaOf(v, c.val, c.prev)}<span class="muted" title="${esc(c.vg.text)} · ${esc(fval(c.prev, v))}">${esc(c.vg.text.replace('ggü. ', '').replace(/ \(.*\)$/, ''))}</span>` : '<span class="muted">ohne Vergleich</span>';
    return `<li ${R(`kz-item${on ? ' on' : ''}`, Math.min(i, 12) + 3)} data-id="${esc(k.id)}" ${neu ? '' : 'draggable="true"'} tabindex="${on ? 0 : -1}" role="option" aria-selected="${on}">
      <span class="kz-grip" aria-hidden="true">${icon('grip')}</span>
      <div class="kz-it-main">
        <div class="kz-it-top"><b>${esc(v.name || 'Ohne Namen')}</b>${neu ? '<span class="pill">NEU</span>' : dirty(k.id) ? '<i class="kz-dot" title="Ungespeicherte Änderungen"></i>' : ''}${v.text ? `<button type="button" class="q" tabindex="-1" data-tip="${esc(v.text)}" data-tip-title="${esc(v.name)}" data-tip-code="${esc(v.formel)}">?</button>` : ''}</div>
        <div class="kz-it-val"><span>${esc(fval(c.val, v))}</span>${c.am ? `<i class="ampel ${c.am}" title="Ampel: ${AMPEL_TXT[c.am]}"></i>` : ''}</div>
        <div class="kz-it-sub kpi-sub">${sub}</div>
      </div>
      <div class="kz-it-side">
        <button type="button" class="kz-star${k.anheften ? ' on' : ''}" data-action="kz-pin" data-id="${esc(k.id)}" aria-pressed="${!!k.anheften}" title="${k.anheften ? 'Vom Überblick lösen' : 'Im Überblick anheften'}">${icon('star')}</button>
        ${window.Charts ? Charts.spark(c.series, 'var(--accent)', 84, 26) : ''}
      </div>
    </li>`;
  }
  function renderList() {
    const ul = $('#kzList'); if (!ul) return;
    const p = App.period(), L = liste();
    ul.innerHTML = L.length ? L.map((k, i) => { const c = calc(shown(k), p); ed.vals[k.id] = c.val; return itemHTML(k, c, i); }).join('')
      : `<li class="kz-list-empty">${icon('sigma')}<span>Noch keine Kennzahlen.</span></li>`;
    const cnt = $('#kzCount'); if (cnt) cnt.textContent = `· ${D.KENNZAHLEN.length}`;
    zeigeAuswahl();
  }
  /* Gewählten Eintrag in der Liste sichtbar halten (nur die Liste scrollt, nicht die Seite) */
  function zeigeAuswahl() {
    const ul = $('#kzList'), li = ul && $('.kz-item.on', ul); if (!li) return;
    const t = li.offsetTop - ul.offsetTop, b = t + li.offsetHeight;
    if (t < ul.scrollTop) ul.scrollTop = t - 6; else if (b > ul.scrollTop + ul.clientHeight) ul.scrollTop = b - ul.clientHeight + 6;
  }
  function updateItem(id, c) {
    const li = $(`.kz-item[data-id="${CSS.escape(id)}"]`), k = liste().find((x) => x.id === id);
    if (!li || !k) return;
    ed.vals[id] = c.val;
    const tmp = document.createElement('ul');
    tmp.innerHTML = itemHTML(k, c);
    li.replaceWith(tmp.firstElementChild);
  }
  function select(id, { focusList = false } = {}) {
    if (!id || id === ui.sel) return;
    ui.sel = id;
    $$('.kz-item').forEach((li) => { const on = li.dataset.id === id; li.classList.toggle('on', on); li.setAttribute('aria-selected', on); li.tabIndex = on ? 0 : -1; });
    renderEditor();
    zeigeAuswahl();
    if (focusList) $(`.kz-item[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }
  /* Reihenfolge ändern (gilt auch für die angehefteten Kacheln im Überblick) */
  function verschiebe(id, toId, after) {
    const L = D.KENNZAHLEN, from = L.findIndex((k) => k.id === id);
    if (from < 0 || id === toId) return;
    const [k] = L.splice(from, 1);
    let to = toId ? L.findIndex((x) => x.id === toId) : L.length;
    if (to < 0) to = L.length;
    L.splice(after ? to + 1 : to, 0, k);
    App.save();
    renderList();
  }

  /* ---------- Editor ---------- */
  function renderEditor() {
    const box = $('#kzEdit'); if (!box) return;
    const k = draft(ui.sel);
    ed.err = null; ed.hot = null; ed.ac = null; ed.chartDrawn = false;
    if (!k) {
      box.innerHTML = `<section ${R('card', 3)}><div class="empty">${icon('sigma')}<b>Noch keine Kennzahl</b><span>Lege deine erste eigene Kennzahl an – oder übernimm unten eine Idee.</span>
        <button type="button" class="btn-primary" data-action="kz-new">${icon('plus')}Neue Kennzahl</button></div></section>`;
      return;
    }
    box.innerHTML = `
      <section ${R('card kz-editor', 3)}>
        <div class="kz-ed-head">
          <div class="kz-ed-title">
            <input class="kz-name-in" id="kzName" value="${esc(k.name)}" placeholder="Name der Kennzahl" spellcheck="false" autocomplete="off" aria-label="Name der Kennzahl">
            <div class="kz-ed-meta" id="kzMeta"></div>
          </div>
          <div class="kz-ed-actions">
            <button type="button" class="icon-btn sm" data-action="kz-dup" title="Duplizieren">${icon('copy')}</button>
            <button type="button" class="icon-btn sm kz-del" data-action="kz-del" title="Löschen">${icon('trash')}</button>
            <button type="button" class="btn ghost sm" data-action="kz-revert" id="kzRevert" title="Änderungen verwerfen">${icon('reset')}Verwerfen</button>
            <button type="button" class="btn-primary sm" data-action="kz-save" id="kzSave">${icon('check')}Speichern<kbd>${MOD}S</kbd></button>
          </div>
        </div>
        <div class="field kz-desc"><label for="kzText">Beschreibung <span class="kz-lab-note">· erscheint als (?)-Tooltip</span></label>
          <input class="input" id="kzText" value="${esc(k.text || '')}" placeholder="Was sagt die Kennzahl aus?" autocomplete="off"></div>
        <div class="field kz-fxwrap">
          <div class="field-label"><label for="fxIn">Formel</label><span class="spacer"></span><button type="button" class="link" data-action="kz-tab" data-tab="funktionen">${icon('book')}Alle Funktionen</button></div>
          <div class="fx" id="fx">
            <div class="fx-field" id="fxField"><pre class="fx-hl" id="fxHl" aria-hidden="true"></pre><textarea id="fxIn" class="fx-in" rows="1" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off"
              placeholder="z. B. TEILEN(GEWINN(); EINNAHMEN(); 0)" aria-label="Formel" aria-autocomplete="list" aria-controls="fxAc">${esc(k.formel)}</textarea></div>
            <div class="fx-ac" id="fxAc" role="listbox" hidden></div>
          </div>
          <div class="fx-sig" id="fxSig"></div>
        </div>
        <div id="fxRes"></div>
        <div class="kz-ex" id="kzEx" ${ui.explain ? '' : 'hidden'}>
          <div class="kz-ex-head"><span class="kz-ex-t">${icon('kzTree')}Rechenweg <span class="muted">· jeder Teil der Formel mit seinem Zwischenergebnis</span></span>
            <span class="row"><button type="button" class="link" data-action="ex-all" data-mode="alle">Alle aufklappen</button><button type="button" class="link" data-action="ex-all" data-mode="keine">Zuklappen</button></span></div>
          <ul class="ex-tree" id="exTree"></ul>
        </div>
      </section>
      <section ${R('card kz-set-card', 4)}>
        <div class="card-head"><div><div class="card-title">${icon('eye')}Darstellung & Ampel</div><div class="card-sub">Wie der Wert angezeigt, verglichen und bewertet wird</div></div></div>
        <div class="kz-set">
          <div class="kz-cell"><span class="field-label">Format</span>${App.seg('local', 'kzformat', FORMATE, k.format || 'eur')}</div>
          <div class="kz-cell"><span class="field-label">Nachkommastellen</span>${App.seg('local', 'kzdec', STELLEN, k.dec == null ? '' : String(k.dec))}</div>
          <div class="kz-cell"><span class="field-label">Vergleich mit</span>${App.seg('local', 'kzvgl', VERGLEICHE, k.vergleich || 'vorperiode')}</div>
          <div class="kz-cell"><span class="field-label">Überblick</span><label class="toggle-row kz-pin-row"><span>${icon('star')}Im Überblick anheften</span><span class="switch"><input type="checkbox" id="kzPin" ${k.anheften ? 'checked' : ''}><span></span></span></label></div>
        </div>
        <div class="kz-ampel" id="kzAmpel"></div>
      </section>
      <section ${R('card kz-chart-card', 5)}>
        <div class="card-head wrap"><div><div class="card-title">${icon('chart')}Verlauf</div><div class="card-sub" id="kzChartSub"></div></div><div class="kz-stats" id="kzStats"></div></div>
        <div class="chart kz-chart" id="kzChart"></div>
      </section>`;
    const ta = $('#fxIn');
    ta.addEventListener('input', onInput);
    ta.addEventListener('keydown', onFxKey);
    ta.addEventListener('keyup', (e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || (!ed.ac && /^Arrow/.test(e.key))) { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) acHide(); afterCaret(); } });
    ta.addEventListener('mouseup', () => { acHide(); afterCaret(); });
    ta.addEventListener('focus', afterCaret);
    ta.addEventListener('blur', () => { setTimeout(() => { if (ed && document.activeElement !== $('#fxIn')) { acHide(); sigUpdate(); if (ed.unfertig) auswerten(); else paint(); } }, 120); });
    ampelRender();
    refreshHead();
    paint();
    sigUpdate();
    autosize();
    requestAnimationFrame(autosize);
    auswerten();
    requestAnimationFrame(() => ed && App.updateSegs($('#kzEdit')));
  }
  function autosize() {
    const ta = $('#fxIn'); if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }
  function refreshHead(flash) {
    const k = draft(ui.sel), meta = $('#kzMeta'); if (!k || !meta) return;
    const msg = nameMsg(k), d = dirty(k.id);
    $('#kzName').classList.toggle('invalid', !!msg);
    const st = msg ? `<span class="badge neg">${icon('alert')}${esc(msg)}</span>`
      : flash ? `<span class="badge pos kz-flash">${icon('check')}Gespeichert</span>`
        : isNeu(k.id) ? `<span class="badge accent">${icon('sparkle')}Neu · noch nicht gespeichert</span>`
          : d ? `<span class="badge warn"><i class="kz-dot"></i>Ungespeicherte Änderungen</span>` : `<span class="badge">${icon('check')}Gespeichert</span>`;
    meta.innerHTML = `${st}<span>${esc(FORMAT_NAME[k.format] || 'Euro')}</span>${k.anheften ? `<span class="kz-meta-pin">${icon('star')}im Überblick</span>` : ''}`;
    $('#kzSave').disabled = !d;
    $('#kzRevert').disabled = !d;
  }
  /* Formel neu einfärben (Fehler, Hover aus dem Rechenweg, Klammerpaar am Cursor) */
  function paint() {
    const ta = $('#fxIn'), pre = $('#fxHl'); if (!ta || !pre || !ed) return;
    const focus = document.activeElement === ta;
    pre.innerHTML = hlHTML(ta.value, { err: ed.err, hot: ed.hot, pad: true, match: focus && ta.selectionStart === ta.selectionEnd ? matchAt(ta.value, ta.selectionStart) : null });
    $('#fxField').classList.toggle('bad', !!ed.err);
  }
  function afterCaret() { paint(); sigUpdate(); }

  function onInput() {
    const ta = $('#fxIn'), k = draft(ui.sel); if (!k || !ed) return;
    k.formel = ta.value;
    // Alte Fehlermarke nur behalten, wenn sie vor der Tippstelle liegt (Positionen unverändert)
    if (ed.err && ed.err.end >= ta.selectionStart - 1) ed.err = null;
    autosize();
    paint();
    if (!ed.programmatic) { if (ed.acOff) acHide(); else acUpdate(false); }
    sigUpdate();
    refreshHead();
    schedule();
  }
  function schedule() { clearTimeout(ed.timer); ed.timer = setTimeout(auswerten, 120); }

  /* Auswerten: Ergebnis, Fehler, Rechenweg, Verlauf, Listeneintrag */
  function auswerten() {
    if (!ed) return;
    const k = draft(ui.sel); if (!k || !$('#fxRes')) return;
    const p = App.period();
    const chk = F().check(k.formel, ctxFor(p, k));
    // Während getippt wird, ist eine halbe Formel kein Fehler: dann ruhiger Hinweis statt Rot (beim Verlassen voll)
    ed.unfertig = !chk.ok && document.activeElement === $('#fxIn') && /unvollständig|Fehlende schließende|ohne schließendes/.test(chk.error.message);
    ed.err = chk.ok || ed.unfertig ? null : chk.error;
    ed.fix = chk.ok ? null : fixOf(chk.error, k.formel);
    const c = calc(k, p);
    paint();
    $('#fxRes').innerHTML = resultHTML(chk, c, p, k);
    explainRender(chk, p, k);
    chartRender(c, p, k);
    // Liste: bei fehlerhaftem Entwurf den zuletzt gespeicherten Wert zeigen
    const s = saved(k.id);
    updateItem(k.id, chk.ok || !s ? c : calc(s, p));
    const sc = $('#amScale'); if (sc) sc.innerHTML = ampelScaleHTML(k, c.val);
  }

  function resultHTML(chk, c, p, k) {
    if (!String(k.formel).trim()) return `<div class="fx-res idle"><span class="fx-res-ic">${icon('kzFx')}</span><div class="fx-res-msg"><b>Formel eingeben</b><span>Zum Beispiel <code class="fx-code">${hlHTML('EINNAHMEN() - AUSGABEN()')}</code> – Vorschläge erscheinen beim Tippen.</span></div></div>`;
    if (!chk.ok && ed.unfertig) {
      return `<div class="fx-res idle"><span class="fx-res-ic">${icon('edit')}</span><div class="fx-res-msg"><b>Formel noch unvollständig</b><span>${esc(chk.error.hint || chk.error.message)}</span><small>Das Ergebnis erscheint, sobald die Formel vollständig ist.</small></div></div>`;
    }
    if (!chk.ok) {
      const e = chk.error, fix = ed.fix, src = String(k.formel);
      const stelle = src.slice(e.start, e.end).trim();
      const ref = /^In Kennzahl \[(.+?)\]/.exec(e.message), refK = ref && liste().find((x) => norm(shown(x).name) === norm(ref[1]));
      return `<div class="fx-res err" role="alert"><span class="fx-res-ic">${icon('alert')}</span>
        <div class="fx-res-msg"><b>${esc(e.message)}</b>${e.hint ? `<span>${esc(e.hint)}</span>` : ''}<small>Zeichen ${e.start + 1}${e.end - e.start > 1 ? `–${e.end}` : ''}${stelle ? ` · ${esc(stelle.length > 40 ? stelle.slice(0, 38) + '…' : stelle)}` : ''}</small></div>
        ${fix ? `<button type="button" class="btn subtle fx-fix" data-action="fx-fix" title="Korrektur übernehmen">${icon('check')}<span><code>${esc(fix.text.length > 34 ? fix.text.slice(0, 32) + '…' : fix.text)}</code> übernehmen</span></button>`
          : refK ? `<button type="button" class="btn subtle fx-fix" data-action="kz-open" data-id="${esc(refK.id)}">${icon('arrow')}<span>${esc(shown(refK).name)} öffnen</span></button>` : ''}</div>`;
    }
    const v = c.val;
    return `<div class="fx-res ok">
      <div class="fx-res-main">
        <div class="fx-res-lab">Ergebnis <span>im Zeitraum ${esc(p.label)}</span></div>
        <div class="fx-res-val">${esc(fval(v, k))}${c.am ? `<i class="ampel ${c.am}" title="Ampel: ${AMPEL_TXT[c.am]}"></i>` : ''}</div>
        <div class="fx-res-sub">${!isFinite(v) ? '<span class="muted">nicht berechenbar – z. B. Division durch 0 (TEILEN fängt das ab)</span>'
          : c.vg ? `${deltaOf(k, v, c.prev)}<span class="muted">${esc(c.vg.text)} · ${esc(fval(c.prev, k))}</span>` : '<span class="muted">ohne Vergleich</span>'}</div>
      </div>
      <div class="fx-res-side">${window.Charts ? Charts.spark(c.series, 'var(--accent)', 132, 40) : ''}
        <button type="button" class="btn ghost sm fx-ex-btn${ui.explain ? ' on' : ''}" data-action="fx-explain" aria-expanded="${ui.explain}">${icon('kzTree')}${ui.explain ? 'Rechenweg ausblenden' : 'Erklären'}</button></div>
    </div>`;
  }

  /* ---------- Rechenweg („Erklären“) ---------- */
  const exState = (id) => (ui.ex[id] ||= { mode: 'auto', t: new Set() });
  function explainRender(chk, p, k) {
    const box = $('#exTree'); if (!box) return;
    if (!ui.explain) { box.innerHTML = ''; return; }
    if (!chk.ok) { box.innerHTML = `<li class="ex-empty">${icon('info')}Sobald die Formel stimmt, siehst du hier den Rechenweg.</li>`; return; }
    let tree = null;
    try { tree = F().explain(k.formel, ctxFor(p, k)); } catch { /* Formel inzwischen ungültig */ }
    if (!tree) { box.innerHTML = ''; return; }
    const src = String(k.formel), st = exState(k.id);
    let total = 0;
    (function cnt(n) { total++; (n.children || []).forEach(cnt); })(tree);
    const offen = (path, depth) => {
      const def = st.mode === 'alle' ? true : st.mode === 'keine' ? depth === 0 : depth < 2 || total <= 16;
      return st.t.has(path) ? !def : def;
    };
    const node = (n, path, depth, range, inRef) => {
      const kids = n.children || [], open = kids.length && offen(path, depth);
      // Bereiche der Kinder in der Formel suchen (für den Hover), der Reihe nach von links
      let cur = range ? range[0] : 0;
      const kidRanges = kids.map((ch) => {
        if (!range || inRef) return null;
        const i = src.indexOf(ch.label, cur);
        if (i < 0 || i + ch.label.length > range[1]) return null;
        cur = i + ch.label.length;
        return [i, i + ch.label.length];
      });
      const isRef = /^\[[^\]]+\]$/.test(n.label);
      const val = typeof n.value === 'string' ? `<span class="ex-val txt">${esc(n.value)}</span>`
        : `<span class="ex-val">${esc(depth === 0 ? fval(n.value, k) : fmtTeil(n.label, n.value))}</span>`;
      return `<li class="ex-n${kids.length ? ' kids' : ''}${open ? ' open' : ''}${isRef ? ' ex-ref' : ''}${inRef ? ' in-ref' : ''}" data-path="${path}">
        <div class="ex-row"${range && !inRef ? ` data-a="${range[0]}" data-b="${range[1]}"` : ''}>
          ${kids.length ? `<button type="button" class="ex-tog" data-action="ex-tog" data-path="${path}" aria-expanded="${!!open}" title="Auf-/zuklappen">${icon('chevR')}</button>` : '<i class="ex-leaf"></i>'}
          <div class="ex-lab"><code class="fx-code">${hlHTML(n.label)}</code>${n.note ? `<small>${esc(n.note)}</small>` : ''}${isRef && kids.length ? '<small>Formel dieser Kennzahl:</small>' : ''}</div>
          ${val}
        </div>
        ${kids.length ? `<ul>${kids.map((ch, i) => node(ch, `${path}.${i}`, depth + 1, kidRanges[i], inRef || isRef)).join('')}</ul>` : ''}
      </li>`;
    };
    const lead = src.length - src.trimStart().length;
    box.innerHTML = node(tree, '0', 0, [lead, src.trimEnd().length], false);
  }

  /* ---------- Verlauf ---------- */
  function chartRender(c, p, k) {
    const el = $('#kzChart'); if (!el || !window.Charts) return;
    const vals = c.series.map((v) => (isFinite(v) ? v : null)), ok = vals.filter((v) => v != null);
    $('#kzChartSub').textContent = `je Monat · ${c.ms[0].label} bis ${c.ms[11].label}${p.typ !== 'monat' ? ` · hervorgehoben: ${p.label}` : ''}`;
    if (!ok.length) {
      if (el._ro) { el._ro.disconnect(); el._ro = null; }
      el.innerHTML = `<div class="empty kz-chart-empty">${icon('chart')}<span>Kein Verlauf – die Formel liefert noch keine Werte.</span></div>`;
      $('#kzStats').innerHTML = '';
      return;
    }
    const avg = ok.reduce((s, v) => s + v, 0) / ok.length;
    $('#kzStats').innerHTML = `<span><small>Ø</small><b>${esc(fval(avg, k))}</b></span><span><small>Min</small><b>${esc(fval(Math.min(...ok), k))}</b></span><span><small>Max</small><b>${esc(fval(Math.max(...ok), k))}</b></span>`;
    const yFmt = (v, st) => (k.format === 'prozent' ? num(v * 100, st * 100 >= 1 ? 0 : 1) + ' %' : k.format === 'eur' ? fmt.axis(v, st) : num(v, st >= 1 ? 0 : 1));
    el.classList.toggle('static', ed.chartDrawn);
    Charts.bars(el, {
      labels: c.ms.map((r) => fmt.monatKurz(r.von)), height: 210,
      series: [{ name: k.name || 'Kennzahl', color: 'var(--accent)', values: vals }],
      fmtY: yFmt, fmtTip: (v) => fval(v, k),
      tipTitle: (i) => c.ms[i].label + (c.ms[i].von <= D.TODAY && D.TODAY <= c.ms[i].bis ? ' (bis heute)' : ''),
      faint: (i) => !(c.ms[i].von >= p.von && c.ms[i].von <= p.bis),
      onClick: (i) => { App.state.ptyp = 'monat'; App.setState('panchor', c.ms[i].von); }
    });
    ed.chartDrawn = true;
  }

  /* ---------- Darstellung & Ampel ---------- */
  function ampelRender() {
    const box = $('#kzAmpel'), k = draft(ui.sel); if (!box || !k) return;
    const a = k.ampel, low = !!(a && a.richtung === 'niedrig');
    const unit = k.format === 'prozent' ? '%' : k.format === 'eur' ? '€' : k.format === 'tage' ? 'Tage' : '';
    const show = (v) => numDe(k.format === 'prozent' ? v * 100 : v);
    box.classList.toggle('on', !!a);
    box.innerHTML = `<label class="toggle-row"><span>Ampel<small>Färbt den Wert grün, gelb oder rot – in der Liste und im Überblick</small></span><span class="switch"><input type="checkbox" id="kzAmpelOn" ${a ? 'checked' : ''}><span></span></span></label>
      ${a ? `<div class="kz-am-grid">
        <div class="field"><label for="amG"><i class="ampel gruen"></i>Grün ${low ? 'bis' : 'ab'}</label><div class="input-wrap"><input class="input sm num" id="amG" inputmode="decimal" value="${esc(show(a.gruen))}" autocomplete="off">${unit ? `<span class="suffix">${unit}</span>` : ''}</div></div>
        <div class="field"><label for="amY"><i class="ampel gelb"></i>Gelb ${low ? 'bis' : 'ab'}</label><div class="input-wrap"><input class="input sm num" id="amY" inputmode="decimal" value="${esc(show(a.gelb))}" autocomplete="off">${unit ? `<span class="suffix">${unit}</span>` : ''}</div></div>
        <div class="field"><span class="field-label">Richtung</span>${App.seg('local', 'kzrichtung', [['hoch', 'Höher ist besser'], ['niedrig', 'Niedriger ist besser']], low ? 'niedrig' : 'hoch')}</div>
      </div>
      <div id="amScale">${ampelScaleHTML(k, ed.vals[k.id])}</div>` : ''}`;
    requestAnimationFrame(() => App.updateSegs(box));
  }
  function ampelScaleHTML(k, v) {
    const a = k.ampel; if (!a) return '';
    const G = +a.gruen, Y = +a.gelb, low = a.richtung === 'niedrig';
    if (!isFinite(G) || !isFinite(Y)) return '';
    const pts = [G, Y]; if (isFinite(v)) pts.push(v);
    let lo = Math.min(...pts), hi = Math.max(...pts);
    const span = hi - lo || Math.abs(hi) || 1;
    lo -= span * 0.3; hi += span * 0.3;
    const x = (t) => Math.max(0, Math.min(100, ((t - lo) / (hi - lo)) * 100));
    const b1 = Math.min(G, Y), b2 = Math.max(G, Y), zones = low ? ['gruen', 'gelb', 'rot'] : ['rot', 'gelb', 'gruen'];
    const ok = low ? G <= Y : G >= Y;
    return `<div class="am-scale" aria-hidden="true">
        <div class="am-bar"><i class="${zones[0]}" style="width:${x(b1)}%"></i><i class="${zones[1]}" style="width:${x(b2) - x(b1)}%"></i><i class="${zones[2]}"></i></div>
        ${isFinite(v) ? `<span class="am-mark" style="left:${x(v)}%"><b>${esc(fval(v, k))}</b></span>` : ''}
        <span class="am-tick" style="left:${x(b1)}%">${esc(fval(b1, k))}</span><span class="am-tick" style="left:${x(b2)}%">${esc(fval(b2, k))}</span>
      </div>${ok ? '' : `<p class="hint warn">${low ? 'Bei „niedriger ist besser“ sollte Grün unter Gelb liegen.' : 'Grün sollte über Gelb liegen.'}</p>`}`;
  }
  function ampelVorschlag(k) {
    if (k.format === 'prozent') return { gruen: 0.3, gelb: 0.1 };
    if (k.format === 'tage') return { gruen: 14, gelb: 21, richtung: 'niedrig' };
    const v = ed.vals[k.id];
    if (!isFinite(v) || !v) return { gruen: 1000, gelb: 500 };
    const r = (t) => { const m = Math.pow(10, Math.floor(Math.log10(Math.abs(t)))); return Math.round(t / m) * m; };
    return { gruen: r(v), gelb: r(v / 2) };
  }

  /* ---------- Parameterhilfe unter dem Feld ---------- */
  function sigUpdate() {
    const box = $('#fxSig'), ta = $('#fxIn'); if (!box || !ta) return;
    const tipp = `<span class="fx-sig-tip">${icon('info')}Tippen zeigt Vorschläge · Argumente mit <code>;</code> trennen · Filter wie <code>kategorie: "…"</code> · Kennzahlen als <code>[Name]</code></span>`;
    if (document.activeElement !== ta) { box.innerHTML = tipp; return; }
    const toks = F().tokenize(ta.value), call = callAt(toks, ta.selectionStart), f = call && fnDef(call.fn);
    if (!f) { box.innerHTML = tipp; return; }
    const inner = f.sig.slice(f.sig.indexOf('(') + 1, f.sig.lastIndexOf(')'));
    const ps = inner ? inner.split(';').map((s) => s.trim()) : [];
    let idx = call.filter ? ps.findIndex((s) => /filter/.test(s)) : call.idx;
    if (idx >= ps.length || idx < 0) idx = ps.findIndex((s) => s.includes('…'));
    const flt = call.filter && F().FILTERS.find((x) => x.name === call.filter);
    box.innerHTML = `<span class="fx-sig-f"><span class="tk-fn">${esc(f.name)}</span>(${ps.map((s, i) => (i === idx ? `<b>${esc(s)}</b>` : esc(s))).join('; ')})</span>
      <span class="fx-sig-d">${flt ? `<b>${esc(flt.name)}:</b> ${esc(flt.desc)}` : esc(f.desc)}</span>`;
  }

  /* ---------- Autovervollständigung ---------- */
  function acUpdate(explicit) {
    const ta = $('#fxIn'); if (!ta || !ed) return;
    if (ta.selectionStart !== ta.selectionEnd) return acHide();
    const res = acCompute(ta.value, ta.selectionStart, explicit);
    if (!res || !res.items.length) return acHide();
    const keep = ed.ac && ed.ac.items[ed.ac.i];
    ed.ac = { ...res, items: res.items.slice(0, 80), i: 0 };
    if (keep) { const j = ed.ac.items.findIndex((it) => it.kind === keep.kind && it.label === keep.label); if (j > 0 && res.prefix) ed.ac.i = j; }
    acPaint();
    acPlace();
  }
  function acHide() { if (!ed) return; ed.ac = null; const b = $('#fxAc'); if (b) { b.hidden = true; b.innerHTML = ''; } const ta = $('#fxIn'); if (ta) ta.removeAttribute('aria-activedescendant'); }
  function markPre(label, pre) {
    if (!pre) return esc(label);
    const i = norm(label).indexOf(norm(pre));
    return i < 0 ? esc(label) : esc(label.slice(0, i)) + `<mark>${esc(label.slice(i, i + pre.length))}</mark>` + esc(label.slice(i + pre.length));
  }
  function acPaint() {
    const a = ed.ac, box = $('#fxAc'); if (!a || !box) return;
    const cur = a.items[a.i];
    box.innerHTML = `<div class="fx-ac-list">${a.items.map((it, i) => `<div class="fx-ac-it${i === a.i ? ' on' : ''}" id="fxAc${i}" role="option" aria-selected="${i === a.i}" data-i="${i}">
        <i class="fx-k k-${it.kind}" title="${KIND[it.kind][1]}">${KIND[it.kind][0]}</i><span class="fx-ac-l">${markPre(it.label, a.prefix)}</span><span class="fx-ac-d">${esc(it.detail || '')}</span></div>`).join('')}</div>
      ${cur && cur.desc ? `<div class="fx-ac-doc"><span class="fx-ac-kind">${KIND[cur.kind][1]}</span>${cur.kind === 'fn' ? `<b>${esc(cur.detail)}</b>` : ''}<p>${esc(cur.desc)}</p>${cur.example ? `<code class="fx-code">${hlHTML(cur.example)}</code>` : ''}</div>` : ''}
      <div class="fx-ac-foot"><span><kbd>↑</kbd><kbd>↓</kbd> wählen</span><span><kbd>↵</kbd> oder <kbd>⇥</kbd> übernehmen</span><span><kbd>Esc</kbd> schließen</span></div>`;
    box.hidden = false;
    $('#fxIn').setAttribute('aria-activedescendant', 'fxAc' + a.i);
    const on = $('.fx-ac-it.on', box), list = $('.fx-ac-list', box);
    if (on && list) { const t = on.offsetTop, b = t + on.offsetHeight; if (t < list.scrollTop) list.scrollTop = t - 4; else if (b > list.scrollTop + list.clientHeight) list.scrollTop = b - list.clientHeight + 4; }
  }
  /* Pixelposition eines Zeichens in der Formel (über die Hervorhebungs-Ebene gemessen), relativ zu .fx */
  function charPos(i) {
    const pre = $('#fxHl'), base = $('#fx').getBoundingClientRect();
    const nodes = [], walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    let acc = 0;
    for (let j = 0; j < nodes.length; j++) {
      const n = nodes[j], len = n.nodeValue.length;
      if (len && (i < acc + len || (j === nodes.length - 1 && i <= acc + len))) {
        const off = i - acc, r = document.createRange();
        if (off < len) { r.setStart(n, off); r.setEnd(n, off + 1); } else { r.setStart(n, off - 1); r.setEnd(n, off); }
        const rect = r.getClientRects()[0] || r.getBoundingClientRect();
        return { x: (off < len ? rect.left : rect.right) - base.left, y: rect.bottom - base.top };
      }
      acc += len;
    }
    const s = getComputedStyle(pre);
    return { x: parseFloat(s.paddingLeft), y: parseFloat(s.paddingTop) + parseFloat(s.lineHeight) };
  }
  function acPlace() {
    const box = $('#fxAc'), fx = $('#fx'); if (!ed || !box || box.hidden || !ed.ac) return;
    const pt = charPos(ed.ac.from), W = fx.clientWidth, bw = Math.min(470, W);
    box.style.width = bw + 'px';
    box.style.left = Math.max(0, Math.min(W - bw, pt.x - 36)) + 'px';
    box.style.top = pt.y + 8 + 'px';
  }
  /* Text ersetzen und dabei den Undo-Verlauf des Felds erhalten (⌘Z funktioniert weiter) */
  function replaceRange(from, to, text, caret) {
    const ta = $('#fxIn'); if (!ta) return;
    ta.focus();
    ta.setSelectionRange(from, to);
    ed.programmatic = true;
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok) { ta.setRangeText(text, from, to, 'end'); onInput(); }
    ed.programmatic = false;
    ta.setSelectionRange(caret, caret);
    afterCaret();
  }
  function acAccept(i) {
    const a = ed && ed.ac; if (!a) return;
    const it = a.items[i == null ? a.i : i]; if (!it) return;
    const src = $('#fxIn').value;
    let to = a.to, ins = it.insert != null ? it.insert : it.label, caret = it.caret != null ? it.caret : null;
    if (it.kind === 'fn') {
      let j = to; while (src[j] === ' ') j++;
      if (src[j] === '(') { to = j + 1; ins = it.label + '('; caret = ins.length; } else { ins = it.label + '()'; caret = it.label.length + 1; }
    }
    if (a.from === a.to && src[a.from - 1] === ':' && (it.kind === 'val' || it.kind === 'zeit' || it.kind === 'fn')) { ins = ' ' + ins; if (caret != null) caret++; }
    acHide();
    ed.acOff = false;
    replaceRange(a.from, to, ins, a.from + (caret != null ? caret : ins.length));
    if (it.reopen) acUpdate(true);
  }
  function onFxKey(e) {
    const open = ed && ed.ac && !$('#fxAc').hidden;
    if (open) {
      const n = ed.ac.items.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ed.ac.i = (ed.ac.i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; acPaint(); return; }
      if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); ed.ac.i = Math.max(0, Math.min(n - 1, ed.ac.i + (e.key === 'PageDown' ? 7 : -7))); acPaint(); return; }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); acAccept(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); acHide(); ed.acOff = true; return; }
    }
    if (e.key === ' ' && e.ctrlKey) { e.preventDefault(); ed.acOff = false; acUpdate(true); return; }
    if (e.key === 'Escape') { $('#fxIn').blur(); return; }
    // Nach einer Pause wieder Vorschläge anbieten, sobald weiter getippt wird
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) ed.acOff = false;
  }

  /* ---------- Speichern, Verwerfen, Anlegen ---------- */
  function renameRef(src, alt, neu) {
    let changed = false;
    const out = F().tokenize(src).map((t) => (t.type === 'ref' && norm(t.value) === norm(alt) ? ((changed = true), `[${neu}]`) : t.text)).join('');
    return changed ? out : src;
  }
  const usesRef = (src, name) => F().tokenize(src).some((t) => t.type === 'ref' && norm(t.value) === norm(name));
  const usesVar = (src, name) => F().tokenize(src).some((t) => t.type === 'name' && t.text.toUpperCase() === String(name).toUpperCase());

  function speichern() {
    const k = draft(ui.sel); if (!k || !ed) return;
    const msg = nameMsg(k);
    if (msg) { App.toast(msg === 'Name fehlt' ? 'Bitte zuerst einen Namen eingeben' : msg, { icon: 'alert' }); $('#kzName')?.focus(); return; }
    clearTimeout(ed.timer);
    const chk = F().check(k.formel, ctxFor(App.period(), k));
    if (!chk.ok) {
      auswerten();
      const r = $('#fxRes .fx-res'); if (r) { r.classList.remove('shake'); void r.offsetWidth; r.classList.add('shake'); }
      App.toast('Die Formel hat noch einen Fehler – bitte erst korrigieren', { icon: 'alert' });
      return;
    }
    if (!dirty(k.id)) { App.toast('Alles gespeichert', { icon: 'check' }); return; }
    k.name = String(k.name).trim();
    const neu = isNeu(k.id), s = neu ? null : saved(k.id), alt = s ? s.name : null;
    let bezuege = 0;
    if (alt && norm(alt) !== norm(k.name)) {
      D.KENNZAHLEN.forEach((x) => {
        if (x.id === k.id) return;
        const f = renameRef(x.formel, alt, k.name);
        if (f !== x.formel) { x.formel = f; bezuege++; }
        if (ui.drafts[x.id]) ui.drafts[x.id].formel = renameRef(ui.drafts[x.id].formel, alt, k.name);
      });
    }
    if (neu) { D.KENNZAHLEN.push(clone(k)); ui.neu = null; }
    else FIELDS.forEach((f) => { if (k[f] === undefined || (k[f] === '' && f !== 'text')) delete s[f]; else s[f] = clone(k[f]); });
    delete ui.drafts[k.id];
    App.save();
    renderList();
    refreshHead(true);
    setTimeout(() => ed && refreshHead(), 1800);
    const cnt = $('#kzTabs button[data-value="kennzahlen"] .cnt'); if (cnt) cnt.textContent = D.KENNZAHLEN.length;
    $('#kzIdeen').innerHTML = ideenHTML();
    App.toast(neu ? `„${k.name}“ angelegt` : bezuege ? `„${k.name}“ gespeichert · ${bezuege} Bezug${bezuege > 1 ? 'e' : ''} umbenannt` : `„${k.name}“ gespeichert`);
  }
  function neueKennzahl(formel) {
    if (!ui.neu) ui.neu = { id: 'kz' + Date.now().toString(36), name: freierName('Neue Kennzahl'), text: '', formel: 'EINNAHMEN() - AUSGABEN()', format: 'eur', anheften: false };
    if (formel) ui.neu.formel = formel;
    ui.sel = ui.neu.id;
    ui.tab = 'kennzahlen';
  }
  function setPin(id, on) {
    const target = isNeu(id) ? ui.neu : saved(id); if (!target) return;
    target.anheften = on;
    if (ui.drafts[id]) ui.drafts[id].anheften = on;
    if (!isNeu(id)) App.save();
    const b = $(`.kz-star[data-id="${CSS.escape(id)}"]`);
    if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.title = on ? 'Vom Überblick lösen' : 'Im Überblick anheften'; }
    if (id === ui.sel) { const sw = $('#kzPin'); if (sw) sw.checked = on; refreshHead(); }
    App.toast(on ? `„${shown(target).name}“ erscheint im Überblick` : `„${shown(target).name}“ vom Überblick gelöst`, { icon: 'star' });
  }
  const scrollToEditor = () => requestAnimationFrame(() => { const c = $('.kz-editor'); if (c && c.getBoundingClientRect().top < 70) c.scrollIntoView({ behavior: App.settings.motion === 'full' ? 'smooth' : 'auto', block: 'start' }); });

  /* ---------- Variablen ---------- */
  function wertHint(v) {
    const w = +v.wert;
    return isFinite(w) && w !== 0 && Math.abs(w) < 1 ? `${numDe(w)} = ${fmt.pct(w, Math.abs(w * 100) % 1 ? 1 : 0)}` : '';
  }
  function usedChips(v) {
    const ks = D.KENNZAHLEN.filter((k) => usesVar(k.formel, v.name));
    if (!ks.length) return '<span class="muted kz-unused">noch in keiner Kennzahl</span>';
    const p = App.period();
    return `<div class="chips">${ks.map((k) => `<a class="chip" href="#/kennzahlen?k=${esc(k.id)}" title="${esc(k.formel)}">${esc(k.name)}<b class="num">${esc(fval(wert(k, p), k))}</b></a>`).join('')}</div>`;
  }
  function variablenHTML() {
    const p = App.period();
    return `<section ${R('card kz-vars', 2)}>
        <div class="card-head wrap"><div><div class="card-title">${icon('kzVar')}Variablen <span class="muted">· ${D.VARIABLEN.length}</span></div>
          <div class="card-sub">Feste Werte, die du in Formeln per Namen verwendest, z. B. <code class="fx-code">${hlHTML('GEWINN() * STEUERQUOTE')}</code>. Änderungen wirken sofort auf alle Kennzahlen.</div></div>
          <button type="button" class="btn subtle" data-action="var-add">${icon('plus')}Variable</button></div>
        ${D.VARIABLEN.length ? `<div class="table-wrap"><table class="fin-table kz-vt">
          <thead><tr><th class="l">Name</th><th>Wert</th><th class="l">Beschreibung</th><th class="l">Verwendet in · Werte ${esc(p.label)}</th><th></th></tr></thead>
          <tbody>${D.VARIABLEN.map((v, i) => `<tr data-i="${i}">
            <td class="l"><input class="input sm kz-vn" value="${esc(v.name)}" spellcheck="false" autocomplete="off" aria-label="Name" data-i="${i}"></td>
            <td><input class="input sm num kz-vw" value="${esc(numDe(v.wert))}" inputmode="decimal" autocomplete="off" aria-label="Wert von ${esc(v.name)}" data-i="${i}"><small class="kz-vw-hint" id="kzVh${i}">${esc(wertHint(v))}</small></td>
            <td class="l"><input class="input sm kz-vd" value="${esc(v.text || '')}" placeholder="Wofür steht der Wert?" autocomplete="off" aria-label="Beschreibung" data-i="${i}"></td>
            <td class="l kz-vu" id="kzVu${i}">${usedChips(v)}</td>
            <td><button type="button" class="icon-btn sm kz-x" data-action="var-del" data-i="${i}" title="Variable löschen">${icon('trash')}</button></td>
          </tr>`).join('')}</tbody></table></div>`
          : `<div class="empty">${icon('kzVar')}<b>Noch keine Variablen</b><span>Lege z. B. deinen Stundensatz an und nutze ihn in Formeln.</span></div>`}
      </section>
      <p ${R('hint kz-vt-hint', 3)}>${icon('info')}<span>Quoten als Anteil eintragen: <b>0,25</b> entspricht 25 %. In Formeln geht auch direkt <code class="fx-code">${hlHTML('30 %')}</code>. Namen: Großbuchstaben, Ziffern und _. Umbenennen passt alle Formeln automatisch an.</span></p>`;
  }
  function refreshVarUses() { D.VARIABLEN.forEach((v, i) => { const td = $('#kzVu' + i); if (td) td.innerHTML = usedChips(v); }); }
  function varNameErr(n, i) {
    if (!n) return 'Name fehlt';
    if (!/^[A-ZÄÖÜ_][A-ZÄÖÜ0-9_]*$/.test(n)) return 'Nur Großbuchstaben, Ziffern und _ – nicht mit einer Ziffer beginnen';
    if (fnSet().has(n) || konstSet().has(n)) return `„${n}“ ist schon eine Funktion oder Konstante`;
    if (D.VARIABLEN.some((v, j) => j !== i && String(v.name).toUpperCase() === n)) return `„${n}“ gibt es schon`;
    return '';
  }
  function saveSoon() { clearTimeout(ed.saveT); ed.saveT = setTimeout(() => App.save(), 250); }

  /* ---------- Funktionen (Nachschlagewerk) ---------- */
  function sigFmt(sig) {
    const i = sig.indexOf('(');
    return i < 0 ? esc(sig) : `<span class="tk-fn">${esc(sig.slice(0, i))}</span><span class="kz-fn-p">${esc(sig.slice(i))}</span>`;
  }
  function beispielWert(ex) {
    const p = App.period(), r = F().check(ex, App.fctx(p));
    return r.ok ? fmtTeil(ex, r.value) : '';
  }
  function funktionenHTML() {
    const FN = F().FUNCTIONS, gruppen = [...new Set(FN.map((f) => f.group))];
    const sel = ui.sel && draft(ui.sel), p = App.period();
    const entry = (f) => {
      const w = beispielWert(f.example);
      return `<div class="kz-fn" data-q="${esc(norm(`${f.name} ${f.desc} ${f.group} ${f.example}`))}">
        <code class="kz-fn-sig">${sigFmt(f.sig)}</code>
        <p>${esc(f.desc)}</p>
        <div class="kz-fn-ex">
          <button type="button" class="kz-ex-code" data-action="fn-use" data-ex="${esc(f.example)}" title="${sel ? `In die Formel von „${esc(sel.name)}“ übernehmen` : 'Als neue Kennzahl anlegen'}"><code class="fx-code">${hlHTML(f.example)}</code>${w ? `<span class="kz-ex-w">= ${esc(w)}</span>` : ''}<span class="kz-ex-go">${icon('arrow')}</span></button>
          <button type="button" class="icon-btn sm" data-action="fn-new" data-ex="${esc(f.example)}" title="Als neue Kennzahl anlegen">${icon('plus')}</button>
        </div></div>`;
    };
    return `<div ${R('kz-ref-bar', 2)}><label class="kz-search">${icon('search')}<input class="input" id="kzFnQ" type="search" placeholder="Funktion, Filter oder Stichwort suchen …" value="${esc(ui.fnQuery)}" autocomplete="off" aria-label="Funktionen durchsuchen"></label>
        <span class="hint">Klick auf ein Beispiel übernimmt es ${sel ? `in die Formel von <b>${esc(sel.name)}</b>` : 'als neue Kennzahl'} · Werte für ${esc(p.label)}</span></div>
      <div class="kz-ref-grid" id="kzRef">
        ${gruppen.map((g, gi) => `<section ${R('card kz-ref-card', 3 + gi)} data-grp><div class="card-title">${icon(GRUPPE_IC[g] || 'kzFx')}${esc(g)} <span class="muted">· ${FN.filter((f) => f.group === g).length}</span></div>${FN.filter((f) => f.group === g).map(entry).join('')}</section>`).join('')}
        <section ${R('card kz-ref-card', 9)} data-grp><div class="card-title">${icon('filter')}Filter <span class="muted">· in Datenfunktionen</span></div>
          ${F().FILTERS.map((f) => `<div class="kz-fn" data-q="${esc(norm(f.name + ' filter ' + f.desc))}"><code class="kz-fn-sig"><span class="tk-flt">${esc(f.name)}</span><span class="kz-fn-p">:</span></code><p>${esc(f.desc)}</p></div>`).join('')}</section>
        <section ${R('card kz-ref-card', 10)} data-grp><div class="card-title">${icon('calendar')}Zeiträume & Datenmengen</div>
          ${F().CONSTANTS.map((c) => `<div class="kz-fn" data-q="${esc(norm(c.name + ' konstante zeitraum ' + c.desc))}"><code class="kz-fn-sig"><span class="tk-const">${esc(c.name)}</span></code><p>${esc(c.desc)}</p></div>`).join('')}</section>
        <section ${R('card kz-ref-card', 11)} data-grp><div class="card-title">${icon('code')}Schreibweise</div>
          ${[['1500 · 0,3 · 30 %', 'Zahlen mit Komma oder Punkt, ohne Tausenderpunkt; „30 %“ ist 0,3.'],
            ['GEWINN() * STEUERQUOTE', 'Rechnen mit + − * / ^ und Klammern, Variablen per Namen.'],
            ['MAX(0; GEWINN())', 'Argumente werden mit Semikolon getrennt – wie im deutschen Excel.'],
            [`AUSGABEN(kategorie: "${(D.KATEGORIEN.find((k) => k.typ === 'ausgabe') || { name: 'Material' }).name}")`, 'Filter als name: wert; Texte in Anführungszeichen.'],
            [`[${(D.KENNZAHLEN[0] || { name: 'Gewinn' }).name}] / MONATE()`, 'Andere Kennzahlen in eckigen Klammern. Zirkel werden erkannt.'],
            ['WENN(GEWINN() > 0; 1; 0)', 'Vergleiche: = <> < > <= >= ergeben 1 (wahr) oder 0 (falsch).']]
            .map(([c, t]) => `<div class="kz-fn" data-q="${esc(norm(c + ' ' + t + ' syntax schreibweise'))}"><code class="kz-fn-sig fx-code">${hlHTML(c)}</code><p>${esc(t)}</p></div>`).join('')}</section>
      </div>
      <div class="empty kz-ref-none" id="kzRefNone" hidden>${icon('search')}<b>Nichts gefunden</b><span>Andere Schreibweise versuchen – z. B. „teilen“, „monat“ oder „bar“.</span></div>`;
  }
  function filterFunktionen() {
    const q = norm(ui.fnQuery).trim();
    let any = false;
    $$('#kzRef [data-grp]').forEach((sec) => {
      let n = 0;
      $$('.kz-fn', sec).forEach((x) => { const hit = !q || x.dataset.q.includes(q); x.hidden = !hit; if (hit) n++; });
      sec.hidden = !n; if (n) any = true;
    });
    const none = $('#kzRefNone'); if (none) none.hidden = any;
  }

  /* ---------- Ideen ---------- */
  function ideen() {
    const p = App.period(), formeln = new Set(liste().map((k) => norm(shown(k).formel).replace(/\s+/g, '')));
    return IDEEN.map((x, i) => ({ ...x, i, formel: ideeFormel(x) }))
      .filter((x) => x.formel && !nameTaken(x.name, null) && !formeln.has(norm(x.formel).replace(/\s+/g, '')))
      .map((x) => { const r = F().check(x.formel, App.fctx(p)); return r.ok ? { ...x, v: r.value } : null; })
      .filter(Boolean).slice(0, 6);
  }
  function ideenHTML() {
    const list = ideen(), p = App.period();
    if (!list.length) return '';
    return `<div ${R('ov-bar kz-ideen-bar', 7)}><h2 class="section-title">${icon('kzBulb')}Ideen für Kennzahlen <span class="muted">· mit einem Klick übernehmen</span></h2><span class="hint">Werte für ${esc(p.label)}</span></div>
      <div class="kz-ideen-grid">${list.map((x, i) => `<article ${R('kz-idea', 8 + i)}>
        <div class="kz-idea-h"><span class="kz-idea-ic">${icon(x.icon)}</span><b>${esc(x.name)}</b><span class="kz-idea-v">${esc(fval(x.v, x))}</span></div>
        <p>${esc(x.text)}</p>
        <code class="fx-code kz-idea-f">${hlHTML(x.formel)}</code>
        <div class="kz-idea-foot"><span class="badge">${esc(FORMAT_NAME[x.format])}</span>${x.ampel ? '<span class="badge"><i class="ampel gruen"></i>Ampel</span>' : ''}<span class="spacer"></span>
          <button type="button" class="btn subtle sm" data-action="idea-add" data-i="${x.i}">${icon('plus')}Hinzufügen</button></div>
      </article>`).join('')}</div>`;
  }

  /* ================= Ereignisse ================= */
  function wire(root) {
    let dragId = null;
    root.addEventListener('click', (e) => {
      const li = e.target.closest('.kz-item');
      if (li && !e.target.closest('[data-action]')) { select(li.dataset.id); return; }
    });
    root.addEventListener('mousedown', (e) => {
      const it = e.target.closest('.fx-ac-it');
      if (it) { e.preventDefault(); acAccept(+it.dataset.i); }
    });
    root.addEventListener('mouseover', (e) => {
      if (!ed || !$('#fxIn')) return;
      const row = e.target.closest('.ex-row[data-a]');
      const hot = row ? { start: +row.dataset.a, end: +row.dataset.b } : null;
      if (JSON.stringify(hot) !== JSON.stringify(ed.hot)) { ed.hot = hot; paint(); }
    });
    root.addEventListener('input', (e) => {
      const t = e.target, k = draft(ui.sel);
      if (t.id === 'kzName' && k) { k.name = t.value; refreshHead(); schedule(); return; }
      if (t.id === 'kzText' && k) { k.text = t.value; refreshHead(); schedule(); return; }
      if ((t.id === 'amG' || t.id === 'amY') && k && k.ampel) {
        const v = parseDe(t.value), bad = v == null || isNaN(v);
        t.classList.toggle('invalid', bad);
        if (bad) return;
        k.ampel[t.id === 'amG' ? 'gruen' : 'gelb'] = k.format === 'prozent' ? +(v / 100).toFixed(10) : v;
        refreshHead(); schedule(); return;
      }
      if (t.id === 'kzFnQ') { ui.fnQuery = t.value; filterFunktionen(); return; }
      const i = +t.dataset.i, v = D.VARIABLEN[i];
      if (!v) return;
      if (t.classList.contains('kz-vw')) {
        const w = parseDe(t.value), bad = w == null || isNaN(w);
        t.classList.toggle('invalid', bad);
        if (bad) return;
        v.wert = w;
        $('#kzVh' + i).textContent = wertHint(v);
        refreshVarUses(); saveSoon();
      } else if (t.classList.contains('kz-vd')) { v.text = t.value; saveSoon(); }
      else if (t.classList.contains('kz-vn')) {
        const pos = t.selectionStart;
        t.value = t.value.toUpperCase().replace(/[\s-]/g, '_');
        t.setSelectionRange(pos, pos);
        t.classList.toggle('invalid', !!varNameErr(t.value, i));
      }
    });
    root.addEventListener('change', (e) => {
      const t = e.target, k = draft(ui.sel);
      if (t.id === 'kzPin') { setPin(ui.sel, t.checked); return; }
      if (t.id === 'kzAmpelOn' && k) {
        if (t.checked) k.ampel = ampelVorschlag(k); else delete k.ampel;
        ampelRender(); refreshHead(); auswerten(); return;
      }
      if (t.classList.contains('kz-vn')) {
        const i = +t.dataset.i, v = D.VARIABLEN[i], alt = String(v.name), neu = t.value.trim();
        if (neu === alt.toUpperCase() && neu === alt) return;
        const err = varNameErr(neu, i);
        if (err) { App.toast(err, { icon: 'alert' }); t.value = alt; t.classList.remove('invalid'); return; }
        let n = 0;
        const umbenennen = (src) => {
          let ch = false;
          const out = F().tokenize(src).map((x) => (x.type === 'name' && x.text.toUpperCase() === alt.toUpperCase() ? ((ch = true), neu) : x.text)).join('');
          return ch ? out : src;
        };
        D.KENNZAHLEN.forEach((k2) => { const f = umbenennen(k2.formel); if (f !== k2.formel) { k2.formel = f; n++; } });
        Object.values(ui.drafts).forEach((d) => { d.formel = umbenennen(d.formel); });
        if (ui.neu) ui.neu.formel = umbenennen(ui.neu.formel);
        v.name = neu;
        App.save(); refreshVarUses();
        App.toast(n ? `Umbenannt in ${neu} · ${n} Formel${n > 1 ? 'n' : ''} angepasst` : `Umbenannt in ${neu}`);
      }
    });
    root.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t.id === 'kzName' && e.key === 'Enter') { e.preventDefault(); $('#fxIn')?.focus(); return; }
      if ((t.id === 'amG' || t.id === 'amY' || t.classList.contains('kz-vw') || t.classList.contains('kz-vn') || t.classList.contains('kz-vd')) && e.key === 'Enter') { e.preventDefault(); t.blur(); return; }
      const li = t.closest && t.closest('.kz-item');
      if (!li || t !== li) return;
      const items = $$('.kz-item'), i = items.indexOf(li);
      if (e.key === 'Enter') { e.preventDefault(); $('#fxIn')?.focus(); }
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey) {
        e.preventDefault();
        const other = items[i + (e.key === 'ArrowDown' ? 1 : -1)];
        if (!other || isNeu(li.dataset.id) || isNeu(other.dataset.id)) return;
        verschiebe(li.dataset.id, other.dataset.id, e.key === 'ArrowDown');
        $(`.kz-item[data-id="${CSS.escape(li.dataset.id)}"]`)?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const nx = items[i + (e.key === 'ArrowDown' ? 1 : -1)];
        if (nx) select(nx.dataset.id, { focusList: true });
      }
    });
    root.addEventListener('seg-change', (e) => {
      const { key, value } = e.detail;
      if (key === 'kztab') { ui.tab = value; acHide(); renderBody(); return; }
      const k = draft(ui.sel); if (!k) return;
      if (key === 'kzformat') { k.format = value; ampelRender(); }
      else if (key === 'kzdec') { if (value === '') delete k.dec; else k.dec = +value; }
      else if (key === 'kzvgl') { if (value === 'vorperiode') delete k.vergleich; else k.vergleich = value; }
      else if (key === 'kzrichtung' && k.ampel) { if (value === 'niedrig') k.ampel.richtung = 'niedrig'; else delete k.ampel.richtung; ampelRender(); }
      else return;
      refreshHead(); auswerten();
    });
    // Ziehen & Ablegen in der Liste
    root.addEventListener('dragstart', (e) => {
      const li = e.target.closest && e.target.closest('.kz-item');
      if (!li || isNeu(li.dataset.id)) return;
      dragId = li.dataset.id;
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragId);
    });
    const clearMarks = () => $$('.kz-item.drop-before, .kz-item.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    root.addEventListener('dragover', (e) => {
      if (!dragId) return;
      const li = e.target.closest && e.target.closest('.kz-item');
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearMarks();
      if (li && li.dataset.id !== dragId && !isNeu(li.dataset.id)) { const r = li.getBoundingClientRect(); li.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before'); }
    });
    root.addEventListener('drop', (e) => {
      if (!dragId) return;
      e.preventDefault();
      const li = $('.kz-item.drop-before, .kz-item.drop-after');
      const id = dragId; dragId = null;
      if (li) { verschiebe(id, li.dataset.id, li.classList.contains('drop-after')); App.toast('Reihenfolge gespeichert – gilt auch für den Überblick'); }
      clearMarks();
    });
    root.addEventListener('dragend', () => { dragId = null; clearMarks(); $$('.kz-item.dragging').forEach((x) => x.classList.remove('dragging')); });
  }

  /* ================= Aktionen (data-action) ================= */
  const aktiv = () => !!(ed && App.route.id === 'kennzahlen');
  App.action('kz-new', () => {
    if (!aktiv()) return;
    neueKennzahl();
    App.rerender();
    requestAnimationFrame(() => { const n = $('#kzName'); if (n) { n.focus(); n.select(); } scrollToEditor(); });
  });
  App.action('kz-save', () => { if (aktiv()) speichern(); });
  App.action('kz-revert', () => {
    if (!aktiv()) return;
    const id = ui.sel;
    if (isNeu(id)) { ui.neu = null; ui.sel = (D.KENNZAHLEN[0] || {}).id || null; App.rerender(); App.toast('Neue Kennzahl verworfen'); return; }
    const d = ui.drafts[id]; delete ui.drafts[id];
    renderEditor(); renderList();
    App.toast('Änderungen verworfen', { action: { label: 'Rückgängig', fn: () => { ui.drafts[id] = d; if (aktiv() && ui.sel === id) { renderEditor(); renderList(); } } } });
  });
  App.action('kz-dup', () => {
    if (!aktiv()) return;
    const k = draft(ui.sel); if (!k) return;
    const c = clone(k);
    c.id = 'kz' + Date.now().toString(36);
    c.name = freierName(`${String(k.name).trim() || 'Kennzahl'} (Kopie)`);
    c.anheften = false;
    const idx = D.KENNZAHLEN.findIndex((x) => x.id === k.id);
    D.KENNZAHLEN.splice(idx < 0 ? D.KENNZAHLEN.length : idx + 1, 0, c);
    App.save();
    ui.sel = c.id;
    App.rerender();
    App.toast(`„${c.name}“ angelegt`, { icon: 'copy' });
  });
  App.action('kz-del', () => {
    if (!aktiv()) return;
    const id = ui.sel;
    if (isNeu(id)) { ui.neu = null; ui.sel = (D.KENNZAHLEN[0] || {}).id || null; App.rerender(); return; }
    const s = saved(id); if (!s) return;
    const nutzer = D.KENNZAHLEN.filter((x) => x.id !== id && usesRef(x.formel, s.name)).map((x) => x.name);
    if (!confirm(`Kennzahl „${s.name}“ löschen?${nutzer.length ? `\n\nSie wird noch verwendet in: ${nutzer.join(', ')}. Diese Formeln zeigen danach einen Fehler.` : ''}`)) return;
    const idx = D.KENNZAHLEN.indexOf(s), d = ui.drafts[id];
    D.KENNZAHLEN.splice(idx, 1);
    delete ui.drafts[id];
    App.save();
    ui.sel = (D.KENNZAHLEN[idx] || D.KENNZAHLEN[idx - 1] || {}).id || null;
    App.rerender();
    App.toast(`„${s.name}“ gelöscht`, { icon: 'trash', action: { label: 'Rückgängig', fn: () => {
      D.KENNZAHLEN.splice(Math.min(idx, D.KENNZAHLEN.length), 0, s);
      if (d) ui.drafts[id] = d;
      ui.sel = id; App.save();
      if (App.route.id === 'kennzahlen') App.rerender();
    } } });
  });
  App.action('kz-pin', (a) => { if (aktiv()) setPin(a.dataset.id, !(isNeu(a.dataset.id) ? ui.neu.anheften : (saved(a.dataset.id) || {}).anheften)); });
  App.action('kz-open', (a) => { if (aktiv()) select(a.dataset.id); });
  App.action('kz-tab', (a) => { if (!aktiv()) return; ui.tab = a.dataset.tab; acHide(); renderBody(); window.scrollTo({ top: 0 }); });
  App.action('fx-fix', () => {
    if (!aktiv() || !ed.fix) return;
    const f = ed.fix;
    replaceRange(f.start, f.end, f.text, f.start + f.text.length);
    clearTimeout(ed.timer);
    auswerten();
  });
  App.action('fx-explain', () => {
    if (!aktiv()) return;
    ui.explain = !ui.explain;
    const ex = $('#kzEx'); if (ex) ex.hidden = !ui.explain;
    auswerten();
  });
  App.action('ex-tog', (a) => {
    const li = a.closest('.ex-n'); if (!li || !ed) return;
    const open = li.classList.toggle('open');
    a.setAttribute('aria-expanded', open);
    const st = exState(ui.sel), path = a.dataset.path;
    if (st.t.has(path)) st.t.delete(path); else st.t.add(path);
  });
  App.action('ex-all', (a) => {
    if (!aktiv()) return;
    const st = exState(ui.sel);
    st.mode = a.dataset.mode; st.t.clear();
    auswerten();
  });
  App.action('var-add', () => {
    if (!aktiv()) return;
    let n = 'NEUE_VARIABLE', i = 2;
    while (D.VARIABLEN.some((v) => String(v.name).toUpperCase() === n)) n = `NEUE_VARIABLE_${i++}`;
    D.VARIABLEN.push({ name: n, wert: 0, text: '' });
    App.save();
    renderBody();
    requestAnimationFrame(() => { const inp = $$('.kz-vn').pop(); if (inp) { inp.focus(); inp.select(); } });
  });
  App.action('var-del', (a) => {
    if (!aktiv()) return;
    const i = +a.dataset.i, v = D.VARIABLEN[i]; if (!v) return;
    const nutzer = D.KENNZAHLEN.filter((k) => usesVar(k.formel, v.name)).map((k) => k.name);
    if (nutzer.length && !confirm(`Variable ${v.name} löschen?\n\nSie wird noch verwendet in: ${nutzer.join(', ')}. Diese Kennzahlen zeigen danach einen Fehler.`)) return;
    D.VARIABLEN.splice(i, 1);
    App.save(); renderBody();
    App.toast(`${v.name} gelöscht`, { icon: 'trash', action: { label: 'Rückgängig', fn: () => { D.VARIABLEN.splice(i, 0, v); App.save(); if (aktiv() && ui.tab === 'variablen') renderBody(); } } });
  });
  App.action('fn-use', (a) => {
    if (!aktiv()) return;
    const ex = a.dataset.ex, k = ui.sel && draft(ui.sel);
    if (!k) { neueKennzahl(ex); App.rerender(); scrollToEditor(); return; }
    const alt = k.formel, id = k.id;
    k.formel = ex;
    ui.tab = 'kennzahlen';
    App.rerender();
    requestAnimationFrame(() => { const ta = $('#fxIn'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); afterCaret(); } scrollToEditor(); });
    App.toast(`Beispiel in „${k.name}“ übernommen`, { action: { label: 'Rückgängig', fn: () => { const d = draft(id); if (d) d.formel = alt; if (aktiv() && ui.sel === id) renderEditor(); } } });
  });
  App.action('fn-new', (a) => {
    if (!aktiv()) return;
    neueKennzahl(a.dataset.ex);
    App.rerender();
    requestAnimationFrame(() => { const n = $('#kzName'); if (n) { n.focus(); n.select(); } scrollToEditor(); });
  });
  App.action('idea-add', (a) => {
    if (!aktiv()) return;
    const x = IDEEN[+a.dataset.i], formel = x && ideeFormel(x); if (!formel) return;
    const k = { id: 'kz' + Date.now().toString(36), name: freierName(x.name), text: x.text, formel, format: x.format, anheften: false };
    if (x.dec != null) k.dec = x.dec;
    if (x.ampel) k.ampel = clone(x.ampel);
    D.KENNZAHLEN.push(k);
    App.save();
    ui.sel = k.id;
    App.rerender();
    scrollToEditor();
    App.toast(`„${k.name}“ hinzugefügt`, { action: { label: 'Rückgängig', fn: () => { const i = D.KENNZAHLEN.indexOf(k); if (i >= 0) D.KENNZAHLEN.splice(i, 1); App.save(); if (ui.sel === k.id) ui.sel = (D.KENNZAHLEN[0] || {}).id; if (App.route.id === 'kennzahlen') App.rerender(); } } });
  });

  App.page('kennzahlen', { title: 'Kennzahlen', icon: 'sigma', nav: false, parent: 'auswertung', order: 32, desc: 'Eigene Formeln & Kennzahlen – wie in Excel, nur lesbar', render });
})();
