import { describe, expect, it } from 'vitest';
import type { Formular } from './buchungen';
import {
  bankHinweise,
  belegFormular,
  belegHinweis,
  belegVorbereiten,
  betragEingebbar,
  betragInPosition,
  ertragBuchungstext,
  ertragFaellig,
  ertragOeffnen,
  ertragPosition,
  ertragPruefen,
  ertragSchluessel,
  ertragStart,
  ertragSumme,
  positionenAusBuchung,
  positionenPruefen,
  hinweis35a,
  karteiAnschrift,
  maskenPfad,
  naechsteBelegNummer,
  papierGewaehlt,
  offeneRechnungen,
  offenFaellig,
  rechnungOffen,
  vorlageFuer,
  type Ertrag,
  type ErtragKontext,
} from './ertrag';
import type { Nummernkreis } from './numbering';
import { neuesFormular, type BelegFormular, type BelegZeile, type KundeAnschrift } from './rechnungen';
import { BEISPIEL_FIRMA } from './vorlagen/beispiel';
import { standardVorlage } from './vorlagen/standard';

const HEUTE = '2026-10-22';

const KUNDEN: KundeAnschrift[] = [
  { id: 1, nummer: 'K-0001', name: 'Anna Schmidt', zusatz: null, strasse: 'Gartenweg 3', plz: '12390', ort: 'Seehausen', email: 'anna@example.de' },
  { id: 2, nummer: 'K-0002', name: 'Bob Bauer', zusatz: null, strasse: null, plz: null, ort: null, email: null },
];

const KREISE: Nummernkreis[] = [
  { id: 'quittung', muster: 'QU-{JJJJ}-{NNN}', jahr: 2026, naechste: 105 },
  { id: 'rechnung', muster: 'RE-{JJJJ}-{NNN}', jahr: 2026, naechste: 15 },
];

const ctx: ErtragKontext = {
  kunden: KUNDEN,
  firma: BEISPIEL_FIRMA,
  ustModus: 'klein',
  kreise: KREISE,
  kennwerte: new Map([[2026, { kleinbetragsrechnung_cent: 25_000 }]]),
  vorlagen: {
    quittung: [
      { schluessel: 'klassisch', id: null, design: 'klassisch', name: 'Klassisch', bausteine: standardVorlage('quittung'), aktiv: true },
      { schluessel: 'formular', id: null, design: 'formular', name: 'Formular', bausteine: standardVorlage('quittung', 'formular'), aktiv: false },
    ],
    rechnung: [{ schluessel: 'eigen:7', id: 7, design: 'klassisch', name: 'Meine Rechnung', bausteine: standardVorlage('rechnung'), aktiv: true }],
  },
  zahlungszielTage: 14,
  heute: HEUTE,
};

const formular = (x: Partial<Formular> = {}): Formular => ({
  typ: 'einnahme',
  betrag: '60,00',
  kategorieId: 9,
  zahlungsdatum: HEUTE,
  belegnummer: '',
  beschreibung: 'Rasen mähen',
  wer: 'Anna Schmidt · K-0001',
  kundeBewusstNeu: null,
  privat: '',
  zahlungsart: 'bar',
  ...x,
});

// wie aus der Schublade: eine Position mit Text und Betrag der Vorbelegung
const ertrag = (x: Partial<Ertrag> = {}): Ertrag => ({ ...ertragStart({ text: 'Rasen mähen', betrag: 6_000 }, 'quittung'), ...x });

const zeile = (x: Partial<BelegZeile>): BelegZeile => ({
  id: 1,
  art: 'rechnung',
  nummer: 'RE-2026-001',
  status: 'offen',
  kunde_id: 1,
  kunde_name: 'Anna Schmidt',
  datum: '2026-10-01',
  faellig_am: '2026-10-15',
  bezahlt_am: null,
  zahlungsart: null,
  betreff: 'Hecke schneiden',
  summe_cent: 15_300,
  termin_id: null,
  termin_datum: null,
  termin_von: null,
  termin_status: null,
  storno_von_id: null,
  storniert_am: null,
  pdf_beleg_id: null,
  scan_beleg_id: null,
  ...x,
});

