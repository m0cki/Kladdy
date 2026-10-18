/* Daten für die Suche ⌘K (§6.2): je Quelle eine schlanke Abfrage (nur die Spalten, die lib/suche-daten.ts braucht),
 * neueste zuerst. Geladen einmal beim Öffnen der Suche. Schlägt eine Quelle fehl, bleibt sie leer – die übrigen,
 * Seiten und Befehle funktionieren weiter. Kunden immer über kunde_id. */
import { abfrage } from '../db';
import { LEERE_SUCHDATEN, type SuchBeleg, type SuchBuchung, type SuchDaten, type SuchKennzahl, type SuchKunde, type SuchTermin } from '../suche-daten';

/** Ein- & Ausgänge ohne die Storno-Gegenbuchungen selbst (das Original trägt `storniert`). */
const ladeBuchungen = (): Promise<SuchBuchung[]> =>
  abfrage<SuchBuchung>(
    `SELECT b.id, b.nummer, b.typ, b.zahlungsdatum, b.betrag_cent, b.beschreibung, b.belegnummer, r.nummer AS rechnung_nummer,
            k.name AS kategorie_name, ku.name AS kunde_name, ku.nummer AS kunde_nummer, b.lieferant, b.zahlungsart,
            CASE WHEN EXISTS (SELECT 1 FROM buchungen s WHERE s.storno_von_id = b.id) THEN 1 ELSE 0 END AS storniert
       FROM buchungen b
       JOIN kategorien k ON k.id = b.kategorie_id
       LEFT JOIN kunden ku ON ku.id = b.kunde_id
       LEFT JOIN rechnungen r ON r.id = b.rechnung_id
      WHERE b.storno_von_id IS NULL
      ORDER BY b.zahlungsdatum DESC, b.id DESC`,
  );

/** Belege (Tabelle rechnungen) inkl. Entwürfe ohne Nummer. */
const ladeBelege = (): Promise<SuchBeleg[]> =>
  abfrage<SuchBeleg>(
    `SELECT r.id, r.art, r.nummer, r.status, COALESCE(r.datum, substr(r.erstellt_am, 1, 10)) AS datum,
            COALESCE(NULLIF(TRIM(r.betreff), ''),
                     (SELECT p.beschreibung FROM rechnungspositionen p WHERE p.rechnung_id = r.id ORDER BY p.pos LIMIT 1)) AS betreff,
            ku.name AS kunde_name, ku.nummer AS kunde_nummer, r.kunde_name AS beleg_name, r.summe_cent, r.faellig_am
       FROM rechnungen r
       LEFT JOIN kunden ku ON ku.id = r.kunde_id
      ORDER BY COALESCE(r.datum, substr(r.erstellt_am, 1, 10)) DESC, r.id DESC`,
  );

/** Termine ohne abgesagte, neueste zuerst. */
const ladeTermine = (): Promise<SuchTermin[]> =>
  abfrage<SuchTermin>(
    `SELECT t.id, t.datum, t.von, t.bis, t.leistung, t.status, ku.name AS kunde_name, ku.nummer AS kunde_nummer, t.adresse
       FROM termine t
       LEFT JOIN kunden ku ON ku.id = t.kunde_id
      WHERE t.status <> 'abgesagt'
      ORDER BY t.datum DESC, t.von DESC, t.id DESC`,
  );

/** Kunden, zuletzt da zuerst (letzte Buchung bzw. letzter Beleg), dann nach Name. */
const ladeKunden = (): Promise<SuchKunde[]> =>
  abfrage<SuchKunde>(
    `SELECT k.id, k.nummer, k.name, k.zusatz, k.strasse, k.plz, k.ort, k.email, k.telefon
       FROM kunden k
      ORDER BY MAX(COALESCE((SELECT MAX(b.zahlungsdatum) FROM buchungen b WHERE b.kunde_id = k.id), ''),
                   COALESCE((SELECT MAX(r.datum) FROM rechnungen r WHERE r.kunde_id = k.id), ''),
                   substr(k.erstellt_am, 1, 10)) DESC,
               k.name COLLATE NOCASE`,
  );

const ladeKennzahlen = (): Promise<SuchKennzahl[]> =>
  abfrage<SuchKennzahl>(`SELECT id, name, formel, beschreibung FROM kennzahlen ORDER BY sortierung, name COLLATE NOCASE`);

/** Alle Quellen parallel; eine fehlgeschlagene Quelle bleibt leer. */
export async function ladeSuchDaten(): Promise<SuchDaten> {
  const quellen = [ladeBuchungen(), ladeBelege(), ladeTermine(), ladeKunden(), ladeKennzahlen()] as const;
  const [buchungen, belege, termine, kunden, kennzahlen] = await Promise.allSettled(quellen);
  const wert = <T>(r: PromiseSettledResult<T[]>): T[] => {
    if (r.status === 'fulfilled') return r.value;
    console.warn('Suche: Quelle nicht geladen', r.reason);
    return [];
  };
  return {
    ...LEERE_SUCHDATEN,
    buchungen: wert(buchungen),
    belege: wert(belege),
    termine: wert(termine),
    kunden: wert(kunden),
    kennzahlen: wert(kennzahlen),
  };
}
