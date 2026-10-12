/* Kladdy – Prototyp · Demo-Daten (Version 4: Dienstleister, viele Einzelkunden, 3 Kostenkategorien, keine Konten)
 * Fiktives Kleingewerbe „Mustermann Haus- & Gartenservice“: Rasen, Hecke, Gartenpflege, Kleinreparaturen, Montage, Winterdienst.
 * Die meisten Einnahmen laufen über Quittungen (QU-JJJJ-NNN) an viele verschiedene Kunden, die selten wiederkommen;
 * größere Aufträge über Rechnungen (RE-JJJJ-NNN). Kosten nur in drei Kategorien: Produkte & Material, Sprit & Fahrzeug, Sonstiges.
 * Keine Konten/Kontostände: Als Kleinunternehmer ist das Geschäftskonto das Privatkonto – erfasst werden nur die
 * geschäftlichen Ein- und Ausgänge, jeweils mit Zahlungsweg (Bar, Überweisung/Karte, PayPal).
 * KONTAKTE enthält nur Kunden (jeder Kunde einer Quittung oder Rechnung); Geschäfte bei Ausgaben stehen als Freitext in `lieferant`.
 * Alles deterministisch (fester Zufalls-Seed) relativ zu heute: komplettes Vorjahr + laufendes Jahr.
 * Geld immer in CENT (Integer), Datum immer als 'YYYY-MM-DD'.
 */
