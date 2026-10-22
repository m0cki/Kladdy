import { describe, expect, it } from 'vitest';
import {
  anschriftLesen,
  anschriftText,
  artWechseln,
  betreffSetzen,
  faelligAus,
  faelligText,
  filtere,
  formularAusDokument,
  formularAusEntwurf,
  formularSumme,
  formularZuDaten,
  formularZuDokument,
  listenBetrag,
  neuesFormular,
  parseMenge,
  passtReiter,
  positionenAus,
  preisEingabe,
  statusMenue,
  statusSchluessel,
  type BelegFormular,
  type BelegZeile,
  type KundeAnschrift,
} from './rechnungen';
import { BEISPIEL_FIRMA } from './vorlagen/beispiel';
import { STANDARD_TEXTE } from './vorlagen/dokument';

const HEUTE = '2026-10-22';

const zeile = (z: Partial<BelegZeile>): BelegZeile => ({
  id: 1,
  art: 'rechnung',
  nummer: 'RE-2026-001',
  status: 'offen',
  kunde_id: 1,
  kunde_name: 'Hausverwaltung Kaiser',
  datum: '2026-10-01',
  faellig_am: '2026-10-15',
  bezahlt_am: null,
  zahlungsart: null,
  betreff: 'Heckenschnitt',
  summe_cent: 15_300,
  termin_id: null,
  termin_datum: null,
  termin_von: null,
  termin_status: null,
  storno_von_id: null,
  storniert_am: null,
  pdf_beleg_id: null,
  scan_beleg_id: null,
  ...z,
});

const KUNDEN: KundeAnschrift[] = [
  { id: 1, nummer: 'K-0001', name: 'Anna Schmidt', zusatz: null, strasse: 'Gartenweg 3', plz: '12390', ort: 'Seehausen', email: 'anna@example.de' },
  { id: 2, nummer: 'K-0002', name: 'Bob Bauer', zusatz: null, strasse: null, plz: null, ort: null, email: null },
  { id: 3, nummer: 'K-0003', name: 'Bob Bauer', zusatz: null, strasse: 'Lindenweg 1', plz: '12345', ort: 'Musterstadt', email: null },
];

const formular = (f: Partial<BelegFormular> = {}): BelegFormular => ({ ...neuesFormular({ art: 'rechnung' }, { heute: HEUTE, zielTage: {} }), ...f });

describe('Status', () => {
  it('überfällig, vorbereitet, Sonderfälle je Art', () => {
    expect(statusSchluessel(zeile({}), HEUTE)).toBe('ueberfaellig');
    expect(statusSchluessel(zeile({ faellig_am: HEUTE }), HEUTE)).toBe('offen');
    expect(statusSchluessel(zeile({ status: 'entwurf', nummer: null }), HEUTE)).toBe('entwurf');
    expect(statusSchluessel(zeile({ status: 'entwurf', nummer: null, termin_id: 4 }), HEUTE)).toBe('vorbereitet');
    expect(statusSchluessel(zeile({ art: 'eigenbeleg', status: 'bezahlt' }), HEUTE)).toBe('gebucht');
    expect(statusSchluessel(zeile({ art: 'angebot', faellig_am: '2026-10-01' }), HEUTE)).toBe('abgelaufen');
    expect(statusSchluessel(zeile({ art: 'angebot', status: 'angenommen' }), HEUTE)).toBe('angenommen');
    expect(statusSchluessel(zeile({ art: 'storno', status: 'storniert' }), HEUTE)).toBe('stornobeleg');
    expect(statusSchluessel(zeile({ status: 'storniert' }), HEUTE)).toBe('storniert');
  });

  it('Reiter: Offen = offene Rechnungen + Vorbereitungen für geplante Termine, Bezahlt ohne Angebote', () => {
    expect(passtReiter(zeile({}), 'offen')).toBe(true);
    expect(passtReiter(zeile({ art: 'quittung', status: 'bezahlt' }), 'offen')).toBe(false);
    expect(passtReiter(zeile({ status: 'entwurf', nummer: null, termin_id: 4, termin_status: 'geplant' }), 'offen')).toBe(true);
    expect(passtReiter(zeile({ status: 'entwurf', nummer: null, termin_id: 4, termin_status: 'erledigt' }), 'offen')).toBe(false);
    expect(passtReiter(zeile({ art: 'quittung', status: 'bezahlt' }), 'bezahlt')).toBe(true);
    expect(passtReiter(zeile({ art: 'angebot', status: 'bezahlt' }), 'bezahlt')).toBe(false);
    expect(passtReiter(zeile({ art: 'storno', status: 'storniert' }), 'bezahlt')).toBe(false);
  });

  it('Status-Menü je Art', () => {
    const aktionen = (z: BelegZeile) => statusMenue(z, HEUTE).punkte.map((p) => p.aktion);
    expect(aktionen(zeile({}))).toEqual(['bezahlt', 'stornieren']);
    expect(aktionen(zeile({ status: 'bezahlt', bezahlt_am: '2026-10-10' }))).toEqual(['doch-offen', 'stornieren']);
    expect(aktionen(zeile({ art: 'quittung', status: 'bezahlt' }))).toEqual(['als-rechnung', 'stornieren']);
    expect(aktionen(zeile({ art: 'angebot', faellig_am: '2026-11-30' }))).toEqual(['angebot-offen', 'umwandeln', 'angebot-abgelehnt']);
    expect(aktionen(zeile({ art: 'angebot', status: 'angenommen' }))).toEqual(['rechnung-oeffnen']);
    expect(aktionen(zeile({ status: 'storniert' }))).toEqual(['duplizieren']);
    expect(aktionen(zeile({ art: 'quittung', status: 'entwurf', nummer: null, termin_id: 3, termin_datum: '2026-10-24' }))).toEqual([
      'ausstellen',
      'zum-termin',
      'vorbereitung-weg',
    ]);
    expect(statusMenue(zeile({}), HEUTE).text).toContain('Seit 7 Tagen überfällig');
    expect(statusMenue(zeile({ art: 'angebot' }), HEUTE).punkte[0].art).toBe('on');
  });
});

