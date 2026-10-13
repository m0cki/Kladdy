/* Fensterzustand für die Mac-Titelleiste (§3.1).
 * Setzt <html data-fenster="fenster|vollbild">: Im Fenster liegen die Ampel-Knöpfe über der Marke,
 * im Vollbild gibt es keine Ampel, die Marke rückt nach links. Außerhalb von Tauri bleibt das Attribut leer. */
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/** Beobachtet den Vollbildmodus. Gibt eine Abmelde-Funktion zurück. */
export function watchFenster(): () => void {
  if (!isTauri()) return () => {};
  const win = getCurrentWindow();
  const root = document.documentElement;
  let cancelled = false;
  let unlisten: (() => void) | null = null;

  const update = () =>
    win.isFullscreen().then((voll) => {
      if (!cancelled) root.dataset.fenster = voll ? 'vollbild' : 'fenster';
    });

  root.dataset.fenster = 'fenster';
  void update();
  win
    .onResized(() => void update())
    .then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

  return () => {
    cancelled = true;
    unlisten?.();
    delete root.dataset.fenster;
  };
}
