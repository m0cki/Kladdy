/* Beleg-Dokument: die eine Eingabe für Vorschau (components/beleg/Blatt.tsx), LaTeX (lib/latex/) und
 * Pflichtangaben-Check (pflicht.ts). ANLEITUNG §5 (rechnungen, rechnungspositionen), §6.6, §7.
 *
 * - Die Beleg-Maske (Phase 3 Teil 2) baut es aus dem Formular, das Finalisieren friert es als `snapshot_json` ein:
 *   Kunde und Firma stehen deshalb als Schnappschuss drin (GoBD: ein Nachdruck sieht aus wie das Original).
 * - Kunde per ID verknüpft (`kunde.id`), nie per Name; beim Eigenbeleg ist der Empfänger ein Geschäft (id null).
 * - Geld nur in Cent. Menge darf Nachkommastellen haben (Spalte `menge REAL`); der Positionsbetrag wird ganzzahlig
 *   über Tausendstel gerechnet und kaufmännisch auf Cent gerundet.
 * - `nummer` null = Entwurf (Nummern gibt es erst beim Ausstellen).
 * Tests: vorlagen.test.ts */
import type { Zahlungsart } from '../buchungen';
import type { Firma } from '../firma';
import { ibanFormat } from '../firma';
import { formatBetrag, pruefeCent, summe } from '../money';
import type { UstModus } from '../queries/einstellungen';
import { betragInWorten } from '../latex/zahl-in-worten';

export type Belegart = 'rechnung' | 'quittung' | 'angebot' | 'eigenbeleg';
/** a4 = A4 hochkant, a5q = A5 quer */
export type Blattformat = 'a4' | 'a5q';

export interface ArtInfo {
  label: string;
  prefix: string;
  format: Blattformat;
  nrLabel: string;
}

export const BELEGARTEN: readonly Belegart[] = ['rechnung', 'quittung', 'angebot', 'eigenbeleg'];

/** Wie im Prototyp (ART): Rechnung/Angebot A4 hoch, Quittung/Eigenbeleg A5 quer. */
export const ARTEN: Readonly<Record<Belegart, ArtInfo>> = {
  rechnung: { label: 'Rechnung', prefix: 'RE', format: 'a4', nrLabel: 'Rechnungs-Nr.' },
  quittung: { label: 'Quittung', prefix: 'QU', format: 'a5q', nrLabel: 'Quittungs-Nr.' },
  angebot: { label: 'Angebot', prefix: 'AN', format: 'a4', nrLabel: 'Angebots-Nr.' },
  eigenbeleg: { label: 'Eigenbeleg', prefix: 'EB', format: 'a5q', nrLabel: 'Beleg-Nr.' },
};

export const istBelegart = (v: unknown): v is Belegart => typeof v === 'string' && (BELEGARTEN as readonly string[]).includes(v);
export const formatVon = (art: Belegart): Blattformat => ARTEN[art].format;

export const HINWEIS_19 = 'Umsatzsteuerfrei aufgrund der Kleinunternehmerregelung gemäß § 19 UStG.';
export const HINWEIS_14B = 'Hinweis für Privatkunden: Bitte bewahren Sie diesen Beleg zwei Jahre auf (§ 14b UStG).';

/** Standardtexte der Maske je Art (Prototyp TEXTE). */
export const STANDARD_TEXTE: Readonly<Record<Belegart, { einleitung: string; schlusstext: string }>> = {
  rechnung: { einleitung: 'vielen Dank für Ihren Auftrag. Ich berechne Ihnen folgende Leistungen:', schlusstext: HINWEIS_14B },
  quittung: { einleitung: '', schlusstext: HINWEIS_14B },
  angebot: { einleitung: 'vielen Dank für Ihre Anfrage. Gerne biete ich Ihnen an:', schlusstext: 'Ich freue mich auf Ihren Auftrag.' },
  eigenbeleg: { einleitung: '', schlusstext: '' },
};

/** Schnappschuss des Kunden (bzw. beim Eigenbeleg des Zahlungsempfängers) im Beleg. */
export interface KundeSchnappschuss {
  /** Verknüpfung per ID; null = (noch) kein Kunde in der Kartei, z. B. Geschäft beim Eigenbeleg */
  id: number | null;
  /** Kundennummer „K-0012“ oder '' */
  nummer: string;
  name: string;
  zusatz: string;
  strasse: string;
  plz: string;
  ort: string;
  email: string;
}

export interface BelegPosition {
  beschreibung: string;
  /** darf Nachkommastellen haben (höchstens drei zählen) */
  menge: number;
  einheit: string;
  einzelpreis_cent: number;
}

