/* Bausteine der Einstellungsseite. `id` landet als data-setting im DOM (Sprungziel der Suche, lib/einstellungen-index.ts). */
import type { ReactNode } from 'react';
import { reveal } from '../../components/ui/PageHead';

export function SetRow({ id, label, value, children }: { id: string; label: string; value?: string; children: ReactNode }) {
  return (
    <div className="set-row" data-setting={id}>
      <div className="set-label">
        <span>{label}</span>
        {value ? <output>{value}</output> : null}
      </div>
      {children}
    </div>
  );
}

export function SetCard({ title, i = 1, children }: { title: string; i?: number; children: ReactNode }) {
  return (
    <section className="card set-card reveal" style={reveal(i)}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
