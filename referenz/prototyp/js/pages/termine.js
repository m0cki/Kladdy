/* Kladdy – Prototyp · Termine (Seiten-ID 'termine', im Menü zwischen „Ein- & Ausgänge“ und „Rechnungen & Quittungen“)
 * Kundentermine als ruhige Agenda nach Tagen – auf Wunsch mit vorbereiteter Quittung bzw. Rechnung. Keine Kacheln/Statistik.
 * Vorbereiteter Beleg = Entwurf OHNE Nummer in D.rechnungen (status 'entwurf', termin: <id>). Die Nummer kommt erst beim
 * Ausstellen (GoBD: lückenlos) → eine Absage verwirft den Entwurf einfach, ein Storno ist nicht nötig.
 * Ablauf: Termin eintragen (Schublade) → „✓ Erledigt“ abhaken (nur heute und früher; bleibt auf der Seite, Toast mit
 *   „Quittung ausstellen“) → „Quittung ausstellen“ (bzw. „Rechnung schreiben“) öffnet die EINE Erfassen-Schublade:
 *   App.erfassen({ typ: 'einnahme', beleg, entwurf, termin, kontakt, betrag, text, datum }) – sie stellt den Entwurf mit Nummer
 *   aus, bucht die Einnahme und setzt t.beleg. render() gleicht zusätzlich ab: Beleg mit Nummer → Termin erledigt.
 * Status: geplant · erledigt (mit Beleg ✓ | „Beleg fehlt“ | t.ohneBeleg = ohne Beleg abgeschlossen, mit Einnahme b.termin
 *   = „bezahlt ohne Beleg“) · abgesagt.
 * „Nachtragen“ (oben) = geplant in der Vergangenheit + erledigt ohne Beleg (wie der Zähler in der Seitenleiste).
 * Filter: Anstehend (Nachtragen + heute + Zukunft) · Erledigt (alle erledigten) · Alle (dazu abgesagte; Vergangenes unter „Vorbei“).
 * Routen:  #/termine?t=<id> (Schublade) · ?neu=1[&kontakt=<id>][&datum=YYYY-MM-DD] – Parameter werden danach entfernt.
 * Global:  App.neuerTermin(prefill) öffnet die Schublade auf jeder Seite (z. B. Kunden → „Termin eintragen“).
 *          prefill: { kontakt, kunde, datum, von, bis, adresse, leistung, betrag (Cent), notiz, beleg: 'quittung'|'rechnung'|'keinen' }
 *          App.termine = { ics, abgleich, vorbereiten, abhaken, belegAusstellen, kassieren, parseMoney } (für Tests und andere Seiten)
 */
