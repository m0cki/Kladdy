import { describe, expect, it } from 'vitest';
import {
  ANNAHMEN_STANDARD,
  annahmenAusWert,
  datumIn,
  geldfluss,
  horizontAusParam,
  isoWoche,
  kwText,
  nachWochen,
  naechsterTermin,
  tagKurz,
  variablerSchnitt,
  vorlageLesen,
  vorschau,
  wiederkehrendAusZeile,
  wiederkehrTermine,
  wochenStart,
  zahlungsverzug,
  type Annahmen,
  type LiqBuchung,
  type LiqRechnung,
  type VorschauDaten,
  type Wiederkehrend,
} from './liquiditaet';

const HEUTE = '2026-10-18'; // Sonntag

const nichts: VorschauDaten = { buchungen: [], offen: [], bezahlt: [], planposten: [], wiederkehrend: [] };
const nur = (o: Partial<Annahmen>): Annahmen => ({
  offene: false,
  ueberfaellige: false,
  wiederkehrend: false,
  plan: false,
  variabel: false,
  verzug: null,
  avgZeilen: true,
  ...o,
});

function rechnung(x: Partial<LiqRechnung> = {}): LiqRechnung {
  return { id: 1, nummer: 'RE-2026-007', kunde_name: 'Hausverwaltung Kaiser', datum: '2026-10-10', faellig_am: '2026-10-24', summe_cent: 45_600, ...x };
}

function buchung(x: Partial<LiqBuchung> = {}): LiqBuchung {
  return { typ: 'einnahme', zahlungsdatum: '2026-10-01', betrag_cent: 9_000, art: 'zahlung', storno_von_id: null, rechnung_art: null, wiederkehrend_id: null, ...x };
}

function wk(x: Partial<Omit<Wiederkehrend, 'vorlage'>> & { vorlage?: Partial<Wiederkehrend['vorlage']> } = {}): Wiederkehrend {
  const { vorlage, ...rest } = x;
  return {
    id: 1,
    rhythmus: 'monatlich',
    naechstes_datum: '2026-10-20',
    aktiv: true,
    ...rest,
    vorlage: { name: 'Handyvertrag', betrag_cent: 2_999, typ: 'ausgabe', kategorie_id: 4, tag: 20, ...vorlage },
  };
}

describe('Bausteine', () => {
  it('datumIn kappt am Monatsende (auch Schaltjahr)', () => {
    expect(datumIn(2026, 2, 31)).toBe('2026-02-28');
    expect(datumIn(2028, 2, 31)).toBe('2028-02-29');
    expect(datumIn(2026, 4, 31)).toBe('2026-04-30');
    expect(datumIn(2026, 12, 5)).toBe('2026-12-05');
  });

  it('geldfluss: voller Betrag, Storno umgekehrt, AfA/Pauschale ohne Geldfluss', () => {
    expect(geldfluss(buchung())).toBe(9_000);
    expect(geldfluss(buchung({ typ: 'ausgabe' }))).toBe(-9_000);
    expect(geldfluss(buchung({ typ: 'ausgabe', storno_von_id: 3 }))).toBe(9_000);
    expect(geldfluss(buchung({ art: 'afa' }))).toBe(0);
    expect(geldfluss(buchung({ art: 'pauschale', typ: 'ausgabe' }))).toBe(0);
  });

  it('Ø Zahlungsverzug aus der Historie: zu früh zählt 0, auf ganze Tage gerundet', () => {
    expect(zahlungsverzug([])).toBe(0);
    expect(
      zahlungsverzug([
        { faellig_am: '2026-09-01', bezahlt_am: '2026-09-11' }, // 10
        { faellig_am: '2026-09-01', bezahlt_am: '2026-08-25' }, // zu früh ⇒ 0
        { faellig_am: '2026-09-30', bezahlt_am: '2026-10-05' }, // 5
      ]),
    ).toBe(5);
    expect(
      zahlungsverzug([
        { faellig_am: '2026-09-01', bezahlt_am: '2026-09-04' },
        { faellig_am: '2026-09-01', bezahlt_am: '2026-09-05' },
      ]),
    ).toBe(4); // 3,5 ⇒ 4
  });

  it('Horizont aus der Adresse: nur 30/60/90, sonst 90', () => {
    expect(horizontAusParam('30')).toBe(30);
    expect(horizontAusParam('60')).toBe(60);
    expect(horizontAusParam(null)).toBe(90);
    expect(horizontAusParam('45')).toBe(90);
    expect(horizontAusParam('abc')).toBe(90);
  });

  it('Annahmen aus dem gespeicherten Wert: fehlende/kaputte Felder ⇒ Standard', () => {
    expect(annahmenAusWert(null)).toEqual(ANNAHMEN_STANDARD);
    expect(annahmenAusWert('kaputt')).toEqual(ANNAHMEN_STANDARD);
    expect(annahmenAusWert({ offene: false, verzug: 12, variabel: 'ja' })).toEqual({ ...ANNAHMEN_STANDARD, offene: false, verzug: 12 });
    expect(annahmenAusWert({ verzug: 2.5 }).verzug).toBeNull();
    expect(annahmenAusWert({ verzug: -1 }).verzug).toBeNull();
  });
});

