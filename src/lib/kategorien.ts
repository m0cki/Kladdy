/* Kategorien (ANLEITUNG §2.8, §5 Tabelle kategorien; Standardset aus Migration 0002, Katalog und EÜR-Zuordnung aus der
 * Migration „kategorien“). Reine Logik ohne Datenbank – Speichern in queries/kategorien.ts, Oberfläche in
 * Einstellungen › Steuern (pages/einstellungen/Kategorien.tsx):
 * - Formular prüfen ⇒ Spaltenwerte: Name je Art eindeutig, EÜR-Bereich Pflicht, abziehbarer Anteil nur bei Ausgaben,
 *   „zählt zum Kleinunternehmer-Umsatz“ nur bei Einnahmen, „Wareneingangsbuch“ nur bei Ausgaben, Stichworte klein und
 *   kommagetrennt (Vorschlag beim Erfassen, kategorieAusText in lib/buchungen.ts).
 * - Ausgeblendet = archiviert = 1: beim Erfassen nicht angeboten, auf bestehenden Buchungen weiter gültig. So starten auch
 *   die optionalen Kategorien aus dem Katalog (AfA, Bewirtung, Geschenke, Homeoffice). Je Art bleibt mindestens eine
 *   sichtbar. Gelöscht wird nie (Buchungen verweisen per ID), die Art steht nach dem Anlegen fest.
 * - EÜR-Zuordnung pro Jahr (Tabelle euer_zuordnung): Zeile der Anlage EÜR und, nur wenn nötig, ein eigener EÜR-Bereich
 *   für dieses Jahr (leer = der der Kategorie). Ein Jahr ohne eigene Zuordnung übernimmt die des nächstälteren Jahres
 *   (kopierQuelle, wie die Steuer-Kennwerte). Die EÜR (Phase 5) liest sie über ladeEuerZuordnung(jahr).
 * Tests: kategorien.test.ts */
import { nameSchluessel, type BuchungTyp } from './buchungen';
import { kopierQuelle } from './steuer-kennwerte';

/** Zeile aus kategorien plus Anzahl der Buchungen (queries/kategorien.ts → ladeKategorien). */
export interface Kategorie {
  id: number;
  name: string;
  typ: BuchungTyp;
  euer_bereich: string | null;
  abziehbar_prozent: number;
  zaehlt_ku_umsatz: number;
  wareneingang: number;
  farbe: string | null;
  /** lucide-Name, siehe KATEGORIE_ICONS */
  icon: string | null;
  /** kommagetrennt, klein */
  stichworte: string | null;
  sortierung: number | null;
  /** 1 = ausgeblendet */
  archiviert: number;
  /** Buchungen mit dieser Kategorie (auch stornierte und Gegenbuchungen) */
  buchungen: number;
}

export const NAME_MAX = 40;
export const BEREICH_MAX = 80;
export const STICHWORT_MAX = 30;
export const STICHWORTE_MAX = 40;

/** Symbole zur Auswahl (lucide-Namen wie in kategorien.icon). Die Komponenten dazu: components/buchungen/Symbole.tsx. */
export const KATEGORIE_ICONS = [
  'wrench',
  'box',
  'fuel',
  'ellipsis',
  'tag',
  'hammer',
  'leaf',
  'truck',
  'car',
  'smartphone',
  'megaphone',
  'shield',
  'briefcase',
  'monitor',
  'calculator',
  'trending-down',
  'utensils',
  'gift',
  'house',
] as const;
export type KategorieIconName = (typeof KATEGORIE_ICONS)[number];

/** Namen für Screenreader und Tooltip. */
export const ICON_NAMEN: Readonly<Record<KategorieIconName, string>> = {
  wrench: 'Werkzeug',
  box: 'Kiste',
  fuel: 'Zapfsäule',
  ellipsis: 'Sonstiges',
  tag: 'Etikett',
  hammer: 'Hammer',
  leaf: 'Blatt',
  truck: 'Lieferwagen',
  car: 'Auto',
  smartphone: 'Handy',
  megaphone: 'Werbung',
  shield: 'Versicherung',
  briefcase: 'Aktentasche',
  monitor: 'Bildschirm',
  calculator: 'Rechner',
  'trending-down': 'Abschreibung',
  utensils: 'Besteck',
  gift: 'Geschenk',
  house: 'Haus',
};

export const istKategorieIcon = (v: string | null | undefined): v is KategorieIconName =>
  !!v && (KATEGORIE_ICONS as readonly string[]).includes(v);

