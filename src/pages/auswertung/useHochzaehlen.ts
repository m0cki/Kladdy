/* KPI-Werte hochzählen (§9.5: 900 ms, ease-out cubic); bei reduzierter Bewegung sofort der Zielwert.
 * Gemeinsam für Überblick und Liquidität. `nurAnfangs`: nur beim ersten Anzeigen zählen, danach (z. B. beim Verstellen
 * der Annahmen) den neuen Wert sofort zeigen. */
import { useEffect, useRef, useState } from 'react';
import { hochzaehlWert } from '../../lib/charts';
import { useUi } from '../../store/ui';

export function useHochzaehlen(ziel: number, nurAnfangs = false): number {
  const voll = useUi((s) => s.settings.motion === 'full');
  const [wert, setWert] = useState(voll ? 0 : ziel);
  const gezaehlt = useRef(false);
  useEffect(() => {
    if (!voll || (nurAnfangs && gezaehlt.current)) {
      setWert(ziel);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const schritt = (jetzt: number) => {
      const t = (jetzt - t0) / 900;
      setWert(hochzaehlWert(ziel, t));
      if (t < 1) raf = requestAnimationFrame(schritt);
      else gezaehlt.current = true;
    };
    raf = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(raf);
  }, [ziel, voll, nurAnfangs]);
  return wert;
}
