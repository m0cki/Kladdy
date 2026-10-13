import { BookOpen } from 'lucide-react';
import { Placeholder } from '../../components/ui/Placeholder';
import { AuswertungKopf } from './AuswertungKopf';

export default function Steuer() {
  return (
    <div className="page">
      <AuswertungKopf />
      <Placeholder icon={BookOpen} title="Steuer & Export" text="EÜR, Kleinunternehmer-Check und Export kommen in Phase 5." />
    </div>
  );
}
