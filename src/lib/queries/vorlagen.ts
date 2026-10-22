/* Vorlagen des Baukastens in der Datenbank (ANLEITUNG §5 Tabelle vorlagen, §7.0; Seite pages/Vorlagen.tsx).
 *
 * Bedeutung der Tabelle `vorlagen` (seit Phase 3 Teil 5):
 * - Die Standardvorlagen liegen im Code (lib/vorlagen/standard.ts), nie in der Tabelle. Die Tabelle hält nur eigene
 *   Kopien, je Belegart genau eine Zeile („Meine Rechnung“ …). Sie entsteht bei der ersten Änderung am Standard;
 *   jede weitere Änderung überschreibt `bloecke_json` derselben Zeile.
 * - `ist_standard` = 1 heißt „diese eigene Kopie ist die Vorlage der Art“ (gilt statt des Standards für neue Belege),
 *   0 = abgeschaltet. „Zurücksetzen“ setzt 0, statt zu löschen: „Rückgängig“ bleibt möglich, Verweise aus
 *   `rechnungen.vorlage_id` bleiben gültig, und die nächste Änderung nimmt dieselbe Zeile wieder (ist_standard = 1).
 * - `bloecke_json` = Bausteine wie in lib/vorlagen/bausteine.ts. Beim Lesen fallen unbekannte und für die Art nicht
 *   erlaubte Bausteine weg (`nurErlaubte`).
 * - Ausgestellte Belege frieren ihre Bausteine im `snapshot_json` ein (Beleg-Maske): Spätere Änderungen hier oder ein
 *   App-Update der Standards verändern sie nicht.
 * Keine GoBD-Daten, aber wie die Einstellungen protokolliert (tabelle 'vorlagen', bei Änderungen nur die geänderten
 * Felder) und aus dem Frontend über die Schreib-Warteschlange (`nacheinander`) geschrieben. Lesen geht direkt (auch
 * innerhalb eines `nacheinander`-Auftrags, z. B. beim Finalisieren, ohne auf sich selbst zu warten).
 * Ohne Datenbank (Browser, npm run dev) gilt immer der Standard. Tests: vorlagen.test.ts */
import { abfrage, ausfuehren, datenbankVerfuegbar, nacheinander, zeitstempel } from '../db';
import { bausteineAusJson, type Baustein } from '../vorlagen/bausteine';
import { EIGENER_NAME, STANDARD_NAME, nurErlaubte } from '../vorlagen/baukasten';
import { istBelegart, type Belegart } from '../vorlagen/dokument';
import { standardVorlage } from '../vorlagen/standard';
import { aenderungen, protokollieren } from './protokoll';

/** Zeile der Tabelle `vorlagen`, wie SQLite sie liefert. */
export interface VorlageZeile {
  id: number;
  name: string;
  art: string;
  bloecke_json: string;
  ist_standard: number;
}

/** Eigene Kopie einer Belegart. */
export interface EigeneVorlage {
  id: number;
  name: string;
  art: Belegart;
  bausteine: Baustein[];
  /** ist_standard = 1: gilt für neue Belege dieser Art */
  aktiv: boolean;
}

/** Eine wählbare Vorlage (Beleg-Maske: Vorlagen-Auswahl). */
export interface VorlagenWahl {
  /** null = Standardvorlage aus dem Code, sonst `vorlagen.id` der eigenen Kopie */
  id: number | null;
  name: string;
  bausteine: Baustein[];
  /** die Vorlage, die für neue Belege der Art gilt (eigene Kopie, sonst der Standard) */
  aktiv: boolean;
}

const ZEILEN_SQL =
  'SELECT id, name, art, bloecke_json, ist_standard FROM vorlagen WHERE art = $1 ORDER BY ist_standard DESC, geaendert_am DESC, id DESC';
const ANLEGEN_SQL = 'INSERT INTO vorlagen (name, art, bloecke_json, ist_standard, geaendert_am) VALUES ($1, $2, $3, 1, $4)';
const AENDERN_SQL = 'UPDATE vorlagen SET bloecke_json = $1, ist_standard = 1, geaendert_am = $2 WHERE id = $3';
const ABSCHALTEN_SQL = 'UPDATE vorlagen SET ist_standard = 0, geaendert_am = $1 WHERE id = $2';

