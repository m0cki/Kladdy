/* Mitgelieferte Standardvorlagen je Belegart (ANLEITUNG §7.0, §7.5/§7.6, Prototyp App.sheet.STANDARD).
 *
 * Wo sie liegen: **im Code**, nicht in der Datenbank. So kann ein App-Update die Standards verbessern, ohne Migration.
 * Je Art gibt es ein oder mehrere **Designs** (Schlüssel, Name, Beschreibung, Bausteine). Jede Art hat das Design
 * 'klassisch'; die Quittung zusätzlich 'formular' (wie ein Quittungsblock). Ein weiteres Design ist eine reine
 * Code-Änderung: hier eintragen, fertig (Vorlagen-Seite, Beleg-Maske und Erfassen-Schublade lesen diese Liste).
 * Die Tabelle `vorlagen` hält nur eigene Kopien, je (Art, Design) eine (Spalte `basis`, lib/queries/vorlagen.ts).
 * Welches Design neue Belege einer Art nehmen, steht in der Einstellung 'vorlagen_design' (Standard 'klassisch').
 * GoBD: Ausgestellte Belege frieren ihre Bausteine im `snapshot_json` ein – ein späteres Update der Standards
 * verändert sie nicht. Tests: vorlagen.test.ts */
import type { Baustein } from './bausteine';
import type { Belegart } from './dokument';

export interface VorlagenDesign {
  /** fester Schlüssel (Spalte `vorlagen.basis`, Einstellung 'vorlagen_design', entwurf_json.vorlage_design) */
  schluessel: string;
  name: string;
  beschreibung: string;
  bausteine: readonly Baustein[];
}

/** Design, das jede Art hat; gilt, solange nichts anderes gewählt ist (auch für alte Entwürfe und Kopien). */
export const STANDARD_DESIGN = 'klassisch';

const KLASSISCH = { schluessel: STANDARD_DESIGN, name: 'Klassisch' } as const;

