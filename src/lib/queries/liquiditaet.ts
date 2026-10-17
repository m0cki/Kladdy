/* Auswertung › Liquidität (§6.9.2): Planposten, wiederkehrende Kosten, bezahlte Rechnungen (Ø Zahlungsverzug) und die
 * gespeicherten Annahmen lesen; Planposten und wiederkehrende Kosten schreiben. Gerechnet wird in lib/liquiditaet.ts.
 * Schreiben über Rust (src-tauri/src/liquiditaet.rs): je eine Transaktion mit Protokolleintrag, wie bei den Kunden.
 * Die Annahmen sind eine Einstellung ('liquiditaet_annahmen', protokolliert wie alle Einstellungen). */
import { invoke } from '@tauri-apps/api/core';
import { abfrage, nacheinander } from '../db';
import {
  annahmenAusWert,
  wiederkehrendAusZeile,
  type Annahmen,
  type BezahlteRechnung,
  type Planposten,
  type Rhythmus,
  type Wiederkehrend,
  type WiederkehrendZeile,
} from '../liquiditaet';
import type { BuchungTyp } from '../buchungen';
import { einstellungLesen, einstellungSchreiben } from './einstellungen';

export const ANNAHMEN_SCHLUESSEL = 'liquiditaet_annahmen';

const PLANPOSTEN_SQL = 'SELECT id, datum, text, betrag_cent FROM planposten ORDER BY datum, id';
const WIEDERKEHREND_SQL = 'SELECT id, vorlage_json, rhythmus, naechstes_datum, aktiv FROM wiederkehrend ORDER BY id';
/** Für den Ø Zahlungsverzug: ausgestellte, bezahlte Rechnungen mit Fälligkeit. */
const BEZAHLT_SQL = `
  SELECT faellig_am, bezahlt_am FROM rechnungen
   WHERE art = 'rechnung' AND status = 'bezahlt' AND nummer IS NOT NULL AND faellig_am IS NOT NULL AND bezahlt_am IS NOT NULL`;

/** Alles für die Vorschau außer Buchungen und offenen Rechnungen (die lädt lib/queries/auswertung.ts mit). */
export interface VorschauZusatz {
  bezahlt: BezahlteRechnung[];
  planposten: Planposten[];
  wiederkehrend: Wiederkehrend[];
  annahmen: Annahmen;
}

export async function ladeVorschauZusatz(): Promise<VorschauZusatz> {
  const [bezahlt, planposten, zeilen, annahmen] = await Promise.all([
    abfrage<BezahlteRechnung>(BEZAHLT_SQL),
    abfrage<Planposten>(PLANPOSTEN_SQL),
    abfrage<WiederkehrendZeile>(WIEDERKEHREND_SQL),
    einstellungLesen(ANNAHMEN_SCHLUESSEL),
  ]);
  const wiederkehrend = zeilen.map(wiederkehrendAusZeile).filter((w): w is Wiederkehrend => w != null);
  return { bezahlt, planposten, wiederkehrend, annahmen: annahmenAusWert(annahmen) };
}

/** Annahmen speichern (Regler: vorher entprellen, sonst landet jeder Zwischenwert im Protokoll). */
export const speichereAnnahmen = (a: Annahmen): Promise<boolean> => einstellungSchreiben(ANNAHMEN_SCHLUESSEL, a);

/* ---------- Schreiben (Rust) ---------- */

export interface PostenErgebnis {
  id: number;
  /** false = nichts geändert */
  geaendert: boolean;
}

/** Wie PlanpostenEingabe in liquiditaet.rs. */
export interface PlanpostenDaten {
  datum: string;
  text: string;
  /** negativ = Ausgabe */
  betrag_cent: number;
}

/** Wie WiederkehrendEingabe in liquiditaet.rs. */
export interface WiederkehrendDaten {
  name: string;
  /** > 0 */
  betrag_cent: number;
  typ: BuchungTyp;
  kategorie_id: number | null;
  rhythmus: Rhythmus;
  /** Anker: nächster Termin */
  naechstes_datum: string;
  /** Tag im Monat; null = Tag von naechstes_datum */
  tag: number | null;
  aktiv: boolean;
}

export const planpostenAnlegen = (daten: PlanpostenDaten, heute: string): Promise<PostenErgebnis> =>
  nacheinander(() => invoke<PostenErgebnis>('planposten_anlegen', { daten, heute }));
export const planpostenAendern = (id: number, daten: PlanpostenDaten, heute: string): Promise<PostenErgebnis> =>
  nacheinander(() => invoke<PostenErgebnis>('planposten_aendern', { id, daten, heute }));
export const planpostenLoeschen = (id: number): Promise<PostenErgebnis> => nacheinander(() => invoke<PostenErgebnis>('planposten_loeschen', { id }));

export const wiederkehrendAnlegen = (daten: WiederkehrendDaten): Promise<PostenErgebnis> =>
  nacheinander(() => invoke<PostenErgebnis>('wiederkehrend_anlegen', { daten }));
export const wiederkehrendAendern = (id: number, daten: WiederkehrendDaten): Promise<PostenErgebnis> =>
  nacheinander(() => invoke<PostenErgebnis>('wiederkehrend_aendern', { id, daten }));
export const wiederkehrendAktiv = (id: number, aktiv: boolean): Promise<PostenErgebnis> =>
  nacheinander(() => invoke<PostenErgebnis>('wiederkehrend_aktiv', { id, aktiv }));
export const wiederkehrendLoeschen = (id: number): Promise<PostenErgebnis> => nacheinander(() => invoke<PostenErgebnis>('wiederkehrend_loeschen', { id }));
