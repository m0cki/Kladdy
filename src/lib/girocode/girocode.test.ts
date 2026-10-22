import { describe, expect, it } from 'vitest';
import { leereFirma } from '../firma';
import { BEISPIEL_FIRMA, testbeleg } from '../vorlagen/beispiel';
import type { BelegDokument } from '../vorlagen/dokument';
import { standardVorlage } from '../vorlagen/standard';
import { EPC_MAX_BYTE, epcBetrag, epcPayload, type EpcDaten } from './epc';
import {
  GIROCODE_DATEI,
  epcFuer,
  girocodeDatei,
  girocodeFuer,
  girocodeMoeglich,
  girocodePng,
  qrGroesseMm,
  vorlageZeigtGirocode,
} from './girocode';

const rechnung = (): BelegDokument => testbeleg('rechnung', BEISPIEL_FIRMA, 'klein', '2026-10-18');
const quittung = (): BelegDokument => testbeleg('quittung', BEISPIEL_FIRMA, 'klein', '2026-10-18');

/** Beispiel aus ANLEITUNG §7.4 (153,00 €, RE-2026-014) */
const BEISPIEL: EpcDaten = {
  name: 'Mustermann Haus- & Gartenservice',
  iban: 'DE89 3704 0044 0532 0130 00',
  bic: 'COBADEFFXXX',
  betrag_cent: 15300,
  zweck: 'RE-2026-014',
};

const payload = (d: EpcDaten): string => {
  const r = epcPayload(d);
  if (!r.ok) throw new Error(r.fehler.join(' '));
  return r.payload;
};
const fehler = (d: EpcDaten): string[] => {
  const r = epcPayload(d);
  return r.ok ? [] : r.fehler;
};

