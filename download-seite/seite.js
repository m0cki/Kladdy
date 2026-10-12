/* Kladdy – Download-Seite
 *
 * Trag hier dein GitHub-Repository ein: 'Benutzername/Repository', z. B. 'maxmuster/kladdy'.
 * Solange hier noch DEIN-GITHUB-NAME steht, läuft die Seite im Beispielmodus:
 * Der Download-Knopf springt zur Installationsanleitung, „Was ist neu“ zeigt einen Beispiel-Eintrag
 * und unter dem Knopf erscheint ein dezenter Hinweis.
 */
const KONFIG = { github: 'DEIN-GITHUB-NAME/kladdy' };

(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const wenigBewegung = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ================= Hell / Dunkel ================= */
  // Gespeichert wird nur, wenn du den Umschalter benutzt (localStorage, kein Cookie).
  // Entspricht deine Wahl wieder der Systemeinstellung, wird der Eintrag gelöscht.
  const SCHLUESSEL = 'kladdy-darstellung'; // 'hell' | 'dunkel'
  const mqDunkel = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  const lesen = () => { try { return localStorage.getItem(SCHLUESSEL); } catch (e) { return null; } };
  const gueltig = (w) => (w === 'hell' || w === 'dunkel' ? w : null);
  // ?darstellung=hell|dunkel – zum Testen, wird nicht gespeichert
  let wahl = gueltig(new URLSearchParams(location.search).get('darstellung')) || gueltig(lesen());

  const system = () => (mqDunkel.matches ? 'dunkel' : 'hell');
  const wirksam = () => wahl || system();

  function darstellungAnwenden() {
    const root = document.documentElement;
    if (wahl) root.setAttribute('data-mode', wahl === 'dunkel' ? 'dark' : 'light');
    else root.removeAttribute('data-mode');
    // Screenshots: <source media="(prefers-color-scheme: dark)"> an die Wahl anpassen
    $$('source[data-dunkel]').forEach((s) => {
      s.media = wahl === 'dunkel' ? 'all' : wahl === 'hell' ? 'not all' : '(prefers-color-scheme: dark)';
    });
    const text = wirksam() === 'dunkel' ? 'Helle Darstellung' : 'Dunkle Darstellung';
    $$('[data-darstellung]').forEach((b) => { b.setAttribute('aria-label', text); b.title = text; });
  }

  $$('[data-darstellung]').forEach((b) => b.addEventListener('click', () => {
    const neu = wirksam() === 'dunkel' ? 'hell' : 'dunkel';
    wahl = neu === system() ? null : neu;
    try { if (wahl) localStorage.setItem(SCHLUESSEL, wahl); else localStorage.removeItem(SCHLUESSEL); } catch (e) { /* privat-Modus o. Ä. */ }
    darstellungAnwenden();
  }));
  if (mqDunkel.addEventListener) mqDunkel.addEventListener('change', darstellungAnwenden);
  else if (mqDunkel.addListener) mqDunkel.addListener(darstellungAnwenden);
  darstellungAnwenden();

  /* ================= Jahreszahl ================= */
  $$('[data-jahr]').forEach((e) => { e.textContent = String(new Date().getFullYear()); });

  /* ================= Platzhalter (Impressum/Datenschutz) ================= */
  const platzhalter = $$('.platzhalter');
  if (platzhalter.length) {
    const balken = el('div', 'platzhalter-balken');
    balken.setAttribute('role', 'status');
    balken.textContent = `Platzhalter vor dem Veröffentlichen ausfüllen – noch ${platzhalter.length} ${platzhalter.length === 1 ? 'Stelle ist' : 'Stellen sind'} gelb markiert.`;
    document.body.insertBefore(balken, document.body.firstChild);
  }
  // Startseite: dezenter Hinweis im Footer, solange impressum.html noch Platzhalter enthält.
  // (Geht nur auf einem Webserver – bei Doppelklick/file:// lässt der Browser das Nachladen nicht zu.)
  const impHinweis = $('[data-impressum-hinweis]');
  if (impHinweis && /^https?:$/.test(location.protocol) && window.fetch) {
    fetch('impressum.html', { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((t) => { if (t.indexOf('class="platzhalter"') !== -1) impHinweis.hidden = false; })
      .catch(() => {});
  }

  /* ================= Galerie-Reiter ================= */
  const reiter = $$('.galerie [role="tab"]');
  function reiterWaehlen(tab, fokus) {
    reiter.forEach((t) => {
      const an = t === tab;
      t.setAttribute('aria-selected', an ? 'true' : 'false');
      t.tabIndex = an ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) { panel.hidden = !an; panel.classList.toggle('aktiv', an); }
    });
    if (fokus) tab.focus();
  }
  reiter.forEach((t, i) => {
    t.addEventListener('click', () => reiterWaehlen(t, false));
    t.addEventListener('keydown', (ev) => {
      let ziel = null;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') ziel = reiter[(i + 1) % reiter.length];
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') ziel = reiter[(i - 1 + reiter.length) % reiter.length];
      else if (ev.key === 'Home') ziel = reiter[0];
      else if (ev.key === 'End') ziel = reiter[reiter.length - 1];
      if (ziel) { ev.preventDefault(); reiterWaehlen(ziel, true); }
    });
  });
  if (reiter.length) reiterWaehlen(reiter.find((t) => t.getAttribute('aria-selected') === 'true') || reiter[0], false);

  /* ================= Dezentes Einblenden ================= */
  const einblenden = $$('.einblenden');
  if (einblenden.length && 'IntersectionObserver' in window && !wenigBewegung()) {
    document.documentElement.classList.add('animiert');
    const io = new IntersectionObserver((eintraege) => {
      eintraege.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('sichtbar'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -40px 0px', threshold: 0.05 });
    einblenden.forEach((e) => io.observe(e));
  }

  /* ================= Download & Versionen (GitHub) ================= */
  const repo = String(KONFIG.github || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '');
  const beispielmodus = repo.indexOf('DEIN-GITHUB-NAME') !== -1 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
  const downloadLinks = $$('[data-download]');
  const metaZeile = $('[data-download-meta]');
  const relBox = $('[data-releases]');
  if (!downloadLinks.length && !relBox) return; // Unterseiten: kein Abruf

  if (beispielmodus) {
    $$('[data-beispiel]').forEach((e) => { e.hidden = false; });
    return; // Download-Knöpfe zeigen auf #installieren, „Was ist neu“ bleibt beim Beispiel
  }

  const REPO_URL = `https://github.com/${repo}`;
  downloadLinks.forEach((a) => { a.href = `${REPO_URL}/releases/latest`; });
  $$('[data-quellcode]').forEach((a) => { a.href = REPO_URL; });

  const DATUM = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const datum = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : DATUM.format(d); };
  const groesse = (bytes) => {
    const mb = (+bytes || 0) / 1e6; // wie der Finder: 1 MB = 1.000.000 Byte
    if (!mb) return '';
    return (mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10).toLocaleString('de-DE') + ' MB';
  };
  const githubUrl = (u) => (typeof u === 'string' && /^https:\/\/github\.com\//.test(u) ? u : null);
  const versionVon = (r) => String(r.tag_name || r.name || '').replace(/^v(?=\d)/i, '');

  function fussText(text, linkText) {
    const fuss = $('[data-releases-fuss]');
    if (!fuss) return;
    fuss.textContent = text ? text + ' ' : '';
    const a = el('a', null, linkText || 'Alle Versionen auf GitHub');
    a.href = `${REPO_URL}/releases`;
    fuss.appendChild(a);
  }

  // Release-Notizen (Markdown) minimal und sicher darstellen: nur Text-Knoten,
  // dazu „### Überschrift“, „- Liste“, Absätze sowie **fett** und `code`. Kein innerHTML.
  function inline(ziel, text) {
    text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [Text](Link) → Text
      .replace(/<(https?:\/\/[^>\s]+)>/g, '$1');        // <https://…> → https://…
    text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach((teil) => {
      if (!teil) return;
      if (/^\*\*[^*]+\*\*$/.test(teil)) ziel.appendChild(el('strong', null, teil.slice(2, -2)));
      else if (/^`[^`]+`$/.test(teil)) ziel.appendChild(el('code', null, teil.slice(1, -1)));
      else ziel.appendChild(document.createTextNode(teil));
    });
  }
  function notizen(md, ziel) {
    let liste = null, absatz = null;
    String(md || '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n').forEach((roh) => {
      const z = roh.trim();
      let m;
      if (!z) { liste = null; absatz = null; return; }
      if ((m = z.match(/^#{1,6}\s+(.+)$/))) { liste = null; absatz = null; const h = el('h4'); inline(h, m[1]); ziel.appendChild(h); return; }
      if ((m = z.match(/^[-*+]\s+(.+)$/))) {
        absatz = null;
        if (!liste) { liste = el('ul'); ziel.appendChild(liste); }
        const li = el('li'); inline(li, m[1]); liste.appendChild(li); return;
      }
      liste = null;
      if (!absatz) { absatz = el('p'); ziel.appendChild(absatz); } else absatz.appendChild(document.createTextNode(' '));
      inline(absatz, z);
    });
    if (!ziel.childNodes.length) ziel.appendChild(el('p', null, 'Keine Notizen zu dieser Version.'));
  }

  function releasesZeigen(liste) {
    if (!relBox) return;
    relBox.textContent = '';
    liste.forEach((r, i) => {
      const art = el('article', 'release karte');
      const kopf = el('div', 'release-kopf');
      kopf.appendChild(el('h3', null, 'Version ' + versionVon(r)));
      if (i === 0) kopf.appendChild(el('span', 'badge', 'Aktuell'));
      if (r.published_at) {
        const t = el('time', null, datum(r.published_at));
        t.dateTime = r.published_at;
        kopf.appendChild(t);
      }
      art.appendChild(kopf);
      const text = el('div', 'release-text');
      notizen(r.body, text);
      art.appendChild(text);
      relBox.appendChild(art);
    });
    const fuss = el('p', 'releases-fuss');
    fuss.setAttribute('data-releases-fuss', '');
    relBox.appendChild(fuss);
    fussText('');
  }

  function downloadSetzen(rel) {
    const dmgs = (rel.assets || []).filter((a) => a && /\.dmg$/i.test(a.name || '') && githubUrl(a.browser_download_url));
    const dmg = dmgs.find((a) => /universal/i.test(a.name)) || dmgs.find((a) => /aarch64|arm64/i.test(a.name)) || dmgs[0];
    const teile = ['Version ' + versionVon(rel)];
    if (dmg) {
      downloadLinks.forEach((a) => { a.href = dmg.browser_download_url; a.setAttribute('data-direkt', ''); });
      const g = groesse(dmg.size);
      if (g) teile.push(g);
    }
    if (rel.published_at) teile[0] += ' vom ' + datum(rel.published_at);
    teile.push('macOS 14 oder neuer');
    if (dmg && /universal/i.test(dmg.name)) teile.push('auch für Intel-Macs');
    if (metaZeile) metaZeile.textContent = teile.join(' · ');
  }

  // Direkter .dmg-Download: danach zur Anleitung scrollen
  const status = $('[data-download-status]');
  downloadLinks.forEach((a) => a.addEventListener('click', (ev) => {
    if (!a.hasAttribute('data-direkt') || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
    setTimeout(() => {
      if (status) { status.textContent = 'Der Download läuft – so geht es weiter:'; status.hidden = false; }
      const ziel = document.getElementById('installieren');
      if (ziel) ziel.scrollIntoView({ behavior: wenigBewegung() ? 'auto' : 'smooth', block: 'start' });
    }, 350);
  }));

  if (!window.fetch) return;
  const abbruch = window.AbortController ? new AbortController() : null;
  const timer = setTimeout(() => { if (abbruch) abbruch.abort(); }, 5000);
  fetch(`https://api.github.com/repos/${repo}/releases?per_page=3`, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: abbruch ? abbruch.signal : undefined
  })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then((daten) => {
      clearTimeout(timer);
      const liste = (Array.isArray(daten) ? daten : []).filter((r) => r && !r.draft && !r.prerelease);
      if (!liste.length) { fussText('Noch keine Version veröffentlicht.', 'Zu GitHub'); return; }
      downloadSetzen(liste[0]);
      releasesZeigen(liste);
    })
    .catch(() => {
      clearTimeout(timer);
      // offline, Zeitüberschreitung oder Limit der GitHub-API: Beispiel bleiben lassen, Link anbieten
      fussText('Die Versionshinweise konnten gerade nicht geladen werden.');
    });
})();
