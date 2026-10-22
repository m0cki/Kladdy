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
  faelligText,
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
import { standardVorlage } from './vorlagen/standard';
import { istDatum } from './zeitraum';

/** Die drei Wege (Beschriftung wie im Prototyp). */
export type Ertragsweg = 'beleg' | 'offen' | 'ohne';
export type ErtragsArt = 'quittung' | 'rechnung';

export const istErtragsArt = (x: unknown): x is ErtragsArt => x === 'quittung' || x === 'rechnung';

export interface Ertrag {
  weg: Ertragsweg;
  /** Art des eigenen Belegs (Vorauswahl aus Einstellungen › Belege) */
  art: ErtragsArt;
  /** nur Rechnung: „bereits bezahlt“ (Einnahme gleich mit) oder „noch offen“ (Einnahme erst beim Zahlungseingang) */
  bezahlt: boolean;
  /** selbst gewählte Vorlage (id null = Standard); null = die aktive der Art */
  vorlage: { id: number | null } | null;
  /** Anschrift eines neuen Kunden bzw. eines Kunden ohne Anschrift in der Kartei, Zeilen mit \n */
  adresse: string;
  /** Text der Position auf dem Beleg; leer = die Beschreibung */
  leistung: string;
  /** „Offene Rechnung zuordnen“: die gewählte Rechnung */
  offenId: number | null;
}

/** Start: vom Aufrufer vorgewählter Beleg ⇒ „Beleg erstellen“; mit mitgebrachter Datei (Drop) ⇒ „Ohne eigenen Beleg“. */
export function ertragStart(v: { beleg?: ErtragsArt; belege?: readonly unknown[] }, belegArt: ErtragsArt): Ertrag {
  return {
    weg: v.beleg ? 'beleg' : v.belege?.length ? 'ohne' : 'beleg',
    art: v.beleg ?? belegArt,
    bezahlt: true,
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

/** Gewählte Vorlage der Art; sonst die aktive, sonst der Standard. */
export function vorlageFuer(e: Pick<Ertrag, 'art' | 'vorlage'>, vorlagen: ErtragKontext['vorlagen']): VorlagenWahl {
  const liste = vorlagen[e.art];
  const gewaehlt = e.vorlage;
  return (
    (gewaehlt ? liste.find((v) => v.id === gewaehlt.id) : undefined) ??
    liste.find((v) => v.aktiv) ??
    liste[0] ?? { id: null, name: e.art === 'rechnung' ? 'Standard-Rechnung' : 'Standard-Quittung', bausteine: standardVorlage(e.art), aktiv: true }
  );
}

/** Erfassen-Formular + Beleg-Angaben ⇒ Formular der Beleg-Maske. `cent` = gelesener Betrag. */
export function belegFormular(f: Formular, e: Ertrag, cent: number, ctx: Pick<ErtragKontext, 'kunden' | 'vorlagen' | 'zahlungszielTage' | 'heute'>): BelegFormular {
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
    },
    { heute: ctx.heute, zielTage: { rechnung: ctx.zahlungszielTage } },
  );
  const leistung = e.leistung.trim();
  return {
    ...basis,
    // wie in der Schublade gebunden („Name · K-0012“ bzw. bewusst neuer Kunde mit gleichem Namen)
    kunde: f.wer.trim(),
    kundeBewusstNeu: f.kundeBewusstNeu,
    adresse: e.adresse.trim() ? e.adresse : basis.adresse,
    positionen: basis.positionen.map((p, i) => (i === 0 && leistung ? { ...p, beschreibung: leistung } : p)),
    vorlageId: vorlageFuer(e, ctx.vorlagen).id,
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

/** Alles für beleg_ausstellen – samt Pflichtangaben-Check wie in der Maske. */
export function belegVorbereiten(f: Formular, e: Ertrag, cent: number, ctx: ErtragKontext): BelegVorbereitet {
  const formular = belegFormular(f, e, cent, ctx);
  const dokument = formularZuDokument(formular, { kunden: ctx.kunden, firma: ctx.firma, ustModus: ctx.ustModus });
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
