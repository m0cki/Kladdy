/* Tooltip der Diagramme (§9.6 Regel 6): Fläche, Radius 11, 9-px-Farbquadrate, Werte rechts. Steht neben dem Zeiger,
 * am rechten Rand links davon. Nur Zusatz – alle Werte stehen auch in der Tabelle (Regel 8), daher aria-hidden. */
import { useLayoutEffect, useRef, useState } from 'react';
import { farbVar } from './farbe';

export interface TipZeile {
  farbe?: string;
  name: string;
  wert: string;
}

export interface TipInhalt {
  titel: string;
  zeilen: TipZeile[];
  notiz?: string;
}

interface Props {
  /** null = ausgeblendet */
  inhalt: TipInhalt | null;
  /** Ankerpunkt im Diagramm (px) */
  x: number;
  y: number;
  /** Breite des Diagramms (px) */
  breite: number;
}

export function ChartTip({ inhalt, x, y, breite }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<[number, number]>([0, 0]);
  // Beim Ausblenden den letzten Inhalt stehen lassen, sonst wird die Box während des Ausblendens leer
  const [letzter, setLetzter] = useState<TipInhalt | null>(null);
  if (inhalt && inhalt !== letzter) setLetzter(inhalt);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !inhalt) return;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let links = x + 14;
    if (links + tw > breite - 4) links = x - tw - 14;
    setPos([Math.max(4, links), Math.max(0, y - th / 2)]);
  }, [inhalt, x, y, breite]);

  const c = inhalt ?? letzter;
  return (
    <div ref={ref} className={`chart-tip ${inhalt ? 'show' : ''}`} style={{ transform: `translate(${pos[0]}px, ${pos[1]}px)` }} aria-hidden="true">
      {c ? (
        <>
          <div className="ct-title">{c.titel}</div>
          {c.zeilen.map((z, i) => (
            <div key={i} className="ct-row">
              {z.farbe ? <i style={farbVar(z.farbe)} /> : null}
              <span>{z.name}</span>
              <b>{z.wert}</b>
            </div>
          ))}
          {c.notiz ? <div className="ct-note">{c.notiz}</div> : null}
        </>
      ) : null}
    </div>
  );
}
