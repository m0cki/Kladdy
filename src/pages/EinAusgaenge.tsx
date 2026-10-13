import { ArrowLeftRight, Plus } from 'lucide-react';
import { runCommand } from '../lib/commands';
import { PageHead } from '../components/ui/PageHead';
import { Placeholder } from '../components/ui/Placeholder';

/* Startseite (§6.3). Die eine Hauptaktion „+ Erfassen“ sitzt hier im Seitenkopf (⌘N von überall). */
export default function EinAusgaenge() {
  return (
    <div className="page">
      <PageHead
        icon={ArrowLeftRight}
        title="Ein- & Ausgänge"
        sub="Alle geschäftlichen Zahlungen · es zählt das Zahlungsdatum"
        actions={
          <button type="button" className="btn-primary head-add" title="Einnahme oder Ausgabe erfassen (⌘N)" onClick={() => runCommand('erfassen')}>
            <Plus />
            <span>Erfassen</span>
          </button>
        }
      />
      <Placeholder icon={ArrowLeftRight} title="Noch keine Einträge" text="Die Liste mit Filterleiste und die Erfassen-Schublade kommen in Phase 1." />
    </div>
  );
}
