/* Pflichtangaben-Check (ANLEITUNG §2.3, § 34a UStDV, § 33 UStDV Kleinbetragsrechnung; Prototyp App.sheet.pflichtCheck).
 * Prüft Daten UND Bausteine: Was nirgends gedruckt wird, fehlt auch dann, wenn es in den Daten steht – entfernt man
 * z. B. den Baustein „Steuerhinweis (§ 19)“, ist „Entgelt und § 19-Hinweis“ sofort rot.
 * Ergebnis: [{ label, ok, hint, offen }]; `offen` = in Ordnung, wird aber erst später erledigt (Nummer beim
 * Finalisieren, Unterschrift nach dem Drucken). Angebote sind keine Rechnungen ⇒ keine Pflichtangaben.
 * Blanko-Formular (`doc.blanko`): geprüft wird nur, ob die Vorlage die Angabe druckt (und die Firmendaten); Werte des
 * Belegs gelten als offen („von Hand eintragen“), statt wegen leerer Werte rot zu werden.
 * Tests: pflicht.test.ts */
import { formatBetrag } from '../money';
import { quittungAngaben, sichtbare, type Baustein, type QuittungAngaben } from './bausteine';
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

/** Hinweis für Werte, die im Blanko-Formular von Hand eingetragen werden */
const HAND = 'wird von Hand eingetragen';

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
  const blanko = !!doc.blanko;
  /** Angabe, deren Wert im Beleg steht: im Blanko-Formular von Hand eingetragen (offen), sonst wie `add` */
  const wert = (label: string, bausteinOk: boolean, bausteinHint: string, datenOk: boolean, datenHint: string, okHint: string, hand = HAND) =>
    blanko ? add(label, bausteinOk, bausteinHint, true, '', hand, true) : add(label, bausteinOk, bausteinHint, datenOk, datenHint, okHint);
  const posOk = doc.positionen.length > 0 && doc.positionen.every((p) => p.beschreibung.trim() && mengeTausendstel(p.menge) > 0);

  if (doc.art === 'eigenbeleg') {
    const eb = hat('eigenbeleg_felder');
    const bh = 'Baustein „Eigenbeleg-Angaben“ fehlt';
    const g = doc.eigenbeleg;
    wert('Datum der Zahlung', eb, bh, !!doc.datum, 'Datum fehlt', datumText(doc.datum));
    wert('Betrag', eb, bh, gesamt > 0, 'Betrag fehlt', `${formatBetrag(gesamt)} · mit Betrag in Worten`);
    wert('Zahlungsempfänger', eb, bh, !!e.name, 'Name des Empfängers fehlt', [e.name, ...e.zeilen].join(', ') + (e.zeilen.length ? '' : ' · Anschrift, soweit bekannt'));
    wert('Gegenstand / Zweck', eb, bh, !!doc.betreff.trim(), 'Wofür wurde gezahlt?', doc.betreff.trim());
    wert('Grund für den Eigenbeleg', eb, bh, !!g && (g.grund !== 'sonstiges' || !!g.grund_text.trim()), 'Grund beschreiben', eigenbelegGrundText(doc));
    add('Unterschrift', hat('unterschrift'), 'Baustein „Unterschrift“ fehlt', true, '', 'nach dem Drucken unterschreiben', true);
    return out;
  }

  const quittung = doc.art === 'quittung';
  // Quittungsangaben zählen nur mit den Angaben, die sie wirklich drucken (jede ist einzeln abschaltbar); der Stil
  // „Formular“ druckt auch die Nummer („Nr.: …“). Firmenkopf (Text) zählt über seine Platzhalter (druckt)
  const qa = quittung ? L.filter((b) => b.typ === 'quittung_felder').map(quittungAngaben) : [];
  const qf = (angabe: Exclude<keyof QuittungAngaben, 'formular' | 'leer'>) => qa.some((a) => a[angabe]);
  /** Hinweis, wenn eine Angabe der Quittung fehlt: Baustein fehlt ganz oder die Angabe ist abgeschaltet */
  const qHinweis = (label: string, sonst: string) =>
    !quittung ? sonst : qa.length ? `Quittungsangaben: „${label}“ ist abgeschaltet` : 'Baustein „Quittungsangaben“ fehlt';
  const fussAdresse = hat('fusszeile', (b) => b.an('adresse'));

  add('Name und Anschrift (Aussteller)', fussAdresse || (druckt('strasse') && druckt('ort')), 'Firmenkopf, Absenderzeile oder Fußzeile mit Adresse fehlt',
    !!(F.name.trim() && F.strasse.trim() && F.plz.trim() && F.ort.trim()), 'in den Firmendaten ergänzen', `${F.name}, ${F.plz} ${F.ort}`);
  // vollständiger Name des Unternehmers = Inhaber (der Firmenname allein reicht nicht); die Fußzeile „Adresse“ druckt ihn mit
  add('Vollständiger Name (Inhaber)', fussAdresse || druckt('inhaber'), '{inhaber} wird nirgends gedruckt – z. B. im Firmenkopf oder in der Absenderzeile ergänzen',
    !!F.inhaber.trim(), 'in den Firmendaten ergänzen', F.inhaber);

  const kundeGedruckt = hat('anschrift_meta') || qf('kunde') || druckt('kunde');
  if (quittung && blanko) {
    // Betrag steht noch nicht fest: Kunde mit Anschrift ist über der Grenze Pflicht, darunter nicht
    const grenze = formatBetrag(kleinbetrag);
    out.push(
      kundeGedruckt
        ? { label: 'Name und Anschrift (Kunde)', ok: true, offen: true, hint: `von Hand eintragen – Anschrift Pflicht über ${grenze}` }
        : { label: 'Name und Anschrift (Kunde)', ok: true, hint: `nicht vorgesehen – reicht nur bis ${grenze}` },
    );
  } else if (quittung && gesamt <= kleinbetrag) {
    const grenze = formatBetrag(kleinbetrag);
    out.push({ label: 'Name und Anschrift (Kunde)', ok: true, hint: e.name ? `${e.name} · optional bis ${grenze}` : `nicht nötig – Kleinbetragsrechnung bis ${grenze}` });
  } else {
    wert('Name und Anschrift (Kunde)', kundeGedruckt, qHinweis('Erhalten von', 'Baustein „Anschrift & Belegdaten“ fehlt'),
      !!(e.name && e.zeilen.length), !e.name ? 'Kunde fehlt' : quittung ? `Anschrift fehlt (Pflicht über ${formatBetrag(kleinbetrag)})` : 'Anschrift fehlt',
      [e.name, e.zeilen[e.zeilen.length - 1]].filter(Boolean).join(', '));
  }

  const steuerGedruckt = hat('fusszeile', (b) => b.an('kontakt')) || hat('anschrift_meta', (b) => b.an('steuernr')) || druckt('steuernummer');
  if (quittung && !blanko && gesamt <= kleinbetrag) {
    // § 33 UStDV: die Kleinbetragsrechnung braucht keine Steuernummer – erst darüber. Blanko bleibt streng: der Betrag
    // wird von Hand eingetragen und kann über der Grenze liegen.
    const grenze = formatBetrag(kleinbetrag);
    const nr = F.steuernummer.trim();
    out.push({
      label: 'Steuernummer',
      ok: true,
      hint: steuerGedruckt && nr ? `${nr} · Pflicht erst über ${grenze}` : `nicht nötig – Kleinbetragsrechnung bis ${grenze}`,
    });
  } else {
    add('Steuernummer', steuerGedruckt, 'Fußzeile, Firmenkopf oder {steuernummer} fehlt', !!F.steuernummer.trim(), 'in den Firmendaten ergänzen', F.steuernummer);
  }
  wert('Ausstellungsdatum', hat('anschrift_meta', (b) => b.an('datum')) || qf('datum') || druckt('datum'), qHinweis('Datum', 'Datum wird nirgends gedruckt'),
    !!doc.datum, 'Datum fehlt', datumText(doc.datum));
  const n = doc.positionen.length;
  wert('Menge und Art der Leistung', hat('positionen') || qf('zweck'), qHinweis('Für', 'Baustein „Positionen“ fehlt'),
    quittung ? !!doc.betreff.trim() || posOk : posOk, quittung ? 'Wofür? (Leistung / Gegenstand)' : 'Beschreibung oder Menge fehlt',
    quittung && n <= 1 ? doc.betreff.trim() || doc.positionen[0]?.beschreibung.trim() || '' : `${n} ${n === 1 ? 'Position' : 'Positionen'}`);

  const summeGedruckt = hat('summe') || qf('betrag') || druckt('summe');
  const summeHinweis = quittung && qa.length && !hat('summe') ? 'Quittungsangaben: „Betrag“ ist abgeschaltet' : 'Gesamtbetrag wird nicht gedruckt';
  if (doc.ust_modus === 'klein') {
    const h19 = L.some((b) => b.texte().some((t) => /§\s*19/.test(t)));
    wert('Entgelt und § 19-Hinweis', summeGedruckt && h19, h19 ? summeHinweis : 'Baustein „Steuerhinweis (§ 19)“ fehlt',
      gesamt > 0, 'Betrag fehlt', `${formatBetrag(gesamt)} · ${HINWEIS_19.replace(/\.$/, '')}`, `Betrag ${HAND} · § 19-Hinweis gedruckt`);
  } else {
    // § 14 Abs. 4 UStG: Nettobetrag, Steuersatz und Steuerbetrag – Belege mit Umsatzsteuer kann die App noch nicht
    wert('Entgelt', summeGedruckt, summeHinweis, gesamt > 0, 'Betrag fehlt', formatBetrag(gesamt));
    out.push({ label: 'Steuersatz und Steuerbetrag', ok: false, hint: 'Regelbesteuerung: Belege mit Umsatzsteuer kann Kladdy noch nicht ausstellen' });
  }

  const nrGedruckt = hat('anschrift_meta', (b) => b.an('nr')) || qf('nr') || druckt('nr');
  if (!nrGedruckt) out.push({ label: 'Fortlaufende Nummer', ok: false, hint: 'Nummer wird nirgends gedruckt' });
  else if (blanko) out.push({ label: 'Fortlaufende Nummer', ok: true, hint: 'von Hand fortlaufend eintragen', offen: true });
  else if (doc.nummer) out.push({ label: 'Fortlaufende Nummer', ok: true, hint: doc.nummer });
  else {
    const naechste = optionen.naechste_nummer ? ` (${optionen.naechste_nummer})` : '';
    out.push({ label: 'Fortlaufende Nummer', ok: true, hint: `wird beim Finalisieren vergeben${naechste}`, offen: true });
  }

  if (quittung) out.push({ label: 'Leistungsdatum', ok: true, hint: '= Ausstellungsdatum' });
  else {
    wert('Leistungsdatum / -zeitraum', hat('anschrift_meta', (b) => b.an('leistung')) || druckt('leistungsdatum'), 'Leistungsdatum wird nirgends gedruckt',
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
