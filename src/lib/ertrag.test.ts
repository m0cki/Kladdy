import { describe, expect, it } from 'vitest';
import type { Formular } from './buchungen';
import {
  belegFormular,
  belegHinweis,
  belegVorbereiten,
  ertragPruefen,
  ertragSchluessel,
  ertragStart,
  hinweis35a,
  karteiAnschrift,
  maskenPfad,
  naechsteBelegNummer,
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
    quittung: [{ id: null, name: 'Standard-Quittung', bausteine: standardVorlage('quittung'), aktiv: true }],
    rechnung: [
      { id: null, name: 'Standard-Rechnung', bausteine: standardVorlage('rechnung'), aktiv: false },
      { id: 7, name: 'Meine Rechnung', bausteine: standardVorlage('rechnung'), aktiv: true },
    ],
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

const ertrag = (x: Partial<Ertrag> = {}): Ertrag => ({ ...ertragStart({}, 'quittung'), ...x });

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
    expect(ertragSchluessel(ertrag())).not.toBe(ertragSchluessel(ertrag({ leistung: 'Hecke' })));
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
    expect(offenFaellig(liste[0], HEUTE)).toEqual({ text: '12 T. überfällig', ueberfaellig: true });
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
  });
});

describe('Beleg aus der Schublade', () => {
  it('Quittung für einen bekannten Kunden: ein Posten, Leistung statt Beschreibung, aktive Vorlage', () => {
    const f = belegFormular(formular(), ertrag({ leistung: 'Rasen mähen, 120 m²' }), 6_000, ctx);
    expect(f).toMatchObject({ art: 'quittung', kunde: 'Anna Schmidt · K-0001', datum: HEUTE, betreff: 'Rasen mähen', zahlungsart: 'bar', bezahltAm: null, vorlageId: null });
    expect(f.positionen).toEqual([{ beschreibung: 'Rasen mähen, 120 m²', menge: '1', einheit: 'Stk.', preis: '60,00', kategorieId: 9 }]);
    expect(karteiAnschrift(formular(), KUNDEN)?.id).toBe(1);
    expect(karteiAnschrift(formular({ wer: 'Bob Bauer · K-0002' }), KUNDEN)).toBeNull();
  });

  it('Rechnung bezahlt bzw. offen, neuer Kunde mit Anschrift', () => {
    const bezahlt = belegFormular(formular({ wer: 'Clara Neu', zahlungsart: 'bank' }), ertrag({ art: 'rechnung', adresse: 'Am Hang 2\n12345 Musterstadt' }), 6_000, ctx);
    expect(bezahlt).toMatchObject({ art: 'rechnung', kunde: 'Clara Neu', adresse: 'Am Hang 2\n12345 Musterstadt', bezahltAm: HEUTE, zielTage: '14', vorlageId: 7 });
    const offen = belegFormular(formular({ wer: 'Clara Neu' }), ertrag({ art: 'rechnung', bezahlt: false }), 6_000, ctx);
    expect(offen.bezahltAm).toBeNull();
    expect(vorlageFuer({ art: 'rechnung', vorlage: null }, ctx.vorlagen).id).toBe(7);
    expect(vorlageFuer({ art: 'rechnung', vorlage: { id: null } }, ctx.vorlagen).name).toBe('Standard-Rechnung');
    expect(vorlageFuer({ art: 'rechnung', vorlage: { id: 99 } }, ctx.vorlagen).id).toBe(7);
    expect(vorlageFuer({ art: 'quittung', vorlage: null }, { ...ctx.vorlagen, quittung: [] }).name).toBe('Standard-Quittung');
    expect(belegFormular(formular({ wer: 'Clara Neu' }), ertrag({ art: 'rechnung', vorlage: { id: null } }), 6_000, ctx).vorlageId).toBeNull();
  });

  it('vorbereitet für beleg_ausstellen: Daten, Nummer, Pflichtangaben', () => {
    const q = belegVorbereiten(formular(), ertrag(), 6_000, ctx);
    expect(q.fehlt).toEqual([]);
    expect(q.naechste).toBe('QU-2026-105');
    expect(q.daten).toMatchObject({ art: 'quittung', kunde_id: 1, kunde_name: null, kunde_adresse: null, datum: HEUTE, zahlungsart: 'bar', bezahlt_am: null });
    expect(q.daten?.positionen).toEqual([{ beschreibung: 'Rasen mähen', menge: 1, einheit: 'Stk.', einzelpreis_cent: 6_000, kategorie_id: null }]);
    expect(q.dokument.kunde).toMatchObject({ id: 1, name: 'Anna Schmidt', ort: 'Seehausen' });
    expect(q.gedruckt.length).toBeGreaterThan(0);
    expect(q.dokument.logo).toBeNull();
    const logo = `logo-${'f'.repeat(64)}.png`;
    expect(belegVorbereiten(formular(), ertrag(), 6_000, { ...ctx, logo }).dokument.logo).toBe(logo);

    const offen = belegVorbereiten(formular({ wer: 'Clara Neu' }), ertrag({ art: 'rechnung', bezahlt: false }), 6_000, ctx);
    expect(offen.fehlt).toEqual(['Name und Anschrift (Kunde)']);
    expect(offen.daten).toMatchObject({ art: 'rechnung', kunde_id: null, kunde_name: 'Clara Neu', zahlungsart: null, bezahlt_am: null, faellig_am: '2026-11-05' });
    const mitAdresse = belegVorbereiten(formular({ wer: 'Clara Neu' }), ertrag({ art: 'rechnung', bezahlt: false, adresse: 'Am Hang 2\n12345 Musterstadt' }), 6_000, ctx);
    expect(mitAdresse.fehlt).toEqual([]);
    expect(mitAdresse.daten?.kunde_adresse).toBe('Am Hang 2\n12345 Musterstadt');

    const ohneFirma = belegVorbereiten(formular(), ertrag(), 6_000, { ...ctx, firma: { ...BEISPIEL_FIRMA, steuernummer: '' } });
    expect(ohneFirma.fehlt).toEqual(['Steuernummer']);
    const wahl = belegVorbereiten(formular({ wer: 'Anna Schmidt' }), ertrag(), 6_000, { ...ctx, kunden: [...KUNDEN, { ...KUNDEN[0], id: 3, nummer: 'K-0003' }] });
    expect(wahl.daten).toBeNull();
    expect(wahl.fehlt.some((t) => /Mehrere Kunden/.test(t))).toBe(true);
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

  it('Positionen und Texte des Entwurfs bleiben, solange der Betrag passt; Leistungsdatum = Termin', () => {
    const f = belegFormular(formular(), ertrag(), 6_000, ctx, { termin, entwurf: zwei });
    expect(f).toMatchObject({ art: 'quittung', kunde: 'Anna Schmidt · K-0001', datum: HEUTE, leistungVon: '2026-10-20', schlusstext: 'Danke!', terminId: 5, mehrere: true });
    expect(f.positionen.map((p) => p.beschreibung)).toEqual(['Rasen mähen', 'Grünschnitt']);
    // anderer Betrag ⇒ eine Position über den neuen Betrag
    const g = belegFormular(formular({ betrag: '75,00' }), ertrag(), 7_500, ctx, { termin, entwurf: zwei });
    expect(g.positionen).toHaveLength(1);
    expect(g.positionen[0]).toMatchObject({ beschreibung: 'Rasen mähen', preis: '75,00' });
    // eine Position: die Leistung aus der Schublade ersetzt nur deren Text
    const e = belegFormular(formular(), ertrag({ leistung: 'Rasen mähen, 120 m²' }), 6_000, ctx, { termin, entwurf: entwurf() });
    expect(e.positionen).toEqual([{ beschreibung: 'Rasen mähen, 120 m²', menge: '1', einheit: 'Stk.', preis: '60,00', kategorieId: null }]);
  });

  it('Art gewechselt: Rechnung mit deren Texten und Zahlungsziel, Entwurf wird ausgestellt', () => {
    const r = belegFormular(formular(), ertrag({ art: 'rechnung', bezahlt: false }), 6_000, ctx, { termin, entwurf: zwei });
    expect(r).toMatchObject({ art: 'rechnung', bezahltAm: null, zielTage: '14', terminId: 5, vorlageId: 7, mehrere: false });
    expect(r.einleitung).toMatch(/vielen Dank für Ihren Auftrag/);
    const v = belegVorbereiten(formular(), ertrag({ art: 'rechnung', bezahlt: false }), 6_000, ctx, { termin, entwurf: zwei });
    expect(v.daten).toMatchObject({ art: 'rechnung', termin_id: 5, leistung_von: '2026-10-20', faellig_am: '2026-11-05', bezahlt_am: null });
  });

  it('zum Termin ohne Entwurf: neuer Beleg mit Termin', () => {
    const v = belegVorbereiten(formular(), ertrag(), 6_000, ctx, { termin, entwurf: null });
    expect(v.fehlt).toEqual([]);
    expect(v.daten).toMatchObject({ art: 'quittung', termin_id: 5, leistung_von: '2026-10-20', datum: HEUTE });
    expect(belegVorbereiten(formular(), ertrag(), 6_000, ctx).daten).toMatchObject({ termin_id: null, leistung_von: HEUTE });
  });
});