describe('EPC069-12 Version 002', () => {
  it('Beispiel aus §7.4 genau', () => {
    expect(payload(BEISPIEL)).toBe(
      'BCD\n002\n1\nSCT\nCOBADEFFXXX\nMustermann Haus- & Gartenservice\nDE89370400440532013000\nEUR153.00\n\n\nRE-2026-014',
    );
  });

  it('Betrag aus Cent ohne Float', () => {
    expect(epcBetrag(15300)).toBe('EUR153.00');
    expect(epcBetrag(1)).toBe('EUR0.01');
    expect(epcBetrag(1050)).toBe('EUR10.50');
    expect(epcBetrag(16298)).toBe('EUR162.98');
    expect(epcBetrag(99_999_999_999)).toBe('EUR999999999.99');
  });

  it('BIC ist optional (leere Zeile), IBAN kompakt und groß', () => {
    const z = payload({ ...BEISPIEL, bic: '', iban: 'de89 3704 0044 0532 0130 00' }).split('\n');
    expect(z[4]).toBe('');
    expect(z[6]).toBe('DE89370400440532013000');
    expect(payload({ ...BEISPIEL, bic: 'cobadeff' }).split('\n')[4]).toBe('COBADEFF');
  });

  it('ohne Verwendungszweck fallen die leeren Zeilen am Ende weg', () => {
    expect(payload({ ...BEISPIEL, zweck: '' })).toBe('BCD\n002\n1\nSCT\nCOBADEFFXXX\nMustermann Haus- & Gartenservice\nDE89370400440532013000\nEUR153.00');
  });

  it('Umbrüche in Name und Zweck schieben keine Zeile ein', () => {
    const z = payload({ ...BEISPIEL, name: '  Müller\n& Söhne\r\n100% ', zweck: 'RE-1\nEUR999.00' }).split('\n');
    expect(z).toHaveLength(11);
    expect(z[5]).toBe('Müller & Söhne 100%');
    expect(z[7]).toBe('EUR153.00');
    expect(z[10]).toBe('RE-1 EUR999.00');
  });

  it('fehlende Angaben', () => {
    expect(fehler({ ...BEISPIEL, name: ' ' })).toEqual(['Der Name des Zahlungsempfängers fehlt (Einstellungen › Firma).']);
    expect(fehler({ ...BEISPIEL, iban: '' })).toEqual(['Die IBAN fehlt (Einstellungen › Firma).']);
    expect(fehler({ ...BEISPIEL, name: '', iban: '' })).toHaveLength(2);
  });

  it('IBAN-Prüfsumme (mod 97) und BIC wie in Einstellungen › Firma', () => {
    expect(fehler({ ...BEISPIEL, iban: 'DE89370400440532013001' })[0]).toMatch(/Prüfziffer/);
    expect(fehler({ ...BEISPIEL, iban: 'DE98370400440532013000' })[0]).toMatch(/Prüfziffer/);
    expect(fehler({ ...BEISPIEL, iban: 'DE8937040044053201300' })[0]).toMatch(/22 Zeichen/);
    expect(fehler({ ...BEISPIEL, iban: 'AT611904300234573201' })).toEqual([]);
    expect(fehler({ ...BEISPIEL, bic: 'COBADEF' })[0]).toMatch(/8 oder 11/);
  });

  it('Betrag 0,01 € bis 999.999.999,99 €, nur ganze Cent', () => {
    expect(fehler({ ...BEISPIEL, betrag_cent: 1 })).toEqual([]);
    expect(fehler({ ...BEISPIEL, betrag_cent: 99_999_999_999 })).toEqual([]);
    expect(fehler({ ...BEISPIEL, betrag_cent: 0 })[0]).toMatch(/0,00 €/);
    for (const cent of [-500, 100_000_000_000, 12.5, Number.NaN]) {
      expect(fehler({ ...BEISPIEL, betrag_cent: cent }), String(cent)).toEqual(['Der Betrag muss zwischen 0,01 € und 999.999.999,99 € liegen.']);
    }
  });

  it('Längen: Name 70 Zeichen, Verwendungszweck 140 Zeichen (Umlaute zählen einfach)', () => {
    expect(fehler({ ...BEISPIEL, name: 'ü'.repeat(70) })).toEqual([]);
    expect(fehler({ ...BEISPIEL, name: 'ü'.repeat(71) })[0]).toMatch(/70 Zeichen/);
    expect(fehler({ ...BEISPIEL, zweck: 'x'.repeat(140) })).toEqual([]);
    expect(fehler({ ...BEISPIEL, zweck: 'x'.repeat(141) })[0]).toMatch(/140 Zeichen/);
  });

  it('höchstens 331 Byte (UTF-8)', () => {
    const basis: EpcDaten = { name: 'ä'.repeat(70), iban: 'DE89370400440532013000', betrag_cent: 100, zweck: '' };
    // 189 Byte ohne Zweck (Name 140 Byte), Zweck je 140 Zeichen
    const genau = { ...basis, zweck: 'x'.repeat(138) + 'ää' };
    expect(new TextEncoder().encode(payload(genau)).length).toBe(EPC_MAX_BYTE);
    const zuViel = { ...basis, zweck: 'x'.repeat(137) + 'äää' };
    expect(fehler(zuViel)).toEqual(['Der GiroCode wird zu lang (höchstens 331 Byte) – Name oder Verwendungszweck kürzen.']);
  });
});

