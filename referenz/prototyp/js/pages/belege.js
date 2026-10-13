/* Kladdy – Prototyp · Rechnungen & Quittungen (dazu Angebote und Eigenbelege)
 * Zwei Seiten: „rechnungen“ (schlanke Liste nach laufender Nummer mit Reitern – „Offen“ = offene Posten –, Suche,
 * Knopf „Vorlagen“ und kleinem „Neu“-Menü) und „beleg“ (Eingabemaske mit Live-Papiervorschau, Pflichtangaben-Check,
 * Finalisieren, Druck/PDF). Summen und Statistiken stehen in der Auswertung, nicht hier.
 * Quittungen und Rechnungen entstehen über „+ Erfassen“ (App.erfassen → Einnahme → „Beleg zur Einnahme“); die Schublade
 * springt für Details hierher: #/beleg/neu?art=…&betrag=…&datum=…&text=…&kontakt=…|kunde=…&buchung=…&vorlage=…
 * (optional &bezahlt=1 für eine schon bezahlte Rechnung, &zahlungsart=bar|bank|paypal).
 * Kunden: Belege verweisen auf den Kunden (kontakt) und tragen ab dem Festschreiben Name/Anschrift/Kunden-Nr. als
 * Schnappschuss (kunde/kundeAdresse/kundeNr) – GoBD: Änderungen auf der Kundenseite verändern ausgestellte Belege nicht.
 * Nur Entwürfe von Rechnung/Angebot lesen live aus dem Kunden. Neue Namen werden beim Festschreiben als Kunde angelegt.
 * Der Empfänger eines Eigenbelegs ist kein Kunde (Freitext → b.lieferant der Ausgabe).
 * Das Papierblatt wird aus Bausteinen gebaut (Vorlagen-Baukasten) und ist reines HTML/CSS in mm:
 * Rechnung/Angebot A4 hoch, Quittung/Eigenbeleg A5 quer. Gedruckt wird 1:1 über #printArea.
 *
 * Für andere Seiten (Vorlagen) – doc ist ein rechnungsartiges Objekt wie in DATA.rechnungen:
 *   App.sheet.BLOCKS · STANDARD[art] · PLATZHALTER · vorlage(art, id?) · platzhalter(text, ctx)
 *   App.sheet.html(doc, { bloecke, qr, entwurf, beispiel, editable, firma, kontakt, accent }) → HTML des Blatts
 *   App.sheet.pflichtCheck(doc, bloecke) → [{ label, ok, hint, offen }]
 *   App.sheet.print(doc, opts) · preparePrint(doc, opts) → restore()  (ohne Druckdialog, z. B. für Tests)
 *   App.sheet.mount(host, doc, { fit: 'width' | 'page', maxHeight, onFit }) → { update, fit, setFit, destroy }
 *   App.sheet.wortBetrag(cent) · format(doc) → 'a4' | 'a5q' · girocode(doc, firma) · nextNr(art, datum)
 */
