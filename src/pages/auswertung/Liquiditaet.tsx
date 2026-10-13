import { Waves } from 'lucide-react';
import { Placeholder } from '../../components/ui/Placeholder';
import { AuswertungKopf } from './AuswertungKopf';

export default function Liquiditaet() {
  return (
    <div className="page">
      <AuswertungKopf />
      <Placeholder icon={Waves} title="Liquidität" text="Prognose für 30/60/90 Tage mit Annahmen und Planposten kommt in Phase 2." />
    </div>
  );
}
