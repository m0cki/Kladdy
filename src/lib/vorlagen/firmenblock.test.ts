import { describe, expect, it } from 'vitest';
import { BEISPIEL_FIRMA, testbeleg } from './beispiel';
import { FIRMENBLOCK_ZEILEN } from './bausteine';
import { platzhalterWerte } from './dokument';
import { firmenZeilen, sichtbareZeilen, zeileSichtbar } from './firmenblock';

const werte = (firma = BEISPIEL_FIRMA) => platzhalterWerte(testbeleg('quittung', firma, 'klein', '2026-10-18'));

describe('Firmenkopf: Zeilen mit Platzhaltern', () => {
  it('zerlegt in Zeilen, trimmt, leere fallen weg, Platzhalter je Zeile ohne {nr} und ohne Doppelte', () => {
    expect(firmenZeilen('  {strasse} · {plz} {ort}\r\n\n Fahrzeugaufbereitung \n{ort}, {ort}\nNr. {nr}')).toEqual([
      { text: '{strasse} · {plz} {ort}', platzhalter: ['strasse', 'plz', 'ort'] },
      { text: 'Fahrzeugaufbereitung', platzhalter: [] },
      { text: '{ort}, {ort}', platzhalter: ['ort'] },
      { text: 'Nr. {nr}', platzhalter: [] },
    ]);
    expect(firmenZeilen('')).toEqual([]);
  });

  it('Zeile fällt weg, wenn alle ihre Platzhalter leer sind; Zeilen ohne Platzhalter bleiben', () => {
    const w = { ...werte(), telefon: '', steuernummer: ' ' };
    const sichtbar = sichtbareZeilen(`Inh. {inhaber}\nSteuernr. {steuernummer}\n{telefon}\nTel. {telefon} · {email}\nFester Text`, w).map((z) => z.text);
    expect(sichtbar).toEqual(['Inh. {inhaber}', 'Tel. {telefon} · {email}', 'Fester Text']);
    expect(zeileSichtbar({ text: 'x', platzhalter: [] }, w)).toBe(true);
  });

  it('Standardzeilen mit Beispielfirma ganz, ohne Telefon und Steuernummer ohne diese Zeilen', () => {
    expect(sichtbareZeilen(FIRMENBLOCK_ZEILEN, werte())).toHaveLength(4);
    const ohne = { ...BEISPIEL_FIRMA, telefon: '', steuernummer: '' };
    expect(sichtbareZeilen(FIRMENBLOCK_ZEILEN, werte(ohne)).map((z) => z.text)).toEqual(['{strasse} · {plz} {ort}', '{email}']);
  });
});
