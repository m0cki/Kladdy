import { describe, expect, it } from 'vitest';
import { aenderungen, protokollSql } from './protokoll';

const ZEIT = '2026-10-13T20:15:00Z';

describe('protokollSql', () => {
  it('neuer Datensatz: nur neu', () => {
    const { sql, werte } = protokollSql({
      tabelle: 'buchungen',
      datensatzId: 7,
      aktion: 'neu',
      neu: { betrag_cent: 1999, beschreibung: 'Rasen mähen' },
      zeitpunkt: ZEIT,
    });
    expect(sql).toMatch(/^INSERT INTO protokoll \(zeitpunkt, tabelle, datensatz_id, aktion, alt_json, neu_json, schluessel\)/);
    expect(sql).toContain('$7');
    expect(werte).toEqual([ZEIT, 'buchungen', 7, 'neu', null, '{"betrag_cent":1999,"beschreibung":"Rasen mähen"}', null]);
  });

  it('Änderung: alt und neu', () => {
    const { werte } = protokollSql({
      tabelle: 'rechnungen',
      datensatzId: 3,
      aktion: 'geaendert',
      alt: { status: 'offen' },
      neu: { status: 'bezahlt' },
      zeitpunkt: ZEIT,
    });
    expect(werte.slice(3)).toEqual(['geaendert', '{"status":"offen"}', '{"status":"bezahlt"}', null]);
  });

  it('verworfener Entwurf: nur alt', () => {
    const { werte } = protokollSql({ tabelle: 'rechnungen', datensatzId: 9, aktion: 'geloescht_entwurf', alt: { betreff: 'Hecke' } });
    expect(werte[4]).toBe('{"betreff":"Hecke"}');
    expect(werte[5]).toBeNull();
    expect(werte[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/); // Standard: jetzt
  });

  it('Storno braucht mindestens einen Stand', () => {
    expect(protokollSql({ tabelle: 'buchungen', datensatzId: 1, aktion: 'storniert', neu: { storno_id: 2 } }).werte[5]).toBe(
      '{"storno_id":2}',
    );
    expect(() => protokollSql({ tabelle: 'buchungen', datensatzId: 1, aktion: 'storniert' })).toThrow(/storniert/);
  });

  it('lehnt unvollständige Einträge ab', () => {
    expect(() => protokollSql({ tabelle: 'buchungen', datensatzId: 1, aktion: 'neu' })).toThrow(/neu/);
    expect(() => protokollSql({ tabelle: 'buchungen', datensatzId: 1, aktion: 'neu', alt: {}, neu: {} })).toThrow(/neu/);
    expect(() => protokollSql({ tabelle: 'buchungen', datensatzId: 1, aktion: 'geaendert', neu: {} })).toThrow(/geaendert/);
    expect(() => protokollSql({ tabelle: 'rechnungen', datensatzId: 1, aktion: 'geloescht_entwurf', alt: {}, neu: {} })).toThrow(
      /geloescht_entwurf/,
    );
    expect(() => protokollSql({ tabelle: 'buchungen', datensatzId: 0, aktion: 'neu', neu: {} })).toThrow(RangeError);
    expect(() => protokollSql({ tabelle: 'buchungen', datensatzId: 1.5, aktion: 'neu', neu: {} })).toThrow(RangeError);
  });

  it('Stammdaten mit Textschlüssel: datensatz_id 0, Schlüssel in eigener Spalte', () => {
    const { werte } = protokollSql({
      tabelle: 'nummernkreise',
      schluessel: 'rechnung',
      aktion: 'geaendert',
      alt: { muster: 'RE-{JJJJ}-{NNN}' },
      neu: { muster: 'R{JJ}-{NNNN}' },
      zeitpunkt: ZEIT,
    });
    expect(werte).toEqual([ZEIT, 'nummernkreise', 0, 'geaendert', '{"muster":"RE-{JJJJ}-{NNN}"}', '{"muster":"R{JJ}-{NNNN}"}', 'rechnung']);
    expect(protokollSql({ tabelle: 'steuer_parameter', schluessel: '2027', aktion: 'neu', neu: { km_pauschale_cent: 30 } }).werte[6]).toBe('2027');
    expect(() => protokollSql({ tabelle: 'einstellungen', schluessel: ' ', aktion: 'neu', neu: {} })).toThrow(/Schlüssel/);
  });
});

describe('aenderungen', () => {
  it('nur geänderte Felder', () => {
    expect(
      aenderungen(
        { betrag_cent: 1000, beschreibung: 'Hecke', kunde_id: 4 },
        { betrag_cent: 1200, beschreibung: 'Hecke', kunde_id: 4 },
      ),
    ).toEqual({ alt: { betrag_cent: 1000 }, neu: { betrag_cent: 1200 } });
  });

  it('neue und entfernte Felder zählen als geändert, undefined = null', () => {
    expect(aenderungen({ a: 1, b: undefined }, { b: null, c: 'x' })).toEqual({ alt: { a: 1, c: null }, neu: { a: null, c: 'x' } });
  });

  it('vergleicht verschachtelte Werte und meldet „nichts geändert“', () => {
    expect(aenderungen({ extra: { ort: 'A' } }, { extra: { ort: 'A' } })).toBeNull();
    expect(aenderungen({ extra: { ort: 'A' } }, { extra: { ort: 'B' } })).toEqual({
      alt: { extra: { ort: 'A' } },
      neu: { extra: { ort: 'B' } },
    });
  });
});
