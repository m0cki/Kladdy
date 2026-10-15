import { describe, expect, it } from 'vitest';
import {
  BELEG_ENDUNGEN,
  DIALOG_FILTER,
  abgelehntText,
  angehaengtText,
  belegZusatz,
  belegeAnzahl,
  belegeZusammenfuehren,
  dateiArt,
  dateiName,
  doppeltText,
  endung,
  erlaubteEndung,
  groesseText,
  pruefungAuswerten,
  zeitpunktDatum,
  type BelegPruefung,
  type VorgemerkterBeleg,
} from './belege';

const beleg = (pfad: string, sha256: string | null = null): VorgemerkterBeleg => ({ pfad, name: dateiName(pfad), groesse: 1000, mime: 'application/pdf', sha256, doppelt: [] });

describe('Dateinamen und Endungen', () => {
  it('nimmt den letzten Pfadteil', () => {
    expect(dateiName('/Users/x/Downloads/Bon 4711.PDF')).toBe('Bon 4711.PDF');
    expect(dateiName('C:\\a\\b.jpg')).toBe('b.jpg');
  });
  it('liest die Endung klein und ohne Punkt', () => {
    expect(endung('/a/Rechnung.PDF')).toBe('pdf');
    expect(endung('/a/.versteckt')).toBe('');
    expect(endung('/a/ohne')).toBe('');
    expect(endung('/a/x.tar.gz')).toBe('gz');
  });
  it('prüft erlaubte Endungen wie Rust', () => {
    for (const e of ['pdf', 'PNG', 'jpg', 'jpeg', 'heic', 'heif', 'webp', 'tif', 'tiff', 'xml']) expect(erlaubteEndung(`/a/b.${e}`)).toBe(true);
    expect(erlaubteEndung('/a/b.docx')).toBe(false);
    expect(erlaubteEndung('/a/b')).toBe(false);
  });
  it('Dialog-Filter: alle erlaubten Endungen ohne Punkt, deutscher Name', () => {
    expect(DIALOG_FILTER.extensions).toEqual([...BELEG_ENDUNGEN]);
    expect(DIALOG_FILTER.extensions.every((e) => !e.startsWith('.'))).toBe(true);
    expect(DIALOG_FILTER.name).toMatch(/^Belege/);
  });
});

describe('groesseText', () => {
  it('formatiert de-DE', () => {
    expect(groesseText(512)).toBe('512 Byte');
    expect(groesseText(1024)).toBe('1 KB');
    expect(groesseText(340 * 1024)).toBe('340 KB');
    expect(groesseText(Math.round(1.24 * 1024 * 1024))).toBe('1,2 MB');
    expect(groesseText(50 * 1024 * 1024)).toBe('50 MB');
  });
  it('leer bei fehlender Größe', () => {
    expect(groesseText(null)).toBe('');
    expect(groesseText(-1)).toBe('');
  });
});

describe('dateiArt', () => {
  it('nach MIME, sonst nach Endung', () => {
    expect(dateiArt('x', 'application/pdf')).toBe('pdf');
    expect(dateiArt('x', 'image/heic')).toBe('bild');
    expect(dateiArt('x', 'application/xml')).toBe('xml');
    expect(dateiArt('foto.JPG', null)).toBe('bild');
    expect(dateiArt('re.xml', '')).toBe('xml');
    expect(dateiArt('a.bin', null)).toBe('datei');
  });
});

describe('pruefungAuswerten', () => {
  const r = (pfad: string, fehler: string | null = null): BelegPruefung => ({
    pfad,
    name: dateiName(pfad),
    groesse: 10,
    mime: 'application/pdf',
    sha256: fehler ? null : `h-${pfad}`,
    fehler,
    doppelt: [],
  });
  it('teilt in gültig und abgelehnt, Reihenfolge bleibt', () => {
    const a = pruefungAuswerten([r('/a.pdf'), r('/b.docx', 'Dateityp nicht erlaubt'), r('/c.pdf')]);
    expect(a.gueltig.map((b) => b.pfad)).toEqual(['/a.pdf', '/c.pdf']);
    expect(a.abgelehnt).toEqual([{ name: 'b.docx', fehler: 'Dateityp nicht erlaubt' }]);
  });
});

describe('belegeZusammenfuehren', () => {
  it('hängt an und überspringt gleiche Pfade und gleichen Inhalt', () => {
    const alt = [beleg('/a.pdf', 'h1')];
    const neu = [beleg('/a.pdf', 'h1'), beleg('/kopie.pdf', 'h1'), beleg('/b.pdf', 'h2'), beleg('/b.pdf', 'h2'), beleg('/c.pdf')];
    expect(belegeZusammenfuehren(alt, neu).map((b) => b.pfad)).toEqual(['/a.pdf', '/b.pdf', '/c.pdf']);
  });
  it('ändert die alte Liste nicht', () => {
    const alt = [beleg('/a.pdf')];
    belegeZusammenfuehren(alt, [beleg('/b.pdf')]);
    expect(alt).toHaveLength(1);
  });
});

describe('Texte', () => {
  it('abgelehntText: einer bzw. mehrere in einem Toast', () => {
    expect(abgelehntText([])).toBeNull();
    expect(abgelehntText([{ name: 'a.docx', fehler: 'Dateityp nicht erlaubt' }])).toBe('„a.docx“ nicht übernommen: Dateityp nicht erlaubt');
    expect(
      abgelehntText([
        { name: 'a.docx', fehler: 'Dateityp nicht erlaubt' },
        { name: 'b.pdf', fehler: 'größer als 50 MB' },
      ]),
    ).toBe('2 Dateien nicht übernommen: „a.docx“ (Dateityp nicht erlaubt) · „b.pdf“ (größer als 50 MB)');
  });
  it('doppeltText', () => {
    const d = (nummer: string, storniert = false) => ({ buchung_id: 1, nummer, zahlungsdatum: '2026-09-03', storniert });
    expect(doppeltText([])).toBeNull();
    expect(doppeltText([d('2026-0012')])).toBe('Schon abgelegt bei Buchung 2026-0012 (03.09.2026)');
    expect(doppeltText([d('2026-0012', true)])).toBe('Schon abgelegt bei Buchung 2026-0012 (03.09.2026, storniert)');
    expect(doppeltText([d('2026-0012'), d('2026-0013')])).toBe('Schon abgelegt bei den Buchungen 2026-0012 (03.09.2026) und 2026-0013 (03.09.2026)');
    expect(doppeltText([d('2026-0012'), d('2026-0013'), d('2026-0014')])).toBe('Schon abgelegt bei Buchung 2026-0012 (03.09.2026) und 2 weiteren');
  });
  it('Toast-Zusätze', () => {
    expect(belegeAnzahl(1)).toBe('1 Beleg');
    expect(belegeAnzahl(3)).toBe('3 Belege');
    expect(belegZusatz(0)).toBe('');
    expect(belegZusatz(undefined)).toBe('');
    expect(belegZusatz(1)).toBe(' · 1 Beleg abgelegt');
    expect(`Ausgabe gespeichert · 2026-0003${belegZusatz(2)}`).toBe('Ausgabe gespeichert · 2026-0003 · 2 Belege abgelegt');
    expect(angehaengtText(1, 'Ausgabe 2026-0003')).toBe('1 Beleg an Ausgabe 2026-0003 angehängt');
  });
  it('zeitpunktDatum', () => {
    expect(zeitpunktDatum('2026-09-03T12:00:00Z')).toBe('03.09.2026');
    expect(zeitpunktDatum('kaputt')).toBe('');
  });
});
