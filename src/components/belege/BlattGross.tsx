/* „Groß ansehen“: das Blatt in Lesegröße in einem Dialog – zum Kontrollieren von Pflichtangaben und Kleingedrucktem,
 * ohne die Vorschau neben dem Formular aufzublähen. Nur lesen (keine Bearbeitung im Blatt). */
import { useState, type ComponentProps } from 'react';
import { Maximize2, ScanSearch } from 'lucide-react';
import { Drawer } from '../ui/Drawer';
import { BlattVorschau } from './Blatt';

type Props = Pick<ComponentProps<typeof BlattVorschau>, 'doc' | 'bausteine'> & { titel?: string };

export function BlattGross({ doc, bausteine, titel = 'Beleg in Lesegröße' }: Props) {
  const [offen, setOffen] = useState(false);
  return (
    <>
      <button type="button" className="btn ghost" title="Das Blatt groß ansehen, z. B. um Pflichtangaben und Fußzeile zu lesen" onClick={() => setOffen(true)}>
        <Maximize2 />
        Groß ansehen
      </button>
      <Drawer open={offen} onClose={() => setOffen(false)} title={titel} icon={ScanSearch} width={900} className="blatt-gross">
        {offen ? <BlattVorschau doc={doc} bausteine={bausteine} maxScale={1.6} className="blatt-gross-desk" /> : null}
      </Drawer>
    </>
  );
}
