import { describe, expect, it } from 'vitest';
import {
  LOGO_DIALOG_FILTER,
  LOGO_MAX_BREITE,
  LOGO_MAX_HOEHE,
  istLogoName,
  logoAusPfaden,
  logoAusWert,
  logoTyp,
  vorlageZeigtLogo,
  zielMass,
} from './firmenlogo';
import { standardVorlage } from './vorlagen/standard';

const NAME = `logo-${'0123456789abcdef'.repeat(4)}.png`;

describe('Firmenlogo', () => {
  it('nur PNG, JPG, SVG und WebP (Endung, groß oder klein)', () => {
    expect(logoTyp('/Users/max/Logo.png')).toBe('image/png');
    expect(logoTyp('/Users/max/logo.JPG')).toBe('image/jpeg');
    expect(logoTyp('/Users/max/logo.jpeg')).toBe('image/jpeg');
    expect(logoTyp('/Users/max/logo.svg')).toBe('image/svg+xml');
    expect(logoTyp('/Users/max/logo.webp')).toBe('image/webp');
    for (const p of ['/x/logo.pdf', '/x/logo.heic', '/x/logo', '/x/.png', '/x/logo.png.zip', '/x/constructor', '/x/a.toString']) expect(logoTyp(p), p).toBeNull();
    expect(LOGO_DIALOG_FILTER.extensions).toEqual(['png', 'jpg', 'jpeg', 'svg', 'webp']);
  });

  it('Dateiname wie in Rust (logo-<sha256>.png), sonst App-Symbol', () => {
    expect(istLogoName(NAME)).toBe(true);
    expect(logoAusWert(NAME)).toBe(NAME);
    for (const v of ['', 'logo.png', `../${NAME}`, NAME.toUpperCase(), NAME.replace('.png', '.jpg'), `${NAME}x`, `logo-${'0'.repeat(63)}.png`, null, undefined, 42, { name: NAME }]) {
      expect(istLogoName(v)).toBe(false);
      expect(logoAusWert(v)).toBe('');
    }
  });

  it('verkleinert auf höchstens 720 × 240 px, Seitenverhältnis bleibt, nie größer', () => {
    expect(zielMass(1440, 480)).toEqual({ breite: 720, hoehe: 240 });
    expect(zielMass(2000, 1000)).toEqual({ breite: 480, hoehe: 240 });
    expect(zielMass(3000, 500)).toEqual({ breite: 720, hoehe: 120 });
    expect(zielMass(1000, 1000)).toEqual({ breite: 240, hoehe: 240 });
    expect(zielMass(200, 100)).toEqual({ breite: 200, hoehe: 100 });
    expect(zielMass(720, 240)).toEqual({ breite: 720, hoehe: 240 });
    // extrem schmal oder flach: mindestens 1 px
    expect(zielMass(100_000, 10)).toEqual({ breite: 720, hoehe: 1 });
    expect(zielMass(1, 10_000)).toEqual({ breite: 1, hoehe: 240 });
    // SVG ohne eigene Größe ⇒ 512 × 512 ⇒ 240 × 240
    expect(zielMass(0, 0)).toEqual({ breite: 240, hoehe: 240 });
    expect(zielMass(Number.NaN, 100)).toEqual({ breite: 512, hoehe: 100 });
    for (const [w, h] of [
      [4032, 3024],
      [333, 777],
      [721, 241],
      [5, 5],
    ]) {
      const z = zielMass(w, h);
      expect(z.breite).toBeLessThanOrEqual(LOGO_MAX_BREITE);
      expect(z.hoehe).toBeLessThanOrEqual(LOGO_MAX_HOEHE);
      expect(Math.abs(z.breite / z.hoehe - w / h) / (w / h)).toBeLessThan(0.02);
    }
  });

  it('Kopf mit Logo: Standard bei Rechnung und Angebot, nicht bei der Quittung', () => {
    expect(vorlageZeigtLogo(standardVorlage('rechnung'))).toBe(true);
    expect(vorlageZeigtLogo(standardVorlage('angebot'))).toBe(true);
    expect(vorlageZeigtLogo(standardVorlage('quittung'))).toBe(false);
    expect(vorlageZeigtLogo([{ typ: 'kopf' }])).toBe(true);
    expect(vorlageZeigtLogo([{ typ: 'kopf', logo: false }])).toBe(false);
    expect(vorlageZeigtLogo([{ typ: 'kopf', aus: true }])).toBe(false);
    // Firmenkopf (Text): Logo nur, wenn eingeschaltet (Standard aus, auch im Design „Formular“)
    expect(vorlageZeigtLogo(standardVorlage('quittung', 'formular'))).toBe(false);
    expect(vorlageZeigtLogo([{ typ: 'firmenblock', logo: true }])).toBe(true);
  });

  it('von mehreren gezogenen Dateien das erste Bild', () => {
    expect(logoAusPfaden(['/x/rechnung.pdf', '/x/logo.svg', '/x/b.png'])).toBe('/x/logo.svg');
    expect(logoAusPfaden(['/x/rechnung.pdf'])).toBe('/x/rechnung.pdf');
    expect(logoAusPfaden([])).toBeNull();
  });
});
