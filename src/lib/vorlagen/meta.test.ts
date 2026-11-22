import { describe, expect, it } from 'vitest';
import { aufloesen, logoHoeheMm, logoPosition, type Baustein } from './bausteine';
import { zusammenfassung } from './baukasten';
import { BEISPIEL_FIRMA, blankobeleg, testbeleg } from './beispiel';
import { datumFormat, datumLang, leistungText, type BelegDokument } from './dokument';
import { META_REIHENFOLGE, metaAngaben, metaReihenfolge, metaVerschieben, metaZeilen } from './meta';
import { pflichtCheck } from './pflicht';
import { standardVorlage } from './standard';

const rechnung = (): BelegDokument => ({ ...testbeleg('rechnung', BEISPIEL_FIRMA, 'klein', '2026-10-18'), nummer: 'RE-2026-007' });
const meta = (b: Partial<Baustein> = {}) => aufloesen({ typ: 'anschrift_meta', ...b });
const metaAusVorlage = (art: 'rechnung' | 'angebot') => standardVorlage(art).find((b) => b.typ === 'anschrift_meta')!;
/** Zeilen als [Beschriftung, Wert] zum Vergleichen */
const zeilen = (b: ReturnType<typeof meta>, doc: BelegDokument) =>
  metaZeilen(b, doc).map((z) => [z.label, z.wert.art === 'text' || z.wert.art === 'nummer' ? z.wert.text : z.wert.art]);

describe('Datumsformat', () => {
  it('lang: Tag ohne Null, Monat ausgeschrieben', () => {
    expect(datumLang('2026-11-21')).toBe('21. November 2026');
    expect(datumLang('2026-03-01')).toBe('1. März 2026');
    expect(datumLang('')).toBe('');
    expect(datumLang(null)).toBe('');
    expect(datumFormat('2026-11-21', 'kurz')).toBe('21.11.2026');
    expect(datumFormat('2026-11-21')).toBe('21.11.2026');
  });

  it('Leistungszeitraum lang: gleicher Monat, gleiches Jahr, über den Jahreswechsel', () => {
    expect(leistungText({ leistung_von: '2026-10-01', leistung_bis: '2026-10-07' }, 'lang')).toBe('1.–7. Oktober 2026');
    expect(leistungText({ leistung_von: '2026-10-28', leistung_bis: '2026-11-03' }, 'lang')).toBe('28. Oktober – 3. November 2026');
    expect(leistungText({ leistung_von: '2026-12-28', leistung_bis: '2027-01-03' }, 'lang')).toBe('28. Dezember 2026 – 3. Januar 2027');
    expect(leistungText({ leistung_von: '2026-10-01', leistung_bis: null }, 'lang')).toBe('1. Oktober 2026');
    // kurz unverändert
    expect(leistungText({ leistung_von: '2026-10-01', leistung_bis: '2026-10-07' })).toBe('01.10.–07.10.2026');
  });
});

describe('Belegdaten: Reihenfolge', () => {
  it('Standard, eigene Folge, doppelte und unbekannte Schlüssel, fehlende hinten', () => {
    expect(metaReihenfolge('')).toEqual(['nr', 'datum', 'leistung', 'kundennr', 'steuernr', 'faellig']);
    expect(metaReihenfolge(META_REIHENFOLGE).join(',')).toBe(META_REIHENFOLGE);
    expect(metaReihenfolge('datum, nr,datum,quatsch')).toEqual(['datum', 'nr', 'leistung', 'kundennr', 'steuernr', 'faellig']);
  });

  it('↑/↓ tauscht mit dem Nachbarn, am Rand unverändert', () => {
    expect(metaVerschieben('', 'datum', -1)).toBe('datum,nr,leistung,kundennr,steuernr,faellig');
    expect(metaVerschieben('', 'nr', -1)).toBe(META_REIHENFOLGE);
    expect(metaVerschieben('', 'faellig', 1)).toBe(META_REIHENFOLGE);
    expect(metaVerschieben('datum,nr', 'nr', 1)).toBe('datum,leistung,nr,kundennr,steuernr,faellig');
  });
});

