/* Rechnungen & Quittungen (§6.6): Lesen per SQL, Schreiben NUR über die Rust-Commands in src-tauri/src/rechnungen.rs
 * (eine Transaktion je Vorgang: Nummer, Kunde, Schnappschuss, Buchung, Protokoll, GoBD-Prüfungen).
 * - ladeBelege: alle Belege in einer Abfrage (die Liste filtert selbst, Prototyp genauso).
 * - ladeBeleg: ein Beleg für die Maske, samt Positionen, Termin, Zahlung, Storno und Herkunft.
 * - ladeUeberfaelligAnzahl: roter Zähler in der Seitenleiste (§6.1).
 * Fehler kommen als deutscher Text. */
import { invoke } from '@tauri-apps/api/core';
import { abfrage, eine } from '../db';
import type { Zahlungsart } from '../buchungen';
import type { BelegDaten, BelegStatus, BelegZeile, EntwurfZeile, KundeAnschrift, ListenArt, PositionZeile } from '../rechnungen';

const ZEILE_SQL = `
  SELECT r.id, r.art, r.nummer, r.status, r.kunde_id, COALESCE(r.kunde_name, k.name) AS kunde_name,
         r.datum, r.faellig_am, r.bezahlt_am, r.zahlungsart,
         COALESCE(NULLIF(TRIM(r.betreff), ''),
                  (SELECT p.beschreibung FROM rechnungspositionen p WHERE p.rechnung_id = r.id ORDER BY p.pos LIMIT 1)) AS betreff,
         r.summe_cent, r.termin_id, t.datum AS termin_datum, t.von AS termin_von, t.status AS termin_status,
         r.storno_von_id, (SELECT s.datum FROM rechnungen s WHERE s.storno_von_id = r.id) AS storniert_am,
         r.pdf_beleg_id, r.scan_beleg_id
    FROM rechnungen r
    LEFT JOIN kunden k ON k.id = r.kunde_id
    LEFT JOIN termine t ON t.id = r.termin_id`;

/** Alle Belege (die Liste filtert und sortiert in lib/rechnungen.ts). */
export const ladeBelege = (): Promise<BelegZeile[]> => abfrage<BelegZeile>(`${ZEILE_SQL} ORDER BY r.id DESC`);

/** Anzahl der überfälligen Rechnungen (offen, Fälligkeit vor heute). */
export async function ladeUeberfaelligAnzahl(heute: string): Promise<number> {
  const r = await eine<{ n: number }>(
    `SELECT COUNT(*) AS n FROM rechnungen
      WHERE art = 'rechnung' AND status = 'offen' AND nummer IS NOT NULL AND faellig_am < $1`,
    [heute],
  );
  return r?.n ?? 0;
}

/** Alles, was die Maske zu einem Beleg braucht. */
export interface BelegVoll extends Omit<EntwurfZeile, 'art' | 'zahlungsart'> {
  art: ListenArt;
  nummer: string | null;
  status: BelegStatus;
  zahlungsart: Zahlungsart | null;
  summe_cent: number;
  termin_datum: string | null;
  termin_von: string | null;
  termin_status: string | null;
  storno_von_id: number | null;
  storniert_am: string | null;
  pdf_beleg_id: number | null;
  scan_beleg_id: number | null;
  kunde_nummer: string | null;
  kunde_email_live: string | null;
  snapshot_json: string | null;
  erstellt_am: string;
  geaendert_am: string;
  /** aktive Zahlung (Einnahme bzw. Ausgabe) zum Beleg */
  buchung_id: number | null;
  buchung_nummer: string | null;
  /** Zahlungsweg der aktiven Zahlung */
  buchung_zahlungsart: Zahlungsart | null;
  /** Original eines Stornobelegs */
  storno_von_nummer: string | null;
  storno_von_datum: string | null;
  storno_von_art: string | null;
  /** Stornobeleg zu diesem Beleg */
  storno_id: number | null;
  storno_nummer: string | null;
  /** Rechnung, die aus diesem Angebot entstanden ist */
  rechnung_aus_angebot_id: number | null;
  /** Angebot, aus dem diese Rechnung entstanden ist */
  angebot_id: number | null;
  angebot_nummer: string | null;
}

