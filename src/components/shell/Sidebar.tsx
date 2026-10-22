/* Seitenleiste (§6.1): Marke = Startseite, genau fünf Menüpunkte. Eingeklappt nur Icons, Name als Tooltip.
 * Auf der Einstellungsseite wird sie zur Einstellungs-Navigation: „Zurück“ (zur gemerkten Seite, wie Esc / ⚙)
 * und die Bereiche der Einstellungen – gleiche Optik wie die Menüpunkte (Wunsch des Nutzers).
 * .sb-head ist Ziehfläche des Fensters; links darin sitzen die Ampel-Knöpfe (§3.1). */
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { BEREICHE, bereichPfad, isEinstellungen } from '../../lib/einstellungen-index';
import { datenbankVerfuegbar } from '../../lib/db';
import { NAV, START } from '../../lib/navigation';
import { ladeOhneBelegAnzahl } from '../../lib/queries/buchungen';
import { ladeUeberfaelligAnzahl } from '../../lib/queries/rechnungen';
import { ladeTerminZaehler } from '../../lib/queries/termine';
import { heute } from '../../lib/zeitraum';
import { useUi } from '../../store/ui';
import { Marke } from '../ui/Firmenlogo';

const isActive = (path: string, to: string) => path === to || path.startsWith(to + '/');

/** Zähler an „Ein- & Ausgänge“: Zahlungen ohne Beleg (§6.1). Neu geladen nach jedem Schreiben (datenStand). */
function useOhneBeleg(): number {
  const stand = useUi((s) => s.datenStand);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!datenbankVerfuegbar()) return;
    let aktiv = true;
    ladeOhneBelegAnzahl()
      .then((x) => aktiv && setN(x))
      .catch(() => undefined);
    return () => {
      aktiv = false;
    };
  }, [stand]);
  return n;
}

/** Roter Zähler an „Rechnungen & Quittungen“: überfällige Rechnungen (§6.1). */
function useUeberfaellig(): number {
  const stand = useUi((s) => s.datenStand);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!datenbankVerfuegbar()) return;
    let aktiv = true;
    ladeUeberfaelligAnzahl(heute())
      .then((x) => aktiv && setN(x))
      .catch(() => undefined);
    return () => {
      aktiv = false;
    };
  }, [stand]);
  return n;
}

/** Zähler an „Termine“ (§6.1): heute; rot die nachzutragenden und die erledigten ohne Beleg. */
function useTermineZaehler(): { heute: number; offen: number } {
  const stand = useUi((s) => s.datenStand);
  const [n, setN] = useState({ heute: 0, offen: 0 });
  useEffect(() => {
    if (!datenbankVerfuegbar()) return;
    let aktiv = true;
    ladeTerminZaehler(heute())
      .then((x) => aktiv && setN(x))
      .catch(() => undefined);
    return () => {
      aktiv = false;
    };
  }, [stand]);
  return n;
}

function Hauptmenue({ pathname }: { pathname: string }) {
  const ohneBeleg = useOhneBeleg();
  const ueberfaellig = useUeberfaellig();
  const termine = useTermineZaehler();
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
                  {to === '/ein-ausgaenge' && ohneBeleg > 0 ? (
                    <span className="sb-badge" title={`${ohneBeleg} ohne Beleg`}>
                      {ohneBeleg}
                    </span>
                  ) : null}
                  {to === '/termine' && termine.offen > 0 ? (
                    <span className="sb-badge alarm" title={`${termine.offen} nachtragen bzw. ohne Beleg`}>
                      {termine.offen}
                    </span>
                  ) : to === '/termine' && termine.heute > 0 ? (
                    <span className="sb-badge" title={`${termine.heute} heute`}>
                      {termine.heute}
                    </span>
                  ) : null}
                  {to === '/belege' && ueberfaellig > 0 ? (
                    <span className="sb-badge alarm" title={`${ueberfaellig} überfällig`}>
                      {ueberfaellig}
                    </span>
                  ) : null}
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
          <Marke />
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
