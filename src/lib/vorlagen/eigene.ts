/* Eigene Vorlagen neben den mitgelieferten Designs (ANLEITUNG §7.0 „Eigene Vorlagen“; Datenbank: lib/queries/vorlagen.ts).
 *
 * Eine wählbare Vorlage hat einen **Schlüssel**: für ein mitgeliefertes Design dessen Schlüssel ('klassisch',
 * 'formular'), für eine eigene Vorlage `eigen:<vorlagen.id>`. Derselbe Schlüssel steht in der Einstellung
 * 'vorlagen_design' (aktive Vorlage je Art), in der Adresse der Vorlagen-Seite (?design=eigen:12) und als Wert der
 * Auswahl „Vorlage“ in Beleg-Maske und Erfassen-Schublade. Ein Entwurf merkt sich weiter `vorlage_id` (eigene Vorlage,
 * sonst NULL) und `entwurf_json.vorlage_design` (Design bzw. Basis der eigenen Vorlage).
 * Reine Funktionen: Liste bauen, aktive Vorlage auflösen, Auswahl finden, Namen prüfen. Tests: eigene.test.ts */
import { STANDARD_NAME } from './baukasten';
import type { Baustein } from './bausteine';
import type { Belegart } from './dokument';
import { STANDARD_DESIGN, designSchluessel, designsFuer, istDesign, standardVorlage } from './standard';

/** Eigene Vorlage einer Belegart (Zeile der Tabelle `vorlagen`). */
export interface EigeneVorlage {
  id: number;
  name: string;
  art: Belegart;
  /** Design, von dem sie stammt (Spalte `basis`; „Zurücksetzen“ nimmt dessen Bausteine) */
  basis: string;
  bausteine: Baustein[];
  /** entfernt (Spalte `archiviert`, Migration 0011): nicht mehr wählbar, Verweise von Belegen bleiben gültig */
  archiviert: boolean;
}

/** Eine wählbare Vorlage (Vorlagen-Seite, Beleg-Maske, Erfassen-Schublade). */
export interface VorlagenWahl {
  /** 'klassisch' … oder 'eigen:<id>' */
  schluessel: string;
  /** null = Design aus dem Code, sonst `vorlagen.id` */
  id: number | null;
  /** Schlüssel des Designs bzw. Basis der eigenen Vorlage (entwurf_json.vorlage_design) */
  design: string;
  name: string;
  bausteine: Baustein[];
  /** die Vorlage, die neue Belege der Art nehmen (Einstellung 'vorlagen_design'); genau eine je Art */
  aktiv: boolean;
  /** entfernte eigene Vorlage: nur dabei, damit Entwürfe, die sie nutzen, sie weiter zeigen */
  archiviert?: boolean;
}

const PREFIX = 'eigen:';
/** Höchstlänge eines Namens */
export const NAME_MAX = 60;

export const eigenSchluessel = (id: number): string => `${PREFIX}${id}`;

/** ID aus 'eigen:<id>', sonst null. */
export function eigeneId(schluessel: unknown): number | null {
  if (typeof schluessel !== 'string' || !schluessel.startsWith(PREFIX)) return null;
  const n = Number(schluessel.slice(PREFIX.length));
  return Number.isSafeInteger(n) && n > 0 && String(n) === schluessel.slice(PREFIX.length) ? n : null;
}

/** Name eines mitgelieferten Designs in Listen: „Standardvorlage“, wenn die Art nur eins hat, sonst „Klassisch“ … */
export const designName = (art: Belegart, design: string): string => {
  const designs = designsFuer(art);
  return designs.length > 1 ? (designs.find((d) => d.schluessel === design)?.name ?? designs[0].name) : STANDARD_NAME;
};

/** Gibt es den Schlüssel als Vorlage der Art? (Design oder nicht entfernte eigene Vorlage) */
export const istWaehlbar = (art: Belegart, schluessel: unknown, eigene: readonly Pick<EigeneVorlage, 'id' | 'archiviert'>[]): schluessel is string => {
  if (istDesign(art, schluessel)) return true;
  const id = eigeneId(schluessel);
  return id != null && eigene.some((v) => v.id === id && !v.archiviert);
};

/** Gespeicherten Wert der Einstellung für eine Art auflösen: gültig ⇒ derselbe Schlüssel, sonst das Design
 *  ('eigen:…' einer entfernten oder fremden Vorlage ⇒ 'klassisch'). */
