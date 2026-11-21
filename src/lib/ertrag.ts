/* Beleg zum Ertrag (§6.4 Punkt 6, Prototyp buchungen.js makeState/docPanelHTML/syncDoc/offenHTML): beim Erfassen einer
 * Einnahme gleich den eigenen Beleg ausstellen (Quittung oder Rechnung – bezahlt oder noch offen), eine offene Rechnung
 * zuordnen oder ohne eigenen Beleg speichern. Reine Logik ohne Datenbank. Geschrieben wird über die Rust-Commands der
 * Rechnungen (beleg_ausstellen bzw. beleg_bezahlt) – je eine Transaktion für Beleg, Einnahme, Kunde und Protokoll.
 * Der Beleg entsteht aus demselben Formular wie in der Beleg-Maske (neuesFormular ⇒ formularZuDaten/-Dokument),
 * damit Vorschau, Pflichtangaben und Schnappschuss überall gleich sind. Mit „Beleg erstellen“ stehen die Beschreibungen
 * nur in den Positionen (Summe = Betrag der Einnahme, Buchungstext wie Rust aus den Positionen); bei Rechnung getrennt
 * Rechnungs-, Leistungsdatum (auch Zeitraum) und Zahlungsziel. Tests: ertrag.test.ts */
import { kundeAufloesen, type Formular, type Zahlungsart } from './buchungen';
import { parseBetrag } from './money';
import type { Firma } from './firma';
import { naechsteNummer, type Nummernkreis } from './numbering';
import type { UstModus } from './queries/einstellungen';
import type { VorlagenWahl } from './queries/vorlagen';
import {
  artWechseln,
  buchungstextAus,
  faelligAus,
  faelligText,
  formularZuDaten,
  formularZuDokument,
  leerePosition,
  neuesFormular,
  parseMenge,
  positionenAus,
  preisEingabe,
  type BelegDaten,
  type BelegFormular,
  type BelegZeile,
  type KundeAnschrift,
  type PositionFormular,
} from './rechnungen';
import type { KennwerteJahr } from './steuer-kennwerte';
import { istBausteinTyp, sichtbare, type Baustein } from './vorlagen/bausteine';
import { bausteineFuer, belegSumme, type BelegDokument, type Belegart } from './vorlagen/dokument';
import { KLEINBETRAG_STANDARD_CENT, pflichtCheck } from './vorlagen/pflicht';
import { wahlFinden } from './vorlagen/eigene';
import { STANDARD_DESIGN, standardVorlage } from './vorlagen/standard';
import { istDatum } from './zeitraum';

/** Die drei Wege (Beschriftung wie im Prototyp). */
export type Ertragsweg = 'beleg' | 'offen' | 'ohne';
export type ErtragsArt = 'quittung' | 'rechnung';

export interface Ertrag {
  weg: Ertragsweg;
  /** Art des eigenen Belegs (Vorauswahl aus Einstellungen › Belege) */
  art: ErtragsArt;
  /** nur Rechnung: „bereits bezahlt“ (Einnahme gleich mit) oder „noch offen“ (Einnahme erst beim Zahlungseingang) */
  bezahlt: boolean;
  /** selbst gewählte Vorlage: eigene Vorlage (id) bzw. Design (id null, lib/vorlagen/standard.ts; ohne `design`:
   *  'klassisch'), lib/vorlagen/eigene.ts → wahlFinden; null = die aktive der Art */
  vorlage: { id: number | null; design?: string } | null;
  /** Anschrift eines neuen Kunden bzw. eines Kunden ohne Anschrift in der Kartei, Zeilen mit \n */
  adresse: string;
  /** Positionen des Belegs wie in der Beleg-Maske (Beschreibung, Menge, Einheit, Einzelpreis). Ersetzen bei „Beleg
   *  erstellen“ die Beschreibung der Buchung; ihre Summe ist der Betrag der Einnahme. */
  positionen: PositionFormular[];
  /** Leistungsdatum; '' = wie das Datum oben (Rechnungs- bzw. Zahlungsdatum) */
  leistungVon: string;
  /** Ende eines Leistungszeitraums; '' = einzelner Tag */
  leistungBis: string;
  /** nur Rechnung: Zahlungsziel in Tagen wie eingegeben; '' = Einstellungen › Belege */
  zielTage: string;
  /** „Offene Rechnung zuordnen“: die gewählte Rechnung */
  offenId: number | null;
  /** „Nur buchen“: eine Papierquittung liegt im Ordner (ohne eingetragene Nummer wird die Buchung als „Papier“ belegt);
   *  null = noch nicht gewählt ⇒ folgt dem Zahlungsweg (bar ⇒ ja), siehe papierGewaehlt */
  papier: boolean | null;
}

