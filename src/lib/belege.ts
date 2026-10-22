/* Belege ablegen (§6.3, §6.4 „Beleg“ und „Drag & Drop auf das Fenster“): reine Logik ohne Tauri.
 * - Erlaubte Dateitypen und Größe (spiegelt die Prüfung in Rust, beleg_pruefen), Filter für den Datei-Dialog.
 * - Ergebnis von beleg_pruefen auswerten: gültige Dateien vormerken, ungültige als ein Warn-Text.
 * - Vorgemerkte Dateien zusammenführen (keine doppelten Pfade bzw. Inhalte).
 * - Anzeige: Größe de-DE („1,2 MB“), Dateiart, Hinweis „Schon abgelegt bei Buchung …“, Zusatz im Speichern-Toast.
 * Gelesen wird in lib/queries/belege.ts, der Ablauf (Drop, ⌘O, Anhängen) steht in lib/belegablage.ts. */
import { datumKurz } from './buchungen';

/** Endungen, die Rust annimmt (beleg_pruefen). */
export const BELEG_ENDUNGEN = ['pdf', 'png', 'jpg', 'jpeg', 'heic', 'heif', 'webp', 'tif', 'tiff', 'xml'] as const;
/** Höchstgröße je Datei (50 MB). */
export const MAX_BELEG_BYTES = 50 * 1024 * 1024;

/** Filter für den nativen Datei-Dialog (@tauri-apps/plugin-dialog, `extensions` ohne Punkt). */
export const DIALOG_FILTER = { name: 'Belege (PDF, Bilder, E-Rechnung)', extensions: [...BELEG_ENDUNGEN] };

/** Dateiname aus einem Pfad (macOS „/“, zur Sicherheit auch „\“). */
export const dateiName = (pfad: string): string => pfad.split(/[\\/]/).filter(Boolean).pop() ?? pfad;

