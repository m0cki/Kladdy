/* Mitgelieferte Standardvorlagen je Belegart (ANLEITUNG §7.5/§7.6, Prototyp App.sheet.STANDARD).
 *
 * Wo sie liegen: **im Code**, nicht in der Datenbank. So kann ein App-Update die Standards verbessern, ohne Migration.
 * Die Tabelle `vorlagen` hält später (Vorlagen-Seite, Phase 3 Teil 5) nur eigene Kopien: Die erste Änderung an einem
 * Standard legt eine Kopie an, „Zurücksetzen“ nimmt wieder diesen Stand. GoBD: Ausgestellte Belege frieren ihre
 * Bausteine im `snapshot_json` ein – ein späteres Update der Standards verändert sie nicht. */
import type { Baustein } from './bausteine';
import type { Belegart } from './dokument';

export const STANDARD_VORLAGEN: Readonly<Record<Belegart, readonly Baustein[]>> = {
  rechnung: [
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
  angebot: [
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
  quittung: [
    { typ: 'titel', text: '{art}', rechts: 'Nr. {nr}', stil: 'akzent', linie: true },
    { typ: 'quittung_felder' },
    { typ: 'steuerhinweis', groesse: 'klein' },
    { typ: 'text', text: '{schlusstext}', groesse: 'grau' },
    // § 33/§ 34a UStDV: vollständiger Name des leistenden Unternehmers ⇒ Inhaber mit ausgeben
    { typ: 'absenderzeile', text: '{firma} · Inh. {inhaber} · {strasse} · {plz} {ort} · Steuernr. {steuernummer}', linie: false },
    { typ: 'unterschrift', links: 'Ort, Datum', rechts: 'Unterschrift {firma}' },
  ],
  eigenbeleg: [
    { typ: 'titel', text: '{art}', rechts: 'Nr. {nr}', stil: 'akzent', linie: true },
    { typ: 'eigenbeleg_felder' },
    { typ: 'absenderzeile', text: 'Ausgestellt von {inhaber} · {firma} · {strasse} · {plz} {ort}', linie: false },
    { typ: 'unterschrift', links: 'Ort, Datum', rechts: 'Unterschrift {inhaber}' },
  ],
};

/** Kopie der Standardvorlage (zum Bearbeiten, nie das Original verändern). */
export const standardVorlage = (art: Belegart): Baustein[] => STANDARD_VORLAGEN[art].map((b) => ({ ...b }));
