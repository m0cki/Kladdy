/* App-Rahmen: Aurora, Seitenleiste, Kopfzeile, Inhalt, Schubladen, Toasts, Update-Prüfung beim Start.
 * Datei-Drop aufs Fenster: lib/belegablage.ts (Overlay „Beleg hier ablegen“).
 * Globale Kürzel: In der Mac-App gehören ⌘N, ⌘O, ⇧⌘L und ⌘\ dem nativen Menü (Events über lib/menu.ts);
 * im Browser (npm run dev) übernimmt sie der Tastatur-Handler hier. ⌘K (Suche) ist immer Sache der Oberfläche. */
import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { watchBelegDrop } from '../../lib/belegablage';
import { runCommand } from '../../lib/commands';
import { watchFenster } from '../../lib/fenster';
import { inTauri, onMenu, type MenuId } from '../../lib/menu';
import { isEinstellungen } from '../../lib/einstellungen-index';
import { autoCheckOnStart } from '../../lib/updates';
import { useUi } from '../../store/ui';
import { Toasts } from '../ui/Toasts';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { UpdateNotesDrawer } from './UpdateNotesDrawer';
import { ErfassenSchublade } from '../erfassen/ErfassenSchublade';
import { BelegDropOverlay } from '../belege/BelegDropOverlay';

export function AppShell() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const closeDrawer = useUi((s) => s.closeDrawer);
  const setZurueck = useUi((s) => s.setZurueck);
  const searchRef = useRef<HTMLInputElement>(null);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  // aktuelle navigate-Funktion für Menü-Events (Listener wird nur einmal angemeldet)
  const navRef = useRef(navigate);
  useEffect(() => {
    navRef.current = navigate;
  }, [navigate]);

  useEffect(() => onMenu((id) => runCommand(id, { navigate: (to) => navRef.current(to) })), []);
  useEffect(() => watchFenster(), []);
  // Datei aufs Fenster ziehen ⇒ Beleg ablegen (nur Mac-App)
  useEffect(() => watchBelegDrop(), []);
  // Update-Prüfung beim Start: höchstens einmal am Tag, nur wenn eingeschaltet (§3.2)
  useEffect(() => autoCheckOnStart(), []);

  // Rückweg aus den Einstellungen merken
  useEffect(() => {
    if (!isEinstellungen(pathname)) setZurueck(pathname + search);
  }, [pathname, search, setZurueck]);

  useEffect(() => {
    const native = inTauri();
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'k' && !e.shiftKey) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (native) return; // sonst doppelt: das native Menü löst die Aktion bereits aus
      let id: MenuId | null = null;
      if (e.key === '\\') id = 'seitenleiste';
      else if (k === 'l' && e.shiftKey) id = 'hell-dunkel';
      else if (k === 'n' && !e.shiftKey) id = 'erfassen';
      else if (k === 'o' && !e.shiftKey) id = 'importieren';
      if (id) {
        e.preventDefault();
        runCommand(id, { navigate: (to) => navRef.current(to) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Seitenwechsel: offene Schublade schließen (außer einer Erfassen-Schublade mit ungespeicherten Eingaben), nach oben scrollen
  useEffect(() => {
    const { drawer, ungespeichert } = useUi.getState();
    if (!(drawer === 'erfassen' && ungespeichert)) closeDrawer();
    window.scrollTo({ top: 0 });
  }, [pathname, closeDrawer]);

  return (
    <>
      <div className="aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className={`app ${collapsed ? 'sb-collapsed' : ''}`} id="app">
        <Sidebar />
        <div className="main">
          <Topbar ref={searchRef} />
          <main className="content" id="content">
            <Outlet />
          </main>
        </div>
      </div>
      <UpdateNotesDrawer />
      <ErfassenSchublade />
      <BelegDropOverlay />
      <Toasts />
    </>
  );
}
