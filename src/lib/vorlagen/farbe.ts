/* Akzentfarbe des Belegs (ANLEITUNG §7.5 „Farben passend zum App-Akzent“).
 * Die Vorschau färbt mit `--akz: color-mix(in oklab, var(--accent) 86%, #000)` (blatt.css, wie im Prototyp).
 * Für das PDF rechnet `belegAkzent` dieselbe Mischung in OKLab nach und liefert den Hex-Wert für \definecolor,
 * damit Vorschau und PDF denselben Ton haben. Tests: vorlagen.test.ts */

const ANTEIL = 0.86;

const zuLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const zuSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** '#rrggbb' ⇒ 'RRGGBB' (ohne #, groß) für \definecolor{akzent}{HTML}{…}; ungültig ⇒ Indigo-Standard. */
export function belegAkzent(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const h = m ? m[1] : '6366f1';
  const [r, g, b] = [0, 2, 4].map((i) => zuLinear(parseInt(h.slice(i, i + 2), 16) / 255));
  // sRGB (linear) ⇒ OKLab (Björn Ottosson)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = (0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s) * ANTEIL;
  const A = (1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s) * ANTEIL;
  const B = (0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s) * ANTEIL;
  // Mischung mit Schwarz (L = a = b = 0) ⇒ zurück nach sRGB
  const l2 = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m2 = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s2 = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2,
    -1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2,
    -0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2,
  ];
  return rgb
    .map((c) => Math.round(Math.min(1, Math.max(0, zuSrgb(Math.min(1, Math.max(0, c))))) * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
