import { Blocks, FilePlus, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHead } from '../components/ui/PageHead';
import { Placeholder } from '../components/ui/Placeholder';

/* Rechnungen & Quittungen (§6.6) – Liste kommt in Phase 3. Unterseiten: Beleg-Maske, Vorlagen. */
export default function Belege() {
  return (
    <div className="page">
      <PageHead
        icon={FileText}
        title="Rechnungen & Quittungen"
        sub="Alle Belege mit laufender Nummer · es zählt das Belegdatum"
        actions={
          <>
            <Link className="btn ghost" to="/belege/vorlagen" title="Quittung & Rechnung aus Bausteinen gestalten">
              <Blocks />
              Vorlagen
            </Link>
            <Link className="btn ghost" to="/belege/neu" title="Neuer Beleg">
              <FilePlus />
              Neu
            </Link>
          </>
        }
      />
      <Placeholder icon={FileText} title="Noch keine Belege" text="Die Liste nach Nummern mit Filtern kommt in Phase 3." />
    </div>
  );
}
