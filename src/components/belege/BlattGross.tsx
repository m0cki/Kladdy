/* „Groß ansehen“: das Blatt in Lesegröße in einem Dialog – zum Kontrollieren von Pflichtangaben und Kleingedrucktem,
 * ohne die Vorschau neben dem Formular aufzublähen. Nur lesen (keine Bearbeitung im Blatt). */
import { useState, type ComponentProps } from 'react';
import { Maximize2, ScanSearch } from 'lucide-react';
import { Drawer } from '../ui/Drawer';
import { BlattVorschau } from './Blatt';

type Props = Pick<ComponentProps<typeof BlattVorschau>, 'doc' | 'bausteine'> & {
  titel?: string;
  /** nur das Symbol (volle Beschriftung als Tooltip) – für volle Werkzeugleisten */
  kompakt?: boolean;
};

export function BlattGross({ doc, bausteine, titel = 'Beleg in Lesegröße', kompakt = false }: Props) {
  const [offen, setOffen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={kompakt ? 'btn ghost icon-only' : 'btn ghost'}
        title="Groß ansehen – das Blatt in Lesegröße, z. B. um Pflichtangaben und Fußzeile zu lesen"
        aria-label={kompakt ? 'Groß ansehen' : undefined}
        onClick={() => setOffen(true)}
      >
        <Maximize2 />
        {kompakt ? null : 'Groß ansehen'}
      </button>
      <Drawer open={offen} onClose={() => setOffen(false)} title={titel} icon={ScanSearch} width={900} className="blatt-gross">
        {offen ? <BlattVorschau doc={doc} bausteine={bausteine} maxScale={1.6} className="blatt-gross-desk" /> : null}
      </Drawer>
    </>
  );
}