describe('Start und Hinweise', () => {
  it('Vorauswahl: Beleg erstellen mit der Art aus den Einstellungen, mit Datei ohne eigenen Beleg', () => {
    expect(ertragStart({}, 'rechnung')).toMatchObject({ weg: 'beleg', art: 'rechnung', bezahlt: true, offenId: null });
    expect(ertragStart({ beleg: 'quittung' }, 'rechnung')).toMatchObject({ weg: 'beleg', art: 'quittung' });
    expect(ertragStart({ belege: [{}] }, 'quittung').weg).toBe('ohne');
    expect(ertragStart({ beleg: 'rechnung', belege: [{}] }, 'quittung').weg).toBe('beleg');
  });

  it('Einstellung „Nur buchen“: neue Einnahme ohne Beleg aus Kladdy, Termin und Entwurf behalten ihren Beleg', () => {
    expect(ertragStart({}, 'quittung', 'ohne')).toMatchObject({ weg: 'ohne', art: 'quittung' });
    expect(ertragStart({ beleg: 'quittung' }, 'quittung', 'ohne').weg).toBe('beleg');
    expect(ertragStart({ termin: 4 }, 'quittung', 'ohne').weg).toBe('beleg');
    expect(ertragStart({ entwurf: 9 }, 'rechnung', 'ohne').weg).toBe('beleg');
    expect(ertragStart({}, 'quittung', 'ohne').papier).toBeNull();
    expect(papierGewaehlt({ papier: null }, 'bar')).toBe(true);
    expect(papierGewaehlt({ papier: null }, 'bank')).toBe(false);
    expect(papierGewaehlt({ papier: false }, 'bar')).toBe(false);
  });

  it('Vorschau der nächsten Buchungsnummer wie der Belegnummern', () => {
    const kreise = [{ id: 'buchung', muster: '{JJJJ}-{NNNN}', jahr: 2026, naechste: 240 }] as Parameters<typeof naechsteBelegNummer>[0];
    expect(naechsteBelegNummer(kreise, 'buchung', '2026-11-05', '2026-11-05')).toBe('2026-0240');
    expect(naechsteBelegNummer(kreise, 'buchung', '2027-01-02', '2027-01-02')).toBe('2027-0001');
    expect(naechsteBelegNummer([], 'buchung', '2026-11-05', '2026-11-05')).toBeNull();
  });

  it('Rechnung noch offen, § 35a nur bei barer Zahlung mit eigenem Beleg', () => {
    expect(rechnungOffen(ertrag({ art: 'rechnung', bezahlt: false }))).toBe(true);
    expect(rechnungOffen(ertrag({ art: 'rechnung', bezahlt: true }))).toBe(false);
    expect(rechnungOffen(ertrag({ weg: 'ohne', art: 'rechnung', bezahlt: false }))).toBe(false);
    expect(hinweis35a(ertrag(), 'bar')).toMatch(/Dann Rechnung wählen/);
    expect(hinweis35a(ertrag({ art: 'rechnung' }), 'bar')).toMatch(/unbar zahlen/);
    expect(hinweis35a(ertrag({ art: 'rechnung', bezahlt: false }), 'bar')).toBeNull();
    expect(hinweis35a(ertrag(), 'bank')).toBeNull();
    expect(hinweis35a(ertrag({ weg: 'ohne' }), 'bar')).toBeNull();
    expect(belegHinweis(ertrag({ art: 'rechnung', bezahlt: false }))).toMatch(/erst, wenn das Geld eingeht/);
    expect(belegHinweis(ertrag())).toMatch(/mit der Einnahme verknüpft/);
  });

  it('ungespeichert nur bei eigenen Eingaben', () => {
    expect(ertragSchluessel(ertrag())).toBe(ertragSchluessel(ertrag({ art: 'rechnung', weg: 'ohne' })));
    expect(ertragSchluessel(ertrag())).not.toBe(ertragSchluessel(ertrag({ positionen: [ertragPosition('Hecke', 6_000)] })));
    expect(ertragSchluessel(ertrag())).not.toBe(ertragSchluessel(ertrag({ positionen: [...ertrag().positionen, ertragPosition()] })));
    expect(ertragSchluessel(ertrag())).not.toBe(ertragSchluessel(ertrag({ leistungVon: '2026-10-20' })));
    expect(ertragSchluessel(ertrag())).not.toBe(ertragSchluessel(ertrag({ zielTage: '30' })));
  });
});