export const aktiverSchluessel = (art: Belegart, roh: unknown, eigene: readonly Pick<EigeneVorlage, 'id' | 'archiviert'>[]): string =>
  istWaehlbar(art, roh, eigene) ? roh : designSchluessel(art, roh);

/** Reihenfolge: mitgelieferte Designs wie im Code, dann eigene Vorlagen nach Name (de), entfernte zuletzt. */
export function wahlListe(art: Belegart, eigene: readonly EigeneVorlage[], aktiv: string): VorlagenWahl[] {
  const designs: VorlagenWahl[] = designsFuer(art).map((d) => ({
    schluessel: d.schluessel,
    id: null,
    design: d.schluessel,
    name: designName(art, d.schluessel),
    bausteine: standardVorlage(art, d.schluessel),
    aktiv: d.schluessel === aktiv,
  }));
  const sortiert = eigene
    .filter((v) => v.art === art)
    .slice()
    .sort((a, b) => Number(a.archiviert) - Number(b.archiviert) || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }) || a.id - b.id);
  const mine: VorlagenWahl[] = sortiert.map((v) => ({
    schluessel: eigenSchluessel(v.id),
    id: v.id,
    design: designSchluessel(art, v.basis),
    name: v.name,
    bausteine: v.bausteine,
    aktiv: !v.archiviert && eigenSchluessel(v.id) === aktiv,
    ...(v.archiviert ? { archiviert: true } : {}),
  }));
  return [...designs, ...mine];
}

/** Gewählte Vorlage finden: eigene über die ID, sonst das Design (id null). undefined = nicht da. */
export function wahlFinden(liste: readonly VorlagenWahl[], g: { id: number | null; design?: string } | null | undefined): VorlagenWahl | undefined {
  if (!g) return undefined;
  if (g.id != null) {
    const v = liste.find((x) => x.id === g.id);
    if (v) return v;
  }
  const design = g.design ?? STANDARD_DESIGN;
  return liste.find((x) => x.id === null && x.design === design);
}

/** Einträge für eine Auswahl: alle nicht entfernten, dazu die gerade gewählte, auch wenn sie entfernt ist. */
export const waehlbar = (liste: readonly VorlagenWahl[], gewaehlt?: VorlagenWahl | null): VorlagenWahl[] =>
  liste.filter((v) => !v.archiviert || v.schluessel === gewaehlt?.schluessel);

/** Name in Auswahllisten: entfernte mit Zusatz. */
export const wahlName = (v: Pick<VorlagenWahl, 'name' | 'archiviert'>): string => (v.archiviert ? `${v.name} (entfernt)` : v.name);

/** Namen vereinheitlichen: Leerraum am Rand weg, innen ein Leerzeichen. */
export const nameBereinigen = (name: string): string => name.replace(/\s+/g, ' ').trim();

const gleich = (a: string, b: string) => a.localeCompare(b, 'de', { sensitivity: 'base' }) === 0;

/**
 * Name einer eigenen Vorlage prüfen. `vergeben` = Namen der Vorlagen der Art (Designs und nicht entfernte eigene, ohne
 * die umbenannte selbst). null = in Ordnung, sonst die Meldung.
 */
export function namePruefen(name: string, vergeben: readonly string[]): string | null {
  const n = nameBereinigen(name);
  if (!n) return 'Bitte einen Namen eingeben.';
  if (n.length > NAME_MAX) return `Höchstens ${NAME_MAX} Zeichen.`;
  if (vergeben.some((v) => gleich(v, n))) return `„${n}“ gibt es schon.`;
  return null;
}

/** Freier Name: „Meine Quittung“, sonst „Meine Quittung 2“, „… 3“ … */
export function freierName(wunsch: string, vergeben: readonly string[]): string {
  const basis = nameBereinigen(wunsch);
  if (!vergeben.some((v) => gleich(v, basis))) return basis;
  for (let i = 2; ; i++) {
    const n = `${basis} ${i}`;
    if (!vergeben.some((v) => gleich(v, n))) return n;
  }
}

/** Vergebene Namen einer Art (für namePruefen/freierName): Designs und nicht entfernte eigene, ohne `ohneId`. */
export const vergebeneNamen = (art: Belegart, eigene: readonly Pick<EigeneVorlage, 'id' | 'name' | 'archiviert'>[], ohneId?: number): string[] => [
  ...designsFuer(art).map((d) => designName(art, d.schluessel)),
  ...eigene.filter((v) => !v.archiviert && v.id !== ohneId).map((v) => v.name),
];
