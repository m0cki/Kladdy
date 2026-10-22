/* Pflichtangaben-Check (ANLEITUNG §2.3, § 34a UStDV, § 33 UStDV Kleinbetragsrechnung; Prototyp App.sheet.pflichtCheck).
 * Prüft Daten UND Bausteine: Was nirgends gedruckt wird, fehlt auch dann, wenn es in den Daten steht – entfernt man
 * z. B. den Baustein „Steuerhinweis (§ 19)“, ist „Entgelt und § 19-Hinweis“ sofort rot.
 * Ergebnis: [{ label, ok, hint, offen }]; `offen` = in Ordnung, wird aber erst später erledigt (Nummer beim
 * Finalisieren, Unterschrift nach dem Drucken). Angebote sind keine Rechnungen ⇒ keine Pflichtangaben.
 * Tests: pflicht.test.ts */
import { formatBetrag } from '../money';
import { sichtbare, type Baustein } from './bausteine';
import {
  ARTEN,
  HINWEIS_19,
  belegSumme,
  datumText,
  eigenbelegGrundText,
  empfaenger,
  leistungText,
  mengeTausendstel,
  type BelegDokument,
} from './dokument';

export interface Pflichtangabe {
  label: string;
  ok: boolean;
  hint: string;
  offen?: boolean;
}

export interface PflichtOptionen {
  /** Grenze der Kleinbetragsrechnung brutto in Cent (Steuer-Kennwert `kleinbetragsrechnung_cent`, Standard 250 €) */
  kleinbetrag_cent?: number;
  /** Nächste Nummer für den Hinweis „wird beim Finalisieren vergeben (…)“ */
  naechste_nummer?: string | null;
}

export const KLEINBETRAG_STANDARD_CENT = 25_000;

