/* Vorlagen des Baukastens in der Datenbank (ANLEITUNG §5 Tabelle vorlagen, §7.0; Seite pages/Vorlagen.tsx).
 *
 * Bedeutung der Tabelle `vorlagen` (seit Phase 3 Teil 5, Spalte `basis` seit Migration 0010):
 * - Die Standardvorlagen liegen im Code (lib/vorlagen/standard.ts), je Art ein oder mehrere Designs ('klassisch',
 *   bei der Quittung auch 'formular'), nie in der Tabelle. Die Tabelle hält nur eigene Kopien, je (Art, Design) genau
 *   eine Zeile („Meine Quittung“, „Meine Quittung (Formular)“ …); `basis` = Schlüssel des Designs (Standard
 *   'klassisch', so bleiben Zeilen von vor 0010 gültig). Sie entsteht bei der ersten Änderung am Design; jede weitere
 *   Änderung überschreibt `bloecke_json` derselben Zeile. Zeilen mit unbekannter `basis` (neueres Update) bleiben liegen.
 * - `ist_standard` = 1 heißt „diese eigene Kopie gilt statt des mitgelieferten Designs“, 0 = abgeschaltet. Je Zeile,
 *   also je Design. „Zurücksetzen“ setzt 0, statt zu löschen: „Rückgängig“ bleibt möglich, Verweise aus
 *   `rechnungen.vorlage_id` bleiben gültig, und die nächste Änderung nimmt dieselbe Zeile wieder (ist_standard = 1).
 * - Welches Design neue Belege einer Art nehmen, steht in der Einstellung 'vorlagen_design' ({ art: schluessel },
 *   fehlt ⇒ 'klassisch'). Wirksame Vorlage = eigene Kopie dieses Designs (wenn aktiv), sonst das Design selbst.
 * - `bloecke_json` = Bausteine wie in lib/vorlagen/bausteine.ts. Beim Lesen fallen unbekannte und für die Art nicht
 *   erlaubte Bausteine weg (`nurErlaubte`).
 * - Ausgestellte Belege frieren ihre Bausteine im `snapshot_json` ein (Beleg-Maske): Spätere Änderungen hier oder ein
 *   App-Update der Standards verändern sie nicht.
 * Keine GoBD-Daten, aber wie die Einstellungen protokolliert (tabelle 'vorlagen', bei Änderungen nur die geänderten
 * Felder) und aus dem Frontend über die Schreib-Warteschlange (`nacheinander`) geschrieben. Lesen geht direkt (auch
 * innerhalb eines `nacheinander`-Auftrags, z. B. beim Finalisieren, ohne auf sich selbst zu warten).
 * Ohne Datenbank (Browser, npm run dev) gilt immer das klassische Design. Tests: vorlagen.test.ts */
import { abfrage, ausfuehren, datenbankVerfuegbar, nacheinander, zeitstempel } from '../db';
import { bausteineAusJson, type Baustein } from '../vorlagen/bausteine';
import { STANDARD_NAME, eigenerName, nurErlaubte } from '../vorlagen/baukasten';
import { istBelegart, type Belegart } from '../vorlagen/dokument';
import { STANDARD_DESIGN, designSchluessel, designsFuer, istDesign, standardVorlage } from '../vorlagen/standard';
import { einstellungAendern, einstellungLesen } from './einstellungen';
import { aenderungen, protokollieren } from './protokoll';

/** Zeile der Tabelle `vorlagen`, wie SQLite sie liefert. */
export interface VorlageZeile {
  id: number;
  name: string;
  art: string;
  /** Design der Kopie; fehlt nur in Zeilen ohne die Spalte (Tests) ⇒ 'klassisch' */
  basis?: string | null;
  bloecke_json: string;
  ist_standard: number;
}

/** Eigene Kopie eines Designs einer Belegart. */
export interface EigeneVorlage {
  id: number;
  name: string;
  art: Belegart;
  /** Schlüssel des Designs (Spalte `basis`) */
  basis: string;
  bausteine: Baustein[];
  /** ist_standard = 1: gilt statt des mitgelieferten Designs */
  aktiv: boolean;
}

/** Eine wählbare Vorlage (Beleg-Maske, Erfassen-Schublade): je Design eine, mit den wirksamen Bausteinen. */
export interface VorlagenWahl {
  /** null = Design aus dem Code, sonst `vorlagen.id` der eigenen Kopie */
  id: number | null;
  /** Schlüssel des Designs */
  design: string;
  name: string;
  bausteine: Baustein[];
  /** das Design, das für neue Belege der Art gilt (Einstellung 'vorlagen_design'); genau eine je Art */
  aktiv: boolean;
}

