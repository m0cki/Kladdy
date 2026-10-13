/* Auswertung: Titel + großer Umschalter mit vier Reitern (§6.9, §9.3). Jeder Reiter hat eine eigene Adresse. */
import { ChartColumn } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { AUSWERTUNG } from '../../lib/navigation';
import { PageHead, reveal } from '../../components/ui/PageHead';

export function AuswertungKopf() {
  return (
    <>
      <PageHead icon={ChartColumn} title="Auswertung" className="ausw-head" />
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
