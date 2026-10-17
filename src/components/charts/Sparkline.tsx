/* Sparkline (§9.6, prototyp/js/charts.js → spark): kleiner Verlauf ohne Achsen für Kacheln und Tabellen.
 * Nur Zusatz zur Zahl daneben, daher aria-hidden. Werte in beliebiger Einheit (Cent, Stück …). */
import { linePath, type Punkt } from '../../lib/charts';
import { farbVar } from './farbe';

interface Props {
  werte: readonly (number | null)[];
  farbe?: string;
  breite?: number;
  hoehe?: number;
}

export function Sparkline({ werte, farbe = 'var(--accent)', breite = 84, hoehe = 26 }: Props) {
  const v = werte.filter((x): x is number => x != null && Number.isFinite(x));
  if (v.length < 2) return null;
  const min = Math.min(...v);
  const spanne = Math.max(...v) - min || 1;
  const pts: Punkt[] = v.map((w, i) => [1 + (i / (v.length - 1)) * (breite - 4), 2 + (hoehe - 4) - ((w - min) / spanne) * (hoehe - 4)]);
  const d = linePath(pts);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="spark" width={breite} height={hoehe} viewBox={`0 0 ${breite} ${hoehe}`} aria-hidden="true" style={farbVar(farbe)}>
      <path d={`${d}L${lx},${hoehe}L${pts[0][0]},${hoehe}Z`} className="spark-flaeche" />
      <path d={d} className="spark-linie" />
      <circle cx={lx} cy={ly} r={2.2} className="spark-punkt" />
    </svg>
  );
}
