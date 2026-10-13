/* Kopfzeile (§6.2): links Seitenleisten-Knopf, Mitte Suche (⌘K), rechts nur Hell/Dunkel · ⚙.
 * Kein Erfassen-Knopf hier. Die ganze Leiste ist Ziehfläche des Fensters (Knöpfe/Eingaben ausgenommen). */
import { forwardRef } from 'react';
import { Moon, Search, Settings, Sun } from 'lucide-react';
import { toggleMode, useEffectiveMode, useUi } from '../../store/ui';
import { PanelIcon } from '../ui/PanelIcon';

export const Topbar = forwardRef<HTMLInputElement>(function Topbar(_props, searchRef) {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const openDrawer = useUi((s) => s.openDrawer);
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
      <div className="search" id="search">
        <Search className="search-ic" />
        <input
          ref={searchRef}
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Suchen oder Befehl …"
          title="Einträge, Belege, Termine, Kunden, Kennzahlen und Befehle durchsuchen"
          aria-label="Suchen"
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
        />
        <kbd>⌘K</kbd>
      </div>
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
        <button type="button" className="icon-btn tb-gear" title="Einstellungen" aria-label="Einstellungen" onClick={() => openDrawer('settings')}>
          <Settings />
        </button>
      </div>
    </header>
  );
});
