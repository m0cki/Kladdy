import { describe, expect, it } from 'vitest';
import {
  aenderung,
  auftraege,
  ausgabeCent,
  ausgabenNachKategorie,
  balkenEnde,
  deltaAnzeige,
  eingaengeNachZahlungsweg,
  hochrechnung,
  kuGrenzen,
  kuStatus,
  KU_GRENZEN_STANDARD,
  kumuliert,
  monatPlus,
  monatsReihe,
  offeneRechnungen,
  ohneBelegAnzahl,
  summen,
  vergleich,
  type AuftragZeile,
  type AuswertungBuchung,
} from './auswertung';
import { zeitraum } from './zeitraum';

let id = 0;
/** Testbuchung: Einnahme 100 € bar am 15.10.2026 in „Dienstleistungen“ (zählt zum KU-Umsatz). */
function b(x: Partial<AuswertungBuchung> = {}): AuswertungBuchung {
  return {
    id: ++id,
    typ: 'einnahme',
    zahlungsdatum: '2026-10-15',
    betrag_cent: 10_000,
    privatanteil_prozent: 0,
    kategorie_id: 1,
    kategorie_name: 'Dienstleistungen',
    kategorie_farbe: '#6366f1',
    abziehbar_prozent: 100,
    zaehlt_ku_umsatz: 1,
    art: 'zahlung',
    zahlungsart: 'bar',
    rechnung_id: null,
    storno_von_id: null,
    belege_anzahl: 1,
    storniert: 0,
    ...x,
  };
}
const aus = (x: Partial<AuswertungBuchung> = {}) =>
  b({ typ: 'ausgabe', kategorie_id: 3, kategorie_name: 'Sprit & Fahrzeug', kategorie_farbe: '#0ea5e9', zaehlt_ku_umsatz: 0, zahlungsart: 'bank', ...x });

const okt = zeitraum('monat', '2026-10-01');
/** formatBetrag setzt ein geschütztes Leerzeichen vor € */
const sp = (t: string) => t.replace(/\u00a0/g, ' ');

describe('summen', () => {
  it('Eingänge, Ausgaben, Überschuss, KU-Umsatz in Cent', () => {
    const s = summen([b(), b({ betrag_cent: 2_550 }), aus({ betrag_cent: 4_999 })], okt);
    expect(s).toEqual({ eingaenge: 12_550, ausgaben: 4_999, ueberschuss: 7_551, ku: 12_550 });
  });
  it('Grenzen nach Zahlungsdatum: erster und letzter Tag gehören dazu, Nachbartage nicht', () => {
    const s = summen(
      [b({ zahlungsdatum: '2026-09-30' }), b({ zahlungsdatum: '2026-10-01', betrag_cent: 1 }), b({ zahlungsdatum: '2026-10-31', betrag_cent: 2 }), b({ zahlungsdatum: '2026-11-01' })],
      okt,
    );
    expect(s.eingaenge).toBe(3);
  });
  it('Storno: Gegenbuchung zählt negativ ⇒ Original und Storno heben sich im selben Zeitraum auf', () => {
    const orig = aus({ betrag_cent: 8_000, storniert: 1 });
    const storno = aus({ betrag_cent: 8_000, storno_von_id: orig.id });
    const s = summen([orig, storno, aus({ betrag_cent: 1_000 })], okt);
    expect(s.ausgaben).toBe(1_000);
    const e = summen([b({ storniert: 1 }), b({ storno_von_id: 1 })], okt);
    expect(e).toEqual({ eingaenge: 0, ausgaben: 0, ueberschuss: 0, ku: 0 });
  });
  it('Storno an einem späteren Tag (Original festgeschrieben) zählt in dessen Zeitraum negativ', () => {
    const orig = b({ zahlungsdatum: '2026-09-20', storniert: 1 });
    const storno = b({ zahlungsdatum: '2026-10-02', storno_von_id: orig.id });
    expect(summen([orig, storno], zeitraum('monat', '2026-09-01')).eingaenge).toBe(10_000);
    expect(summen([orig, storno], okt).eingaenge).toBe(-10_000);
    expect(summen([orig, storno], zeitraum('jahr', '2026-01-01')).eingaenge).toBe(0);
  });
  it('Ausgaben ohne Privatanteil und nur abziehbarer Teil, je Buchung auf Cent gerundet', () => {
    expect(ausgabeCent(aus({ betrag_cent: 10_001, privatanteil_prozent: 30 }))).toBe(7_001); // 30 % von 100,01 = 30,003 ⇒ 30,00
    expect(ausgabeCent(aus({ betrag_cent: 1_999, abziehbar_prozent: 70 }))).toBe(1_399);
    expect(ausgabeCent(aus({ betrag_cent: 1_999, abziehbar_prozent: 70, storno_von_id: 9 }))).toBe(-1_399);
    // drei Buchungen à 0,05 € mit 50 % privat: je 0,03 € (nicht 0,075 € gesamt gerundet)
    const s = summen([aus({ betrag_cent: 5, privatanteil_prozent: 50 }), aus({ betrag_cent: 5, privatanteil_prozent: 50 }), aus({ betrag_cent: 5, privatanteil_prozent: 50 })], okt);
    expect(s.ausgaben).toBe(6);
    expect(Number.isInteger(s.ausgaben)).toBe(true);
  });
  it('Buchungen ohne Geldfluss (AfA/Pauschale) zählen mit; Einnahmen ohne KU-Kategorie nicht zum KU-Umsatz', () => {
    const s = summen([aus({ art: 'afa', zahlungsart: null, betrag_cent: 2_000 }), b({ zaehlt_ku_umsatz: 0, betrag_cent: 500 })], okt);
    expect(s).toEqual({ eingaenge: 500, ausgaben: 2_000, ueberschuss: -1_500, ku: 0 });
  });
});

