/* Termine (§6.5): Lesen per SQL, Schreiben NUR über die Rust-Commands in src-tauri/src/termine.rs (eine Transaktion je
 * Vorgang: Termin, ggf. neuer Kunde, vorbereiteter Beleg, Protokoll). Zusammengeführt wird in lib/termine.ts.
 * - ladeTermine / ladeTermin: Termine mit Kunde, dazu Belege (am Termin oder über die Einnahme) und Einnahmen.
 * - ladeTerminZaehler: Seitenleiste (§6.1) – heute bzw. rot die nachzutragenden und erledigten ohne Beleg.
 * - ladeTerminStamm: was die Termin-Schublade braucht (Kunden mit Notiz, Einstellungen › Belege, aktive Vorlagen,
 *   Leistungen mit Ø-Betrag). */
import { invoke } from '@tauri-apps/api/core';
import { abfrage, eine, nacheinander } from '../db';
import type { ErtragsArt } from '../ertrag';
import type { BelegDaten } from '../rechnungen';
import {
  leistungsVorschlaege,
  termineZusammenfuehren,
  type LeistungsVorschlag,
  type Termin,
  type TerminBelegZeile,
  type TerminDaten,
  type TerminEinnahmeZeile,
  type TerminKunde,
  type TerminStatus,
  type TerminZeile,
} from '../termine';
import { ladeBelegEinstellungen } from './einstellungen';
import { ladeVorlagenFuerArt } from './vorlagen';

const TERMIN_SQL = `
  SELECT t.id, t.kunde_id, k.name AS kunde_name, k.nummer AS kunde_nummer, k.notiz AS kunde_notiz,
         t.datum, t.von, t.bis, t.adresse, t.leistung, t.betrag_geschaetzt_cent, t.notiz, t.status, t.ohne_beleg
    FROM termine t
    LEFT JOIN kunden k ON k.id = t.kunde_id
   WHERE ($1 IS NULL OR t.id = $1)
   ORDER BY t.datum, t.von, t.id`;

/** Belege am Termin (auch Entwürfe) und bezahlte Rechnungen, deren Einnahme auf den Termin verweist. */
const BELEG_SQL = `
  SELECT r.id, r.termin_id, r.art, r.nummer, r.status, r.summe_cent
    FROM rechnungen r
   WHERE r.termin_id IS NOT NULL AND ($1 IS NULL OR r.termin_id = $1)
  UNION ALL
  SELECT r.id, b.termin_id, r.art, r.nummer, r.status, r.summe_cent
    FROM buchungen b
    JOIN rechnungen r ON r.id = b.rechnung_id
   WHERE b.termin_id IS NOT NULL AND ($1 IS NULL OR b.termin_id = $1)`;

/** Einnahmen zu Terminen (ohne Gegenbuchungen; storniert = es gibt eine Gegenbuchung). */
const EINNAHME_SQL = `
  SELECT b.id, b.termin_id, b.nummer, b.betrag_cent, b.zahlungsdatum, b.zahlungsart, b.rechnung_id,
         CASE WHEN EXISTS (SELECT 1 FROM buchungen s WHERE s.storno_von_id = b.id) THEN 1 ELSE 0 END AS storniert
    FROM buchungen b
   WHERE b.termin_id IS NOT NULL AND b.storno_von_id IS NULL AND ($1 IS NULL OR b.termin_id = $1)`;

async function lade(id: number | null): Promise<Termin[]> {
  const [zeilen, belege, einnahmen] = await Promise.all([
    abfrage<TerminZeile>(TERMIN_SQL, [id]),
    abfrage<TerminBelegZeile>(BELEG_SQL, [id]),
    abfrage<TerminEinnahmeZeile>(EINNAHME_SQL, [id]),
  ]);
  return termineZusammenfuehren(zeilen, belege, einnahmen);
}

/** Alle Termine (die Seite filtert und gruppiert in lib/termine.ts). */
export const ladeTermine = (): Promise<Termin[]> => lade(null);

/** Ein Termin oder null. */
export async function ladeTermin(id: number): Promise<Termin | null> {
  const [t] = await lade(id);
  return t ?? null;
}

/** Seitenleiste: geplante Termine heute; nachzutragende (geplant, vorbei) plus erledigte ohne gültigen Beleg. */
export async function ladeTerminZaehler(heute: string): Promise<{ heute: number; offen: number }> {
  const r = await eine<{ heute: number; offen: number }>(
    `SELECT (SELECT COUNT(*) FROM termine WHERE status = 'geplant' AND datum = $1) AS heute,
            (SELECT COUNT(*) FROM termine WHERE status = 'geplant' AND datum < $1)
          + (SELECT COUNT(*) FROM termine t
              WHERE t.status = 'erledigt' AND t.ohne_beleg = 0
                AND NOT EXISTS (SELECT 1 FROM rechnungen r
                                 WHERE r.nummer IS NOT NULL AND r.status <> 'storniert' AND r.art IN ('quittung', 'rechnung')
                                   AND (r.termin_id = t.id
                                        OR r.id IN (SELECT b.rechnung_id FROM buchungen b WHERE b.termin_id = t.id)))) AS offen`,
    [heute],
  );
  return { heute: r?.heute ?? 0, offen: r?.offen ?? 0 };
}

/* ---------- Stammdaten der Termin-Schublade ---------- */

