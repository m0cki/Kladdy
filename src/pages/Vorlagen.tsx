import { Blocks } from 'lucide-react';
import { PageHead } from '../components/ui/PageHead';
import { Placeholder } from '../components/ui/Placeholder';

/* Vorlagen-Baukasten (§7) – kommt in Phase 3. */
export default function Vorlagen() {
  return (
    <div className="page">
      <PageHead
        icon={Blocks}
        title="Vorlagen"
        sub="Belege aus Bausteinen zusammenstellen – ohne LaTeX. Die App erzeugt daraus im Hintergrund das PDF."
        back={{ to: '/belege', label: 'Rechnungen & Quittungen' }}
      />
      <Placeholder icon={Blocks} title="Baukasten" text="Bausteine, Vorschau und PDF-Export kommen in Phase 3." />
    </div>
  );
}
