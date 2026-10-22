import { describe, expect, it } from 'vitest';
import { objektstroemeAnhaengen, verdaechtig } from './pdfreparatur';

/** Zeichen 0–255 ⇒ Bytes (wie in der PDF-Datei) und zurück */
const bytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
const text = (u8: Uint8Array): string => Array.from(u8, (b) => String.fromCharCode(b)).join('');

async function packen(roh: string): Promise<string> {
  const strom = new Blob([new Uint8Array(bytes(roh))]).stream().pipeThrough(new CompressionStream('deflate'));
  return text(new Uint8Array(await new Response(strom).arrayBuffer()));
}

/** Kleine PDF: Seite verweist auf Schrift 4 0 R, die nur im Objekt-Stream 10 liegt; die Tabelle führt 4 und 5 als frei. */
async function pdfMitObjektStrom(gepackt: boolean): Promise<string> {
  const objekte: [number, string][] = [
    [4, '<< /Type /Font /Subtype /Type0 /BaseFont /TestSans /Encoding /Identity-H /DescendantFonts [5 0 R] >>'],
    [5, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /TestSans >>'],
  ];
  let off = 0;
  const paare: string[] = [];
  for (const [nr, inhalt] of objekte) {
    paare.push(`${nr} ${off}`);
    off += inhalt.length + 1;
  }
  const kopf = `${paare.join(' ')} `;
  const roh = kopf + objekte.map(([, inhalt]) => inhalt).join('\n');
  const daten = gepackt ? await packen(roh) : roh;
  const filter = gepackt ? ' /Filter /FlateDecode' : '';
  let s = '%PDF-1.5\n';
  s += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  s += '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  s += '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /T1 4 0 R >> >> >>\nendobj\n';
  s += '9 0 obj\n' + String(daten.length) + '\nendobj\n';
  s += `10 0 obj\n<< /Type /ObjStm /N 2 /First ${kopf.length} /Length 9 0 R${filter} >>\nstream\n${daten}\nendstream\nendobj\n`;
  const xref = s.length;
  s += 'xref\n0 11\n0000000000 65535 f \n';
  s += 'trailer\n<< /Size 11 /Root 1 0 R >>\nstartxref\n' + String(xref) + '\n%%EOF\n';
  return s;
}

/** Anfang des Objekts an der Stelle, die die neue (letzte) Querverweistabelle nennt */
function objektLaut(neu: string, nr: number): string {
  const m = new RegExp(`\\n${nr} 1\\n(\\d{10}) 00000 n \\n`).exec(neu.slice(neu.lastIndexOf('\nxref\n')));
  return m ? neu.slice(Number(m[1]), Number(m[1]) + 80) : '';
}

describe('verdaechtig', () => {
  it('viele Steuerzeichen (Schrift nicht geladen) ⇒ ja, normaler Text ⇒ nein', () => {
    expect(verdaechtig(['\u0002T\u0002e\u0002l\u0002e\u0002k\u0002o\u0002m'])).toBe(true);
    expect(verdaechtig(['Telekom Deutschland GmbH', 'Rechnungsbetrag  39,95 €'])).toBe(false);
    expect(verdaechtig(['Text\u0002 mit einem Ausreißer'])).toBe(false);
    expect(verdaechtig([])).toBe(false);
  });
});

describe('objektstroemeAnhaengen', () => {
  it('hängt die Objekte aus dem Objekt-Stream als inkrementelle Aktualisierung an (ungepackt)', async () => {
    const alt = await pdfMitObjektStrom(false);
    const neu = await objektstroemeAnhaengen(bytes(alt));
    expect(neu).not.toBeNull();
    const s = text(neu ?? new Uint8Array());
    expect(s.startsWith(alt)).toBe(true); // Original unverändert davor
    expect(objektLaut(s, 4)).toMatch(/^4 0 obj\n<< \/Type \/Font \/Subtype \/Type0/);
    expect(objektLaut(s, 5)).toMatch(/^5 0 obj\n<< \/Type \/Font \/Subtype \/CIDFontType2/);
    expect(s).toContain(`trailer\n<< /Size 11 /Root 1 0 R /Prev ${alt.indexOf('xref\n0 11')} >>`);
    expect(s.endsWith('%%EOF\n')).toBe(true);
    // startxref zeigt auf die neue Tabelle
    const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)?.[1]);
    expect(s.slice(start, start + 4)).toBe('xref');
  });

  it('entpackt FlateDecode', async () => {
    const neu = await objektstroemeAnhaengen(bytes(await pdfMitObjektStrom(true)));
    expect(objektLaut(text(neu ?? new Uint8Array()), 4)).toMatch(/^4 0 obj\n<< \/Type \/Font/);
  });

  it('ohne Objekt-Stream oder bei schon vorhandenen Objekten ⇒ null', async () => {
    expect(await objektstroemeAnhaengen(bytes('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\nstartxref\n9\n%%EOF\n'))).toBeNull();
    const mitObjekten = (await pdfMitObjektStrom(false)).replace('9 0 obj', '4 0 obj\n<< >>\nendobj\n5 0 obj\n<< >>\nendobj\n9 0 obj');
    expect(await objektstroemeAnhaengen(bytes(mitObjekten))).toBeNull();
  });

  it('kaputter Stream ⇒ null statt Fehler', async () => {
    const kaputt = (await pdfMitObjektStrom(true)).replace('/Length 9 0 R', '/Length 5');
    expect(await objektstroemeAnhaengen(bytes(kaputt))).toBeNull();
  });

  it('Beispielbeleg Rechnung_Telekom.pdf: Schrift 4–6 liegt nur im Objekt-Stream', async () => {
    // Datei lesen ohne @types/node (Node ≥ 22: process.getBuiltinModule)
    const fs = (globalThis as unknown as { process: { getBuiltinModule(id: string): { readFileSync(p: URL): Uint8Array } } }).process.getBuiltinModule('node:fs');
    const daten = new Uint8Array(fs.readFileSync(new URL('../../../referenz/beispiel-belege/Rechnung_Telekom.pdf', import.meta.url)));
    const s = text((await objektstroemeAnhaengen(daten)) ?? new Uint8Array());
    expect(objektLaut(s, 4)).toMatch(/^4 0 obj\n<< \/Type \/Font \/Subtype \/Type0/);
    expect(objektLaut(s, 5)).toMatch(/^5 0 obj\n<< \/Type \/Font \/Subtype \/CIDFontType2/);
    expect(objektLaut(s, 6)).toMatch(/^6 0 obj\n<< \/Type \/FontDescriptor/);
  });
});
