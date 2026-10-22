/* Firmenlogo (ANLEITUNG §6.10 „Firmenlogo“, §9.7, §7.1): reine Logik ohne Tauri.
 * - Einstellung `firmenlogo` = Dateiname in <appDataDir>/assets (`logo-<sha256>.png`, src-tauri/src/firmenlogo.rs),
 *   leer = App-Symbol. Ausgestellte Belege merken sich den Namen im Schnappschuss (BelegDokument.logo).
 * - Erlaubte Bilder (PNG, JPG, SVG, WebP) und die Zielgröße beim Verkleinern: höchstens 720 × 240 px (16 mm
 *   Logohöhe im Druck brauchen ~190 px), Seitenverhältnis bleibt, nie vergrößert.
 * - PDF: \LogoDatei = `logo.png`, die Bytes gehen als Asset an Tectonic (lib/latex/kompilieren.ts).
 * Ablauf (Dialog, Drop, Canvas, Rückgängig) in lib/logoablage.ts, Rust-Commands in lib/queries/firmenlogo.ts.
 * Tests: firmenlogo.test.ts */
import { endung } from './belege';
import { sichtbare, type Baustein } from './vorlagen/bausteine';

export const LOGO_MAX_BREITE = 720;
export const LOGO_MAX_HOEHE = 240;
/** Fester Name im Temp-Ordner des PDF-Satzes (kein Nutzerwert). */
export const LOGO_TEX_DATEI = 'logo.png';

/** Endungen der Quelldateien ⇒ MIME-Typ (für Blob und Canvas). Rust prüft dieselben Endungen. */
const LOGO_TYPEN: ReadonlyMap<string, string> = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['svg', 'image/svg+xml'],
  ['webp', 'image/webp'],
]);

/** Filter für den nativen Datei-Dialog (`extensions` ohne Punkt). */
export const LOGO_DIALOG_FILTER = { name: 'Bilder (PNG, JPG, SVG, WebP)', extensions: [...LOGO_TYPEN.keys()] };
export const LOGO_TYP_FEHLER = 'Bitte ein Bild wählen (PNG, JPG, SVG oder WebP).';

/** MIME-Typ eines Bildes nach der Endung; null = kein erlaubtes Bild. */
export const logoTyp = (pfad: string): string | null => LOGO_TYPEN.get(endung(pfad)) ?? null;

const NAME = /^logo-[0-9a-f]{64}\.png$/;
/** Name einer abgelegten Logo-Datei (wie Rust `name_pruefen`)? */
export const istLogoName = (v: unknown): v is string => typeof v === 'string' && NAME.test(v);
/** Gespeicherten Wert lesen: gültiger Dateiname oder '' (App-Symbol). */
export const logoAusWert = (v: unknown): string => (istLogoName(v) ? v : '');

/** Zielgröße in Pixeln: höchstens 720 × 240, Seitenverhältnis bleibt, kleinere Bilder bleiben, wie sie sind.
 * Ohne eigene Größe (manche SVG) 512 × 512 wie im Prototyp. */
export function zielMass(breite: number, hoehe: number): { breite: number; hoehe: number } {
  const w = Number.isFinite(breite) && breite > 0 ? breite : 512;
  const h = Number.isFinite(hoehe) && hoehe > 0 ? hoehe : 512;
  const f = Math.min(1, LOGO_MAX_BREITE / w, LOGO_MAX_HOEHE / h);
  return {
    breite: Math.min(LOGO_MAX_BREITE, Math.max(1, Math.round(w * f))),
    hoehe: Math.min(LOGO_MAX_HOEHE, Math.max(1, Math.round(h * f))),
  };
}

/** Zeigt ein sichtbarer Baustein „Kopf mit Logo“ das Logo (Einstellung `logo`)? */
export const vorlageZeigtLogo = (bausteine: readonly Baustein[]): boolean =>
  sichtbare(bausteine).some(({ b }) => b.typ === 'kopf' && b.an('logo'));

/** Welche Datei von mehreren gezogenen das Logo wird: das erste Bild, sonst die erste (sie wird dann abgelehnt). */
export const logoAusPfaden = (pfade: readonly string[]): string | null => pfade.find((p) => logoTyp(p) !== null) ?? pfade[0] ?? null;
