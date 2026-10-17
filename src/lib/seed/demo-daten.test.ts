import { describe, expect, it } from 'vitest';
import { demoDaten, DEMO_KATEGORIE, DEMO_SEED, plusTage, positionenSumme, type DemoDaten } from './demo-daten';
import { istDatum } from '../zeitraum';
import { formatNummer, STANDARD_MUSTER } from '../numbering';

const HEUTE = '2026-10-17';
const d = demoDaten(HEUTE);
const Y = 2026;

const ganzeCent = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n);
/** Summe der Einnahmen mit KU-Umsatz (Kategorie Dienstleistungen) im Jahr, Stornos abgezogen. */
const kuUmsatz = (x: DemoDaten, jahr: number) =>
  x.buchungen
    .filter((b) => b.typ === 'einnahme' && b.kategorie_id === DEMO_KATEGORIE.dienstleistung && b.zahlungsdatum.startsWith(`${jahr}-`))
    .reduce((s, b) => s + (b.storno_von === null ? b.betrag_cent : -b.betrag_cent), 0);

describe('demoDaten', () => {
  it('ist deterministisch und hängt am Seed', () => {
    expect(JSON.stringify(demoDaten(HEUTE))).toBe(JSON.stringify(d));
    expect(JSON.stringify(demoDaten(HEUTE, DEMO_SEED + 1))).not.toBe(JSON.stringify(d));
    expect(() => demoDaten('17.10.2026')).toThrow();
  });

  it('hat ungefähr 450 Buchungen und 220 Kunden über 22 Monate', () => {
    expect(d.buchungen.length).toBeGreaterThanOrEqual(400);
    expect(d.buchungen.length).toBeLessThanOrEqual(500);
    expect(d.kunden.length).toBeGreaterThanOrEqual(190);
    expect(d.kunden.length).toBeLessThanOrEqual(250);
    const monate = new Set(d.buchungen.map((b) => b.zahlungsdatum.slice(0, 7)));
    expect(monate.size).toBe(22);
    expect(d.buchungen.some((b) => b.typ === 'einnahme')).toBe(true);
    for (const kat of [DEMO_KATEGORIE.produkte, DEMO_KATEGORIE.sprit, DEMO_KATEGORIE.sonstiges]) {
      expect(d.buchungen.some((b) => b.typ === 'ausgabe' && b.kategorie_id === kat)).toBe(true);
    }
    for (const weg of ['bar', 'bank', 'paypal'] as const) expect(d.buchungen.some((b) => b.zahlungsart === weg)).toBe(true);
  });

  it('rechnet nur mit ganzen, positiven Cent', () => {
    for (const b of d.buchungen) {
      expect(ganzeCent(b.betrag_cent)).toBe(true);
      expect(b.betrag_cent).toBeGreaterThan(0);
    }
    for (const r of d.belege) for (const p of r.positionen) expect(ganzeCent(p.einzelpreis_cent)).toBe(true);
    for (const t of d.termine) if (t.betrag_geschaetzt_cent !== null) expect(ganzeCent(t.betrag_geschaetzt_cent)).toBe(true);
  });

  it('liegt im Zeitraum und nicht in der Zukunft (außer geplanten Terminen und ihren Entwürfen)', () => {
    const start = `${Y - 1}-01-01`;
    for (const b of d.buchungen) {
      expect(istDatum(b.zahlungsdatum)).toBe(true);
      expect(b.zahlungsdatum >= start && b.zahlungsdatum <= HEUTE).toBe(true);
    }
    for (const k of d.kunden) expect(istDatum(k.erstellt_am) && k.erstellt_am >= plusTage(start, -10) && k.erstellt_am <= HEUTE).toBe(true);
    for (const r of d.belege) {
      expect(istDatum(r.datum)).toBe(true);
      if (r.status !== 'entwurf') expect(r.datum <= HEUTE).toBe(true);
      if (r.bezahlt_am) expect(r.bezahlt_am <= HEUTE && r.bezahlt_am >= r.datum).toBe(true);
    }
    for (const t of d.termine) {
      expect(istDatum(t.datum)).toBe(true);
      if (t.datum > HEUTE) expect(t.status).toBe('geplant');
      if (t.status === 'erledigt' || t.status === 'abgesagt') expect(t.datum <= HEUTE).toBe(true);
    }
    expect(d.termine.filter((t) => t.datum > HEUTE).length).toBeGreaterThanOrEqual(5);
    expect(d.termine.some((t) => t.status === 'erledigt')).toBe(true);
  });

  it('vergibt Nummern lückenlos je Kreis und Jahr in Datumsreihenfolge', () => {
    d.kunden.forEach((k, i) => expect(k.nummer).toBe(formatNummer(STANDARD_MUSTER.kunde, 0, i + 1)));
    for (let i = 1; i < d.kunden.length; i++) expect(d.kunden[i - 1].erstellt_am <= d.kunden[i].erstellt_am).toBe(true);
    for (const jahr of [Y - 1, Y]) {
      const buch = d.buchungen.filter((b) => b.zahlungsdatum.startsWith(`${jahr}-`));
      buch.forEach((b, i) => expect(b.nummer).toBe(formatNummer(STANDARD_MUSTER.buchung, jahr, i + 1)));
      for (const art of ['quittung', 'rechnung'] as const) {
        const ausgestellt = d.belege.filter((r) => r.art === art && r.nummer !== null && r.datum.startsWith(`${jahr}-`));
        expect(ausgestellt.length).toBeGreaterThan(0);
        ausgestellt.forEach((r, i) => expect(r.nummer).toBe(formatNummer(STANDARD_MUSTER[art], jahr, i + 1)));
      }
    }
    for (let i = 1; i < d.buchungen.length; i++) expect(d.buchungen[i - 1].zahlungsdatum <= d.buchungen[i].zahlungsdatum).toBe(true);
    for (const r of d.belege) expect(r.nummer === null).toBe(r.status === 'entwurf');
  });

  it('verweist nur auf vorhandene Kunden, Belege und Termine', () => {
    const imBereich = (i: number | null, n: number) => i === null || (Number.isInteger(i) && i >= 0 && i < n);
    for (const b of d.buchungen) {
      expect(imBereich(b.kunde, d.kunden.length)).toBe(true);
      expect(imBereich(b.beleg, d.belege.length)).toBe(true);
      if (b.typ === 'einnahme' && b.storno_von === null) expect(b.kunde).not.toBeNull();
      if (b.typ === 'ausgabe') expect(b.kunde === null && !!b.lieferant).toBe(true);
    }
    for (const r of d.belege) {
      expect(imBereich(r.kunde, d.kunden.length)).toBe(true);
      expect(imBereich(r.termin, d.termine.length)).toBe(true);
      expect(r.positionen.length).toBeGreaterThan(0);
    }
    for (const t of d.termine) expect(imBereich(t.kunde, d.kunden.length)).toBe(true);
    // jeder Kunde kommt irgendwo vor
    const benutzt = new Set([...d.buchungen.map((b) => b.kunde), ...d.belege.map((r) => r.kunde), ...d.termine.map((t) => t.kunde)]);
    d.kunden.forEach((_, i) => expect(benutzt.has(i)).toBe(true));
  });

  it('bucht jede bezahlte Quittung/Rechnung genau einmal mit Betrag, Tag und Nummer des Belegs', () => {
    const zuBeleg = new Map<number, number>();
    for (const b of d.buchungen) {
      if (b.beleg === null) continue;
      expect(zuBeleg.has(b.beleg)).toBe(false);
      zuBeleg.set(b.beleg, 1);
      const r = d.belege[b.beleg];
      expect(r.status).toBe('bezahlt');
      expect(b.betrag_cent).toBe(positionenSumme(r.positionen));
      expect(b.zahlungsdatum).toBe(r.bezahlt_am);
      expect(b.belegnummer).toBe(r.nummer);
      expect(b.kunde).toBe(r.kunde);
    }
    d.belege.forEach((r, i) => expect(zuBeleg.has(i)).toBe(r.status === 'bezahlt'));
    expect(d.belege.filter((r) => r.art === 'quittung').every((r) => r.status !== 'offen')).toBe(true);
    expect(d.belege.some((r) => r.art === 'rechnung' && r.status === 'offen')).toBe(true);
    expect(d.belege.some((r) => r.status === 'entwurf' && r.termin !== null)).toBe(true);
  });

  it('storniert wie die App: Gegenbuchung nach dem Original, gleicher Betrag, Verweis auf die Nummer', () => {
    const stornos = d.buchungen.filter((b) => b.storno_von !== null);
    expect(stornos.length).toBe(2);
    for (const s of stornos) {
      const i = d.buchungen.indexOf(s);
      const o = d.buchungen[s.storno_von!];
      expect(s.storno_von!).toBeLessThan(i);
      expect(o.storno_von).toBeNull();
      expect([s.typ, s.betrag_cent, s.kategorie_id, s.zahlungsart]).toEqual([o.typ, o.betrag_cent, o.kategorie_id, o.zahlungsart]);
      expect(s.belegnummer).toBe(o.nummer);
      expect(s.beschreibung.startsWith(`Storno von ${o.nummer}: `)).toBe(true);
      expect(s.zahlungsdatum.slice(0, 4)).toBe(o.zahlungsdatum.slice(0, 4));
    }
  });

  it('bleibt plausibel Kleinunternehmer: Vorjahr unter 25.000 €, Hochrechnung knapp darunter', () => {
    const vorjahr = kuUmsatz(d, Y - 1);
    expect(vorjahr).toBeGreaterThan(1_200_000);
    expect(vorjahr).toBeLessThan(2_500_000);
    const lfd = kuUmsatz(d, Y);
    const monate = 9 + 17 / 31;
    const hochrechnung = (lfd / monate) * 12;
    expect(hochrechnung).toBeGreaterThan(0.8 * 2_500_000);
    expect(hochrechnung).toBeLessThan(2_500_000);
    expect(lfd).toBeGreaterThan(vorjahr * 0.8);
  });

  it('funktioniert auch Anfang Januar und am Jahresende', () => {
    for (const heute of ['2026-01-02', '2027-12-31']) {
      const x = demoDaten(heute);
      expect(x.buchungen.every((b) => b.zahlungsdatum <= heute)).toBe(true);
      expect(x.belege.every((r) => r.status === 'entwurf' || r.datum <= heute)).toBe(true);
      expect(kuUmsatz(x, +heute.slice(0, 4) - 1)).toBeLessThan(2_500_000);
    }
  });
});