describe('vergleich (Vorperiode)', () => {
  it('abgeschlossener Zeitraum ⇒ ganze Vorperiode', () => {
    expect(vergleich(zeitraum('monat', '2026-08-01'), '2026-10-17')).toEqual({ von: '2026-07-01', bis: '2026-07-31', teil: false, text: 'ggü. Vormonat' });
    expect(vergleich(zeitraum('quartal', '2026-04-01'), '2026-10-17')).toMatchObject({ von: '2026-01-01', bis: '2026-03-31', text: 'ggü. Vorquartal' });
    expect(vergleich(zeitraum('jahr', '2025-01-01'), '2026-10-17')).toMatchObject({ von: '2024-01-01', bis: '2024-12-31', text: 'ggü. Vorjahr' });
  });
  it('laufender Zeitraum ⇒ Vorperiode gleich lang', () => {
    expect(vergleich(okt, '2026-10-17')).toEqual({ von: '2026-09-01', bis: '2026-09-17', teil: true, text: 'ggü. Vormonat (gleich lang)' });
    expect(vergleich(zeitraum('quartal', '2026-10-17'), '2026-10-17')).toMatchObject({ von: '2026-07-01', bis: '2026-07-17', teil: true });
    expect(vergleich(zeitraum('jahr', '2026-10-17'), '2026-10-17')).toEqual({
      von: '2025-01-01',
      bis: '2025-10-17',
      teil: true,
      text: 'ggü. Vorjahr (gleicher Zeitraum)',
    });
  });
  it('nie über das Ende der Vorperiode hinaus (31. März ⇒ Februar ganz)', () => {
    expect(vergleich(zeitraum('monat', '2026-03-31'), '2026-03-31')).toMatchObject({ von: '2026-02-01', bis: '2026-02-28' });
    expect(vergleich(zeitraum('monat', '2026-03-29'), '2026-03-29')).toMatchObject({ bis: '2026-02-28' });
    expect(vergleich(zeitraum('monat', '2026-01-10'), '2026-01-10')).toMatchObject({ von: '2025-12-01', bis: '2025-12-10' });
  });
});

describe('aenderung und deltaAnzeige', () => {
  it('relative Änderung, ohne Vergleichswert null', () => {
    expect(aenderung(120, 100)).toBeCloseTo(0.2);
    expect(aenderung(50, 100)).toBeCloseTo(-0.5);
    expect(aenderung(100, 0)).toBeNull();
    expect(aenderung(50, -100)).toBeCloseTo(1.5); // von −100 auf +50: Verbesserung
  });
  it('▲/▼ und Vorzeichen, nie nur Farbe', () => {
    expect(deltaAnzeige(0.1234)).toEqual({ klasse: 'pos', pfeil: '▲', text: '+12,3 %' });
    expect(deltaAnzeige(-0.05)).toEqual({ klasse: 'neg', pfeil: '▼', text: '−5,0 %' });
    expect(deltaAnzeige(0.0001)).toEqual({ klasse: 'flat', pfeil: '■', text: '±0,0 %' });
    expect(deltaAnzeige(null)).toEqual({ klasse: 'flat', pfeil: '', text: '–' });
    expect(deltaAnzeige(12.5).text).toBe('+1.250,0 %');
  });
  it('Ausgaben: mehr ist schlecht (Farbe umgekehrt, Pfeil bleibt)', () => {
    expect(deltaAnzeige(0.2, true)).toEqual({ klasse: 'neg', pfeil: '▲', text: '+20,0 %' });
    expect(deltaAnzeige(-0.2, true)).toEqual({ klasse: 'pos', pfeil: '▼', text: '−20,0 %' });
  });
});

