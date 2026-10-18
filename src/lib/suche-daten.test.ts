import { describe, expect, it } from 'vitest';
import { begrenze, gruppiere, suche } from './suche';
import {
  DATEN_LIMITS,
  GRUPPE,
  belegEintrag,
  betragStichworte,
  buchungEintrag,
  datenEintraege,
  kennzahlEintrag,
  kundeEintrag,
  sprungPfad,
  terminEintrag,
  type SuchBeleg,
  type SuchBuchung,
  type SuchDaten,
  type SuchKunde,
  type SuchTermin,
} from './suche-daten';

const HEUTE = '2026-10-18';

const buchung = (x: Partial<SuchBuchung> = {}): SuchBuchung => ({
  id: 1,
  nummer: '2026-0042',
  typ: 'einnahme',
  zahlungsdatum: '2026-10-12',
  betrag_cent: 4990,
  beschreibung: 'Rasen mähen',
  belegnummer: 'QU-2026-012',
  rechnung_nummer: null,
  kategorie_name: 'Dienstleistung',
  kunde_name: 'Erika Müller',
  kunde_nummer: 'K-0012',
  lieferant: null,
  zahlungsart: 'bar',
  storniert: 0,
  ...x,
});

const beleg = (x: Partial<SuchBeleg> = {}): SuchBeleg => ({
  id: 7,
  art: 'rechnung',
  nummer: 'RE-2026-003',
  status: 'offen',
  datum: '2026-09-01',
  betreff: 'Heckenschnitt',
  kunde_name: 'Erika Müller',
  kunde_nummer: 'K-0012',
  beleg_name: 'Erika Müller',
  summe_cent: 123456,
  faellig_am: '2026-09-15',
  ...x,
});

const termin = (x: Partial<SuchTermin> = {}): SuchTermin => ({
  id: 3,
  datum: '2026-10-20',
  von: '09:00',
  bis: '11:00',
  leistung: 'Laub entfernen',
  status: 'geplant',
  kunde_name: 'Hans Meier',
  kunde_nummer: 'K-0007',
  adresse: null,
  ...x,
});

const kunde = (x: Partial<SuchKunde> = {}): SuchKunde => ({
  id: 12,
  nummer: 'K-0012',
  name: 'Erika Müller',
  zusatz: null,
  strasse: 'Lindenweg 4',
  plz: '12345',
  ort: 'Musterstadt',
  email: 'erika@example.org',
  telefon: null,
  ...x,
});

describe('betragStichworte', () => {
  it('liefert deutsche Schreibweisen mit und ohne Tausenderpunkt, mit Punkt und mit\u00a0€', () => {
    expect(betragStichworte(123456)).toEqual(['1.234,56', '1234,56', '1234.56', '1.234,56\u00a0€']);
    expect(betragStichworte(4990)).toEqual(['49,90', '49.90', '49,90\u00a0€']);
  });
});

describe('buchungEintrag', () => {
  it('zeigt Beleg-Nr · Datum · Kategorie · Kunde und den Betrag mit echtem Vorzeichen', () => {
    const e = buchungEintrag(buchung());
    expect(e.gruppe).toBe(GRUPPE.buchungen);
    expect(e.label).toBe('Rasen mähen');
    expect(e.sub).toBe('QU-2026-012 · 12.10.2026 · Dienstleistung · Erika Müller');
    expect(e.rechts).toBe('+49,90\u00a0€');
    expect(e.sprung).toEqual({ art: 'buchung', id: 1 });
    expect(e.storniert).toBe(false);
  });
  it('Ausgaben mit U+2212, Geschäft statt Kunde, Name nicht doppelt', () => {
    const e = buchungEintrag(buchung({ typ: 'ausgabe', beschreibung: 'Tanken · Aral', lieferant: 'Aral', kunde_name: null, belegnummer: null, kategorie_name: 'Sprit' }));
    expect(e.rechts).toBe('−49,90\u00a0€');
    expect(e.sub).toBe('2026-0042 · 12.10.2026 · Sprit');
    expect(e.symbol).toBe('ausgabe');
  });
  it('markiert Stornos im Untertitel', () => {
    const e = buchungEintrag(buchung({ storniert: 1 }));
    expect(e.storniert).toBe(true);
    expect(e.sub).toMatch(/· storniert$/);
  });
});

describe('belegEintrag', () => {
  it('Nummer · Betreff, Art · Kunde · Datum · Status (überfällig nach Fälligkeit)', () => {
    const e = belegEintrag(beleg(), HEUTE);
    expect(e.label).toBe('RE-2026-003 · Heckenschnitt');
    expect(e.sub).toBe('Rechnung · Erika Müller · 01.09.2026 · überfällig');
    expect(e.rechts).toBe('+1.234,56\u00a0€');
    expect(sprungPfad(e.sprung)).toBe('/belege/7');
  });
  it('Entwürfe ohne Nummer heißen „Entwurf“, Barverkauf ohne Kunde', () => {
    const e = belegEintrag(beleg({ art: 'quittung', nummer: null, status: 'entwurf', betreff: null, kunde_name: null, kunde_nummer: null, beleg_name: null }), HEUTE);
    expect(e.label).toBe('Entwurf · Quittung');
    expect(e.sub).toBe('Quittung · Barverkauf · 01.09.2026 · Entwurf');
  });
  it('Eigenbeleg als Ausgabe (−), Angebot ohne Richtung, Storno markiert', () => {
    expect(belegEintrag(beleg({ art: 'eigenbeleg', summe_cent: 1250 }), HEUTE).rechts).toBe('−12,50\u00a0€');
    expect(belegEintrag(beleg({ art: 'angebot', summe_cent: 1250 }), HEUTE).rechts).toBe('12,50\u00a0€');
    const s = belegEintrag(beleg({ status: 'storniert' }), HEUTE);
    expect(s.storniert).toBe(true);
    expect(s.sub).toMatch(/storniert$/);
  });
});

