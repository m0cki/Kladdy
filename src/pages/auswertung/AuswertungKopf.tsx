/* Auswertung: Titel + großer Umschalter mit vier Reitern (§6.9, §9.3). Jeder Reiter hat eine eigene Adresse.
 * Rechts im Kopf optional Bedienelemente des Reiters (Überblick: Zeitraum), wie App.auswertungKopf im Prototyp. */
import type { ReactNode } from 'react';
import { ChartColumn } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { AUSWERTUNG } from '../../lib/navigation';
import { PageHead, reveal } from '../../components/ui/PageHead';

export function AuswertungKopf({ aktionen }: { aktionen?: ReactNode }) {
  return (
    <>
      <PageHead icon={ChartColumn} title="Auswertung" className="ausw-head" actions={aktionen} />
      <nav className="ausw-switch reveal" style={reveal(0)} aria-label="Bereiche der Auswertung">
        {AUSWERTUNG.map(({ to, label, sub, icon: Icon }) => (
          <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon />
            <span>
              <b>{label}</b>
              <small>{sub}</small>
            </span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}
