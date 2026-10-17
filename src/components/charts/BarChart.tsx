/* Gruppierte Balken (§9.6): eine Y-Achse, Balken mit 4-px-Rundung nur am Datenende, 2 px Abstand, max. 26 px breit,
 * wachsen federnd aus der Nulllinie (35 ms je Gruppe, §9.5). Hover: Spalte hervorheben + Tooltip. Klick wählt eine
 * Gruppe (z. B. den Monat). Darunter die Tabelle mit allen Werten (Regel 8). Portiert aus prototyp/js/charts.js → bars. */
import { useMemo, useState, type MouseEvent } from 'react';
import { achsenText, balkenraster, bandIndex, barPath, geldAchse, skala, xBeschriftungen } from '../../lib/charts';
import { ChartTabelle } from './ChartTabelle';
import { ChartTip, type TipInhalt, type TipZeile } from './ChartTip';
import { farbVar } from './farbe';
import { useBreite } from './useBreite';

export interface BarSerie {
  name: string;
  /** Token, z. B. 'var(--series-1)' */
  farbe: string;
  /** Cent; null = kein Wert */
  werte: (number | null)[];
}

interface Props {
  labels: string[];
  serien: BarSerie[];
  /** Beschreibung fürs Bildschirmlesen und Überschrift der Tabelle */
  titel: string;
  hoehe?: number;
  /** Achse (Wert, Tick-Abstand) */
  formatY?: (v: number, schritt: number) => string;
  /** Tooltip und Tabelle */
  formatWert: (v: number) => string;
  /** Titel im Tooltip und in der Tabelle (Standard: label) */
  langLabel?: (i: number) => string;
  /** weitere Zeilen im Tooltip und Spalten in der Tabelle, z. B. Überschuss */
  extra?: { name: string; wert: (i: number) => string };
  /** blasser zeichnen (außerhalb des gewählten Zeitraums) */
  blass?: (i: number) => boolean;
  /** Klick auf eine Gruppe */
  onWahl?: (i: number) => void;
  /** Text für die Knöpfe in der Tabelle, z. B. „Monat wählen“ */
  wahlText?: string;
  /** Kopf der ersten Tabellenspalte */
  kopf?: string;
}

const M = { t: 12, r: 10, b: 28, l: 58 };

export function BarChart({ labels, serien, titel, hoehe = 260, formatY = achsenText, formatWert, langLabel, extra, blass, onWahl, wahlText, kopf = 'Monat' }: Props) {
  const { ref, breite, anim } = useBreite<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; y: number } | null>(null);
  const n = labels.length;
  const s = serien.length;

  const g = useMemo(() => {
    const achse = geldAchse(serien.flatMap((se) => se.werte));
    const pw = Math.max(0, breite - M.l - M.r);
    const ph = hoehe - M.t - M.b;
    const y = skala(achse.lo, achse.hi, M.t, ph);
    const raster = balkenraster(pw, n, s);
    const schritt = achse.ticks.length > 1 ? Math.abs(achse.ticks[1] - achse.ticks[0]) : 1;
    return { achse, pw, ph, y, raster, schritt, y0: y(0), xLabels: xBeschriftungen(n, raster.band) };
  }, [serien, breite, hoehe, n, s]);

  const ort = (e: MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    return { i: bandIndex(e.clientX - rect.left, M.l, g.raster.band, n), y: e.clientY - rect.top };
  };

  const tip: TipInhalt | null = useMemo(() => {
    if (!hover) return null;
    const zeilen: TipZeile[] = serien.map((se) => ({ farbe: se.farbe, name: se.name, wert: se.werte[hover.i] == null ? '–' : formatWert(se.werte[hover.i]!) }));
    if (extra) zeilen.push({ name: extra.name, wert: extra.wert(hover.i) });
    return { titel: langLabel ? langLabel(hover.i) : labels[hover.i], zeilen };
  }, [hover, serien, extra, langLabel, labels, formatWert]);

  const { raster, y, y0 } = g;
  const teilweiseBlass = !!blass && labels.some((_, i) => blass(i));
  return (
    <>
      <div className="chart" ref={ref} style={{ height: hoehe }}>
        {breite && n ? (
          <svg className={`chart-svg ${hover ? 'hovering' : ''}`} width={breite} height={hoehe} viewBox={`0 0 ${breite} ${hoehe}`} role="img" aria-label={titel}>
            {g.achse.ticks.map((v) => (
              <g key={v}>
                <line x1={M.l} x2={breite - M.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'c-base' : 'c-grid'} />
                <text x={M.l - 8} y={y(v)} className="c-tick" textAnchor="end" dominantBaseline="middle">
                  {formatY(v, g.schritt)}
                </text>
              </g>
            ))}
            <rect className="c-band" x={M.l + (hover?.i ?? 0) * raster.band} y={M.t} width={raster.band} height={g.ph} rx={6} />
            {labels.map((_, i) => {
              const gx = M.l + i * raster.band + (raster.band - raster.gruppe) / 2;
              return serien.map((se, k) => {
                const v = se.werte[i];
                if (v == null) return null;
                const bx = gx + k * (raster.balken + 2);
                const d = barPath(bx, raster.balken, y0, y(v));
                if (!d) return null;
                return (
                  <path
                    key={`${i}-${k}`}
                    d={d}
                    className={`c-bar ${anim ? 'c-grow' : ''} ${blass?.(i) ? 'blass' : ''}`}
                    style={farbVar(se.farbe, { transformOrigin: `${bx + raster.balken / 2}px ${y0}px`, animationDelay: anim ? `${i * 35 + k * 60}ms` : undefined })}
                  />
                );
              });
            })}
            {g.xLabels.map((i) => (
              <text key={i} x={M.l + i * raster.band + raster.band / 2} y={hoehe - 8} className="c-tick" textAnchor="middle">
                {labels[i]}
              </text>
            ))}
            <rect
              className={`c-overlay ${onWahl ? 'klickbar' : ''}`}
              x={M.l}
              y={M.t}
              width={g.pw}
              height={g.ph}
              onPointerMove={(e) => setHover(ort(e))}
              onPointerLeave={() => setHover(null)}
              onClick={onWahl ? (e) => onWahl(ort(e).i) : undefined}
            />
          </svg>
        ) : null}
        <ChartTip inhalt={tip} x={hover ? M.l + hover.i * raster.band + raster.band / 2 : 0} y={hover?.y ?? 0} breite={breite} />
      </div>
      <ChartTabelle
        titel={titel}
        kopf={kopf}
        spalten={[...serien.map((se) => se.name), ...(extra ? [extra.name] : [])]}
        zeilen={labels.map((l, i) => {
          const text = langLabel ? langLabel(i) : l;
          return {
            schluessel: `${i}`,
            hervorheben: teilweiseBlass && !blass!(i),
            label: onWahl ? (
              <button type="button" className="link" title={wahlText} onClick={() => onWahl(i)}>
                {text}
              </button>
            ) : (
              text
            ),
            werte: [...serien.map((se) => (se.werte[i] == null ? '–' : formatWert(se.werte[i]!))), ...(extra ? [extra.wert(i)] : [])],
          };
        })}
      />
    </>
  );
}
