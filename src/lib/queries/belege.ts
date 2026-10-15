/* Belegdateien (§6.4 „Beleg“): Lesen per SQL, alles andere über Rust-Commands.
 * Belege werden nie gelöscht (GoBD) – es gibt deshalb kein Entfernen, nur Ablegen, Öffnen und im Finder zeigen.
 * - belegPruefen: liest die Dateien nur (Typ, Größe, Hash, schon vorhanden?), kopiert nichts.
 * - belegAnhaengen: legt Dateien zu einer bestehenden Buchung ab (auch im festgeschriebenen Zeitraum, nicht an Gegenbuchungen).
 * - Neue Buchungen bekommen ihre Dateien über `belege` in buchung_anlegen/_aendern (gleiche Transaktion). */
import { invoke } from '@tauri-apps/api/core';
import { abfrage } from '../db';
import type { BelegPruefung } from '../belege';

/** Zeile aus der Tabelle `belege`. */
export interface BelegZeile {
  id: number;
  buchung_id: number | null;
  rechnung_id: number | null;
  pfad: string;
  originalname: string | null;
  mime: string | null;
  sha256: string;
  groesse: number | null;
  art: 'beleg' | 'erechnung_xml' | 'rechnung_pdf';
  aufbewahren_bis: string;
  erstellt_am: string;
}

/** Alle Dateien zu einer Buchung, älteste zuerst. */
export const ladeBelegeZuBuchung = (buchungId: number): Promise<BelegZeile[]> =>
  abfrage<BelegZeile>(
    `SELECT id, buchung_id, rechnung_id, pfad, originalname, mime, sha256, groesse, art, aufbewahren_bis, erstellt_am
       FROM belege WHERE buchung_id = $1 ORDER BY id`,
    [buchungId],
  );

export const belegPruefen = (pfade: string[]): Promise<BelegPruefung[]> => invoke<BelegPruefung[]>('beleg_pruefen', { pfade });

export const belegAnhaengen = (buchungId: number, pfade: string[]): Promise<{ ids: number[] }> =>
  invoke<{ ids: number[] }>('beleg_anhaengen', { buchungId, pfade });

/** Datei mit dem Standardprogramm öffnen. */
export const belegOeffnen = (id: number): Promise<void> => invoke<void>('beleg_oeffnen', { id });

/** Datei im Finder zeigen. */
export const belegZeigen = (id: number): Promise<void> => invoke<void>('beleg_zeigen', { id });
