import { FileText } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { PageHead } from '../components/ui/PageHead';
import { Placeholder } from '../components/ui/Placeholder';

/* Beleg-Maske (§6.6): eine Maske für Rechnung, Quittung, Angebot und Eigenbeleg – kommt in Phase 3. */
export default function BelegEditor() {
  const { id } = useParams();
  const neu = !id || id === 'neu';
  return (
    <div className="page">
      <PageHead
        icon={FileText}
        title={neu ? 'Neuer Beleg' : 'Beleg'}
        sub="Eine Maske für Rechnung, Quittung, Angebot und Eigenbeleg – mit Live-Vorschau"
        back={{ to: '/belege', label: 'Rechnungen & Quittungen' }}
      />
      <Placeholder icon={FileText} title="Beleg-Maske" text="Formular, Live-Vorschau und Pflichtangaben-Check kommen in Phase 3." />
    </div>
  );
}