/** Farben zur Auswahl (wie die Theme-Presets in §9.1). Gespeichert als Hex in kategorien.farbe, angezeigt nur über --c. */
export const KATEGORIE_FARBEN: readonly { wert: string; name: string }[] = [
  { wert: '#6366f1', name: 'Indigo' },
  { wert: '#0ea5e9', name: 'Ozean' },
  { wert: '#10b981', name: 'Smaragd' },
  { wert: '#f59e0b', name: 'Bernstein' },
  { wert: '#f97316', name: 'Orange' },
  { wert: '#ec4899', name: 'Rosé' },
  { wert: '#a855f7', name: 'Violett' },
  { wert: '#eab308', name: 'Gold' },
  { wert: '#14b8a6', name: 'Türkis' },
  { wert: '#64748b', name: 'Graphit' },
];
const FARBE = /^#[0-9a-f]{6}$/i;

/** Vorschläge fürs Feld „EÜR-Bereich“ (übliche Bereiche der Anlage EÜR); freie Eingabe bleibt möglich. */
export const EUER_BEREICHE: Readonly<Record<BuchungTyp, readonly string[]>> = {
  einnahme: ['Betriebseinnahmen als Kleinunternehmer', 'Umsatzsteuerpflichtige Betriebseinnahmen'],
  ausgabe: [
    'Waren, Roh- und Hilfsstoffe',
    'Bezogene Fremdleistungen',
    'Aufwendungen für geringwertige Wirtschaftsgüter',
    'AfA auf bewegliche Wirtschaftsgüter',
    'Kraftfahrzeugkosten',
    'Telekommunikation',
    'Werbekosten',
    'Beiträge, Gebühren und Versicherungen',
    'Bewirtungsaufwendungen',
    'Geschenke',
    'Häusliches Arbeitszimmer / Tagespauschale',
    'Übrige Betriebsausgaben',
  ],
};

/** Bereiche der vorhandenen Kategorien dieser Art, dann die übrigen Vorschläge (ohne Dubletten). */
export function euerVorschlaege(typ: BuchungTyp, alle: readonly Kategorie[]): string[] {
  const vorhanden = alle.filter((k) => k.typ === typ && k.euer_bereich).map((k) => k.euer_bereich ?? '');
  return [...new Set([...vorhanden, ...EUER_BEREICHE[typ]])];
}

/** Vorbelegung für neue Kategorien: Einnahmen wie die erste vorhandene Einnahme-Kategorie, Ausgaben „Übrige“. */
export function standardBereich(typ: BuchungTyp, alle: readonly Kategorie[]): string {
  if (typ === 'ausgabe') return 'Übrige Betriebsausgaben';
  return alle.find((k) => k.typ === 'einnahme' && k.euer_bereich)?.euer_bereich ?? EUER_BEREICHE.einnahme[0];
}

/* ================= Formular ================= */

/** Eingaben im Formular (Texte wie getippt). */
export interface KategorieFormular {
  typ: BuchungTyp;
  name: string;
  euer_bereich: string;
  /** abziehbarer Anteil in %, nur bei Ausgaben */
  abziehbar: string;
  ku: boolean;
  wareneingang: boolean;
  stichworte: string;
  icon: string;
  farbe: string;
}

/** Geprüft, so wie es in kategorien steht (Kennzeichen als 0/1). */
export interface KategorieDaten {
  typ: BuchungTyp;
  name: string;
  euer_bereich: string;
  abziehbar_prozent: number;
  zaehlt_ku_umsatz: number;
  wareneingang: number;
  stichworte: string | null;
  icon: string;
  farbe: string;
}

export type KategorieFeld = 'typ' | 'name' | 'euer_bereich' | 'abziehbar' | 'stichworte' | 'icon' | 'farbe';
export type KategoriePruefung = { ok: true; daten: KategorieDaten } | { ok: false; fehler: Partial<Record<KategorieFeld, string>> };