window.DATA = (() => {
  'use strict';

  /* ---------- Datum ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const daysIn = (y, m) => new Date(y, m, 0).getDate();
  const dateIn = (y, m, d) => `${y}-${pad(m)}-${pad(Math.min(d, daysIn(y, m)))}`;
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const TODAY = iso(new Date());
  const Y = +TODAY.slice(0, 4), M = +TODAY.slice(5, 7);
  const START = `${Y - 1}-01-01`;

  /* ---------- Zufall (deterministisch) ---------- */
  let seed = 20261009;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const between = (a, b) => a + rnd() * (b - a);
  const cents = (eur) => Math.round(eur * 100);
  const day = () => 1 + Math.floor(rnd() * 28);
  const digits = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');
  const weighted = (pairs) => { let r = rnd() * pairs.reduce((s, p) => s + p[1], 0); for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; } return pairs[0][0]; };

  /* ---------- Stammdaten ---------- */
  const FIRMA = {
    name: 'Mustermann Haus- & Gartenservice', inhaber: 'Max Mustermann', claim: 'Gartenpflege · Kleinreparaturen · Montage',
    strasse: 'Lindenweg 12', plz: '12345', ort: 'Musterstadt',
    email: 'hallo@mustermann-service.de', telefon: '0123 456789', web: 'mustermann-service.de',
    steuernummer: '12/345/67890', bank: 'Musterbank', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX',
    paypal: 'hallo@mustermann-service.de', ustModus: 'klein', zahlungszielTage: 14
  };

  /* Zahlungswege – nur zur Info, wie bezahlt wurde (kein Kontostand). Kartenzahlung läuft wie eine Überweisung übers Konto. */
  const ZAHLUNGSARTEN = [
    { id: 'bar', name: 'Bar', kurz: 'Bar', icon: 'cash', farbe: 'var(--series-3)', text: 'Bargeld' },
    { id: 'bank', name: 'Überweisung', kurz: 'Überweisung', icon: 'bank', farbe: 'var(--series-1)', text: 'Überweisung oder Karte – läuft über dein Konto' },
    { id: 'paypal', name: 'PayPal', kurz: 'PayPal', icon: 'paypal', farbe: 'var(--series-2)', text: 'PayPal' }
  ];

  /* Kategorien – bewusst wenige: eine Einnahmeart, drei Kostenarten.
   * stichworte helfen der Belegerkennung; euer = Bereich in der Anlage EÜR. */
  const KATEGORIEN = [
    { id: 'dienstleistung', name: 'Dienstleistungen', typ: 'einnahme', icon: 'wrench', farbe: '#6366f1', ku: true,
      euer: 'Betriebseinnahmen als Kleinunternehmer', text: 'Alle Einnahmen aus Aufträgen – egal ob Quittung oder Rechnung.',
      stichworte: ['rasen', 'hecke', 'garten', 'montage', 'reparatur', 'winterdienst', 'quittung', 'rechnung'] },
    { id: 'produkte', name: 'Produkte & Material', typ: 'ausgabe', icon: 'box', farbe: '#f59e0b', wareneingang: true,
      euer: 'Waren, Roh- und Hilfsstoffe', text: 'Was du für Aufträge einkaufst: Pflanzen, Erde, Ersatzteile, Kleinmaterial.',
      stichworte: ['bauhaus', 'obi', 'hornbach', 'toom', 'gartencenter', 'erde', 'mulch', 'dünger', 'pflanzen', 'saatgut', 'rasensamen', 'ersatzteil', 'schrauben', 'dübel', 'material', 'müllsäcke', 'handschuhe'] },
    { id: 'sprit', name: 'Sprit & Fahrzeug', typ: 'ausgabe', icon: 'fuel', farbe: '#0ea5e9',
      euer: 'Kraftfahrzeugkosten', text: 'Tanken, Werkstatt, Kfz-Versicherung des betrieblich genutzten Fahrzeugs.',
      stichworte: ['tankstelle', 'aral', 'shell', 'esso', 'jet', 'total', 'diesel', 'benzin', 'super', 'kraftstoff', 'liter', 'werkstatt', 'reifen', 'kfz', 'inspektion'] },
    { id: 'sonstiges', name: 'Sonstige Kosten', typ: 'ausgabe', icon: 'dots', farbe: '#a855f7',
      euer: 'Übrige Betriebsausgaben', text: 'Telefon, Versicherung, Werkzeug, Gebühren, Werbung – alles Übrige.',
      stichworte: ['telekom', 'vodafone', 'o2', 'versicherung', 'gebühr', 'porto', 'werbung', 'flyer', 'software', 'werkzeug', 'paypal', 'wertstoffhof'] }
  ].map((k) => ({ abziehbar: 100, ku: false, wareneingang: false, ...k }));

  /* Kunden – werden unten beim Erzeugen der Quittungen und Rechnungen angelegt (jeder Kunde genau einmal) */
  const KONTAKTE = [];
  /* Geschäfte, bei denen eingekauft wird (nur für die Demo-Daten; in der App ein Freitext an der Ausgabe) */
  const GESCHAEFT = { l1: 'Bauhaus', l2: 'OBI Baumarkt', l3: 'Gartencenter Grünland', l4: 'Aral Tankstelle', l5: 'Shell Station', l6: 'Telekom Deutschland', l7: 'Handwerker-Versicherung AG', l10: 'PayPal', l11: 'Auto-Schutz Versicherung', l12: 'Kfz-Werkstatt Meier' };
  const BELEGNR = { l1: () => `BH ${digits(4)} ${digits(4)}`, l2: () => `OBI-${digits(8)}`, l3: () => `GL-${digits(5)}`, l4: () => `Bon ${digits(4)}`, l5: () => `Bon ${digits(4)}`, l6: () => `RG ${digits(9)}`, l7: () => `VS-${digits(7)}`, l11: () => `KFZ-${digits(6)}`, l12: () => `WS-${digits(4)}` };

  /* Wiederkehrende Zahlungen (für Historie und Liquiditätsvorschau) */
  const WIEDERKEHREND = [
    { id: 'w1', text: 'Handyvertrag', typ: 'ausgabe', betrag: 2999, kat: 'sonstiges', lieferant: GESCHAEFT.l6, rhythmus: 'monatlich', tag: 20, zahlungsart: 'bank', l: 'l6' },
    { id: 'w2', text: 'Kfz-Versicherung Transporter', typ: 'ausgabe', betrag: 3800, kat: 'sprit', lieferant: GESCHAEFT.l11, rhythmus: 'monatlich', tag: 1, zahlungsart: 'bank', l: 'l11' },
    { id: 'w4', text: 'Betriebshaftpflicht', typ: 'ausgabe', betrag: 9600, kat: 'sonstiges', lieferant: GESCHAEFT.l7, rhythmus: 'quartal', monate: [1, 4, 7, 10], tag: 15, zahlungsart: 'bank', l: 'l7' }
  ];

  /* Namen für Einzelkunden (Quittungen) und Auftraggeber (Rechnungen) */
  const VORNAMEN = ['Anna', 'Lukas', 'Sophie', 'Jonas', 'Marie', 'Paul', 'Lea', 'Felix', 'Emma', 'Leon', 'Mia', 'Noah', 'Hannah', 'Elias', 'Lina', 'Ben', 'Clara', 'Finn', 'Laura', 'Tim', 'Julia', 'Moritz', 'Sarah', 'Jan', 'Katharina', 'David', 'Nina', 'Simon', 'Johanna', 'Florian', 'Lisa', 'Tobias', 'Eva', 'Matthias', 'Ida', 'Henrik', 'Greta', 'Karl', 'Frieda', 'Ole', 'Ursula', 'Gerhard', 'Monika', 'Helmut', 'Renate', 'Wolfgang'];
  const NACHNAMEN = ['Schmidt', 'Müller', 'Becker', 'Hoffmann', 'Wagner', 'Schulz', 'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hartmann', 'Lange', 'Werner', 'Krause', 'Lehmann', 'Köhler', 'Maier', 'Fuchs', 'Peters', 'Scholz', 'Möller', 'Weiß', 'Jung', 'Hahn', 'Vogel', 'Friedrich', 'Keller', 'Günther', 'Frank', 'Berger', 'Winkler', 'Roth', 'Beck', 'Lorenz', 'Baumann'];
  const STRASSEN = ['Lindenallee', 'Birkenweg', 'Hauptstraße', 'Am Markt', 'Gartenstraße', 'Schulweg', 'Bergstraße', 'Mühlenweg', 'Kirchplatz', 'Ahornring', 'Seeufer', 'Rosenweg', 'Bahnhofstraße', 'Am Anger'];
  const ORTE = [['12345', 'Musterstadt'], ['12347', 'Musterdorf'], ['12346', 'Musterstadt'], ['12390', 'Seehausen'], ['12399', 'Weindorf'], ['12350', 'Waldheim']];
  const FIRMEN = ['Hausverwaltung Kaiser', 'Praxis Dr. Sommer', 'Kita Sonnenschein e. V.', 'Café Lindenblatt', 'Kanzlei Brandt & Partner', 'Hotel Am See', 'Bäckerei Kornfeld', 'Weinhaus Rebstock GmbH', 'Physiotherapie Bewegt', 'Gasthaus Zur Linde', 'Wohnungsbau Seehausen eG'];

  /* Kunden anlegen: Einzelkunden (Quittungen, Wiederkehr selten) und Auftraggeber (Rechnungen, oft Firmen) */
  let kid = 0;
  const NOTIZEN = ['Hund im Garten – Tor immer schließen', 'Schlüssel liegt beim Nachbarn (Nr. 14)', 'Grünschnitt bitte mitnehmen', 'Zahlt gern bar', 'Parken in der Einfahrt ok', 'Lieber vormittags anrufen'];
  function neuerKunde(name, mitAdresse, zusatz = '') {
    const [plz, ort] = pick(ORTE);
    const k = { id: 'k' + (++kid), nr: 'K-' + String(kid).padStart(4, '0'), art: 'kunde', name, zusatz, strasse: mitAdresse ? `${pick(STRASSEN)} ${1 + Math.floor(rnd() * 60)}` : '', plz: mitAdresse ? plz : '', ort: mitAdresse ? ort : '',
      email: '', telefon: rnd() < 0.35 ? `0${1 + Math.floor(rnd() * 8)}${digits(2)} ${digits(6)}` : '', notiz: '' };
    KONTAKTE.push(k);
    return k;
  }
  const privatkunden = [], firmenkunden = [];
  function einzelkunde() {
    if (privatkunden.length > 10 && rnd() < 0.08) { const k = pick(privatkunden); if (!k.notiz && rnd() < 0.5) k.notiz = pick(NOTIZEN); return k; }
    const k = neuerKunde(`${pick(VORNAMEN)} ${pick(NACHNAMEN)}`, rnd() < 0.6);
    privatkunden.push(k);
    return k;
  }
  function auftraggeber(name) {
    if (name) { const f = firmenkunden.find((x) => x.name === name); if (f) return f; }
    else if (firmenkunden.length > 3 && rnd() < 0.12) return pick(firmenkunden); // selten Wiederholungskunde
    const istFirma = !!name || rnd() < 0.6;
    const nm = name || (istFirma ? (FIRMEN.find((f) => !firmenkunden.some((x) => x.name === f)) || `${pick(NACHNAMEN)} GmbH`) : `${pick(VORNAMEN)} ${pick(NACHNAMEN)}`);
    const k = neuerKunde(nm, true, istFirma ? pick(['Objektbetreuung', 'Inhaberin', 'Haustechnik', 'Geschäftsführung', '']) : '');
    if (istFirma) k.email = `info@${slug(nm.split(' ')[0])}.de`;
    firmenkunden.push(k);
    return k;
  }
  const adresseVon = (k) => (k.strasse ? `${k.strasse}\n${k.plz} ${k.ort}` : '');

  /* Leistungen für Quittungen: [Text, Einheit, Menge min/max, Preis je Einheit min/max (€), Saison] */
  const LEISTUNGEN = [
    ['Rasenmähen inkl. Grünschnitt', 'pausch.', 1, 1, 45, 95, 'sommer'], ['Heckenschnitt', 'Std.', 2, 6, 35, 38, 'sommer'],
    ['Gartenpflege', 'Std.', 2, 5, 35, 35, 'sommer'], ['Beet anlegen inkl. Pflanzen', 'pausch.', 1, 1, 120, 340, 'sommer'],
    ['Laub entfernen', 'pausch.', 1, 1, 50, 140, 'herbst'], ['Regenrinne reinigen', 'pausch.', 1, 1, 70, 150, 'herbst'],
    ['Möbelmontage', 'Std.', 1, 4, 38, 38, 'immer'], ['Kleinreparatur im Haushalt', 'Std.', 1, 3, 38, 38, 'immer'],
    ['Lampen & Regale anbringen', 'pausch.', 1, 1, 45, 110, 'immer'], ['Winterdienst (Einsatz)', 'Einsatz', 1, 3, 30, 45, 'winter']
  ];
  const ZAHLWEG_QUITTUNG = [['bar', 55], ['bank', 28], ['paypal', 17]];
  const PRODUKTE = [['l3', 'Blumenerde & Rindenmulch'], ['l3', 'Pflanzen für Kundenbeet'], ['l3', 'Dünger & Rasensamen'], ['l1', 'Schrauben, Dübel, Kleinteile'], ['l2', 'Ersatzmesser Rasenmäher'], ['l1', 'Müllsäcke & Arbeitshandschuhe'], ['l2', 'Silikon & Montagekleber'], ['l1', 'Rasenkantensteine']];
  const SONSTIGES = [['Akku-Heckenschere', 'werkzeug', 159, 229], ['Flyer-Druck (500 Stk.)', 'werbung', 39, 69], ['Grünschnitt-Entsorgung Wertstoffhof', 'entsorgung', 12, 35], ['Bohrer- & Bit-Set', 'werkzeug', 29, 59], ['Anzeige Gemeindeblatt', 'werbung', 35, 80]];
  const JOBS = [
    { betreff: 'Grünanlagenpflege', pos: [['Grünanlagenpflege Außenbereich', 12, 'Std.', 3800], ['Grünschnitt-Entsorgung', 1, 'pausch.', 6500]] },
    { betreff: 'Heckenschnitt Außenanlage', pos: [['Heckenschnitt inkl. Entsorgung', 9, 'Std.', 3800]] },
    { betreff: 'Möbelmontage Büro', pos: [['Montage Schreibtische & Schränke', 7, 'Std.', 3800], ['Kleinmaterial', 1, 'pausch.', 2400]] },
    { betreff: 'Laubbeseitigung Herbst', pos: [['Laubbeseitigung Grundstück', 1, 'pausch.', 42000]] },
    { betreff: 'Winterdienst Saison', pos: [['Winterdienst Einsätze', 8, 'Einsatz', 4500]] },
    { betreff: 'Neuanlage Beet Eingangsbereich', pos: [['Beet anlegen', 24, 'm²', 1800], ['Pflanzen & Erde', 1, 'pausch.', 21000]] }
  ];

  /* ---------- Erzeugen ---------- */
  const buchungen = [], rechnungen = [];
  let bid = 0, rid = 0;
  const add = (b) => { const x = { id: 'b' + (++bid), kontakt: null, kunde: null, lieferant: null, rechnung: null, privat: 0, beleg: null, belegnr: null, ...b }; buchungen.push(x); return x; };
  const slug = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  const posSumme = (pos) => pos.reduce((s, p) => s + Math.round(p.menge * p.preis), 0);
  const mkPos = (rows) => rows.map(([text, menge, einheit, preis]) => ({ text, menge, einheit, preis }));
  const saison = (m) => (m >= 4 && m <= 8 ? 'sommer' : m >= 9 && m <= 11 ? 'herbst' : 'winter');

  for (let y = Y - 1; y <= Y; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === Y && m > M) break;
      const inRange = (d) => d >= START && d <= TODAY;
      let paypalUms = 0, paypalN = 0;
      // wiederkehrend
      WIEDERKEHREND.forEach((w) => {
        if (w.rhythmus === 'quartal' && !w.monate.includes(m)) return;
        const d = dateIn(y, m, w.tag);
        if (inRange(d)) add({ typ: w.typ, datum: d, betrag: w.betrag, kat: w.kat, lieferant: w.lieferant, zahlungsart: w.zahlungsart, text: w.text, wiederkehrend: w.id, belegnr: BELEGNR[w.l] ? BELEGNR[w.l]() : null });
      });
      // Quittungen: viele Einzelkunden, saisonal
      const s = saison(m);
      const nQ = s === 'sommer' ? 12 + Math.floor(rnd() * 5) : s === 'herbst' ? 10 + Math.floor(rnd() * 4) : 5 + Math.floor(rnd() * 4);
      const passend = LEISTUNGEN.filter((l) => l[6] === 'immer' || l[6] === s || (s === 'herbst' && l[6] === 'sommer' && m === 9));
      for (let i = 0; i < nQ; i++) {
        const d = dateIn(y, m, day()); if (!inRange(d)) continue;
        const [text, einheit, mMin, mMax, pMin, pMax] = pick(passend);
        const menge = mMin + Math.floor(rnd() * (mMax - mMin + 1));
        const preis = cents(einheit === 'pausch.' ? Math.round(between(pMin, pMax)) : pMin + Math.floor(rnd() * (pMax - pMin + 1)));
        const pos = [[text, menge, einheit, preis]];
        if (/Rasen|Hecke|Laub/.test(text) && rnd() < 0.3) pos.push(['Grünschnitt-Entsorgung', 1, 'pausch.', 1500]);
        const zw = weighted(ZAHLWEG_QUITTUNG), k = einzelkunde();
        rechnungen.push({ id: 'r' + (++rid), art: 'quittung', nr: null, status: 'bezahlt', kontakt: k.id, kunde: k.name, kundeAdresse: adresseVon(k), datum: d, leistung: d, faellig: d, betreff: text, positionen: mkPos(pos), bezahltAm: d, zahlungsart: zw, kat: 'dienstleistung' });
        const sum = posSumme(mkPos(pos));
        if (zw === 'paypal') { paypalUms += sum; paypalN++; }
      }
      // Aufträge mit Rechnung (ältere; die letzten Wochen sind unten fest vorgegeben)
      if (rnd() < 0.55) {
        const d = dateIn(y, m, day());
        if (d >= START && d < addDays(TODAY, -40)) {
          const job = pick(JOBS.filter((j) => s === 'winter' ? !/Laub|Hecke|Beet/.test(j.betreff) : !/Winter/.test(j.betreff)));
          const k = auftraggeber();
          const delay = rnd() < 0.7 ? Math.round(between(3, 13)) : Math.round(between(14, 30));
          rechnungen.push({ id: 'r' + (++rid), art: 'rechnung', nr: null, status: 'bezahlt', kontakt: k.id, datum: d, leistung: d, faellig: addDays(d, 14), betreff: job.betreff, positionen: mkPos(job.pos), bezahltAm: addDays(d, delay), zahlungsart: 'bank', kat: 'dienstleistung' });
        }
      }
      // Sprit (3–5× im Monat), Werkstatt einmal im Jahr
      const nSprit = 3 + Math.floor(rnd() * 3) - (s === 'winter' ? 1 : 0);
      for (let i = 0; i < nSprit; i++) {
        const d = dateIn(y, m, day()); if (!inRange(d)) continue;
        const l = rnd() < 0.6 ? 'l4' : 'l5', liter = between(32, 58);
        add({ typ: 'ausgabe', datum: d, betrag: cents(liter * between(1.68, 1.84)), kat: 'sprit', lieferant: GESCHAEFT[l], zahlungsart: rnd() < 0.85 ? 'bank' : 'bar', text: `Tanken Diesel (${liter.toFixed(1).replace('.', ',')} l)`, belegnr: BELEGNR[l]() });
      }
      if (m === 3) { const d = dateIn(y, m, 18); if (inRange(d)) add({ typ: 'ausgabe', datum: d, betrag: cents(between(290, 470)), kat: 'sprit', lieferant: GESCHAEFT.l12, zahlungsart: 'bank', text: 'Inspektion & Reifenwechsel Transporter', belegnr: BELEGNR.l12() }); }
      // Produkte & Material (2–4× im Monat, im Sommer mehr)
      const nProd = (s === 'winter' ? 1 : 2) + Math.floor(rnd() * 3);
      for (let i = 0; i < nProd; i++) {
        const d = dateIn(y, m, day()); if (!inRange(d)) continue;
        const [l, text] = pick(s === 'winter' ? PRODUKTE.filter((p) => p[0] !== 'l3') : PRODUKTE);
        add({ typ: 'ausgabe', datum: d, betrag: cents(between(18, 160)), kat: 'produkte', lieferant: GESCHAEFT[l], zahlungsart: rnd() < 0.75 ? 'bank' : 'bar', text, belegnr: BELEGNR[l]() });
      }
      // Sonstige Kosten (gelegentlich)
      if (rnd() < 0.45) { const d = dateIn(y, m, day()); if (inRange(d)) { const [text, , lo, hi] = pick(SONSTIGES); add({ typ: 'ausgabe', datum: d, betrag: cents(between(lo, hi)), kat: 'sonstiges', lieferant: /Wertstoffhof/.test(text) ? 'Wertstoffhof Musterstadt' : /Flyer/.test(text) ? 'Druckerei Schnell' : /Anzeige/.test(text) ? 'Gemeindeblatt Musterstadt' : pick(['Bauhaus', 'OBI Baumarkt']), zahlungsart: rnd() < 0.7 ? 'bank' : 'bar', text, belegnr: `Bon ${digits(4)}` }); } }
      // Gebühren der Zahlungsdienste (monatlich gesammelt)
      const endM = dateIn(y, m, 28);
      if (inRange(endM)) {
        if (paypalN) add({ typ: 'ausgabe', datum: endM, betrag: Math.round(paypalUms * 0.0249 + paypalN * 35), kat: 'sonstiges', lieferant: GESCHAEFT.l10, zahlungsart: 'paypal', text: `PayPal-Gebühren (${paypalN} Zahlungen)`, belegnr: `PP-${y}${pad(m)}` });
      }
    }
  }

  /* Feste aktuelle Rechnungen (zwei offen, davon eine überfällig, eine kleine offene), Entwurf, Angebot */
  const fixed = [
    { kunde: 'Kita Sonnenschein e. V.', datum: addDays(TODAY, -31), faellig: addDays(TODAY, -17), status: 'offen', betreff: 'Heckenschnitt Außenanlage', pos: [['Heckenschnitt inkl. Entsorgung', 16, 'Std.', 3800], ['Grünschnitt-Entsorgung', 1, 'pausch.', 6800]] },
    { kunde: 'Hausverwaltung Kaiser', datum: addDays(TODAY, -6), faellig: addDays(TODAY, 8), status: 'offen', betreff: 'Grünanlagenpflege September', pos: [['Grünanlagenpflege Wohnanlage Seeufer', 22, 'Std.', 3800], ['Grünschnitt-Entsorgung', 1, 'pausch.', 9500]] },
    { kunde: 'Praxis Dr. Sommer', datum: addDays(TODAY, -24), faellig: addDays(TODAY, -10), status: 'bezahlt', bezahltAm: addDays(TODAY, -12), betreff: 'Möbelmontage Praxisräume', pos: [['Montage Schränke & Regale', 8, 'Std.', 3800], ['Kleinmaterial', 1, 'pausch.', 2900]] },
    { kunde: 'Hausverwaltung Kaiser', datum: addDays(TODAY, -1), status: 'entwurf', betreff: 'Laubbeseitigung Oktober', pos: [['Laubbeseitigung Wohnanlage Seeufer', 14, 'Std.', 3800]] }
  ];
  fixed.forEach((f) => { const k = auftraggeber(f.kunde); rechnungen.push({ id: 'r' + (++rid), art: 'rechnung', nr: null, status: f.status, kontakt: k.id, datum: f.datum, leistung: f.datum, faellig: f.faellig || addDays(f.datum, 14), betreff: f.betreff, positionen: mkPos(f.pos), bezahltAm: f.bezahltAm || null, zahlungsart: 'bank', kat: 'dienstleistung' }); });
  rechnungen.push({ id: 'r' + (++rid), art: 'angebot', nr: null, status: 'offen', kontakt: auftraggeber('Weinhaus Rebstock GmbH').id, datum: addDays(TODAY, -9), leistung: '', faellig: addDays(TODAY, 21), betreff: 'Neuanlage Vorgarten', positionen: mkPos([['Vorgarten neu anlegen (Rückbau, Boden, Pflanzung)', 45, 'm²', 4200], ['Pflanzen & Material', 1, 'pausch.', 98000], ['Entsorgung', 1, 'pausch.', 18000]]), bezahltAm: null, zahlungsart: 'bank', kat: 'dienstleistung' });
  { const k = auftraggeber(); rechnungen.push({ id: 'r' + (++rid), art: 'rechnung', nr: null, status: 'offen', kontakt: k.id, datum: addDays(TODAY, -3), leistung: addDays(TODAY, -3), faellig: addDays(TODAY, 11), betreff: 'Regenrinnen & Laub', positionen: mkPos([['Regenrinnen reinigen', 1, 'pausch.', 14000], ['Laub entfernen', 3, 'Std.', 3800]]), bezahltAm: null, zahlungsart: 'bank', kat: 'dienstleistung' }); }

  /* Nummern vergeben (je Art und Jahr fortlaufend nach Datum, Entwürfe ohne Nummer) */
  const PREFIX = { rechnung: 'RE', quittung: 'QU', angebot: 'AN', eigenbeleg: 'EB' };
  const nrCounter = {};
  rechnungen.sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : +a.id.slice(1) - +b.id.slice(1)));
  rechnungen.forEach((r) => {
    if (r.status === 'entwurf') return;
    const key = r.art + r.datum.slice(0, 4);
    nrCounter[key] = (nrCounter[key] || 0) + 1;
    r.nr = `${PREFIX[r.art]}-${r.datum.slice(0, 4)}-${String(nrCounter[key]).padStart(3, '0')}`;
  });
  /* Ausgestellte Belege: Ausstellungstag und Schnappschuss der Kundendaten (GoBD – spätere Änderungen am Kunden ändern den Beleg nicht) */
  rechnungen.forEach((r) => {
    if (!r.nr) return;
    const k = KONTAKTE.find((x) => x.id === r.kontakt);
    r.erstellt = r.datum;
    if (k) { r.kunde = r.kunde || k.name; r.kundeAdresse = r.kundeAdresse || adresseVon(k); r.kundeNr = k.nr; }
  });

  /* Bezahlte Rechnungen/Quittungen → Einnahme mit Belegnummer */
  rechnungen.forEach((r) => {
    if (r.status !== 'bezahlt' || !r.bezahltAm) return;
    if (r.bezahltAm > TODAY) { r.status = 'offen'; r.bezahltAm = null; return; }
    const k = KONTAKTE.find((x) => x.id === r.kontakt);
    add({ typ: 'einnahme', datum: r.bezahltAm, betrag: posSumme(r.positionen), kat: r.kat || 'dienstleistung', kontakt: r.kontakt, kunde: k ? k.name : r.kunde || null, zahlungsart: r.zahlungsart,
      text: r.betreff, rechnung: r.id, belegnr: r.nr });
  });

  /* Reihenfolge: nach Datum, am selben Tag Einnahmen zuerst */
  const chrono = (a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : (a.typ === 'einnahme' ? -1 : 0) - (b.typ === 'einnahme' ? -1 : 0) || +a.id.slice(1) - +b.id.slice(1));

  /* Sortieren, Buchungsnummern (Journal), Belegdateien */
  buchungen.sort(chrono);
  const bCounter = {};
  buchungen.forEach((b) => {
    const yy = b.datum.slice(0, 4);
    bCounter[yy] = (bCounter[yy] || 0) + 1;
    b.nr = `${yy}-${String(bCounter[yy]).padStart(4, '0')}`;
    if (b.rechnung) b.beleg = `${b.belegnr}.pdf`;
    else b.beleg = diffDays(b.datum, TODAY) < 70 && rnd() < 0.1 ? null : `${b.datum}_${slug(b.text)}.pdf`;
  });

  /* ---------- Termine (Version 5) ----------
   * Kundentermine: { id, kontakt, kunde, datum, von, bis, adresse, leistung, betrag (Cent, geschätzt), notiz,
   *   status: 'geplant' | 'erledigt' | 'abgesagt', beleg: ID der (vorbereiteten) Quittung/Rechnung | null }
   * Vorbereitete Belege sind Entwürfe OHNE Nummer (status 'entwurf', termin: <id>) – die Nummer kommt erst beim Ausstellen,
   * eine Absage braucht deshalb keinen Storno. Erledigte Termine zeigen auf die ausgestellte Quittung. */
  const TERMINE = [];
  let tid = 0;
  const ZEITEN = [['08:00', '10:00'], ['09:30', '11:30'], ['10:00', '12:00'], ['13:00', '15:00'], ['14:30', '16:00'], ['16:00', '17:30']];
  const werktag = (d, dir = 1) => { while ([0, 6].includes(parse(d).getDay())) d = addDays(d, dir); return d; }; // keine Termine am Wochenende
  function termin(t) { const x = { id: 't' + (++tid), notiz: '', beleg: null, status: 'geplant', ...t }; TERMINE.push(x); return x; }
  function vorbereiten(t, art = 'quittung') {
    const r = { id: 'r' + (++rid), art, nr: null, status: 'entwurf', kontakt: t.kontakt, kunde: t.kunde, kundeAdresse: t.adresse, datum: t.datum, leistung: t.datum,
      faellig: art === 'rechnung' ? addDays(t.datum, FIRMA.zahlungszielTage) : t.datum, betreff: t.leistung,
      positionen: mkPos([[t.leistung, 1, 'pausch.', t.betrag]]), bezahltAm: null, zahlungsart: art === 'rechnung' ? 'bank' : 'bar', kat: 'dienstleistung', termin: t.id };
    rechnungen.push(r); t.beleg = r.id;
    return r;
  }
  { // erledigt: die zwei jüngsten Quittungen hatten einen Termin
    const qs = rechnungen.filter((r) => r.art === 'quittung' && r.status === 'bezahlt').sort((a, b) => (a.datum < b.datum ? 1 : -1)).slice(0, 2);
    qs.forEach((r, i) => { const k = KONTAKTE.find((x) => x.id === r.kontakt) || {}; const [von, bis] = ZEITEN[i + 1];
      const t = termin({ kontakt: r.kontakt, kunde: r.kunde, datum: r.datum, von, bis, adresse: adresseVon(k), leistung: r.betreff, betrag: posSumme(r.positionen), status: 'erledigt', beleg: r.id });
      r.termin = t.id; });
    // abgesagt (letzte Woche) und einer von gestern, der noch nachgetragen werden muss
    const k1 = einzelkunde();
    termin({ kontakt: k1.id, kunde: k1.name, datum: werktag(addDays(TODAY, -5), -1), von: '10:00', bis: '12:00', adresse: adresseVon(k1), leistung: 'Heckenschnitt', betrag: 14000, status: 'abgesagt', notiz: 'Kundin krank – meldet sich wieder' });
    const k2 = einzelkunde();
    vorbereiten(termin({ kontakt: k2.id, kunde: k2.name, datum: werktag(addDays(TODAY, -1), -1), von: '14:30', bis: '16:00', adresse: adresseVon(k2), leistung: 'Laub entfernen', betrag: 9000 }));
    // anstehend: die nächsten zwei Wochen, teils mit vorbereiteter Quittung, eine Firma mit Rechnung
    const plan = [[0, 'Rasenmähen inkl. Grünschnitt', 6500, true], [1, 'Regenrinne reinigen', 11000, true], [2, 'Möbelmontage (2 Schränke)', 15200, false],
      [4, 'Laub entfernen', 8500, true], [6, 'Kleinreparatur im Haushalt', 7600, false], [9, 'Beet winterfest machen', 18000, true], [13, 'Heckenschnitt', 21000, false]];
    plan.forEach(([d, leistung, betrag, vor], i) => {
      const k = i === 1 || i === 5 ? pick(privatkunden.filter((x) => x.notiz)) || einzelkunde() : einzelkunde();
      const [von, bis] = ZEITEN[(i * 2) % ZEITEN.length];
      const t = termin({ kontakt: k.id, kunde: k.name, datum: werktag(addDays(TODAY, d)), von, bis, adresse: adresseVon(k), leistung, betrag });
      if (vor) vorbereiten(t);
    });
    const hv = firmenkunden.find((x) => x.name === 'Hausverwaltung Kaiser');
    if (hv) vorbereiten(termin({ kontakt: hv.id, kunde: hv.name, datum: werktag(addDays(TODAY, 3)), von: '08:00', bis: '12:00', adresse: adresseVon(hv), leistung: 'Grünanlagenpflege Wohnanlage Seeufer', betrag: 38000, notiz: 'Schlüssel beim Hausmeister' }), 'rechnung');
  }

  /* ---------- Steuer-Kennwerte, Variablen, Kennzahlen, Planung ---------- */
  const PARAMS = {};
  [Y - 1, Y, Y + 1].forEach((yy) => {
    PARAMS[yy] = { ku_grenze_vorjahr: 25000, ku_grenze_laufend: 100000, gwg: 800, gewst_freibetrag: 24500, kleinbetrag: 250, km_satz: 0.3, bewirtung_quote: 0.7, geschenke_grenze: 50 };
  });
  const VARIABLEN = [
    { name: 'STEUERQUOTE', wert: 0.25, text: 'Anteil des Gewinns, den ich für Steuern zurücklege' },
    { name: 'STUNDENSATZ', wert: 38, text: 'Mein Stundensatz in €' },
    { name: 'STUNDEN', wert: 720, text: 'Geschätzte Arbeitsstunden pro Jahr im Gewerbe' }
  ];
  const KENNZAHLEN = [
    { id: 'kz1', name: 'Überschuss', formel: 'EINNAHMEN() - AUSGABEN()', format: 'eur', text: 'Einnahmen minus abziehbare Ausgaben (Gewinn laut EÜR).' },
    { id: 'kz2', name: 'Gewinnmarge', formel: 'TEILEN(GEWINN(); EINNAHMEN(); 0)', format: 'prozent', text: 'Wie viel von jedem eingenommenen Euro übrig bleibt.', ampel: { gruen: 0.3, gelb: 0.1 }, anheften: true },
    { id: 'kz3', name: 'Steuerrücklage', formel: 'MAX(0; GEWINN(zeitraum: YTD)) * STEUERQUOTE', format: 'eur', text: 'Empfohlene Rücklage für Einkommensteuer auf den Gewinn seit Jahresbeginn.', anheften: true },
    { id: 'kz4', name: 'Hochrechnung Jahresumsatz', formel: 'TEILEN(KU_UMSATZ(zeitraum: YTD); MONATE_VERGANGEN(); 0) * 12', format: 'eur', text: 'Umsatz seit Jahresbeginn, hochgerechnet auf 12 Monate.', anheften: true },
    { id: 'kz5', name: 'KU-Spielraum bis 25.000 €', formel: 'PARAM("ku_grenze_vorjahr") - KU_UMSATZ(zeitraum: JAHR)', format: 'eur', text: 'Wie viel Umsatz dieses Jahr noch möglich ist, damit die Kleinunternehmerregelung auch nächstes Jahr gilt.', ampel: { gruen: 5000, gelb: 2000 } },
    { id: 'kz6', name: 'Ø Auftragswert', formel: 'TEILEN(SUMME(RECHNUNGEN; status: "bezahlt"); ANZAHL(RECHNUNGEN; status: "bezahlt"); 0)', format: 'eur', text: 'Durchschnittlicher Betrag pro Quittung bzw. Rechnung.' },
    { id: 'kz7', name: 'Anzahl Aufträge', formel: 'ANZAHL(RECHNUNGEN)', format: 'zahl', text: 'Ausgestellte Quittungen und Rechnungen im Zeitraum.' },
    { id: 'kz8', name: 'Kosten pro Monat', formel: 'TEILEN(AUSGABEN(); MONATE(); 0)', format: 'eur', text: 'Durchschnittliche Ausgaben je Monat.' },
    { id: 'kz9', name: 'Spritkosten pro Monat', formel: 'TEILEN(AUSGABEN(kategorie: "Sprit"); MONATE(); 0)', format: 'eur', text: 'Tanken, Werkstatt und Kfz-Versicherung je Monat.' },
    { id: 'kz10', name: 'Produktkostenquote', formel: 'TEILEN(AUSGABEN(kategorie: "Produkte"); EINNAHMEN(); 0)', format: 'prozent', text: 'Anteil der eingekauften Produkte & Materialien an den Einnahmen.', ampel: { gruen: 0.15, gelb: 0.25, richtung: 'niedrig' } },
    { id: 'kz11', name: 'Anteil Barumsatz', formel: 'TEILEN(EINNAHMEN(zahlungsart: "bar"); EINNAHMEN(); 0)', format: 'prozent', text: 'Anteil der Einnahmen, die bar bezahlt werden.' },
    { id: 'kz12', name: 'Umsatzwachstum', formel: 'TEILEN(EINNAHMEN(); VORJAHR(EINNAHMEN()); 0) - 1', format: 'prozent', text: 'Einnahmen im Vergleich zum gleichen Zeitraum im Vorjahr.' }
  ];
  /* Planposten für die Liquiditätsvorschau (Datum relativ zu heute) */
  const PLANPOSTEN = [
    { id: 'p1', datum: addDays(TODAY, 33), text: 'Anschaffung Aufsitzmäher (gebraucht)', betrag: -149000, art: 'ausgabe' },
    { id: 'p2', datum: addDays(TODAY, 19), text: 'Winterreifen Transporter', betrag: -48000, art: 'ausgabe' },
    { id: 'p3', datum: addDays(TODAY, 56), text: 'Winterdienst-Vertrag Hausverwaltung (erwartet)', betrag: 60000, art: 'einnahme' }
  ].filter((p) => p.datum > TODAY);

  /* ---------- Hilfsfunktionen ---------- */
  const kat = (id) => KATEGORIEN.find((k) => k.id === id);
  const kontakt = (id) => KONTAKTE.find((k) => k.id === id);
  /* Zahlungsweg; alte Werte ('karte', 'privat') zählen als Überweisung */
  const zahlungsart = (id) => ZAHLUNGSARTEN.find((z) => z.id === id) || ZAHLUNGSARTEN.find((z) => z.id === 'bank');
  const rechnungSumme = (r) => posSumme(r.positionen);
  /* Name des Gegenübers: Kunde (Kontakt oder freier Name) bzw. Geschäft bei Ausgaben */
  const gegenueber = (x) => {
    if (!x) return '';
    if (x.kunde && (x.nr || x.typ)) return x.kunde; // ausgestellter Beleg bzw. Buchung: Name wie damals (GoBD-Schnappschuss)
    const k = x.kontakt ? kontakt(x.kontakt) : null;
    return k ? k.name : x.kunde || x.lieferant || '';
  };
  /* Feste Kundennummer (K-0001 …); fehlt sie (neu angelegter Kunde), wird die nächste freie vergeben und am Kunden gemerkt */
  function kundenNr(k) {
    if (!k) return '';
    if (!k.nr) k.nr = 'K-' + String(KONTAKTE.reduce((m, x) => Math.max(m, +(String(x.nr || '').match(/\d+/) || [0])[0]), 0) + 1).padStart(4, '0');
    return k.nr;
  }
  /* Geldfluss einer Buchung mit Vorzeichen (Cent): Einnahme +, Ausgabe − */
  const netto = (b) => (b.typ === 'einnahme' ? b.betrag : b.typ === 'ausgabe' ? -b.betrag : 0);
  /* Nächste laufende Nummer einer Belegart, z. B. 'QU-2026-088' */
  function naechsteNr(art, jahr = Y) {
    const p = `${PREFIX[art]}-${jahr}-`;
    const max = rechnungen.filter((r) => r.nr && r.nr.startsWith(p)).reduce((mx, r) => Math.max(mx, +r.nr.slice(p.length)), 0);
    return p + String(max + 1).padStart(3, '0');
  }

  return {
    VERSION: 5, TODAY, START, FIRMA, ZAHLUNGSARTEN, KATEGORIEN, KONTAKTE, TERMINE, WIEDERKEHREND, PARAMS, VARIABLEN, KENNZAHLEN, PLANPOSTEN, PREFIX,
    buchungen, rechnungen,
    kat, kontakt, kundenNr, zahlungsart, rechnungSumme, gegenueber, netto, naechsteNr, chrono,
    util: { pad, iso, parse, addDays, daysIn, dateIn, diffDays, slug }
  };
})();
