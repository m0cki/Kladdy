/* Vorlagen des Baukastens in der Datenbank (ANLEITUNG §5 Tabelle vorlagen, §7.0; Seite pages/Vorlagen.tsx).
 *
 * Bedeutung der Tabelle `vorlagen` (Spalte `basis` seit Migration 0010, `archiviert` seit 0011):
 * - Die mitgelieferten Designs liegen im Code (lib/vorlagen/standard.ts: 'klassisch', bei der Quittung auch
 *   'formular'), nie in der Tabelle, und werden nie verändert. Die Tabelle hält **eigene Vorlagen**, beliebig viele je
 *   Art, jede mit Namen („Meine Quittung“, „Quittung Garten“ …) und `basis` = Design, von dem sie stammt.
 * - Eine eigene Vorlage entsteht über „Neue Vorlage“ (Name frei, Bausteine der gerade gezeigten) oder bei der ersten
 *   Änderung an einem Design (Name „Meine Quittung“, „Meine Quittung (Formular)“, bei Bedarf mit Nummer). Jede weitere
 *   Änderung überschreibt `bloecke_json` derselben Zeile.
 * - „Entfernen“ löscht nie, sondern setzt `archiviert` = 1: Verweise aus `rechnungen.vorlage_id` (Entwürfe, ausgestellte
 *   Belege) bleiben gültig, „Rückgängig“ setzt 0. Entfernte sind nicht mehr wählbar; ein Entwurf, der eine nutzt, zeigt
 *   sie weiter.
 * - `ist_standard` hat seit 0011 keine Bedeutung mehr (neue Zeilen 0). Bis 0010 hieß 1 „Kopie gilt statt des Designs“;
 *   die Migration hat das in die Einstellung übertragen (siehe 0011).
 * - Welche Vorlage neue Belege einer Art nehmen, steht in der Einstellung 'vorlagen_design' ({ art: schluessel },
 *   Schlüssel 'klassisch' … oder 'eigen:<id>', lib/vorlagen/eigene.ts; fehlt oder ungültig ⇒ das Design bzw.
 *   'klassisch').
 * - `bloecke_json` = Bausteine wie in lib/vorlagen/bausteine.ts. Beim Lesen fallen unbekannte und für die Art nicht
 *   erlaubte Bausteine weg (`nurErlaubte`).
 * - Ausgestellte Belege frieren ihre Bausteine im `snapshot_json` ein (Beleg-Maske): Spätere Änderungen hier oder ein
 *   App-Update der Standards verändern sie nicht.
 * Keine GoBD-Daten, aber wie die Einstellungen protokolliert (tabelle 'vorlagen', bei Änderungen nur die geänderten
 * Felder) und aus dem Frontend über die Schreib-Warteschlange (`nacheinander`) geschrieben. Lesen geht direkt (auch
 * innerhalb eines `nacheinander`-Auftrags, z. B. beim Finalisieren, ohne auf sich selbst zu warten).
 * Ohne Datenbank (Browser, npm run dev) gibt es nur die Designs, aktiv ist 'klassisch'. Tests: vorlagen.test.ts */
import { abfrage, ausfuehren, datenbankVerfuegbar, nacheinander, zeitstempel } from '../db';
import { bausteineAusJson, type Baustein } from '../vorlagen/bausteine';
import { eigenerName, nurErlaubte } from '../vorlagen/baukasten';
import { istBelegart, type Belegart } from '../vorlagen/dokument';
import {
  aktiverSchluessel,
  eigeneId,
  eigenSchluessel,
  freierName,
  istWaehlbar,
  nameBereinigen,
  namePruefen,
  vergebeneNamen,
  wahlListe,
  type EigeneVorlage,
  type VorlagenWahl,
} from '../vorlagen/eigene';
import { STANDARD_DESIGN, designSchluessel, istDesign, standardVorlage } from '../vorlagen/standard';
import { einstellungAendernDirekt, einstellungLesen } from './einstellungen';
import { aenderungen, protokollieren } from './protokoll';

