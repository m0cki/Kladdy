/* Linie/Fläche mit mehreren Serien (§9.6): eine Y-Achse, Linien 2 px mit runden Enden, die sich zeichnen (1,3 s, §9.5);
 * optional Fläche als Verlauf 32 % → 0 %. Bezugswerte (Vorjahr, Ziel) gestrichelt `3 4` in --muted, nie als eigene
 * Serie (Regel 7). Letzter Wert der Hauptserie als gefüllte Pille am Linienende. Lücken (null, z. B. künftige Monate)
 * bleiben leer. Hover: Fadenkreuz + Tooltip. Darunter die Tabelle (Regel 8).
 * Portiert aus prototyp/js/charts.js → area und lines. */
import { useId, useMemo, useState, type PointerEvent } from 'react';
import { achsenText, areaPath, geldAchse, linePath, naechsterIndex, pillBreite, skala, xBeschriftungen, type Punkt } from '../../lib/charts';
import { ChartTabelle } from './ChartTabelle';
import { ChartTip, type TipInhalt } from './ChartTip';
import { farbVar } from './farbe';
import { useBreite } from './useBreite';

export interface LinienSerie {
  name: string;
  /** Token, Standard var(--accent); Bezugswerte immer --muted */
  farbe?: string;
  /** Cent; null = Lücke */
  werte: (number | null)[];
  /** gestrichelter Bezugswert (Vorjahr, Ziel) */
  bezug?: boolean;
  /** Fläche unter der Linie */
  flaeche?: boolean;
}

interface Props {
  labels: string[];
  serien: LinienSerie[];
  titel: string;
  hoehe?: number;
  formatY?: (v: number, schritt: number) => string;
  formatWert: (v: number) => string;
  /** Text der Endwert-Pille (Standard formatWert) */
  formatEnde?: (v: number) => string;
  langLabel?: (i: number) => string;
  glatt?: boolean;
  /** Endwert-Pille zeigen (Standard ja) */
  endPille?: boolean;
  kopf?: string;
}

const M = { t: 14, r: 14, b: 28, l: 58 };
const farbeVon = (s: LinienSerie) => (s.bezug ? 'var(--muted)' : (s.farbe ?? 'var(--accent)'));