export type EigenbelegGrund = 'verloren' | 'kein' | 'unleserlich' | 'sonstiges';
export const EIGENBELEG_GRUENDE: Readonly<Record<EigenbelegGrund, string>> = {
  verloren: 'Beleg verloren',
  kein: 'Kein Beleg erhältlich (z. B. Parkautomat, Trinkgeld)',
  unleserlich: 'Beleg unleserlich',
  sonstiges: 'Sonstiges',
};

export interface BelegDokument {
  art: Belegart;
  /** null = Entwurf */
  nummer: string | null;
  storniert: boolean;
  /** Belegdatum 'YYYY-MM-DD' (Eigenbeleg: Datum der Zahlung) */
  datum: string;
  leistung_von: string | null;
  leistung_bis: string | null;
  /** Rechnung: fällig am · Angebot: gültig bis */
  faellig_am: string | null;
  kunde: KundeSchnappschuss | null;
  betreff: string;
  einleitung: string;
  schlusstext: string;
  positionen: BelegPosition[];
  /** Quittung/Eigenbeleg: wie bezahlt wurde (nur Info, keine Konten) */
  zahlungsweg: Zahlungsart | null;
  /** Rechnung, die bei Ausstellung schon bezahlt war (eingefroren): Quittungstext statt Zahlungsaufforderung */
  quittiert: { am: string; zahlungsweg: Zahlungsart } | null;
  /** nur Eigenbeleg */
  eigenbeleg: { grund: EigenbelegGrund; grund_text: string; gebucht: { nummer: string; kategorie: string } | null } | null;
  /** Ausstellungstag (Unterschrift beim Eigenbeleg); null = `datum` */
  ausgestellt_am: string | null;
  /** Schnappschuss der Firmendaten beim Ausstellen */
  firma: Firma;
  /** Firmenlogo beim Ausstellen: Dateiname in <appDataDir>/assets (`logo-<sha256>.png`, lib/firmenlogo.ts); fehlt oder
   * leer = keins. Steht im Schnappschuss (`snapshot_json.dokument.logo`), damit ein Nachdruck das Logo von damals trägt. */
  logo?: string | null;
  ust_modus: UstModus;
  /** Stornobeleg: Verweis auf das Original (Titel „Stornorechnung“ usw., Beträge negativ, kein Zahlungsaufruf) */
  storno_von?: { nummer: string; datum: string } | null;
}

/* ---------- Rechnen (nur Ganzzahlen) ---------- */

/** Menge in Tausendstel (1,5 ⇒ 1500). Mehr als drei Nachkommastellen werden gerundet. */
export function mengeTausendstel(menge: number): number {
  if (!Number.isFinite(menge)) throw new RangeError(`Menge: ${menge} ist keine Zahl`);
  return Math.round(menge * 1000);
}

/** Positionsbetrag in Cent = Menge × Einzelpreis, kaufmännisch gerundet (halbe Cent vom Nullpunkt weg). */
export function positionBetrag(p: Pick<BelegPosition, 'menge' | 'einzelpreis_cent'>): number {
  pruefeCent(p.einzelpreis_cent, 'Einzelpreis');
  const produkt = mengeTausendstel(p.menge) * p.einzelpreis_cent;
  if (!Number.isSafeInteger(produkt)) throw new RangeError('Positionsbetrag außerhalb des sicheren Bereichs');
  const vz = produkt < 0 ? -1 : 1;
  const abs = Math.abs(produkt);
  const ganz = (abs - (abs % 1000)) / 1000;
  return vz * (abs % 1000 >= 500 ? ganz + 1 : ganz) || 0;
}

export const belegSumme = (doc: Pick<BelegDokument, 'positionen'>): number => summe(doc.positionen.map(positionBetrag));

/* ---------- Anzeige ---------- */

const MENGE = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 });
/** 1.5 ⇒ „1,5“, 3 ⇒ „3“ */
export const mengeText = (menge: number): string => MENGE.format(mengeTausendstel(menge) / 1000).replace('-', '−');

/** 'YYYY-MM-DD' ⇒ '09.10.2026' ('' bei leer) */
export const datumText = (iso: string | null | undefined): string => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
const tagMonat = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** Leistungsdatum oder -zeitraum: „01.10.2026“, „01.10.–07.10.2026“, über den Jahreswechsel voll. */
export function leistungText(doc: Pick<BelegDokument, 'leistung_von' | 'leistung_bis'>): string {
  const a = doc.leistung_von;
  const b = doc.leistung_bis;
  if (!a) return '';
  if (!b || b === a) return datumText(a);
  return a.slice(0, 4) === b.slice(0, 4) ? `${tagMonat(a)}–${datumText(b)}` : `${datumText(a)}–${datumText(b)}`;
}

