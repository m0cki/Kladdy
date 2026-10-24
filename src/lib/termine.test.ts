import { describe, expect, it } from 'vitest';
import { nameSchluessel } from './buchungen';
import type { BelegFormular } from './rechnungen';
import {
  BETRAG_FEHLER,
  adresseEinzeilig,
  ausstellArt,
  belegFehlt,
  betragAnzeige,
  betragFeld,
  betragKurz,
  betragVorschlag,
  chip,
  chrono,
  erfassenHinweis,
  ertragAusEntwurf,
  ertragBezug,
  filterZaehler,
  formularStart,
  gruppen,
  istNachtragen,
  istOffen,
  kannAusstellen,
  kartenUrl,
  knoepfe,
  leistungsVorschlaege,
  menue,
  minuten,
  nachtragenText,
  plus2h,
  punktArt,
  relTag,
  tagKopf,
  tagLang,
  terminDatenAus,
  terminPruefen,
  terminWann,
  termineZusammenfuehren,
  ueberschneidungen,
  vorbelegungMitBezug,
  vorbelegungZumAusstellen,
  vorbereitenHinweis,
  vorbereitungDaten,
  vorbereitungFormular,
  wannHinweis,
  wocheZeigen,
  wochenStreifen,
  type ErfassenBezug,
  type HinweisTeil,
  type Termin,
  type TerminBelegZeile,
  type TerminEinnahmeZeile,
  type TerminFormular,
  type TerminKunde,
  type TerminZeile,
} from './termine';
import { STANDARD_TEXTE } from './vorlagen/dokument';

/** Donnerstag; die Woche beginnt am Montag, 19.10.2026 (KW 43). */
const H = '2026-10-22';
const NBSP = ' ';

const zeile = (x: Partial<TerminZeile> = {}): TerminZeile => ({
  id: 1,
  kunde_id: 1,
  kunde_name: 'Anna Schmidt',
  kunde_nummer: 'K-0001',
  kunde_notiz: null,
  datum: H,
  von: '08:00',
  bis: '10:00',
  adresse: 'Gartenweg 3\n12390 Seehausen',
  leistung: 'Rasen mähen',
  betrag_geschaetzt_cent: 6_500,
  notiz: null,
  status: 'geplant',
  ohne_beleg: 0,
  ...x,
});

const termin = (x: Partial<Termin> = {}): Termin => ({ ...zeile(), entwurf: null, beleg: null, einnahme: null, ...x });

const beleg = (x: Partial<TerminBelegZeile> = {}): TerminBelegZeile => ({
  id: 10,
  termin_id: 1,
  art: 'quittung',
  nummer: null,
  status: 'entwurf',
  summe_cent: 6_500,
  ...x,
});

const einnahme = (x: Partial<TerminEinnahmeZeile> = {}): TerminEinnahmeZeile => ({
  id: 20,
  termin_id: 1,
  nummer: '2026-0001',
  betrag_cent: 6_500,
  zahlungsdatum: H,
  zahlungsart: 'bar',
  rechnung_id: null,
  storniert: 0,
  ...x,
});

const text = (t: HinweisTeil[]): string => t.map((x) => x.text).join('');