describe('Vorlage wiederkehrender Posten (vorlage_json)', () => {
  it('liest die dokumentierte Form und ignoriert Zusatzfelder (Phase 7)', () => {
    expect(vorlageLesen({ name: ' Handy ', betrag_cent: 2999, typ: 'ausgabe', tag: 20, zahlungsart: 'bank' })).toEqual({
      name: 'Handy',
      betrag_cent: 2999,
      typ: 'ausgabe',
      kategorie_id: null,
      tag: 20,
    });
  });

  it('lehnt Ungültiges ab', () => {
    const ok = { name: 'Handy', betrag_cent: 2999, typ: 'ausgabe', kategorie_id: null, tag: 20 };
    expect(vorlageLesen(ok)).not.toBeNull();
    for (const kaputt of [
      { ...ok, name: '  ' },
      { ...ok, name: 'x'.repeat(81) },
      { ...ok, betrag_cent: 29.99 },
      { ...ok, betrag_cent: 0 },
      { ...ok, betrag_cent: -5 },
      { ...ok, typ: 'privat' },
      { ...ok, tag: 0 },
      { ...ok, tag: 32 },
      { ...ok, kategorie_id: 'Sonstiges' },
      [],
      null,
    ])
      expect(vorlageLesen(kaputt)).toBeNull();
  });

  it('Datenbankzeile: kaputtes JSON oder unbekannter Rhythmus ⇒ null', () => {
    const z = { id: 3, vorlage_json: '{"name":"Handy","betrag_cent":2999,"typ":"ausgabe","kategorie_id":null,"tag":20}', rhythmus: 'monatlich', naechstes_datum: '2026-10-20', aktiv: 1 };
    expect(wiederkehrendAusZeile(z)?.aktiv).toBe(true);
    expect(wiederkehrendAusZeile({ ...z, aktiv: 0 })?.aktiv).toBe(false);
    expect(wiederkehrendAusZeile({ ...z, vorlage_json: '{' })).toBeNull();
    expect(wiederkehrendAusZeile({ ...z, rhythmus: 'woechentlich' })).toBeNull();
    expect(wiederkehrendAusZeile({ ...z, naechstes_datum: '20.10.2026' })).toBeNull();
  });
});

