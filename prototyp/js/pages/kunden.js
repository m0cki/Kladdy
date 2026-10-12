/* Kladdy – Prototyp · Kunden
 * Wer, wann, was gemacht: ruhige Liste aller Kunden (jeder Kunde einer Quittung oder Rechnung ist ein Kontakt) –
 * Besuche, „zuletzt da“, letzte Leistung, Umsatz, Notiz-Symbol. Keine KPI-Kacheln (Statistik steht in der Auswertung).
 * Besuch = Quittung oder Rechnung des Kunden (Entwürfe zählen, stornierte und für Termine vorbereitete nicht) bzw. Einnahme
 * mit Kunde ohne Beleg – immer nur bis heute. Datum eines Besuchs = Leistungsdatum, sonst Belegdatum. Angebote und Termine
 * (D.TERMINE: geplant, nachtragen, abgesagt) stehen im Verlauf; der nächste Termin zusätzlich in der Liste und oben in der Schublade.
 * Je Zeichnen wird einmal ein Index Kunde → Einträge gebaut; Suche, Filter und Sortierung zeichnen nur den Tabellenkörper.
 * Klick, Enter oder #/kunden?k=<id> (z. B. aus der Suche ⌘K) öffnet die Schublade: Kopf mit Adresse/Telefon/E-Mail,
 * Notiz (speichert selbst), Stammdaten (einklappbar), Verlauf mit Belegen. #/kunden?neu=1[&name=…] öffnet „Kunde anlegen“.
 * „Neuen Auftrag erfassen“ → App.erfassen({ typ: 'einnahme', kontakt }) – die eine Erfassen-Schublade;
 * „Termin eintragen“ → App.neuerTermin({ kontakt }) bzw. #/termine?neu=1&kontakt=<id>. Termine verlinken auf #/termine?t=<id>.
 */