/** „Aral, Shell ; Diesel“ ⇒ ['aral', 'shell', 'diesel']: getrennt an Komma, Semikolon oder Zeilenumbruch, klein, ohne Dubletten. */
export function stichworteLesen(text: string): string[] {
  const worte = text
    .split(/[,;\n]/)
    .map((w) => w.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE'))
    .filter(Boolean);
  return [...new Set(worte)];
}

/** Gespeicherte Stichworte zum Anzeigen und Bearbeiten: „aral, shell, diesel“. */
export const stichworteText = (gespeichert: string | null): string => stichworteLesen(gespeichert ?? '').join(', ');

const leerzeichen = (t: string): string => t.trim().replace(/\s+/g, ' ');

/** Formular mit den Werten einer vorhandenen Kategorie. */
export const formularAus = (k: Kategorie): KategorieFormular => ({
  typ: k.typ,
  name: k.name,
  euer_bereich: k.euer_bereich ?? '',
  abziehbar: String(k.abziehbar_prozent),
  ku: k.zaehlt_ku_umsatz !== 0,
  wareneingang: k.wareneingang !== 0,
  stichworte: stichworteText(k.stichworte),
  icon: k.icon ?? 'tag',
  farbe: k.farbe ?? KATEGORIE_FARBEN[0].wert,
});

/** Leeres Formular für eine neue Kategorie: üblicher Bereich, eine Farbe, die noch keine sichtbare Kategorie hat. */
export function neuesFormular(typ: BuchungTyp, alle: readonly Kategorie[]): KategorieFormular {
  const vergeben = new Set(alle.filter((k) => !k.archiviert).map((k) => (k.farbe ?? '').toLowerCase()));
  return {
    typ,
    name: '',
    euer_bereich: standardBereich(typ, alle),
    abziehbar: '100',
    ku: typ === 'einnahme',
    wareneingang: false,
    stichworte: '',
    icon: 'tag',
    farbe: (KATEGORIE_FARBEN.find((f) => !vergeben.has(f.wert)) ?? KATEGORIE_FARBEN[0]).wert,
  };
}

/**
 * Formular prüfen. `bisher` = die Kategorie, die bearbeitet wird (null = neu). Fehler je Feld, sonst die Spaltenwerte.
 * Namen vergleicht nameSchluessel (Groß/klein, Akzente, Leerzeichen egal), nur innerhalb derselben Art.
 */
export function kategoriePruefen(f: KategorieFormular, alle: readonly Kategorie[], bisher: Kategorie | null): KategoriePruefung {
  const fehler: Partial<Record<KategorieFeld, string>> = {};
  if (bisher && f.typ !== bisher.typ) fehler.typ = 'Die Art lässt sich nach dem Anlegen nicht mehr ändern.';

  const name = leerzeichen(f.name);
  if (!name) fehler.name = 'Bitte einen Namen eingeben.';
  else if (name.length > NAME_MAX) fehler.name = `Höchstens ${NAME_MAX} Zeichen.`;
  else {
    const schluessel = nameSchluessel(name);
    const doppelt = alle.find((k) => k.typ === f.typ && k.id !== bisher?.id && nameSchluessel(k.name) === schluessel);
    if (doppelt) fehler.name = doppelt.archiviert ? `„${doppelt.name}“ gibt es schon (ausgeblendet) – bitte dort einblenden.` : `„${doppelt.name}“ gibt es schon.`;
  }

  const bereich = leerzeichen(f.euer_bereich);
  if (!bereich) fehler.euer_bereich = 'Bitte einen EÜR-Bereich eintragen – danach richtet sich die EÜR.';
  else if (bereich.length > BEREICH_MAX) fehler.euer_bereich = `Höchstens ${BEREICH_MAX} Zeichen.`;

  let abziehbar = 100;
  if (f.typ === 'ausgabe') {
    const t = f.abziehbar.replace(/[\s%]/g, '');
    if (!/^\d{1,3}$/.test(t) || Number(t) > 100) fehler.abziehbar = 'Ganze Zahl von 0 bis 100.';
    else abziehbar = Number(t);
  }

  const worte = stichworteLesen(f.stichworte);
  if (worte.length > STICHWORTE_MAX) fehler.stichworte = `Höchstens ${STICHWORTE_MAX} Stichworte.`;
  else if (worte.some((w) => w.length > STICHWORT_MAX)) fehler.stichworte = `Ein Stichwort hat höchstens ${STICHWORT_MAX} Zeichen.`;

  // unbekannte Symbole nur, wenn die Kategorie sie schon hatte (Anzeige fällt dann auf ein Standardsymbol zurück)
  if (!istKategorieIcon(f.icon) && f.icon !== bisher?.icon) fehler.icon = 'Bitte ein Symbol wählen.';
  if (!FARBE.test(f.farbe)) fehler.farbe = 'Bitte eine Farbe wählen.';

  if (Object.keys(fehler).length) return { ok: false, fehler };
  return {
    ok: true,
    daten: {
      typ: f.typ,
      name,
      euer_bereich: bereich,
      abziehbar_prozent: abziehbar,
      zaehlt_ku_umsatz: f.typ === 'einnahme' && f.ku ? 1 : 0,
      wareneingang: f.typ === 'ausgabe' && f.wareneingang ? 1 : 0,
      stichworte: worte.length ? worte.join(',') : null,
      icon: f.icon,
      farbe: f.farbe.toLowerCase(),
    },
  };
}

/** Erste Fehlermeldung (Reihenfolge der Felder im Formular). */
export function ersterFehler(fehler: Partial<Record<KategorieFeld, string>>): string {
  const reihenfolge: readonly KategorieFeld[] = ['typ', 'name', 'euer_bereich', 'abziehbar', 'stichworte', 'icon', 'farbe'];
  for (const k of reihenfolge) {
    const t = fehler[k];
    if (t) return t;
  }
  return 'Bitte die Eingaben prüfen.';
}

/* ================= Ausblenden ================= */

export const LETZTE_SICHTBARE: Readonly<Record<BuchungTyp, string>> = {
  einnahme: 'Mindestens eine Kategorie für Einnahmen muss sichtbar bleiben – sonst lässt sich nichts mehr erfassen.',
  ausgabe: 'Mindestens eine Kategorie für Ausgaben muss sichtbar bleiben – sonst lässt sich nichts mehr erfassen.',
};

/** Darf `k` ausgeblendet werden? null = ja, sonst der Grund (je Art bleibt mindestens eine Kategorie sichtbar). */
export function ausblendenFehler(k: Pick<Kategorie, 'id' | 'typ'>, alle: readonly Kategorie[]): string | null {
  return alle.some((x) => x.typ === k.typ && x.id !== k.id && !x.archiviert) ? null : LETZTE_SICHTBARE[k.typ];
}

/* ================= EÜR-Zuordnung pro Jahr ================= */

/** Zeile aus euer_zuordnung. */
export interface EuerZeile {
  jahr: number;
  kategorie_id: number;
  /** eigener Bereich in diesem Jahr; null = der der Kategorie */
  euer_bereich: string | null;
  /** Zeile der Anlage EÜR; null = nicht eingetragen */
  euer_zeile: number | null;
}

/** Wirksame Zuordnung einer Kategorie in einem Jahr. */
export interface EuerZuordnung {
  kategorie_id: number;
  name: string;
  typ: BuchungTyp;
  /** ausgeblendet – zählt in der EÜR trotzdem, wenn Buchungen darauf verweisen */
  ausgeblendet: boolean;
  /** EÜR-Bereich: eigener des Jahres, sonst der der Kategorie (null, wenn beides fehlt) */
  euer_bereich: string | null;
  /** Zeile der Anlage EÜR; null = nicht eingetragen */
  euer_zeile: number | null;
  /** Jahr, dessen Zuordnung gilt (das Jahr selbst oder das nächstältere mit Zuordnung); null = es gibt noch keine */
  quelle: number | null;
  /** in diesem Jahr gilt ein eigener Bereich statt dem der Kategorie */
  eigener_bereich: boolean;
}

/** Jahre mit eigener Zuordnung, aufsteigend. */
export const euerJahre = (zeilen: readonly EuerZeile[]): number[] => [...new Set(zeilen.map((z) => z.jahr))].sort((a, b) => a - b);

/** Wirksame Zuordnung aller übergebenen Kategorien für `jahr` (gleiche Reihenfolge). */
export function euerZuordnungFuer(jahr: number, kategorien: readonly Kategorie[], zeilen: readonly EuerZeile[]): EuerZuordnung[] {
  const jahre = euerJahre(zeilen);
  const quelle = jahre.includes(jahr) ? jahr : kopierQuelle(jahre, jahr);
  const jeKategorie = new Map(zeilen.filter((z) => z.jahr === quelle).map((z) => [z.kategorie_id, z] as const));
  return kategorien.map((k) => {
    const z = jeKategorie.get(k.id);
    const eigen = z?.euer_bereich ?? null;
    return {
      kategorie_id: k.id,
      name: k.name,
      typ: k.typ,
      ausgeblendet: k.archiviert !== 0,
      euer_bereich: eigen ?? k.euer_bereich,
      euer_zeile: z?.euer_zeile ?? null,
      quelle,
      eigener_bereich: eigen !== null,
    };
  });
}

/** Kategorien der Zuordnungstabelle: sichtbare und ausgeblendete mit Buchungen (die zählen in der EÜR weiter). */
export const euerKategorien = (alle: readonly Kategorie[]): Kategorie[] => alle.filter((k) => !k.archiviert || k.buchungen > 0);

/** Eingabe „EÜR-Bereich“ eines Jahres: leer oder gleich dem der Kategorie ⇒ null (dann gilt der der Kategorie). */
export function euerBereichLesen(eingabe: string, kategorieBereich: string | null): { wert: string | null } | { fehler: string } {
  const t = leerzeichen(eingabe);
  if (!t || t === leerzeichen(kategorieBereich ?? '')) return { wert: null };
  if (t.length > BEREICH_MAX) return { fehler: `Höchstens ${BEREICH_MAX} Zeichen.` };
  return { wert: t };
}

/** Eingabe „Zeile“: leer ⇒ null, sonst eine ganze Zahl von 1 bis 999. */
export function euerZeileLesen(eingabe: string): { wert: number | null } | { fehler: string } {
  const t = eingabe.trim();
  if (!t) return { wert: null };
  if (!/^\d{1,3}$/.test(t) || Number(t) < 1) return { fehler: 'Zeile: ganze Zahl von 1 bis 999.' };
  return { wert: Number(t) };
}