export const leistungLabel = (doc: Pick<BelegDokument, 'leistung_von' | 'leistung_bis'>): string =>
  doc.leistung_bis && doc.leistung_von && doc.leistung_bis !== doc.leistung_von ? 'Leistungszeitraum' : 'Leistungsdatum';

/** Tage zwischen zwei ISO-Daten (UTC, ohne Sommerzeit-Versatz). */
export function tageZwischen(von: string, bis: string): number {
  const t = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((t(bis) - t(von)) / 86_400_000);
}

const ZAHLUNGSWEG_TEXT: Readonly<Record<Zahlungsart, string>> = { bar: 'Bar', bank: 'Überweisung', paypal: 'PayPal' };
export const zahlungswegText = (z: Zahlungsart | null | undefined): string => (z ? ZAHLUNGSWEG_TEXT[z] : '');

/** Empfänger wie er gedruckt wird: Name (Quittung ohne Namen: „Barverkauf“) und Anschriftzeilen. */
export interface Empfaenger {
  name: string;
  anzeige: string;
  zeilen: string[];
  ort: string;
  nummer: string;
}

export function empfaenger(doc: Pick<BelegDokument, 'art' | 'kunde'>): Empfaenger {
  const k = doc.kunde;
  const t = (s: string | undefined) => (s ?? '').trim();
  const name = t(k?.name);
  const ort = [t(k?.plz), t(k?.ort)].filter(Boolean).join(' ');
  const zeilen = [t(k?.zusatz), t(k?.strasse), ort].filter(Boolean);
  return { name, anzeige: name || (doc.art === 'quittung' ? 'Barverkauf' : ''), zeilen, ort, nummer: t(k?.nummer) };
}

/** Rechnung war bei Ausstellung schon bezahlt ⇒ Satz für den Baustein „Zahlung“ (sonst ''). */
export function quittiertText(doc: Pick<BelegDokument, 'art' | 'quittiert' | 'positionen'>): string {
  if (doc.art !== 'rechnung' || !doc.quittiert) return '';
  const wie = doc.quittiert.zahlungsweg === 'bar' ? 'bar ' : doc.quittiert.zahlungsweg === 'paypal' ? 'per PayPal ' : '';
  return `Den Betrag von ${formatBetrag(belegSumme(doc))} habe ich am ${datumText(doc.quittiert.am)} ${wie}dankend erhalten.`;
}

export function eigenbelegGrundText(doc: Pick<BelegDokument, 'eigenbeleg'>): string {
  const e = doc.eigenbeleg;
  if (!e) return '—';
  if (e.grund === 'sonstiges') return e.grund_text.trim() || EIGENBELEG_GRUENDE.sonstiges;
  return EIGENBELEG_GRUENDE[e.grund];
}

export function gebuchtText(doc: Pick<BelegDokument, 'eigenbeleg'>): string {
  const g = doc.eigenbeleg?.gebucht;
  return g ? [g.nummer, g.kategorie].filter(Boolean).join(' · ') : '';
}

/** „Für“ auf der Quittung bei höchstens einer Position: Betreff, sonst Text der Position, sonst „—“. */
export function quittungFuer(doc: Pick<BelegDokument, 'betreff' | 'positionen'>): string {
  return doc.betreff.trim() || doc.positionen[0]?.beschreibung.trim() || '—';
}

/** Datum für „Ort, Datum“ der Unterschrift: Eigenbeleg = Ausstellungstag, sonst Belegdatum. */
export const unterschriftDatum = (doc: Pick<BelegDokument, 'art' | 'datum' | 'ausgestellt_am'>): string =>
  datumText(doc.art === 'eigenbeleg' ? (doc.ausgestellt_am ?? doc.datum) : doc.datum);

export const istEntwurf = (doc: Pick<BelegDokument, 'nummer' | 'storniert'>): boolean => !doc.storniert && !doc.nummer;

/** Titel der Belegart; ein Stornobeleg heißt „Stornorechnung“, „Storno-Quittung“ bzw. „Storno-Eigenbeleg“. */
export function belegTitel(doc: Pick<BelegDokument, 'art' | 'storno_von'>): string {
  if (!doc.storno_von) return ARTEN[doc.art].label;
  return doc.art === 'rechnung' ? 'Stornorechnung' : `Storno-${ARTEN[doc.art].label}`;
}

