import { describe, expect, it } from 'vitest';
import { ART_TEXT, anzahlText, groesseText, inhaltText, wiederhergestelltText, zeitpunktText } from './sicherungen';

describe('Sicherungen: Anzeige', () => {
  it('Größe wie im Finder, deutsches Komma', () => {
    expect(groesseText(0)).toBe('0 Byte');
    expect(groesseText(830)).toBe('830 Byte');
    expect(groesseText(12_345)).toBe('12,3 KB');
    expect(groesseText(4_500_000)).toBe('4,5 MB');
    expect(groesseText(2_000_000_000)).toBe('2,0 GB');
    expect(groesseText(Number.NaN)).toBe('0 Byte');
  });

  it('Zeitpunkt in Ortszeit, Ungültiges unverändert', () => {
    const iso = '2026-10-13T22:15:00Z';
    const d = new Date(iso);
    const zwei = (n: number) => String(n).padStart(2, '0');
    expect(zeitpunktText(iso)).toBe(
      `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.${d.getFullYear()}, ${zwei(d.getHours())}:${zwei(d.getMinutes())}`,
    );
    expect(zeitpunktText('kaputt')).toBe('kaputt');
  });

  it('Anzahlen mit Tausenderpunkt, fehlende als Strich', () => {
    expect(anzahlText(null)).toBe('—');
    expect(anzahlText(1234)).toBe('1.234');
    expect(inhaltText({ buchungen: 1, rechnungen: 12, kunden: null })).toBe('1 Buchung, 12 Belege, — Kunden');
  });

  it('jede Art hat einen Namen', () => {
    for (const art of ['automatisch', 'manuell', 'vor-update', 'vor-migration', 'vor-wiederherstellung'] as const) {
      expect(ART_TEXT[art].length).toBeGreaterThan(0);
    }
  });

  it('Meldung nach dem Wiederherstellen', () => {
    const iso = '2026-10-13T22:15:00Z';
    expect(wiederhergestelltText({ zeitpunkt: iso, vorher: null })).toBe(`Sicherung vom ${zeitpunktText(iso)} wiederhergestellt.`);
    expect(wiederhergestelltText({ zeitpunkt: iso, vorher: '/x/vor-wiederherstellung/k.db' })).toContain('Stand davor ist gesichert');
  });
});
