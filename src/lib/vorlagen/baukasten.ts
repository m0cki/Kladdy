/* Bearbeiten einer Vorlage im Baukasten (ANLEITUNG §7.0 Seite „Vorlagen“; Prototyp js/pages/vorlagen.js).
 * Reine Funktionen für die Seite pages/Vorlagen.tsx: Bausteine einfügen, entfernen, ausblenden, verschieben (Ziehen und
 * ↑/↓), Einstellungen setzen und Platzhalter an der Schreibmarke einfügen. Alle Funktionen lassen die übergebene Liste
 * unverändert und liefern eine neue (React-Zustand). Welche Bausteine es je Art gibt, steht in BAUSTEINE[typ].arten.
 * Tests: baukasten.test.ts */
import { BAUSTEINE, BAUSTEIN_TYPEN, aufloesen, type Baustein, type BausteinTyp, type Einstellung } from './bausteine';
import type { Belegart } from './dokument';
import { STANDARD_DESIGN, designFuer } from './standard';

/** Name der eigenen Kopie je Art (Tabelle `vorlagen`, lib/queries/vorlagen.ts). */
export const EIGENER_NAME: Readonly<Record<Belegart, string>> = {
  rechnung: 'Meine Rechnung',
  quittung: 'Meine Quittung',
  angebot: 'Mein Angebot',
  eigenbeleg: 'Mein Eigenbeleg',
};

export const STANDARD_NAME = 'Standardvorlage';

/** Name der eigenen Kopie eines Designs: „Meine Quittung“ (klassisch), „Meine Quittung (Formular)“ (andere). */
export const eigenerName = (art: Belegart, design: string = STANDARD_DESIGN): string =>
  design === STANDARD_DESIGN ? EIGENER_NAME[art] : `${EIGENER_NAME[art]} (${designFuer(art, design).name})`;

/** Bausteine, die es für die Art gibt (Palette „+ Baustein hinzufügen“), in Katalog-Reihenfolge. */
export const erlaubteTypen = (art: Belegart): BausteinTyp[] => BAUSTEIN_TYPEN.filter((t) => BAUSTEINE[t].arten.includes(art));

/** Nur Bausteine, die zur Art passen (z. B. keine „Zahlung & GiroCode“ auf der Quittung). */
export const nurErlaubte = (liste: readonly Baustein[], art: Belegart): Baustein[] => liste.filter((b) => BAUSTEINE[b.typ].arten.includes(art));

/** Kurzinfo in der Bausteinliste: erster gefüllter Text (Zeilenumbrüche als „ · “), sonst die Beschreibung. */
export function zusammenfassung(b: Baustein): string {
  const def = BAUSTEINE[b.typ];
  const r = aufloesen(b);
  const feld = def.felder.find((f) => (f.typ === 'text' || f.typ === 'textarea') && r.text(f.key).trim());
  return feld ? r.text(feld.key).trim().replace(/\s*\n\s*/g, ' · ') : def.beschreibung;
}

/** Neuen Baustein (nur Typ, Einstellungen = Standard) unter dem ausgewählten einfügen; ohne Auswahl ans Ende. */
export function einfuegen(liste: readonly Baustein[], typ: BausteinTyp, nach: number | null): { liste: Baustein[]; index: number } {
  const index = nach == null ? liste.length : Math.max(0, Math.min(liste.length, nach + 1));
  const neu = [...liste];
  neu.splice(index, 0, { typ });
  return { liste: neu, index };
}

/** Baustein entfernen. `auswahl` = neue Auswahl, damit derselbe Baustein ausgewählt bleibt (bzw. der Nachbar). */
export function entfernen(liste: readonly Baustein[], index: number, auswahl: number): { liste: Baustein[]; weg: Baustein | null; auswahl: number } {
  if (index < 0 || index >= liste.length) return { liste: [...liste], weg: null, auswahl };
  const neu = [...liste];
  const [weg] = neu.splice(index, 1);
  const s = auswahl > index ? auswahl - 1 : auswahl;
  return { liste: neu, weg, auswahl: Math.max(0, Math.min(s, neu.length - 1)) };
}

/** „Rückgängig“ nach dem Entfernen: wieder an die alte Stelle (höchstens ans Ende). */
export function zurueckEinfuegen(liste: readonly Baustein[], index: number, b: Baustein): { liste: Baustein[]; index: number } {
  const i = Math.max(0, Math.min(liste.length, index));
  const neu = [...liste];
  neu.splice(i, 0, b);
  return { liste: neu, index: i };
}

/** Auge: aus- bzw. wieder einblenden (`aus` fällt beim Einblenden ganz weg, wie im Prototyp). */
export function umschalten(liste: readonly Baustein[], index: number): Baustein[] {
  return liste.map((b, i) => {
    if (i !== index) return b;
    const neu: Baustein = { ...b };
    if (neu.aus) delete neu.aus;
    else neu.aus = true;
    return neu;
  });
}

/** Eine Einstellung des Bausteins setzen. `typ` und `aus` sind keine Einstellungen. */
export function einstellen(liste: readonly Baustein[], index: number, key: string, wert: Einstellung): Baustein[] {
  if (key === 'typ' || key === 'aus') return [...liste];
  return liste.map((b, i) => {
    if (i !== index) return b;
    const neu: Baustein = { ...b };
    neu[key] = wert;
    return neu;
  });
}

/** ↑/↓: mit dem Nachbarn tauschen. `index` = neue Stelle (unverändert am Rand). */
export function verschieben(liste: readonly Baustein[], index: number, richtung: -1 | 1): { liste: Baustein[]; index: number } {
  const j = index + richtung;
  if (index < 0 || index >= liste.length || j < 0 || j >= liste.length) return { liste: [...liste], index };
  const neu = [...liste];
  [neu[index], neu[j]] = [neu[j], neu[index]];
  return { liste: neu, index: j };
}

/**
 * Ziehen: Baustein `von` an die Einfügestelle `stelle` (0 … Länge, gezählt in der alten Liste: 0 = vor den ersten,
 * Länge = hinter den letzten). `index` = wo er danach steht.
 */
export function ziehen(liste: readonly Baustein[], von: number, stelle: number): { liste: Baustein[]; index: number } {
  if (von < 0 || von >= liste.length) return { liste: [...liste], index: von };
  const s = Math.max(0, Math.min(liste.length, stelle));
  const neu = [...liste];
  const [b] = neu.splice(von, 1);
  const index = s > von ? s - 1 : s;
  neu.splice(index, 0, b);
  return { liste: neu, index };
}

/** Ändert das Ziehen an `stelle` überhaupt etwas? (direkt vor oder hinter sich selbst = nein) */
export const ziehenAendert = (von: number, stelle: number): boolean => stelle !== von && stelle !== von + 1;

/** Einfügestelle beim Ziehen aus den senkrechten Mitten der Listeneinträge (von oben nach unten) und der Zeigerhöhe. */
export function stelleAusMitten(mitten: readonly number[], y: number): number {
  const i = mitten.findIndex((m) => y < m);
  return i === -1 ? mitten.length : i;
}

/** Platzhalter `{name}` an der Schreibmarke einfügen (eine Markierung wird ersetzt); ohne Marke ans Ende. */
export function platzhalterEinfuegen(text: string, von: number | null, bis: number | null, name: string): { text: string; cursor: number } {
  const a = Math.max(0, Math.min(von ?? text.length, text.length));
  const b = Math.max(a, Math.min(bis ?? a, text.length));
  const ph = `{${name}}`;
  return { text: text.slice(0, a) + ph + text.slice(b), cursor: a + ph.length };
}
