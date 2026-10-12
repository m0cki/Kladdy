/* Kladdy – Prototyp · Liquidität (Reiter der Auswertung)
 * „Was in den nächsten 30/60/90 Tagen rein- und rausgeht“ auf Basis von App.prognose({ historie: 0 }).
 * Es gibt keinen Kontostand (das Geschäftskonto ist zugleich das Privatkonto). Die Kurve startet deshalb heute bei 0 €
 * und zeigt den erwarteten Überschuss ab heute; fällt sie unter 0, geht bis dahin mehr raus als rein (ggf. privat vorstrecken).
 * Aufbau: Kennzahlen (Einnahmen, Ausgaben, Überschuss, engster Moment), Diagramm mit Hinweis bei Engpass, Annahmen (wirken live),
 * Planposten und erwartete Zahlungen je Kalenderwoche.
 * Annahmen zeichnen nur Kennzahlen, Diagramm, Hinweis und Tabelle neu – der Regler behält so den Fokus.
 */
(() => {
  'use strict';
  const { D, $, esc, icon, fmt } = App;
  const U = D.util;
  const T = D.TODAY;

  /* Seitenzustand: bleibt beim Seitenwechsel erhalten (wird nicht gespeichert) */
  const DEF = { tage: 90, offene: true, ueberfaellige: true, wiederkehrend: true, plan: true, variabel: true, verzug: null, avgRows: true };
  const st = { ...DEF };
  let planArt = 'ausgabe';

  const ART = {
    rechnung: { icon: 'invoice', label: 'Offene Rechnung' },
    wiederkehrend: { icon: 'reset', label: 'Wiederkehrende Zahlung' },
    plan: { icon: 'calendar', label: 'Planposten' },
    variabel: { icon: 'sigma', label: 'Durchschnittswert' }
  };
  const isAvg = (e) => e.art === 'variabel';

  const eur0 = (v, sign = false) => fmt.eurE(v, { dec: 0, sign });
  const wtag = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
  const tagKurz = (iso) => `${wtag.format(U.parse(iso)).replace('.', '')} ${fmt.datumKurz(iso)}`;
  const summe = (l) => l.reduce((s, e) => s + e.betrag, 0);

  /* Kalenderwoche nach ISO 8601 und Wochenbeginn (Montag) */
  function isoKW(iso) {
    const d = U.parse(iso);
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  }
  const wochenStart = (iso) => U.addDays(iso, -((U.parse(iso).getDay() + 6) % 7));
  function kwLabel(ws) {
    const we = U.addDays(ws, 6);
    const von = ws.slice(5, 7) === we.slice(5, 7) ? `${ws.slice(8)}.` : fmt.datumKurz(ws);
    return `KW ${isoKW(ws)} · ${von}–${fmt.datumKurz(we)}`;
  }

  /* Betrag aus dem Formular: „1.290,50“, „1290,5“, „1290.50“ → Cent */
  function parseBetrag(s) {
    s = String(s || '').trim().replace(/[\s€]/g, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const v = Number(s);
    return isFinite(v) && v > 0 ? Math.round(v * 100) : NaN;
  }

  /* ---------- Rechnen: Vorschau ab heute (Start 0 €) für den gewählten Zeitraum ---------- */
  function calc() {
    const P = App.prognose({
      tage: st.tage, historie: 0, verzug: st.verzug,
      offene: st.offene, ueberfaellige: st.ueberfaellige, wiederkehrend: st.wiederkehrend, plan: st.plan, variabel: st.variabel
    });
    const ti = P.todayIdx, bis = U.addDays(T, st.tage);
    const tage = P.tage.slice(ti, ti + st.tage + 1);
    const ev = P.ereignisse.filter((e) => e.t <= bis);
    let min = tage[0];
    tage.forEach((d) => { if (d.v < min.v) min = d; });
    const rein = ev.filter((e) => e.betrag > 0), raus = ev.filter((e) => e.betrag < 0);
    // engster Moment = größter Rückgang ab heute (< 0: bis dahin geht mehr raus als rein)
    const tief = min.v - P.basis;
    return { P, tage, ev, min, tief, bis, rein: summe(rein), raus: summe(raus), netto: summe(ev),
      reRechnung: summe(rein.filter((e) => e.art === 'rechnung')), rausFix: summe(raus.filter((e) => e.art === 'wiederkehrend')) };
  }

  /* ---------- Kennzahlen ---------- */
  function kpisHTML(c) {
    const bisTxt = `bis ${fmt.datumKurz(c.bis)}`;
    const eng = c.tief < -0.5;
    return [
      App.kpi({ label: 'Erwartete Einnahmen', count: c.rein, cfmt: 'eurE0', i: 2,
        sub: `<span class="muted">${c.reRechnung ? `davon ${eur0(c.reRechnung)} offene Rechnungen` : bisTxt}</span>`,
        tip: `Was bis ${fmt.datum(c.bis)} voraussichtlich reinkommt: offene Rechnungen, eingeplante Einnahmen und der Wochendurchschnitt aus Quittungen.` }),
      App.kpi({ label: 'Erwartete Ausgaben', count: -c.raus, cfmt: 'eurE0', i: 3,
        sub: `<span class="muted">${c.rausFix ? `davon ${eur0(-c.rausFix)} feste Kosten` : bisTxt}</span>`,
        tip: `Was bis ${fmt.datum(c.bis)} voraussichtlich rausgeht: feste Kosten (z. B. Versicherung, Handy), Planposten und der Wochendurchschnitt der übrigen Ausgaben.` }),
      App.kpi({ label: 'Erwarteter Überschuss', count: c.netto, cfmt: 'eurE0', i: 4, ampel: c.netto < 0 ? 'rot' : '',
        sub: `<span class="muted">Einnahmen − Ausgaben ${bisTxt}</span>` }),
      `<div class="kpi reveal liq-eng ${eng ? 'neg' : 'ok'}" style="--i:5">
        <div class="kpi-label"><span>Engster Moment${eng ? ` · ${fmt.datumKurz(c.min.t)}` : ''}</span><button type="button" class="q" data-tip="Größter Rückgang ab heute: der Tag, an dem bis dahin am meisten mehr raus- als reingegangen ist. Liegt er unter 0, musst du kurz aus eigener Tasche vorstrecken." data-tip-title="Engster Moment">?</button></div>
        <div class="kpi-val">${eng ? `<span class="neg-t">${eur0(c.tief)}</span>` : `<span class="pos-t">${icon('check')}Kein Engpass</span>`}</div>
        <p class="liq-eng-t">${eng ? `Bis ${fmt.datumKurz(c.min.t)} gehen ${eur0(-c.tief)} mehr raus als rein – ggf. privat vorstrecken.` : `Durchgehend im Plus – bis ${fmt.datumKurz(c.bis)} kommt immer mindestens so viel rein wie rausgeht.`}</p></div>`
    ].join('');
  }

  /* ---------- Diagramm ---------- */
  function drawChart(c, root, anim) {
    const el = $('#liqChart', root);
    el.classList.toggle('no-anim', !anim);
    Charts.forecast(el, {
      data: c.tage, todayIdx: 0, height: 300, negativ: true, wertName: 'Überschuss ab heute',
      fmtY: (v, step) => fmt.axis(v, step),
      fmtX: (t, heute) => (heute ? fmt.datumKurz(t) : fmt.monatKurz(t)),
      fmtDate: (t) => tagKurz(t),
      fmtTip: (v, isEvent) => eur0(v, !!isEvent),
      fmtEnd: (v) => eur0(v, true),
      fmtMin: (v, t) => `Engster Moment ${eur0(v)} · ${fmt.datumKurz(t)}`
    });
    $('#liqChartSub', root).textContent = `Start heute bei 0 € · ${st.tage} Tage bis ${fmt.datum(c.bis)} · über 0 = mehr rein als raus`;
  }

  /* Hinweis unter dem Diagramm – nur bei einem Engpass, mit Vorschlägen zum Überbrücken */
  function bannerHTML(c) {
    if (c.tief >= -0.5) return '';
    // größte geplante Ausgabe bis zum engsten Moment verschieben; überfällige (sonst nächste) Rechnung anmahnen
    const plan = c.ev.filter((e) => e.art === 'plan' && e.betrag < 0 && e.t <= c.min.t).sort((a, b) => a.betrag - b.betrag)[0];
    const offen = App.offeneRechnungen();
    const re = offen.find((r) => r.faellig < T) || offen[0];
    const tips = [];
    if (plan) tips.push(`„${esc(plan.text)}“ verschieben`);
    if (re) tips.push(`Rechnung ${esc(re.nr)} ${re.faellig < T ? 'anmahnen' : 'nachfassen'}`);
    tips.push(`${eur0(-c.tief)} kurz privat vorstrecken`);
    const actions = (plan ? `<button type="button" class="chip" data-liq="plan-shift" data-id="${esc(plan.ref)}">${icon('calendar')}Um 30 Tage verschieben</button>` : '') +
      (re ? `<a class="chip" href="#/beleg/${esc(re.id)}">${icon('invoice')}${esc(re.nr)} öffnen</a>` : '');
    return `<div class="liq-banner" role="status">${icon('alert')}
      <div class="liq-banner-t"><b>Engpass um den ${fmt.datumKurz(c.min.t)} überbrücken</b>
      <span>Z. B. ${tips.join(', ').replace(/, ([^,]*)$/, ' oder $1')}.</span></div>
      ${actions ? `<div class="liq-banner-a">${actions}</div>` : ''}</div>`;
  }

  /* ---------- Erwartete Zahlungen je Kalenderwoche ---------- */
  function tableHTML(c) {
    const evs = c.ev.filter((e) => Math.abs(e.betrag) >= 0.5); // Ø-Posten mit 0 € weglassen
    if (!evs.length) return `<div class="empty">${icon('calendar')}<b>Keine erwarteten Zahlungen</b><span>Schalte Annahmen ein oder lege einen Planposten an.</span></div>`;
    const weeks = [];
    evs.forEach((e) => {
      const ws = wochenStart(e.t);
      let w = weeks[weeks.length - 1];
      if (!w || w.ws !== ws) weeks.push((w = { ws, list: [] }));
      w.list.push(e);
    });
    const row = (e) => {
      const a = ART[e.art] || ART.plan, avg = isAvg(e);
      const href = e.art === 'rechnung' && e.ref ? `#/beleg/${encodeURIComponent(e.ref)}` : '';
      const text = avg ? e.text.replace(/^Ø\s*/, '') : e.text;
      return `<tr class="${href ? 'row' : ''} ${avg ? 'liq-avg' : ''}" ${href ? `data-href="${href}"` : ''}>
        <td class="l num liq-d">${tagKurz(e.t)}</td>
        <td class="l liq-what"><div class="liq-what-in"><span class="liq-ic" data-art="${e.art}" title="${esc(a.label)}">${icon(a.icon)}</span>${href ? `<a href="${href}">${esc(text)}</a>` : `<span class="t">${esc(text)}</span>`}${avg ? '<span class="pill" title="Durchschnittswert aus den letzten 90 Tagen">Ø</span>' : ''}</div></td>
        <td class="num ${e.betrag > 0 ? 'pos-v' : ''}">${eur0(e.betrag, true)}</td>
        <td class="num ${e.saldo < 0 ? 'neg-v' : ''}">${eur0(e.saldo)}</td></tr>`;
    };
    return `<table class="fin-table liq-table"><thead><tr><th class="l">Datum</th><th class="l">Was</th><th>Betrag</th><th title="Erwartete Einnahmen minus Ausgaben von heute bis zu dieser Zahlung">Überschuss bis dahin</th></tr></thead><tbody>` +
      weeks.map((w) => {
        const end = w.list[w.list.length - 1].saldo;
        const vis = w.list.filter((e) => st.avgRows || !isAvg(e));
        return `<tr class="grp"><td class="l" colspan="2">${kwLabel(w.ws)}</td><td class="num">${eur0(summe(w.list), true)}</td><td class="num ${end < 0 ? 'neg-v' : ''}">${eur0(end)}</td></tr>` + vis.map(row).join('');
      }).join('') + '</tbody></table>';
  }

  /* ---------- Planposten ---------- */
  function planHTML(c) {
    const list = D.PLANPOSTEN.filter((p) => p.datum > T).sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0));
    if (!list.length) return `<p class="liq-plan-empty">Noch keine Planposten. Trag z. B. eine geplante Anschaffung oder einen großen Auftrag ein.</p>`;
    return `<ul class="liq-plan">${list.map((p) => {
      const out = p.datum > c.bis;
      return `<li class="${out ? 'out' : ''}" ${out ? `title="Liegt außerhalb der ${st.tage}-Tage-Vorschau"` : ''}>
        <span class="liq-plan-d"><b>${fmt.datumKurz(p.datum)}</b><small>${fmt.rel(p.datum)}</small></span>
        <span class="liq-plan-t">${esc(p.text)}</span>
        <b class="num ${p.betrag > 0 ? 'pos-t' : ''}">${fmt.eur(p.betrag, { dec: 0, sign: true })}</b>
        <button type="button" class="icon-btn sm" data-liq="plan-del" data-id="${esc(p.id)}" title="Planposten löschen" aria-label="Planposten „${esc(p.text)}“ löschen">${icon('trash')}</button></li>`;
    }).join('')}</ul>`;
  }

  /* ---------- Annahmen ---------- */
  function annahmenHTML(P) {
    const offen = App.offeneRechnungen(), ueber = offen.filter((r) => r.faellig < T);
    const sum = (l) => l.reduce((s, r) => s + D.rechnungSumme(r), 0);
    const plan = D.PLANPOSTEN.filter((p) => p.datum > T);
    const n = (x, ein, mehr) => `${x} ${x === 1 ? ein : mehr}`;
    const tog = (key, label, sub, cls = '') => `<label class="toggle-row ${cls}"><span>${label}<small>${sub}</small></span>
      <span class="switch"><input type="checkbox" data-opt="${key}" ${st[key] ? 'checked' : ''}><span></span></span></label>`;
    const verzug = st.verzug == null ? P.verzugAuto : st.verzug;
    return `<div class="liq-opts">
        ${tog('offene', 'Offene Rechnungen', `${n(offen.length, 'Rechnung', 'Rechnungen')} · ${fmt.eur(sum(offen), { dec: 0 })} · zur Fälligkeit + Verzug`)}
        ${tog('ueberfaellige', 'Überfällige einrechnen', ueber.length ? `${n(ueber.length, 'Rechnung', 'Rechnungen')} · ${fmt.eur(sum(ueber), { dec: 0 })} · frühestens in 3 Tagen` : 'derzeit keine überfällig', `sub ${st.offene ? '' : 'off'}`)}
        ${tog('wiederkehrend', 'Feste Kosten', `${D.WIEDERKEHREND.length} wiederkehrende Posten${D.WIEDERKEHREND.length ? ' · ' + esc(D.WIEDERKEHREND.slice(0, 3).map((w) => w.text).join(', ')) + (D.WIEDERKEHREND.length > 3 ? ' …' : '') : ''}`)}
        ${tog('plan', 'Planposten', plan.length ? `${n(plan.length, 'Posten', 'Posten')} · ${fmt.eur(plan.reduce((s, p) => s + p.betrag, 0), { dec: 0, sign: true })}` : 'noch keine eingetragen')}
        ${tog('variabel', 'Ø übrige Einnahmen und Ausgaben', `${eur0(P.wEin, true)} / ${eur0(P.wAus, true)} pro Woche · Quittungen, Sprit, Material … der letzten 90 Tage`)}
      </div>
      <div class="liq-sl">
        <div class="liq-sl-head"><label for="liqVerzug">Kunden zahlen im Schnitt</label><output id="liqVerzugOut">${verzugText(verzug)}</output></div>
        <input type="range" id="liqVerzug" min="0" max="45" step="1" value="${verzug}" style="--fill:${(verzug / 45) * 100}%" ${st.offene ? '' : 'disabled'}>
        <div class="hint" id="liqVerzugHint">${verzugHint(P.verzugAuto)}</div>
      </div>`;
  }
  const verzugText = (v) => (v === 0 ? 'pünktlich zur Fälligkeit' : `${v} ${v === 1 ? 'Tag' : 'Tage'} nach Fälligkeit`);
  const verzugHint = (auto) => `Ø aus deiner Historie: ${auto} ${auto === 1 ? 'Tag' : 'Tage'}` +
    (st.verzug != null && st.verzug !== auto ? ` · <button type="button" class="liq-linkbtn" data-liq="verzug-auto">übernehmen</button>` : '');

  /* ---------- Seite ---------- */
  function render(el) {
    const c = calc();
    const morgen = U.addDays(T, 1);
    el.innerHTML = `<div class="page liq">
      ${App.auswertungKopf('liquiditaet', App.seg('local', 'tage', [[30, '30 Tage'], [60, '60 Tage'], [90, '90 Tage']], st.tage))}
      <p class="page-sub liq-intro reveal" style="--i:1">Was in den nächsten ${st.tage} Tagen voraussichtlich rein- und rausgeht – aus offenen Rechnungen, festen Kosten, Planposten und Durchschnittswerten.</p>
      <div class="kpis k4" id="liqKpis">${kpisHTML(c)}</div>
      <div class="grid-main">
        <div class="stack">
          <section class="card reveal" style="--i:7">
            <div class="card-head wrap">
              <div><div class="card-title">${icon('wave')}Überschuss ab heute</div><div class="card-sub" id="liqChartSub"></div></div>
              <div class="legend liq-legend">
                <span><i class="ln"></i>Erwarteter Überschuss</span>
                <span><i class="dt" style="background:var(--pos)"></i>Einnahme</span><span><i class="dt" style="background:var(--neg)"></i>Ausgabe</span>
                <span><i class="neg-area"></i>unter 0 = mehr raus als rein</span>
              </div>
            </div>
            <div class="chart liq-chart" id="liqChart"></div>
            <div id="liqBanner">${bannerHTML(c)}</div>
          </section>
          <section class="card reveal" style="--i:9">
            <div class="card-head wrap">
              <div><div class="card-title">${icon('list')}Erwartete Zahlungen <span class="muted" id="liqTblRange">· bis ${fmt.datum(c.bis)}</span></div>
              <div class="card-sub">Nach Kalenderwoche · Überschuss ab heute nach jeder Zahlung · Rechnungen lassen sich öffnen</div></div>
              <label class="toggle-row liq-avgtoggle"><span>Ø-Werte zeigen</span><span class="switch"><input type="checkbox" data-opt="avgRows" ${st.avgRows ? 'checked' : ''}><span></span></span></label>
            </div>
            <div class="table-wrap" id="liqTable">${tableHTML(c)}</div>
          </section>
        </div>
        <div class="stack">
          <section class="card reveal" style="--i:8">
            <div class="card-head"><div><div class="card-title">${icon('filter')}Annahmen</div><div class="card-sub">Was in die Vorschau einfließt – wirkt sofort.</div></div>
              <button type="button" class="btn subtle liq-reset" data-liq="reset" title="Alle Annahmen auf Standard">${icon('reset')}Standard</button></div>
            <div id="liqAnn">${annahmenHTML(c.P)}</div>
          </section>
          <section class="card reveal" style="--i:10">
            <div class="card-head"><div><div class="card-title">${icon('calendar')}Planposten</div><div class="card-sub">Einmalige Zahlungen, die du erwartest – z. B. Anschaffungen oder große Aufträge.</div></div></div>
            <div id="liqPlan">${planHTML(c)}</div>
            <form class="liq-pf" id="liqPlanForm" novalidate autocomplete="off">
              <div class="liq-pf-row">${App.seg('local', 'planArt', [['ausgabe', 'Ausgabe'], ['einnahme', 'Einnahme']], planArt, 'full')}</div>
              <div class="liq-pf-row two">
                <input type="date" class="input sm" name="datum" min="${morgen}" value="${U.addDays(T, 30)}" aria-label="Datum">
                <div class="input-wrap"><input class="input sm money" name="betrag" inputmode="decimal" placeholder="0,00" aria-label="Betrag"><span class="suffix">€</span></div>
              </div>
              <div class="liq-pf-row two wide">
                <input class="input sm" name="text" placeholder="Was? z. B. Neue Heckenschere" maxlength="80" aria-label="Beschreibung">
                <button type="submit" class="btn-primary sm">${icon('plus')}Hinzufügen</button>
              </div>
              <p class="hint neg" id="liqPfErr" hidden></p>
            </form>
          </section>
          <div class="proto-note reveal" style="--i:11">${icon('info')}<span><b>So rechnet die Vorschau:</b> Einen Kontostand gibt es nicht – dein Geschäftskonto ist zugleich dein Privatkonto. Die Kurve startet heute bei 0 € und zählt nur, was ab morgen rein- und rausgeht: offene Rechnungen zur Fälligkeit plus Ø Zahlungsverzug, feste Kosten und Planposten an ihrem Termin, alles Übrige als Wochendurchschnitt der letzten 90 Tage. Eine Schätzung, keine Garantie.</span></div>
        </div>
      </div>
    </div>`;
    const root = el.firstElementChild;
    drawChart(c, root, true);
    bind(root);
  }

  /* Nur die rechnenden Teile neu zeichnen (Fokus und Reglerposition bleiben erhalten) */
  function update(root, { ann = false } = {}) {
    const c = calc();
    if (ann) $('#liqAnn', root).innerHTML = annahmenHTML(c.P); // nur nach Klicks (kein Regler aktiv)
    const k = $('#liqKpis', root);
    k.classList.add('no-anim');
    k.innerHTML = kpisHTML(c);
    drawChart(c, root, false);
    const b = $('#liqBanner', root);
    b.classList.add('no-anim');
    b.innerHTML = bannerHTML(c);
    $('#liqTable', root).innerHTML = tableHTML(c);
    $('#liqTblRange', root).textContent = `· bis ${fmt.datum(c.bis)}`;
    $('.liq-intro', root).textContent = `Was in den nächsten ${st.tage} Tagen voraussichtlich rein- und rausgeht – aus offenen Rechnungen, festen Kosten, Planposten und Durchschnittswerten.`;
    $('#liqPlan', root).innerHTML = planHTML(c);
    return c;
  }

  function bind(root) {
    const form = $('#liqPlanForm', root);
    // Rückgängig aus dem Toast: alte Seite ggf. schon ersetzt → dann komplett neu zeichnen
    const refresh = () => { if (root.isConnected) update(root, { ann: true }); else if (App.route.id === 'liquiditaet') App.rerender(); };
    const err = $('#liqPfErr', root);

    root.addEventListener('seg-change', (e) => {
      const { key, value } = e.detail;
      if (key === 'tage') { st.tage = +value; update(root); }
      else if (key === 'planArt') planArt = value;
    });

    root.addEventListener('change', (e) => {
      const t = e.target;
      if (!t.matches('[data-opt]')) return;
      st[t.dataset.opt] = t.checked;
      if (t.dataset.opt === 'offene') {
        $('[data-opt="ueberfaellige"]', root).closest('.toggle-row').classList.toggle('off', !t.checked);
        $('#liqVerzug', root).disabled = !t.checked;
      }
      update(root);
    });

    root.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'liqVerzug') {
        const v = +t.value, auto = calc().P.verzugAuto;
        st.verzug = v === auto ? null : v;
        t.style.setProperty('--fill', (v / 45) * 100 + '%');
        $('#liqVerzugOut', root).textContent = verzugText(v);
        $('#liqVerzugHint', root).innerHTML = verzugHint(auto);
        update(root);
      } else if (t.closest('#liqPlanForm')) { t.classList.remove('invalid'); err.hidden = true; }
    });

    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-liq]');
      if (a) {
        const act = a.dataset.liq;
        if (act === 'reset') {
          Object.assign(st, DEF);
          App.rerender();
          App.toast('Annahmen auf Standard zurückgesetzt');
        } else if (act === 'verzug-auto') {
          st.verzug = null;
          const auto = calc().P.verzugAuto, sl = $('#liqVerzug', root);
          sl.value = auto; sl.style.setProperty('--fill', (auto / 45) * 100 + '%');
          $('#liqVerzugOut', root).textContent = verzugText(auto);
          $('#liqVerzugHint', root).innerHTML = verzugHint(auto);
          update(root);
        } else if (act === 'plan-del') {
          const i = D.PLANPOSTEN.findIndex((p) => p.id === a.dataset.id);
          if (i < 0) return;
          const [p] = D.PLANPOSTEN.splice(i, 1);
          App.save(); update(root, { ann: true });
          App.toast(`Planposten „${p.text}“ gelöscht`, { icon: 'trash', action: { label: 'Rückgängig', fn: () => { D.PLANPOSTEN.splice(i, 0, p); App.save(); refresh(); } } });
        } else if (act === 'plan-shift') {
          const p = D.PLANPOSTEN.find((x) => x.id === a.dataset.id);
          if (!p) return;
          const alt = p.datum;
          p.datum = U.addDays(p.datum, 30);
          App.save(); update(root, { ann: true });
          App.toast(`„${p.text}“ auf ${fmt.datum(p.datum)} verschoben`, { icon: 'calendar', action: { label: 'Rückgängig', fn: () => { p.datum = alt; App.save(); refresh(); } } });
        }
        return;
      }
      // Zeile mit Rechnung → Beleg öffnen (Klick auf den Link selbst erledigt der Browser)
      const tr = e.target.closest('tr[data-href]');
      if (tr && !e.target.closest('a')) App.go(tr.dataset.href);
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const datum = form.datum.value, text = form.text.value.trim(), cent = parseBetrag(form.betrag.value);
      const fehler = [];
      if (!datum || datum <= T) { fehler.push('ein Datum nach heute'); form.datum.classList.add('invalid'); }
      if (!isFinite(cent)) { fehler.push('einen Betrag'); form.betrag.classList.add('invalid'); }
      if (!text) { fehler.push('eine Beschreibung'); form.text.classList.add('invalid'); }
      if (fehler.length) { err.textContent = `Bitte ${fehler.join(', ')} angeben.`; err.hidden = false; return; }
      D.PLANPOSTEN.push({ id: 'p' + Date.now().toString(36), datum, text, betrag: planArt === 'ausgabe' ? -cent : cent, art: planArt });
      App.save();
      form.text.value = ''; form.betrag.value = '';
      const c = update(root, { ann: true });
      App.toast(`Planposten „${text}“ am ${fmt.datum(datum)} eingeplant${datum > c.bis ? ' (außerhalb der Vorschau)' : ''}`, { icon: 'calendar' });
    });
  }

  App.page('liquiditaet', { title: 'Liquidität', icon: 'wave', nav: false, parent: 'auswertung', order: 31, desc: 'Was in den nächsten 90 Tagen rein- und rausgeht', render });
})();