export const STANDARD_VORLAGEN: Readonly<Record<Belegart, readonly VorlagenDesign[]>> = {
  rechnung: [
    {
      ...KLASSISCH,
      beschreibung: 'Kopf mit Logo, Anschrift für den Fensterumschlag, Positionen, GiroCode und Fußzeile',
      bausteine: [
        { typ: 'kopf', logo: true, claim: '{inhaber}' },
        { typ: 'abstand', groesse: 'gross' },
        { typ: 'absenderzeile' },
        { typ: 'anschrift_meta', nr: true, datum: true, leistung: true, kundennr: true, faellig: false },
        { typ: 'abstand', groesse: 'mittel' },
        { typ: 'titel', text: '{art} {nr}' },
        { typ: 'betreff' },
        { typ: 'text', text: 'Guten Tag,\n{einleitung}' },
        { typ: 'positionen' },
        { typ: 'summe', label: 'Gesamtbetrag' },
        { typ: 'steuerhinweis' },
        { typ: 'zahlung' },
        { typ: 'text', text: '{schlusstext}' },
        { typ: 'gruss' },
        { typ: 'fusszeile' },
      ],
    },
  ],
  angebot: [
    {
      ...KLASSISCH,
      beschreibung: 'Kopf mit Logo, Anschrift, Positionen, Gültigkeit und Fußzeile',
      bausteine: [
        { typ: 'kopf', logo: true, claim: '{inhaber}' },
        { typ: 'abstand', groesse: 'gross' },
        { typ: 'absenderzeile' },
        { typ: 'anschrift_meta', nr: true, datum: true, leistung: false, kundennr: true, faellig: true },
        { typ: 'abstand', groesse: 'mittel' },
        { typ: 'titel', text: '{art} {nr}' },
        { typ: 'betreff' },
        { typ: 'text', text: 'Guten Tag,\n{einleitung}' },
        { typ: 'positionen' },
        { typ: 'summe', label: 'Angebotssumme' },
        { typ: 'steuerhinweis' },
        { typ: 'text', text: 'Dieses Angebot ist gültig bis zum {faellig}.' },
        { typ: 'text', text: '{schlusstext}' },
        { typ: 'gruss' },
        { typ: 'fusszeile' },
      ],
    },
  ],
  quittung: [
    {
      ...KLASSISCH,
      beschreibung: 'Titel in Akzentfarbe, Angaben als Kacheln, zwei Unterschriftslinien',
      bausteine: [
        { typ: 'titel', text: '{art}', rechts: 'Nr. {nr}', stil: 'akzent', linie: true },
        { typ: 'quittung_felder' },
        { typ: 'steuerhinweis', groesse: 'klein' },
        { typ: 'text', text: '{schlusstext}', groesse: 'grau' },
        // § 33/§ 34a UStDV: vollständiger Name des leistenden Unternehmers ⇒ Inhaber mit ausgeben
        { typ: 'absenderzeile', text: '{firma} · Inh. {inhaber} · {strasse} · {plz} {ort} · Steuernr. {steuernummer}', linie: false },
        { typ: 'unterschrift', links: 'Ort, Datum', rechts: 'Unterschrift {firma}' },
      ],
    },
    {
      schluessel: 'formular',
      name: 'Formular',
      beschreibung: 'Wie ein Quittungsblock: Firmenkopf, Ankreuzfelder, Unterschriftslinie',
      bausteine: [
        { typ: 'rahmen' },
        // Inhaber und Anschrift (§ 33 UStDV) stehen im Firmenkopf; eigene Zeilen (z. B. „Fahrzeugaufbereitung“) im Untertitel
        { typ: 'firmenblock' },
        { typ: 'titel', text: '{art}', versal: true, stil: 'schwarz' },
        { typ: 'quittung_felder', stil: 'formular', worte: false },
        { typ: 'steuerhinweis', groesse: 'mini' },
        { typ: 'text', text: '{schlusstext}', groesse: 'grau' },
        { typ: 'unterschrift', stil: 'eine', rechts: 'Unterschrift:', unten: false },
      ],
    },
  ],
  eigenbeleg: [
    {
      ...KLASSISCH,
      beschreibung: 'Titel in Akzentfarbe, Angaben als Kacheln, Unterschrift',
      bausteine: [
        { typ: 'titel', text: '{art}', rechts: 'Nr. {nr}', stil: 'akzent', linie: true },
        { typ: 'eigenbeleg_felder' },
        { typ: 'absenderzeile', text: 'Ausgestellt von {inhaber} · {firma} · {strasse} · {plz} {ort}', linie: false },
        { typ: 'unterschrift', links: 'Ort, Datum', rechts: 'Unterschrift {inhaber}' },
      ],
    },
  ],
};

/** Alle Designs der Art (das klassische zuerst). */
export const designsFuer = (art: Belegart): readonly VorlagenDesign[] => STANDARD_VORLAGEN[art];

/** Gibt es das Design für die Art? */
export const istDesign = (art: Belegart, schluessel: unknown): schluessel is string =>
  typeof schluessel === 'string' && STANDARD_VORLAGEN[art].some((d) => d.schluessel === schluessel);

/** Gültiger Design-Schlüssel der Art; Unbekanntes (auch aus alten Daten oder einem neueren Update) ⇒ 'klassisch'. */
export const designSchluessel = (art: Belegart, roh: unknown): string => (istDesign(art, roh) ? roh : STANDARD_DESIGN);

/** Design der Art; unbekannte Schlüssel ⇒ 'klassisch'. */
export function designFuer(art: Belegart, schluessel: string = STANDARD_DESIGN): VorlagenDesign {
  const liste = STANDARD_VORLAGEN[art];
  return liste.find((d) => d.schluessel === schluessel) ?? liste.find((d) => d.schluessel === STANDARD_DESIGN) ?? liste[0];
}

/** Kopie der Bausteine eines Designs (zum Bearbeiten, nie das Original verändern); unbekannt ⇒ 'klassisch'. */
export const standardVorlage = (art: Belegart, schluessel: string = STANDARD_DESIGN): Baustein[] => designFuer(art, schluessel).bausteine.map((b) => ({ ...b }));
