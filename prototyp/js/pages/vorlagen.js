/* Kladdy – Prototyp · Vorlagen (Block-Baukasten)
 * Belege werden aus Bausteinen zusammengesetzt – ohne LaTeX zu schreiben:
 * hinzufügen, entfernen, ausblenden, per Ziehen sortieren und je Baustein einstellen, mit Live-Vorschau.
 * Die Bausteine und ihr Aussehen kommen aus App.sheet (js/pages/belege.js). Den LaTeX-Code erzeugt die
 * App im Hintergrund; er ist nur in der Experten-Ansicht sichtbar.
 * Unterseite von „Rechnungen & Quittungen“ (parent: 'rechnungen'), erreichbar über den Knopf „Vorlagen“ in der Liste.
 */
(() => {
  'use strict';
  const { D, $, $$, esc, icon, fmt } = App;
  App.ICONS.eyeOff = '<path d="M3 3l18 18M10.6 5.1A9.7 9.7 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.9 3.8M6.6 6.6C3.9 8.4 2.5 12 2.5 12s3.5 7 9.5 7a9.4 9.4 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';

  const ARTEN = [['rechnung', 'Rechnung'], ['quittung', 'Quittung'], ['angebot', 'Angebot'], ['eigenbeleg', 'Eigenbeleg']];
  const ui = { art: 'rechnung', sel: 0, ansicht: 'vorschau', docId: null, palette: false }; // docId: null = automatisch, '' = Beispieldaten
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const S = () => window.App.sheet;

  /* ---------- Vorlagen-Verwaltung ---------- */
  const eigene = () => D.VORLAGEN.filter((v) => v.art === ui.art);
  const aktiv = () => eigene().find((v) => v.standard) || null;
  /* Bearbeitet wird immer eine eigene Vorlage; beim ersten Ändern entsteht sie als Kopie des Standards */
  function bloecke() { const v = aktiv(); return v ? v.bloecke : (S().STANDARD[ui.art] || []); }
  /* GoBD: Vor jeder Änderung bekommen ausgestellte Belege ohne eingefrorenes Layout ihre bisherige Vorlage – ein Nachdruck sieht dann aus wie das Original */
  const vorAenderung = () => { if (S().einfrierenAlle) S().einfrierenAlle(); };
  function bearbeitbar() {
    vorAenderung();
    let v = aktiv();
    if (!v) {
      v = { id: 'v' + Date.now(), name: `Meine ${ARTEN.find((a) => a[0] === ui.art)[1]}`, art: ui.art, bloecke: clone(S().STANDARD[ui.art] || []), standard: true };
      D.VORLAGEN.push(v);
    }
    return v;
  }
  let saveT = 0;
  function gespeichert() { App.save(); clearTimeout(saveT); saveT = setTimeout(() => { const s = $('#vlSaved'); if (s) { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); } }, 60); }

  /* Feld-Defaults eines Bausteins */
  function cfgOf(b) {
    const def = S().BLOCKS[b.typ];
    const out = {};
    (def && def.felder || []).forEach((f) => { out[f.key] = f.default; });
    return { ...out, ...b };
  }
  function summary(b) {
    const def = S().BLOCKS[b.typ]; if (!def) return '';
    const c = cfgOf(b);
    const t = (def.felder || []).find((f) => (f.typ === 'text' || f.typ === 'textarea') && c[f.key]);
    if (t) return String(c[t.key]).replace(/\n/g, ' · ');
    return def.desc || '';
  }

  /* ---------- Vorschau-Dokument ---------- */
  function docs() { return D.rechnungen.filter((r) => r.art === ui.art).slice().reverse().slice(0, 10); }
  function vorschauDoc() {
    const d = ui.docId && D.rechnungen.find((r) => r.id === ui.docId && r.art === ui.art);
    return d || { art: ui.art, positionen: [], status: 'entwurf' };
  }

  /* ---------- Rendern ---------- */
  function render(el) {
    if (!S() || !S().BLOCKS) {
      el.innerHTML = `<div class="page"><div class="card"><div class="empty">${icon('info')}<b>Bausteine werden geladen …</b><span>Der Beleg-Renderer (belege.js) fehlt noch.</span></div></div></div>`;
      return;
    }
    if (ui.docId && !docs().some((r) => r.id === ui.docId)) ui.docId = null;
    if (ui.docId == null) { const first = docs().find((r) => r.status !== 'entwurf'); ui.docId = first ? first.id : ''; }
    const v = aktiv();
    el.innerHTML = `
      <div class="page vl-page">
        <div class="page-head reveal" style="--i:0">
          <div><a class="bl-back" href="#/rechnungen">${icon('chevL')}Rechnungen & Quittungen</a><h1>${icon('blocks')}Vorlagen</h1><p class="page-sub">Belege aus Bausteinen zusammenstellen – ohne LaTeX. Die App erzeugt daraus im Hintergrund das PDF.</p></div>
          <div class="page-actions">${App.seg('local', 'art', ARTEN, ui.art)}</div>
        </div>
        <div class="vl-layout">
          <div class="stack">
            <section class="card reveal" style="--i:1">
              <div class="card-head"><div><div class="card-title">${icon('blocks')}Bausteine</div>
                <div class="card-sub">${v ? `<b>${esc(v.name)}</b> · eigene Vorlage` : 'Standardvorlage · Änderungen erzeugen eine eigene Kopie'} <span class="vl-saved" id="vlSaved">${icon('check')}gespeichert</span></div></div>
                ${v ? `<button type="button" class="icon-btn sm" data-action="vl-reset" data-tip="Eigene Vorlage verwerfen und zum Standard zurückkehren" data-tip-title="Zurücksetzen">${icon('reset')}</button>` : ''}</div>
              <ul class="vl-blocks" id="vlBlocks"></ul>
              <div class="vl-add">
                <button type="button" class="btn subtle" data-action="vl-palette">${icon('plus')} Baustein hinzufügen</button>
                <div class="vl-palette ${ui.palette ? 'open' : ''}" id="vlPalette"></div>
              </div>
            </section>
            <section class="card reveal" style="--i:2" id="vlConfig"></section>
            <section class="card reveal" style="--i:3" id="vlCheck"></section>
          </div>
          <div class="vl-right reveal" style="--i:2">
            <div class="vl-toolbar">
              ${App.seg('local', 'ansicht', [['vorschau', icon('eye') + 'Vorschau'], ['latex', icon('code') + 'LaTeX (Experten)']], ui.ansicht)}
              <span class="spacer"></span>
              <label class="vl-doc">${icon('file')}<select class="select sm" id="vlDoc">
                <option value="">Beispieldaten</option>
                ${docs().map((r) => `<option value="${r.id}" ${r.id === ui.docId ? 'selected' : ''}>${esc(r.nr || 'Entwurf')} · ${esc(S().empfaenger(r).anzeige || D.gegenueber(r))}</option>`).join('')}
              </select></label>
              <button type="button" class="btn ghost" data-action="vl-print" title="Vorschau drucken / als PDF speichern">${icon('printer')} PDF</button>
            </div>
            <div class="card flush vl-stage" id="vlStage"></div>
          </div>
        </div>
      </div>`;
    drawBlocks();
    drawPalette();
    drawConfig();
    drawPreview();
  }

  function drawBlocks() {
    const list = bloecke();
    $('#vlBlocks').innerHTML = list.map((b, i) => {
      const def = S().BLOCKS[b.typ] || { name: b.typ, icon: 'file' };
      return `<li class="vl-blk ${i === ui.sel ? 'on' : ''} ${b.aus ? 'aus' : ''}" draggable="true" data-i="${i}">
        <span class="vl-grip" title="Ziehen zum Sortieren">${icon('grip')}</span>
        <span class="vl-ic">${icon(def.icon || 'file')}</span>
        <span class="vl-meta"><b>${esc(def.name)}</b><small>${esc(summary(b))}</small></span>
        <button type="button" class="icon-btn sm" data-action="vl-toggle" data-i="${i}" title="${b.aus ? 'Einblenden' : 'Ausblenden'}">${icon(b.aus ? 'eyeOff' : 'eye')}</button>
        <button type="button" class="icon-btn sm vl-del" data-action="vl-del" data-i="${i}" title="Entfernen">${icon('x')}</button></li>`;
    }).join('') || `<li class="vl-empty">Noch keine Bausteine – füge unten welche hinzu.</li>`;
  }

  function drawPalette() {
    const types = Object.entries(S().BLOCKS).filter(([, d]) => !d.arten || d.arten.includes(ui.art));
    $('#vlPalette').innerHTML = `<div class="vl-pal-head"><b>Baustein hinzufügen</b><small>wird unter dem ausgewählten eingefügt</small></div>
      <div class="vl-pal-grid">${types.map(([k, d]) => `<button type="button" class="vl-pal-item" data-action="vl-add" data-typ="${k}">${icon(d.icon || 'file')}<span><b>${esc(d.name)}</b><small>${esc(d.desc || '')}</small></span></button>`).join('')}</div>`;
  }

  function feldHTML(f, c, i) {
    const id = `vlf-${i}-${f.key}`;
    const val = c[f.key];
    if (f.typ === 'toggle') return `<div class="toggle-row"><span>${esc(f.label)}</span><label class="switch"><input type="checkbox" id="${id}" data-feld="${f.key}" ${val ? 'checked' : ''}><span></span></label></div>`;
    let ctrl;
    if (f.typ === 'select') ctrl = `<select class="select" id="${id}" data-feld="${f.key}">${(f.optionen || []).map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
    else if (f.typ === 'textarea') ctrl = `<textarea class="textarea" id="${id}" data-feld="${f.key}" rows="3">${esc(val ?? '')}</textarea>`;
    else ctrl = `<input class="input ${f.typ === 'number' ? 'num' : ''}" id="${id}" data-feld="${f.key}" type="${f.typ === 'number' ? 'number' : 'text'}" value="${esc(val ?? '')}">`;
    const ph = (f.typ === 'text' || f.typ === 'textarea') ? `<div class="vl-ph">${(S().PLATZHALTER || []).map(([p, t]) => `<button type="button" class="chip" data-ph="${esc(p)}" data-for="${id}" data-tip="${esc(t)}">${esc(p)}</button>`).join('')}</div>` : '';
    return `<div class="field"><label for="${id}">${esc(f.label)}</label>${ctrl}${ph}</div>`;
  }

  function drawConfig() {
    const list = bloecke(), b = list[ui.sel], box = $('#vlConfig');
    if (!b) { box.innerHTML = `<div class="empty">${icon('blocks')}<span>Baustein auswählen, um ihn einzustellen.</span></div>`; return; }
    const def = S().BLOCKS[b.typ] || { name: b.typ, felder: [] };
    const c = cfgOf(b);
    box.innerHTML = `<div class="card-head"><div><div class="card-title">${icon(def.icon || 'edit')}${esc(def.name)}</div><div class="card-sub">${esc(def.desc || '')}</div></div>
      <div class="row"><button type="button" class="icon-btn sm" data-action="vl-move" data-d="-1" title="Nach oben" ${ui.sel === 0 ? 'disabled' : ''}>${icon('chevL', 'rot90')}</button><button type="button" class="icon-btn sm" data-action="vl-move" data-d="1" title="Nach unten" ${ui.sel === list.length - 1 ? 'disabled' : ''}>${icon('chevR', 'rot90')}</button></div></div>
      ${(def.felder || []).length ? `<div class="form">${def.felder.map((f) => feldHTML(f, c, ui.sel)).join('')}</div>` : `<p class="hint">Dieser Baustein hat keine Einstellungen – er übernimmt die Daten aus dem Beleg und den Firmendaten.</p>`}`;
  }

  function drawCheck(doc, list) {
    const box = $('#vlCheck'); if (!box) return;
    const items = S().pflichtCheck ? S().pflichtCheck(doc, list) : [];
    const bad = items.filter((x) => !x.ok).length;
    const titel = ui.art === 'eigenbeleg' ? 'Angaben im Eigenbeleg' : 'Pflichtangaben', grundlage = { rechnung: '§ 34a UStDV · ', quittung: '§ 33/§ 34a UStDV · ' }[ui.art] || '';
    box.innerHTML = `<div class="card-head"><div><div class="card-title">${icon(bad ? 'alert' : 'check')}${titel}</div><div class="card-sub">${items.length ? `${grundlage}${bad ? `${bad} fehlt` : 'alles drin'}` : 'keine Pflichtangaben nach UStDV'}</div></div></div>
      <ul class="vl-check">${items.map((x) => `<li class="${x.ok ? 'ok' : 'bad'}">${icon(x.ok ? 'check' : 'x')}<span>${esc(x.label)}${x.hint ? `<small>${esc(x.hint)}</small>` : ''}</span></li>`).join('') || '<li class="ok">Für diese Belegart keine Prüfung hinterlegt.</li>'}</ul>`;
  }

  function drawPreview() {
    const stage = $('#vlStage'); if (!stage) return;
    const list = bloecke(), doc = vorschauDoc();
    drawCheck(doc, list);
    if (ui.ansicht === 'latex') {
      stage.innerHTML = `<div class="vl-latex"><div class="proto-note">${icon('info')}<span>Wird automatisch aus den Bausteinen erzeugt und in der Mac-App mit Tectonic zu PDF kompiliert. Bearbeiten ist nicht nötig.</span></div><pre class="vl-code">${hiLatex(latex(list))}</pre></div>`;
      return;
    }
    stage.innerHTML = `<div class="vl-paper"><div class="vl-scale" id="vlScale">${S().html(doc, { bloecke: list, beispiel: !ui.docId })}</div></div>`;
    const sheet = $('#vlScale .sheet');
    if (sheet) { sheet.classList.add('editable'); const w = sheet.querySelector(`[data-blk="${ui.sel}"]`); if (w) w.classList.add('blk-sel'); }
    fit();
  }
  /* Blatt auf die Breite der Bühne skalieren */
  function fit() {
    const stage = $('#vlStage'), sc = $('#vlScale'); if (!stage || !sc) return;
    const sheet = sc.firstElementChild; if (!sheet) return;
    const pad = 28, w = stage.clientWidth - pad * 2;
    const k = Math.min(1.2, w / sheet.offsetWidth);
    sc.style.transform = `scale(${k})`;
    sc.parentElement.style.height = Math.ceil(sheet.offsetHeight * k + pad * 2) + 'px';
  }

  /* ---------- LaTeX-Erzeugung (Experten-Ansicht) ---------- */
  /* alle Platzhalter aus App.sheet.PLATZHALTER → Makros aus daten.tex (sonst stünde z. B. „{schlusstext}“ wörtlich im PDF) */
  const PH2TEX = { kunde: '\\KundeName', nr: '\\Nummer', art: '\\Belegart', datum: '\\Datum', leistungsdatum: '\\Leistungsdatum', faellig: '\\Faellig',
    summe: '\\Gesamt', betrag_worte: '\\BetragInWorten', betreff: '\\Betreff', einleitung: '\\Einleitung', schlusstext: '\\Schlusstext', zahlungsziel: '\\Zahlungsziel',
    firma: '\\Firma', inhaber: '\\FirmaInhaber', strasse: '\\FirmaStrasse', plz: '\\FirmaPLZ', ort: '\\FirmaOrt', steuernummer: '\\Steuernummer',
    telefon: '\\FirmaTelefon', email: '\\FirmaEmail', web: '\\FirmaWeb', bank: '\\Bank', iban: '\\IBAN', bic: '\\BIC' };
  function texText(s) {
    return String(s ?? '').replace(/[\\&%$#_^~]/g, (ch) => ({ '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', $: '\\$', '#': '\\#', _: '\\_', '^': '\\^{}', '~': '\\~{}' }[ch]))
      .replace(/\{(\w+)\}/g, (m, k) => (PH2TEX[k] ? PH2TEX[k] + '{}' : m)).replace(/\n/g, '\\\\\n');
  }
  function latex(list) {
    const a5 = ui.art === 'quittung' || ui.art === 'eigenbeleg';
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().replace('#', '').toUpperCase() || '6366F1';
    const out = [
      `% Kladdy – automatisch erzeugt aus ${list.length} Bausteinen (${ARTEN.find((x) => x[0] === ui.art)[1]})`,
      `\\documentclass[11pt]{article}`,
      `\\usepackage[${a5 ? 'a5paper, landscape, margin=14mm' : 'a4paper, top=18mm, bottom=32mm, left=22mm, right=20mm'}]{geometry}`,
      `\\usepackage{fontspec}`, `\\IfFontExistsTF{Helvetica Neue}{\\setmainfont{Helvetica Neue}}{}`,
      `\\usepackage[ngerman]{babel}`, `\\usepackage{xcolor, graphicx, tabularx, booktabs, etoolbox, fancyhdr}`,
      `\\definecolor{akzent}{HTML}{${acc.length === 6 ? acc : '6366F1'}}`, `\\definecolor{grau}{HTML}{6B7280}`,
      `\\setlength{\\parindent}{0pt}`, `\\input{daten.tex}   % Werte des Belegs (von der App erzeugt)`,
      `\\newcommand{\\Position}[6]{#1 & #2 & #3~#4 & #5 & #6 \\\\}`, `\\pagestyle{fancy}\\fancyhf{}\\renewcommand{\\headrulewidth}{0pt}`, ''
    ];
    const body = [];
    list.forEach((b) => {
      if (b.aus) return;
      const c = cfgOf(b), t = (k) => texText(c[k]);
      switch (b.typ) {
        case 'kopf': body.push(`% Kopf\n\\begin{minipage}[t]{0.6\\textwidth}{\\Large\\bfseries\\color{akzent}\\Firma}\\par{\\small\\color{grau}${c.claim ? t('claim') : '\\FirmaInhaber'}}\\end{minipage}\\hfill\n\\begin{minipage}[t]{0.35\\textwidth}\\raggedleft${c.logo === false ? '' : '\\ifdefempty{\\LogoDatei}{}{\\includegraphics[height=16mm]{\\LogoDatei}}'}\\end{minipage}\\par\\vspace{12mm}`); break;
        case 'absenderzeile': body.push(`{\\scriptsize\\color{grau}${c.text ? t('text') : '\\Firma{} · \\FirmaStrasse{} · \\FirmaPLZ{} \\FirmaOrt'}}\\par\\smallskip`); break;
        case 'anschrift_meta': { // Zeilen rechts wie im Baustein eingestellt
          const z = [c.nr && '\\textcolor{grau}{\\Belegart{}-Nr.} & \\textbf{\\Nummer}', c.datum && '\\textcolor{grau}{Datum} & \\Datum', c.leistung && ui.art !== 'angebot' && '\\textcolor{grau}{Leistungsdatum} & \\Leistungsdatum',
            c.kundennr && '\\textcolor{grau}{Kunden-Nr.} & \\KundenNr', c.faellig && `\\textcolor{grau}{${ui.art === 'angebot' ? 'Gültig bis' : 'Fällig am'}} & \\Faellig`].filter(Boolean);
          body.push(`% Anschrift | Belegdaten\n\\begin{minipage}[t]{0.55\\textwidth}\\KundeName\\par\\KundeStrasse\\par\\KundeOrt\\end{minipage}\\hfill\n\\begin{minipage}[t]{0.38\\textwidth}\\small\\begin{tabular}{@{}l r@{}}\n${z.map((x) => `  ${x}\\\\\n`).join('')}\\end{tabular}\\end{minipage}\\par\\vspace{10mm}`); break;
        }
        case 'titel': body.push(`{\\LARGE\\bfseries ${c.text ? t('text') : '\\Belegart{} \\Nummer'}}${c.rechts ? `\\hfill{\\large\\bfseries ${t('rechts')}}` : ''}\\par\\medskip`); break;
        case 'betreff': body.push(`\\ifdefempty{\\Betreff}{}{\\textbf{\\Betreff}\\par\\medskip}`); break;
        case 'datenschutz': body.push(`{\\scriptsize\\color{grau}${t('text')}}\\par\\medskip`); break;
        case 'text': case 'gruss': case 'steuerhinweis': body.push(`${t(Object.keys(c).find((k) => typeof c[k] === 'string' && k !== 'typ') || 'text')}\\par\\medskip`); break;
        case 'positionen': body.push(`{\\renewcommand{\\arraystretch}{1.35}\n\\begin{tabularx}{\\textwidth}{@{}r X r r r@{}}\\toprule\n  \\textcolor{grau}{\\small Pos.} & \\textcolor{grau}{\\small Beschreibung} & \\textcolor{grau}{\\small Menge} & \\textcolor{grau}{\\small Einzelpreis} & \\textcolor{grau}{\\small Gesamt}\\\\\\midrule\n  \\Positionen\n\\bottomrule\\end{tabularx}}\\par\\medskip`); break;
        case 'summe': body.push(`\\hfill{\\large\\textbf{${c.label ? t('label') : 'Gesamtbetrag'}: \\textcolor{akzent}{\\Gesamt}}}\\par\\medskip`); break;
        case 'betrag_worte': body.push(`\\textit{in Worten: \\BetragInWorten}\\par\\medskip`); break;
        case 'zahlung': body.push(`\\begin{minipage}[t]{0.68\\textwidth}${t('text') || 'Bitte überweisen Sie \\Gesamt{} bis zum \\Faellig.'}\\end{minipage}\\hfill\n${c.qr === false ? '' : '\\begin{minipage}[t]{0.28\\textwidth}\\raggedleft\\includegraphics[width=26mm]{girocode.png}\\par{\\tiny\\color{grau}Mit der Banking-App scannen}\\end{minipage}'}\\par\\medskip`); break;
        case 'quittung_felder': body.push(`\\Feld{Betrag}{\\textbf{\\Gesamt}}\\Feld{Erhalten von}{\\KundeName}\\Feld{Für}{\\Betreff}\\Feld{Datum}{\\Datum}`); break;
        case 'eigenbeleg_felder': body.push(`\\Feld{Zahlungsempfänger}{\\KundeName}\\Feld{Zweck}{\\Betreff}\\Feld{Betrag}{\\textbf{\\Gesamt}}\\Feld{Grund für den Eigenbeleg}{\\Grund}`); break;
        case 'unterschrift': body.push(`\\vfill\\begin{tabularx}{\\textwidth}{@{}XX@{}}\\rule{0.9\\linewidth}{0.4pt} & \\rule{0.9\\linewidth}{0.4pt}\\\\\n{\\footnotesize\\color{grau}${t('links')}} & {\\footnotesize\\color{grau}${t('rechts')}}\\\\\\end{tabularx}`); break;
        case 'trennlinie': body.push(`{\\color{akzent}\\rule{\\textwidth}{0.8pt}}\\par\\medskip`); break;
        case 'abstand': body.push(`\\vspace{${{ klein: '4mm', mittel: '8mm', gross: '14mm', groß: '14mm' }[c.groesse || c.hoehe] || '8mm'}}`); break;
        case 'fusszeile': out.push(`\\fancyfoot[C]{\\footnotesize\\color{grau}\\begin{tabularx}{\\textwidth}{@{}XXX@{}}\n  \\Firma\\newline\\FirmaStrasse\\newline\\FirmaPLZ{} \\FirmaOrt &\n  \\FirmaEmail\\newline Steuernr.: \\Steuernummer &\n  \\Bank\\newline IBAN: \\IBAN\n\\end{tabularx}}`); break;
        default: body.push(`% Baustein „${b.typ}“`);
      }
    });
    if (list.some((b) => !b.aus && (b.typ === 'quittung_felder' || b.typ === 'eigenbeleg_felder'))) out.push(`\\newcommand{\\Feld}[2]{{\\footnotesize\\color{grau}#1}\\par{\\large #2}\\par\\medskip}`);
    return out.join('\n') + '\n\n\\begin{document}\n' + body.join('\n\n') + '\n\\end{document}\n';
  }
  function hiLatex(src) {
    return esc(src).replace(/(%[^\n]*)/g, '<i class="tx-c">$1</i>')
      .replace(/(\\[A-Za-z@]+)/g, '<b class="tx-k">$1</b>')
      .replace(/([{}[\]])/g, '<span class="tx-b">$1</span>');
  }

  /* ---------- Interaktion ---------- */
  function rerenderParts() { drawBlocks(); drawConfig(); drawPreview(); }
  function setSel(i) { ui.sel = i; drawBlocks(); drawConfig(); drawPreview(); }

  document.addEventListener('seg-change', (e) => {
    if (App.route.id !== 'vorlagen') return;
    if (e.detail.key === 'art') { ui.art = e.detail.value; ui.sel = 0; ui.docId = null; ui.palette = false; App.rerender(); }
    if (e.detail.key === 'ansicht') { ui.ansicht = e.detail.value; drawPreview(); }
  });
  App.action('vl-palette', () => { ui.palette = !ui.palette; $('#vlPalette').classList.toggle('open', ui.palette); });
  App.action('vl-add', (a) => {
    const v = bearbeitbar();
    const at = Math.min(v.bloecke.length, ui.sel + 1);
    v.bloecke.splice(at, 0, { typ: a.dataset.typ });
    ui.sel = at; ui.palette = false; $('#vlPalette').classList.remove('open');
    gespeichert(); App.rerender();
    App.toast(`Baustein „${S().BLOCKS[a.dataset.typ].name}“ hinzugefügt`);
  });
  App.action('vl-del', (a, e) => {
    e.stopPropagation();
    const v = bearbeitbar(), i = +a.dataset.i, [weg] = v.bloecke.splice(i, 1);
    ui.sel = Math.max(0, Math.min(ui.sel, v.bloecke.length - 1));
    gespeichert(); App.rerender();
    App.toast(`„${(S().BLOCKS[weg.typ] || {}).name || weg.typ}“ entfernt`, { action: { label: 'Rückgängig', fn: () => { vorAenderung(); v.bloecke.splice(i, 0, weg); ui.sel = i; gespeichert(); App.rerender(); } } });
  });
  App.action('vl-toggle', (a, e) => {
    e.stopPropagation();
    const v = bearbeitbar(), b = v.bloecke[+a.dataset.i];
    if (b.aus) delete b.aus; else b.aus = true;
    gespeichert(); rerenderParts();
  });
  App.action('vl-move', (a) => {
    const v = bearbeitbar(), d = +a.dataset.d, i = ui.sel, j = i + d;
    if (j < 0 || j >= v.bloecke.length) return;
    [v.bloecke[i], v.bloecke[j]] = [v.bloecke[j], v.bloecke[i]];
    ui.sel = j; gespeichert(); rerenderParts();
  });
  App.action('vl-reset', () => {
    const v = aktiv(); if (!v) return;
    vorAenderung();
    D.VORLAGEN.splice(D.VORLAGEN.indexOf(v), 1);
    ui.sel = 0; gespeichert(); App.rerender();
    App.toast('Standardvorlage wiederhergestellt', { action: { label: 'Rückgängig', fn: () => { vorAenderung(); D.VORLAGEN.push(v); gespeichert(); App.rerender(); } } });
  });
  App.action('vl-print', () => {
    if (S().print) S().print(vorschauDoc(), { bloecke: bloecke(), beispiel: !ui.docId });
  });

  document.addEventListener('click', (e) => {
    if (App.route.id !== 'vorlagen') return;
    const li = e.target.closest('.vl-blk');
    if (li && !e.target.closest('button')) { setSel(+li.dataset.i); return; }
    const blk = e.target.closest('#vlScale [data-blk]');
    if (blk) { setSel(+blk.dataset.blk); $(`.vl-blk[data-i="${ui.sel}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    const ph = e.target.closest('[data-ph]');
    if (ph) {
      const inp = document.getElementById(ph.dataset.for); if (!inp) return;
      const s = inp.selectionStart ?? inp.value.length, en = inp.selectionEnd ?? s;
      inp.value = inp.value.slice(0, s) + ph.dataset.ph + inp.value.slice(en);
      inp.focus(); inp.selectionStart = inp.selectionEnd = s + ph.dataset.ph.length;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (ui.palette && !e.target.closest('.vl-add')) { ui.palette = false; $('#vlPalette')?.classList.remove('open'); }
  });
  /* Feld geändert → Baustein aktualisieren (Vorschau live) */
  const onFeld = (e) => {
    const f = e.target.closest && e.target.closest('#vlConfig [data-feld]');
    if (!f) return;
    const v = bearbeitbar(), b = v.bloecke[ui.sel]; if (!b) return;
    b[f.dataset.feld] = f.type === 'checkbox' ? f.checked : f.type === 'number' ? Number(f.value) : f.value;
    gespeichert(); drawBlocks(); drawPreview();
    // Erstes Ändern einer Standardvorlage: Kopf aktualisieren (Name der eigenen Vorlage)
    if (!$('#vlSaved')?.closest('.card-sub')?.textContent.includes('eigene')) { const sub = $('#vlSaved')?.closest('.card-sub'); if (sub) sub.innerHTML = `<b>${esc(v.name)}</b> · eigene Vorlage <span class="vl-saved flash" id="vlSaved">${icon('check')}gespeichert</span>`; }
  };
  document.addEventListener('input', onFeld);
  document.addEventListener('change', (e) => {
    if (e.target.id === 'vlDoc') { ui.docId = e.target.value; drawPreview(); return; }
    if (e.target.matches && e.target.matches('#vlConfig select, #vlConfig input[type=checkbox]')) onFeld(e);
  });

  /* Ziehen zum Sortieren */
  let dragI = null;
  document.addEventListener('dragstart', (e) => {
    const li = e.target.closest && e.target.closest('.vl-blk'); if (!li) return;
    dragI = +li.dataset.i; li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragI));
  });
  document.addEventListener('dragover', (e) => {
    const li = e.target.closest && e.target.closest('.vl-blk'); if (dragI == null || !li) return;
    e.preventDefault();
    $$('.vl-blk').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    const r = li.getBoundingClientRect();
    li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
  });
  document.addEventListener('drop', (e) => {
    const li = e.target.closest && e.target.closest('.vl-blk'); if (dragI == null || !li) return;
    e.preventDefault(); e.stopPropagation();
    const r = li.getBoundingClientRect();
    let to = +li.dataset.i + (e.clientY < r.top + r.height / 2 ? 0 : 1);
    const v = bearbeitbar(), [b] = v.bloecke.splice(dragI, 1);
    if (to > dragI) to--;
    v.bloecke.splice(to, 0, b); ui.sel = to; dragI = null;
    gespeichert(); rerenderParts();
  }, true);
  document.addEventListener('dragend', () => { dragI = null; $$('.vl-blk').forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after')); });
  window.addEventListener('resize', () => { if (App.route.id === 'vorlagen') fit(); });

  App.page('vorlagen', { title: 'Vorlagen', icon: 'blocks', nav: false, parent: 'rechnungen', order: 21, desc: 'Quittung & Rechnung aus Bausteinen gestalten', render(el, route) {
    if (route.params.art && ARTEN.some((a) => a[0] === route.params.art)) { if (ui.art !== route.params.art) ui.docId = null; ui.art = route.params.art; ui.sel = 0; history.replaceState(null, '', '#/vorlagen'); }
    render(el);
    App.dropTarget = null;
    return () => { ui.palette = false; };
  } });
})();