export type { EigeneVorlage, VorlagenWahl } from '../vorlagen/eigene';

/** Zeile der Tabelle `vorlagen`, wie SQLite sie liefert. */
export interface VorlageZeile {
  id: number;
  name: string;
  art: string;
  /** Design der Vorlage; fehlt nur in Zeilen ohne die Spalte (Tests) ⇒ 'klassisch' */
  basis?: string | null;
  bloecke_json: string;
  /** 1 = entfernt; fehlt nur in Zeilen ohne die Spalte ⇒ 0 */
  archiviert?: number | null;
}

/** Einstellung: aktive Vorlage je Art, { rechnung: 'klassisch', quittung: 'eigen:12', … } */
export const DESIGN_EINSTELLUNG = 'vorlagen_design';

const SPALTEN = 'id, name, art, basis, bloecke_json, archiviert';
const ZEILEN_SQL = `SELECT ${SPALTEN} FROM vorlagen WHERE art = $1 ORDER BY id`;
const ZEILE_SQL = `SELECT ${SPALTEN} FROM vorlagen WHERE id = $1`;
const ANLEGEN_SQL = 'INSERT INTO vorlagen (name, art, bloecke_json, ist_standard, geaendert_am, basis, archiviert) VALUES ($1, $2, $3, 0, $4, $5, 0)';
const BLOECKE_SQL = 'UPDATE vorlagen SET bloecke_json = $1, geaendert_am = $2 WHERE id = $3';
const NAME_SQL = 'UPDATE vorlagen SET name = $1, geaendert_am = $2 WHERE id = $3';
const ARCHIV_SQL = 'UPDATE vorlagen SET archiviert = $1, geaendert_am = $2 WHERE id = $3';

/** Zeile lesen; fremde Arten (z. B. 'gutschrift') ⇒ null. */
export function vorlageAusZeile(z: VorlageZeile): EigeneVorlage | null {
  if (!istBelegart(z.art)) return null;
  return {
    id: z.id,
    name: z.name,
    art: z.art,
    basis: z.basis || STANDARD_DESIGN,
    bausteine: nurErlaubte(bausteineAusJson(z.bloecke_json), z.art),
    archiviert: !!z.archiviert,
  };
}

const zeilenDerArt = async (art: Belegart): Promise<EigeneVorlage[]> =>
  (await abfrage<VorlageZeile>(ZEILEN_SQL, [art])).flatMap((z) => {
    const v = vorlageAusZeile(z);
    return v ? [v] : [];
  });

async function zeileLesen(id: number): Promise<EigeneVorlage & { json: string }> {
  const z = (await abfrage<VorlageZeile>(ZEILE_SQL, [id]))[0];
  const v = z ? vorlageAusZeile(z) : null;
  if (!z || !v) throw new Error('Diese Vorlage gibt es nicht (mehr).');
  return { ...v, json: z.bloecke_json };
}

function ohneJson(z: EigeneVorlage & { json: string }): EigeneVorlage {
  const { id, name, art, basis, bausteine, archiviert } = z;
  return { id, name, art, basis, bausteine, archiviert };
}

/* ---------- Aktive Vorlage je Art (Einstellung 'vorlagen_design') ---------- */

const istObjekt = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Gespeicherter Wert für eine Art (roh, noch nicht geprüft). */
export const wertFuerArt = (wert: unknown, art: Belegart): unknown => (istObjekt(wert) ? wert[art] : undefined);

/** Alle eigenen Vorlagen der Art, auch entfernte (`archiviert`). Ohne Datenbank keine. */
export async function ladeEigeneVorlagen(art: Belegart): Promise<EigeneVorlage[]> {
  if (!datenbankVerfuegbar()) return [];
  return zeilenDerArt(art);
}

