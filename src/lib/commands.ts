/* Globale Befehle – aus dem nativen Menü, aus Tastenkürzeln (Browser) und aus der Suche (später Befehlspalette, §6.2).
 * Echt: Erfassen (⌘N, die eine Erfassen-Schublade), Beleg importieren (⌘O, wie ein Datei-Drop), Hell/Dunkel, Seitenleiste, Nach Updates suchen, Über Kladdy.
 * Der Rest meldet, in welcher Phase er kommt. */
import { toggleMode, useUi } from '../store/ui';
import { belegImportieren } from './belegablage';
import { bereichPfad } from './einstellungen-index';
import { erfassen } from './erfassen';
import type { MenuId } from './menu';
import { checkForUpdate } from './updates';

const SPAETER: Partial<Record<MenuId, string>> = {
  quittung: 'Quittung schreiben (über die Erfassen-Schublade) kommt in Phase 3',
  rechnung: 'Rechnung schreiben (über die Erfassen-Schublade) kommt in Phase 3',
  export: 'Export kommt in Phase 5',
};

export interface CommandContext {
  /** Klickpunkt (für die Enthüllung beim Hell/Dunkel-Wechsel) */
  origin?: { x: number; y: number };
  /** Router-Navigation (aus AppShell) */
  navigate?: (to: string) => void;
}

export function runCommand(id: MenuId, ctx: CommandContext = {}): void {
  const ui = useUi.getState();
  if (id === 'erfassen') erfassen();
  else if (id === 'importieren') void belegImportieren();
  else if (id === 'hell-dunkel') toggleMode(ctx.origin);
  else if (id === 'seitenleiste') ui.toggleSidebar();
  else if (id === 'updates') void checkForUpdate({ manual: true });
  else if (id === 'ueber') ctx.navigate?.(bereichPfad('updates'));
  else ui.toast(SPAETER[id] ?? 'Kommt später', 'info');
}
