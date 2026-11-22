/* Buchung löschen (§2.5, §6.3, §6.4): Texte für den Bestätigungsdialog und den Toast – reine Funktionen.
 * Gelöscht wird nur vor der Festschreibung und ohne ausgestellten eigenen Beleg, ein Storno-Paar nur gemeinsam
 * (Rust: src-tauri/src/buchungen.rs → loeschen). Angehängte Dateien bleiben in der Belegablage, die Nummer wird nie neu
 * vergeben, das Protokoll hält die ganze Zeile fest. Der Dialog selbst: components/buchungen/LoeschDialog.tsx. */
import { betragAnzeige, datumKurz, typName, type BuchungZeile } from './buchungen';
import type { LoeschErgebnis, Loeschbarkeit } from './queries/buchungen';

/** Was der Dialog über die Buchung zeigt (aus der Liste bzw. der Schublade). */
export type LoeschZiel = Pick<BuchungZeile, 'id' | 'nummer' | 'typ' | 'zahlungsdatum' | 'betrag_cent' | 'beschreibung'>;

export interface ZusammenfassungZeile {
  label: string;
  wert: string;
}

/** „a“, „a und b“, „a, b und c“ */
export function aufzaehlen(teile: readonly string[]): string {
  if (teile.length <= 1) return teile[0] ?? '';
  return `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`;
}

/** Nr., Datum (de-DE), Betrag mit Vorzeichen (Ausgabe mit echtem −) und Art, Beschreibung. */
export function loeschZusammenfassung(b: LoeschZiel): ZusammenfassungZeile[] {
  return [
    { label: 'Nr.', wert: b.nummer },
    { label: 'Datum', wert: datumKurz(b.zahlungsdatum) },
    { label: 'Betrag', wert: `${betragAnzeige(b)} · ${typName(b.typ)}` },
    { label: 'Beschreibung', wert: b.beschreibung.trim() || '–' },
  ];
}

/** Hinweise unter der Zusammenfassung, in dieser Reihenfolge. */
export function loeschHinweise(l: Pick<Loeschbarkeit, 'nummern' | 'storno_paar' | 'dateien' | 'entwuerfe' | 'termin'>, o: { ungespeichert?: boolean } = {}): string[] {
  const h: string[] = [];
  if (l.storno_paar) h.push(`Die Buchung und ihre Storno-Buchung werden gelöscht (${aufzaehlen(l.nummern)}).`);
  if (l.dateien === 1) h.push('Die angehängte Datei bleibt in der Belegablage, nur die Verknüpfung wird gelöst.');
  else if (l.dateien > 1) h.push(`Die ${l.dateien} angehängten Dateien bleiben in der Belegablage, nur die Verknüpfung wird gelöst.`);
  if (l.nummern.length > 1) h.push(`Die Nummern ${aufzaehlen(l.nummern)} werden nicht neu vergeben.`);
  else if (l.nummern.length === 1) h.push(`Die Nummer ${l.nummern[0]} wird nicht neu vergeben.`);
  if (l.entwuerfe === 1) h.push('Der Beleg-Entwurf zu dieser Zahlung bleibt, nur ohne Verknüpfung.');
  else if (l.entwuerfe > 1) h.push(`Die ${l.entwuerfe} Beleg-Entwürfe zu dieser Zahlung bleiben, nur ohne Verknüpfung.`);
  if (l.termin) h.push('Der Termin dazu bleibt erledigt.');
  h.push('Das Löschen steht mit allen Angaben im Protokoll.');
  if (o.ungespeichert) h.push('Ungespeicherte Änderungen gehen verloren.');
  return h;
}

/** Toast danach (ohne Rückgängig): „Buchung 2026-0007 gelöscht“ bzw. mit Storno-Buchung. */
export function loeschToast(r: Pick<LoeschErgebnis, 'nummern'>): string {
  const [original, storno] = r.nummern;
  return storno ? `Buchung ${original} und Storno-Buchung ${storno} gelöscht` : `Buchung ${original ?? ''} gelöscht`;
}

/** Schneller Vorab-Blick für die Zeile in Ein- & Ausgänge (Knopf zeigen?) – entscheiden tut Rust. */
export const vielleichtLoeschbar = (b: Pick<BuchungZeile, 'art' | 'festgeschrieben' | 'rechnung_id'>): boolean =>
  b.art === 'zahlung' && !b.festgeschrieben && b.rechnung_id == null;