/** Schlüssel der Vorlage, die neue Belege der Art nehmen. Ohne Datenbank 'klassisch'. */
export async function ladeAktivenSchluessel(art: Belegart, eigene?: readonly EigeneVorlage[]): Promise<string> {
  if (!datenbankVerfuegbar()) return STANDARD_DESIGN;
  const [wert, liste] = await Promise.all([einstellungLesen(DESIGN_EINSTELLUNG), eigene ?? zeilenDerArt(art)]);
  return aktiverSchluessel(art, wertFuerArt(wert, art), liste);
}

async function aktivSetzen(art: Belegart, schluessel: string): Promise<boolean> {
  return einstellungAendernDirekt(DESIGN_EINSTELLUNG, (alt) => ({ ...(istObjekt(alt) ? alt : {}), [art]: schluessel }));
}

/** Vorlage für neue Belege der Art festlegen (protokolliert). Andere Arten bleiben. false = keine Änderung. */
export function speichereAktiveVorlage(art: Belegart, schluessel: string): Promise<boolean> {
  return nacheinander(async () => {
    if (!istWaehlbar(art, schluessel, await zeilenDerArt(art))) throw new Error('Diese Vorlage gibt es nicht (mehr).');
    return aktivSetzen(art, schluessel);
  });
}

/* ---------- Lesen (auch für Beleg-Maske, Erfassen-Schublade, Termine) ---------- */

/** Wählbare Vorlagen der Art: Designs, dann eigene (entfernte mit `archiviert`); genau eine ist `aktiv`. */
export async function ladeVorlagenFuerArt(art: Belegart): Promise<VorlagenWahl[]> {
  const eigene = await ladeEigeneVorlagen(art);
  return wahlListe(art, eigene, await ladeAktivenSchluessel(art, eigene));
}

/** Die aktive Vorlage der Art (für neue Entwürfe, z. B. Duplizieren). */
export async function ladeAktiveWahl(art: Belegart): Promise<VorlagenWahl> {
  const liste = await ladeVorlagenFuerArt(art);
  return liste.find((v) => v.aktiv) ?? liste[0];
}

/** Bausteine, die für neue Belege der Art gelten. */
export const ladeAktiveBausteine = async (art: Belegart): Promise<Baustein[]> => (await ladeAktiveWahl(art)).bausteine;

/* ---------- Schreiben (Vorlagen-Seite) ---------- */

export interface AnlegenOptionen {
  /** Design, von dem die Vorlage stammt (bei einer Kopie einer eigenen: deren Basis) */
  basis: string;
  /** fehlt ⇒ „Meine Quittung“ (bzw. „Meine Quittung (Formular)“), bei Bedarf mit Nummer */
  name?: string;
  /** gleich als aktive Vorlage der Art eintragen (erste Änderung am aktiven Design: neue Belege nehmen die Änderung) */
  aktivieren?: boolean;
}

/** Neue eigene Vorlage anlegen (protokolliert). Name wird geprüft (nicht leer, nicht doppelt in der Art). */
export function vorlageAnlegen(art: Belegart, bausteine: readonly Baustein[], o: AnlegenOptionen): Promise<EigeneVorlage> {
  if (!istDesign(art, o.basis)) return Promise.reject(new Error(`Unbekanntes Design „${o.basis}“.`));
  return nacheinander(async () => {
    const vergeben = vergebeneNamen(art, await zeilenDerArt(art));
    const name = o.name === undefined ? freierName(eigenerName(art, o.basis), vergeben) : nameBereinigen(o.name);
    const fehler = namePruefen(name, vergeben);
    if (fehler) throw new Error(fehler);
    const json = JSON.stringify(nurErlaubte(bausteine, art));
    const { id } = await ausfuehren(ANLEGEN_SQL, [name, art, json, zeitstempel(), o.basis]);
    if (id == null) throw new Error('Die eigene Vorlage wurde nicht angelegt.');
    await protokollieren({ tabelle: 'vorlagen', datensatzId: id, aktion: 'neu', neu: { name, art, basis: o.basis, bloecke_json: json } });
    if (o.aktivieren) await aktivSetzen(art, eigenSchluessel(id));
    return { id, name, art, basis: o.basis, bausteine: bausteineAusJson(json), archiviert: false };
  });
}