describe('Termine zusammenführen und Zustand', () => {
  it('Entwurf, gültiger Beleg vor storniertem, Einnahme ohne Beleg', () => {
    const [a, b, c] = termineZusammenfuehren(
      [zeile({ id: 1 }), zeile({ id: 2 }), zeile({ id: 3 })],
      [
        beleg({ id: 10, termin_id: 1 }),
        beleg({ id: 11, termin_id: 2, nummer: 'QU-2026-001', status: 'storniert' }),
        beleg({ id: 12, termin_id: 2, nummer: 'QU-2026-002', status: 'bezahlt' }),
        beleg({ id: 13, termin_id: 2, nummer: 'AN-2026-001', art: 'angebot', status: 'offen' }),
        beleg({ id: 14, termin_id: 3, nummer: 'RE-2026-001', art: 'rechnung', status: 'storniert' }),
      ],
      [einnahme({ id: 20, storniert: 1 }), einnahme({ id: 21 }), einnahme({ id: 22, termin_id: 2, rechnung_id: 12 })],
    );
    expect([a.entwurf?.id, a.beleg, a.einnahme?.id]).toEqual([10, null, 21]);
    expect([b.entwurf, b.beleg?.id, b.einnahme]).toEqual([null, 12, null]);
    expect(c.beleg?.id).toBe(14);
  });

  it('nachtragen, Beleg fehlt, ausstellen', () => {
    expect(istNachtragen(zeile({ datum: '2026-10-21' }), H)).toBe(true);
    expect(istNachtragen(zeile({ datum: H }), H)).toBe(false);
    expect(istNachtragen(zeile({ datum: '2026-10-21', status: 'erledigt' }), H)).toBe(false);
    expect(belegFehlt(termin({ status: 'erledigt' }))).toBe(true);
    expect(belegFehlt(termin({ status: 'erledigt', ohne_beleg: 1 }))).toBe(false);
    expect(belegFehlt(termin({ status: 'erledigt', beleg: beleg({ nummer: 'QU-2026-001', status: 'bezahlt' }) }))).toBe(false);
    expect(belegFehlt(termin({ status: 'erledigt', beleg: beleg({ nummer: 'QU-2026-001', status: 'storniert' }) }))).toBe(true);
    expect(istOffen(termin({ datum: '2026-10-01' }), H)).toBe(true);
    expect(kannAusstellen(termin({ status: 'erledigt' }))).toBe(true);
    expect(kannAusstellen(termin({ status: 'erledigt', ohne_beleg: 1 }))).toBe(true); // „Doch mit Quittung“
    expect(kannAusstellen(termin({ status: 'erledigt', ohne_beleg: 1, einnahme: einnahme() }))).toBe(false);
    expect(kannAusstellen(termin())).toBe(false);
    expect(ausstellArt(termin({ entwurf: beleg({ art: 'rechnung' }) }), 'quittung')).toBe('rechnung');
    expect(ausstellArt(termin(), 'rechnung')).toBe('rechnung');
  });
});

describe('Agenda', () => {
  const a = termin({ id: 1, datum: '2026-10-21', von: '14:00' }); // nachtragen
  const b = termin({ id: 2, datum: '2026-10-20', status: 'erledigt' }); // Beleg fehlt
  const c = termin({ id: 3, datum: '2026-10-23', von: '09:00' });
  const d = termin({ id: 4, datum: '2026-10-23', von: '08:00' });
  const e = termin({ id: 5, datum: '2026-10-19', status: 'erledigt', beleg: beleg({ nummer: 'QU-2026-001', status: 'bezahlt' }) });
  const f = termin({ id: 6, datum: '2026-10-18', status: 'abgesagt' });
  const g = termin({ id: 7, datum: H, status: 'erledigt', beleg: beleg({ nummer: 'QU-2026-002', status: 'bezahlt' }) });
  const x = termin({ id: 8, datum: '2026-10-23', von: '07:00', status: 'abgesagt' });
  const liste = [a, b, c, d, e, f, g];
  const ids = (gr: ReturnType<typeof gruppen>) => gr.map((y) => (y.typ === 'trenner' ? y.text : [y.typ === 'tag' ? y.datum : 'nachtragen', y.items.map((t) => t.id)]));

  it('Anstehend: Nachtragen oben, „Heute“ immer, dann je Tag nach Uhrzeit', () => {
    expect(ids(gruppen(liste, 'anstehend', H))).toEqual([
      ['nachtragen', [2, 1]],
      [H, [7]],
      ['2026-10-23', [4, 3]],
    ]);
    expect(ids(gruppen([c], 'anstehend', H))).toEqual([
      [H, []],
      ['2026-10-23', [3]],
    ]);
  });

  it('Alle mit „Vorbei“ (neueste zuerst), Erledigt neueste zuerst, Zähler je Filter', () => {
    expect(ids(gruppen(liste, 'alle', H))).toEqual([['nachtragen', [2, 1]], [H, [7]], ['2026-10-23', [4, 3]], 'Vorbei', ['2026-10-19', [5]], ['2026-10-18', [6]]]);
    expect(ids(gruppen(liste, 'erledigt', H))).toEqual([
      [H, [7]],
      ['2026-10-20', [2]],
      ['2026-10-19', [5]],
    ]);
    expect(filterZaehler(liste, H)).toEqual({ anstehend: 5, erledigt: 3, alle: 7 });
    expect(nachtragenText([a, b], H)).toBe('Termin abhaken oder Beleg ausstellen');
    expect(nachtragenText([a], H)).toBe('vorbei, aber noch nicht abgehakt');
    expect(nachtragenText([b], H)).toBe('erledigt, aber noch ohne Beleg');
  });

  it('Wochenstreifen: diese und nächste Woche ab Montag, ohne abgesagte', () => {
    const [w1, w2] = wochenStreifen([...liste, x], H);
    expect([w1.label, w1.kw, w1.tage[0].datum, w2.kw, w2.tage[0].datum]).toEqual(['Diese Woche', 43, '2026-10-19', 44, '2026-10-26']);
    expect(w1.tage.map((t) => t.termine.map((y) => y.id))).toEqual([[5], [2], [1], [7], [4, 3], [], []]);
    expect([w1.tage[3].heute, w1.tage[0].vorbei, w1.tage[4].vorbei, w1.tage[5].wochenende, w1.tage[4].wochenende]).toEqual([true, true, false, true, false]);
    expect([punktArt(a, H), punktArt(g, H), punktArt(c, H)]).toEqual(['nach', 'erledigt', 'geplant']);
    expect(wocheZeigen(liste, 'erledigt', H)).toBe(false);
    expect(wocheZeigen(liste, 'anstehend', H)).toBe(true);
    expect(wocheZeigen([termin({ datum: '2026-12-01' })], 'alle', H)).toBe(false);
  });
});

