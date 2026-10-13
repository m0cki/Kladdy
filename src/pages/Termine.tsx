import { CalendarDays, Plus } from 'lucide-react';
import { PageHead } from '../components/ui/PageHead';
import { Placeholder } from '../components/ui/Placeholder';
import { useUi } from '../store/ui';

/* Termine (§6.5) – kommt in Phase 3. */
export default function Termine() {
  const toast = useUi((s) => s.toast);
  return (
    <div className="page">
      <PageHead
        icon={CalendarDays}
        title="Termine"
        sub="Kundentermine – auf Wunsch mit vorbereiteter Quittung"
        actions={
          <button type="button" className="btn-primary head-add" onClick={() => toast('Termine kommen in Phase 3', 'info')}>
            <Plus />
            Termin eintragen
          </button>
        }
      />
      <Placeholder icon={CalendarDays} title="Noch keine Termine" text="Agenda und Termin-Schublade kommen in Phase 3." />
    </div>
  );
}
