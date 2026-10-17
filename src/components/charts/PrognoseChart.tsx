/* Liquiditätsvorschau (§6.9.2, §9.6): Treppenlinie des erwarteten Überschusses ab heute (Start 0 €), ein Wert je Tag.
 * Über 0 Akzent, unter 0 --neg (Linie und Fläche an der Nulllinie geteilt). Erwartete Zahlungen als Punkte – Einnahme
 * gefüllt, Ausgabe als Ring (Plus/Minus nie nur über Farbe). Heute-Linie mit pulsierendem Punkt, engster Moment unter 0
 * mit Beschriftung, Endwert als Pille rechts. Hover: Fadenkreuz + Tooltip mit den Zahlungen des Tages (höchstens 5).
 * Darunter die Tabelle (Regel 8). Portiert aus prototyp/js/charts.js → forecast (todayIdx 0). */
import { useId, useMemo, useState, type PointerEvent } from 'react';
import { MONAT_KURZ } from '../../lib/auswertung';
import { achsenText, geldAchse, naechsterIndex, pillBreite, skala, stepPath, type Punkt } from '../../lib/charts';
import { datumKurz, tagKurz, type Tag } from '../../lib/liquiditaet';
import { formatBetrag } from '../../lib/money';
import { ChartTabelle } from './ChartTabelle';
import { ChartTip, type TipInhalt } from './ChartTip';
import { farbVar } from './farbe';
import { useBreite } from './useBreite';

interface Props {
  /** heute … letzter Tag (aus vorschau()) */
  tage: readonly Tag[];
  titel: string;
  hoehe?: number;
}

const M = { t: 26, r: 76, b: 28, l: 62 };
const euro0 = (c: number, vorzeichen = false) => formatBetrag(c, { nachkomma: 0, vorzeichen: vorzeichen ? 'immer' : 'auto' });
const summe = (t: Tag) => t.zahlungen.reduce((s, z) => s + z.betrag_cent, 0);

