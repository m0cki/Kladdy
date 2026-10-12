/* Kladdy – Prototyp · Diagramme
 * Kleine, abhängigkeitsfreie SVG-Diagramme (aus PowerAnalytic übernommen und ergänzt):
 * Fläche, gruppierte Balken, Linien, Sparkline, Donut und die Liquiditätsprognose.
 * Farben kommen ausschließlich über CSS-Variablen, damit Theme-Wechsel ohne Neuzeichnen greifen.
 * Regeln: eine Y-Achse, Hover-Tooltip, Legende ab 2 Serien, Bezugswerte gestrichelt.
 */
window.Charts = (() => {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function niceTicks(min, max, count = 4) {
    if (min === max) { max = min + 1; min = min - 1; }
    const step0 = (max - min) / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const n = step0 / mag;
    const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12));
    return { lo, hi, ticks };
  }

  /* Monotone kubische Interpolation (keine Überschwinger) */
  function linePath(pts, smooth) {
    if (!pts.length) return '';
    if (!smooth || pts.length < 3) return 'M' + pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L');
    const n = pts.length, dx = [], dy = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; dy[i] = pts[i + 1][1] - pts[i][1]; m[i] = dy[i] / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${(pts[i][0] + h).toFixed(2)},${(pts[i][1] + t[i] * h).toFixed(2)} ${(pts[i + 1][0] - h).toFixed(2)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(2)} ${pts[i + 1][0].toFixed(2)},${pts[i + 1][1].toFixed(2)}`;
    }
    return d;
  }
  /* Treppenlinie: der Wert ändert sich sprunghaft an Zahlungstagen */
  function stepPath(pts) {
    if (!pts.length) return '';
    let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) d += `H${pts[i][0].toFixed(2)}V${pts[i][1].toFixed(2)}`;
    return d;
  }

  /* Balken mit 4px-Rundung nur am Datenende (an der Nulllinie gerade) */
  function barPath(x, w, y0, y1) {
    const h = Math.abs(y1 - y0);
    const r = Math.min(4, w / 2, h);
    if (h < 0.5) return '';
    if (y1 < y0) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
    return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  }

  /* Montiert ein Diagramm und zeichnet bei Größenänderung neu (ohne erneute Animation) */
  function mount(el, draw) {
    if (el._ro) el._ro.disconnect();
    let first = true, lastW = 0;
    const run = () => {
      const w = Math.floor(el.clientWidth);
      if (!w || w === lastW) return;
      lastW = w;
      draw(w, first);
      first = false;
    };
    el._ro = new ResizeObserver(run);
    el._ro.observe(el);
    run();
  }

  function svgOpen(w, h) { return `<svg class="chart-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">`; }

  /* fmt(v, step) bekommt den Tick-Abstand mit, damit alle Achsenwerte gleich viele Nachkommastellen haben */
  function yAxis(ticks, y, m, w, fmt) {
    const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
    return ticks.map((v) => `<line x1="${m.l}" x2="${w - m.r}" y1="${y(v)}" y2="${y(v)}" class="${v === 0 ? 'c-base' : 'c-grid'}"/>` +
      `<text x="${m.l - 8}" y="${y(v)}" class="c-tick" text-anchor="end" dominant-baseline="middle">${esc(fmt(v, step))}</text>`).join('');
  }

  function tipHTML(title, rows, note) {
    return `<div class="ct-title">${esc(title)}</div>` + rows.map((r) =>
      `<div class="ct-row">${r.color ? `<i style="background:${r.color}"></i>` : ''}<span>${esc(r.name || '')}</span><b>${esc(r.value)}</b></div>`).join('') +
      (note ? `<div class="ct-note">${note}</div>` : '');
  }

  function placeTip(el, tip, x, y) {
    tip.classList.add('show');
    const tw = tip.offsetWidth, th = tip.offsetHeight, W = el.clientWidth;
    let left = x + 14;
    if (left + tw > W - 4) left = x - tw - 14;
    tip.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(0, y - th / 2)}px)`;
  }

  /* Beschriftung als Pille mit Hintergrund (lesbar, auch wenn eine Linie kreuzt) */
  function labelPill(cls, x, cy, text, anchor = 'start') {
    const w = text.length * 5.6 + 14;
    const rx = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
    return `<g class="${cls}"><rect x="${rx}" y="${cy - 8}" width="${w}" height="16" rx="5"/>` +
      `<text x="${rx + 7}" y="${cy}" dominant-baseline="central">${esc(text)}</text></g>`;
  }

  /* ---------- Flächendiagramm (eine Serie) ---------- */
  function area(el, o) {
    const H = o.height || 260;
    mount(el, (W, first) => {
      const m = { t: 14, r: o.endLabel === false ? 14 : 70, b: 28, l: 58 };
      const pw = W - m.l - m.r, ph = H - m.t - m.b;
      const vals = o.data.map((d) => d.v);
      const ref = o.baseline ? [o.baseline.v] : [];
      const min = Math.min(0, ...vals, ...ref), max = Math.max(...vals, ...ref), pad = (max - min) * 0.08 || 1;
      const { lo, hi, ticks } = niceTicks(min < 0 ? min - pad : min, max + pad, 4);
      const x = (i) => m.l + (o.data.length === 1 ? pw / 2 : (i / (o.data.length - 1)) * pw);
      const y = (v) => m.t + ph - ((v - lo) / (hi - lo)) * ph;
      const pts = o.data.map((d, i) => [x(i), y(d.v)]);
      const line = linePath(pts, o.smooth);
      const areaD = `${line}L${x(o.data.length - 1)},${y(Math.max(lo, 0))}L${m.l},${y(Math.max(lo, 0))}Z`;
      const gid = 'g' + Math.random().toString(36).slice(2, 8);
      const nX = Math.max(2, Math.min(o.data.length, Math.floor(pw / 70)));
      const every = Math.ceil(o.data.length / nX);
      const color = o.color || 'var(--accent)';
      const last = pts[pts.length - 1];
      const refY = o.baseline ? y(o.baseline.v) : 0;
      el.innerHTML = svgOpen(W, H) +
        `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${color};stop-opacity:.32"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/></linearGradient></defs>` +
        yAxis(ticks, y, m, W, o.fmtY) +
        o.data.map((d, i) => ((o.data.length - 1 - i) % every === 0 ? `<text x="${x(i)}" y="${H - 8}" class="c-tick" text-anchor="${i === 0 ? 'start' : i === o.data.length - 1 ? 'end' : 'middle'}">${esc(o.fmtX(d.t))}</text>` : '')).join('') +
        (o.baseline ? `<line x1="${m.l}" x2="${W - m.r}" y1="${refY}" y2="${refY}" class="c-ref"/>` : '') +
        `<path d="${areaD}" style="fill:url(#${gid})" class="${first ? 'c-fade' : ''}"/>` +
        `<path d="${line}" pathLength="1" class="c-line ${first ? 'c-draw' : ''}" style="stroke:${color}"/>` +
        (o.baseline ? labelPill('c-reflabel', m.l + 4, refY - 12, o.baseline.label) : '') +
        `<circle cx="${last[0]}" cy="${last[1]}" r="4" class="c-dot c-pulse" style="fill:${color}"/>` +
        (o.endLabel === false ? '' : `<g class="c-endlabel"><rect x="${W - m.r + 6}" y="${last[1] - 11}" width="${m.r - 8}" height="22" rx="6" style="fill:${color}"/>` +
          `<text x="${W - m.r + 6 + (m.r - 8) / 2}" y="${last[1]}" text-anchor="middle" dominant-baseline="central" class="c-endtext">${esc((o.fmtEnd || o.fmtY)(vals[vals.length - 1], 1))}</text></g>`) +
        `<line class="c-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}"/><circle class="c-hoverdot" r="5" style="fill:${color}"/>` +
        `<rect class="c-overlay" x="${m.l - 6}" y="${m.t}" width="${pw + 12}" height="${ph}"/></svg><div class="chart-tip"></div>`;
      const svg = el.querySelector('svg'), tip = el.querySelector('.chart-tip');
      const cross = svg.querySelector('.c-cross'), dot = svg.querySelector('.c-hoverdot');
      const overlay = svg.querySelector('.c-overlay');
      overlay.addEventListener('pointermove', (ev) => {
        const rect = svg.getBoundingClientRect();
        const i = Math.max(0, Math.min(o.data.length - 1, Math.round(((ev.clientX - rect.left - m.l) / pw) * (o.data.length - 1))));
        const [cx, cy] = pts[i];
        cross.setAttribute('x1', cx); cross.setAttribute('x2', cx);
        dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
        svg.classList.add('hovering');
        tip.innerHTML = tipHTML(o.fmtDate(o.data[i].t), [{ name: o.name || '', value: o.fmtTip(o.data[i].v) }, ...(o.extraTip ? o.extraTip(i) : [])]);
        placeTip(el, tip, cx, cy);
      });
      overlay.addEventListener('pointerleave', () => { svg.classList.remove('hovering'); tip.classList.remove('show'); });
    });
  }

  /* ---------- Gruppierte Balken (gleiche Einheit, eine Achse) ---------- */
  function bars(el, o) {
    const H = o.height || 250;
    mount(el, (W, first) => {
      const m = { t: 12, r: 10, b: 28, l: 58 };
      const pw = W - m.l - m.r, ph = H - m.t - m.b;
      const n = o.labels.length, s = o.series.length;
      const all = o.series.flatMap((se) => se.values).filter((v) => v != null);
      const { lo, hi, ticks } = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4);
      const y = (v) => m.t + ph - ((v - lo) / (hi - lo)) * ph;
      const band = pw / n;
      const groupW = Math.min(band * 0.72, s * 26 + (s - 1) * 2);
      const bw = (groupW - (s - 1) * 2) / s;
      const y0 = y(0);
      const every = Math.ceil(46 / band);
      let barsSvg = '';
      o.labels.forEach((lab, i) => {
        const gx = m.l + i * band + (band - groupW) / 2;
        o.series.forEach((se, k) => {
          const val = se.values[i];
          if (val == null) return;
          const bx = gx + k * (bw + 2);
          const d = barPath(bx, bw, y0, y(val));
          const faint = o.faint && o.faint(i) ? 'opacity:.45;' : '';
          if (d) barsSvg += `<path d="${d}" class="c-bar ${first ? 'c-grow' : ''}" style="${faint}fill:${se.color};transform-origin:${bx + bw / 2}px ${y0}px;animation-delay:${first ? i * 35 + k * 60 : 0}ms"/>`;
        });
      });
      el.innerHTML = svgOpen(W, H) + yAxis(ticks, y, m, W, o.fmtY) +
        `<rect class="c-band" x="0" y="${m.t}" width="${band}" height="${ph}" rx="6"/>` +
        barsSvg +
        o.labels.map((lab, i) => (i % every === (n - 1) % every) ? `<text x="${m.l + i * band + band / 2}" y="${H - 8}" class="c-tick" text-anchor="middle">${esc(lab)}</text>` : '').join('') +
        `<rect class="c-overlay" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></svg><div class="chart-tip"></div>`;
      const svg = el.querySelector('svg'), tip = el.querySelector('.chart-tip'), bandEl = svg.querySelector('.c-band');
      const overlay = svg.querySelector('.c-overlay');
      overlay.addEventListener('pointermove', (ev) => {
        const rect = svg.getBoundingClientRect();
        const i = Math.max(0, Math.min(n - 1, Math.floor((ev.clientX - rect.left - m.l) / band)));
        bandEl.setAttribute('x', m.l + i * band);
        svg.classList.add('hovering');
        tip.innerHTML = tipHTML(o.tipTitle ? o.tipTitle(i) : o.labels[i], o.series.map((se) => ({ color: se.color, name: se.name, value: se.values[i] == null ? '–' : o.fmtTip(se.values[i]) })).concat(o.extraTip ? o.extraTip(i) : []));
        placeTip(el, tip, m.l + i * band + band / 2, ev.clientY - rect.top);
      });
      overlay.addEventListener('pointerleave', () => { svg.classList.remove('hovering'); tip.classList.remove('show'); });
      if (o.onClick) overlay.addEventListener('click', (ev) => {
        const rect = svg.getBoundingClientRect();
        o.onClick(Math.max(0, Math.min(n - 1, Math.floor((ev.clientX - rect.left - m.l) / band))));
      });
    });
  }

  /* ---------- Mehrere Linien ---------- */
  function lines(el, o) {
    const H = o.height || 250;
    mount(el, (W, first) => {
      const m = { t: 12, r: 14, b: 28, l: 52 };
      const pw = W - m.l - m.r, ph = H - m.t - m.b;
      const n = o.labels.length;
      const all = o.series.flatMap((se) => se.values).filter((v) => v != null && isFinite(v));
      const { lo, hi, ticks } = niceTicks(Math.min(0, ...all), Math.max(...all), 4);
      const x = (i) => m.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
      const y = (v) => m.t + ph - ((v - lo) / (hi - lo)) * ph;
      const every = Math.ceil(46 / (pw / Math.max(1, n - 1)));
      let body = '';
      o.series.forEach((se, k) => {
        // Lücken (null) überspringen, z. B. Monate in der Zukunft
        const pts = se.values.map((v, i) => (v == null || !isFinite(v) ? null : [x(i), y(v)])).filter(Boolean);
        body += `<path d="${linePath(pts, o.smooth)}" ${se.dashed ? '' : 'pathLength="1"'} class="c-line ${se.dashed ? 'dashed' : ''} ${first ? 'c-draw' : ''}" style="stroke:${se.color};animation-delay:${k * 120}ms"/>`;
        if (n <= 16 && !se.dashed) body += pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" class="c-marker ${first ? 'c-fade' : ''}" style="fill:${se.color}"/>`).join('');
      });
      el.innerHTML = svgOpen(W, H) + yAxis(ticks, y, m, W, o.fmtY) + body +
        o.labels.map((lab, i) => (i % every === (n - 1) % every) ? `<text x="${x(i)}" y="${H - 8}" class="c-tick" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(lab)}</text>` : '').join('') +
        `<line class="c-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}"/>` +
        `<rect class="c-overlay" x="${m.l - 10}" y="${m.t}" width="${pw + 20}" height="${ph}"/></svg><div class="chart-tip"></div>`;
      const svg = el.querySelector('svg'), tip = el.querySelector('.chart-tip'), cross = svg.querySelector('.c-cross');
      const overlay = svg.querySelector('.c-overlay');
      overlay.addEventListener('pointermove', (ev) => {
        const rect = svg.getBoundingClientRect();
        const i = Math.max(0, Math.min(n - 1, Math.round(((ev.clientX - rect.left - m.l) / pw) * (n - 1))));
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
        svg.classList.add('hovering');
        tip.innerHTML = tipHTML(o.labels[i], o.series.map((se) => ({ color: se.color, name: se.name, value: o.fmtTip(se.values[i]) })));
        placeTip(el, tip, x(i), ev.clientY - rect.top);
      });
      overlay.addEventListener('pointerleave', () => { svg.classList.remove('hovering'); tip.classList.remove('show'); });
    });
  }

  /* ---------- Vorschau (Liquidität) ----------
   * data: [{ t, v, events: [{ text, betrag, prog }] }] – ein Punkt pro Tag (Wert am Tagesende, Euro)
   * todayIdx: Index von heute. Bis dahin Ist (durchgezogen), danach Prognose (gestrichelt, blassere Fläche).
   *   todayIdx 0 = reine Vorschau ab heute: nichts abzugrenzen → Linie durchgezogen und gezeichnet wie Ist.
   * negativ: true → Bereich unter 0 rot (Linie und Fläche), z. B. „mehr raus als rein“.
   * wertName: Name des Werts im Tooltip (Standard „Wert“). */
  function forecast(el, o) {
    const H = o.height || 300;
    mount(el, (W, first) => {
      const m = { t: 26, r: 76, b: 28, l: 62 };
      const pw = W - m.l - m.r, ph = H - m.t - m.b;
      const n = o.data.length, ti = o.todayIdx || 0, nurProg = ti === 0;
      const vals = o.data.map((d) => d.v);
      const min = Math.min(0, ...vals), max = Math.max(...vals), pad = (max - min) * 0.1 || 1;
      const { lo, hi, ticks } = niceTicks(min < 0 ? min - pad : min, max + pad, 4);
      const x = (i) => m.l + (i / Math.max(1, n - 1)) * pw;
      const y = (v) => m.t + ph - ((v - lo) / (hi - lo)) * ph;
      const pts = o.data.map((d, i) => [x(i), y(d.v)]);
      const hist = pts.slice(0, ti + 1), prog = pts.slice(ti);
      const hLine = stepPath(hist), pLine = stepPath(prog);
      const base = y(Math.max(lo, 0));
      const gid = 'g' + Math.random().toString(36).slice(2, 8);
      // Tiefpunkt der Prognose; „kritisch“ = unter 0
      let minI = ti; for (let i = ti; i < n; i++) if (vals[i] < vals[minI]) minI = i;
      const under = vals[minI] < 0;
      // Unter-0-Bereich: Fläche und Linie an der Nulllinie teilen (oben Akzent, unten rot)
      const neg = !!o.negativ && lo < 0, z = y(0);
      const clipO = neg ? ` clip-path="url(#${gid}o)"` : '', clipU = ` clip-path="url(#${gid}u)"`;
      // X-Beschriftung: Monatsanfänge (mind. 64 px Abstand)
      const xIdx = [];
      o.data.forEach((d, i) => { if (d.t.slice(8) === '01' && (!xIdx.length || x(i) - x(xIdx[xIdx.length - 1]) >= 64) && Math.abs(i - ti) * (pw / n) > 30) xIdx.push(i); });
      const evDots = o.data.map((d, i) => (i > ti && d.events && d.events.length ? `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="2.6" style="fill:${d.events.reduce((s, e) => s + e.betrag, 0) >= 0 ? 'var(--pos)' : 'var(--neg)'}" class="${first ? 'c-fade' : ''}"/>` : '')).join('');
      const last = pts[n - 1];
      const minTxt = o.fmtMin ? o.fmtMin(vals[minI], o.data[minI].t) : '';
      const minAnchor = pts[minI][0] > W - m.r - 120 ? 'end' : pts[minI][0] < m.l + 90 ? 'start' : 'middle';
      // Prognose-Linie: gestrichelt nach einem Ist-Teil, ohne Rückblick durchgezogen (mit Zeichen-Animation)
      const pCls = `c-line ${nurProg ? '' : 'dashed'} ${first ? 'c-draw' : ''}`;
      const pAttr = nurProg ? ' pathLength="1"' : '';
      el.innerHTML = svgOpen(W, H) +
        `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.30"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient>` +
        `<linearGradient id="${gid}p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:${nurProg ? '.26' : '.12'}"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient>` +
        (neg ? `<linearGradient id="${gid}n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--neg);stop-opacity:.06"/><stop offset="1" style="stop-color:var(--neg);stop-opacity:.30"/></linearGradient>` +
          `<clipPath id="${gid}o"><rect x="0" y="0" width="${W}" height="${z}"/></clipPath><clipPath id="${gid}u"><rect x="0" y="${z}" width="${W}" height="${H - z}"/></clipPath>` : '') + '</defs>' +
        yAxis(ticks, y, m, W, o.fmtY) +
        xIdx.map((i) => `<text x="${x(i)}" y="${H - 8}" class="c-tick" text-anchor="middle">${esc(o.fmtX(o.data[i].t))}</text>`).join('') +
        `<line x1="${x(ti)}" x2="${x(ti)}" y1="${m.t - 10}" y2="${m.t + ph}" class="c-today"/>` +
        `<text x="${x(ti)}" y="${m.t - 14}" text-anchor="${nurProg ? 'start' : 'middle'}" class="c-todaylabel">Heute</text>` +
        `<text x="${x(ti)}" y="${H - 8}" class="c-tick" text-anchor="${nurProg ? 'start' : 'middle'}">${esc(o.fmtX(o.data[ti].t, true))}</text>` +
        (nurProg ? '' : `<path d="${hLine}H${x(ti)}V${base}H${m.l}Z" style="fill:url(#${gid})" class="${first ? 'c-fade' : ''}"/>`) +
        `<path d="${pLine}V${base}H${x(ti)}Z" style="fill:url(#${gid}p)" class="${first ? 'c-fade' : ''}"${clipO}/>` +
        (neg ? `<path d="${pLine}V${z}H${x(ti)}Z" style="fill:url(#${gid}n)" class="${first ? 'c-fade' : ''}"${clipU}/>` : '') +
        (nurProg ? '' : `<path d="${hLine}" pathLength="1" class="c-line ${first ? 'c-draw' : ''}" style="stroke:var(--accent)"/>`) +
        `<path d="${pLine}"${pAttr} class="${pCls}" style="stroke:var(--accent)"${clipO}/>` +
        (neg ? `<path d="${pLine}"${pAttr} class="${pCls}" style="stroke:var(--neg)"${clipU}/>` : '') +
        evDots +
        (minI > ti ? `<circle cx="${pts[minI][0]}" cy="${pts[minI][1]}" r="5" class="c-dot" style="fill:${under ? 'var(--neg)' : 'var(--warn)'}"/>` +
          (minTxt ? labelPill('c-minlabel', pts[minI][0], Math.min(m.t + ph - 10, pts[minI][1] + 18), minTxt, minAnchor) : '') : '') +
        `<circle cx="${x(ti)}" cy="${pts[ti][1]}" r="4.5" class="c-dot c-pulse" style="fill:var(--accent)"/>` +
        `<g class="c-endlabel"><rect x="${W - m.r + 6}" y="${last[1] - 11}" width="${m.r - 8}" height="22" rx="6" style="fill:var(--surface-3);stroke:var(--accent-line)"/>` +
        `<text x="${W - m.r + 6 + (m.r - 8) / 2}" y="${last[1]}" text-anchor="middle" dominant-baseline="central" style="fill:var(--text);font-size:11px;font-weight:700;font-variant-numeric:tabular-nums">${esc(o.fmtEnd(vals[n - 1]))}</text></g>` +
        `<line class="c-cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}"/><circle class="c-hoverdot" r="5" style="fill:var(--accent)"/>` +
        `<rect class="c-overlay" x="${m.l - 6}" y="${m.t}" width="${pw + 12}" height="${ph}"/></svg><div class="chart-tip"></div>`;
      const svg = el.querySelector('svg'), tip = el.querySelector('.chart-tip');
      const cross = svg.querySelector('.c-cross'), dot = svg.querySelector('.c-hoverdot');
      svg.querySelector('.c-overlay').addEventListener('pointermove', (ev) => {
        const rect = svg.getBoundingClientRect();
        const i = Math.max(0, Math.min(n - 1, Math.round(((ev.clientX - rect.left - m.l) / pw) * (n - 1))));
        const [cx, cy] = pts[i];
        const farbe = neg && vals[i] < 0 ? 'var(--neg)' : 'var(--accent)';
        cross.setAttribute('x1', cx); cross.setAttribute('x2', cx);
        dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.style.fill = farbe;
        svg.classList.add('hovering');
        const d = o.data[i];
        // ◌ markiert erwartete Zahlungen – nur nötig, wenn es daneben Ist-Werte gibt
        const evs = (d.events || []).slice(0, 5).map((e) => ({ name: (e.prog && !nurProg ? '◌ ' : '') + e.text, value: o.fmtTip(e.betrag, true) }));
        const more = (d.events || []).length > 5 ? `+ ${d.events.length - 5} weitere` : '';
        tip.innerHTML = tipHTML(o.fmtDate(d.t) + (i > ti ? ' · Prognose' : i === ti ? ' · heute' : ''), [{ color: farbe, name: o.wertName || 'Wert', value: o.fmtTip(d.v) }, ...evs], more);
        placeTip(el, tip, cx, cy);
      });
      svg.querySelector('.c-overlay').addEventListener('pointerleave', () => { svg.classList.remove('hovering'); tip.classList.remove('show'); });
    });
  }

  /* ---------- Donut mit Liste ---------- */
  function donut(el, o) {
    const total = o.items.reduce((s, it) => s + it.value, 0) || 1;
    const R = 85, r = 58, c = 85;
    let a0 = -Math.PI / 2;
    const arc = (a1, a2) => {
      const large = a2 - a1 > Math.PI ? 1 : 0;
      const p = (rad, a) => `${(c + rad * Math.cos(a)).toFixed(2)},${(c + rad * Math.sin(a)).toFixed(2)}`;
      return `M${p(R, a1)}A${R},${R} 0 ${large} 1 ${p(R, a2)}L${p(r, a2)}A${r},${r} 0 ${large} 0 ${p(r, a1)}Z`;
    };
    const paths = o.items.map((it, i) => {
      const a1 = a0, a2 = a0 + (it.value / total) * Math.PI * 2 - (o.items.length > 1 ? 0.012 : 0);
      a0 += (it.value / total) * Math.PI * 2;
      return `<path d="${arc(a1, Math.max(a1 + 0.001, a2))}" data-i="${i}" style="fill:${it.color}"/>`;
    }).join('');
    el.innerHTML = `<div class="donut-wrap"><div class="donut"><svg width="170" height="170" viewBox="0 0 170 170">${paths}</svg>` +
      `<div class="donut-center"><div><b>${esc(o.center)}</b><small>${esc(o.centerSub || '')}</small></div></div></div>` +
      `<ul class="donut-list">${o.items.map((it, i) => `<li data-i="${i}"><i style="background:${it.color}"></i><span>${esc(it.name)}</span><b>${esc(o.fmt(it.value))}</b><small>${Math.round((it.value / total) * 100)} %</small></li>`).join('')}</ul></div>`;
    const dn = el.querySelector('.donut');
    const on = (i) => {
      dn.classList.toggle('hovering', i != null);
      el.querySelectorAll('[data-i]').forEach((x) => x.classList.toggle('on', x.dataset.i === String(i)));
      const center = el.querySelector('.donut-center b'), sub = el.querySelector('.donut-center small');
      if (i == null) { center.textContent = o.center; sub.textContent = o.centerSub || ''; }
      else { center.textContent = o.fmt(o.items[i].value); sub.textContent = o.items[i].name; }
    };
    el.querySelectorAll('[data-i]').forEach((x) => {
      x.addEventListener('pointerenter', () => on(+x.dataset.i));
      x.addEventListener('pointerleave', () => on(null));
    });
  }

  /* ---------- Sparkline (als String, für Tabellen und Kacheln) ---------- */
  function spark(values, color, w = 84, h = 26) {
    const v = values.filter((x) => x != null && isFinite(x));
    if (v.length < 2) return '';
    const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
    const pts = v.map((val, i) => [1 + (i / (v.length - 1)) * (w - 4), 2 + (h - 4) - ((val - min) / span) * (h - 4)]);
    const d = linePath(pts, false);
    const last = pts[pts.length - 1];
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">` +
      `<path d="${d}L${last[0]},${h}L${pts[0][0]},${h}Z" style="fill:${color};opacity:.12"/>` +
      `<path d="${d}" style="fill:none;stroke:${color};stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round"/>` +
      `<circle cx="${last[0]}" cy="${last[1]}" r="2.2" style="fill:${color}"/></svg>`;
  }

  function legend(series) {
    return `<div class="legend">${series.map((s) => `<span><i class="${s.dashed ? 'dash' : ''}" style="background:${s.color};color:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  }

  return { area, bars, lines, forecast, donut, spark, legend, niceTicks };
})();