describe('Nummer, offene Rechnungen, Prüfung', () => {
  it('nächste Nummer nach dem Jahr des Datums, nie rückwärts', () => {
    expect(naechsteBelegNummer(KREISE, 'quittung', '2026-10-22', HEUTE)).toBe('QU-2026-105');
    expect(naechsteBelegNummer(KREISE, 'rechnung', '2027-01-02', HEUTE)).toBe('RE-2027-001');
    expect(naechsteBelegNummer(KREISE, 'quittung', '2025-12-30', HEUTE)).toBe('QU-2026-105');
    expect(naechsteBelegNummer(KREISE, 'quittung', '', HEUTE)).toBe('QU-2026-105');
    expect(naechsteBelegNummer(KREISE, 'angebot', HEUTE, HEUTE)).toBeNull();
  });

  it('nur ausgestellte offene Rechnungen, die am längsten fälligen zuerst', () => {
    const liste = offeneRechnungen([
      zeile({ id: 1, faellig_am: '2026-10-30' }),
      zeile({ id: 2, faellig_am: '2026-10-10' }),
      zeile({ id: 3, status: 'bezahlt' }),
      zeile({ id: 4, art: 'quittung', status: 'bezahlt' }),
      zeile({ id: 5, nummer: null, status: 'entwurf' }),
      zeile({ id: 6, art: 'angebot', status: 'offen' }),
    ]);
    expect(liste.map((z) => z.id)).toEqual([2, 1]);
    expect(offenFaellig(liste[0], HEUTE)).toEqual({ text: '12 Tage überfällig', ueberfaellig: true });
    expect(offenFaellig(liste[1], HEUTE)).toEqual({ text: 'in 8 Tagen', ueberfaellig: false });
  });

  it('Rechnung braucht den Kunden, zuordnen eine Rechnung, das Exemplar genau eine Datei', () => {
    expect(ertragPruefen(formular(), ertrag(), 0)).toBeNull();
    expect(ertragPruefen(formular({ wer: '' }), ertrag(), 0)).toBeNull();
    expect(ertragPruefen(formular({ wer: ' ' }), ertrag({ art: 'rechnung' }), 0)).toMatchObject({ feld: 'wer' });
    expect(ertragPruefen(formular(), ertrag(), 2)).toMatchObject({ feld: 'dateien' });
    expect(ertragPruefen(formular(), ertrag({ weg: 'offen' }), 0)).toMatchObject({ feld: 'offen' });
    expect(ertragPruefen(formular(), ertrag({ weg: 'offen', offenId: 3 }), 5)).toBeNull();
    expect(ertragPruefen(formular({ wer: '' }), ertrag({ weg: 'ohne', art: 'rechnung' }), 3)).toBeNull();
    // Positionen zuerst: ohne Beschreibung kein Beleg
    expect(ertragPruefen(formular(), ertrag({ positionen: [ertragPosition('', 6_000)] }), 0)).toMatchObject({ feld: 'positionen' });
    expect(ertragPruefen(formular(), ertrag({ weg: 'ohne', positionen: [ertragPosition()] }), 0)).toBeNull();
  });

  it('Positionen prüfen: Text nötig, Zahlen lesbar, Menge über 0, leere Zeilen zählen nicht', () => {
    expect(positionenPruefen([ertragPosition('Rasen', 6_000)])).toBeNull();
    expect(positionenPruefen([ertragPosition('Rasen', 6_000), ertragPosition()])).toBeNull();
    expect(positionenPruefen([ertragPosition()])).toMatch(/Was wurde gemacht/);
    expect(positionenPruefen([ertragPosition('Rasen', 6_000), ertragPosition('', 2_000)])).toMatch(/^Position 2: Was wurde gemacht/);
    expect(positionenPruefen([{ ...ertragPosition('Rasen'), preis: '12,x' }])).toMatch(/Preis nicht lesbar/);
    expect(positionenPruefen([{ ...ertragPosition('Rasen', 100), menge: 'zwei' }])).toMatch(/Menge nicht lesbar/);
    expect(positionenPruefen([{ ...ertragPosition('Rasen', 100), menge: '0' }])).toMatch(/größer als 0/);
  });
});

