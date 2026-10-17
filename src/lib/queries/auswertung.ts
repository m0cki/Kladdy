/* Auswertung › Überblick (§6.9.1) und Liquidität (§6.9.2): Lesen per SQL, gerechnet wird in lib/auswertung.ts bzw.
 * lib/liquiditaet.ts. Der Überblick lädt die Vorschau mit (Status-Pille „Nächste 90 Tage“).
 * Bewusst ALLE Buchungen auf einmal (ein Kleingewerbe hat wenige Hundert im Jahr): Zeitraum-Wechsel, Vorperiode,
 * Vorjahr und Kleinunternehmer-Status brauchen dann keine weitere Abfrage. Auch Storno-Gegenbuchungen, sie zählen negativ.
 * Aufträge mit denselben Datums-Regeln wie der Kunden-Verlauf (queries/kunden.ts → VERLAUF_SQL). */
import { abfrage } from '../db';
import type { AuftragZeile, AuswertungBuchung } from '../auswertung';
import type { LiqRechnung } from '../liquiditaet';
import type { KennwerteJahr } from '../steuer-kennwerte';
import { ladeUstModus, type UstModus } from './einstellungen';
import { ladeVorschauZusatz, type VorschauZusatz } from './liquiditaet';
import { ladeKennwerte } from './steuer';

const BUCHUNGEN_SQL = `
  SELECT b.id, b.typ, b.zahlungsdatum, b.betrag_cent, b.privatanteil_prozent, b.kategorie_id,
         k.name AS kategorie_name, k.farbe AS kategorie_farbe, k.abziehbar_prozent, k.zaehlt_ku_umsatz,
         b.art, b.zahlungsart, b.rechnung_id, b.storno_von_id, b.wiederkehrend_id,
         (SELECT r.art FROM rechnungen r WHERE r.id = b.rechnung_id) AS rechnung_art,
         (SELECT COUNT(*) FROM belege be WHERE be.buchung_id = b.id) AS belege_anzahl,
         CASE WHEN EXISTS (SELECT 1 FROM buchungen s WHERE s.storno_von_id = b.id) THEN 1 ELSE 0 END AS storniert
    FROM buchungen b
    JOIN kategorien k ON k.id = b.kategorie_id
   ORDER BY b.zahlungsdatum, b.id`;

/** Besuche wie in lib/kunden.ts; ob einer zählt, entscheidet istBesuch() (Status, Datum bis heute). */
const AUFTRAEGE_SQL = `
  SELECT 'beleg' AS quelle, r.art, r.status, COALESCE(r.leistung_von, r.datum, substr(r.erstellt_am, 1, 10)) AS datum
    FROM rechnungen r
   WHERE r.kunde_id IS NOT NULL AND r.art IN ('rechnung', 'quittung')
  UNION ALL
  SELECT 'einnahme', 'einnahme',
         CASE WHEN EXISTS (SELECT 1 FROM buchungen s WHERE s.storno_von_id = b.id) THEN 'storniert' ELSE 'bezahlt' END,
         COALESCE((SELECT t.datum FROM termine t WHERE t.id = b.termin_id AND t.status = 'erledigt'), b.zahlungsdatum)
    FROM buchungen b
   WHERE b.typ = 'einnahme' AND b.kunde_id IS NOT NULL AND b.rechnung_id IS NULL AND b.storno_von_id IS NULL`;

/** Ausgestellte, offene Rechnungen (Entwürfe haben keine Nummer), mit Schnappschuss-Namen für die Liquidität. */
const OFFEN_SQL = `
  SELECT id, nummer, kunde_name, datum, faellig_am, summe_cent FROM rechnungen
   WHERE art = 'rechnung' AND status = 'offen' AND nummer IS NOT NULL
   ORDER BY faellig_am`;

export interface UeberblickDaten {
  buchungen: AuswertungBuchung[];
  auftraege: AuftragZeile[];
  offen: LiqRechnung[];
  kennwerte: Map<number, KennwerteJahr>;
  ustModus: UstModus;
  /** für „Nächste 90 Tage“ */
  vorschau: VorschauZusatz;
}

export async function ladeUeberblick(): Promise<UeberblickDaten> {
  const [buchungen, auftraege, offen, kennwerte, ustModus, vorschau] = await Promise.all([
    abfrage<AuswertungBuchung>(BUCHUNGEN_SQL),
    abfrage<AuftragZeile>(AUFTRAEGE_SQL),
    abfrage<LiqRechnung>(OFFEN_SQL),
    ladeKennwerte(),
    ladeUstModus(),
    ladeVorschauZusatz(),
  ]);
  return { buchungen, auftraege, offen, kennwerte, ustModus, vorschau };
}

export interface LiquiditaetDaten extends VorschauZusatz {
  buchungen: AuswertungBuchung[];
  offen: LiqRechnung[];
}

export async function ladeLiquiditaet(): Promise<LiquiditaetDaten> {
  const [buchungen, offen, zusatz] = await Promise.all([abfrage<AuswertungBuchung>(BUCHUNGEN_SQL), abfrage<LiqRechnung>(OFFEN_SQL), ladeVorschauZusatz()]);
  return { buchungen, offen, ...zusatz };
}
