/* Farben kommen nur als CSS-Variable --c ans Element (Token wie var(--series-1) oder die Kategoriefarbe aus den Daten),
 * die Regeln in charts.css lesen sie aus – keine festen Farben im Markup. */
import type { CSSProperties } from 'react';

export const farbVar = (farbe: string | undefined, extra?: CSSProperties): CSSProperties =>
  ({ ...extra, '--c': farbe ?? 'var(--accent)' }) as CSSProperties;
