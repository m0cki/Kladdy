/* App-Symbol (§9.7): abgerundetes Quadrat mit Akzentverlauf und weißem Beleg-Symbol (wie im Prototyp). */
import { useId } from 'react';

export function Logo({ className = 'logo' }: { className?: string }) {
  const id = useId();
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <path
        d="M10 8.5h9.5l3 3V23a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"
        fill="none"
        stroke="var(--on-accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M12.5 15h7M12.5 19h4.5" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
