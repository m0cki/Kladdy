import { describe, expect, it } from 'vitest';
import {
  LEERER_FILTER,
  abziehbar,
  anzahlErweitert,
  anzahlText,
  betragAnzeige,
  fehltBeleg,
  filtere,
  formularSchluessel,
  gegenueber,
  geschaefte,
  geschaeftZu,
  kannStornieren,
  kategorieAusText,
  kundeAufloesen,
  kundenLabel,
  markiere,
  nameOhneNummer,
  privatProzent,
  pruefeFormular,
  sperre,
  type BuchungZeile,
  type Formular,
  type KategorieWahl,
  type KundeKurz,
  type PruefKontext,
} from './buchungen';

const zeile = (z: Partial<BuchungZeile> & { id: number }): BuchungZeile => ({
  nummer: `2026-${String(z.id).padStart(4, '0')}`,
  typ: 'ausgabe',
  zahlungsdatum: '2026-10-01',
  belegdatum: null,
  betrag_cent: 1000,
  privatanteil_prozent: 0,
  kategorie_id: 3,
  kategorie_name: 'Sprit & Fahrzeug',
  kategorie_icon: 'fuel',
  kategorie_farbe: '#0ea5e9',
  kunde_id: null,
  kunde_name: null,
  kunde_nummer: null,
  lieferant: null,
  art: 'zahlung',
  zahlungsart: 'bank',
  belegnummer: null,
  beschreibung: 'Diesel',
  rechnung_id: null,
  rechnung_nummer: null,
  belege_anzahl: 0,
  storniert: 0,
  festgeschrieben: 0,
  ...z,
});

const KATS: KategorieWahl[] = [
  { id: 1, name: 'Dienstleistungen', typ: 'einnahme', icon: 'wrench', farbe: '#6366f1', stichworte: 'rasen,hecke,garten', euer_bereich: null, abziehbar_prozent: 100, wareneingang: 0, zaehlt_ku_umsatz: 1 },
  { id: 2, name: 'Produkte & Material', typ: 'ausgabe', icon: 'box', farbe: '#f59e0b', stichworte: 'bauhaus,obi,dünger,erde', euer_bereich: null, abziehbar_prozent: 100, wareneingang: 1, zaehlt_ku_umsatz: 0 },
  { id: 3, name: 'Sprit & Fahrzeug', typ: 'ausgabe', icon: 'fuel', farbe: '#0ea5e9', stichworte: 'tankstelle,aral,diesel', euer_bereich: null, abziehbar_prozent: 100, wareneingang: 0, zaehlt_ku_umsatz: 0 },
];

const KUNDEN: KundeKurz[] = [
  { id: 10, nummer: 'K-0010', name: 'Anna Schmidt', ort: 'Berlin' },
  { id: 11, nummer: 'K-0011', name: 'Anna  schmidt', ort: 'Hamburg' },
  { id: 12, nummer: 'K-0012', name: 'Bernd Müller', ort: null },
];

describe('Regeln', () => {
  it('fehltBeleg: nur Zahlungen ohne Datei, nicht storniert, ohne eigenen Beleg', () => {
    expect(fehltBeleg(zeile({ id: 1 }))).toBe(true);
    expect(fehltBeleg(zeile({ id: 1, belege_anzahl: 1 }))).toBe(false);
    expect(fehltBeleg(zeile({ id: 1, storniert: 1 }))).toBe(false);
    expect(fehltBeleg(zeile({ id: 1, rechnung_id: 4 }))).toBe(false);
    expect(fehltBeleg(zeile({ id: 1, art: 'afa' }))).toBe(false);
  });
  it('sperre und kannStornieren', () => {
    expect(sperre(zeile({ id: 1 }))).toBeNull();
    expect(sperre(zeile({ id: 1, storniert: 1, rechnung_id: 3 }))).toBe('storniert');
    expect(sperre(zeile({ id: 1, rechnung_id: 3, festgeschrieben: 1 }))).toBe('beleg');
    expect(sperre(zeile({ id: 1, festgeschrieben: 1 }))).toBe('festgeschrieben');
    expect(sperre(zeile({ id: 1, art: 'pauschale' }))).toBe('modul');
    expect(kannStornieren(zeile({ id: 1 }))).toBe(true);
    expect(kannStornieren(zeile({ id: 1, festgeschrieben: 1 }))).toBe(true);
    expect(kannStornieren(zeile({ id: 1, rechnung_id: 2 }))).toBe(false);
    expect(kannStornieren(zeile({ id: 1, storniert: 1 }))).toBe(false);
  });
  it('Betrag mit Vorzeichen und echtem Minus', () => {
    expect(betragAnzeige({ typ: 'einnahme', betrag_cent: 123456 })).toBe('+1.234,56\u00a0€');
    expect(betragAnzeige({ typ: 'ausgabe', betrag_cent: 1250 })).toBe('\u221212,50\u00a0€');
  });
  it('gegenueber: Kunde mit Nummer bzw. Geschäft', () => {
    expect(gegenueber(zeile({ id: 1, typ: 'einnahme', kunde_name: 'Anna', kunde_nummer: 'K-0001' }))).toBe('Anna · K-0001');
    expect(gegenueber(zeile({ id: 1, lieferant: ' Aral ' }))).toBe('Aral');
    expect(gegenueber(zeile({ id: 1, typ: 'einnahme' }))).toBe('');
  });
  it('abziehbar: Privatanteil und Abzugsquote in Cent', () => {
    expect(abziehbar(10000, 30)).toBe(7000);
    expect(abziehbar(1999, 0, 70)).toBe(1399);
    expect(abziehbar(1001, 50)).toBe(500);
  });
});

