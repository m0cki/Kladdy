/* Zeitraum-Wähler (§6.3): Segment Monat · Quartal · Jahr und ‹ Oktober 2026 ›. Nicht in die Zukunft blätterbar. */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ZEITRAUM_MODI, hatNaechsten, heute, naechsterAnker, zeitraum, type ZeitraumModus } from '../../lib/zeitraum';
import { Seg } from './Seg';

interface Props {
  modus: ZeitraumModus;
  anker: string;
  onChange: (z: { modus: ZeitraumModus; anker: string }) => void;
}

export function ZeitraumWahl({ modus, anker, onChange }: Props) {
  const z = zeitraum(modus, anker);
  const h = heute();
  return (
    <div className="period">
      <Seg options={ZEITRAUM_MODI} value={modus} onChange={(m) => onChange({ modus: m, anker })} ariaLabel="Zeitraum" />
      <div className="period-nav">
        <button type="button" className="icon-btn sm" title="Vorheriger Zeitraum" aria-label="Vorheriger Zeitraum" onClick={() => onChange({ modus, anker: naechsterAnker(modus, anker, -1, h) })}>
          <ChevronLeft />
        </button>
        <b aria-live="polite">{z.label}</b>
        <button
          type="button"
          className="icon-btn sm"
          title="Nächster Zeitraum"
          aria-label="Nächster Zeitraum"
          disabled={!hatNaechsten(modus, anker, h)}
          onClick={() => onChange({ modus, anker: naechsterAnker(modus, anker, 1, h) })}
        >
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}
