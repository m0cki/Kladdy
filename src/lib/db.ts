/* Datenbank-Zugriff (ANLEITUNG §3, §5) über @tauri-apps/plugin-sql.
 * - Welche Datei geöffnet wird, entscheidet allein Rust (src-tauri/src/datenbank.rs, Command `datenbank_url`):
 *   Release „kladdy.db“, Debug „kladdy-dev.db“, beide im App-Verzeichnis. Beim ersten Öffnen laufen die Migrationen.
 * - Ist die Sicherung vor diesen Migrationen beim Start fehlgeschlagen, liefert `datenbank_url` statt der URL die
 *   Meldung: Die Datei bleibt zu (nichts wird ohne Sicherung migriert), Seiten zeigen die Meldung als Ladefehler,
 *   AppShell zusätzlich als bleibenden Toast (`sicherungsFehler`).
 * - Platzhalter in SQL: $1, $2, … (SQLite-Syntax des Plugins).
 * - Das Plugin bindet JS-Zahlen als Float (REAL). In INTEGER-Spalten speichert SQLite ganzzahlige Werte trotzdem als
 *   INTEGER, und Geld ist bei uns immer ganzzahlig (money.ts). Für TEXT-Spalten deshalb Strings übergeben, nie Zahlen
 *   (sonst landet „5.0“ in der Spalte); Wahrheitswerte wandelt sqlWert in 0/1.
 * - Keine Transaktionen aus dem Frontend: Das Plugin verteilt Befehle auf mehrere Verbindungen, ein BEGIN/COMMIT über
 *   mehrere Aufrufe ist nicht sicher. Mehrschritt-Vorgänge (finalisieren, stornieren, festschreiben) laufen als
 *   Rust-Command mit Transaktion (CLAUDE.md).
 * Reine Funktionen (sqlWert, zeitstempel) sind mit Vitest getestet (db.test.ts). */
import { invoke, isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';

/** Was SQLite gebunden bekommt. */
export type SqlWert = string | number | null;
/** Was die Helfer annehmen; wird mit sqlWert umgewandelt. */
export type SqlEingabe = SqlWert | boolean | undefined;

/** Wert für eine Bindung: true/false ⇒ 1/0, undefined ⇒ NULL. Wirft bei NaN/Infinity (wären sonst still 0). */
export function sqlWert(v: SqlEingabe): SqlWert {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' && !Number.isFinite(v)) throw new RangeError(`Ungültiger Zahlenwert für SQL: ${v}`);
  return v;
}

export const sqlWerte = (werte: readonly SqlEingabe[]): SqlWert[] => werte.map(sqlWert);

/** Zeitpunkt für erstellt_am, geaendert_am, protokoll.zeitpunkt: ISO 8601 in UTC auf die Sekunde, z. B. '2026-10-13T20:15:00Z'. */
export function zeitstempel(d: Date = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Gibt es hier eine Datenbank? Nein im Browser (npm run dev): Seiten zeigen dann einen Hinweis statt Daten. */
export const datenbankVerfuegbar = (): boolean => isTauri();

/** Meldung aus Rust, wenn die Sicherung vor Migrationen beim Start fehlgeschlagen ist (was, wo, was tun), sonst null. */
export const sicherungsFehler = (): Promise<string | null> =>
  isTauri() ? invoke<string | null>('sicherung_status') : Promise.resolve(null);

/**
 * Schreibvorgänge nacheinander ausführen (eine gemeinsame Warteschlange). Ersetzt keine Transaktion, verhindert aber,
 * dass zwei schnelle Änderungen (z. B. zwei Felder kurz nacheinander verlassen) ihren alten Stand gleichzeitig lesen.
 * Ein Fehler bricht nur den eigenen Auftrag ab, nicht die folgenden.
 */
let kette: Promise<unknown> = Promise.resolve();
export function nacheinander<T>(auftrag: () => Promise<T>): Promise<T> {
  const ergebnis = kette.then(auftrag, auftrag);
  kette = ergebnis.catch(() => undefined);
  return ergebnis;
}

let verbindung: Promise<Database> | null = null;

/** Die eine Datenbank-Verbindung der App (wird beim ersten Aufruf geöffnet und migriert). */
export function datenbank(): Promise<Database> {
  if (!isTauri()) return Promise.reject(new Error('Die Datenbank gibt es nur in der App (npm run tauri dev).'));
  verbindung ??= invoke<string>('datenbank_url')
    .then((url) => Database.load(url))
    .catch((e: unknown) => {
      verbindung = null; // nächster Aufruf versucht es erneut
      throw e;
    });
  return verbindung;
}

/** SELECT ⇒ Zeilen. */
export async function abfrage<T>(sql: string, werte: readonly SqlEingabe[] = []): Promise<T[]> {
  const db = await datenbank();
  return db.select<T[]>(sql, sqlWerte(werte));
}

/** SELECT ⇒ erste Zeile oder null. */
export async function eine<T>(sql: string, werte: readonly SqlEingabe[] = []): Promise<T | null> {
  const zeilen = await abfrage<T>(sql, werte);
  return zeilen[0] ?? null;
}

export interface Ausgefuehrt {
  /** Anzahl geänderter Zeilen */
  geaendert: number;
  /** rowid der zuletzt eingefügten Zeile (nur bei INSERT sinnvoll) */
  id: number | null;
}

/** INSERT/UPDATE/DELETE. Für INSERT liefert `id` die neue Zeilen-ID. */
export async function ausfuehren(sql: string, werte: readonly SqlEingabe[] = []): Promise<Ausgefuehrt> {
  const db = await datenbank();
  const r = await db.execute(sql, sqlWerte(werte));
  return { geaendert: r.rowsAffected, id: r.lastInsertId ?? null };
}