describe('filtere', () => {
  const alle = [
    zeile({ id: 1, typ: 'einnahme', kategorie_id: 1, kategorie_name: 'Dienstleistungen', beschreibung: 'Rasen mähen', kunde_name: 'Anna Schmidt', kunde_nummer: 'K-0010', zahlungsart: 'bar', betrag_cent: 4500, zahlungsdatum: '2026-10-03' }),
    zeile({ id: 2, beschreibung: 'Diesel', lieferant: 'Aral Tankstelle', betrag_cent: 123456, zahlungsdatum: '2026-10-05' }),
    zeile({ id: 3, kategorie_id: 2, kategorie_name: 'Produkte & Material', beschreibung: 'Dünger', lieferant: 'Bauhaus', belege_anzahl: 1, zahlungsdatum: '2026-10-05' }),
    zeile({ id: 4, beschreibung: 'Storniert', storniert: 1, zahlungsdatum: '2026-10-01' }),
  ];

  it('ohne Filter: alles, neueste zuerst, am selben Tag höhere ID zuerst', () => {
    const r = filtere(alle, LEERER_FILTER);
    expect(r.zeilen.map((b) => b.id)).toEqual([3, 2, 1, 4]);
    expect(r.tabs).toEqual({ alle: 4, einnahme: 1, ausgabe: 3 });
    expect(r.ohneBeleg).toBe(2);
  });
  it('Typ-Tab filtert, Zähler an den Tabs bleiben', () => {
    const r = filtere(alle, { ...LEERER_FILTER, typ: 'einnahme' });
    expect(r.zeilen.map((b) => b.id)).toEqual([1]);
    expect(r.tabs.alle).toBe(4);
  });
  it('Suche über Gegenüber, Kundennummer, Kategorie, Betrag (deutsch und mit Punkt), Akzente egal', () => {
    expect(filtere(alle, { ...LEERER_FILTER, q: 'aral' }).zeilen.map((b) => b.id)).toEqual([2]);
    expect(filtere(alle, { ...LEERER_FILTER, q: 'k-0010' }).zeilen.map((b) => b.id)).toEqual([1]);
    expect(filtere(alle, { ...LEERER_FILTER, q: '1.234,56' }).zeilen.map((b) => b.id)).toEqual([2]);
    expect(filtere(alle, { ...LEERER_FILTER, q: '1234.56' }).zeilen.map((b) => b.id)).toEqual([2]);
    expect(filtere(alle, { ...LEERER_FILTER, q: 'dunger' }).zeilen.map((b) => b.id)).toEqual([3]);
    expect(filtere(alle, { ...LEERER_FILTER, q: 'rasen anna' }).zeilen.map((b) => b.id)).toEqual([1]);
    expect(filtere(alle, { ...LEERER_FILTER, q: 'Überweisung bauhaus' }).zeilen.map((b) => b.id)).toEqual([3]);
  });
  it('Kategorie, Zahlungsweg, nur ohne Beleg', () => {
    expect(filtere(alle, { ...LEERER_FILTER, kategorien: [2] }).zeilen.map((b) => b.id)).toEqual([3]);
    expect(filtere(alle, { ...LEERER_FILTER, zahlungsart: 'bar' }).zeilen.map((b) => b.id)).toEqual([1]);
    const ob = filtere(alle, { ...LEERER_FILTER, ohneBeleg: true });
    expect(ob.zeilen.map((b) => b.id)).toEqual([2, 1]);
    expect(ob.ohneBeleg).toBe(2);
  });
  it('Zähler je Kategorie ignorieren den Kategorie-Filter', () => {
    const r = filtere(alle, { ...LEERER_FILTER, kategorien: [2] });
    expect(r.proKategorie.get(3)).toBe(2);
    expect(r.proKategorie.get(2)).toBe(1);
  });
  it('anzahlErweitert / anzahlText', () => {
    expect(anzahlErweitert({ ...LEERER_FILTER, kategorien: [1, 2], ohneBeleg: true, zahlungsart: 'bar' })).toBe(4);
    expect(anzahlText(1)).toBe('1 Eintrag');
    expect(anzahlText(1420)).toBe('1.420 Einträge');
  });
});

