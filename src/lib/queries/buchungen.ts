/* Ein- & Ausgänge: Lesen per SQL, Schreiben NUR über Rust-Commands (Transaktion, Nummernvergabe, Protokoll, GoBD-Prüfungen).
 * - ladeBuchungen: Zeilen eines Zeitraums nach Zahlungsdatum. Storno-Gegenbuchungen selbst werden nicht gezeigt,
 *   das Original trägt `storniert = 1`.
 * - ladeOhneBelegAnzahl: Zähler in der Seitenleiste (§6.1) – gleiche Regel wie fehltBeleg() in lib/buchungen.ts.
 * - buchungAnlegen / buchungAendern / buchungStornieren: invoke; Fehler kommen als deutscher Text. */
import { invoke } from '@tauri-apps/api/core';
import { abfrage, eine } from '../db';
import type { BuchungDaten, BuchungZeile, KategorieWahl, KundeKurz } from '../buchungen';

/** Festgeschrieben: Spalte gesetzt oder Zahlungsdatum bis zum letzten festgeschriebenen Tag. */
const FEST = `(b.festgeschrieben = 1 OR b.zahlungsdatum <= COALESCE((SELECT MAX(bis_datum) FROM festschreibungen), ''))`;
const STORNIERT = `EXISTS (SELECT 1 FROM buchungen s WHERE s.storno_von_id = b.id)`;
const BELEGE = `(SELECT COUNT(*) FROM belege be WHERE be.buchung_id = b.id)`;

const ZEILE_SQL = `
  SELECT b.id, b.nummer, b.typ, b.zahlungsdatum, b.belegdatum, b.betrag_cent, b.privatanteil_prozent, b.kategorie_id,
         k.name AS kategorie_name, k.icon AS kategorie_icon, k.farbe AS kategorie_farbe,
         b.kunde_id, ku.name AS kunde_name, ku.nummer AS kunde_nummer, b.lieferant, b.art, b.zahlungsart,
         b.belegnummer, b.beschreibung, b.rechnung_id, r.nummer AS rechnung_nummer,
         ${BELEGE} AS belege_anzahl,
         CASE WHEN ${STORNIERT} THEN 1 ELSE 0 END AS storniert,
         CASE WHEN ${FEST} THEN 1 ELSE 0 END AS festgeschrieben
    FROM buchungen b
    JOIN kategorien k ON k.id = b.kategorie_id
    LEFT JOIN kunden ku ON ku.id = b.kunde_id
    LEFT JOIN rechnungen r ON r.id = b.rechnung_id`;

/** Zeilen mit Zahlungsdatum von–bis, neueste zuerst. */
export const ladeBuchungen = (von: string, bis: string): Promise<BuchungZeile[]> =>
  abfrage<BuchungZeile>(
    `${ZEILE_SQL}
     WHERE b.storno_von_id IS NULL AND b.zahlungsdatum BETWEEN $1 AND $2
     ORDER BY b.zahlungsdatum DESC, b.id DESC`,
    [von, bis],
  );

/** Eine Zeile (zum Bearbeiten), null wenn es sie nicht (mehr) gibt. */
export const ladeBuchung = (id: number): Promise<BuchungZeile | null> =>
  eine<BuchungZeile>(`${ZEILE_SQL} WHERE b.id = $1`, [id]);

/** Anzahl der Zahlungen ohne Beleg (Zähler in der Seitenleiste). */
export async function ladeOhneBelegAnzahl(): Promise<number> {
  const r = await eine<{ n: number }>(
    `SELECT COUNT(*) AS n FROM buchungen b
      WHERE b.storno_von_id IS NULL AND b.art = 'zahlung' AND b.rechnung_id IS NULL
        AND NOT ${STORNIERT} AND ${BELEGE} = 0`,
  );
  return r?.n ?? 0;
}

/** Kategorien für die Kacheln (nicht archiviert, in fester Reihenfolge). */
export const ladeKategorienWahl = (): Promise<KategorieWahl[]> =>
  abfrage<KategorieWahl>(
    `SELECT id, name, typ, icon, farbe, stichworte, euer_bereich, abziehbar_prozent, wareneingang, zaehlt_ku_umsatz
       FROM kategorien WHERE archiviert = 0 ORDER BY sortierung, name`,
  );

/** Kunden für die Vorschläge „Name · K-0012“ (zuletzt mit Einnahme zuerst, dann nach Name). */
export const ladeKundenKurz = (): Promise<KundeKurz[]> =>
  abfrage<KundeKurz>(
    `SELECT k.id, k.nummer, k.name, k.ort FROM kunden k
      ORDER BY (SELECT MAX(b.zahlungsdatum) FROM buchungen b WHERE b.kunde_id = k.id) DESC, k.name COLLATE NOCASE`,
  );

/** Bisherige Geschäfte (Ausgaben) mit Kategorie und Anzahl – zusammengefasst von geschaefte() in lib/buchungen.ts. */
export const ladeLieferanten = (): Promise<{ lieferant: string; kategorie_id: number; n: number }[]> =>
  abfrage(
    `SELECT lieferant, kategorie_id, COUNT(*) AS n FROM buchungen
      WHERE typ = 'ausgabe' AND storno_von_id IS NULL AND lieferant IS NOT NULL AND TRIM(lieferant) <> ''
      GROUP BY lieferant, kategorie_id ORDER BY n DESC LIMIT 500`,
  );

/** Letzter festgeschriebener Tag oder null. */
export async function ladeFestBis(): Promise<string | null> {
  const r = await eine<{ bis: string | null }>('SELECT MAX(bis_datum) AS bis FROM festschreibungen');
  return r?.bis ?? null;
}

/* ---------- Schreiben (Rust) ---------- */

/** Antwort der Rust-Commands (src-tauri/src/buchungen.rs → BuchungErgebnis). Beim Stornieren: die Storno-Buchung. */
export interface BuchungErgebnis {
  id: number;
  nummer: string;
  kunde_id: number | null;
  kunde_nummer: string | null;
  /** Kunde wurde in diesem Vorgang neu angelegt (neuer_kunde) */
  kunde_neu: boolean;
}

export const buchungAnlegen = (daten: BuchungDaten): Promise<BuchungErgebnis> => invoke<BuchungErgebnis>('buchung_anlegen', { daten });

export const buchungAendern = (id: number, daten: BuchungDaten): Promise<BuchungErgebnis> =>
  invoke<BuchungErgebnis>('buchung_aendern', { id, daten });

/** Gegenbuchung anlegen; liegt das Original im festgeschriebenen Zeitraum, datiert Rust sie auf `heute`. */
export const buchungStornieren = (id: number, heute: string): Promise<BuchungErgebnis> =>
  invoke<BuchungErgebnis>('buchung_stornieren', { id, heute });