/** Endung klein, ohne Punkt; '' wenn keine. */
export function endung(pfad: string): string {
  const name = dateiName(pfad);
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export const erlaubteEndung = (pfad: string): boolean => (BELEG_ENDUNGEN as readonly string[]).includes(endung(pfad));

const ZAHL_1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const ZAHL_0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

/** Bytes ⇒ „512 Byte“, „340 KB“, „1,2 MB“ (Basis 1024 wie im Prototyp). */
export function groesseText(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} Byte`;
  if (bytes < 1024 * 1024) return `${ZAHL_0.format(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${ZAHL_1.format(bytes / (1024 * 1024))} MB`;
}

const DF_TAG = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Zeitstempel (erstellt_am, UTC) ⇒ lokales Datum „03.09.2026“; '' wenn unlesbar. */
export function zeitpunktDatum(ts: string): string {
  const d = new Date(ts);
  if (!Number.isNaN(d.getTime())) return DF_TAG.format(d);
  return /^\d{4}-\d{2}-\d{2}/.test(ts) ? datumKurz(ts.slice(0, 10)) : '';
}

export type DateiArt = 'pdf' | 'bild' | 'xml' | 'datei';

/** Art für Symbol und Beschriftung – nach MIME, sonst nach Endung. */
export function dateiArt(name: string, mime?: string | null): DateiArt {
  const m = (mime ?? '').toLowerCase();
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('image/')) return 'bild';
  if (m.endsWith('/xml') || m.endsWith('+xml')) return 'xml';
  const e = endung(name);
  if (e === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'heic', 'heif', 'webp', 'tif', 'tiff'].includes(e)) return 'bild';
  if (e === 'xml') return 'xml';
  return 'datei';
}

export const DATEI_ART_NAME: Readonly<Record<DateiArt, string>> = { pdf: 'PDF', bild: 'Bild', xml: 'E-Rechnung (XML)', datei: 'Datei' };

/* ---------- Ergebnis von beleg_pruefen ---------- */

/** Wo dieselbe Datei (gleicher Hash) schon liegt. */
export interface BelegDoppelt {
  buchung_id: number;
  nummer: string;
  zahlungsdatum: string;
  storniert: boolean;
}

/** Eine Zeile aus `beleg_pruefen` (eine je Eingabe, gleiche Reihenfolge). */
export interface BelegPruefung {
  pfad: string;
  name: string;
  groesse: number;
  mime: string;
  sha256: string | null;
  /** deutscher Text, wenn die Datei nicht abgelegt werden kann */
  fehler: string | null;
  doppelt: BelegDoppelt[];
}

/** Vorgemerkte Datei (noch nicht abgelegt). */
export interface VorgemerkterBeleg {
  pfad: string;
  name: string;
  groesse: number;
  mime: string;
  sha256: string | null;
  doppelt: BelegDoppelt[];
}

export interface Abgelehnt {
  name: string;
  fehler: string;
}

export interface Auswertung {
  gueltig: VorgemerkterBeleg[];
  abgelehnt: Abgelehnt[];
}

/** Ergebnis aufteilen in vormerkbare und abgelehnte Dateien. */
export function pruefungAuswerten(ergebnisse: readonly BelegPruefung[]): Auswertung {
  const gueltig: VorgemerkterBeleg[] = [];
  const abgelehnt: Abgelehnt[] = [];
  for (const r of ergebnisse) {
    const name = r.name || dateiName(r.pfad);
    if (r.fehler) abgelehnt.push({ name, fehler: r.fehler });
    else gueltig.push({ pfad: r.pfad, name, groesse: r.groesse, mime: r.mime, sha256: r.sha256, doppelt: r.doppelt ?? [] });
  }
  return { gueltig, abgelehnt };
}

/** Neue Dateien an die vorgemerkten anhängen: gleicher Pfad oder gleicher Inhalt (Hash) nur einmal. */
export function belegeZusammenfuehren(alt: readonly VorgemerkterBeleg[], neu: readonly VorgemerkterBeleg[]): VorgemerkterBeleg[] {
  const pfade = new Set(alt.map((b) => b.pfad));
  const hashes = new Set(alt.map((b) => b.sha256).filter((h): h is string => !!h));
  const out = [...alt];
  for (const b of neu) {
    if (pfade.has(b.pfad) || (b.sha256 && hashes.has(b.sha256))) continue;
    pfade.add(b.pfad);
    if (b.sha256) hashes.add(b.sha256);
    out.push(b);
  }
  return out;
}

/* ---------- Texte ---------- */

const zitat = (s: string) => `„${s}“`;

/** Ein Warn-Text für alle abgelehnten Dateien (null, wenn keine). */
export function abgelehntText(liste: readonly Abgelehnt[]): string | null {
  if (!liste.length) return null;
  if (liste.length === 1) return `${zitat(liste[0].name)} nicht übernommen: ${liste[0].fehler}`;
  return `${liste.length} Dateien nicht übernommen: ${liste.map((a) => `${zitat(a.name)} (${a.fehler})`).join(' · ')}`;
}

/** Hinweis unter einer vorgemerkten Datei, die es schon gibt: „Schon abgelegt bei Buchung 2026-0012 (03.09.2026)“. */
export function doppeltText(doppelt: readonly BelegDoppelt[]): string | null {
  if (!doppelt.length) return null;
  const eins = (d: BelegDoppelt) => `${d.nummer} (${datumKurz(d.zahlungsdatum)}${d.storniert ? ', storniert' : ''})`;
  if (doppelt.length === 1) return `Schon abgelegt bei Buchung ${eins(doppelt[0])}`;
  if (doppelt.length === 2) return `Schon abgelegt bei den Buchungen ${eins(doppelt[0])} und ${eins(doppelt[1])}`;
  return `Schon abgelegt bei Buchung ${eins(doppelt[0])} und ${doppelt.length - 1} weiteren`;
}

/** „1 Beleg“ / „3 Belege“ */
export const belegeAnzahl = (n: number): string => `${n} ${n === 1 ? 'Beleg' : 'Belege'}`;

/** Zusatz im Speichern-Toast: „ · 1 Beleg abgelegt“ (leer bei 0). */
export const belegZusatz = (n: number | null | undefined): string => (n && n > 0 ? ` · ${belegeAnzahl(n)} abgelegt` : '');

/** Toast nach „Beleg anhängen“: „2 Belege an Ausgabe 2026-0003 angehängt“. */
export const angehaengtText = (n: number, wo: string): string => `${belegeAnzahl(n)} an ${wo} angehängt`;

/* ---------- Eigene Dropzone einer Seite (z. B. Firmenlogo-Kachel, lib/belegablage.ts) ---------- */

export interface Punkt {
  x: number;
  y: number;
}

/** Position eines Datei-Drags aufs Fenster in CSS-Pixeln. Tauri meldet sie als PhysicalPosition; auf dem Mac sind
 * es aber schon Punkte (wry nimmt draggingLocation ohne Skalierung), anderswo echte Pixel ⇒ durch die Skalierung. */
export function dropPunkt(p: Punkt, skala: number, mac: boolean): Punkt {
  const s = mac || !(skala > 0) ? 1 : skala;
  return { x: p.x / s, y: p.y / s };
}