const VOLL_SQL = `
  SELECT r.id, r.art, r.nummer, r.status, r.kunde_id, r.kunde_name, r.kunde_adresse, r.kunde_nummer,
         k.name AS kunde_name_live, k.nummer AS kunde_nummer_live, k.email AS kunde_email_live,
         r.datum, r.leistung_von, r.leistung_bis, r.faellig_am, r.betreff, r.einleitung, r.schlusstext, r.summe_cent,
         r.zahlungsart, r.bezahlt_am, r.vorlage_id, r.termin_id, r.entwurf_json, r.snapshot_json,
         r.pdf_beleg_id, r.scan_beleg_id, r.storno_von_id, r.erstellt_am, r.geaendert_am,
         t.datum AS termin_datum, t.von AS termin_von, t.status AS termin_status,
         (SELECT b.id FROM buchungen b WHERE b.rechnung_id = r.id AND b.storno_von_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM buchungen s WHERE s.storno_von_id = b.id) ORDER BY b.id DESC LIMIT 1) AS buchung_id,
         (SELECT b.nummer FROM buchungen b WHERE b.rechnung_id = r.id AND b.storno_von_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM buchungen s WHERE s.storno_von_id = b.id) ORDER BY b.id DESC LIMIT 1) AS buchung_nummer,
         (SELECT b.zahlungsart FROM buchungen b WHERE b.rechnung_id = r.id AND b.storno_von_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM buchungen s WHERE s.storno_von_id = b.id) ORDER BY b.id DESC LIMIT 1) AS buchung_zahlungsart,
         (SELECT o.nummer FROM rechnungen o WHERE o.id = r.storno_von_id) AS storno_von_nummer,
         (SELECT o.datum FROM rechnungen o WHERE o.id = r.storno_von_id) AS storno_von_datum,
         (SELECT o.art FROM rechnungen o WHERE o.id = r.storno_von_id) AS storno_von_art,
         (SELECT s.id FROM rechnungen s WHERE s.storno_von_id = r.id) AS storno_id,
         (SELECT s.nummer FROM rechnungen s WHERE s.storno_von_id = r.id) AS storno_nummer,
         (SELECT s.datum FROM rechnungen s WHERE s.storno_von_id = r.id) AS storniert_am,
         (SELECT x.id FROM rechnungen x WHERE x.art = 'rechnung'
            AND json_extract(x.entwurf_json, '$.aus_angebot') = r.id ORDER BY x.id DESC LIMIT 1) AS rechnung_aus_angebot_id,
         json_extract(r.entwurf_json, '$.aus_angebot') AS angebot_id,
         (SELECT a.nummer FROM rechnungen a WHERE a.id = json_extract(r.entwurf_json, '$.aus_angebot')) AS angebot_nummer
    FROM rechnungen r
    LEFT JOIN kunden k ON k.id = r.kunde_id
    LEFT JOIN termine t ON t.id = r.termin_id
   WHERE r.id = $1`;

/** Ein Beleg (null, wenn es ihn nicht gibt) mit seinen Positionen. */
export async function ladeBeleg(id: number): Promise<{ beleg: BelegVoll; positionen: PositionZeile[] } | null> {
  const beleg = await eine<BelegVoll>(VOLL_SQL, [id]);
  if (!beleg) return null;
  const positionen = await abfrage<PositionZeile>(
    'SELECT beschreibung, menge, einheit, einzelpreis_cent, kategorie_id FROM rechnungspositionen WHERE rechnung_id = $1 ORDER BY pos, id',
    [id],
  );
  return { beleg, positionen };
}

/** Kunden mit Anschrift für die Vorschläge der Maske (zuletzt mit Beleg oder Einnahme zuerst). */
export const ladeKundenAnschrift = (): Promise<KundeAnschrift[]> =>
  abfrage<KundeAnschrift>(
    `SELECT k.id, k.nummer, k.name, k.zusatz, k.strasse, k.plz, k.ort, k.email FROM kunden k
      ORDER BY MAX(COALESCE((SELECT MAX(b.zahlungsdatum) FROM buchungen b WHERE b.kunde_id = k.id), ''),
                   COALESCE((SELECT MAX(r.datum) FROM rechnungen r WHERE r.kunde_id = k.id), '')) DESC,
               k.name COLLATE NOCASE`,
  );

