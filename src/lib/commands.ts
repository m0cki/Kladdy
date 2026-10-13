/* Globale Befehle – aus dem nativen Menü, aus Tastenkürzeln (Browser) und später aus der Befehlspalette.
 * Phase 0: nur Hell/Dunkel und Seitenleiste sind echt, der Rest meldet, in welcher Phase er kommt. */
import { toggleMode, useUi } from '../store/ui';
import type { MenuId } from './menu';

const SPAETER: Partial<Record<MenuId, string>> = {
  erfassen: 'Die Erfassen-Schublade kommt in Phase 1',
  quittung: 'Quittung schreiben (über die Erfassen-Schublade) kommt in Phase 3',
  rechnung: 'Rechnung schreiben (über die Erfassen-Schublade) kommt in Phase 3',
  importieren: 'Beleg importieren kommt in Phase 1',
  export: 'Export kommt in Phase 5',
  updates: 'Die Update-Prüfung kommt in Phase 6',
  ueber: '„Über Kladdy“ kommt in Phase 6',
};

export function runCommand(id: MenuId, origin?: { x: number; y: number }): void {
  const ui = useUi.getState();
  if (id === 'hell-dunkel') toggleMode(origin);
  else if (id === 'seitenleiste') ui.toggleSidebar();
  else ui.toast(SPAETER[id] ?? 'Kommt später', 'info');
}
