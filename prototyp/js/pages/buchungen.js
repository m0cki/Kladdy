/* Kladdy – Prototyp · Seite „Ein- & Ausgänge“ (Seiten-ID 'buchungen', Startseite)
 * Ruhige Liste aller geschäftlichen Zahlungen – ohne Konten, Salden und Summen (die gehören in die Auswertung).
 * Maßgeblich ist das Zahlungsdatum (Zufluss/Abfluss, § 11 EStG). Der Zahlungsweg (Bar · Überweisung · PayPal) ist nur eine Angabe.
 *
 * Aufbau:  render() baut das Gerüst · update() aktualisiert Filter und Tabelle (ohne das Suchfeld neu zu bauen)
 *          · Schublade zum Erfassen/Bearbeiten mit Beleg-Drop und Erkennung bzw. „Beleg zur Einnahme“ (Quittung/Rechnung).
 * Global:  App.neueBuchung(prefill) – aufgerufen von App.erfassen („+ Erfassen“ im Seitenkopf, ⌘N, Befehle, andere Seiten)
 *          · App.bearbeiteBuchung(id). Beide öffnen die Schublade auf jeder Seite, ohne zu navigieren.
 *          prefill: { typ, beleg: 'quittung'|'rechnung', kontakt (Kunden-ID), kunde, lieferant, betrag (Cent), text, kat,
 *                     zahlungsart, datum, belegnr, vorlage, file } – beleg oder kontakt bedeuten immer eine Einnahme.
 * Routen:  #/buchungen?zw=bar|bank|paypal · ?b=<id> · ?drop=1 (App.pendingFiles) · ?neu=1 [&typ=&beleg=&kontakt=&betrag=&text=…]
 * Filter leben in Modulvariablen (F) und überleben App.rerender().
 */