/** Papierquittung bei „Nur buchen“: gewählt oder – solange nicht gewählt – bei Barzahlung ja (dann gibt es meist einen Zettel). */
export const papierGewaehlt = (e: Pick<Ertrag, 'papier'>, zahlungsart: Zahlungsart): boolean => e.papier ?? zahlungsart === 'bar';

/** Belegnummer, die eine Buchung mit Papierquittung ohne eigene Nummer bekommt (gilt dann nicht als „ohne Beleg“). */
export const PAPIER_BELEG = 'Papier';

/** Einheit neuer Positionen aus der Schublade */
const EINHEIT = 'Stk.';

/** Eine Position (Menge 1) mit Text und Preis, z. B. aus der Vorbelegung (Beschreibung und Betrag). */
export const ertragPosition = (text = '', cent = 0): PositionFormular => ({ ...leerePosition(EINHEIT, text.trim()), preis: cent > 0 ? preisEingabe(cent) : '' });

/** Start: vom Aufrufer vorgewählter Beleg ⇒ „Beleg erstellen“; mit mitgebrachter Datei (Drop) ⇒ „Nur buchen“; sonst
 *  die Einstellung „Neue Einnahme“ (`standardWeg`). Die erste Position bekommt Text und Betrag der Vorbelegung.
 *  Zu einem Termin ist eine Rechnung standardmäßig „noch offen“ (nach dem Termin zahlt der Kunde meist später). */
export function ertragStart(
  v: { beleg?: ErtragsArt; belege?: readonly unknown[]; termin?: number; entwurf?: number; text?: string; betrag?: number },
  belegArt: ErtragsArt,
  standardWeg: 'beleg' | 'ohne' = 'beleg',
): Ertrag {
  return {
    weg: v.beleg ? 'beleg' : v.belege?.length ? 'ohne' : v.termin != null || v.entwurf != null ? 'beleg' : standardWeg,
    art: v.beleg ?? belegArt,
    bezahlt: v.termin == null && v.entwurf == null,
    vorlage: null,
    adresse: '',
    positionen: [ertragPosition(v.text, v.betrag)],
    leistungVon: '',
    leistungBis: '',
    zielTage: '',
    offenId: null,
    papier: null,
  };
}

/** Beleg-Kasten beim Öffnen: Start (ertragStart), dazu Positionen, Anschrift, Vorlage und Leistungsdatum eines
 *  vorbereiteten Entwurfs (termine.ts → ertragAusEntwurf), der Tag des Termins als Leistungsdatum (sofern der Entwurf
 *  keins hat) und das Zahlungsziel aus Einstellungen › Belege. */
export function ertragOeffnen(start: Ertrag, o: { entwurf?: Partial<Ertrag> | null; terminDatum?: string | null; zielTage?: number | null }): Ertrag {
  const e: Ertrag = { ...start, ...(o.entwurf ?? {}) };
  if (!e.positionen.length) e.positionen = start.positionen;
  if (o.terminDatum && !e.leistungVon) e.leistungVon = o.terminDatum;
  if (o.zielTage != null && !e.zielTage.trim()) e.zielTage = String(o.zielTage);
  return e;
}

/** Für „ungespeichert“: nur was man eintippt bzw. wählt (Weg und Art allein sind keine Eingabe). */
export const ertragSchluessel = (e: Ertrag): string =>
  JSON.stringify([
    e.adresse.trim(),
    e.positionen.map((p) => [p.beschreibung.trim(), p.menge.trim(), p.einheit.trim(), p.preis.trim()]),
    e.leistungVon,
    e.leistungBis,
    e.zielTage.trim(),
    e.offenId,
  ]);