export function pflichtCheck(doc: BelegDokument, bausteine: readonly Baustein[], optionen: PflichtOptionen = {}): Pflichtangabe[] {
  if (doc.art === 'angebot') return [];
  const kleinbetrag = optionen.kleinbetrag_cent ?? KLEINBETRAG_STANDARD_CENT;
  const F = doc.firma;
  const e = empfaenger(doc);
  const gesamt = belegSumme(doc);
  const L = sichtbare(bausteine).map((x) => x.b);
  const hat = (typ: string, pruefe: (b: (typeof L)[number]) => boolean = () => true) => L.some((b) => b.typ === typ && pruefe(b));
  /** {platzhalter} kommt in irgendeinem Text eines sichtbaren Bausteins vor */
  const druckt = (name: string) => L.some((b) => b.texte().some((t) => t.includes(`{${name}}`)));
  const out: Pflichtangabe[] = [];
  const add = (label: string, bausteinOk: boolean, bausteinHint: string, datenOk: boolean, datenHint: string, okHint: string, offen = false) => {
    if (!bausteinOk) out.push({ label, ok: false, hint: bausteinHint });
    else if (!datenOk) out.push({ label, ok: false, hint: datenHint });
    else out.push({ label, ok: true, hint: okHint, ...(offen ? { offen } : {}) });
  };
  const posOk = doc.positionen.length > 0 && doc.positionen.every((p) => p.beschreibung.trim() && mengeTausendstel(p.menge) > 0);

  if (doc.art === 'eigenbeleg') {
    const eb = hat('eigenbeleg_felder');
    const bh = 'Baustein „Eigenbeleg-Angaben“ fehlt';
    const g = doc.eigenbeleg;
    add('Datum der Zahlung', eb, bh, !!doc.datum, 'Datum fehlt', datumText(doc.datum));
    add('Betrag', eb, bh, gesamt > 0, 'Betrag fehlt', `${formatBetrag(gesamt)} · mit Betrag in Worten`);
    add('Zahlungsempfänger', eb, bh, !!e.name, 'Name des Empfängers fehlt', [e.name, ...e.zeilen].join(', ') + (e.zeilen.length ? '' : ' · Anschrift, soweit bekannt'));
    add('Gegenstand / Zweck', eb, bh, !!doc.betreff.trim(), 'Wofür wurde gezahlt?', doc.betreff.trim());
    add('Grund für den Eigenbeleg', eb, bh, !!g && (g.grund !== 'sonstiges' || !!g.grund_text.trim()), 'Grund beschreiben', eigenbelegGrundText(doc));
    add('Unterschrift', hat('unterschrift'), 'Baustein „Unterschrift“ fehlt', true, '', 'nach dem Drucken unterschreiben', true);
    return out;
  }

  const quittung = doc.art === 'quittung';
  const qf = quittung && hat('quittung_felder');
  const fussAdresse = hat('fusszeile', (b) => b.an('adresse'));

  add('Name und Anschrift (Aussteller)', fussAdresse || (druckt('strasse') && druckt('ort')), 'Absenderzeile oder Fußzeile mit Adresse fehlt',
    !!(F.name.trim() && F.strasse.trim() && F.plz.trim() && F.ort.trim()), 'in den Firmendaten ergänzen', `${F.name}, ${F.plz} ${F.ort}`);
  // vollständiger Name des Unternehmers = Inhaber (der Firmenname allein reicht nicht); die Fußzeile „Adresse“ druckt ihn mit
  add('Vollständiger Name (Inhaber)', fussAdresse || druckt('inhaber'), '{inhaber} wird nirgends gedruckt – z. B. in der Absenderzeile ergänzen',
    !!F.inhaber.trim(), 'in den Firmendaten ergänzen', F.inhaber);

  if (quittung && gesamt <= kleinbetrag) {
    const grenze = formatBetrag(kleinbetrag);
    out.push({ label: 'Name und Anschrift (Kunde)', ok: true, hint: e.name ? `${e.name} · optional bis ${grenze}` : `nicht nötig – Kleinbetragsrechnung bis ${grenze}` });
  } else {
    add('Name und Anschrift (Kunde)', hat('anschrift_meta') || qf || druckt('kunde'), 'Baustein „Anschrift & Belegdaten“ fehlt',
      !!(e.name && e.zeilen.length), !e.name ? 'Kunde fehlt' : quittung ? `Anschrift fehlt (Pflicht über ${formatBetrag(kleinbetrag)})` : 'Anschrift fehlt',
      [e.name, e.zeilen[e.zeilen.length - 1]].filter(Boolean).join(', '));
  }

  add('Steuernummer', hat('fusszeile', (b) => b.an('kontakt')) || druckt('steuernummer'), 'Fußzeile oder {steuernummer} fehlt',
    !!F.steuernummer.trim(), 'in den Firmendaten ergänzen', F.steuernummer);
  add('Ausstellungsdatum', hat('anschrift_meta', (b) => b.an('datum')) || qf || druckt('datum'), 'Datum wird nirgends gedruckt',
    !!doc.datum, 'Datum fehlt', datumText(doc.datum));
  const n = doc.positionen.length;
  add('Menge und Art der Leistung', hat('positionen') || qf, 'Baustein „Positionen“ fehlt',
    quittung ? !!doc.betreff.trim() || posOk : posOk, quittung ? 'Wofür? (Leistung / Gegenstand)' : 'Beschreibung oder Menge fehlt',
    quittung && n <= 1 ? doc.betreff.trim() || doc.positionen[0]?.beschreibung.trim() || '' : `${n} ${n === 1 ? 'Position' : 'Positionen'}`);

  const summeGedruckt = hat('summe') || qf || druckt('summe');
  if (doc.ust_modus === 'klein') {
    const h19 = L.some((b) => b.texte().some((t) => /§\s*19/.test(t)));
    add('Entgelt und § 19-Hinweis', summeGedruckt && h19, h19 ? 'Gesamtbetrag wird nicht gedruckt' : 'Baustein „Steuerhinweis (§ 19)“ fehlt',
      gesamt > 0, 'Betrag fehlt', `${formatBetrag(gesamt)} · ${HINWEIS_19.replace(/\.$/, '')}`);
  } else {
    // § 14 Abs. 4 UStG: Nettobetrag, Steuersatz und Steuerbetrag – Belege mit Umsatzsteuer kann die App noch nicht
    add('Entgelt', summeGedruckt, 'Gesamtbetrag wird nicht gedruckt', gesamt > 0, 'Betrag fehlt', formatBetrag(gesamt));
    out.push({ label: 'Steuersatz und Steuerbetrag', ok: false, hint: 'Regelbesteuerung: Belege mit Umsatzsteuer kann Kladdy noch nicht ausstellen' });
  }

  const nrGedruckt = hat('anschrift_meta', (b) => b.an('nr')) || druckt('nr');
  if (!nrGedruckt) out.push({ label: 'Fortlaufende Nummer', ok: false, hint: 'Nummer wird nirgends gedruckt' });
  else if (doc.nummer) out.push({ label: 'Fortlaufende Nummer', ok: true, hint: doc.nummer });
  else {
    const naechste = optionen.naechste_nummer ? ` (${optionen.naechste_nummer})` : '';
    out.push({ label: 'Fortlaufende Nummer', ok: true, hint: `wird beim Finalisieren vergeben${naechste}`, offen: true });
  }

  if (quittung) out.push({ label: 'Leistungsdatum', ok: true, hint: '= Ausstellungsdatum' });
  else {
    add('Leistungsdatum / -zeitraum', hat('anschrift_meta', (b) => b.an('leistung')) || druckt('leistungsdatum'), 'Leistungsdatum wird nirgends gedruckt',
      !!doc.leistung_von, 'Leistungsdatum fehlt', leistungText(doc));
  }
  return out;
}

/** Alles in Ordnung (offene Punkte zählen als erledigt)? */
export const pflichtOk = (liste: readonly Pflichtangabe[]): boolean => liste.every((p) => p.ok);

/** Kurzer Titel für Meldungen, z. B. „Rechnung: 2 Pflichtangaben fehlen“. */
export function pflichtTitel(doc: Pick<BelegDokument, 'art'>, liste: readonly Pflichtangabe[]): string {
  const fehlt = liste.filter((p) => !p.ok).length;
  const art = ARTEN[doc.art].label;
  return fehlt ? `${art}: ${fehlt} ${fehlt === 1 ? 'Pflichtangabe fehlt' : 'Pflichtangaben fehlen'}` : `${art}: alle Pflichtangaben vorhanden`;
}
