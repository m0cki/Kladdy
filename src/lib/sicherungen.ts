/* Sicherungen der Datenbank (ANLEITUNG §3.2, §5, §6.10). Die Arbeit macht Rust (src-tauri/src/sicherungen.rs):
 * - automatisch bei jedem Start (`sicherungen/automatisch/`, rotierend: die letzten 10 + je Monat eine für ein Jahr),
 *   vor jedem Update-Install (`vor-update/`, aus lib/updates.ts), von Hand (`manuell/`, „Jetzt sichern“), vor offenen
 *   Migrationen (`vor-migration/`) und vor dem Wiederherstellen (`vor-wiederherstellung/`).
 * - Wiederherstellen: `wiederherstellenVormerken(name)` und danach Neustart; beim Start wird erst der aktuelle Stand
 *   gesichert, dann die Kopie eingesetzt. Was beim Start passiert ist, liefert einmalig `startBericht()` (AppShell).
 * Reine Anzeige-Helfer (Art, Größe, Zeitpunkt, Anzahl) sind mit Vitest getestet (sicherungen.test.ts). */
import { invoke, isTauri } from '@tauri-apps/api/core';

/** Unterordner von `sicherungen/` = Anlass der Kopie. */
export type SicherungsArt = 'automatisch' | 'manuell' | 'vor-update' | 'vor-migration' | 'vor-wiederherstellung';

export interface Sicherung {
  /** Kennung fürs Wiederherstellen: `<art>/<datei>` */
  name: string;
  art: SicherungsArt;
  datei: string;
  /** Bytes */
  groesse: number;
  /** UTC, `JJJJ-MM-TTThh:mm:ssZ` */
  zeitpunkt: string;
  /** höchste angewendete Migration */
  schema: number | null;
  buchungen: number | null;
  /** Quittungen, Rechnungen, Angebote … (Menüpunkt „Belege“) */
  rechnungen: number | null;
  kunden: number | null;
  /** abgelegte Belegdateien */
  belege: number | null;
  /** Grund, warum die Kopie nicht wiederhergestellt werden kann */
  fehler: string | null;
}

export interface Wiederhergestellt {
  zeitpunkt: string;
  /** Pfad der Sicherung des Stands davor (null, wenn es keine Datenbank gab) */
  vorher: string | null;
}

export interface StartBericht {
  wiederhergestellt: Wiederhergestellt | null;
  /** fertige Sätze (Wiederherstellen fehlgeschlagen, automatische Sicherung fehlgeschlagen) */
  fehler: string[];
}

export const ART_TEXT: Record<SicherungsArt, string> = {
  automatisch: 'Beim Start',
  manuell: 'Von Hand',
  'vor-update': 'Vor Update',
  'vor-migration': 'Vor Datenbank-Umstellung',
  'vor-wiederherstellung': 'Vor Wiederherstellen',
};

const ZAHL = new Intl.NumberFormat('de-DE');
const KOMMA = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ZEIT = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Dateigröße wie im Finder (Basis 1000): „830 Byte“, „12,3 KB“, „4,5 MB“. */
export function groesseText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1000) return `${ZAHL.format(Math.max(0, Math.round(bytes || 0)))} Byte`;
  if (bytes < 1_000_000) return `${KOMMA.format(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${KOMMA.format(bytes / 1_000_000)} MB`;
  return `${KOMMA.format(bytes / 1_000_000_000)} GB`;
}

/** Zeitpunkt in Ortszeit, z. B. „13.10.2026, 22:15“. Ungültiges bleibt, wie es ist. */
export function zeitpunktText(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : ZEIT.format(new Date(t));
}

/** Zeilenzahl oder „—“ (Tabelle gab es in dieser Sicherung noch nicht oder sie war nicht lesbar). */
export const anzahlText = (n: number | null): string => (n === null ? '—' : ZAHL.format(n));

/** Hinweis nach dem Start, wenn eine Sicherung wiederhergestellt wurde. */
export function wiederhergestelltText(w: Wiederhergestellt): string {
  const davor = w.vorher ? ` Der Stand davor ist gesichert (${ART_TEXT['vor-wiederherstellung']}).` : '';
  return `Sicherung vom ${zeitpunktText(w.zeitpunkt)} wiederhergestellt.${davor}`;
}

/** Inhalt einer Sicherung in einem Satzteil, z. B. „12 Buchungen, 3 Belege, 5 Kunden“. */
export function inhaltText(s: Pick<Sicherung, 'buchungen' | 'rechnungen' | 'kunden'>): string {
  const teil = (n: number | null, eins: string, viele: string) => `${anzahlText(n)} ${n === 1 ? eins : viele}`;
  return [teil(s.buchungen, 'Buchung', 'Buchungen'), teil(s.rechnungen, 'Beleg', 'Belege'), teil(s.kunden, 'Kunde', 'Kunden')].join(', ');
}

/* ---------- Rust-Commands ---------- */

export const sicherungenAuflisten = (): Promise<Sicherung[]> => invoke<Sicherung[]>('sicherungen_auflisten');

/** Kopie der geöffneten Datenbank. `null`, wenn es noch keine Datenbank gibt (nichts zu sichern). */
export const sicherungAnlegen = (anlass: 'manuell' | 'vor-update'): Promise<Sicherung | null> =>
  invoke<Sicherung | null>('sicherung_anlegen', { anlass });

export const sicherungenOrdnerZeigen = (): Promise<void> => invoke<void>('sicherungen_ordner_zeigen');

/** Prüft die Sicherung und merkt sie für den nächsten Start vor. Danach neu starten (`relaunch()`). */
export const wiederherstellenVormerken = (name: string): Promise<void> => invoke<void>('sicherung_wiederherstellen_vormerken', { name });

/** Einmal nach dem Start: Wiederherstellen erledigt? Fehler beim automatischen Sichern? */
export const startBericht = (): Promise<StartBericht> =>
  isTauri() ? invoke<StartBericht>('sicherungen_start_bericht') : Promise.resolve({ wiederhergestellt: null, fehler: [] });
