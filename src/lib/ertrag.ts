/* Beleg zum Ertrag (§6.4 Punkt 6, Prototyp buchungen.js makeState/docPanelHTML/syncDoc/offenHTML): beim Erfassen einer
 * Einnahme gleich den eigenen Beleg ausstellen (Quittung oder Rechnung – bezahlt oder noch offen), eine offene Rechnung
 * zuordnen oder ohne eigenen Beleg speichern. Reine Logik ohne Datenbank. Geschrieben wird über die Rust-Commands der
 * Rechnungen (beleg_ausstellen bzw. beleg_bezahlt) – je eine Transaktion für Beleg, Einnahme, Kunde und Protokoll.
 * Der Beleg entsteht aus demselben Formular wie in der Beleg-Maske (neuesFormular ⇒ formularZuDaten/-Dokument),
 * damit Vorschau, Pflichtangaben und Schnappschuss überall gleich sind. Tests: ertrag.test.ts */
import { kundeAufloesen, type Formular, type Zahlungsart } from './buchungen';
import type { Firma } from './firma';
import { naechsteNummer, type Nummernkreis } from './numbering';
import type { UstModus } from './queries/einstellungen';
import type { VorlagenWahl } from './queries/vorlagen';
import {
  artWechseln,
  faelligText,
  formularSumme,
  formularZuDaten,
  formularZuDokument,
  neuesFormular,
  type BelegDaten,
  type BelegFormular,
  type BelegZeile,
  type KundeAnschrift,
} from './rechnungen';
import type { KennwerteJahr } from './steuer-kennwerte';
import { istBausteinTyp, type Baustein } from './vorlagen/bausteine';
import { bausteineFuer, type BelegDokument, type Belegart } from './vorlagen/dokument';
import { KLEINBETRAG_STANDARD_CENT, pflichtCheck } from './vorlagen/pflicht';
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
  /** selbst gewählte Vorlage: Design (lib/vorlagen/standard.ts) und eigene Kopie (id null = Design aus dem Code);
   *  ohne `design` zählt die id (fehlt sie: 'klassisch'); null = die aktive der Art */
  vorlage: { id: number | null; design?: string } | null;
  /** Anschrift eines neuen Kunden bzw. eines Kunden ohne Anschrift in der Kartei, Zeilen mit \n */
  adresse: string;
  /** Text der Position auf dem Beleg; leer = die Beschreibung */
  leistung: string;
  /** „Offene Rechnung zuordnen“: die gewählte Rechnung */
  offenId: number | null;
}

/** Start: vom Aufrufer vorgewählter Beleg ⇒ „Beleg erstellen“; mit mitgebrachter Datei (Drop) ⇒ „Ohne eigenen Beleg“.
 *  Zu einem Termin ist eine Rechnung standardmäßig „noch offen“ (nach dem Termin zahlt der Kunde meist später). */
export function ertragStart(
  v: { beleg?: ErtragsArt; belege?: readonly unknown[]; termin?: number; entwurf?: number },
  belegArt: ErtragsArt,
): Ertrag {
  return {
    weg: v.beleg ? 'beleg' : v.belege?.length ? 'ohne' : 'beleg',
    art: v.beleg ?? belegArt,
    bezahlt: v.termin == null && v.entwurf == null,
    vorlage: null,
    adresse: '',
    leistung: '',
    offenId: null,
  };
}

/** Für „ungespeichert“: nur was man eintippt bzw. wählt (Weg und Art allein sind keine Eingabe). */
export const ertragSchluessel = (e: Ertrag): string => JSON.stringify([e.adresse.trim(), e.leistung.trim(), e.offenId]);

/** Eine Rechnung, die erst beim Zahlungseingang zur Einnahme wird. */
export const rechnungOffen = (e: Pick<Ertrag, 'weg' | 'art' | 'bezahlt'>): boolean => e.weg === 'beleg' && e.art === 'rechnung' && !e.bezahlt;

