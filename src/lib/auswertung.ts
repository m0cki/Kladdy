/* Auswertung › Überblick (ANLEITUNG §6.9.1) – reine Rechenlogik ohne Datenbank, mit Vitest getestet (auswertung.test.ts).
 * Daten aus lib/queries/auswertung.ts; Logik wie im Prototyp (referenz/prototyp/js/core.js → summen/vergleich,
 * js/pages/ueberblick.js), aber in ganzen Cent.
 *
 * Regeln:
 * - Es zählt das Zahlungsdatum (Zufluss/Abfluss). Storno-Gegenbuchungen zählen negativ an IHREM Zahlungsdatum (§5).
 *   Im Normalfall ist das der Tag des Originals ⇒ beide heben sich im selben Zeitraum auf, genau wie in Ein- & Ausgänge
 *   (Original durchgestrichen, Gegenbuchung unsichtbar). Nur wenn das Original festgeschrieben war, liegt der Storno später.
 * - Eingänge = Einnahmen brutto. Ausgaben = abziehbarer Teil (ohne Privatanteil, ggf. anteilig abziehbar, je Buchung auf
 *   Cent gerundet – wie EÜR und Prototyp). Überschuss = Eingänge − Ausgaben. Buchungen ohne Geldfluss (AfA/Pauschale)
 *   zählen mit, haben aber keinen Zahlungsweg.
 * - Aufträge = Besuche wie in lib/kunden.ts (istBesuch): ausgestellte Quittungen/Rechnungen ohne Storno + Einnahmen mit
 *   Kunde ohne eigenen Beleg, nach Leistungs- bzw. Termindatum, nur bis heute.
 * - Kleinunternehmer (§2.6, § 19 UStG): Umsatz der Kategorien mit „zählt zum KU-Umsatz“ im laufenden Kalenderjahr,
 *   hochgerechnet aufs Jahr, gemessen an der Vorjahresgrenze (25.000 €) – ab 80 % gelb, ab 100 % rot. Rot auch, wenn das
 *   Vorjahr schon über 25.000 € lag oder das laufende Jahr über 100.000 €. */
import { abziehbar, fehltBeleg, zahlungswegName, type BuchungTyp, type Zahlungsart } from './buchungen';
import { istBesuch, tageZwischen, type VerlaufArt, type VerlaufQuelle } from './kunden';
import { formatBetrag } from './money';
import { kopierQuelle, type KennwerteJahr } from './steuer-kennwerte';
import { imZeitraum, plusTage, verschiebe, zeitraum, type Zeitraum, type ZeitraumModus } from './zeitraum';

/** Eine Buchung, wie sie ladeAuswertung() liefert – auch Storno-Gegenbuchungen (storno_von_id gesetzt). */
export interface AuswertungBuchung {
  id: number;
  typ: BuchungTyp;
  zahlungsdatum: string;
  /** immer positiv */
  betrag_cent: number;
  privatanteil_prozent: number;
  kategorie_id: number;
  kategorie_name: string;
  kategorie_farbe: string | null;
  abziehbar_prozent: number;
  zaehlt_ku_umsatz: number;
  art: 'zahlung' | 'afa' | 'pauschale';
  zahlungsart: Zahlungsart | null;
  rechnung_id: number | null;
  storno_von_id: number | null;
  belege_anzahl: number;
  /** 1 = es gibt eine Gegenbuchung zu dieser Buchung */
  storniert: number;
}

type Von = Pick<Zeitraum, 'von' | 'bis'>;

/** +1 für normale Buchungen, −1 für Storno-Gegenbuchungen. */
const vorzeichen = (b: Pick<AuswertungBuchung, 'storno_von_id'>): 1 | -1 => (b.storno_von_id == null ? 1 : -1);

/** Beitrag zu den Eingängen (Cent, Storno negativ). */
export const eingangCent = (b: AuswertungBuchung): number => (b.typ === 'einnahme' ? vorzeichen(b) * b.betrag_cent : 0);

/** Beitrag zu den Ausgaben: abziehbarer Teil (Cent, Storno negativ). */
export const ausgabeCent = (b: AuswertungBuchung): number =>
  b.typ === 'ausgabe' ? vorzeichen(b) * abziehbar(b.betrag_cent, b.privatanteil_prozent, b.abziehbar_prozent) : 0;

