import { Plus, Users } from 'lucide-react';
import { PageHead } from '../components/ui/PageHead';
import { Placeholder } from '../components/ui/Placeholder';
import { useUi } from '../store/ui';

/* Kunden (§6.8) – kommt in Phase 1. */
export default function Kunden() {
  const toast = useUi((s) => s.toast);
  return (
    <div className="page">
      <PageHead
        icon={Users}
        title="Kunden"
        sub="Bei wem du warst – wann und was gemacht wurde"
        actions={
          <button type="button" className="btn-primary head-add" onClick={() => toast('Kunden kommen in Phase 1', 'info')}>
            <Plus />
            Kunde anlegen
          </button>
        }
      />
      <Placeholder icon={Users} title="Noch keine Kunden" text="Kundenliste mit Verlauf kommt in Phase 1." />
    </div>
  );
}
