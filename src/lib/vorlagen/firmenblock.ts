/* Zeilen des Bausteins „Firmenkopf (Text)“ (ANLEITUNG §7.0): Untertitel und Kontaktzeilen mit Platzhaltern.
 * Regel für Vorschau (Blatt.tsx) und PDF (latex/vorlage.ts) gleichermaßen: Eine Zeile, deren Platzhalter alle leer sind,
 * fällt ganz weg – ohne Steuernummer druckt „Steuernr. {steuernummer}“ also nicht nur „Steuernr.“. Zeilen ohne
 * Platzhalter bleiben (wenn sie nicht leer sind). {nr} ist nie leer (Entwurf ⇒ „Entwurf“).
 * Die Vorschau filtert mit den Werten (`sichtbareZeilen`), das PDF prüft dieselben Platzhalter erst in TeX (main.tex
 * enthält keine Daten), beide über `firmenZeilen`. Formatierung (<b> usw.) zählt dabei nicht. Tests: firmenblock.test.ts */
import type { PlatzhalterName } from './dokument';
import { laenge, parsen, serialisieren, trimmen, zeilenMarkup } from './formatierung';

export interface FirmenZeile {
  /** Markup der Zeile mit Platzhaltern (formatierung.ts, für sich vollständig), Ränder getrimmt */
  text: string;
  /** Platzhalter der Zeile (ohne {nr}, ohne Doppelte); leer = Zeile ohne Platzhalter, steht immer da */
  platzhalter: PlatzhalterName[];
}

/** Text in Zeilen zerlegen (leere Zeilen fallen weg). Formatierung über mehrere Zeilen wird je Zeile geschlossen. */
export function firmenZeilen(text: string): FirmenZeile[] {
  return zeilenMarkup(text).flatMap((z) => {
    const laeufe = trimmen(parsen(z));
    if (!laenge(laeufe)) return [];
    const platzhalter: PlatzhalterName[] = [];
    for (const t of laeufe) if (t.art === 'platzhalter' && t.name !== 'nr' && !platzhalter.includes(t.name)) platzhalter.push(t.name);
    return [{ text: serialisieren(laeufe), platzhalter }];
  });
}

/** Wird die Zeile gedruckt? Ohne Platzhalter ja, sonst nur, wenn mindestens einer einen Wert hat. Eine Zeile nur aus
 * {nr} gilt als Zeile ohne Platzhalter. */
export const zeileSichtbar = (z: FirmenZeile, werte: Readonly<Record<PlatzhalterName, string>>): boolean =>
  !z.platzhalter.length || z.platzhalter.some((p) => !!werte[p].trim());

/** Zeilen, die gedruckt werden (noch mit Platzhaltern). */
export const sichtbareZeilen = (text: string, werte: Readonly<Record<PlatzhalterName, string>>): FirmenZeile[] =>
  firmenZeilen(text).filter((z) => zeileSichtbar(z, werte));