/* ---------- Positionen ⇄ Betrag ---------- */

/** Summe der Positionen in Cent (unlesbare Zahlen zählen 0, wie in der Maske). */
export function ertragSumme(e: Pick<Ertrag, 'positionen'>): number {
  try {
    return belegSumme({ positionen: positionenAus(e) });
  } catch {
    return 0;
  }
}

/** Großer Betrag oben direkt eingebbar? Nur bei genau einer Position mit Menge 1 – er ist dann deren Preis. Sonst zeigt
 *  er nur die Summe der Positionen. */
export const betragEingebbar = (e: Pick<Ertrag, 'positionen'>): boolean => e.positionen.length === 1 && parseMenge(e.positionen[0].menge) === 1;

/** Eingabe im großen Betragsfeld ⇒ Preis der einzigen Position (nur wenn eingebbar). */
export function betragInPosition(e: Pick<Ertrag, 'positionen'>, eingabe: string): PositionFormular[] {
  if (!betragEingebbar(e)) return e.positionen;
  return [{ ...e.positionen[0], preis: eingabe }];
}

/** Beim Wechsel auf „Beleg erstellen“: Betrag und Beschreibung der Buchung wandern in die einzige Position (Text nur,
 *  solange dort noch keiner steht). Mehrere Positionen bleiben, wie sie sind. */
export function positionenAusBuchung(e: Pick<Ertrag, 'positionen'>, f: Pick<Formular, 'betrag' | 'beschreibung'>): PositionFormular[] {
  if (e.positionen.length !== 1) return e.positionen;
  const p = e.positionen[0];
  const cent = parseBetrag(f.betrag);
  const preis = betragEingebbar(e) && cent !== null && cent > 0 ? preisEingabe(cent) : p.preis;
  return [{ ...p, preis, beschreibung: p.beschreibung.trim() ? p.beschreibung : f.beschreibung.trim() }];
}

/** Text der Einnahme, wenn der Beleg sie bucht (wie Rust: Betreff, sonst die Positionen, „… und 2 weitere“). */
export const ertragBuchungstext = (e: Pick<Ertrag, 'positionen' | 'art'>, betreff = ''): string => buchungstextAus(betreff, positionenAus(e), e.art);

/* ---------- Daten der Rechnung ---------- */

/** Zahlungsziel in Tagen: eingegeben oder aus Einstellungen › Belege. */
export const ertragZielTage = (e: Pick<Ertrag, 'zielTage'>, standard: number): string => e.zielTage.trim() || String(standard);

/** Fälligkeit einer Rechnung mit dem Rechnungsdatum `datum`. */
export const ertragFaellig = (e: Pick<Ertrag, 'zielTage'>, datum: string, standard: number): string | null =>
  faelligAus({ art: 'rechnung', datum, zielTage: ertragZielTage(e, standard) });

/** Eine Rechnung, die erst beim Zahlungseingang zur Einnahme wird. */
export const rechnungOffen = (e: Pick<Ertrag, 'weg' | 'art' | 'bezahlt'>): boolean => e.weg === 'beleg' && e.art === 'rechnung' && !e.bezahlt;

/** Nummer, die der Beleg beim Ausstellen bzw. die Buchung beim Speichern bekommt (Jahr des Datums, nie rückwärts – wie
 *  Rust). Nur eine Vorschau: vergeben wird erst in Rust. */
export function naechsteBelegNummer(kreise: readonly Nummernkreis[], art: Belegart | 'buchung', datum: string, heute: string): string | null {
  const kreis = kreise.find((k) => k.id === art);
  if (!kreis) return null;
  const jahr = Number((istDatum(datum) ? datum : heute).slice(0, 4));
  try {
    return naechsteNummer(kreis, Math.max(jahr, kreis.jahr)).nummer;
  } catch {
    return null;
  }
}

export const ERTRAG_ART_TIPP =
  'Quittung: bestätigt, dass bezahlt wurde – deine Quittung enthält zugleich alle Rechnungsangaben. Rechnung: fordert zur Zahlung auf, der Kunde zahlt später (oder überweist gleich).';

