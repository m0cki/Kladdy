/* Ende-zu-Ende mit echtem pdf.js (Legacy-Build läuft in Node ohne Worker und ohne Canvas – nur Warnungen auf der
 * Konsole): Text der Beispielbelege aus referenz/beispiel-belege ⇒ Zeilen ⇒ Erkennung. Rechnung_Telekom.pdf braucht
 * dabei den Rettungsweg aus pdfreparatur.ts (Schrift liegt nur im Objekt-Stream). */
import { describe, expect, it } from 'vitest';
import { textAusPdf } from './pdftext';
import { erkenne, type ErkennungKontext } from './regeln';

// Dateien lesen ohne @types/node (Node ≥ 22: process.getBuiltinModule)
const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): { readFileSync(p: URL): Uint8Array } } }).process.getBuiltinModule('node:fs');
const beleg = (name: string): Uint8Array => new Uint8Array(fs.readFileSync(new URL(`../../../referenz/beispiel-belege/${name}`, import.meta.url)));

const KONTEXT: ErkennungKontext = { heute: '2026-10-22', kategorien: [], geschaefte: [], firma: null };

async function erkennen(name: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const zeilen = await textAusPdf(pdfjs, beleg(name));
  return { zeilen, e: erkenne({ text: zeilen.join('\n'), dateiname: name, kontext: KONTEXT }) };
}

describe('Beispielbelege mit pdf.js', () => {
  it('Kassenbon_Bauhaus.pdf (Courier, Wort für Wort gesetzt)', async () => {
    const { zeilen, e } = await erkennen('Kassenbon_Bauhaus.pdf');
    expect(zeilen).toContain('Summe EUR  47,83');
    expect(e.felder).toMatchObject({ betrag_cent: 4783, zahlungsdatum: '2026-09-14', belegnummer: '4711', lieferant: 'Bauhaus' });
  }, 30_000);

  it('Kassenbon_Gartencenter.pdf (Überschrift auf zwei Zeilen)', async () => {
    const { e } = await erkennen('Kassenbon_Gartencenter.pdf');
    expect(e.felder).toMatchObject({ betrag_cent: 5643, zahlungsdatum: '2026-10-05', belegnummer: '0042-118', lieferant: 'Gartencenter Blütenreich GmbH' });
  }, 30_000);

  it('Tankquittung_Aral.pdf (gesperrte Summe)', async () => {
    const { e } = await erkennen('Tankquittung_Aral.pdf');
    expect(e.felder).toMatchObject({ betrag_cent: 7895, zahlungsdatum: '2026-10-07', belegnummer: '5528', lieferant: 'Aral' });
  }, 30_000);

  it('Rechnung_Telekom.pdf (Lastschrift; Schrift nur im Objekt-Stream ⇒ reparierte Kopie)', async () => {
    const { zeilen, e } = await erkennen('Rechnung_Telekom.pdf');
    expect(zeilen[0]).toBe('Telekom Deutschland GmbH');
    expect(e.felder).toMatchObject({
      betrag_cent: 3995,
      zahlungsdatum: '2026-10-20',
      belegdatum: '2026-10-05',
      belegnummer: '710023456789',
      lieferant: 'Telekom Deutschland GmbH',
    });
  }, 30_000);
});
