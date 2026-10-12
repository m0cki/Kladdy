/* Kladdy – Prototyp · Steuer & Export (Reiter der Auswertung)
 * Die „amtliche“ Sicht – ohne Kennzahl-Kacheln (die stehen im Überblick):
 *   EÜR nach EÜR-Bereichen und Monaten · Wareneingangsbuch nach § 143 AO · Kleinunternehmer- und Gewerbesteuer-Grenzen
 *   mit Jahresabschluss-Checkliste · Export fürs Finanzamt (CSV aller Ein-/Ausgänge, EÜR und Wareneingangsbuch als PDF).
 * Alle Downloads und Drucke liegen gebündelt im Reiter „Export“; EÜR und Wareneingangsbuch verweisen nur dorthin.
 * Druck: Inhalt wird kurz in #printArea gerendert, body.printing-euer blendet alles andere aus (css/steuer.css).
 * Link von außen: #/steuer?tab=euer|web|ku|export&jahr=2025
 */
(() => {
  'use strict';
  const { D, $, esc, icon, fmt } = App;
  const U = D.util;
  const T = D.TODAY, Y = +T.slice(0, 4), M = +T.slice(5, 7);
  const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const TABS = [['euer', 'EÜR'], ['web', 'Wareneingangsbuch'], ['ku', 'Kleinunternehmer'], ['export', `${icon('download')}Export`]];
  const st = { jahr: Y, tab: 'euer' };

  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const zeros = () => Array(12).fill(0);
  const eur0 = (c) => fmt.eur(c, { dec: 0 });
  const PARAM = (y) => D.PARAMS[y] || D.PARAMS[Y];
  /* Monate seit Jahresbeginn (anteilig) – gleiche Hochrechnung wie im Überblick */
  const monateVergangen = () => (M - 1) + (+T.slice(8, 10)) / U.daysIn(Y, M);
  const inJahr = (iso, y) => !!iso && iso.slice(0, 4) === String(y);
  const geldfluss = (b) => b.typ === 'einnahme' || b.typ === 'ausgabe';
  const zumExport = `<button type="button" class="btn ghost sm aw-toexport" data-aw="tab" data-tab="export">${icon('download')}Drucken & Export</button>`;

  /* ================= EÜR ================= */
  /* Monatswerte (Cent) je Kategorie; Ausgaben mit abziehbarem Betrag wie App.summen() */
  function euer(y) {
    const ein = {}, aus = {}, nicht = {}, nPriv = zeros();
    D.buchungen.forEach((b) => {
      if (!inJahr(b.datum, y)) return;
      const m = +b.datum.slice(5, 7) - 1, k = D.kat(b.kat);
      if (b.typ === 'einnahme') (ein[b.kat] ||= zeros())[m] += b.betrag;
      else if (b.typ === 'ausgabe') {
        const p = (b.privat || 0) / 100;
        const abz = Math.round(b.betrag * (1 - p) * ((k ? k.abziehbar : 100) / 100));
        const betr = Math.round(b.betrag * (1 - p));
        (aus[b.kat] ||= zeros())[m] += abz;
        if (betr > abz) (nicht[b.kat] ||= zeros())[m] += betr - abz;
        nPriv[m] += b.betrag - betr;
      }
    });
    // nach EÜR-Bereich gruppieren (Reihenfolge wie die Kategorien); unbekannte Kategorien landen bei „Sonstige/Übrige“
    const gruppen = (typ, src) => {
      const map = new Map();
      Object.keys(src).forEach((id) => {
        const k = D.kat(id) || { id, name: id, abziehbar: 100, euer: typ === 'einnahme' ? 'Sonstige Betriebseinnahmen' : 'Übrige Betriebsausgaben' };
        const key = k.euer || k.name;
        if (!map.has(key)) map.set(key, { name: key, kats: [], ord: D.KATEGORIEN.findIndex((x) => (x.euer || x.name) === key) });
        map.get(key).kats.push({ k, vals: src[id], ord: D.KATEGORIEN.indexOf(k) });
      });
      return [...map.values()].sort((a, b) => (a.ord < 0 ? 999 : a.ord) - (b.ord < 0 ? 999 : b.ord)).map((g) => {
        g.kats.sort((a, b) => a.ord - b.ord);
        return { ...g, vals: zeros().map((_, i) => sum(g.kats.map((x) => x.vals[i]))) };
      });
    };
    const E = { y, ein: gruppen('einnahme', ein), aus: gruppen('ausgabe', aus), nicht, nPriv };
    E.einV = zeros().map((_, i) => sum(E.ein.map((g) => g.vals[i])));
    E.ausV = zeros().map((_, i) => sum(E.aus.map((g) => g.vals[i])));
    E.gewV = E.einV.map((v, i) => v - E.ausV[i]);
    E.einS = sum(E.einV); E.ausS = sum(E.ausV); E.gewinn = E.einS - E.ausS;
    return E;
  }

  /* Zeilenmodell – gemeinsam für Bildschirm, Druck und CSV */
  function euerRows(E) {
    const R = [];
    const abzText = (k) => (k.abziehbar < 100 ? ` · ${k.abziehbar} % abziehbar` : '');
    const block = (titel, gruppen, sumLabel, sumV) => {
      R.push({ kind: 'grp', label: titel });
      if (!gruppen.length) R.push({ kind: 'leer', label: 'Keine Buchungen', vals: zeros() });
      gruppen.forEach((g) => {
        if (g.kats.length === 1) R.push({ kind: 'bereich', label: g.name, sub: g.kats[0].k.name + abzText(g.kats[0].k), vals: g.vals, bereich: g.name, kat: g.kats[0].k.name });
        else {
          R.push({ kind: 'bereich', label: g.name, vals: g.vals, bereich: g.name, kat: '' });
          g.kats.forEach((x) => R.push({ kind: 'kat', label: x.k.name + abzText(x.k), vals: x.vals, bereich: g.name, kat: x.k.name }));
        }
      });
      R.push({ kind: 'sum', label: sumLabel, vals: sumV });
    };
    block('Betriebseinnahmen', E.ein, 'Summe Betriebseinnahmen', E.einV);
    block('Betriebsausgaben', E.aus, 'Summe Betriebsausgaben (abziehbar)', E.ausV);
    R.push({ kind: 'gewinn', label: 'Gewinn', vals: E.gewV });
    R.push({ kind: 'grp', label: 'Nachrichtlich: nicht abziehbare Anteile', note: 'nur zur Info, bereits herausgerechnet' });
    const info = Object.keys(E.nicht).map((id) => { const k = D.kat(id) || { name: id, abziehbar: 100 }; return { kind: 'info', label: `${k.name} – ${100 - k.abziehbar} % nicht abziehbar`, vals: E.nicht[id] }; });
    if (sum(E.nPriv)) info.push({ kind: 'info', label: 'Privatanteile (privat genutzter Teil)', vals: E.nPriv });
    if (!info.length) info.push({ kind: 'info', label: 'Keine nicht abziehbaren Anteile', vals: zeros(), leer: true });
    R.push(...info);
    return R;
  }

  function euerHTML(E) {
    const y = E.y, lauf = y === Y;
    const cur = lauf ? M - 1 : -1;
    const fut = (i) => lauf && i > M - 1;
    const cell = (val, i) => (fut(i) ? `<td class="num fut ${i === cur ? 'latest' : ''}"></td>`
      : `<td class="num ${val < 0 ? 'neg-v' : ''} ${val === 0 ? 'zero' : ''} ${i === cur ? 'latest' : ''}">${val === 0 ? '–' : fmt.num(val / 100, 0)}</td>`);
    const cls = { bereich: 'aw-bereich', kat: 'r-i', sum: 'r-sum r-b', gewinn: 'r-sum r-hl', info: 'aw-info r-i', leer: 'aw-info' };
    const rows = euerRows(E).map((r) => {
      if (r.kind === 'grp') return `<tr class="grp"><td class="sticky">${esc(r.label)}${r.note ? `<span class="aw-grpnote">· ${esc(r.note)}</span>` : ''}</td><td colspan="13"></td></tr>`;
      if (r.leer) return `<tr class="aw-info aw-leer"><td class="sticky">${esc(r.label)}</td><td colspan="13"></td></tr>`;
      const s = sum(r.vals);
      return `<tr class="${cls[r.kind]}"><td class="sticky" title="${esc(r.label + (r.sub ? ' – ' + r.sub : ''))}"><span class="aw-lbl"><span>${esc(r.label)}</span>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</span></td>
        ${r.vals.map(cell).join('')}<td class="num sum ${s < 0 ? 'neg-v' : ''}">${s === 0 && r.kind !== 'gewinn' ? '–' : fmt.num(s / 100, 2)}</td></tr>`;
    }).join('');
    return `<section class="card reveal aw-euer" style="--i:3">
        <div class="card-head wrap">
          <div><div class="card-title">${icon('sigma')}Einnahmen-Überschuss-Rechnung ${y}${lauf ? `<span class="muted">· vorläufig, Stand ${fmt.datum(T)}</span>` : ''}</div>
          <div class="card-sub">Nach EÜR-Bereichen und Monaten · Zufluss-/Abflussprinzip (§ 11 EStG) · Beträge in €${lauf ? ` · ${MON[M - 1]} läuft noch` : ''}</div></div>
          ${zumExport}
        </div>
        <div class="table-wrap aw-scroll"><table class="fin-table aw-table">
          <thead><tr><th class="sticky">EÜR-Bereich / Kategorie</th>${MON.map((m, i) => `<th class="${i === cur ? 'latest' : ''} ${fut(i) ? 'fut' : ''}">${m}</th>`).join('')}<th class="sum">Summe ${y}</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
        <div class="card-foot aw-foot"><span>${icon('info')}Werte in ELSTER in die Anlage EÜR übertragen – die Zeilennummern bitte im aktuellen Formular prüfen.</span>
          <span class="muted">Als Kleinunternehmer ohne Umsatzsteuer: alle Beträge sind Endbeträge.</span></div>
      </section>`;
  }

  /* ================= CSV (Semikolon, Dezimalkomma, UTF-8 mit BOM, CRLF) ================= */
  /* Text in Anführungszeichen, wenn nötig; führende =, +, -, @ entschärfen (Formel-Injection in Tabellenprogrammen) */
  const csvText = (s) => { s = String(s ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csvZahl = (c) => (c / 100).toFixed(2).replace('.', ',');
  function download(name, zeilen) {
    const blob = new Blob(['﻿' + zeilen.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    App.toast(`${name} exportiert`, { icon: 'download' });
  }

  /* Alle Ein- und Ausgänge eines Jahres, chronologisch; Betrag mit Vorzeichen (Eingang +, Ausgabe −) */
  const buchungenJahr = (y) => D.buchungen.filter((b) => geldfluss(b) && inJahr(b.datum, y)).sort(D.chrono);
  function csvBuchungen(y) {
    const zeilen = [['Datum', 'Beleg-Nr.', 'Beschreibung', 'Kunde/Geschäft', 'Kategorie', 'EÜR-Bereich', 'Zahlungsweg', 'Betrag'].join(';')];
    buchungenJahr(y).forEach((b) => {
      const k = D.kat(b.kat) || { name: b.kat || '', euer: '' };
      const text = b.text + (b.privat ? ` (${b.privat} % privat)` : '');
      zeilen.push([fmt.datum(b.datum), b.belegnr || b.nr, text, D.gegenueber(b), k.name, k.euer || '', D.zahlungsart(b.zahlungsart).name, csvZahl(D.netto(b))].map((v, i) => (i === 7 ? v : csvText(v))).join(';'));
    });
    return zeilen;
  }

  /* EÜR-Tabelle (Bereiche × Monate) */
  function csvEuer(E) {
    const lines = [['Art', 'EÜR-Bereich', 'Kategorie', ...MON, 'Summe'].map(csvText).join(';')];
    let teil = '';
    euerRows(E).forEach((r) => {
      if (r.kind === 'grp') { teil = r.label; return; }
      if (r.kind === 'leer' || r.leer) return;
      if (r.kind === 'bereich' && !r.kat) return; // Bereich mit mehreren Kategorien: Einzelzeilen genügen
      const art = { bereich: teil, kat: teil, sum: 'Summe', gewinn: 'Ergebnis', info: 'Nachrichtlich' }[r.kind];
      const bereich = r.kind === 'bereich' || r.kind === 'kat' ? r.bereich : r.label;
      const kat = r.kind === 'bereich' || r.kind === 'kat' ? r.kat : '';
      lines.push([art, bereich, kat].map(csvText).concat(r.vals.map(csvZahl), csvZahl(sum(r.vals))).join(';'));
    });
    return lines;
  }

  /* ================= Wareneingangsbuch (§ 143 AO) ================= */
  /* Lieferant = Freitext an der Ausgabe (z. B. „Bauhaus“); seine Anschrift steht auf dem Beleg */
  function webDaten(y) {
    const kats = new Set(D.KATEGORIEN.filter((k) => k.wareneingang).map((k) => k.id));
    return D.buchungen.filter((b) => b.typ === 'ausgabe' && kats.has(b.kat) && inJahr(b.datum, y))
      .sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : String(a.nr).localeCompare(String(b.nr))))
      .map((b, i) => ({ lfd: i + 1, b }));
  }
  const lieferant = (w) => w.b.lieferant || '';
  const belegRef = (b) => b.belegnr || b.nr;
  const webLuecke = (w) => !lieferant(w) || !w.b.beleg;

  function webHTML(y) {
    const W = webDaten(y);
    const katNamen = D.KATEGORIEN.filter((k) => k.wareneingang).map((k) => `„${k.name}“`).join(', ') || '(keine Kategorie markiert)';
    const luecken = W.filter(webLuecke).length;
    if (!W.length) return `<section class="card reveal" style="--i:3"><div class="empty">${icon('book')}<b>Keine Wareneingänge in ${y}</b><span>Ausgaben der Kategorie ${esc(katNamen)} erscheinen hier automatisch.</span></div></section>`;
    let body = '', mon = '';
    W.forEach((w) => {
      const m = w.b.datum.slice(0, 7);
      if (m !== mon) {
        mon = m;
        const n = W.filter((x) => x.b.datum.startsWith(m)).length;
        body += `<tr class="grp"><td class="l" colspan="6">${esc(fmt.monat(m))}<span class="aw-grpnote">· ${n} ${n > 1 ? 'Wareneingänge' : 'Wareneingang'}</span></td></tr>`;
      }
      const name = lieferant(w);
      body += `<tr class="row" data-href="#/buchungen?b=${encodeURIComponent(w.b.id)}" tabindex="0">
        <td class="num muted">${w.lfd}</td>
        <td class="num">${fmt.datum(w.b.datum)}</td>
        <td class="l aw-lief">${name ? `<div class="cell-main">${App.monogram(name, 'xs')}<span class="t"><b>${esc(name)}</b></span></div>` : '<span class="badge warn">Lieferant fehlt</span>'}</td>
        <td class="l wrap aw-ware">${esc(w.b.text)}</td>
        <td class="num">${fmt.eur(w.b.betrag)}</td>
        <td class="l aw-beleg">${w.b.beleg ? `<span class="aw-bref"><b class="mono">${esc(belegRef(w.b))}</b><small>${icon('clip')}<span>${esc(w.b.beleg)}</span></small></span>` : `<span class="aw-bref"><b class="mono">${esc(belegRef(w.b))}</b><span class="badge warn">Beleg fehlt</span></span>`}</td></tr>`;
    });
    return `<section class="card reveal" style="--i:3">
        <div class="card-head wrap">
          <div><div class="card-title">${icon('book')}Wareneingangsbuch ${y} <span class="muted">· § 143 AO</span></div>
          <div class="card-sub">Automatisch aus deinen Ausgaben der Kategorie ${esc(katNamen)} · Tag, Lieferant, Ware, Preis und Belegverweis</div></div>
          <div class="row">${luecken ? `<span class="badge warn">${icon('alert')}${luecken} ohne Lieferant oder Beleg</span>` : `<span class="badge pos">${icon('check')}vollständig</span>`}${zumExport}</div>
        </div>
        <div class="table-wrap"><table class="fin-table aw-web">
          <thead><tr><th>Nr.</th><th>Datum</th><th class="l">Lieferant</th><th class="l">Warenbezeichnung</th><th>Preis</th><th class="l">Beleg</th></tr></thead>
          <tbody>${body}</tbody>
          <tfoot><tr><td colspan="4" class="l">Summe ${y} · ${W.length} Wareneingänge</td><td class="num">${fmt.eur(sum(W.map((w) => w.b.betrag)))}</td><td></td></tr></tfoot>
        </table></div>
        <div class="card-foot aw-foot"><span>${icon('info')}Pflicht für gewerbliche Unternehmer, die Waren für den Betrieb einkaufen (Material, Pflanzen, Ersatzteile). Preise als Endbeträge, da Kleinunternehmer.</span>
          <span class="muted">§ 143 AO verlangt auch die Anschrift des Lieferanten – sie steht auf dem Beleg. Deshalb gehört zu jedem Wareneingang ein Beleg.</span></div>
      </section>`;
  }

  /* ================= Kleinunternehmer, Gewerbesteuer, Jahresabschluss ================= */
  function meter({ titel, sub, wert, grenze, hoch = null, badge, text, i, weich = false }) {
    const q = Math.max(0, wert / grenze), qh = hoch != null ? Math.max(0, hoch / grenze) : null;
    const lvl = (qh ?? q) >= 1 ? (weich ? 'warn' : 'over') : (qh ?? q) >= 0.8 ? 'warn' : '';
    const pc = (x) => Math.min(100, x * 100);
    return `<div class="aw-meter" style="--i:${i || 0}">
      <div class="aw-meter-head"><div><b>${titel}</b><small>${sub}</small></div>${badge}</div>
      <div class="aw-meter-val"><b class="num">${eur0(wert)}</b><span class="muted">von ${eur0(grenze)}</span><span class="aw-meter-pct num">${fmt.pct(q, 0)}</span></div>
      <div class="progress ${lvl}" role="meter" aria-valuemin="0" aria-valuemax="${grenze / 100}" aria-valuenow="${Math.round(wert / 100)}" aria-label="${esc(titel)}">
        <i style="width:${pc(q)}%"></i>${qh != null && qh > q ? `<s style="left:${pc(q)}%;width:${pc(qh) - pc(q)}%"></s><u style="left:calc(${pc(qh)}% - 1px)"></u>` : ''}</div>
      <div class="aw-meter-scale"><span>0 €</span>${qh != null ? `<span class="aw-hoch"><i></i>Hochrechnung 31.12.: <b>${eur0(hoch)}</b> · ${fmt.pct(qh, 0)}</span>` : ''}<span>${eur0(grenze)}</span></div>
      <p class="aw-meter-text">${text}</p></div>`;
  }
  const badge = (cls, ic, text) => `<span class="badge ${cls}">${ic ? icon(ic) : ''}${text}</span>`;

  /* Checkliste: automatische Prüfungen + eigene Häkchen (im Browser gespeichert) */
  const CHECK_KEY = 'gb.abschluss';
  function checkliste(y) {
    const inJ = (b) => inJahr(b.datum, y);
    const ohneBeleg = D.buchungen.filter((b) => inJ(b) && geldfluss(b) && !b.beleg).length;
    const offen = D.rechnungen.filter((r) => r.art === 'rechnung' && r.status === 'offen' && r.datum.slice(0, 4) <= String(y));
    const ueber = offen.filter((r) => r.faellig < T).length;
    const W = webDaten(y), webL = W.filter(webLuecke).length;
    const gwg = (PARAM(y).gwg || 800) * 100;
    // mögliche Anlagegüter: Ausgaben über der GWG-Grenze, außer Wareneinkauf. Ohne Vorsteuerabzug (Kleinunternehmer)
    // gehört die Umsatzsteuer zu den Anschaffungskosten (§ 9b EStG) → Grenze gilt für den gezahlten Betrag, nicht netto.
    const gross = D.buchungen.filter((b) => inJ(b) && b.typ === 'ausgabe' && !(D.kat(b.kat) || {}).wareneingang && !b.wiederkehrend && b.betrag > gwg).length;
    const man = (App.LS.get(CHECK_KEY, {})[y]) || {};
    return [
      { id: 'belege', auto: true, ok: !ohneBeleg, text: 'Alle Ein- und Ausgänge haben einen Beleg', detail: ohneBeleg ? `${ohneBeleg} ohne Beleg` : 'vollständig', href: '#/buchungen' },
      { id: 'offen', auto: true, ok: !ueber, text: 'Offene Rechnungen geprüft', detail: offen.length ? `${offen.length} offen${ueber ? ` · ${ueber} überfällig` : ''}` : 'keine offen', href: '#/rechnungen' },
      { id: 'web', auto: true, ok: !webL, text: 'Wareneingangsbuch vollständig', detail: webL ? `${webL} ohne Lieferant oder Beleg` : `${W.length} Einträge`, tab: 'web' },
      { id: 'afa', auto: true, ok: !gross, text: `Anschaffungen über ${eur0(gwg)} als Anlage (AfA)`, detail: gross ? `${gross} prüfen` : 'keine im Jahr' },
      { id: 'kasse', text: 'Bareinnahmen einzeln aufgezeichnet', ok: !!man.kasse },
      { id: 'privat', text: 'Privatanteile eingetragen (z. B. Handy, Fahrzeug)', ok: !!man.privat },
      { id: 'fahrt', text: 'Fahrtenliste bzw. Kfz-Kosten belegt', ok: !!man.fahrt },
      { id: 'homeoffice', text: 'Homeoffice-Tage eingetragen', detail: 'optional', ok: !!man.homeoffice }
    ];
  }

  function kuHTML(y) {
    const P = PARAM(y), G25 = P.ku_grenze_vorjahr * 100, G100 = P.ku_grenze_laufend * 100, FB = P.gewst_freibetrag * 100, IHK = (P.ihk_frei || 5200) * 100;
    const lauf = y === Y;
    const hatVJ = D.buchungen.some((b) => inJahr(b.datum, y - 1));
    const vj = App.summen(`${y - 1}-01-01`, `${y - 1}-12-31`).ku;
    const s = App.summen(`${y}-01-01`, `${y}-12-31`);
    const lfd = s.ku, gew = s.gewinn;
    const hoch = lauf ? Math.round((lfd / monateVergangen()) * 12) : null;
    const gewHoch = lauf ? Math.round((Math.max(0, gew) / monateVergangen()) * 12) : null;
    const lfdTitel = lauf ? `${y} bisher` : `${y}`;
    const ref = hoch ?? lfd;

    const m1 = hatVJ ? meter({ titel: `Umsatz ${y - 1}`, sub: `entscheidet, ob ${y} die Kleinunternehmerregelung gilt`, wert: vj, grenze: G25, i: 0,
      badge: vj <= G25 ? badge('pos', 'check', `KU gilt ${y}`) : badge('neg', 'alert', `Regelbesteuerung ${y}`),
      text: vj <= G25 ? `Dein Umsatz ${y - 1} lag unter ${eur0(G25)}. Damit bist du ${y} Kleinunternehmer: Rechnungen ohne Umsatzsteuer, keine Umsatzsteuer-Voranmeldung.`
        : `Dein Umsatz ${y - 1} lag über ${eur0(G25)}. ${y} gilt die Regelbesteuerung – mit Umsatzsteuer auf Rechnungen und Voranmeldungen.` })
      : `<div class="aw-meter"><div class="aw-meter-head"><div><b>Umsatz ${y - 1}</b><small>entscheidet, ob ${y} die Kleinunternehmerregelung gilt</small></div>${badge('', 'info', 'keine Daten')}</div>
        <p class="aw-meter-text">Für ${y - 1} gibt es keine Buchungen in Kladdy. Maßgeblich ist der Gesamtumsatz laut deiner Steuererklärung ${y - 1} – lag er bei höchstens ${eur0(G25)}, gilt die Regel ${y}.</p></div>`;
    const m2 = meter({ titel: `Umsatz ${lfdTitel}`, sub: `entscheidet über ${y + 1}`, wert: lfd, grenze: G25, hoch, i: 1,
      badge: ref <= G25 * 0.8 ? badge('pos', 'check', `KU ${y + 1} sicher`) : ref <= G25 ? badge('warn', 'alert', 'knapp') : badge('neg', 'alert', `KU ${y + 1} gefährdet`),
      text: lauf ? `Bleibst du bis 31.12. unter ${eur0(G25)}, giltst du ${y + 1} weiter als Kleinunternehmer. Linear hochgerechnet landest du bei ${eur0(hoch)} – ${hoch <= G25 ? `${eur0(G25 - hoch)} unter der Grenze (bisher noch ${eur0(G25 - lfd)} Luft).` : `das wären ${eur0(hoch - G25)} zu viel.`}${ref > G25 * 0.8 ? ' Behalte vor allem die Saisonspitzen im Blick.' : ''}`
        : `${lfd <= G25 ? `Unter ${eur0(G25)}: Auch ${y + 1} gilt die Kleinunternehmerregelung.` : `Über ${eur0(G25)}: ${y + 1} gilt die Regelbesteuerung.`}` });
    const m3 = meter({ titel: `Umsatz ${lfdTitel}`, sub: 'sofortige Grenze im laufenden Jahr', wert: lfd, grenze: G100, i: 2,
      badge: lfd <= G100 * 0.8 ? badge('pos', 'check', 'weit entfernt') : lfd <= G100 ? badge('warn', 'alert', 'nah dran') : badge('neg', 'alert', 'überschritten'),
      text: `Überschreitest du im laufenden Jahr ${eur0(G100)}, endet die Regel sofort – ab genau dem Umsatz, mit dem du die Grenze reißt, nicht erst im Folgejahr.` });
    const g1 = meter({ titel: `Gewinn ${lfdTitel}`, sub: 'Freibetrag für Einzelunternehmen', wert: Math.max(0, gew), grenze: FB, hoch: gewHoch, i: 3,
      badge: (gewHoch ?? gew) <= FB ? badge('pos', 'check', 'keine Gewerbesteuer') : badge('warn', 'alert', 'Gewerbesteuer fällig'),
      text: `Bis ${eur0(FB)} Gewerbeertrag (vereinfacht: Gewinn) fällt keine Gewerbesteuer an; die Gewerbesteuererklärung ist erst darüber Pflicht.${lauf ? ` Hochrechnung bis Jahresende: ${eur0(gewHoch)}.` : ''}` });
    const g2 = meter({ titel: `Gewinn ${lfdTitel}`, sub: 'IHK-Beitragsfreiheit (ohne Handelsregister)', wert: Math.max(0, gew), grenze: IHK, hoch: gewHoch, i: 4, weich: true,
      badge: (gewHoch ?? gew) <= IHK ? badge('pos', 'check', 'beitragsfrei') : badge('', 'info', 'Beitrag möglich'),
      text: `Ohne Handelsregistereintrag bist du bis ${eur0(IHK)} Gewerbeertrag vom IHK-Beitrag befreit. Darüber erhebt die IHK einen Grundbeitrag – kein Steuerthema, nur eine Kostenfrage.` });

    const items = checkliste(y);
    const done = items.filter((x) => x.ok).length;
    const jahrZu = y < Y;
    const frist = `${y + 1}-07-31`;
    const fristN = U.diffDays(T, frist);
    const list = items.map((x) => `<li class="${x.ok ? 'ok' : ''} ${x.auto ? 'auto' : ''}">
        ${x.auto ? `<span class="aw-ck" title="automatisch geprüft">${icon(x.ok ? 'check' : 'alert')}</span>` : `<button type="button" class="aw-ck" data-aw="check" data-id="${x.id}" role="checkbox" aria-checked="${x.ok}" title="${x.ok ? 'Als offen markieren' : 'Als erledigt markieren'}">${icon('check')}</button>`}
        <span class="aw-ck-t"><span>${esc(x.text)}</span>${x.detail ? `<small>${esc(x.detail)}</small>` : ''}</span>
        ${x.href ? `<a class="link" href="${x.href}">ansehen${icon('chevR')}</a>` : x.tab ? `<button type="button" class="link" data-aw="tab" data-tab="${x.tab}">ansehen${icon('chevR')}</button>` : x.auto ? '<span class="pill">auto</span>' : ''}</li>`).join('');
    return `<section class="card reveal aw-ku" style="--i:3">
        <div class="card-head"><div><div class="card-title">${icon('target')}Kleinunternehmerregelung <span class="muted">· § 19 UStG</span></div>
          <div class="card-sub">Zwei Grenzen: Vorjahr höchstens ${eur0(G25)} und laufendes Jahr höchstens ${eur0(G100)}</div></div></div>
        <div class="aw-meters aw-row3">${m1}${m2}${m3}</div>
      </section>
      <div class="grid-2 aw-ku">
        <section class="card reveal" style="--i:4">
          <div class="card-head"><div><div class="card-title">${icon('shop')}Gewerbesteuer & IHK</div><div class="card-sub">Freibeträge auf den Gewerbeertrag ${y}</div></div></div>
          <div class="aw-meters">${g1}${g2}</div>
        </section>
        <section class="card reveal" style="--i:5">
          <div class="card-head"><div><div class="card-title">${icon('check')}Jahresabschluss ${y}</div><div class="card-sub">Bevor das Jahr festgeschrieben wird</div></div>
            <span class="aw-ck-count num">${done}/${items.length}</span></div>
          <div class="progress aw-ck-prog"><i style="width:${(done / items.length) * 100}%"></i></div>
          <ul class="aw-checks">${list}</ul>
          <div class="card-foot"><span class="muted">${icon('calendar')}Steuererklärung ${y} mit Anlage EÜR + G: bis ${fmt.datum(frist)} <span class="${fristN < 0 ? '' : fristN < 60 ? 'warn-t' : ''}">(${fmt.rel(frist)})</span></span>
            <button type="button" class="btn ghost" data-aw="fest" ${jahrZu && done === items.length ? '' : 'disabled'} title="${jahrZu ? (done === items.length ? '' : 'Erst alle Punkte erledigen') : `Möglich ab 01.01.${y + 1}`}">${icon('lock')}Jahr festschreiben</button></div>
        </section>
      </div>`;
  }

  /* ================= Export fürs Finanzamt ================= */
  function exportHTML(y) {
    const B = buchungenJahr(y), W = webDaten(y);
    const nEin = B.filter((b) => b.typ === 'einnahme').length, nAus = B.length - nEin;
    const lauf = y === Y;
    const zeile = ({ ic, titel, text, knoepfe }) => `<li class="aw-ex">
        <span class="aw-ex-ic">${icon(ic)}</span>
        <span class="aw-ex-t"><b>${titel}</b><small>${text}</small></span>
        <span class="aw-ex-a">${knoepfe}</span></li>`;
    const mac = (titel) => `<span class="badge" title="${esc(titel)} gibt es in der fertigen Mac-App">${icon('lock')}in der Mac-App</span>`;
    return `<div class="grid-main aw-export">
      <section class="card reveal" style="--i:3">
        <div class="card-head"><div><div class="card-title">${icon('download')}Export fürs Finanzamt ${y}${lauf ? `<span class="muted">· Stand ${fmt.datum(T)}</span>` : ''}</div>
          <div class="card-sub">Alles für die Steuererklärung an einem Ort – zum Abheften, Weitergeben oder Übertragen</div></div></div>
        <ul class="aw-exlist">
          ${zeile({ ic: 'swap', titel: `Alle Ein- & Ausgänge ${y}`, text: `CSV für Excel oder Numbers · ${B.length} Einträge (${nEin} Einnahmen, ${nAus} Ausgaben) · Datum, Beleg-Nr., Beschreibung, Kunde/Geschäft, Kategorie, EÜR-Bereich, Zahlungsweg, Betrag`,
            knoepfe: `<button type="button" class="btn-primary sm" data-aw="csv-buchungen" ${B.length ? '' : 'disabled'}>${icon('download')}CSV</button>` })}
          ${zeile({ ic: 'sigma', titel: `Einnahmen-Überschuss-Rechnung ${y}`, text: `Nach EÜR-Bereichen und Monaten · PDF (A4 quer) zum Abheften, CSV zum Weiterrechnen${lauf ? ' · vorläufig' : ''}`,
            knoepfe: `<button type="button" class="btn ghost sm" data-aw="csv">${icon('download')}CSV</button><button type="button" class="btn-primary sm" data-aw="print-euer">${icon('printer')}Als PDF drucken</button>` })}
          ${zeile({ ic: 'book', titel: `Wareneingangsbuch ${y}`, text: `§ 143 AO · ${W.length} Wareneingänge · PDF (A4 hoch)`,
            knoepfe: `<button type="button" class="btn-primary sm" data-aw="print-web" ${W.length ? '' : 'disabled'}>${icon('printer')}Als PDF drucken</button>` })}
          ${zeile({ ic: 'clip', titel: 'Alle Belege als ZIP-Ordner', text: `Quittungen, Rechnungen und Kassenbons ${y} in einem Ordner, nach Monaten sortiert`, knoepfe: mac('Der ZIP-Export') })}
          ${zeile({ ic: 'file', titel: 'DATEV-Export für die Steuerberatung', text: 'Falls du später mit einer Steuerberatung arbeitest: Buchungen im DATEV-Format zum Einlesen', knoepfe: mac('Der DATEV-Export') })}
        </ul>
      </section>
      <section class="card reveal aw-elster" style="--i:4">
        <div class="card-head"><div><div class="card-title">${icon('info')}So kommt es ans Finanzamt</div></div></div>
        <ol class="aw-steps">
          <li><b>Anlage EÜR über ELSTER</b><span>Die Steuererklärung samt Anlage EÜR gibst du elektronisch über ELSTER ab (Mein ELSTER). Kladdy zeigt dir im Reiter <button type="button" class="link" data-aw="tab" data-tab="euer">EÜR</button> die Werte zum Übertragen – die Zeilennummern bitte im aktuellen Formular prüfen.</span></li>
          <li><b>Belege aufbewahren</b><span>Ans Finanzamt schickst du keine Belege mit. Es kann sie aber später anfordern – deshalb jede Ein- und Ausgabe mit Beleg ablegen.</span></li>
          <li><b>Mit Steuerberatung</b><span>Gib die CSV oder später den DATEV-Export aus der Mac-App weiter.</span></li>
        </ol>
      </section>
    </div>`;
  }

  /* ================= Druck ================= */
  function printKopf(art, titel, zeile) {
    const F = D.FIRMA;
    return `<header class="pr-head"><div class="pr-title"><small>${art}</small><h1>${titel}</h1><p>${zeile}</p></div>
      <div class="pr-firm"><b>${esc(F.name)}</b>${esc(F.inhaber)}<br>${esc(F.strasse)} · ${esc(F.plz)} ${esc(F.ort)}<br>Steuernummer ${esc(F.steuernummer)}<br>Kleinunternehmer (§ 19 UStG)</div></header>`;
  }
  const printFuss = (links) => `<footer class="pr-foot"><span>${links}</span><span>Erstellt mit Kladdy am ${fmt.datum(T)}</span></footer>`;

  function printEuer(E) {
    const y = E.y, lauf = y === Y;
    const n = (c) => (c ? fmt.num(c / 100, 0) : '–');
    const rows = euerRows(E).map((r) => {
      if (r.kind === 'grp') return `<tr class="g"><td colspan="14">${esc(r.label)}${r.note ? ` <i>· ${esc(r.note)}</i>` : ''}</td></tr>`;
      if (r.leer) return `<tr class="info"><td colspan="14">${esc(r.label)}</td></tr>`;
      return `<tr class="${r.kind}"><td>${esc(r.label)}${r.sub ? ` <small>${esc(r.sub)}</small>` : ''}</td>${r.vals.map((v, i) => `<td>${lauf && i > M - 1 ? '' : n(v)}</td>`).join('')}<td class="s">${fmt.num(sum(r.vals) / 100, 2)}</td></tr>`;
    }).join('');
    return `<div class="aw-print pr-euer">
      ${printKopf('Vorbereitung Anlage EÜR', `Einnahmen-Überschuss-Rechnung ${y}`, `Gewinnermittlung nach § 4 Abs. 3 EStG · 01.01.${y} – 31.12.${y}${lauf ? ` · vorläufig, Stand ${fmt.datum(T)}` : ''}`)}
      <div class="pr-kpis"><div><small>Betriebseinnahmen</small><b>${fmt.eur(E.einS)}</b></div><div><small>Betriebsausgaben (abziehbar)</small><b>${fmt.eur(E.ausS)}</b></div><div class="hl"><small>Gewinn</small><b>${fmt.eur(E.gewinn)}</b></div></div>
      <table class="pr-table"><thead><tr><th>EÜR-Bereich / Kategorie</th>${MON.map((m) => `<th>${m}</th>`).join('')}<th class="s">Summe €</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="pr-note">Zufluss-/Abflussprinzip (§ 11 EStG). Ausgaben mit abziehbarem Betrag (ohne Privatanteile und nicht abziehbare Anteile). Kleinunternehmer nach § 19 UStG: Beträge ohne Umsatzsteuer. Werte in ELSTER in die Anlage EÜR übertragen – Zeilen bitte im aktuellen Formular prüfen.</p>
      ${printFuss(`${esc(D.FIRMA.name)} · EÜR ${y}`)}</div>`;
  }

  function printWeb(y) {
    const W = webDaten(y);
    const rows = W.map((w) => `<tr><td class="c">${w.lfd}</td><td>${fmt.datum(w.b.datum)}</td><td><b>${esc(lieferant(w) || '—')}</b></td><td>${esc(w.b.text)}</td><td class="r">${fmt.eur(w.b.betrag)}</td><td>${esc(belegRef(w.b))}${w.b.beleg ? `<br><small>${esc(w.b.beleg)}</small>` : '<br><small>Beleg fehlt</small>'}</td></tr>`).join('');
    return `<div class="aw-print pr-web">
      ${printKopf('Aufzeichnung nach § 143 AO', `Wareneingangsbuch ${y}`, `Tag des Eingangs, Lieferant, Ware, Preis und Beleg · 01.01.${y} – ${y === Y ? fmt.datum(T) : '31.12.' + y}`)}
      <table class="pr-table"><thead><tr><th class="c">Nr.</th><th>Datum</th><th>Lieferant</th><th>Warenbezeichnung</th><th class="r">Preis</th><th>Beleg</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">Keine Wareneingänge.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="4">Summe ${y} · ${W.length} Wareneingänge</td><td class="r">${fmt.eur(sum(W.map((w) => w.b.betrag)))}</td><td></td></tr></tfoot></table>
      <p class="pr-note">Anschrift des Lieferanten siehe Beleg.</p>
      ${printFuss(`${esc(D.FIRMA.name)} · Wareneingangsbuch ${y}`)}</div>`;
  }

  /* Druckzustand setzen, drucken, danach alles zurücksetzen (#printArea teilt sich die Seite mit den Belegen) */
  function drucken(kind) {
    const area = $('#printArea');
    if (!area) return;
    const prev = area.innerHTML;
    area.innerHTML = kind === 'euer' ? printEuer(euer(st.jahr)) : printWeb(st.jahr);
    document.getElementById('pageSize')?.remove();
    const ps = document.createElement('style');
    ps.id = 'pageSize';
    ps.textContent = `@page { size: A4 ${kind === 'euer' ? 'landscape' : 'portrait'}; margin: 12mm; }`;
    document.head.appendChild(ps);
    document.body.classList.add('printing-euer');
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-euer');
      if (ps.isConnected) ps.remove();
      area.innerHTML = prev;
    }, { once: true });
    window.print();
  }

  /* ================= Seite ================= */
  function bodyHTML() {
    if (st.tab === 'web') return webHTML(st.jahr);
    if (st.tab === 'ku') return kuHTML(st.jahr);
    if (st.tab === 'export') return exportHTML(st.jahr);
    return euerHTML(euer(st.jahr));
  }
  function syncHash() {
    const q = new URLSearchParams();
    if (st.tab !== 'euer') q.set('tab', st.tab);
    if (st.jahr !== Y) q.set('jahr', st.jahr);
    const h = '#/steuer' + (q.toString() ? '?' + q : '');
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  function showBody(root, anim = true) {
    const b = $('#awBody', root);
    b.classList.toggle('no-anim', !anim);
    b.innerHTML = bodyHTML();
    // lange Tabellen zum aktuellen Monat scrollen
    const sc = $('.aw-scroll', b), lat = sc && $('th.latest', sc);
    // so weit nach rechts wie möglich (Spalte „Summe“ sichtbar), ohne den aktuellen Monat unter die feste erste Spalte zu schieben
    if (lat) requestAnimationFrame(() => { const fix = ($('th.sticky', sc) || {}).offsetWidth || 0; sc.scrollLeft = Math.max(0, Math.min(sc.scrollWidth - sc.clientWidth, lat.offsetLeft - fix)); });
    syncHash();
  }

  function render(el, route) {
    const p = route.params;
    const tab = p.tab === 'wareneingang' ? 'web' : p.tab;
    if (TABS.some((t) => t[0] === tab)) st.tab = tab;
    if (p.jahr && [Y - 1, Y].includes(+p.jahr)) st.jahr = +p.jahr;
    el.innerHTML = `<div class="page aw">
      ${App.auswertungKopf('steuer', App.seg('local', 'jahr', [[Y - 1, String(Y - 1)], [Y, String(Y)]], st.jahr))}
      <div class="aw-tabs reveal" style="--i:1">${App.seg('local', 'tab', TABS, st.tab, 'tabs')}<span class="aw-tabs-hint">Die Sicht fürs Finanzamt: EÜR, Wareneingangsbuch, Kleinunternehmer-Grenzen und Export.</span></div>
      <div id="awBody" class="stack"></div>
    </div>`;
    const root = el.firstElementChild;
    showBody(root);

    root.addEventListener('seg-change', (e) => {
      const { key, value } = e.detail;
      if (key === 'tab') st.tab = value; else if (key === 'jahr') st.jahr = +value; else return;
      showBody(root);
    });
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-aw]');
      if (a) {
        const act = a.dataset.aw;
        if (act === 'print-euer') drucken('euer');
        else if (act === 'print-web') drucken('web');
        else if (act === 'csv') download(`euer_${st.jahr}.csv`, csvEuer(euer(st.jahr)));
        else if (act === 'csv-buchungen') download(`ein-ausgaenge_${st.jahr}.csv`, csvBuchungen(st.jahr));
        else if (act === 'tab') { $(`.aw-tabs .seg button[data-value="${a.dataset.tab}"]`, root)?.click(); window.scrollTo({ top: 0 }); }
        else if (act === 'check') {
          const all = App.LS.get(CHECK_KEY, {}), y = st.jahr;
          all[y] = { ...(all[y] || {}), [a.dataset.id]: !(all[y] || {})[a.dataset.id] };
          App.LS.set(CHECK_KEY, all);
          const scroll = window.scrollY;
          showBody(root, false);
          window.scrollTo(0, scroll);
        } else if (act === 'fest') App.toast(`Im Prototyp nicht aktiv – in der App sind ${st.jahr} danach nur noch Stornobuchungen möglich.`, { icon: 'lock', ms: 4200 });
        return;
      }
      const tr = e.target.closest('tr[data-href]');
      if (tr) App.go(tr.dataset.href);
    });
    root.addEventListener('keydown', (e) => {
      const tr = e.target.closest && e.target.closest('tr[data-href]');
      if (tr && e.key === 'Enter') App.go(tr.dataset.href);
    });
  }

  App.page('steuer', { title: 'Steuer & Export', icon: 'book', nav: false, parent: 'auswertung', order: 33, desc: 'EÜR, Wareneingangsbuch, Kleinunternehmer-Check, Export', render });
})();