/** Hinweis zu § 35a EStG (haushaltsnahe Dienstleistung: absetzbar nur mit Rechnung und unbarer Zahlung). */
export function hinweis35a(e: Ertrag, zahlungsart: Zahlungsart): string | null {
  if (e.weg !== 'beleg' || rechnungOffen(e) || zahlungsart !== 'bar') return null;
  return e.art === 'rechnung'
    ? 'Für § 35a muss der Kunde unbar zahlen (Überweisung oder Karte).'
    : 'Will der Kunde die Arbeitskosten von der Steuer absetzen (§ 35a EStG)? Dann Rechnung wählen – absetzbar nur bei unbarer Zahlung (Überweisung oder Karte).';
}

/** Was beim Speichern passiert (unter dem Beleg-Kasten). */
export const belegHinweis = (e: Ertrag): string =>
  rechnungOffen(e)
    ? 'Die Rechnung wird ausgestellt und erscheint unter „Belege“ als offen. Die Einnahme entsteht erst, wenn das Geld eingeht.'
    : 'Wird beim Speichern mit dieser Nummer ausgestellt und mit der Einnahme verknüpft – Betrag und Datum wie oben.';

/** Offene Rechnungen zum Zuordnen: ausgestellt und offen, die am längsten fälligen zuerst. */
export function offeneRechnungen(zeilen: readonly BelegZeile[]): BelegZeile[] {
  const schluessel = (z: BelegZeile) => z.faellig_am ?? z.datum ?? '';
  return zeilen
    .filter((z) => z.art === 'rechnung' && z.status === 'offen' && z.nummer)
    .sort((a, b) => schluessel(a).localeCompare(schluessel(b)) || a.id - b.id);
}

/** Zweite Zeile einer offenen Rechnung: „7 Tage überfällig“, „heute fällig“, „in 3 Tagen“. */
export const offenFaellig = (z: BelegZeile, heute: string): { text: string; ueberfaellig: boolean } => {
  const f = faelligText(z, heute);
  return { text: f.text, ueberfaellig: f.klasse === 'neg' };
};

export interface ErtragFehler {
  feld: 'wer' | 'offen' | 'dateien' | 'positionen';
  text: string;
}

const OHNE_TEXT = 'Was wurde gemacht? Bitte die Leistung beschreiben – sie steht auf dem Beleg.';

/** Positionen prüfen: Zahlen lesbar, Menge über 0, jede Position mit Preis beschreibt die Leistung. */
export function positionenPruefen(positionen: readonly PositionFormular[]): string | null {
  for (const [i, p] of positionen.entries()) {
    const nr = positionen.length > 1 ? `Position ${i + 1}: ` : '';
    if (p.menge.trim() && parseMenge(p.menge) === null) return `${nr}Menge nicht lesbar – z. B. 1, 2,5 oder 0,25`;
    if (p.preis.trim() && parseBetrag(p.preis) === null) return `${nr}Preis nicht lesbar – z. B. 45 oder 45,50`;
    const zaehlt = p.beschreibung.trim() || p.preis.trim();
    if (zaehlt && (parseMenge(p.menge) ?? 0) <= 0) return `${nr}Die Menge muss größer als 0 sein.`;
    if (!p.beschreibung.trim() && (parseBetrag(p.preis) ?? 0) !== 0) return `${nr}${OHNE_TEXT}`;
  }
  if (!positionen.some((p) => p.beschreibung.trim())) return OHNE_TEXT;
  return null;
}

/** Prüfungen, die nur der Beleg braucht (Betrag, Datum, Beschreibung und Kunde prüft pruefeFormular). */
export function ertragPruefen(f: Pick<Formular, 'wer'>, e: Ertrag, dateien: number): ErtragFehler | null {
  if (e.weg === 'offen' && e.offenId == null) return { feld: 'offen', text: 'Bitte eine offene Rechnung auswählen.' };
  if (e.weg !== 'beleg') return null;
  const pos = positionenPruefen(e.positionen);
  if (pos) return { feld: 'positionen', text: pos };
  if (e.art === 'rechnung' && !f.wer.trim()) return { feld: 'wer', text: 'Für eine Rechnung bitte den Kunden angeben.' };
  if (dateien > 1) return { feld: 'dateien', text: 'Als unterschriebenes Exemplar passt genau eine Datei – bitte die übrigen entfernen.' };
  return null;
}