/** Einstellung: aktives Design je Art, { rechnung: 'klassisch', quittung: 'formular', … } */
export const DESIGN_EINSTELLUNG = 'vorlagen_design';

const ZEILEN_SQL =
  'SELECT id, name, art, basis, bloecke_json, ist_standard FROM vorlagen WHERE art = $1 ORDER BY ist_standard DESC, geaendert_am DESC, id DESC';
const ANLEGEN_SQL = 'INSERT INTO vorlagen (name, art, bloecke_json, ist_standard, geaendert_am, basis) VALUES ($1, $2, $3, 1, $4, $5)';
const AENDERN_SQL = 'UPDATE vorlagen SET bloecke_json = $1, ist_standard = 1, geaendert_am = $2 WHERE id = $3';
const ABSCHALTEN_SQL = 'UPDATE vorlagen SET ist_standard = 0, geaendert_am = $1 WHERE id = $2';

const basisVon = (z: Pick<VorlageZeile, 'basis'>): string => z.basis || STANDARD_DESIGN;

/** Zeile lesen; fremde Arten (z. B. 'gutschrift') ⇒ null. */
export function vorlageAusZeile(z: VorlageZeile): EigeneVorlage | null {
  if (!istBelegart(z.art)) return null;
  return {
    id: z.id,
    name: z.name,
    art: z.art,
    basis: basisVon(z),
    bausteine: nurErlaubte(bausteineAusJson(z.bloecke_json), z.art),
    aktiv: !!z.ist_standard,
  };
}

/** Alle Zeilen der Art (eines Designs), die aktiven (sonst die zuletzt geänderte) zuerst. */
const zeilen = async (art: Belegart, basis?: string): Promise<VorlageZeile[]> => {
  const alle = await abfrage<VorlageZeile>(ZEILEN_SQL, [art]);
  return basis === undefined ? alle : alle.filter((z) => basisVon(z) === basis);
};

/* ---------- Aktives Design je Art (Einstellung 'vorlagen_design') ---------- */

/** Gespeicherten Wert lesen: { art: schluessel }; Unbekanntes und Fehlendes ⇒ 'klassisch'. */
export function designsAusWert(wert: unknown): Record<Belegart, string> {
  const o = wert && typeof wert === 'object' && !Array.isArray(wert) ? (wert as Record<string, unknown>) : {};
  return {
    rechnung: designSchluessel('rechnung', o.rechnung),
    angebot: designSchluessel('angebot', o.angebot),
    quittung: designSchluessel('quittung', o.quittung),
    eigenbeleg: designSchluessel('eigenbeleg', o.eigenbeleg),
  };
}

/** Design, das neue Belege der Art nehmen. Ohne Datenbank 'klassisch'. */
export async function ladeAktivesDesign(art: Belegart): Promise<string> {
  if (!datenbankVerfuegbar()) return STANDARD_DESIGN;
  return designsAusWert(await einstellungLesen(DESIGN_EINSTELLUNG))[art];
}

/** Design für neue Belege der Art festlegen (protokolliert). Andere Arten bleiben, wie sie sind. false = keine Änderung. */
export function speichereAktivesDesign(art: Belegart, schluessel: string): Promise<boolean> {
  if (!istDesign(art, schluessel)) return Promise.reject(new Error(`Unbekanntes Design „${schluessel}“.`));
  return einstellungAendern(DESIGN_EINSTELLUNG, (alt) => {
    const o = alt && typeof alt === 'object' && !Array.isArray(alt) ? (alt as Record<string, unknown>) : {};
    return { ...o, [art]: schluessel };
  });
}

/* ---------- Lesen (auch für die Beleg-Maske) ---------- */

/** Aktive eigene Kopie eines Designs der Art oder null (dann gilt das Design aus dem Code). Ohne Datenbank immer null. */
export async function ladeEigeneVorlage(art: Belegart, basis: string = STANDARD_DESIGN): Promise<EigeneVorlage | null> {
  if (!datenbankVerfuegbar()) return null;
  const z = (await zeilen(art, basis))[0];
  const v = z ? vorlageAusZeile(z) : null;
  return v?.aktiv ? v : null;
}