export function AreaChart({ labels, serien, titel, hoehe = 260, formatY = achsenText, formatWert, formatEnde, langLabel, glatt = false, endPille = true, kopf = 'Monat' }: Props) {
  const { ref, breite, anim } = useBreite<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gid = `g${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const n = labels.length;
  const haupt = serien.find((s) => !s.bezug) ?? serien[0];

  const g = useMemo(() => {
    const achse = geldAchse(serien.flatMap((s) => s.werte));
    const pw = Math.max(0, breite - M.l - M.r);
    const ph = hoehe - M.t - M.b;
    const y = skala(achse.lo, achse.hi, M.t, ph);
    const x = (i: number) => M.l + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
    const schritt = achse.ticks.length > 1 ? Math.abs(achse.ticks[1] - achse.ticks[0]) : 1;
    // Punkte je Serie (Lücken ausgelassen)
    const pts = serien.map((s) => s.werte.flatMap((v, i): Punkt[] => (v == null || !Number.isFinite(v) ? [] : [[x(i), y(v)]])));
    return { achse, pw, ph, y, x, schritt, pts, xLabels: xBeschriftungen(n, pw / Math.max(1, n - 1)) };
  }, [serien, breite, hoehe, n]);

  // Endwert der Hauptserie: letzter vorhandener Wert
  const iHaupt = serien.indexOf(haupt);
  let iEnde = -1;
  haupt?.werte.forEach((v, i) => {
    if (v != null) iEnde = i;
  });

  const tip: TipInhalt | null = useMemo(() => {
    if (hover == null) return null;
    return {
      titel: langLabel ? langLabel(hover) : labels[hover],
      zeilen: serien.map((s) => ({ farbe: farbeVon(s), name: s.name, wert: s.werte[hover] == null ? '–' : formatWert(s.werte[hover]!) })),
    };
  }, [hover, serien, labels, langLabel, formatWert]);

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    setHover(naechsterIndex(e.clientX - rect.left, M.l, g.pw, n));
  };

  const { x, y } = g;
  const basis = y(Math.max(g.achse.lo, 0));
  const hv = hover != null ? haupt?.werte[hover] : null;
  // Zeichenreihenfolge: Bezugswerte unten, Hauptserie oben
  const reihenfolge = serien.map((s, k) => ({ s, k })).sort((a, b) => Number(!!b.s.bezug) - Number(!!a.s.bezug));

  let pille = null;
  if (endPille && haupt && iEnde >= 0 && breite) {
    const text = (formatEnde ?? formatWert)(haupt.werte[iEnde]!);
    const w = pillBreite(text);
    const px = x(iEnde);
    const py = y(haupt.werte[iEnde]!);
    const rechts = px + 10 + w <= breite - 2;
    const rx = rechts ? px + 10 : px - 10 - w;
    const ry = rechts ? py - 11 : Math.max(2, py - 30);
    pille = (
      <g className="c-endlabel" style={farbVar(farbeVon(haupt))}>
        <rect x={rx} y={ry} width={w} height={22} rx={6} />
        <text x={rx + w / 2} y={ry + 11} textAnchor="middle" dominantBaseline="central" className="c-endtext">
          {text}
        </text>
      </g>
    );
  }

  return (
    <>
      <div className="chart" ref={ref} style={{ height: hoehe }}>
        {breite && n ? (
          <svg className={`chart-svg ${hover != null ? 'hovering' : ''}`} width={breite} height={hoehe} viewBox={`0 0 ${breite} ${hoehe}`} role="img" aria-label={titel}>
            <defs>
              {serien.map((s, k) =>
                s.flaeche ? (
                  <linearGradient key={k} id={`${gid}-${k}`} x1="0" y1="0" x2="0" y2="1" style={farbVar(farbeVon(s))}>
                    <stop offset="0" className="c-stop-oben" />
                    <stop offset="1" className="c-stop-unten" />
                  </linearGradient>
                ) : null,
              )}
            </defs>
            {g.achse.ticks.map((v) => (
              <g key={v}>
                <line x1={M.l} x2={breite - M.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'c-base' : 'c-grid'} />
                <text x={M.l - 8} y={y(v)} className="c-tick" textAnchor="end" dominantBaseline="middle">
                  {formatY(v, g.schritt)}
                </text>
              </g>
            ))}
            {g.xLabels.map((i) => (
              <text key={i} x={x(i)} y={hoehe - 8} className="c-tick" textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}>
                {labels[i]}
              </text>
            ))}
            {reihenfolge.map(({ s, k }) => {
              const pts = g.pts[k];
              if (!pts.length) return null;
              const farbe = farbeVon(s);
              return (
                <g key={k} style={farbVar(farbe)}>
                  {s.flaeche && !s.bezug ? <path d={areaPath(pts, basis, glatt)} fill={`url(#${gid}-${k})`} className={anim ? 'c-fade' : ''} /> : null}
                  <path
                    d={linePath(pts, glatt)}
                    pathLength={s.bezug ? undefined : 1}
                    className={`c-line ${s.bezug ? 'bezug' : ''} ${anim ? (s.bezug ? 'c-fade' : 'c-draw') : ''}`}
                    style={anim ? { animationDelay: `${k * 120}ms` } : undefined}
                  />
                  {!s.bezug && n <= 16 ? pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3.5} className={`c-marker ${anim ? 'c-fade' : ''}`} />) : null}
                </g>
              );
            })}
            {pille}
            <line className="c-cross" x1={hover != null ? x(hover) : 0} x2={hover != null ? x(hover) : 0} y1={M.t} y2={M.t + g.ph} />
            {iHaupt >= 0 ? (
              <circle className="c-hoverdot" r={5} cx={hover != null ? x(hover) : 0} cy={hv != null ? y(hv) : 0} style={farbVar(farbeVon(haupt), hv == null ? { visibility: 'hidden' } : undefined)} />
            ) : null}
            <rect className="c-overlay" x={M.l - 6} y={M.t} width={g.pw + 12} height={g.ph} onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
        ) : null}
        <ChartTip inhalt={tip} x={hover != null ? x(hover) : 0} y={hv != null ? y(hv) : M.t + g.ph / 2} breite={breite} />
      </div>
      <ChartTabelle
        titel={titel}
        kopf={kopf}
        spalten={serien.map((s) => s.name)}
        zeilen={labels.map((l, i) => ({
          schluessel: `${i}`,
          label: langLabel ? langLabel(i) : l,
          werte: serien.map((s) => (s.werte[i] == null ? '–' : formatWert(s.werte[i]!))),
        }))}
      />
    </>
  );
}