describe('Beleg aus der Schublade', () => {
  it('Quittung für einen bekannten Kunden: die Position beschreibt die Leistung, aktive Vorlage', () => {
    const f = belegFormular(formular({ beschreibung: 'egal' }), ertrag({ positionen: [ertragPosition('Rasen mähen, 120 m²', 6_000)] }), ctx);
    expect(f).toMatchObject({ art: 'quittung', kunde: 'Anna Schmidt · K-0001', datum: HEUTE, leistungVon: HEUTE, leistungBis: '', betreff: '', mehrere: false, zahlungsart: 'bar', bezahltAm: null, vorlageId: null, vorlageDesign: 'klassisch' });
    expect(f.positionen).toEqual([{ beschreibung: 'Rasen mähen, 120 m²', menge: '1', einheit: 'Stk.', preis: '60,00', kategorieId: 9 }]);
    expect(karteiAnschrift(formular(), KUNDEN)?.id).toBe(1);
    expect(karteiAnschrift(formular({ wer: 'Bob Bauer · K-0002' }), KUNDEN)).toBeNull();
  });

  it('Rechnung bezahlt bzw. offen, neuer Kunde mit Anschrift', () => {
    const bezahlt = belegFormular(formular({ wer: 'Clara Neu', zahlungsart: 'bank' }), ertrag({ art: 'rechnung', adresse: 'Am Hang 2\n12345 Musterstadt' }), ctx);
    expect(bezahlt).toMatchObject({ art: 'rechnung', kunde: 'Clara Neu', adresse: 'Am Hang 2\n12345 Musterstadt', bezahltAm: HEUTE, zielTage: '14', vorlageId: 7 });
    const offen = belegFormular(formular({ wer: 'Clara Neu' }), ertrag({ art: 'rechnung', bezahlt: false }), ctx);
    expect(offen.bezahltAm).toBeNull();
    expect(vorlageFuer({ art: 'rechnung', vorlage: null }, ctx.vorlagen).id).toBe(7);
    expect(vorlageFuer({ art: 'rechnung', vorlage: { id: 99 } }, ctx.vorlagen).id).toBe(7);
    expect(vorlageFuer({ art: 'quittung', vorlage: null }, { ...ctx.vorlagen, quittung: [] }).name).toBe('Standard-Quittung');
  });

  it('Vorlage nach Design: gewähltes Design, ohne Design die id (null ⇒ klassisch), Unbekanntes ⇒ aktive', () => {
    expect(vorlageFuer({ art: 'quittung', vorlage: { id: null, design: 'formular' } }, ctx.vorlagen).name).toBe('Formular');
    expect(vorlageFuer({ art: 'quittung', vorlage: { id: null } }, ctx.vorlagen).design).toBe('klassisch');
    expect(vorlageFuer({ art: 'quittung', vorlage: { id: null, design: 'gibtsnicht' } }, ctx.vorlagen).design).toBe('klassisch');
    expect(vorlageFuer({ art: 'rechnung', vorlage: { id: null } }, ctx.vorlagen).id).toBe(7);
    const f = belegFormular(formular(), ertrag({ vorlage: { id: null, design: 'formular' } }), ctx);
    expect(f).toMatchObject({ vorlageId: null, vorlageDesign: 'formular' });
    const v = belegVorbereiten(formular(), ertrag({ vorlage: { id: null, design: 'formular' } }), ctx);
    // gedruckt wird das Formular; die Pflichtangaben sind auch dort vollständig
    expect(v.gedruckt.some((b) => b.typ === 'firmenblock')).toBe(true);
    expect(v.fehlt).toEqual([]);
    expect(v.daten?.zusatz).toMatchObject({ vorlage_design: 'formular' });
  });

  it('vorbereitet für beleg_ausstellen: Daten, Nummer, Pflichtangaben', () => {
    const q = belegVorbereiten(formular(), ertrag(), ctx);
    expect(q.fehlt).toEqual([]);
    expect(q.naechste).toBe('QU-2026-105');
    expect(q.daten).toMatchObject({ art: 'quittung', kunde_id: 1, kunde_name: null, kunde_adresse: null, datum: HEUTE, zahlungsart: 'bar', bezahlt_am: null });
    expect(q.daten?.positionen).toEqual([{ beschreibung: 'Rasen mähen', menge: 1, einheit: 'Stk.', einzelpreis_cent: 6_000, kategorie_id: null }]);
    expect(q.dokument.kunde).toMatchObject({ id: 1, name: 'Anna Schmidt', ort: 'Seehausen' });
    expect(q.gedruckt.length).toBeGreaterThan(0);
    expect(q.dokument.logo).toBeNull();
    const logo = `logo-${'f'.repeat(64)}.png`;
    expect(belegVorbereiten(formular(), ertrag(), { ...ctx, logo }).dokument.logo).toBe(logo);

    const offen = belegVorbereiten(formular({ wer: 'Clara Neu' }), ertrag({ art: 'rechnung', bezahlt: false }), ctx);
    expect(offen.fehlt).toEqual(['Name und Anschrift (Kunde)']);
    expect(offen.daten).toMatchObject({ art: 'rechnung', kunde_id: null, kunde_name: 'Clara Neu', zahlungsart: null, bezahlt_am: null, faellig_am: '2026-11-05' });
    const mitAdresse = belegVorbereiten(formular({ wer: 'Clara Neu' }), ertrag({ art: 'rechnung', bezahlt: false, adresse: 'Am Hang 2\n12345 Musterstadt' }), ctx);
    expect(mitAdresse.fehlt).toEqual([]);
    expect(mitAdresse.daten?.kunde_adresse).toBe('Am Hang 2\n12345 Musterstadt');

    // ohne Steuernummer: Quittung bis 250 € geht (Kleinbetragsrechnung, § 33 UStDV), Rechnung nicht
    const ohneNr = { ...ctx, firma: { ...BEISPIEL_FIRMA, steuernummer: '' } };
    expect(belegVorbereiten(formular(), ertrag(), ohneNr).fehlt).toEqual([]);
    const reOhneNr = belegVorbereiten(formular({ wer: 'Clara Neu' }), ertrag({ art: 'rechnung', bezahlt: false, adresse: 'Am Hang 2\n12345 Musterstadt' }), ohneNr);
    expect(reOhneNr.fehlt).toEqual(['Steuernummer']);
    const wahl = belegVorbereiten(formular({ wer: 'Anna Schmidt' }), ertrag(), { ...ctx, kunden: [...KUNDEN, { ...KUNDEN[0], id: 3, nummer: 'K-0003' }] });
    expect(wahl.daten).toBeNull();
    expect(wahl.fehlt.some((t) => /Mehrere Kunden/.test(t))).toBe(true);
  });

  it('mehrere Positionen (Autoreinigung je Kfz): Summe, Quittung mit „mehrere“, Buchungstext wie Rust', () => {
    const autos = ertrag({
      positionen: [ertragPosition('Autoreinigung VW Golf', 4_500), ertragPosition('Autoreinigung VW Passat', 5_500), { ...ertragPosition('Autoreinigung VW Polo', 4_000), menge: '2' }],
    });
    expect(ertragSumme(autos)).toBe(18_000);
    expect(betragEingebbar(autos)).toBe(false);
    const f = belegFormular(formular({ betrag: '180,00' }), autos, ctx);
    expect(f).toMatchObject({ mehrere: true, betreff: '' });
    expect(f.positionen.map((p) => p.beschreibung)).toEqual(['Autoreinigung VW Golf', 'Autoreinigung VW Passat', 'Autoreinigung VW Polo']);
    const v = belegVorbereiten(formular({ betrag: '180,00' }), autos, ctx);
    expect(v.fehlt).toEqual([]);
    expect(v.daten?.positionen.map((p) => [p.menge, p.einzelpreis_cent])).toEqual([
      [1, 4_500],
      [1, 5_500],
      [2, 4_000],
    ]);
    expect(v.buchungstext).toBe('Autoreinigung VW Golf und 2 weitere');
    expect(ertragBuchungstext(autos)).toBe(v.buchungstext);
    expect(ertragBuchungstext(ertrag())).toBe('Rasen mähen');
    expect(ertragBuchungstext(ertrag({ positionen: [ertragPosition()] }))).toBe('Quittung');
    // Rechnung: Positionen ohnehin einzeln, kein „mehrere“
    expect(belegFormular(formular(), { ...autos, art: 'rechnung' }, ctx).mehrere).toBe(false);
    // leere Zeilen fallen weg
    expect(belegVorbereiten(formular(), ertrag({ positionen: [...ertrag().positionen, ertragPosition()] }), ctx).daten?.positionen).toHaveLength(1);
  });

  it('Betrag oben und Positionen: eingebbar nur bei einer Position mit Menge 1', () => {
    const e = ertrag();
    expect(betragEingebbar(e)).toBe(true);
    expect(betragInPosition(e, '75,5')[0]).toMatchObject({ beschreibung: 'Rasen mähen', preis: '75,5' });
    expect(ertragSumme({ positionen: betragInPosition(e, '75,5') })).toBe(7_550);
    const zwei = ertrag({ positionen: [ertragPosition('A', 100), ertragPosition('B', 200)] });
    expect(betragInPosition(zwei, '9')).toBe(zwei.positionen);
    expect(betragEingebbar(ertrag({ positionen: [{ ...ertragPosition('A', 100), menge: '3' }] }))).toBe(false);
    expect(ertragSumme(ertrag({ positionen: [{ ...ertragPosition('A'), preis: 'x' }] }))).toBe(0);
    // Wechsel auf „Beleg erstellen“: Betrag und Beschreibung der Buchung wandern in die leere Position
    expect(positionenAusBuchung({ positionen: [ertragPosition()] }, { betrag: '12,5', beschreibung: ' Hecke ' })[0]).toMatchObject({ beschreibung: 'Hecke', preis: '12,50' });
    expect(positionenAusBuchung(e, { betrag: '', beschreibung: 'anders' })[0]).toMatchObject({ beschreibung: 'Rasen mähen', preis: '60,00' });
    expect(positionenAusBuchung(zwei, { betrag: '1', beschreibung: 'x' })).toBe(zwei.positionen);
  });

  it('Leistungsdatum bzw. -zeitraum und Zahlungsziel landen in Formular, Dokument und Daten', () => {
    const e = ertrag({ art: 'rechnung', bezahlt: false, leistungVon: '2026-10-12', leistungBis: '2026-10-14', zielTage: '30' });
    const v = belegVorbereiten(formular(), e, ctx);
    expect(v.formular).toMatchObject({ datum: HEUTE, leistungVon: '2026-10-12', leistungBis: '2026-10-14', zielTage: '30' });
    expect(v.dokument).toMatchObject({ datum: HEUTE, leistung_von: '2026-10-12', leistung_bis: '2026-10-14' });
    expect(v.daten).toMatchObject({ datum: HEUTE, leistung_von: '2026-10-12', leistung_bis: '2026-10-14', faellig_am: '2026-11-21' });
    expect(ertragFaellig(e, HEUTE, 14)).toBe('2026-11-21');
    expect(ertragFaellig(ertrag(), HEUTE, 14)).toBe('2026-11-05');
    // „bis“ nicht nach „von“ ⇒ einzelner Tag; ohne Eingabe gilt das Datum oben
    expect(belegFormular(formular(), ertrag({ leistungVon: '2026-10-12', leistungBis: '2026-10-12' }), ctx).leistungBis).toBe('');
    expect(belegVorbereiten(formular(), ertrag({ leistungVon: '2026-10-19' }), ctx).daten).toMatchObject({ datum: HEUTE, leistung_von: '2026-10-19', leistung_bis: null });
    expect(belegVorbereiten(formular(), ertrag(), ctx).daten).toMatchObject({ leistung_von: HEUTE });
  });

  it('Hinweise zur Bankverbindung: IBAN, Baustein „Zahlung“, Bankverbindung an; bezahlt ⇒ Quittiert-Satz', () => {
    const offen = ertrag({ art: 'rechnung', bezahlt: false });
    const voll = standardVorlage('rechnung');
    expect(bankHinweise(offen, { iban: 'DE02120300000000202051' }, voll, 'Meine Rechnung')).toEqual([]);
    expect(bankHinweise(offen, { iban: ' ' }, voll, 'Meine Rechnung')).toEqual([{ art: 'warn', text: expect.stringMatching(/fehlt die IBAN/) }]);
    const ohne = voll.filter((b) => b.typ !== 'zahlung');
    expect(bankHinweise(offen, { iban: 'DE02' }, ohne, 'Meine Rechnung')[0].text).toMatch(/„Meine Rechnung“ hat keinen Baustein/);
    const aus = voll.map((b) => (b.typ === 'zahlung' ? { ...b, aus: true } : b));
    expect(bankHinweise(offen, { iban: 'DE02' }, aus, 'X')[0].text).toMatch(/keinen Baustein/);
    const ohneBank = voll.map((b) => (b.typ === 'zahlung' ? { ...b, bank: false } : b));
    expect(bankHinweise(offen, { iban: '' }, ohneBank, 'X').map((h) => h.text)).toEqual([expect.stringMatching(/Bankverbindung .* ausgeschaltet/), expect.stringMatching(/IBAN/)]);
    expect(bankHinweise(ertrag({ art: 'rechnung' }), { iban: '' }, ohne, 'X')).toEqual([{ art: 'info', text: expect.stringMatching(/dankend erhalten/) }]);
    expect(bankHinweise(ertrag(), { iban: '' }, ohne, 'X')).toEqual([]);
    expect(bankHinweise(ertrag({ weg: 'ohne', art: 'rechnung', bezahlt: false }), { iban: '' }, ohne, 'X')).toEqual([]);
    // über belegVorbereiten mit der Vorlage der Art
    expect(belegVorbereiten(formular(), offen, { ...ctx, firma: { ...BEISPIEL_FIRMA, iban: '' } }).bank.map((h) => h.art)).toEqual(['warn']);
  });

  it('Adresse der Maske mit den Eingaben', () => {
    expect(maskenPfad('quittung', { betrag: 6_000, datum: HEUTE, text: ' Rasen ', kundeId: 1, name: 'x', zahlungsart: 'bar', kategorieId: 9 })).toBe(
      '/belege/neu?art=quittung&betrag=6000&datum=2026-10-22&text=Rasen&kunde=1&zahlungsart=bar&kategorie=9',
    );
    expect(maskenPfad('eigenbeleg', { betrag: null, datum: '', name: 'Aral', bezahlt: false })).toBe('/belege/neu?art=eigenbeleg&name=Aral');
    expect(maskenPfad('rechnung', { bezahlt: true })).toBe('/belege/neu?art=rechnung&bezahlt=1');
  });
});