export interface TerminStamm {
  /** zuletzt besuchte zuerst */
  kunden: TerminKunde[];
  /** Einstellung „Beleg bei Einnahmen“ (Vorauswahl „Beleg vorbereiten“) */
  belegArt: ErtragsArt;
  /** Zahlungsziel neuer Rechnungen in Tagen */
  zielTage: number;
  /** aktive Vorlage je Art (null = Standard) */
  vorlagen: Record<ErtragsArt, number | null>;
  leistungen: LeistungsVorschlag[];
}

const KUNDEN_SQL = `
  SELECT k.id, k.nummer, k.name, k.zusatz, k.strasse, k.plz, k.ort, k.notiz FROM kunden k
   ORDER BY MAX(COALESCE((SELECT MAX(b.zahlungsdatum) FROM buchungen b WHERE b.kunde_id = k.id), ''),
                COALESCE((SELECT MAX(r.datum) FROM rechnungen r WHERE r.kunde_id = k.id), ''),
                COALESCE((SELECT MAX(t.datum) FROM termine t WHERE t.kunde_id = k.id), '')) DESC,
            k.name COLLATE NOCASE`;

/** Betreffs ausgestellter Quittungen (mit Betrag) und Leistungen der Termine. */
const LEISTUNG_SQL = `
  SELECT COALESCE(NULLIF(TRIM(r.betreff), ''),
                  (SELECT p.beschreibung FROM rechnungspositionen p WHERE p.rechnung_id = r.id ORDER BY p.pos LIMIT 1)) AS text,
         r.summe_cent AS cent
    FROM rechnungen r
   WHERE r.art = 'quittung' AND r.nummer IS NOT NULL AND r.status <> 'storniert'
  UNION ALL
  SELECT t.leistung, NULL FROM termine t`;

/** Einstellungen › Belege und die aktiven Vorlagen (Seite Termine: „Quittung vorbereiten“ und „ausstellen“). */
export async function ladeTerminEinstellungen(): Promise<Pick<TerminStamm, 'belegArt' | 'zielTage' | 'vorlagen'>> {
  const [einstellungen, quittung, rechnung] = await Promise.all([ladeBelegEinstellungen(), ladeVorlagenFuerArt('quittung'), ladeVorlagenFuerArt('rechnung')]);
  return {
    belegArt: einstellungen.beleg_art,
    zielTage: einstellungen.zahlungsziel_tage,
    vorlagen: { quittung: quittung.find((v) => v.aktiv)?.id ?? null, rechnung: rechnung.find((v) => v.aktiv)?.id ?? null },
  };
}

export async function ladeTerminStamm(): Promise<TerminStamm> {
  const [kunden, einstellungen, leistungen] = await Promise.all([
    abfrage<TerminKunde>(KUNDEN_SQL),
    ladeTerminEinstellungen(),
    abfrage<{ text: string | null; cent: number | null }>(LEISTUNG_SQL),
  ]);
  return { kunden, ...einstellungen, leistungen: leistungsVorschlaege(leistungen) };
}

/* ---------- Schreiben (Rust) ---------- */

/** Stand vor einem Vorgang (für „Rückgängig“). */
export interface TerminStand {
  status: TerminStatus;
  ohne_beleg: boolean;
  notiz: string | null;
}

/** Antwort der Rust-Commands (termine.rs → TerminErgebnis). */
export interface TerminErgebnis {
  id: number;
  status: TerminStatus | 'geloescht';
  ohne_beleg: boolean;
  kunde_id: number | null;
  kunde_nummer: string | null;
  kunde_neu: boolean;
  entwurf_id: number | null;
  entwurf_aktion: 'neu' | 'geaendert' | null;
  /** verworfene Entwürfe – kommen bei „Rückgängig“ unverändert zurück */
  verworfen: BelegDaten[];
  vorher: TerminStand | null;
}

/** Eintragen (id null) bzw. ändern, mit dem vorbereiteten Beleg (`entwurf` bei Quittung/Rechnung). */
export const terminSpeichern = (id: number | null, daten: TerminDaten, entwurf: BelegDaten | null): Promise<TerminErgebnis> =>
  nacheinander(() => invoke<TerminErgebnis>('termin_speichern', { id, daten, entwurf }));

export const terminErledigt = (id: number, heute: string): Promise<TerminErgebnis> =>
  nacheinander(() => invoke<TerminErgebnis>('termin_erledigt', { id, heute }));

export const terminNichtErledigt = (id: number): Promise<TerminErgebnis> => nacheinander(() => invoke<TerminErgebnis>('termin_nicht_erledigt', { id }));

export const terminOhneBeleg = (id: number): Promise<TerminErgebnis> => nacheinander(() => invoke<TerminErgebnis>('termin_ohne_beleg', { id }));

export const terminAbsagen = (id: number, grund: string | null, heute: string): Promise<TerminErgebnis> =>
  nacheinander(() => invoke<TerminErgebnis>('termin_absagen', { id, grund, heute }));

/** „Rückgängig“: Stand zurück, verworfene Entwürfe wieder anlegen. */
export const terminZuruecksetzen = (id: number, stand: TerminStand, entwuerfe: BelegDaten[]): Promise<TerminErgebnis> =>
  nacheinander(() => invoke<TerminErgebnis>('termin_zuruecksetzen', { id, stand, entwuerfe }));

export const terminLoeschen = (id: number): Promise<TerminErgebnis> => nacheinander(() => invoke<TerminErgebnis>('termin_loeschen', { id }));
