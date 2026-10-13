import { LayoutDashboard } from 'lucide-react';
import { Placeholder } from '../../components/ui/Placeholder';
import { AuswertungKopf } from './AuswertungKopf';

export default function Ueberblick() {
  return (
    <div className="page">
      <AuswertungKopf />
      <Placeholder icon={LayoutDashboard} title="Überblick" text="Status, KPI-Reihe und Diagramme kommen in Phase 2." />
    </div>
  );
}