/* ---------- Beleg aus den Eingaben der Schublade ---------- */

export interface ErtragKontext {
  kunden: readonly KundeAnschrift[];
  firma: Firma;
  ustModus: UstModus;
  /** aktuelles Firmenlogo (Dateiname oder '') */
  logo?: string;
  kreise: readonly Nummernkreis[];
  kennwerte: ReadonlyMap<number, KennwerteJahr>;
  vorlagen: Readonly<Record<ErtragsArt, readonly VorlagenWahl[]>>;
  /** Zahlungsziel neuer Rechnungen in Tagen (Einstellungen › Belege) */
  zahlungszielTage: number;
  heute: string;
}

/** Bekannter Kunde mit Anschrift in der Kartei? Dann druckt der Beleg diese, sonst die eingegebene. */
export function karteiAnschrift(f: Pick<Formular, 'wer' | 'kundeBewusstNeu'>, kunden: readonly KundeAnschrift[]): KundeAnschrift | null {
  const k = kundeAufloesen(f.wer, kunden, f.kundeBewusstNeu);
  if (k.art !== 'kunde') return null;
  const x = kunden.find((y) => y.id === k.kunde.id);
  return x && (x.strasse || x.ort) ? x : null;
}

/** Gewählte Vorlage der Art (eigene über die ID, sonst das Design); sonst die aktive, sonst der Standard. */
export function vorlageFuer(e: Pick<Ertrag, 'art' | 'vorlage'>, vorlagen: ErtragKontext['vorlagen']): VorlagenWahl {
  const liste = vorlagen[e.art];
  return (
    wahlFinden(liste, e.vorlage) ??
    liste.find((v) => v.aktiv) ??
    liste[0] ?? {
      schluessel: STANDARD_DESIGN,
      id: null,
      design: STANDARD_DESIGN,
      name: e.art === 'rechnung' ? 'Standard-Rechnung' : 'Standard-Quittung',
      bausteine: standardVorlage(e.art),
      aktiv: true,
    }
  );
}

/** Termin bzw. vorbereiteter Beleg, zu dem die Einnahme gehört (Termine › „Quittung ausstellen“, Maske eines
 *  vorbereiteten Belegs, §6.5). */
export interface ErtragBezug {
  /** Termin: ID und Tag (wird das Leistungsdatum) */
  termin: { id: number; datum: string } | null;
  /** vorbereiteter Beleg ohne Nummer als Formular der Maske (formularAusEntwurf) */
  entwurf: BelegFormular | null;
}

/** Betreff eines vorbereiteten Entwurfs, der nicht nur den Text seiner ersten Position wiederholt (Termine legen beides
 *  mit der Leistung an). Sonst '' – dann sprechen die Positionen (Quittung „Für“, Buchungstext). */
function eigenerBetreff(w: BelegFormular): string {
  const b = w.betreff.trim();
  return b && b !== (w.positionen[0]?.beschreibung.trim() ?? '') ? w.betreff : '';
}

/** Erfassen-Formular + Beleg-Angaben ⇒ Formular der Beleg-Maske. Positionen, Leistungsdatum und Zahlungsziel kommen aus
 *  dem Beleg-Kasten (`e`), Kunde, Datum und Zahlung aus der Schublade; die Beschreibung der Buchung bleibt außen vor.
 *  Mit vorbereitetem Entwurf (Prototyp buchungen.js speichern) bleiben dessen Texte (Einleitung, Schlusstext, eigener
 *  Betreff); seine Positionen hat die Schublade beim Öffnen übernommen (ertragAusEntwurf). */
