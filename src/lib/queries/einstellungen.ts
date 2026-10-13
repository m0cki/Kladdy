/* Einstellungen in der Datenbank (ANLEITUNG §5 Tabelle einstellungen: schluessel → JSON-Wert, §6.10).
 * Hier: 'firma' (ein Objekt, lib/firma.ts) und 'ust_modus' ('klein' | 'regel'). Darstellung bleibt in localStorage.
 * Jede Änderung landet im Protokoll (tabelle 'einstellungen', schluessel = Einstellung, nur geänderte Felder).
 * Reine Funktionen (wertLesen, protokollFuerEinstellung) sind mit Vitest getestet (einstellungen.test.ts). */
import { ausfuehren, eine, nacheinander } from '../db';
import { firmaAusJson, type Firma } from '../firma';
import { aenderungen, protokollieren, type ProtokollEintrag } from './protokoll';

export type UstModus = 'klein' | 'regel';
export const UST_MODUS_STANDARD: UstModus = 'klein';

const SPEICHERN_SQL =
  'INSERT INTO einstellungen (schluessel, wert) VALUES ($1, $2) ON CONFLICT (schluessel) DO UPDATE SET wert = excluded.wert';

/** Gespeicherten JSON-Text lesen; kaputtes JSON ⇒ null (die Oberfläche fällt dann auf Standardwerte zurück). */
export function wertLesen(roh: string | null | undefined): unknown {
  if (roh == null) return null;
  try {
    return JSON.parse(roh) as unknown;
  } catch {
    return null;
  }
}

const istObjekt = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Protokoll speichert Objekte; einfache Werte (z. B. 'klein') als { wert: … }. */
const alsObjekt = (v: unknown): Record<string, unknown> => (istObjekt(v) ? v : { wert: v });

/**
 * Protokolleintrag für eine Einstellung: 'neu', wenn es sie noch nicht gab (`alt` undefined), sonst 'geaendert' mit
 * nur den geänderten Feldern. null, wenn sich nichts ändert (dann wird auch nichts gespeichert).
 */
export function protokollFuerEinstellung(schluessel: string, alt: unknown, neu: unknown): ProtokollEintrag | null {
  if (alt === undefined) return { tabelle: 'einstellungen', schluessel, aktion: 'neu', neu: alsObjekt(neu) };
  const diff = aenderungen(alsObjekt(alt), alsObjekt(neu));
  return diff ? { tabelle: 'einstellungen', schluessel, aktion: 'geaendert', ...diff } : null;
}

/** Wert einer Einstellung; undefined, wenn sie nie gespeichert wurde. */
export async function einstellungLesen(schluessel: string): Promise<unknown> {
  const z = await eine<{ wert: string }>('SELECT wert FROM einstellungen WHERE schluessel = $1', [schluessel]);
  return z ? wertLesen(z.wert) : undefined;
}

/** Speichert eine Einstellung und protokolliert sie. false = keine Änderung. Läuft in der Schreib-Warteschlange. */
export function einstellungSchreiben(schluessel: string, neu: unknown): Promise<boolean> {
  return nacheinander(async () => {
    const alt = await einstellungLesen(schluessel);
    const eintrag = protokollFuerEinstellung(schluessel, alt, neu);
    if (!eintrag) return false;
    await ausfuehren(SPEICHERN_SQL, [schluessel, JSON.stringify(neu)]);
    await protokollieren(eintrag);
    return true;
  });
}

/* ---------- Firma ---------- */

export const ladeFirma = async (): Promise<Firma> => firmaAusJson(await einstellungLesen('firma'));
export const speichereFirma = (f: Firma): Promise<boolean> => einstellungSchreiben('firma', f);

/* ---------- Umsatzsteuer: Kleinunternehmer (§ 19 UStG) oder Regelbesteuerung ---------- */

export const ustModusAusWert = (v: unknown): UstModus => (v === 'regel' ? 'regel' : UST_MODUS_STANDARD);
export const ladeUstModus = async (): Promise<UstModus> => ustModusAusWert(await einstellungLesen('ust_modus'));
export const speichereUstModus = (m: UstModus): Promise<boolean> => einstellungSchreiben('ust_modus', m);