describe('Zeile: Betrag, Chip, Knöpfe, Menü', () => {
  it('Betrag laut Beleg, Einnahme oder geschätzt', () => {
    expect(betragAnzeige(termin({ beleg: beleg({ nummer: 'QU-2026-001', status: 'bezahlt', summe_cent: 7_000 }) }))).toEqual({ cent: 7_000, ist: true, titel: 'laut Beleg' });
    expect(betragAnzeige(termin({ status: 'erledigt', ohne_beleg: 1, einnahme: einnahme({ betrag_cent: 6_000 }) }))).toMatchObject({ cent: 6_000, ist: true });
    expect(betragAnzeige(termin({ entwurf: beleg({ summe_cent: 7_500 }) }))).toMatchObject({ cent: 7_500, ist: false });
    expect(betragAnzeige(termin())).toMatchObject({ cent: 6_500, ist: false, titel: 'geschätzt' });
    expect(betragAnzeige(termin({ betrag_geschaetzt_cent: null }))).toBeNull();
    expect(betragKurz(6_500)).toBe(`65${NBSP}€`);
    expect(betragKurz(6_550)).toBe(`65,50${NBSP}€`);
  });

  it('Beleg-Chip', () => {
    expect(chip(termin({ status: 'abgesagt', entwurf: beleg() })).art).toBe('abgesagt');
    expect(chip(termin({ status: 'erledigt', entwurf: beleg() }))).toMatchObject({ art: 'fehlt', titel: 'Quittung vorbereitet, noch ohne Nummer' });
    expect(chip(termin({ status: 'erledigt', ohne_beleg: 1, einnahme: einnahme({ id: 33 }) }))).toMatchObject({ art: 'bezahlt', einnahme: 33 });
    expect(chip(termin({ status: 'erledigt', ohne_beleg: 1 })).art).toBe('ohne');
    expect(chip(termin({ entwurf: beleg({ id: 9, art: 'rechnung' }) }))).toMatchObject({ art: 'vorbereitet', text: 'Rechnung vorbereitet', beleg: 9, belegArt: 'rechnung' });
    expect(chip(termin({ status: 'erledigt', beleg: beleg({ nummer: 'QU-2026-096', status: 'bezahlt' }) }))).toMatchObject({ art: 'ausgestellt', text: 'QU-2026-096', offen: false });
    expect(chip(termin({ status: 'erledigt', beleg: beleg({ art: 'rechnung', nummer: 'RE-2026-015', status: 'offen' }) }))).toMatchObject({ offen: true, belegArt: 'rechnung' });
    expect(chip(termin({ beleg: beleg({ nummer: 'QU-2026-001', status: 'storniert' }) })).art).toBe('storniert');
    expect(chip(termin()).art).toBe('leer');
  });

  it('Knöpfe: Erledigt nur heute und früher, „War der Termin?“ bei vorbei', () => {
    expect(knoepfe(termin({ datum: '2026-10-30' }), H)).toEqual({ frage: false, haupt: null, absagen: false, mehr: true });
    expect(knoepfe(termin(), H)).toMatchObject({ haupt: 'abhaken', frage: false });
    expect(knoepfe(termin({ datum: '2026-10-01' }), H)).toEqual({ frage: true, haupt: 'abhaken', absagen: true, mehr: true });
    expect(knoepfe(termin({ status: 'erledigt' }), H).haupt).toBe('ausstellen');
    expect(knoepfe(termin({ status: 'erledigt', beleg: beleg({ nummer: 'QU-1', status: 'bezahlt' }) }), H)).toEqual({ frage: false, haupt: null, absagen: false, mehr: false });
    expect(knoepfe(termin({ status: 'abgesagt' }), H).haupt).toBe('wieder');
  });

  it('Menü je Zustand', () => {
    const aktionen = (t: Termin) => menue(t, H, 'quittung').map((p) => ('trenner' in p ? '—' : p.aktion));
    expect(aktionen(termin({ datum: '2026-10-30' }))).toEqual(['bearbeiten', 'vorbereiten', '—', 'absagen']);
    expect(aktionen(termin({ datum: '2026-10-01' }))).toEqual(['bearbeiten', 'vorbereiten']);
    const mitEntwurf = menue(termin({ entwurf: beleg({ art: 'rechnung' }) }), H, 'quittung');
    expect(mitEntwurf.map((p) => ('trenner' in p ? '—' : p.aktion))).toEqual(['bearbeiten', '—', 'absagen']);
    expect(mitEntwurf[2]).toMatchObject({ sub: 'Vorbereitete Rechnung wird verworfen', neg: true });
    expect(aktionen(termin({ status: 'erledigt' }))).toEqual(['ohne', 'nichterledigt']);
    expect(menue(termin({ status: 'erledigt', ohne_beleg: 1 }), H, 'rechnung')[0]).toMatchObject({ aktion: 'mitbeleg', label: 'Doch mit Rechnung' });
    expect(aktionen(termin({ status: 'erledigt', ohne_beleg: 1, einnahme: einnahme() }))).toEqual(['einnahme']);
    expect(menue(termin({ status: 'abgesagt' }), H, 'quittung')).toEqual([]);
  });
});

