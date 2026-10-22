/* Der eine Erfassen-Weg (§6, §6.4): `erfassen(vorbelegung)` öffnet die Erfassen-Schublade von jeder Seite aus
 * („+ Erfassen“ im Kopf von Ein- & Ausgänge, ⌘N, Befehlspalette; andere Seiten nur vorbelegt). `bearbeiten(id)` öffnet
 * dieselbe Schublade mit einer bestehenden Buchung. Mit ungespeicherten Eingaben wird vorher nachgefragt
 * (Toast „Verwerfen“ / „Weiter bearbeiten“), ebenso beim Schließen. */
import { create } from 'zustand';
import { useUi } from '../store/ui';
import { belegeZusammenfuehren, type VorgemerkterBeleg } from './belege';
import type { BuchungTyp, Zahlungsart } from './buchungen';
import type { ErtragsArt } from './ertrag';

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
  /** schon geprüfte Belegdateien (Datei-Drop, ⌘O) */
  belege?: VorgemerkterBeleg[];
  /** Einnahme mit eigenem Beleg, Art vorgewählt (Neu-Menü, Befehlspalette, Menü „Quittung/Rechnung schreiben …“) */
  beleg?: ErtragsArt;
}

export type Auftrag = { art: 'neu'; vorbelegung: Vorbelegung; n: number } | { art: 'bearbeiten'; id: number; n: number };

interface ErfassenState {
  auftrag: Auftrag | null;
  /** Vorgemerkte Belegdateien der offenen Schublade (werden beim Speichern bzw. „Beleg anhängen“ abgelegt). Hier statt im
   *  Formular, damit ein Drop auch während des Ladens ankommt. Jeder neue Auftrag beginnt mit seiner Vorbelegung. */
  belege: VorgemerkterBeleg[];
  /** Kann die offene Schublade Dateien annehmen? (false z. B. bei einer Gegenbuchung oder ohne Datenbank) */
  nimmtBelege: boolean;
}

/** Was die Schublade gerade zeigen soll. `n` wechselt bei jedem Öffnen ⇒ Formular neu aufbauen. */
export const useErfassen = create<ErfassenState>(() => ({ auftrag: null, belege: [], nimmtBelege: true }));

/** Dateien zur offenen Schublade hinzufügen (gleiche Datei nur einmal). */
export function belegeVormerken(neu: VorgemerkterBeleg[]): void {
  useErfassen.setState((s) => ({ belege: belegeZusammenfuehren(s.belege, neu) }));
}

/** Eine vorgemerkte Datei wieder herausnehmen (abgelegte Belege bleiben, die werden nie gelöscht). */
export function belegEntfernen(pfad: string): void {
  useErfassen.setState((s) => ({ belege: s.belege.filter((b) => b.pfad !== pfad) }));
}

export const belegeLeeren = (): void => useErfassen.setState({ belege: [] });

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
  useErfassen.setState({ auftrag, belege: auftrag.art === 'neu' ? belegeZusammenfuehren([], auftrag.vorbelegung.belege ?? []) : [], nimmtBelege: true });
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
    belegeLeeren();
  });
}

/** Nach dem Speichern: ohne Nachfrage schließen. */
export function erfassenFertig(): void {
  frageToastWeg();
  const ui = useUi.getState();
  if (ui.drawer === 'erfassen') ui.closeDrawer();
  belegeLeeren();
}