describe('Belegdaten: Vorschau-Daten (metaZeilen)', () => {
  it('ältere Vorlage ohne neue Felder: wie bisher (Beschriftung je Art, Reihenfolge, kurzes Datum)', () => {
    const b = aufloesen(metaAusVorlage('rechnung'));
    expect(zeilen(b, rechnung())).toEqual([
      ['Rechnungs-Nr.', 'RE-2026-007'],
      ['Datum', '18.10.2026'],
      ['Leistungszeitraum', '12.10.–18.10.2026'],
      ['Kunden-Nr.', 'K-0042'],
      ['Steuernummer', BEISPIEL_FIRMA.steuernummer],
    ]);
    expect(metaZeilen(b, rechnung()).every((z) => !z.eigen)).toBe(true);
    // Entwurf ohne Nummer
    expect(metaZeilen(b, { ...rechnung(), nummer: null })[0].wert).toEqual({ art: 'entwurf' });
  });

  it('eigene Reihenfolge, Beschriftungen und langes Datum', () => {
    const b = meta({
      reihenfolge: 'faellig,datum,nr',
      faellig: true,
      kundennr: false,
      nr_label: 'Rechnungsnummer',
      leistung_label: 'Leistung erbracht',
      datumsformat: 'lang',
    });
    expect(zeilen(b, rechnung())).toEqual([
      ['Fällig am', '1. November 2026'],
      ['Datum', '18. Oktober 2026'],
      ['Rechnungsnummer', 'RE-2026-007'],
      ['Leistung erbracht', '12.–18. Oktober 2026'],
    ]);
    expect(metaZeilen(b, rechnung()).map((z) => z.eigen)).toEqual([false, false, true, true]);
  });

  it('Beschriftung nur aus Leerzeichen oder leeren Tags = Standard', () => {
    expect(zeilen(meta({ nr_label: '  ', datum_label: '<b></b>' }), rechnung()).slice(0, 2)).toEqual([
      ['Rechnungs-Nr.', 'RE-2026-007'],
      ['Datum', '18.10.2026'],
    ]);
  });

  it('Angebot: nie Leistungsdatum, „Gültig bis“; leere Werte fallen weg', () => {
    const doc: BelegDokument = { ...rechnung(), art: 'angebot', kunde: null };
    const b = meta({ faellig: true });
    expect(metaAngaben(b, 'angebot').map((a) => a.key)).toEqual(['nr', 'datum', 'kundennr', 'faellig']);
    expect(zeilen(b, doc).map(([l]) => l)).toEqual(['Angebots-Nr.', 'Datum', 'Gültig bis']);
  });

  it('Blanko: Schreiblinien, Steuernummer aus den Firmendaten, eigene Beschriftung bleibt', () => {
    const doc = blankobeleg('rechnung', BEISPIEL_FIRMA, 'klein');
    const b = meta({ steuernr: true, reihenfolge: 'steuernr', nr_label: 'Nr.' });
    expect(zeilen(b, doc)).toEqual([
      ['Steuernummer', BEISPIEL_FIRMA.steuernummer],
      ['Nr.', 'luecke'],
      ['Datum', 'luecke'],
      ['Leistungsdatum', 'luecke'],
      ['Kunden-Nr.', 'luecke'],
    ]);
  });

  it('Kurzinfo in der Bausteinliste: Angaben in Reihenfolge mit eigenen Beschriftungen', () => {
    expect(zusammenfassung({ typ: 'anschrift_meta' })).toBe('Empfänger · Nr. · Datum · Leistungsdatum · Kunden-Nr.');
    expect(zusammenfassung({ typ: 'anschrift_meta', reihenfolge: 'datum', nr_label: '<b>Rechnung</b>', datumsformat: 'lang' })).toBe(
      'Empfänger · Datum · Rechnung · Leistungsdatum · Kunden-Nr. · Datum ausgeschrieben',
    );
  });

  it('Reihenfolge zählt nicht als Text (Pflichtangaben-Check, Platzhalter)', () => {
    expect(meta().texte()).not.toContain(META_REIHENFOLGE);
  });
});

describe('Belegdaten: Pflichtangaben-Check', () => {
  const mitMeta = (b: Partial<Baustein>) => standardVorlage('rechnung').map((x) => (x.typ === 'anschrift_meta' ? { ...x, ...b } : x));
  const punkt = (v: Baustein[], label: string) => pflichtCheck(rechnung(), v).find((p) => p.label === label)!;

  it('Reihenfolge und Beschriftung ändern nichts: Nummer, Datum und Leistungsdatum gelten als gedruckt', () => {
    const v = mitMeta({ reihenfolge: 'leistung,datum,nr', nr_label: 'Rechnungsnummer', datum_label: 'Rechnungsdatum', datumsformat: 'lang' });
    expect(punkt(v, 'Fortlaufende Nummer').ok).toBe(true);
    expect(punkt(v, 'Ausstellungsdatum').ok).toBe(true);
    expect(punkt(v, 'Leistungsdatum / -zeitraum').ok).toBe(true);
  });

  it('abgeschaltet ⇒ fehlt (sofern nicht anderswo gedruckt)', () => {
    const ohne = mitMeta({ nr: false, leistung: false }).map((x) => (x.typ === 'titel' ? { ...x, text: '{art}' } : x));
    expect(punkt(ohne, 'Fortlaufende Nummer').ok).toBe(false);
    expect(punkt(ohne, 'Leistungsdatum / -zeitraum').ok).toBe(false);
  });
});

describe('Kopf mit Logo: Lage und Höhe', () => {
  it('Standard = bisher (rechts, A4 16 mm, A5 10 mm), Grenzen 8 bis 40 mm', () => {
    const k = aufloesen({ typ: 'kopf' });
    expect(logoPosition(k.text('logopos'))).toBe('rechts');
    expect(logoHoeheMm(k.text('logogroesse'), true)).toBe(16);
    expect(logoHoeheMm(k.text('logogroesse'), false)).toBe(10);
    expect(logoHoeheMm('25', false)).toBe(25);
    expect(logoHoeheMm('2', true)).toBe(8);
    expect(logoHoeheMm('99', true)).toBe(40);
    expect(logoHoeheMm('', true)).toBe(16);
    expect(logoPosition('mitte')).toBe('mitte');
    expect(logoPosition('oben')).toBe('rechts');
  });

  it('falscher Typ in alten Daten ⇒ Standard', () => {
    const k = aufloesen({ typ: 'kopf', logopos: true, logogroesse: false });
    expect(k.text('logopos')).toBe('rechts');
    expect(k.text('logogroesse')).toBe('standard');
  });
});