describe('Datum und Uhrzeit', () => {
  it('Minuten, „bis“-Vorschlag, Reihenfolge', () => {
    expect([minuten('08:30'), minuten('8:05'), minuten('24:00'), minuten(''), minuten(null)]).toEqual([510, 485, null, null, null]);
    expect([plus2h('08:00'), plus2h('23:00'), plus2h('')]).toEqual(['10:00', '23:59', '']);
    const l = [zeile({ id: 3, datum: '2026-10-23', von: '09:00' }), zeile({ id: 4, datum: '2026-10-23', von: '08:00' }), zeile({ id: 1, datum: '2026-10-21' }), zeile({ id: 2, datum: '2026-10-23', von: null })];
    expect([...l].sort(chrono).map((t) => t.id)).toEqual([1, 2, 4, 3]);
  });

  it('Tage lang, relativ und als Kopf', () => {
    expect(tagLang('2026-10-19', H)).toBe('Montag, 19. Oktober');
    expect(tagLang('2025-12-30', H)).toBe('Dienstag, 30. Dezember 2025');
    expect([relTag(H, H), relTag('2026-10-23', H), relTag('2026-10-21', H), relTag('2026-10-25', H)]).toEqual(['Heute', 'Morgen', 'Gestern', '']);
    expect(terminWann({ datum: '2026-10-19', von: '08:00' })).toBe('Mo, 19.10.2026 · 08:00');
    expect(tagKopf(H, H)).toEqual({ titel: 'Heute', zusatz: '· Donnerstag, 22. Oktober' });
    expect(tagKopf('2026-10-26', H)).toEqual({ titel: 'Montag, 26. Oktober', zusatz: 'in 4 Tagen' });
  });

  it('Adresse einzeilig und als Karten-Link', () => {
    expect(adresseEinzeilig(' Gartenweg 3 \n\n12390 Seehausen')).toBe('Gartenweg 3, 12390 Seehausen');
    expect(kartenUrl('Gartenweg 3\n12390 Seehausen')).toBe('https://maps.apple.com/?q=Gartenweg%203%2C%2012390%20Seehausen');
    expect(kartenUrl('  ')).toBeNull();
  });
});

