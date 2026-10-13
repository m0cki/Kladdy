/* Seitenleisten-Symbol (PanelLeft im Lucide-Stil) mit drehbarem Pfeil `.pnl-chev` (§9.5: „Pfeil im Panel-Symbol dreht sich“).
 * Lucide hat kein PanelLeft mit eigenständig animierbarem Pfeil, daher wie im Prototyp selbst gezeichnet. */
export function PanelIcon() {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
      <path className="pnl-chev" d="m15.5 9.5-2.5 2.5 2.5 2.5" />
    </svg>
  );
}
