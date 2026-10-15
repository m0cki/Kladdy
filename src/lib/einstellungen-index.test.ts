import { describe, expect, it } from 'vitest';
import { BEREICHE, EINSTELLUNGEN, bereichPfad, isBereichId } from './einstellungen-index';
import { FIRMA_FELDER } from './firma';
import { KREIS_REIHENFOLGE } from './numbering';
import { KENNWERTE } from './steuer-kennwerte';

const ids = EINSTELLUNGEN.map((e) => e.id);

describe('Suchindex der Einstellungen', () => {
  it('hat eindeutige IDs (data-setting im DOM)', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('verweist nur auf vorhandene Bereiche', () => {
    for (const e of EINSTELLUNGEN) expect(isBereichId(e.bereich)).toBe(true);
  });

  it('hat für jeden gebauten Bereich mindestens einen Eintrag', () => {
    for (const b of BEREICHE.filter((x) => !x.phase)) {
      expect(EINSTELLUNGEN.some((e) => e.bereich === b.id)).toBe(true);
    }
  });

  it('Firma: jede firma-<feld>-ID ist ein echtes Feld aus firma.ts', () => {
    const felder = new Set<string>(FIRMA_FELDER);
    const firmaIds = ids.filter((id) => id.startsWith('firma-') && id !== 'firma-pflichtangaben');
    expect(firmaIds.length).toBeGreaterThan(0);
    for (const id of firmaIds) expect(felder.has(id.slice('firma-'.length))).toBe(true);
  });

  it('Steuern: jeder Kennwert und jeder Nummernkreis ist auffindbar', () => {
    for (const k of KENNWERTE) expect(ids).toContain(`kw-${k.schluessel}`);
    for (const id of KREIS_REIHENFOLGE) expect(ids).toContain(`nk-${id}`);
  });

  it('baut den Sprungpfad mit kodiertem Feld', () => {
    expect(bereichPfad('firma', 'firma-iban')).toBe('/einstellungen/firma?feld=firma-iban');
    expect(bereichPfad('steuern')).toBe('/einstellungen/steuern');
  });
});