/** Nummer, die der Beleg beim Ausstellen bekommt (Jahr des Belegdatums, nie rückwärts – wie Rust). */
export function naechsteBelegNummer(kreise: readonly Nummernkreis[], art: Belegart, datum: string, heute: string): string | null {
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
    ? 'Die Rechnung wird ausgestellt und erscheint unter „Rechnungen & Quittungen“ als offen. Die Einnahme entsteht erst, wenn das Geld eingeht.'
    : 'Wird beim Speichern mit dieser Nummer ausgestellt und mit der Einnahme verknüpft – Betrag und Datum wie oben.';

/** Offene Rechnungen zum Zuordnen: ausgestellt und offen, die am längsten fälligen zuerst. */
export function offeneRechnungen(zeilen: readonly BelegZeile[]): BelegZeile[] {
  const schluessel = (z: BelegZeile) => z.faellig_am ?? z.datum ?? '';
  return zeilen
    .filter((z) => z.art === 'rechnung' && z.status === 'offen' && z.nummer)
    .sort((a, b) => schluessel(a).localeCompare(schluessel(b)) || a.id - b.id);
}

/** Zweite Zeile einer offenen Rechnung: „7 T. überfällig“, „heute fällig“, „in 3 Tagen“. */
export const offenFaellig = (z: BelegZeile, heute: string): { text: string; ueberfaellig: boolean } => {
  const f = faelligText(z, heute);
  return { text: f.text, ueberfaellig: f.klasse === 'neg' };
};

/** Prüfungen, die nur der Beleg braucht (Betrag, Datum, Beschreibung und Kunde prüft pruefeFormular). */
export function ertragPruefen(f: Pick<Formular, 'wer'>, e: Ertrag, dateien: number): { feld: 'wer' | 'offen' | 'dateien'; text: string } | null {
  if (e.weg === 'offen' && e.offenId == null) return { feld: 'offen', text: 'Bitte eine offene Rechnung auswählen.' };
  if (e.weg !== 'beleg') return null;
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

/** Gewählte Vorlage der Art (nach Design, sonst nach eigener Kopie); sonst die aktive, sonst der Standard. */
export function vorlageFuer(e: Pick<Ertrag, 'art' | 'vorlage'>, vorlagen: ErtragKontext['vorlagen']): VorlagenWahl {
  const liste = vorlagen[e.art];
  const g = e.vorlage;
  const gewaehlt = !g
    ? undefined
    : g.design !== undefined
      ? liste.find((v) => v.design === g.design)
      : g.id != null
        ? liste.find((v) => v.id === g.id)
        : liste.find((v) => v.design === STANDARD_DESIGN);
  return (
    gewaehlt ??
    liste.find((v) => v.aktiv) ??
    liste[0] ?? {
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

/** Erfassen-Formular + Beleg-Angaben ⇒ Formular der Beleg-Maske. `cent` = gelesener Betrag. Mit vorbereitetem Entwurf
 *  (Prototyp buchungen.js speichern): dessen Texte, Vorlage und Positionen bleiben, solange der Betrag zur Summe passt;
 *  Kunde, Datum, Betreff und Zahlung kommen aus der Schublade. */
export function belegFormular(
  f: Formular,
  e: Ertrag,
  cent: number,
  ctx: Pick<ErtragKontext, 'kunden' | 'vorlagen' | 'zahlungszielTage' | 'heute'>,
  bezug: ErtragBezug | null = null,
): BelegFormular {
  const k = kundeAufloesen(f.wer, ctx.kunden, f.kundeBewusstNeu);
  const kunde = k.art === 'kunde' ? (ctx.kunden.find((x) => x.id === k.kunde.id) ?? null) : null;
  const basis = neuesFormular(
    {
      art: e.art,
      betrag: cent,
      datum: f.zahlungsdatum,
      text: f.beschreibung,
      kunde,
      name: k.art === 'neu' || k.art === 'wahl' ? k.name : undefined,
      zahlungsart: f.zahlungsart,
      bezahlt: e.art === 'rechnung' && e.bezahlt,
      kategorieId: f.kategorieId,
      terminId: bezug?.termin?.id ?? null,
    },
    { heute: ctx.heute, zielTage: { rechnung: ctx.zahlungszielTage } },
  );
  const leistung = e.leistung.trim();
  const vorlage = vorlageFuer(e, ctx.vorlagen);
  const form: BelegFormular = {
    ...basis,
    // wie in der Schublade gebunden („Name · K-0012“ bzw. bewusst neuer Kunde mit gleichem Namen)
    kunde: f.wer.trim(),
    kundeBewusstNeu: f.kundeBewusstNeu,
    adresse: e.adresse.trim() ? e.adresse : basis.adresse,
    // Leistungsdatum eines Termins ist sein Tag, nicht der Zahlungstag
    leistungVon: bezug?.termin?.datum ?? basis.leistungVon,
    positionen: basis.positionen.map((p, i) => (i === 0 && leistung ? { ...p, beschreibung: leistung } : p)),
    vorlageId: vorlage.id,
    vorlageDesign: vorlage.design,
  };
  const entwurf = bezug?.entwurf;
  if (!entwurf) return form;
  const w = entwurf.art === e.art ? entwurf : artWechseln(entwurf, e.art, { rechnung: ctx.zahlungszielTage });
  const passt = formularSumme(w) === cent;
  const positionen = !passt ? form.positionen : w.positionen.length === 1 && leistung ? [{ ...w.positionen[0], beschreibung: leistung }] : w.positionen;
  return {
    ...w,
    kunde: form.kunde,
    kundeBewusstNeu: form.kundeBewusstNeu,
    adresse: form.adresse,
    datum: form.datum,
    leistungVon: bezug?.termin ? form.leistungVon : w.leistungVon || form.leistungVon,
    zielTage: form.zielTage,
    betreff: form.betreff,
    zahlungsart: form.zahlungsart,
    bezahltAm: form.bezahltAm,
    positionen,
    mehrere: e.art === 'quittung' && positionen.length > 1,
    vorlageId: form.vorlageId,
    vorlageDesign: form.vorlageDesign,
    terminId: w.terminId ?? form.terminId,
    buchungId: null,
  };
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
}

/** Alles für beleg_ausstellen – samt Pflichtangaben-Check wie in der Maske (mit `bezug`: zum Termin bzw. den Entwurf). */
export function belegVorbereiten(f: Formular, e: Ertrag, cent: number, ctx: ErtragKontext, bezug: ErtragBezug | null = null): BelegVorbereitet {
  const formular = belegFormular(f, e, cent, ctx, bezug);
  const dokument = formularZuDokument(formular, { kunden: ctx.kunden, firma: ctx.firma, ustModus: ctx.ustModus, logo: ctx.logo });
  const gedruckt = bausteineFuer(dokument, vorlageFuer(e, ctx.vorlagen).bausteine).filter((b) => istBausteinTyp(b.typ));
  const naechste = naechsteBelegNummer(ctx.kreise, e.art, f.zahlungsdatum, ctx.heute);
  const jahr = Number((istDatum(f.zahlungsdatum) ? f.zahlungsdatum : ctx.heute).slice(0, 4));
  const kennwerte = ctx.kennwerte.get(jahr) ?? [...ctx.kennwerte.values()].pop() ?? {};
  const pflicht = pflichtCheck(dokument, gedruckt, { kleinbetrag_cent: kennwerte.kleinbetragsrechnung_cent ?? KLEINBETRAG_STANDARD_CENT, naechste_nummer: naechste });
  const fehlt = pflicht.filter((p) => !p.ok).map((p) => p.label);
  const d = formularZuDaten(formular, ctx.kunden);
  if (!d.ok) fehlt.push(...Object.values(d.fehler));
  return { formular, daten: d.ok ? d.daten : null, dokument, gedruckt, naechste, fehlt: [...new Set(fehlt)] };
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