describe('Termin-Schublade', () => {
  const KUNDEN: TerminKunde[] = [
    { id: 1, nummer: 'K-0001', name: 'Anna Schmidt', ort: 'Seehausen', zusatz: null, strasse: 'Gartenweg 3', plz: '12390', notiz: 'Hund im Garten' },
    { id: 2, nummer: 'K-0002', name: 'Anna Schmidt', ort: 'Musterstadt', zusatz: null, strasse: null, plz: null, notiz: null },
    { id: 3, nummer: 'K-0003', name: 'Bob Bauer', ort: null, zusatz: null, strasse: null, plz: null, notiz: null },
  ];
  const fo = (x: Partial<TerminFormular> = {}): TerminFormular => ({
    kunde: 'Bob Bauer · K-0003',
    kundeBewusstNeu: null,
    datum: H,
    von: '8:00',
    bis: '',
    adresse: ' Lindenweg 1 \n\n 12345 Musterstadt ',
    leistung: ' Hecke ',
    betrag: '65',
    notiz: ' ',
    beleg: 'quittung',
    ...x,
  });
  const o = { heute: H, beleg: 'quittung' as const, wiederEinplanen: false };

  it('prüfen: Kunde per Nummer, „bis“ = von + 2 h, Adresse bereinigt, Betrag in Cent', () => {
    expect(terminPruefen(fo(), KUNDEN, o)).toEqual({
      ok: true,
      daten: {
        kunde_id: 3,
        neuer_kunde: null,
        datum: H,
        von: '08:00',
        bis: '10:00',
        adresse: 'Lindenweg 1\n12345 Musterstadt',
        leistung: 'Hecke',
        betrag_geschaetzt_cent: 6_500,
        notiz: null,
        beleg: 'quittung',
        wieder_einplanen: false,
        heute: H,
      },
    });
    const neu = terminPruefen(fo({ kunde: 'Clara Neu', betrag: '' }), KUNDEN, { ...o, beleg: 'behalten', wiederEinplanen: true });
    expect(neu).toMatchObject({ ok: true, daten: { kunde_id: null, neuer_kunde: 'Clara Neu', betrag_geschaetzt_cent: null, beleg: 'behalten', wieder_einplanen: true } });
    // gleicher Name: erst nachfragen, „Neuer Kunde mit diesem Namen“ legt bewusst neu an
    expect(terminPruefen(fo({ kunde: 'Anna Schmidt' }), KUNDEN, o)).toEqual({ ok: false, fehler: { kunde: 'Bitte wählen, wer gemeint ist' } });
    const bewusst = terminPruefen(fo({ kunde: 'Anna Schmidt', kundeBewusstNeu: nameSchluessel('Anna Schmidt') }), KUNDEN, o);
    expect(bewusst).toMatchObject({ ok: true, daten: { kunde_id: null, neuer_kunde: 'Anna Schmidt' } });
  });

  it('prüfen: Fehler je Feld', () => {
    const f = (x: Partial<TerminFormular>) => {
      const r = terminPruefen(fo(x), KUNDEN, o);
      return r.ok ? {} : r.fehler;
    };
    expect(f({ kunde: ' ' })).toEqual({ kunde: 'Bitte einen Kunden eintragen' });
    expect(f({ datum: '2026-02-30' })).toEqual({ datum: 'Bitte ein Datum wählen' });
    expect(f({ von: '' })).toEqual({ von: 'Beginn fehlt' });
    expect(f({ bis: '07:00' })).toEqual({ bis: 'Ende vor Beginn' });
    expect(f({ leistung: '  ' })).toEqual({ leistung: 'Was wird gemacht?' });
    expect(f({ betrag: 'abc' })).toEqual({ betrag: BETRAG_FEHLER });
    expect(f({ betrag: '-5' })).toEqual({ betrag: BETRAG_FEHLER });
  });

  it('Überschneidungen und Hinweis unter „Wann“', () => {
    const l = [termin({ id: 1 }), termin({ id: 2, von: '11:00', bis: null, kunde_name: 'Bob Bauer' }), termin({ id: 3, von: '09:00', status: 'abgesagt' })];
    expect(ueberschneidungen(l, null, H, '09:30', '11:30').map((t) => t.id)).toEqual([1, 2]);
    expect(ueberschneidungen(l, 1, H, '09:30', '10:30')).toEqual([]);
    expect(ueberschneidungen(l, null, H, '10:00', '11:00')).toEqual([]);
    const h = (x: Partial<Parameters<typeof wannHinweis>[0]>) => wannHinweis({ datum: H, von: '09:00', bis: '09:30', heute: H, geplant: true, liste: l, selbst: null, ...x });
    expect(h({})).toEqual({ tag: 'Donnerstag, 22. Oktober · heute', warnung: 'Überschneidet sich mit 08:00–10:00 Anna Schmidt.' });
    expect(h({ datum: '2026-10-01' })?.warnung).toBe('Liegt in der Vergangenheit – erscheint unter „Nachtragen“.');
    expect(h({ von: '10:00', bis: '09:00' })?.warnung).toBe('Das Ende liegt vor dem Beginn.');
    expect(h({ geplant: false })?.warnung).toBeNull();
    expect(h({ datum: '' })).toBeNull();
  });

  it('Leistungen mit Ø-Betrag aus den Quittungen', () => {
    const v = leistungsVorschlaege([
      { text: 'Rasen mähen', cent: 6_000 },
      { text: ' rasen MÄHEN ', cent: 7_000 },
      { text: 'Rasen mähen', cent: null },
      { text: 'Hecke', cent: null },
      { text: null, cent: 100 },
      { text: ' ', cent: 5 },
    ]);
    expect(v).toEqual([
      { text: 'Rasen mähen', n: 3, schnitt: 6_500, nb: 2 },
      { text: 'Hecke', n: 1, schnitt: null, nb: 0 },
    ]);
    expect(betragVorschlag('rasen mähen', v)).toEqual({ cent: 6_500, text: `Sonst meist um 65${NBSP}€ (Ø aus 2 Quittungen)` });
    expect(betragVorschlag('Hecke', v)).toBeNull();
    expect(betragVorschlag('Fenster', leistungsVorschlaege([{ text: 'Fenster', cent: 1_234 }]))?.cent).toBe(1_200);
  });

  it('Startwerte: bestehender Termin, wieder einplanen, Vorbelegung', () => {
    const t = termin({ entwurf: beleg({ art: 'rechnung' }), betrag_geschaetzt_cent: 6_550, notiz: 'Tor zu' });
    expect(formularStart({ termin: t, wieder: false, standard: 'quittung', heute: H })).toEqual({
      kunde: 'Anna Schmidt · K-0001',
      kundeBewusstNeu: null,
      datum: H,
      von: '08:00',
      bis: '10:00',
      adresse: 'Gartenweg 3\n12390 Seehausen',
      leistung: 'Rasen mähen',
      betrag: '65,50',
      notiz: 'Tor zu',
      beleg: 'rechnung',
    });
    expect(formularStart({ termin: termin(), wieder: false, standard: 'quittung', heute: H }).beleg).toBe('keinen');
    const wieder = formularStart({ termin: termin({ datum: '2026-10-01', status: 'abgesagt' }), wieder: true, standard: 'rechnung', heute: H });
    expect([wieder.datum, wieder.beleg]).toEqual([H, 'rechnung']);
    const neu = formularStart({ termin: null, vorgabe: { kunde: 1 }, kunden: KUNDEN, standard: 'quittung', heute: H });
    expect(neu).toMatchObject({ kunde: 'Anna Schmidt · K-0001', adresse: 'Gartenweg 3\n12390 Seehausen', datum: H, von: '09:00', bis: '11:00', beleg: 'quittung' });
    const vorgabe = formularStart({ termin: null, vorgabe: { datum: 'x', von: '14:00', bis: '13:00', betrag: 5, beleg: 'keinen' }, kunden: KUNDEN, standard: 'quittung', heute: H });
    expect(vorgabe).toMatchObject({ kunde: '', datum: H, von: '14:00', bis: '16:00', betrag: '0,05', beleg: 'keinen' });
    expect([betragFeld(6_500), betragFeld(null), betragFeld(0)]).toEqual(['65', '', '']);
  });

  it('Termin ⇒ Eingabe für Rust (Menü „Quittung vorbereiten“)', () => {
    expect(terminDatenAus(zeile(), 'quittung', H)).toEqual({
      kunde_id: 1,
      neuer_kunde: null,
      datum: H,
      von: '08:00',
      bis: '10:00',
      adresse: 'Gartenweg 3\n12390 Seehausen',
      leistung: 'Rasen mähen',
      betrag_geschaetzt_cent: 6_500,
      notiz: null,
      beleg: 'quittung',
      wieder_einplanen: false,
      heute: H,
    });
  });
});