describe('Termine wiederkehrender Posten', () => {
  it('monatlich ab dem Anker, nur nach `von` und bis `bis`', () => {
    expect(wiederkehrTermine(wk(), HEUTE, '2027-01-16')).toEqual(['2026-10-20', '2026-11-20', '2026-12-20']);
    // Anker in der Zukunft: davor nichts
    expect(wiederkehrTermine(wk({ naechstes_datum: '2026-12-20' }), HEUTE, '2027-01-16')).toEqual(['2026-12-20']);
    // Anker weit in der Vergangenheit (nie weitergezählt): läuft trotzdem weiter
    expect(wiederkehrTermine(wk({ naechstes_datum: '2024-01-20' }), HEUTE, '2026-12-01')).toEqual(['2026-10-20', '2026-11-20']);
    // heute selbst zählt nicht mehr
    expect(wiederkehrTermine(wk({ naechstes_datum: '2026-10-18', vorlage: { tag: 18 } }), HEUTE, '2026-11-30')).toEqual(['2026-11-18']);
  });

  it('der 31. im Februar und in 30-Tage-Monaten, danach wieder der 31.', () => {
    const w = wk({ naechstes_datum: '2027-01-31', vorlage: { tag: 31 } });
    expect(wiederkehrTermine(w, '2027-01-01', '2027-05-31')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
    expect(wiederkehrTermine(w, '2028-01-31', '2028-03-01')).toEqual(['2028-02-29']);
  });

  it('vierteljährlich und jährlich ab dem Anker', () => {
    const q = wk({ rhythmus: 'vierteljaehrlich', naechstes_datum: '2027-01-15', vorlage: { tag: 15 } });
    expect(wiederkehrTermine(q, HEUTE, '2027-12-31')).toEqual(['2027-01-15', '2027-04-15', '2027-07-15', '2027-10-15']);
    const j = wk({ rhythmus: 'jaehrlich', naechstes_datum: '2026-11-30', vorlage: { tag: 30 } });
    expect(wiederkehrTermine(j, HEUTE, '2028-12-31')).toEqual(['2026-11-30', '2027-11-30', '2028-11-30']);
    // jährlich am 29.2. ⇒ in Nicht-Schaltjahren der 28.2.
    const s = wk({ rhythmus: 'jaehrlich', naechstes_datum: '2028-02-29', vorlage: { tag: 29 } });
    expect(wiederkehrTermine(s, '2028-01-01', '2030-12-31')).toEqual(['2028-02-29', '2029-02-28', '2030-02-28']);
  });

  it('rückwärts (für den Rückblick des Ø) auch vor dem Anker', () => {
    expect(wiederkehrTermine(wk(), '2026-07-20', HEUTE, true)).toEqual(['2026-08-20', '2026-09-20']);
    expect(wiederkehrTermine(wk(), '2026-07-20', HEUTE)).toEqual([]);
  });

  it('nächster Termin für die Liste', () => {
    expect(naechsterTermin(wk(), HEUTE)).toBe('2026-10-20');
    expect(naechsterTermin(wk({ rhythmus: 'jaehrlich', naechstes_datum: '2026-03-01', vorlage: { tag: 1 } }), HEUTE)).toBe('2027-03-01');
  });
});

describe('Ø variable Ein- und Ausgänge (letzte 90 Tage, je Woche)', () => {
  it('nimmt nur die letzten 90 Tage, ohne Rechnungszahlungen, Wiederkehrendes und Buchungen ohne Geldfluss', () => {
    const b = [
      buchung({ zahlungsdatum: '2026-10-18', betrag_cent: 90_000 }), // heute zählt
      buchung({ zahlungsdatum: '2026-07-20', betrag_cent: 90_000 }), // heute − 90: zählt nicht mehr
      buchung({ zahlungsdatum: '2026-10-19', betrag_cent: 90_000 }), // Zukunft
      buchung({ zahlungsdatum: '2026-09-01', betrag_cent: 50_000, rechnung_art: 'rechnung' }),
      buchung({ zahlungsdatum: '2026-09-01', betrag_cent: 9_000, rechnung_art: 'quittung' }), // Quittung zählt
      buchung({ zahlungsdatum: '2026-09-02', typ: 'ausgabe', betrag_cent: 18_000 }),
      buchung({ zahlungsdatum: '2026-09-02', typ: 'ausgabe', betrag_cent: 5_000, art: 'afa' }),
      buchung({ zahlungsdatum: '2026-09-03', typ: 'ausgabe', betrag_cent: 4_000, wiederkehrend_id: 7 }),
    ];
    // Ein: (90.000 + 9.000) × 7 / 90 = 7.700 · Aus: 18.000 × 7 / 90 = 1.400
    expect(variablerSchnitt(b, [], HEUTE)).toEqual({ ein: 7_700, aus: 1_400 });
  });

  it('Storno-Gegenbuchungen heben das Original auf; Rundung auf ganze Cent', () => {
    const b = [
      buchung({ betrag_cent: 1_000 }),
      buchung({ betrag_cent: 1_000, storno_von_id: 1 }),
      buchung({ typ: 'ausgabe', betrag_cent: 100 }), // 100 × 7 / 90 = 7,78 ⇒ 8
    ];
    expect(variablerSchnitt(b, [], HEUTE)).toEqual({ ein: 0, aus: 8 });
  });

  it('zieht nicht verknüpfte Termine aktiver wiederkehrender Posten ab (sonst doppelt gezählt)', () => {
    // Handy 29,99 € am 20.: im Rückblick 20.8. und 20.9., beide ohne Verknüpfung gebucht
    const b = [
      buchung({ zahlungsdatum: '2026-08-20', typ: 'ausgabe', betrag_cent: 2_999 }),
      buchung({ zahlungsdatum: '2026-09-20', typ: 'ausgabe', betrag_cent: 2_999 }),
      buchung({ zahlungsdatum: '2026-09-25', typ: 'ausgabe', betrag_cent: 9_000 }),
    ];
    expect(variablerSchnitt(b, [wk()], HEUTE)).toEqual({ ein: 0, aus: 700 }); // nur die 90 € bleiben
    // inaktiv: wird nicht abgezogen
    expect(variablerSchnitt(b, [wk({ aktiv: false })], HEUTE).aus).toBe(Math.round((14_998 * 7) / 90));
    // eine Zahlung verknüpft (Phase 7): die zählt ohnehin nicht, abgezogen wird nur der andere Termin
    const verknuepft = [{ ...b[0], wiederkehrend_id: 1 }, b[1], b[2]];
    expect(variablerSchnitt(verknuepft, [wk()], HEUTE)).toEqual({ ein: 0, aus: 700 });
    // nie unter 0
    expect(variablerSchnitt([], [wk()], HEUTE)).toEqual({ ein: 0, aus: 0 });
  });
});

describe('vorschau()', () => {
  it('ohne Daten: Kurve heute bei 0, kein Engpass, Tagesreihe über den ganzen Horizont', () => {
    for (const h of [30, 60, 90]) {
      const v = vorschau(nichts, HEUTE, h, ANNAHMEN_STANDARD);
      expect(v.tage).toHaveLength(h + 1);
      expect(v.tage[0]).toEqual({ datum: HEUTE, wert: 0, zahlungen: [] });
      expect(v.bis).toBe(v.tage[h].datum);
      expect(v.zahlungen).toEqual([]);
      expect(v.engster).toEqual({ datum: HEUTE, wert: 0 });
      expect(v.engpass).toBe(false);
    }
    expect(vorschau(nichts, HEUTE, 30, ANNAHMEN_STANDARD).bis).toBe('2026-11-17');
  });

  it('offene Rechnung am Fälligkeitstag plus Ø Verzug aus der Historie', () => {
    const d: VorschauDaten = {
      ...nichts,
      offen: [rechnung()],
      bezahlt: [
        { faellig_am: '2026-08-01', bezahlt_am: '2026-08-07' },
        { faellig_am: '2026-09-01', bezahlt_am: '2026-09-07' },
      ],
    };
    const v = vorschau(d, HEUTE, 90, nur({ offene: true }));
    expect(v.verzugAuto).toBe(6);
    expect(v.verzug).toBe(6);
    expect(v.zahlungen).toEqual([
      { datum: '2026-10-30', text: 'RE-2026-007 · Hausverwaltung Kaiser', betrag_cent: 45_600, art: 'rechnung', ref: 1, ueberfaellig: false, saldo: 45_600 },
    ]);
    expect(v.ausRechnungen).toBe(45_600);
    // Regler: eigener Verzug statt Historie
    expect(vorschau(d, HEUTE, 90, nur({ offene: true, verzug: 0 })).zahlungen[0].datum).toBe('2026-10-24');
    expect(vorschau(d, HEUTE, 90, nur({ offene: true, verzug: 20 })).zahlungen[0].datum).toBe('2026-11-13');
    // Horizont zu kurz: fällt heraus
    expect(vorschau(d, HEUTE, 30, nur({ offene: true, verzug: 45 })).zahlungen).toEqual([]);
    // ausgeschaltet
    expect(vorschau(d, HEUTE, 90, nur({})).zahlungen).toEqual([]);
  });

  it('überfällige frühestens in 3 Tagen, abschaltbar; ohne Fälligkeit zählt das Belegdatum', () => {
    const d: VorschauDaten = {
      ...nichts,
      offen: [
        rechnung({ id: 1, faellig_am: '2026-10-01' }), // überfällig
        rechnung({ id: 2, nummer: 'RE-2026-008', faellig_am: '2026-10-18', kunde_name: null }), // heute fällig: nicht überfällig, aber + 0 Tage ⇒ heute + 3
        rechnung({ id: 3, nummer: 'RE-2026-009', faellig_am: null, datum: '2026-10-16' }),
      ],
    };
    const v = vorschau(d, HEUTE, 90, nur({ offene: true, ueberfaellige: true, verzug: 0 }));
    expect(v.zahlungen.map((z) => [z.ref, z.datum, z.ueberfaellig])).toEqual([
      [1, '2026-10-21', true],
      [2, '2026-10-21', false],
      [3, '2026-10-21', true],
    ]);
    expect(v.zahlungen[0].text).toBe('RE-2026-007 · Hausverwaltung Kaiser (überfällig)');
    expect(v.zahlungen[1].text).toBe('RE-2026-008 · Kunde');
    // mit Verzug landet die überfällige ggf. nach heute + 3
    expect(vorschau(d, HEUTE, 90, nur({ offene: true, ueberfaellige: true, verzug: 25 })).zahlungen.find((z) => z.ref === 1)?.datum).toBe('2026-10-26');
    // Überfällige aus: nur die nicht überfällige bleibt
    const ohne = vorschau(d, HEUTE, 90, nur({ offene: true, ueberfaellige: false, verzug: 0 }));
    expect(ohne.zahlungen.map((z) => z.ref)).toEqual([2]);
  });

  it('wiederkehrende Kosten und Planposten innerhalb des Horizonts', () => {
    const d: VorschauDaten = {
      ...nichts,
      wiederkehrend: [wk(), wk({ id: 2, aktiv: false, vorlage: { name: 'Alt' } }), wk({ id: 3, vorlage: { name: 'Pflegevertrag', typ: 'einnahme', betrag_cent: 15_000, tag: 1 }, naechstes_datum: '2026-11-01' })],
      planposten: [
        { id: 1, datum: '2026-11-14', text: 'Aufsitzmäher', betrag_cent: -149_000 },
        { id: 2, datum: '2026-10-18', text: 'heute: zählt nicht mehr', betrag_cent: -1_000 },
        { id: 3, datum: '2027-01-30', text: 'nach dem Horizont', betrag_cent: 60_000 },
        { id: 4, datum: '2026-12-10', text: 'Winterdienst-Vertrag', betrag_cent: 60_000 },
      ],
    };
    const v = vorschau(d, HEUTE, 60, nur({ wiederkehrend: true, plan: true }));
    expect(v.bis).toBe('2026-12-17');
    expect(v.zahlungen.map((z) => [z.datum, z.art, z.betrag_cent])).toEqual([
      ['2026-10-20', 'wiederkehrend', -2_999],
      ['2026-11-01', 'wiederkehrend', 15_000],
      ['2026-11-14', 'plan', -149_000],
      ['2026-11-20', 'wiederkehrend', -2_999],
      ['2026-12-01', 'wiederkehrend', 15_000],
      ['2026-12-10', 'plan', 60_000],
    ]);
    expect(v.eingaenge).toBe(90_000);
    expect(v.ausgaben).toBe(154_998);
    expect(v.ueberschuss).toBe(-64_998);
    expect(v.festeKosten).toBe(5_998);
    // Schalter aus: nichts davon
    expect(vorschau(d, HEUTE, 60, nur({ plan: true })).zahlungen.map((z) => z.ref)).toEqual([1, 4]);
    expect(vorschau(d, HEUTE, 60, nur({ wiederkehrend: true })).zahlungen.every((z) => z.art === 'wiederkehrend')).toBe(true);
  });

  it('Ø wöchentlich gebündelt ab heute + 7, als eigene Zeilen', () => {
    const d: VorschauDaten = { ...nichts, buchungen: [buchung({ betrag_cent: 90_000 }), buchung({ typ: 'ausgabe', betrag_cent: 18_000 })] };
    const v = vorschau(d, HEUTE, 30, nur({ variabel: true }));
    expect(v.schnitt).toEqual({ ein: 7_000, aus: 1_400 });
    expect(v.zahlungen.map((z) => [z.datum, z.betrag_cent])).toEqual([
      ['2026-10-25', 7_000],
      ['2026-10-25', -1_400],
      ['2026-11-01', 7_000],
      ['2026-11-01', -1_400],
      ['2026-11-08', 7_000],
      ['2026-11-08', -1_400],
      ['2026-11-15', 7_000],
      ['2026-11-15', -1_400],
    ]);
    expect(v.zahlungen.every((z) => z.art === 'variabel' && z.ref === null)).toBe(true);
    // 90 Tage = 12 Wochen
    expect(vorschau(d, HEUTE, 90, nur({ variabel: true })).zahlungen).toHaveLength(24);
    // Ø 0 ⇒ keine Zeile
    expect(vorschau({ ...nichts, buchungen: [buchung()] }, HEUTE, 30, nur({ variabel: true })).zahlungen.every((z) => z.betrag_cent > 0)).toBe(true);
  });

  it('kumulierte Kurve ab 0, Saldo je Zahlung, am selben Tag Eingänge zuerst', () => {
    const d: VorschauDaten = {
      ...nichts,
      planposten: [
        { id: 1, datum: '2026-10-20', text: 'raus', betrag_cent: -30_000 },
        { id: 2, datum: '2026-10-20', text: 'rein', betrag_cent: 10_000 },
        { id: 3, datum: '2026-10-25', text: 'rein', betrag_cent: 50_000 },
      ],
    };
    const v = vorschau(d, HEUTE, 30, nur({ plan: true }));
    expect(v.zahlungen.map((z) => [z.ref, z.saldo])).toEqual([
      [2, 10_000],
      [1, -20_000],
      [3, 30_000],
    ]);
    expect(v.tage.slice(0, 8).map((t) => t.wert)).toEqual([0, 0, -20_000, -20_000, -20_000, -20_000, -20_000, 30_000]);
    expect(v.tage[2].zahlungen.map((z) => z.ref)).toEqual([2, 1]);
    expect(v.tage[v.tage.length - 1].wert).toBe(v.ueberschuss);
  });

  it('engster Moment: erster tiefster Punkt; Engpass erst ab einem Euro mehr raus als rein', () => {
    const mit = (betraege: [string, number][]) =>
      vorschau({ ...nichts, planposten: betraege.map(([datum, betrag_cent], i) => ({ id: i + 1, datum, text: 'x', betrag_cent })) }, HEUTE, 90, nur({ plan: true }));
    const v = mit([
      ['2026-10-20', -50_000],
      ['2026-11-01', 20_000],
      ['2026-11-14', -52_000], // tiefster Punkt −82.000
      ['2026-11-20', 100_000],
      ['2026-12-01', -100_000], // wieder −82.000: der erste zählt
    ]);
    expect(v.engster).toEqual({ datum: '2026-11-14', wert: -82_000 });
    expect(v.engpass).toBe(true);
    expect(mit([['2026-10-20', -49]]).engpass).toBe(false);
    expect(mit([['2026-10-20', -50]]).engpass).toBe(true);
    // immer im Plus: engster Moment ist heute mit 0
    expect(mit([['2026-10-20', 10_000]]).engster).toEqual({ datum: HEUTE, wert: 0 });
  });

  it('erwartete Zahlungen = offene Rechnungen + Planposten (Abnahme Phase 2)', () => {
    const offen = [rechnung({ id: 1, summe_cent: 45_600 }), rechnung({ id: 2, nummer: 'RE-2026-010', faellig_am: '2026-11-05', summe_cent: 120_000 })];
    const planposten = [{ id: 9, datum: '2026-11-14', text: 'Aufsitzmäher', betrag_cent: -149_000 }];
    const v = vorschau({ ...nichts, offen, planposten }, HEUTE, 90, nur({ offene: true, ueberfaellige: true, plan: true, verzug: 0 }));
    expect(v.eingaenge).toBe(165_600);
    expect(v.ausgaben).toBe(149_000);
    expect(v.zahlungen.filter((z) => z.art === 'rechnung').map((z) => z.ref)).toEqual([1, 2]);
    expect(v.zahlungen.filter((z) => z.art === 'plan').map((z) => z.ref)).toEqual([9]);
  });
});

describe('Kalenderwochen', () => {
  it('ISO 8601: Montag als Wochenbeginn, Woche mit dem Donnerstag', () => {
    expect(isoWoche('2026-10-18')).toEqual({ jahr: 2026, woche: 42 }); // Sonntag
    expect(isoWoche('2026-10-19')).toEqual({ jahr: 2026, woche: 43 }); // Montag
    expect(isoWoche('2026-01-01')).toEqual({ jahr: 2026, woche: 1 }); // Donnerstag
    expect(isoWoche('2026-12-31')).toEqual({ jahr: 2026, woche: 53 }); // 2026 hat 53 Wochen
    expect(isoWoche('2027-01-03')).toEqual({ jahr: 2026, woche: 53 });
    expect(isoWoche('2027-01-04')).toEqual({ jahr: 2027, woche: 1 });
    expect(isoWoche('2024-12-30')).toEqual({ jahr: 2025, woche: 1 });
  });

  it('Wochenbeginn und Beschriftung (de-DE)', () => {
    expect(wochenStart('2026-10-18')).toBe('2026-10-12');
    expect(wochenStart('2026-10-19')).toBe('2026-10-19');
    expect(wochenStart('2027-01-01')).toBe('2026-12-28');
    expect(kwText('2026-10-19')).toBe('KW 43 · 19.–25.10.');
    expect(kwText('2026-10-26')).toBe('KW 44 · 26.10.–01.11.');
    expect(kwText('2026-12-28')).toBe('KW 53 · 28.12.–03.01.');
    expect(tagKurz('2026-10-19')).toBe('Mo 19.10.');
    expect(tagKurz('2026-10-18')).toBe('So 18.10.');
  });

  it('gruppiert Zahlungen je Woche mit Summe (inkl. Ø) und Saldo am Wochenende', () => {
    const d: VorschauDaten = {
      ...nichts,
      buchungen: [buchung({ betrag_cent: 90_000 })],
      planposten: [
        { id: 1, datum: '2026-10-20', text: 'a', betrag_cent: -30_000 },
        { id: 2, datum: '2026-10-27', text: 'b', betrag_cent: -5_000 },
        { id: 3, datum: '2026-11-01', text: 'c', betrag_cent: 2_000 },
      ],
    };
    const v = vorschau(d, HEUTE, 30, nur({ plan: true, variabel: true }));
    const w = nachWochen(v.zahlungen);
    expect(w.map((x) => [x.text, x.zahlungen.length, x.summe, x.saldo])).toEqual([
      ['KW 43 · 19.–25.10.', 2, -23_000, -23_000], // −300 € + Ø 70 € (25.10.)
      ['KW 44 · 26.10.–01.11.', 3, 4_000, -19_000], // −50 € + 20 € + Ø 70 €
      ['KW 45 · 02.–08.11.', 1, 7_000, -12_000],
      ['KW 46 · 09.–15.11.', 1, 7_000, -5_000],
    ]);
    expect(nachWochen([])).toEqual([]);
  });
});
