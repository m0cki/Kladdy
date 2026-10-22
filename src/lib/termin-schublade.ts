/* Die eine Termin-Schublade (§6.5): `terminNeu(vorgabe)` (Termine › „+ Termin eintragen“, Kunden-Schublade, Befehlspalette
 * über /termine?neu=1), `terminOeffnen(id)` (Zeile, Suche ⌘K über /termine?t=<id>, „Wieder einplanen“) und
 * `terminAbsagenFragen(id)` (Rückfrage mit Grund). Hängt im AppShell (components/termine/TerminSchublade.tsx).
 * `flash` hebt einen Termin nach einer Aktion kurz hervor (Seite Termine). */
import { create } from 'zustand';
import { useUi } from '../store/ui';
import type { BelegWahl } from './termine';

/** Vorbelegung eines neuen Termins (Prototyp App.neuerTermin). */
export interface TerminVorgabe {
  /** Kunden-ID (immer per ID, nie per Name) */
  kunde?: number;
  datum?: string;
  von?: string;
  bis?: string;
  adresse?: string;
  leistung?: string;
  /** Cent */
  betrag?: number;
  notiz?: string;
  beleg?: BelegWahl;
}

export type TerminAuftrag =
  | { art: 'neu'; vorgabe: TerminVorgabe; n: number }
  | { art: 'termin'; id: number; wieder: boolean; n: number }
  | { art: 'absagen'; id: number; ausSchublade: boolean; n: number };

interface TerminSchubladeState {
  auftrag: TerminAuftrag | null;
  /** zuletzt geänderter Termin (kurz hervorheben); `n` wechselt bei jeder Aktion */
  flash: { id: number; n: number; zeit: number } | null;
}

export const useTerminSchublade = create<TerminSchubladeState>(() => ({ auftrag: null, flash: null }));

let zaehler = 0;

function oeffne(auftrag: TerminAuftrag): void {
  useTerminSchublade.setState({ auftrag });
  const ui = useUi.getState();
  if (ui.drawer !== 'termin') ui.openDrawer('termin');
}

/** Neuer Termin, optional vorbelegt (z. B. mit dem Kunden aus der Kunden-Schublade). */
export const terminNeu = (vorgabe: TerminVorgabe = {}): void => oeffne({ art: 'neu', vorgabe, n: ++zaehler });

/** Termin ansehen bzw. bearbeiten; `wieder` = abgesagten Termin wieder einplanen. */
export const terminOeffnen = (id: number, wieder = false): void => oeffne({ art: 'termin', id, wieder, n: ++zaehler });

/** Rückfrage „Termin absagen“ mit optionalem Grund; aus der Schublade führt „Zurück“ wieder in sie. */
export const terminAbsagenFragen = (id: number, ausSchublade = false): void => oeffne({ art: 'absagen', id, ausSchublade, n: ++zaehler });

export function terminSchliessen(): void {
  const ui = useUi.getState();
  if (ui.drawer === 'termin') ui.closeDrawer();
}

/** Termin kurz hervorheben (Seite Termine scrollt ihn in Sicht). */
export const terminFlash = (id: number): void => useTerminSchublade.setState({ flash: { id, n: ++zaehler, zeit: Date.now() } });