(() => {
  'use strict';
  const { D, $, $$, esc, icon, fmt } = App;
  const U = D.util, T = D.TODAY;

  /* Zustand der Liste (bleibt beim Seitenwechsel erhalten) */
  const st = { q: '', filter: 'alle', sort: 'zuletzt', dir: -1 };
  const SORT_DIR = { zuletzt: -1, name: 1, besuche: -1 }; // Startrichtung je Spalte
  let V = null;   // Ansicht: { root, tbody, seg, count, ix }
  let sel = null; // Kunde in der offenen Schublade (Zeile markiert)

  const ART = { quittung: ['Quittung', 'receipt'], rechnung: ['Rechnung', 'invoice'], angebot: ['Angebot', 'file'] };
  const STATUS = {
    bezahlt: ['bezahlt', 'bezahlt'], offen: ['offen', 'offen'], ueberfaellig: ['ueberfaellig', 'überfällig'], entwurf: ['entwurf', 'Entwurf'], storniert: ['storniert', 'storniert'],
    angebot: ['accent', 'Angebot'], vorbereitet: ['entwurf', 'vorbereitet'],
    geplant: ['accent', 'geplant'], nachtragen: ['warn', 'nachtragen'], abgesagt: ['entwurf', 'abgesagt'], erledigt: ['bezahlt', 'erledigt'] // Termine
  };
  /* Notizzettel (fehlt in den Kern-Icons) */
  const IC_NOTIZ = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5h14A1.5 1.5 0 0 1 20.5 5v9.5l-6 6H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M20.5 14.5H16a1.5 1.5 0 0 0-1.5 1.5v4.5M7.5 8.5h9M7.5 12h5.5"/></svg>';

  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const coll = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
  const mengeNF = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
  const plural = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;
  const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  /* „vor 12 Tagen“ · „vor 3 Wochen“ · „vor 5 Monaten“ · „vor 2 Jahren“ */
  function vor(iso) {
    const n = U.diffDays(iso, T);
    if (n < 0) return fmt.rel(iso);
    if (n === 0) return 'heute';
    if (n === 1) return 'gestern';
    if (n < 14) return `vor ${n} Tagen`;
    if (n < 60) return `vor ${Math.round(n / 7)} Wochen`;
    const m = Math.round(n / 30.44);
    return m < 24 ? `vor ${m} Monaten` : `vor ${Math.floor(n / 365.25)} Jahren`;
  }

  /* Treffer hervorheben – Zeichen für Zeichen normalisiert, damit Umlaute die Position nicht verschieben */
  function hl(text, q) {
    text = String(text ?? '');
    if (!q) return esc(text);
    const ch = [...text], start = [];
    let s = '';
    ch.forEach((c) => { start.push(s.length); s += norm(c); });
    const i = s.indexOf(q);
    if (i < 0) return esc(text);
    let a = 0; while (a + 1 < ch.length && start[a + 1] <= i) a++;
    let b = a; while (b < ch.length && start[b] < i + q.length) b++;
    return esc(ch.slice(0, a).join('')) + '<mark>' + esc(ch.slice(a, b).join('')) + '</mark>' + esc(ch.slice(b).join(''));
  }

  /* Termine: „Di 14.10.“ bzw. „heute 08:00“ (Liste) · „Di, 14.10. · 08:00–10:00“ (Schublade) */
  const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const wt = (iso) => WT[U.parse(iso).getDay()];
  const zeit = (v) => (v.von ? v.von + (v.bis ? '–' + v.bis : '') : '');
  function terminKurz(v) {
    const n = U.diffDays(T, v.datum);
    return n === 0 ? `heute ${v.von || ''}`.trim() : n === 1 ? `morgen ${v.von || ''}`.trim() : `${wt(v.datum)} ${fmt.datumKurz(v.datum)}`;
  }
  function terminLang(v, klein = false) {
    const n = U.diffDays(T, v.datum), rel = n === 0 ? 'Heute' : n === 1 ? 'Morgen' : n === -1 ? 'Gestern' : '';
    return [rel ? (klein ? rel.toLowerCase() : rel) : `${wt(v.datum)}, ${fmt.datumKurz(v.datum)}`, zeit(v)].filter(Boolean).join(' · ');
  }

  /* ================= Index: Kunde → Einträge (Belege, Einnahmen ohne Beleg, Termine) =================
   * Besuch nur bis heute. Vorbereitete Belege (Entwurf mit `termin`, Termin noch nicht erledigt) zählen nicht und hängen
   * am Termin; erledigte Termine erscheinen über ihren Beleg bzw. ihre Einnahme ohne Beleg (b.termin, buchungen.js) – je mit
   * Kalender-Symbol und mit dem Termindatum –, sonst als „erledigt“. So ist ein Termin immer genau EIN Besuch. */
  function ausBeleg(r, tm, bezahlt = false) {
    const angebot = r.art === 'angebot', storno = r.status === 'storniert', entwurf = r.status === 'entwurf';
    const vorb = entwurf && !!r.termin && !(tm && tm.status === 'erledigt' && !bezahlt);
    const ueber = r.art === 'rechnung' && r.status === 'offen' && !!r.faellig && r.faellig < T;
    const datum = r.leistung || r.datum;
    return {
      id: r.id, beleg: true, art: r.art, datum, betreff: r.betreff || ART[r.art][0], pos: r.positionen || [],
      betrag: D.rechnungSumme(r), nr: r.nr, faellig: r.faellig, zw: r.status === 'bezahlt' ? r.zahlungsart : null,
      status: angebot ? 'angebot' : storno ? 'storniert' : vorb ? 'vorbereitet' : entwurf ? 'entwurf' : ueber ? 'ueberfaellig' : r.status,
      besuch: !angebot && !storno && !vorb && datum <= T, umsatz: !angebot && !storno && !entwurf,
      termin: tm ? { id: tm.id, von: tm.von, bis: tm.bis } : null
    };
  }
  const ausBuchung = (b, tm) => {
    const datum = tm ? tm.datum : b.datum; // Einnahme zum Termin: Besuch am Termintag (wie das Leistungsdatum bei Belegen)
    return { id: b.id, beleg: false, art: 'eingang', datum, betreff: b.text || 'Einnahme', pos: [], betrag: b.betrag, nr: null, zw: b.zahlungsart, status: 'bezahlt',
      besuch: datum <= T, umsatz: true, termin: tm ? { id: tm.id, von: tm.von, bis: tm.bis } : null };
  };
  const ausTermin = (t, vorb) => ({
    id: t.id, beleg: false, art: 'termin', datum: t.datum, von: t.von, bis: t.bis, betreff: t.leistung || 'Termin', notiz: t.notiz || '', pos: [], betrag: t.betrag || 0,
    status: t.status === 'geplant' ? (t.datum < T ? 'nachtragen' : 'geplant') : t.status, // geplant · nachtragen · abgesagt · erledigt
    besuch: t.status === 'erledigt' && t.datum <= T, umsatz: false, vorb: vorb ? { id: vorb.id, art: vorb.art } : null
  });

  function auswerten(x) {
    const { k, e } = x;
    e.sort((a, b) => cmpStr(b.datum, a.datum) || cmpStr(b.von || '', a.von || '') || (a.besuch ? 0 : 1) - (b.besuch ? 0 : 1));
    const bs = e.filter((v) => v.besuch);
    x.besuche = bs.length;
    x.letzter = bs[0] || null;
    x.zuletzt = x.letzter ? x.letzter.datum : null; // nie in der Zukunft (Besuch nur bis heute)
    x.naechster = e.filter((v) => v.status === 'geplant').sort((a, b) => cmpStr(a.datum, b.datum) || cmpStr(a.von || '', b.von || ''))[0] || null;
    x.nachtragen = e.filter((v) => v.status === 'nachtragen');
    x.termine = e.filter((v) => v.art === 'termin').length;
    x.seit = e.length ? (e[e.length - 1].datum < T ? e[e.length - 1].datum : T) : null;
    x.umsatz = e.reduce((s, v) => s + (v.umsatz ? v.betrag : 0), 0);
    x.offen = e.filter((v) => v.status === 'offen' || v.status === 'ueberfaellig');
    x.ueber = x.offen.some((v) => v.status === 'ueberfaellig');
    // Sortierschlüssel „zuletzt da“: neu angelegt ganz oben, dann nur kommende Termine (nächster zuerst), dann nach letztem Besuch
    const vergangen = e.find((v) => v.datum <= T);
    x.sortDatum = x.zuletzt || (x.naechster ? '9' + String(99999999 - +x.naechster.datum.replace(/-/g, '')) : vergangen ? vergangen.datum : e.length ? e[0].datum : '9999');
    e.forEach((v) => { v.hay = norm([v.betreff, ...v.pos.map((p) => p.text), v.nr || '', v.notiz || ''].join(' ')); });
    x.tel = String(k.telefon || '').replace(/\D/g, '');
    x.hay = norm([k.name, k.zusatz, k.nr, k.strasse, k.plz, k.ort, k.telefon, k.email, k.notiz].join(' '));
  }

  function index() {
    const ix = new Map(), byName = new Map();
    D.KONTAKTE.forEach((k) => {
      if (k.art === 'lieferant') return;
      ix.set(k.id, { k, e: [] });
      const n = norm(k.name).trim();
      byName.set(n, byName.has(n) ? null : k.id); // doppelte Namen → nicht eindeutig
    });
    // Kunde über `kontakt`; ältere Einträge ohne Kontakt über einen eindeutigen Namen
    const zu = (x) => ix.get(x.kontakt) || (!x.kontakt && x.kunde ? ix.get(byName.get(norm(x.kunde).trim())) : null);
    const TM = D.TERMINE || [], tmId = new Map(TM.map((t) => [t.id, t])), tmBeleg = new Map(TM.filter((t) => t.beleg).map((t) => [t.beleg, t]));
    const vorbereitet = new Map(); // Beleg-ID → am Termin anzeigen statt als eigener Eintrag
    const belege = new Set();
    const bezahlt = new Map(); // Termin-ID → Einnahme ohne Beleg zu diesem Termin (b.termin)
    D.buchungen.forEach((b) => { if (b.typ === 'einnahme' && !b.rechnung && b.termin && tmId.has(b.termin)) bezahlt.set(b.termin, b); });
    D.rechnungen.forEach((r) => {
      if (!ART[r.art]) return;
      const x = zu(r); if (!x) return;
      const tm = (r.termin && tmId.get(r.termin)) || tmBeleg.get(r.id) || null, bz = !!tm && bezahlt.has(tm.id), v = ausBeleg(r, tm, bz);
      belege.add(r.id);
      if (v.status === 'vorbereitet' && tm && (tm.status !== 'erledigt' || bz)) { vorbereitet.set(r.id, r); return; }
      x.e.push(v);
    });
    D.buchungen.forEach((b) => { if (b.typ !== 'einnahme' || b.rechnung) return; const x = zu(b), tm = b.termin ? tmId.get(b.termin) : null; if (x) x.e.push(ausBuchung(b, tm && tm.status === 'erledigt' ? tm : null)); });
    TM.forEach((t) => {
      if (t.status === 'erledigt' && ((t.beleg && belege.has(t.beleg)) || bezahlt.has(t.id))) return; // steht schon über Beleg bzw. Einnahme im Verlauf
      const x = zu(t); if (!x) return;
      const r = (t.beleg && vorbereitet.get(t.beleg)) || D.rechnungen.find((y) => y.termin === t.id && vorbereitet.has(y.id)) || null;
      x.e.push(ausTermin(t, r));
    });
    ix.forEach(auswerten);
    return ix;
  }

  /* ================= Liste ================= */
  const FILTER = { alle: () => true, stamm: (x) => x.besuche >= 2, notiz: (x) => !!String(x.k.notiz || '').trim() };
  const SORT = {
    zuletzt: (a, b) => cmpStr(a.sortDatum, b.sortDatum),
    name: (a, b) => coll.compare(a.k.name, b.k.name),
    besuche: (a, b) => a.besuche - b.besuche || cmpStr(a.sortDatum, b.sortDatum)
  };

  /* Suche: Stammdaten + Notiz; sonst eine Leistung/Beleg-Nr. im Verlauf (→ wird in der Zeile gezeigt) */
  function treffer(x, q, qd) {
    if (!q) return {};
    if (x.hay.includes(q) || (qd.length >= 3 && x.tel.includes(qd))) return {};
    const v = x.e.find((e) => e.hay.includes(q));
    return v ? { v } : null;
  }

  function leistungZelle(x, q, v) {
    const e = v || x.letzter || x.naechster || x.e[0]; // ohne Besuch: kommender Termin, sonst jüngster Eintrag (Angebot, abgesagt …)
    if (!e) return '<span class="ku-z muted">noch kein Besuch</span>';
    const b = e.status !== 'bezahlt' ? STATUS[e.status] : x.ueber ? STATUS.ueberfaellig : x.offen.length ? STATUS.offen : null;
    let sub = '';
    if (v) { // Treffer in einer Leistung: was passt und wann
      const p = norm(v.betreff).includes(q) ? '' : ((v.pos.find((p) => norm(p.text).includes(q)) || {}).text || (v.nr && norm(v.nr).includes(q) ? v.nr : ''));
      const wann = v !== x.letzter ? fmt.datum(v.datum) : '';
      if (p || wann) sub = `<small class="ku-z">${p ? hl(p, q) : ''}${p && wann ? ' · ' : ''}${wann}</small>`;
    }
    return `<span class="ku-z ku-lz"><span class="ku-tx">${hl(e.betreff, q)}</span>${b ? `<span class="badge ${b[0]}">${b[1]}</span>` : ''}</span>${sub}`;
  }

  function zeile(x, q, qd, h) {
    const k = x.k, ntz = String(k.notiz || '').trim();
    const telHit = q && k.telefon && (norm(k.telefon).includes(q) || (qd.length >= 3 && x.tel.includes(qd)));
    const mailHit = q && k.email && norm(k.email).includes(q);
    const adr = [k.strasse, k.ort].filter(Boolean).join(', ');
    const adrZ = telHit ? `${icon('phone')}${hl(k.telefon, q)}` : mailHit ? `${icon('mail')}${hl(k.email, q)}` : adr ? hl(adr, q) : '<span class="muted">–</span>';
    // „Zuletzt da“: Datum des letzten Besuchs; darunter der nächste Termin (sonst „vor …“) bzw. ein nachzutragender Termin
    const n = x.naechster, nt = x.nachtragen[0];
    const unter = n ? `<small class="ku-z ku-next" data-tip="${esc(terminLang(n) + ' · ' + n.betreff)}" data-tip-title="Nächster Termin">${icon('calendar')}nächster: ${esc(terminKurz(n))}</small>`
      : nt && !x.zuletzt ? `<small class="ku-z warn-t" data-tip="${esc(terminLang(nt) + ' · ' + nt.betreff)}" data-tip-title="Termin nachtragen">${icon('calendar')}${esc(terminKurz(nt))} nachtragen</small>`
        : x.zuletzt ? `<small class="ku-z">${vor(x.zuletzt)}</small>` : '';
    const zuletzt = `${x.zuletzt ? `<span class="ku-z num">${fmt.datum(x.zuletzt)}</span>` : '<span class="ku-z muted">–</span>'}${unter}`;
    return `<tr class="row${sel === k.id ? ' selected' : ''}" data-k="${esc(k.id)}" tabindex="0">
      <td class="l"><div class="cell-main">${App.monogram(k.name, 'sm')}<span class="t"><b>${hl(k.name, q)}</b>${k.zusatz ? `<small>${hl(k.zusatz, q)}</small>` : ''}</span></div></td>
      <td class="l ku-c-adr"><span class="ku-z ku-adr">${adrZ}</span></td>
      <td class="c num ku-c-bes">${x.besuche || '<span class="muted">–</span>'}</td>
      <td class="l ku-c-last">${zuletzt}</td>
      <td class="l ku-c-leist">${leistungZelle(x, q, h.v)}</td>
      <td class="num ku-c-ums">${x.umsatz ? fmt.eur(x.umsatz) : '<span class="muted">–</span>'}</td>
      <td class="c ku-c-ntz">${ntz ? `<span class="ku-ntz${q && norm(ntz).includes(q) ? ' on' : ''}" data-tip="${esc(ntz)}" data-tip-title="Notiz" role="img" aria-label="Notiz: ${esc(ntz)}">${IC_NOTIZ}</span>` : ''}</td>
    </tr>`;
  }

  function leerHTML(q) {
    const alle = st.filter !== 'alle' ? `<button type="button" class="link" data-ku="alle">${icon('users')}In allen Kunden suchen</button>` : '';
    const inhalt = q
      ? `${icon('search')}<b>Keine Treffer für „${esc(st.q.trim())}“</b><span>Name, Straße, Ort, Telefon, Notiz oder eine Leistung versuchen.</span>
         <div class="row wrap ku-leer-act"><button type="button" class="btn ghost" data-ku="neu" data-name="${esc(st.q.trim())}">${icon('plus')}„${esc(st.q.trim())}“ als Kunde anlegen</button>${alle}</div>`
      : st.filter === 'stamm' ? `${icon('users')}<b>Noch keine Stammkunden</b><span>Hier erscheinen Kunden, bei denen du mindestens zweimal warst.</span>`
        : st.filter === 'notiz' ? `${IC_NOTIZ}<b>Noch keine Notizen</b><span>Notizen wie „Hund im Garten – Tor schließen“ schreibst du in der Kundenansicht.</span>`
          : `${icon('users')}<b>Noch keine Kunden</b><span>Kunden entstehen mit jeder Quittung oder Rechnung – oder hier über „Kunde anlegen“.</span>`;
    return `<tr class="ku-leer"><td colspan="7"><div class="empty">${inhalt}</div></td></tr>`;
  }

  function segHTML() {
    const n = (f) => { let c = 0; V.ix.forEach((x) => { if (FILTER[f](x)) c++; }); return c; };
    return App.seg('local', 'ku-filter', [['alle', `Alle <span class="cnt">${n('alle')}</span>`], ['stamm', `Stammkunden <span class="cnt">${n('stamm')}</span>`], ['notiz', `mit Notiz <span class="cnt">${n('notiz')}</span>`]], st.filter);
  }
  function zeichneSeg() {
    V.seg.innerHTML = segHTML();
    const b = $('[data-value="stamm"]', V.seg); if (b) b.title = 'Kunden mit 2 oder mehr Besuchen';
    const seg = V.seg; // V kann bis zum nächsten Frame weg sein (Notiz speichert beim Seitenwechsel, danach räumt die Seite auf)
    requestAnimationFrame(() => { if (seg.isConnected) App.updateSegs(seg); });
  }
  function zeichneSort() {
    $$('th[data-sort]', V.root).forEach((th) => {
      const on = th.dataset.sort === st.sort;
      th.classList.toggle('on', on);
      th.dataset.dir = on ? (st.dir < 0 ? '↓' : '↑') : '';
      th.setAttribute('aria-sort', on ? (st.dir < 0 ? 'descending' : 'ascending') : 'none');
    });
  }

  function liste() {
    if (!V || !V.root.isConnected) return;
    const q = norm(st.q.trim()), qd = /\d/.test(q) ? q.replace(/\D/g, '') : '';
    const rows = [];
    V.ix.forEach((x) => { if (!FILTER[st.filter](x)) return; const h = treffer(x, q, qd); if (h) rows.push([x, h]); });
    rows.sort((a, b) => SORT[st.sort](a[0], b[0]) * st.dir || coll.compare(a[0].k.name, b[0].k.name));
    V.tbody.innerHTML = rows.length ? rows.map(([x, h]) => zeile(x, q, qd, h)).join('') : leerHTML(q);
    const ges = V.ix.size;
    V.count.textContent = rows.length === ges ? plural(ges, 'Kunde', 'Kunden') : `${rows.length} von ${ges}`;
  }

  /* Nach Änderungen (Notiz, Stammdaten, neu, gelöscht): Index neu, Liste neu */
  function refresh() {
    if (!V || !V.root.isConnected) return;
    V.ix = index();
    zeichneSeg();
    liste();
  }
  function markSel(id) {
    sel = id;
    if (V) $$('tr[data-k]', V.tbody).forEach((tr) => tr.classList.toggle('selected', tr.dataset.k === id));
  }

  /* ================= Seite ================= */
  function render(el, route) {
    el.innerHTML = `<div class="page ku-page">
      <div class="page-head reveal" style="--i:0">
        <div><h1>${icon('users')}Kunden</h1><p class="page-sub">Bei wem du warst – wann und was gemacht wurde</p></div>
        <div class="page-actions">
          <label class="ku-search">${icon('search')}<input type="search" class="input" id="kuQ" value="${esc(st.q)}" placeholder="Name, Straße, Ort, Telefon, Notiz, Leistung …" aria-label="Kunden durchsuchen" autocomplete="off" spellcheck="false"></label>
          <button type="button" class="btn-primary head-add" data-ku="neu">${icon('plus')}Kunde anlegen</button>
        </div>
      </div>
      <section class="card flush ku-liste reveal" style="--i:1">
        <div class="ku-bar"><div class="ku-seg"></div><span class="ku-count"></span></div>
        <div class="table-wrap"><table class="fin-table ku-table">
          <thead><tr>
            <th class="l" data-sort="name"><button type="button" class="ku-th" data-sort="name">Kunde</button></th>
            <th class="l ku-c-adr">Adresse</th>
            <th class="c ku-c-bes" data-sort="besuche"><button type="button" class="ku-th" data-sort="besuche">Besuche</button></th>
            <th class="l ku-c-last" data-sort="zuletzt"><button type="button" class="ku-th" data-sort="zuletzt">Zuletzt da</button></th>
            <th class="l ku-c-leist">Letzte Leistung</th>
            <th class="ku-c-ums">Umsatz</th>
            <th class="c ku-c-ntz"><span class="sr-only">Notiz</span></th>
          </tr></thead>
          <tbody></tbody>
        </table></div>
      </section>
    </div>`;
    const root = el.firstElementChild;
    V = { root, tbody: $('tbody', root), seg: $('.ku-seg', root), count: $('.ku-count', root), ix: index() };
    zeichneSeg(); zeichneSort(); liste();

    root.addEventListener('input', (e) => { if (e.target.id === 'kuQ') { st.q = e.target.value; liste(); } }); // ~225 Zeilen: direkt neu zeichnen
    root.addEventListener('seg-change', (e) => { if (e.detail.key === 'ku-filter') { st.filter = e.detail.value; liste(); } });
    root.addEventListener('click', (e) => {
      const s = e.target.closest('[data-sort]');
      if (s) {
        const k = s.dataset.sort;
        if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = SORT_DIR[k]; }
        zeichneSort(); liste(); return;
      }
      const b = e.target.closest('[data-ku]');
      if (b) {
        if (b.dataset.ku === 'neu') openDetail(null, { neu: true, name: b.dataset.name || '' });
        else if (b.dataset.ku === 'alle') { st.filter = 'alle'; zeichneSeg(); liste(); }
        return;
      }
      const tr = e.target.closest('tr[data-k]');
      if (tr && !e.target.closest('a')) openDetail(tr.dataset.k);
    });
    root.addEventListener('keydown', (e) => {
      if (e.target.id === 'kuQ') {
        if (e.key === 'Escape' && st.q) { e.preventDefault(); e.stopPropagation(); e.target.value = st.q = ''; liste(); }
        else if (e.key === 'ArrowDown') { const tr = $('tr[data-k]', V.tbody); if (tr) { e.preventDefault(); tr.focus(); } }
        else if (e.key === 'Enter') { const trs = $$('tr[data-k]', V.tbody); if (trs.length === 1) openDetail(trs[0].dataset.k); }
        return;
      }
      const tr = e.target.closest && e.target.closest('tr[data-k]');
      if (!tr || e.target !== tr) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(tr.dataset.k); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling;
        if (n && n.dataset.k) n.focus(); else if (e.key === 'ArrowUp') $('#kuQ', root).focus();
      }
    });

    // Direktlink #/kunden?k=<id> (Suche ⌘K, andere Seiten) bzw. ?neu=1&name=…: Schublade öffnen, Parameter entfernen
    const P = route.params || {};
    if (P.k || P.neu) {
      history.replaceState(null, '', '#/kunden');
      if (P.neu) openDetail(null, { neu: true, name: P.name || '' });
      else if (V.ix.has(P.k)) openDetail(P.k);
      else App.toast('Diesen Kunden gibt es nicht (mehr).', { icon: 'alert' });
    }
    return () => { if (V && V.root === root) V = null; };
  }

  /* ================= Schublade: Kunde ================= */
  function posKurz(v) {
    if (!v.pos.length) return '';
    const t = v.pos.slice(0, 3).map((p) => (p.einheit && p.einheit !== 'pausch.' ? `${p.text} · ${mengeNF.format(+p.menge || 0)} ${p.einheit}` : p.text)).join(', ')
      + (v.pos.length > 3 ? ` + ${v.pos.length - 3} weitere` : '');
    return t === v.betreff ? '' : t;
  }

  /* Termin im Verlauf: geplant (oben, Zukunft) · nachtragen · abgesagt (durchgestrichen) · erledigt ohne Beleg */
  function terminHTML(v) {
    const [cls, label] = STATUS[v.status] || ['', v.status];
    const vb = v.vorb ? `<a class="ku-nr txt" href="#/beleg/${encodeURIComponent(v.vorb.id)}" title="Vorbereiteten Beleg öffnen">${icon(ART[v.vorb.art][1])}${ART[v.vorb.art][0]} vorbereitet</a>` : '';
    return `<li class="ku-ev ku-ev-t s-${v.status}">
      <div class="ku-ev-d"><b class="num">${fmt.datum(v.datum)}</b><small>${vor(v.datum)}</small></div>
      <div class="ku-ev-m"><b>${esc(v.betreff)}</b>${v.notiz ? `<small class="ku-ev-ntz">${esc(v.notiz)}</small>` : ''}
        <span class="ku-ev-meta"><a class="ku-nr txt" href="#/termine?t=${encodeURIComponent(v.id)}" title="Termin öffnen">${icon('calendar')}Termin${v.von ? ' ' + esc(zeit(v)) : ''}</a>${vb}</span></div>
      <div class="ku-ev-r">${v.betrag ? `<b class="num" title="geschätzt">ca. ${fmt.eur(v.betrag)}</b>` : ''}<span class="badge ${cls}">${label}</span></div>
    </li>`;
  }

  function eintragHTML(v) {
    if (v.art === 'termin') return terminHTML(v);
    const z = v.zw ? D.zahlungsart(v.zw) : null, [cls, label] = STATUS[v.status] || ['', v.status];
    const tm = v.termin ? `<a class="ku-nr txt" href="#/termine?t=${encodeURIComponent(v.termin.id)}" title="Termin öffnen">${icon('calendar')}${esc(zeit(v.termin) || 'Termin')}</a>` : '';
    const frist = v.status === 'ueberfaellig' ? `fällig seit ${fmt.datum(v.faellig)}` : v.status === 'offen' && v.art === 'rechnung' && v.faellig ? `fällig ${fmt.rel(v.faellig)}` : '';
    const nr = v.beleg
      ? `<a class="ku-nr${v.nr ? '' : ' leer'}" href="#/beleg/${encodeURIComponent(v.id)}" title="${ART[v.art][0]} öffnen">${icon(ART[v.art][1])}${esc(v.nr || 'Entwurf')}</a>`
      : `<a class="ku-nr leer" href="#/buchungen?b=${encodeURIComponent(v.id)}" title="Einnahme öffnen">${icon('swap')}ohne Beleg</a>`;
    const pos = posKurz(v);
    return `<li class="ku-ev s-${v.status}">
      <div class="ku-ev-d"><b class="num">${fmt.datum(v.datum)}</b><small>${vor(v.datum)}</small></div>
      <div class="ku-ev-m"><b>${esc(v.betreff)}</b>${pos ? `<small>${esc(pos)}</small>` : ''}
        <span class="ku-ev-meta">${nr}${tm}${z ? `<span>${icon(z.icon)}${esc(z.kurz)}</span>` : ''}${frist ? `<span class="${v.status === 'ueberfaellig' ? 'neg-t' : ''}">${icon('clock')}${frist}</span>` : ''}</span></div>
      <div class="ku-ev-r"><b class="num">${fmt.eur(v.betrag)}</b><span class="badge ${cls}">${label}</span></div>
    </li>`;
  }

  function kopfHTML(x) {
    const k = x.k, ort = [k.plz, k.ort].filter(Boolean).join(' '), adr = [k.strasse, ort].filter(Boolean).join(', ');
    const wege = [
      adr && `<a class="ku-weg" href="https://maps.apple.com/?q=${encodeURIComponent(adr)}" target="_blank" rel="noopener" title="In Karten öffnen">${icon('pin')}${esc(adr)}</a>`,
      k.telefon && `<a class="ku-weg" href="tel:${esc(String(k.telefon).replace(/[^\d+]/g, ''))}" title="Anrufen">${icon('phone')}${esc(k.telefon)}</a>`,
      k.email && `<a class="ku-weg" href="mailto:${esc(k.email)}" title="E-Mail schreiben">${icon('mail')}${esc(k.email)}</a>`
    ].filter(Boolean);
    const kenn = x.besuche
      ? [`<b>${plural(x.besuche, 'Besuch', 'Besuche')}</b>`, `zuletzt ${vor(x.zuletzt)}`, `Kunde seit ${fmt.monat(x.seit)}`]
      : ['<b>Noch kein Besuch</b>', x.seit ? `Kunde seit ${fmt.monat(x.seit)}` : 'neu angelegt'];
    if (x.umsatz) kenn.push(`${fmt.eur(x.umsatz)} Umsatz`);
    const hw = (cls, href, ic, html, rechts = '') => `<a class="ku-hw ${cls}" href="${href}">${icon(ic)}<span>${html}</span>${rechts ? `<small>${rechts}</small>` : ''}${icon('chevR')}</a>`;
    const n = x.naechster, nTage = n ? U.diffDays(T, n.datum) : 0;
    const hinweise = (n ? hw('acc', `#/termine?t=${encodeURIComponent(n.id)}`, 'calendar', `<b>Nächster Termin:</b> ${esc(terminLang(n))} · ${esc(n.betreff)}`, nTage > 1 ? fmt.rel(n.datum) : '') : '')
      + x.nachtragen.map((v) => hw('warn', `#/termine?t=${encodeURIComponent(v.id)}`, 'calendar', `<b>Termin ${esc(terminLang(v, true))}</b> · ${esc(v.betreff)} – noch nicht erledigt`, 'nachtragen')).join('')
      + x.offen.map((v) => hw(v.status === 'ueberfaellig' ? 'neg' : 'acc', `#/beleg/${encodeURIComponent(v.id)}`, v.status === 'ueberfaellig' ? 'alert' : 'clock',
        `<b class="mono">${esc(v.nr || 'Rechnung')}</b> · ${fmt.eur(v.betrag)} offen – ${v.status === 'ueberfaellig' ? `seit ${plural(U.diffDays(v.faellig, T), 'Tag', 'Tagen')} überfällig` : `fällig ${fmt.rel(v.faellig)}`}`)).join('');
    return `<section class="ku-kopf">${App.monogram(k.name, 'lg')}
      <div class="ku-kopf-t">
        <div class="ku-name">${esc(k.name)}${k.nr ? `<span class="ku-knr" title="Kundennummer">${esc(k.nr)}</span>` : ''}</div>${k.zusatz ? `<div class="ku-zusatz">${esc(k.zusatz)}</div>` : ''}
        ${wege.length ? `<div class="ku-wege">${wege.join('')}</div>` : `<button type="button" class="link ku-ergaenzen" data-ku="stamm">${icon('plus')}Adresse oder Telefon ergänzen</button>`}
        <p class="ku-kenn">${kenn.map((t) => `<span>${t}</span>`).join('<i>·</i>')}</p>${hinweise}
      </div></section>`;
  }

  function formHTML(k, neu) {
    const f = (name, label, attrs = '', cls = 'full') => `<div class="field ${cls}"><label for="kuF-${name}">${label}</label><input class="input" id="kuF-${name}" name="${name}" value="${esc(k[name] || '')}" autocomplete="off" ${attrs}></div>`;
    return `<form class="form ku-form" id="kuForm" novalidate>
      <div class="form-grid">
        ${f('name', 'Name <span class="ku-pfl">Pflicht</span>', 'required placeholder="Vor- und Nachname oder Firma"')}
        <p class="hint full ku-dup" hidden></p>
        ${f('zusatz', 'Zusatz', 'placeholder="z. B. Ansprechpartner, Objekt"')}
        ${f('strasse', 'Straße und Hausnummer')}
        <div class="full ku-plzort">${f('plz', 'PLZ', 'inputmode="numeric" maxlength="5"', '')}${f('ort', 'Ort', '', '')}</div>
        ${f('telefon', 'Telefon', 'type="tel"', '')}${f('email', 'E-Mail', 'type="email"', '')}
        ${neu ? `<div class="field full"><label for="kuF-notiz">Notiz</label><textarea class="textarea" id="kuF-notiz" name="notiz" rows="2" placeholder="z. B. Hund im Garten – Tor immer schließen"></textarea><p class="hint ku-notiz-hint">Nur notieren, was du für den Auftrag brauchst – keine Angaben zu Gesundheit, Religion o. Ä. (Datenschutz).</p></div>` : ''}
      </div>
      ${neu ? '' : `<p class="hint ku-gobd">${icon('lock')}<span>Bereits ausgestellte Belege behalten ihre Angaben (GoBD) – Änderungen gelten für neue Belege.</span></p>
      <div class="row"><button type="submit" class="btn-primary sm">${icon('check')}Speichern</button><button type="button" class="btn ghost" data-ku="abbrechen">Abbrechen</button></div>`}
    </form>`;
  }

  function fill(s) {
    const body = $('.drawer-body', s.d), foot = $('.drawer-foot', s.d);
    const h2 = $('.drawer-head h2', s.d);
    if (h2) h2.innerHTML = `${icon(s.neu ? 'plus' : 'user')}<span>${s.neu ? 'Kunde anlegen' : 'Kunde'}</span>`;
    if (s.neu) {
      body.innerHTML = `<section><h3>Stammdaten</h3>${formHTML({ name: s.name }, true)}</section>`;
      foot.innerHTML = `<span class="spacer"></span><button type="button" class="btn ghost" data-action="close-drawer">Abbrechen</button><button type="submit" form="kuForm" class="btn-primary sm">${icon('check')}Kunde anlegen</button>`;
      dupHint(s, s.name);
      return;
    }
    const x = index().get(s.id);
    if (!x) { App.drawer.close(); return; }
    const k = x.k, ang = x.e.filter((v) => v.art === 'angebot').length, gepl = x.e.filter((v) => v.status === 'geplant').length;
    if (!k.nr && D.kundenNr) { D.kundenNr(k); App.save(); } // feste Kundennummer (ältere Daten)
    // Verlauf neueste oben; Kommendes (Zukunft, geplante Termine von heute) über einem „heute“-Trenner
    const kommend = (v) => v.datum > T || (v.status === 'geplant' && v.datum === T);
    let tl = '', trenner = x.e.some(kommend);
    x.e.forEach((v) => { if (trenner && !kommend(v)) { tl += '<li class="ku-heute" aria-hidden="true"><span>heute</span></li>'; trenner = false; } tl += eintragHTML(v); });
    body.innerHTML = kopfHTML(x)
      + `<section class="ku-notiz-sec"><div class="ku-sec-h"><h3><label for="kuNotiz">Notiz</label></h3><span class="ku-saved" aria-live="polite">speichert automatisch</span></div>
          <textarea class="textarea ku-notiz${k.notiz ? ' voll' : ''}" id="kuNotiz" rows="2" placeholder="z. B. Hund im Garten – Tor immer schließen">${esc(k.notiz || '')}</textarea><p class="hint ku-notiz-hint">Nur notieren, was du für den Auftrag brauchst – keine Angaben zu Gesundheit, Religion o. Ä. (Datenschutz).</p></section>`
      + `<section class="ku-stamm-sec"><details class="ku-stamm"><summary>${icon('edit')}<span>Stammdaten bearbeiten</span>${icon('chevD', 'ku-chev')}</summary>${formHTML(k, false)}</details></section>`
      + `<section class="ku-verlauf"><div class="ku-sec-h"><h3>Verlauf</h3><span>${x.besuche ? plural(x.besuche, 'Besuch', 'Besuche') : 'noch kein Besuch'}${gepl ? ' · ' + plural(gepl, 'Termin', 'Termine') + ' geplant' : ''}${ang ? ' · ' + plural(ang, 'Angebot', 'Angebote') : ''}</span></div>
          ${x.e.length ? `<ol class="ku-tl">${tl}</ol>` : '<p class="hint">Noch nichts erfasst. Mit „Neuen Auftrag erfassen“ trägst du den ersten Besuch ein – mit Quittung oder Rechnung.</p>'}</section>`;
    foot.innerHTML = `${loeschbar(k.id) ? `<button type="button" class="btn danger ku-del" data-ku="loeschen" title="Kunde löschen" aria-label="Kunde löschen">${icon('trash')}</button>` : fristHTML(k)}<span class="spacer"></span>
      <button type="button" class="btn ghost" data-ku="termin">${icon('calendar')}Termin eintragen</button>
      <button type="button" class="btn-primary sm" data-ku="auftrag">${icon('plus')}Neuen Auftrag erfassen</button>`;
  }

  /* Löschen nur, solange nichts am Kunden hängt (Belege, Buchungen, Termine) */
  const loeschbar = (id) => !D.rechnungen.some((r) => r.kontakt === id) && !D.buchungen.some((b) => b.kontakt === id) && !(D.TERMINE || []).some((t) => t.kontakt === id);

  /* Datenschutz (DSGVO) vs. Aufbewahrung: Hängen Buchungen oder ausgestellte Belege am Kunden, dürfen seine Daten erst nach
   * Ablauf der Fristen weg – Belege 8, Aufzeichnungen 10 Jahre, Beginn am Ende des Kalenderjahres; es gilt die längere.
   * Danach „Anonymisieren“: Name, Anschrift, Kontakt und Notiz verschwinden (auch in Belegen, Buchungen, Terminen), Nummer und Beträge bleiben. */
  const FRIST_JAHRE = 10;
  function aufbewahrung(id) {
    const jahre = [...D.rechnungen.filter((r) => r.kontakt === id && r.nr).map((r) => r.datum), ...D.buchungen.filter((b) => b.kontakt === id).map((b) => b.datum)]
      .filter(Boolean).map((d) => +String(d).slice(0, 4));
    if (!jahre.length) return null;
    const j = Math.max(...jahre) + FRIST_JAHRE;
    return { bis: `${j}-12-31`, ab: `${j + 1}-01-01` };
  }
  function fristHTML(k) {
    if (k.anonymisiert) return `<span class="ku-frist">${icon('lock')}Anonymisiert am ${fmt.datum(k.anonymisiert)}</span>`;
    const f = aufbewahrung(k.id);
    if (!f) return '';
    if (T >= f.ab) return `<button type="button" class="btn danger" data-ku="anonym" title="Aufbewahrungsfrist abgelaufen – persönliche Daten entfernen">${icon('user')}Anonymisieren</button>`;
    return `<span class="ku-frist" tabindex="0" data-tip-title="Aufbewahrungsfrist" data-tip="Belege und Buchungen dieses Kunden müssen bis ${fmt.datum(f.bis)} aufbewahrt werden (Belege 8, Aufzeichnungen 10 Jahre). Ab ${fmt.datum(f.ab)} kannst du den Kunden hier anonymisieren – Name, Anschrift, Kontakt und Notiz werden dann entfernt.">${icon('lock')}Löschen ab ${f.ab.slice(0, 4)}</span>`;
  }
  function anonymisieren(s) {
    const k = D.kontakt(s.id), f = aufbewahrung(s.id);
    if (!k || !f || T < f.ab) return;
    if (!confirm(`${k.name} anonymisieren?\n\nName, Anschrift, Kontaktdaten und Notiz werden entfernt – auch in den alten Belegen, Buchungen und Terminen. Die Kundennummer und die Beträge bleiben. Das lässt sich nicht rückgängig machen.`)) return;
    const name = `Ehemaliger Kunde ${D.kundenNr(k)}`;
    D.rechnungen.forEach((r) => { if (r.kontakt === k.id) { r.kunde = name; r.kundeAdresse = ''; } });
    D.buchungen.forEach((b) => { if (b.kontakt === k.id) b.kunde = name; });
    (D.TERMINE || []).forEach((t) => { if (t.kontakt === k.id) Object.assign(t, { kunde: name, adresse: '', notiz: '' }); });
    Object.assign(k, { name, zusatz: '', strasse: '', plz: '', ort: '', email: '', telefon: '', notiz: '', anonymisiert: T });
    App.save(); refresh(); fill(s);
    App.toast(`Anonymisiert: ${name}`, { icon: 'lock' });
  }

  /* Gibt es den Namen schon? (nur beim Anlegen) – Hinweis mit Nummer; Anlegen bleibt erlaubt (eigene Nummer, kein Problem) */
  function dupHint(s, val) {
    const p = $('.ku-dup', s.d); if (!p) return;
    const gleich = App.kundeAusEingabe(val).liste.filter((k) => k.art !== 'lieferant');
    p.hidden = !gleich.length;
    p.innerHTML = gleich.length ? `${icon('info')}<span>Gibt es schon: ${gleich.slice(0, 3).map((k) => `<button type="button" class="link" data-ku="oeffnen" data-id="${esc(k.id)}">${esc([D.kundenNr(k), k.ort].filter(Boolean).join(' · '))}</button>`).join(', ')}${gleich.length > 3 ? ` (+${gleich.length - 3})` : ''} – trotzdem neu anlegen?</span>` : '';
  }

  /* Notiz: verzögert bzw. beim Verlassen speichern; Toast einmal je Bearbeitung */
  function notizSpeichern(s) {
    clearTimeout(s.timer);
    if (!s.dirty || s.neu) return;
    s.dirty = false;
    const k = D.kontakt(s.id), ta = $('.ku-notiz', s.d);
    if (!k || !ta) return;
    const wert = ta.value.trim();
    if (wert === String(k.notiz || '').trim()) return;
    k.notiz = wert;
    App.save();
    const sv = $('.ku-saved', s.d); if (sv) sv.innerHTML = `${icon('check')}gespeichert`;
    if (!s.toasted) { s.toasted = true; App.toast('Notiz gespeichert'); }
    refresh();
  }

  function speichern(s) {
    const f = $('.ku-form', s.d); if (!f) return;
    const val = (n) => (f.elements[n] ? String(f.elements[n].value).trim() : '');
    const name = val('name');
    if (!name) { const i = f.elements.name; i.classList.add('invalid'); i.focus(); App.toast('Bitte einen Namen eingeben', { icon: 'alert' }); return; }
    const felder = { name, zusatz: val('zusatz'), strasse: val('strasse'), plz: val('plz'), ort: val('ort'), email: val('email'), telefon: val('telefon') };
    if (s.neu) {
      const k = { id: 'k' + Date.now().toString(36), art: 'kunde', ...felder, notiz: val('notiz') };
      D.KONTAKTE.push(k);
      if (D.kundenNr) D.kundenNr(k); // K-0232 …
      App.save();
      s.neu = false; s.id = k.id;
      refresh(); fill(s); markSel(k.id);
      const tr = V && $(`tr[data-k="${k.id}"]`, V.tbody); if (tr) tr.scrollIntoView({ block: 'nearest' });
      App.toast(`${k.name} angelegt`);
      return;
    }
    const k = D.kontakt(s.id); if (!k) return;
    notizSpeichern(s);
    // Ausgestellte Belege behalten ihren Schnappschuss (belege.js friert ihn beim Laden ein); Entwürfe ohne Nummer und
    // Termine führen den Namen mit (Suche ⌘K und Belegliste lesen dort den gespeicherten Namen)
    const alt = k.name;
    D.rechnungen.forEach((r) => { if (r.kontakt === k.id && !r.nr && r.status === 'entwurf' && r.kunde === alt) r.kunde = felder.name; });
    (D.TERMINE || []).forEach((t) => { if (t.kontakt === k.id) t.kunde = felder.name; });
    Object.assign(k, felder);
    App.save();
    refresh(); fill(s);
    App.toast('Stammdaten gespeichert');
  }

  function loeschen(s) {
    const i = D.KONTAKTE.findIndex((k) => k.id === s.id);
    if (i < 0 || !loeschbar(s.id)) return;
    s.dirty = false;
    const [k] = D.KONTAKTE.splice(i, 1);
    App.save();
    App.drawer.close();
    refresh();
    App.toast(`${k.name} gelöscht`, { icon: 'trash', action: { label: 'Rückgängig', fn: () => { D.KONTAKTE.splice(Math.min(i, D.KONTAKTE.length), 0, k); App.save(); refresh(); } } });
  }

  function openDetail(id, { neu = false, name = '' } = {}) {
    if (!neu && !D.kontakt(id)) return;
    const s = { id, neu, name, timer: 0, dirty: false, toasted: false, d: null };
    s.d = App.drawer.open({ id: 'kunde', title: neu ? 'Kunde anlegen' : 'Kunde', icon: neu ? 'plus' : 'user', width: 560, foot: '<span class="spacer"></span>',
      onClose: () => { notizSpeichern(s); markSel(null); } });
    const d = s.d;
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ku]'); if (!b) return;
      const a = b.dataset.ku, det = $('.ku-stamm', d);
      if (a === 'auftrag') { const kid = s.id; App.drawer.close(); App.erfassen({ typ: 'einnahme', kontakt: kid }); }
      else if (a === 'termin') {
        const kid = s.id; App.drawer.close();
        if (typeof App.neuerTermin === 'function') App.neuerTermin({ kontakt: kid }); else App.go('#/termine?neu=1&kontakt=' + encodeURIComponent(kid));
      }
      else if (a === 'loeschen') loeschen(s);
      else if (a === 'anonym') anonymisieren(s);
      else if (a === 'oeffnen') openDetail(b.dataset.id);
      else if (a === 'abbrechen' && det) { $('.ku-form', d).reset(); $$('.invalid', d).forEach((x) => x.classList.remove('invalid')); det.open = false; }
      else if (a === 'stamm' && det) { det.open = true; const i = $('[name="strasse"]', det); if (i) i.focus(); }
    });
    d.addEventListener('submit', (e) => { e.preventDefault(); speichern(s); });
    d.addEventListener('input', (e) => {
      const t = e.target;
      if (t.classList.contains('invalid')) t.classList.remove('invalid');
      if (t.matches('.ku-notiz')) {
        s.dirty = true;
        t.classList.toggle('voll', !!t.value.trim());
        const sv = $('.ku-saved', d); if (sv) sv.textContent = '…';
        clearTimeout(s.timer); s.timer = setTimeout(() => notizSpeichern(s), 900);
      } else if (s.neu && t.name === 'name') dupHint(s, t.value);
    });
    d.addEventListener('focusin', (e) => { if (e.target.matches('.ku-notiz')) s.toasted = false; });
    d.addEventListener('focusout', (e) => { if (e.target.matches('.ku-notiz')) notizSpeichern(s); });
    d.addEventListener('toggle', (e) => { if (e.target.matches('.ku-stamm') && e.target.open) { const i = $('[name="name"]', e.target); if (i && !$('[name="strasse"]', e.target).matches(':focus')) i.focus({ preventScroll: true }); } }, true);
    fill(s);
    markSel(neu ? null : id);
    if (neu) setTimeout(() => { const i = $('[name="name"]', d); if (i && d.isConnected) { i.focus({ preventScroll: true }); if (name) i.setSelectionRange(name.length, name.length); } }, 80);
  }

  App.page('kunden', { title: 'Kunden', icon: 'users', nav: true, order: 30, desc: 'Wer, wann, was gemacht', render });
})();
