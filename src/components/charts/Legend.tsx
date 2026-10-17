/* Legende (§9.6 Regel 3): ab zwei Serien immer, 10-px-Quadrate mit Radius 3; Bezugswerte als Strichel. */
import { farbVar } from './farbe';

export interface LegendEintrag {
  name: string;
  farbe: string;
  gestrichelt?: boolean;
}

export function Legend({ serien }: { serien: readonly LegendEintrag[] }) {
  return (
    <div className="legend">
      {serien.map((s) => (
        <span key={s.name}>
          <i className={s.gestrichelt ? 'dash' : ''} style={farbVar(s.farbe)} />
          {s.name}
        </span>
      ))}
    </div>
  );
}