export function PrognoseChart({ tage, titel, hoehe = 300 }: Props) {
  const { ref, breite, anim } = useBreite<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gid = `p${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const n = tage.length;

  const g = useMemo(() => {
    const vals = tage.map((t) => t.wert);
    const min = Math.min(0, ...vals);
    const max = Math.max(0, ...vals);
    const pad = Math.round((max - min) * 0.1) || 100;
    const achse = geldAchse([min < 0 ? min - pad : 0, max + pad]);
    const pw = Math.max(0, breite - M.l - M.r);
    const ph = hoehe - M.t - M.b;
    const y = skala(achse.lo, achse.hi, M.t, ph);
    const x = (i: number) => M.l + (n <= 1 ? 0 : (i / (n - 1)) * pw);
    const pts: Punkt[] = vals.map((v, i) => [x(i), y(v)]);
    const schritt = achse.ticks.length > 1 ? Math.abs(achse.ticks[1] - achse.ticks[0]) : 1;
    let minI = 0;
    vals.forEach((v, i) => {
      if (v < vals[minI]) minI = i;
    });
    // X-Beschriftung: Monatsanfänge, mindestens 64 px Abstand und nicht zu nah an „heute“
    const xIdx: number[] = [];
    tage.forEach((t, i) => {
      if (i > 0 && t.datum.slice(8) === '01' && x(i) - M.l > 40 && (!xIdx.length || x(i) - x(xIdx[xIdx.length - 1]) >= 64)) xIdx.push(i);
    });
    return { vals, achse, pw, ph, y, x, pts, schritt, minI, xIdx, linie: stepPath(pts) };
  }, [tage, breite, hoehe, n]);

  const { x, y, vals, pts, minI } = g;
  const z = y(0);
  const neg = g.achse.lo < 0;

  const tip: TipInhalt | null = useMemo(() => {
    if (hover == null || !tage[hover]) return null;
    const t = tage[hover];
    const zl = t.zahlungen.slice(0, 5).map((p) => ({ name: p.text, wert: euro0(p.betrag_cent, true) }));
    return {
      titel: `${tagKurz(t.datum)}${hover === 0 ? ' · heute' : ''}`,
      zeilen: [{ farbe: t.wert < 0 ? 'var(--neg)' : 'var(--accent)', name: 'Überschuss ab heute', wert: euro0(t.wert) }, ...zl],
      notiz: t.zahlungen.length > 5 ? `+ ${t.zahlungen.length - 5} weitere` : undefined,
    };
  }, [hover, tage]);

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    setHover(naechsterIndex(e.clientX - rect.left, M.l, g.pw, n));
  };

  const flaeche = n ? `${g.linie}V${z.toFixed(2)}H${x(0).toFixed(2)}Z` : '';
  const fade = anim ? 'c-fade' : '';
  const zeigeMin = minI > 0 && vals[minI] < 0;
  const minText = zeigeMin ? `Engster Moment ${euro0(vals[minI])} · ${datumKurz(tage[minI].datum)}` : '';
  const minW = pillBreite(minText);
  const minX = zeigeMin ? pts[minI][0] : 0;
  const minRx = minX + minW > breite - M.r ? minX - minW : minX < M.l + minW / 2 ? minX : minX - minW / 2;
  const minY = zeigeMin ? Math.min(M.t + g.ph - 10, pts[minI][1] + 18) : 0;
  const ende = n ? pts[n - 1] : null;
  const hv = hover != null ? vals[hover] : null;

  // Tabelle: heute, jeder Tag mit Zahlungen und der letzte Tag
  const zeilen = tage
    .map((t, i) => ({ t, i }))
    .filter(({ t, i }) => i === 0 || i === n - 1 || t.zahlungen.length)
    .map(({ t, i }) => ({
      schluessel: t.datum,
      label: `${tagKurz(t.datum)}${i === 0 ? ' (heute)' : ''}`,
      werte: [t.zahlungen.length ? euro0(summe(t), true) : '–', euro0(t.wert)],
      hervorheben: i === minI && zeigeMin,
    }));

  return (
    <>
      <div className="chart liq-chart" ref={ref} style={{ height: hoehe }}>
        {breite && n ? (
          <svg className={`chart-svg ${hover != null ? 'hovering' : ''}`} width={breite} height={hoehe} viewBox={`0 0 ${breite} ${hoehe}`} role="img" aria-label={titel}>
            <defs>
              <linearGradient id={`${gid}o`} x1="0" y1="0" x2="0" y2="1" style={farbVar('var(--accent)')}>
                <stop offset="0" className="c-stop-oben" />
                <stop offset="1" className="c-stop-unten" />
              </linearGradient>
              <linearGradient id={`${gid}u`} x1="0" y1="0" x2="0" y2="1" style={farbVar('var(--neg)')}>
                <stop offset="0" className="c-stop-neg-oben" />
                <stop offset="1" className="c-stop-neg-unten" />
              </linearGradient>
              <clipPath id={`${gid}co`}>
                <rect x={0} y={0} width={breite} height={Math.max(0, z)} />
              </clipPath>
              <clipPath id={`${gid}cu`}>
                <rect x={0} y={z} width={breite} height={Math.max(0, hoehe - z)} />
              </clipPath>
            </defs>
            {g.achse.ticks.map((v) => (
              <g key={v}>
                <line x1={M.l} x2={breite - M.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'c-base' : 'c-grid'} />
                <text x={M.l - 8} y={y(v)} className="c-tick" textAnchor="end" dominantBaseline="middle">
                  {achsenText(v, g.schritt)}
                </text>
              </g>
            ))}
            {g.xIdx.map((i) => (
              <text key={i} x={x(i)} y={hoehe - 8} className="c-tick" textAnchor="middle">
                {MONAT_KURZ[Number(tage[i].datum.slice(5, 7)) - 1]}
              </text>
            ))}
            <line x1={x(0)} x2={x(0)} y1={M.t - 10} y2={M.t + g.ph} className="c-today" />
            <text x={x(0)} y={M.t - 14} textAnchor="start" className="c-todaylabel">
              Heute
            </text>
            <text x={x(0)} y={hoehe - 8} className="c-tick" textAnchor="start">
              {datumKurz(tage[0].datum)}
            </text>
            <path d={flaeche} fill={`url(#${gid}o)`} clipPath={`url(#${gid}co)`} className={fade} />
            {neg ? <path d={flaeche} fill={`url(#${gid}u)`} clipPath={`url(#${gid}cu)`} className={fade} /> : null}
            <path d={g.linie} pathLength={1} className={`c-line ${anim ? 'c-draw' : ''}`} style={farbVar('var(--accent)')} clipPath={neg ? `url(#${gid}co)` : undefined} />
            {neg ? <path d={g.linie} pathLength={1} className={`c-line ${anim ? 'c-draw' : ''}`} style={farbVar('var(--neg)')} clipPath={`url(#${gid}cu)`} /> : null}
            {tage.map((t, i) =>
              i > 0 && t.zahlungen.length ? <circle key={t.datum} cx={pts[i][0]} cy={pts[i][1]} r={3} className={`c-ev ${summe(t) >= 0 ? 'pos' : 'neg'} ${fade}`} /> : null,
            )}
            {zeigeMin ? (
              <>
                <circle cx={minX} cy={pts[minI][1]} r={5} className="c-dot" style={farbVar('var(--neg)')} />
                <g className="c-minlabel">
                  <rect x={minRx} y={minY - 8} width={minW} height={16} rx={5} />
                  <text x={minRx + 7} y={minY} dominantBaseline="central">
                    {minText}
                  </text>
                </g>
              </>
            ) : null}
            <circle cx={x(0)} cy={pts[0][1]} r={4.5} className="c-dot c-pulse" style={farbVar('var(--accent)')} />
            {ende ? (
              <g className="c-endlabel neutral">
                <rect x={breite - M.r + 6} y={ende[1] - 11} width={M.r - 8} height={22} rx={6} />
                <text x={breite - M.r + 6 + (M.r - 8) / 2} y={ende[1]} textAnchor="middle" dominantBaseline="central" className="c-endtext">
                  {euro0(vals[n - 1], true)}
                </text>
              </g>
            ) : null}
            <line className="c-cross" x1={hover != null ? x(hover) : 0} x2={hover != null ? x(hover) : 0} y1={M.t} y2={M.t + g.ph} />
            <circle
              className="c-hoverdot"
              r={5}
              cx={hover != null ? x(hover) : 0}
              cy={hv != null ? y(hv) : 0}
              style={farbVar(hv != null && hv < 0 ? 'var(--neg)' : 'var(--accent)', hv == null ? { visibility: 'hidden' } : undefined)}
            />
            <rect className="c-overlay" x={M.l - 6} y={M.t} width={g.pw + 12} height={g.ph} onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
        ) : null}
        <ChartTip inhalt={tip} x={hover != null ? x(hover) : 0} y={hv != null ? y(hv) : M.t + g.ph / 2} breite={breite} />
      </div>
      <ChartTabelle titel={titel} kopf="Tag" spalten={['Zahlungen', 'Überschuss ab heute']} zeilen={zeilen} />
    </>
  );
}