/** Aktive eigene Kopien aller (bekannten) Designs der Art, je Design höchstens eine. */
export async function ladeEigeneVorlagen(art: Belegart): Promise<Map<string, EigeneVorlage>> {
  const m = new Map<string, EigeneVorlage>();
  if (!datenbankVerfuegbar()) return m;
  for (const z of await zeilen(art)) {
    const v = vorlageAusZeile(z);
    if (v?.aktiv && istDesign(art, v.basis) && !m.has(v.basis)) m.set(v.basis, v);
  }
  return m;
}

/** Bausteine, die für neue Belege der Art gelten: aktives Design, als eigene Kopie, wenn es eine gibt. */
export async function ladeAktiveBausteine(art: Belegart): Promise<Baustein[]> {
  const design = await ladeAktivesDesign(art);
  const v = await ladeEigeneVorlage(art, design);
  return v ? v.bausteine : standardVorlage(art, design);
}

/** Wählbare Vorlagen der Art: je Design eine (eigene Kopie, sonst das Design aus dem Code); genau eine ist `aktiv`. */
export async function ladeVorlagenFuerArt(art: Belegart): Promise<VorlagenWahl[]> {
  const [eigene, aktiv] = await Promise.all([ladeEigeneVorlagen(art), ladeAktivesDesign(art)]);
  const designs = designsFuer(art);
  return designs.map((d) => {
    const v = eigene.get(d.schluessel);
    return {
      id: v?.id ?? null,
      design: d.schluessel,
      name: v?.name ?? (designs.length > 1 ? d.name : STANDARD_NAME),
      bausteine: v?.bausteine ?? standardVorlage(art, d.schluessel),
      aktiv: d.schluessel === aktiv,
    };
  });
}

/* ---------- Schreiben (Vorlagen-Seite) ---------- */

/**
 * Bausteine als eigene Kopie eines Designs der Art speichern und einschalten: legt die Zeile beim ersten Mal an, sonst
 * wird die vorhandene überschrieben (auch eine abgeschaltete – so funktioniert „Rückgängig“ nach „Zurücksetzen“).
 * Ändert nicht, welches Design neue Belege nehmen. Ohne Änderung wird weder geschrieben noch protokolliert.
 */
export function speichereVorlage(art: Belegart, bausteine: readonly Baustein[], basis: string = STANDARD_DESIGN): Promise<EigeneVorlage> {
  if (!istDesign(art, basis)) return Promise.reject(new Error(`Unbekanntes Design „${basis}“.`));
  return nacheinander(async () => {
    const json = JSON.stringify(nurErlaubte(bausteine, art));
    const jetzt = zeitstempel();
    const alt = (await zeilen(art, basis))[0];
    if (!alt) {
      const name = eigenerName(art, basis);
      const { id } = await ausfuehren(ANLEGEN_SQL, [name, art, json, jetzt, basis]);
      if (id == null) throw new Error('Die eigene Vorlage wurde nicht angelegt.');
      await protokollieren({ tabelle: 'vorlagen', datensatzId: id, aktion: 'neu', neu: { name, art, basis, bloecke_json: json, ist_standard: 1 } });
      return { id, name, art, basis, bausteine: bausteineAusJson(json), aktiv: true };
    }
    const diff = aenderungen({ bloecke_json: alt.bloecke_json, ist_standard: alt.ist_standard ? 1 : 0 }, { bloecke_json: json, ist_standard: 1 });
    if (diff) {
      await ausfuehren(AENDERN_SQL, [json, jetzt, alt.id]);
      await protokollieren({ tabelle: 'vorlagen', datensatzId: alt.id, aktion: 'geaendert', ...diff });
    }
    return { id: alt.id, name: alt.name, art, basis, bausteine: bausteineAusJson(json), aktiv: true };
  });
}

/** „Zurücksetzen“: eigene Kopie eines Designs abschalten (ist_standard = 0), danach gilt das Design aus dem Code.
 *  Andere Designs der Art bleiben. false = es war keine aktiv. */
export function vorlageZuruecksetzen(art: Belegart, basis: string = STANDARD_DESIGN): Promise<boolean> {
  return nacheinander(async () => {
    const aktive = (await zeilen(art, basis)).filter((z) => z.ist_standard);
    if (!aktive.length) return false;
    const jetzt = zeitstempel();
    for (const z of aktive) {
      await ausfuehren(ABSCHALTEN_SQL, [jetzt, z.id]);
      await protokollieren({ tabelle: 'vorlagen', datensatzId: z.id, aktion: 'geaendert', alt: { ist_standard: 1 }, neu: { ist_standard: 0 } });
    }
    return true;
  });
}