describe('Liste', () => {
  const alle = [
    zeile({ id: 1, nummer: 'RE-2026-001', datum: '2026-09-20', faellig_am: '2026-10-04' }),
    zeile({ id: 2, art: 'quittung', nummer: 'QU-2026-007', status: 'bezahlt', datum: '2026-10-05', kunde_name: 'Anna Schmidt', summe_cent: 6_500, betreff: 'Rasen mähen' }),
    zeile({ id: 3, art: 'quittung', nummer: null, status: 'entwurf', datum: '2026-10-21', kunde_name: null, summe_cent: 0 }),
    zeile({ id: 4, art: 'angebot', nummer: 'AN-2026-002', datum: '2026-10-10', faellig_am: '2026-11-09' }),
  ];
  const oktober = { von: '2026-10-01', bis: '2026-10-31' };
  const nr = { feld: 'nr', richtung: -1 } as const;

  it('Zeitraum nach Belegdatum, „Offen“ und Suche über alle Zeiträume', () => {
    const r = filtere(alle, { reiter: 'alle', q: '', zeitraum: oktober, sortierung: nr, heute: HEUTE });
    expect(r.zeilen.map((z) => z.id)).toEqual([3, 4, 2]);
    expect(r.reiter).toEqual({ alle: 3, offen: 1, bezahlt: 1 });
    expect(r.ueberfaellig).toBe(1);
    expect(r.ohneZeitraum).toBe(false);
    const offen = filtere(alle, { reiter: 'offen', q: '', zeitraum: oktober, sortierung: nr, heute: HEUTE });
    expect(offen.zeilen.map((z) => z.id)).toEqual([1]);
    expect(offen.ohneZeitraum).toBe(true);
    const suche = filtere(alle, { reiter: 'alle', q: 'kaiser', zeitraum: oktober, sortierung: nr, heute: HEUTE });
    expect(suche.zeilen.map((z) => z.id)).toEqual([4, 1]);
    const betrag = filtere(alle, { reiter: 'alle', q: '65,00', zeitraum: null, sortierung: nr, heute: HEUTE });
    expect(betrag.zeilen.map((z) => z.id)).toEqual([2]);
    const entwurf = filtere(alle, { reiter: 'alle', q: 'entwurf', zeitraum: null, sortierung: nr, heute: HEUTE });
    expect(entwurf.zeilen.map((z) => z.id)).toEqual([3]);
  });

  it('Sortierung nach Betrag und Kunde', () => {
    const betrag = filtere(alle, { reiter: 'alle', q: '', zeitraum: null, sortierung: { feld: 'betrag', richtung: -1 }, heute: HEUTE });
    expect(betrag.zeilen.map((z) => z.summe_cent)).toEqual([15_300, 15_300, 6_500, 0]);
    const kunde = filtere(alle, { reiter: 'alle', q: '', zeitraum: null, sortierung: { feld: 'kunde', richtung: 1 }, heute: HEUTE });
    expect(kunde.zeilen[0].id).toBe(3);
    expect(kunde.zeilen[1].kunde_name).toBe('Anna Schmidt');
  });

  it('Spalte „Fällig / Zahlung“ und Betrag', () => {
    expect(faelligText(zeile({}), HEUTE)).toMatchObject({ text: '7 T. überfällig', klasse: 'neg' });
    expect(faelligText(zeile({ faellig_am: HEUTE }), HEUTE).text).toBe('heute fällig');
    expect(faelligText(zeile({ faellig_am: '2026-10-23' }), HEUTE).text).toBe('in 1 Tag');
    expect(faelligText(zeile({ art: 'quittung', status: 'bezahlt', zahlungsart: 'bar', bezahlt_am: '2026-10-05' }), HEUTE).text).toBe('bar · 05.10.');
    expect(faelligText(zeile({ status: 'entwurf', nummer: null, termin_id: 2, termin_datum: '2026-10-24', termin_von: '09:00' }), HEUTE).text).toBe(
      'Termin 24.10. · 09:00',
    );
    expect(listenBetrag(zeile({ art: 'eigenbeleg', summe_cent: 450 }))).toBe('\u22124,50\u00a0€');
    expect(listenBetrag(zeile({ art: 'storno', summe_cent: -15_300 }))).toBe('\u2212153,00\u00a0€');
  });
});