/** Zeile lesen; fremde Arten (z. B. 'gutschrift') ⇒ null. */
export function vorlageAusZeile(z: VorlageZeile): EigeneVorlage | null {
  if (!istBelegart(z.art)) return null;
  return { id: z.id, name: z.name, art: z.art, bausteine: nurErlaubte(bausteineAusJson(z.bloecke_json), z.art), aktiv: !!z.ist_standard };
}

/** Alle Zeilen der Art, die aktive (sonst die zuletzt geänderte) zuerst. */
const zeilen = (art: Belegart): Promise<VorlageZeile[]> => abfrage<VorlageZeile>(ZEILEN_SQL, [art]);

/* ---------- Lesen (auch für die Beleg-Maske) ---------- */

/** Aktive eigene Kopie der Art oder null (dann gilt der Standard). Ohne Datenbank immer null. */
export async function ladeEigeneVorlage(art: Belegart): Promise<EigeneVorlage | null> {
  if (!datenbankVerfuegbar()) return null;
  const z = (await zeilen(art))[0];
  const v = z ? vorlageAusZeile(z) : null;
  return v?.aktiv ? v : null;
}

/** Bausteine, die für neue Belege der Art gelten: eigene Kopie, sonst der Standard. */
export async function ladeAktiveBausteine(art: Belegart): Promise<Baustein[]> {
  const v = await ladeEigeneVorlage(art);
  return v ? v.bausteine : standardVorlage(art);
}

/** Wählbare Vorlagen der Art: immer der Standard (id null), dazu die aktive eigene Kopie; genau eine ist `aktiv`. */
export async function ladeVorlagenFuerArt(art: Belegart): Promise<VorlagenWahl[]> {
  const v = await ladeEigeneVorlage(art);
  const liste: VorlagenWahl[] = [{ id: null, name: STANDARD_NAME, bausteine: standardVorlage(art), aktiv: !v }];
  if (v) liste.push({ id: v.id, name: v.name, bausteine: v.bausteine, aktiv: true });
  return liste;
}

/* ---------- Schreiben (Vorlagen-Seite) ---------- */

/**
 * Bausteine als eigene Vorlage der Art speichern und aktiv schalten: legt die Zeile beim ersten Mal an, sonst wird die
 * vorhandene überschrieben (auch eine abgeschaltete – so funktioniert „Rückgängig“ nach „Zurücksetzen“).
 * Ohne Änderung wird weder geschrieben noch protokolliert.
 */
export function speichereVorlage(art: Belegart, bausteine: readonly Baustein[]): Promise<EigeneVorlage> {
  return nacheinander(async () => {
    const json = JSON.stringify(nurErlaubte(bausteine, art));
    const jetzt = zeitstempel();
    const alt = (await zeilen(art))[0];
    if (!alt) {
      const name = EIGENER_NAME[art];
      const { id } = await ausfuehren(ANLEGEN_SQL, [name, art, json, jetzt]);
      if (id == null) throw new Error('Die eigene Vorlage wurde nicht angelegt.');
      await protokollieren({ tabelle: 'vorlagen', datensatzId: id, aktion: 'neu', neu: { name, art, bloecke_json: json, ist_standard: 1 } });
      return { id, name, art, bausteine: bausteineAusJson(json), aktiv: true };
    }
    const diff = aenderungen({ bloecke_json: alt.bloecke_json, ist_standard: alt.ist_standard ? 1 : 0 }, { bloecke_json: json, ist_standard: 1 });
    if (diff) {
      await ausfuehren(AENDERN_SQL, [json, jetzt, alt.id]);
      await protokollieren({ tabelle: 'vorlagen', datensatzId: alt.id, aktion: 'geaendert', ...diff });
    }
    return { id: alt.id, name: alt.name, art, bausteine: bausteineAusJson(json), aktiv: true };
  });
}

/** „Zurücksetzen“: eigene Kopie abschalten (ist_standard = 0), danach gilt der Standard. false = es war keine aktiv. */
export function vorlageZuruecksetzen(art: Belegart): Promise<boolean> {
  return nacheinander(async () => {
    const aktive = (await zeilen(art)).filter((z) => z.ist_standard);
    if (!aktive.length) return false;
    const jetzt = zeitstempel();
    for (const z of aktive) {
      await ausfuehren(ABSCHALTEN_SQL, [jetzt, z.id]);
      await protokollieren({ tabelle: 'vorlagen', datensatzId: z.id, aktion: 'geaendert', alt: { ist_standard: 1 }, neu: { ist_standard: 0 } });
    }
    return true;
  });
}
