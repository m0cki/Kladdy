/* Seitenleiste (§6.1): Marke = Startseite, genau fünf Menüpunkte. Eingeklappt nur Icons, Name als Tooltip.
 * .sb-head ist Ziehfläche des Fensters; links darin sitzen die Ampel-Knöpfe (§3.1). */
import { Link, useLocation } from 'react-router-dom';
import { NAV, START } from '../../lib/navigation';
import { Logo } from '../ui/Logo';

const isActive = (path: string, to: string) => path === to || path.startsWith(to + '/');

export function Sidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="sidebar" id="sidebar">
      <div className="sb-head" data-tauri-drag-region="deep">
        <Link className="brand" to={START} title="Zu Ein- & Ausgänge" aria-label="Kladdy – Startseite">
          <Logo />
          <span className="brand-text">
            <b>Kladdy</b>
            <small>Kleingewerbe</small>
          </span>
        </Link>
      </div>
      <nav className="sb-scroll" aria-label="Hauptmenü">
        <div className="sb-section">
          <ul className="sb-list">
            {NAV.map(({ to, label, icon: Icon }) => {
              const active = isActive(pathname, to);
              return (
                <li key={to} className={`sb-item sb-nav ${active ? 'active' : ''}`}>
                  <Link to={to} title={label} aria-current={active ? 'page' : undefined}>
                    <Icon />
                    <span className="sb-label">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </aside>
  );
}
