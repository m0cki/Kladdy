import { describe, expect, it } from 'vitest';
import { schnappschussLesen } from './belegpdf';
import { BEISPIEL_FIRMA, testbeleg } from './vorlagen/beispiel';
import { standardVorlage } from './vorlagen/standard';

const NAME = `logo-${'c3'.repeat(32)}.png`;
const snapshot = (dokument: Record<string, unknown>) =>
  JSON.stringify({ version: 1, dokument, bausteine: standardVorlage('rechnung') });
const ausgestellt = () => ({ ...testbeleg('rechnung', BEISPIEL_FIRMA, 'klein', '2026-10-22'), nummer: 'RE-2026-014' });

describe('Schnappschuss: Firmenlogo von damals', () => {
  it('Dateiname aus dokument.logo, nicht das aktuelle Logo', () => {
    const s = schnappschussLesen(snapshot({ ...ausgestellt(), logo: NAME, akzent: '#0ea5e9' }));
    expect(s?.dokument.logo).toBe(NAME);
    expect(s?.dokument.nummer).toBe('RE-2026-014');
    expect(s?.akzent).toBe('#0ea5e9');
  });

  it('ohne Logo (ältere Schnappschüsse, zurückgesetzt) oder fremder Wert: keins', () => {
    expect(schnappschussLesen(snapshot(ausgestellt()))?.dokument.logo).toBeNull();
    expect(schnappschussLesen(snapshot({ ...ausgestellt(), logo: '' }))?.dokument.logo).toBeNull();
    expect(schnappschussLesen(snapshot({ ...ausgestellt(), logo: '../../kladdy.db' }))?.dokument.logo).toBeNull();
    expect(schnappschussLesen(snapshot({ ...ausgestellt(), logo: 7 }))?.dokument.logo).toBeNull();
  });
});