/** Beitrag zum Kleinunternehmer-Umsatz. */
const kuCent = (b: AuswertungBuchung): number => (b.typ === 'einnahme' && b.zaehlt_ku_umsatz ? vorzeichen(b) * b.betrag_cent : 0);

export interface Summen {
  eingaenge: number;
  ausgaben: number;
  ueberschuss: number;
  /** Umsatz für die Kleinunternehmer-Grenze */
  ku: number;
}

export function summen(buchungen: readonly AuswertungBuchung[], z: Von): Summen {
  let eingaenge = 0;
  let ausgaben = 0;
  let ku = 0;
  for (const b of buchungen) {
    if (!imZeitraum(z, b.zahlungsdatum)) continue;
    eingaenge += eingangCent(b);
    ausgaben += ausgabeCent(b);
    ku += kuCent(b);
  }
  return { eingaenge, ausgaben, ueberschuss: eingaenge - ausgaben, ku };
}

/* ================= Vergleich mit der Vorperiode ================= */

export interface Vergleich extends Von {
  /** Vorperiode wurde auf die bisher vergangene Länge gekürzt (laufender Zeitraum) */
  teil: boolean;
  /** „ggü. Vormonat (gleich lang)“ … */
  text: string;
}

const VOR: Readonly<Record<ZeitraumModus, string>> = { monat: 'Vormonat', quartal: 'Vorquartal', jahr: 'Vorjahr' };

/**
 * Vorperiode. Enthält der Zeitraum heute, wird sie gleich lang abgeschnitten (fairer Vergleich, wie im Prototyp):
 * 1.–17. Oktober ⇒ 1.–17. September; nie über das Ende der Vorperiode hinaus (31. März ⇒ bis 28./29. Februar).
 */
export function vergleich(z: Zeitraum, heute: string): Vergleich {
  const vor = zeitraum(z.modus, verschiebe(z.modus, z.von, -1));
  if (!imZeitraum(z, heute)) return { von: vor.von, bis: vor.bis, teil: false, text: `ggü. ${VOR[z.modus]}` };
  const bis = plusTage(vor.von, tageZwischen(z.von, heute));
  return {
    von: vor.von,
    bis: bis < vor.bis ? bis : vor.bis,
    teil: true,
    text: `ggü. ${VOR[z.modus]} (${z.modus === 'jahr' ? 'gleicher Zeitraum' : 'gleich lang'})`,
  };
}

/** Relative Änderung (0,12 = +12 %); null, wenn es keinen Vergleichswert gibt. Negativer Bezug zählt über den Betrag. */
export const aenderung = (jetzt: number, vorher: number): number | null => (vorher ? (jetzt - vorher) / Math.abs(vorher) : null);

export interface DeltaAnzeige {
  /** CSS-Klasse von .delta: Farbe nach „gut/schlecht“ (bei Ausgaben umgekehrt) */
  klasse: 'pos' | 'neg' | 'flat';
  /** ▲ / ▼ / ■, leer ohne Vergleich – Richtung nie nur über Farbe (§9.6 Regel 9) */
  pfeil: string;
  /** „+12,3 %“, „−4,0 %“ bzw. „–“ */
  text: string;
}

const prozent1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function deltaAnzeige(v: number | null, umgekehrt = false): DeltaAnzeige {
  if (v == null || !Number.isFinite(v)) return { klasse: 'flat', pfeil: '', text: '–' };
  const p = Math.round(v * 1000) / 10; // eine Nachkommastelle
  if (p === 0) return { klasse: 'flat', pfeil: '■', text: '±0,0 %' };
  const gut = umgekehrt ? p < 0 : p > 0;
  return { klasse: gut ? 'pos' : 'neg', pfeil: p > 0 ? '▲' : '▼', text: `${p > 0 ? '+' : '−'}${prozent1.format(Math.abs(p))} %` };
}

/* ================= Monate (Balken, kumuliert) ================= */

/** Kurzname wie im Prototyp (Intl „short“ ohne Punkt). */
export const MONAT_KURZ = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sept', 'Okt', 'Nov', 'Dez'] as const;