describe('terminEintrag, kundeEintrag, kennzahlEintrag', () => {
  it('Termin: Leistung · Kunde, Datum · Zeit · Status (vergangen + geplant = nachtragen)', () => {
    expect(terminEintrag(termin(), HEUTE)).toMatchObject({ label: 'Laub entfernen · Hans Meier', sub: '20.10.2026 · 09:00–11:00 · geplant' });
    expect(terminEintrag(termin({ datum: '2026-10-01' }), HEUTE).sub).toBe('01.10.2026 · 09:00–11:00 · nachtragen');
    expect(sprungPfad(terminEintrag(termin(), HEUTE).sprung)).toBe('/termine?t=3');
  });
  it('Kunde: Name, Nummer · Adresse, öffnet die Schublade (kein Pfad)', () => {
    const e = kundeEintrag(kunde());
    expect(e).toMatchObject({ label: 'Erika Müller', sub: 'K-0012 · Lindenweg 4, 12345 Musterstadt', symbol: 'kunde' });
    expect(sprungPfad(e.sprung)).toBeNull();
    expect(kundeEintrag(kunde({ strasse: null, plz: null, ort: null })).sub).toBe('K-0012 · Kunde');
  });
  it('Kennzahl: Name und Formel, ohne Wert', () => {
    const e = kennzahlEintrag({ id: 2, name: 'Marge', formel: 'ueberschuss / einnahmen', beschreibung: null });
    expect(e).toMatchObject({ label: 'Marge', sub: 'ueberschuss / einnahmen' });
    expect(e.rechts).toBeUndefined();
    expect(sprungPfad(e.sprung)).toBe('/auswertung/kennzahlen?k=2');
  });
});

describe('Suche über Daten', () => {
  const daten: SuchDaten = {
    buchungen: [
      buchung({ id: 3, zahlungsdatum: '2026-10-14', betrag_cent: 4900, beschreibung: 'Hecke schneiden', belegnummer: null }),
      buchung({ id: 2, zahlungsdatum: '2026-10-13', betrag_cent: 1500, beschreibung: 'Laub', belegnummer: null }),
      buchung({ id: 1 }),
    ],
    belege: [beleg()],
    termine: [termin(), termin({ id: 4, status: 'abgesagt', leistung: 'Abgesagtes' })],
    kunden: [kunde(), kunde({ id: 13, nummer: 'K-0013', name: 'Max Muster', email: null })],
    kennzahlen: [],
  };
  const eintraege = datenEintraege(daten, HEUTE);
  const ids = (q: string) => suche(eintraege, q, Infinity).map((t) => t.eintrag.id);

  it('lässt abgesagte Termine weg', () => {
    expect(eintraege.some((e) => e.id === 'termin:4')).toBe(false);
  });
  it('findet Beträge über „49,90“ und „49“', () => {
    expect(ids('49,90')).toEqual(['buchung:1']);
    expect(ids('49')).toEqual(expect.arrayContaining(['buchung:3', 'buchung:1']));
    expect(ids('1234,56')).toEqual(['beleg:7']);
    expect(ids('1.234')).toEqual(['beleg:7']);
  });
  it('findet über Kunde, Kundennummer, Beleg-Nr. und Datum', () => {
    expect(ids('K-0013')).toEqual(['kunde:13']);
    expect(ids('QU-2026-012')).toEqual(['buchung:1']);
    expect(ids('12.10.2026')).toEqual(['buchung:1']);
    expect(ids('2026-10-12')).toEqual(['buchung:1']);
  });
  it('neueste zuerst bei gleicher Bewertung', () => {
    const buchungen = suche(eintraege, 'muller', Infinity)
      .map((t) => t.eintrag.id)
      .filter((id) => id.startsWith('buchung:'));
    expect(buchungen).toEqual(['buchung:3', 'buchung:2', 'buchung:1']);
  });
  it('begrenzt je Gruppe', () => {
    const viele = datenEintraege({ ...daten, buchungen: Array.from({ length: 20 }, (_, i) => buchung({ id: 100 + i })), belege: [], termine: [] }, HEUTE);
    const t = begrenze(suche(viele, 'muller', Infinity), DATEN_LIMITS);
    const g = gruppiere(t);
    expect(g.find((x) => x.gruppe === GRUPPE.buchungen)?.treffer).toHaveLength(6);
    expect(g.find((x) => x.gruppe === GRUPPE.kunden)?.treffer).toHaveLength(1);
  });
  it('mit „>“ keine Daten', () => {
    expect(ids('>muller')).toEqual([]);
  });
});
