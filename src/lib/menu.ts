/* Native Menüleiste (src-tauri/src/lib.rs) → Frontend.
 * Rust sendet bei Klick auf einen eigenen Menüpunkt das Event „menu“ mit dessen ID.
 * Im reinen Browser (npm run dev ohne Tauri) übernehmen Tastenkürzel in AppShell dieselben Aktionen. */
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const MENU_IDS = [
  'ueber',
  'erfassen',
  'quittung',
  'rechnung',
  'importieren',
  'export',
  'updates',
  'hell-dunkel',
  'seitenleiste',
] as const;
export type MenuId = (typeof MENU_IDS)[number];

const isMenuId = (v: unknown): v is MenuId => typeof v === 'string' && (MENU_IDS as readonly string[]).includes(v);

/** Menü-Events abonnieren. Gibt eine Abmelde-Funktion zurück (auch außerhalb von Tauri gefahrlos). */
export function onMenu(handler: (id: MenuId) => void): () => void {
  if (!isTauri()) return () => {};
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  listen<string>('menu', (e) => {
    if (isMenuId(e.payload)) handler(e.payload);
  })
    .then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    })
    .catch(() => {
      /* ohne Event-System (z. B. Tests) einfach nichts tun */
    });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Läuft die Oberfläche in der Mac-App? Dann gehören die globalen Kürzel dem nativen Menü. */
export const inTauri = (): boolean => isTauri();
