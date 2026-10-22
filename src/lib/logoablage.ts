/* Firmenlogo hochladen, zurücksetzen und anzeigen (ANLEITUNG §6.10 „Firmenlogo“, Prototyp core.js → logoLaden).
 * - Bild per Dialog wählen oder auf die Kachel in Einstellungen › Firma ziehen ⇒ Rust liest die Datei (nur Bilder bis
 *   10 MB) ⇒ der Webview verkleinert per Canvas auf höchstens 720 × 240 px (Transparenz bleibt) ⇒ PNG ⇒ Rust prüft und
 *   legt es unter <appDataDir>/assets/logo-<sha256>.png ab (nie überschreiben, nie löschen) ⇒ Einstellung `firmenlogo`
 *   (mit Protokoll). Übernehmen und Zurücksetzen melden sich mit „Rückgängig“.
 * - Alte Logo-Dateien bleiben liegen: ausgestellte Belege verweisen über ihren Schnappschuss darauf (BelegDokument.logo).
 * - Anzeige: Blob-URL je Dateiname (Seitenleiste, Einstellungen, Blatt-Vorschau), einmal erzeugt.
 * - Im Browser ohne Tauri gibt es kein Logo (App-Symbol) und keinen Fehler. */
import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { create } from 'zustand';
import { useUi } from '../store/ui';
import { dateiName } from './belege';
import { datenbankVerfuegbar } from './db';
import { fehlerText } from './fehler';
import { LOGO_DIALOG_FILTER, LOGO_TYP_FEHLER, istLogoName, logoAusPfaden, logoTyp, zielMass } from './firmenlogo';
import { inTauri } from './menu';
import { ladeFirmenlogo, logoAblegen, logoBytes, logoQuelleLesen, speichereFirmenlogo } from './queries/firmenlogo';

/** Aktuelles Logo (Dateiname, '' = App-Symbol) und ob gerade ein Bild verarbeitet wird. */
export const useFirmenlogo = create<{ name: string; laeuft: boolean }>(() => ({ name: '', laeuft: false }));

/** Einstellung lesen (beim Start der App); ohne Datenbank bleibt das App-Symbol. */
export async function firmenlogoLaden(): Promise<void> {
  if (!datenbankVerfuegbar()) return;
  try {
    useFirmenlogo.setState({ name: await ladeFirmenlogo() });
  } catch {
    /* bleibt beim App-Symbol */
  }
}

const ui = () => useUi.getState();
const warn = (text: string) => ui().showToast({ text, icon: 'warn', sticky: true });

async function setzen(name: string): Promise<void> {
  await speichereFirmenlogo(name);
  useFirmenlogo.setState({ name });
}

/** „Rückgängig“ im Toast: vorherigen Stand wieder setzen (auch das ins Protokoll). */
async function zurueck(name: string): Promise<void> {
  try {
    await setzen(name);
    ui().toast(name ? 'Vorheriges Logo wiederhergestellt' : 'Standard-Symbol wiederhergestellt');
  } catch (e) {
    warn(`Rückgängig ging nicht: ${fehlerText(e)}`);
  }
}

const NICHT_LESBAR = 'Das Bild ließ sich nicht öffnen.';

function bildLaden(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fehler) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fehler(new Error(NICHT_LESBAR));
    img.src = src;
  });
}