export function belegFormular(
  f: Formular,
  e: Ertrag,
  ctx: Pick<ErtragKontext, 'kunden' | 'vorlagen' | 'zahlungszielTage' | 'heute'>,
  bezug: ErtragBezug | null = null,
): BelegFormular {
  const k = kundeAufloesen(f.wer, ctx.kunden, f.kundeBewusstNeu);
  const kunde = k.art === 'kunde' ? (ctx.kunden.find((x) => x.id === k.kunde.id) ?? null) : null;
  const basis = neuesFormular(
    {
      art: e.art,
      datum: f.zahlungsdatum,
      kunde,
      name: k.art === 'neu' || k.art === 'wahl' ? k.name : undefined,
      zahlungsart: f.zahlungsart,
      bezahlt: e.art === 'rechnung' && e.bezahlt,
      kategorieId: f.kategorieId,
      terminId: bezug?.termin?.id ?? null,
    },
    { heute: ctx.heute, zielTage: { rechnung: ctx.zahlungszielTage } },
  );
  const positionen = e.positionen.map((p) => ({ ...p, kategorieId: f.kategorieId }));
  // Leistungsdatum: eingegeben (zum Termin beim Öffnen dessen Tag, ertragOeffnen), sonst das Datum oben
  const leistungVon = e.leistungVon || f.zahlungsdatum;
  const vorlage = vorlageFuer(e, ctx.vorlagen);
  const form: BelegFormular = {
    ...basis,
    // wie in der Schublade gebunden („Name · K-0012“ bzw. bewusst neuer Kunde mit gleichem Namen)
    kunde: f.wer.trim(),
    kundeBewusstNeu: f.kundeBewusstNeu,
    adresse: e.adresse.trim() ? e.adresse : basis.adresse,
    leistungVon,
    leistungBis: e.leistungBis && e.leistungBis > leistungVon ? e.leistungBis : '',
    zielTage: ertragZielTage(e, ctx.zahlungszielTage),
    // Beschreibungen stehen nur in den Positionen
    betreff: '',
    positionen,
    mehrere: e.art === 'quittung' && positionen.length > 1,
    vorlageId: vorlage.id,
    vorlageDesign: vorlage.design,
  };
  const entwurf = bezug?.entwurf;
  if (!entwurf) return form;
  const w = entwurf.art === e.art ? entwurf : artWechseln(entwurf, e.art, { rechnung: ctx.zahlungszielTage });
  return {
    ...w,
    kunde: form.kunde,
    kundeBewusstNeu: form.kundeBewusstNeu,
    adresse: form.adresse,
    datum: form.datum,
    leistungVon: form.leistungVon,
    leistungBis: form.leistungBis,
    zielTage: form.zielTage,
    betreff: eigenerBetreff(entwurf),
    zahlungsart: form.zahlungsart,
    bezahltAm: form.bezahltAm,
    positionen,
    mehrere: form.mehrere,
    vorlageId: form.vorlageId,
    vorlageDesign: form.vorlageDesign,
    terminId: w.terminId ?? form.terminId,
    buchungId: null,
  };
}

/** Hinweis im Beleg-Kasten (Bankverbindung auf der Rechnung). */
export interface ErtragHinweis {
  art: 'warn' | 'info';
  text: string;
}

/** Bankverbindung auf der Rechnung: bei „noch offen“ fehlende IBAN bzw. fehlender/abgeschalteter Baustein „Zahlung“ der
 *  Vorlage; bei „bereits bezahlt“ druckt der Baustein statt der Bankverbindung den Quittiert-Satz. */
export function bankHinweise(e: Pick<Ertrag, 'weg' | 'art' | 'bezahlt'>, firma: Pick<Firma, 'iban'>, gedruckt: readonly Baustein[], vorlageName: string): ErtragHinweis[] {
  if (e.weg !== 'beleg' || e.art !== 'rechnung') return [];
  if (e.bezahlt) return [{ art: 'info', text: 'Bereits bezahlt: Statt der Bankverbindung steht auf der Rechnung „Den Betrag von … habe ich am … dankend erhalten.“' }];
  const liste: ErtragHinweis[] = [];
  const zahlung = sichtbare(gedruckt).find(({ b }) => b.typ === 'zahlung')?.b;
  if (!zahlung)
    liste.push({ art: 'warn', text: `Die Vorlage „${vorlageName}“ hat keinen Baustein „Zahlung & GiroCode“ – Zahlungshinweis und Bankverbindung fehlen auf der Rechnung.` });
  else if (!zahlung.an('bank')) liste.push({ art: 'warn', text: `In der Vorlage „${vorlageName}“ ist die Bankverbindung im Baustein „Zahlung & GiroCode“ ausgeschaltet.` });
  if (!firma.iban.trim()) liste.push({ art: 'warn', text: 'In den Firmendaten fehlt die IBAN – der Kunde weiß nicht, wohin er überweisen soll (Einstellungen › Firma).' });
  return liste;
}

