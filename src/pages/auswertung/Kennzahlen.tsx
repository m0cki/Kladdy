import { Sigma } from 'lucide-react';
import { Placeholder } from '../../components/ui/Placeholder';
import { AuswertungKopf } from './AuswertungKopf';

export default function Kennzahlen() {
  return (
    <div className="page">
      <AuswertungKopf />
      <Placeholder icon={Sigma} title="Kennzahlen" text="Eigene Kennzahlen mit Formel-Editor kommen in Phase 4." />
    </div>
  );
}