/** Bisherige Positionstexte (Vorschläge mit Einheit und Preis, häufigste zuerst). */
export const ladePositionsVorschlaege = (): Promise<{ beschreibung: string; einheit: string | null; einzelpreis_cent: number; n: number }[]> =>
  abfrage(
    `SELECT beschreibung, einheit, einzelpreis_cent, COUNT(*) AS n FROM rechnungspositionen
      WHERE TRIM(beschreibung) <> '' AND einzelpreis_cent > 0
      GROUP BY beschreibung ORDER BY n DESC, MAX(id) DESC LIMIT 80`,
  );

/** Zahlungsempfänger für Eigenbelege: Geschäfte aus den bisherigen Ausgaben (häufigste zuerst). */
export const ladeGeschaeftsnamen = (): Promise<{ name: string }[]> =>
  abfrage(
    `SELECT lieferant AS name FROM buchungen WHERE typ = 'ausgabe' AND lieferant IS NOT NULL AND TRIM(lieferant) <> ''
      GROUP BY lieferant ORDER BY COUNT(*) DESC LIMIT 200`,
  );

/* ---------- Schreiben (Rust) ---------- */

/** Antwort der Rust-Commands (rechnungen.rs → BelegErgebnis). */
export interface BelegErgebnis {
  id: number;
  nummer: string | null;
  status: string;
  kunde_id: number | null;
  kunde_nummer: string | null;
  kunde_neu: boolean;
  buchung_id: number | null;
  buchung_nummer: string | null;
  gegenbuchung_nummer: string | null;
  storno_id: number | null;
  storno_nummer: string | null;
  entwurf_id: number | null;
}

/** Was beim Ausstellen dazukommt (rechnungen.rs → AusstellenEingabe). */
export interface AusstellenDaten {
  /** Belegdokument wie in der Vorschau (die Werte aus der Datenbank setzt Rust selbst ein) */
  dokument: unknown;
  /** Bausteine der Vorlage (werden eingefroren) */
  bausteine: unknown;
  kategorie_id: number | null;
  heute: string;
}

export const belegEntwurfSpeichern = (id: number | null, daten: BelegDaten): Promise<BelegErgebnis> =>
  invoke<BelegErgebnis>('beleg_entwurf_speichern', { id, daten });

export const belegEntwurfLoeschen = (id: number): Promise<BelegErgebnis> => invoke<BelegErgebnis>('beleg_entwurf_loeschen', { id });

/** Speichert und stellt in EINER Transaktion aus (id null = neuer Beleg). */
export const belegAusstellen = (id: number | null, daten: BelegDaten, ausstellen: AusstellenDaten): Promise<BelegErgebnis> =>
  invoke<BelegErgebnis>('beleg_ausstellen', { id, daten, ausstellen });

export const belegBezahlt = (id: number, datum: string, zahlungsart: string, heute: string): Promise<BelegErgebnis> =>
  invoke<BelegErgebnis>('beleg_bezahlt', { id, datum, zahlungsart, heute });

export const belegOffen = (id: number, heute: string): Promise<BelegErgebnis> => invoke<BelegErgebnis>('beleg_offen', { id, heute });

export const belegAngebotStatus = (id: number, status: 'offen' | 'abgelehnt'): Promise<BelegErgebnis> =>
  invoke<BelegErgebnis>('beleg_angebot_status', { id, status });

export const belegUmwandeln = (
  id: number,
  daten: { heute: string; einleitung: string | null; schlusstext: string | null; faellig_am: string | null },
): Promise<BelegErgebnis> => invoke<BelegErgebnis>('beleg_umwandeln', { id, daten });

export const belegStornieren = (id: number, heute: string): Promise<BelegErgebnis> => invoke<BelegErgebnis>('beleg_stornieren', { id, heute });

/** PDF eines ausgestellten Belegs ablegen (genau einmal); gibt die ID in `belege` zurück. */
export const belegPdfAblegen = (id: number, pdf: Uint8Array): Promise<number> => invoke<number>('beleg_pdf_ablegen', { id, pdf: Array.from(pdf) });

export const belegScanAnhaengen = (id: number, pfad: string): Promise<number> => invoke<number>('beleg_scan_anhaengen', { id, pfad });