describe('kategorieAusText', () => {
  it('über Stichworte, nur Kategorien des Typs, Umlaute egal', () => {
    expect(kategorieAusText('Diesel bei Aral', KATS, 'ausgabe')).toBe(3);
    expect(kategorieAusText('DUENGER', KATS, 'ausgabe')).toBeNull();
    expect(kategorieAusText('Dünger', KATS, 'ausgabe')).toBe(2);
    expect(kategorieAusText('Hecke schneiden', KATS, 'einnahme')).toBe(1);
    expect(kategorieAusText('Hecke schneiden', KATS, 'ausgabe')).toBeNull();
    expect(kategorieAusText('ob', KATS, 'ausgabe')).toBeNull();
  });
});

describe('Kunden', () => {
  it('Label und Name ohne Nummer', () => {
    expect(kundenLabel(KUNDEN[0])).toBe('Anna Schmidt · K-0010');
    expect(nameOhneNummer('Anna Schmidt · K-0010')).toBe('Anna Schmidt');
    expect(nameOhneNummer('Anna Schmidt (K-0010)')).toBe('Anna Schmidt');
  });
  it('gebunden nur über die Nummer', () => {
    expect(kundeAufloesen('Anna Schmidt · K-0011', KUNDEN)).toEqual({ art: 'kunde', kunde: KUNDEN[1] });
    expect(kundeAufloesen('k-0012', KUNDEN)).toEqual({ art: 'kunde', kunde: KUNDEN[2] });
  });
  it('gleicher Name ⇒ nachfragen, auch bei nur einem Treffer', () => {
    const r = kundeAufloesen('anna schmidt', KUNDEN);
    expect(r).toMatchObject({ art: 'wahl', name: 'anna schmidt' });
    expect(r.art === 'wahl' && r.liste.map((k) => k.id)).toEqual([10, 11]);
    expect(kundeAufloesen('Bernd Muller', KUNDEN)).toMatchObject({ art: 'wahl' });
  });
  it('bewusst neu bzw. unbekannt ⇒ neuer Kunde', () => {
    expect(kundeAufloesen('Anna Schmidt', KUNDEN, 'anna schmidt')).toMatchObject({ art: 'neu', name: 'Anna Schmidt' });
    expect(kundeAufloesen('  Clara Neu ', KUNDEN)).toEqual({ art: 'neu', name: 'Clara Neu', namensvettern: [] });
    expect(kundeAufloesen('Clara · K-9999', KUNDEN)).toMatchObject({ art: 'neu', name: 'Clara' });
    expect(kundeAufloesen('   ', KUNDEN)).toEqual({ art: 'leer' });
  });
});

describe('geschaefte', () => {
  const g = geschaefte([
    { lieferant: 'Aral', kategorie_id: 3, n: 4 },
    { lieferant: 'ARAL', kategorie_id: 2, n: 1 },
    { lieferant: 'Bauhaus', kategorie_id: 2, n: 2 },
    { lieferant: '  ', kategorie_id: 2, n: 9 },
  ]);
  it('zusammengefasst, häufigste zuerst, häufigste Kategorie und Schreibweise', () => {
    expect(g).toEqual([
      { name: 'Aral', anzahl: 5, kategorie_id: 3 },
      { name: 'Bauhaus', anzahl: 2, kategorie_id: 2 },
    ]);
    expect(geschaeftZu('aral', g)?.kategorie_id).toBe(3);
    expect(geschaeftZu('', g)).toBeNull();
  });
});

