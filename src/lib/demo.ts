/* Demo-Daten (ANLEITUNG §10 Phase 1 Teil 6, §6.10 Einstellungen › Daten). NUR in der Entwicklung (`npm run tauri dev`):
 * Die Rust-Seite (src-tauri/src/demo.rs) gibt es nur im Debug-Build; hier ist alles hinter `import.meta.env.DEV`, und
 * der Generator (seed/demo-daten.ts) wird erst beim Laden dynamisch importiert, damit er nicht im Release-Bundle landet.
 * Die Demo-Daten liegen in einer eigenen Datenbankdatei; Laden und Entfernen schalten um, danach lädt die Oberfläche neu. */
import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { inTauri } from './menu';
import { heute } from './zeitraum';

/** Demo-Daten gibt es nur im Entwicklungs-Build der Mac-App. */
export const DEMO_MOEGLICH = import.meta.env.DEV;

export interface DemoErgebnis {
  kunden: number;
  buchungen: number;
  belege: number;
  termine: number;
}

/** Ist gerade die Demo-Datenbank geöffnet? (für den Hinweis in der Kopfzeile und die Einstellungen) */
export const useDemo = create<{ aktiv: boolean }>(() => ({ aktiv: false }));

/** Fragt den Modus bei Rust ab. Außerhalb der Entwicklung oder im Browser immer aus. */
export async function demoStatusLaden(): Promise<boolean> {
  if (!import.meta.env.DEV || !inTauri()) return false;
  const s = await invoke<{ aktiv: boolean }>('demo_status');
  useDemo.setState({ aktiv: s.aktiv });
  return s.aktiv;
}

/** Erzeugt die Demo-Daten (relativ zu heute) und legt die Demo-Datenbank an. Danach `neuStarten()`. */
export async function demoLaden(): Promise<DemoErgebnis> {
  if (import.meta.env.DEV) {
    const { demoDaten } = await import('./seed/demo-daten');
    return invoke<DemoErgebnis>('demo_laden', { daten: demoDaten(heute()) });
  }
  throw new Error('Demo-Daten gibt es nur in der Entwicklerversion.');
}

/** Löscht Demo-Datenbank und Demo-Belege und schaltet zurück auf die echte Datenbank. Danach `neuStarten()`. */
export async function demoEntfernen(): Promise<void> {
  if (import.meta.env.DEV) return invoke<void>('demo_entfernen');
  throw new Error('Demo-Daten gibt es nur in der Entwicklerversion.');
}

/** Oberfläche neu laden: öffnet die jetzt aktive Datenbank und lädt alle Listen frisch. */
export const neuStarten = (): void => window.location.reload();