/** Bild ⇒ PNG mit höchstens 720 × 240 px (Prototyp logoVerkleinern). */
async function verkleinern(roh: ArrayBuffer, typ: string): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([roh], { type: typ }));
  try {
    const img = await bildLaden(url);
    const { breite, hoehe } = zielMass(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = breite;
    canvas.height = hoehe;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(NICHT_LESBAR);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, breite, hoehe);
    const png = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
    if (!png) throw new Error(NICHT_LESBAR);
    return new Uint8Array(await png.arrayBuffer());
  } catch {
    // auch Fehler des Webviews (z. B. gesperrte Zeichenfläche bei manchen SVG) mit deutscher Meldung
    throw new Error(NICHT_LESBAR);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Bilddatei als Firmenlogo übernehmen: lesen, verkleinern, ablegen, Einstellung setzen – mit „Rückgängig“. */
export async function logoHochladen(pfad: string): Promise<void> {
  const typ = logoTyp(pfad);
  if (!typ) return void warn(`„${dateiName(pfad)}“: ${LOGO_TYP_FEHLER}`);
  if (useFirmenlogo.getState().laeuft) return;
  useFirmenlogo.setState({ laeuft: true });
  try {
    const roh = await logoQuelleLesen(pfad);
    const png = await verkleinern(roh, typ);
    const { name } = await logoAblegen(png);
    const vorher = useFirmenlogo.getState().name;
    if (name === vorher) return void ui().toast('Dieses Logo ist schon eingestellt', 'info');
    await setzen(name);
    ui().showToast({ text: 'Logo übernommen', icon: 'check', actions: [{ label: 'Rückgängig', run: () => void zurueck(vorher) }] });
  } catch (e) {
    warn(`Logo nicht übernommen: ${fehlerText(e)}`);
  } finally {
    useFirmenlogo.setState({ laeuft: false });
  }
}

/** Klick auf Kachel oder „Logo hochladen …“: nativer Dialog (nur Bilder). */
export async function logoWaehlen(): Promise<void> {
  if (!inTauri()) return ui().toast('Das Logo lässt sich nur in der Mac-App hochladen (npm run tauri dev).', 'info');
  try {
    const pfad = await open({ title: 'Firmenlogo wählen', multiple: false, directory: false, filters: [LOGO_DIALOG_FILTER] });
    if (typeof pfad === 'string') await logoHochladen(pfad);
  } catch (e) {
    warn(fehlerText(e));
  }
}

/** Dateien auf die Kachel gezogen: das erste Bild wird das Logo. */
export function logoAusDrop(pfade: readonly string[]): void {
  const pfad = logoAusPfaden(pfade);
  if (pfad) void logoHochladen(pfad);
}

/** „Zurücksetzen“: wieder das App-Symbol (die Logo-Datei bleibt liegen) – mit „Rückgängig“. */
export async function logoZuruecksetzen(): Promise<void> {
  const alt = useFirmenlogo.getState().name;
  if (!alt) return;
  try {
    await setzen('');
    ui().showToast({ text: 'Standard-Symbol wiederhergestellt', icon: 'check', actions: [{ label: 'Rückgängig', run: () => void zurueck(alt) }] });
  } catch (e) {
    warn(`Zurücksetzen ging nicht: ${fehlerText(e)}`);
  }
}

/* ---------- Anzeige ---------- */

const urls = new Map<string, Promise<string>>();

/** Blob-URL eines abgelegten Logos (je Name einmal; die Datei ändert sich nie). */
function logoUrl(name: string): Promise<string> {
  const da = urls.get(name);
  if (da) return da;
  const neu = logoBytes(name).then((b) => URL.createObjectURL(new Blob([new Uint8Array(b)], { type: 'image/png' })));
  urls.set(name, neu);
  neu.catch(() => urls.delete(name));
  return neu;
}

/** URL zum Anzeigen des Logos `name` (null: kein Logo, noch nicht geladen, fehlt oder Browser ohne Tauri). */
export function useLogoUrl(name: string | null | undefined): string | null {
  const [geladen, setGeladen] = useState<{ name: string; url: string } | null>(null);
  useEffect(() => {
    if (!name || !istLogoName(name) || !inTauri()) return;
    let aktiv = true;
    logoUrl(name).then(
      (url) => {
        if (aktiv) setGeladen({ name, url });
      },
      () => undefined,
    );
    return () => {
      aktiv = false;
    };
  }, [name]);
  return name && geladen?.name === name ? geladen.url : null;
}
