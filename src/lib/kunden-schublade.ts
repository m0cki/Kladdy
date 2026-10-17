/* Die Kunden-Schublade (§6.8): `kundeOeffnen(id)` zeigt einen Kunden (Kopf, Notiz, Stammdaten, Verlauf),
 * `kundeNeu(name)` öffnet dieselbe Schublade zum Anlegen. Hängt im AppShell (components/kunden/KundeSchublade.tsx). */
import { create } from 'zustand';
import { useUi } from '../store/ui';

export type KundeAuftrag = { art: 'kunde'; id: number; n: number } | { art: 'neu'; name: string; n: number };

/** Was die Schublade zeigen soll. `n` wechselt bei jedem Öffnen ⇒ Formular neu aufbauen. */
export const useKundeSchublade = create<{ auftrag: KundeAuftrag | null }>(() => ({ auftrag: null }));

let zaehler = 0;

function oeffne(auftrag: KundeAuftrag): void {
  useKundeSchublade.setState({ auftrag });
  const ui = useUi.getState();
  if (ui.drawer !== 'kunde') ui.openDrawer('kunde');
}

export const kundeOeffnen = (id: number): void => oeffne({ art: 'kunde', id, n: ++zaehler });

export const kundeNeu = (name = ''): void => oeffne({ art: 'neu', name, n: ++zaehler });

export function kundeSchliessen(): void {
  const ui = useUi.getState();
  if (ui.drawer === 'kunde') ui.closeDrawer();
}