describe('Monate', () => {
  it('monatPlus über Jahresgrenzen', () => {
    expect(monatPlus('2026-10', -11)).toBe('2025-11');
    expect(monatPlus('2026-01', -1)).toBe('2025-12');
    expect(monatPlus('2026-12', 1)).toBe('2027-01');
  });
  it('balkenEnde: Ende des Zeitraums, höchstens der laufende Monat', () => {
    expect(balkenEnde(zeitraum('jahr', '2025-06-01'), '2026-10-17')).toBe('2025-12');
    expect(balkenEnde(zeitraum('jahr', '2026-06-01'), '2026-10-17')).toBe('2026-10');
    expect(balkenEnde(zeitraum('quartal', '2026-04-01'), '2026-10-17')).toBe('2026-06');
  });
  it('monatsReihe: 12 Monate bis einschließlich Ende, Storno negativ, leere Monate 0', () => {
    const r = monatsReihe(
      [b({ zahlungsdatum: '2026-10-03' }), aus({ zahlungsdatum: '2026-10-20', betrag_cent: 3_000 }), b({ zahlungsdatum: '2025-11-30', betrag_cent: 700 }), b({ zahlungsdatum: '2025-10-31' }), b({ zahlungsdatum: '2026-10-04', storno_von_id: 1 })],
      '2026-10',
    );
    expect(r).toHaveLength(12);
    expect(r[0]).toMatchObject({ monat: '2025-11', von: '2025-11-01', kurz: 'Nov', lang: 'November 2025', eingaenge: 700, ausgaben: 0, ueberschuss: 700 });
    expect(r[11]).toMatchObject({ monat: '2026-10', eingaenge: 0, ausgaben: 3_000, ueberschuss: -3_000 });
    expect(r[4]).toMatchObject({ monat: '2026-03', kurz: 'März', eingaenge: 0 });
  });
  it('kumuliert: laufendes Jahr bis heute, danach null; Vorjahr ganz', () => {
    const k = kumuliert(
      [b({ zahlungsdatum: '2026-01-10' }), aus({ zahlungsdatum: '2026-02-01', betrag_cent: 4_000 }), b({ zahlungsdatum: '2026-11-02' }), b({ zahlungsdatum: '2025-03-05', betrag_cent: 500 }), b({ zahlungsdatum: '2025-12-31', betrag_cent: 1 })],
      2026,
      '2026-10-17',
    );
    expect(k.aktuell.slice(0, 3)).toEqual([10_000, 6_000, 6_000]);
    expect(k.aktuell[9]).toBe(6_000);
    expect(k.aktuell.slice(10)).toEqual([null, null]);
    expect(k.vorjahr).toEqual([0, 0, 500, 500, 500, 500, 500, 500, 500, 500, 500, 501]);
  });
  it('kumuliert: vergangenes Jahr ganz', () => {
    const k = kumuliert([b({ zahlungsdatum: '2025-12-31' })], 2025, '2026-10-17');
    expect(k.aktuell.every((x) => x !== null)).toBe(true);
    expect(k.aktuell[11]).toBe(10_000);
  });
});