describe('Vorbereiteter Beleg (Entwurf ohne Nummer)', () => {
  const basis = { termin: { datum: '2026-10-23', leistung: 'Hecke schneiden', betrag: 9_000 }, vorhanden: null, altLeistung: '', zielTage: 14, vorlageId: 4, heute: H };

  it('neu: eine Position Leistung × geschätzter Betrag, Datum = Termin, Rechnung mit Zahlungsziel', () => {
    const q = vorbereitungFormular({ ...basis, art: 'quittung' });
    expect(q).toMatchObject({ art: 'quittung', kunde: '', datum: '2026-10-23', leistungVon: '2026-10-23', betreff: 'Hecke schneiden', vorlageId: 4, zahlungsart: 'bar' });
    expect(q.positionen).toEqual([{ beschreibung: 'Hecke schneiden', menge: '1', einheit: 'pausch.', preis: '90,00', kategorieId: null }]);
    const r = vorbereitungDaten({ ...basis, art: 'rechnung' });
    expect(r).toMatchObject({
      art: 'rechnung',
      kunde_id: null,
      kunde_name: null,
      datum: '2026-10-23',
      leistung_von: '2026-10-23',
      faellig_am: '2026-11-06',
      betreff: 'Hecke schneiden',
      zahlungsart: null,
      bezahlt_am: null,
      vorlage_id: 4,
    });
    expect(r?.positionen).toEqual([{ beschreibung: 'Hecke schneiden', menge: 1, einheit: 'pausch.', einzelpreis_cent: 9_000, kategorie_id: null }]);
    expect(vorbereitungFormular({ ...basis, art: 'quittung', termin: { ...basis.termin, betrag: null } }).positionen[0].preis).toBe('');
  });

  it('aktives Design der Art landet im Entwurf (entwurf_json.vorlage_design), unbekannt ⇒ klassisch', () => {
    const q = vorbereitungFormular({ ...basis, art: 'quittung', vorlageId: null, vorlageDesign: 'formular' });
    expect(q).toMatchObject({ vorlageId: null, vorlageDesign: 'formular' });
    expect(vorbereitungDaten({ ...basis, art: 'quittung', vorlageId: null, vorlageDesign: 'formular' })?.zusatz).toEqual({ vorlage_design: 'formular' });
    expect(vorbereitungFormular({ ...basis, art: 'rechnung', vorlageDesign: 'formular' }).vorlageDesign).toBe('klassisch');
    expect(vorbereitungDaten({ ...basis, art: 'rechnung' })?.zusatz).toEqual({});
  });

  it('vorhanden: folgt dem Termin, behält eigene Positionen und Betreff; Artwechsel mit Standardtexten', () => {
    const q = vorbereitungFormular({ ...basis, art: 'quittung' });
    const vorhanden: BelegFormular = {
      ...q,
      betreff: 'Eigener Betreff',
      positionen: [q.positionen[0], { ...q.positionen[0], beschreibung: 'Grünschnitt', preis: '15,00' }],
      mehrere: true,
      vorlageId: 9,
      terminId: 5,
    };
    const termin2 = { datum: '2026-10-30', leistung: 'Hecke', betrag: 5_000 };
    const a = vorbereitungFormular({ ...basis, art: 'quittung', termin: termin2, vorhanden, altLeistung: 'Hecke schneiden' });
    expect(a).toMatchObject({ datum: '2026-10-30', leistungVon: '2026-10-30', betreff: 'Eigener Betreff', vorlageId: 9, terminId: 5, mehrere: true });
    expect(a.positionen).toHaveLength(2);
    const b = vorbereitungFormular({ ...basis, art: 'rechnung', termin: termin2, vorhanden: { ...q, terminId: 5 }, altLeistung: 'Hecke schneiden' });
    expect(b).toMatchObject({ art: 'rechnung', betreff: 'Hecke', zielTage: '14', vorlageId: 4, terminId: 5, einleitung: STANDARD_TEXTE.rechnung.einleitung });
    expect(b.positionen).toEqual([{ beschreibung: 'Hecke', menge: '1', einheit: 'pausch.', preis: '50,00', kategorieId: null }]);
  });

  it('Hinweis unter „Beleg vorbereiten“', () => {
    expect(vorbereitenHinweis('keinen', null, 14)).toBe('Ohne Beleg. Beim Erledigen kannst du die Quittung immer noch ausstellen.');
    expect(vorbereitenHinweis('keinen', 'quittung', 14)).toMatch(/^Die vorbereitete Quittung wird beim Speichern verworfen/);
    expect(vorbereitenHinweis('rechnung', null, 14)).toMatch(/Entwurf ohne Nummer.*Zahlungsziel 14 Tage ab Termin\.$/);
    expect(vorbereitenHinweis('rechnung', 'quittung', 21)).toMatch(/^Die vorbereitete Quittung wird zur Rechnung\./);
    expect(vorbereitenHinweis('quittung', 'quittung', 14)).toMatch(/^Quittung ist vorbereitet \(noch ohne Nummer\)\./);
  });
});