describe('pruefeFormular', () => {
  const ctx: PruefKontext = { kategorien: KATS, kunden: KUNDEN, heute: '2026-10-15', festBis: null };
  const basis: Formular = {
    typ: 'ausgabe',
    betrag: '12,5',
    kategorieId: 3,
    zahlungsdatum: '2026-10-14',
    belegnummer: ' Bon 4711 ',
    beschreibung: ' Diesel ',
    wer: ' Aral ',
    kundeBewusstNeu: null,
    privat: '',
    zahlungsart: 'bar',
  };

  it('Ausgabe ⇒ daten', () => {
    const r = pruefeFormular(basis, ctx);
    expect(r).toEqual({
      ok: true,
      daten: {
        typ: 'ausgabe',
        zahlungsdatum: '2026-10-14',
        belegdatum: null,
        betrag_cent: 1250,
        privatanteil_prozent: 0,
        kategorie_id: 3,
        kunde_id: null,
        neuer_kunde: null,
        lieferant: 'Aral',
        zahlungsart: 'bar',
        belegnummer: 'Bon 4711',
        beschreibung: 'Diesel',
        heute: '2026-10-15',
      },
    });
  });
  it('„12.50“ und Privatanteil', () => {
    const r = pruefeFormular({ ...basis, betrag: '12.50', privat: '30' }, ctx);
    expect(r.ok && r.daten).toMatchObject({ betrag_cent: 1250, privatanteil_prozent: 30 });
  });
  it('Einnahme: gewählter Kunde ⇒ kunde_id, neuer Name ⇒ neuer_kunde, kein Lieferant, kein Privatanteil', () => {
    const e = { ...basis, typ: 'einnahme' as const, kategorieId: 1, privat: '50' };
    const a = pruefeFormular({ ...e, wer: 'Anna Schmidt · K-0010' }, ctx);
    expect(a.ok && a.daten).toMatchObject({ kunde_id: 10, neuer_kunde: null, lieferant: null, privatanteil_prozent: 0 });
    const b = pruefeFormular({ ...e, wer: 'Clara Neu' }, ctx);
    expect(b.ok && b.daten).toMatchObject({ kunde_id: null, neuer_kunde: 'Clara Neu' });
    const c = pruefeFormular({ ...e, wer: '' }, ctx);
    expect(c.ok && c.daten).toMatchObject({ kunde_id: null, neuer_kunde: null });
  });
  it('gleicher Name ohne Wahl ⇒ Fehler; bewusst neu ⇒ ok', () => {
    const e = { ...basis, typ: 'einnahme' as const, kategorieId: 1, wer: 'Bernd Müller' };
    expect(pruefeFormular(e, ctx)).toEqual({ ok: false, fehler: { wer: 'Bitte wählen, wer gemeint ist.' } });
    const r = pruefeFormular({ ...e, kundeBewusstNeu: 'bernd muller' }, ctx);
    expect(r.ok && r.daten.neuer_kunde).toBe('Bernd Müller');
  });
  it('Fehler je Feld', () => {
    const r = pruefeFormular({ ...basis, betrag: '1,2,3', kategorieId: 1, zahlungsdatum: '', beschreibung: ' ', privat: '120' }, ctx);
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.fehler)).toEqual(['betrag', 'kategorie', 'zahlungsdatum', 'beschreibung', 'privat']);
    expect(pruefeFormular({ ...basis, betrag: '' }, ctx)).toMatchObject({ ok: false, fehler: { betrag: 'Bitte einen Betrag eingeben.' } });
    expect(pruefeFormular({ ...basis, betrag: '0' }, ctx).ok).toBe(false);
    expect(pruefeFormular({ ...basis, betrag: '-5' }, ctx).ok).toBe(false);
    expect(pruefeFormular({ ...basis, betrag: '100.000.000' }, ctx).ok).toBe(false);
  });
  it('festgeschriebener Zeitraum', () => {
    const r = pruefeFormular(basis, { ...ctx, festBis: '2026-10-14' });
    expect(r).toMatchObject({ ok: false, fehler: { zahlungsdatum: expect.stringContaining('14.10.2026') } });
    expect(pruefeFormular(basis, { ...ctx, festBis: '2026-10-13' }).ok).toBe(true);
  });
  it('Belegdatum beim Bearbeiten bleibt erhalten', () => {
    const r = pruefeFormular(basis, { ...ctx, belegdatum: '2026-10-10' });
    expect(r.ok && r.daten.belegdatum).toBe('2026-10-10');
  });
  it('privatProzent', () => {
    expect(privatProzent('')).toBe(0);
    expect(privatProzent('100')).toBe(100);
    expect(privatProzent('12,5')).toBeNull();
    expect(privatProzent('101')).toBeNull();
  });
  it('formularSchluessel: Leerzeichen und leerer Privatanteil egal', () => {
    expect(formularSchluessel(basis)).toBe(formularSchluessel({ ...basis, beschreibung: 'Diesel', privat: '0' }));
    expect(formularSchluessel(basis)).not.toBe(formularSchluessel({ ...basis, betrag: '12' }));
  });
});

describe('markiere', () => {
  it('findet Wörter unabhängig von Groß/klein und Umlauten, verschmilzt Überlappungen', () => {
    expect(markiere('Dünger für Rasen', 'dunger')).toEqual([[0, 6]]);
    expect(markiere('Dünger für Rasen', 'rasen DÜN')).toEqual([[0, 3], [11, 16]]);
    expect(markiere('Aral', 'ar ral')).toEqual([[0, 4]]);
    expect(markiere('Aral', '  ')).toEqual([]);
  });
});
