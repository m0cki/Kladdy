/* Kladdy – Prototyp · Kern
 * Shell (Seitenleiste, Topbar, Suche/Befehlspalette), Routing, Einstellungen (Hell/Dunkel, Themes),
 * Schubladen, Toasts, Tooltips, Datei-Drop, Formatierung und das Vorschau-Modell (Liquidität).
 * Seiten liegen in js/pages/*.js und melden sich mit App.page(id, { … }) an.
 *
 * Navigation (bewusst schlank): Ein- & Ausgänge · Termine · Rechnungen & Quittungen · Kunden · Auswertung.
 * Unterseiten hängen per `parent` an einem Menüpunkt (z. B. beleg/vorlagen → rechnungen);
 * die Auswertung hat einen großen Umschalter: App.auswertungKopf(aktiveId, actionsHTML).
 *
 * Kurzreferenz für Seiten:
 *   App.page('id', { title, icon, nav: true, order, parent, desc, render(el, route) })   route = { parts, params }
 *   App.go('#/buchungen?b=b12') · App.rerender() · App.action('name', (el, ev) => …)  → data-action="name"
 *   App.fmt.eur(cent) · eurE(euro) · pct(anteil) · datum(iso) · monat(iso) · rel(iso) · num(v, d)
 *   App.seg(kind, key, [[wert, label]], aktiv)  kind: 'setting' | 'state' | 'local' (→ Event 'seg-change' {key, value})
 *   App.periodHTML() · App.period() → { typ, von, bis, label } · App.vergleich(p)
 *   App.drawer.open({ id, title, sub, icon, width, body, foot, onMount(root), onClose }) · App.drawer.close()
 *   App.toast(text, { action: { label, fn } }) · App.countUp(root) · App.kpi({...}) · App.monogram(name, size)
 *   App.dropTarget = (files) => …   (pro Seite; wird beim Seitenwechsel zurückgesetzt)
 *   App.prognose(opts) → Vorschau (kumulierter Überschuss) · App.kz(kennzahl, periode) → Wert · App.fctx(periode)
 *   App.kundeAusEingabe(text) → { k, liste, neu, name } · App.kundenOptionen() · App.kundenLabel(k) – Kunden über ihre Nummer wählen
 *   App.erfassen({ typ, beleg: 'quittung'|'rechnung', kontakt, betrag, text, datum, entwurf: <Beleg-ID>, termin: <Termin-ID> })
 *     → die eine Erfassen-Schublade; mit `entwurf` wird ein vorbereiteter Beleg (ohne Nummer) ausgestellt statt ein neuer angelegt
 *   App.save() speichert Änderungen an DATA im localStorage.
 */