describe('GiroCode für einen Beleg', () => {
  it('Firma aus dem Schnappschuss, Gesamtbetrag, Entwurf ohne Nummer', () => {
    const r = epcFuer(rechnung());
    expect(r.ok && r.payload.split('\n')).toEqual([
      'BCD',
      '002',
      '1',
      'SCT',
      'COBADEFFXXX',
      'Mustermann Haus- & Gartenservice',
      'DE89370400440532013000',
      'EUR162.98',
      '',
      '',
      'Entwurf',
    ]);
    const mitNr = epcFuer({ ...rechnung(), nummer: 'RE-2026-014' });
    expect(mitNr.ok && mitNr.payload.endsWith('\nRE-2026-014')).toBe(true);
  });

  it('ohne Firmennamen der Inhaber', () => {
    const r = epcFuer({ ...rechnung(), firma: { ...BEISPIEL_FIRMA, name: '' } });
    expect(r.ok && r.payload.split('\n')[5]).toBe(BEISPIEL_FIRMA.inhaber);
  });

  it('Matrix, SVG und Payload; Fehler nur als Liste', () => {
    const g = girocodeFuer(rechnung());
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.payload).toContain('EUR162.98');
    expect((g.matrix.length - 17) % 4).toBe(0);
    expect(g.svg.startsWith('<svg')).toBe(true);
    expect(g.svg).toContain('shape-rendering="crispEdges"');
    // gleicher Inhalt ⇒ gemerktes Ergebnis
    expect(girocodeFuer(rechnung())).toBe(g);

    const leer = girocodeFuer({ ...rechnung(), firma: leereFirma() });
    expect(leer).toEqual({
      ok: false,
      fehler: ['Der Name des Zahlungsempfängers fehlt (Einstellungen › Firma).', 'Die IBAN fehlt (Einstellungen › Firma).'],
    });
    const ohnePos = girocodeFuer({ ...rechnung(), positionen: [] });
    expect(ohnePos.ok).toBe(false);
  });

  it('nur auf offenen Rechnungen', () => {
    expect(girocodeMoeglich(rechnung())).toBe(true);
    expect(girocodeMoeglich(quittung())).toBe(false);
    expect(girocodeMoeglich({ ...rechnung(), art: 'angebot' })).toBe(false);
    expect(girocodeMoeglich({ ...rechnung(), quittiert: { am: '2026-10-18', zahlungsweg: 'bar' } })).toBe(false);
  });

  it('\\GiroCode-Datei und PNG unter derselben Bedingung', () => {
    const faelle: [BelegDokument, boolean][] = [
      [rechnung(), true],
      [quittung(), false],
      [{ ...rechnung(), quittiert: { am: '2026-10-18', zahlungsweg: 'bank' } }, false],
      [{ ...rechnung(), firma: { ...BEISPIEL_FIRMA, iban: 'DE00370400440532013000' } }, false],
    ];
    for (const [doc, soll] of faelle) {
      expect(girocodeDatei(doc)).toBe(soll ? GIROCODE_DATEI : '');
      const png = girocodePng(doc);
      expect(png !== null).toBe(soll);
      if (png) expect(Array.from(png.subarray(0, 4))).toEqual([137, 80, 78, 71]);
    }
  });

  it('Vorlage zeigt den GiroCode nur mit sichtbarem Baustein „Zahlung“ und Einstellung qr', () => {
    expect(vorlageZeigtGirocode(standardVorlage('rechnung'))).toBe(true);
    expect(vorlageZeigtGirocode(standardVorlage('quittung'))).toBe(false);
    expect(vorlageZeigtGirocode([{ typ: 'zahlung', qr: false }])).toBe(false);
    expect(vorlageZeigtGirocode([{ typ: 'zahlung', aus: true }])).toBe(false);
    expect(vorlageZeigtGirocode([{ typ: 'zahlung' }])).toBe(true); // Standard: an
  });

  it('Größe in mm: 18–45, sonst 28 – nie fremder Text', () => {
    expect(qrGroesseMm('24')).toBe(24);
    expect(qrGroesseMm('34')).toBe(34);
    expect(qrGroesseMm('')).toBe(28);
    expect(qrGroesseMm('groß')).toBe(28);
    expect(qrGroesseMm('28mm]{/etc/passwd}')).toBe(28);
    expect(qrGroesseMm('5')).toBe(18);
    expect(qrGroesseMm('100')).toBe(45);
    expect(qrGroesseMm('30.4')).toBe(30);
  });
});