(() => {
  'use strict';
  const { D, esc, icon, fmt } = App;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const K = App.isMac ? { save: '⌘↩', neu: '⌘N' } : { save: 'Strg ↩', neu: 'Strg N' };
  const motion = () => App.settings.motion === 'full';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');
  /* Lade-Kringel für die Belegerkennung (kennt core.js nicht) */
  const SPIN = '<svg class="ic bu-spin" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5"/></svg>';
  const katIco = (k) => icon(k && k.icon && App.ICONS[k.icon] ? k.icon : 'list');

  /* ================= Hilfsfunktionen ================= */
  const TYPEN = [['alle', 'Alle'], ['einnahme', 'Einnahmen'], ['ausgabe', 'Ausgaben']];
  const ZA = D.ZAHLUNGSARTEN;
  const zaOf = (id) => D.zahlungsart(id); // Altwerte ('karte', 'privat') zählen als Überweisung
  const istZa = (id) => ZA.some((z) => z.id === id);
  const KATS = (typ) => D.KATEGORIEN.filter((k) => k.typ === typ);
  const katOf = (id) => D.kat(id) || { id, name: id || '—', farbe: 'var(--muted)', abziehbar: 100, typ: 'ausgabe' };
  const typName = (typ) => (typ === 'einnahme' ? 'Einnahme' : 'Ausgabe');
  const rechnungOf = (b) => (b && b.rechnung ? D.rechnungen.find((r) => r.id === b.rechnung) : null);
  /* Zahlungen zu einer ausgestellten Quittung/Rechnung sind festgeschrieben → nur Storno (GoBD) */
  const gesperrt = (b) => { const r = rechnungOf(b); return !!(r && r.nr); };
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const plural = (n, eins, viele) => `${fmt.num(n)} ${n === 1 ? eins : viele}`;
  const fehltBeleg = (b) => !b.beleg;
  /* abziehbarer Teil einer Ausgabe (ohne Privatanteil, ggf. nur anteilig abziehbar) – wie App.summen */
  const abz = (b) => (b.typ === 'ausgabe' ? Math.round(b.betrag * (1 - (b.privat || 0) / 100) * ((katOf(b.kat).abziehbar ?? 100) / 100)) : 0);
  const moneyStr = (cent) => (cent == null || !isFinite(cent) ? '' : fmt.num(cent / 100, 2));
  const sizeStr = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${fmt.num(n / 1024)} KB` : `${fmt.num(n / 1048576, 1)} MB`);
  const countBy = (list, fn) => list.reduce((m, b) => { const k = fn(b); m[k] = (m[k] || 0) + 1; return m; }, {});
  const DF_LANG = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const datumLang = (iso) => DF_LANG.format(D.util.parse(iso));
  /* neueste zuerst; am selben Tag die zuletzt erfasste oben (laufende Nr.) */
  const neuesteZuerst = (a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : String(b.nr).localeCompare(String(a.nr)));
  function hl(text, q) {
    text = String(text ?? '');
    if (!q) return esc(text);
    const i = norm(text).indexOf(q);
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }
  /* Betrag lesen: „12,5“ · „12.50“ · „1.234,56“ · „1,234.56“ · „47,83 €“ → Cent (null = leer, NaN = unlesbar)
   * Tausender nur in Dreiergruppen, höchstens zwei Nachkommastellen – „1,2,3“, „1.23,45“ oder „1,234“ sind Tippfehler, keine Beträge. */
  function parseMoney(raw) {
    const s = String(raw ?? '').replace(/[\s €+]/g, '');
    if (!s) return null;
    if (!/^(\d[\d.,]*|[.,]\d+)$/.test(s)) return NaN;
    const iC = s.lastIndexOf(','), iD = s.lastIndexOf('.');
    let dec = -1;
    if (iC >= 0 && iD >= 0) dec = Math.max(iC, iD); // beide Zeichen → das hintere trennt die Cent ab
    else if (iC >= 0) dec = s.indexOf(',') === iC ? iC : -1; // nur Komma (einmal) → Dezimalkomma
    else if (iD >= 0) dec = s.indexOf('.') === iD && s.length - iD - 1 !== 3 ? iD : -1; // „12.50“ dezimal, „1.234“ Tausender
    const head = dec >= 0 ? s.slice(0, dec) : s, tail = dec >= 0 ? s.slice(dec + 1) : '';
    if (/[.,]/.test(head) && !/^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.test(head)) return NaN;
    if (/[.,]/.test(tail) || tail.length > 2) return NaN;
    const v = Number((head.replace(/[.,]/g, '') || '0') + '.' + (tail || '0'));
    return isFinite(v) ? Math.round(v * 100) : NaN;
  }
  /* zuletzt benutzte Kategorie eines Typs (neueste manuelle Buchung) */
  function lastKat(typ) {
    for (let i = D.buchungen.length - 1; i >= 0; i--) { const b = D.buchungen[i]; if (b.typ === typ && !b.wiederkehrend && !b.rechnung) return b.kat; }
    return (KATS(typ)[0] || {}).id;
  }
  /* Kategorie über Stichworte erraten (data.js: KATEGORIEN[].stichworte) */
  function katAusText(text, typ) {
    const n = norm(text);
    if (n.length < 3) return null;
    const k = KATS(typ).find((x) => (x.stichworte || []).some((w) => w && n.includes(norm(w))));
    return k ? k.id : null;
  }
  /* Kunden hängen an ihrer festen Nummer, nicht am Namen: das Feld „Kunde“ zeigt „Name · K-0012“ (App.kundenLabel),
   * aufgelöst wird über App.kundeAusEingabe (core.js) – gleiche Namen fragt die Schublade nach (siehe werHint). */
  const kundeLabel = (k) => App.kundenLabel(k);
  const adresseVon = (k) => (k ? [k.zusatz, k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join('\n') : '');
  /* neuer Kunde aus Name (+ Anschrift „Straße\nPLZ Ort“ vom Beleg) – erscheint danach unter „Kunden“ */
  function neuerKunde(name, adresse = '') {
    const z = String(adresse).split('\n').map((s) => s.trim()).filter(Boolean);
    const m = z.length ? z[z.length - 1].match(/^(\d{4,5})\s+(.+)$/) : null;
    const ortZ = m ? z.pop() : '';
    return { id: 'k' + Date.now().toString(36), art: 'kunde', name, zusatz: z.length > 1 ? z.slice(0, -1).join(', ') : '', strasse: z.length ? z[z.length - 1] : '',
      plz: m ? m[1] : '', ort: m ? m[2] : ortZ, email: '', telefon: '', notiz: '' };
  }
  /* übliche Kategorie eines Gegenübers: Kunde (über seine ID) bzw. Geschäft (über den Namen) */
  function haeufigsteKat(wer, typ, kunde = null) {
    const n = norm(String(wer ?? '').trim());
    if (!n) return null;
    const ko = typ === 'einnahme' ? kunde : null, c = {};
    D.buchungen.forEach((b) => {
      if (b.typ !== typ) return;
      if (ko ? b.kontakt === ko.id : norm(String(b.lieferant || '').trim()) === n) c[b.kat] = (c[b.kat] || 0) + 1;
    });
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || null;
  }
  /* bisherige Geschäfte (Freitext an Ausgaben), häufigste zuerst → [{ name, n, kat }] */
  function geschaefte() {
    const m = new Map();
    D.buchungen.forEach((b) => {
      const name = b.typ === 'ausgabe' && String(b.lieferant || '').trim();
      if (!name) return;
      const key = norm(name), x = m.get(key) || { name, n: 0, kats: {} };
      x.n++; x.kats[b.kat] = (x.kats[b.kat] || 0) + 1;
      m.set(key, x);
    });
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'de'))
      .map((x) => ({ name: x.name, n: x.n, kat: Object.keys(x.kats).sort((a, b) => x.kats[b] - x.kats[a])[0] }));
  }
  /* je Kunde: wie oft (bezahlte Aufträge + offene Rechnungen) und wann zuletzt → Map(id → { n, last }) */
  function kundenStats() {
    const m = new Map();
    const add = (id, datum) => { if (!id) return; const x = m.get(id) || { n: 0, last: '' }; x.n++; if (datum > x.last) x.last = datum; m.set(id, x); };
    D.buchungen.forEach((b) => { if (b.typ === 'einnahme') add(b.kontakt, b.datum); });
    D.rechnungen.forEach((r) => { if (r.art === 'rechnung' && r.status === 'offen') add(r.kontakt, r.leistung || r.datum); });
    return m;
  }

  /* ================= Zustand (überlebt App.rerender) ================= */
  const F = { typ: 'alle', q: '', kats: new Set(), za: 'alle', ohneBeleg: false };
  const nAdvanced = () => F.kats.size + (F.za !== 'alle' ? 1 : 0) + (F.ohneBeleg ? 1 : 0);
  const filterAktiv = () => F.typ !== 'alle' || !!F.q.trim() || nAdvanced() > 0;
  let V = null; // Elemente der aktuell gerenderten Seite
  let flashId = null; // nach dem Speichern kurz hervorheben
  const FILES = new Map(); // Buchung-ID → File (Vorschau innerhalb der Sitzung)

  /* Suchtext: Text, Nr., Beleg-Nr., Kunde/Geschäft, Kategorie, Zahlungsweg, Betrag (deutsch & mit Punkt), Belegdatei */
  function hay(b) {
    const re = rechnungOf(b);
    return norm([b.nr, b.text, b.belegnr || '', re ? re.nr : '', D.gegenueber(b), katOf(b.kat).name, zaOf(b.zahlungsart).kurz,
      fmt.num(b.betrag / 100, 2), (b.betrag / 100).toFixed(2), b.beleg || ''].join(' '));
  }

  /* ================= Seite ================= */
  function render(el, route) {
    const P = route.params || {};
    if (P.zw === 'alle' || istZa(P.zw)) F.za = P.zw;
    const p = App.period();
    el.innerHTML = `<div class="page bu-page">
      <div class="page-head bu-head reveal" style="--i:0">
        <div class="bu-head-titel"><h1>${icon('swap')}Ein- &amp; Ausgänge</h1>
          <p class="page-sub">Alle geschäftlichen Zahlungen · es zählt das Zahlungsdatum</p></div>
        <div class="bu-head-zeit">${App.periodHTML()}</div>
        <div class="bu-head-neu"><button type="button" class="btn-primary head-add" data-action="erfassen" title="Einnahme oder Ausgabe erfassen (${K.neu})" aria-label="Erfassen">${icon('plus')}<span>Erfassen</span></button></div>
      </div>
      <div class="sticky-bar bu-bar reveal" style="--i:1">
        <div class="bu-bar-top">
          ${App.seg('local', 'bu-typ', TYPEN.map(([v, l]) => [v, `${l}<span class="cnt">0</span>`]), F.typ, 'tabs')}
          <label class="bu-search">${icon('search')}<input type="search" class="input sm" data-bu="q" value="${esc(F.q)}" placeholder="Suchen …" aria-label="Einnahmen und Ausgaben durchsuchen (Text, Beleg-Nr., Name, Betrag)" autocomplete="off" spellcheck="false"></label>
          <span class="spacer"></span>
          <button type="button" class="bu-ob-link" data-bu="ob" hidden>${icon('alert')}<span></span></button>
          <div class="bu-filter">
            <button type="button" class="btn subtle bu-filter-btn" data-bu="filter" aria-expanded="false" aria-haspopup="dialog">${icon('filter')}Filter<span class="bu-badge" hidden>0</span></button>
            <div class="bu-pop" role="dialog" aria-label="Weitere Filter" hidden>
              <div class="bu-pop-sec"><h4>Kategorie</h4><div class="bu-pop-kats"></div></div>
              <div class="bu-pop-sec"><h4>Zahlungsweg</h4><div class="chips bu-pop-za">
                <button type="button" class="chip" data-za="alle">Alle</button>${ZA.map((z) => `<button type="button" class="chip" data-za="${esc(z.id)}">${icon(z.icon)}${esc(z.kurz)}</button>`).join('')}</div></div>
              <div class="bu-pop-sec"><label class="toggle-row bu-pop-ob"><span>Nur ohne Beleg<small class="bu-pop-obn"></small></span>
                <span class="switch"><input type="checkbox" data-bu="ob-sw"><span></span></span></label></div>
              <div class="bu-pop-foot"><button type="button" class="link" data-bu="reset-adv">${icon('reset')}Zurücksetzen</button><button type="button" class="btn subtle" data-bu="pop-close">Fertig</button></div>
            </div>
          </div>
        </div>
        <div class="bu-active" hidden></div>
      </div>
      <div class="card bu-card reveal" style="--i:2">
        <div class="table-wrap">
          <table class="fin-table bu-table">
            <thead><tr>
              <th class="l bu-c-dat">Datum</th><th class="l bu-c-bnr">Beleg-Nr.</th><th class="l">Beschreibung</th>
              <th class="l bu-c-kat">Kategorie</th><th class="l bu-c-zw">Zahlungsweg</th><th class="bu-c-amt">Betrag</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <p class="bu-foot" hidden></p>
      </div>
    </div>`;

    const root = el.firstElementChild;
    V = { root, p, bar: $('.bu-bar', root), pop: $('.bu-pop', root), active: $('.bu-active', root), tbody: $('.bu-table tbody', root), foot: $('.bu-foot', root), obLink: $('.bu-ob-link', root), katSig: '' };
    update();

    /* Höhe der Filterleiste → klebriger Tabellenkopf sitzt direkt darunter */
    const ro = new ResizeObserver(() => { if (V) root.style.setProperty('--bu-bar-h', V.bar.offsetHeight + 'px'); });
    ro.observe(V.bar);

    /* ---------- Ereignisse der Seite (am Seitenelement → verschwinden beim nächsten Rendern) ---------- */
    let tq = 0; // Suche kurz entprellen
    root.addEventListener('seg-change', (e) => {
      if (e.detail.key !== 'bu-typ') return;
      F.typ = e.detail.value;
      if (F.typ !== 'alle') F.kats.forEach((id) => { if (katOf(id).typ !== F.typ) F.kats.delete(id); });
      update();
    });
    root.addEventListener('input', (e) => {
      if (e.target.dataset.bu !== 'q') return;
      F.q = e.target.value; clearTimeout(tq); tq = setTimeout(update, 90);
    });
    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.bu === 'ob-sw') { F.ohneBeleg = t.checked; update(); }
      else if (t.dataset.popKat) { if (t.checked) F.kats.add(t.dataset.popKat); else F.kats.delete(t.dataset.popKat); update(); }
    });
    root.addEventListener('click', (e) => {
      const t = e.target;
      const za = t.closest('[data-za]');
      if (za) { F.za = za.dataset.za; update(); return; }
      const x = t.closest('[data-x]');
      if (x) { removeFilter(x.dataset.x); return; }
      const a = t.closest('[data-bu]'), act = a && a.dataset.bu;
      if (act === 'filter') { togglePop(); return; }
      if (act === 'pop-close') { togglePop(false); return; }
      if (act === 'reset-adv') { F.kats.clear(); F.za = 'alle'; F.ohneBeleg = false; update(); return; }
      if (act === 'ob') { F.ohneBeleg = !F.ohneBeleg; update(); return; }
      if (act === 'reset-empty') { resetFilter(); return; }
      const tr = t.closest('tr.row');
      if (!tr) return;
      const b = D.buchungen.find((y) => y.id === tr.dataset.id);
      if (act === 'row-del') { if (b) loeschen(b); return; }
      if (act === 'row-edit' || !t.closest('a, button, .bu-lock')) { if (b) openDrawer(b); }
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.target.dataset.bu === 'q' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; F.q = ''; update(); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.row')) { e.preventDefault(); openById(e.target.dataset.id); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && e.target.matches('tr.row')) { const b = D.buchungen.find((y) => y.id === e.target.dataset.id); if (b && !gesperrt(b)) { e.preventDefault(); loeschen(b); } }
    });
    /* Filter-Popover: Klick daneben oder Esc schließt */
    const outside = (e) => { if (V && !V.pop.hidden && !e.target.closest('.bu-filter')) togglePop(false); };
    const esc2 = (e) => { if (e.key === 'Escape' && V && !V.pop.hidden) { togglePop(false); $('[data-bu="filter"]', V.bar).focus(); } };
    document.addEventListener('click', outside);
    document.addEventListener('keydown', esc2);

    /* Datei aufs Fenster gezogen → Schublade mit Beleg (oder an die offene Schublade anhängen) */
    App.dropTarget = (files) => {
      const f = files && files[0];
      if (!f) return;
      if (cur && cur.root.isConnected) attachFile(cur, f);
      else openDrawer(null, { file: f });
    };

    /* Parameter aus der Adresse einmalig auswerten, danach Adresse bereinigen */
    let handled = !!P.zw;
    if (P.drop) { const files = App.pendingFiles; App.pendingFiles = null; if (files && files.length) openDrawer(null, { file: files[0] }); handled = true; }
    else if (P.neu) { openDrawer(null, prefill(P)); handled = true; }
    else if (P.b) {
      const b = D.buchungen.find((x) => x.id === P.b);
      if (b) { openDrawer(b); $(`tr.row[data-id="${CSS.escape(b.id)}"]`, root)?.scrollIntoView({ block: 'center' }); }
      else App.toast('Diesen Eintrag gibt es nicht (mehr).', { icon: 'alert' });
      handled = true;
    }
    if (handled) history.replaceState(null, '', '#/buchungen');
    if (cur && cur.b && !P.b) markSelected(cur.b.id);

    /* Gespeicherte Zeile kurz hervorheben */
    if (flashId) {
      const tr = $(`tr.row[data-id="${CSS.escape(flashId)}"]`, root);
      flashId = null;
      if (tr) {
        tr.classList.add('bu-flash');
        setTimeout(() => tr.classList.remove('bu-flash'), 2200);
        const r = tr.getBoundingClientRect();
        if (r.top < 160 || r.bottom > innerHeight - 20) tr.scrollIntoView({ block: 'center', behavior: motion() ? 'smooth' : 'auto' });
      }
    }
    return () => { ro.disconnect(); clearTimeout(tq); document.removeEventListener('click', outside); document.removeEventListener('keydown', esc2); V = null; };
  }

  /* Vorgaben aus App.erfassen bzw. der Adresse (?neu=1&…) säubern */
  function prefill(P = {}) {
    const o = {};
    if (P.typ === 'einnahme' || P.typ === 'ausgabe') o.typ = P.typ;
    if (P.beleg === 'quittung' || P.beleg === 'rechnung') { o.beleg = P.beleg; o.typ = 'einnahme'; }
    if (P.kontakt && D.kontakt(P.kontakt)) { o.kontakt = P.kontakt; o.typ = 'einnahme'; } // Kontakte sind immer Kunden
    if (P.betrag && +P.betrag > 0) o.betrag = Math.round(+P.betrag);
    if (/^\d{4}-\d\d-\d\d$/.test(P.datum || '')) o.datum = P.datum;
    if (P.text) o.text = String(P.text);
    if (P.kat && D.kat(P.kat)) { o.kat = P.kat; o.typ = o.typ || D.kat(P.kat).typ; }
    if (P.kunde) o.kunde = String(P.kunde);
    if (P.lieferant) o.lieferant = String(P.lieferant);
    if (P.belegnr) o.belegnr = String(P.belegnr);
    if (istZa(P.zahlungsart || P.zw)) o.zahlungsart = P.zahlungsart || P.zw;
    if (P.vorlage) o.vorlage = String(P.vorlage);
    if (P.file) o.file = P.file;
    // Termin (Seite „Termine“ → „Quittung ausstellen“): Kunde, Leistung, Betrag vom Termin; sein vorbereiteter Entwurf zählt mit
    const t = P.termin ? (D.TERMINE || []).find((x) => x.id === P.termin) : null;
    const eId = P.entwurf || (t && t.beleg);
    const e = eId ? D.rechnungen.find((x) => x.id === eId && !x.nr && x.status === 'entwurf') : null;
    if (e) { // vorbereiteter Beleg ohne Nummer → wird beim Speichern ausgestellt (Art umschaltbar)
      o.entwurf = e.id; o.typ = 'einnahme';
      if (!o.beleg) o.beleg = ART.includes(e.art) ? e.art : 'quittung';
      if (!o.kontakt && e.kontakt && D.kontakt(e.kontakt)) o.kontakt = e.kontakt;
      if (!o.kontakt && !o.kunde && e.kunde) o.kunde = e.kunde;
      if (!o.betrag) o.betrag = D.rechnungSumme(e);
      if (!o.text && e.betreff) o.text = e.betreff;
      if (!o.vorlage && e.vorlage) o.vorlage = e.vorlage;
      if (e.kundeAdresse) o.adresse = e.kundeAdresse;
      if ((e.positionen || []).length === 1) o.leistung = e.positionen[0].text;
    }
    const tt = t || (e && e.termin ? (D.TERMINE || []).find((x) => x.id === e.termin) : null);
    if (tt) {
      o.termin = tt.id; o.typ = 'einnahme';
      if (!o.kontakt && tt.kontakt && D.kontakt(tt.kontakt)) o.kontakt = tt.kontakt;
      if (!o.kontakt && !o.kunde && tt.kunde) o.kunde = tt.kunde;
      if (!o.betrag && tt.betrag > 0) o.betrag = tt.betrag;
      if (!o.text && tt.leistung) o.text = tt.leistung;
      if (!o.adresse && tt.adresse) o.adresse = tt.adresse;
    }
    return o;
  }

  function togglePop(force) {
    if (!V) return;
    const open = force ?? V.pop.hidden;
    V.pop.hidden = !open;
    $('[data-bu="filter"]', V.bar).setAttribute('aria-expanded', String(open));
    if (open) requestAnimationFrame(() => $('input, button', V.pop)?.focus({ preventScroll: true }));
  }
  function removeFilter(x) {
    if (x === 'all') { F.kats.clear(); F.za = 'alle'; F.ohneBeleg = false; F.q = ''; if (V) $('[data-bu="q"]', V.bar).value = ''; }
    else if (x.startsWith('kat:')) F.kats.delete(x.slice(4));
    else if (x === 'za') F.za = 'alle';
    else if (x === 'ob') F.ohneBeleg = false;
    else if (x === 'q') { F.q = ''; if (V) $('[data-bu="q"]', V.bar).value = ''; }
    update();
  }
  function resetFilter() {
    Object.assign(F, { typ: 'alle', q: '', za: 'alle', ohneBeleg: false });
    F.kats.clear();
    if (!V) return;
    $$('.seg[data-key="bu-typ"] button', V.bar).forEach((b) => { const on = b.dataset.value === 'alle'; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    $('[data-bu="q"]', V.bar).value = '';
    update();
  }

  /* ================= Aktualisieren: Filter und Tabelle ================= */
  function update() {
    if (!V) return;
    const p = V.p;
    const inP = D.buchungen.filter((b) => b.datum >= p.von && b.datum <= p.bis);
    const qn = norm(F.q.trim());
    const base = qn ? inP.filter((b) => hay(b).includes(qn)) : inP;
    const pass = (b, skip) => (skip === 'typ' || F.typ === 'alle' || b.typ === F.typ)
      && (skip === 'kat' || !F.kats.size || F.kats.has(b.kat))
      && (skip === 'za' || F.za === 'alle' || zaOf(b.zahlungsart).id === F.za)
      && (skip === 'ob' || !F.ohneBeleg || fehltBeleg(b));
    const list = base.filter((b) => pass(b, ''));

    /* Tabs mit Anzahl */
    const tc = countBy(base.filter((b) => pass(b, 'typ')), (b) => b.typ);
    $$('.seg[data-key="bu-typ"] button', V.bar).forEach((btn) => {
      const v = btn.dataset.value;
      $('.cnt', btn).textContent = fmt.num(v === 'alle' ? (tc.einnahme || 0) + (tc.ausgabe || 0) : tc[v] || 0);
    });
    App.updateSegs(V.bar);

    /* Filter-Popover: Kategorien (passend zum Typ) mit Anzahl, Zahlungsweg, ohne Beleg */
    const kats = D.KATEGORIEN.filter((k) => F.typ === 'alle' || k.typ === F.typ || F.kats.has(k.id));
    const kc = countBy(base.filter((b) => pass(b, 'kat')), (b) => b.kat);
    const sig = kats.map((k) => k.id).join(',');
    const box = $('.bu-pop-kats', V.pop);
    if (sig !== V.katSig) {
      V.katSig = sig;
      box.innerHTML = kats.map((k) => `<label class="bu-check"><input type="checkbox" data-pop-kat="${esc(k.id)}"><i class="dot" style="background:${esc(k.farbe)}"></i><span>${esc(k.name)}</span><small class="num"></small></label>`).join('');
    }
    $$('[data-pop-kat]', box).forEach((c) => {
      const id = c.dataset.popKat, n = kc[id] || 0;
      c.checked = F.kats.has(id);
      c.closest('.bu-check').classList.toggle('zero', !n && !c.checked);
      $('small', c.closest('.bu-check')).textContent = fmt.num(n);
    });
    $$('[data-za]', V.pop).forEach((c) => c.classList.toggle('on', c.dataset.za === F.za));
    const nOb = base.filter((b) => pass(b, 'ob') && fehltBeleg(b)).length;
    $('[data-bu="ob-sw"]', V.pop).checked = F.ohneBeleg;
    $('.bu-pop-obn', V.pop).textContent = plural(nOb, 'Eintrag', 'Einträge');
    const na = nAdvanced(), badge = $('.bu-badge', V.bar);
    badge.hidden = !na; badge.textContent = na;
    $('[data-bu="filter"]', V.bar).classList.toggle('on', na > 0);

    /* Aktive Filter als entfernbare Chips (zweite Zeile nur bei Bedarf) */
    const chips = [];
    if (F.q.trim()) chips.push(`<button type="button" class="chip on" data-x="q">${icon('search')}„${esc(F.q.trim())}“${icon('x')}</button>`);
    F.kats.forEach((id) => { const k = katOf(id); chips.push(`<button type="button" class="chip on" data-x="kat:${esc(id)}"><i class="dot" style="background:${esc(k.farbe)}"></i>${esc(k.name)}${icon('x')}</button>`); });
    if (F.za !== 'alle') { const z = zaOf(F.za); chips.push(`<button type="button" class="chip on" data-x="za">${icon(z.icon)}${esc(z.kurz)}${icon('x')}</button>`); }
    if (F.ohneBeleg) chips.push(`<button type="button" class="chip on" data-x="ob">${icon('alert')}ohne Beleg${icon('x')}</button>`);
    V.active.innerHTML = chips.length ? `<span class="bu-active-l">Gefiltert:</span>${chips.join('')}${chips.length > 1 ? '<button type="button" class="link" data-x="all">alle entfernen</button>' : ''}` : '';
    V.active.hidden = !chips.length;

    /* Hinweis „X ohne Beleg“ (schaltet den Filter) */
    V.obLink.hidden = !nOb && !F.ohneBeleg;
    V.obLink.classList.toggle('on', F.ohneBeleg);
    $('span', V.obLink).textContent = F.ohneBeleg ? 'Nur ohne Beleg · aufheben' : `${fmt.num(nOb)} ohne Beleg`;

    /* Tabelle: neueste zuerst; darunter nur eine dezente Zeile mit der Anzahl */
    list.sort(neuesteZuerst);
    V.tbody.innerHTML = list.length ? rowsHTML(list, qn) : emptyHTML(inP.length === 0, p);
    V.foot.hidden = !list.length;
    V.foot.textContent = `${plural(list.length, 'Eintrag', 'Einträge')}${filterAktiv() && list.length !== inP.length ? ` von ${fmt.num(inP.length)}` : ''} · ${p.label} · neueste zuerst`;
    if (cur && cur.b) markSelected(cur.b.id);
  }

  /* ---------- Tabellenzeilen (Monatsüberschrift nur, wenn mehrere Monate sichtbar sind) ---------- */
  function rowsHTML(list, qn) {
    const nProM = countBy(list, (b) => b.datum.slice(0, 7)), mehrere = Object.keys(nProM).length > 1;
    let html = '', curM = '';
    list.forEach((b) => {
      const m = b.datum.slice(0, 7);
      if (mehrere && m !== curM) {
        curM = m;
        html += `<tr class="grp"><td colspan="6" class="l"><span class="bu-grp-l"><span class="bu-grp-m">${esc(fmt.monat(m))}</span><span class="bu-grp-n">${plural(nProM[m], 'Eintrag', 'Einträge')}</span></span></td></tr>`;
      }
      html += rowHTML(b, qn);
    });
    return html;
  }

  function rowHTML(b, qn) {
    const k = katOf(b.kat), re = rechnungOf(b), wer = D.gegenueber(b), lock = gesperrt(b), z = zaOf(b.zahlungsart);
    let text = b.text || '';
    if (wer && text.endsWith(' · ' + wer)) text = text.slice(0, -(wer.length + 3)); // Name steht in der zweiten Zeile
    // Beleg-Nr.: eigene Belege als Link-Chip, sonst Nummer des Geschäfts; Büroklammer bzw. „fehlt“
    const nr = b.belegnr || (re && re.nr) || '';
    let bnr = nr ? (re && re.nr ? `<a class="bu-nr-chip" href="#/beleg/${esc(re.id)}" title="${re.art === 'quittung' ? 'Quittung' : 'Rechnung'} öffnen">${hl(nr, qn)}</a>` : `<span class="bu-nr" title="${esc(nr)}">${hl(nr, qn)}</span>`) : '';
    if (fehltBeleg(b)) bnr += `<span class="badge warn bu-missing" data-tip="Für diesen Eintrag fehlt noch der Beleg. ${b.typ === 'einnahme' ? 'Datei anhängen oder Quittung bzw. Rechnung erstellen.' : 'Datei anhängen oder Eigenbeleg erstellen.'}">fehlt</span>`;
    else if (b.beleg) bnr += `<span class="bu-clip" data-tip="${esc(b.beleg)}" data-tip-title="Belegdatei">${icon('clip')}</span>`;
    if (!bnr) bnr = '<span class="bu-dash">–</span>';
    // Betrag: Einnahme +, Ausgabe − (farbig); anteilig abziehbare Ausgaben mit Hinweis
    let amt;
    if (b.typ === 'einnahme') amt = `<span class="bu-amt ein">${fmt.eur(b.betrag, { sign: true })}</span>`;
    else {
      const a = abz(b);
      amt = a !== b.betrag ? `<span class="bu-amt aus bu-abz" data-tip="${esc(`Davon abziehbar: ${fmt.eur(a)}${b.privat ? ` (${b.privat} % privat)` : ''}`)}">${fmt.eur(-b.betrag)}</span>` : `<span class="bu-amt aus">${fmt.eur(-b.betrag)}</span>`;
    }
    const acts = `<span class="bu-acts"><button type="button" class="icon-btn sm" data-bu="row-edit" data-tip="Bearbeiten" aria-label="Bearbeiten">${icon('edit')}</button>${lock
      ? `<span class="icon-btn sm bu-lock" tabindex="0" data-tip="Gehört zu ${esc(re.nr)} und ist festgeschrieben. Ändern nur per Storno des Belegs (GoBD)." data-tip-title="Festgeschrieben">${icon('lock')}</span>`
      : `<button type="button" class="icon-btn sm bu-del" data-bu="row-del" data-tip="Löschen" aria-label="Löschen">${icon('trash')}</button>`}</span>`;
    return `<tr class="row bu-${b.typ}" data-id="${esc(b.id)}" tabindex="0">
      <td class="l bu-dat" title="${esc(datumLang(b.datum))} · Nr. ${esc(b.nr)}">${fmt.datumKurz(b.datum)}</td>
      <td class="l"><span class="bu-bnr">${bnr}</span></td>
      <td class="l"><div class="cell-main"><div class="t"><b>${hl(text, qn)}</b>${wer ? `<small>${hl(wer, qn)}</small>` : ''}</div></div></td>
      <td class="l"><span class="cat-tag"><i style="background:${esc(k.farbe)}"></i><span class="bu-kat-n">${hl(k.name, qn)}</span></span>${b.typ === 'ausgabe' && b.privat ? `<span class="pill bu-pill">${b.privat} % privat</span>` : ''}</td>
      <td class="l"><span class="bu-zw-c" title="${esc(z.text)}">${icon(z.icon)}<span>${hl(z.kurz, qn)}</span></span></td>
      <td class="num bu-amt-td"><div class="bu-amt-w">${acts}${amt}</div></td>
    </tr>`;
  }

  function emptyHTML(keineImZeitraum, p) {
    return `<tr class="bu-empty"><td colspan="6"><div class="empty">${icon(keineImZeitraum ? 'calendar' : 'filter')}
      <b>${keineImZeitraum ? `Noch keine Einnahmen oder Ausgaben in ${esc(p.label)}` : 'Kein Eintrag passt zu diesem Filter'}</b>
      ${keineImZeitraum
        ? `<span>Neue Zahlungen erfasst du oben rechts mit <span class="bu-erf">${icon('plus')}Erfassen</span> (${K.neu}) –<br>oder zieh einen Beleg als PDF einfach aufs Fenster, Betrag und Datum werden erkannt.</span>`
        : `<span>Filter lockern oder zurücksetzen.</span><div class="row"><button type="button" class="btn ghost" data-bu="reset-empty">${icon('reset')}Filter zurücksetzen</button></div>`}
      </div></td></tr>`;
  }

  function markSelected(id) {
    $$('.bu-table tr.row.selected').forEach((tr) => tr.classList.remove('selected'));
    if (id) $(`.bu-table tr.row[data-id="${CSS.escape(id)}"]`)?.classList.add('selected');
  }
  function openById(id) {
    const b = D.buchungen.find((x) => x.id === id);
    if (b) openDrawer(b); else App.toast('Diesen Eintrag gibt es nicht (mehr).', { icon: 'alert' });
  }

  /* ================= Löschen (sofort, mit Rückgängig; Belegzahlungen nur per Storno) ================= */
  function loeschen(b) {
    if (gesperrt(b)) { App.toast('Festgeschrieben – nur per Storno des Belegs änderbar.', { icon: 'lock' }); return; }
    const idx = D.buchungen.indexOf(b);
    if (idx < 0) return;
    D.buchungen.splice(idx, 1);
    App.save();
    if (cur && cur.b === b) App.drawer.close();
    App.rerender();
    const kurz = b.text.length > 34 ? b.text.slice(0, 33) + '…' : b.text;
    App.toast(`Gelöscht · ${kurz}`, { icon: 'trash', action: { label: 'Rückgängig', fn: () => { D.buchungen.splice(Math.min(idx, D.buchungen.length), 0, b); App.save(); if (App.route.id === 'buchungen') flashId = b.id; App.rerender(); } } });
  }

  /* ================= Schublade: Ein- oder Ausgabe erfassen / bearbeiten ================= */
  let cur = null; // Zustand der offenen Schublade

  /* Zahlungsweg-Vorschlag: Quittung meist bar, Rechnung (und alles andere) per Überweisung/Karte */
  const zaStandard = (typ, ew, art) => (typ === 'einnahme' && ew === 'beleg' && art === 'quittung' ? 'bar' : 'bank');
  const ART = ['quittung', 'rechnung'];

  function makeState(b, o = {}) {
    const typ = b ? b.typ : o.typ === 'einnahme' ? 'einnahme' : 'ausgabe';
    const kat = b ? b.kat : o.kat && katOf(o.kat).typ === typ ? o.kat : lastKat(typ);
    const re = b ? rechnungOf(b) : null;
    const ko = !b && o.kontakt ? D.kontakt(o.kontakt) : null;
    // bestehende Einnahme: ihr Kunde (über die ID) – festgeschriebene zeigen den Namen aus dem Beleg
    const bKo = b && b.typ === 'einnahme' && !gesperrt(b) && b.kontakt ? D.kontakt(b.kontakt) : null;
    // Beleg zur Einnahme: 'beleg' (eigenen Beleg erstellen, Art siehe art) · 'offen' (offene Rechnung zuordnen) · 'ohne' (Datei/fremder Beleg)
    const ew = b ? (re ? null : 'ohne') : o.beleg ? 'beleg' : o.file ? 'ohne' : 'beleg';
    // Art des eigenen Belegs: Vorgabe des Aufrufers, sonst Einstellung „Beleg bei Einnahmen“
    const art = ART.includes(o.beleg) ? o.beleg : ART.includes(App.settings.belegArt) ? App.settings.belegArt : 'quittung';
    // Termin bzw. vorbereiteter Entwurf (nur beim Neu-Erfassen): wird beim Speichern abgehakt bzw. ausgestellt
    const termin = !b && o.termin ? (D.TERMINE || []).find((x) => x.id === o.termin) || null : null;
    const entwurf = !b && o.entwurf ? D.rechnungen.find((x) => x.id === o.entwurf) || null : null;
    return {
      b, typ, ew, art, lock: !!b && gesperrt(b), termin, entwurf,
      // gebundener Kunde (ID) bzw. bewusst „Neuer Kunde mit diesem Namen“ (norm. Name) – siehe kundeAufloesen
      kid: (ko || bKo || {}).id || null, kneu: null, kAuto: null,
      // Quittung und Eigenbeleg drucken die Zahlungsart – bei ausgestellten bleibt sie wie auf dem Blatt (GoBD)
      zaFest: !!b && gesperrt(b) && ['quittung', 'eigenbeleg'].includes(re.art) ? re : null,
      za: b ? zaOf(b.zahlungsart).id : istZa(o.zahlungsart) ? o.zahlungsart : zaStandard(typ, ew, art),
      v: b
        ? { betrag: b.betrag, datum: b.datum, text: b.text, kat: b.kat, wer: bKo ? kundeLabel(bKo) : D.gegenueber(b), privat: b.privat || 0, belegnr: b.belegnr || (re ? re.nr : '') }
        : { betrag: o.betrag ?? null, datum: o.datum || D.TODAY, text: o.text || '', kat, wer: ko ? kundeLabel(ko) : (typ === 'einnahme' ? o.kunde : o.lieferant) || '', privat: 0, belegnr: o.belegnr || '' },
      beleg: b ? b.beleg : null, // Dateiname eines bereits abgelegten Belegs
      file: (b && FILES.get(b.id)) || null, url: null,
      // vom Aufrufer gesetzte Felder überschreibt die Belegerkennung nicht
      touched: new Set(Object.keys(o).map((k) => (['kontakt', 'kunde', 'lieferant'].includes(k) ? 'wer' : k === 'zahlungsart' ? 'za' : k))
        .filter((k) => ['betrag', 'datum', 'text', 'kat', 'wer', 'za', 'belegnr'].includes(k))),
      sugg: {}, recog: null, token: 0, root: null, ks: kundenStats(),
      d: { adresse: o.adresse ?? adresseVon(ko), auto: !!ko && o.adresse == null, leistung: o.leistung || '', vorlage: o.vorlage || '' },
      dstatus: termin || entwurf ? 'offen' : 'bezahlt', // nach einem Termin zahlt der Kunde eine Rechnung meist später
      offenId: null
    };
  }
  /* Belegart, die beim Speichern einer Einnahme neu erstellt wird (oder null) */
  const docArt = (st) => (st.typ === 'einnahme' && !(st.b && st.b.rechnung) && st.ew === 'beleg' ? st.art : null);
  const rechnungOffen = (st) => docArt(st) === 'rechnung' && st.dstatus === 'offen' && !st.b;
  const zuordnen = (st) => st.typ === 'einnahme' && st.ew === 'offen' && !st.b;

  function openDrawer(b, o = {}) {
    const st = makeState(b, o);
    const box = {};
    App.drawer.open({
      id: 'buchung', width: 520, icon: b ? 'edit' : 'swap',
      title: drawerTitle(st), sub: drawerSub(st), body: bodyHTML(st), foot: drawerFoot(st),
      onMount: (root) => { box.root = root; root.classList.add('bu-drawer'); bindDrawer(root); mount(root, st, o.file); },
      onClose: () => { if (cur && cur.root === box.root) { revoke(cur); cur = null; } markSelected(null); }
    });
  }

  function mount(root, st, file) {
    st.root = root;
    cur = st;
    // festgeschrieben: Ein-/Ausgabe nicht umschaltbar – auch nicht per Tastatur (pointer-events allein sperrt nur die Maus)
    if (st.lock) $$('.seg[data-key="bf-typ"] button', root).forEach((b) => { b.disabled = true; });
    if (st.zaFest) $$('.bu-zw-opt[data-zw]', root).forEach((b) => { b.disabled = true; });
    sync(st);
    renderBeleg(st);
    renderRecog(st);
    markSelected(st.b ? st.b.id : null);
    requestAnimationFrame(() => App.updateSegs(root));
    if (file) attachFile(st, file);
    setTimeout(() => { if (cur === st && !st.lock) { const el = fld(root, 'betrag'); el.focus({ preventScroll: true }); if (st.b) el.select(); } }, motion() ? 260 : 30);
  }

  const drawerTitle = (st) => `${typName(st.typ)} ${st.b ? 'bearbeiten' : 'erfassen'}`;
  const drawerSub = (st) => (st.b
    ? `Nr. ${esc(st.b.nr)}${st.lock ? ' · festgeschrieben' : ''}`
    : `Nr. ${esc(App.nextBuchungNr((st.root && val(st.root, 'datum')) || st.v.datum || D.TODAY))} · wird beim Speichern vergeben`);
  const TIP_DATUM = 'Für die EÜR zählt der Tag, an dem das Geld geflossen ist (Zufluss-/Abflussprinzip, § 11 EStG) – nicht das Rechnungsdatum.';
  const werLabel = (typ) => (typ === 'einnahme' ? 'Kunde' : 'Geschäft / Lieferant');
  const werPlatzhalter = (typ) => (typ === 'einnahme' ? 'Name – aus deinen Kunden oder neu' : 'z. B. Aral Tankstelle, Bauhaus …');

  function katTilesHTML(typ, sel) {
    return KATS(typ).map((k) => `<button type="button" class="bu-tile${k.id === sel ? ' on' : ''}" data-kat-tile="${esc(k.id)}" role="radio" aria-checked="${k.id === sel}" style="--c:${esc(k.farbe)}">
      <i class="bu-tile-ic">${katIco(k)}</i><b>${esc(k.name)}</b>${k.text ? `<small>${esc(k.text)}</small>` : ''}</button>`).join('');
  }

  function bodyHTML(st) {
    const v = st.v, re = st.b ? rechnungOf(st.b) : null, ro = st.lock ? ' readonly' : '';
    const tipNr = 'Eigene Quittungen und Rechnungen haben eine laufende Nummer (QU-/RE-…). Bei Ausgaben die Rechnungs- oder Bonnummer des Geschäfts.';
    return `
      <div class="bu-recog-slot"></div>
      ${st.termin || st.entwurf ? '<div class="bu-link bu-termin" role="note"></div>' : ''}
      ${re ? `<div class="bu-link${st.lock ? ' lock' : ''}">${icon(st.lock ? 'lock' : re.art === 'quittung' ? 'receipt' : 'invoice')}<span>Zahlung zu <b>${esc(re.nr || 'Entwurf')}</b> · ${esc(re.betreff)}${st.lock ? '<small>Festgeschrieben: Betrag, Datum und Kunde kommen aus dem Beleg, ändern nur per Storno (GoBD).</small>' : ''}</span><a class="link" href="#/beleg/${esc(re.id)}">Öffnen${icon('arrow')}</a></div>` : ''}
      <section class="bu-sec-betrag">
        ${App.seg('local', 'bf-typ', [['ausgabe', `${icon('minus')}Ausgabe`], ['einnahme', `${icon('plus')}Einnahme`]], st.typ, `full${st.lock ? ' bu-locked' : ''}`)}
        <div class="field">
          <label class="field-label" for="bf-betrag">Betrag</label>
          <div class="input-wrap"><input id="bf-betrag" name="betrag" class="input money-input" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0,00" value="${moneyStr(v.betrag)}"${ro}><span class="suffix">€</span></div>
          <p class="hint bu-betrag-hint" aria-live="polite"></p>
        </div>
        <div class="field bu-kat-field">
          <label class="field-label" for="bf-kat">Kategorie</label>
          <input type="hidden" id="bf-kat" name="kat" value="${esc(v.kat)}">
          <div class="bu-tiles bu-kat-tiles" role="radiogroup" aria-label="Kategorie">${katTilesHTML(st.typ, v.kat)}</div>
          <p class="hint bu-kat-hint"></p>
        </div>
      </section>
      <section>
        <h3>Angaben</h3>
        <div class="form-grid">
          <div class="field bu-datum-field"><label class="field-label" for="bf-datum"><span class="bu-datum-l">Zahlungsdatum</span><button type="button" class="q" data-tip="${esc(TIP_DATUM)}" data-tip-title="Zahlungsdatum" tabindex="-1">?</button></label>
            <input id="bf-datum" name="datum" type="date" class="input" value="${esc(v.datum)}" required${ro}></div>
          <div class="field bu-belegnr-field"><label class="field-label" for="bf-belegnr">Beleg-Nr.<button type="button" class="q" data-tip="${esc(tipNr)}" data-tip-title="Beleg-Nr." tabindex="-1">?</button></label>
            <input id="bf-belegnr" name="belegnr" class="input bu-nr-in" autocomplete="off" spellcheck="false" placeholder="z. B. Bon 4711" value="${esc(v.belegnr || '')}"${ro}></div>
          <p class="hint full bu-datum-hint" hidden></p>
          <div class="field full"><label class="field-label" for="bf-text">Beschreibung</label>
            <input id="bf-text" name="text" class="input" autocomplete="off" placeholder="Wofür? z. B. Diesel für den Transporter" value="${esc(v.text)}"></div>
          <div class="field full bu-wer-field"><label class="field-label" for="bf-wer"><span class="bu-wer-l">${werLabel(st.typ)}</span><small class="muted bu-wer-opt">optional</small></label>
            <input id="bf-wer" name="wer" class="input" list="bf-wer-list" autocomplete="off" placeholder="${esc(werPlatzhalter(st.typ))}" value="${esc(v.wer || '')}"${ro}>
            <datalist id="bf-wer-list">${werOptions(st)}</datalist>
            <p class="hint bu-wer-hint" hidden></p></div>
        </div>
        <details class="bu-more"${+v.privat ? ' open' : ''}><summary>Mehr Optionen${icon('chevD')}</summary>
          <div class="bu-more-body"><div class="field"><label class="field-label" for="bf-privat">Privatanteil</label>
            <div class="input-wrap"><input id="bf-privat" name="privat" type="number" min="0" max="100" step="5" class="input num" value="${+v.privat || 0}"><span class="suffix">%</span></div></div>
            <p class="hint">Nur wenn etwas auch privat genutzt wird (z. B. Handy zu 30 % privat) – dann zählt nur der Rest als Ausgabe.</p></div></details>
      </section>
      <section class="bu-sec-zw">
        <h3>Bezahlt per</h3>
        <div class="bu-zw" role="radiogroup" aria-label="Bezahlt per">${ZA.map((z) =>
          `<button type="button" class="bu-zw-opt" data-zw="${esc(z.id)}" role="radio" aria-checked="false">${icon(z.icon)}<b>${esc(z.name)}</b>${z.text && z.text !== z.name ? `<small>${esc(z.text)}</small>` : ''}</button>`).join('')}</div>
        <p class="hint bu-za-hint" hidden></p>
      </section>
      <section class="bu-sec-beleg">
        <h3 class="bu-beleg-h">Beleg</h3>
        <div class="bu-ew-slot"></div>
        <div class="bu-beleg-slot"></div>
        <input type="file" class="bu-file-in" accept="application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.heic" hidden>
      </section>`;
  }

  function drawerFoot(st) {
    return `${st.b ? (st.lock
      ? `<span class="bu-foot-lock" data-tip="Zahlungen zu ausgestellten Quittungen und Rechnungen sind festgeschrieben. Korrektur nur per Storno des Belegs (GoBD).">${icon('lock')}festgeschrieben</span>`
      : `<button type="button" class="btn danger" data-bu="delete" title="Löschen (mit Rückgängig) – in der App gibt es nur Storno (GoBD)">${icon('trash')}Löschen</button>`) : ''}
      <span class="spacer"></span>
      <button type="button" class="btn ghost" data-action="close-drawer">Abbrechen</button>
      ${st.b ? '' : `<button type="button" class="btn subtle" data-bu="save-new" title="Speichern und direkt den nächsten Eintrag erfassen (⇧${K.save})">Speichern &amp; neu</button>`}
      <button type="button" class="btn-primary sm" data-bu="save" title="Speichern (${K.save})">${icon('check')}Speichern<kbd>${K.save}</kbd></button>`;
  }

  /* Namensvorschläge: Kunden als „Name · K-0012“ (zuletzt besuchte zuerst, App.kundenOptionen) bzw. bisherige Geschäfte (häufigste zuerst) */
  function werOptions(st) {
    if (st.typ === 'ausgabe') return geschaefte().map((g) => `<option value="${esc(g.name)}">${fmt.num(g.n)}× · ${esc(katOf(g.kat).name)}</option>`).join('');
    const last = (k) => (st.ks.get(k.id) || {}).last || '';
    return App.kundenOptionen((a, b) => (last(a) < last(b) ? 1 : last(a) > last(b) ? -1 : a.name.localeCompare(b.name, 'de')));
  }
  /* Kunde aus dem Feld: gebunden über die Nummer im Label („Name · K-0012“), eindeutiger Name, mehrdeutig (liste) oder neu.
   * bewusst = „Neuer Kunde mit diesem Namen“ gewählt (st.kneu). Setzt st.kid – beim Speichern wird nicht erneut über den Namen gesucht. */
  function kundeAufloesen(st) {
    const txt = val(st.root, 'wer');
    const r = st.typ === 'einnahme' ? App.kundeAusEingabe(txt) : { k: null, liste: [], neu: false, name: '' };
    const mitNr = /\bK-\d{3,}\b/i.test(txt);
    // bewusst neu: auch bei genau einem Namenstreffer („Andere Person?“) – eine Nummer im Feld bindet dagegen immer
    const bewusst = !!r.name && st.kneu === norm(r.name) && !(r.k && mitNr);
    const k = bewusst ? null : r.k;
    st.kid = k ? k.id : null;
    // perName: nur über den bloßen Namen gebunden (getippt; beim Verlassen zum Label gemacht → st.kAuto)
    return { ...r, k, bewusst, neu: r.neu || bewusst, perName: !!k && (!mitNr || st.kAuto === k.id) };
  }

  /* ---------- Formular-Helfer ---------- */
  const fld = (r, name) => r.querySelector(`[name="${name}"]`);
  const val = (r, name) => { const el = fld(r, name); return el ? el.value : ''; };
  const markEl = (r, name) => (name === 'kat' ? $('.bu-kat-tiles', r) : fld(r, name)); // sichtbares Element eines Feldes
  function setSeg(r, key, value) {
    const s = $(`.seg[data-key="${key}"]`, r);
    if (!s) return;
    $$('button', s).forEach((b) => { const on = b.dataset.value === value; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    App.updateSegs(s.parentElement);
  }
  function setZw(st, value) {
    st.za = value;
    // nur die „Bezahlt per“-Kacheln – die Beleg-Kacheln (.bu-ew) tragen dieselbe Klasse und behalten ihre Auswahl
    $$('.bu-zw-opt[data-zw]', st.root).forEach((b) => { const on = b.dataset.zw === value; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  }
  function setKat(st, id) {
    const r = st.root;
    fld(r, 'kat').value = id;
    $$('.bu-tile', r).forEach((t) => { const on = t.dataset.katTile === id; t.classList.toggle('on', on); t.setAttribute('aria-checked', String(on)); t.tabIndex = on ? 0 : -1; });
    sync(st);
  }
  function setErr(r, name, msg) {
    const el = markEl(r, name);
    if (!el) return;
    const field = el.closest('.field');
    el.classList.toggle('invalid', !!msg);
    let p = $('.bu-err', field);
    if (!msg) { if (p) p.remove(); return; }
    if (!p) { p = document.createElement('p'); p.className = 'hint neg bu-err'; p.setAttribute('role', 'alert'); field.appendChild(p); }
    p.textContent = msg;
  }
  /* Vorschlag aus der Belegerkennung markieren / entfernen */
  function suggest(st, name, herkunft, sicherheit) {
    const r = st.root, el = markEl(r, name), lab = $(`label[for="bf-${name}"]`, r);
    if (!el || !lab) return;
    el.classList.add('suggested');
    $('.sugg-tag', lab)?.remove();
    const low = sicherheit === 'niedrig';
    lab.insertAdjacentHTML('beforeend', `<span class="sugg-tag${low ? ' low' : ''}" title="${low ? 'Unsicher erkannt – bitte prüfen' : 'Automatisch erkannt – bitte kurz prüfen'}">${icon('sparkle')}${herkunft === 'dateiname' ? 'aus Dateiname' : 'aus PDF'}</span>`);
    st.sugg[name] = true;
  }
  function unSuggest(st, name) {
    if (!st.sugg[name]) return;
    const r = st.root;
    markEl(r, name)?.classList.remove('suggested');
    $(`label[for="bf-${name}"] .sugg-tag`, r)?.remove();
    delete st.sugg[name];
  }

  /* Abhängige Felder & Hinweise je nach Typ, Kategorie, Beleg, Betrag */
  function sync(st) {
    const r = st.root, typ = st.typ, k = katOf(val(r, 'kat')), isAus = typ === 'ausgabe';
    const doc = docArt(st), zu = zuordnen(st), offen = rechnungOffen(st);
    $('.bu-more', r).hidden = !isAus;
    $('.bu-kat-field', r).hidden = KATS(typ).length < 2; // nur eine Einnahme-Kategorie → keine Auswahl nötig
    // Einnahme mit eigenem Beleg: Nummer kommt aus dem Beleg; offene Rechnung zuordnen: auch der Kunde
    $('.bu-wer-field', r).hidden = zu;
    $('.bu-belegnr-field', r).hidden = !!doc || zu;
    $('.bu-datum-field', r).classList.toggle('full', !!doc || zu);
    $('.bu-datum-l', r).textContent = offen ? 'Rechnungsdatum' : 'Zahlungsdatum';
    Object.assign($('.bu-datum-field .q', r).dataset, offen
      ? { tip: 'Datum der Rechnung. Die Einnahme wird erst erfasst, wenn das Geld eingeht – dann zählt der Zahlungstag (§ 11 EStG).', tipTitle: 'Rechnungsdatum' }
      : { tip: TIP_DATUM, tipTitle: 'Zahlungsdatum' });
    $('.bu-sec-zw', r).hidden = offen; // noch nicht bezahlt
    $('.bu-wer-l', r).textContent = werLabel(typ);
    $('.bu-wer-opt', r).textContent = doc === 'rechnung' ? 'für die Rechnung nötig' : 'optional';
    fld(r, 'wer').placeholder = werPlatzhalter(typ);
    fld(r, 'text').placeholder = isAus ? 'Wofür? z. B. Diesel für den Transporter' : 'Wofür? z. B. Rasen mähen, Hecke schneiden';
    setZw(st, st.za);
    // Kategorie-Hinweis (EÜR-Zuordnung)
    const bits = [];
    if (k.euer) bits.push(`EÜR: ${esc(k.euer)}`);
    if (k.wareneingang) bits.push('erscheint im Wareneingangsbuch');
    if (k.abziehbar < 100) bits.push(`nur ${k.abziehbar} % abziehbar`);
    const kh = $('.bu-kat-hint', r); kh.innerHTML = bits.join(' · '); kh.hidden = !bits.length;
    // Zahlungsweg-Hinweis (nur bar: Einzelaufzeichnung)
    const zp = $('.bu-za-hint', r), zh = st.zaFest ? `Steht so auf ${st.zaFest.art === 'quittung' ? 'der Quittung' : 'dem Eigenbeleg'} ${st.zaFest.nr} – ändern nur per Storno.`
      : st.za === 'bar' && !doc ? 'Bargeld einzeln und zeitnah festhalten (§ 146 AO) – Bon bzw. Quittung aufheben.' : '';
    zp.textContent = zh; zp.hidden = !zh;
    // Datum-Hinweis
    const datum = val(r, 'datum'), p = App.period(), dp = $('.bu-datum-hint', r);
    let dh = '';
    if (st.abbu && datum === st.abbu.ab) dh = `${icon('calendar')}Rechnungsdatum ${fmt.datum(st.abbu.rechnung)} · ${datum > D.TODAY ? `wird am ${fmt.datum(datum)} abgebucht` : `abgebucht am ${fmt.datum(datum)}`} – für die EÜR zählt die Abbuchung`;
    else if (datum && datum > D.TODAY) dh =`${icon('clock')}Liegt in der Zukunft – erfasst wird, wenn das Geld tatsächlich fließt.`;
    else if (datum && (datum < p.von || datum > p.bis) && App.route.id === 'buchungen') dh = `${icon('calendar')}Liegt außerhalb von ${esc(p.label)} – der Eintrag erscheint deshalb nicht in der aktuellen Liste.`;
    dp.innerHTML = dh; dp.hidden = !dh;
    const sub = !st.b && $('.drawer-head h2 small', r); if (sub) sub.innerHTML = drawerSub(st); // Nr. folgt dem Jahr des Datums
    syncDoc(st); // Beleg zur Einnahme: Nummer, Vorlagen, Status, Hinweise
    // Betrag-Hinweis
    const cent = parseMoney(val(r, 'betrag'));
    let bh = '';
    if (isAus && cent > 0) {
      const pr = Math.min(100, Math.max(0, +val(r, 'privat') || 0));
      const a = Math.round(cent * (1 - pr / 100) * ((k.abziehbar ?? 100) / 100));
      if (a !== cent) bh = `Als Betriebsausgabe zählen <b class="num">${fmt.eur(a)}</b>${pr ? ` (${fmt.num(pr)} % privat)` : ''}`;
    } else if (typ === 'einnahme' && k.ku) bh = 'Zählt zum Kleinunternehmer-Umsatz (§ 19 UStG) · ohne Umsatzsteuer';
    const bp = $('.bu-betrag-hint', r); bp.innerHTML = bh; bp.hidden = !bh;
    belegHint(st);
    werHint(st);
    terminHint(st);
  }

  /* Hinweiszeile oben bei Termin / vorbereitetem Beleg, z. B. „Vorbereitete Quittung zum Termin am Mo, 12.10. · 08:00 – wird jetzt mit Nummer ausgestellt“ */
  const WT = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
  const terminWann = (t) => `${WT.format(D.util.parse(t.datum)).replace('.', '')}, ${fmt.datumKurz(t.datum)}${t.von ? ` · ${t.von}` : ''}`;
  function terminHint(st) {
    const el = $('.bu-termin', st.root);
    if (!el) return;
    const t = st.termin, e = st.entwurf && !st.entwurf.nr ? st.entwurf : null;
    const wann = t ? ` zum Termin am <b>${esc(terminWann(t))}</b>` : '', artN = st.art === 'rechnung' ? 'Rechnung' : 'Quittung';
    // Termin + „Offene Rechnung zuordnen“ bzw. „Ohne eigenen Beleg“: Entwurf wird verworfen, Termin mit der Rechnung bzw. ohne Beleg abgeschlossen
    const ausstellen = st.ew === 'beleg', abschluss = !t ? '' : st.ew === 'offen' ? 'mit der zugeordneten Rechnung abgeschlossen' : st.ew === 'ohne' ? 'ohne Beleg abgeschlossen' : '';
    const eArt = e && e.art === 'rechnung' ? 'Rechnung' : 'Quittung';
    const h = e ? (ausstellen ? `Vorbereitete ${artN}${wann} – wird jetzt mit Nummer ausgestellt`
      : abschluss ? `Vorbereitete ${eArt}${wann} wird verworfen – der Termin wird ${abschluss}`
        : `Vorbereiteter Beleg${wann} bleibt Entwurf${t ? ' · Termin wird als erledigt abgehakt' : ''}`)
      : abschluss ? `Termin am <b>${esc(terminWann(t))}</b> – wird beim Speichern ${abschluss}`
        : `Termin am <b>${esc(terminWann(t))}</b> – wird beim Speichern als erledigt abgehakt`;
    el.innerHTML = `${icon('calendar')}<span>${h}</span>`;
    el.hidden = st.typ !== 'einnahme';
  }

  /* Unter „Kunde“: bekannter Kunde (Nummer, Ort, wie oft, wann zuletzt), Nachfrage bei gleichen Namen oder Hinweis „neu“ */
  function werHint(st) {
    const r = st.root, el = $('.bu-wer-hint', r), name = val(r, 'wer').trim();
    let h = '', wahl = false;
    const kw = kundeAufloesen(st);
    if (st.typ === 'einnahme' && name && !st.lock) {
      const s = kw.k && st.ks.get(kw.k.id);
      if (kw.k) h = `${icon('user')}Bekannter Kunde · ${esc([D.kundenNr(kw.k), kw.k.ort].filter(Boolean).join(' · '))} · ${s ? `${plural(s.n, 'Auftrag', 'Aufträge')} · zuletzt ${fmt.datum(s.last)}` : 'noch ohne Auftrag'}`
        + (kw.perName ? ` <button type="button" class="link bu-kalt" data-kwahl="neu">Andere Person? Als neuen Kunden anlegen</button>` : '');
      else if (kw.liste.length > 1 && !kw.bewusst) {
        wahl = true;
        const knopf = (k) => { const x = st.ks.get(k.id); return `<button type="button" class="bu-kwahl-btn" data-kwahl="${esc(k.id)}"><b class="mono">${esc(D.kundenNr(k))}</b>${esc(App.kundenOrt(k) || 'ohne Adresse')} · ${x ? `zuletzt ${x.last.slice(5, 7)}/${x.last.slice(0, 4)}` : 'noch ohne Auftrag'}</button>`; };
        h = `<span>${icon('users')}Mehrere Kunden heißen „${esc(kw.name)}“ – wer ist gemeint?</span><span class="bu-kwahl">${kw.liste.map(knopf).join('')}<button type="button" class="bu-kwahl-btn neu" data-kwahl="neu">${icon('plus')}Neuer Kunde mit diesem Namen</button></span>`;
      } else {
        h = `${icon('plus')}Neuer Kunde${kw.bewusst ? ` „${esc(kw.name)}“ mit eigener Nummer` : ''} – wird beim Speichern unter „Kunden“ angelegt.`;
        // zurück: genau ein Namensvetter → „Doch K-0012 nehmen“, mehrere → wieder auswählen
        if (kw.bewusst && kw.liste.length === 1) h += ` <button type="button" class="link bu-kalt" data-kwahl="${esc(kw.liste[0].id)}">Doch ${esc(D.kundenNr(kw.liste[0]))} nehmen</button>`;
        else if (kw.bewusst && kw.liste.length > 1) h += ` <button type="button" class="link bu-kalt" data-kwahl="wahl">Doch einen der bestehenden wählen</button>`;
      }
    }
    el.innerHTML = h; el.hidden = !h; el.classList.toggle('bu-wahl', wahl);
  }
  /* Anschrift für Quittung/Rechnung aus dem Kunden übernehmen (solange nicht selbst geändert) */
  function adresseVorschlagen(st) {
    if (st.typ !== 'einnahme' || (st.d.adresse.trim() && !st.d.auto)) return;
    const ko = kundeAufloesen(st).k;
    st.d.adresse = adresseVon(ko); st.d.auto = !!ko;
    const ad = fld(st.root, 'dadresse'); if (ad) ad.value = st.d.adresse;
  }

  function setTyp(st, typ) {
    const r = st.root;
    if (typ !== 'einnahme' && st.offenId) offenLoesen(st);
    // Ausgabe: das Geschäft ist Freitext – Kundennummer aus dem Feld nehmen
    if (typ === 'ausgabe' && st.kid) { const k = D.kontakt(st.kid), w = fld(r, 'wer'); if (k && w.value.trim() === kundeLabel(k)) w.value = k.name; }
    st.typ = typ;
    setSeg(r, 'bf-typ', typ);
    const now = val(r, 'kat'), keep = katOf(now).typ === typ, neu = keep ? now : lastKat(typ);
    $('.bu-kat-tiles', r).innerHTML = katTilesHTML(typ, neu);
    if (!keep) unSuggest(st, 'kat');
    $('#bf-wer-list', r).innerHTML = werOptions(st);
    const h = $('.drawer-head h2 > span', r); if (h && h.firstChild) h.firstChild.textContent = drawerTitle(st);
    if (typ === 'einnahme' && st.file && !st.b) st.ew = 'ohne'; // Datei liegt schon vor → fremder Beleg
    if (!st.touched.has('za') && !st.b) st.za = zaStandard(typ, st.ew, st.art);
    adresseVorschlagen(st);
    setKat(st, neu);
    renderBeleg(st);
    sync(st);
  }

  /* ---------- Beleg ---------- */
  function revoke(st) { if (st && st.url) { URL.revokeObjectURL(st.url); st.url = null; } }

  /* Beleg-Bereich: Ausgaben → Datei mit Erkennung; Einnahmen → „Beleg zur Einnahme“ (erstellen, zuordnen oder Datei) */
  const EW = [['beleg', null, 'Beleg erstellen'], ['offen', 'clock', 'Offene Rechnung zuordnen'], ['ohne', 'upload', 'Ohne eigenen Beleg']];
  const artIcon = (art) => (art === 'rechnung' ? 'invoice' : 'receipt');
  const naechsteNr = (art, datum) => D.naechsteNr(art, +String(datum || D.TODAY).slice(0, 4));

  function renderBeleg(st) {
    const r = st.root, slot = $('.bu-beleg-slot', r), ewSlot = $('.bu-ew-slot', r), re = st.b ? rechnungOf(st.b) : null;
    $('.bu-beleg-h', r).textContent = st.typ === 'einnahme' ? 'Beleg zur Einnahme' : 'Beleg';
    if (re) { ewSlot.innerHTML = ''; slot.innerHTML = scanHTML(st, `Zum Beleg ${re.nr || ''} gehört kein Scan? Unterschriebenes Exemplar hier ablegen.`); return; }
    if (st.typ !== 'einnahme') { ewSlot.innerHTML = ''; fileArea(st, slot); return; }
    const nOffen = App.offeneRechnungen().length;
    const sub = { beleg: naechsteNr(st.art, val(r, 'datum')), offen: nOffen ? `${nOffen} offen` : 'keine offen', ohne: 'Datei anhängen' };
    ewSlot.innerHTML = `<div class="bu-ew" role="radiogroup" aria-label="Beleg zur Einnahme">${EW.filter(([id]) => !(st.b && id === 'offen')).map(([id, ic, label]) =>
      `<button type="button" class="bu-zw-opt${st.ew === id ? ' on' : ''}" data-ew="${id}" role="radio" aria-checked="${st.ew === id}" tabindex="${st.ew === id ? 0 : -1}">${icon(ic || artIcon(st.art))}<b>${label}</b><small class="${id === 'beleg' ? 'mono' : ''}">${esc(sub[id])}</small></button>`).join('')}</div>`;
    if (st.ew === 'beleg') slot.innerHTML = docPanelHTML(st);
    else if (st.ew === 'offen') slot.innerHTML = offenHTML(st);
    else fileArea(st, slot);
    syncDoc(st);
    App.updateSegs(slot);
  }

  /* Eigener Beleg: EIN Weg mit Art [Quittung | Rechnung] (Vorauswahl aus den Einstellungen), Nummer, Vorlage, bei Rechnung
   * Status [bereits bezahlt | noch offen], Anschrift, Leistung; optional unterschriebenes Exemplar. Der Kunde steht oben unter „Angaben“.
   * Was von der Art abhängt, hält syncDoc() aktuell – der Umschalter wird dafür nicht neu gebaut (Fokus bleibt). */
  const TIP_ART = 'Quittung: bestätigt, dass bezahlt wurde – deine Quittung enthält zugleich alle Rechnungsangaben. Rechnung: fordert zur Zahlung auf, der Kunde zahlt später (oder überweist gleich).';
  function docPanelHTML(st) {
    const text = val(st.root, 'text').trim();
    return `<div class="bu-doc">
      <div class="bu-doc-head">
        ${App.seg('local', 'bf-art', ART.map((a) => [a, `${icon(artIcon(a))}${a === 'quittung' ? 'Quittung' : 'Rechnung'}`]), st.art, 'bu-art')}
        <button type="button" class="q" data-tip="${esc(TIP_ART)}" data-tip-title="Quittung oder Rechnung?" tabindex="-1">?</button>
        <span class="spacer"></span>
        <span class="bu-doc-nr"><small>erhält Nr.</small><b></b></span></div>
      <p class="hint bu-art-hint" hidden></p>
      <div class="form-grid">
        <div class="field bu-vorlage-field"><label class="field-label" for="bf-vorlage">Vorlage</label>
          <select id="bf-vorlage" name="vorlage" class="select"></select></div>
        ${st.b ? '' : `<div class="field bu-dstatus-field"><span class="field-label">Status</span>${App.seg('local', 'bf-dstatus', [['bezahlt', 'bereits bezahlt'], ['offen', 'noch offen']], st.dstatus, 'full')}</div>`}
        <div class="field full"><label class="field-label" for="bf-dadresse">Anschrift des Kunden<small class="muted bu-adr-opt"></small></label>
          <textarea id="bf-dadresse" name="dadresse" class="textarea" rows="2" placeholder="Straße Nr.&#10;PLZ Ort">${esc(st.d.adresse)}</textarea></div>
        <div class="field full"><label class="field-label" for="bf-dleistung">Leistung<small class="muted">steht auf dem Beleg</small></label>
          <input id="bf-dleistung" name="dleistung" class="input" autocomplete="off" placeholder="${esc(text || 'wie Beschreibung')}" value="${esc(st.d.leistung)}"></div>
      </div>
      <p class="hint bu-doc-hint"></p>
      ${scanHTML(st)}
    </div>`;
  }

  /* Alles, was von Art, Status, Datum und Zahlungsweg abhängt: Kachel, Nummer, Vorlagen, Status, Hinweise (§ 35a EStG) */
  function syncDoc(st) {
    const r = st.root, art = st.art, nr = naechsteNr(art, val(r, 'datum'));
    const tile = $('.bu-ew [data-ew="beleg"]', r);
    if (tile) { $('.ic', tile).outerHTML = icon(artIcon(art)); $('small', tile).textContent = nr; }
    const box = st.ew === 'beleg' && $('.bu-doc', r);
    if (!box) return;
    const rech = art === 'rechnung', offen = rechnungOffen(st);
    $('.bu-doc-nr b', box).textContent = nr;
    const sel = fld(r, 'vorlage');
    if (sel.dataset.art !== art) { // Vorlagen der gewählten Art
      const vorl = [{ id: '', name: rech ? 'Standard-Rechnung' : 'Standard-Quittung' }].concat((D.VORLAGEN || []).filter((v) => v.art === art));
      if (!vorl.some((v) => v.id === st.d.vorlage)) st.d.vorlage = '';
      sel.innerHTML = vorl.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('');
      sel.value = st.d.vorlage; sel.dataset.art = art;
    }
    const sf = $('.bu-dstatus-field', box);
    if (sf) { const zeigen = rech && sf.hidden; sf.hidden = !rech; if (zeigen) App.updateSegs(sf); }
    $('.bu-vorlage-field', box).classList.toggle('full', !rech || !sf);
    $('.bu-adr-opt', box).textContent = rech ? 'aus „Kunde“ oder neu' : 'optional';
    $('.bu-doc-hint', box).innerHTML = offen
      ? 'Die Rechnung wird gespeichert und erscheint unter „Rechnungen &amp; Quittungen“ als offen. Erfasst wird die Einnahme erst, wenn das Geld eingeht.'
      : `Wird beim Speichern mit dieser Nummer erstellt und mit der Einnahme verknüpft – Betrag und Datum wie oben.`;
    // Haushaltsnahe Dienstleistung (§ 35a EStG): absetzbar nur mit Rechnung und unbarer Zahlung
    const h = offen || st.za !== 'bar' ? ''
      : rech ? 'Für § 35a muss der Kunde unbar zahlen (Überweisung oder Karte).'
        : 'Will der Kunde die Arbeitskosten von der Steuer absetzen (§ 35a EStG)? Dann Rechnung wählen – absetzbar nur bei unbarer Zahlung (Überweisung oder Karte).';
    const ah = $('.bu-art-hint', box);
    ah.innerHTML = h ? `${icon('info')}${h}` : ''; ah.hidden = !h;
  }

  /* Schritt 2 (optional): unterschriebenes Exemplar / Scan zum eigenen Beleg */
  function scanHTML(st, hinweis = '') {
    const f = st.file, name = f ? f.name : st.b && st.b.rechnung && st.beleg && !/^(QU|RE)-.*\.pdf$/.test(st.beleg) ? st.beleg : '';
    return `<details class="bu-scan"${name ? ' open' : ''}><summary>${icon('clip')}Unterschriebenes Exemplar anhängen<small>(optional)</small></summary>
      <div class="bu-scan-body">${name
        ? `<div class="file-chip bu-file">${icon('file')}<b title="${esc(name)}">${esc(name)}</b>${f ? `<small class="muted">${sizeStr(f.size)}</small>` : '<small class="muted">abgelegt</small>'}
            <button type="button" class="icon-btn sm" data-bu="remove-file" title="Entfernen">${icon('x')}</button></div>`
        : `<div class="dropzone bu-dz" role="button" tabindex="0" data-bu="pick" aria-label="Scan auswählen oder hierher ziehen">${icon('upload')}<span>${esc(hinweis || 'Scan oder Foto der unterschriebenen Fassung hierher ziehen oder klicken')}</span></div>`}</div></details>`;
  }

  /* offene Rechnungen zur Auswahl */
  function offenHTML(st) {
    const list = App.offeneRechnungen();
    if (!list.length) return '<div class="bu-offen-empty">Keine offenen Rechnungen – alles bezahlt.</div>';
    return `<div class="bu-offen" role="radiogroup" aria-label="Offene Rechnung">${list.map((x) => {
      const n = D.util.diffDays(D.TODAY, x.faellig), on = st.offenId === x.id;
      return `<button type="button" class="bu-offen-opt${on ? ' on' : ''}" data-offen="${esc(x.id)}" role="radio" aria-checked="${on}">
        <span class="bu-nr-chip">${esc(x.nr)}</span><b>${esc(D.gegenueber(x))}</b><span class="num">${fmt.eur(D.rechnungSumme(x))}</span>
        <small>${esc(x.betreff)}</small><small class="${n < 0 ? 'neg-t' : ''}">${n < 0 ? `${-n} T. überfällig` : n === 0 ? 'fällig heute' : `fällig ${fmt.datumKurz(x.faellig)}`}</small></button>`;
    }).join('')}</div><p class="hint">Beim Speichern wird die Rechnung als bezahlt markiert und mit dieser Einnahme verknüpft.</p>`;
  }

  function waehleOffen(st, id) {
    const x = D.rechnungen.find((y) => y.id === id), r = st.root;
    if (!x) return;
    st.offenId = id;
    fld(r, 'betrag').value = moneyStr(D.rechnungSumme(x));
    fld(r, 'text').value = x.betreff;
    const xk = x.kontakt && D.kontakt(x.kontakt);
    fld(r, 'wer').value = xk ? kundeLabel(xk) : D.gegenueber(x);
    fld(r, 'belegnr').value = x.nr;
    if (x.kat && katOf(x.kat).typ === 'einnahme') setKat(st, x.kat);
    if (!st.touched.has('za')) st.za = 'bank';
    ['betrag', 'text'].forEach((n) => { unSuggest(st, n); setErr(r, n, ''); });
    $$('.bu-offen-opt', r).forEach((b) => { const on = b.dataset.offen === id; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    sync(st);
  }

  /* „Offene Rechnung zuordnen“ verlassen: deren Nummer gehört nicht an eine andere, unverknüpfte Einnahme (die Rechnung bleibt offen) */
  function offenLoesen(st) {
    const x = st.offenId && D.rechnungen.find((y) => y.id === st.offenId);
    if (x && val(st.root, 'belegnr').trim() === x.nr) fld(st.root, 'belegnr').value = '';
    st.offenId = null;
  }

  function fileArea(st, slot) {
    if (st.file) {
      const f = st.file, isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name), isImg = /^image\//.test(f.type);
      if (!st.url && (isPdf || isImg)) st.url = URL.createObjectURL(f);
      slot.innerHTML = `<div class="file-chip bu-file">${icon(isImg ? 'eye' : 'file')}<b title="${esc(f.name)}">${esc(f.name)}</b>
          <small class="muted">${sizeStr(f.size)} · ${isPdf ? 'PDF' : isImg ? 'Bild' : 'Datei'}</small>
          <button type="button" class="icon-btn sm" data-bu="pick" title="Anderen Beleg wählen">${icon('upload')}</button>
          <button type="button" class="icon-btn sm" data-bu="remove-file" title="Beleg entfernen">${icon('x')}</button></div>
        ${isPdf ? `<div class="bu-preview"><iframe src="${st.url}#toolbar=0&navpanes=0&view=FitH" title="Vorschau ${esc(f.name)}"></iframe></div>`
          : isImg ? `<div class="bu-preview img"><img src="${st.url}" alt="Vorschau ${esc(f.name)}"></div>` : ''}`;
    } else if (st.beleg) {
      slot.innerHTML = `<div class="file-chip bu-file">${icon('clip')}<b title="${esc(st.beleg)}">${esc(st.beleg)}</b>
          <small class="muted">abgelegt · unveränderbar</small>
          ${st.lock ? '' : `<button type="button" class="icon-btn sm" data-bu="pick" title="Beleg ersetzen">${icon('upload')}</button>
          <button type="button" class="icon-btn sm" data-bu="remove-file" title="Verknüpfung lösen">${icon('x')}</button>`}</div>`;
    } else {
      slot.innerHTML = `<div class="dropzone bu-dz" role="button" tabindex="0" data-bu="pick" aria-label="Beleg auswählen oder hierher ziehen">
          ${icon('upload')}<b>Beleg hierher ziehen</b><span>oder klicken zum Auswählen · PDF, JPG, PNG<br>Betrag, Datum und Geschäft werden erkannt</span></div>
        <div class="bu-nobeleg"><p class="hint warn">${icon('alert')}<span class="bu-nobeleg-t"></span></p>
          <div class="bu-nobeleg-links"><button type="button" class="link" data-bu="eigenbeleg">Kein Beleg? → Eigenbeleg erstellen</button></div></div>`;
    }
    belegHint(st);
  }

  function belegHint(st) {
    const box = $('.bu-nobeleg', st.root);
    if (!box) return;
    box.hidden = !!st.file || !!st.beleg;
    $('.bu-nobeleg-links', box).hidden = st.typ !== 'ausgabe'; // Eigenbeleg ersetzt nur fehlende Ausgabe-Belege
    $('.bu-nobeleg-t', box).textContent = st.typ === 'einnahme'
      ? 'Ohne eigenen Beleg, z. B. Auszahlung einer Plattform: Abrechnung oder Zahlungsnachweis hierher ziehen.'
      : 'Ohne Beleg fehlt der Nachweis fürs Finanzamt. Rechnung oder Kassenbon hierher ziehen.';
  }

  /* Scan zum eigenen Beleg (Quittung/Rechnung) → keine Erkennung nötig */
  const nurScan = (st) => !!docArt(st) || !!(st.b && st.b.rechnung);

  async function attachFile(st, file) {
    if (!file || !st.root) return;
    revoke(st);
    st.file = file; st.beleg = file.name;
    renderBeleg(st);
    if (nurScan(st)) { st.token++; st.recog = null; renderRecog(st); return; }
    const token = ++st.token, t0 = performance.now();
    st.recog = 'loading'; renderRecog(st);
    let res = null, fehler = false;
    try { if (window.Beleg && typeof window.Beleg.analyse === 'function') res = await window.Beleg.analyse(file); }
    catch (err) { console.warn('Belegerkennung fehlgeschlagen:', err); fehler = true; res = null; }
    if (motion()) await wait(Math.max(0, 450 - (performance.now() - t0))); // kurzer, ruhiger Ladezustand statt Flackern
    if (cur !== st || token !== st.token) return;
    if (!res || typeof res !== 'object' || !res.felder) res = fallbackAnalyse(file, fehler ? 'fehler' : window.Beleg ? 'leer' : 'fehlt');
    applyRecog(st, res);
  }

  /* Ersatz, falls js/beleg.js fehlt oder scheitert: nur den Dateinamen lesen (bekannte Geschäfte bzw. Kunden) */
  function fallbackAnalyse(file, grund) {
    const name = String(file.name || '').replace(/\.[a-z0-9]{2,5}$/i, '');
    const felder = {}, herkunft = {}, sicherheit = {};
    const set = (k, v, s = 'mittel') => { felder[k] = v; herkunft[k] = 'dateiname'; sicherheit[k] = s; };
    let rest = name, m;
    const okDate = (y, mo, d) => +mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31;
    if ((m = name.match(/(20\d\d)[-_.](\d{1,2})[-_.](\d{1,2})/)) && okDate(m[1], m[2], m[3])) { set('datum', `${m[1]}-${pad(m[2])}-${pad(m[3])}`); rest = rest.replace(m[0], ' '); }
    else if ((m = name.match(/(\d{1,2})\.(\d{1,2})\.(20\d\d)/)) && okDate(m[3], m[2], m[1])) { set('datum', `${m[3]}-${pad(m[2])}-${pad(m[1])}`); rest = rest.replace(m[0], ' '); }
    if ((m = rest.match(/(?:^|[^\d])(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[,.]\d{2})(?!\d)/))) { const c = parseMoney(m[1]); if (c > 0) set('betrag', c); }
    const n = norm(name.replace(/[_-]+/g, ' '));
    const STOP = /^(gmbh|deutschland|tankstelle|station|baumarkt|markt|service|versicherung|musterstadt)$/;
    const gs = geschaefte().find((g) => norm(g.name).split(/[^a-z0-9ß]+/).some((w) => w.length >= 3 && !STOP.test(w) && new RegExp(`(^|[^a-z0-9ß])${w}([^a-z0-9ß]|$)`).test(n)));
    const ko = !gs && D.KONTAKTE.find((k) => { const kn = norm(k.name); return kn.length >= 5 && n.includes(kn); });
    if (gs) { set('lieferant', gs.name); set('typ', 'ausgabe', 'niedrig'); }
    else if (ko) { set('lieferant', ko.name); set('kontakt', ko.id); set('typ', 'einnahme', 'niedrig'); }
    const typ = felder.typ || 'ausgabe';
    const kat = (gs && gs.kat) || (ko && haeufigsteKat(ko.name, 'einnahme', ko)) || katAusText(name.replace(/[_-]+/g, ' '), typ);
    if (kat) set('kategorie', kat, 'niedrig');
    const hinweise = [grund === 'fehlt' ? 'Belegerkennung nicht geladen – nur der Dateiname wurde ausgewertet.'
      : grund === 'fehler' ? 'Der Beleg ließ sich nicht lesen – nur der Dateiname wurde ausgewertet.'
        : 'Nur der Dateiname wurde ausgewertet – bitte prüfen.'];
    return { quelle: Object.keys(felder).length ? 'dateiname' : 'keine', text: '', felder, herkunft, sicherheit, hinweise };
  }

  /* Erkannten Namen einer Ausgabe mit den bisherigen Geschäften abgleichen (beleg.js kennt seit v4 keine Lieferanten-Kontakte):
   * „Aral“ → „Aral Tankstelle“; unsicher geratener Name → bekanntes Geschäft aus dem Briefkopf (oberste Zeile zuerst).
   * Dann auch dessen übliche Kategorie und der Name vorn in der Beschreibung. */
  const GESCH_STOP = /^(gmbh|ag|kg|co|und|der|die|das|filiale|deutschland|tankstelle|station|baumarkt|markt|service|versicherung|musterstadt|musterdorf)$/;
  const markant = (name) => norm(name).split(/[^a-z0-9ß]+/).filter((w) => w.length >= 3 && !GESCH_STOP.test(w));
  const enthaelt = (txt, g) => { const t = ` ${norm(txt).replace(/[^a-z0-9ß]+/g, ' ')} `, ws = markant(g.name); return ws.length > 0 && ws.every((w) => t.includes(` ${w} `)); };
  function geschaeftAbgleich(res, typ) {
    const f = res.felder || {}, sich = res.sicherheit || (res.sicherheit = {});
    if (f.kontakt || (f.typ || typ) !== 'ausgabe') return res;
    const gs = geschaefte(), alt = String(f.lieferant || '').trim();
    let g = alt ? gs.find((x) => norm(x.name) === norm(alt)) || gs.find((x) => enthaelt(alt, x)) : null;
    if (!g && sich.lieferant !== 'hoch' && res.text) {
      for (const zeile of String(res.text).split('\n').slice(0, 8)) { g = gs.find((x) => enthaelt(zeile, x)); if (g) break; }
    }
    if (!g) return res;
    if (g.name !== alt) {
      const vorn = String(f.text || '').split(' · ')[0];
      if (f.text && vorn && norm(alt).startsWith(norm(vorn))) f.text = g.name + String(f.text).slice(vorn.length);
      f.lieferant = g.name; sich.lieferant = 'mittel';
    }
    if (g.kat && (!f.kategorie || sich.kategorie !== 'hoch')) { f.kategorie = g.kat; sich.kategorie = 'mittel'; }
    return res;
  }
  /* Zahlungsweg aus dem Belegtext – nur Zeilen mit Betrag („Bar 60,00“, „Kartenzahlung girocard 78,95“, „PayPal 12,00“) */
  function zahlungswegAusText(text) {
    for (const z of String(text || '').split('\n')) {
      if (!/\d,\d\d/.test(z)) continue;
      if (/\b(bar|bargeld|barzahlung|gegeben)\b/i.test(z)) return 'bar';
      if (/paypal/i.test(z)) return 'paypal';
      if (/girocard|ec-?karte|kartenzahlung|visa|mastercard|maestro|überweis|lastschrift/i.test(z)) return 'bank';
    }
    return null;
  }

  /* Erkannte Felder übernehmen: nur leere (oder noch automatisch belegte) Felder füllen */
  function isEmpty(st, name) {
    if (st.sugg[name] && !st.touched.has(name)) return true;
    if (name === 'datum' || name === 'kat') return !st.b && !st.touched.has(name);
    return !val(st.root, name).trim();
  }
  function applyRecog(st, res) {
    geschaeftAbgleich(res, st.typ);
    const r = st.root, f = res.felder || {}, her = res.herkunft || {}, sich = res.sicherheit || {};
    const src = (feld) => her[feld] || (res.quelle === 'pdf-text' ? 'text' : 'dateiname');
    const chips = [];
    const fill = (name, feld, value, display, extra = {}) => {
      const el = fld(r, name);
      if (!el || st.lock && ['betrag', 'datum', 'belegnr', 'wer'].includes(name)) return;
      const now = name === 'betrag' ? parseMoney(el.value) : el.value;
      let state;
      if (isEmpty(st, name)) {
        if (name === 'kat') setKat(st, value); else el.value = name === 'betrag' ? moneyStr(value) : value;
        suggest(st, name, src(feld), sich[feld]);
        setErr(r, name, '');
        state = 'neu';
      } else state = norm(now) === norm(value) ? 'gleich' : 'anders';
      chips.push({ name, feld, value, display, state, ...extra });
    };
    // Typ nur von Ausgabe (Vorgabe) auf Einnahme wechseln, wenn ein eigener Beleg erkannt wurde – eine bewusst geöffnete Einnahme
    // („Ohne eigenen Beleg“ + Abrechnung der Plattform) bleibt Einnahme; beleg.js schlägt sonst immer „ausgabe“ vor
    const typNeu = f.typ === 'einnahme' || (f.typ === 'ausgabe' && sich.typ === 'hoch');
    if (typNeu && !st.b && !st.touched.has('typ') && f.typ !== st.typ) setTyp(st, f.typ);
    if (f.betrag > 0) fill('betrag', 'betrag', Math.round(f.betrag), fmt.eur(f.betrag), { num: true });
    // Lastschrift: Zahlungsdatum = Abbuchungstag; das Rechnungsdatum steht dezent unter dem Feld (siehe sync)
    const abbu = /^\d{4}-\d\d-\d\d$/.test(f.datum || '') && /^\d{4}-\d\d-\d\d$/.test(f.rechnungsdatum || '') && f.rechnungsdatum !== f.datum;
    st.abbu = abbu ? { rechnung: f.rechnungsdatum, ab: f.datum } : null;
    if (/^\d{4}-\d\d-\d\d$/.test(f.datum || '')) fill('datum', 'datum', f.datum, `${abbu ? 'Abbuchung ' : ''}${fmt.datum(f.datum)}`);
    // Ausgabe: erkannter Name (auch ein Kontakt) ist das Geschäft · Einnahme: der Kunde
    const ko = f.kontakt && D.kontakt(f.kontakt), wer = ko ? ko.name : f.lieferant || '';
    if (wer) fill('wer', ko ? 'kontakt' : 'lieferant', ko && st.typ === 'einnahme' ? kundeLabel(ko) : wer, wer); // Kunde gebunden über seine Nummer
    const kat = f.kategorie && D.kat(f.kategorie);
    if (kat && kat.typ === st.typ) fill('kat', 'kategorie', kat.id, kat.name, { dot: kat.farbe });
    if (f.rechnungsnr) fill('belegnr', 'rechnungsnr', String(f.rechnungsnr), `Nr. ${f.rechnungsnr}`, { code: true });
    const za = !st.lock && zahlungswegAusText(res.text);
    if (za) {
      const state = za === st.za ? 'gleich' : st.touched.has('za') ? 'anders' : 'neu';
      if (state === 'neu') setZw(st, za);
      chips.push({ name: 'za', value: za, display: zaOf(za).name, state });
    }
    const text = f.text || (wer ? `${wer}${kat ? ' · ' + kat.name : ''}` : '');
    if (text && isEmpty(st, 'text')) { fld(r, 'text').value = text; suggest(st, 'text', src(f.text ? 'text' : 'lieferant'), sich.text); setErr(r, 'text', ''); }
    const hinweise = Array.isArray(res.hinweise) ? res.hinweise.slice() : [];
    // eigene Rechnung/Quittung erkannt (z. B. „RE-2026-007.pdf“): offene Rechnung gleich zuordnen, schon bezahlte nicht doppelt erfassen
    const eigen = st.typ === 'einnahme' && !st.b && f.rechnungsnr ? D.rechnungen.find((x) => x.nr && x.nr.toLowerCase() === String(f.rechnungsnr).toLowerCase()) : null;
    if (eigen && eigen.art === 'rechnung' && eigen.status === 'offen') { st.ew = 'offen'; renderBeleg(st); waehleOffen(st, eigen.id); }
    else if (eigen && D.buchungen.some((b) => b.rechnung === eigen.id)) hinweise.push(`${eigen.nr} ist schon als Einnahme erfasst – bitte nicht doppelt erfassen.`);
    st.recog = { quelle: res.quelle, chips, hinweise };
    sync(st);
    renderRecog(st);
  }

  function renderRecog(st) {
    const slot = $('.bu-recog-slot', st.root);
    if (!slot) return;
    const R = st.recog;
    if (!R) { slot.innerHTML = ''; return; }
    if (R === 'loading') {
      slot.innerHTML = `<div class="bu-recog loading" role="status">${SPIN}<div class="bu-recog-main">
        <div class="bu-recog-head"><b>Beleg wird gelesen …</b><span class="muted">Betrag, Datum, Geschäft</span></div>
        <div class="bu-recog-sk"><i class="sk"></i><i class="sk"></i><i class="sk"></i></div></div></div>`;
      return;
    }
    const none = !R.chips.length;
    const quelle = R.quelle === 'pdf-text' ? 'aus dem PDF-Text' : R.quelle === 'dateiname' ? 'aus dem Dateinamen' : '';
    const chip = (c, i) => {
      const inner = `${c.dot ? `<i class="dot" style="background:${esc(c.dot)}"></i>` : ''}<span class="${c.num ? 'num' : ''}${c.code ? ' mono' : ''}">${esc(c.display)}</span>`;
      if (c.state === 'anders') return `<button type="button" class="chip bu-diff" data-bu="take" data-i="${i}" data-tip="Im Formular steht ein anderer Wert. Klicken übernimmt den Wert vom Beleg.">${inner}<em>übernehmen</em></button>`;
      return `<span class="chip ${c.state === 'neu' ? 'on' : ''}" ${c.state === 'gleich' ? 'title="stimmt mit dem Formular überein"' : ''}>${inner}${c.state === 'gleich' ? icon('check') : ''}</span>`;
    };
    slot.innerHTML = `<div class="bu-recog ${none ? 'none' : ''}">
      ${icon(none ? 'info' : 'sparkle')}
      <div class="bu-recog-main">
        <div class="bu-recog-head"><b>${none ? 'Nichts erkannt' : 'Erkannt'}</b>${quelle ? `<span class="muted">${quelle}</span>` : ''}</div>
        ${none ? '<p class="hint">Bitte Betrag, Datum und Geschäft selbst eintragen.</p>' : `<div class="chips">${R.chips.map(chip).join('')}</div>`}
        ${R.hinweise.length ? `<ul class="bu-recog-hints">${R.hinweise.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
      </div>
      <button type="button" class="icon-btn sm" data-bu="recog-x" title="Ausblenden">${icon('x')}</button>
    </div>`;
  }

  /* ---------- Ereignisse in der Schublade (einmal je Schublade gebunden; Zustand immer aus `cur`) ---------- */
  function bindDrawer(root) {
    const S = () => (cur && cur.root === root ? cur : null);
    root.addEventListener('seg-change', (e) => {
      const st = S(); if (!st) return;
      if (e.detail.key === 'bf-typ') { st.touched.add('typ'); setTyp(st, e.detail.value); }
      else if (e.detail.key === 'bf-dstatus') { st.dstatus = e.detail.value; sync(st); }
      else if (e.detail.key === 'bf-art') { // Quittung ↔ Rechnung: Zahlungsweg-Vorschlag folgt, solange nicht selbst gewählt
        st.art = e.detail.value;
        if (!st.touched.has('za') && !st.b) st.za = zaStandard(st.typ, st.ew, st.art);
        sync(st);
      }
    });
    root.addEventListener('input', (e) => {
      const st = S(), name = e.target.name;
      if (!st || !name) return;
      if (name === 'dadresse') { st.d.adresse = e.target.value; st.d.auto = false; return; }
      if (name === 'dleistung') { st.d.leistung = e.target.value; return; }
      if (name === 'vorlage') { st.d.vorlage = e.target.value; return; }
      st.touched.add(name);
      unSuggest(st, name);
      setErr(root, name, '');
      if (name === 'wer') { st.kAuto = null; werHint(st); }
      if (name === 'text') { const dl = fld(root, 'dleistung'); if (dl) dl.placeholder = e.target.value.trim() || 'wie Beschreibung'; }
      if (name === 'text' && !st.touched.has('kat') && !st.b) { const k = katAusText(e.target.value, st.typ); if (k && k !== val(root, 'kat')) { unSuggest(st, 'kat'); setKat(st, k); } }
      if (['betrag', 'privat', 'datum'].includes(name)) sync(st);
    });
    root.addEventListener('change', (e) => {
      const st = S(); if (!st) return;
      const t = e.target;
      if (t.classList.contains('bu-file-in')) { const f = t.files && t.files[0]; t.value = ''; if (f) attachFile(st, f); return; }
      if (t.name === 'vorlage') { st.d.vorlage = t.value; return; }
      if (t.name !== 'wer') return;
      // eindeutiger Kunde → Feld zeigt „Name · K-0012“ (gebunden über die Nummer)
      const kw = kundeAufloesen(st);
      if (kw.k && !st.lock && t.value.trim() !== kundeLabel(kw.k)) { t.value = kundeLabel(kw.k); st.kAuto = kw.k.id; } // nur über den Namen gebunden
      // bekannter Kunde bzw. bekanntes Geschäft → übliche Kategorie (solange nicht selbst gewählt) und Anschrift
      if (!st.b && !st.touched.has('kat')) { const k = haeufigsteKat(t.value, st.typ, kw.k); if (k && katOf(k).typ === st.typ && k !== val(root, 'kat')) { unSuggest(st, 'kat'); setKat(st, k); } }
      adresseVorschlagen(st);
      werHint(st);
    });
    root.addEventListener('focusout', (e) => {
      const st = S(); if (!st || e.target.name !== 'betrag') return;
      const c = parseMoney(e.target.value);
      if (c > 0) e.target.value = moneyStr(c);
      else if (e.target.value.trim()) setErr(root, 'betrag', 'Betrag nicht lesbar – z. B. 12,50 oder 1.234,56');
    });
    root.addEventListener('click', (e) => {
      const st = S(); if (!st) return;
      // gleiche Namen: gemeinten Kunden binden (Feld = „Name · K-0012“) bzw. bewusst einen neuen mit diesem Namen anlegen
      const kwahl = e.target.closest('[data-kwahl]');
      if (kwahl) {
        const w = fld(root, 'wer'), v = kwahl.dataset.kwahl, k = D.kontakt(v);
        if (k) { w.value = kundeLabel(k); st.kneu = null; } // diesen Kunden (auch „Doch K-0012 nehmen“)
        else if (v === 'neu') { const n = App.kundeAusEingabe(w.value).name; w.value = n; st.kneu = norm(n); } // neuer Kunde gleichen Namens
        else st.kneu = null; // „Doch einen der bestehenden wählen“
        st.kAuto = null;
        st.touched.add('wer'); unSuggest(st, 'wer'); setErr(root, 'wer', '');
        if (k && !st.b && !st.touched.has('kat')) { const kt = haeufigsteKat(k.name, st.typ, k); if (kt && katOf(kt).typ === st.typ && kt !== val(root, 'kat')) setKat(st, kt); }
        adresseVorschlagen(st); werHint(st);
        w.focus({ preventScroll: true });
        return;
      }
      const tile = e.target.closest('[data-kat-tile]');
      if (tile) { st.touched.add('kat'); unSuggest(st, 'kat'); setErr(root, 'kat', ''); setKat(st, tile.dataset.katTile); return; }
      const zw = e.target.closest('[data-zw]');
      if (zw) { st.touched.add('za'); setZw(st, zw.dataset.zw); sync(st); return; }
      const ew = e.target.closest('[data-ew]');
      if (ew) {
        if (st.ew === 'offen' && ew.dataset.ew !== 'offen') offenLoesen(st);
        st.ew = ew.dataset.ew;
        if (!st.touched.has('za') && !st.b) st.za = zaStandard(st.typ, st.ew, st.art);
        adresseVorschlagen(st);
        $('.bu-offen', root)?.classList.remove('invalid');
        renderBeleg(st); sync(st);
        $(`[data-ew="${st.ew}"]`, root)?.focus({ preventScroll: true });
        return;
      }
      const of = e.target.closest('[data-offen]');
      if (of) { waehleOffen(st, of.dataset.offen); return; }
      const a = e.target.closest('[data-bu]');
      if (!a) return;
      const act = a.dataset.bu;
      if (act === 'save') save(st, false);
      else if (act === 'save-new') save(st, true);
      else if (act === 'delete') loeschen(st.b);
      else if (act === 'pick') $('.bu-file-in', root).click();
      else if (act === 'remove-file') { revoke(st); st.file = null; st.beleg = null; st.token++; if (st.recog === 'loading') st.recog = null; renderBeleg(st); renderRecog(st); }
      else if (act === 'recog-x') { st.recog = null; renderRecog(st); }
      else if (act === 'take') takeChip(st, +a.dataset.i);
      else if (act === 'eigenbeleg') eigenbeleg(st);
    });
    root.addEventListener('keydown', (e) => {
      const st = S(); if (!st) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(st, e.shiftKey && !st.b); return; }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('bu-dz')) { e.preventDefault(); $('.bu-file-in', root).click(); return; }
      // Pfeiltasten in Kachel-Gruppen (wie Radio-Buttons)
      const grp = e.target.closest('.bu-zw, .bu-kat-tiles, .bu-ew, .bu-offen');
      if (grp && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const items = $$('button', grp), i = items.indexOf(e.target.closest('button'));
        const n = items[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? items.length - 1 : 1)) % items.length];
        n.click(); n.focus();
      }
    });
    // eigene Dropzone (core.js überlässt Drops auf .dropzone der Seite)
    root.addEventListener('dragover', (e) => { const dz = e.target.closest('.bu-dz'); if (dz) { e.preventDefault(); dz.classList.add('over'); } });
    root.addEventListener('dragleave', (e) => { const dz = e.target.closest('.bu-dz'); if (dz && !dz.contains(e.relatedTarget)) dz.classList.remove('over'); });
    root.addEventListener('drop', (e) => {
      const dz = e.target.closest('.bu-dz'), st = S();
      if (!dz) return;
      e.preventDefault(); dz.classList.remove('over');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && st) attachFile(st, f);
    });
  }

  function takeChip(st, i) {
    const c = st.recog && st.recog.chips && st.recog.chips[i];
    if (!c || !c.name) return;
    if (c.name === 'za') { setZw(st, c.value); c.state = 'gleich'; sync(st); renderRecog(st); return; }
    if (c.name === 'kat') setKat(st, c.value); else fld(st.root, c.name).value = c.name === 'betrag' ? moneyStr(c.value) : c.value;
    st.touched.delete(c.name);
    suggest(st, c.name, 'text', 'hoch');
    setErr(st.root, c.name, '');
    c.state = 'neu';
    sync(st);
    renderRecog(st);
  }

  /* Eigenbeleg für eine Ausgabe ohne Originalbeleg (Seite „Beleg“; Empfänger = Geschäft) */
  function eigenbeleg(st) {
    const r = st.root, cent = parseMoney(val(r, 'betrag')), wer = val(r, 'wer').trim();
    const q = new URLSearchParams({ art: 'eigenbeleg' });
    if (cent > 0) q.set('betrag', String(cent));
    q.set('datum', val(r, 'datum') || D.TODAY);
    if (val(r, 'text').trim()) q.set('text', val(r, 'text').trim());
    const ko = st.typ === 'einnahme' ? kundeAufloesen(st).k : null;
    if (ko) q.set('kontakt', ko.id); else if (wer) q.set(st.typ === 'ausgabe' ? 'lieferant' : 'kunde', wer);
    q.set('zahlungsart', st.za); // gewählter Zahlungsweg und Kategorie gehen sonst verloren
    if (katOf(val(r, 'kat')).typ === 'ausgabe') q.set('kat', val(r, 'kat'));
    if (st.b) q.set('buchung', st.b.id);
    location.hash = `#/beleg/neu?${q.toString()}`;
  }

  /* ---------- Speichern ---------- */
  /* Layout beim Ausstellen einfrieren (GoBD: ein Nachdruck sieht aus wie das Original) – Bausteine der gewählten Vorlage aus belege.js */
  const layoutFest = (art, vorlage) => (App.sheet && typeof App.sheet.vorlage === 'function' ? JSON.parse(JSON.stringify(App.sheet.vorlage(art, vorlage || null))) : null);
  function save(st, andNew) {
    const r = st.root, typ = st.typ;
    const errs = [];
    const err = (name, msg) => { setErr(r, name, msg); if (msg) errs.push(name); };
    const raw = val(r, 'betrag').trim(), cent = parseMoney(raw);
    err('betrag', !raw ? 'Bitte einen Betrag eingeben.' : !(cent > 0) ? 'Betrag nicht lesbar – z. B. 12,50 oder 1.234,56' : cent >= 1e10 ? 'Dieser Betrag ist unrealistisch hoch.' : '');
    const datum = val(r, 'datum');
    err('datum', /^\d{4}-\d\d-\d\d$/.test(datum) ? '' : 'Bitte das Zahlungsdatum wählen.');
    const text = val(r, 'text').trim();
    err('text', text ? '' : 'Wofür? Bitte kurz beschreiben – das gehört zur Aufzeichnung.');
    const kat = val(r, 'kat');
    err('kat', katOf(kat).typ === typ ? '' : 'Bitte eine Kategorie wählen.');
    const art = docArt(st), wer = val(r, 'wer').trim();
    if (art === 'rechnung') err('wer', wer ? '' : 'Für eine Rechnung bitte den Kunden angeben.');
    // Kunde: gebunden über die Nummer im Feld („Name · K-0012“); gleicher Name ohne Wahl → nachfragen statt raten
    const kw = typ === 'einnahme' && wer && !zuordnen(st) && !st.lock ? kundeAufloesen(st) : null;
    if (kw && !kw.k && kw.liste.length > 1 && !kw.bewusst) err('wer', 'Bitte wählen, wer gemeint ist.');
    const offenRe = zuordnen(st) ? D.rechnungen.find((x) => x.id === st.offenId) : null;
    if (zuordnen(st) && !offenRe) errs.push('offen');
    if (errs.length) {
      if (errs[0] === 'offen') {
        const box = $('.bu-offen, .bu-offen-empty', r);
        box?.classList.add('invalid', 'bu-shake');
        App.toast('Bitte eine offene Rechnung auswählen.', { icon: 'info', ms: 2200 });
        return;
      }
      const el = markEl(r, errs[0]);
      (el.matches('input, select, button') ? el : $('button', el) || el).focus();
      const field = el.closest('.field');
      field.classList.remove('bu-shake'); void field.offsetWidth; field.classList.add('bu-shake');
      return;
    }
    const undos = []; // Rückgängig in umgekehrter Reihenfolge
    const adresse = (fld(r, 'dadresse') ? val(r, 'dadresse') : st.d.adresse).trim();
    // Kunde: bekannter Kontakt – sonst neu anlegen, damit er unter „Kunden“ auftaucht (nicht bei festgeschriebenen Zahlungen)
    let ko = null, neuKo = false;
    if (kw) {
      ko = kw.k; // gebundener Kunde (ID), nicht erneut über den Namen gesucht
      if (!ko) { // unbekannt bzw. bewusst „Neuer Kunde mit diesem Namen“ → eigener Kunde mit eigener Nummer
        ko = neuerKunde(kw.name || wer, art ? adresse : ''); neuKo = true;
        D.KONTAKTE.push(ko); D.kundenNr(ko); // feste Kundennummer gleich beim Anlegen (wie unter „Kunden“ und „Termine“)
        undos.push(() => { const i = D.KONTAKTE.indexOf(ko); if (i >= 0) D.KONTAKTE.splice(i, 1); });
      }
    }
    const privat = typ === 'ausgabe' ? Math.min(100, Math.max(0, Math.round(+val(r, 'privat') || 0))) : 0;
    const data = {
      typ, datum, betrag: cent, kat, zahlungsart: st.za, text, privat, beleg: st.file ? st.file.name : st.beleg || null, belegnr: val(r, 'belegnr').trim() || null,
      kontakt: ko ? ko.id : null, kunde: ko ? ko.name : null, lieferant: typ === 'ausgabe' ? wer || null : null
    };
    if (st.lock) { delete data.kontakt; delete data.kunde; delete data.lieferant; } // Kunde kommt aus dem Beleg
    let doc = null, ausgestellt = false, ersetzt = false;

    if (art) {
      // eigener Beleg (Quittung/Rechnung): vorbereiteten Entwurf ausstellen bzw. neu erstellen – beides mit Nummer und verknüpft
      const offen = rechnungOffen(st), e = st.entwurf && !st.entwurf.nr && st.entwurf.status === 'entwurf' ? st.entwurf : null;
      const leistungText = (fld(r, 'dleistung') ? val(r, 'dleistung') : st.d.leistung).trim() || text;
      const felder = {
        art, nr: naechsteNr(art, datum), status: offen ? 'offen' : 'bezahlt',
        kontakt: ko ? ko.id : null, kunde: ko ? ko.name : wer || null, kundeAdresse: adresse, kundeNr: ko ? D.kundenNr(ko) : null, // Schnappschuss (GoBD)
        datum, faellig: offen ? D.util.addDays(datum, D.FIRMA.zahlungszielTage || 14) : datum, betreff: text,
        bezahltAm: offen ? null : datum, quittiert: art === 'rechnung' && !offen ? { am: datum, za: st.za } : null, // Rechnung schon bezahlt → druckt „dankend erhalten“
        zahlungsart: st.za, kat, vorlage: st.d.vorlage, erstellt: D.TODAY
      };
      if (e) {
        // Entwurf (z. B. vom Termin) bekommt jetzt seine Nummer; Positionen bleiben, solange der Betrag zur Summe passt
        const vorher = JSON.parse(JSON.stringify(e));
        ersetzt = cent !== D.rechnungSumme(e);
        Object.assign(e, felder, { leistung: st.termin ? st.termin.datum : e.leistung || datum, scan: st.file ? st.file.name : e.scan || null });
        if (ersetzt) e.positionen = [{ text: leistungText, menge: 1, einheit: 'pausch.', preis: cent }];
        else if (e.positionen.length === 1 && st.d.leistung.trim()) e.positionen[0].text = st.d.leistung.trim();
        if (!Array.isArray(e.bloecke)) { const bl = layoutFest(art, e.vorlage); if (bl) e.bloecke = bl; } // vorhandenes Layout bleibt
        undos.push(() => { Object.keys(e).forEach((k) => delete e[k]); Object.assign(e, vorher); });
        doc = e; ausgestellt = true;
      } else {
        doc = { id: 'r' + Date.now(), ...felder, leistung: st.termin ? st.termin.datum : datum, positionen: [{ text: leistungText, menge: 1, einheit: 'pausch.', preis: cent }],
          scan: st.file ? st.file.name : null, ...(st.termin ? { termin: st.termin.id } : {}) };
        const bl = layoutFest(art, st.d.vorlage); if (bl) doc.bloecke = bl;
        D.rechnungen.push(doc);
        undos.push(() => { const i = D.rechnungen.indexOf(doc); if (i >= 0) D.rechnungen.splice(i, 1); });
      }
    }
    // Termin abhaken (nur bei Einnahmen): erledigt, mit dem ausgestellten Beleg verknüpft
    const t = typ === 'einnahme' ? st.termin : null;
    let tOhne = false, verworfen = null;
    if (t) {
      const tVorher = { status: t.status, beleg: t.beleg, ohneBeleg: t.ohneBeleg };
      // vorbereiteten Entwurf OHNE Nummer verwerfen (sonst bliebe er verwaist unter „Offen“) – bei „Offene Rechnung zuordnen“ und „Ohne eigenen Beleg“
      const entwurfVerwerfen = () => {
        const e = [st.entwurf, t.beleg && D.rechnungen.find((x) => x.id === t.beleg)].find((x) => x && !x.nr && x.status === 'entwurf' && (x.termin === t.id || t.beleg === x.id));
        const i = e ? D.rechnungen.indexOf(e) : -1;
        if (i < 0) return;
        D.rechnungen.splice(i, 1); verworfen = e;
        if (t.beleg === e.id) t.beleg = null;
        undos.push(() => { if (!D.rechnungen.includes(e)) D.rechnungen.splice(Math.min(i, D.rechnungen.length), 0, e); });
      };
      t.status = 'erledigt';
      if (doc) { t.beleg = doc.id; delete t.ohneBeleg; }
      else if (offenRe) { entwurfVerwerfen(); t.beleg = offenRe.id; delete t.ohneBeleg; } // Termin gehört jetzt zur bezahlten Rechnung
      else { entwurfVerwerfen(); tOhne = true; t.ohneBeleg = true; } // ohne Beleg abgeschlossen (wie termine.js), Einnahme verweist auf den Termin
      undos.push(() => { Object.assign(t, tVorher); if (tVorher.ohneBeleg === undefined) delete t.ohneBeleg; });
    }
    if (tOhne) data.termin = t.id;
    const tText = !t ? '' : `${tOhne ? ' · Termin ohne Beleg abgeschlossen' : ' · Termin erledigt'}${verworfen ? ` · vorbereitete ${verworfen.art === 'rechnung' ? 'Rechnung' : 'Quittung'} verworfen` : ''}`;
    const extras = `${ersetzt ? ' · Positionen durch den neuen Betrag ersetzt' : ''}${tText}${neuKo ? ' · neuer Kunde angelegt' : ''}`;

    if (doc) {
      if (rechnungOffen(st)) { // noch nicht bezahlt → nur die Rechnung, keine Einnahme
        App.save();
        if (andNew) nextForm(st); else App.drawer.close();
        App.rerender();
        toastMehr(`${doc.nr} ${ausgestellt ? 'ausgestellt' : 'gespeichert'} · noch offen${extras}`, [
          { label: 'Beleg öffnen', fn: () => { location.hash = `#/beleg/${doc.id}`; } },
          { label: 'Rückgängig', fn: () => { undos.reverse().forEach((u) => u()); App.save(); App.rerender(); } }]);
        return;
      }
      Object.assign(data, { rechnung: doc.id, belegnr: doc.nr, beleg: st.file ? st.file.name : `${doc.nr}.pdf` });
    } else if (offenRe) {
      // offene Rechnung als bezahlt markieren und mit genau dieser Einnahme verknüpfen
      const snapR = { status: offenRe.status, bezahltAm: offenRe.bezahltAm, zahlungsart: offenRe.zahlungsart };
      Object.assign(offenRe, { status: 'bezahlt', bezahltAm: datum, zahlungsart: st.za });
      undos.push(() => Object.assign(offenRe, snapR));
      Object.assign(data, { rechnung: offenRe.id, belegnr: offenRe.nr, beleg: st.file ? st.file.name : `${offenRe.nr}.pdf`, kontakt: offenRe.kontakt || null, kunde: D.gegenueber(offenRe) || null });
    } else if (st.b && st.b.rechnung) {
      // Zahlung zu eigenem Beleg: Scan wird am Beleg vermerkt, sonst bleibt das erzeugte PDF der Nachweis; Zahlungsweg mitführen
      const re = rechnungOf(st.b);
      if (!data.beleg && re && re.nr) data.beleg = `${re.nr}.pdf`;
      if (re) {
        const alt = { scan: re.scan, zahlungsart: re.zahlungsart };
        if (st.file) re.scan = st.file.name;
        if (re.status === 'bezahlt' && !st.zaFest) re.zahlungsart = st.za; // Rechnung: Zahlungsweg mitführen; Quittung/Eigenbeleg: wie gedruckt
        undos.push(() => Object.assign(re, alt));
      }
    }

    let b;
    if (st.b) {
      b = st.b;
      const snap = { ...b };
      Object.assign(b, data);
      undos.push(() => { Object.keys(b).forEach((k) => { if (!(k in snap)) delete b[k]; }); Object.assign(b, snap); });
    } else {
      b = { id: 'b' + Date.now(), nr: App.nextBuchungNr(datum), rechnung: null, wiederkehrend: null, ...data };
      D.buchungen.push(b);
      undos.push(() => { const i = D.buchungen.indexOf(b); if (i >= 0) D.buchungen.splice(i, 1); FILES.delete(b.id); });
    }
    if (st.file) FILES.set(b.id, st.file);
    App.save();
    const hier = App.route.id === 'buchungen';
    if (hier) flashId = b.id;
    if (andNew) nextForm(st); else App.drawer.close();
    App.rerender();
    const sichtbar = !hier || !!$(`.bu-table tr.row[data-id="${CSS.escape(b.id)}"]`);
    const undo = { label: 'Rückgängig', fn: () => { undos.reverse().forEach((u) => u()); App.save(); App.rerender(); App.toast(`${typName(b.typ)} ${b.nr} zurückgenommen`, { icon: 'reset' }); } };
    const link = (x) => ({ label: 'Beleg öffnen', fn: () => { location.hash = `#/beleg/${x.id}`; } });
    if (doc) toastMehr(`Einnahme gespeichert · ${doc.nr} ${ausgestellt ? 'ausgestellt' : 'erstellt'}${extras}`, [link(doc), undo]);
    else if (offenRe) toastMehr(`${offenRe.nr} bezahlt · Einnahme gespeichert${extras}`, [link(offenRe), undo]);
    else App.toast(`${st.b ? 'Änderung gespeichert' : `${typName(typ)} ${fmt.eur(cent)} gespeichert`}${extras}${sichtbar ? '' : ' · im aktuellen Filter ausgeblendet'}`, { action: undo });
  }

  /* Toast mit mehreren Knöpfen (App.toast kennt nur einen): der letzte ist der Hauptknopf */
  function toastMehr(msg, actions) {
    App.toast(msg, { action: actions[actions.length - 1], ms: 5000 });
    const t = $('#toasts .toast:last-child'), main = t && $('button', t);
    if (!t) return;
    actions.slice(0, -1).forEach((a) => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = a.label;
      btn.addEventListener('click', () => { a.fn(); t.remove(); });
      t.insertBefore(btn, main);
    });
  }

  /* „Speichern & neu“: Schublade bleibt offen, Typ/Datum/Kategorie/Zahlungsweg bleiben stehen */
  function nextForm(old) {
    const r = old.root;
    revoke(old);
    const st = makeState(null, { typ: old.typ, datum: val(r, 'datum'), kat: val(r, 'kat'), zahlungsart: old.za, beleg: old.ew === 'beleg' ? old.art : null });
    st.touched.clear();
    st.root = r;
    cur = st;
    $('.drawer-body', r).innerHTML = bodyHTML(st);
    $('.drawer-foot', r).innerHTML = drawerFoot(st);
    const sub = $('.drawer-head small', r);
    if (sub) sub.innerHTML = drawerSub(st);
    $('.drawer-body', r).scrollTop = 0;
    mount(r, st, null);
  }

  /* Datei aufs Fenster, während die Schublade offen ist – auf jeder Seite: an die Schublade hängen, statt zu „Ein- & Ausgänge“
   * zu springen (das schlösse die Schublade samt Eingaben). core.js ruft beim Drop App.dropTarget auf; der wird hier in der
   * Capture-Phase kurz auf die Schublade umgelenkt und danach wiederhergestellt. Drops auf eine .dropzone regelt diese selbst. */
  window.addEventListener('drop', (e) => {
    if (!cur || !cur.root || !cur.root.isConnected) return;
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    if (e.target.closest && e.target.closest('.dropzone')) return;
    const vorher = App.dropTarget, st = cur;
    const hier = (files) => {
      App.dropTarget = vorher;
      const f = files && files[0];
      if (f && cur === st && st.root.isConnected) attachFile(st, f); else if (typeof vorher === 'function') vorher(files);
    };
    App.dropTarget = hier;
    setTimeout(() => { if (App.dropTarget === hier) App.dropTarget = vorher; }, 0);
  }, true);

  /* ================= Anmelden ================= */
  App.page('buchungen', { title: 'Ein- & Ausgänge', navTitle: 'Ein- & Ausgänge', icon: 'swap', nav: true, order: 10, desc: 'Alle geschäftlichen Zahlungen: Geld rein, Geld raus', render });

  /* Zentral erfassen/bearbeiten – von jeder Seite aus, ohne zu navigieren (App.erfassen → hier) */
  App.neueBuchung = (vorgabe = {}) => openDrawer(null, prefill(vorgabe));
  App.bearbeiteBuchung = (id) => openById(id);
  App.buchungen = { parseMoney }; // für Tests
})();