(() => {
  'use strict';
  const { D, $, $$, esc, icon, fmt } = App;
  const U = D.util, T = D.TODAY;
  const motion = () => App.settings.motion === 'full';
  const pad = (n) => String(n).padStart(2, '0');
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const plural = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;
  const ART = { quittung: { label: 'Quittung', icon: 'receipt' }, rechnung: { label: 'Rechnung', icon: 'invoice' } };
  const artOf = (a) => ART[a] || ART.quittung;
  const artStandard = () => (ART[App.settings.belegArt] ? App.settings.belegArt : 'quittung');
  const zielTage = () => +D.FIRMA.zahlungszielTage || 14;
  /* Notizzettel (wie auf der Kundenseite; fehlt in den Kern-Icons) */
  const IC_NOTIZ = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5h14A1.5 1.5 0 0 1 20.5 5v9.5l-6 6H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M20.5 14.5H16a1.5 1.5 0 0 0-1.5 1.5v4.5M7.5 8.5h9M7.5 12h5.5"/></svg>';

  /* ================= Datum & Uhrzeit ================= */
  const DF_TAG = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const DF_TAG_J = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const DF_WT = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
  const tagLang = (iso) => (iso.slice(0, 4) === T.slice(0, 4) ? DF_TAG : DF_TAG_J).format(U.parse(iso)); // „Montag, 12. Oktober“
  const wt = (iso) => DF_WT.format(U.parse(iso)).replace('.', '');                                          // „Mo“
  const isoOk = (s) => /^\d{4}-\d\d-\d\d$/.test(String(s || ''));
  const minuten = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : null; };
  const uhr = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  const plus2h = (von) => { const m = minuten(von); return m == null ? '' : uhr(Math.min(23 * 60 + 59, m + 120)); }; // Vorschlag „bis“
  const relTag = (iso) => ({ 0: 'Heute', 1: 'Morgen', '-1': 'Gestern' }[U.diffDays(T, iso)] || '');
  const montag = (iso) => U.addDays(iso, -((U.parse(iso).getDay() + 6) % 7));
  function kw(iso) { // ISO-Kalenderwoche
    const d = U.parse(iso); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const j4 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - j4) / 864e5 - 3 + ((j4.getDay() + 6) % 7)) / 7);
  }
  const chrono = (a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : (minuten(a.von) ?? 0) - (minuten(b.von) ?? 0));

  /* ================= Geld, Adresse, Kunde ================= */
  const betragKurz = (c) => fmt.eur(c, { dec: c % 100 ? 2 : 0 });
  const geldFeld = (c) => (c ? fmt.num(c / 100, c % 100 ? 2 : 0) : '');
  /* Betrag lesen wie im Rest der App: „65“ · „65,50“ · „1.234,56“ · „65 €“ → Cent (null = leer, NaN = unlesbar) */
  function parseMoney(raw) {
    const s = String(raw ?? '').replace(/[\s €+]/g, '');
    if (!s) return null;
    if (!/^(\d[\d.,]*|[.,]\d+)$/.test(s)) return NaN;
    const iC = s.lastIndexOf(','), iD = s.lastIndexOf('.');
    let dec = -1;
    if (iC >= 0 && iD >= 0) dec = Math.max(iC, iD);
    else if (iC >= 0) dec = s.indexOf(',') === iC ? iC : -1;
    else if (iD >= 0) dec = s.indexOf('.') === iD && s.length - iD - 1 !== 3 ? iD : -1;
    const tail = dec >= 0 ? s.slice(dec + 1) : '';
    if (/[.,]/.test(tail)) return NaN;
    const v = Number((dec >= 0 ? s.slice(0, dec) : s).replace(/[.,]/g, '') + '.' + (tail || '0'));
    return isFinite(v) ? Math.round(v * 100) : NaN;
  }
  const zeilen = (a) => String(a || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const adrEinzeilig = (a) => zeilen(a).join(', ');
  const mapsUrl = (a) => 'https://maps.apple.com/?q=' + encodeURIComponent(adrEinzeilig(a));
  const adresseVon = (k) => (k && (k.strasse || k.ort) ? [k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join('\n') : '');
  /* Freitext → Stammdaten: Zeile „PLZ Ort“, davor die Straße, noch weiter oben ein Zusatz (z. Hd. …);
   * auch einzeilig „Straße 1, 12345 Ort“ bzw. „Straße 1 12345 Ort“. zusatz nur, wenn vorhanden. */
  function parseAdresse(text) {
    let z = zeilen(text);
    if (z.length === 1) { const m = z[0].match(/^(.*?\S),?\s+(\d{4,5}\s+\D.*)$/); if (m) z = [m[1], m[2]]; }
    let p = -1; z.forEach((x, i) => { if (/^\d{4,5}\s+\S/.test(x)) p = i; });
    if (p < 0) return { strasse: z[0] || '', plz: '', ort: z.slice(1).join(', ') };
    const m = z[p].match(/^(\d{4,5})\s+(.+)$/), zusatz = z.slice(0, Math.max(0, p - 1)).join(', ');
    return { strasse: p ? z[p - 1] : '', plz: m[1], ort: m[2], ...(zusatz ? { zusatz } : {}) };
  }
  const kundeVon = (t) => (t && t.kontakt ? D.kontakt(t.kontakt) : null);
  const nameVon = (t) => { const k = kundeVon(t); return (k && k.name) || t.kunde || ''; };
  const tById = (id) => D.TERMINE.find((t) => t.id === id) || null;
  const belegOf = (t) => (t && t.beleg ? D.rechnungen.find((r) => r.id === t.beleg) || null : null);
  const nachtragen = (t) => t.status === 'geplant' && t.datum < T;                       // vorbei, nicht abgehakt
  const belegAus = (t) => { const r = belegOf(t); return r && r.nr && r.status !== 'entwurf' && r.status !== 'storniert' ? r : null; }; // ausgestellt
  const belegFehlt = (t) => t.status === 'erledigt' && !t.ohneBeleg && !belegAus(t);     // erledigt, Beleg fehlt
  /* Einnahme ohne eigenen Beleg zum Termin (buchungen.js: b.termin, dazu t.ohneBeleg) → „bezahlt ohne Beleg“ */
  const einnahmeVon = (t) => (t ? D.buchungen.find((b) => b.typ === 'einnahme' && !b.rechnung && b.termin === t.id) || null : null);
  const offen = (t) => nachtragen(t) || belegFehlt(t);                                   // → Gruppe „Nachtragen“
  const entwurfVon = (t) => { const r = belegOf(t); return r && !r.nr && r.status === 'entwurf' ? r : null; };
  const ausstellArt = (t) => { const e = entwurfVon(t); return e && ART[e.art] ? e.art : artStandard(); };
  const ausstellLabel = (t) => (ausstellArt(t) === 'rechnung' ? 'Rechnung schreiben' : 'Quittung ausstellen');

  /* Besuche je Kunde – gezählt wie auf der Kunden-Seite: Quittungen/Rechnungen (nicht storniert; Entwürfe ja, nur die für
   * noch nicht erledigte Termine vorbereiteten nicht), Einnahmen ohne Beleg (zum Termin mit dessen Datum), erledigte Termine
   * ohne Beleg und ohne Einnahme – ein Termin ist so immer genau EIN Besuch; nur bis heute → Map(id → { n, last }) */
  function kundenInfo() {
    const m = new Map(), belege = new Set(), bezahlt = new Set(); // bezahlt: Termine mit Einnahme ohne Beleg (b.termin)
    const add = (id, d) => { if (!id || !d || d > T) return; const x = m.get(id) || { n: 0, last: '' }; x.n++; if (d > x.last) x.last = d; m.set(id, x); };
    D.buchungen.forEach((b) => { if (b.typ === 'einnahme' && !b.rechnung && b.termin) bezahlt.add(b.termin); });
    D.rechnungen.forEach((r) => {
      if (r.art !== 'quittung' && r.art !== 'rechnung') return;
      belege.add(r.id);
      const t = r.termin ? tById(r.termin) : null;
      if (r.status === 'storniert' || (r.status === 'entwurf' && r.termin && !(t && t.status === 'erledigt' && !bezahlt.has(t.id)))) return;
      add(r.kontakt, r.leistung || r.datum);
    });
    D.buchungen.forEach((b) => { if (b.typ === 'einnahme' && !b.rechnung) { const t = b.termin ? tById(b.termin) : null; add(b.kontakt, t && t.status === 'erledigt' ? t.datum : b.datum); } });
    D.TERMINE.forEach((t) => { if (t.status === 'erledigt' && !(t.beleg && belege.has(t.beleg)) && !bezahlt.has(t.id)) add(t.kontakt, t.datum); });
    return m;
  }
  /* Häufige Leistungen: Betreffs der Quittungen (+ bisherige Termine), dazu Ø-Betrag aus den Quittungen */
  function leistungen() {
    const m = new Map();
    const add = (text, cent) => {
      const s = String(text || '').trim(), key = norm(s); if (!key) return;
      const x = m.get(key) || { text: s, n: 0, sum: 0, nb: 0 };
      x.n++; if (cent > 0) { x.sum += cent; x.nb++; }
      m.set(key, x);
    };
    D.rechnungen.forEach((r) => { if (r.art === 'quittung' && r.nr && r.status !== 'storniert') add(r.betreff, D.rechnungSumme(r)); });
    D.TERMINE.forEach((t) => add(t.leistung, 0));
    return [...m.values()].sort((a, b) => b.n - a.n || a.text.localeCompare(b.text, 'de')).slice(0, 24);
  }

  /* ================= Beleg vorbereiten (Entwurf ohne Nummer) ================= */
  function vorbereiten(t, art = artStandard()) {
    const r = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), art, nr: null, status: 'entwurf', kontakt: t.kontakt || null, kunde: nameVon(t),
      kundeAdresse: t.adresse || '', datum: t.datum, leistung: t.datum, faellig: art === 'rechnung' ? U.addDays(t.datum, zielTage()) : t.datum, betreff: t.leistung,
      positionen: [{ text: t.leistung, menge: 1, einheit: 'pausch.', preis: t.betrag || 0 }], bezahltAm: null, zahlungsart: art === 'rechnung' ? 'bank' : 'bar', kat: 'dienstleistung', termin: t.id };
    D.rechnungen.push(r);
    t.beleg = r.id;
    return r;
  }
  /* Entwurf an den Termin angleichen (nur ohne Nummer). In der Maske ergänzte Positionen bzw. ein eigener Betreff bleiben. */
  function belegAngleichen(r, t, art, altLeistung) {
    if (!r || r.nr) return;
    const artNeu = r.art !== art;
    Object.assign(r, { art, kontakt: t.kontakt || null, kunde: nameVon(t), kundeAdresse: t.adresse || '', datum: t.datum, leistung: t.datum, termin: t.id,
      faellig: art === 'rechnung' ? U.addDays(t.datum, zielTage()) : t.datum });
    if (artNeu) r.zahlungsart = art === 'rechnung' ? 'bank' : 'bar';
    if (!r.betreff || r.betreff === altLeistung) r.betreff = t.leistung;
    if ((r.positionen || []).length <= 1) r.positionen = [{ text: t.leistung, menge: 1, einheit: 'pausch.', preis: t.betrag || 0 }];
  }
  function belegEntfernen(r) { const i = D.rechnungen.indexOf(r); if (i >= 0) D.rechnungen.splice(i, 1); return i; }

  /* Abgleich mit den Belegen: Termin ↔ Beleg verknüpfen (ein ausgestellter Beleg schlägt den Entwurf), verwaiste Verweise lösen,
   * ausgestellt → erledigt (und „ohne Beleg“ ist dann hinfällig) */
  function abgleich() {
    let n = 0;
    D.rechnungen.forEach((r) => {
      if (!r.termin || r.status === 'storniert') return;
      const t = tById(r.termin);
      if (!t || t.status === 'abgesagt' || t.beleg === r.id) return;
      const ist = r.nr && r.status !== 'entwurf';
      if (!t.beleg || (ist && !belegAus(t))) { t.beleg = r.id; n++; }
    });
    D.buchungen.forEach((b) => { // Einnahme ohne Beleg zum erledigten Termin → „ohne Beleg“ abgeschlossen (setzt buchungen.js schon selbst)
      if (b.typ !== 'einnahme' || b.rechnung || !b.termin) return;
      const t = tById(b.termin);
      if (t && t.status === 'erledigt' && !t.ohneBeleg && !belegAus(t)) { t.ohneBeleg = true; n++; }
    });
    D.TERMINE.forEach((t) => {
      if (!t.beleg) return;
      const r = belegOf(t);
      if (!r) { t.beleg = null; n++; return; } // Entwurf inzwischen gelöscht
      if (!belegAus(t)) return;
      if (t.status === 'geplant') { t.status = 'erledigt'; n++; }
      if (t.ohneBeleg) { delete t.ohneBeleg; n++; }
    });
    if (n) App.save();
    return n;
  }

  /* ================= Zustand der Liste ================= */
  const st = { filter: 'anstehend' };
  let V = null;       // { root, seg, woche, agenda, menu }
  let selId = null;   // Termin in der offenen Schublade
  let flashId = null; // nach dem Speichern kurz hervorheben
  const sichtbar = (t, f = st.filter) => f === 'alle' || (f === 'erledigt' ? t.status === 'erledigt' : t.status === 'geplant' || belegFehlt(t) || (t.status === 'erledigt' && t.datum === T));

  function nachTagen(list, absteigend = false) {
    const m = new Map();
    list.forEach((t) => { if (!m.has(t.datum)) m.set(t.datum, []); m.get(t.datum).push(t); });
    const tage = [...m.keys()].sort(); if (absteigend) tage.reverse();
    return tage.map((d) => ({ typ: 'tag', datum: d, items: m.get(d).sort(chrono) }));
  }
  /* Gruppen je Filter: [{ typ: 'nachtragen'|'tag'|'trenner', datum, items }] */
  function gruppen(f = st.filter) {
    const L = D.TERMINE;
    if (f === 'erledigt') return nachTagen(L.filter((t) => t.status === 'erledigt'), true);
    const G = [], nach = L.filter(offen).sort(chrono);
    if (nach.length) G.push({ typ: 'nachtragen', items: nach });
    const kommend = nachTagen(L.filter((t) => t.datum >= T && !offen(t) && sichtbar(t, f)));
    if (!kommend.some((g) => g.datum === T)) kommend.unshift({ typ: 'tag', datum: T, items: [] }); // „Heute“ steht immer da
    G.push(...kommend);
    if (f === 'alle') {
      const vorbei = L.filter((t) => t.datum < T && !offen(t));
      if (vorbei.length) G.push({ typ: 'trenner', text: 'Vorbei' }, ...nachTagen(vorbei, true));
    }
    return G;
  }

  /* ================= Seite ================= */
  function render(el, route) {
    abgleich();
    const P = route.params || {};
    const ziel = P.t ? tById(P.t) : null;
    if (ziel && !sichtbar(ziel)) st.filter = 'alle';
    el.innerHTML = `<div class="page tm-page">
      <div class="page-head reveal" style="--i:0">
        <div><h1>${icon('calendar')}Termine</h1><p class="page-sub">Kundentermine – auf Wunsch mit vorbereiteter Quittung</p></div>
        <div class="page-actions"><button type="button" class="btn-primary head-add" data-tm="neu">${icon('plus')}Termin eintragen</button></div>
      </div>
      <section class="card flush tm-liste reveal" style="--i:1">
        <div class="tm-bar"><div class="tm-seg"></div></div>
        <div class="tm-woche"></div>
        <div class="tm-agenda"></div>
      </section>
    </div>`;
    const root = el.firstElementChild;
    const ac = new AbortController(), on = (t, ev, fn, cap = false) => t.addEventListener(ev, fn, { signal: ac.signal, capture: cap });
    const menu = menuPopover(on);
    V = { root, seg: $('.tm-seg', root), woche: $('.tm-woche', root), agenda: $('.tm-agenda', root), menu };
    V.seg.innerHTML = segHTML();
    zeichne();

    on(root, 'seg-change', (e) => { if (e.detail.key === 'tm-filter') { st.filter = e.detail.value; V.menu.zu(); zeichne(); } });
    on(root, 'click', (e) => {
      const b = e.target.closest('[data-tm]');
      if (b) {
        const act = b.dataset.tm, li = b.closest('[data-t]'), t = li ? tById(li.dataset.t) : null;
        if (act === 'neu') openTermin(null);
        else if (act === 'tag') zumTag(b.dataset.d);
        else if (act === 'menu') { if (t) V.menu.auf(b, t); }
        else if (t) aktion(act, t);
        return;
      }
      if (e.target.closest('a, button, .tm-ntz')) return; // Links (Kunde, Karte, Beleg) und Notiz nicht abfangen
      const li = e.target.closest('.tm-item[data-t]');
      if (li) openTermin(tById(li.dataset.t));
    });
    on(root, 'keydown', (e) => {
      const li = e.target.closest && e.target.closest('.tm-item[data-t]');
      if (!li || e.target !== li) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTermin(tById(li.dataset.t)); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const L = $$('.tm-item[data-t]', V.agenda), i = L.indexOf(li), n = L[i + (e.key === 'ArrowDown' ? 1 : -1)];
        if (n) n.focus();
      }
    });

    // Direktlinks #/termine?t=<id> (Suche ⌘K) bzw. ?neu=1[&kontakt=…][&datum=…]: Schublade öffnen, Adresse bereinigen
    if (P.t || P.neu) {
      history.replaceState(null, '', '#/termine');
      if (P.neu) openTermin(null, { prefill: { kontakt: P.kontakt, datum: P.datum, kunde: P.kunde, leistung: P.leistung } });
      else if (ziel) { openTermin(ziel); const li = $(`.tm-item[data-t="${CSS.escape(ziel.id)}"]`, root); if (li) li.scrollIntoView({ block: 'center' }); }
      else App.toast('Diesen Termin gibt es nicht (mehr).', { icon: 'alert' });
    }
    if (flashId) {
      const li = $(`.tm-item[data-t="${CSS.escape(flashId)}"]`, root);
      flashId = null;
      if (li) {
        li.classList.add('tm-flash'); setTimeout(() => li.classList.remove('tm-flash'), 2400);
        const r = li.getBoundingClientRect();
        if (r.top < 120 || r.bottom > innerHeight - 20) li.scrollIntoView({ block: 'center', behavior: motion() ? 'smooth' : 'auto' });
      }
    }
    return () => { ac.abort(); menu.zu(); if (V && V.root === root) V = null; };
  }

  function segHTML() {
    const n = { anstehend: 0, erledigt: 0, alle: D.TERMINE.length }; // je Filter genau die Zeilen der Liste (Anstehend: inkl. heute erledigter)
    D.TERMINE.forEach((t) => { if (sichtbar(t, 'anstehend')) n.anstehend++; if (t.status === 'erledigt') n.erledigt++; });
    return App.seg('local', 'tm-filter', [['anstehend', `Anstehend <span class="cnt">${n.anstehend}</span>`], ['erledigt', `Erledigt <span class="cnt">${n.erledigt}</span>`], ['alle', `Alle <span class="cnt">${n.alle}</span>`]], st.filter);
  }
  function setFilter(f) {
    st.filter = f;
    $$('.seg[data-key="tm-filter"] button', V.seg).forEach((b) => { const on = b.dataset.value === f; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    App.updateSegs(V.seg);
    zeichne();
  }
  function zeichne() {
    if (!V || !V.root.isConnected) return;
    // Wochenstreifen schaut nach vorn: nicht unter „Erledigt“ und nicht, wenn in den zwei Wochen nichts ansteht
    const mo = montag(T), so = U.addDays(mo, 13);
    V.woche.innerHTML = wocheHTML();
    V.woche.hidden = st.filter === 'erledigt' || !D.TERMINE.some((t) => t.status !== 'abgesagt' && t.datum >= mo && t.datum <= so);
    V.agenda.innerHTML = agendaHTML();
    markSel(selId);
  }
  function markSel(id) {
    selId = id;
    if (V) $$('.tm-item[data-t]', V.agenda).forEach((li) => li.classList.toggle('selected', li.dataset.t === id));
  }

  /* ---------- Wochenstreifen: diese + nächste Woche, Punkt je Termin ---------- */
  function wocheHTML() {
    const mo = montag(T), proTag = new Map();
    D.TERMINE.forEach((t) => { if (t.status === 'abgesagt') return; if (!proTag.has(t.datum)) proTag.set(t.datum, []); proTag.get(t.datum).push(t); });
    const tag = (d) => {
      const L = (proTag.get(d) || []).sort(chrono);
      const dots = L.slice(0, 4).map((t) => `<i class="${offen(t) ? 'nach' : t.status}"></i>`).join('') + (L.length > 4 ? `<em>+${L.length - 4}</em>` : '');
      const cls = `tm-d${d === T ? ' heute' : ''}${d < T ? ' vorbei' : ''}${L.length ? '' : ' frei'}${U.parse(d).getDay() % 6 === 0 ? ' we' : ''}`;
      const tip = L.map((t) => `${t.von} ${nameVon(t)}${t.status === 'erledigt' ? ' ✓' : ''}`).join(' · ');
      return `<button type="button" class="${cls}" data-tm="tag" data-d="${d}" aria-label="${esc(tagLang(d))}: ${plural(L.length, 'Termin', 'Termine')}"${L.length ? ` data-tip="${esc(tip)}" data-tip-title="${esc(tagLang(d))}"` : ' tabindex="-1" aria-disabled="true"'}>
        <small>${wt(d)}</small><b>${+d.slice(8)}</b><span class="tm-dots">${dots}</span></button>`;
    };
    const woche = (start, label) => `<div class="tm-wo"><div class="tm-wo-h">${label}<span>KW ${kw(start)}</span></div>
      <div class="tm-wo-d">${[0, 1, 2, 3, 4, 5, 6].map((i) => tag(U.addDays(start, i))).join('')}</div></div>`;
    return woche(mo, 'Diese Woche') + woche(U.addDays(mo, 7), 'Nächste Woche');
  }
  /* Klick auf einen Tag: zur Tagesgruppe springen (steht der Tag nicht im Filter, auf „Alle“ wechseln) */
  function zumTag(d) {
    if (!V || !D.TERMINE.some((t) => t.datum === d && t.status !== 'abgesagt')) return; // freier Tag: nichts tun (Filter bleibt)
    const finde = () => { const g = document.getElementById('tm-d-' + d); return g && $('.tm-item', g) ? g : $(`.tm-item[data-d="${d}"]`, V.agenda); };
    let z = finde();
    if (!z && st.filter !== 'alle') { setFilter('alle'); z = finde(); }
    if (!z) return;
    z.scrollIntoView({ block: 'start', behavior: motion() ? 'smooth' : 'auto' });
    const h = z.matches('.tm-tag') ? $('.tm-tag-h', z) : z;
    h.classList.remove('tm-ping'); void h.offsetWidth; h.classList.add('tm-ping');
  }

  /* ---------- Agenda ---------- */
  function agendaHTML() {
    const G = gruppen();
    if (!G.some((g) => g.items && g.items.length)) return leerHTML();
    return G.map((g) => {
      if (g.typ === 'trenner') return `<div class="tm-trenner" role="separator"><span>${esc(g.text)}</span></div>`;
      if (g.typ === 'nachtragen') {
        const nA = g.items.filter(nachtragen).length, nB = g.items.length - nA;
        const was = nA && nB ? 'Termin abhaken oder Beleg ausstellen' : nA ? 'vorbei, aber noch nicht abgehakt' : 'erledigt, aber noch ohne Beleg';
        return `<section class="tm-tag tm-nach" id="tm-nachtragen" aria-label="Nachtragen">
        <h3 class="tm-tag-h">${icon('alert')}<b>Nachtragen</b><span>· ${was}</span></h3>
        <ul class="tm-items">${g.items.map((t) => itemHTML(t, true)).join('')}</ul></section>`;
      }
      const rel = relTag(g.datum);
      const kopf = rel ? `<b>${rel}</b><span>· ${esc(tagLang(g.datum))}</span>` : `<b>${esc(tagLang(g.datum))}</b><span>${esc(fmt.rel(g.datum))}</span>`;
      return `<section class="tm-tag${g.datum === T ? ' heute' : ''}" id="tm-d-${g.datum}"><h3 class="tm-tag-h">${kopf}</h3>
        <ul class="tm-items">${g.items.length ? g.items.map((t) => itemHTML(t)).join('') : '<li class="tm-frei">Heute keine Termine.</li>'}</ul></section>`;
    }).join('');
  }

  function leerHTML() {
    const neu = `<button type="button" class="btn ghost" data-tm="neu">${icon('plus')}Termin eintragen</button>`;
    const [ic, b, s, btn] = st.filter === 'erledigt'
      ? ['check', 'Noch keine erledigten Termine', 'Hak Termine mit „✓ Erledigt“ ab – sie stehen dann hier, die Quittung stellst du danach aus.', '']
      : st.filter === 'alle'
        ? ['calendar', 'Noch keine Termine', 'Trag deinen ersten Kundentermin ein – auf Wunsch gleich mit vorbereiteter Quittung.', neu]
        : ['calendar', 'Keine anstehenden Termine', 'Trag den nächsten Kundentermin ein – auf Wunsch gleich mit vorbereiteter Quittung.', neu];
    return `<div class="empty tm-leer">${icon(ic)}<b>${b}</b><span>${s}</span>${btn}</div>`;
  }

  /* Beleg-Chip: vorbereitet (Entwurf, Link) · Nummer ✓ (ausgestellt, Link) · Beleg fehlt · ohne Beleg · abgesagt */
  function chipHTML(t, r) {
    if (t.status === 'abgesagt') return '<span class="tm-chip ab">abgesagt</span>';
    if (belegFehlt(t)) { const e = entwurfVon(t); return `<span class="tm-chip fehlt" title="${e ? `${artOf(e.art).label} vorbereitet, noch ohne Nummer` : 'Noch kein Beleg zu diesem Termin'}">${icon('alert')}Beleg fehlt</span>`; }
    if (t.status === 'erledigt' && t.ohneBeleg && !belegAus(t)) {
      const b = einnahmeVon(t);
      if (b) return `<a class="tm-chip bez" href="#/buchungen?b=${encodeURIComponent(b.id)}" title="Einnahme ohne Beleg · ${esc(D.zahlungsart(b.zahlungsart).kurz)} – öffnen">bezahlt ohne Beleg${icon('check', 'tm-ok')}</a>`;
      return `<span class="tm-chip ohne" title="Ohne Beleg abgeschlossen (z. B. Nachbesserung, kostenlos)">${icon('check')}ohne Beleg</span>`;
    }
    if (!r) return '<span class="tm-chip leer" title="Kein Beleg vorbereitet">ohne Beleg</span>';
    const A = artOf(r.art), href = `#/beleg/${encodeURIComponent(r.id)}`;
    if (!r.nr) return `<a class="tm-chip vor" href="${href}" title="Entwurf ohne Nummer – öffnen">${icon(A.icon)}${A.label} vorbereitet</a>`;
    if (r.status === 'storniert') return `<a class="tm-chip storno" href="${href}" title="${A.label} storniert – öffnen">${icon(A.icon)}<span>${esc(r.nr)}</span></a>`;
    const bezahlt = r.status === 'bezahlt';
    return `<a class="tm-chip ok${bezahlt ? '' : ' offen'}" href="${href}" title="${A.label} ${bezahlt ? 'bezahlt' : 'offen'} – öffnen">${icon(A.icon)}<span>${esc(r.nr)}</span>${bezahlt ? icon('check', 'tm-ok') : '<small>offen</small>'}</a>`;
  }

  const MEHR = `<button type="button" class="icon-btn sm tm-mehr" data-tm="menu" aria-haspopup="menu" aria-expanded="false" title="Weitere Aktionen" aria-label="Weitere Aktionen">${icon('dots')}</button>`;
  function aktionenHTML(t) {
    if (t.status === 'abgesagt') return `<button type="button" class="btn subtle tm-btn" data-tm="wieder">${icon('reset')}Wieder einplanen</button>`;
    if (t.status === 'erledigt') {
      if (belegAus(t)) return '';
      if (t.ohneBeleg) return MEHR;
      const A = artOf(ausstellArt(t));
      return `<button type="button" class="btn-primary sm tm-kass" data-tm="ausstellen" title="Öffnet „Erfassen“: ${A.label} mit Nummer ausstellen und Einnahme buchen">${icon(A.icon)}${ausstellLabel(t)}</button>${MEHR}`;
    }
    if (t.status !== 'geplant') return '';
    const nach = nachtragen(t);
    const haken = t.datum <= T ? `<button type="button" class="btn-primary sm tm-kass" data-tm="abhaken" title="Termin abhaken – die Quittung stellst du danach aus">${icon('check')}Erledigt</button>` : '';
    return `${nach ? '<span class="tm-frage">War der Termin?</span>' : ''}${haken}${nach ? `<button type="button" class="btn ghost tm-btn" data-tm="absagen">Absagen</button>` : ''}${MEHR}`;
  }

  function itemHTML(t, mitDatum = false) {
    const r = belegOf(t), k = kundeVon(t), name = nameVon(t) || 'ohne Kunde';
    const s = t.status === 'abgesagt' ? 'abgesagt' : belegFehlt(t) ? 'fehlt' : t.status === 'erledigt' ? 'erledigt' : nachtragen(t) ? 'nach' : 'geplant';
    const kunde = k ? `<a class="tm-kunde" href="#/kunden?k=${encodeURIComponent(k.id)}" title="Kunde öffnen">${esc(name)}</a>` : `<span class="tm-kunde">${esc(name)}</span>`;
    const ntz = [t.notiz && ['Termin', zeilen(t.notiz).join(' · ')], k && k.notiz && ['Kunde', k.notiz]].filter(Boolean);
    const notiz = ntz.length ? `<span class="tm-ntz" tabindex="0" role="img" data-tip="${esc(ntz.map(([a, b]) => (ntz.length > 1 ? `${a}: ${b}` : b)).join(' · '))}" data-tip-title="${ntz.length > 1 ? 'Notizen' : ntz[0][0] === 'Kunde' ? 'Notiz zum Kunden' : 'Notiz'}" aria-label="Notiz">${IC_NOTIZ}</span>` : '';
    const adr = adrEinzeilig(t.adresse);
    const ist = !!(r && r.nr && r.status !== 'storniert'), ein = !ist && t.status === 'erledigt' && t.ohneBeleg ? einnahmeVon(t) : null;
    const betrag = ist ? D.rechnungSumme(r) : ein ? ein.betrag : (r && !r.nr && D.rechnungSumme(r)) || t.betrag || 0;
    return `<li class="tm-item s-${s}" data-t="${esc(t.id)}" data-d="${t.datum}" tabindex="0">
      <div class="tm-zeit">${mitDatum ? `<small>${wt(t.datum)} ${fmt.datumKurz(t.datum)}</small>` : ''}<b>${esc(t.von || '–')}</b><span>${esc(t.bis || '')}</span></div>
      ${App.monogram(name, 'sm')}
      <div class="tm-main">
        <div class="tm-l1">${kunde}${notiz}</div>
        <div class="tm-l2"><span class="tm-leist">${esc(t.leistung || '–')}</span>${adr ? `<a class="tm-adr" href="${esc(mapsUrl(t.adresse))}" target="_blank" rel="noopener" title="In Karten öffnen">${icon('pin')}<span>${esc(adr)}</span></a>` : ''}</div>
      </div>
      <div class="tm-info">${betrag ? `<span class="tm-betrag${ist || ein ? ' ist' : ''}" title="${ist ? 'laut Beleg' : ein ? 'laut Einnahme' : 'geschätzt'}">${ist || ein ? '' : 'ca. '}${betragKurz(betrag)}</span>` : ''}${chipHTML(t, r)}</div>
      <div class="tm-acts">${aktionenHTML(t)}</div>
    </li>`;
  }

  /* ================= Aktionen ================= */
  function aktion(act, t) {
    if (act === 'abhaken') abhaken(t);
    else if (act === 'ausstellen') belegAusstellen(t);
    else if (act === 'ohne') ohneBelegAbschliessen(t);
    else if (act === 'mitbeleg') belegAusstellen(t); // „ohne Beleg“ fällt erst mit dem ausgestellten Beleg weg (abgleich) – Abbrechen ändert nichts
    else if (act === 'nichterledigt') nichtErledigt(t);
    else if (act === 'absagen') absagenDialog(t);
    else if (act === 'wieder') openTermin(t, { replan: true });
    else if (act === 'bearbeiten') openTermin(t);
    else if (act === 'vorbereiten') vorbereitenAktion(t);
    else if (act === 'ics') icsLaden(t);
    else if (act === 'einnahme') { const b = einnahmeVon(t); if (b) App.go('#/buchungen?b=' + encodeURIComponent(b.id)); }
  }

  /* „✓ Erledigt“: nur abhaken – bleibt auf der Seite; der Toast bietet gleich „Quittung ausstellen“ an */
  function abhaken(t) {
    if (!t || t.status !== 'geplant') return;
    t.status = 'erledigt'; delete t.ohneBeleg;
    App.save(); flashId = t.id; App.rerender();
    if (belegAus(t)) { App.toast('Termin erledigt'); return; }
    App.toast('Termin erledigt', { actions: [
      { label: ausstellLabel(t), fn: () => belegAusstellen(t) },
      { label: 'Rückgängig', fn: () => { if (t.status !== 'erledigt' || belegAus(t)) return; t.status = 'geplant'; App.save(); flashId = t.id; App.rerender(); } }] });
  }
  /* Beleg zum erledigten Termin: die EINE Erfassen-Schublade (stellt den Entwurf mit Nummer aus, bucht die Einnahme, setzt t.beleg) */
  function belegAusstellen(t) {
    if (!t || t.status !== 'erledigt' || belegAus(t) || (t.ohneBeleg && einnahmeVon(t))) return; // schon bezahlt ohne Beleg: keine zweite Einnahme
    const e = entwurfVon(t), betrag = (e && D.rechnungSumme(e)) || t.betrag || 0;
    const o = { typ: 'einnahme', beleg: ausstellArt(t), termin: t.id, text: t.leistung, datum: T };
    if (e) o.entwurf = e.id;
    if (t.kontakt) o.kontakt = t.kontakt; else if (t.kunde) o.kunde = t.kunde;
    if (betrag > 0) o.betrag = betrag;
    App.erfassen(o);
  }
  /* Kurzweg (Tests, andere Seiten): abhaken und gleich die Erfassen-Schublade öffnen */
  function kassieren(t) {
    if (!t) return;
    if (t.status === 'geplant') { t.status = 'erledigt'; delete t.ohneBeleg; App.save(); flashId = t.id; App.rerender(); }
    belegAusstellen(t);
  }
  /* Erledigt, aber bewusst ohne Beleg (Nachbesserung, kostenlos): ein vorbereiteter Entwurf ohne Nummer wird verworfen */
  function ohneBelegAbschliessen(t) {
    if (!belegFehlt(t)) return;
    const e = entwurfVon(t), idx = e ? belegEntfernen(e) : -1;
    if (e) t.beleg = null;
    t.ohneBeleg = true;
    App.save(); flashId = t.id; App.rerender();
    App.toast(`Ohne Beleg abgeschlossen${e ? ` · vorbereitete ${artOf(e.art).label} verworfen` : ''}`, { action: { label: 'Rückgängig', fn: () => {
      delete t.ohneBeleg;
      if (e && !D.rechnungen.includes(e)) { D.rechnungen.splice(Math.min(idx, D.rechnungen.length), 0, e); if (!t.beleg) t.beleg = e.id; }
      App.save(); flashId = t.id; App.rerender();
    } } });
  }
  function nichtErledigt(t) {
    if (!t || t.status !== 'erledigt' || belegAus(t) || einnahmeVon(t)) return;
    const ohne = !!t.ohneBeleg;
    t.status = 'geplant'; delete t.ohneBeleg;
    App.save(); flashId = t.id; App.rerender();
    App.toast('Termin wieder offen', { icon: 'reset', action: { label: 'Rückgängig', fn: () => { if (t.status !== 'geplant') return; t.status = 'erledigt'; if (ohne) t.ohneBeleg = true; App.save(); flashId = t.id; App.rerender(); } } });
  }

  function vorbereitenAktion(t) {
    if (belegOf(t)) return;
    const r = vorbereiten(t, artStandard());
    App.save(); flashId = t.id; App.rerender();
    App.toast(`${artOf(r.art).label} vorbereitet – Entwurf ohne Nummer`, { icon: artOf(r.art).icon, actions: [
      { label: 'Öffnen', fn: () => App.go('#/beleg/' + encodeURIComponent(r.id)) },
      { label: 'Rückgängig', fn: () => { if (r.nr) return; belegEntfernen(r); if (t.beleg === r.id) t.beleg = null; App.save(); App.rerender(); } }] });
  }

  /* Absagen: Entwurf ohne Nummer wird verworfen (kein Storno nötig); Sonderfall mit Nummer → storniert */
  const kurzHTML = (t) => `<div class="tm-kurz">${App.monogram(nameVon(t) || '?', 'sm')}<div><b>${esc(nameVon(t) || 'ohne Kunde')}</b>
    <small>${esc(t.leistung || '')}${t.leistung ? ' · ' : ''}${esc(tagLang(t.datum))}, ${esc(t.von)}–${esc(t.bis)}</small></div></div>`;
  function absagenDialog(t, ausSchublade = false) { // ausSchublade: „Zurück“ öffnet wieder die Termin-Schublade
    if (!t || t.status !== 'geplant') return;
    const r = belegOf(t), A = r ? artOf(r.art).label : '';
    const info = !r ? ''
      : !r.nr ? `<p class="tm-note">${icon('info')}<span>Die vorbereitete ${A} hatte noch keine Nummer – sie wird einfach verworfen, ein Storno ist nicht nötig.</span></p>`
        : `<p class="tm-note warn">${icon('alert')}<span>${A} ${esc(r.nr)} ist schon ausgestellt – sie wird storniert und bleibt mit Vermerk archiviert (GoBD).</span></p>`;
    App.drawer.open({
      id: 'tm-absagen', title: 'Termin absagen', sub: esc(`${tagLang(t.datum)} · ${t.von}–${t.bis}`), icon: 'calendar', width: 440,
      body: `<section>${kurzHTML(t)}
        <div class="field"><label for="tmGrund">Grund <small class="muted">optional</small></label>
          <textarea class="textarea" id="tmGrund" rows="2" placeholder="z. B. Kunde krank, Regen – wird an die Notiz angehängt"></textarea></div>${info}</section>`,
      foot: `<span class="spacer"></span><button type="button" class="btn ghost" ${ausSchublade ? 'id="tmAbZurueck"' : 'data-action="close-drawer"'}>Zurück</button><button type="button" class="btn danger" id="tmAbOk">${icon('x')}Termin absagen</button>`,
      onMount(d) {
        const ok = () => { const g = $('#tmGrund', d).value.trim(); App.drawer.close(); absagen(t, g); };
        $('#tmAbOk', d).addEventListener('click', ok);
        if (ausSchublade) $('#tmAbZurueck', d).addEventListener('click', () => openTermin(t));
        d.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ok(); } });
        setTimeout(() => { const g = $('#tmGrund', d); if (g && d.isConnected) g.focus({ preventScroll: true }); }, 80);
      }
    });
  }
  function absagen(t, grund = '') {
    if (!t || t.status !== 'geplant') return;
    const vorher = { status: t.status, notiz: t.notiz, beleg: t.beleg }, r = belegOf(t);
    let rIdx = -1, rVorher = null, msg = 'Termin abgesagt';
    if (r && !r.nr) { rIdx = belegEntfernen(r); t.beleg = null; msg += ` · ${artOf(r.art).label} verworfen`; }
    else if (r && r.status !== 'storniert') { rVorher = { status: r.status, storniertAm: r.storniertAm }; r.status = 'storniert'; r.storniertAm = T; msg += ` · ${r.nr} storniert`; }
    t.status = 'abgesagt';
    if (grund) t.notiz = [t.notiz, `Abgesagt am ${fmt.datum(T)}: ${grund}`].filter(Boolean).join('\n');
    App.save(); App.rerender();
    App.toast(msg, { icon: 'x', action: { label: 'Rückgängig', fn: () => {
      Object.assign(t, vorher);
      if (rIdx >= 0 && !D.rechnungen.includes(r)) D.rechnungen.splice(Math.min(rIdx, D.rechnungen.length), 0, r);
      if (rVorher) { r.status = rVorher.status; if (rVorher.storniertAm) r.storniertAm = rVorher.storniertAm; else delete r.storniertAm; }
      App.save(); flashId = t.id; App.rerender();
    } } });
  }
  function loeschen(t) {
    const i = D.TERMINE.indexOf(t); if (i < 0 || t.status !== 'abgesagt') return;
    D.TERMINE.splice(i, 1);
    App.save(); App.drawer.close(); App.rerender();
    App.toast('Termin gelöscht', { icon: 'trash', action: { label: 'Rückgängig', fn: () => { D.TERMINE.splice(Math.min(i, D.TERMINE.length), 0, t); App.save(); flashId = t.id; App.rerender(); } } });
  }

  /* ---------- In Kalender: .ics (eine VEVENT, Zeiten in Europe/Berlin) ---------- */
  const VTZ = ['BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE'];
  const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const ENC = new TextEncoder();
  function falten(line) { // Zeilen > 75 Byte falten (RFC 5545), UTF-8-sicher
    if (ENC.encode(line).length <= 75) return line;
    let out = '', cur = '', len = 0, max = 75;
    for (const ch of line) {
      const b = ENC.encode(ch).length;
      if (len + b > max) { out += cur + '\r\n '; cur = ''; len = 0; max = 74; }
      cur += ch; len += b;
    }
    return out + cur;
  }
  function ics(t) {
    const k = kundeVon(t), name = nameVon(t), adr = adrEinzeilig(t.adresse);
    const dt = (d, hm) => `${d.replace(/-/g, '')}T${String(hm || '00:00').replace(':', '')}00`;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const text = [`Kunde: ${name}`, k && k.telefon && `Telefon: ${k.telefon}`, t.leistung && `Leistung: ${t.leistung}`, t.betrag && `Geschätzt: ${fmt.eur(t.betrag)}`,
      t.notiz && `Notiz: ${t.notiz}`, k && k.notiz && `Kundennotiz: ${k.notiz}`].filter(Boolean).join('\n');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kladdy//Termine//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...VTZ,
      'BEGIN:VEVENT', `UID:kladdy-${t.id}@${D.FIRMA.web || 'kladdy.local'}`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Berlin:${dt(t.datum, t.von)}`, `DTEND;TZID=Europe/Berlin:${dt(t.datum, t.bis || plus2h(t.von))}`,
      `SUMMARY:${icsText([t.leistung, name].filter(Boolean).join(' · '))}`, adr && `LOCATION:${icsText(adr)}`, `DESCRIPTION:${icsText(text)}`,
      `STATUS:${t.status === 'abgesagt' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean);
    return L.map(falten).join('\r\n') + '\r\n';
  }
  function icsLaden(t) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics(t)], { type: 'text/calendar;charset=utf-8' }));
    a.download = `Termin ${t.datum} ${U.slug(nameVon(t) || 'Kunde')}.ics`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    App.toast('Kalender-Datei geladen – per Doppelklick in den Kalender übernehmen', { icon: 'download' });
  }

  /* ---------- „⋯“-Menü (Popover fixiert im body; Esc, Tab, Klick daneben schließt; wandert beim Scrollen mit) ---------- */
  function menuItems(t) {
    const r = belegOf(t);
    if (t.status === 'erledigt') {
      const zurueck = { act: 'nichterledigt', ic: 'reset', label: 'Doch nicht erledigt', sub: 'Zurück auf geplant' };
      const A = artOf(ausstellArt(t)), e = entwurfVon(t);
      const b = t.ohneBeleg ? einnahmeVon(t) : null; // bezahlt ohne Beleg: Geld ist gebucht → nur die Einnahme öffnen
      if (b) return [{ act: 'einnahme', ic: 'swap', label: 'Einnahme öffnen', sub: `Bezahlt ohne Beleg · ${fmt.eur(b.betrag)} am ${fmt.datum(b.datum)}` }];
      if (t.ohneBeleg) return [{ act: 'mitbeleg', ic: A.icon, label: `Doch mit ${A.label}`, sub: 'Öffnet „Erfassen“ zum Ausstellen' }, zurueck];
      return [{ act: 'ohne', ic: 'check', label: 'Ohne Beleg abschließen', sub: e ? `z. B. Nachbesserung, kostenlos – vorbereitete ${artOf(e.art).label} wird verworfen` : 'z. B. Nachbesserung, kostenlos' }, zurueck];
    }
    const I = [{ act: 'bearbeiten', ic: 'edit', label: 'Bearbeiten / Verschieben', sub: 'Tag, Uhrzeit, Adresse, Leistung' }];
    if (!r) { const A = artOf(artStandard()); I.push({ act: 'vorbereiten', ic: A.icon, label: `${A.label} vorbereiten`, sub: 'Entwurf ohne Nummer – die Nummer kommt beim Ausstellen' }); }
    I.push({ act: 'ics', ic: 'download', label: 'In Kalender', sub: '.ics-Datei für Kalender, Outlook & Co.' });
    if (!nachtragen(t)) I.push({ sep: true }, { act: 'absagen', ic: 'x', label: 'Absagen', sub: r && !r.nr ? `Vorbereitete ${artOf(r.art).label} wird verworfen` : '', cls: 'neg' });
    return I;
  }
  function menuPopover(on) {
    let pop = null, btn = null;
    function zu(fokus = false) {
      if (!pop) return;
      pop.remove(); pop = null;
      if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('open'); if (fokus && btn.isConnected) btn.focus({ preventScroll: true }); }
      btn = null;
    }
    function platzieren(e) {
      if (!pop || !btn) return;
      const rb = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
      if (e && (!btn.isConnected || rb.bottom < 0 || rb.top > innerHeight)) { zu(); return; }
      let top = rb.bottom + 6;
      if (top + h > innerHeight - 12) top = Math.max(12, rb.top - h - 6);
      pop.style.left = Math.round(Math.min(innerWidth - w - 12, Math.max(12, rb.right - w))) + 'px';
      pop.style.top = Math.round(top) + 'px';
    }
    function auf(b, t) {
      const gleich = btn === b; zu(); if (gleich) return;
      btn = b; b.setAttribute('aria-expanded', 'true'); b.classList.add('open');
      pop = document.createElement('div');
      pop.className = 'tm-menu'; pop.setAttribute('role', 'menu'); pop.setAttribute('aria-label', `Termin ${nameVon(t)}`);
      pop.innerHTML = menuItems(t).map((x) => (x.sep ? '<div class="tm-mi-sep" role="separator"></div>'
        : `<button type="button" class="tm-mi${x.cls ? ' ' + x.cls : ''}" role="menuitem" data-mi="${x.act}" tabindex="-1">${icon(x.ic)}<span><b>${esc(x.label)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span></button>`)).join('');
      document.body.appendChild(pop);
      platzieren();
      pop.addEventListener('click', (e) => { const mi = e.target.closest('[data-mi]'); if (!mi) return; zu(); aktion(mi.dataset.mi, t); });
      pop.addEventListener('keydown', (e) => {
        const L = $$('.tm-mi', pop), i = L.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); L[(i + (e.key === 'ArrowDown' ? 1 : L.length - 1)) % L.length].focus(); }
        else if (e.key === 'Tab') zu();
      });
      const first = $('.tm-mi', pop); if (first) first.focus({ preventScroll: true });
    }
    on(document, 'keydown', (e) => { if (e.key === 'Escape' && pop) { e.stopPropagation(); zu(true); } }, true);
    on(document, 'pointerdown', (e) => { if (pop && !pop.contains(e.target) && !(btn && btn.contains(e.target))) zu(); });
    on(window, 'scroll', platzieren, true);
    on(window, 'resize', platzieren);
    return { auf, zu };
  }

  /* ================= Schublade: Termin eintragen / bearbeiten / wieder einplanen ================= */
  const val = (s, n) => { const el = $(`[name="${n}"]`, s.d); return el ? el.value : ''; };
  /* Kunde aus dem Feld – über die feste Nummer („Name · K-0012“, App.kundeAusEingabe), nie bloß über einen mehrdeutigen Namen.
   * s.kSel = vorgegebener bzw. gewählter Kunde (Feld zeigt sein Label), s.neuName = bei gleichnamigen Kunden bewusst
   * „Neuer Kunde mit diesem Namen“ bzw. „Andere Person?“ gewählt. → { k, liste, neu, name, perName };
   * k null und liste > 1 = mehrdeutig (Nachfrage); perName = nur über den bloßen Namen gefunden (dann „Andere Person?“ anbieten) */
  function kundeAufloesen(s) {
    const text = val(s, 'kunde').trim();
    if (s.kSel && text === App.kundenLabel(s.kSel)) return { k: s.kSel, liste: [s.kSel], neu: false, name: s.kSel.name };
    const r = App.kundeAusEingabe(text), perName = !/\bK-\d{3,}\b/i.test(text);
    if (perName && r.liste.length && s.neuName && s.neuName === norm(r.name)) return { ...r, k: null, neu: true };
    return { ...r, perName: perName && !!r.k };
  }
  /* Vorschläge: alle Kunden als „Name · K-0012“ (Adresse daneben), zuletzt besuchte zuerst */
  function kundenOptionen(s) {
    const last = (k) => (s.ki.get(k.id) || {}).last || '';
    return App.kundenOptionen((a, b) => (last(a) < last(b) ? 1 : last(a) > last(b) ? -1 : a.name.localeCompare(b.name, 'de')));
  }
  /* Kunde binden (Nachfrage bei gleichen Namen): Feld = Label, Adresse übernehmen, solange sie nicht selbst geändert wurde */
  function kundeBinden(s, k) {
    s.kSel = k; s.neuName = '';
    $('[name="kunde"]', s.d).value = App.kundenLabel(k);
    const a = $('[name="adresse"]', s.d);
    if (s.adrAuto || !a.value.trim()) { a.value = adresseVon(k); s.adrAuto = true; }
    setErr(s, 'kunde', ''); kundeHint(s);
  }

  function belegSecHTML(s) {
    if (s.fix) {
      const r = s.fix, A = artOf(r.art);
      return `<section class="tm-beleg-sec"><h3>Beleg</h3>
        <a class="tm-fix" href="#/beleg/${encodeURIComponent(r.id)}">${icon(A.icon)}<span><b>${esc(r.nr)}</b> · ${A.label} ${r.status === 'storniert' ? 'storniert' : 'ausgestellt'} · ${fmt.eur(D.rechnungSumme(r))}
          <small>Ausgestellte Belege bleiben unverändert (GoBD) – Änderungen am Termin betreffen sie nicht.</small></span>${icon('chevR')}</a></section>`;
    }
    if (s.t && s.t.status === 'erledigt' && !s.replan) {
      const b = s.t.ohneBeleg ? einnahmeVon(s.t) : null;
      if (b) {
        const z = D.zahlungsart(b.zahlungsart);
        return `<section class="tm-beleg-sec"><h3>Beleg</h3>
          <a class="tm-fix" href="#/buchungen?b=${encodeURIComponent(b.id)}">${icon(z.icon)}<span><strong>Bezahlt ohne Beleg</strong> · Einnahme ${fmt.eur(b.betrag)} am ${fmt.datum(b.datum)} · ${esc(z.kurz)}
            <small>Die Einnahme ist gebucht – einen eigenen Beleg gibt es dazu bewusst nicht.</small></span>${icon('chevR')}</a></section>`;
      }
      if (s.t.ohneBeleg) return `<section class="tm-beleg-sec"><h3>Beleg</h3><p class="hint tm-hint">${icon('check')}<span>Ohne Beleg abgeschlossen (z. B. Nachbesserung, kostenlos).</span></p></section>`;
      const A = artOf(ausstellArt(s.t)), e = entwurfVon(s.t);
      return `<section class="tm-beleg-sec"><h3>Beleg</h3>
        <p class="tm-note warn">${icon('alert')}<span>Beleg fehlt – der Termin ist erledigt.${e ? ` Die vorbereitete ${A.label} bekommt beim Ausstellen ihre Nummer.` : ''}</span></p>
        <div class="row"><button type="button" class="btn-primary sm" data-tmf="ausstellen">${icon(A.icon)}${ausstellLabel(s.t)}</button></div></section>`;
    }
    if (!s.mitBeleg) return '';
    return `<section class="tm-beleg-sec"><h3>Beleg vorbereiten</h3>
      ${App.seg('local', 'tm-beleg', [['quittung', icon('receipt') + 'Quittung'], ['rechnung', icon('invoice') + 'Rechnung'], ['keinen', 'Keinen']], s.beleg, 'full')}
      <p class="hint tm-hint tm-beleg-hint"></p></section>`;
  }

  function formHTML(s, v) {
    const lOpts = s.li.map((x) => `<option value="${esc(x.text)}">${x.n}×</option>`).join('');
    return `<form class="tm-form" id="tmForm" novalidate autocomplete="off">
      <section><h3>Kunde &amp; Ort</h3>
        <div class="field"><label for="tmF-kunde">Kunde</label>
          <input class="input" id="tmF-kunde" name="kunde" list="tmKundenListe" value="${esc(v.kunde)}" placeholder="Name – aus deinen Kunden oder neu" spellcheck="false">
          <datalist id="tmKundenListe">${kundenOptionen(s)}</datalist>
          <div class="tm-kunde-hint" hidden></div></div>
        <div class="field"><label for="tmF-adresse">Adresse</label>
          <textarea class="textarea tm-adresse" id="tmF-adresse" name="adresse" rows="2" placeholder="Straße und Hausnummer&#10;PLZ Ort">${esc(v.adresse)}</textarea></div>
      </section>
      <section><h3>Wann</h3>
        <div class="tm-zeitrow">
          <div class="field"><label for="tmF-datum">Datum</label><input class="input" type="date" id="tmF-datum" name="datum" value="${esc(v.datum)}"></div>
          <div class="field"><label for="tmF-von">von</label><input class="input" type="time" id="tmF-von" name="von" value="${esc(v.von)}"></div>
          <div class="field"><label for="tmF-bis">bis</label><input class="input" type="time" id="tmF-bis" name="bis" value="${esc(v.bis)}"></div>
        </div>
        <div class="hint tm-hint tm-wann-hint"></div>
      </section>
      <section><h3>Was</h3>
        <div class="field"><label for="tmF-leistung">Leistung</label>
          <input class="input" id="tmF-leistung" name="leistung" list="tmLeistListe" value="${esc(v.leistung)}" placeholder="z. B. Rasenmähen inkl. Grünschnitt">
          <datalist id="tmLeistListe">${lOpts}</datalist></div>
        <div class="field tm-betrag-f"><label for="tmF-betrag">Geschätzter Betrag <small class="muted">optional</small></label>
          <div class="input-wrap"><input class="input money" id="tmF-betrag" name="betrag" inputmode="decimal" value="${esc(geldFeld(v.betrag))}" placeholder="z. B. 65"><span class="suffix">€</span></div>
          <p class="hint tm-betrag-hint" hidden></p></div>
        <div class="field"><label for="tmF-notiz">Notiz</label>
          <textarea class="textarea tm-notiz" id="tmF-notiz" name="notiz" rows="2" placeholder="z. B. Schlüssel beim Nachbarn, Grünschnitt mitnehmen">${esc(v.notiz)}</textarea></div>
      </section>
      ${belegSecHTML(s)}
    </form>`;
  }

  function footHTML(s) {
    const t = s.t, abbr = '<button type="button" class="btn ghost" data-action="close-drawer">Abbrechen</button>';
    const ok = (label, ic = 'check') => `<button type="submit" form="tmForm" class="btn-primary sm">${icon(ic)}${label}</button>`;
    if (s.neu) return `<span class="spacer"></span>${abbr}${ok('Termin eintragen')}`;
    if (s.replan) return `<span class="spacer"></span>${abbr}${ok('Wieder einplanen', 'calendar')}`;
    const links = t.status === 'abgesagt' ? `<button type="button" class="btn danger" data-tmf="loeschen">${icon('trash')}Löschen</button>`
      : t.status === 'geplant' ? `<button type="button" class="btn danger" data-tmf="absagen">${icon('x')}Absagen</button>` : '';
    return `${links}<span class="spacer"></span>${abbr}${ok('Speichern')}`;
  }

  /* Hinweise unter den Feldern */
  function kundeHint(s) {
    const el = $('.tm-kunde-hint', s.d), text = val(s, 'kunde').trim(), adr = val(s, 'adresse').trim();
    if (!text) { el.hidden = true; el.innerHTML = ''; return; }
    const { k, liste, neu, name, perName } = kundeAufloesen(s), mmjj = (iso) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
    let h;
    if (k) {
      const x = s.ki.get(k.id), ohneAdr = !k.strasse && !k.ort;
      const andere = perName ? ` · <button type="button" class="link tm-klink" data-tmk="neu">Andere Person? Als neuen Kunden anlegen</button>` : ''; // nur per Name gefunden
      h = `<p class="hint tm-hint">${icon('user')}<span>Bekannter Kunde · ${esc(D.kundenNr(k))} · ${x ? `${plural(x.n, 'Besuch', 'Besuche')}, zuletzt ${fmt.datum(x.last)}` : 'noch ohne Besuch'}${ohneAdr && adr ? ' · Adresse wird beim Kunden ergänzt' : ''}${andere}</span></p>`;
      if (k.notiz) h += `<p class="tm-knotiz">${IC_NOTIZ}<span>${esc(k.notiz)}</span></p>`;
    } else if (liste.length > 1 && !neu) { // gleiche Namen: nachfragen, wer gemeint ist
      h = `<p class="hint tm-hint">${icon('users')}<span>Mehrere Kunden heißen „${esc(name)}“ – wer ist gemeint?</span></p>
        <div class="tm-kwahl" role="group" aria-label="Kunde wählen">${liste.map((x) => { const i = s.ki.get(x.id);
          return `<button type="button" class="tm-kw" data-tmk="${esc(x.id)}"><b>${esc(D.kundenNr(x))}</b><span>${esc(App.kundenOrt(x) || 'ohne Adresse')} · ${i ? `zuletzt ${mmjj(i.last)}` : 'noch ohne Besuch'}</span></button>`; }).join('')}
          <button type="button" class="tm-kw neu" data-tmk="neu">${icon('plus')}<span>Neuer Kunde mit diesem Namen</span></button></div>`;
    } else if (liste.length) { // bewusst neue Person trotz gleichem Namen – Zurückwechseln möglich
      h = `<p class="hint tm-hint tm-neuk">${icon('plus')}<span>Neuer Kunde „${esc(name)}“ mit eigener Nummer – wird angelegt${adr ? ' (mit dieser Adresse)' : ''} · ${liste.map((x) => `<button type="button" class="link tm-klink" data-tmk="${esc(x.id)}">Doch ${esc(D.kundenNr(x))} nehmen</button>`).join(' · ')}</span></p>`;
    } else h = `<p class="hint tm-hint tm-neuk">${icon('plus')}<span>Neuer Kunde – wird angelegt${adr ? ' (mit dieser Adresse)' : ''}.</span></p>`;
    el.innerHTML = h; el.hidden = false;
  }
  function wannHint(s) {
    const p = $('.tm-wann-hint', s.d), d = val(s, 'datum'), a = minuten(val(s, 'von')), b = minuten(val(s, 'bis'));
    if (!isoOk(d)) { p.innerHTML = ''; return; }
    const geplant = s.neu || s.replan || s.t.status === 'geplant';
    let warn = '';
    if (a != null && b != null && b <= a) warn = 'Das Ende liegt vor dem Beginn.';
    else if (geplant && a != null) {
      const bis = b ?? a + 120;
      const o = D.TERMINE.filter((x) => x !== s.t && x.status === 'geplant' && x.datum === d && a < (minuten(x.bis) ?? (minuten(x.von) ?? 0) + 120) && (minuten(x.von) ?? 0) < bis);
      if (o.length) warn = `Überschneidet sich mit ${o.map((x) => `${x.von}–${x.bis} ${nameVon(x)}`).join(', ')}.`;
    }
    if (!warn && geplant && d < T) warn = 'Liegt in der Vergangenheit – erscheint unter „Nachtragen“.';
    p.innerHTML = `<span>${icon('calendar')}${esc(tagLang(d))} · ${esc(fmt.rel(d))}</span>${warn ? `<span class="warn-t">${icon('alert')}${esc(warn)}</span>` : ''}`;
  }
  function betragHint(s) {
    const p = $('.tm-betrag-hint', s.d), inp = $('[name="betrag"]', s.d), c = parseMoney(val(s, 'betrag'));
    if (Number.isNaN(c)) { p.className = 'hint neg tm-betrag-hint'; p.textContent = 'Betrag nicht lesbar – z. B. 65 oder 65,50'; p.hidden = false; return; }
    const x = s.li.find((l) => norm(l.text) === norm(val(s, 'leistung')));
    const avg = x && x.nb ? x.sum / x.nb : 0, typ = avg >= 2000 ? Math.round(avg / 500) * 500 : Math.round(avg / 100) * 100;
    inp.placeholder = typ ? `z. B. ${fmt.num(typ / 100)}` : 'z. B. 65';
    p.className = 'hint tm-betrag-hint';
    p.textContent = c == null && typ ? `Sonst meist um ${betragKurz(typ)} (Ø aus ${plural(x.nb, 'Quittung', 'Quittungen')})` : '';
    p.hidden = !p.textContent;
  }
  function belegHint(s) {
    const p = $('.tm-beleg-hint', s.d); if (!p) return;
    const r = belegOf(s.t), offen = r && !r.nr ? r : null;
    let h;
    if (s.beleg === 'keinen') {
      h = offen ? `${icon('info')}<span>Die vorbereitete ${artOf(offen.art).label} wird beim Speichern verworfen – sie hatte noch keine Nummer, ein Storno ist nicht nötig.</span>`
        : `${icon('info')}<span>Ohne Beleg. Beim Erledigen kannst du die Quittung immer noch ausstellen.</span>`;
    } else {
      const A = artOf(s.beleg), ziel = s.beleg === 'rechnung' ? ` Zahlungsziel ${zielTage()} Tage ab Termin.` : '';
      h = offen
        ? `${icon(A.icon)}<span>${offen.art !== s.beleg ? `Die vorbereitete ${artOf(offen.art).label} wird zur ${A.label}.` : `${A.label} ist vorbereitet (noch ohne Nummer).`} Datum, Leistung und Betrag werden beim Speichern übernommen.${ziel}</span>`
        : `${icon('info')}<span>Wird als Entwurf ohne Nummer angelegt und erscheint unter Rechnungen &amp; Quittungen → Offen als ‚vorbereitet‘. Die Nummer kommt erst beim Ausstellen.${ziel}</span>`;
    }
    p.innerHTML = h;
  }
  function setErr(s, name, msg) {
    const el = $(`[name="${name}"]`, s.d); if (!el) return;
    const field = el.closest('.field');
    el.classList.toggle('invalid', !!msg);
    let p = $('.tm-err', field);
    if (!msg) { if (p) p.remove(); return; }
    if (!p) { p = document.createElement('p'); p.className = 'hint neg tm-err'; p.setAttribute('role', 'alert'); field.appendChild(p); }
    p.textContent = msg;
  }

  function openTermin(t, { prefill = {}, replan = false } = {}) {
    if (t && !D.TERMINE.includes(t)) return;
    if (V) V.menu.zu();
    const r = belegOf(t);
    const s = { t, neu: !t, replan: !!t && replan, d: null, ki: kundenInfo(), li: leistungen(), fix: r && r.nr ? r : null };
    let v;
    s.neuName = '';
    if (t) { // Kunde des Termins ist gebunden (Feld zeigt „Name · K-0012“)
      s.kSel = kundeVon(t);
      v = { kunde: s.kSel ? App.kundenLabel(s.kSel) : t.kunde || '', datum: s.replan && t.datum < T ? T : t.datum, von: t.von || '09:00', bis: t.bis || plus2h(t.von), adresse: t.adresse || '', leistung: t.leistung || '', betrag: t.betrag || null, notiz: t.notiz || '' };
    } else {
      const kP = prefill.kontakt ? D.kontakt(prefill.kontakt) || null : null, von = minuten(prefill.von) != null ? prefill.von : '09:00';
      s.kSel = kP && kP.art !== 'lieferant' ? kP : null; // vorgegebener Kunde (z. B. Kunden → „Termin eintragen“) ist gebunden
      v = { kunde: s.kSel ? App.kundenLabel(s.kSel) : String(prefill.kunde || ''), datum: isoOk(prefill.datum) ? prefill.datum : T, von, bis: minuten(prefill.bis) > minuten(von) ? prefill.bis : plus2h(von),
        adresse: prefill.adresse != null ? String(prefill.adresse) : adresseVon(s.kSel), leistung: String(prefill.leistung || ''), betrag: +prefill.betrag > 0 ? Math.round(+prefill.betrag) : null, notiz: String(prefill.notiz || '') };
    }
    s.adrAuto = !v.adresse.trim() || v.adresse === adresseVon(s.kSel || App.kundeAusEingabe(v.kunde).k); // Adresse folgt dem Kunden, solange nicht selbst geändert
    s.bisAuto = !t || v.bis === plus2h(v.von);                                          // „bis“ folgt „von“ (+2 h), solange nicht selbst geändert
    s.beleg = r && !r.nr ? r.art : t ? (s.replan ? artStandard() : 'keinen') : (['quittung', 'rechnung', 'keinen'].includes(prefill.beleg) ? prefill.beleg : artStandard());
    s.mitBeleg = !s.fix && (!t || t.status === 'geplant' || s.replan);
    const titel = s.neu ? 'Termin eintragen' : s.replan ? 'Wieder einplanen' : t.status === 'erledigt' ? 'Termin · erledigt' : t.status === 'abgesagt' ? 'Termin · abgesagt' : 'Termin bearbeiten';
    const sub = t ? esc(`${tagLang(t.datum)} · ${t.von}–${t.bis}`) : 'Kundentermin, auf Wunsch mit vorbereiteter Quittung';
    s.d = App.drawer.open({ id: 'termin', title: titel, sub, icon: s.neu ? 'plus' : 'calendar', width: 480, body: formHTML(s, v), foot: footHTML(s),
      onClose: () => { if (t && selId === t.id) markSel(null); } });
    s.d.classList.add('tm-drawer');
    binden(s);
    kundeHint(s); wannHint(s); betragHint(s); belegHint(s);
    markSel(t ? t.id : null);
    setTimeout(() => {
      if (!s.d.isConnected) return;
      const f = s.replan ? 'datum' : !v.kunde ? 'kunde' : s.neu && !v.leistung ? 'leistung' : null;
      const el = f && $(`[name="${f}"]`, s.d); if (el) el.focus({ preventScroll: true });
    }, motion() ? 260 : 40);
  }

  function binden(s) {
    const d = s.d;
    d.addEventListener('submit', (e) => { e.preventDefault(); speichern(s); });
    d.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); speichern(s); } });
    d.addEventListener('click', (e) => {
      const kw = e.target.closest('[data-tmk]'); // Nachfrage bei gleichen Namen
      if (kw) {
        if (kw.dataset.tmk !== 'neu') { const k = D.kontakt(kw.dataset.tmk); if (k) kundeBinden(s, k); }
        else { // neue Person mit diesem Namen: Bindung lösen, Adresse vom bisherigen Kunden leeren
          s.kSel = null; s.neuName = norm(kundeAufloesen(s).name);
          if (s.adrAuto) $('[name="adresse"]', d).value = '';
          setErr(s, 'kunde', ''); kundeHint(s);
        }
        return;
      }
      const b = e.target.closest('[data-tmf]'); if (!b || !s.t) return;
      if (b.dataset.tmf === 'absagen') absagenDialog(s.t, true);
      else if (b.dataset.tmf === 'ausstellen') belegAusstellen(s.t);
      else if (b.dataset.tmf === 'loeschen') loeschen(s.t);
    });
    d.addEventListener('seg-change', (e) => { if (e.detail.key === 'tm-beleg') { s.beleg = e.detail.value; belegHint(s); } });
    d.addEventListener('input', (e) => {
      const el = e.target, n = el.name;
      if (el.classList.contains('invalid')) setErr(s, n, '');
      if (n === 'kunde') {
        if (s.kSel && el.value.trim() !== App.kundenLabel(s.kSel)) s.kSel = null;                       // selbst geändert → nicht mehr gebunden
        if (s.neuName && norm(App.kundeAusEingabe(el.value).name) !== s.neuName) s.neuName = '';
        if (s.adrAuto) $('[name="adresse"]', d).value = adresseVon(kundeAufloesen(s).k);
        kundeHint(s);
      } else if (n === 'adresse') { s.adrAuto = !el.value.trim(); kundeHint(s); }
      else if (n === 'von') {
        const bis = $('[name="bis"]', d), a = minuten(el.value);
        if (a != null && (s.bisAuto || minuten(bis.value) == null || minuten(bis.value) <= a)) { bis.value = plus2h(el.value); s.bisAuto = true; setErr(s, 'bis', ''); }
        wannHint(s);
      } else if (n === 'bis') { s.bisAuto = false; wannHint(s); }
      else if (n === 'datum') wannHint(s);
      else if (n === 'leistung' || n === 'betrag') betragHint(s);
    });
    d.addEventListener('change', (e) => { if (e.target.name === 'kunde') kundeHint(s); });
  }

  function speichern(s) {
    const raw = (n) => val(s, n), name = raw('kunde').trim(), datum = raw('datum'), von = raw('von'), leistung = raw('leistung').trim();
    let bis = raw('bis');
    if (minuten(bis) == null && minuten(von) != null) bis = plus2h(von);
    const cent = parseMoney(raw('betrag'));
    const fehler = [], kr = kundeAufloesen(s);
    const err = (n, msg) => { setErr(s, n, msg); if (msg) fehler.push(n); };
    err('kunde', !name ? 'Bitte einen Kunden eintragen' : !kr.k && kr.liste.length > 1 && !kr.neu ? 'Bitte wählen, wer gemeint ist' : '');
    err('datum', isoOk(datum) ? '' : 'Bitte ein Datum wählen');
    err('von', minuten(von) != null ? '' : 'Beginn fehlt');
    err('bis', minuten(von) == null || minuten(bis) > minuten(von) ? '' : 'Ende vor Beginn');
    err('leistung', leistung ? '' : 'Was wird gemacht?');
    err('betrag', Number.isNaN(cent) ? 'Betrag nicht lesbar – z. B. 65 oder 65,50' : '');
    if (fehler.length) { const el = $(`[name="${fehler[0]}"]`, s.d); if (el) el.focus(); return; }

    // Kunde: gebunden bzw. eindeutig (Nummer) oder neu anlegen – mit Adresse aus dem Freitext; t.kunde = Name ohne Nummer
    const adresse = zeilen(raw('adresse')).join('\n');
    let k = kr.k, neuK = null;
    if (!k) {
      k = { id: 'k' + Date.now().toString(36), art: 'kunde', name: kr.name || name, zusatz: '', strasse: '', plz: '', ort: '', email: '', telefon: '', notiz: '', ...(adresse ? parseAdresse(adresse) : {}) };
      D.KONTAKTE.push(k); D.kundenNr(k); neuK = k;
    } else if (!k.strasse && !k.ort && adresse) { const a = parseAdresse(adresse); if (k.zusatz) delete a.zusatz; Object.assign(k, a); }

    const daten = { kontakt: k.id, kunde: k.name, datum, von, bis, adresse, leistung, betrag: cent > 0 ? cent : null, notiz: raw('notiz').trim() };
    let t = s.t;
    const altLeistung = t ? t.leistung : '';
    if (!t) { t = { id: 't' + Date.now().toString(36), ...daten, status: 'geplant', beleg: null }; D.TERMINE.push(t); }
    else { Object.assign(t, daten); if (s.replan) t.status = 'geplant'; }

    // Vorbereiteter Beleg folgt dem Termin – solange er keine Nummer hat
    let belegMsg = '';
    if (s.mitBeleg && t.status === 'geplant') {
      const r = belegOf(t), offen = r && !r.nr ? r : null;
      if (s.beleg === 'keinen') { if (offen) { belegEntfernen(offen); t.beleg = null; belegMsg = `${artOf(offen.art).label} verworfen`; } }
      else if (offen) { const vorher = offen.art; belegAngleichen(offen, t, s.beleg, altLeistung); belegMsg = vorher !== s.beleg ? `jetzt mit ${artOf(s.beleg).label}` : `${artOf(s.beleg).label} angepasst`; }
      else if (!r) { vorbereiten(t, s.beleg); belegMsg = `${artOf(s.beleg).label} vorbereitet`; }
    } else if (t.status === 'erledigt' && entwurfVon(t)) belegAngleichen(entwurfVon(t), t, entwurfVon(t).art, altLeistung); // Entwurf folgt, bis er ausgestellt ist
    App.save();
    App.drawer.close();
    const hier = App.route.id === 'termine';
    if (hier) { flashId = t.id; if (!sichtbar(t)) st.filter = 'alle'; }
    App.rerender();
    const was = s.neu ? 'Termin eingetragen' : s.replan ? `Wieder eingeplant · ${fmt.datumKurz(t.datum)} ${t.von}` : 'Termin gespeichert';
    const msg = [was, belegMsg, neuK && `Kunde ${neuK.name} angelegt`].filter(Boolean).join(' · ');
    App.toast(msg, hier ? {} : { action: { label: 'Ansehen', fn: () => { flashId = t.id; if (!sichtbar(t)) st.filter = 'alle'; App.go('#/termine'); } } });
  }

  /* ================= Anmelden ================= */
  App.page('termine', { title: 'Termine', icon: 'calendar', nav: true, order: 15, desc: 'Kundentermine, Quittung vorbereiten', render });
  App.neuerTermin = (prefill = {}) => openTermin(null, { prefill });
  App.termine = { ics, abgleich, vorbereiten, abhaken, belegAusstellen, kassieren, parseMoney, parseAdresse };
})();
