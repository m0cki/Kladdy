/* Firmenlogo (§6.10): Einstellung `firmenlogo` (Dateiname oder '', jede Änderung ins Protokoll) und die Rust-Commands
 * aus src-tauri/src/firmenlogo.rs. Abgelegte Logos ändern sich nie (Name = Prüfsumme): ihre Bytes werden je Name
 * einmal gelesen und gemerkt (Seitenleiste, Vorschau, PDF). */
import { invoke } from '@tauri-apps/api/core';
import { logoAusWert } from '../firmenlogo';
import { einstellungLesen, einstellungSchreiben } from './einstellungen';

/** Aktuelles Logo: Dateiname oder '' (App-Symbol). */
export const ladeFirmenlogo = async (): Promise<string> => logoAusWert(await einstellungLesen('firmenlogo'));
/** Logo setzen ('' = zurück zum App-Symbol). false = keine Änderung. */
export const speichereFirmenlogo = (name: string): Promise<boolean> => einstellungSchreiben('firmenlogo', name);

/** Bytes der gewählten bzw. gezogenen Bilddatei (Rust prüft Typ und Größe, legt nichts ab). */
export const logoQuelleLesen = (pfad: string): Promise<ArrayBuffer> => invoke<ArrayBuffer>('firmenlogo_quelle_lesen', { pfad });

/** Verkleinertes PNG ablegen (Rust prüft es, nie überschreiben). */
export const logoAblegen = (png: Uint8Array): Promise<{ name: string; neu: boolean }> =>
  invoke<{ name: string; neu: boolean }>('firmenlogo_ablegen', { png: Array.from(png) });

const gelesen = new Map<string, Promise<Uint8Array>>();

/** Bytes eines abgelegten Logos (gemerkt; ein Fehler wird nicht gemerkt, der nächste Aufruf versucht es neu). */
export function logoBytes(name: string): Promise<Uint8Array> {
  const da = gelesen.get(name);
  if (da) return da;
  const neu = invoke<ArrayBuffer>('firmenlogo_lesen', { name }).then((b) => new Uint8Array(b));
  gelesen.set(name, neu);
  neu.catch(() => gelesen.delete(name));
  return neu;
}
