/* Kunden (§6.8): Lesen per SQL, Schreiben NUR über Rust-Commands (src-tauri/src/kunden.rs: Transaktion, Nummernvergabe,
 * Protokoll, Löschprüfung). Keine Abfrage je Kunde: ladeKunden() und ladeVerlauf() holen alles in je einer Abfrage,
 * zusammengeführt wird in lib/kunden.ts (kundenIndex). Die Schublade lädt dieselben Formen für einen Kunden. */
import { invoke } from '@tauri-apps/api/core';
import { abfrage, nacheinander } from '../db';
import type { KundeDaten, KundeZeile, VerlaufZeile } from '../kunden';

const KUNDE_SQL = `
  SELECT k.id, k.nummer, k.name, k.zusatz, k.strasse, k.plz, k.ort, k.email, k.telefon, k.notiz, k.erstellt_am,
         CASE WHEN EXISTS (SELECT 1 FROM buchungen b WHERE b.kunde_id = k.id)
                OR EXISTS (SELECT 1 FROM rechnungen r WHERE r.kunde_id = k.id)
                OR EXISTS (SELECT 1 FROM termine t WHERE t.kunde_id = k.id)
                OR EXISTS (SELECT 1 FROM fahrten f WHERE f.kunde_id = k.id) THEN 1 ELSE 0 END AS gebunden,
         NULLIF(MAX(COALESCE((SELECT MAX(b.zahlungsdatum) FROM buchungen b WHERE b.kunde_id = k.id), ''),
                    COALESCE((SELECT MAX(r.datum) FROM rechnungen r WHERE r.kunde_id = k.id AND r.nummer IS NOT NULL), '')), '') AS frist_datum
    FROM kunden k`;

/** Verlauf aus drei Quellen in einer Form (VerlaufZeile). `$1` = Kunden-ID oder NULL für alle. */
const VERLAUF_SQL = `
  SELECT 'beleg' AS quelle, r.id, r.kunde_id, r.art,
         COALESCE(r.leistung_von, r.datum, substr(r.erstellt_am, 1, 10)) AS datum, NULL AS von, NULL AS bis,
         r.nummer, r.status, r.summe_cent AS betrag_cent,
         COALESCE(NULLIF(TRIM(r.betreff), ''),
                  (SELECT p.beschreibung FROM rechnungspositionen p WHERE p.rechnung_id = r.id ORDER BY p.pos LIMIT 1)) AS leistung,
         (SELECT group_concat(beschreibung, ' · ') FROM
            (SELECT p.beschreibung FROM rechnungspositionen p WHERE p.rechnung_id = r.id ORDER BY p.pos)) AS positionen,
         (SELECT b.zahlungsart FROM buchungen b
           WHERE b.rechnung_id = r.id AND b.storno_von_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM buchungen s WHERE s.storno_von_id = b.id)
           ORDER BY b.zahlungsdatum DESC, b.id DESC LIMIT 1) AS zahlungsart,
         r.faellig_am, NULL AS notiz, r.termin_id, NULL AS belegnummer, 0 AS belege_anzahl
    FROM rechnungen r
   WHERE r.kunde_id IS NOT NULL AND r.art IN ('rechnung', 'quittung', 'angebot') AND ($1 IS NULL OR r.kunde_id = $1)
  UNION ALL
  SELECT 'einnahme', b.id, b.kunde_id, 'einnahme',
         COALESCE((SELECT t.datum FROM termine t WHERE t.id = b.termin_id AND t.status = 'erledigt'), b.zahlungsdatum),
         NULL, NULL, b.nummer,
         CASE WHEN EXISTS (SELECT 1 FROM buchungen s WHERE s.storno_von_id = b.id) THEN 'storniert' ELSE 'bezahlt' END,
         b.betrag_cent, b.beschreibung, NULL, b.zahlungsart, NULL, NULL, b.termin_id, b.belegnummer,
         (SELECT COUNT(*) FROM belege be WHERE be.buchung_id = b.id)
    FROM buchungen b
   WHERE b.typ = 'einnahme' AND b.kunde_id IS NOT NULL AND b.rechnung_id IS NULL AND b.storno_von_id IS NULL
     AND ($1 IS NULL OR b.kunde_id = $1)
  UNION ALL
  SELECT 'termin', t.id, t.kunde_id, 'termin', t.datum, t.von, t.bis, NULL, t.status, t.betrag_geschaetzt_cent,
         t.leistung, NULL, NULL, NULL, t.notiz, NULL, NULL, 0
    FROM termine t
   WHERE t.kunde_id IS NOT NULL AND ($1 IS NULL OR t.kunde_id = $1)`;

/** Alle Kunden (Reihenfolge macht lib/kunden.ts). */
export const ladeKunden = (): Promise<KundeZeile[]> => abfrage<KundeZeile>(`${KUNDE_SQL} ORDER BY k.id`);

/** Ein Kunde oder null. */
export async function ladeKunde(id: number): Promise<KundeZeile | null> {
  const z = await abfrage<KundeZeile>(`${KUNDE_SQL} WHERE k.id = $1`, [id]);
  return z[0] ?? null;
}

/** Verlauf aller Kunden (kundeId weglassen) bzw. eines Kunden. */
export const ladeVerlauf = (kundeId: number | null = null): Promise<VerlaufZeile[]> => abfrage<VerlaufZeile>(VERLAUF_SQL, [kundeId]);

/* ---------- Schreiben (Rust) ---------- */

/** Antwort der Rust-Commands (kunden.rs → KundeErgebnis). */
export interface KundeErgebnis {
  id: number;
  nummer: string;
  /** false: nichts geändert, nichts protokolliert */
  geaendert: boolean;
}

export const kundeAnlegen = (daten: KundeDaten, heute: string): Promise<KundeErgebnis> =>
  nacheinander(() => invoke<KundeErgebnis>('kunde_anlegen', { daten, heute }));

export const kundeAendern = (id: number, daten: KundeDaten): Promise<KundeErgebnis> =>
  nacheinander(() => invoke<KundeErgebnis>('kunde_aendern', { id, daten }));

export const kundeNotiz = (id: number, notiz: string | null): Promise<KundeErgebnis> =>
  nacheinander(() => invoke<KundeErgebnis>('kunde_notiz', { id, notiz }));

export const kundeLoeschen = (id: number): Promise<KundeErgebnis> => nacheinander(() => invoke<KundeErgebnis>('kunde_loeschen', { id }));

/** Karten-, Telefon- oder Mail-Link mit der Standard-App öffnen (Rust prüft gegen eine feste Liste). */
export const linkOeffnen = (url: string): Promise<void> => invoke<void>('link_oeffnen', { url });
