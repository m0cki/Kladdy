/* Monogramm (§9.4 .mono-logo): Initialen auf einer Farbe aus dem Namen. Gesetzt wird nur der Farbton (--h);
 * die Farbe selbst baut kunden.css (.ku-mono), keine Inline-Farben. */
import type { CSSProperties } from 'react';
import { farbton, initialen } from '../../lib/kunden';

export function Monogramm({ name, size = 'sm' }: { name: string; size?: 'xs' | 'sm' | 'lg' }) {
  return (
    <i className={`mono-logo ${size} ku-mono`} style={{ '--h': farbton(name) } as CSSProperties} aria-hidden="true">
      {initialen(name)}
    </i>
  );
}
