/* GoBD-Änderungsprotokoll (ANLEITUNG §2.5, §5 Tabelle protokoll): jede Änderung an buchungen, rechnungen, belege
 * (und weiteren Stammdaten) mit alt/neu als JSON. Stammdaten ohne INTEGER-ID (einstellungen, steuer_parameter,
 * nummernkreise) tragen datensatz_id = 0 und ihren Textschlüssel in protokoll.schluessel (Migration 0003).
 * Einträge werden nur angehängt, nie geändert oder gelöscht.
 * Hinweis: Aus dem Frontend sind Änderung und Protokolleintrag zwei Aufrufe (keine gemeinsame Transaktion, siehe db.ts).
 * Wo beides zwingend zusammengehört (finalisieren, stornieren, festschreiben), schreibt der Rust-Command das Protokoll
 * in seiner Transaktion. Reine Funktionen sind mit Vitest getestet (protokoll.test.ts). */
import { ausfuehren, zeitstempel, type SqlWert } from '../db';

/** 'geloescht' (Migration 0006): Kunde ohne Bezüge gelöscht (§2.10) bzw. Planposten/wiederkehrender Posten gelöscht
 *  (Planungsdaten, §6.9.2), nur über Rust (kunden.rs, liquiditaet.rs), alt = ganze Zeile. */
export type ProtokollAktion = 'neu' | 'geaendert' | 'storniert' | 'geloescht_entwurf' | 'geloescht';

/** Tabellen mit INTEGER-ID (protokoll.datensatz_id ist INTEGER NOT NULL). */
export type ProtokollTabelleId =
  | 'buchungen'
  | 'rechnungen'
  | 'rechnungspositionen'
  | 'belege'
  | 'kunden'
  | 'termine'
  | 'kategorien'
  | 'anlagen'
  | 'planposten'
  | 'wiederkehrend'
  | 'vorlagen';

/** Stammdaten mit Textschlüssel (Migration 0003): datensatz_id = 0, Schlüssel in protokoll.schluessel,
 *  z. B. 'firma' (einstellungen), '2026' (steuer_parameter: Jahr), 'rechnung' (nummernkreise). */
export type ProtokollTabelleText = 'einstellungen' | 'steuer_parameter' | 'nummernkreise';

export type ProtokollTabelle = ProtokollTabelleId | ProtokollTabelleText;

/** Welcher Datensatz: INTEGER-ID oder Textschlüssel, je nach Tabelle. */
export type ProtokollZiel =
  | { tabelle: ProtokollTabelleId; datensatzId: number; schluessel?: undefined }
  | { tabelle: ProtokollTabelleText; schluessel: string; datensatzId?: undefined };

export type ProtokollEintrag = ProtokollZiel & {
  aktion: ProtokollAktion;
  /** Stand vorher (bei 'neu' leer) */
  alt?: Record<string, unknown> | null;
  /** Stand nachher (bei 'geloescht_entwurf' und 'geloescht' leer) */
  neu?: Record<string, unknown> | null;
  /** Standard: jetzt (zeitstempel()) */
  zeitpunkt?: string;
};

const json = (v: Record<string, unknown> | null | undefined): string | null => (v == null ? null : JSON.stringify(v));

/** Prüft den Eintrag und baut das INSERT. Wirft bei unvollständigen Einträgen (Programmfehler). */
export function protokollSql(e: ProtokollEintrag): { sql: string; werte: SqlWert[] } {
  let datensatzId = 0;
  let schluessel: string | null = null;
  if (e.schluessel !== undefined) {
    if (!e.schluessel.trim()) throw new Error(`Protokoll ${e.tabelle}: Schlüssel fehlt`);
    schluessel = e.schluessel;
  } else {
    if (!Number.isSafeInteger(e.datensatzId) || e.datensatzId < 1) {
      throw new RangeError(`Protokoll: ungültige Datensatz-ID ${e.datensatzId}`);
    }
    datensatzId = e.datensatzId;
  }
  const hatAlt = e.alt != null;
  const hatNeu = e.neu != null;
  if (e.aktion === 'neu' && (hatAlt || !hatNeu)) throw new Error('Protokoll „neu“: nur neu, kein alt');
  if (e.aktion === 'geaendert' && (!hatAlt || !hatNeu)) throw new Error('Protokoll „geaendert“: alt und neu angeben');
  if (e.aktion === 'storniert' && !hatAlt && !hatNeu) throw new Error('Protokoll „storniert“: alt oder neu angeben');
  if ((e.aktion === 'geloescht_entwurf' || e.aktion === 'geloescht') && (!hatAlt || hatNeu)) {
    throw new Error(`Protokoll „${e.aktion}“: nur alt, kein neu`);
  }
  return {
    sql:
      'INSERT INTO protokoll (zeitpunkt, tabelle, datensatz_id, aktion, alt_json, neu_json, schluessel) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    werte: [e.zeitpunkt ?? zeitstempel(), e.tabelle, datensatzId, e.aktion, json(e.alt), json(e.neu), schluessel],
  };
}

/** Schreibt einen Eintrag ins Protokoll und gibt seine ID zurück. */
export async function protokollieren(e: ProtokollEintrag): Promise<number | null> {
  const { sql, werte } = protokollSql(e);
  return (await ausfuehren(sql, werte)).id;
}

/**
 * Für 'geaendert': nur die Felder, die sich wirklich geändert haben (Vergleich per JSON), damit das Protokoll lesbar bleibt.
 * Felder, die nur in einem der beiden Stände vorkommen, zählen als geändert. null, wenn sich nichts geändert hat.
 */
export function aenderungen(
  alt: Record<string, unknown>,
  neu: Record<string, unknown>,
): { alt: Record<string, unknown>; neu: Record<string, unknown> } | null {
  const a: Record<string, unknown> = {};
  const n: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(alt), ...Object.keys(neu)])) {
    if (JSON.stringify(alt[k] ?? null) === JSON.stringify(neu[k] ?? null)) continue;
    a[k] = alt[k] ?? null;
    n[k] = neu[k] ?? null;
  }
  return Object.keys(a).length ? { alt: a, neu: n } : null;
}
