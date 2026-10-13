/* Seitenleiste (§6.1): Marke = Startseite, genau fünf Menüpunkte. Eingeklappt nur Icons, Name als Tooltip.
 * Auf der Einstellungsseite wird sie zur Einstellungs-Navigation: „Zurück“ (zur gemerkten Seite, wie Esc / ⚙)
 * und die Bereiche der Einstellungen – gleiche Optik wie die Menüpunkte (Wunsch des Nutzers).
 * .sb-head ist Ziehfläche des Fensters; links darin sitzen die Ampel-Knöpfe (§3.1). */
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { BEREICHE, bereichPfad, isEinstellungen } from '../../lib/einstellungen-index';
import { NAV, START } from '../../lib/navigation';
import { useUi } from '../../store/ui';
import { Logo } from '../ui/Logo';

const isActive = (path: string, to: string) => path === to || path.startsWith(to + '/');

function Hauptmenue({ pathname }: { pathname: string }) {
  return (
    <nav className="sb-scroll sb-swap" data-modus="haupt" aria-label="Hauptmenü">
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
  );
}

function EinstellungsMenue({ pathname }: { pathname: string }) {
  const zurueck = useUi((s) => s.zurueck);
  return (
    <nav className="sb-scroll sb-swap" data-modus="einstellungen" aria-label="Einstellungen">
      <div className="sb-section">
        <ul className="sb-list">
          <li className="sb-item sb-nav sb-back">
            <Link to={zurueck || START} title="Zurück (Esc)">
              <ArrowLeft />
              <span className="sb-label">Zurück</span>
            </Link>
          </li>
        </ul>
      </div>
      <div className="sb-section">
        <div className="sb-title">Einstellungen</div>
        <ul className="sb-list">
          {BEREICHE.map(({ id, label, icon: Icon, phase }) => {
            const to = bereichPfad(id);
            const active = isActive(pathname, to);
            return (
              <li key={id} className={`sb-item sb-nav ${active ? 'active' : ''}`}>
                <Link to={to} title={phase ? `${label} (kommt mit Phase ${phase})` : label} aria-current={active ? 'page' : undefined}>
                  <Icon />
                  <span className="sb-label">{label}</span>
                  {phase ? <span className="sb-badge phase">Phase {phase}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

export function Sidebar() {
  const { pathname } = useLocation();
  const einstellungen = isEinstellungen(pathname);
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
      {/* key: beim Wechsel neu einhängen, damit die Einblend-Animation läuft */}
      {einstellungen ? <EinstellungsMenue key="einstellungen" pathname={pathname} /> : <Hauptmenue key="haupt" pathname={pathname} />}
    </aside>
  );
}