(() => {
  'use strict';
  const D = window.DATA, U = D.util;
  const { $, $$, esc, icon, fmt } = App;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const euro = (cent) => fmt.eur(cent);
  const nl = (s) => esc(s).replace(/\n/g, '<br>');
  const mengeNF = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });
  const menge = (m) => mengeNF.format(+m || 0);
  const geld = (cent) => (cent ? App.num(cent / 100, 2) : '');
  const datumWT = (iso) => (iso ? new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(U.parse(iso)) : '—');
  const ibanFmt = (s) => (window.QR ? QR.ibanFormat(s) : String(s || '').replace(/(.{4})(?=.)/g, '$1 '));
  const kbd = (k) => (App.isMac ? '⌘' : 'Strg+') + k;

  /* ================= Belegarten, Texte, Hilfen ================= */
  const ART = {
    quittung: { label: 'Quittung', mehr: 'Quittungen', icon: 'receipt', prefix: 'QU', neu: 'Neue Quittung', format: 'a5q', nrLabel: 'Quittungs-Nr.' },
    rechnung: { label: 'Rechnung', mehr: 'Rechnungen', icon: 'invoice', prefix: 'RE', neu: 'Neue Rechnung', format: 'a4', nrLabel: 'Rechnungs-Nr.' },
    angebot: { label: 'Angebot', mehr: 'Angebote', icon: 'file', prefix: 'AN', neu: 'Neues Angebot', format: 'a4', nrLabel: 'Angebots-Nr.' },
    eigenbeleg: { label: 'Eigenbeleg', mehr: 'Eigenbelege', icon: 'stamp', prefix: 'EB', neu: 'Neuer Eigenbeleg', format: 'a5q', nrLabel: 'Beleg-Nr.' }
  };
  const ARTEN = ['quittung', 'rechnung', 'angebot', 'eigenbeleg'];
  const ALLE = ARTEN.slice();
  const ART_TIPP = 'Quittung: bestätigt, dass bezahlt wurde – meist bar oder per PayPal direkt vor Ort; bei dir enthält sie zugleich alle Rechnungsangaben. Rechnung: fordert zur Zahlung auf, mit Zahlungsziel – der Kunde zahlt später per Überweisung (GiroCode). Eine Rechnung brauchst du, wenn eine Firma beauftragt oder ein Privatkunde die Arbeitskosten nach § 35a EStG absetzen will: dafür sind Rechnung und unbare Zahlung auf dein Konto nötig (Überweisung oder Karte), Barzahlung zählt nicht. Was beim Erfassen vorausgewählt ist, legst du in den Einstellungen fest.';
  const HINWEIS19 = 'Umsatzsteuerfrei aufgrund der Kleinunternehmerregelung gemäß § 19 UStG.';
  const HINWEIS14B = 'Hinweis für Privatkunden: Bitte bewahren Sie diesen Beleg zwei Jahre auf (§ 14b UStG).';
  /* Informationspflicht (Art. 13 DSGVO) in Kurzform – optionaler Baustein, nicht in den Standardvorlagen */
  const DATENSCHUTZ = 'Datenschutz: Ihre Angaben (Name, Anschrift, ggf. Telefon/E-Mail) verwende ich nur für diesen Auftrag und bewahre sie wegen der gesetzlichen Aufbewahrungspflichten auf (Art. 6 Abs. 1 lit. b und c DSGVO). Sie haben das Recht auf Auskunft, Berichtigung und – nach Ablauf der Fristen – Löschung. Fragen gern an {email}.';
  const TEXTE = {
    rechnung: { einleitung: 'vielen Dank für Ihren Auftrag. Ich berechne Ihnen folgende Leistungen:', schluss: HINWEIS14B },
    quittung: { einleitung: '', schluss: HINWEIS14B }, // auf der Quittung (A5 quer) als kleiner grauer Fußhinweis
    angebot: { einleitung: 'vielen Dank für Ihre Anfrage. Gerne biete ich Ihnen an:', schluss: 'Ich freue mich auf Ihren Auftrag.' }
  };
  /* Standardtext eines Belegs. GoBD: Alte ausgestellte Belege (ohne eingefrorenes Layout `bloecke`, z. B. Demo-Daten)
   * ohne eigenen Schlusstext behalten den Standard von damals (leer), damit ein Nachdruck genauso aussieht wie das Original.
   * Alles, was diese Version ausstellt, friert das Layout ein (Maske und „+ Erfassen“) und bekommt den heutigen Standard (§ 14b);
   * einfrieren() hält bei alten Belegen die Texte fest, bevor es das Layout einfriert. */
  const SCHLUSS_ALT = { rechnung: '', quittung: '' };
  function standardText(doc, key) {
    const T = TEXTE[doc && doc.art]; if (!T) return '';
    if (key === 'schluss' && doc.art in SCHLUSS_ALT && ausgestellt(doc) && !Array.isArray(doc.bloecke)) return SCHLUSS_ALT[doc.art];
    return T[key];
  }
  const GRUENDE = [['verloren', 'Beleg verloren'], ['kein', 'Kein Beleg erhältlich (z. B. Parkautomat, Trinkgeld)'], ['unleserlich', 'Beleg unleserlich'], ['sonstiges', 'Sonstiges']];
  const EINHEITEN = ['Stk.', 'Std.', 'pausch.', 'm', 'm²', 'lfm', 'km', 'Tag', 'Satz'];
  /* Zahlungsweg (nur Info, kein Konto): Bar · Überweisung (auch Karte) · PayPal – aus DATA.ZAHLUNGSARTEN */
  const zaName = (id, std = 'bar') => D.zahlungsart(id || std).name;
  const zaGueltig = (id) => D.ZAHLUNGSARTEN.some((z) => z.id === id);
  const zahlungswege = () => D.ZAHLUNGSARTEN.map((z) => [z.id, icon(z.icon) + esc(z.kurz)]);
  const summe = (r) => (r && Array.isArray(r.positionen) ? D.rechnungSumme(r) : 0);
  /* Kategorien nie fest verdrahten: Einnahme-Kategorie für Belege, Standard für Eigenbelege */
  const ausgabeKats = () => D.KATEGORIEN.filter((k) => k.typ === 'ausgabe');
  const einnahmeKat = () => (D.KATEGORIEN.find((k) => k.id === 'dienstleistung') || D.KATEGORIEN.find((k) => k.typ === 'einnahme' && k.ku) || D.KATEGORIEN.find((k) => k.typ === 'einnahme') || {}).id;
  const ausgabeStd = () => (ausgabeKats().find((k) => /sonst/.test(k.id)) || ausgabeKats()[ausgabeKats().length - 1] || {}).id;
  const kleinbetrag = (doc) => ((D.PARAMS && D.PARAMS[+(doc.datum || D.TODAY).slice(0, 4)] || {}).kleinbetrag || 250) * 100;

  /* Zahlen aus deutscher Eingabe („1.280,50“, „4,5“, „1280.5“) */
  function parseZahl(s) {
    s = String(s ?? '').replace(/[€\s]/g, '').replace('−', '-');
    if (!s) return 0;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const v = Number(s);
    return isFinite(v) ? v : NaN;
  }
  const parseCent = (s) => { const v = parseZahl(s); return isFinite(v) ? Math.round(v * 100) : NaN; };

  /* Nächste fortlaufende Nummer je Art und Jahr (nie wiederverwenden) */
  function nextNr(art, datum = D.TODAY) {
    if (typeof D.naechsteNr === 'function') return D.naechsteNr(ART[art] ? art : 'rechnung', +(datum || D.TODAY).slice(0, 4));
    const p = `${(ART[art] || ART.rechnung).prefix}-${(datum || D.TODAY).slice(0, 4)}-`;
    const max = D.rechnungen.reduce((m, r) => (r.nr && r.nr.startsWith(p) ? Math.max(m, +r.nr.slice(p.length) || 0) : m), 0);
    return p + String(max + 1).padStart(3, '0');
  }

  /* Termine (DATA.TERMINE, Seite #/termine): Zu einem Termin kann eine Quittung/Rechnung vorbereitet werden – ein Entwurf
   * ohne Nummer mit r.termin. Nummer und Buchung entstehen erst beim Ausstellen; eine Absage verwirft den Entwurf (kein Storno). */
  const terminVon = (r) => (r && r.termin && Array.isArray(D.TERMINE) ? D.TERMINE.find((t) => t.id === r.termin) || null : null);
  const vorbereitet = (r) => !!(r && r.status === 'entwurf' && r.termin);
  const wochentag = (iso) => new Intl.DateTimeFormat('de-DE', { weekday: 'short' }).format(U.parse(iso)).replace('.', '');
  const terminText = (t, lang = true) => (t ? `${lang ? wochentag(t.datum) + ', ' : ''}${fmt.datumKurz(t.datum)}${t.von ? ` · ${t.von}${lang && t.bis ? '–' + t.bis : ''}` : ''}` : '');

  /* Status inkl. „überfällig“, „vorbereitet“ und Sonderfälle je Art */
  function statusKey(r) {
    if (vorbereitet(r)) return 'vorbereitet';
    if (r.status === 'offen' && r.art === 'rechnung' && r.faellig && r.faellig < D.TODAY) return 'ueberfaellig';
    return r.status;
  }
  const STATUS = { entwurf: 'Entwurf', vorbereitet: 'Vorbereitet', offen: 'Offen', ueberfaellig: 'Überfällig', bezahlt: 'Bezahlt', storniert: 'Storniert', abgelehnt: 'Abgelehnt' };
  function statusBadge(r) {
    const s = statusKey(r);
    // angenommen = in eine Rechnung umgewandelt (auch wenn es vorher als abgelehnt markiert war)
    if (r.art === 'angebot' && r.umgewandelt && s !== 'storniert') return '<span class="badge bezahlt">Angenommen</span>';
    if (r.art === 'angebot' && s === 'offen' && r.faellig && r.faellig < D.TODAY) return '<span class="badge entwurf">Abgelaufen</span>';
    if (r.art === 'eigenbeleg' && s === 'bezahlt') return '<span class="badge bezahlt">Gebucht</span>';
    return `<span class="badge ${s}">${STATUS[s] || esc(s)}</span>`;
  }

  /* Kunde (D.KONTAKTE enthält nur Kunden) / freier Empfänger → { k, name, anzeige, zeilen[], nr } */
  function kundenNr(k) {
    if (!k) return '';
    return D.kundenNr(k); // feste Nummer aus data.js (verschiebt sich nicht beim Löschen)
  }
  const adresseText = (k) => (k ? [k.zusatz, k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter((s) => s && String(s).trim()).join('\n') : '');
  /* Empfänger eines Belegs. GoBD: Ausgestellte Belege (mit Nummer, kein Entwurf) zeigen und drucken immer ihren
   * Schnappschuss (kunde/kundeAdresse/kundeNr) – spätere Änderungen am Kunden verändern sie nicht. Alte Belege ohne
   * Schnappschuss fallen auf den Kunden zurück (und werden beim Öffnen eingefroren, siehe einfrieren).
   * Entwürfe von Rechnung/Angebot lesen live aus dem Kunden; Quittung/Eigenbeleg bearbeiten den Schnappschuss direkt. */
  const ausgestellt = (doc) => !!(doc && doc.nr && doc.status !== 'entwurf');
  function empfaenger(doc, kontakt = null) {
    const k = kontakt || (doc.kontakt ? D.kontakt(doc.kontakt) : null) || null;
    const snap = String(doc.kunde || '').trim(), fest = ausgestellt(doc);
    const live = (doc.art === 'rechnung' || doc.art === 'angebot') && !fest;
    if (k && (live || !snap)) {
      const zeilen = adresseText(k).split('\n').filter(Boolean);
      return { k, name: k.name || '', anzeige: k.name || '', zeilen, nr: (fest && doc.kundeNr) || kundenNr(k), email: k.email || '' };
    }
    const zeilen = String(doc.kundeAdresse || '').split('\n').map((s) => s.trim()).filter(Boolean);
    return { k, name: snap, anzeige: snap || (doc.art === 'quittung' ? 'Barverkauf' : ''), zeilen, nr: (fest && doc.kundeNr) || kundenNr(k), email: k ? k.email || '' : '' };
  }
  /* Schnappschuss des Kunden in den Beleg schreiben (Name, Anschrift, Kunden-Nr.) */
  function schnappschuss(r, k) {
    if (!k) return;
    r.kunde = k.name; r.kundeAdresse = adresseText(k); r.kundeNr = kundenNr(k);
  }
  /* Alte ausgestellte Belege ohne Schnappschuss einfrieren → true, wenn geändert. Der Kunde wird schon beim Laden
   * eingefroren (siehe unten), damit eine spätere Änderung oder Löschung des Kunden ausgestellte Belege nie erreicht. */
  function kundeEinfrieren(r) {
    if (!ausgestellt(r) || r.art === 'eigenbeleg' || !r.kontakt) return false;
    const k = D.kontakt(r.kontakt); if (!k) return false;
    if (!String(r.kunde || '').trim()) { schnappschuss(r, k); return true; }
    if (!r.kundeNr) { r.kundeNr = kundenNr(k); return true; }
    return false;
  }
  /* … dazu das Layout: Belege ohne eingefrorene Bausteine (Demo-Daten, ausgestellt über „+ Erfassen“) bekommen die Vorlage,
   * mit der sie bisher gedruckt wurden – beim Öffnen/Drucken und vor jeder Vorlagenänderung (vorlagen.js → einfrierenAlle). */
  /* Eigenbeleg ohne eingefrorenes „Gebucht als …“ (vor dieser Version ausgestellt): Stand der Ausgabe jetzt festhalten */
  function gebuchtEinfrieren(r) {
    if (!ausgestellt(r) || r.art !== 'eigenbeleg' || r.gebucht || r.status === 'storniert') return false;
    const b = D.buchungen.find((x) => x.id === r.buchung) || D.buchungen.find((x) => x.rechnung === r.id);
    if (!b) return false;
    r.gebucht = { nr: b.nr, kat: (D.kat(b.kat) || {}).name || '' };
    return true;
  }
  function einfrieren(r) {
    let k = kundeEinfrieren(r) | gebuchtEinfrieren(r);
    if (!ausgestellt(r)) return !!k;
    // Firmenlogo, mit dem der Beleg ausgestellt wurde ('' = keins) – core.js friert vor jedem Logowechsel alle ein
    if (r.logoId === undefined) { r.logoId = D.FIRMA.logoId || ''; k = 1; }
    // Texte festhalten (alte Belege: die von damals – deshalb vor dem Layout; „+ Erfassen“ friert nur das Layout ein)
    if (TEXTE[r.art]) ['einleitung', 'schluss'].forEach((key) => { if (r[key] == null) { r[key] = standardText(r, key); k = 1; } });
    if (Array.isArray(r.bloecke)) return !!k;
    r.bloecke = clone(layoutVon(r));
    return true;
  }
  const einfrierenAlle = () => D.rechnungen.reduce((n, r) => n + (einfrieren(r) ? 1 : 0), 0);
  const kundeName = (r) => empfaenger(r).anzeige;
  /* Kunde aus einer Eingabe („Name“ oder „Name · K-0012“) – nur eindeutig (Nummer oder einziger Treffer), nie still der erste
   * von mehreren gleichnamigen Kunden (App.kundeAusEingabe, core.js) */
  const findeKontakt = (text) => (String(text || '').trim() ? App.kundeAusEingabe(text).k || null : null);
  /* „zuletzt 03/2025“ – letzter ausgestellter Beleg des Kunden (zum Unterscheiden gleichnamiger Kunden) */
  function zuletzt(k) {
    const d = D.rechnungen.reduce((m, r) => (r.kontakt === k.id && r.nr && r.status !== 'storniert' && r.datum > m ? r.datum : m), '');
    return d ? `zuletzt ${d.slice(5, 7)}/${d.slice(0, 4)}` : 'noch keine Belege';
  }
  /* Neuen Kunden aus Name + freier Anschrift anlegen (vollständiger Datensatz wie in DATA.KONTAKTE) */
  function kundeAnlegen(name, adresse) {
    const k = { id: 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), art: 'kunde', name: String(name).trim(), ...parseAdresse(adresse), email: '', telefon: '', notiz: '' };
    D.KONTAKTE.push(k);
    return k;
  }
  /* Freie Anschrift („z. Hd. …\nStraße 1\n12345 Ort“) → Felder des Kunden */
  function parseAdresse(text) {
    const z = String(text || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const out = { zusatz: '', strasse: '', plz: '', ort: '' };
    const last = z.length ? /^(\d{4,5})\s+(.+)$/.exec(z[z.length - 1]) : null;
    if (last) { out.plz = last[1]; out.ort = last[2]; z.pop(); }
    if (z.length) out.strasse = z.pop();
    out.zusatz = z.join(', ');
    return out;
  }
  function leistungText(doc) {
    const a = doc.leistung, b = doc.leistungBis;
    if (!a) return '';
    if (!b || b === a) return fmt.datum(a);
    return a.slice(0, 4) === b.slice(0, 4) ? `${fmt.datumKurz(a)}–${fmt.datum(b)}` : `${fmt.datum(a)}–${fmt.datum(b)}`;
  }
  function faelligSetzen(d) {
    if (d.art === 'rechnung' || d.art === 'angebot') { if (d.datum) d.faellig = U.addDays(d.datum, Math.max(0, +d.ziel || 0)); }
    else d.faellig = d.datum;
  }

  /* ================= Betrag in Worten =================
   * 0 … 999.999.999 Euro; „ein Euro“, „einhunderteins Euro“, „eintausend“, „eine Million“ */
  const EINS = ['', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
  const ZEHN = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
  const u100 = (n) => (n < 20 ? EINS[n] : (n % 10 ? EINS[n % 10] + 'und' : '') + ZEHN[Math.floor(n / 10)]);
  const u1000 = (n) => (n >= 100 ? EINS[Math.floor(n / 100)] + 'hundert' : '') + u100(n % 100);
  function zahlWort(n, vorNomen = false) {
    if (n === 0) return 'null';
    const mio = Math.floor(n / 1e6), tsd = Math.floor(n / 1000) % 1000, rest = n % 1000;
    const teile = [];
    if (mio) teile.push(mio === 1 ? 'eine Million' : u1000(mio).replace(/ein$/, 'eine') + ' Millionen');
    let s = (tsd ? u1000(tsd) + 'tausend' : '') + u1000(rest);
    if (rest % 100 === 1 && !(vorNomen && n === 1)) s = s.replace(/ein$/, 'eins');
    if (s) teile.push(s);
    return teile.join(' ');
  }
  function wortBetrag(cent) {
    cent = Math.round(Math.abs(+cent || 0));
    const e = Math.floor(cent / 100), c = cent % 100;
    if (e > 999999999) return fmt.eur(cent);
    if (!e && c) return `${zahlWort(c, true)} Cent`;
    return `${zahlWort(e, true)} Euro${c ? ` und ${zahlWort(c, true)} Cent` : ''}`;
  }

  /* ================= GiroCode (EPC-QR) ================= */
  function epcFor(doc, F = D.FIRMA) {
    if (!window.QR) return { ok: false, fehlend: true, fehler: ['QR-Modul (js/qr.js) nicht geladen'] };
    return QR.epc({ name: F.name, iban: F.iban, bic: F.bic, betrag: summe(doc) / 100, zweck: doc.nr || 'Entwurf' });
  }
  function girocode(doc, F = D.FIRMA) {
    const r = epcFor(doc, F);
    if (!r.ok) return r;
    try { return { ...r, svg: QR.toSVG(r.payload, { ecl: 'M', margin: 0, dark: '#111111' }) }; } catch (err) { return { ok: false, fehler: [err.message] }; }
  }

  /* ================= Platzhalter ================= */
  const PLATZHALTER = [
    ['{kunde}', 'Name des Kunden / Empfängers'], ['{nr}', 'Belegnummer'], ['{art}', 'Belegart (Rechnung, Quittung …)'],
    ['{datum}', 'Belegdatum'], ['{leistungsdatum}', 'Leistungsdatum oder -zeitraum'], ['{faellig}', 'Fällig am / gültig bis'],
    ['{summe}', 'Gesamtbetrag'], ['{betrag_worte}', 'Betrag in Worten'], ['{betreff}', 'Betreff des Belegs'],
    ['{einleitung}', 'Einleitungstext aus der Maske'], ['{schlusstext}', 'Schlusstext aus der Maske'], ['{zahlungsziel}', 'Zahlungsziel in Tagen'],
    ['{firma}', 'Firmenname'], ['{inhaber}', 'Inhaber'], ['{strasse}', 'Straße (Firma)'], ['{plz}', 'PLZ (Firma)'], ['{ort}', 'Ort (Firma)'],
    ['{steuernummer}', 'Steuernummer'], ['{telefon}', 'Telefon'], ['{email}', 'E-Mail'], ['{web}', 'Website'],
    ['{bank}', 'Bank'], ['{iban}', 'IBAN'], ['{bic}', 'BIC']
  ];
  function phWerte(x) {
    const { doc, firma: F, empf: e } = x;
    return {
      kunde: e.anzeige, nr: doc.nr || '', art: x.A.label, datum: doc.datum ? fmt.datum(doc.datum) : '', leistungsdatum: leistungText(doc),
      faellig: doc.faellig ? fmt.datum(doc.faellig) : '', summe: euro(x.summe), betrag_worte: wortBetrag(x.summe), betreff: doc.betreff || '',
      // ältere/importierte Belege ohne eigene Texte bekommen die Standardtexte der Art
      einleitung: doc.einleitung ?? standardText(doc, 'einleitung'), schlusstext: doc.schluss ?? standardText(doc, 'schluss'),
      zahlungsziel: doc.ziel != null ? String(doc.ziel) : doc.faellig && doc.datum ? String(Math.max(0, U.diffDays(doc.datum, doc.faellig))) : '',
      firma: F.name, inhaber: F.inhaber, strasse: F.strasse, plz: F.plz, ort: F.ort, steuernummer: F.steuernummer,
      telefon: F.telefon, email: F.email, web: F.web, bank: F.bank, iban: ibanFmt(F.iban), bic: F.bic
    };
  }
  /* Ersetzt {platzhalter}, maskiert HTML, '\n' → <br>; fehlende Nummer → grau „Entwurf“ */
  function platzhalter(text, x) {
    const W = x ? phWerte(x) : {};
    let out = '';
    String(text ?? '').split(/(\{\w+\})/).forEach((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (m && m[1] in W) {
        const v = W[m[1]];
        out += v == null || v === '' ? (m[1] === 'nr' ? '<span class="blk-leer">Entwurf</span>' : '') : esc(v);
      } else out += esc(part);
    });
    return out.replace(/[ \t]+\n/g, '\n').replace(/^\n+|\n+$/g, '').replace(/\n/g, '<br>');
  }

  /* ================= Bausteine =================
   * render(cfg, ctx) liefert das Innere eines Abschnitts (ohne Hülle); leerer String = nichts drucken.
   * ctx = { doc, art, A, firma, kontakt, empf, summe, qr, entwurf, storno, format } */
  const SEL_GROESSE = [['normal', 'Normal'], ['klein', 'Klein'], ['grau', 'Klein, grau']];
  const BLOCKS = {
    kopf: {
      name: 'Kopf mit Logo', icon: 'file', desc: 'Firmenname in Akzentfarbe, Untertitel und Logo', arten: ALLE,
      felder: [
        { key: 'logo', label: 'Logo anzeigen', typ: 'toggle', default: true },
        { key: 'claim', label: 'Untertitel', typ: 'text', default: '{inhaber}' }
      ],
      render(c, x) {
        const F = x.firma;
        const logo = c.logo === false ? '' : F.logo ? `<img src="${esc(F.logo)}" alt="">` : '<span class="blk-logo-slot">Logo</span>';
        return `<div class="blk-kopf-l"><div class="blk-firma">${esc(F.name)}</div>${c.claim ? `<div class="blk-claim">${platzhalter(c.claim, x)}</div>` : ''}</div>${logo ? `<div class="blk-logo">${logo}</div>` : ''}`;
      }
    },
    absenderzeile: {
      name: 'Absenderzeile', icon: 'send', desc: 'Kleine Zeile mit Firma und Anschrift (über dem Empfänger)', arten: ALLE,
      felder: [
        { key: 'text', label: 'Text', typ: 'text', default: '{firma} · {strasse} · {plz} {ort}' },
        { key: 'linie', label: 'Unterstrichen (Fensterumschlag)', typ: 'toggle', default: true }
      ],
      render: (c, x) => { const h = platzhalter(c.text, x); return h ? `<div class="blk-absender${c.linie === false ? '' : ' linie'}">${h}</div>` : ''; }
    },
    anschrift_meta: {
      name: 'Anschrift & Belegdaten', icon: 'users', desc: 'Empfänger links, Nummer, Datum usw. rechts', arten: ALLE,
      felder: [
        { key: 'nr', label: 'Belegnummer', typ: 'toggle', default: true },
        { key: 'datum', label: 'Datum', typ: 'toggle', default: true },
        { key: 'leistung', label: 'Leistungsdatum', typ: 'toggle', default: true },
        { key: 'kundennr', label: 'Kunden-Nr.', typ: 'toggle', default: true },
        { key: 'faellig', label: 'Fälligkeit / gültig bis', typ: 'toggle', default: false }
      ],
      render(c, x) {
        const { doc, empf: e, A } = x, rows = [];
        if (c.nr) rows.push([A.nrLabel, doc.nr ? `<b>${esc(doc.nr)}</b>` : '<span class="blk-leer">Entwurf</span>']);
        if (c.datum) rows.push(['Datum', fmt.datum(doc.datum)]);
        if (c.leistung && x.art !== 'angebot' && doc.leistung) rows.push([doc.leistungBis && doc.leistungBis !== doc.leistung ? 'Leistungszeitraum' : 'Leistungsdatum', esc(leistungText(doc))]);
        if (c.kundennr && e.nr) rows.push(['Kunden-Nr.', esc(e.nr)]);
        if (c.faellig && doc.faellig) rows.push([x.art === 'angebot' ? 'Gültig bis' : 'Fällig am', fmt.datum(doc.faellig)]);
        const zeilen = [e.anzeige, ...e.zeilen].filter(Boolean);
        const adr = zeilen.length ? zeilen.map((l) => `<div>${esc(l)}</div>`).join('') : '<div class="blk-leer">Empfänger</div>';
        return `<div class="blk-adr">${adr}</div>${rows.length ? `<table class="blk-meta">${rows.map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join('')}</table>` : ''}`;
      }
    },
    titel: {
      name: 'Titel', icon: 'edit', desc: 'Große Überschrift, z. B. „Rechnung RE-2026-013“', arten: ALLE,
      felder: [
        { key: 'text', label: 'Text', typ: 'text', default: '{art} {nr}' },
        { key: 'rechts', label: 'Text rechts (optional)', typ: 'text', default: '' },
        { key: 'stil', label: 'Farbe', typ: 'select', default: 'schwarz', optionen: [['schwarz', 'Schwarz'], ['akzent', 'Akzentfarbe']] },
        { key: 'linie', label: 'Linie in Akzentfarbe darunter', typ: 'toggle', default: false }
      ],
      render: (c, x) => `<div class="blk-titel-row${c.stil === 'akzent' ? ' akzent' : ''}"><h1>${platzhalter(c.text, x)}</h1>${c.rechts ? `<div class="blk-titel-r">${platzhalter(c.rechts, x)}</div>` : ''}</div>${c.linie ? '<div class="blk-akzentlinie"></div>' : ''}`
    },
    betreff: {
      name: 'Betreff', icon: 'edit', desc: 'Betreffzeile in Fett', arten: ALLE,
      felder: [{ key: 'text', label: 'Text', typ: 'text', default: '{betreff}' }],
      render: (c, x) => { const h = platzhalter(c.text, x); return h ? `<p class="blk-betreff">${h}</p>` : ''; }
    },
    text: {
      name: 'Freitext', icon: 'list', desc: 'Beliebiger Text mit Platzhaltern', arten: ALLE,
      felder: [
        { key: 'text', label: 'Text', typ: 'textarea', default: '' },
        { key: 'groesse', label: 'Schrift', typ: 'select', default: 'normal', optionen: SEL_GROESSE }
      ],
      render: (c, x) => { const h = platzhalter(c.text, x); return h ? `<p class="blk-text ${esc(c.groesse || 'normal')}">${h}</p>` : ''; }
    },
    datenschutz: {
      name: 'Datenschutzhinweis', icon: 'lock', desc: 'Kurz: wofür du die Kundendaten speicherst (DSGVO)', arten: ['rechnung', 'quittung', 'angebot'],
      felder: [{ key: 'text', label: 'Text', typ: 'textarea', default: DATENSCHUTZ }],
      render: (c, x) => { const h = platzhalter(c.text, x); return h ? `<p class="blk-text grau blk-ds">${h}</p>` : ''; }
    },
    positionen: {
      name: 'Positionen', icon: 'list', desc: 'Tabelle der Leistungen mit Menge und Preis', arten: ALLE,
      felder: [
        { key: 'pos', label: 'Spalte „Pos.“', typ: 'toggle', default: true },
        { key: 'einheit', label: 'Einheit hinter der Menge', typ: 'toggle', default: true },
        { key: 'einzelpreis', label: 'Spalte „Einzelpreis“', typ: 'toggle', default: true }
      ],
      render(c, x) {
        const pos = x.doc.positionen || [];
        const cols = [c.pos && ['Pos.', 'r p'], ['Beschreibung', 'l'], ['Menge', 'r'], c.einzelpreis && ['Einzelpreis', 'r'], ['Gesamt', 'r']].filter(Boolean);
        const rows = pos.map((p, i) => `<tr>${c.pos ? `<td class="r p">${i + 1}</td>` : ''}<td class="l">${nl(p.text)}</td><td class="r">${menge(p.menge)}${c.einheit !== false && p.einheit ? '&nbsp;' + esc(p.einheit) : ''}</td>${c.einzelpreis ? `<td class="r">${euro(p.preis)}</td>` : ''}<td class="r">${euro(Math.round(p.menge * p.preis))}</td></tr>`).join('');
        return `<table class="blk-pos"><thead><tr>${cols.map(([l, k]) => `<th class="${k}">${l}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td class="l blk-leer" colspan="${cols.length}">Noch keine Positionen</td></tr>`}</tbody></table>`;
      }
    },
    summe: {
      name: 'Gesamtbetrag', icon: 'sigma', desc: 'Summenzeile, Betrag in Akzentfarbe', arten: ALLE,
      felder: [{ key: 'label', label: 'Bezeichnung', typ: 'text', default: 'Gesamtbetrag' }],
      render: (c, x) => `<div class="blk-summe-row"><span>${platzhalter(c.label, x)}</span><b>${euro(x.summe)}</b></div>`
    },
    betrag_worte: {
      name: 'Betrag in Worten', icon: 'edit', desc: 'z. B. „einhundertdreiundfünfzig Euro“', arten: ALLE,
      felder: [{ key: 'label', label: 'Bezeichnung', typ: 'text', default: 'in Worten' }],
      render: (c, x) => `<p class="blk-worte">${c.label ? `<span>${platzhalter(c.label, x)}:</span> ` : ''}${esc(wortBetrag(x.summe))}</p>`
    },
    steuerhinweis: {
      name: 'Steuerhinweis (§ 19)', icon: 'info', desc: 'Pflichthinweis für Kleinunternehmer', arten: ALLE,
      felder: [
        { key: 'text', label: 'Text', typ: 'text', default: HINWEIS19 },
        { key: 'groesse', label: 'Schrift', typ: 'select', default: 'normal', optionen: SEL_GROESSE }
      ],
      render: (c, x) => { const h = platzhalter(c.text, x); return h ? `<p class="blk-text ${esc(c.groesse || 'normal')}">${h}</p>` : ''; }
    },
    zahlung: {
      name: 'Zahlung & GiroCode', icon: 'qr', desc: 'Zahlungshinweis, Bankverbindung und QR-Code zum Bezahlen', arten: ['rechnung', 'angebot'],
      felder: [
        { key: 'text', label: 'Zahlungshinweis', typ: 'textarea', default: 'Bitte überweisen Sie {summe} bis zum {faellig} unter Angabe der Rechnungsnummer.' },
        { key: 'bank', label: 'Bankverbindung als Kasten', typ: 'toggle', default: true },
        { key: 'qr', label: 'GiroCode (QR) anzeigen', typ: 'toggle', default: true },
        { key: 'qrgroesse', label: 'Größe GiroCode', typ: 'select', default: '28', optionen: [['24', 'klein (24 mm)'], ['28', 'mittel (28 mm)'], ['34', 'groß (34 mm)']] }
      ],
      render(c, x) {
        const { doc, firma: F } = x;
        // Schon bei Ausstellung bezahlt (z. B. aus „+ Erfassen“ → Rechnung, bereits bezahlt): kein Zahlungsaufruf, kein GiroCode
        const q = quittiert(doc);
        if (q) return `<p class="blk-text">Den Betrag von ${euro(x.summe)} habe ich am ${fmt.datum(q.am)} ${q.za === 'bar' ? 'bar ' : q.za === 'paypal' ? 'per PayPal ' : ''}dankend erhalten.</p>`;
        const txt = c.text ? platzhalter(c.text, x) : '';
        let qr = '';
        if (c.qr !== false && x.qr && x.art === 'rechnung') {
          const g = girocode(doc, F), mm = Math.max(18, Math.min(45, +c.qrgroesse || 28));
          const box = g.ok ? `<div class="blk-qr-code" style="width:${mm}mm;height:${mm}mm">${g.svg}</div>` : g.fehlend ? `<div class="blk-qr-code blk-qr-ph" style="width:${mm}mm;height:${mm}mm">QR</div>` : '';
          if (box) qr = `<figure class="blk-qr">${box}<figcaption>Mit der Banking-App<br>scannen und bezahlen</figcaption></figure>`;
        }
        const bank = c.bank === false ? '' : `<div class="blk-bank"><b>Bankverbindung</b><dl>
          <dt>Empfänger</dt><dd>${esc(F.name)}</dd><dt>IBAN</dt><dd class="blk-iban">${esc(ibanFmt(F.iban))}</dd>
          <dt>BIC</dt><dd>${esc(F.bic)}${F.bank ? ` · ${esc(F.bank)}` : ''}</dd><dt>Betrag</dt><dd><b>${euro(x.summe)}</b></dd>
          <dt>Verwendungszweck</dt><dd>${doc.nr ? esc(doc.nr) : '<span class="blk-leer">Rechnungsnummer</span>'}</dd></dl></div>`;
        const p = txt ? `<p class="blk-text">${txt}</p>` : '';
        if (!bank && !qr) return p;
        return `${p}<div class="blk-pay${bank ? ' box' : ''}">${bank || '<div class="blk-pay-sp"></div>'}${qr}</div>`;
      }
    },
    quittung_felder: {
      name: 'Quittungsangaben', icon: 'receipt', desc: 'Betrag, Datum, Zahlungsart, erhalten von, für', arten: ['quittung'],
      felder: [
        { key: 'worte', label: 'Betrag in Worten', typ: 'toggle', default: true },
        { key: 'zahlungsart', label: 'Zahlungsart anzeigen', typ: 'toggle', default: true },
        { key: 'von', label: 'Bezeichnung „erhalten von“', typ: 'text', default: 'Erhalten von' },
        { key: 'fuer', label: 'Bezeichnung „für“', typ: 'text', default: 'Für' }
      ],
      render(c, x) {
        const { doc, empf: e } = x, pos = doc.positionen || [];
        const fuer = pos.length > 1 ? `${doc.betreff ? `<div>${nl(doc.betreff)}</div>` : ''}${posMini(pos)}` : nl(doc.betreff || (pos[0] && pos[0].text) || '') || '—';
        return `<div class="blk-grid ${c.zahlungsart === false ? 'c2' : 'c3'}">${feld('Betrag', `<b class="blk-big">${euro(x.summe)}</b>`)}${feld('Datum', fmt.datum(doc.datum))}${c.zahlungsart === false ? '' : feld('Zahlungsart', esc(zaName(doc.zahlungsart)))}</div>
          ${c.worte === false ? '' : feld('Betrag in Worten', esc(wortBetrag(x.summe)))}
          ${feld(platzhalter(c.von, x), esc(e.anzeige) + (e.zeilen.length ? `, ${esc(e.zeilen.join(', '))}` : ''))}
          ${feld(platzhalter(c.fuer, x), fuer)}`;
      }
    },
    eigenbeleg_felder: {
      name: 'Eigenbeleg-Angaben', icon: 'stamp', desc: 'Betrag, Datum, Empfänger, Zweck und Grund', arten: ['eigenbeleg'],
      felder: [
        { key: 'untertitel', label: 'Untertitel', typ: 'text', default: 'Ersatzbeleg für eine Betriebsausgabe ohne Originalbeleg' },
        { key: 'worte', label: 'Betrag in Worten', typ: 'toggle', default: true }
      ],
      render(c, x) {
        const { doc, empf: e } = x;
        const grund = doc.grund === 'sonstiges' ? (doc.grundText || 'Sonstiges') : (GRUENDE.find((g) => g[0] === doc.grund) || [, '—'])[1];
        // GoBD: ausgestellt → beim Buchen eingefroren (doc.gebucht); spätere Änderungen an der Ausgabe ändern das Blatt nicht
        const b = doc.buchung && D.buchungen.find((y) => y.id === doc.buchung);
        const g = doc.gebucht || (b ? { nr: b.nr, kat: (D.kat(b.kat) || {}).name || '' } : null);
        return `${c.untertitel ? `<p class="blk-sub">${platzhalter(c.untertitel, x)}</p>` : ''}
          <div class="blk-grid c3">${feld('Betrag', `<b class="blk-big">${euro(x.summe)}</b>`)}${feld('Datum der Zahlung', fmt.datum(doc.datum))}${feld('Zahlungsart', esc(zaName(doc.zahlungsart)))}</div>
          ${c.worte === false ? '' : feld('Betrag in Worten', esc(wortBetrag(x.summe)))}
          <div class="blk-grid c2">${feld('Zahlungsempfänger', e.name ? esc(e.name) + (e.zeilen.length ? `<small>${esc(e.zeilen.join(', '))}</small>` : '') : '<span class="blk-leer">fehlt</span>')}${feld('Grund für den Eigenbeleg', esc(grund))}</div>
          ${feld('Gegenstand / Zweck der Ausgabe', nl(doc.betreff) || '<span class="blk-leer">fehlt</span>')}
          ${g ? `<p class="blk-text grau">Gebucht als ${esc(g.nr)}${g.kat ? ` · ${esc(g.kat)}` : ''}</p>` : ''}`;
      }
    },
    gruss: {
      name: 'Grußformel', icon: 'send', desc: 'z. B. „Mit freundlichen Grüßen“ und Name', arten: ALLE,
      felder: [{ key: 'text', label: 'Text', typ: 'textarea', default: 'Mit freundlichen Grüßen\n{inhaber}' }],
      render: (c, x) => { const h = platzhalter(c.text, x); return h ? `<p class="blk-text">${h}</p>` : ''; }
    },
    unterschrift: {
      name: 'Unterschrift', icon: 'edit', desc: 'Linien für Ort/Datum und Unterschrift', arten: ALLE,
      felder: [
        { key: 'links', label: 'Beschriftung links', typ: 'text', default: 'Ort, Datum' },
        { key: 'rechts', label: 'Beschriftung rechts', typ: 'text', default: 'Unterschrift' },
        { key: 'vorbelegen', label: 'Ort und Datum vorausfüllen', typ: 'toggle', default: true },
        { key: 'unten', label: 'Am Seitenende', typ: 'toggle', default: true }
      ],
      render(c, x) {
        const d = x.art === 'eigenbeleg' ? (x.doc.erstellt || D.TODAY) : x.doc.datum;
        const pre = c.vorbelegen !== false && d ? `${esc(x.firma.ort)}, ${fmt.datum(d)}` : '';
        return `<div class="blk-sign"><div><span>${pre}</span><i></i><small>${platzhalter(c.links, x)}</small></div><div><span></span><i></i><small>${platzhalter(c.rechts, x)}</small></div></div>`;
      }
    },
    trennlinie: {
      name: 'Trennlinie', icon: 'list', desc: 'Waagerechte Linie', arten: ALLE,
      felder: [{ key: 'farbe', label: 'Farbe', typ: 'select', default: 'grau', optionen: [['grau', 'Grau, fein'], ['akzent', 'Akzentfarbe'], ['schwarz', 'Schwarz']] }],
      render: (c) => `<hr class="blk-hr ${esc(c.farbe || 'grau')}">`
    },
    abstand: {
      name: 'Abstand', icon: 'chevD', desc: 'Leerraum zwischen Bausteinen', arten: ALLE,
      felder: [{ key: 'groesse', label: 'Höhe', typ: 'select', default: 'mittel', optionen: [['klein', 'klein (4 mm)'], ['mittel', 'mittel (8 mm)'], ['gross', 'groß (14 mm)']] }],
      render: (c) => `<div class="blk-space ${esc(c.groesse || 'mittel')}"></div>`
    },
    fusszeile: {
      name: 'Fußzeile', icon: 'bank', unten: true, desc: 'Drei Spalten am Seitenende: Adresse · Kontakt & Steuernr. · Bank', arten: ALLE,
      felder: [
        { key: 'adresse', label: 'Spalte Adresse', typ: 'toggle', default: true },
        { key: 'kontakt', label: 'Spalte Kontakt & Steuernummer', typ: 'toggle', default: true },
        { key: 'bank', label: 'Spalte Bankverbindung', typ: 'toggle', default: true }
      ],
      render(c, x) {
        const F = x.firma, z = (l) => l.filter((s) => s && String(s).trim()).map(esc).join('<br>');
        const sp = [];
        if (c.adresse !== false) sp.push(`<div><b>${esc(F.name)}</b><br>${z([F.inhaber, F.strasse, `${F.plz} ${F.ort}`])}</div>`);
        if (c.kontakt !== false) sp.push(`<div>${z([F.telefon && `Tel. ${F.telefon}`, F.email, F.web, F.steuernummer && `Steuernr. ${F.steuernummer}`])}</div>`);
        if (c.bank !== false) sp.push(`<div>${z([F.bank, F.iban && `IBAN ${ibanFmt(F.iban)}`, F.bic && `BIC ${F.bic}`])}</div>`);
        return sp.length ? `<div class="blk-fuss" style="--n:${sp.length}">${sp.join('')}</div>` : '';
      }
    }
  };
  /* Rechnung war schon bei Ausstellung bezahlt → { am, za } oder null. Ausgestellte Belege nutzen den beim Finalisieren
   * eingefrorenen Wert (r.quittiert), damit späteres „bezahlt“/„doch offen“ das Blatt nicht verändert (GoBD). */
  function quittiert(doc) {
    if (!doc || doc.art !== 'rechnung') return null;
    if (doc.quittiert) return doc.quittiert;
    if (ausgestellt(doc) && doc.erstellt) return null;
    return doc.bezahltAm && doc.datum && doc.bezahltAm <= doc.datum ? { am: doc.bezahltAm, za: doc.zahlungsart } : null;
  }
  function feld(label, wert) { return `<div class="blk-feld"><small>${label}</small><div>${wert}</div></div>`; }
  function posMini(pos) {
    return `<table class="blk-posmini">${pos.map((p) => `<tr><td>${menge(p.menge)}${p.einheit ? '&nbsp;' + esc(p.einheit) : ''} ×</td><td>${esc(p.text)}</td><td>${euro(Math.round(p.menge * p.preis))}</td></tr>`).join('')}</table>`;
  }
  const defaults = (typ) => { const o = {}; ((BLOCKS[typ] || {}).felder || []).forEach((f) => { o[f.key] = f.default; }); return o; };

  /* Mitgelieferte Vorlagen je Belegart (entsprechen den LaTeX-Vorlagen aus der Anleitung §7.5/§7.6) */
  const STANDARD = {
    rechnung: [
      { typ: 'kopf', logo: true, claim: '{inhaber}' },
      { typ: 'abstand', groesse: 'gross' },
      { typ: 'absenderzeile' },
      { typ: 'anschrift_meta', nr: true, datum: true, leistung: true, kundennr: true, faellig: false },
      { typ: 'abstand', groesse: 'mittel' },
      { typ: 'titel', text: '{art} {nr}' },
      { typ: 'betreff' },
      { typ: 'text', text: 'Guten Tag,\n{einleitung}' },
      { typ: 'positionen' },
      { typ: 'summe', label: 'Gesamtbetrag' },
      { typ: 'steuerhinweis' },
      { typ: 'zahlung' },
      { typ: 'text', text: '{schlusstext}' },
      { typ: 'gruss' },
      { typ: 'fusszeile' }
    ],
    angebot: [
      { typ: 'kopf', logo: true, claim: '{inhaber}' },
      { typ: 'abstand', groesse: 'gross' },
      { typ: 'absenderzeile' },
      { typ: 'anschrift_meta', nr: true, datum: true, leistung: false, kundennr: true, faellig: true },
      { typ: 'abstand', groesse: 'mittel' },
      { typ: 'titel', text: '{art} {nr}' },
      { typ: 'betreff' },
      { typ: 'text', text: 'Guten Tag,\n{einleitung}' },
      { typ: 'positionen' },
      { typ: 'summe', label: 'Angebotssumme' },
      { typ: 'steuerhinweis' },
      { typ: 'text', text: 'Dieses Angebot ist gültig bis zum {faellig}.' },
      { typ: 'text', text: '{schlusstext}' },
      { typ: 'gruss' },
      { typ: 'fusszeile' }
    ],
    quittung: [
      { typ: 'titel', text: '{art}', rechts: 'Nr. {nr}', stil: 'akzent', linie: true },
      { typ: 'quittung_felder' },
      { typ: 'steuerhinweis', groesse: 'klein' },
      { typ: 'text', text: '{schlusstext}', groesse: 'grau' },
      // § 33/§ 34a UStDV: vollständiger Name des leistenden Unternehmers → Inhaber mit ausgeben
      { typ: 'absenderzeile', text: '{firma} · Inh. {inhaber} · {strasse} · {plz} {ort} · Steuernr. {steuernummer}', linie: false },
      { typ: 'unterschrift', links: 'Ort, Datum', rechts: 'Unterschrift {firma}' }
    ],
    eigenbeleg: [
      { typ: 'titel', text: '{art}', rechts: 'Nr. {nr}', stil: 'akzent', linie: true },
      { typ: 'eigenbeleg_felder' },
      { typ: 'absenderzeile', text: 'Ausgestellt von {inhaber} · {firma} · {strasse} · {plz} {ort}', linie: false },
      { typ: 'unterschrift', links: 'Ort, Datum', rechts: 'Unterschrift {inhaber}' }
    ]
  };
  /* Mitgelieferte Vorlagen von früher – GoBD: alte ausgestellte Belege ohne eingefrorenes Layout (z. B. Demo-Daten)
   * wurden damit gedruckt und behalten sie (wie SCHLUSS_ALT bei den Texten) */
  const STANDARD_ALT = {
    quittung: STANDARD.quittung.map((b) => (b.typ === 'absenderzeile' ? { ...b, text: '{firma} · {strasse} · {plz} {ort} · Steuernr. {steuernummer}' } : b))
  };
  /* Aktive Vorlage: gewählte (id) → eigene Standardvorlage der Art → mitgelieferte */
  function vorlage(art, id = null) {
    if (id === 'mitgeliefert') return STANDARD[art] || STANDARD.rechnung;
    const V = Array.isArray(D.VORLAGEN) ? D.VORLAGEN : [];
    const v = (id && V.find((x) => x.id === id && x.art === art)) || V.find((x) => x.art === art && x.standard);
    return v && Array.isArray(v.bloecke) ? v.bloecke : STANDARD[art] || STANDARD.rechnung;
  }
  /* Bausteine, mit denen ein Beleg gedruckt wird: eingefrorene → (alter Beleg mit mitgelieferter Vorlage: die von damals) → aktive Vorlage */
  function layoutVon(d, art = d.art) {
    if (Array.isArray(d.bloecke)) return d.bloecke;
    const v = vorlage(art, d.vorlage);
    return ausgestellt(d) && v === STANDARD[art] && STANDARD_ALT[art] ? STANDARD_ALT[art] : v;
  }

  /* Beispieldaten für die Vorlagen-Vorschau (füllt nur, was fehlt) */
  function mitBeispiel(d) {
    const art = ART[d.art] ? d.art : 'rechnung', t = D.TODAY, x = { ...d, art };
    if (!x.nr) x.nr = nextNr(art, t);
    x.datum ||= t;
    if (!x.kontakt && !String(x.kunde || '').trim()) {
      x.kunde = { quittung: 'Anna Schmidt', eigenbeleg: 'Parkhaus am Markt' }[art] || 'Beispiel GmbH';
      x.kundeAdresse = { quittung: 'Lindenweg 4\n12345 Musterstadt', eigenbeleg: 'Marktplatz 1\n12345 Musterstadt' }[art] || 'z. Hd. Frau Beispiel\nBeispielweg 5\n54321 Beispielstadt';
    }
    if (!(x.positionen || []).some((p) => p.text || p.preis)) {
      x.positionen = art === 'quittung' ? [{ text: 'Rasenmähen inkl. Kantenschnitt', menge: 1, einheit: 'pausch.', preis: 6500 }]
        : art === 'eigenbeleg' ? [{ text: 'Parkgebühr Kundentermin', menge: 1, einheit: '', preis: 600 }]
          : [{ text: 'Heckenschnitt Grundstücksgrenze', menge: 3, einheit: 'Std.', preis: 4500 }, { text: 'Entsorgung Grünschnitt', menge: 1, einheit: 'pausch.', preis: 2500 }];
    }
    x.betreff ||= { quittung: 'Rasenmähen inkl. Kantenschnitt', eigenbeleg: 'Parkgebühr Kundentermin' }[art] || 'Gartenpflege Oktober';
    if (art === 'rechnung' || art === 'angebot') {
      x.leistung ||= t; if (x.ziel == null) x.ziel = art === 'angebot' ? 30 : D.FIRMA.zahlungszielTage || 14;
      if (x.einleitung == null) x.einleitung = TEXTE[art].einleitung;
      if (x.schluss == null) x.schluss = TEXTE[art].schluss;
    }
    if (!x.faellig) faelligSetzen(x);
    if (art === 'eigenbeleg') { x.grund ||= 'kein'; x.zahlungsart ||= 'bar'; }
    if (art === 'quittung') x.zahlungsart ||= 'bar';
    return x;
  }

  /* ================= Blatt zusammensetzen ================= */
  /* Logo eines ausgestellten Belegs: das von damals (Archiv in D.FIRMA.logoArchiv), nicht das aktuelle */
  const logoVon = (id) => (!id ? '' : id === D.FIRMA.logoId ? D.FIRMA.logo : (D.FIRMA.logoArchiv || {})[id] || '');
  function kontext(doc, o = {}) {
    let F = o.firma || D.FIRMA;
    if (!o.firma && ausgestellt(doc) && doc.logoId != null && doc.logoId !== (D.FIRMA.logoId || '')) F = { ...F, logo: logoVon(doc.logoId) };
    const art = ART[doc.art] ? doc.art : 'rechnung';
    const empf = empfaenger(doc, o.kontakt || null);
    const storno = doc.status === 'storniert';
    const entwurf = o.entwurf != null ? !!o.entwurf : !storno && (!doc.nr || doc.status === 'entwurf');
    return { doc, art, A: ART[art], firma: F, kontakt: empf.k, empf, summe: summe(doc), qr: o.qr !== false && doc.qr !== false, entwurf, storno, format: ART[art].format };
  }
  function html(doc, o = {}) {
    let d = doc ? { ...doc } : { art: o.art || 'rechnung' };
    if (o.beispiel) d = mitBeispiel(d);
    d.positionen = Array.isArray(d.positionen) ? d.positionen : [];
    const x = kontext(d, { ...o, entwurf: o.entwurf != null ? o.entwurf : o.beispiel ? false : undefined });
    const liste = o.bloecke || layoutVon(d, x.art);
    const platz = !!(o.editable || o.beispiel);
    const oben = [], unten = [];
    (Array.isArray(liste) ? liste : []).forEach((b, i) => {
      if (!b || b.aus) return;
      const def = BLOCKS[b.typ]; if (!def) return;
      const c = { ...defaults(b.typ), ...b };
      let inner = '';
      try { inner = def.render(c, x) || ''; } catch (err) { console.warn('Baustein', b.typ, err); }
      if (!inner && !platz) return;
      const h = `<div class="blk blk-${b.typ}" data-blk="${i}">${inner || `<div class="blk-platz">${esc(def.name)} – leer</div>`}</div>`;
      (def.unten || c.unten === true ? unten : oben).push(h);
    });
    const style = o.accent ? ` style="--accent:${esc(o.accent)}"` : '';
    const wm = x.storno ? 'STORNIERT' : x.entwurf ? 'ENTWURF' : '';
    const falz = x.format === 'a4' ? '<i class="sh-mark" style="top:105mm"></i><i class="sh-mark" style="top:210mm"></i><i class="sh-mark loch" style="top:148.5mm"></i>' : '';
    return `<article class="sheet sh-${x.format}${x.entwurf ? ' is-draft' : ''}${x.storno ? ' is-storno' : ''}${o.editable ? ' editable' : ''}" data-format="${x.format}" data-art="${x.art}"${style} lang="de">${falz}${wm ? `<div class="sh-wm" aria-hidden="true"><span>${wm}</span></div>` : ''}<div class="sh-main">${oben.join('')}</div>${unten.length ? `<div class="sh-unten">${unten.join('')}</div>` : ''}</article>`;
  }
  const format = (doc) => (ART[doc && doc.art] || ART.rechnung).format;

  /* ================= Pflichtangaben (§ 34a/§ 33 UStDV) – Daten UND Bausteine ================= */
  function pflichtCheck(doc, bloecke) {
    let d = doc ? { ...doc } : { art: 'rechnung' };
    if (!(d.positionen || []).length && !d.kontakt && !d.kunde) d = mitBeispiel(d);
    d.positionen = d.positionen || [];
    const art = ART[d.art] ? d.art : 'rechnung';
    if (art === 'angebot') return [];
    const F = D.FIRMA, x = kontext(d), e = x.empf, total = x.summe;
    const L = (bloecke || layoutVon(d, art)).filter((b) => b && !b.aus && BLOCKS[b.typ]).map((b) => ({ ...defaults(b.typ), ...b }));
    const has = (typ, pred = () => true) => L.some((b) => b.typ === typ && pred(b));
    const txt = (k) => L.some((b) => Object.entries(b).some(([kk, v]) => kk !== 'typ' && typeof v === 'string' && v.includes(`{${k}}`)));
    const out = [];
    const add = (label, blockOk, blockHint, dataOk, dataHint, okHint, offen = false) => {
      if (!blockOk) out.push({ label, ok: false, hint: blockHint });
      else if (!dataOk) out.push({ label, ok: false, hint: dataHint });
      else out.push({ label, ok: true, hint: okHint, offen });
    };
    const posOk = d.positionen.length > 0 && d.positionen.every((p) => String(p.text || '').trim() && +p.menge > 0);
    if (art === 'eigenbeleg') {
      const eb = has('eigenbeleg_felder'), bh = 'Baustein „Eigenbeleg-Angaben“ fehlt';
      add('Datum der Zahlung', eb, bh, !!d.datum, 'Datum fehlt', fmt.datum(d.datum));
      add('Betrag', eb, bh, total > 0, 'Betrag fehlt', `${euro(total)} · mit Betrag in Worten`);
      add('Zahlungsempfänger', eb, bh, !!e.name, 'Name des Empfängers fehlt', [e.name, ...e.zeilen].join(', ') + (e.zeilen.length ? '' : ' · Anschrift, soweit bekannt'));
      add('Gegenstand / Zweck', eb, bh, !!String(d.betreff || '').trim(), 'Wofür wurde gezahlt?', d.betreff);
      add('Grund für den Eigenbeleg', eb, bh, d.grund !== 'sonstiges' || !!String(d.grundText || '').trim(), 'Grund beschreiben', d.grund === 'sonstiges' ? d.grundText : (GRUENDE.find((g) => g[0] === d.grund) || [, ''])[1]);
      add('Unterschrift', has('unterschrift'), 'Baustein „Unterschrift“ fehlt', true, '', 'nach dem Drucken unterschreiben', true);
      return out;
    }
    const quittung = art === 'quittung', qf = quittung && has('quittung_felder');
    const firmaOk = !!(F.name && F.strasse && F.plz && F.ort);
    add('Name und Anschrift (Aussteller)', has('fusszeile', (b) => b.adresse !== false) || (txt('strasse') && txt('ort')), 'Absenderzeile oder Fußzeile mit Adresse fehlt',
      firmaOk, 'in den Firmendaten ergänzen', `${F.name}, ${F.plz} ${F.ort}`);
    // vollständiger Name des Unternehmers = Inhaber (der Firmenname allein reicht nicht); Fußzeile „Adresse“ druckt ihn mit
    add('Vollständiger Name (Inhaber)', has('fusszeile', (b) => b.adresse !== false) || txt('inhaber'), '{inhaber} wird nirgends gedruckt – z. B. in der Absenderzeile ergänzen',
      !!String(F.inhaber || '').trim(), 'in den Firmendaten ergänzen', F.inhaber);
    if (quittung && total <= kleinbetrag(d)) out.push({ label: 'Name und Anschrift (Kunde)', ok: true, hint: e.name ? `${e.name} · optional bis ${euro(kleinbetrag(d))}` : `nicht nötig – Kleinbetragsrechnung bis ${euro(kleinbetrag(d))}` });
    else add('Name und Anschrift (Kunde)', has('anschrift_meta') || qf || txt('kunde'), 'Baustein „Anschrift & Belegdaten“ fehlt',
      !!(e.name && e.zeilen.length), !e.name ? 'Kunde fehlt' : quittung ? 'Anschrift fehlt (Pflicht über 250 €)' : 'Anschrift fehlt', [e.name, e.zeilen[e.zeilen.length - 1]].filter(Boolean).join(', '));
    add('Steuernummer', has('fusszeile', (b) => b.kontakt !== false) || txt('steuernummer'), 'Fußzeile oder {steuernummer} fehlt',
      !!F.steuernummer, 'in den Firmendaten ergänzen', F.steuernummer);
    add('Ausstellungsdatum', has('anschrift_meta', (b) => b.datum) || qf || txt('datum'), 'Datum wird nirgends gedruckt', !!d.datum, 'Datum fehlt', fmt.datum(d.datum));
    add('Menge und Art der Leistung', has('positionen') || qf, 'Baustein „Positionen“ fehlt',
      quittung ? !!String(d.betreff || '').trim() || posOk : posOk, quittung ? 'Wofür? (Leistung / Gegenstand)' : 'Beschreibung oder Menge fehlt',
      quittung && d.positionen.length <= 1 ? d.betreff : `${d.positionen.length} ${d.positionen.length === 1 ? 'Position' : 'Positionen'}`);
    const h19 = L.some((b) => Object.values(b).some((v) => typeof v === 'string' && /§\s*19/.test(v)));
    add('Entgelt und § 19-Hinweis', (has('summe') || qf || txt('summe')) && h19, h19 ? 'Gesamtbetrag wird nicht gedruckt' : 'Baustein „Steuerhinweis (§ 19)“ fehlt',
      total > 0, 'Betrag fehlt', `${euro(total)} · ${HINWEIS19.replace(/\.$/, '')}`);
    const nrBlock = has('anschrift_meta', (b) => b.nr) || txt('nr');
    if (!nrBlock) out.push({ label: 'Fortlaufende Nummer', ok: false, hint: 'Nummer wird nirgends gedruckt' });
    else out.push({ label: 'Fortlaufende Nummer', ok: true, hint: d.nr && d.status !== 'entwurf' ? d.nr : `wird beim Finalisieren vergeben (${nextNr(art, d.datum)})`, offen: !d.nr || d.status === 'entwurf' });
    if (quittung) out.push({ label: 'Leistungsdatum', ok: true, hint: '= Ausstellungsdatum' });
    else add('Leistungsdatum / -zeitraum', has('anschrift_meta', (b) => b.leistung) || txt('leistungsdatum'), 'Leistungsdatum wird nirgends gedruckt', !!d.leistung, 'Leistungsdatum fehlt', leistungText(d));
    return out;
  }

  /* ================= Druck =================
   * Blatt in #printArea rendern, @page-Größe setzen (A4 hoch / A5 quer, Rand 0) → nur das Blatt wird gedruckt. */
  function preparePrint(doc, o = {}) {
    const pa = document.getElementById('printArea');
    if (!pa) return () => {};
    pa.innerHTML = html(doc, o);
    let st = document.getElementById('pageSize');
    if (!st) { st = document.createElement('style'); st.id = 'pageSize'; document.head.appendChild(st); }
    st.textContent = format(doc) === 'a5q' ? '@page { size: 210mm 148mm; margin: 0; }'
      : '@page { size: 210mm 297mm; margin: 14mm 0 14mm; } @page :first { margin: 0; }';
    const titel = document.title;
    const e = empfaenger(doc || {});
    document.title = [doc && doc.nr ? doc.nr : `${(ART[doc && doc.art] || ART.rechnung).label}-Entwurf`, e.anzeige].filter(Boolean).join(' '); // = Dateiname „Als PDF sichern“
    document.body.classList.add('printing-beleg');
    return () => { pa.innerHTML = ''; st.textContent = ''; document.title = titel; document.body.classList.remove('printing-beleg'); };
  }
  function print(doc, o = {}) {
    const restore = preparePrint(doc, o);
    window.addEventListener('afterprint', restore, { once: true });
    window.print();
  }

  /* ================= Skalierte Vorschau (Bühne) ================= */
  const MM = 96 / 25.4;
  function mount(host, doc, opts = {}) {
    const o = { fit: 'width', ...opts };
    host.classList.add('sheet-desk');
    host.innerHTML = '<div class="sheet-stage"></div>';
    const stage = host.firstElementChild;
    let cur = doc, lastW = -1, raf = 0;
    function fit() {
      const sh = stage.firstElementChild; if (!sh) return;
      const cs = getComputedStyle(host);
      const availW = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const w = sh.offsetWidth, h = sh.offsetHeight, pageH = (sh.dataset.format === 'a5q' ? 148 : 297) * MM;
      let s = availW / w;
      if (o.fit === 'page') { const mh = typeof o.maxHeight === 'function' ? o.maxHeight() : +o.maxHeight || 0; if (mh > 120) s = Math.min(s, mh / pageH); }
      s = Math.max(0.15, Math.min(s, o.maxScale || 1.5));
      sh.style.transform = `scale(${s})`;
      stage.style.width = `${Math.round(w * s)}px`;
      stage.style.height = `${Math.ceil(h * s)}px`;
      const pages = Math.max(1, Math.ceil((h - 2) / pageH));
      $$('.sh-pb', sh).forEach((n) => n.remove());
      for (let p = 1; p < pages; p++) sh.insertAdjacentHTML('beforeend', `<div class="sh-pb" style="top:${(p * pageH).toFixed(1)}px"><span>Seite ${p + 1}</span></div>`);
      if (o.onFit) o.onFit({ scale: s, pages, format: sh.dataset.format });
    }
    function update(d, extra) { if (d) cur = d; if (extra) Object.assign(o, extra); stage.innerHTML = html(cur, o); fit(); }
    const ro = new ResizeObserver(() => { if (host.clientWidth !== lastW) { lastW = host.clientWidth; fit(); } });
    ro.observe(host);
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); };
    window.addEventListener('resize', onResize);
    update();
    return { update, fit, setFit(m) { o.fit = m; fit(); }, destroy() { ro.disconnect(); window.removeEventListener('resize', onResize); cancelAnimationFrame(raf); } };
  }

  App.sheet = {
    BLOCKS, STANDARD, PLATZHALTER, vorlage, platzhalter, html, pflichtCheck, print, preparePrint, mount,
    wortBetrag, zahlWort, format, girocode, epc: epcFor, nextNr, empfaenger, defaults, beispiel: mitBeispiel, einfrierenAlle
  };

  /* ================= Buchungen zu Belegen ================= */
  /* Ein- oder Ausgang wie in DATA.buchungen (Zahlungsweg nur als Info – es gibt keine Konten) */
  function buchungAnlegen(f) {
    const b = { id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), nr: App.nextBuchungNr(f.datum), kontakt: null, kunde: null, lieferant: null, rechnung: null, privat: 0, beleg: null, belegnr: null, ...f };
    D.buchungen.push(b);
    return b;
  }
  /* Beleg mit einer schon erfassten Zahlung verknüpfen (keine zweite Buchung) */
  function buchungVerknuepfen(b, r) {
    Object.assign(b, { rechnung: r.id, belegnr: r.nr, beleg: b.beleg || `${r.nr}.pdf` });
    if (r.art === 'eigenbeleg') { if (!b.lieferant && r.kunde) b.lieferant = r.kunde; }
    else Object.assign(b, { kontakt: r.kontakt || null, kunde: kundeName(r) || null });
  }

  /* ================= Status selbst festlegen (GoBD-gerecht) =================
   * Rechnung: Offen ⇄ Bezahlt (Einnahme buchen bzw. zurücknehmen) · Quittung: immer bezahlt, nur Storno (oder als Rechnung
   * neu ausstellen) · Angebot: Offen · Angenommen (→ Rechnung) · Abgelehnt · Eigenbeleg: gebucht, nur Storno.
   * Storniert ist endgültig – zurück nur über den sofortigen Rückgängig-Toast. Der Beleg selbst (Nummer, Blatt) bleibt unverändert. */
  const buchungenZu = (r) => D.buchungen.filter((b) => b.rechnung === r.id);
  /* Zustand eines Belegs merken → Funktion zum Wiederherstellen (für Rückgängig) */
  function zustandMerken(r) { const v = clone(r); return () => { Object.keys(r).forEach((k) => delete r[k]); Object.assign(r, v); }; }
  /* Verknüpfte Buchungen zurücknehmen (entfernen) – oder nur vom Beleg lösen, wenn die Zahlung schon vorher erfasst war */
  function buchungenZuruecknehmen(r, nurLoesen = false) {
    const alt = buchungenZu(r).map((b) => ({ b, i: D.buchungen.indexOf(b), snap: { rechnung: b.rechnung, belegnr: b.belegnr, beleg: b.beleg } }));
    alt.slice().sort((x, y) => y.i - x.i).forEach(({ b, i }) => {
      if (nurLoesen) Object.assign(b, { rechnung: null, belegnr: null, beleg: b.beleg === `${r.nr}.pdf` ? null : b.beleg });
      else D.buchungen.splice(i, 1);
    });
    return {
      anzahl: alt.length, nrn: alt.map((x) => x.b.nr), summe: alt.reduce((s, x) => s + x.b.betrag, 0),
      zurueck() { alt.slice().sort((x, y) => x.i - y.i).forEach(({ b, i, snap }) => { if (nurLoesen) Object.assign(b, snap); else if (!D.buchungen.includes(b)) D.buchungen.splice(Math.min(i, D.buchungen.length), 0, b); }); }
    };
  }
  const nrListe = (nrn) => nrn.map((n) => `<b class="mono">${esc(n)}</b>`).join(', ');
  const fertig = (msg, undo) => { App.save(); App.rerender(); App.toast(msg, { action: { label: 'Rückgängig', fn: () => { undo(); App.save(); App.rerender(); } } }); };

  /* Rechnung → bezahlt: Datum + Zahlungsweg, dann App.markPaid (bucht die Einnahme, mit Rückgängig) */
  function bezahltDialog(r) {
    let za = zaGueltig(r.zahlungsart) ? r.zahlungsart : 'bank';
    App.drawer.open({
      id: 'paid', title: 'Als bezahlt markieren', sub: `${esc(r.nr)} · ${euro(summe(r))}`, icon: 'check', width: 420,
      body: `<section><div class="field"><label>Zahlungseingang am</label><input type="date" class="input" id="blPaidDate" value="${D.TODAY}" max="${D.TODAY}"></div>
        <div class="field"><label>Zahlungsweg</label>${App.seg('local', 'paidza', zahlungswege(), za, 'full bl-zaseg')}</div>
        <p class="hint">Gebucht wird eine Einnahme über ${euro(summe(r))} mit Beleg ${esc(r.nr)}.pdf. Über den Status lässt sich das jederzeit wieder umkehren.</p></section>`,
      foot: `<button type="button" class="btn ghost" data-action="close-drawer">Abbrechen</button><button type="button" class="btn-primary sm" id="blPaidOk">${icon('check')}Bezahlt buchen</button>`,
      onMount(d) {
        d.addEventListener('seg-change', (e) => { if (e.detail.key === 'paidza') za = e.detail.value; });
        d.querySelector('#blPaidOk').addEventListener('click', () => { const dt = d.querySelector('#blPaidDate').value || D.TODAY; App.drawer.close(); App.markPaid(r.id, dt, za); });
      }
    });
  }
  /* Rechnung → doch offen: verknüpfte Einnahme(n) zurücknehmen */
  function dochOffenDialog(r) {
    const bs = buchungenZu(r);
    App.drawer.open({
      id: 'wieder-offen', title: 'Doch noch offen?', sub: `${esc(r.nr)} · ${euro(summe(r))}`, icon: 'reset', width: 440,
      body: `<section><p>${esc(r.nr)} wird wieder als <b>offen</b> geführt${r.bezahltAm ? ` – bisher bezahlt am ${fmt.datum(r.bezahltAm)}` : ''}.</p>
        ${bs.length ? `<p>Die Einnahme ${nrListe(bs.map((b) => b.nr))} über ${euro(bs.reduce((s, b) => s + b.betrag, 0))} wird zurückgenommen.</p>` : ''}
        <div class="proto-note">${icon('info')}<span>In der Mac-App wird die Einnahme per Storno-Buchung zurückgenommen; Nummer und Beleg der Rechnung bleiben unverändert. Im Prototyp wird die Einnahme entfernt.</span></div></section>`,
      foot: `<button type="button" class="btn ghost" data-action="close-drawer">Abbrechen</button><button type="button" class="btn-primary sm" id="blOffenOk">${icon('reset')}Wieder offen</button>`,
      onMount(d) { d.querySelector('#blOffenOk').addEventListener('click', () => { App.drawer.close(); dochOffen(r); }); }
    });
  }
  function dochOffen(r) {
    const undoR = zustandMerken(r), q = quittiert(r);
    if (q && !r.quittiert) r.quittiert = q; // Blatt bleibt, wie ausgestellt („dankend erhalten“)
    const bu = buchungenZuruecknehmen(r);
    r.status = 'offen'; r.bezahltAm = null; delete r.buchung; delete r.buchungVorher;
    fertig(`${r.nr} wieder offen${bu.anzahl ? ` · Einnahme ${bu.nrn.join(', ')} zurückgenommen` : ''}`, () => { undoR(); bu.zurueck(); });
  }
  /* Stornieren: Beleg bleibt archiviert, Nummer vergeben; Einnahme/Ausgabe wird zurückgenommen bzw. gelöst */
  function stornoDialog(r) {
    const bs = buchungenZu(r), loesen = !!r.buchungVorher, A = ART[r.art] || ART.rechnung;
    const was = r.art === 'eigenbeleg' ? 'Ausgabe' : 'Einnahme';
    App.drawer.open({
      id: 'storno', title: `${A.label} stornieren`, sub: `${esc(r.nr)} · ${euro(summe(r))}`, icon: 'x', width: 440,
      body: `<section><p>Der Beleg wird als <b>storniert</b> markiert und bleibt unverändert archiviert. Seine Nummer bleibt vergeben. Das ist endgültig – direkt danach lässt es sich noch rückgängig machen.</p>
        ${bs.length ? `<p>Die ${was} ${nrListe(bs.map((b) => b.nr))} wird ${loesen ? 'vom Beleg gelöst (sie war schon vorher erfasst und bleibt bestehen)' : 'zurückgenommen'}.</p>` : ''}
        <div class="proto-note">${icon('info')}<span>In der Mac-App erzeugt „Stornieren“ einen Stornobeleg mit eigener Nummer über −${euro(summe(r))}, der auf ${esc(r.nr)} verweist${bs.length && !loesen ? `, und eine Storno-Buchung zur ${was}` : ''}. Das Original bleibt unverändert (GoBD).</span></div></section>`,
      foot: `<button type="button" class="btn ghost" data-action="close-drawer">Abbrechen</button><button type="button" class="btn danger" id="blStornoOk">${icon('x')}Stornieren</button>`,
      onMount(d) { d.querySelector('#blStornoOk').addEventListener('click', () => { App.drawer.close(); stornieren(r); }); }
    });
  }
  function stornieren(r, { still = false } = {}) {
    const undoR = zustandMerken(r), bu = buchungenZuruecknehmen(r, !!r.buchungVorher);
    r.status = 'storniert'; r.storniertAm = D.TODAY;
    const undo = () => { undoR(); bu.zurueck(); };
    if (!still) fertig(`${r.nr} storniert${bu.anzahl && !r.buchungVorher ? ` · ${r.art === 'eigenbeleg' ? 'Ausgabe' : 'Einnahme'} ${bu.nrn.join(', ')} zurückgenommen` : ''}`, undo);
    return undo;
  }
  /* Kopie als Entwurf (Duplizieren, Angebot → Rechnung, Quittung → Rechnung) */
  function kopie(r, art) {
    const c = clone(r);
    // ohne Terminbezug: ein Entwurf mit `termin` wäre sonst ein „vorbereiteter“ Beleg für den (längst erledigten) Termin
    ['nr', 'bezahltAm', 'buchung', 'buchungVorher', 'quittiert', 'umgewandelt', 'storniertAm', 'erstellt', 'ausAngebot', 'ersetzt', 'bloecke', 'scan', 'kundeNr', 'termin', 'gebucht', 'logoId'].forEach((k) => delete c[k]);
    Object.assign(c, { id: 'r' + Date.now().toString(36), art, status: 'entwurf', nr: null, datum: D.TODAY });
    if (c.leistung) { c.leistung = D.TODAY; c.leistungBis = ''; }
    if ((art === 'rechnung' || art === 'angebot') && c.kontakt && D.kontakt(c.kontakt)) { c.kunde = ''; c.kundeAdresse = ''; } // Entwurf liest wieder live aus dem Kunden
    if (c.vorlage && c.vorlage !== 'mitgeliefert' && !(D.VORLAGEN || []).some((v) => v.id === c.vorlage && v.art === art)) c.vorlage = '';
    faelligSetzen(c);
    return c;
  }
  function duplizieren(r) {
    const c = kopie(r, r.art);
    D.rechnungen.push(c); App.save();
    App.toast(`Kopie von ${r.nr || 'Entwurf'} als Entwurf angelegt`);
    App.go('#/beleg/' + c.id);
  }
  function umwandeln(r) {
    const c = kopie(r, 'rechnung');
    Object.assign(c, { einleitung: `vielen Dank für Ihren Auftrag gemäß meinem Angebot ${r.nr}. Ich berechne Ihnen folgende Leistungen:`, schluss: TEXTE.rechnung.schluss, ziel: D.FIRMA.zahlungszielTage || 14, qr: true, zahlungsart: 'bank', ausAngebot: r.id });
    faelligSetzen(c);
    r.umgewandelt = c.id;
    D.rechnungen.push(c); App.save();
    App.toast(`Rechnungsentwurf aus ${r.nr} erstellt`);
    App.go('#/beleg/' + c.id);
  }
  /* Versehentlich Quittung statt Rechnung: Quittung stornieren und eine Rechnung mit gleichen Angaben als Entwurf anlegen */
  function alsRechnungDialog(r) {
    const bs = buchungenZu(r);
    App.drawer.open({
      id: 'als-rechnung', title: 'Als Rechnung neu ausstellen', sub: `${esc(r.nr)} · ${euro(summe(r))}`, icon: 'invoice', width: 440,
      body: `<section><p>${esc(r.nr)} wird <b>storniert</b>${bs.length && !r.buchungVorher ? ` (Einnahme ${nrListe(bs.map((b) => b.nr))} zurückgenommen)` : ''}. Mit denselben Angaben entsteht eine <b>Rechnung als Entwurf</b> – mit Zahlungsziel und GiroCode.</p>
        <p class="hint">Beim Finalisieren bekommt sie eine RE-Nummer. Ist das Geld schon da, markierst du sie danach über den Status als bezahlt.</p></section>`,
      foot: `<button type="button" class="btn ghost" data-action="close-drawer">Abbrechen</button><button type="button" class="btn-primary sm" id="blAlsReOk">${icon('invoice')}Stornieren & Rechnung anlegen</button>`,
      onMount(d) { d.querySelector('#blAlsReOk').addEventListener('click', () => { App.drawer.close(); alsRechnungNeu(r); }); }
    });
  }
  function alsRechnungNeu(r) {
    const undoStorno = stornieren(r, { still: true });
    const c = kopie(r, 'rechnung');
    Object.assign(c, { leistung: r.leistung || r.datum, einleitung: TEXTE.rechnung.einleitung, schluss: TEXTE.rechnung.schluss, ziel: D.FIRMA.zahlungszielTage || 14, qr: true, zahlungsart: 'bank', ersetzt: r.id });
    if (!c.kontakt && norm(c.kunde) === 'barverkauf') { c.kunde = ''; c.kundeAdresse = ''; }
    faelligSetzen(c);
    D.rechnungen.push(c); App.save();
    App.toast(`${r.nr} storniert · Rechnung als Entwurf angelegt`, { action: { label: 'Rückgängig', fn: () => { const i = D.rechnungen.indexOf(c); if (i >= 0) D.rechnungen.splice(i, 1); undoStorno(); App.save(); App.go('#/beleg/' + r.id); } } });
    App.go('#/beleg/' + c.id);
  }
  function angebotStatus(r, s) {
    if (r.status === s) return;
    const undo = zustandMerken(r);
    r.status = s;
    fertig(s === 'abgelehnt' ? `${r.nr} als abgelehnt markiert` : `${r.nr} wieder offen`, undo);
  }

  /* Vorbereitete Quittung/Rechnung ausstellen – über die EINE Erfassen-Schublade (buchungen.js, prefill.entwurf):
   * sie vergibt die Nummer, bucht die Einnahme bzw. führt die Rechnung als offen und ruft danach App.rerender auf. */
  const perSchublade = (r) => vorbereitet(r) && (r.art === 'quittung' || r.art === 'rechnung');
  const ausstellenText = (r) => (r.art === 'rechnung' ? 'Rechnung schreiben …' : 'Quittung ausstellen …');
  function ausstellenErfassen(r) {
    App.erfassen({ typ: 'einnahme', beleg: r.art, entwurf: r.id, termin: r.termin, kontakt: r.kontakt, betrag: D.rechnungSumme(r), text: r.betreff, datum: D.TODAY });
  }
  /* Vorbereiteten Beleg verwerfen – mit Absage des Termins oder nur die Vorbereitung entfernen (Termin bleibt geplant) */
  function vorbereitungVerwerfen(r, absagen) {
    const t = terminVon(r), i = D.rechnungen.indexOf(r), tVorher = t ? { status: t.status, beleg: t.beleg } : null;
    if (i >= 0) D.rechnungen.splice(i, 1);
    if (t) { t.beleg = null; if (absagen) t.status = 'abgesagt'; }
    work = null; App.save();
    const imBeleg = App.route.id === 'beleg';
    if (imBeleg) App.go('#/rechnungen'); else App.rerender();
    App.toast(absagen ? `Termin abgesagt · vorbereitete ${ART[r.art].label} verworfen` : 'Vorbereitung entfernt · Termin bleibt geplant', { action: { label: 'Rückgängig', fn: () => {
      if (!D.rechnungen.includes(r)) D.rechnungen.splice(Math.min(i, D.rechnungen.length), 0, r);
      if (t) Object.assign(t, tVorher);
      App.save(); if (imBeleg) App.go('#/beleg/' + r.id); else App.rerender();
    } } });
  }
  function verwerfenDialog(r) {
    const t = terminVon(r), frage = t && t.status === 'geplant';
    App.drawer.open({
      id: 'verwerfen', title: `Vorbereitete ${ART[r.art].label} löschen`, sub: t ? `Termin ${esc(terminText(t))} · ${esc(t.kunde || '')}` : '', icon: 'trash', width: 440,
      body: `<section><p>Der Entwurf hat noch keine Nummer – er wird einfach gelöscht, ein Storno ist nicht nötig.</p>
        ${frage ? '<p>Soll der Termin dabei abgesagt werden?</p>' : ''}</section>`,
      foot: `<button type="button" class="btn ghost" data-action="close-drawer">Abbrechen</button>
        <button type="button" class="btn subtle" id="blVorbWeg">${icon('trash')}${frage ? 'Nur Vorbereitung löschen' : 'Löschen'}</button>
        ${frage ? `<button type="button" class="btn danger" id="blTerminAb">${icon('x')}Termin absagen</button>` : ''}`,
      onMount(d) {
        d.querySelector('#blVorbWeg').addEventListener('click', () => { App.drawer.close(); vorbereitungVerwerfen(r, false); });
        const ab = d.querySelector('#blTerminAb'); if (ab) ab.addEventListener('click', () => { App.drawer.close(); vorbereitungVerwerfen(r, true); });
      }
    });
  }

  /* Menüinhalt je Art und Status: Erklärung + mögliche Schritte */
  function statusMenu(r) {
    const s = statusKey(r), I = [];
    const it = (act, ic, label, sub, cls = '') => I.push({ act, ic, label, sub, cls });
    let text = '';
    if (vorbereitet(r)) {
      const t = terminVon(r), hier = App.route.id === 'beleg' && App.route.parts[1] === r.id;
      text = `Vorbereitet${t ? ` für den Termin am ${terminText(t)}` : ''}. Nummer und ${r.art === 'quittung' ? 'Einnahme entstehen' : 'Rechnungsdatum entstehen'} erst beim Ausstellen.`;
      if (!hier) { if (perSchublade(r)) it('ausstellen', r.art === 'rechnung' ? 'invoice' : 'receipt', ausstellenText(r), r.art === 'rechnung' ? 'Nummer vergeben, als offen führen' : 'Nummer vergeben und Einnahme buchen'); else it('oeffnen', 'edit', 'Öffnen …', 'Entwurf prüfen und finalisieren'); }
      if (t) it('termin', 'calendar', 'Zum Termin', terminText(t));
      it('vorb-weg', 'trash', 'Vorbereitung entfernen', 'Termin bleibt geplant');
      if (t && t.status === 'geplant') it('termin-ab', 'x', `Termin absagen (${ART[r.art].label} verwerfen)`, 'Kein Storno nötig – es gibt noch keine Nummer', 'neg');
      return { text, items: I };
    }
    if (r.status === 'storniert') {
      text = `Storniert${r.storniertAm ? ' am ' + fmt.datum(r.storniertAm) : ''} – endgültig (GoBD). Die Nummer bleibt vergeben, der Beleg archiviert.`;
      it('dup', 'copy', 'Duplizieren', 'Mit gleichen Angaben neu als Entwurf');
    } else if (r.art === 'rechnung') {
      if (r.status === 'bezahlt') {
        const b = buchungenZu(r)[0];
        text = `Bezahlt am ${fmt.datum(r.bezahltAm || r.datum)} · ${zaName(r.zahlungsart, 'bank')}${b ? ` · Einnahme ${b.nr}` : ''}.`;
        it('offen', 'reset', 'Doch offen …', 'Versehentlich abgehakt – Einnahme wird zurückgenommen');
      } else {
        text = s === 'ueberfaellig' ? `Seit ${U.diffDays(r.faellig, D.TODAY)} Tagen überfällig (fällig war ${fmt.datum(r.faellig)}).` : `Wartet auf Zahlung – fällig ${fmt.datum(r.faellig)}.`;
        it('paid', 'check', 'Bezahlt …', 'Zahlungseingang mit Datum und Zahlungsweg buchen');
        it('storno', 'x', 'Stornieren …', 'Rechnung ungültig machen, Nummer bleibt vergeben', 'neg');
      }
    } else if (r.art === 'quittung') {
      text = 'Eine Quittung bestätigt, dass bezahlt wurde – ihr Status ist immer „Bezahlt“. War sie ein Versehen, wird sie storniert.';
      it('als-rechnung', 'invoice', 'Als Rechnung neu ausstellen …', 'Storniert die Quittung, legt eine Rechnung als Entwurf an');
      it('storno', 'x', 'Stornieren …', 'Quittung ungültig machen, Einnahme zurücknehmen', 'neg');
    } else if (r.art === 'angebot') {
      if (r.umgewandelt) { text = 'Angenommen und in eine Rechnung umgewandelt.'; it('open-re', 'arrow', 'Rechnung öffnen', ''); }
      else {
        text = r.status === 'abgelehnt' ? 'Der Kunde hat das Angebot abgelehnt.' : `Wartet auf Antwort – gültig bis ${fmt.datum(r.faellig)}.`;
        it('ang-offen', 'clock', 'Offen', 'Wartet auf Antwort des Kunden', r.status === 'offen' ? 'on' : '');
        it('convert', 'arrow', 'Angenommen …', 'In eine Rechnung umwandeln (Entwurf)');
        it('ang-ab', 'x', 'Abgelehnt', 'Kunde hat abgesagt', r.status === 'abgelehnt' ? 'on' : '');
      }
    } else {
      const b = buchungenZu(r)[0];
      text = `Gebucht${b ? ` als Ausgabe ${b.nr}` : ''} – der Eigenbeleg ersetzt den fehlenden Originalbeleg.`;
      it('storno', 'x', 'Stornieren …', 'Eigenbeleg ungültig machen', 'neg');
    }
    return { text, items: I };
  }
  function statusAktion(act, r) {
    if (act === 'paid') bezahltDialog(r);
    else if (act === 'offen') dochOffenDialog(r);
    else if (act === 'storno') stornoDialog(r);
    else if (act === 'als-rechnung') alsRechnungDialog(r);
    else if (act === 'dup') duplizieren(r);
    else if (act === 'convert') umwandeln(r);
    else if (act === 'open-re') App.go('#/beleg/' + r.umgewandelt);
    else if (act === 'ang-ab') angebotStatus(r, 'abgelehnt');
    else if (act === 'ang-offen') angebotStatus(r, 'offen');
    else if (act === 'oeffnen') App.go('#/beleg/' + r.id);
    else if (act === 'ausstellen') ausstellenErfassen(r);
    else if (act === 'termin') App.go('#/termine?t=' + encodeURIComponent(r.termin));
    else if (act === 'vorb-weg') vorbereitungVerwerfen(r, false);
    else if (act === 'termin-ab') vorbereitungVerwerfen(r, true);
  }
  /* Status-Badge als Knopf (ausgestellte Belege); Entwürfe zeigen nur das Badge – sie haben „Finalisieren“ */
  const statusKnopf = (r) => ((r.status === 'entwurf' || !r.nr) && !vorbereitet(r) ? statusBadge(r)
    : `<button type="button" class="bl-stbtn" data-bl="status" data-id="${esc(r.id)}" aria-haspopup="menu" aria-expanded="false" title="Status ändern">${statusBadge(r)}${icon('chevD')}</button>`);
  /* Popover am Knopf (position: fixed im body). Schließt bei Esc, Tab und Klick daneben; beim Scrollen wandert es mit
   * (und schließt, sobald der Knopf aus dem Bild ist). */
  function statusPopover(on) {
    let pop = null, btn = null;
    function zu(fokus = false) {
      if (!pop) return;
      pop.remove(); pop = null;
      if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('open'); if (fokus) btn.focus({ preventScroll: true }); }
      btn = null;
    }
    function platzieren(e) {
      if (!pop || !btn) return;
      const rb = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
      if (e && (!btn.isConnected || rb.bottom < 0 || rb.top > innerHeight)) { zu(); return; } // beim Scrollen aus dem Bild → zu
      let top = rb.bottom + 6;
      if (top + h > innerHeight - 12) top = Math.max(12, rb.top - h - 6);
      pop.style.left = Math.round(Math.min(innerWidth - w - 12, Math.max(12, rb.right - w))) + 'px';
      pop.style.top = Math.round(top) + 'px';
    }
    function auf(b, r) {
      if (!b || !r) return;
      const gleich = btn === b; zu(); if (gleich) return;
      const m = statusMenu(r);
      btn = b; b.setAttribute('aria-expanded', 'true'); b.classList.add('open');
      pop = document.createElement('div');
      pop.className = 'bl-stmenu'; pop.setAttribute('role', 'menu'); pop.setAttribute('aria-label', `Status ${r.nr || ''}`);
      pop.innerHTML = `<div class="bl-st-head">${statusBadge(r)}<p>${esc(m.text)}</p></div>
        ${m.items.map((x) => `<button type="button" class="bl-mi${x.cls ? ' ' + x.cls : ''}" role="menuitem" data-st="${x.act}" tabindex="-1">${icon(x.ic)}<span><b>${esc(x.label)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span>${x.cls === 'on' ? icon('check', 'bl-mi-on') : ''}</button>`).join('')}`;
      document.body.appendChild(pop);
      platzieren();
      pop.addEventListener('click', (e) => { const mi = e.target.closest('[data-st]'); if (!mi) return; zu(); statusAktion(mi.dataset.st, r); });
      pop.addEventListener('keydown', (e) => {
        const L = [...pop.querySelectorAll('.bl-mi')], i = L.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (L.length) L[(i + (e.key === 'ArrowDown' ? 1 : L.length - 1)) % L.length].focus(); }
        else if (e.key === 'Tab') zu();
      });
      const first = pop.querySelector('.bl-mi'); if (first) first.focus({ preventScroll: true });
    }
    on(document, 'keydown', (e) => { if (e.key === 'Escape' && pop) { e.stopPropagation(); zu(true); } }, true);
    on(document, 'pointerdown', (e) => { if (pop && !pop.contains(e.target) && !(btn && btn.contains(e.target))) zu(); });
    on(window, 'scroll', platzieren, true);
    on(window, 'resize', platzieren);
    return { auf, zu, offen: () => !!pop };
  }

  /* ================= Seite: Liste ================= */
  /* Bewusst nur drei Filter – die Art steht in der Spalte „Art“. Offen = offene Rechnungen (unabhängig vom Zeitraum),
   * Bezahlt = bezahlte Rechnungen, Quittungen und gebuchte Eigenbelege; Entwürfe, Angebote, Stornos nur unter „Alle“. */
  const TABS = [
    ['alle', 'Alle', () => true],
    ['offen', 'Offen', (r) => (r.art === 'rechnung' && r.status === 'offen') || (vorbereitet(r) && (terminVon(r) || {}).status === 'geplant')],
    ['bezahlt', 'Bezahlt', (r) => r.status === 'bezahlt' && r.art !== 'angebot']
  ];
  const liste = { tab: 'alle', q: '', sort: 'nr', dir: -1 };
  /* Zeitraum der Liste (nach Belegdatum): bei jedem Start der aktuelle Monat – bewusst nicht gespeichert */
  const ZR = [['monat', 'Monat'], ['jahr', 'Jahr'], ['gesamt', 'Gesamt']];
  const zr = { typ: 'monat', anker: D.TODAY };
  const zrRange = () => (zr.typ === 'gesamt' ? { typ: 'gesamt', von: '', bis: '9999-12-31', label: 'Gesamt' } : App.rangeOf(zr.typ, zr.anker));
  const imZeitraum = (r, p = zrRange()) => (r.datum || '') >= p.von && (r.datum || '') <= p.bis;
  const zrText = (p = zrRange()) => (p.typ === 'gesamt' ? 'alle Zeiträume' : p.typ === 'jahr' ? `im Jahr ${p.label}` : `im ${p.label}`);
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  /* Reiter wechseln; „Offen“ sortiert nach Fälligkeit (älteste überfällige zuerst) */
  function setzeTab(t) {
    if (t === liste.tab) return;
    if (t === 'offen') Object.assign(liste, { sort: 'faellig', dir: 1 });
    else if (liste.sort === 'faellig') Object.assign(liste, { sort: 'nr', dir: -1 });
    liste.tab = t;
  }
  /* Sortierung: Entwürfe oben, dann nach Jahr, Datum und Nummer absteigend (je Art = Nummernfolge).
   * „Fällig / Zahlung“ sortiert nach dem, was in der Spalte steht – bei vorbereiteten Belegen der Termin. */
  const faelligKey = (r) => { const t = vorbereitet(r) && terminVon(r); return (t ? t.datum + ' ' + (t.von || '') : r.faellig || r.datum) || ''; };
  function vergleich(a, b) {
    const k = liste.sort, s = liste.dir;
    if (k === 'betrag') return s * (summe(a) - summe(b));
    if (k === 'kunde') return s * kundeName(a).localeCompare(kundeName(b), 'de');
    if (k === 'faellig') { const fa = faelligKey(a), fb = faelligKey(b); return s * (fa < fb ? -1 : fa > fb ? 1 : 0) || String(a.nr || '').localeCompare(String(b.nr || '')); }
    if (!a.nr !== !b.nr) return a.nr ? 1 : -1;
    if (k === 'datum' || (a.datum !== b.datum && a.art !== b.art)) return s * (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0) || s * String(a.nr || '').localeCompare(String(b.nr || ''));
    return s * String(a.nr || a.datum).localeCompare(String(b.nr || b.datum)) || s * (a.datum < b.datum ? -1 : 1);
  }
  function faelligHTML(r) {
    if (vorbereitet(r)) { const t = terminVon(r); return t ? `<span class="${t.status === 'geplant' && t.datum < D.TODAY ? 'warn-t' : ''}" title="${esc(terminText(t))}">Termin ${terminText(t, false)}</span>` : '<span class="muted">Termin</span>'; }
    if (r.status === 'entwurf') return '<span class="muted">—</span>';
    if (r.status === 'storniert') return `<span class="muted">storniert${r.storniertAm ? ' ' + fmt.datumKurz(r.storniertAm) : ''}</span>`;
    if (r.art === 'rechnung' && r.status === 'offen') {
      const n = U.diffDays(D.TODAY, r.faellig);
      return n < 0 ? `<span class="neg-t">${-n} T. überfällig</span>` : n === 0 ? '<span class="warn-t">heute fällig</span>' : `<span>in ${n} ${n === 1 ? 'Tag' : 'Tagen'}</span>`;
    }
    if (r.art === 'angebot') {
      if (r.umgewandelt) return '<span class="muted">→ Rechnung</span>';
      if (r.status === 'abgelehnt') return '<span class="muted">abgelehnt</span>';
      const n = U.diffDays(D.TODAY, r.faellig || r.datum);
      return n < 0 ? '<span class="muted">abgelaufen</span>' : `<span>gültig noch ${n} T.</span>`;
    }
    if (r.status === 'bezahlt') return `<span class="muted">${r.art === 'eigenbeleg' ? 'gebucht' : r.art === 'quittung' ? esc(zaName(r.zahlungsart)) : 'bezahlt'} · ${fmt.datumKurz(r.bezahltAm || r.datum)}</span>`;
    return '<span class="muted">—</span>';
  }
  function zeileHTML(r) {
    const A = ART[r.art] || ART.rechnung, offen = r.art === 'rechnung' && r.status === 'offen';
    return `<tr class="row${r.status === 'storniert' ? ' is-storno' : ''}${statusKey(r) === 'ueberfaellig' ? ' is-ueber' : ''}" data-id="${esc(r.id)}" tabindex="0">
      <td class="l bl-nr">${r.nr ? `<a href="#/beleg/${esc(r.id)}">${esc(r.nr)}</a>` : `<a class="bl-draftnr" href="#/beleg/${esc(r.id)}">${vorbereitet(r) ? 'Vorbereitet' : 'Entwurf'}</a>`}${r.scan ? `<span class="bl-clip" title="Unterschriebenes Exemplar: ${esc(r.scan)}">${icon('clip')}</span>` : ''}</td>
      <td class="l bl-artc"><span class="bl-art" title="${A.label}">${icon(A.icon)}<span>${A.label}</span></span></td>
      <td class="l bl-kunde">${esc(kundeName(r) || '—')}${r.betreff ? `<small class="bl-sub2">${esc(r.betreff)}</small>` : ''}</td>
      <td class="l bl-betreff">${esc(r.betreff || '—')}</td>
      <td class="num">${fmt.datum(r.datum)}</td>
      <td class="l bl-due">${faelligHTML(r)}</td>
      <td class="num bl-amt">${r.art === 'eigenbeleg' ? '−' : ''}${euro(summe(r))}</td>
      <td class="c">${statusKnopf(r)}</td>
      <td class="bl-acts"><div class="row-acts">
        ${offen ? `<button type="button" class="icon-btn sm ok" data-action="mark-paid" data-id="${esc(r.id)}" title="Als bezahlt markieren (heute, Überweisung)">${icon('check')}</button>` : ''}
        <button type="button" class="icon-btn sm" data-bl="print" data-id="${esc(r.id)}" title="Drucken / PDF">${icon('printer')}</button>
      </div></td></tr>`;
  }
  /* „Neu“-Menü: zeigt die laufenden Nummern. Quittung und Rechnung gibt es nur über die eine Erfassen-Schublade
   * (Einnahme → Beleg zur Einnahme), Angebot und Eigenbeleg (keine Einnahme) direkt in der Maske. */
  const NEU = [
    ['quittung', 'Einnahme mit Quittung erfassen', () => App.erfassen({ typ: 'einnahme', beleg: 'quittung' })],
    ['rechnung', 'Einnahme erfassen – bezahlt oder offen', () => App.erfassen({ typ: 'einnahme', beleg: 'rechnung' })],
    ['angebot', 'Für einen Kunden – noch keine Einnahme', () => App.go('#/beleg/neu?art=angebot')],
    ['eigenbeleg', 'Originalbeleg einer Ausgabe fehlt', () => App.go('#/beleg/neu?art=eigenbeleg')]
  ];
  function neuMenuHTML() {
    const item = ([a, sub]) => `<button type="button" class="bl-mi" role="menuitem" data-neu="${a}" tabindex="-1">${icon(ART[a].icon)}<span><b>${ART[a].label}</b><small>${esc(sub)}</small></span><code>${esc(nextNr(a))}</code></button>`;
    return `<div class="bl-neu">
      <button type="button" class="btn ghost bl-neu-btn" data-bl="neu" aria-haspopup="menu" aria-expanded="false" aria-controls="blNeuMenu" title="Neuer Beleg mit der nächsten laufenden Nummer">Neu${icon('chevD')}</button>
      <div class="bl-menu" id="blNeuMenu" role="menu" aria-label="Neuer Beleg">
        <div class="bl-menu-head">Nächste Nummer</div>
        ${NEU.slice(0, 2).map(item).join('')}<div class="bl-menu-sep" role="separator"></div>${NEU.slice(2).map(item).join('')}
        <p class="bl-menu-foot">${icon('info')}<span>Quittung und Rechnung öffnen „Erfassen“ – derselbe Weg wie „+ Erfassen“ bei Ein- &amp; Ausgänge (${kbd('N')}).</span></p>
      </div></div>`;
  }
  function renderListe(el, route) {
    const ac = new AbortController(), on = (t, ev, fn, cap = false) => t.addEventListener(ev, fn, { signal: ac.signal, capture: cap });
    if (route.params.tab) setzeTab(TABS.some((t) => t[0] === route.params.tab) ? route.params.tab : 'alle'); // alte Links (?tab=quittung …) → Alle
    if (route.params.zeitraum && ZR.some((z) => z[0] === route.params.zeitraum)) zr.typ = route.params.zeitraum;
    const R = D.rechnungen;
    const ersterTag = R.reduce((m, r) => (r.datum && r.datum < m ? r.datum : m), D.TODAY);
    // › reicht bis heute – oder bis zum spätesten Beleg (vorbereitet für einen Termin im nächsten Monat/Jahr)
    const letzterTag = R.reduce((m, r) => (r.datum && r.datum > m ? r.datum : m), D.TODAY);
    /* Adresse spiegelt Reiter und Zeitraum (Neuzeichnen, Zurück, Lesezeichen) */
    const listenHash = () => { const q = new URLSearchParams(); if (liste.tab !== 'alle') q.set('tab', liste.tab); if (zr.typ !== 'monat') q.set('zeitraum', zr.typ); const s = q.toString(); return '#/rechnungen' + (s ? '?' + s : ''); };
    const hashSync = () => { const h = listenHash(); if (location.hash !== h) history.replaceState(null, '', h); };
    el.innerHTML = `<div class="page bl-list">
      <div class="page-head reveal">
        <div><h1>${icon('invoice')}Rechnungen & Quittungen</h1><p class="page-sub">Alle Belege mit laufender Nummer · es zählt das Belegdatum</p></div>
        <div class="page-actions">
          <div class="bl-zrwrap" data-slot="zr"></div>
          <a class="btn ghost" href="#/vorlagen" title="Quittung & Rechnung aus Bausteinen gestalten">${icon('blocks')}Vorlagen</a>
          ${neuMenuHTML()}
        </div>
      </div>
      <section class="card flush bl-tablecard reveal" style="--i:1">
        <div class="bl-tabs">
          <div class="bl-tabsl"><div data-slot="tabs"></div><span class="bl-zrhint" data-slot="hint"></span></div>
          <label class="bl-filter">${icon('search')}<input class="input sm" type="search" data-bl-filter placeholder="Nr., Kunde, Betreff, Betrag …" value="${esc(liste.q)}" aria-label="Belege filtern"></label>
        </div>
        <div class="table-wrap"><table class="fin-table bl-table">
          <thead><tr>
            <th class="l sortable" data-sort="nr">Nr.</th><th class="l">Art</th><th class="l sortable" data-sort="kunde">Kunde</th><th class="l bl-c-betreff">Betreff</th>
            <th class="sortable" data-sort="datum">Datum</th><th class="l sortable" data-sort="faellig">Fällig / Zahlung</th><th class="sortable" data-sort="betrag">Betrag</th><th class="c">Status</th><th class="bl-c-acts"></th>
          </tr></thead>
          <tbody data-slot="rows"></tbody>
        </table></div>
        <div class="bl-tfoot" data-slot="foot"></div>
      </section>
      <p class="proto-note reveal" style="--i:2">${icon('info')}<span>„Drucken / PDF“ öffnet den Druckdialog des Browsers – dort „Als PDF sichern“ wählen. Die Mac-App erzeugt das PDF mit LaTeX aus derselben Vorlage und legt es als Beleg ab.</span></p>
    </div>`;

    /* Zeitraum-Umschalter + Reiter (Zähler beziehen sich auf den Zeitraum – außer „Offen“: immer alle offenen) */
    const suche = () => norm(liste.q.trim());
    function kopf() {
      const p = zrRange(), q = suche(), ohneZr = !!q || liste.tab === 'offen';
      const nav = p.typ === 'gesamt' ? '' : `<div class="period-nav">
          <button type="button" class="icon-btn sm" data-bl="zr-prev" title="${p.typ === 'monat' ? 'Vorheriger Monat' : 'Vorheriges Jahr'}"${p.von <= ersterTag ? ' disabled' : ''}>${icon('chevL')}</button>
          <b>${esc(p.label)}</b>
          <button type="button" class="icon-btn sm" data-bl="zr-next" title="${p.typ === 'monat' ? 'Nächster Monat' : 'Nächstes Jahr'}"${App.shiftAnchor(p.von, p.typ, 1) > letzterTag ? ' disabled' : ''}>${icon('chevR')}</button></div>`;
      const hinweis = q ? 'Suche über alle Zeiträume' : liste.tab === 'offen' ? 'alle offenen, unabhängig vom Zeitraum' : '';
      $('[data-slot="zr"]', el).innerHTML = `<div class="period bl-zr${ohneZr ? ' aus' : ''}"${ohneZr ? ` title="${hinweis}"` : ''}>${App.seg('local', 'zeitraum', ZR, zr.typ)}${nav}</div>`;
      $('[data-slot="hint"]', el).innerHTML = hinweis ? `${icon('info')}${hinweis}` : '';
      const imZr = R.filter((r) => imZeitraum(r, p)), nUeber = R.filter((r) => statusKey(r) === 'ueberfaellig').length;
      const tabLabel = ([k, l, f]) => [k, `${l} <span class="cnt${k === 'offen' && nUeber ? ' alarm' : ''}"${k === 'offen' && nUeber ? ` title="${nUeber} überfällig"` : ''}>${(k === 'offen' ? R : imZr).filter(f).length}</span>`];
      $('[data-slot="tabs"]', el).innerHTML = App.seg('local', 'tab', TABS.map(tabLabel), liste.tab, 'tabs');
      requestAnimationFrame(() => App.updateSegs(el));
    }
    function leerHTML(q, p) {
      if (q) return `<b>Nichts gefunden</b><span>Keine Belege zu „${esc(liste.q)}“ – in keinem Zeitraum.</span>`;
      if (liste.tab === 'offen') return '<b>Nichts offen</b><span>Alle Rechnungen bezahlt, nichts für Termine vorbereitet.</span>';
      const im = p.typ === 'jahr' ? `Im Jahr ${esc(p.label)}` : `Im ${esc(p.label)}`, was = liste.tab === 'bezahlt' ? 'nichts bezahlt' : 'keine Belege';
      if (p.typ !== 'gesamt') return `<b>${im} noch ${was}</b><button type="button" class="link" data-bl="zr-gesamt">Gesamt anzeigen${icon('arrow')}</button>`;
      return liste.tab === 'bezahlt' ? '<b>Noch nichts bezahlt</b>' : '<b>Noch keine Belege</b><span>Quittungen und Rechnungen entstehen über „+ Erfassen“ → Einnahme.</span>';
    }
    function tabelle() {
      const f = (TABS.find((t) => t[0] === liste.tab) || TABS[0])[2];
      const q = suche(), p = zrRange();
      // Suche und „Offen“ gelten über alle Zeiträume, sonst nur der gewählte Zeitraum
      const basis = q || liste.tab === 'offen' ? R : R.filter((r) => imZeitraum(r, p));
      const rows = basis.filter(f).filter((r) => !q || norm(`${r.nr || 'entwurf'} ${kundeName(r)} ${r.betreff} ${euro(summe(r))} ${ART[r.art] ? ART[r.art].label : ''} ${r.scan || ''}`).includes(q)).sort(vergleich);
      $('[data-slot="rows"]', el).innerHTML = rows.map(zeileHTML).join('') || `<tr><td colspan="9"><div class="empty">${icon(liste.tab === 'offen' && !q ? 'check' : 'invoice')}${leerHTML(q, p)}</div></td></tr>`;
      $$('th[data-sort]', el).forEach((th) => { th.classList.toggle('on', th.dataset.sort === liste.sort); th.dataset.dir = th.dataset.sort === liste.sort ? (liste.dir < 0 ? '↓' : '↑') : ''; });
      // nur Anzahl + Zeitraum – Summen stehen in der Auswertung
      const n = rows.length, ue = rows.filter((r) => statusKey(r) === 'ueberfaellig').length;
      $('[data-slot="foot"]', el).innerHTML = q ? `<span>${n} ${n === 1 ? 'Treffer' : 'Treffer'} · alle Zeiträume</span>`
        : liste.tab === 'offen' ? (() => { const nv = rows.filter(vorbereitet).length, nr = n - nv; return `<span>${nr} ${nr === 1 ? 'offene Rechnung' : 'offene Rechnungen'}${nv ? ` · ${nv} vorbereitet für Termine` : ''}${ue ? ` · <span class="neg-t">${ue} überfällig</span>` : ''} · unabhängig vom Zeitraum</span>`; })()
          : `<span>${n} ${n === 1 ? 'Beleg' : 'Belege'} · ${p.typ === 'gesamt' ? 'alle Zeiträume' : esc(p.label)}</span>`;
    }
    function alles() { kopf(); tabelle(); hashSync(); }
    alles();

    /* ---------- Neu-Menü (Popover): schließt bei Klick daneben, Esc und Tab ---------- */
    const menu = $('.bl-neu', el), mBtn = $('[data-bl="neu"]', menu);
    const items = () => $$('.bl-mi', menu);
    const offen = () => menu.classList.contains('open');
    function menuAuf(an, fokus = true) {
      // Steht der Knopf links (schmales Fenster, Kopf umgebrochen), klappt das Menü nach rechts auf
      if (an) menu.classList.toggle('links', mBtn.getBoundingClientRect().right - $('.bl-menu', menu).offsetWidth < el.getBoundingClientRect().left);
      menu.classList.toggle('open', an); mBtn.setAttribute('aria-expanded', String(an));
      if (an && fokus) items()[0].focus();
    }
    on(mBtn, 'click', () => menuAuf(!offen()));
    on(menu, 'click', (e) => {
      const mi = e.target.closest('[data-neu]'); if (!mi) return;
      menuAuf(false, false);
      const n = NEU.find((x) => x[0] === mi.dataset.neu); if (n) n[2]();
    });
    on(menu, 'keydown', (e) => {
      if (!offen()) { if (e.key === 'ArrowDown' && e.target === mBtn) { e.preventDefault(); menuAuf(true); } return; }
      const L = items(), i = L.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); L[(i + (e.key === 'ArrowDown' ? 1 : L.length - 1)) % L.length].focus(); }
      else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); L[e.key === 'Home' ? 0 : L.length - 1].focus(); }
      else if (e.key === 'Tab') menuAuf(false, false);
    });
    on(document, 'keydown', (e) => { if (e.key === 'Escape' && offen()) { e.stopPropagation(); menuAuf(false, false); mBtn.focus(); } }, true);
    on(document, 'pointerdown', (e) => { if (offen() && !menu.contains(e.target)) menuAuf(false, false); });
    /* ---------- Status-Menü an den Badges ---------- */
    const sp = statusPopover(on);

    on(el, 'seg-change', (e) => {
      if (e.detail.key === 'tab') { setzeTab(e.detail.value); kopf(); tabelle(); hashSync(); }
      else if (e.detail.key === 'zeitraum') { zr.typ = e.detail.value; alles(); }
    });
    let tSuche = 0;
    on(el, 'input', (e) => {
      if (!e.target.matches('[data-bl-filter]')) return;
      const vorher = !!suche(); liste.q = e.target.value;
      tabelle(); if (vorher !== !!suche()) { clearTimeout(tSuche); tSuche = setTimeout(kopf, 0); } // Hinweis „alle Zeiträume“ ein/aus
    });
    on(el, 'click', (e) => {
      const z = e.target.closest('[data-bl^="zr-"]');
      if (z) {
        const a = z.dataset.bl, p = zrRange();
        if (a === 'zr-gesamt') zr.typ = 'gesamt';
        else { const n = App.shiftAnchor(p.von, p.typ, a === 'zr-prev' ? -1 : 1); if (n > letzterTag) return; zr.anker = n; }
        alles(); return;
      }
      const sb = e.target.closest('[data-bl="status"]');
      if (sb) { sp.auf(sb, D.rechnungen.find((x) => x.id === sb.dataset.id)); return; }
      const th = e.target.closest('th[data-sort]');
      if (th) { const k = th.dataset.sort; liste.dir = liste.sort === k ? -liste.dir : k === 'kunde' || k === 'faellig' ? 1 : -1; liste.sort = k; tabelle(); return; }
      const pb = e.target.closest('[data-bl="print"]');
      if (pb) { const r = D.rechnungen.find((x) => x.id === pb.dataset.id); if (r) { if (einfrieren(r)) App.save(); print(r); } return; }
      if (e.target.closest('.row-acts') || e.target.closest('a') || e.target.closest('.bl-neu')) return;
      const tr = e.target.closest('tr.row[data-id]');
      if (tr) App.go('#/beleg/' + tr.dataset.id);
    });
    on(el, 'keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('tr.row[data-id]')) App.go('#/beleg/' + e.target.dataset.id); });
    return () => { ac.abort(); sp.zu(); clearTimeout(tSuche); };
  }

  /* ================= Seite: Beleg (Eingabemaske) ================= */
  let work = null; // ungespeicherter Arbeitsstand { hash, doc, dirty, multi, zeitraum }
  // Seitenwechsel verwirft den Arbeitsstand – unabhängig davon, ob core.js schon neu gerendert hat (Zeitstempel)
  window.addEventListener('hashchange', (e) => { if (work && work.t < e.timeStamp) work = null; });
  const prefs = { fit: App.LS.get('gb.belege.fit', 'page') };

  function normalize(d, editierbar) {
    d.art = ART[d.art] ? d.art : 'quittung';
    d.positionen = (d.positionen || []).map((p) => ({ text: p.text || '', menge: p.menge ?? 1, einheit: p.einheit || '', preis: p.preis || 0 }));
    if (d.kundeAdresse == null) d.kundeAdresse = '';
    if (d.kunde == null) d.kunde = '';
    if (d.ziel == null) d.ziel = d.faellig && d.datum && d.faellig !== d.datum ? Math.max(0, U.diffDays(d.datum, d.faellig)) : d.art === 'angebot' ? 30 : D.FIRMA.zahlungszielTage || 14;
    if (TEXTE[d.art]) { if (d.einleitung == null) d.einleitung = standardText(d, 'einleitung'); if (d.schluss == null) d.schluss = standardText(d, 'schluss'); }
    if (d.qr == null) d.qr = d.art === 'rechnung';
    // nur Bar / Überweisung / PayPal; alte Werte (z. B. Karte) laufen wie eine Überweisung übers Konto
    if (!zaGueltig(d.zahlungsart)) d.zahlungsart = d.zahlungsart || d.art === 'rechnung' || d.art === 'angebot' ? 'bank' : 'bar';
    if (d.art === 'eigenbeleg') { d.grund ||= 'verloren'; if (!D.kat(d.kat) || D.kat(d.kat).typ !== 'ausgabe') d.kat = ausgabeStd(); }
    if (editierbar) {
      // vorbereiteter Beleg für einen künftigen Termin: ausgestellt (und kassiert) wird heute
      if (vorbereitet(d) && d.datum > D.TODAY) { if (d.leistung === d.datum) d.leistung = D.TODAY; d.datum = D.TODAY; }
      if ((d.art === 'rechnung' || d.art === 'angebot') && !d.positionen.length) d.positionen.push({ text: '', menge: 1, einheit: 'Stk.', preis: 0 });
      if ((d.art === 'quittung' || d.art === 'eigenbeleg') && !d.positionen.length) d.positionen.push({ text: d.betreff || '', menge: 1, einheit: d.art === 'quittung' ? 'Stk.' : '', preis: 0 });
      faelligSetzen(d);
    }
    return d;
  }
  /* Neuer Beleg aus der Adresse – v. a. aus der Erfassen-Schublade („Beleg zur Einnahme“), dem Neu-Menü oder der Kundenseite:
   * art, betrag (Cent), datum, text, kontakt (Kunden-ID) | kunde (Name), adresse, buchung (schon erfasster Ein-/Ausgang,
   * wird verknüpft statt doppelt gebucht), vorlage, zahlungsart, bezahlt=1 (Rechnung ist schon bezahlt) */
  function neuerBeleg(p) {
    const art = ART[p.art] ? p.art : 'quittung', t = D.TODAY;
    const b = (p.buchung || p.b) ? D.buchungen.find((x) => x.id === (p.buchung || p.b)) || null : null;
    const datum = /^\d{4}-\d\d-\d\d$/.test(p.datum || '') ? p.datum : (b && b.datum) || t;
    const d = { id: null, art, nr: null, status: 'entwurf', kontakt: null, kunde: '', kundeAdresse: '', datum, leistung: datum, leistungBis: '', betreff: String(p.text || (b && b.text) || '').trim(), positionen: [], bezahltAm: null };
    const cent = Math.max(0, parseInt(p.betrag, 10) || 0) || (b ? b.betrag : 0);
    const za = p.zahlungsart || p.za;
    if (zaGueltig(za)) d.zahlungsart = za; else if (b && zaGueltig(b.zahlungsart)) d.zahlungsart = b.zahlungsart;
    if (p.vorlage && (p.vorlage === 'mitgeliefert' || (D.VORLAGEN || []).some((v) => v.id === p.vorlage && v.art === art))) d.vorlage = p.vorlage;
    if (art === 'eigenbeleg') {
      // Zahlungsempfänger ist kein Kunde, sondern ein Geschäft o. Ä. (Freitext wie b.lieferant)
      const pk = p.kontakt && D.kontakt(p.kontakt);
      d.kunde = String(p.kunde || p.lieferant || (pk && pk.name) || (b && b.lieferant) || '').trim();
      d.kundeAdresse = String(p.adresse || '').trim();
      // Kategorie: in der Schublade gewählt (p.kat) → die der erfassten Ausgabe → Standard
      const istAusgabeKat = (id) => !!(id && D.kat(id) && D.kat(id).typ === 'ausgabe');
      d.grund = 'verloren'; d.kat = istAusgabeKat(p.kat) ? p.kat : b && istAusgabeKat(b.kat) ? b.kat : ausgabeStd();
      if (b && b.typ === 'ausgabe') d.buchung = b.id;
    } else {
      // Kunde per ID, sonst per Name/Nummer (nur eindeutig – bei Namensvettern fragt die Maske nach),
      // einen neuen erst beim Festschreiben anlegen; der Name im Beleg steht immer ohne Nummer
      const name = String(p.kunde || (b && b.kunde) || '').trim();
      const k = (p.kontakt && D.kontakt(p.kontakt)) || (b && b.kontakt && D.kontakt(b.kontakt)) || findeKontakt(name);
      if (k) { d.kontakt = k.id; if (art === 'quittung') { d.kunde = k.name; d.kundeAdresse = String(p.adresse || '').trim() || adresseText(k); } }
      else { d.kunde = name ? App.kundeAusEingabe(name).name : ''; d.kundeAdresse = String(p.adresse || '').trim(); }
      if (art !== 'angebot' && b && b.typ === 'einnahme' && !b.rechnung) d.buchung = b.id;
      if (art === 'rechnung' && (d.buchung || p.bezahlt === '1' || p.status === 'bezahlt')) d.bezahltAm = d.buchung ? b.datum : d.datum;
    }
    if (art === 'quittung' || art === 'eigenbeleg' || cent || d.betreff) d.positionen = [{ text: d.betreff, menge: 1, einheit: art === 'quittung' ? 'Stk.' : art === 'eigenbeleg' ? '' : 'pausch.', preis: cent }];
    return normalize(d, true);
  }

  function renderBeleg(el, route) {
    const ac = new AbortController(), on = (t, ev, fn, cap = false) => t.addEventListener(ev, fn, { signal: ac.signal, capture: cap });
    const id = route.parts[1] || 'neu', isNew = id === 'neu';
    const orig = isNew ? null : D.rechnungen.find((r) => r.id === id);
    if (orig && einfrieren(orig)) App.save(); // GoBD: alter Beleg bekommt beim Öffnen seinen Schnappschuss
    if (!isNew && !orig) {
      el.innerHTML = `<div class="page"><div class="card"><div class="empty">${icon('info')}<b>Beleg nicht gefunden</b><span>Vielleicht wurde der Entwurf gelöscht.</span><a class="link" href="#/rechnungen">${icon('chevL')}Zu Rechnungen & Quittungen</a></div></div></div>`;
      return null;
    }
    const editable = () => isNew || orig.status === 'entwurf';
    const keep = work && work.hash === location.hash && work.dirty && editable();
    const w = keep ? work : (work = { hash: location.hash, t: performance.now(), doc: isNew ? neuerBeleg(route.params) : normalize(clone(orig), orig.status === 'entwurf'), dirty: false });
    const doc = w.doc;
    // Entwurf mit Kundennamen, aber ohne Bindung (z. B. gespeichert, bevor es den Kunden gab): eindeutigen Kunden binden
    if (!keep && editable() && doc.art !== 'eigenbeleg' && !doc.kontakt && String(doc.kunde || '').trim()) {
      const k = findeKontakt(doc.kunde); if (k) { doc.kontakt = k.id; w.perName = k.id; if (doc.art !== 'quittung') doc.kunde = ''; }
    }
    if (w.multi == null) w.multi = doc.art === 'quittung' && doc.positionen.length > 1;
    if (w.zeitraum == null) w.zeitraum = !!(doc.leistungBis && doc.leistungBis !== doc.leistung);
    let blatt = null, tPrev = 0, druckRestore = null;
    const F = D.FIRMA;
    const einzel = () => doc.art === 'eigenbeleg' || (doc.art === 'quittung' && !w.multi);
    const erste = () => { if (!doc.positionen.length) doc.positionen.push({ text: doc.betreff || '', menge: 1, einheit: doc.art === 'quittung' ? 'Stk.' : '', preis: 0 }); return doc.positionen[0]; };

    /* ---------- Karten ---------- */
    const karte = (key, titel, ic, body, i, kopfRechts = '') => `<section class="card bl-card reveal" style="--i:${i}" data-card="${key}">
      <div class="card-head"><div class="card-title">${icon(ic)}${titel}</div>${kopfRechts}</div>${body}</section>`;
    const val = (v) => esc(v ?? '');
    const segZA = () => App.seg('local', 'zahlungsart', zahlungswege(), doc.zahlungsart, 'full bl-zaseg');
    const verknuepft = () => (doc.buchung && D.buchungen.find((x) => x.id === doc.buchung)) || null;
    const kundenLink = (k) => `<a class="link bl-klink" href="#/kunden?k=${encodeURIComponent(k.id)}" title="${esc(k.name)} auf der Kundenseite öffnen">Kundenseite${icon('arrowUR')}</a>`;
    const belegeVon = (k) => { const n = D.rechnungen.filter((r) => r.kontakt === k.id && r.nr).length; return n ? `${n} ${n === 1 ? 'Beleg' : 'Belege'}` : 'noch keine Belege'; };

    /* Ausgestellt, aber der Kunde wurde seitdem geändert → kurzer Hinweis (der Beleg bleibt, wie er ist) */
    function geaendertHTML() {
      const k = !editable() && doc.kontakt && D.kontakt(doc.kontakt), e = empfaenger(doc);
      return k && (k.name !== e.name || adresseText(k) !== e.zeilen.join('\n')) ? `<p class="hint bl-snap">${icon('info')} Die Kundendaten wurden inzwischen geändert – dieser Beleg bleibt, wie er ausgestellt wurde.</p>` : '';
    }
    /* Kundenfeld: gebunden wird über die feste Nummer. Im Feld steht dann „Name · K-0012“ (Entwurf), auf dem Beleg nur der Name.
     * Gleichnamige Kunden ohne Nummer → nachfragen (kundeWahl); „Neuer Kunde mit diesem Namen“ merkt w.kundeNeu (normierter Name). */
    const kundeFeld = () => { const k = editable() && doc.kontakt && D.kontakt(doc.kontakt); return k ? App.kundenLabel(k) : null; };
    function kundeWahl() {
      if (!editable() || doc.art === 'eigenbeleg' || doc.kontakt) return null;
      const n = norm(String(doc.kunde || '').trim());
      if (!n || n === 'barverkauf' || w.kundeNeu === n) return null;
      const a = App.kundeAusEingabe(doc.kunde);
      return a.liste.length > 1 ? a : null;
    }
    function kundeWahlHTML(a) {
      return `<div class="bl-kwahl" role="group" aria-label="Welcher Kunde?"><p>${icon('alert')}<span>Mehrere Kunden heißen „${esc(a.name)}“ – wer ist gemeint?</span></p>
        ${a.liste.map((k) => { const t = [kundenNr(k), App.kundenOrt(k) || 'ohne Adresse', zuletzt(k)]; return `<button type="button" class="bl-kwahl-k" data-bl="kunde-wahl" data-k="${esc(k.id)}" title="${esc(t.join(' · '))}" aria-label="${esc(`${k.name} · ${t.join(' · ')}`)}"><b>${esc(t[0])}</b><span>${esc(t[1])}</span><small>${esc(t[2])}</small></button>`; }).join('')}
        <button type="button" class="bl-mini bl-kwahl-neu" data-bl="kunde-neu">${icon('plus')}Neuer Kunde mit diesem Namen</button></div>`;
    }
    function kKunde(i) {
      const name = !editable() ? empfaenger(doc).name : kundeFeld() || doc.kunde;
      return karte('kunde', 'Kunde', 'users', `<div class="bl-stack">
        <label class="bl-search">${icon('search')}<input class="input" data-f="kundeName" list="bl-kunden" value="${val(name)}" placeholder="Name eingeben – vorhandene Kunden werden vorgeschlagen" autocomplete="off" aria-label="Kunde"></label>
        <div data-slot="kundeinfo">${kundeInfoHTML()}</div></div>`, i);
    }
    function kundeInfoHTML() {
      const k = doc.kontakt && D.kontakt(doc.kontakt), wahl = kundeWahl();
      if (wahl) return kundeWahlHTML(wahl);
      if (!editable()) { // ausgestellt: Schnappschuss zeigen – so steht es auf dem Beleg; der Kunde ist nur verlinkt
        const e = empfaenger(doc);
        return `<div class="bl-addr">${App.monogram(e.anzeige || '?')}<div class="bl-addr-t"><b>${esc(e.anzeige || '—')}</b>${e.zeilen.map((l) => `<span>${esc(l)}</span>`).join('')}</div>
          <div class="bl-addr-m">${e.nr ? `<span class="chip strong">${esc(e.nr)}</span>` : ''}${k ? `<small>${belegeVon(k)}</small>${kundenLink(k)}` : ''}</div></div>${geaendertHTML()}`;
      }
      if (k) {
        return `<div class="bl-addr">${App.monogram(k.name)}<div class="bl-addr-t"><b>${esc(k.name)}</b>${adresseText(k).split('\n').filter(Boolean).map((l) => `<span>${esc(l)}</span>`).join('')}</div>
          <div class="bl-addr-m"><span class="chip strong">${esc(kundenNr(k))}</span><small>${belegeVon(k)}</small>${kundenLink(k)}</div></div>${andereHTML(k)}`;
      }
      if (String(doc.kunde || '').trim()) {
        return `<div class="field"><label>Anschrift <span class="badge accent">Neuer Kunde</span></label>
          <textarea class="textarea" rows="3" data-f="kundeAdresse" placeholder="Straße und Hausnummer&#10;PLZ Ort">${val(doc.kundeAdresse)}</textarea>
          <span class="hint">${neuText()}${zurueckHTML()}</span></div>`;
      }
      return `<p class="hint">${icon('info')} Name und Anschrift des Kunden gehören zu den Pflichtangaben einer Rechnung.</p>`;
    }
    /* Quittung: Kunde ist verknüpft (Nummer + Link) oder wird beim Festschreiben neu angelegt */
    function qKundeHTML() {
      const k = doc.kontakt && D.kontakt(doc.kontakt), name = String(doc.kunde || '').trim(), wahl = kundeWahl();
      if (wahl) return kundeWahlHTML(wahl);
      if (k) return `<div class="bl-kref">${App.monogram(k.name, 'xs')}<span>Kunde <b class="mono">${esc(empfaenger(doc).nr)}</b> · ${belegeVon(k)}</span>${kundenLink(k)}</div>${geaendertHTML()}${andereHTML(k)}`;
      if (editable() && name && name.toLowerCase() !== 'barverkauf') return `<div class="bl-kref"><span class="badge accent">Neuer Kunde</span><span>${neuText()}</span>${zurueckHTML()}</div>`;
      return '';
    }
    /* Per bloßem Namen gebunden → dezent anbieten, eine andere Person gleichen Namens als neuen Kunden anzulegen */
    const andereHTML = (k) => (editable() && w.perName === k.id ? `<p class="bl-kandere"><button type="button" class="bl-mini" data-bl="kunde-andere">Andere Person? Als neuen Kunden anlegen</button></p>` : '');
    /* Neuer Kunde (trotz gleichnamiger) – mit Rückweg zum vorhandenen bzw. zur Auswahl */
    const neuText = () => {
      const n = norm(String(doc.kunde || '').trim());
      if (w.kundeNeu !== n) return doc.art === 'quittung' ? 'wird beim Festschreiben angelegt' : 'Wird beim Finalisieren als Kunde angelegt.';
      const q = `„${esc(String(doc.kunde).trim())}“ mit eigener Nummer`;
      return doc.art === 'quittung' ? `${q} – wird beim Festschreiben angelegt` : `Neuer Kunde ${q} – wird beim Finalisieren angelegt.`;
    };
    function zurueckHTML() {
      const n = norm(String(doc.kunde || '').trim()); if (!n || w.kundeNeu !== n) return '';
      const z = w.zurueck && D.kontakt(w.zurueck);
      if (z && norm(z.name) === n) return ` <button type="button" class="bl-mini" data-bl="kunde-zurueck" data-k="${esc(z.id)}">Doch ${esc(kundenNr(z))} nehmen</button>`;
      return App.kundeAusEingabe(doc.kunde).liste.length > 1 ? ' <button type="button" class="bl-mini" data-bl="kunde-zurueck">Doch einen vorhandenen wählen</button>' : '';
    }
    function kDaten(i) {
      const ang = doc.art === 'angebot';
      const chips = (ang ? [14, 30, 60] : [7, 14, 30]).map((n) => `<button type="button" class="chip${+doc.ziel === n ? ' on' : ''}" data-bl="ziel" data-v="${n}">${n}</button>`).join('');
      const leistung = ang ? '' : `<div class="field"><label>${w.zeitraum ? 'Leistung vom' : 'Leistungsdatum'}<span class="spacer"></span><button type="button" class="bl-mini" data-bl="zeitraum">${w.zeitraum ? 'Einzelnes Datum' : 'Zeitraum'}</button></label>
        <input type="date" class="input" data-f="leistung" value="${val(doc.leistung)}"></div>${w.zeitraum ? `<div class="field"><label>bis</label><input type="date" class="input" data-f="leistungBis" value="${val(doc.leistungBis)}" min="${val(doc.leistung)}"></div>` : ''}`;
      return karte('daten', ang ? 'Angebotsdaten' : 'Rechnungsdaten', 'calendar', `<div class="form-grid">
        <div class="field"><label>${ang ? 'Angebotsdatum' : 'Rechnungsdatum'}</label><input type="date" class="input" data-f="datum" value="${val(doc.datum)}"></div>
        ${leistung}
        <div class="field"><label>${ang ? 'Gültig' : 'Zahlungsziel'}</label><div class="input-wrap"><input type="number" class="input num" data-f="ziel" data-type="int" min="0" max="365" value="${+doc.ziel || 0}"><span class="suffix">Tage</span></div>
          <div class="bl-zielrow"><span class="hint" data-live="faellig"></span><span class="chips">${chips}</span></div></div>
        <div class="field full"><label>Betreff</label><input class="input" data-f="betreff" value="${val(doc.betreff)}" placeholder="z. B. Gartenpflege Oktober"></div>
      </div>`, i);
    }
    function kPositionen(i) {
      return karte('positionen', 'Leistungen', 'list', `<div class="bl-stack">
        <div class="field"><label>Einleitung</label><textarea class="textarea" rows="2" data-f="einleitung">${val(doc.einleitung)}</textarea></div>
        ${posEditorHTML()}
        <div class="field"><label>Schlusstext <span class="muted">(optional)</span></label><textarea class="textarea" rows="2" data-f="schluss" placeholder="z. B. Ich freue mich auf die weitere Zusammenarbeit.">${val(doc.schluss)}</textarea></div>
      </div>`, i, '<span class="muted bl-count" data-live="poscount"></span>');
    }
    function posEditorHTML() {
      return `<div class="bl-pos-ed"><div class="bl-pos-list">${posRowsHTML()}</div>
        <button type="button" class="btn ghost bl-pos-add" data-bl="pos-add">${icon('plus')}Position hinzufügen</button>
        <div class="bl-pos-total"><span>Gesamtbetrag<small>umsatzsteuerfrei nach § 19 UStG</small></span><b class="num" data-live="sum"></b></div></div>`;
    }
    function posRowsHTML() {
      return doc.positionen.map((p, i) => `<div class="bl-pos" data-i="${i}">
        <button type="button" class="bl-pos-grip" title="Ziehen zum Sortieren (oder ↑ / ↓)" aria-label="Position ${i + 1} verschieben"><span>${i + 1}</span>${icon('grip')}</button>
        <input class="input sm bl-pos-text" data-p="text" list="bl-postexte" value="${val(p.text)}" placeholder="Beschreibung der Leistung" aria-label="Beschreibung">
        <button type="button" class="icon-btn sm bl-pos-del" data-bl="pos-del" title="Position entfernen" aria-label="Position ${i + 1} entfernen">${icon('trash')}</button>
        <div class="bl-pos-line2">
          <input class="input sm num" data-p="menge" inputmode="decimal" value="${menge(p.menge)}" aria-label="Menge">
          <input class="input sm" data-p="einheit" list="bl-einheiten" value="${val(p.einheit)}" placeholder="Einheit" aria-label="Einheit">
          <span class="bl-pos-op">×</span>
          <div class="input-wrap"><input class="input sm money" data-p="preis" inputmode="decimal" value="${App.num((p.preis || 0) / 100, 2)}" aria-label="Einzelpreis"><span class="suffix">€</span></div>
          <span class="bl-pos-op">=</span>
          <b class="bl-pos-sum num" data-rowsum>${euro(Math.round(p.menge * p.preis))}</b>
        </div></div>`).join('');
    }
    function kZahlung(i) {
      // Aus „+ Erfassen“ → Rechnung, bereits bezahlt: kein Zahlungsziel/GiroCode, Einnahme wird verknüpft bzw. mitgebucht
      if (editable() && doc.bezahltAm) {
        const b = verknuepft();
        return karte('zahlung', 'Zahlung', 'check', `<div class="bl-stack">
          <div class="bl-note ok">${icon('check')}<span><b>Schon bezahlt</b> am ${fmt.datum(doc.bezahltAm)}${b ? ` · gehört zur erfassten Einnahme <b class="mono">${esc(b.nr)}</b> – es entsteht keine zweite.` : ' · die Einnahme wird beim Finalisieren gleich mitgebucht.'}</span></div>
          ${b ? '' : `<div class="field"><label>Zahlungsweg</label>${segZA()}</div>`}
          <div><button type="button" class="bl-mini" data-bl="noch-offen">Doch noch offen – mit Zahlungsziel und GiroCode</button></div></div>`, i);
      }
      return karte('zahlung', 'Zahlung', 'bank', `<div class="bl-stack">
        <div class="toggle-row"><span>GiroCode (QR) zum Bezahlen anzeigen<small>Betrag, IBAN und Verwendungszweck sind beim Scannen schon ausgefüllt.</small></span><label class="switch"><input type="checkbox" data-f="qr"${doc.qr ? ' checked' : ''}><span></span></label></div>
        <div class="bl-bank">${icon('bank')}<div><b>${esc(F.bank)}</b><span class="mono">${esc(ibanFmt(F.iban))}</span><small>BIC ${esc(F.bic)} · Empfänger ${esc(F.name)}</small></div></div>
        <div data-live="qrerr"></div></div>`, i);
    }
    function kPflicht(i) {
      const t = doc.art === 'eigenbeleg' ? 'Angaben im Eigenbeleg' : `Pflichtangaben <span class="muted">${doc.art === 'quittung' ? '§ 33/§ 34a UStDV' : '§ 34a UStDV'}</span>`;
      return karte('pflicht', t, 'check', '<ul class="bl-check" data-live="pflicht"></ul>', i, '<span data-live="pflichtsum"></span>');
    }
    function betragFeld() {
      const p = doc.positionen[0];
      return `<div class="input-wrap bl-money"><input class="input money-input" data-f="betrag" data-type="money" inputmode="decimal" value="${p && p.preis ? geld(p.preis) : ''}" placeholder="0,00" aria-label="Betrag"><span class="suffix">€</span></div>`;
    }
    function kQBetrag(i) {
      const b = editable() && verknuepft();
      return karte('betrag', 'Betrag', 'cash', `<div class="bl-stack">
        ${w.multi ? posEditorHTML() : betragFeld()}
        <div class="bl-worte"><small>in Worten</small><span data-live="worte"></span></div>
        <div data-live="kb"></div>
        ${b ? `<div class="bl-note ok">${icon('clip')}<span>Gehört zur erfassten Einnahme <b class="mono">${esc(b.nr)}</b> („${esc(b.text)}“) – es entsteht keine zweite.</span></div>` : ''}
        <div class="toggle-row"><span>Mehrere Positionen aufführen<small>Für mehrere Artikel – die Summe wird zum Betrag.</small></span><label class="switch"><input type="checkbox" data-f="_multi"${w.multi ? ' checked' : ''}><span></span></label></div>
      </div>`, i);
    }
    function kQAngaben(i) {
      return karte('angaben', 'Angaben', 'receipt', `<div class="bl-stack">
        <div class="field"><label>Erhalten von <span class="muted">(Kunde · optional bis 250 €)</span></label>
          <div class="bl-search">${icon('search')}<input class="input" data-f="kunde" list="bl-kunden" value="${val(kundeFeld() || doc.kunde)}" placeholder="Barverkauf – oder Name, Kunden werden vorgeschlagen" autocomplete="off" aria-label="Erhalten von"></div>
          <div data-slot="qkunde">${qKundeHTML()}</div></div>
        <div class="field"><label>Anschrift <span class="muted">(optional)</span></label><textarea class="textarea" rows="2" data-f="kundeAdresse" placeholder="Straße und Hausnummer&#10;PLZ Ort">${val(doc.kundeAdresse)}</textarea></div>
        <div class="field"><label>Für (Leistung / Gegenstand)</label><input class="input" data-f="betreff" value="${val(doc.betreff)}" placeholder="z. B. Rasenmähen inkl. Kantenschnitt" list="bl-postexte"></div>
        <div class="form-grid"><div class="field"><label>Datum</label><input type="date" class="input" data-f="datum" value="${val(doc.datum)}"></div>
          <div class="field full"><label>Zahlungsweg</label>${segZA()}</div></div>
      </div>`, i);
    }
    function kEBInfo(i) {
      return `<div class="bl-info reveal" style="--i:${i}" data-card="ebinfo">${icon('info')}<div><b>Eigenbeleg = Ersatzbeleg</b>
        <p>Für Ausgaben, deren Originalbeleg fehlt: verloren, unleserlich oder gar nicht erhältlich (Parkautomat, Trinkgeld). Mit Datum, Betrag, Empfänger, Zweck, Grund und deiner Unterschrift wird er in der Regel anerkannt – aber nur als Ausnahme. Wo es geht, lieber eine Rechnungskopie anfordern.</p></div></div>`;
    }
    function kEBZahlung(i) {
      const b = verknuepft();
      return karte('ebzahlung', 'Zahlung', 'cash', `<div class="bl-stack">
        ${betragFeld()}
        <div class="bl-worte"><small>in Worten</small><span data-live="worte"></span></div>
        <div class="form-grid"><div class="field"><label>Datum der Zahlung</label><input type="date" class="input" data-f="datum" value="${val(doc.datum)}" max="${D.TODAY}"></div>
          <div class="field full"><label>Zahlungsweg</label>${segZA()}</div>
          <div class="field full"><label id="blKatL">Kategorie</label><div class="bl-kats" role="radiogroup" aria-labelledby="blKatL">${ausgabeKats().map((k) => `<label class="bl-kat${k.id === doc.kat ? ' on' : ''}" style="--k:${esc(k.farbe || 'var(--accent)')}" title="${esc((k.stichworte || []).join(', ') || k.euer || '')}"><input type="radio" name="bl-kat" data-f="kat" value="${esc(k.id)}"${k.id === doc.kat ? ' checked' : ''}>${k.icon && App.ICONS[k.icon] ? icon(k.icon) : '<i class="dot"></i>'}<span>${esc(k.name)}</span></label>`).join('')}</div></div></div>
        ${b ? `<div class="bl-note ok">${icon('clip')}<span>${editable() ? 'Wird an die erfasste Ausgabe' : 'Angehängt an die Ausgabe'} <b class="mono">${esc(b.nr)}</b> („${esc(b.text)}“)${editable() ? ' angehängt – es entsteht keine zweite.' : ''}</span></div>` : ''}
      </div>`, i);
    }
    function kEBEmpf(i) {
      return karte('empf', 'Zahlungsempfänger', 'shop', `<div class="bl-stack">
        <div class="field"><label>Name <span class="muted">(Geschäft, kein Kunde)</span></label><input class="input" data-f="kunde" list="bl-empf" value="${val(doc.kunde)}" placeholder="z. B. Parkhaus am Markt" autocomplete="off"></div>
        <div class="field"><label>Anschrift <span class="muted">(soweit bekannt)</span></label><textarea class="textarea" rows="2" data-f="kundeAdresse" placeholder="Straße und Hausnummer&#10;PLZ Ort">${val(doc.kundeAdresse)}</textarea></div>
      </div>`, i);
    }
    function kEBZweck(i) {
      return karte('zweck', 'Gegenstand & Grund', 'edit', `<div class="bl-stack">
        <div class="field"><label>Gegenstand / Zweck der Ausgabe</label><textarea class="textarea" rows="2" data-f="betreff" placeholder="z. B. Parkgebühr beim Kundentermin">${val(doc.betreff)}</textarea></div>
        <div class="field"><label>Grund für den Eigenbeleg</label><select class="select" data-f="grund">${GRUENDE.map(([k, l]) => `<option value="${k}"${k === doc.grund ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        ${doc.grund === 'sonstiges' ? `<div class="field"><label>Grund (Beschreibung)</label><input class="input" data-f="grundText" value="${val(doc.grundText)}" placeholder="Warum gibt es keinen Originalbeleg?"></div>` : ''}
      </div>`, i);
    }
    const KARTEN = { kunde: kKunde, daten: kDaten, positionen: kPositionen, zahlung: kZahlung, pflicht: kPflicht, betrag: kQBetrag, angaben: kQAngaben, ebinfo: kEBInfo, ebzahlung: kEBZahlung, empf: kEBEmpf, zweck: kEBZweck };
    const LAYOUT = { rechnung: ['kunde', 'daten', 'positionen', 'zahlung', 'pflicht'], angebot: ['kunde', 'daten', 'positionen'], quittung: ['betrag', 'angaben', 'pflicht'], eigenbeleg: ['ebinfo', 'ebzahlung', 'empf', 'zweck', 'pflicht'] };

    /* ---------- Live-Teile (ändern sich beim Tippen) ---------- */
    function untertitel() {
      const e = empfaenger(doc), t = summe(doc), a = doc.art, teile = [];
      if (a === 'eigenbeleg') teile.push(e.name ? `an ${esc(e.name)}` : 'Empfänger fehlt', `<b class="num">${euro(t)}</b>`, esc((D.kat(doc.kat) || {}).name || ''));
      else teile.push(esc(e.anzeige || 'Noch kein Kunde'), `<b class="num">${euro(t)}</b>`);
      if (a === 'quittung' || a === 'eigenbeleg') teile.push(esc(zaName(doc.zahlungsart)));
      if (a === 'rechnung' && editable() && doc.bezahltAm) teile.push(`schon bezahlt · ${esc(zaName(doc.zahlungsart, 'bank'))}`);
      if (!editable() && orig.datum) teile.push(fmt.datum(orig.datum));
      return teile.filter(Boolean).join(' · ');
    }
    function pflichtListe() {
      const L = pflichtCheck(doc), a = kundeWahl();
      if (a) L.unshift({ label: 'Kunde eindeutig', ok: false, hint: `Mehrere Kunden heißen „${a.name}“ – bitte wählen, wer gemeint ist` });
      return L;
    }
    const LIVE = {
      sub: untertitel,
      nr: () => (editable() ? `${icon('lock')}wird <b class="mono">${nextNr(doc.art, doc.datum)}</b>` : ''),
      sum: () => euro(summe(doc)),
      worte: () => esc(wortBetrag(summe(doc))),
      poscount: () => `${doc.positionen.length} ${doc.positionen.length === 1 ? 'Position' : 'Positionen'}`,
      faellig: () => (doc.art === 'angebot' ? `gültig bis ${datumWT(doc.faellig)}` : +doc.ziel ? `fällig am ${datumWT(doc.faellig)}` : 'sofort fällig'),
      kb: () => {
        const t = summe(doc), g = kleinbetrag(doc);
        return t <= g ? `<div class="bl-note ok">${icon('check')}<span><b>Kleinbetragsrechnung</b> (bis ${euro(g)}, § 33 UStDV) – Name und Anschrift des Kunden sind nicht nötig.</span></div>`
          : `<div class="bl-note warn">${icon('alert')}<span><b>Über ${euro(g)}:</b> Name und Anschrift des Kunden sind Pflicht.</span></div>`;
      },
      pflicht: () => pflichtListe().map((c) => { const s = c.ok ? (c.offen ? 'info' : 'ok') : 'fail'; return `<li class="${s}"><span class="st">${icon(s === 'ok' ? 'check' : s === 'fail' ? 'x' : 'clock')}</span><b>${esc(c.label)}</b><small>${esc(c.hint || '')}</small></li>`; }).join(''),
      pflichtsum: () => { const L = pflichtListe(), bad = L.filter((c) => !c.ok).length; return bad ? `<span class="badge neg">${bad} fehlt</span>` : '<span class="badge pos">vollständig</span>'; },
      qrerr: () => {
        if (!doc.qr) return '';
        const g = epcFor(doc);
        if (g.ok) return `<div class="bl-note ok">${icon('qr')}<span>GiroCode bereit – Verwendungszweck <b class="mono">${esc(doc.nr || 'Entwurf')}</b>, Betrag ${euro(summe(doc))}.</span></div>`;
        return `<div class="bl-note neg">${icon('alert')}<span><b>GiroCode kann nicht erzeugt werden</b><br>${(g.fehler || []).map(esc).join(' · ')}</span></div>`;
      },
      dirty: () => (w.dirty ? '<i></i>Nicht gespeichert' : orig ? `${icon('check')}Gespeichert` : ''),
      status: statusInfo
    };
    function statusInfo() {
      if (!orig || editable()) return '';
      const r = orig, b = D.buchungen.find((x) => x.id === r.buchung) || D.buchungen.find((x) => x.rechnung === r.id);
      const bl = b ? ` · <a class="link mono" href="#/buchungen?b=${esc(b.id)}">${esc(b.nr)}</a>` : '';
      if (r.status === 'storniert') return `${icon('x')}Storniert${r.storniertAm ? ' am ' + fmt.datum(r.storniertAm) : ''}`;
      if (r.art === 'rechnung' && r.status === 'offen') { const n = U.diffDays(D.TODAY, r.faellig); return n < 0 ? `<span class="neg-t">${icon('alert')}${-n} Tage überfällig</span> · fällig war ${fmt.datum(r.faellig)}` : `${icon('clock')}fällig ${fmt.rel(r.faellig)} · ${fmt.datum(r.faellig)}`; }
      if (r.art === 'angebot') return r.umgewandelt ? `${icon('check')}In Rechnung umgewandelt · <a class="link" href="#/beleg/${esc(r.umgewandelt)}">öffnen</a>` : r.status === 'abgelehnt' ? `${icon('x')}Vom Kunden abgelehnt` : `${icon('clock')}gültig bis ${fmt.datum(r.faellig)}`;
      if (r.status === 'bezahlt') return `${icon('check')}${r.art === 'eigenbeleg' ? 'Ausgabe gebucht' : r.art === 'quittung' ? `${esc(zaName(r.zahlungsart))} erhalten` : `Bezahlt (${esc(zaName(r.zahlungsart, 'bank'))})`} am ${fmt.datum(r.bezahltAm || r.datum)}${bl}`;
      return '';
    }
    function live() {
      $$('[data-live]', el).forEach((n) => { const f = LIVE[n.dataset.live]; if (f) n.innerHTML = f(); });
      $$('[data-bl="final"]', el).forEach((b) => { b.title = `Nummer ${nextNr(doc.art, doc.datum)} vergeben und festschreiben`; });
    }

    /* ---------- Aufbau ---------- */
    function kopfHTML() {
      const A = ART[doc.art];
      const titel = !editable() && orig.nr ? orig.nr : isNew ? A.neu : A.label;
      const rechts = [];
      // Art im Entwurf umschaltbar; „?“ erklärt den Unterschied Quittung ↔ Rechnung
      if (editable()) rechts.push(`<div class="bl-artwrap">${App.seg('local', 'art', ARTEN.map((a) => [a, icon(ART[a].icon) + ART[a].label]), doc.art, 'bl-artseg')}<button type="button" class="q bl-artq" data-tip="${esc(ART_TIPP)}" data-tip-title="Quittung oder Rechnung?" aria-label="Unterschied zwischen Quittung und Rechnung">?</button></div>`);
      if (!isNew && orig.status === 'entwurf') rechts.push(`<button type="button" class="btn ghost" data-bl="delete">${icon('trash')}Löschen</button>`);
      if (!editable()) {
        rechts.push(`<button type="button" class="btn ghost" data-bl="dup">${icon('copy')}Duplizieren</button>`); // Stornieren u. a. im Status-Menü am Badge
      }
      return `<div class="bl-head reveal">
        <div class="bl-htitle"><a class="bl-back" href="#/rechnungen">${icon('chevL')}Rechnungen & Quittungen</a>
          <h1>${icon(A.icon)}<span>${esc(titel)}</span>${isNew ? '<span class="badge entwurf">Neu</span>' : statusKnopf(orig)}<span class="bl-willnr" data-live="nr"></span></h1>
          <div class="page-sub" data-live="sub"></div></div>
        <div class="page-actions">${rechts.join('')}</div></div>`;
    }
    /* Hinweisleiste für vorbereitete Belege: zu welchem Termin, mit Link zur Terminseite */
    function terminHTML() {
      if (!vorbereitet(doc)) return '';
      const t = terminVon(doc);
      return `<div class="bl-termin reveal" data-card="termin">${icon('calendar')}<div><b>Vorbereitet für den Termin am ${t ? esc(terminText(t)) : '—'}${t && t.kunde ? ` · ${esc(t.kunde)}` : ''}</b>
        <span>Nummer${doc.art === 'quittung' ? ' und Einnahme entstehen' : ' entsteht'} erst beim Ausstellen.${t && t.status !== 'geplant' ? ` Der Termin ist ${t.status === 'abgesagt' ? 'abgesagt' : 'erledigt'}.` : ''}</span></div>
        ${t ? `<a class="link" href="#/termine?t=${encodeURIComponent(t.id)}">Zum Termin${icon('arrowUR')}</a>` : ''}</div>`;
    }
    function sperrHTML() {
      const s = orig.status === 'storniert';
      return `<div class="bl-lock reveal">${icon('lock')}<div><b>Finalisiert – Änderungen nur per Storno (GoBD)</b>
        <span>${s ? 'Dieser Beleg ist storniert und bleibt unverändert archiviert.' : 'Nummer, Datum und Beträge sind festgeschrieben. Für Korrekturen stornieren und neu erstellen – oder duplizieren.'}</span></div></div>`;
    }
    /* Vorlage wählen (Standard, eigene Vorlagen der Art, mitgelieferte); finalisiert = eingefroren */
    function vorlageHTML() {
      const V = (Array.isArray(D.VORLAGEN) ? D.VORLAGEN : []).filter((v) => v.art === doc.art);
      const ic = icon('blocks');
      if (!editable()) {
        const v = V.find((x) => x.id === orig.vorlage);
        return `<span class="bl-vl" title="${orig.bloecke ? 'Layout beim Finalisieren eingefroren' : ''}">${ic}Vorlage <b>${esc(orig.vorlage === 'mitgeliefert' ? 'Mitgeliefert' : v ? v.name : 'Standard')}</b></span>`;
      }
      const std = V.find((v) => v.standard);
      const opts = [['', std ? `Standard · ${std.name}` : 'Standard'], ...V.filter((v) => !v.standard).map((v) => [v.id, v.name])];
      if (std) opts.push(['mitgeliefert', 'Mitgelieferte Vorlage']);
      return `<label class="bl-vl">${ic}<span>Vorlage</span><select class="select sm" data-f="vorlage" aria-label="Vorlage">${opts.map(([v, l]) => `<option value="${esc(v)}"${(doc.vorlage || '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <a class="icon-btn sm" href="#/vorlagen?art=${doc.art}" title="Vorlagen bearbeiten">${icon('edit')}</a>`;
    }
    /* Unterschriebenes Exemplar (Scan/Foto) – darf auch nach dem Finalisieren angehängt werden */
    function scanHTML() {
      const s = orig.scan;
      const sub = orig.art === 'eigenbeleg' ? 'Ausdrucken, unterschreiben, einscannen – gehört zum Beleg.' : 'Optional: Scan oder Foto des unterschriebenen Belegs.';
      return `<section class="card bl-card bl-scan reveal" style="--i:1" data-card="scan">
        <div class="card-head"><div><div class="card-title">${icon('clip')}Unterschriebenes Exemplar</div><div class="card-sub">${sub}</div></div></div>
        ${s ? `<div class="file-chip">${icon('file')}<b title="${esc(s)}">${esc(s)}</b><span class="badge bezahlt">angehängt</span><button type="button" class="icon-btn sm" data-bl="scan-weg" title="Anhang entfernen">${icon('x')}</button></div>`
        : `<label class="dropzone bl-drop">${icon('upload')}<span><b>Datei hierher ziehen</b> oder klicken zum Auswählen</span><small>PDF oder Foto</small><input type="file" accept="application/pdf,image/*" data-bl-scan hidden></label>`}
      </section>`;
    }
    function scanSetzen(file) {
      if (!file || !orig) return;
      orig.scan = file.name; App.save();
      const k = $('[data-card="scan"]', el); if (k) k.outerHTML = scanHTML().replace(' reveal', '');
      App.toast(`„${file.name}“ an ${orig.nr || 'den Beleg'} angehängt`);
    }
    function aktionenHTML() {
      if (editable()) {
        const kopf = `<span class="bl-dirty" data-live="dirty"></span><span class="spacer"></span>
          <button type="button" class="btn subtle" data-bl="save" title="${kbd('S')}">Als Entwurf speichern</button>`;
        // vorbereitet für einen Termin: ausgestellt wird über die Erfassen-Schublade (der eine Weg für Eingänge)
        if (perSchublade(doc)) return `${kopf}<button type="button" class="btn-primary sm" data-bl="ausstellen" title="Öffnet „Erfassen“ – dort wird die Nummer vergeben${doc.art === 'quittung' ? ' und die Einnahme gebucht' : ''}">${icon(doc.art === 'rechnung' ? 'invoice' : 'receipt')}${ausstellenText(doc)}</button>`;
        const lbl = { rechnung: doc.bezahltAm ? 'Finalisieren & buchen' : 'Finalisieren', angebot: 'Finalisieren', quittung: 'Finalisieren & buchen', eigenbeleg: 'Buchen' }[doc.art];
        return `${kopf}<button type="button" class="btn-primary sm" data-bl="final">${icon(doc.art === 'eigenbeleg' ? 'stamp' : 'lock')}${lbl}</button>`;
      }
      const info = '<span class="bl-status" data-live="status"></span><span class="spacer"></span>';
      if (orig.art === 'rechnung' && orig.status === 'offen') return `${info}<button type="button" class="btn-primary sm" data-bl="paid">${icon('check')}Als bezahlt markieren</button>`;
      if (orig.art === 'angebot' && orig.status === 'offen' && !orig.umgewandelt) return `${info}<button type="button" class="btn-primary sm" data-bl="convert">${icon('arrow')}In Rechnung umwandeln</button>`;
      return `${info}<button type="button" class="btn ghost" data-bl="print">${icon('printer')}Drucken / PDF</button>`;
    }
    function datalists() {
      const vorl = new Map();
      D.rechnungen.forEach((r) => (r.positionen || []).forEach((p) => { if (p.text && !vorl.has(p.text)) vorl.set(p.text, p); }));
      // Zahlungsempfänger für Eigenbelege: Geschäfte aus den bisherigen Ausgaben (häufigste zuerst) + typische Fälle ohne Beleg
      const n = new Map();
      D.buchungen.forEach((b) => { const l = b.typ === 'ausgabe' && String(b.lieferant || '').trim(); if (l) n.set(l, (n.get(l) || 0) + 1); });
      const lief = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')).map((x) => x[0]).concat(['Parkautomat', 'Parkhaus', 'Tankstelle (Automat)', 'Wertstoffhof', 'Trinkgeld']);
      return `<datalist id="bl-einheiten">${EINHEITEN.map((x) => `<option value="${x}">`).join('')}</datalist>
        <datalist id="bl-postexte">${[...vorl.keys()].slice(0, 60).map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        <datalist id="bl-kunden">${App.kundenOptionen()}</datalist>
        <datalist id="bl-empf">${[...new Set(lief)].map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`;
    }
    const topH = () => ($('#topbar') || {}).offsetHeight || 68;
    function draw() {
      const ed = editable();
      el.innerHTML = `<div class="page bl-page">
        ${kopfHTML()}
        <div class="bl-grid">
          <div class="bl-form">
            ${ed ? terminHTML() : sperrHTML() + scanHTML()}
            <fieldset class="bl-fs"${ed ? '' : ' disabled'}>${LAYOUT[doc.art].map((k, i) => KARTEN[k](i + 1)).join('')}</fieldset>
            <div class="bl-actions">${aktionenHTML()}</div>
          </div>
          <aside class="bl-preview reveal" style="--i:2" aria-label="Vorschau">
            <div class="bl-ptools">
              <div class="bl-pinfo">${vorlageHTML()}</div>
              <div class="row">${App.seg('local', 'fit', [['page', 'Seite'], ['width', 'Breite']], prefs.fit)}
                <button type="button" class="btn ghost" data-bl="print" title="Nur das Blatt drucken – im Dialog „Als PDF sichern“ wählen (${kbd('P')})">${icon('printer')}Drucken / PDF</button></div>
            </div>
            <div class="bl-desk"></div>
            <div class="bl-pcap" data-pages>${ART[doc.art].format === 'a4' ? 'A4 hoch' : 'A5 quer'}</div>
          </aside>
        </div>${datalists()}</div>`;
      if (blatt) blatt.destroy();
      blatt = mount($('.bl-desk', el), doc, {
        fit: prefs.fit,
        maxHeight: () => innerHeight - topH() - 14 - (($('.bl-ptools', el) || {}).offsetHeight || 36) - 10 - 44 - 40,
        onFit: ({ pages, format: f }) => { const c = $('[data-pages]', el); if (c) c.textContent = `${f === 'a4' ? 'A4 hoch' : 'A5 quer'} · ${pages} ${pages === 1 ? 'Seite' : 'Seiten'} · 1:1 gedruckt, ohne Skalierung`; }
      });
      live();
      requestAnimationFrame(() => App.updateSegs(el));
    }
    function redraw(key) {
      const alt = $(`[data-card="${key}"]`, el); if (!alt || !KARTEN[key]) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = KARTEN[key](+alt.style.getPropertyValue('--i') || 0).trim();
      const neu = tmp.firstElementChild; neu.classList.remove('reveal');
      alt.replaceWith(neu); live(); App.updateSegs(neu);
    }
    function redrawPos() { const l = $('.bl-pos-list', el); if (l) l.innerHTML = posRowsHTML(); live(); }
    const vorschau = () => { clearTimeout(tPrev); tPrev = setTimeout(() => blatt && blatt.update(doc), 120); };
    function changed() { w.dirty = true; if (editable()) faelligSetzen(doc); live(); vorschau(); }

    /* ---------- Felder ---------- */
    /* Kundenhinweis neu zeichnen, wenn sich der Zustand ändert (kein Kunde → neuer Name → bekannter Kunde) */
    const zustand = () => {
      if (doc.kontakt) return 'k:' + doc.kontakt + (w.perName === doc.kontakt ? ':name' : '');
      const n = norm(String(doc.kunde || '').trim());
      return !n || n === 'barverkauf' ? '' : kundeWahl() ? 'wahl:' + n : w.kundeNeu === n ? 'neu:eigen' : 'neu';
    };
    let kundeZustand = zustand();
    function kundeSlot() {
      const z = zustand(); if (z === kundeZustand) return;
      kundeZustand = z;
      const s = $('[data-slot="kundeinfo"], [data-slot="qkunde"]', el); if (s) s.innerHTML = doc.art === 'quittung' ? qKundeHTML() : kundeInfoHTML();
    }
    /* Eingabe im Kundenfeld → Kunde (Nummer oder eindeutiger Name); gleicher Name wie der schon gebundene → bleibt gebunden.
     * perName: nur per bloßem Namen gebunden (dann gibt es „Andere Person? Als neuen Kunden anlegen“). Nach „Neuer Kunde mit
     * diesem Namen“ bzw. „Andere Person?“ (w.kundeNeu) bleibt derselbe Name ungebunden, bis eine Nummer gewählt wird. */
    function kundeAusFeld(v) {
      const a = App.kundeAusEingabe(v), alt = doc.kontakt ? D.kontakt(doc.kontakt) : null, mitNr = /\bK-\d{3,}\b/i.test(v);
      let k = a.k, perName = !!(a.k && !mitNr);
      if (!k && alt && a.name && norm(alt.name) === norm(a.name)) { k = alt; perName = w.perName === alt.id; }
      if (k && !mitNr && w.kundeNeu && w.kundeNeu === norm(a.name)) { k = null; perName = false; }
      if (k || w.kundeNeu !== norm(a.name)) { w.kundeNeu = ''; w.zurueck = null; }
      w.perName = k && perName ? k.id : null;
      return { k, alt, name: a.name };
    }
    /* Auswahl („Mehrere Kunden heißen …“ bzw. „Doch K-0012 nehmen“): binden, Feld = „Name · K-0012“, Anschrift übernehmen */
    function kundeWaehlen(k, perName = false) {
      if (!k) return;
      doc.kontakt = k.id; w.kundeNeu = ''; w.zurueck = null; w.perName = perName ? k.id : null;
      if (doc.art === 'quittung') { doc.kunde = k.name; doc.kundeAdresse = adresseText(k); const ta = $('[data-f="kundeAdresse"]', el); if (ta) ta.value = doc.kundeAdresse; }
      else { doc.kunde = ''; doc.kundeAdresse = ''; }
      const f = $('[data-f="kundeName"], [data-card="angaben"] [data-f="kunde"]', el); if (f) f.value = App.kundenLabel(k);
      kundeSlot(); changed();
    }
    /* „Andere Person? Als neuen Kunden anlegen“: Bindung lösen, beim Finalisieren entsteht ein neuer Kunde mit eigener Nummer */
    function kundeAndere() {
      const k = doc.kontakt && D.kontakt(doc.kontakt); if (!k) return;
      w.kundeNeu = norm(k.name); w.zurueck = k.id; w.perName = null;
      doc.kontakt = null; doc.kunde = k.name;
      if (doc.kundeAdresse === adresseText(k)) doc.kundeAdresse = ''; // Anschrift gehört zur anderen Person
      const ta = $('[data-f="kundeAdresse"]', el); if (ta) ta.value = doc.kundeAdresse;
      const f = $('[data-f="kundeName"], [data-card="angaben"] [data-f="kunde"]', el); if (f) f.value = k.name;
      kundeSlot(); changed();
      const ta2 = $('[data-f="kundeAdresse"]', el); if (ta2) ta2.focus();
    }
    const SET = {
      betrag(v) { const p = erste(); p.preis = v; p.menge = 1; },
      betreff(v) { doc.betreff = v; if (einzel()) erste().text = v; },
      kundeName(v) {
        const { k, name } = kundeAusFeld(v);
        if (k) { doc.kontakt = k.id; doc.kunde = ''; } else { doc.kontakt = null; doc.kunde = name; }
        kundeSlot();
      },
      kunde(v) {
        if (doc.art !== 'quittung') { doc.kunde = v; return; } // Eigenbeleg: Zahlungsempfänger ist Freitext, kein Kunde
        // Quittung: bekannten Kunden verknüpfen und seine Anschrift übernehmen, solange sie nicht von Hand geändert wurde
        const { k, alt, name } = kundeAusFeld(v);
        doc.kunde = name; // auf dem Beleg nur der Name, ohne Nummer
        if (k !== alt) {
          doc.kontakt = k ? k.id : null;
          if (!String(doc.kundeAdresse).trim() || doc.kundeAdresse === adresseText(alt)) {
            doc.kundeAdresse = k ? adresseText(k) : '';
            const ta = $('[data-f="kundeAdresse"]', el); if (ta) ta.value = doc.kundeAdresse;
          }
        }
        kundeSlot();
      },
      _multi(v) {
        w.multi = v;
        if (!v) doc.positionen = [{ text: doc.betreff || '', menge: 1, einheit: 'Stk.', preis: summe(doc) }];
        else if (doc.positionen.length === 1 && !doc.positionen[0].text) doc.positionen[0].text = doc.betreff || '';
        redraw('betrag');
      },
      datum(v) {
        if (doc.leistung === doc.datum && !w.zeitraum) doc.leistung = v;
        if (doc.bezahltAm && doc.bezahltAm === doc.datum && !verknuepft()) doc.bezahltAm = v; // „bei Ausstellung bezahlt“ wandert mit
        doc.datum = v;
      },
      leistung(v) { doc.leistung = v; if (doc.leistungBis && doc.leistungBis < v) doc.leistungBis = v; },
      ziel(v) { doc.ziel = v; $$('[data-bl="ziel"]', el).forEach((c) => c.classList.toggle('on', +c.dataset.v === v)); },
      grund(v) { doc.grund = v; redraw('zweck'); },
      kat(v) { doc.kat = v; $$('.bl-kat', el).forEach((l) => l.classList.toggle('on', l.querySelector('input').value === v)); }
    };
    function lese(t) {
      if (t.type === 'checkbox') return t.checked;
      if (t.dataset.type === 'money') { const v = parseCent(t.value); const bad = !isFinite(v) || v < 0; t.classList.toggle('invalid', bad); return bad ? undefined : v; }
      if (t.dataset.type === 'int') { const v = parseInt(t.value, 10); return isFinite(v) ? Math.max(0, Math.min(365, v)) : 0; }
      return t.value;
    }
    function setze(f, v) {
      if (SET[f]) return SET[f](v);
      if (f[0] === '_') return;
      doc[f] = v;
    }

    /* ---------- Aktionen ---------- */
    /* Beim Festschreiben: Kunde verknüpfen bzw. neu anlegen (gleicher Name → vorhandenen nehmen) und – GoBD –
     * Name/Anschrift/Kunden-Nr. als Schnappschuss in den Beleg schreiben (Quittung: so wie in der Maske erfasst). */
    function kundeFesthalten() {
      const name = String(doc.kunde || '').trim();
      if (doc.art === 'eigenbeleg' || (!name && !doc.kontakt) || norm(name) === 'barverkauf') return;
      // gebundener Kunde (feste Nummer) zählt – kein erneutes Suchen per Name; sonst nur ein eindeutiger Name,
      // außer „Neuer Kunde mit diesem Namen“ wurde gewählt (mehrdeutige Namen hält der Pflicht-Check vorher auf)
      let k = (doc.kontakt && D.kontakt(doc.kontakt)) || (w.kundeNeu === norm(name) ? null : findeKontakt(name));
      if (!k) { k = kundeAnlegen(name, doc.kundeAdresse); w.neuerKunde = k; }
      else if (!k.strasse && String(doc.kundeAdresse).trim()) { const a = parseAdresse(doc.kundeAdresse); if (a.strasse || a.ort) Object.assign(k, { strasse: a.strasse, plz: a.plz, ort: a.ort }); } // fehlende Anschrift ergänzen
      doc.kontakt = k.id;
      if (doc.art === 'quittung') { doc.kunde = name || k.name; if (!String(doc.kundeAdresse).trim()) doc.kundeAdresse = adresseText(k); doc.kundeNr = kundenNr(k); }
      else schnappschuss(doc, k);
    }
    function speichern() {
      const out = clone(doc);
      Object.keys(out).forEach((k) => { if (k[0] === '_') delete out[k]; });
      const leer = (p) => !String(p.text).trim() && !p.preis;
      if (out.positionen.some((p) => !leer(p))) out.positionen = out.positionen.filter((p) => !leer(p));
      if (orig) { Object.keys(orig).forEach((k) => { if (!(k in out)) delete orig[k]; }); Object.assign(orig, out); return orig; }
      out.id = 'r' + Date.now().toString(36);
      D.rechnungen.push(out);
      return out;
    }
    function alsEntwurf() {
      if (!editable()) return;
      doc.status = 'entwurf';
      const r = speichern();
      App.save(); w.dirty = false;
      App.toast(isNew ? `Entwurf gespeichert · Nummer wird erst beim Finalisieren vergeben` : 'Entwurf gespeichert');
      if (isNew) App.go('#/beleg/' + r.id); else App.rerender();
    }
    function finalisieren() {
      if (!editable()) return;
      // Namensvetter ohne Wahl: erst klären, wer gemeint ist (sonst entstünde still ein falscher oder doppelter Kunde)
      const wahl = kundeWahl();
      if (wahl) {
        App.toast(`Mehrere Kunden heißen „${wahl.name}“ – bitte wählen, wer gemeint ist`, { icon: 'alert', ms: 4600 });
        const k = $('.bl-kwahl', el);
        if (k) { k.scrollIntoView({ behavior: App.settings.motion === 'full' ? 'smooth' : 'auto', block: 'center' }); k.classList.remove('bl-shake'); void k.offsetWidth; k.classList.add('bl-shake'); const b = $('.bl-kwahl-k', k); if (b) b.focus({ preventScroll: true }); }
        return;
      }
      const fehlt = pflichtListe().filter((c) => !c.ok).map((c) => c.label);
      const e = empfaenger(doc);
      if (doc.art === 'angebot' && !e.name) fehlt.push('Kunde');
      if (summe(doc) <= 0 && !fehlt.some((l) => /Betrag|Entgelt/.test(l))) fehlt.push('Betrag');
      if (!doc.datum) fehlt.push('Datum');
      if (fehlt.length) {
        App.toast(`Noch nicht vollständig: ${[...new Set(fehlt)].join(' · ')}`, { icon: 'alert', ms: 4600 });
        const k = $('[data-card="pflicht"]', el) || $('.bl-card', el);
        if (k) { k.scrollIntoView({ behavior: App.settings.motion === 'full' ? 'smooth' : 'auto', block: 'center' }); k.classList.remove('bl-shake'); void k.offsetWidth; k.classList.add('bl-shake'); }
        return;
      }
      if (doc.art === 'quittung' && !String(doc.kunde).trim() && !doc.kontakt) doc.kunde = 'Barverkauf';
      if (vorbereitet(doc) && doc.datum > D.TODAY) { if (doc.leistung === doc.datum) doc.leistung = D.TODAY; doc.datum = D.TODAY; }
      const termin = vorbereitet(doc) ? terminVon(doc) : null;
      kundeFesthalten();
      doc.nr = nextNr(doc.art, doc.datum);
      doc.erstellt = D.TODAY;
      doc.bloecke = clone(vorlage(doc.art, doc.vorlage)); // Layout einfrieren (GoBD: Nachdruck sieht gleich aus)
      if (doc.art !== 'eigenbeleg') doc.kat = D.kat(doc.kat) && D.kat(doc.kat).typ === 'einnahme' ? doc.kat : einnahmeKat();
      // Quittung/Eigenbeleg sind bezahlt; eine Rechnung nur, wenn sie schon bezahlt ankam (sonst offener Posten)
      const bezahlt = doc.art === 'quittung' || doc.art === 'eigenbeleg' || (doc.art === 'rechnung' && !!doc.bezahltAm);
      if (bezahlt) { doc.status = 'bezahlt'; if (doc.art !== 'rechnung') doc.bezahltAm = doc.datum; }
      else { doc.status = 'offen'; doc.bezahltAm = null; }
      const vorh = bezahlt ? verknuepft() : null;
      if (vorh) doc.buchungVorher = true; // Zahlung war schon erfasst → Storno löst sie nur vom Beleg
      if (doc.art === 'rechnung' && bezahlt && doc.bezahltAm <= doc.datum) doc.quittiert = { am: doc.bezahltAm, za: doc.zahlungsart }; // „dankend erhalten“ einfrieren
      const r = speichern();
      let msg = `${r.nr} finalisiert`;
      if (vorh) { buchungVerknuepfen(vorh, r); msg = `${r.nr} erstellt · an ${r.art === 'eigenbeleg' ? 'Ausgabe' : 'Einnahme'} ${vorh.nr} angehängt`; }
      else if (bezahlt) {
        const b = r.art === 'eigenbeleg'
          ? buchungAnlegen({ typ: 'ausgabe', datum: r.datum, betrag: summe(r), kat: r.kat, lieferant: String(r.kunde || '').trim() || null, zahlungsart: r.zahlungsart || 'bar', text: r.betreff || 'Ausgabe laut Eigenbeleg', rechnung: r.id, beleg: `${r.nr}.pdf`, belegnr: r.nr })
          : buchungAnlegen({ typ: 'einnahme', datum: r.bezahltAm || r.datum, betrag: summe(r), kat: r.kat, kontakt: r.kontakt || null, kunde: kundeName(r) || null, zahlungsart: r.zahlungsart || (r.art === 'rechnung' ? 'bank' : 'bar'), text: r.betreff || (r.art === 'quittung' ? 'Barverkauf' : 'Rechnung'), rechnung: r.id, beleg: `${r.nr}.pdf`, belegnr: r.nr });
        r.buchung = b.id; msg = `${r.nr} erstellt · ${r.art === 'eigenbeleg' ? 'Ausgabe' : 'Einnahme'} ${b.nr} gebucht`;
      }
      // Eigenbeleg druckt „Gebucht als …“ – Nummer und Kategorie der Ausgabe einfrieren (GoBD)
      if (r.art === 'eigenbeleg') { const gb = D.buchungen.find((x) => x.id === r.buchung); if (gb) r.gebucht = { nr: gb.nr, kat: (D.kat(gb.kat) || {}).name || '' }; }
      if (w.neuerKunde) msg += ` · Kunde „${w.neuerKunde.name}“ angelegt`;
      if (termin) { termin.status = 'erledigt'; termin.beleg = r.id; msg += ' · Termin erledigt'; }
      // Ersatz für eine stornierte Quittung („Als Rechnung neu ausstellen“): deren Termin zeigt jetzt auf diesen Beleg
      const ersetzt = r.ersetzt ? D.rechnungen.find((x) => x.id === r.ersetzt) : null, tAlt = terminVon(ersetzt);
      if (tAlt && tAlt.beleg === ersetzt.id) { tAlt.beleg = r.id; r.termin = tAlt.id; }
      App.save(); w.dirty = false;
      App.toast(msg, { action: { label: 'Drucken', fn: () => print(r) } });
      App.go('#/beleg/' + r.id);
    }
    /* Vorbereiteten Beleg ausstellen: ungespeicherte Änderungen (Positionen, Adresse, Vorlage …) erst in den Entwurf, dann Schublade */
    function ausstellen() {
      if (!editable() || !orig) return;
      if (w.dirty) { doc.status = 'entwurf'; speichern(); App.save(); w.dirty = false; live(); }
      ausstellenErfassen(orig);
    }
    function loeschen() {
      if (vorbereitet(orig)) { verwerfenDialog(orig); return; } // fragt, ob der Termin abgesagt werden soll
      const i = D.rechnungen.indexOf(orig); if (i < 0) return;
      // Rechnungsentwurf aus einem Angebot: das Angebot gilt dann nicht mehr als angenommen (sonst toter Verweis)
      const ang = orig.ausAngebot ? D.rechnungen.find((x) => x.id === orig.ausAngebot && x.umgewandelt === orig.id) : null;
      if (ang) delete ang.umgewandelt;
      D.rechnungen.splice(i, 1); App.save(); work = null;
      App.go('#/rechnungen');
      App.toast('Entwurf gelöscht', { action: { label: 'Rückgängig', fn: () => { D.rechnungen.splice(i, 0, orig); if (ang) ang.umgewandelt = orig.id; App.save(); App.go('#/beleg/' + orig.id); } } });
    }
    function wechsleArt(a) {
      if (!ART[a] || a === doc.art) return;
      const alt = doc.art, s = summe(doc);
      if (TEXTE[alt] && doc.einleitung === TEXTE[alt].einleitung) doc.einleitung = TEXTE[a] ? TEXTE[a].einleitung : '';
      if (TEXTE[alt] && doc.schluss === TEXTE[alt].schluss) doc.schluss = TEXTE[a] ? TEXTE[a].schluss : '';
      if (TEXTE[a] && !doc.einleitung) doc.einleitung = TEXTE[a].einleitung;
      // Kunde: Rechnung/Angebot verweisen auf den Kunden, Quittungen zusätzlich mit Schnappschuss; der Empfänger eines Eigenbelegs ist kein Kunde
      if (a === 'eigenbeleg' || alt === 'eigenbeleg') { doc.kontakt = null; doc.kunde = ''; doc.kundeAdresse = ''; }
      else if (a === 'quittung') { const k = doc.kontakt && D.kontakt(doc.kontakt); if (k) { doc.kunde = k.name; doc.kundeAdresse = adresseText(k); } }
      else {
        if (!doc.kontakt && doc.kunde && w.kundeNeu !== norm(doc.kunde.trim())) { const k = findeKontakt(doc.kunde); if (k) doc.kontakt = k.id; }
        if (doc.kontakt) { doc.kunde = ''; doc.kundeAdresse = ''; }
      }
      // Verknüpfte Zahlung passt nur zur passenden Richtung (Einnahme ↔ Quittung/Rechnung, Ausgabe ↔ Eigenbeleg)
      const b = verknuepft();
      if (b && (a === 'angebot' || (b.typ === 'ausgabe') !== (a === 'eigenbeleg'))) delete doc.buchung;
      doc.bezahltAm = a === 'rechnung' && doc.buchung && b ? b.datum : a === 'rechnung' ? doc.bezahltAm || null : null;
      if (a === 'eigenbeleg') { doc.positionen = [{ text: doc.betreff || '', menge: 1, einheit: '', preis: s }]; doc.grund ||= 'verloren'; if (!D.kat(doc.kat) || D.kat(doc.kat).typ !== 'ausgabe') doc.kat = ausgabeStd(); }
      if (a === 'quittung') { w.multi = doc.positionen.length > 1; if (!doc.betreff && doc.positionen[0]) doc.betreff = doc.positionen[0].text; }
      if (a === 'rechnung' || a === 'angebot') {
        doc.ziel = a === 'angebot' ? 30 : F.zahlungszielTage || 14; doc.qr = a === 'rechnung';
        if (!doc.leistung) doc.leistung = doc.datum;
      }
      if (!doc.buchung) doc.zahlungsart = a === 'rechnung' || a === 'angebot' ? 'bank' : 'bar';
      if (doc.vorlage && doc.vorlage !== 'mitgeliefert' && !(D.VORLAGEN || []).some((v) => v.id === doc.vorlage && v.art === a)) doc.vorlage = '';
      doc.art = a;
      normalize(doc, true);
      kundeZustand = zustand();
      w.dirty = true;
      if (isNew) { history.replaceState(null, '', `#/beleg/neu?art=${a}`); w.hash = location.hash; }
      draw();
    }
    function drucken() {
      if (blatt) { clearTimeout(tPrev); blatt.update(doc); }
      print(doc);
    }

    /* ---------- Ereignisse ---------- */
    on(el, 'input', (e) => {
      const t = e.target;
      if (t.dataset.f) { const v = lese(t); if (v === undefined) return; setze(t.dataset.f, v); changed(); return; }
      if (t.dataset.p) {
        const row = t.closest('.bl-pos'), p = doc.positionen[+row.dataset.i]; if (!p) return;
        const k = t.dataset.p;
        if (k === 'text' || k === 'einheit') p[k] = t.value;
        else { const v = k === 'preis' ? parseCent(t.value) : parseZahl(t.value); const bad = !isFinite(v) || v < 0; t.classList.toggle('invalid', bad); if (bad) return; p[k] = v; }
        const rs = $('[data-rowsum]', row); if (rs) rs.textContent = euro(Math.round(p.menge * p.preis));
        changed();
      }
    });
    on(el, 'change', (e) => {
      const t = e.target;
      if (t.matches('[data-bl-scan]')) { scanSetzen(t.files && t.files[0]); return; }
      // Nach dem Verlassen schön formatieren
      if (t.dataset.f === 'betrag' && !t.classList.contains('invalid')) { const p = doc.positionen[0]; t.value = p && p.preis ? geld(p.preis) : ''; }
      // gebundener Kunde: im Feld steht „Name · K-0012“ (eindeutig, auch bei Namensvettern)
      if ((t.dataset.f === 'kundeName' || (t.dataset.f === 'kunde' && doc.art === 'quittung')) && kundeFeld()) t.value = kundeFeld();
      if (t.dataset.p && !t.classList.contains('invalid')) {
        const p = doc.positionen[+t.closest('.bl-pos').dataset.i]; if (!p) return;
        if (t.dataset.p === 'preis') t.value = App.num(p.preis / 100, 2);
        if (t.dataset.p === 'menge') t.value = menge(p.menge);
        if (t.dataset.p === 'text') {
          // Bekannte Position → Einheit und Preis übernehmen
          const v = D.rechnungen.flatMap((r) => r.positionen || []).find((x) => x.text === p.text);
          if (v && !p.preis) {
            p.einheit = v.einheit; p.preis = v.preis;
            const row = t.closest('.bl-pos');
            $('[data-p="einheit"]', row).value = p.einheit; $('[data-p="preis"]', row).value = App.num(p.preis / 100, 2);
            $('[data-rowsum]', row).textContent = euro(Math.round(p.menge * p.preis));
            changed();
          }
        }
      }
    });
    on(el, 'click', (e) => {
      const b = e.target.closest('[data-bl]'); if (!b || b.disabled) return;
      const act = b.dataset.bl;
      if (act === 'print') drucken();
      else if (act === 'save') alsEntwurf();
      else if (act === 'final') finalisieren();
      else if (act === 'ausstellen') ausstellen();
      else if (act === 'paid') bezahltDialog(orig);
      else if (act === 'status') sp.auf(b, orig);
      else if (act === 'storno') stornoDialog(orig);
      else if (act === 'dup') duplizieren(orig);
      else if (act === 'convert') umwandeln(orig);
      else if (act === 'delete') loeschen();
      else if (act === 'scan-weg') {
        const alt = orig.scan; delete orig.scan; App.save();
        const k = $('[data-card="scan"]', el); if (k) k.outerHTML = scanHTML().replace(' reveal', '');
        App.toast('Anhang entfernt', { action: { label: 'Rückgängig', fn: () => scanSetzen({ name: alt }) } });
      }
      else if (act === 'pos-add') {
        const last = doc.positionen[doc.positionen.length - 1];
        doc.positionen.push({ text: '', menge: 1, einheit: last ? last.einheit : 'Stk.', preis: 0 });
        redrawPos(); changed();
        const inp = $(`.bl-pos[data-i="${doc.positionen.length - 1}"] .bl-pos-text`, el); if (inp) inp.focus();
      } else if (act === 'pos-del') {
        doc.positionen.splice(+b.closest('.bl-pos').dataset.i, 1);
        if (!doc.positionen.length) doc.positionen.push({ text: '', menge: 1, einheit: 'Stk.', preis: 0 });
        redrawPos(); changed();
      } else if (act === 'zeitraum') {
        w.zeitraum = !w.zeitraum;
        if (!w.zeitraum) doc.leistungBis = ''; else if (!doc.leistungBis) doc.leistungBis = doc.leistung;
        redraw('daten'); changed();
      } else if (act === 'ziel') {
        SET.ziel(+b.dataset.v);
        const inp = $('[data-f="ziel"]', el); if (inp) inp.value = b.dataset.v;
        changed();
      } else if (act === 'kunde-wahl') kundeWaehlen(D.kontakt(b.dataset.k));
      else if (act === 'kunde-andere') kundeAndere();
      else if (act === 'kunde-zurueck') {
        if (b.dataset.k) kundeWaehlen(D.kontakt(b.dataset.k), true); // zurück zum vorhandenen (wieder per Name gebunden)
        else { w.kundeNeu = ''; kundeSlot(); changed(); } // Auswahl der Namensvettern wieder zeigen
      }
      else if (act === 'kunde-neu') {
        // trotz gleichnamiger Kunden einen neuen anlegen (beim Finalisieren)
        w.kundeNeu = norm(String(doc.kunde || '').trim());
        kundeSlot(); changed();
        const ta = $('[data-f="kundeAdresse"]', el); if (ta && doc.art !== 'quittung') ta.focus();
      } else if (act === 'noch-offen') {
        // Rechnung doch als offenen Posten: Verknüpfung zur Zahlung lösen, Zahlungsziel und GiroCode wieder anbieten
        doc.bezahltAm = null; delete doc.buchung;
        redraw('zahlung');
        const a = $('.bl-actions', el); if (a) a.innerHTML = aktionenHTML();
        changed();
      }
    });
    on(el, 'seg-change', (e) => {
      const { key, value } = e.detail;
      if (key === 'art') wechsleArt(value);
      else if (key === 'zahlungsart') { doc.zahlungsart = value; changed(); }
      else if (key === 'fit') { prefs.fit = value; App.LS.set('gb.belege.fit', value); if (blatt) blatt.setFit(value); }
    });
    // Positionen per Ziehen (Griff) oder ↑/↓ umsortieren
    let von = -1;
    on(el, 'pointerdown', (e) => { const g = e.target.closest('.bl-pos-grip'); if (g && editable()) g.closest('.bl-pos').draggable = true; });
    on(el, 'dragstart', (e) => {
      const p = e.target.closest && e.target.closest('.bl-pos'); if (!p || !p.draggable) return;
      von = +p.dataset.i; p.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(von));
    });
    // Scan auf die Dropzone (oder irgendwo aufs Fenster, siehe App.dropTarget)
    const scanZone = (e) => e.target.closest && e.target.closest('.bl-drop');
    on(el, 'dragover', (e) => { const z = scanZone(e); if (z) { e.preventDefault(); z.classList.add('over'); } });
    on(el, 'dragleave', (e) => { const z = scanZone(e); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
    on(el, 'drop', (e) => { const z = scanZone(e); if (z) { e.preventDefault(); z.classList.remove('over'); scanSetzen(e.dataTransfer.files && e.dataTransfer.files[0]); } });
    if (!editable()) App.dropTarget = (files) => scanSetzen(files[0]);
    on(el, 'dragover', (e) => {
      if (von < 0) return;
      const p = e.target.closest('.bl-pos'); if (!p) return;
      e.preventDefault();
      const r = p.getBoundingClientRect(), nach = e.clientY > r.top + r.height / 2;
      $$('.bl-pos', el).forEach((x) => x.classList.remove('drop-before', 'drop-after'));
      p.classList.add(nach ? 'drop-after' : 'drop-before');
    });
    on(el, 'drop', (e) => {
      if (von < 0) return;
      const p = e.target.closest('.bl-pos'); if (!p) return;
      e.preventDefault();
      let zu = +p.dataset.i + (p.classList.contains('drop-after') ? 1 : 0);
      const [m] = doc.positionen.splice(von, 1);
      if (zu > von) zu--;
      doc.positionen.splice(zu, 0, m); von = -1;
      redrawPos(); changed();
    });
    on(el, 'dragend', () => { von = -1; $$('.bl-pos', el).forEach((x) => { x.draggable = false; x.classList.remove('dragging', 'drop-before', 'drop-after'); }); });
    on(el, 'keydown', (e) => {
      const g = e.target.closest && e.target.closest('.bl-pos-grip');
      if (!g || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const i = +g.closest('.bl-pos').dataset.i, j = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (j < 0 || j >= doc.positionen.length) return;
      const [m] = doc.positionen.splice(i, 1); doc.positionen.splice(j, 0, m);
      redrawPos(); changed();
      const ng = $(`.bl-pos[data-i="${j}"] .bl-pos-grip`, el); if (ng) ng.focus();
    });
    // ⌘P druckt nur das Blatt, ⌘S speichert den Entwurf
    on(document, 'keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey; if (!mod || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'p') { e.preventDefault(); drucken(); }
      else if (k === 's') { e.preventDefault(); if (editable()) alsEntwurf(); }
    });
    // Druck über das Browser-Menü: Blatt trotzdem einsetzen
    on(window, 'beforeprint', () => { if (!document.body.classList.contains('printing-beleg')) druckRestore = preparePrint(doc); });
    on(window, 'afterprint', () => { if (druckRestore) { druckRestore(); druckRestore = null; } });

    draw();
    const sp = statusPopover(on); // Status-Menü am Badge im Kopf
    return () => { ac.abort(); sp.zu(); clearTimeout(tPrev); if (blatt) blatt.destroy(); };
  }

  /* ================= Anmelden ================= */
  // GoBD: Schnappschuss des Kunden (bzw. „Gebucht als …“ beim Eigenbeleg) für alle ausgestellten Belege, bevor jemand Kunden oder Ausgaben ändern/löschen kann
  // (Demo-Rechnungen kommen ohne; gespeichert wird mit der nächsten Änderung, die Kunden-Seite speichert ohnehin alles)
  D.rechnungen.forEach((r) => { kundeEinfrieren(r); gebuchtEinfrieren(r); });
  App.page('rechnungen', { title: 'Rechnungen & Quittungen', navTitle: 'Rechnungen & Quittungen', icon: 'invoice', nav: true, order: 20, desc: 'Quittungen, Rechnungen, Angebote · Vorlagen', render: renderListe });
  App.page('beleg', { title: 'Beleg', icon: 'invoice', nav: false, parent: 'rechnungen', render: renderBeleg });
})();
