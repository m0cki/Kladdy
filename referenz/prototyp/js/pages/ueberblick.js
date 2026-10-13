/* Kladdy – Prototyp · Auswertung → Überblick
 * Erster Reiter der Auswertung (großer Umschalter aus App.auswertungKopf): Status auf einen Blick,
 * Kennzahlen des Zeitraums, Einnahmen & Ausgaben je Monat, Ausgaben nach Kategorie, Überschuss kumuliert,
 * Einnahmen nach Zahlungsweg und angeheftete eigene Kennzahlen.
 * Bewusst NICHT hier: Erfassen (nur „+ Erfassen“ bei Ein- & Ausgänge), Buchungsliste (Ein- & Ausgänge),
 * Liquidität, Kleinunternehmer-Details und EÜR (eigene Reiter).
 */
(() => {
  'use strict';
  const { D, $, esc, icon, fmt, kpi, deltaHTML, pctChange } = App;
  const U = D.util;
  const T = D.TODAY, Y = +T.slice(0, 4), M = +T.slice(5, 7);

  /* Monate seit Jahresbeginn (anteilig), für Hochrechnungen */
  const monateVergangen = () => (M - 1) + (+T.slice(8, 10)) / U.daysIn(Y, M);

  /* gleiche Basis wie der Reiter „Kleinunternehmer“ (ganzes Kalenderjahr) */
  function kuDaten() {
    const lfd = App.summen(`${Y}-01-01`, `${Y}-12-31`).ku / 100;
    return { lfd, hoch: lfd / monateVergangen() * 12, g25: D.PARAMS[Y].ku_grenze_vorjahr };
  }

  function render(el) {
    const p = App.period(), v = App.vergleich(p);
    const s = App.summen(p.von, p.bis), sv = App.summen(v.von, v.bis);
    const offen = App.offeneRechnungen(), ueber = offen.filter((r) => r.faellig < T);
    const auftrag = (r, a) => r.nr && (r.art === 'quittung' || r.art === 'rechnung') && r.status !== 'storniert' && r.datum >= a.von && r.datum <= a.bis;
    const belege = D.rechnungen.filter((r) => auftrag(r, p)), belegeV = D.rechnungen.filter((r) => auftrag(r, v));
    const ohneBeleg = D.buchungen.filter((b) => (b.typ === 'einnahme' || b.typ === 'ausgabe') && !b.beleg);
    const ku = kuDaten(), kuQuote = ku.hoch / ku.g25;
    const prog = App.prognose({ tage: 90, historie: 0 });
    const pj = p.von.slice(0, 4); // Jahr des Zeitraums → EÜR dieses Jahres

    const pills = [
      `<a class="status-pill ${kuQuote >= 1 ? 'alarm' : kuQuote >= 0.8 ? 'warn' : 'ok'}" href="#/steuer?tab=ku&jahr=${Y}"><i class="status-dot"></i><b>Kleinunternehmer</b><span>${fmt.eurE(ku.lfd, { dec: 0 })} von ${fmt.eurE(ku.g25, { dec: 0 })} · Hochrechnung ${fmt.pct(kuQuote, 0)}</span></a>`,
      offen.length ? `<a class="status-pill ${ueber.length ? 'alarm' : 'ok'}" href="#/rechnungen?tab=offen"><i class="status-dot"></i><b>${offen.length} offene Rechnung${offen.length > 1 ? 'en' : ''}${ueber.length ? ` · ${ueber.length} überfällig` : ''}</b><span>${fmt.eur(offen.reduce((a, r) => a + D.rechnungSumme(r), 0), { dec: 0 })}</span></a>` : '',
      ohneBeleg.length ? `<a class="status-pill warn" href="#/buchungen"><i class="status-dot"></i><b>${ohneBeleg.length} ohne Beleg</b><span>nachreichen</span></a>` : '',
      `<a class="status-pill ${prog.netto < 0 ? 'alarm' : 'ok'}" href="#/liquiditaet"><i class="status-dot"></i><b>Nächste 90 Tage</b><span>${fmt.eurE(prog.netto, { dec: 0, sign: true })} erwartet</span></a>`
    ].join('');

    const sub = (a, b, o) => `${deltaHTML(pctChange(a, b), o)}<span class="muted">${esc(v.text)}</span>`;
    const kpis = [
      kpi({ label: 'Einnahmen', count: s.ein, cfmt: 'eur0', sub: sub(s.ein, sv.ein), tip: 'Alle Betriebseinnahmen mit Zahlungseingang im Zeitraum (Zuflussprinzip).', href: '#/buchungen', i: 2 }),
      kpi({ label: 'Ausgaben', count: s.aus, cfmt: 'eur0', sub: sub(s.aus, sv.aus, { invert: true }), tip: 'Abziehbare Betriebsausgaben im Zeitraum (ohne Privatanteile).', href: '#/buchungen', i: 3 }),
      kpi({ label: 'Überschuss', count: s.gewinn, cfmt: 'eur0', sub: sub(s.gewinn, sv.gewinn), tip: 'Einnahmen minus abziehbare Ausgaben – der Gewinn laut EÜR.', href: `#/steuer?tab=euer&jahr=${pj}`, i: 4 }),
      kpi({ label: 'Aufträge', count: belege.length, cfmt: 'num', sub: `${deltaHTML(pctChange(belege.length, belegeV.length))}<span class="muted">${belege.filter((r) => r.art === 'quittung').length} Quittungen · ${belege.filter((r) => r.art === 'rechnung').length} Rechnungen</span>`, tip: 'Ausgestellte Quittungen und Rechnungen im Zeitraum (laufende Nummern).', tipTitle: 'Aufträge', href: '#/rechnungen', i: 5 })
    ].join('');

    const pinned = D.KENNZAHLEN.filter((k) => k.anheften);

    el.innerHTML = `
      <div class="page ub-page">
        ${App.auswertungKopf('auswertung', App.periodHTML())}
        <div class="status-pills ub-pills reveal" style="--i:1">${pills}</div>
        <div class="kpis k4">${kpis}</div>

        <div class="grid-2">
          <section class="card reveal" style="--i:6">
            <div class="card-head wrap"><div><div class="card-title">${icon('chart')}Einnahmen & Ausgaben</div><div class="card-sub">letzte 12 Monate · in € · Klick wählt den Monat</div></div><div id="ovLegend"></div></div>
            <div class="chart" id="ovBars"></div>
          </section>
          <section class="card reveal" style="--i:7">
            <div class="card-head wrap"><div><div class="card-title">${icon('sigma')}Überschuss kumuliert</div><div class="card-sub">${Y} im Vergleich zu ${Y - 1} · in €</div></div><div id="ovCumLegend"></div></div>
            <div class="chart" id="ovCum"></div>
          </section>
        </div>

        <div class="grid-2">
          <section class="card reveal" style="--i:8">
            <div class="card-head"><div><div class="card-title">${icon('list')}Wofür das Geld rausgeht</div><div class="card-sub">${esc(p.label)} · abziehbare Ausgaben nach Kategorie</div></div></div>
            <div id="ovDonut"></div>
          </section>
          <section class="card reveal" style="--i:9">
            <div class="card-head"><div><div class="card-title">${icon('card')}Wie Kunden bezahlen</div><div class="card-sub">${esc(p.label)} · Einnahmen nach Zahlungsweg</div></div></div>
            <div id="ovDonutEin"></div>
          </section>
        </div>

        ${pinned.length ? `<div class="ov-bar reveal" style="--i:10"><h2 class="section-title">${icon('star')}Meine Kennzahlen <span class="muted">· ${esc(p.label)}</span></h2><a class="link" href="#/kennzahlen">Kennzahlen verwalten ${icon('arrow')}</a></div>
        <div class="kz-tiles">${pinned.map((k, i) => kzTile(k, p, i)).join('')}</div>` : ''}
      </div>`;

    drawBars();
    drawDonut(p, 'ausgabe', '#ovDonut', 'Ausgaben');
    drawDonut(p, 'einnahme', '#ovDonutEin', 'Einnahmen', (b) => D.zahlungsart(b.zahlungsart).id); // Altwerte ('karte' …) → Überweisung
    drawCum();
  }

  /* Vergleichszeitraum je Kennzahl – wie im Reiter „Kennzahlen“: Vorperiode (Standard), Vorjahr oder keiner */
  function vglOf(k, p) {
    const art = k.vergleich || 'vorperiode';
    if (art === 'keiner') return null;
    if (art === 'vorperiode' || p.typ === 'jahr') return App.vergleich(p);
    const r = App.rangeOf(p.typ, App.shiftAnchor(p.von, 'jahr', -1));
    if (p.von <= T && T <= p.bis) { r.bis = U.addDays(r.von, U.diffDays(p.von, T)); r.teil = true; }
    r.text = r.teil ? 'ggü. Vorjahr (gleich lang)' : 'ggü. Vorjahr';
    return r;
  }

  function kzTile(k, p, i) {
    const val = App.kz(k, p), vg = vglOf(k, p), prev = vg ? App.kz(k, vg) : NaN;
    const ampel = App.ampelOf(k, val);
    // Verlauf: Wert je Monat der letzten 12 Monate
    const vals = [];
    for (let n = 11; n >= 0; n--) { const a = App.shiftAnchor(T, 'monat', -n); vals.push(App.kz(k, App.rangeOf('monat', a))); }
    const inv = !!(k.ampel && k.ampel.richtung === 'niedrig');
    const diff = !vg ? '' : k.format === 'prozent'
      ? deltaHTML(isFinite(val) && isFinite(prev) ? (val - prev) * 100 : null, { pp: true, invert: inv })
      : deltaHTML(pctChange(val, prev), { invert: inv });
    // kurz wie in der Kennzahlen-Liste („Vorjahr“), der volle Text steht im Tooltip
    const vgl = vg ? `${diff}<span class="muted" title="${esc(vg.text)}">${esc(vg.text.replace('ggü. ', '').replace(/ \(.*\)$/, ''))}</span>` : '<span class="muted">ohne Vergleich</span>';
    return `<a class="kz-tile reveal" style="--i:${15 + i}" href="#/kennzahlen?k=${k.id}">
      <div class="kz-head"><span>${esc(k.name)}</span>${ampel ? `<i class="ampel ${ampel}"></i>` : ''}</div>
      <div class="kz-val">${esc(fmt.kz(val, k.format, k.dec))}</div>
      <div class="kz-foot"><span class="kpi-sub">${vgl}</span>${window.Charts ? Charts.spark(vals, 'var(--accent)', 96, 28) : ''}</div>
      <code class="kz-formel">${esc(k.formel)}</code></a>`;
  }

  /* ---------- Diagramme ---------- */
  function last12() {
    const out = [];
    for (let n = 11; n >= 0; n--) {
      const a = App.shiftAnchor(T, 'monat', -n), r = App.rangeOf('monat', a);
      out.push({ ...r, s: App.summen(r.von, r.bis) });
    }
    return out;
  }
  function drawBars() {
    const ms = last12();
    const series = [
      { name: 'Einnahmen', color: 'var(--series-1)', values: ms.map((m) => m.s.ein / 100) },
      { name: 'Ausgaben', color: 'var(--series-2)', values: ms.map((m) => m.s.aus / 100) }
    ];
    $('#ovLegend').innerHTML = Charts.legend(series);
    Charts.bars($('#ovBars'), {
      labels: ms.map((m) => fmt.monatKurz(m.von)), series, height: 260,
      fmtY: (v, st) => fmt.axis(v, st), fmtTip: (v) => fmt.eurE(v),
      tipTitle: (i) => ms[i].label,
      extraTip: (i) => [{ name: 'Überschuss', value: fmt.eur(ms[i].s.gewinn) }],
      onClick: (i) => { App.state.ptyp = 'monat'; App.state.panchor = ms[i].von; App.setState('panchor', ms[i].von); }
    });
  }
  function drawDonut(p, typ, sel, label, gruppe = null) {
    const by = {};
    D.buchungen.forEach((b) => {
      if (b.typ !== typ || b.datum < p.von || b.datum > p.bis) return;
      const k = D.kat(b.kat), key = gruppe ? gruppe(b) : b.kat;
      // abziehbarer Betrag je Ausgabe auf Cent gerundet – wie App.summen und die EÜR
      by[key] = (by[key] || 0) + (typ === 'ausgabe' ? Math.round(b.betrag * (1 - (b.privat || 0) / 100) * ((k ? k.abziehbar : 100) / 100)) : b.betrag);
    });
    let items = Object.entries(by).map(([id, c]) => gruppe
      ? { name: D.zahlungsart(id).name, value: c / 100, color: D.zahlungsart(id).farbe || 'var(--muted)' }
      : { name: (D.kat(id) || { name: id }).name, value: c / 100, color: (D.kat(id) || { farbe: 'var(--muted)' }).farbe }).sort((a, b) => b.value - a.value);
    if (items.length > 6) { const rest = items.slice(6).reduce((s, x) => s + x.value, 0); items = items.slice(0, 6).concat({ name: 'Übrige', value: rest, color: 'var(--muted)' }); }
    const total = items.reduce((s, x) => s + x.value, 0);
    if (!items.length) { $(sel).innerHTML = `<div class="empty">${icon('info')}<span>Keine ${label} im Zeitraum.</span></div>`; return; }
    Charts.donut($(sel), { items, center: fmt.eurE(total, { dec: 0 }), centerSub: label, fmt: (v) => fmt.eurE(v, { dec: 0 }) });
  }
  function drawCum() {
    const labels = [], cur = [], prev = [];
    let a = 0, b = 0;
    for (let m = 1; m <= 12; m++) {
      labels.push(fmt.monatKurz(`${Y}-${String(m).padStart(2, '0')}`));
      const r1 = App.rangeOf('monat', `${Y}-${String(m).padStart(2, '0')}-01`), r0 = App.rangeOf('monat', `${Y - 1}-${String(m).padStart(2, '0')}-01`);
      b += App.summen(r0.von, r0.bis).gewinn / 100; prev.push(b);
      if (m <= M) { a += App.summen(r1.von, r1.bis).gewinn / 100; cur.push(a); } else cur.push(null);
    }
    const series = [{ name: String(Y), color: 'var(--accent)', values: cur }, { name: String(Y - 1), color: 'var(--muted)', values: prev, dashed: true }];
    $('#ovCumLegend').innerHTML = Charts.legend(series);
    // Vorjahr zuerst zeichnen, damit das laufende Jahr obenauf liegt; künftige Monate bleiben leer
    Charts.lines($('#ovCum'), {
      labels, series: [series[1], series[0]], height: 260,
      fmtY: (v, st) => fmt.axis(v, st), fmtTip: (v) => (v == null ? '–' : fmt.eurE(v, { dec: 0 }))
    });
  }

  App.page('auswertung', { title: 'Auswertung', navTitle: 'Auswertung', icon: 'chart', nav: true, order: 40, desc: 'Überblick, Liquidität, Kennzahlen, Steuer & Export', render });
  App.action('noop', () => {});
  /* Klickbare Tabellenzeilen (tr[data-href]) behandeln Liquidität und Steuer & Export selbst –
   * ein zusätzlicher globaler Handler hier hat jede Navigation doppelt ausgelöst (zweimal gerendert). */
})();
