/* Kopfzeile (§6.2): links Seitenleisten-Knopf, Mitte Suche (⌘K), rechts nur Hell/Dunkel · ⚙ (Einstellungsseite).
 * Kein Erfassen-Knopf hier. Die ganze Leiste ist Ziehfläche des Fensters (Knöpfe/Eingaben ausgenommen). */
import { forwardRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Moon, Settings, Sun } from 'lucide-react';
import { EINSTELLUNGEN_PFAD, isEinstellungen } from '../../lib/einstellungen-index';
import { START } from '../../lib/navigation';
import { toggleMode, useEffectiveMode, useUi } from '../../store/ui';
import { PanelIcon } from '../ui/PanelIcon';
import { Suche } from './Suche';

export const Topbar = forwardRef<HTMLInputElement>(function Topbar(_props, searchRef) {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const zurueck = useUi((s) => s.zurueck);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const aufEinstellungen = isEinstellungen(pathname);
  const mode = useEffectiveMode();
  const sbLabel = collapsed ? 'Seitenleiste ausklappen (⌘\\)' : 'Seitenleiste einklappen (⌘\\)';
  const modeLabel = mode === 'dark' ? 'Hell (⇧⌘L)' : 'Dunkel (⇧⌘L)';

  return (
    <header className="topbar" data-tauri-drag-region="deep">
      <div className="tb-left">
        <button
          type="button"
          className="icon-btn sb-toggle"
          onClick={toggleSidebar}
          title={sbLabel}
          aria-label={sbLabel}
          aria-expanded={!collapsed}
          aria-controls="sidebar"
        >
          <PanelIcon />
        </button>
      </div>
      <Suche ref={searchRef} />
      <div className="tb-actions">
        <button
          type="button"
          className="icon-btn"
          title={modeLabel}
          aria-label={modeLabel}
          onClick={(e) => toggleMode({ x: e.clientX, y: e.clientY })}
        >
          {mode === 'dark' ? <Sun /> : <Moon />}
        </button>
        <button
          type="button"
          className={`icon-btn tb-gear ${aufEinstellungen ? 'active' : ''}`}
          title={aufEinstellungen ? 'Einstellungen schließen (Esc)' : 'Einstellungen'}
          aria-label="Einstellungen"
          aria-pressed={aufEinstellungen}
          // ⚙ öffnet die Einstellungsseite; erneut ⚙ führt zur vorherigen Seite zurück
          onClick={() => navigate(aufEinstellungen ? zurueck || START : EINSTELLUNGEN_PFAD)}
        >
          <Settings />
        </button>
      </div>
    </header>
  );
});
