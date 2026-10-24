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

/**
 * Ändert eine Einstellung aus ihrem gespeicherten Wert (`aendern(alt)`, alt = undefined, wenn es sie nie gab) und
 * protokolliert sie. Lesen und Schreiben im selben Auftrag der Schreib-Warteschlange: zwei schnelle Änderungen an
 * verschiedenen Teilen eines Objekts (z. B. 'vorlagen_design' je Art) überschreiben sich nicht. false = keine Änderung.
 */
export function einstellungAendern(schluessel: string, aendern: (alt: unknown) => unknown): Promise<boolean> {
  return nacheinander(async () => {
    const alt = await einstellungLesen(schluessel);
    const neu = aendern(alt);
    const eintrag = protokollFuerEinstellung(schluessel, alt, neu);
    if (!eintrag) return false;
    await ausfuehren(SPEICHERN_SQL, [schluessel, JSON.stringify(neu)]);
    await protokollieren(eintrag);
    return true;
  });
}

/** Speichert eine Einstellung und protokolliert sie. false = keine Änderung. Läuft in der Schreib-Warteschlange. */
export const einstellungSchreiben = (schluessel: string, neu: unknown): Promise<boolean> => einstellungAendern(schluessel, () => neu);

/* ---------- Firma ---------- */

export const ladeFirma = async (): Promise<Firma> => firmaAusJson(await einstellungLesen('firma'));
export const speichereFirma = (f: Firma): Promise<boolean> => einstellungSchreiben('firma', f);

/* ---------- Umsatzsteuer: Kleinunternehmer (§ 19 UStG) oder Regelbesteuerung ---------- */

export const ustModusAusWert = (v: unknown): UstModus => (v === 'regel' ? 'regel' : UST_MODUS_STANDARD);
export const ladeUstModus = async (): Promise<UstModus> => ustModusAusWert(await einstellungLesen('ust_modus'));
export const speichereUstModus = (m: UstModus): Promise<boolean> => einstellungSchreiben('ust_modus', m);

/* ---------- Belege (Einstellungen › Belege, §6.10) ---------- */

export interface BelegEinstellungen {
  /** „Beleg bei Einnahmen“: Vorauswahl in der Erfassen-Schublade und für vorbereitete Belege bei Terminen */
  beleg_art: 'quittung' | 'rechnung';
  /** Zahlungsziel neuer Rechnungen in Tagen */
  zahlungsziel_tage: number;
  /** Gültigkeit neuer Angebote in Tagen */
  angebot_tage: number;
}

export const BELEG_EINSTELLUNGEN_STANDARD: BelegEinstellungen = { beleg_art: 'quittung', zahlungsziel_tage: 14, angebot_tage: 30 };

const tage = (v: unknown, standard: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 365 ? v : standard;

/** Gespeicherten Wert lesen; Unbekanntes ⇒ Standard. */
export function belegEinstellungenAusWert(v: unknown): BelegEinstellungen {
  const s = BELEG_EINSTELLUNGEN_STANDARD;
  if (!istObjekt(v)) return { ...s };
  return {
    beleg_art: v.beleg_art === 'rechnung' ? 'rechnung' : 'quittung',
    zahlungsziel_tage: tage(v.zahlungsziel_tage, s.zahlungsziel_tage),
    angebot_tage: tage(v.angebot_tage, s.angebot_tage),
  };
}

export const ladeBelegEinstellungen = async (): Promise<BelegEinstellungen> => belegEinstellungenAusWert(await einstellungLesen('belege'));
export const speichereBelegEinstellungen = (b: BelegEinstellungen): Promise<boolean> => einstellungSchreiben('belege', b);
