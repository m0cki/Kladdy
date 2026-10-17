/* Tectonic-Pfad (ANLEITUNG §3.1 „Tectonic finden“, §6.10 Einstellungen › Daten). Suchen und Prüfen in Rust
 * (src-tauri/src/tectonic.rs, dieselbe Suche wie später compile_latex); gespeichert wird der eigene Pfad in
 * einstellungen['tectonic_pfad'] (JSON-Text, null = automatisch). */
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { einstellungLesen, einstellungSchreiben } from './queries/einstellungen';

export type TectonicQuelle = 'mitgeliefert' | 'homebrew' | 'einstellung';

export interface TectonicFund {
  pfad: string;
  quelle: TectonicQuelle;
}

export interface TectonicStand {
  fund: TectonicFund | null;
  eingestellt: string | null;
  eingestellt_fehler: string | null;
}

export interface TectonicPruefung extends TectonicFund {
  version: string;
}

export const QUELLE_TEXT: Readonly<Record<TectonicQuelle, string>> = {
  mitgeliefert: 'mit Kladdy geliefert',
  homebrew: 'Homebrew',
  einstellung: 'eigener Pfad',
};

export const tectonicSuchen = (): Promise<TectonicStand> => invoke<TectonicStand>('tectonic_suchen');
export const tectonicPruefen = (): Promise<TectonicPruefung> => invoke<TectonicPruefung>('tectonic_pruefen');

/** Gespeicherter eigener Pfad (null = automatisch). */
export function pfadAusWert(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
export const ladeTectonicPfad = async (): Promise<string | null> => pfadAusWert(await einstellungLesen('tectonic_pfad'));

/** Prüft den Pfad in Rust (vorhanden, Datei, ausführbar) und speichert ihn. Wirft die Meldung bei ungültigem Pfad. */
export async function tectonicPfadSetzen(pfad: string): Promise<boolean> {
  await invoke<void>('tectonic_pfad_pruefen', { pfad });
  return einstellungSchreiben('tectonic_pfad', pfad.trim());
}

/** Zurück auf automatische Suche. */
export const tectonicAutomatisch = (): Promise<boolean> => einstellungSchreiben('tectonic_pfad', null);

/** Dateiauswahl für das Programm; null = abgebrochen. */
export async function tectonicWaehlen(): Promise<string | null> {
  const wahl = await open({ title: 'Tectonic auswählen', multiple: false, directory: false, defaultPath: '/opt/homebrew/bin' });
  return typeof wahl === 'string' ? wahl : null;
}