describe('Anteile (Donuts)', () => {
  it('Ausgaben nach Kategorie: größte zuerst, nur Zeitraum, abziehbar, Storno abgezogen', () => {
    const r = ausgabenNachKategorie(
      [
        aus({ betrag_cent: 3_000 }),
        aus({ kategorie_id: 2, kategorie_name: 'Produkte & Material', kategorie_farbe: '#f59e0b', betrag_cent: 5_000 }),
        aus({ betrag_cent: 1_000, privatanteil_prozent: 50 }),
        aus({ kategorie_id: 4, kategorie_name: 'Sonstige Kosten', kategorie_farbe: null, betrag_cent: 2_000, storniert: 1 }),
        aus({ kategorie_id: 4, kategorie_name: 'Sonstige Kosten', kategorie_farbe: null, betrag_cent: 2_000, storno_von_id: 77 }),
        aus({ zahlungsdatum: '2026-09-30', betrag_cent: 99_999 }),
        b(),
      ],
      okt,
    );
    expect(r).toEqual([
      { schluessel: '2', name: 'Produkte & Material', farbe: '#f59e0b', wert: 5_000 },
      { schluessel: '3', name: 'Sprit & Fahrzeug', farbe: '#0ea5e9', wert: 3_500 },
    ]);
  });
  it('mehr als max ⇒ Rest als „Übrige“', () => {
    const viele = Array.from({ length: 8 }, (_, i) => aus({ kategorie_id: 10 + i, kategorie_name: `K${i}`, betrag_cent: (i + 1) * 100 }));
    const r = ausgabenNachKategorie(viele, okt, 6);
    expect(r).toHaveLength(7);
    expect(r[0].wert).toBe(800);
    expect(r[6]).toEqual({ schluessel: 'uebrige', name: 'Übrige', farbe: 'var(--muted)', wert: 300 });
    expect(r.reduce((s, x) => s + x.wert, 0)).toBe(3_600);
  });
  it('Eingänge nach Zahlungsweg mit festen Farben, ohne Buchungen ohne Geldfluss', () => {
    const r = eingaengeNachZahlungsweg(
      [b({ betrag_cent: 2_000 }), b({ zahlungsart: 'bank', betrag_cent: 9_000 }), b({ zahlungsart: 'paypal', betrag_cent: 500 }), b({ zahlungsart: null, art: 'pauschale' }), aus()],
      okt,
    );
    expect(r).toEqual([
      { schluessel: 'bank', name: 'Überweisung', farbe: 'var(--series-1)', wert: 9_000 },
      { schluessel: 'bar', name: 'Bar', farbe: 'var(--series-3)', wert: 2_000 },
      { schluessel: 'paypal', name: 'PayPal', farbe: 'var(--series-2)', wert: 500 },
    ]);
  });
});

describe('Status-Pillen', () => {
  it('ohne Beleg: Regel wie in Ein- & Ausgänge, nur im Zeitraum', () => {
    const n = ohneBelegAnzahl(
      [
        b({ belege_anzahl: 0 }), // zählt
        aus({ belege_anzahl: 0 }), // zählt
        b({ belege_anzahl: 0, rechnung_id: 4 }), // eigener Beleg (QU/RE)
        aus({ belege_anzahl: 0, storniert: 1 }), // storniert
        aus({ belege_anzahl: 0, storno_von_id: 3 }), // Gegenbuchung selbst
        aus({ belege_anzahl: 0, art: 'afa', zahlungsart: null }), // ohne Geldfluss
        aus({ belege_anzahl: 0, zahlungsdatum: '2026-09-30' }), // anderer Zeitraum
        aus(), // hat Beleg
      ],
      okt,
    );
    expect(n).toBe(2);
  });
  it('offene Rechnungen: Anzahl, überfällig (Fälligkeit vor heute), Summe', () => {
    expect(
      offeneRechnungen(
        [
          { id: 1, faellig_am: '2026-10-16', summe_cent: 10_000 },
          { id: 2, faellig_am: '2026-10-17', summe_cent: 5_050 },
          { id: 3, faellig_am: null, summe_cent: 1 },
        ],
        '2026-10-17',
      ),
    ).toEqual({ anzahl: 3, ueberfaellig: 1, summe: 15_051 });
    expect(offeneRechnungen([], '2026-10-17')).toEqual({ anzahl: 0, ueberfaellig: 0, summe: 0 });
  });
});