describe('Erfassen-Schublade zum Termin', () => {
  it('„Quittung ausstellen“: Vorbelegung aus Termin und Entwurf', () => {
    const t = termin({ id: 7, status: 'erledigt', entwurf: beleg({ id: 10, art: 'rechnung', summe_cent: 7_000 }) });
    expect(vorbelegungZumAusstellen(t, 'quittung', H)).toEqual({ typ: 'einnahme', beleg: 'rechnung', termin: 7, entwurf: 10, kunde: 1, betrag: 7_000, text: 'Rasen mähen', datum: H });
    const ohne = vorbelegungZumAusstellen(termin({ id: 8, kunde_id: null, betrag_geschaetzt_cent: null }), 'quittung', H);
    expect(ohne).toEqual({ typ: 'einnahme', beleg: 'quittung', termin: 8, text: 'Rasen mähen', datum: H });
  });

  it('Hinweiszeile je Weg', () => {
    const t = { datum: H, von: '08:00' };
    const mit = (weg: 'beleg' | 'offen' | 'ohne', entwurfArt: string | null, art: 'quittung' | 'rechnung' = 'quittung', termin: typeof t | null = t) =>
      erfassenHinweis({ termin, entwurfArt, weg, art });
    expect(text(mit('beleg', 'quittung'))).toBe('Vorbereitete Quittung zum Termin am Do, 22.10.2026 · 08:00 – wird jetzt mit Nummer ausgestellt');
    expect(mit('beleg', 'quittung').find((x) => x.fett)?.text).toBe('Do, 22.10.2026 · 08:00');
    expect(text(mit('beleg', 'quittung', 'rechnung'))).toMatch(/^Vorbereitete Rechnung zum Termin/);
    expect(text(mit('offen', 'rechnung'))).toBe('Vorbereitete Rechnung zum Termin am Do, 22.10.2026 · 08:00 wird verworfen – der Termin wird mit der zugeordneten Rechnung abgeschlossen');
    expect(text(mit('ohne', null))).toBe('Termin am Do, 22.10.2026 · 08:00 – wird beim Speichern ohne Beleg abgeschlossen');
    expect(text(mit('beleg', null))).toBe('Termin am Do, 22.10.2026 · 08:00 – wird beim Speichern als erledigt abgehakt');
    expect(text(mit('ohne', 'quittung', 'quittung', null))).toBe('Vorbereiteter Beleg bleibt Entwurf');
    expect(mit('ohne', null, 'quittung', null)).toEqual([]);
  });

  it('Vorbelegung und Beleg-Angaben aus Termin und Entwurf ergänzen', () => {
    const formular = vorbereitungFormular({ art: 'rechnung', termin: { datum: H, leistung: 'Hecke', betrag: 9_000 }, vorhanden: null, altLeistung: '', zielTage: 14, vorlageId: 4, heute: H });
    const bezug: ErfassenBezug = { termin: termin({ id: 7 }), entwurf: { id: 10, kundeId: 2, formular } };
    expect(vorbelegungMitBezug({ entwurf: 10 }, bezug)).toEqual({ entwurf: 10, typ: 'einnahme', beleg: 'rechnung', kunde: 2, betrag: 9_000, text: 'Hecke', termin: 7 });
    const vorgabe = { termin: 7, kunde: 1, betrag: 100, text: 'X', beleg: 'quittung' as const };
    expect(vorbelegungMitBezug(vorgabe, bezug)).toMatchObject(vorgabe);
    expect(vorbelegungMitBezug({ typ: 'ausgabe' }, null)).toEqual({ typ: 'ausgabe' });
    expect(vorbelegungMitBezug({}, { termin: termin({ id: 7, kunde_id: 3 }), entwurf: null })).toEqual({ typ: 'einnahme', kunde: 3, betrag: 6_500, text: 'Rasen mähen', termin: 7 });

    expect(ertragAusEntwurf(bezug.entwurf)).toEqual({ leistung: '', adresse: '', vorlage: { id: 4, design: 'klassisch' } });
    expect(ertragAusEntwurf({ ...bezug.entwurf!, formular: { ...formular, betreff: 'Eigener' } }).leistung).toBe('Hecke');
    expect(ertragAusEntwurf(null)).toEqual({ leistung: '', adresse: '', vorlage: null });
    expect(ertragBezug(bezug)).toEqual({ termin: { id: 7, datum: H }, entwurf: formular });
    expect(ertragBezug(null)).toBeNull();
  });
});
