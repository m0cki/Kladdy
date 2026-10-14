import { describe, expect, it } from 'vitest';
import { KREIS_REIHENFOLGE, type Nummernkreis } from '../numbering';
import { nachbarn, nummernTabelle } from './nummernkreise';

describe('nummernTabelle', () => {
  it('ordnet jeden Kreis seiner Tabelle zu', () => {
    expect(nummernTabelle('buchung')).toBe('buchungen');
    expect(nummernTabelle('kunde')).toBe('kunden');
    for (const id of ['rechnung', 'quittung', 'angebot', 'eigenbeleg'] as const) expect(nummernTabelle(id)).toBe('rechnungen');
    expect(KREIS_REIHENFOLGE).toHaveLength(6);
  });
});

describe('nachbarn', () => {
  it('nur andere Kreise derselben Tabelle', () => {
    const kreise: Nummernkreis[] = [
      { id: 'buchung', muster: '{JJJJ}-{NNNN}', jahr: 0, naechste: 1 },
      { id: 'quittung', muster: 'QU-{JJJJ}-{NNN}', jahr: 0, naechste: 1 },
      { id: 'rechnung', muster: 'RE-{JJJJ}-{NNN}', jahr: 0, naechste: 1 },
      { id: 'kunde', muster: 'K-{NNNN}', jahr: 0, naechste: 1 },
    ];
    expect(nachbarn(kreise, 'rechnung')).toEqual([{ name: 'Quittung', muster: 'QU-{JJJJ}-{NNN}' }]);
    expect(nachbarn(kreise, 'kunde')).toEqual([]);
  });
});
