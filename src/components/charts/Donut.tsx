/* Donut mit Werteliste daneben (§9.6, prototyp/js/charts.js → donut): Mitte zeigt die Summe, beim Zeigen auf ein Stück
 * oder einen Listeneintrag dessen Wert. Die Liste mit Betrag und Anteil ist zugleich die Tabellen-Entsprechung (Regel 8),
 * der Ring selbst ist nur Schmuck (aria-hidden). Listeneinträge sind per Tastatur erreichbar. */
import { useState } from 'react';
import { donutBogen, donutSegmente, prozenteGanz } from '../../lib/charts';
import { farbVar } from './farbe';

export interface DonutEintrag {
  schluessel: string;
  name: string;
  farbe: string;
  /** Cent, positiv */
  wert: number;
}

interface Props {
  eintraege: DonutEintrag[];
  /** Text in der Mitte (Summe) */
  mitte: string;
  mitteSub: string;
  format: (v: number) => string;
  /** Beschriftung der Liste fürs Bildschirmlesen */
  titel: string;
}

const R = 85;
const r = 58;

export function Donut({ eintraege, mitte, mitteSub, format, titel }: Props) {
  const [an, setAn] = useState<number | null>(null);
  const segmente = donutSegmente(eintraege.map((e) => e.wert));
  const prozente = prozenteGanz(eintraege.map((e) => e.wert));
  const zeige = (i: number | null) => () => setAn(i);
  return (
    <div className="donut-wrap">
      <div className={`donut ${an != null ? 'hovering' : ''}`}>
        <svg width={170} height={170} viewBox="0 0 170 170" aria-hidden="true" className="c-fade">
          {segmente.map((sg, i) =>
            eintraege[i].wert > 0 ? (
              <path
                key={eintraege[i].schluessel}
                d={donutBogen(R, R, r, sg.a1, sg.a2)}
                className={an === i ? 'on' : ''}
                style={farbVar(eintraege[i].farbe)}
                onPointerEnter={zeige(i)}
                onPointerLeave={zeige(null)}
              />
            ) : null,
          )}
        </svg>
        <div className="donut-center">
          <div>
            <b>{an != null ? format(eintraege[an].wert) : mitte}</b>
            <small>{an != null ? eintraege[an].name : mitteSub}</small>
          </div>
        </div>
      </div>
      <ul className="donut-list" aria-label={titel}>
        {eintraege.map((e, i) => (
          <li
            key={e.schluessel}
            className={an === i ? 'on' : ''}
            tabIndex={0}
            onPointerEnter={zeige(i)}
            onPointerLeave={zeige(null)}
            onFocus={zeige(i)}
            onBlur={zeige(null)}
          >
            <i style={farbVar(e.farbe)} />
            <span>{e.name}</span>
            <b>{format(e.wert)}</b>
            <small>{prozente[i]} %</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
