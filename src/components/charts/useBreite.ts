/* Responsive Breite für Diagramme (§9.6): ResizeObserver misst den Container. Animiert wird nur beim ersten Zeichnen;
 * nach einer Größenänderung wird ohne Animation neu gezeichnet (wie mount() im Prototyp). Neu animieren = neu montieren
 * (key am Diagramm ändern, z. B. beim Zeitraum-Wechsel). */
import { useLayoutEffect, useRef, useState } from 'react';

export function useBreite<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [breite, setBreite] = useState(0);
  const [anim, setAnim] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let letzte = 0;
    const messen = () => {
      const w = Math.floor(el.clientWidth);
      if (!w || w === letzte) return;
      if (letzte) setAnim(false);
      letzte = w;
      setBreite(w);
    };
    messen();
    const ro = new ResizeObserver(messen);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, breite, anim };
}
