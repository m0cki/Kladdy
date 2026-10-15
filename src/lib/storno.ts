/* Stornieren statt Löschen (GoBD, §6.3): Rust legt eine Gegenbuchung an (storno_von_id = Original), das Original
 * bleibt sichtbar (durchgestrichen, „storniert“). Nachfrage als klebender Warn-Toast wie beim Neustart (updates.ts). */
import { useUi } from '../store/ui';
import { typName, type BuchungTyp } from './buchungen';
import { fehlerText } from './fehler';
import { buchungStornieren } from './queries/buchungen';
import { heute } from './zeitraum';

export interface StornoZiel {
  id: number;
  nummer: string;
  typ: BuchungTyp;
}

const FRAGE = 'storno-frage';

function frageWeg(): void {
  const ui = useUi.getState();
  const t = ui.toasts.find((x) => x.key === FRAGE);
  if (t) ui.dismissToast(t.id);
}

/** Sofort stornieren (z. B. „Rückgängig“ direkt nach dem Speichern). */
export async function storniere(b: StornoZiel, nachher?: () => void, text?: string): Promise<boolean> {
  const ui = useUi.getState();
  try {
    const r = await buchungStornieren(b.id, heute());
    ui.datenGeaendert();
    ui.showToast({ text: text ?? `${typName(b.typ)} ${b.nummer} storniert · Gegenbuchung ${r.nummer} (im Protokoll)`, icon: 'check' });
    nachher?.();
    return true;
  } catch (e) {
    ui.showToast({ text: `Stornieren ging nicht: ${fehlerText(e)}`, icon: 'warn', sticky: true });
    return false;
  }
}

/** Erst nachfragen, dann stornieren. */
export function storniereMitNachfrage(b: StornoZiel, nachher?: () => void): void {
  useUi.getState().showToast({
    key: FRAGE,
    text: `${typName(b.typ)} ${b.nummer} stornieren? Es entsteht eine Gegenbuchung, der Eintrag bleibt durchgestrichen sichtbar.`,
    icon: 'warn',
    sticky: true,
    actions: [
      {
        label: 'Stornieren',
        run: () => {
          frageWeg();
          void storniere(b, nachher);
        },
      },
      { label: 'Abbrechen', run: frageWeg },
    ],
  });
}