(() => {
  'use strict';
  const D = window.DATA, U = D.util;
  const APP_NAME = 'Kladdy';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* Datei-Modus ohne Speicher */ } }
  };

  /* ================= Icons (Lucide-Stil, 24er Raster, Strich 1.8) ================= */
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m20.5 20.5-4.2-4.2"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/><path class="pnl-chev" d="m15.5 9.5-2.5 2.5 2.5 2.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon: '<path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    chevL: '<path d="m15 18-6-6 6-6"/>',
    chevR: '<path d="m9 18 6-6-6-6"/>',
    chevD: '<path d="m6 9 6 6 6-6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowUR: '<path d="M7 17 17 7M8.5 7H17v8.5"/>',
    dashboard: '<rect x="3.5" y="3.5" width="7" height="9" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.8"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.8"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.8"/>',
    swap: '<path d="M7 4 3.5 7.5 7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13"/>',
    invoice: '<path d="M14.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    receipt: '<path d="M5 3.5v17l2.3-1.5 2.4 1.5 2.3-1.5 2.3 1.5 2.4-1.5 2.3 1.5v-17l-2.3 1.5-2.4-1.5L12 5 9.7 3.5 7.3 5z"/><path d="M8.5 9.5h7M8.5 13h7"/>',
    stamp: '<path d="M5 20h14M6.5 16.5h11a1.5 1.5 0 0 0 1.5-1.5v-1.5a2 2 0 0 0-2-2h-2.6a1 1 0 0 1-1-1.1l.4-3.2a2.8 2.8 0 1 0-5.6 0l.4 3.2a1 1 0 0 1-1 1.1H7a2 2 0 0 0-2 2V15a1.5 1.5 0 0 0 1.5 1.5z"/>',
    wave: '<path d="M3 17c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 3 3"/><path d="M3 10.5 8 6l4 3.5L16.5 5 21 8"/>',
    sigma: '<path d="M17.5 5.5V4h-11l6 8-6 8h11v-1.5"/>',
    chart: '<path d="M4 20V4M4 20h16"/><rect x="7.5" y="11" width="3" height="6" rx="1"/><rect x="13" y="7" width="3" height="10" rx="1"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
    code: '<path d="m8.5 8-4 4 4 4M15.5 8l4 4-4 4M13.5 5l-3 14"/>',
    clip: '<path d="m20 11.5-8.1 8.1a5.2 5.2 0 0 1-7.4-7.4l8.4-8.4a3.5 3.5 0 0 1 5 5L9.6 17.1a1.7 1.7 0 0 1-2.5-2.5l7.8-7.8"/>',
    upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
    file: '<path d="M14.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z"/><path d="M14 3v5h5"/>',
    printer: '<path d="M7 8.5V3.5h10v5M7 17H5a2 2 0 0 1-2-2v-4.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2h-2"/><rect x="7" y="13.5" width="10" height="7" rx="1"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
    qr: '<rect x="3.5" y="3.5" width="6" height="6" rx="1"/><rect x="14.5" y="3.5" width="6" height="6" rx="1"/><rect x="3.5" y="14.5" width="6" height="6" rx="1"/><path d="M14.5 14.5h2.5v2.5M20.5 14.5v.01M14.5 20.5h.01M17.5 20.5h3v-3"/>',
    bank: '<path d="M3.5 9.5 12 4l8.5 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3.5 20.5h17"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v.01M18 14.5v.01"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2.2"/><path d="M2.5 10h19M6.5 15h3"/>',
    car: '<path d="M5 17h14v-4.5l-1.8-4.6a2 2 0 0 0-1.9-1.4H8.7a2 2 0 0 0-1.9 1.4L5 12.5z"/><path d="M5 12.5h14"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.5v.01"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    sparkle: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.9L12 18.5l-1.8-5.8L4.5 10.8 10.2 9z"/><path d="M19 3.5v3M17.5 5h3"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13.5h9l1-13.5"/>',
    copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
    reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v4.5H8"/>',
    filter: '<path d="M3.5 5h17l-6.5 8v6l-4-2v-4z"/>',
    send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
    eye: '<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/>',
    grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".6"/>',
    shop: '<path d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12v8h13v-8"/>',
    tree: '<path d="M12 3 6.5 11h3L6 16.5h12L14.5 11h3z"/><path d="M12 16.5V21"/>',
    star: '<path d="M12 2.8l2.85 5.8 6.4.93-4.63 4.5 1.1 6.37L12 17.4l-5.72 3 1.1-6.37-4.63-4.5 6.4-.93z"/>',
    book: '<path d="M4.5 5a2 2 0 0 1 2-2H19.5v15H6.5a2 2 0 0 0-2 2z"/><path d="M4.5 20a2 2 0 0 0 2 2h13v-4"/>',
    list: '<path d="M8.5 6h12M8.5 12h12M8.5 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    wrench: '<path d="M14.7 6.3a4.5 4.5 0 0 0 5.6 5.6l-8.8 8.8a2.1 2.1 0 0 1-3-3l8.8-8.8a4.5 4.5 0 0 0-2.6-2.6z"/><path d="M14.7 6.3 17 4l3 3-2.3 2.3"/>',
    box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
    fuel: '<path d="M4.5 20.5v-15a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M3 20.5h13M4.5 10h10"/><path d="M14.5 8.5h2a2 2 0 0 1 2 2v5.5a1.5 1.5 0 0 0 3 0V8l-3-3"/>',
    dots: '<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>',
    minus: '<path d="M5 12h14"/>',
    paypal: '<path d="M7.2 20.5 9.8 3.5h5.4a4.6 4.6 0 0 1 0 9.2h-4.4l-1.2 7.8z"/>',
    blocks: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><path d="M17 14v6M14 17h6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    phone: '<path d="M5 3.5h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.6 6.6l1.4-2.3 4.5 1.8V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>'
  };
  const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  /* Marke oben links: eigenes Firmenlogo (Einstellungen → Firma, auf weißer Kachel wie auf dem Beleg) oder das App-Symbol */
  const brandLogo = () => (D.FIRMA.logo ? `<span class="logo logo-eigen"><img src="${esc(D.FIRMA.logo)}" alt=""></span>` : LOGO);
  const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="gb-lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-2)"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#gb-lg)"/><path d="M10 8.5h9.5l3 3V23a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z" fill="none" stroke="var(--on-accent)" stroke-width="2" stroke-linejoin="round"/><path d="M12.5 15h7M12.5 19h4.5" stroke="var(--on-accent)" stroke-width="2" stroke-linecap="round"/></svg>`;

  /* ================= Einstellungen & Zustand ================= */
  const THEMES = [
    { id: 'indigo', name: 'Indigo', accent: '#6366f1', tintH: 240, tintS: 14 },
    { id: 'ocean', name: 'Ozean', accent: '#0ea5e9', tintH: 210, tintS: 20 },
    { id: 'emerald', name: 'Smaragd', accent: '#10b981', tintH: 165, tintS: 14 },
    { id: 'sunset', name: 'Sonnenuntergang', accent: '#f97316', tintH: 20, tintS: 12 },
    { id: 'rose', name: 'Rosé', accent: '#ec4899', tintH: 330, tintS: 12 },
    { id: 'gold', name: 'Gold', accent: '#eab308', tintH: 45, tintS: 10 },
    { id: 'graphite', name: 'Graphit', accent: '#94a3b8', tintH: 220, tintS: 6 },
    { id: 'terminal', name: 'Terminal', accent: '#22c55e', tintH: 140, tintS: 22, numFont: 'mono' }
  ];
  const DEFAULTS = {
    mode: 'dark', theme: 'indigo', accent: '#6366f1', tintH: 240, tintS: 14, radius: 14, fontScale: 100,
    density: 'normal', posneg: 'greenred', numFont: 'sans',
    motion: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full',
    glass: true, aurora: true,
    belegArt: 'quittung', // Standard-Beleg beim Erfassen einer Einnahme (Quittung oder Rechnung)
    backupZiel: 'mac', backupZuletzt: '' // Datensicherung: Ziel (mac | usb | icloud) und letzte Sicherung dorthin (im Prototyp simuliert)
  };
  let settings = { ...DEFAULTS, ...LS.get('gb.settings', {}) };
  /* Für Screenshots/Tests: index.html?mode=light&motion=off&theme=emerald (wird nicht gespeichert) */
  const qp = new URLSearchParams(location.search);
  if (qp.get('mode')) settings.mode = qp.get('mode');
  if (qp.get('motion')) settings.motion = qp.get('motion');
  const state = { sidebarCollapsed: false, ptyp: 'jahr', panchor: D.TODAY, recent: [], ...LS.get('gb.state', {}) };
  if (state.panchor > D.TODAY) state.panchor = D.TODAY;
  const saveSettings = () => LS.set('gb.settings', settings);
  const saveState = () => { const { sidebarCollapsed, ptyp, panchor, recent } = state; LS.set('gb.state', { sidebarCollapsed, ptyp, panchor, recent }); };

  /* Daten-Änderungen (neue Buchungen, Rechnungen, Kennzahlen …) überleben das Neuladen */
  const STORE_KEYS = ['buchungen', 'rechnungen', 'KENNZAHLEN', 'VARIABLEN', 'PLANPOSTEN', 'KONTAKTE', 'VORLAGEN', 'TERMINE'];
  if (!Array.isArray(D.VORLAGEN)) D.VORLAGEN = []; // eigene Beleg-Vorlagen (Block-Baukasten)
  if (!Array.isArray(D.TERMINE)) D.TERMINE = []; // Kundentermine (js/pages/termine.js)
  (function restore() {
    // Stände älterer Datenmodelle passen nicht mehr (z. B. Konten in v3) → aufräumen statt laden
    for (let v = 1; v < (D.VERSION || 1); v++) { try { localStorage.removeItem('gb.data.v' + v); } catch { /* egal */ } }
    const saved = LS.get('gb.data.v' + (D.VERSION || 1), null);
    if (!saved) return;
    STORE_KEYS.forEach((k) => { if (Array.isArray(saved[k]) && Array.isArray(D[k])) { D[k].length = 0; saved[k].forEach((x) => D[k].push(x)); } });
    if (saved.FIRMA) Object.assign(D.FIRMA, saved.FIRMA);
  })();
  function datenStand() {
    const out = { FIRMA: D.FIRMA };
    STORE_KEYS.forEach((k) => { out[k] = D[k]; });
    return out;
  }
  function save() { LS.set('gb.data.v' + (D.VERSION || 1), datenStand()); }
  function resetData() { try { localStorage.removeItem('gb.data.v' + (D.VERSION || 1)); } catch { /* egal */ } location.reload(); }

  /* ================= Formatierung ================= */
  const nfCache = {};
  const nfmt = (min, max) => (nfCache[min + '-' + max] ||= new Intl.NumberFormat('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max }));
  const num = (v, d = 0) => (v == null || !isFinite(v) ? '—' : nfmt(d, d).format(v).replace('-', '−'));
  const fmt = {
    num,
    eur(cent, { dec = 2, sign = false } = {}) {
      if (cent == null || !isFinite(cent)) return '—';
      const s = nfmt(dec, dec).format(Math.abs(cent) / 100) + ' €';
      return (cent < 0 ? '−' : sign && cent > 0 ? '+' : '') + s;
    },
    eurE(euro, o) { return euro == null || !isFinite(euro) ? '—' : fmt.eur(Math.round(euro * 100), o); },
    /* Achsenbeschriftung: 1.200 € / 12 Tsd. € */
    axis(euro, step = 1) { return Math.abs(euro) >= 100000 && step >= 1000 ? num(euro / 1000, 0) + ' Tsd.' : num(euro, step >= 1 ? 0 : 2); },
    pct(v, d = 1, sign = false) { return v == null || !isFinite(v) ? '—' : (sign && v > 0 ? '+' : '') + num(v * 100, d) + ' %'; },
    tage(v) { return v == null || !isFinite(v) ? '—' : num(v, v < 10 ? 1 : 0) + ' Tage'; },
    datum(iso) { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; },
    datumKurz(iso) { if (!iso) return '—'; const [, m, d] = iso.split('-'); return `${d}.${m}.`; },
    datumLang(iso) { return new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(U.parse(iso)); },
    monat(iso) { return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(U.parse(iso.length === 7 ? iso + '-01' : iso)); },
    monatKurz(iso) { return new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(U.parse(iso.length === 7 ? iso + '-01' : iso)).replace('.', ''); },
    rel(iso) {
      const n = U.diffDays(D.TODAY, iso);
      if (n === 0) return 'heute'; if (n === 1) return 'morgen'; if (n === -1) return 'gestern';
      return n > 0 ? `in ${n} Tagen` : `vor ${-n} Tagen`;
    },
    /* Wert nach Kennzahl-Format */
    kz(v, format, dec) {
      const d = dec === '' || dec == null ? null : +dec;
      if (format === 'prozent') return fmt.pct(v, d ?? 1);
      if (format === 'tage') return d == null ? fmt.tage(v) : (v == null || !isFinite(v) ? '—' : num(v, d) + ' Tage');
      if (format === 'zahl') return num(v, d ?? (Number.isInteger(v) ? 0 : 1));
      return fmt.eurE(v, { dec: d ?? (Math.abs(v) >= 10000 ? 0 : 2) });
    }
  };
  function deltaHTML(v, { d = 1, pp = false, invert = false, suffix = '' } = {}) {
    if (v == null || !isFinite(v)) return '<span class="delta flat">–</span>';
    const good = invert ? v < -0.0001 : v > 0.0001, bad = invert ? v > 0.0001 : v < -0.0001;
    const cls = good ? 'pos' : bad ? 'neg' : 'flat';
    const arrow = v > 0.0001 ? '▲' : v < -0.0001 ? '▼' : '■';
    return `<span class="delta ${cls}"><i>${arrow}</i>${v > 0 ? '+' : ''}${pp ? num(v, d) + ' Pp.' : num(v * 100, d) + ' %'}${suffix}</span>`;
  }
  const pctChange = (a, b) => (b ? (a - b) / Math.abs(b) : null);

  /* Monogramm mit Farbe aus dem Namen */
  function colorFor(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 55% 48%)`; }
  function initials(name) {
    const w = String(name || '?').replace(/[^A-Za-zÄÖÜäöüß0-9 ]/g, ' ').split(/\s+/).filter((x) => x && !/^(GmbH|AG|UG|e|V|UC|KG|Dr|und)$/i.test(x));
    return ((w[0] || '?')[0] + (w[1] ? w[1][0] : (w[0] || '')[1] || '')).toUpperCase();
  }
  const monogram = (name, size = 'sm') => `<i class="mono-logo ${size}" style="--b:${colorFor(name)}">${esc(initials(name))}</i>`;

  /* ================= Theme anwenden ================= */
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const effectiveMode = () => (settings.mode === 'system' ? (mq.matches ? 'dark' : 'light') : settings.mode);
  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function applySettings() {
    const r = document.documentElement;
    r.dataset.mode = effectiveMode();
    r.dataset.density = settings.density;
    r.dataset.motion = settings.motion;
    r.dataset.numfont = settings.numFont;
    r.dataset.posneg = settings.posneg;
    r.dataset.glass = settings.glass ? 'on' : 'off';
    r.dataset.aurora = settings.aurora ? 'on' : 'off';
    r.style.setProperty('--accent', settings.accent);
    r.style.setProperty('--on-accent', luminance(settings.accent) > 0.45 ? '#111114' : '#ffffff');
    r.style.setProperty('--tint-h', settings.tintH);
    r.style.setProperty('--tint-s', settings.tintS + '%');
    r.style.setProperty('--radius', settings.radius + 'px');
    r.style.setProperty('--font-scale', settings.fontScale / 100);
    const modeBtn = $('[data-action="toggle-mode"]');
    if (modeBtn) { modeBtn.innerHTML = icon(effectiveMode() === 'dark' ? 'sun' : 'moon'); modeBtn.title = effectiveMode() === 'dark' ? 'Hell (⇧⌘L)' : 'Dunkel (⇧⌘L)'; }
  }
  mq.addEventListener('change', () => { if (settings.mode === 'system') applySettings(); });

  /* ================= Zeitraum ================= */
  const PTYPEN = [['monat', 'Monat'], ['quartal', 'Quartal'], ['jahr', 'Jahr']];
  function rangeOf(typ, anchor) {
    const y = +anchor.slice(0, 4), m = +anchor.slice(5, 7);
    if (typ === 'monat') return { typ, von: U.dateIn(y, m, 1), bis: U.dateIn(y, m, 31), label: fmt.monat(anchor) };
    if (typ === 'quartal') { const q = Math.ceil(m / 3), m0 = (q - 1) * 3 + 1; return { typ, von: U.dateIn(y, m0, 1), bis: U.dateIn(y, m0 + 2, 31), label: `Q${q} ${y}` }; }
    return { typ: 'jahr', von: `${y}-01-01`, bis: `${y}-12-31`, label: String(y) };
  }
  const period = () => rangeOf(state.ptyp, state.panchor);
  function shiftAnchor(anchor, typ, dir) {
    const d = U.parse(anchor); d.setDate(1);
    if (typ === 'monat') d.setMonth(d.getMonth() + dir); else if (typ === 'quartal') d.setMonth(d.getMonth() + 3 * dir); else d.setFullYear(d.getFullYear() + dir);
    return U.iso(d);
  }
  /* Vergleichszeitraum: Vorperiode; enthält die Periode heute, wird gleich lang abgeschnitten (fairer Vergleich) */
  function vergleich(p = period()) {
    const prev = rangeOf(p.typ, shiftAnchor(p.von, p.typ, -1));
    if (p.von <= D.TODAY && D.TODAY <= p.bis) {
      const len = U.diffDays(p.von, D.TODAY);
      prev.bis = U.addDays(prev.von, len);
      prev.teil = true;
    }
    prev.text = p.typ === 'jahr' ? (prev.teil ? 'ggü. Vorjahr (gleicher Zeitraum)' : 'ggü. Vorjahr') : p.typ === 'quartal' ? (prev.teil ? 'ggü. Vorquartal (gleich lang)' : 'ggü. Vorquartal') : (prev.teil ? 'ggü. Vormonat (gleich lang)' : 'ggü. Vormonat');
    return prev;
  }
  function periodHTML() {
    const p = period();
    const canNext = shiftAnchor(p.von, p.typ, 1) <= D.TODAY, canPrev = p.von > D.START; // nicht vor den Datenbeginn
    return `<div class="period">${seg('state', 'ptyp', PTYPEN, state.ptyp)}
      <div class="period-nav"><button type="button" class="icon-btn sm" data-action="period-prev" title="Vorheriger Zeitraum" ${canPrev ? '' : 'disabled'}>${icon('chevL')}</button>
      <b>${esc(p.label)}</b><button type="button" class="icon-btn sm" data-action="period-next" title="Nächster Zeitraum" ${canNext ? '' : 'disabled'}>${icon('chevR')}</button></div></div>`;
  }

  /* ================= Segment-Control ================= */
  function seg(kind, key, opts, active, cls = '') {
    return `<div class="seg ${cls}" data-kind="${kind}" data-key="${key}" role="tablist">${opts.map(([v, label]) =>
      `<button type="button" role="tab" class="${String(v) === String(active) ? 'active' : ''}" data-value="${esc(v)}" aria-selected="${String(v) === String(active)}">${label}</button>`).join('')}</div>`;
  }
  function updateSegs(root = document) {
    $$('.seg', root).forEach((s) => {
      let ind = $('.seg-ind', s);
      if (!ind) { ind = document.createElement('span'); ind.className = 'seg-ind'; s.prepend(ind); }
      const a = $('button.active', s);
      if (!a || !a.offsetWidth) { ind.style.opacity = 0; return; }
      ind.style.opacity = 1;
      ind.style.width = a.offsetWidth + 'px';
      ind.style.height = a.offsetHeight + 'px';
      ind.style.transform = `translate(${a.offsetLeft}px, ${a.offsetTop}px)`;
      requestAnimationFrame(() => s.classList.add('ready'));
    });
  }

  /* ================= KPI-Kachel & Hochzählen ================= */
  function kpi({ label, value = '', count = null, cfmt = 'eur', sub = '', tip = '', tipTitle = '', href = '', ampel = '', i = 0 }) {
    const tag = href ? 'a' : 'div';
    const val = count != null && isFinite(count) ? `<div class="kpi-val" data-count="${count}" data-fmt="${cfmt}">${COUNT_FMT[cfmt](count)}</div>` : `<div class="kpi-val">${value}</div>`;
    return `<${tag} class="kpi reveal" style="--i:${i}" ${href ? `href="${href}"` : ''}>${ampel ? `<i class="ampel ${ampel}"></i>` : ''}
      <div class="kpi-label"><span>${esc(label)}</span>${tip ? `<button type="button" class="q" data-tip="${esc(tip)}" data-tip-title="${esc(tipTitle || label)}">?</button>` : ''}</div>
      ${val}<div class="kpi-sub">${sub}</div></${tag}>`;
  }
  const COUNT_FMT = {
    eur: (v) => fmt.eur(v), eur0: (v) => fmt.eur(v, { dec: 0 }), eurE: (v) => fmt.eurE(v), eurE0: (v) => fmt.eurE(v, { dec: 0 }),
    pct: (v) => fmt.pct(v), tage: (v) => fmt.tage(v), num: (v) => num(v, 0)
  };
  function countUp(root = document) {
    if (settings.motion !== 'full') return;
    $$('[data-count]', root).forEach((el) => {
      const target = +el.dataset.count, f = COUNT_FMT[el.dataset.fmt] || COUNT_FMT.eur;
      const t0 = performance.now(), dur = 900;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = f(target * e);
        if (k < 1) requestAnimationFrame(step); else el.textContent = f(target);
      };
      requestAnimationFrame(step);
    });
  }

  /* ================= Formeln & Kennzahlen ================= */
  function fctx(p = period()) {
    const vars = {}; D.VARIABLEN.forEach((v) => { vars[v.name.toUpperCase()] = v.wert; });
    // laufender Zeitraum endet heute: MONATE(), VORJAHR() usw. vergleichen dann gleich lange Zeiträume (wie App.vergleich)
    return { von: p.von, bis: p.bis > D.TODAY ? D.TODAY : p.bis, heute: D.TODAY, data: D, vars, kennzahlen: D.KENNZAHLEN };
  }
  function kz(k, p = period()) {
    if (!window.Formula) return NaN;
    try { return window.Formula.evaluate(k.formel, fctx(p)); } catch { return NaN; }
  }
  function ampelOf(k, v) {
    if (!k.ampel || v == null || !isFinite(v)) return '';
    const low = k.ampel.richtung === 'niedrig';
    if (low) return v <= k.ampel.gruen ? 'gruen' : v <= k.ampel.gelb ? 'gelb' : 'rot';
    return v >= k.ampel.gruen ? 'gruen' : v >= k.ampel.gelb ? 'gelb' : 'rot';
  }

  /* ================= Summen über Buchungen (Cent) ================= */
  function summen(von, bis, filter = () => true) {
    let ein = 0, aus = 0, ku = 0;
    D.buchungen.forEach((b) => {
      if (b.datum < von || b.datum > bis || !filter(b)) return;
      const k = D.kat(b.kat);
      if (b.typ === 'einnahme') { ein += b.betrag; if (k && k.ku) ku += b.betrag; }
      else if (b.typ === 'ausgabe') aus += Math.round(b.betrag * (1 - (b.privat || 0) / 100) * ((k ? k.abziehbar : 100) / 100));
    });
    return { ein, aus, gewinn: ein - aus, ku };
  }
  const offeneRechnungen = () => D.rechnungen.filter((r) => r.art === 'rechnung' && r.status === 'offen').sort((a, b) => (a.faellig < b.faellig ? -1 : 1));

  /* ================= Vorschau-Modell (Liquidität) =================
   * Es gibt keinen Kontostand (das Geschäftskonto ist zugleich das Privatkonto). Gerechnet wird daher mit dem
   * kumulierten Überschuss: Start bei 0 am Beginn des Rückblicks (historie Tage vor heute, 0 = ab heute),
   * echte Ein-/Ausgänge bis heute, danach erwartete Zahlungen: offene Rechnungen (Fälligkeit + Ø Zahlungsverzug),
   * wiederkehrende Kosten, Planposten und Ø variable Ein-/Ausgänge der letzten 90 Tage (wöchentlich gebündelt).
   * Rückgabe: tage[{t, v, events}], todayIdx, basis (Wert heute), min (tiefster Punkt ab heute), end, at(n),
   * zufluss/abfluss/netto (Euro, nur Zukunft), ereignisse[{t, text, betrag, art, saldo}], verzug, wEin, wAus. */
  function prognose(o = {}) {
    const opt = { tage: 90, historie: 60, offene: true, ueberfaellige: true, wiederkehrend: true, plan: true, variabel: true, verzug: null, ...o };
    const T = D.TODAY, end = U.addDays(T, opt.tage), start = U.addDays(T, -opt.historie);
    // Ø Zahlungsverzug (Tage nach Fälligkeit) aus der Historie
    const bezahlt = D.rechnungen.filter((r) => r.art === 'rechnung' && r.bezahltAm && r.faellig);
    const verzugAuto = bezahlt.length ? Math.round(bezahlt.reduce((s, r) => s + Math.max(0, U.diffDays(r.faellig, r.bezahltAm)), 0) / bezahlt.length) : 0;
    const verzug = opt.verzug == null ? verzugAuto : opt.verzug;
    const ev = {}; // Datum → Ereignisse (Euro)
    const push = (t, e) => { (ev[t] ||= []).push(e); };
    // Rückblick: echte Ein- und Ausgänge
    D.buchungen.forEach((b) => {
      if (b.datum <= start || b.datum > T) return;
      const sum = D.netto(b) / 100;
      if (sum) push(b.datum, { text: b.text, betrag: sum, art: 'ist', prog: false, ref: b.id });
    });
    const future = [];
    const add = (t, e) => { if (t > T && t <= end) { push(t, { ...e, prog: true }); future.push({ t, ...e }); } };
    if (opt.offene) offeneRechnungen().forEach((r) => {
      const ueber = r.faellig < T;
      if (ueber && !opt.ueberfaellige) return;
      let t = U.addDays(r.faellig, verzug); if (t <= T) t = U.addDays(T, 3);
      add(t, { text: `${r.nr} · ${D.gegenueber(r) || 'Kunde'}${ueber ? ' (überfällig)' : ''}`, betrag: D.rechnungSumme(r) / 100, art: 'rechnung', ref: r.id });
    });
    if (opt.wiederkehrend) D.WIEDERKEHREND.forEach((w) => {
      // ab dem 1. des laufenden Monats, sonst fehlen Termine zu Monatsbeginn (und setMonth springt am 31. über)
      for (let d = U.parse(T.slice(0, 8) + '01'); U.iso(d) <= end; d.setMonth(d.getMonth() + 1)) {
        const y = d.getFullYear(), m = d.getMonth() + 1;
        if (w.rhythmus === 'quartal' && !w.monate.includes(m)) continue;
        const t = U.dateIn(y, m, w.tag);
        add(t, { text: w.text, betrag: ((w.typ === 'einnahme' ? 1 : -1) * w.betrag) / 100, art: 'wiederkehrend', ref: w.id });
      }
    });
    if (opt.plan) D.PLANPOSTEN.forEach((p) => add(p.datum, { text: p.text, betrag: p.betrag / 100, art: 'plan', ref: p.id }));
    // Durchschnittswerte aus den letzten 90 Tagen (ohne Rechnungen und Wiederkehrendes – die stehen oben einzeln)
    const h0 = U.addDays(T, -90);
    let varEin = 0, varAus = 0;
    D.buchungen.forEach((b) => {
      const istRechnung = b.rechnung && (D.rechnungen.find((r) => r.id === b.rechnung) || {}).art === 'rechnung';
      if (b.datum <= h0 || b.datum > T || b.wiederkehrend || istRechnung) return;
      const sum = D.netto(b) / 100;
      if (sum > 0) varEin += sum; else varAus += sum;
    });
    const wEin = (varEin / 90) * 7, wAus = (varAus / 90) * 7;
    if (opt.variabel) for (let t = U.addDays(T, 7); t <= end; t = U.addDays(t, 7)) {
      if (Math.round(wEin)) add(t, { text: 'Ø Einnahmen aus Aufträgen (Woche)', betrag: Math.round(wEin), art: 'variabel' });
      if (Math.round(wAus)) add(t, { text: 'Ø laufende Ausgaben (Woche)', betrag: Math.round(wAus), art: 'variabel' });
    }
    // Tagesreihe ab Beginn des Rückblicks (Wert 0)
    let v = 0;
    const tage = []; let todayIdx = 0;
    for (let t = start; t <= end; t = U.addDays(t, 1)) {
      const es = t === start ? [] : ev[t] || [];
      es.forEach((e) => { v += e.betrag; });
      if (t === T) todayIdx = tage.length;
      tage.push({ t, v, events: es });
    }
    const basis = tage[todayIdx].v;
    future.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : b.betrag - a.betrag));
    let run = basis;
    future.forEach((e) => { run += e.betrag; e.saldo = run; });
    let min = tage[todayIdx];
    for (let i = todayIdx; i < tage.length; i++) if (tage[i].v < min.v) min = tage[i];
    const zufluss = future.filter((e) => e.betrag > 0).reduce((s, e) => s + e.betrag, 0);
    const abfluss = future.filter((e) => e.betrag < 0).reduce((s, e) => s + e.betrag, 0);
    const at = (n) => { const i = Math.min(tage.length - 1, todayIdx + n); return tage[i].v; };
    return { tage, todayIdx, basis, min, end: tage[tage.length - 1].v, at, zufluss, abfluss, netto: zufluss + abfluss, ereignisse: future, verzug, verzugAuto, wEin, wAus };
  }

  /* ================= Routing ================= */
  const PAGES = {};
  let route = { id: '', parts: [], params: {} };
  let cleanup = null;
  function page(id, def) { PAGES[id] = { id, nav: false, order: 50, ...def }; }
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, query = ''] = h.split('?');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    const params = Object.fromEntries(new URLSearchParams(query));
    return { id: parts[0] || 'buchungen', parts, params };
  }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function render({ anim = true } = {}) {
    route = parseHash();
    const def = PAGES[route.id] || PAGES.buchungen || { title: 'Leer', render: (el) => { el.innerHTML = `<div class="card"><div class="empty">${icon('info')}<b>Diese Seite gibt es noch nicht</b></div></div>`; } };
    if (typeof cleanup === 'function') { try { cleanup(); } catch { /* egal */ } }
    cleanup = null;
    App.dropTarget = null;
    const el = $('#content');
    el.classList.toggle('no-anim', !anim);
    el.innerHTML = '';
    hideTip();
    try { cleanup = def.render(el, route) || null; } catch (err) {
      console.error(err);
      el.innerHTML = `<div class="card"><div class="empty">${icon('alert')}<b>Diese Ansicht hat einen Fehler</b><span>${esc(err.message)}</span></div></div>`;
    }
    document.title = `${def.title} · ${APP_NAME} – Prototyp`;
    renderSidebar();
    requestAnimationFrame(() => { updateSegs(el); if (anim) countUp(el); });
    if (anim) window.scrollTo({ top: 0 });
  }
  const rerender = () => render({ anim: false });

  /* ================= Seitenleiste ================= */
  const app = $('#app');
  const isMobile = () => matchMedia('(max-width: 900px)').matches;
  function renderSidebar() {
    const nav = Object.values(PAGES).filter((p) => p.nav).sort((a, b) => a.order - b.order);
    const ueber = offeneRechnungen().filter((r) => r.faellig < D.TODAY).length;
    const ohneBeleg = D.buchungen.filter((b) => (b.typ === 'einnahme' || b.typ === 'ausgabe') && !b.beleg).length;
    // Termine: rot = nachtragen (vergangen, aber nicht abgehakt) + erledigt ohne ausgestellten Beleg; sonst die von heute
    const belegNr = (id) => { const r = id && D.rechnungen.find((x) => x.id === id); return r && r.nr && r.status !== 'storniert'; };
    const tOffen = D.TERMINE.filter((t) => t.status === 'geplant'), tHeute = tOffen.filter((t) => t.datum === D.TODAY).length;
    const tAlt = tOffen.filter((t) => t.datum < D.TODAY).length + D.TERMINE.filter((t) => t.status === 'erledigt' && !t.ohneBeleg && !belegNr(t.beleg)).length;
    const badges = { buchungen: ohneBeleg ? [ohneBeleg, '', `${ohneBeleg} ohne Beleg`] : null, rechnungen: ueber ? [ueber, 'alarm', `${ueber} überfällig`] : null,
      termine: tAlt ? [tAlt, 'alarm', `${tAlt} nachtragen bzw. ohne Beleg`] : tHeute ? [tHeute, '', `${tHeute} heute`] : null };
    const aktiv = (PAGES[route.id] || {}).parent || route.id;
    $('#sidebar').innerHTML = `
      <div class="sb-head" data-drag-region><a class="brand" href="#/buchungen" title="Zu Ein- & Ausgänge" aria-label="${APP_NAME} – Startseite">${brandLogo()}<span class="brand-text"><b>${APP_NAME}</b><small>${esc(D.FIRMA.name)}</small></span></a></div>
      <div class="sb-scroll">
        <div class="sb-section"><ul class="sb-list">${nav.map((p) => {
          const b = badges[p.id];
          return `<li class="sb-item sb-nav ${aktiv === p.id ? 'active' : ''}"><a href="#/${p.id}" title="${esc(p.title)}">${icon(p.icon)}<span class="sb-label">${esc(p.navTitle || p.title)}</span>${b ? `<span class="sb-badge ${b[1]}" title="${b[2]}">${b[0]}</span>` : ''}</a></li>`;
        }).join('')}</ul></div>
      </div>`;
  }

  /* ================= Auswertung: ein Menüpunkt, großer Umschalter ================= */
  const AUSWERTUNG = [
    ['auswertung', 'Überblick', 'dashboard', 'Wie läuft das Geschäft?'],
    ['liquiditaet', 'Liquidität', 'wave', 'Was in 90 Tagen rein- und rausgeht'],
    ['kennzahlen', 'Kennzahlen', 'sigma', 'Eigene Formeln'],
    ['steuer', 'Steuer & Export', 'book', 'EÜR, Kleinunternehmer, Export']
  ];
  function auswertungKopf(aktivId, actions = '') {
    return `<div class="page-head ausw-head reveal" style="--i:0">
        <div><h1>${icon('chart')}Auswertung</h1></div>
        ${actions ? `<div class="page-actions">${actions}</div>` : ''}
      </div>
      <nav class="ausw-switch reveal" style="--i:0" aria-label="Bereiche der Auswertung">${AUSWERTUNG.map(([id, label, ic, sub]) =>
        `<a href="#/${id}" class="${id === aktivId ? 'active' : ''}"${id === aktivId ? ' aria-current="page"' : ''}>${icon(ic)}<span><b>${label}</b><small>${sub}</small></span></a>`).join('')}</nav>`;
  }
  function toggleSidebar() {
    if (isMobile()) app.classList.toggle('sb-open');
    else { state.sidebarCollapsed = !state.sidebarCollapsed; saveState(); app.classList.toggle('sb-collapsed', state.sidebarCollapsed); setTimeout(() => updateSegs(), 400); }
    syncSidebarToggle();
  }
  function syncSidebarToggle() {
    const b = $('.sb-toggle'); if (!b) return;
    const open = isMobile() ? app.classList.contains('sb-open') : !state.sidebarCollapsed;
    const label = open ? 'Seitenleiste einklappen (⌘\\)' : 'Seitenleiste ausklappen (⌘\\)';
    b.title = label; b.setAttribute('aria-label', label); b.setAttribute('aria-expanded', String(open));
  }

  /* ================= Topbar + Suche / Befehlspalette ================= */
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const kbdLabel = () => (isMac ? '⌘K' : 'Strg K');
  function renderTopbar() {
    $('#topbar').innerHTML = `
      <div class="tb-left"><button type="button" class="icon-btn sb-toggle" data-action="toggle-sidebar" aria-controls="sidebar">${icon('panel')}</button></div>
      <div class="search" id="search">
        ${icon('search', 'search-ic')}
        <input id="searchInput" type="search" autocomplete="off" spellcheck="false" placeholder="Suchen oder Befehl …" title="Einträge, Belege, Termine, Kunden, Kennzahlen und Befehle durchsuchen" aria-label="Suchen">
        <kbd>${kbdLabel()}</kbd>
        <div class="sd" id="sd" role="listbox"></div>
      </div>
      <div class="tb-actions">
        <button type="button" class="icon-btn" data-action="toggle-mode"></button>
        <button type="button" class="icon-btn tb-gear" data-action="open-settings" title="Einstellungen">${icon('gear')}<i class="tb-dot" hidden></i></button>
      </div>`;
    syncSidebarToggle(); syncBackupDot();
  }
  const COMMANDS = [
    { name: 'Ausgabe erfassen', sub: 'Kosten eintragen · ⌘N', icon: 'minus', run: () => erfassen({ typ: 'ausgabe' }) },
    { name: 'Einnahme erfassen', sub: 'Geld von Kunden eintragen', icon: 'plus', run: () => erfassen({ typ: 'einnahme' }) },
    { name: 'Quittung schreiben', sub: 'Einnahme erfassen und Quittung mit laufender Nummer erstellen', icon: 'receipt', run: () => erfassen({ typ: 'einnahme', beleg: 'quittung' }) },
    { name: 'Rechnung schreiben', sub: 'Einnahme erfassen und Rechnung erstellen (auch noch offen)', icon: 'invoice', run: () => erfassen({ typ: 'einnahme', beleg: 'rechnung' }) },
    { name: 'Termin eintragen', sub: 'Kundentermin, auf Wunsch mit vorbereiteter Quittung', icon: 'calendar', run: () => (App.neuerTermin ? App.neuerTermin({}) : go('#/termine?neu=1')) },
    { name: 'Angebot schreiben', sub: 'Angebot an einen Kunden', icon: 'file', run: () => go('#/beleg/neu?art=angebot') },
    { name: 'Eigenbeleg erstellen', sub: 'Wenn der Originalbeleg einer Ausgabe fehlt', icon: 'stamp', run: () => go('#/beleg/neu?art=eigenbeleg') },
    { name: 'Vorlagen bearbeiten', sub: 'Quittung & Rechnung aus Bausteinen gestalten', icon: 'blocks', run: () => go('#/vorlagen') },
    { name: 'Kunde anlegen', sub: 'Neuen Kunden mit Adresse und Notiz anlegen', icon: 'user', run: () => go('#/kunden?neu=1') },
    { name: 'Hell / Dunkel umschalten', sub: '⇧⌘L', icon: 'moon', run: (ev) => toggleMode(ev) },
    { name: 'Einstellungen öffnen', sub: 'Darstellung, Firma, Daten', icon: 'gear', run: () => openSettings() }
  ];
  const suchSeiten = () => Object.values(PAGES).filter((p) => p.nav || p.desc).sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0) || a.order - b.order);
  let sdItems = [], sdActive = 0;
  function norm(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function hl(text, q) {
    if (!q) return esc(text);
    const i = norm(text).indexOf(norm(q));
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  }
  function searchResults(qRaw) {
    const cmdMode = qRaw.startsWith('>');
    const q = norm(qRaw.replace(/^>\s*/, '').trim());
    const groups = [];
    const m = (s) => !q || norm(s).includes(q);
    const cmds = COMMANDS.filter((c) => m(c.name + ' ' + c.sub));
    if (cmdMode || !q) { groups.push({ title: 'Befehle', items: cmds.slice(0, cmdMode ? 10 : 4).map((c) => ({ ...c, key: 'c:' + c.name })) }); if (cmdMode) return groups; }
    if (!q) {
      const pages = Object.values(PAGES).filter((p) => p.nav).sort((a, b) => a.order - b.order);
      groups.push({ title: 'Springen zu', items: pages.map((p) => ({ name: p.navTitle || p.title, sub: p.desc || '', icon: p.icon, run: () => go('#/' + p.id) })) });
      return groups;
    }
    const pages = suchSeiten().filter((p) => m(p.title + ' ' + (p.navTitle || '') + ' ' + (p.desc || '')));
    if (pages.length) groups.push({ title: 'Seiten', items: pages.map((p) => ({ name: p.title, sub: p.desc || '', icon: p.icon, run: () => go('#/' + p.id) })) });
    if (cmds.length) groups.push({ title: 'Befehle', items: cmds.slice(0, 3) });
    const re = D.rechnungen.filter((r) => m(`${r.nr || 'Entwurf'} ${r.betreff} ${D.gegenueber(r)}`)).slice(-6).reverse();
    if (re.length) groups.push({ title: 'Belege', items: re.map((r) => ({ name: `${r.nr || 'Entwurf'} · ${r.betreff}`, sub: `${D.gegenueber(r) || 'Barverkauf'} · ${fmt.datum(r.datum)} · ${r.status}`, icon: { quittung: 'receipt', eigenbeleg: 'stamp', angebot: 'file' }[r.art] || 'invoice', right: fmt.eur(D.rechnungSumme(r)), run: () => go('#/beleg/' + r.id) })) });
    const bu = D.buchungen.filter((b) => m(`${b.nr} ${b.belegnr || ''} ${b.text} ${D.gegenueber(b)} ${fmt.eur(b.betrag)}`)).slice(-6).reverse();
    if (bu.length) groups.push({ title: 'Ein- & Ausgänge', items: bu.map((b) => ({ name: b.text, sub: `${b.belegnr || b.nr} · ${fmt.datum(b.datum)} · ${(D.kat(b.kat) || {}).name || ''}`, icon: b.typ === 'einnahme' ? 'plus' : 'minus', right: (b.typ === 'einnahme' ? '+' : '−') + fmt.eur(b.betrag), run: () => go('#/buchungen?b=' + b.id) })) });
    const te = D.TERMINE.filter((t) => t.status !== 'abgesagt' && m(`${t.kunde} ${t.leistung} ${fmt.datum(t.datum)}`)).sort((a, b) => (a.datum < b.datum ? 1 : -1)).slice(0, 4);
    if (te.length) groups.push({ title: 'Termine', items: te.map((t) => ({ name: `${t.leistung} · ${t.kunde}`, sub: `${fmt.datum(t.datum)} · ${t.von}–${t.bis} · ${{ geplant: t.datum < D.TODAY ? 'nachtragen' : 'geplant', erledigt: 'erledigt ✓', abgesagt: 'abgesagt' }[t.status] || t.status}`, icon: 'calendar', run: () => go('#/termine?t=' + t.id) })) });
    const ko = D.KONTAKTE.filter((k) => m(`${k.name} ${k.strasse || ''} ${k.ort || ''} ${k.email || ''} ${k.telefon || ''}`)).slice(0, 5);
    if (ko.length) groups.push({ title: 'Kunden', items: ko.map((k) => ({ name: k.name, sub: [k.strasse, k.ort].filter(Boolean).join(', ') || 'Kunde', mono: k.name, run: () => go('#/kunden?k=' + k.id) })) });
    const kz2 = D.KENNZAHLEN.filter((k) => m(k.name + ' ' + k.formel)).slice(0, 4);
    if (kz2.length) groups.push({ title: 'Kennzahlen', items: kz2.map((k) => ({ name: k.name, sub: k.formel, icon: 'sigma', right: fmt.kz(kz(k), k.format), run: () => go('#/kennzahlen?k=' + k.id) })) });
    return groups;
  }
  function renderSearch() {
    const qRaw = $('#searchInput').value;
    const q = qRaw.replace(/^>\s*/, '').trim();
    const groups = searchResults(qRaw);
    sdItems = groups.flatMap((g) => g.items);
    sdActive = Math.min(sdActive, Math.max(0, sdItems.length - 1));
    let idx = 0;
    $('#sd').innerHTML = (groups.length ? groups.map((g) => `<div class="sd-group"><div class="sd-gtitle"><span>${g.title}</span></div>${g.items.map((it) => {
      const i = idx++;
      return `<div class="sd-item ${i === sdActive ? 'active' : ''}" data-sd="${i}" role="option">${it.mono ? monogram(it.mono, 'xs') : icon(it.icon || 'arrow')}<div class="sd-main"><span class="sd-name">${hl(it.name, q)}</span>${it.sub ? `<span class="sd-sub">${hl(it.sub, q)}</span>` : ''}</div>${it.right ? `<span class="sd-right">${esc(it.right)}</span>` : ''}</div>`;
    }).join('')}</div>`).join('') : `<div class="sd-empty">${icon('search')} Nichts gefunden für „${esc(q)}“.</div>`) +
      `<div class="sd-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> auswählen</span><span><kbd>↵</kbd> öffnen</span><span><kbd>&gt;</kbd> nur Befehle</span><span><kbd>Esc</kbd> schließen</span></div>`;
  }
  function openSearch() { $('#search').classList.add('open'); renderSearch(); }
  function closeSearch() { $('#search').classList.remove('open'); $('#searchInput').blur(); }
  function runSd(i, ev) { const it = sdItems[i]; if (!it) return; closeSearch(); $('#searchInput').value = ''; it.run(ev || {}); }

  /* ================= Schubladen ================= */
  const drawer = {
    open({ id = 'drawer', title, sub = '', icon: ic = 'edit', width = 440, body = '', foot = '', onMount, onClose } = {}) {
      drawer.close(true);
      const wrap = document.createElement('div');
      wrap.className = 'overlay'; wrap.id = 'ov-' + id;
      wrap.innerHTML = `<div class="drawer-backdrop" data-action="close-drawer"></div>
        <aside class="drawer" role="dialog" aria-label="${esc(title)}" style="--drawer-w:${width}px">
          <header class="drawer-head"><h2>${icon(ic)}<span>${esc(title)}${sub ? `<small>${sub}</small>` : ''}</span></h2><button type="button" class="icon-btn" data-action="close-drawer" title="Schließen (Esc)">${icon('x')}</button></header>
          <div class="drawer-body">${body}</div>${foot ? `<footer class="drawer-foot">${foot}</footer>` : ''}
        </aside>`;
      wrap._onClose = onClose;
      $('#overlays').appendChild(wrap);
      requestAnimationFrame(() => { wrap.classList.add('open'); updateSegs(wrap); });
      if (onMount) onMount($('.drawer', wrap));
      return $('.drawer', wrap);
    },
    close(instant = false) {
      $$('#overlays .overlay').forEach((w) => {
        if (w._closing) return;
        w._closing = true;
        if (w._onClose) w._onClose();
        w.classList.remove('open');
        setTimeout(() => w.remove(), instant ? 0 : 450);
      });
    },
    isOpen: () => !!$$('#overlays .overlay').find((w) => !w._closing)
  };

  /* ================= Einstellungen ================= */
  function renderSettings(root) {
    const custom = settings.theme === 'custom';
    const row = (label, ctrl, val = '') => `<div class="set-row"><div class="set-label"><span>${label}</span>${val ? `<output>${val}</output>` : ''}</div>${ctrl}</div>`;
    const range = (k, min, max, step = 1) => `<input type="range" data-setting="${k}" min="${min}" max="${max}" step="${step}" value="${settings[k]}" class="${k === 'tintH' ? 'hue' : ''}">`;
    const sw = (k) => `<label class="switch"><input type="checkbox" data-setting="${k}" ${settings[k] ? 'checked' : ''}><span></span></label>`;
    const F = D.FIRMA;
    root.querySelector('.drawer-body').innerHTML = `
      <section><h3>Darstellung</h3>
        ${row('Modus', seg('setting', 'mode', [['light', icon('sun') + 'Hell'], ['dark', icon('moon') + 'Dunkel'], ['system', 'System']], settings.mode))}
        <div class="set-label"><span>Farbthema</span>${custom ? '<span class="badge accent">Eigenes Theme</span>' : ''}</div>
        <div class="themes">${THEMES.map((th) => `<button type="button" class="theme-sw ${settings.theme === th.id ? 'active' : ''}" data-action="theme" data-id="${th.id}" style="--sw-a:${th.accent};--sw-h:${th.tintH};--sw-s:${th.tintS}%">
          <span class="sw-prev"><i></i><i></i><i></i></span><span class="sw-name">${th.name}</span></button>`).join('')}</div>
      </section>
      <section><h3>Feinabstimmung</h3>
        ${row('Akzentfarbe', `<div class="color-row"><input type="color" data-setting="accent" value="${settings.accent}"><code>${settings.accent.toUpperCase()}</code></div>`)}
        ${row('Farbton Hintergrund', range('tintH', 0, 360), settings.tintH + '°')}
        ${row('Sättigung Hintergrund', range('tintS', 0, 40), settings.tintS + '%')}
        ${row('Eckenrundung', range('radius', 0, 24), settings.radius + 'px')}
        ${row('Schriftgröße', range('fontScale', 85, 120, 5), settings.fontScale + '%')}
        ${row('Dichte', seg('setting', 'density', [['compact', 'Kompakt'], ['normal', 'Normal'], ['cozy', 'Luftig']], settings.density))}
        ${row('Plus/Minus-Farben', seg('setting', 'posneg', [['greenred', '<i class="pn" data-pn="greenred"></i>Grün/Rot'], ['blueorange', '<i class="pn" data-pn="blueorange"></i>Blau/Orange'], ['tealpink', '<i class="pn" data-pn="tealpink"></i>Türkis/Pink']], settings.posneg))}
        ${row('Zahlen', seg('setting', 'numFont', [['sans', 'Proportional'], ['mono', 'Monospace']], settings.numFont))}
      </section>
      <section><h3>Bewegung & Effekte</h3>
        ${row('Animationen', seg('setting', 'motion', [['full', 'Voll'], ['reduced', 'Reduziert'], ['off', 'Aus']], settings.motion))}
        <div class="toggle-row"><span>Glas-Effekt</span>${sw('glass')}</div>
        <div class="toggle-row"><span>Farbverlauf im Hintergrund</span>${sw('aurora')}</div>
      </section>
      <section><h3>Belege</h3>
        ${row('Beleg bei Einnahmen', seg('setting', 'belegArt', [['quittung', icon('receipt') + 'Quittung'], ['rechnung', icon('invoice') + 'Rechnung']], settings.belegArt))}
        <p class="hint">Vorauswahl beim Erfassen einer Einnahme. Eine Quittung bestätigt, dass bezahlt wurde; eine Rechnung fordert zur Zahlung auf (z. B. per Überweisung). Beim Erfassen jederzeit umstellbar.</p>
      </section>
      <section><h3>Firma</h3>
        <div class="set-row"><div class="set-label"><span>Firmenlogo</span></div>
          <div class="logo-feld">
            <button type="button" class="dropzone logo-dz" data-action="logo-waehlen" title="Bild hierher ziehen oder klicken" aria-label="Logo hochladen">${brandLogo()}</button>
            <div class="logo-info"><b>${F.logo ? 'Eigenes Logo' : 'Standard-Symbol'}</b>
              <small>PNG, JPG, SVG oder WebP – am besten quadratisch, mit weißem oder transparentem Hintergrund.</small>
              <div class="row wrap"><button type="button" class="btn subtle" data-action="logo-waehlen">${icon('upload')}${F.logo ? 'Anderes Logo …' : 'Logo hochladen …'}</button>
              ${F.logo ? `<button type="button" class="btn ghost" data-action="logo-reset">${icon('reset')}Zurücksetzen</button>` : ''}</div></div>
            <input type="file" id="logoDatei" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden>
          </div>
          <p class="hint">Erscheint oben links im Menü und im Kopf von Rechnungen und Angeboten. Auf die Quittung kommt es mit dem Baustein „Kopf mit Logo“ (Vorlagen). Bereits ausgestellte Belege behalten ihr bisheriges Aussehen.</p>
        </div>
        <dl class="facts">
          <div class="fact"><dt>Name</dt><dd>${esc(F.name)}</dd></div><div class="fact"><dt>Inhaber</dt><dd>${esc(F.inhaber)}</dd></div>
          <div class="fact"><dt>Anschrift</dt><dd>${esc(F.strasse)}, ${esc(F.plz)} ${esc(F.ort)}</dd></div><div class="fact"><dt>Steuernummer</dt><dd>${esc(F.steuernummer)}</dd></div>
          <div class="fact"><dt>IBAN</dt><dd class="mono">${esc(window.QR ? QR.ibanFormat(F.iban) : F.iban)}</dd></div><div class="fact"><dt>Umsatzsteuer</dt><dd>Kleinunternehmer (§ 19 UStG)</dd></div>
        </dl>
        <p class="hint">Im Prototyp sind das Demo-Daten. In der Mac-App sind alle Felder editierbar.</p>
      </section>
      <section class="set-backup"><h3>Datensicherung</h3>
        ${row('Sicherung speichern auf', seg('setting', 'backupZiel', [['mac', 'Diesem Mac'], ['usb', 'USB-Stick'], ['icloud', 'iCloud Drive']], settings.backupZiel))}
        ${(() => { const b = backupStatus(); return `<div class="set-note ${b.warn ? 'warn' : 'ok'}">${icon(b.warn ? 'alert' : 'check')}<span>${b.html}</span></div>`; })()}
        <div class="row wrap"><button type="button" class="btn subtle" data-action="backup-jetzt">${icon('download')}Jetzt sichern</button>
        <button type="button" class="btn ghost" data-action="backup-laden">${icon('upload')}Wiederherstellen …</button></div>
        <input type="file" id="backupDatei" accept="application/json,.json" hidden>
        <p class="hint">Die App sichert täglich automatisch und vor jedem Update. Im Prototyp lädt „Jetzt sichern“ eine Datei herunter, das Ziel ist nur simuliert.</p>
      </section>
      <section><h3>Daten</h3>
        <p class="hint">Änderungen (neue Einnahmen und Ausgaben, Belege, Termine, Kunden, Kennzahlen) werden im Browser gespeichert.</p>
        <div class="row wrap"><button type="button" class="btn ghost" data-action="reset-settings">${icon('reset')} Darstellung zurücksetzen</button>
        <button type="button" class="btn danger" data-action="reset-data">${icon('trash')} Demo-Daten zurücksetzen</button></div>
      </section>
      <section class="set-ueber"><h3>Über ${APP_NAME}</h3>
        <p class="set-version">${LOGO}<span><b>${APP_NAME}</b><small>Prototyp · Stand ${fmt.datum(D.TODAY)}</small></span></p>
        <div class="set-note">${icon('info')}<span><b>Keine Steuerberatung.</b> ${APP_NAME} hilft dir, alles festzuhalten und auszuwerten. Berechnungen, Hinweise und Exporte sind ohne Gewähr – im Zweifel Steuerberatung oder Finanzamt fragen.</span></div>
        <div class="set-note">${icon('lock')}<span><b>Deine Daten bleiben auf diesem Mac.</b> Kein Konto, keine Cloud, kein Tracking. Ins Internet geht die App nur für die Update-Prüfung (eine Versionsdatei bei GitHub) und einmalig für den PDF-Satz.</span></div>
      </section>`;
    updateSegs(root);
  }
  /* Einstellungen neu zeichnen, Scrollposition behalten (z. B. nach „Jetzt sichern“ oder Zielwechsel) */
  function einstellungenNeu() {
    const d = $('#ov-settings .drawer'); if (!d) return;
    const body = $('.drawer-body', d), y = body ? body.scrollTop : 0;
    renderSettings(d); if (body) body.scrollTop = y;
  }
  function openSettings() {
    const d = drawer.open({ id: 'settings', title: 'Einstellungen', icon: 'gear', width: 440 });
    renderSettings(d);
  }
  function setSetting(key, val) {
    if (['tintH', 'tintS', 'radius', 'fontScale'].includes(key)) val = Number(val);
    settings[key] = val;
    if (['accent', 'tintH', 'tintS'].includes(key)) { settings.theme = 'custom'; $$('.theme-sw').forEach((b) => b.classList.remove('active')); }
    if (key === 'backupZiel') settings.backupZuletzt = ''; // neues Ziel: dort gibt es noch keine Sicherung
    saveSettings(); applySettings();
    if (key === 'backupZiel') { syncBackupDot(); einstellungenNeu(); }
    const out = document.querySelector(`[data-setting="${key}"]`)?.closest('.set-row')?.querySelector('output');
    if (out) out.textContent = val + ({ tintH: '°', tintS: '%', radius: 'px', fontScale: '%' }[key] || '');
    const code = document.querySelector('.color-row code'); if (code && key === 'accent') code.textContent = String(val).toUpperCase();
    requestAnimationFrame(() => updateSegs());
  }
  function applyTheme(id) {
    const th = THEMES.find((x) => x.id === id); if (!th) return;
    Object.assign(settings, { theme: id, accent: th.accent, tintH: th.tintH, tintS: th.tintS, numFont: th.numFont || 'sans' });
    saveSettings(); applySettings();
    const d = $('#ov-settings .drawer'); if (d) renderSettings(d);
  }
  function toggleMode(ev) {
    const next = effectiveMode() === 'dark' ? 'light' : 'dark';
    const go2 = () => { settings.mode = next; saveSettings(); applySettings(); const d = $('#ov-settings .drawer'); if (d) renderSettings(d); };
    if (!document.startViewTransition || settings.motion !== 'full') { go2(); return; }
    const x = (ev && ev.clientX) || innerWidth - 60, y = (ev && ev.clientY) || 30;
    const rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const tr = document.startViewTransition(go2);
    tr.ready.then(() => document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${rad}px at ${x}px ${y}px)`] },
      { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)', pseudoElement: '::view-transition-new(root)' }));
  }

  /* ================= Tooltips ([data-tip]) ================= */
  const gtip = $('#gtip');
  let tipTarget = null;
  function showTip(el) {
    gtip.innerHTML = `${el.dataset.tipTitle ? `<b>${esc(el.dataset.tipTitle)}</b>` : ''}<p>${esc(el.dataset.tip)}</p>${el.dataset.tipCode ? `<code>${esc(el.dataset.tipCode)}</code>` : ''}`;
    gtip.classList.add('show');
    const r = el.getBoundingClientRect(), tw = gtip.offsetWidth, th = gtip.offsetHeight;
    const left = Math.min(innerWidth - tw - 10, Math.max(10, r.left + r.width / 2 - tw / 2));
    let top = r.bottom + 10, below = true;
    if (top + th > innerHeight - 10) { top = r.top - th - 10; below = false; }
    gtip.style.left = left + 'px'; gtip.style.top = top + 'px';
    gtip.dataset.side = below ? 'below' : 'above';
  }
  function hideTip() { gtip.classList.remove('show'); tipTarget = null; }
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el === tipTarget) return;
    tipTarget = el;
    if (el) showTip(el); else gtip.classList.remove('show');
  });
  document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) { tipTarget = el; showTip(el); } });
  document.addEventListener('focusout', hideTip);
  window.addEventListener('scroll', hideTip, { passive: true });

  /* ================= Toasts ================= */
  function toast(msg, { action = null, actions = null, icon: ic = 'check', ms = 3200 } = {}) {
    const acts = actions || (action ? [action] : []);
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>${acts.map((x, i) => `<button type="button" data-i="${i}">${esc(x.label)}</button>`).join('')}`;
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { acts[+b.dataset.i].fn(); el.remove(); }));
    if (acts.length) ms = Math.max(ms, 5000);
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  /* ================= Datei auf das Fenster ziehen ================= */
  const dropOv = $('#dropOverlay');
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; dropOv.classList.add('show'); });
  window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropOv.classList.remove('show'); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; dropOv.classList.remove('show');
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    if (e.target.closest && e.target.closest('.dropzone')) return; // eigene Dropzone kümmert sich selbst
    if (typeof App.dropTarget === 'function') App.dropTarget(files);
    else { App.pendingFiles = files; go('#/buchungen?drop=1'); }
  });

  /* ================= Globale Events ================= */
  const ACTIONS = {};
  const action = (name, fn) => { ACTIONS[name] = fn; };
  function setStateKey(key, val) {
    state[key] = val; saveState(); rerender();
  }
  document.addEventListener('click', (e) => {
    const segBtn = e.target.closest('.seg button');
    if (segBtn) {
      const s = segBtn.parentElement, { kind, key } = s.dataset;
      $$('button', s).forEach((b) => { b.classList.toggle('active', b === segBtn); b.setAttribute('aria-selected', String(b === segBtn)); });
      updateSegs(s.parentElement);
      if (kind === 'setting') setSetting(key, segBtn.dataset.value);
      else if (kind === 'state') setStateKey(key, segBtn.dataset.value);
      else s.dispatchEvent(new CustomEvent('seg-change', { bubbles: true, detail: { key, value: segBtn.dataset.value } }));
      return;
    }
    const sd = e.target.closest('[data-sd]');
    if (sd) { runSd(+sd.dataset.sd, e); return; }
    if (!e.target.closest('#search')) closeSearch();
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    if (act === 'toggle-sidebar') toggleSidebar();
    else if (act === 'open-settings') openSettings();
    else if (act === 'close-drawer') drawer.close();
    else if (act === 'theme') applyTheme(a.dataset.id);
    else if (act === 'reset-settings') { settings = { ...DEFAULTS }; saveSettings(); applySettings(); openSettings(); }
    else if (act === 'reset-data') { if (confirm('Alle im Prototyp gemachten Änderungen verwerfen und die Demo-Daten neu laden?')) resetData(); }
    else if (act === 'toggle-mode') toggleMode(e);
    else if (act === 'period-prev' || act === 'period-next') {
      let a = shiftAnchor(period().von, state.ptyp, act === 'period-prev' ? -1 : 1);
      const r = rangeOf(state.ptyp, a);
      if (r.bis < D.START || a > D.TODAY) return;
      if (r.von <= D.TODAY && D.TODAY <= r.bis) a = D.TODAY; // zurück im laufenden Zeitraum → Anker wieder heute (Monat/Quartal passen dann)
      state.panchor = a; saveState(); rerender();
    }
    else if (act === 'mark-paid') { e.preventDefault(); e.stopPropagation(); markPaid(a.dataset.id); }
    else if (act === 'erfassen') erfassen(a.dataset.typ ? { typ: a.dataset.typ } : {});
    else if (ACTIONS[act]) ACTIONS[act](a, e);
  });
  /* ================= Datensicherung (Einstellungen → Datensicherung) ================= */
  /* Warnen, solange die Sicherung auf demselben Mac liegt (Defekt/Diebstahl → beides weg) oder die letzte Sicherung auf
   * USB-Stick/iCloud älter als BACKUP_TAGE ist; dazu ein Hinweis-Punkt am ⚙. Mac-App: Ziel per Ordnerwahl, „gleicher Datenträger“ über st_dev. */
  const BACKUP_TAGE = 30;
  function backupStatus() {
    const z = settings.backupZiel, zuletzt = settings.backupZuletzt || '', alter = zuletzt ? U.diffDays(zuletzt, D.TODAY) : null;
    if (z !== 'usb' && z !== 'icloud') return { warn: true, html: '<b>Die Sicherung liegt auf demselben Mac wie deine Daten.</b> Geht der Mac kaputt oder wird er gestohlen, ist beides weg. Wähle einen USB-Stick oder iCloud Drive.' };
    const ort = z === 'usb' ? 'auf dem USB-Stick' : 'in iCloud Drive';
    if (alter == null) return { warn: true, html: `<b>Noch keine Sicherung ${ort}.</b> ${z === 'usb' ? 'Stick anstecken und' : 'Einmal'} „Jetzt sichern“ – danach sichert die App ${z === 'usb' ? 'automatisch, sobald der Stick steckt' : 'täglich automatisch'}.` };
    if (alter > BACKUP_TAGE) return { warn: true, html: `<b>Letzte Sicherung ${ort} ist ${alter} Tage alt.</b> ${z === 'usb' ? 'Stick anstecken und' : 'Bitte'} „Jetzt sichern“.` };
    return { warn: false, html: `<b>Letzte Sicherung ${ort}: ${alter === 0 ? 'heute' : fmt.rel(zuletzt)}.</b> Erinnerung, sobald sie älter als ${BACKUP_TAGE} Tage ist.` };
  }
  function syncBackupDot() {
    const b = $('.tb-gear'); if (!b) return;
    const warn = backupStatus().warn;
    $('.tb-dot', b).hidden = !warn;
    b.title = warn ? 'Einstellungen · Datensicherung prüfen' : 'Einstellungen';
  }
  /* Prototyp: Stand als JSON herunterladen (Mac-App: VACUUM INTO + Belege als ZIP in den gewählten Ordner) */
  function backupJetzt() {
    const inhalt = { app: APP_NAME, version: D.VERSION, erstellt: new Date().toISOString(), daten: datenStand() };
    const name = `kladdy-sicherung-${D.TODAY}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(inhalt)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    settings.backupZuletzt = D.TODAY; saveSettings(); syncBackupDot(); einstellungenNeu();
    toast(`Sicherung erstellt: ${name}`, { icon: 'download' });
  }
  async function backupLaden(file) {
    if (!file) return;
    let j = null; try { j = JSON.parse(await file.text()); } catch { /* unten */ }
    const d = j && j.daten;
    if (!d || j.app !== APP_NAME || !STORE_KEYS.some((k) => Array.isArray(d[k]))) { toast('Das ist keine Kladdy-Sicherung.', { icon: 'alert' }); return; }
    if (j.version !== D.VERSION) { toast(`Die Sicherung stammt aus einer anderen Version (${j.version}) und passt nicht zu diesem Prototyp.`, { icon: 'alert' }); return; }
    if (!confirm(`Sicherung vom ${fmt.datum(String(j.erstellt).slice(0, 10))} laden?\nDer aktuelle Stand wird dabei ersetzt.`)) return;
    LS.set('gb.data.v' + D.VERSION, d);
    App.neuLaden();
  }
  action('backup-jetzt', () => backupJetzt());
  action('backup-laden', () => { const i = $('#backupDatei'); if (i) i.click(); });
  document.addEventListener('change', (e) => { if (e.target.id === 'backupDatei') { backupLaden(e.target.files && e.target.files[0]); e.target.value = ''; } });

  /* ================= Firmenlogo (Einstellungen → Firma) ================= */
  /* Verkleinert auf höchstens 720 × 240 px (16 mm Logohöhe im Druck brauchen ~190 px) und als PNG gespeichert (Transparenz bleibt) */
  function logoVerkleinern(file) {
    return new Promise((ok, fail) => {
      const src = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || 512, h = img.naturalHeight || 512, f = Math.min(1, 720 / w, 240 / h);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * f)); c.height = Math.max(1, Math.round(h * f));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(src); ok(c.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(src); fail(new Error('kein Bild')); };
      img.src = src;
    });
  }
  /* GoBD: vorher merkt sich jeder ausgestellte Beleg sein bisheriges Logo (r.logoId, belege.js → einfrieren); alte Logos
   * bleiben nur so lange im Archiv, wie ein Beleg sie braucht. url = '' → zurück zum Standard-Symbol. */
  function logoSetzen(url) {
    if (App.sheet && App.sheet.einfrierenAlle) App.sheet.einfrierenAlle();
    const F = D.FIRMA, archiv = F.logoArchiv || {};
    if (F.logo && F.logoId) archiv[F.logoId] = F.logo;
    F.logo = url || ''; F.logoId = url ? 'lg' + Date.now().toString(36) : '';
    const genutzt = new Set(D.rechnungen.map((r) => r.logoId).filter(Boolean));
    Object.keys(archiv).forEach((id) => { if (!genutzt.has(id)) delete archiv[id]; });
    F.logoArchiv = archiv;
    save(); renderSidebar();
    const d = $('#ov-settings .drawer'); if (d) renderSettings(d);
  }
  async function logoLaden(file) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|svg\+xml|webp)$/.test(file.type)) { toast('Bitte ein Bild wählen (PNG, JPG, SVG oder WebP).', { icon: 'alert' }); return; }
    if (file.size > 10 * 1024 * 1024) { toast('Das Bild ist zu groß (höchstens 10 MB).', { icon: 'alert' }); return; }
    let url;
    try { url = await logoVerkleinern(file); } catch { toast('Das Bild ließ sich nicht öffnen.', { icon: 'alert' }); return; }
    const vorher = { logo: D.FIRMA.logo, id: D.FIRMA.logoId };
    logoSetzen(url);
    toast('Logo übernommen', { action: { label: 'Rückgängig', fn: () => logoSetzen(vorher.logo) } });
  }
  action('logo-waehlen', () => { const i = $('#logoDatei'); if (i) i.click(); });
  action('logo-reset', () => { const alt = D.FIRMA.logo; logoSetzen(''); toast('Standard-Symbol wiederhergestellt', { action: { label: 'Rückgängig', fn: () => logoSetzen(alt) } }); });
  document.addEventListener('change', (e) => { if (e.target.id === 'logoDatei') { logoLaden(e.target.files && e.target.files[0]); e.target.value = ''; } });
  document.addEventListener('dragover', (e) => { const z = e.target.closest && e.target.closest('.logo-dz'); if (z) { e.preventDefault(); z.classList.add('over'); } });
  document.addEventListener('dragleave', (e) => { const z = e.target.closest && e.target.closest('.logo-dz'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
  document.addEventListener('drop', (e) => {
    const z = e.target.closest && e.target.closest('.logo-dz'); if (!z) return;
    e.preventDefault(); z.classList.remove('over'); logoLaden(e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  document.addEventListener('input', (e) => {
    const s = e.target.closest('[data-setting]');
    if (s) { setSetting(s.dataset.setting, s.type === 'checkbox' ? s.checked : s.value); return; }
    if (e.target.id === 'searchInput') { sdActive = 0; openSearch(); }
  });
  document.addEventListener('focusin', (e) => { if (e.target.id === 'searchInput') openSearch(); });
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#searchInput').focus(); $('#searchInput').select(); openSearch(); return; }
    if (mod && e.key === '\\') { e.preventDefault(); toggleSidebar(); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); toggleMode(); return; }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'n' && !drawer.isOpen()) { e.preventDefault(); erfassen(); return; }
    if ($('#search').classList.contains('open') && document.activeElement === $('#searchInput')) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sdActive = Math.min(sdItems.length - 1, sdActive + 1); renderSearch(); $('.sd-item.active')?.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sdActive = Math.max(0, sdActive - 1); renderSearch(); $('.sd-item.active')?.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { e.preventDefault(); runSd(sdActive, e); }
      else if (e.key === 'Escape') closeSearch();
      return;
    }
    if (e.key === 'Escape') { if (drawer.isOpen()) drawer.close(); else if (app.classList.contains('sb-open')) toggleSidebar(); }
  });
  window.addEventListener('resize', () => { updateSegs(); if (!isMobile()) app.classList.remove('sb-open'); syncSidebarToggle(); });
  window.addEventListener('hashchange', () => { drawer.close(true); render(); if (isMobile()) app.classList.remove('sb-open'); });

  /* ================= Kunden-Auswahl per Eingabe =================
   * Kunden hängen überall an ihrer festen Nummer (K-0012), nicht am Namen. Eingabefelder für Kunden zeigen deshalb
   * „Name · K-0012“ als Vorschlag (mit Adresse). kundeAusEingabe() löst eine Eingabe auf:
   *   { k: Kunde | null, liste: [alle Treffer], neu: true wenn unbekannt, name: Name ohne Nummer }
   * Mehrere Treffer (gleicher Name, keine Nummer) ⇒ k = null, die Seite fragt nach („Welche Anna Schmidt?“). */
  const kundenLabel = (k) => `${k.name} · ${D.kundenNr(k)}`;
  const kundenOrt = (k) => [k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  function kundeAusEingabe(text) {
    const roh = String(text || '').trim();
    const nr = (roh.match(/\bK-\d{3,}\b/i) || [])[0];
    const name = roh.replace(/\s*[·(,-]?\s*K-\d{3,}\)?\s*$/i, '').trim();
    if (!roh) return { k: null, liste: [], neu: false, name: '' };
    if (nr) { const k = D.KONTAKTE.find((x) => D.kundenNr(x).toUpperCase() === nr.toUpperCase()); if (k) return { k, liste: [k], neu: false, name: k.name }; }
    const n = name.toLowerCase().replace(/\s+/g, ' ');
    const liste = D.KONTAKTE.filter((x) => String(x.name || '').trim().toLowerCase().replace(/\s+/g, ' ') === n);
    return { k: liste.length === 1 ? liste[0] : null, liste, neu: !liste.length, name };
  }
  /* <option>-Liste für <datalist>: value = „Name · K-0012“, Beschriftung = Adresse; sortiert nach fn (Standard: Name) */
  function kundenOptionen(sort = (a, b) => a.name.localeCompare(b.name, 'de')) {
    return D.KONTAKTE.slice().sort(sort).map((k) => `<option value="${esc(kundenLabel(k))}">${esc(kundenOrt(k) || 'ohne Adresse')}</option>`).join('');
  }

  /* Zentrales Erfassen – der eine Weg für Ein- und Ausgänge (Knopf im Kopf von Ein- & Ausgänge, ⌘N, Befehle).
   * prefill: { typ: 'ausgabe'|'einnahme', beleg: 'quittung'|'rechnung', kontakt, betrag, text, … } */
  function erfassen(prefill = {}) {
    if (typeof App.neueBuchung === 'function') App.neueBuchung({ typ: 'ausgabe', ...prefill });
    else go(`#/buchungen?neu=1${prefill.typ ? '&typ=' + prefill.typ : ''}`);
  }

  /* Rechnung als bezahlt markieren → Einnahme-Buchung (mit Rückgängig) */
  function nextBuchungNr(datum) {
    const y = datum.slice(0, 4);
    const max = D.buchungen.filter((b) => b.nr.startsWith(y)).reduce((m, b) => Math.max(m, +b.nr.slice(5)), 0);
    return `${y}-${String(max + 1).padStart(4, '0')}`;
  }
  function markPaid(id, datum = D.TODAY, zahlungsart = 'bank') {
    const r = D.rechnungen.find((x) => x.id === id); if (!r || r.status !== 'offen') return;
    const vorher = { zahlungsart: r.zahlungsart };
    r.status = 'bezahlt'; r.bezahltAm = datum; r.zahlungsart = zahlungsart;
    const b = { id: 'b' + Date.now(), nr: nextBuchungNr(datum), typ: 'einnahme', datum, betrag: D.rechnungSumme(r), kat: r.kat || 'dienstleistung', kontakt: r.kontakt, kunde: D.gegenueber(r) || null, zahlungsart, text: `${r.betreff} · ${D.gegenueber(r)}`, rechnung: r.id, privat: 0, beleg: `${r.nr}.pdf`, belegnr: r.nr };
    D.buchungen.push(b);
    save(); rerender();
    toast(`${r.nr} bezahlt · Einnahme ${b.nr} gebucht`, { action: { label: 'Rückgängig', fn: () => { r.status = 'offen'; r.bezahltAm = null; r.zahlungsart = vorher.zahlungsart; D.buchungen.splice(D.buchungen.indexOf(b), 1); save(); rerender(); } } });
  }

  /* ================= Start ================= */
  const App = {
    D, $, $$, esc, icon, ICONS, LOGO, LS, fmt, num, deltaHTML, pctChange, monogram, colorFor, initials,
    seg, updateSegs, periodHTML, period, rangeOf, vergleich, shiftAnchor,
    page, go, rerender, render, action, drawer, toast, countUp, kpi, save, resetData, auswertungKopf, AUSWERTUNG,
    fctx, kz, ampelOf, summen, offeneRechnungen, prognose, markPaid, nextBuchungNr, erfassen, kundenLabel, kundenOrt, kundeAusEingabe, kundenOptionen,
    get settings() { return settings; }, state, setState: setStateKey, effectiveMode, toggleMode,
    get route() { return route; }, dropTarget: null, pendingFiles: null, isMac,
    neuLaden: () => location.reload() // nach „Wiederherstellen“ (Tests ersetzen es)
  };
  window.App = App;
  app.classList.toggle('sb-collapsed', !!state.sidebarCollapsed);
  if (qp.get('theme')) { const th = THEMES.find((x) => x.id === qp.get('theme')); if (th) Object.assign(settings, { theme: th.id, accent: th.accent, tintH: th.tintH, tintS: th.tintS }); }
  applySettings();
  renderTopbar();
  applySettings();
  // Seiten melden sich nach diesem Skript an → erstes Rendern nach dem Laden aller Skripte
  window.addEventListener('DOMContentLoaded', () => {
    render();
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('ready')));
  });
})();