/** Bausteine, wie sie für dieses Dokument gedruckt werden: Ein Stornobeleg fordert nicht zur Zahlung auf (ohne „Zahlung“). */
export const bausteineFuer = <T extends { typ: string }>(doc: Pick<BelegDokument, 'storno_von'>, bausteine: readonly T[]): T[] =>
  doc.storno_von ? bausteine.filter((b) => b.typ !== 'zahlung') : [...bausteine];

/* ---------- Platzhalter (§7.0: {kunde}, {nr}, {summe}, {faellig} …) ---------- */

export const PLATZHALTER = [
  ['kunde', 'Name des Kunden / Empfängers'],
  ['nr', 'Belegnummer'],
  ['art', 'Belegart (Rechnung, Quittung …)'],
  ['datum', 'Belegdatum'],
  ['leistungsdatum', 'Leistungsdatum oder -zeitraum'],
  ['faellig', 'Fällig am / gültig bis'],
  ['summe', 'Gesamtbetrag'],
  ['betrag_worte', 'Betrag in Worten'],
  ['betreff', 'Betreff des Belegs'],
  ['einleitung', 'Einleitungstext aus der Maske'],
  ['schlusstext', 'Schlusstext aus der Maske'],
  ['zahlungsziel', 'Zahlungsziel in Tagen'],
  ['firma', 'Firmenname'],
  ['inhaber', 'Inhaber'],
  ['strasse', 'Straße (Firma)'],
  ['plz', 'PLZ (Firma)'],
  ['ort', 'Ort (Firma)'],
  ['steuernummer', 'Steuernummer'],
  ['telefon', 'Telefon'],
  ['email', 'E-Mail'],
  ['web', 'Website'],
  ['bank', 'Bank'],
  ['iban', 'IBAN'],
  ['bic', 'BIC'],
] as const;

export type PlatzhalterName = (typeof PLATZHALTER)[number][0];
const NAMEN = new Set<string>(PLATZHALTER.map(([n]) => n));
export const istPlatzhalter = (n: string): n is PlatzhalterName => NAMEN.has(n);

export type Textteil = { art: 'text'; text: string } | { art: 'platzhalter'; name: PlatzhalterName };

/** Text mit Platzhaltern zerlegen; unbekannte {namen} bleiben Text. */
export function zerlegen(text: string): Textteil[] {
  const teile: Textteil[] = [];
  for (const stueck of String(text ?? '').split(/(\{\w+\})/)) {
    if (!stueck) continue;
    const m = /^\{(\w+)\}$/.exec(stueck);
    if (m && istPlatzhalter(m[1])) teile.push({ art: 'platzhalter', name: m[1] });
    else teile.push({ art: 'text', text: stueck });
  }
  return teile;
}

/** Werte aller Platzhalter für ein Dokument (Klartext, unmaskiert). */
export function platzhalterWerte(doc: BelegDokument): Record<PlatzhalterName, string> {
  const F = doc.firma;
  const s = belegSumme(doc);
  return {
    kunde: empfaenger(doc).anzeige,
    nr: doc.nummer ?? '',
    art: belegTitel(doc),
    datum: datumText(doc.datum),
    leistungsdatum: leistungText(doc),
    faellig: datumText(doc.faellig_am),
    summe: formatBetrag(s),
    betrag_worte: betragInWorten(s),
    betreff: doc.betreff,
    einleitung: doc.einleitung,
    schlusstext: doc.schlusstext,
    zahlungsziel: doc.faellig_am && doc.datum ? String(Math.max(0, tageZwischen(doc.datum, doc.faellig_am))) : '',
    firma: F.name,
    inhaber: F.inhaber,
    strasse: F.strasse,
    plz: F.plz,
    ort: F.ort,
    steuernummer: F.steuernummer,
    telefon: F.telefon,
    email: F.email,
    web: F.web,
    bank: F.bank,
    iban: F.iban ? ibanFormat(F.iban) : '',
    bic: F.bic,
  };
}

/** Platzhalter als Klartext ersetzen (fehlende Nummer ⇒ „Entwurf“), Leerzeilen am Rand entfernt. */
export function ersetzen(text: string, werte: Record<PlatzhalterName, string>): string {
  return zerlegen(text)
    .map((t) => (t.art === 'text' ? t.text : t.name === 'nr' && !werte.nr ? 'Entwurf' : werte[t.name]))
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/^\n+|\n+$/g, '');
}