export interface MonatsWert {
  /** 'YYYY-MM' */
  monat: string;
  /** erster Tag, als Anker für „Klick wählt den Monat“ */
  von: string;
  kurz: string;
  /** „Oktober 2026“ */
  lang: string;
  eingaenge: number;
  ausgaben: number;
  ueberschuss: number;
}

/** 'YYYY-MM' um n Monate verschieben. */
export function monatPlus(monat: string, n: number): string {
  const i = Number(monat.slice(0, 4)) * 12 + Number(monat.slice(5, 7)) - 1 + n;
  return `${String(Math.floor(i / 12)).padStart(4, '0')}-${String((i % 12) + 1).padStart(2, '0')}`;
}

/** Summen je Monat 'YYYY-MM' (ein Durchlauf über alle Buchungen). */
function proMonat(buchungen: readonly AuswertungBuchung[]): Map<string, { eingaenge: number; ausgaben: number }> {
  const m = new Map<string, { eingaenge: number; ausgaben: number }>();
  for (const b of buchungen) {
    const k = b.zahlungsdatum.slice(0, 7);
    const x = m.get(k) ?? { eingaenge: 0, ausgaben: 0 };
    x.eingaenge += eingangCent(b);
    x.ausgaben += ausgabeCent(b);
    m.set(k, x);
  }
  return m;
}

/** `anzahl` Monate bis einschließlich `ende` ('YYYY-MM'), ältester zuerst. */
export function monatsReihe(buchungen: readonly AuswertungBuchung[], ende: string, anzahl = 12): MonatsWert[] {
  const m = proMonat(buchungen);
  const out: MonatsWert[] = [];
  for (let n = anzahl - 1; n >= 0; n--) {
    const monat = monatPlus(ende, -n);
    const s = m.get(monat) ?? { eingaenge: 0, ausgaben: 0 };
    const z = zeitraum('monat', `${monat}-01`);
    out.push({ monat, von: z.von, kurz: MONAT_KURZ[Number(monat.slice(5, 7)) - 1], lang: z.label, ...s, ueberschuss: s.eingaenge - s.ausgaben });
  }
  return out;
}

/** Letzter Monat der Balken: Ende des Zeitraums, höchstens der laufende Monat. */
export const balkenEnde = (z: Von, heute: string): string => (z.bis < heute ? z.bis : heute).slice(0, 7);

export interface Kumuliert {
  jahr: number;
  /** laufend aufsummierter Überschuss je Monat; null für Monate nach heute */
  aktuell: (number | null)[];
  /** dasselbe fürs Vorjahr (immer 12 Werte) */
  vorjahr: number[];
}

/** Überschuss kumuliert Januar–Dezember für `jahr` und das Vorjahr. */
export function kumuliert(buchungen: readonly AuswertungBuchung[], jahr: number, heute: string): Kumuliert {
  const m = proMonat(buchungen);
  const bisMonat = heute.slice(0, 7);
  const aktuell: (number | null)[] = [];
  const vorjahr: number[] = [];
  let a = 0;
  let v = 0;
  for (let i = 1; i <= 12; i++) {
    const mm = String(i).padStart(2, '0');
    const jetzt = m.get(`${jahr}-${mm}`);
    const vor = m.get(`${jahr - 1}-${mm}`);
    v += vor ? vor.eingaenge - vor.ausgaben : 0;
    vorjahr.push(v);
    if (`${jahr}-${mm}` > bisMonat) aktuell.push(null);
    else {
      a += jetzt ? jetzt.eingaenge - jetzt.ausgaben : 0;
      aktuell.push(a);
    }
  }
  return { jahr, aktuell, vorjahr };
}

/* ================= Anteile (Donuts) ================= */

export interface Anteil {
  schluessel: string;
  name: string;
  /** CSS-Farbe: Kategoriefarbe aus den Daten bzw. Token (var(--series-1) …) */
  farbe: string;
  wert: number;
}

