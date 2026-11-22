import { describe, expect, it } from 'vitest';
import { aufzaehlen, loeschHinweise, loeschToast, loeschZusammenfassung, vielleichtLoeschbar, type LoeschZiel } from './loeschen';
import type { Loeschbarkeit } from './queries/buchungen';

const NBSP = ' ';

const ausgabe: LoeschZiel = {
  id: 7,
  nummer: '2026-0007',
  typ: 'ausgabe',
  zahlungsdatum: '2026-10-14',
  betrag_cent: 4783,
  beschreibung: 'Diesel  ',
};

const l = (teil: Partial<Loeschbarkeit> = {}): Loeschbarkeit => ({
  loeschbar: true,
  grund: null,
  nummern: ['2026-0007'],
  storno_paar: false,
  dateien: 0,
  entwuerfe: 0,
  termin: false,
  ...teil,
});

describe('aufzaehlen', () => {
  it('verbindet mit Komma und „und“', () => {
    expect(aufzaehlen([])).toBe('');
    expect(aufzaehlen(['a'])).toBe('a');
    expect(aufzaehlen(['a', 'b'])).toBe('a und b');
    expect(aufzaehlen(['a', 'b', 'c'])).toBe('a, b und c');
  });
});

describe('loeschZusammenfassung', () => {
  it('Ausgabe: Datum de-DE, Betrag mit echtem Minus, Beschreibung getrimmt', () => {
    expect(loeschZusammenfassung(ausgabe)).toEqual([
      { label: 'Nr.', wert: '2026-0007' },
      { label: 'Datum', wert: '14.10.2026' },
      { label: 'Betrag', wert: `−47,83${NBSP}€ · Ausgabe` },
      { label: 'Beschreibung', wert: 'Diesel' },
    ]);
  });

  it('Einnahme mit Plus, leere Beschreibung als Strich', () => {
    const z = loeschZusammenfassung({ ...ausgabe, typ: 'einnahme', betrag_cent: 120000, beschreibung: ' ' });
    expect(z[2].wert).toBe(`+1.200,00${NBSP}€ · Einnahme`);
    expect(z[2].wert).not.toContain('-');
    expect(z[3].wert).toBe('–');
  });
});

describe('loeschHinweise', () => {
  it('einfacher Fall: Nummer bleibt vergeben, Protokoll', () => {
    expect(loeschHinweise(l())).toEqual(['Die Nummer 2026-0007 wird nicht neu vergeben.', 'Das Löschen steht mit allen Angaben im Protokoll.']);
  });

  it('Storno-Paar, Dateien, Entwurf, Termin und ungespeicherte Eingaben', () => {
    const h = loeschHinweise(l({ nummern: ['2026-0007', '2026-0009'], storno_paar: true, dateien: 2, entwuerfe: 1, termin: true }), {
      ungespeichert: true,
    });
    expect(h).toEqual([
      'Die Buchung und ihre Storno-Buchung werden gelöscht (2026-0007 und 2026-0009).',
      'Die 2 angehängten Dateien bleiben in der Belegablage, nur die Verknüpfung wird gelöst.',
      'Die Nummern 2026-0007 und 2026-0009 werden nicht neu vergeben.',
      'Der Beleg-Entwurf zu dieser Zahlung bleibt, nur ohne Verknüpfung.',
      'Der Termin dazu bleibt erledigt.',
      'Das Löschen steht mit allen Angaben im Protokoll.',
      'Ungespeicherte Änderungen gehen verloren.',
    ]);
  });

  it('eine Datei, mehrere Entwürfe', () => {
    const h = loeschHinweise(l({ dateien: 1, entwuerfe: 3 }));
    expect(h).toContain('Die angehängte Datei bleibt in der Belegablage, nur die Verknüpfung wird gelöst.');
    expect(h).toContain('Die 3 Beleg-Entwürfe zu dieser Zahlung bleiben, nur ohne Verknüpfung.');
    expect(h.some((x) => x.includes('Storno'))).toBe(false);
    expect(h.some((x) => x.includes('Ungespeichert'))).toBe(false);
  });
});

describe('loeschToast', () => {
  it('ohne Rückgängig, mit Nummer(n)', () => {
    expect(loeschToast({ nummern: ['2026-0007'] })).toBe('Buchung 2026-0007 gelöscht');
    expect(loeschToast({ nummern: ['2026-0007', '2026-0009'] })).toBe('Buchung 2026-0007 und Storno-Buchung 2026-0009 gelöscht');
  });
});

describe('vielleichtLoeschbar', () => {
  it('nur Zahlungen, nicht festgeschrieben, ohne eigenen Beleg', () => {
    const b = { art: 'zahlung' as const, festgeschrieben: 0, rechnung_id: null };
    expect(vielleichtLoeschbar(b)).toBe(true);
    expect(vielleichtLoeschbar({ ...b, festgeschrieben: 1 })).toBe(false);
    expect(vielleichtLoeschbar({ ...b, rechnung_id: 3 })).toBe(false);
    expect(vielleichtLoeschbar({ ...b, art: 'afa' })).toBe(false);
  });
});