export interface BelegVorbereitet {
  formular: BelegFormular;
  /** an beleg_ausstellen (null, wenn sich das Formular nicht speichern lässt – dann steht der Grund in `fehlt`) */
  daten: BelegDaten | null;
  dokument: BelegDokument;
  /** Bausteine wie gedruckt (werden beim Ausstellen eingefroren) */
  gedruckt: Baustein[];
  naechste: string | null;
  /** fehlende Pflichtangaben (§2.3) bzw. Eingabefehler – leer = ausstellbar */
  fehlt: string[];
  /** Hinweise zur Bankverbindung (nur Rechnung) */
  bank: ErtragHinweis[];
  /** Text, mit dem die Einnahme gebucht wird (wie Rust) */
  buchungstext: string;
}

/** Alles für beleg_ausstellen – samt Pflichtangaben-Check wie in der Maske (mit `bezug`: zum Termin bzw. den Entwurf). */
export function belegVorbereiten(f: Formular, e: Ertrag, ctx: ErtragKontext, bezug: ErtragBezug | null = null): BelegVorbereitet {
  const formular = belegFormular(f, e, ctx, bezug);
  const dokument = formularZuDokument(formular, { kunden: ctx.kunden, firma: ctx.firma, ustModus: ctx.ustModus, logo: ctx.logo });
  const vorlage = vorlageFuer(e, ctx.vorlagen);
  const gedruckt = bausteineFuer(dokument, vorlage.bausteine).filter((b) => istBausteinTyp(b.typ));
  const naechste = naechsteBelegNummer(ctx.kreise, e.art, f.zahlungsdatum, ctx.heute);
  const jahr = Number((istDatum(f.zahlungsdatum) ? f.zahlungsdatum : ctx.heute).slice(0, 4));
  const kennwerte = ctx.kennwerte.get(jahr) ?? [...ctx.kennwerte.values()].pop() ?? {};
  const pflicht = pflichtCheck(dokument, gedruckt, { kleinbetrag_cent: kennwerte.kleinbetragsrechnung_cent ?? KLEINBETRAG_STANDARD_CENT, naechste_nummer: naechste });
  const fehlt = pflicht.filter((p) => !p.ok).map((p) => p.label);
  const d = formularZuDaten(formular, ctx.kunden);
  if (!d.ok) fehlt.push(...Object.values(d.fehler));
  return {
    formular,
    daten: d.ok ? d.daten : null,
    dokument,
    gedruckt,
    naechste,
    fehlt: [...new Set(fehlt)],
    bank: bankHinweise(e, ctx.firma, gedruckt, vorlage.name),
    buchungstext: buchungstextAus(formular.betreff, dokument.positionen, e.art),
  };
}

/** Adresse der Beleg-Maske mit den Eingaben der Schublade (Pflichtangaben dort ergänzen bzw. Eigenbeleg erstellen). */
export function maskenPfad(
  art: Belegart,
  o: { betrag?: number | null; datum?: string; text?: string; kundeId?: number | null; name?: string; zahlungsart?: Zahlungsart; bezahlt?: boolean; kategorieId?: number | null },
): string {
  const p = new URLSearchParams({ art });
  if (o.betrag && o.betrag > 0) p.set('betrag', String(o.betrag));
  if (o.datum && istDatum(o.datum)) p.set('datum', o.datum);
  if (o.text?.trim()) p.set('text', o.text.trim());
  if (o.kundeId != null) p.set('kunde', String(o.kundeId));
  else if (o.name?.trim()) p.set('name', o.name.trim());
  if (o.zahlungsart) p.set('zahlungsart', o.zahlungsart);
  if (o.bezahlt) p.set('bezahlt', '1');
  if (o.kategorieId != null) p.set('kategorie', String(o.kategorieId));
  return `/belege/neu?${p.toString()}`;
}