describe('Formular', () => {
  it('Mengen, Preise, Positionen', () => {
    expect(parseMenge('1,5')).toBe(1.5);
    expect(parseMenge('2')).toBe(2);
    expect(parseMenge('0.25')).toBe(0.25);
    expect(parseMenge('1,23456')).toBe(1.235);
    expect(parseMenge('x')).toBeNull();
    expect(parseMenge('')).toBeNull();
    expect(preisEingabe(4_550)).toBe('45,50');
    expect(preisEingabe(0)).toBe('');
    const f = formular({
      positionen: [
        { beschreibung: 'Heckenschnitt', menge: '3', einheit: 'Std.', preis: '45', kategorieId: null },
        { beschreibung: '', menge: '1', einheit: 'Stk.', preis: '', kategorieId: null },
        { beschreibung: 'Dünger', menge: '2,5', einheit: 'kg', preis: '3,99', kategorieId: null },
      ],
    });
    expect(positionenAus(f)).toEqual([
      { beschreibung: 'Heckenschnitt', menge: 3, einheit: 'Std.', einzelpreis_cent: 4_500 },
      { beschreibung: 'Dünger', menge: 2.5, einheit: 'kg', einzelpreis_cent: 399 },
    ]);
    expect(formularSumme(f)).toBe(13_500 + 998);
  });

  it('Fälligkeit aus Zahlungsziel, Anschrift lesen und schreiben', () => {
    expect(faelligAus({ art: 'rechnung', datum: '2026-10-22', zielTage: '14' })).toBe('2026-11-05');
    expect(faelligAus({ art: 'angebot', datum: '2026-10-22', zielTage: '30' })).toBe('2026-11-21');
    expect(faelligAus({ art: 'quittung', datum: '2026-10-22', zielTage: '14' })).toBeNull();
    const a = anschriftLesen('z. Hd. Frau Kaiser\nSeeufer 5\n12390 Seehausen');
    expect(a).toEqual({ zusatz: 'z. Hd. Frau Kaiser', strasse: 'Seeufer 5', plz: '12390', ort: 'Seehausen' });
    expect(anschriftText(a)).toBe('z. Hd. Frau Kaiser\nSeeufer 5\n12390 Seehausen');
  });

  it('neues Formular aus der Erfassen-Schublade', () => {
    const f = neuesFormular({ art: 'quittung', betrag: 6_500, text: 'Rasen mähen', kunde: KUNDEN[0], datum: '2026-10-20' }, { heute: HEUTE, zielTage: {} });
    expect(f.kunde).toBe('Anna Schmidt · K-0001');
    expect(f.adresse).toBe('Gartenweg 3\n12390 Seehausen');
    expect(f.positionen).toEqual([{ beschreibung: 'Rasen mähen', menge: '1', einheit: 'Stk.', preis: '65,00', kategorieId: null }]);
    expect(f.zahlungsart).toBe('bar');
    expect(f.schlusstext).toBe(STANDARD_TEXTE.quittung.schlusstext);
    const r = neuesFormular({ art: 'rechnung', bezahlt: true }, { heute: HEUTE, zielTage: { rechnung: 7 } });
    expect(r.zielTage).toBe('7');
    expect(r.bezahltAm).toBe(HEUTE);
  });

  it('Kunde: gewählt, neu, Namensvettern', () => {
    const gewaehlt = formularZuDaten(formular({ kunde: 'Anna Schmidt · K-0001', adresse: 'egal' }), KUNDEN);
    expect(gewaehlt.ok && gewaehlt.daten).toMatchObject({ kunde_id: 1, kunde_name: null, kunde_adresse: null });
    const ohneAdresse = formularZuDaten(formular({ kunde: 'Bob Bauer · K-0002', adresse: 'Am Hang 2\n12345 Musterstadt' }), KUNDEN);
    expect(ohneAdresse.ok && ohneAdresse.daten).toMatchObject({ kunde_id: 2, kunde_adresse: 'Am Hang 2\n12345 Musterstadt' });
    const neu = formularZuDaten(formular({ kunde: 'Carla Neu', adresse: 'Weg 1\n12345 Ort' }), KUNDEN);
    expect(neu.ok && neu.daten).toMatchObject({ kunde_id: null, kunde_name: 'Carla Neu', kunde_adresse: 'Weg 1\n12345 Ort' });
    const wahl = formularZuDaten(formular({ kunde: 'Bob Bauer' }), KUNDEN);
    expect(wahl.ok).toBe(false);
    if (!wahl.ok) expect(wahl.fehler.kunde).toContain('Mehrere Kunden');
    const bewusst = formularZuDaten(formular({ kunde: 'Bob Bauer', kundeBewusstNeu: 'bob bauer' }), KUNDEN);
    expect(bewusst.ok && bewusst.daten.kunde_name).toBe('Bob Bauer');
    const eigen = formularZuDaten(formular({ art: 'eigenbeleg', kunde: 'Anna Schmidt · K-0001' }), KUNDEN);
    expect(eigen.ok && eigen.daten).toMatchObject({ kunde_id: null, kunde_name: 'Anna Schmidt · K-0001' });
  });

  it('Daten für Rust: Fälligkeit, Zahlungsweg, Zusatzangaben', () => {
    const r = formularZuDaten(formular({ kunde: 'Anna Schmidt · K-0001', datum: '2026-10-22', zielTage: '14' }), KUNDEN);
    expect(r.ok && r.daten).toMatchObject({ art: 'rechnung', faellig_am: '2026-11-05', zahlungsart: null, bezahlt_am: null, leistung_von: '2026-10-22' });
    const bezahlt = formularZuDaten(formular({ kunde: 'Anna Schmidt · K-0001', bezahltAm: '2026-10-20', zahlungsart: 'paypal' }), KUNDEN);
    expect(bezahlt.ok && bezahlt.daten).toMatchObject({ zahlungsart: 'paypal', bezahlt_am: '2026-10-20' });
    const eb = formularZuDaten(
      formular({
        art: 'eigenbeleg',
        kunde: 'Parkhaus',
        grund: 'sonstiges',
        grundText: ' Automat defekt ',
        buchungId: 9,
        positionen: [{ beschreibung: 'Parken', menge: '1', einheit: '', preis: '4,50', kategorieId: 3 }],
      }),
      KUNDEN,
    );
    expect(eb.ok && eb.daten.zusatz).toEqual({ grund: 'sonstiges', grund_text: 'Automat defekt', buchung_id: 9 });
    expect(eb.ok && eb.daten.positionen).toEqual([{ beschreibung: 'Parken', menge: 1, einheit: null, einzelpreis_cent: 450, kategorie_id: 3 }]);
    const falsch = formularZuDaten(formular({ positionen: [{ beschreibung: 'x', menge: 'viel', einheit: '', preis: '1', kategorieId: null }] }), KUNDEN);
    expect(falsch.ok).toBe(false);
  });

  it('Dokument für die Vorschau: quittiert, Kunde aus der Kartei, Eigenbeleg', () => {
    const ctx = { kunden: KUNDEN, firma: BEISPIEL_FIRMA, ustModus: 'klein' as const };
    const d = formularZuDokument(formular({ kunde: 'Anna Schmidt · K-0001', datum: '2026-10-22', bezahltAm: '2026-10-22', zahlungsart: 'bank' }), ctx);
    expect(d.quittiert).toEqual({ am: '2026-10-22', zahlungsweg: 'bank' });
    expect(d.kunde).toMatchObject({ id: 1, nummer: 'K-0001', strasse: 'Gartenweg 3', ort: 'Seehausen' });
    expect(d.faellig_am).toBe('2026-11-05');
    const ohne = formularZuDokument(formular({ kunde: 'Bob Bauer · K-0002', adresse: 'Am Hang 2\n12345 Musterstadt' }), ctx);
    expect(ohne.kunde).toMatchObject({ id: 2, strasse: 'Am Hang 2', plz: '12345' });
    const eb = formularZuDokument(formular({ art: 'eigenbeleg', kunde: 'Parkhaus am Markt', grund: 'kein' }), ctx);
    expect(eb.kunde).toMatchObject({ id: null, name: 'Parkhaus am Markt' });
    expect(eb.eigenbeleg).toEqual({ grund: 'kein', grund_text: '', gebucht: null });
    expect(eb.faellig_am).toBeNull();
  });

  it('Art wechseln: Standardtexte und Empfänger', () => {
    const r = formular({ kunde: 'Anna Schmidt · K-0001', positionen: [{ beschreibung: 'Rasen', menge: '1', einheit: 'Stk.', preis: '65', kategorieId: null }] });
    const q = artWechseln(r, 'quittung');
    expect(q.einleitung).toBe(STANDARD_TEXTE.quittung.einleitung);
    expect(q.kunde).toBe('Anna Schmidt · K-0001');
    expect(q.zahlungsart).toBe('bar');
    const eb = artWechseln(q, 'eigenbeleg');
    expect(eb.kunde).toBe('');
    expect(eb.positionen).toHaveLength(1);
    expect(eb.positionen[0].preis).toBe('65,00');
    const eigeneEinleitung = artWechseln(formular({ einleitung: 'Hallo!' }), 'angebot');
    expect(eigeneEinleitung.einleitung).toBe('Hallo!');
    expect(eigeneEinleitung.zielTage).toBe('30');
  });

  it('Betreff ist bei der Quittung mit einem Betrag zugleich die Position', () => {
    const q = neuesFormular({ art: 'quittung' }, { heute: HEUTE, zielTage: {} });
    expect(betreffSetzen(q, 'Hecke').positionen[0].beschreibung).toBe('Hecke');
    expect(betreffSetzen({ ...q, mehrere: true }, 'Hecke').positionen[0].beschreibung).toBe('');
    expect(betreffSetzen(formular(), 'Hecke').positionen[0].beschreibung).toBe('');
  });

  it('Entwurf aus der Datenbank und ausgestellter Beleg zum Anzeigen', () => {
    const f = formularAusEntwurf(
      {
        id: 5,
        art: 'eigenbeleg',
        kunde_id: null,
        kunde_name: 'Parkhaus',
        kunde_adresse: null,
        kunde_nummer_live: null,
        kunde_name_live: null,
        datum: '2026-10-20',
        leistung_von: '2026-10-20',
        leistung_bis: null,
        faellig_am: null,
        betreff: 'Parken',
        einleitung: null,
        schlusstext: null,
        zahlungsart: 'bar',
        bezahlt_am: null,
        vorlage_id: null,
        termin_id: null,
        entwurf_json: '{"grund":"kein","buchung_id":4}',
      },
      [{ beschreibung: 'Parken', menge: 1, einheit: null, einzelpreis_cent: 450, kategorie_id: 3 }],
      HEUTE,
    );
    expect(f).toMatchObject({ art: 'eigenbeleg', kunde: 'Parkhaus', grund: 'kein', buchungId: 4, zahlungsart: 'bar' });
    expect(f.positionen[0]).toEqual({ beschreibung: 'Parken', menge: '1', einheit: '', preis: '4,50', kategorieId: 3 });
    const doc = formularZuDokument(formular({ kunde: 'Anna Schmidt · K-0001' }), { kunden: KUNDEN, firma: BEISPIEL_FIRMA, ustModus: 'klein' });
    const anzeige = formularAusDokument({ ...doc, nummer: 'RE-2026-001' }, { vorlageId: null, terminId: null });
    expect(anzeige.kunde).toBe('Anna Schmidt · K-0001');
    expect(anzeige.adresse).toBe('Gartenweg 3\n12390 Seehausen');
    expect(anzeige.zielTage).toBe('14');
  });
});
