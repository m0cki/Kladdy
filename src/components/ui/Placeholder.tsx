/* Platzhalter-Karte für Bereiche, die in einer späteren Phase gebaut werden. */
import type { LucideIcon } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { reveal } from './PageHead';

export function Placeholder({ icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <section className="card reveal" style={reveal(1)}>
      <EmptyState icon={icon} title={title}>
        {text}
      </EmptyState>
    </section>
  );
}
