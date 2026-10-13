/* Segment-Umschalter mit gleitender Markierung (§9.4). Position der Markierung wird gemessen. */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface Props<T extends string> {
  options: readonly SegOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
}

export function Seg<T extends string>({ options, value, onChange, className = '', ariaLabel }: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ w: number; h: number; x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const a = el.querySelector<HTMLButtonElement>('button.active');
      if (!a || !a.offsetWidth) return setInd(null);
      const next = { w: a.offsetWidth, h: a.offsetHeight, x: a.offsetLeft, y: a.offsetTop };
      setInd((p) => (p && p.w === next.w && p.h === next.h && p.x === next.x && p.y === next.y ? p : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const raf = requestAnimationFrame(() => setReady(true));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);

  return (
    <div ref={ref} className={`seg ${ready ? 'ready' : ''} ${className}`} role="tablist" aria-label={ariaLabel}>
      <span
        className="seg-ind"
        style={
          ind
            ? { opacity: 1, width: ind.w, height: ind.h, transform: `translate(${ind.x}px, ${ind.y}px)` }
            : { opacity: 0 }
        }
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