describe('Kleinunternehmer', () => {
  it('Grenzen aus den Kennwerten des Jahres, sonst nächstälteres Jahr, sonst Standard', () => {
    const kw = new Map([
      [2025, { ku_grenze_vorjahr_cent: 2_200_000, ku_grenze_laufend_cent: 5_000_000 }],
      [2026, { ku_grenze_vorjahr_cent: 2_500_000, ku_grenze_laufend_cent: 10_000_000 }],
    ]);
    expect(kuGrenzen(kw, 2026)).toEqual({ vorjahr: 2_500_000, laufend: 10_000_000 });
    expect(kuGrenzen(kw, 2027)).toEqual({ vorjahr: 2_500_000, laufend: 10_000_000 });
    expect(kuGrenzen(kw, 2024)).toEqual({ vorjahr: 2_200_000, laufend: 5_000_000 }); // ältestes
    expect(kuGrenzen(new Map(), 2026)).toEqual(KU_GRENZEN_STANDARD);
    expect(kuGrenzen(new Map([[2026, { gwg_grenze_netto_cent: 80_000 }]]), 2026)).toEqual(KU_GRENZEN_STANDARD);
  });
  it('Hochrechnung mit anteiligen Monaten, ganze Cent', () => {
    expect(hochrechnung(1_200_000, '2026-07-01')).toBe(Math.round((1_200_000 * 12 * 31) / (6 * 31 + 1)));
    expect(hochrechnung(1_000_000, '2026-06-30')).toBe(2_000_000); // genau ein halbes Jahr
    expect(hochrechnung(100_000, '2026-12-31')).toBe(100_000);
    expect(hochrechnung(0, '2026-03-15')).toBe(0);
    expect(Number.isInteger(hochrechnung(123_457, '2026-10-17'))).toBe(true);
  });
  const g = KU_GRENZEN_STANDARD;
  it('unter 80 % ⇒ ok, ab 80 % gelb, ab 100 % rot', () => {
    // 30. Juni: Hochrechnung = doppelter Umsatz
    const mit = (cent: number) => kuStatus([b({ zahlungsdatum: '2026-03-01', betrag_cent: cent })], '2026-06-30', g);
    expect(mit(999_900)).toMatchObject({ stufe: 'ok', hochrechnung: 1_999_800 });
    expect(mit(1_000_000)).toMatchObject({ stufe: 'warn', quote: 0.8 });
    expect(mit(1_249_999).stufe).toBe('warn');
    expect(mit(1_250_000)).toMatchObject({ stufe: 'alarm', quote: 1 });
    expect(sp(mit(1_000_000).text)).toBe('10.000 € von 25.000 € · Hochrechnung 80 %');
  });
  it('nur KU-Kategorien des laufenden Kalenderjahrs, Storno abgezogen', () => {
    const s = kuStatus(
      [
        b({ zahlungsdatum: '2026-02-01', betrag_cent: 500_000 }),
        b({ zahlungsdatum: '2026-02-01', betrag_cent: 400_000, zaehlt_ku_umsatz: 0 }),
        b({ zahlungsdatum: '2026-03-01', betrag_cent: 100_000, storniert: 1 }),
        b({ zahlungsdatum: '2026-03-01', betrag_cent: 100_000, storno_von_id: 1 }),
        b({ zahlungsdatum: '2025-12-31', betrag_cent: 300_000 }),
      ],
      '2026-06-30',
      g,
    );
    expect(s).toMatchObject({ jahr: 2026, umsatz: 500_000, umsatzVorjahr: 300_000, hochrechnung: 1_000_000, stufe: 'ok' });
  });
  it('Vorjahr über der Grenze oder laufendes Jahr über 100.000 € ⇒ rot mit Hinweis', () => {
    const vorjahr = kuStatus([b({ zahlungsdatum: '2025-05-01', betrag_cent: 2_600_000 })], '2026-01-15', g);
    expect(vorjahr.stufe).toBe('alarm');
    expect(sp(vorjahr.text)).toBe('2025: 26.000 € – über 25.000 €');
    const laufend = kuStatus([b({ zahlungsdatum: '2026-01-02', betrag_cent: 10_000_100 })], '2026-12-31', g);
    expect(laufend.stufe).toBe('alarm');
    expect(sp(laufend.text)).toBe('100.001 € – über 100.000 € im laufenden Jahr');
  });
});

describe('Aufträge (wie Besuche in lib/kunden.ts)', () => {
  const z = (x: Partial<AuftragZeile>): AuftragZeile => ({ quelle: 'beleg', art: 'quittung', status: 'bezahlt', datum: '2026-10-05', ...x });
  it('Quittungen, Rechnungen (auch offen) und Einnahmen ohne Beleg; keine Entwürfe, Stornos, Zukunft', () => {
    const r = auftraege(
      [
        z({}),
        z({ art: 'rechnung', status: 'offen' }),
        z({ art: 'rechnung', status: 'bezahlt' }),
        z({ quelle: 'einnahme', art: 'einnahme' }),
        z({ status: 'entwurf' }),
        z({ status: 'storniert' }),
        z({ quelle: 'einnahme', art: 'einnahme', status: 'storniert' }),
        z({ datum: '2026-10-20' }), // nach heute
        z({ datum: '2026-09-30' }), // anderer Zeitraum
      ],
      okt,
      '2026-10-17',
    );
    expect(r).toEqual({ gesamt: 4, quittungen: 1, rechnungen: 2, ohneBeleg: 1 });
  });
});