/** Größte zuerst; ab `max` Einträgen wird der Rest zu „Übrige“. Nur positive Werte (ein Donut kann nichts Negatives zeigen). */
function ordne(m: Map<string, Anteil>, max: number): Anteil[] {
  const liste = [...m.values()].filter((a) => a.wert > 0).sort((a, b) => b.wert - a.wert || a.name.localeCompare(b.name, 'de'));
  if (liste.length <= max) return liste;
  const rest = liste.slice(max).reduce((s, a) => s + a.wert, 0);
  return [...liste.slice(0, max), { schluessel: 'uebrige', name: 'Übrige', farbe: 'var(--muted)', wert: rest }];
}

/** „Wofür das Geld rausgeht“: abziehbare Ausgaben je Kategorie. */
export function ausgabenNachKategorie(buchungen: readonly AuswertungBuchung[], z: Von, max = 6): Anteil[] {
  const m = new Map<string, Anteil>();
  for (const b of buchungen) {
    if (b.typ !== 'ausgabe' || !imZeitraum(z, b.zahlungsdatum)) continue;
    const k = String(b.kategorie_id);
    const x = m.get(k) ?? { schluessel: k, name: b.kategorie_name, farbe: b.kategorie_farbe ?? 'var(--muted)', wert: 0 };
    x.wert += ausgabeCent(b);
    m.set(k, x);
  }
  return ordne(m, max);
}

/** Feste Farben je Zahlungsweg (wie im Prototyp, data.js → ZAHLUNGSARTEN). */
export const ZAHLUNGSWEG_FARBE: Readonly<Record<Zahlungsart, string>> = { bank: 'var(--series-1)', paypal: 'var(--series-2)', bar: 'var(--series-3)' };

/** „Wie Kunden bezahlen“: Eingänge je Zahlungsweg (Buchungen ohne Geldfluss haben keinen und fehlen hier). */
export function eingaengeNachZahlungsweg(buchungen: readonly AuswertungBuchung[], z: Von): Anteil[] {
  const m = new Map<string, Anteil>();
  for (const b of buchungen) {
    if (b.typ !== 'einnahme' || !b.zahlungsart || !imZeitraum(z, b.zahlungsdatum)) continue;
    const x = m.get(b.zahlungsart) ?? { schluessel: b.zahlungsart, name: zahlungswegName(b.zahlungsart), farbe: ZAHLUNGSWEG_FARBE[b.zahlungsart], wert: 0 };
    x.wert += eingangCent(b);
    m.set(b.zahlungsart, x);
  }
  return ordne(m, 6);
}

/* ================= Status-Pillen ================= */

/** Zahlungen ohne Beleg im Zeitraum – dieselbe Regel wie der Filter „nur ohne Beleg“ in Ein- & Ausgänge. */
export const ohneBelegAnzahl = (buchungen: readonly AuswertungBuchung[], z: Von): number =>
  buchungen.filter((b) => b.storno_von_id == null && imZeitraum(z, b.zahlungsdatum) && fehltBeleg(b)).length;

export interface OffeneRechnung {
  id: number;
  faellig_am: string | null;
  summe_cent: number;
}

export interface OffeneRechnungen {
  anzahl: number;
  ueberfaellig: number;
  summe: number;
}

/** Offene Rechnungen; überfällig = Fälligkeit vor heute. */
export function offeneRechnungen(rs: readonly OffeneRechnung[], heute: string): OffeneRechnungen {
  return {
    anzahl: rs.length,
    ueberfaellig: rs.filter((r) => !!r.faellig_am && r.faellig_am < heute).length,
    summe: rs.reduce((s, r) => s + r.summe_cent, 0),
  };
}

export interface KuGrenzen {
  /** Umsatz im Vorjahr höchstens (Cent) */
  vorjahr: number;
  /** Umsatz im laufenden Jahr höchstens (Cent) */
  laufend: number;
}

/** Stand 2026 (§2.6) – nur, falls in steuer_parameter gar nichts steht. */
export const KU_GRENZEN_STANDARD: KuGrenzen = { vorjahr: 2_500_000, laufend: 10_000_000 };

/** Grenzen für `jahr`: Kennwerte dieses Jahres, sonst des nächstälteren (wie beim Anlegen eines Jahres), sonst Standard. */
export function kuGrenzen(kennwerte: ReadonlyMap<number, KennwerteJahr>, jahr: number): KuGrenzen {
  const quelle = kennwerte.has(jahr) ? jahr : kopierQuelle([...kennwerte.keys()], jahr);
  const w = quelle == null ? undefined : kennwerte.get(quelle);
  return {
    vorjahr: w?.ku_grenze_vorjahr_cent ?? KU_GRENZEN_STANDARD.vorjahr,
    laufend: w?.ku_grenze_laufend_cent ?? KU_GRENZEN_STANDARD.laufend,
  };
}