/** Bausteine einer eigenen Vorlage speichern. Ohne Änderung wird weder geschrieben noch protokolliert. */
export function speichereVorlage(id: number, bausteine: readonly Baustein[]): Promise<EigeneVorlage> {
  return nacheinander(async () => {
    const alt = await zeileLesen(id);
    const json = JSON.stringify(nurErlaubte(bausteine, alt.art));
    const diff = aenderungen({ bloecke_json: alt.json }, { bloecke_json: json });
    if (diff) {
      await ausfuehren(BLOECKE_SQL, [json, zeitstempel(), id]);
      await protokollieren({ tabelle: 'vorlagen', datensatzId: id, aktion: 'geaendert', ...diff });
    }
    return { ...ohneJson(alt), bausteine: bausteineAusJson(json) };
  });
}

/** Eigene Vorlage umbenennen (geprüft wie beim Anlegen). */
export function vorlageUmbenennen(id: number, name: string): Promise<EigeneVorlage> {
  return nacheinander(async () => {
    const alt = await zeileLesen(id);
    const neu = nameBereinigen(name);
    const fehler = namePruefen(neu, vergebeneNamen(alt.art, await zeilenDerArt(alt.art), id));
    if (fehler) throw new Error(fehler);
    if (neu !== alt.name) {
      await ausfuehren(NAME_SQL, [neu, zeitstempel(), id]);
      await protokollieren({ tabelle: 'vorlagen', datensatzId: id, aktion: 'geaendert', alt: { name: alt.name }, neu: { name: neu } });
    }
    return { ...ohneJson(alt), name: neu };
  });
}

/**
 * Eigene Vorlage entfernen: nie löschen, nur `archiviert` = 1 (Belege und Entwürfe verweisen weiter auf sie). War sie
 * die aktive, nehmen neue Belege wieder ihr Design. `warAktiv` für „Rückgängig“.
 */
export function vorlageEntfernen(id: number): Promise<{ vorlage: EigeneVorlage; warAktiv: boolean }> {
  return nacheinander(async () => {
    const v = ohneJson(await zeileLesen(id));
    if (v.archiviert) return { vorlage: v, warAktiv: false };
    const warAktiv = eigeneId(wertFuerArt(await einstellungLesen(DESIGN_EINSTELLUNG), v.art)) === id;
    await ausfuehren(ARCHIV_SQL, [1, zeitstempel(), id]);
    await protokollieren({ tabelle: 'vorlagen', datensatzId: id, aktion: 'geaendert', alt: { archiviert: 0 }, neu: { archiviert: 1 } });
    if (warAktiv) await aktivSetzen(v.art, designSchluessel(v.art, v.basis));
    return { vorlage: { ...v, archiviert: true }, warAktiv };
  });
}

/** „Rückgängig“ nach dem Entfernen: wieder wählbar, auf Wunsch wieder aktiv. */
export function vorlageWiederherstellen(id: number, aktivieren = false): Promise<EigeneVorlage> {
  return nacheinander(async () => {
    const v = ohneJson(await zeileLesen(id));
    if (v.archiviert) {
      await ausfuehren(ARCHIV_SQL, [0, zeitstempel(), id]);
      await protokollieren({ tabelle: 'vorlagen', datensatzId: id, aktion: 'geaendert', alt: { archiviert: 1 }, neu: { archiviert: 0 } });
    }
    if (aktivieren) await aktivSetzen(v.art, eigenSchluessel(id));
    return { ...v, archiviert: false };
  });
}

/** Bausteine des Designs, von dem eine eigene Vorlage stammt („Zurücksetzen“). */
export const basisBausteine = (v: Pick<EigeneVorlage, 'art' | 'basis'>): Baustein[] => standardVorlage(v.art, v.basis);