describe('zum Termin bzw. mit vorbereitetem Entwurf (§6.5)', () => {
  const termin = { id: 5, datum: '2026-10-20' };
  const entwurf = (x: Partial<BelegFormular> = {}): BelegFormular => ({
    ...neuesFormular({ art: 'quittung', betrag: 6_000, datum: '2026-10-20', text: 'Rasen mähen' }, { heute: HEUTE, zielTage: {} }),
    vorlageId: null,
    terminId: 5,
    ...x,
  });
  const zwei = entwurf({
    positionen: [
      { beschreibung: 'Rasen mähen', menge: '1', einheit: 'Std.', preis: '40,00', kategorieId: null },
      { beschreibung: 'Grünschnitt', menge: '1', einheit: 'pausch.', preis: '20,00', kategorieId: null },
    ],
    mehrere: true,
    schlusstext: 'Danke!',
  });

  it('nach einem Termin ist eine Rechnung zuerst „noch offen“', () => {
    expect(ertragStart({ termin: 5 }, 'rechnung')).toMatchObject({ weg: 'beleg', bezahlt: false });
    expect(ertragStart({ entwurf: 9, beleg: 'quittung' }, 'rechnung')).toMatchObject({ art: 'quittung', bezahlt: false });
  });

  // wie die Schublade beim Öffnen: Positionen des Entwurfs, Tag des Termins als Leistungsdatum, Zahlungsziel
  const geoeffnet = (w: BelegFormular | null, x: Partial<Ertrag> = {}) =>
    ertragOeffnen(ertrag(x), { entwurf: w ? { positionen: w.positionen.map((p) => ({ ...p })) } : null, terminDatum: termin.datum, zielTage: 14 });

  it('beim Öffnen: Positionen des Entwurfs, Termin als Leistungsdatum, Zahlungsziel aus den Einstellungen', () => {
    const e = geoeffnet(zwei);
    expect(e.positionen.map((p) => p.beschreibung)).toEqual(['Rasen mähen', 'Grünschnitt']);
    expect(e).toMatchObject({ leistungVon: '2026-10-20', zielTage: '14' });
    expect(ertragSumme(e)).toBe(6_000);
    // eigenes Leistungsdatum bzw. Zahlungsziel des Entwurfs gewinnt
    expect(ertragOeffnen(ertrag(), { entwurf: { leistungVon: '2026-10-18', zielTage: '7' }, terminDatum: termin.datum, zielTage: 14 })).toMatchObject({ leistungVon: '2026-10-18', zielTage: '7' });
    // Entwurf ohne Positionen ⇒ die der Vorbelegung bleiben
    expect(ertragOeffnen(ertrag(), { entwurf: { positionen: [] } }).positionen).toHaveLength(1);
  });

  it('Positionen der Schublade und Texte des Entwurfs; Leistungsdatum = Termin', () => {
    const f = belegFormular(formular(), geoeffnet(zwei), ctx, { termin, entwurf: zwei });
    expect(f).toMatchObject({ art: 'quittung', kunde: 'Anna Schmidt · K-0001', datum: HEUTE, leistungVon: '2026-10-20', schlusstext: 'Danke!', terminId: 5, mehrere: true });
    expect(f.positionen.map((p) => p.beschreibung)).toEqual(['Rasen mähen', 'Grünschnitt']);
    // Betreff, der nur die erste Position wiederholt (Termine), fällt weg; ein eigener bleibt
    expect(f.betreff).toBe('');
    expect(belegFormular(formular(), geoeffnet(zwei), ctx, { termin, entwurf: { ...zwei, betreff: 'Gartenpflege Oktober' } }).betreff).toBe('Gartenpflege Oktober');
    // in der Schublade geänderte Positionen ersetzen die des Entwurfs
    const e = belegFormular(formular(), ertrag({ positionen: [ertragPosition('Rasen mähen, 120 m²', 6_000)] }), ctx, { termin, entwurf: entwurf() });
    expect(e.positionen).toEqual([{ beschreibung: 'Rasen mähen, 120 m²', menge: '1', einheit: 'Stk.', preis: '60,00', kategorieId: 9 }]);
  });

  it('Art gewechselt: Rechnung mit deren Texten und Zahlungsziel, Entwurf wird ausgestellt', () => {
    const r = belegFormular(formular(), geoeffnet(zwei, { art: 'rechnung', bezahlt: false }), ctx, { termin, entwurf: zwei });
    expect(r).toMatchObject({ art: 'rechnung', bezahltAm: null, zielTage: '14', terminId: 5, vorlageId: 7, mehrere: false });
    expect(r.einleitung).toMatch(/vielen Dank für Ihren Auftrag/);
    const v = belegVorbereiten(formular(), geoeffnet(zwei, { art: 'rechnung', bezahlt: false }), ctx, { termin, entwurf: zwei });
    expect(v.daten).toMatchObject({ art: 'rechnung', termin_id: 5, leistung_von: '2026-10-20', faellig_am: '2026-11-05', bezahlt_am: null });
  });

  it('zum Termin ohne Entwurf: neuer Beleg mit Termin', () => {
    const v = belegVorbereiten(formular(), geoeffnet(null), ctx, { termin, entwurf: null });
    expect(v.fehlt).toEqual([]);
    expect(v.daten).toMatchObject({ art: 'quittung', termin_id: 5, leistung_von: '2026-10-20', datum: HEUTE });
    expect(belegVorbereiten(formular(), ertrag(), ctx).daten).toMatchObject({ termin_id: null, leistung_von: HEUTE });
  });
});
