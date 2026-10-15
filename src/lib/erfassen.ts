/* Der eine Erfassen-Weg (§6, §6.4): `erfassen(vorbelegung)` öffnet die Erfassen-Schublade von jeder Seite aus
 * („+ Erfassen“ im Kopf von Ein- & Ausgänge, ⌘N, Befehlspalette; andere Seiten nur vorbelegt). `bearbeiten(id)` öffnet
 * dieselbe Schublade mit einer bestehenden Buchung. Mit ungespeicherten Eingaben wird vorher nachgefragt
 * (Toast „Verwerfen“ / „Weiter bearbeiten“), ebenso beim Schließen. */
import { create } from 'zustand';
import { useUi } from '../store/ui';
import type { BuchungTyp, Zahlungsart } from './buchungen';

export interface Vorbelegung {
  typ?: BuchungTyp;
  /** Cent */
  betrag?: number;
  /** Beschreibung */
  text?: string;
  /** Zahlungsdatum 'YYYY-MM-DD' */
  datum?: string;
  /** Kunden-ID (immer eine Einnahme) */
  kunde?: number;
  /** Geschäft (Ausgabe) */
  lieferant?: string;
  zahlungsart?: Zahlungsart;
  belegnummer?: string;
}

export type Auftrag = { art: 'neu'; vorbelegung: Vorbelegung; n: number } | { art: 'bearbeiten'; id: number; n: number };

interface ErfassenState {
  auftrag: Auftrag | null;
}

/** Was die Schublade gerade zeigen soll. `n` wechselt bei jedem Öffnen ⇒ Formular neu aufbauen. */
export const useErfassen = create<ErfassenState>(() => ({ auftrag: null }));

let zaehler = 0;
const FRAGE = 'erfassen-frage';

function frageToastWeg(): void {
  const ui = useUi.getState();
  const t = ui.toasts.find((x) => x.key === FRAGE);
  if (t) ui.dismissToast(t.id);
}

/** Bei ungespeicherten Eingaben erst nachfragen, sonst gleich `weiter`. */
function nachVerwerfen(text: string, weiter: () => void): void {
  const ui = useUi.getState();
  if (ui.drawer !== 'erfassen' || !ui.ungespeichert) {
    frageToastWeg();
    weiter();
    return;
  }
  ui.showToast({
    key: FRAGE,
    text,
    icon: 'warn',
    sticky: true,
    actions: [
      {
        label: 'Verwerfen',
        run: () => {
          frageToastWeg();
          useUi.getState().setUngespeichert(false);
          weiter();
        },
      },
      { label: 'Weiter bearbeiten', run: frageToastWeg },
    ],
  });
}

function oeffne(auftrag: Auftrag): void {
  useErfassen.setState({ auftrag });
  const ui = useUi.getState();
  if (ui.drawer === 'erfassen') ui.setUngespeichert(false);
  else ui.openDrawer('erfassen');
}

/** Neue Einnahme/Ausgabe erfassen, optional vorbelegt. */
export function erfassen(vorbelegung: Vorbelegung = {}): void {
  nachVerwerfen('Die offene Eingabe ist noch nicht gespeichert. Verwerfen und neu beginnen?', () =>
    oeffne({ art: 'neu', vorbelegung, n: ++zaehler }),
  );
}

/** Bestehende Buchung in der Schublade öffnen (bearbeiten bzw. ansehen, wenn gesperrt). */
export function bearbeiten(id: number): void {
  nachVerwerfen('Die offene Eingabe ist noch nicht gespeichert. Verwerfen?', () => oeffne({ art: 'bearbeiten', id, n: ++zaehler }));
}

/** Schublade schließen – mit Nachfrage bei ungespeicherten Eingaben. */
export function erfassenSchliessen(): void {
  nachVerwerfen('Ungespeicherte Eingaben verwerfen?', () => {
    const ui = useUi.getState();
    if (ui.drawer === 'erfassen') ui.closeDrawer();
  });
}

/** Nach dem Speichern: ohne Nachfrage schließen. */
export function erfassenFertig(): void {
  frageToastWeg();
  const ui = useUi.getState();
  if (ui.drawer === 'erfassen') ui.closeDrawer();
}