/** Umsatz bis heute aufs ganze Jahr hochgerechnet (anteilige Monate wie im Prototyp), in ganzen Cent. */
export function hochrechnung(cent: number, heute: string): number {
  const y = Number(heute.slice(0, 4));
  const m = Number(heute.slice(5, 7));
  const t = Number(heute.slice(8, 10));
  const tage = new Date(y, m, 0).getDate();
  // cent / ((m − 1) + t / tage) × 12 – als Bruch aus ganzen Zahlen, gerundet erst am Ende
  return Math.round((cent * 12 * tage) / ((m - 1) * tage + t));
}

export type Stufe = 'ok' | 'warn' | 'alarm';

export interface KuStatus {
  jahr: number;
  /** KU-Umsatz laufendes Jahr */
  umsatz: number;
  umsatzVorjahr: number;
  hochrechnung: number;
  /** Hochrechnung / Vorjahresgrenze (1 = 100 %) */
  quote: number;
  grenzen: KuGrenzen;
  stufe: Stufe;
  /** Text der Pille */
  text: string;
}

const euro0 = (c: number) => formatBetrag(c, { nachkomma: 0 });
const prozent0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

export function kuStatus(buchungen: readonly AuswertungBuchung[], heute: string, grenzen: KuGrenzen): KuStatus {
  const jahr = Number(heute.slice(0, 4));
  const umsatz = summen(buchungen, zeitraum('jahr', heute)).ku;
  const umsatzVorjahr = summen(buchungen, zeitraum('jahr', `${jahr - 1}-01-01`)).ku;
  const hoch = hochrechnung(umsatz, heute);
  const quote = grenzen.vorjahr ? hoch / grenzen.vorjahr : 0;
  let stufe: Stufe = quote >= 1 ? 'alarm' : quote >= 0.8 ? 'warn' : 'ok';
  let text = `${euro0(umsatz)} von ${euro0(grenzen.vorjahr)} · Hochrechnung ${prozent0.format(Math.floor(quote * 100))} %`;
  if (umsatz > grenzen.laufend) {
    stufe = 'alarm';
    text = `${euro0(umsatz)} – über ${euro0(grenzen.laufend)} im laufenden Jahr`;
  } else if (umsatzVorjahr > grenzen.vorjahr) {
    stufe = 'alarm';
    text = `${jahr - 1}: ${euro0(umsatzVorjahr)} – über ${euro0(grenzen.vorjahr)}`;
  }
  return { jahr, umsatz, umsatzVorjahr, hochrechnung: hoch, quote, grenzen, stufe, text };
}

/* ================= Aufträge ================= */

/** Zeile für die Aufträge (lib/queries/auswertung.ts), dieselbe Form und dasselbe Datum wie der Kunden-Verlauf. */
export interface AuftragZeile {
  quelle: Extract<VerlaufQuelle, 'beleg' | 'einnahme'>;
  art: VerlaufArt;
  status: string;
  /** Leistungsdatum, sonst Belegdatum; Einnahme: Tag des erledigten Termins, sonst Zahlungsdatum */
  datum: string;
}

export interface Auftraege {
  gesamt: number;
  quittungen: number;
  rechnungen: number;
  /** Einnahmen mit Kunde ohne eigenen Beleg */
  ohneBeleg: number;
}

export function auftraege(zeilen: readonly AuftragZeile[], z: Von, heute: string): Auftraege {
  const r: Auftraege = { gesamt: 0, quittungen: 0, rechnungen: 0, ohneBeleg: 0 };
  for (const x of zeilen) {
    if (!imZeitraum(z, x.datum) || !istBesuch(x, heute)) continue;
    r.gesamt += 1;
    if (x.quelle === 'einnahme') r.ohneBeleg += 1;
    else if (x.art === 'quittung') r.quittungen += 1;
    else r.rechnungen += 1;
  }
  return r;
}
