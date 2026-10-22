/* Belegerkennung – die Regeln (ANLEITUNG §6.4 „Drag & Drop auf das Fenster“ und „Erkennung in der Mac-App“).
 * Port von referenz/prototyp/js/beleg.js (Teil „Erkennung“): Aus den Textzeilen eines Belegs (pdf.js, lib/erkennung/pdftext.ts)
 * und dem Dateinamen werden Buchungsfelder vorgeschlagen – jedes mit Herkunft ('pdf' | 'dateiname') und Sicherheit:
 * - Betrag neben „Gesamt/Summe/zu zahlen“ (Netto + Steuer = Brutto bestätigt), Datum neben „Rechnungsdatum“ bzw. Datum + Uhrzeit
 *   auf Kassenbons; bei Lastschrift zählt der Abbuchungstag („wird am … abgebucht“) als Zahlungsdatum (§ 11 EStG), das
 *   Rechnungsdatum bleibt als Belegdatum mit Hinweis,
 * - Rechnungs- bzw. Bonnummer, Geschäft (Kopfzeilen, Abgleich mit bisherigen Geschäften), Kategorie (Historie des Geschäfts,
 *   sonst Stichworte der Kategorien, sonst interne Wortliste), Beschreibung aus Geschäft + Positionen,
 * - eigene Belege (eigene Steuernummer, USt-IdNr., IBAN, Briefkopf) werden als Einnahme erkannt.
 * Rein und ohne Seiteneffekte; `erkenne` wirft nie (im Zweifel bleibt ein Feld leer). Geld in Cent, Datum 'YYYY-MM-DD'.
 * Tests: regeln.test.ts (u. a. die Texte der Beispielbelege aus referenz/beispiel-belege). */
import { datumKurz, geschaeftZu, type BuchungTyp, type Geschaeft, type KategorieWahl } from '../buchungen';
import type { Firma } from '../firma';
import { formatBetrag } from '../money';
import { heute as heuteDatum, istDatum, plusTage } from '../zeitraum';

/* ================= Typen ================= */

export type Quelle = 'pdf' | 'dateiname';
export type Sicherheit = 'hoch' | 'mittel' | 'niedrig';

export interface ErkannteFelder {
  /** nur gesetzt, wenn ein eigener Beleg erkannt wurde (⇒ 'einnahme') */
  typ?: BuchungTyp;
  betrag_cent?: number;
  /** Zahlungsdatum – bei Lastschrift der Abbuchungstag */
  zahlungsdatum?: string;
  /** Rechnungsdatum, nur wenn es vom Zahlungsdatum abweicht (Lastschrift) */
  belegdatum?: string;
  /** Rechnungs- bzw. Bonnummer */
  belegnummer?: string;
  /** Geschäft (nur Ausgaben) */
  lieferant?: string;
  kategorie_id?: number;
  /** Vorschlag für die Beschreibung, z. B. „Bauhaus · Schleifpapier K120, Ponal Holzleim Express“ */
  beschreibung?: string;
}

export type ErkanntesFeld = keyof ErkannteFelder;

export interface Erkennung {
  felder: ErkannteFelder;
  herkunft: Partial<Record<ErkanntesFeld, Quelle>>;
  sicherheit: Partial<Record<ErkanntesFeld, Sicherheit>>;
  /** woraus überwiegend erkannt wurde; 'keine' = nichts erkannt */
  quelle: Quelle | 'keine';
  /** ruhige Hinweise (Lastschrift, Abweichungen, kein Text im PDF …) */
  hinweise: string[];
  /** „Erkannt: 47,83 € · 14.09.2026 · Bauhaus · Produkte & Material“ – leer, wenn nichts erkannt wurde */
  zusammenfassung: string;
}

/** Was die Regeln von einer Kategorie brauchen (Auszug aus KategorieWahl). */
export type ErkennungKategorie = Pick<KategorieWahl, 'id' | 'name' | 'typ' | 'stichworte' | 'wareneingang' | 'zaehlt_ku_umsatz'>;

export interface ErkennungKontext {
  /** heute 'YYYY-MM-DD' – plausibel sind Daten bis 3 Jahre zurück und 60 Tage voraus */
  heute: string;
  /** Kategorien (nicht archiviert) mit Stichworten */
  kategorien: readonly ErkennungKategorie[];
  /** bisherige Geschäfte mit häufigster Kategorie (geschaefte() aus lib/buchungen.ts) */
  geschaefte: readonly Geschaeft[];
  /** eigene Firma (Einstellungen › Firma) – erkennt eigene Belege und blendet die eigene Anschrift aus */
  firma: Firma | null;
}

/** Ergebnis einer Quelle (PDF-Text bzw. Dateiname) vor dem Zusammenführen. */
interface Teil {
  felder: ErkannteFelder;
  sicherheit: Partial<Record<ErkanntesFeld, Sicherheit>>;
  /** Positionen (für die Beschreibung) */
  pos: string[];
  betreff: string | null;
  /** internes Hauptthema (z. B. 'bewirtung') */
  thema: string | null;
  /** Text für die Kategorie-Stichworte (ohne eigene Firmendaten) */
  katText: string;
}

const leererTeil = (): Teil => ({ felder: {}, sicherheit: {}, pos: [], betreff: null, thema: null, katText: '' });

/* ================= Allgemeine Hilfen ================= */

const pad = (n: number): string => String(n).padStart(2, '0');
const ohneAkzent = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
/** Vergleichsform: klein, Umlaute ausgeschrieben, nur Buchstaben/Ziffern, einfache Leerzeichen. */
const norm = (s: string): string =>
  ohneAkzent(s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss'))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const buchstaben = (s: string): number => (s.match(/[a-zäöüß]/gi) ?? []).length;

/** Gesperrt gedruckter Text („S u m m e E U R“, „7 8 , 9 5“) ⇒ zusammengezogen; erst ab vier Einzelzeichen in Folge. */
const entsperren = (z: string): string => z.replace(/(?<!\S)\S(?: \S){3,}(?!\S)/g, (m) => m.replace(/ /g, ''));

/** Text ⇒ bereinigte, nicht leere Zeilen (Tabulator = Spaltenwechsel, geschützte Leerzeichen = Leerzeichen,
 *  Steuerzeichen aus nicht lesbaren Schriften fallen weg). */
export function zeilenVon(text: string): string[] {
  return text
    .normalize('NFKC')
    .replace(/[­​-‏﻿\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f�]/g, '')
    .split(/\r?\n|\r/)
    .map((z) => entsperren(z.replace(/\t/g, '  ').replace(/[   ]/g, ' ').trim()))
    .filter(Boolean);
}

/* ================= Datum ================= */

interface Grenzen {
  min: string;
  max: string;
}

/** Plausibler Zeitraum: höchstens 3 Jahre zurück, 60 Tage voraus. */
function grenzen(heute: string): Grenzen {
  const t = istDatum(heute) ? heute : heuteDatum();
  return { min: `${String(Number(t.slice(0, 4)) - 3).padStart(4, '0')}${t.slice(4)}`, max: plusTage(t, 60) };
}

type Roh = string | number | undefined;

function mkDatum(j: Roh, m: Roh, t: Roh, g: Grenzen): string | null {
  let y = Number(j);
  const mo = Number(m);
  const d = Number(t);
  if (!y || !mo || !d) return null;
  if (y < 100) y += 2000;
  const s = `${String(y).padStart(4, '0')}-${pad(mo)}-${pad(d)}`;
  return istDatum(s) && s >= g.min && s <= g.max ? s : null;
}

const MONAT: Readonly<Record<string, number | undefined>> = {
  jan: 1, januar: 1, january: 1, feb: 2, februar: 2, february: 2, mrz: 3, mär: 3, märz: 3, maerz: 3, mar: 3, march: 3,
  apr: 4, april: 4, mai: 5, may: 5, jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10, nov: 11, november: 11, dez: 12, dezember: 12, dec: 12, december: 12,
};

/** Muster ⇒ [Jahr, Monat, Tag]: 14.09.2026 · 14.09.26 · 2026-09-14 · 14/09/2026 · 14. September 2026 · Sep 14, 2026 */
const DATUM_MUSTER: readonly [RegExp, (m: RegExpExecArray) => [Roh, Roh, Roh]][] = [
  [/(?<!\d)(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})(?!\d)/g, (m) => [m[3], m[2], m[1]]],
  [/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g, (m) => [m[1], m[2], m[3]]],
  [/(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/g, (m) => [m[3], m[2], m[1]]],
  [/(?<!\d)(\d{1,2})(?:\.\s?|\s|-)([A-Za-zÄÖÜäöü]{3,9})\.?(?:\s|-)(\d{4})(?!\d)/g, (m) => [m[3], MONAT[m[2].toLowerCase()], m[1]]],
  [/(?<![A-Za-z])([A-Za-z]{3,9})\.?\s(\d{1,2}),?\s(\d{4})(?!\d)/g, (m) => [m[3], MONAT[m[1].toLowerCase()], m[2]]],
];

interface Stelle {
  idx: number;
  end: number;
}

/** Alle plausiblen Daten einer Zeile (überlappungsfrei, nach Position). */
function datenIn(z: string, g: Grenzen): (Stelle & { d: string })[] {
  const out: (Stelle & { d: string })[] = [];
  for (const [re, f] of DATUM_MUSTER) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(z))) {
      const t = f(m);
      const d = t[1] ? mkDatum(t[0], t[1], t[2], g) : null;
      const a = m.index;
      const b = m.index + m[0].length;
      if (d && !out.some((o) => a < o.end && o.idx < b)) out.push({ d, idx: a, end: b });
    }
  }
  return out.sort((x, y) => x.idx - y.idx);
}

/* ================= Beträge ================= */

/** Datum, Uhrzeit, IBAN, Telefon, Steuernummer ausblenden (gleiche Länge ⇒ Positionen bleiben gültig). */
const leerzeichen = (m: string): string => ' '.repeat(m.length);
const maskiere = (z: string): string =>
  z
    .replace(/(?<!\d)\d{1,2}\.\s?\d{1,2}\.\s?(?:\d{4}|\d{2})(?!\d)/g, leerzeichen)
    .replace(/(?<!\d)\d{4}-\d{1,2}-\d{1,2}(?!\d)/g, leerzeichen)
    .replace(/(?<!\d)\d{1,2}\/\d{1,2}\/\d{2,4}(?!\d)/g, leerzeichen)
    .replace(/(?<!\d)\d{1,2}:\d{2}(?::\d{2})?(?!\d)/g, leerzeichen)
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b/g, leerzeichen)
    .replace(/(?:tel|telefon|fax|mobil|hotline|phone)\.?:?\s*[+\d][\d\s/()-]{4,}\d/gi, leerzeichen)
    .replace(/(?<!\d)\d{2,3}\/\d{3}\/\d{4,5}(?!\d)/g, leerzeichen);

/** Beträge: 1.234,56 · 1234,56 · 1 234,56 · € 59,49 · 59,49 € · EUR 59,49 · 1234,56 EUR · 59.49 · 1,234.56 */
const RE_GELD =
  /(?<![\d,A-Za-wyzÄÖÜäöüß])(?<!\d\.)(-\s?)?(EUR\s?|€\s?)?(-\s?)?(\d{1,3}(?:[. ]\d{3})+(?:,\d{2})?|\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+[.,]\d{2}|\d+)(?!\d|[.,]\d)(\s?(?:EUR|€|Euro)(?![A-Za-z]))?/gi;
/** Menge, Einheit oder Prozent direkt dahinter ⇒ kein Geldbetrag („42,31 l“, „19 %“). */
const RE_EINHEIT = /^\s?(?:kg|g|m|cm|mm|m2|m3|qm|lfm|l|ml|std|h|stk|st|x|×|km|kwh|kw|uhr|min|gb|mb|tb|tage?|monate?|jahre?|wochen?|seiten?|pcs|%)(?![a-zäöü])/i;

/** Zahl ⇒ Cent. „1,866“ ist eher ein Literpreis als 1.866 € ⇒ nur Punkt-Tausender oder ganze Zahlen. */
function geldWert(k: string): { c: number; dez: boolean } | null {
  const s = k.replace(/ /g, '');
  let m = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})$/.exec(s);
  if (m) return { c: Number(m[1].replace(/\./g, '')) * 100 + Number(m[2]), dez: true };
  m = /^(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/.exec(s);
  if (m) return { c: Number(m[1].replace(/,/g, '')) * 100 + Number(m[2]), dez: true };
  if (/^\d{1,3}(?:\.\d{3})+$/.test(s) || /^\d{1,3}(?:,\d{3}){2,}$/.test(s) || /^\d+$/.test(s)) return { c: Number(s.replace(/[.,]/g, '')) * 100, dez: false };
  return null;
}

/** Geldbeträge einer Zeile (ganze Zahlen nur mit Währung). Negativ bei „-“ davor. */
export function geldIn(z: string): (Stelle & { c: number })[] {
  const zz = maskiere(z);
  const out: (Stelle & { c: number })[] = [];
  RE_GELD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_GELD.exec(zz))) {
    const v = geldWert(m[4]);
    if (!v) continue;
    const waehrung = Boolean(m[2] || m[5]);
    if (!v.dez && !waehrung) continue;
    const ende = m.index + m[0].length;
    if (!m[5] && RE_EINHEIT.test(zz.slice(ende))) continue;
    if (v.c <= 0 || v.c > 1e10) continue;
    out.push({ c: m[1] || m[3] ? -v.c : v.c, idx: m.index + (m[1] || '').length, end: ende });
  }
  return out;
}

/* ================= Beschriftungen (Spalten = mindestens zwei Leerzeichen) ================= */

interface Segment {
  t: string;
  a: number;
  b: number;
}

function segmente(z: string): Segment[] {
  const out: Segment[] = [];
  const re = /\S+(?: \S+)*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(z))) out.push({ t: m[0], a: m.index, b: m.index + m[0].length });
  return out;
}

const hatWort = (s: string): boolean => /[a-zäöüß]{2,}/i.test(s.replace(/\b(?:eur|euro)\b|€/gi, ''));

/** Beschriftung links vom Treffer (nächstes Segment mit Wörtern). */
function labelLinks(z: string, idx: number): string {
  const segs = z.slice(0, idx).split(/\s{2,}/);
  while (segs.length) {
    const l = segs.pop() ?? '';
    if (hatWort(l)) return l.trim();
  }
  return '';
}

/** Tabellenkopf in der Zeile darüber (gleiche Spaltenzahl, sonst rechtsbündig zugeordnet). */
function kopfLabel(Z: readonly string[], i: number, idx: number): string {
  if (!i) return '';
  const k = segmente(Z[i - 1]);
  const w = segmente(Z[i]);
  if (k.length < 2 || !k.every((s) => buchstaben(s.t) >= 2)) return '';
  const j = w.findIndex((s) => idx >= s.a && idx < s.b);
  if (j < 0) return '';
  if (k.length === w.length) return k[j].t;
  if (w.length < k.length) return k[k.length - (w.length - j)].t;
  return '';
}

/** Beschriftung in eigener Zeile darüber („Gesamtbetrag:“ ↵ „90,40 €“). */
function vorzeile(Z: readonly string[], i: number, g: Grenzen): string {
  const p = i ? Z[i - 1] : '';
  return p && p.length <= 50 && buchstaben(p) >= 3 && !geldIn(p).length && !datenIn(p, g).length ? p : '';
}

/* ================= Betrag ================= */

const KW_TOTAL =
  /gesamtbetrag|rechnungsbetrag|endbetrag|gesamtsumme|endsumme|rechnungssumme|zahlbetrag|zahlungsbetrag|zu\s*zahlen|bruttobetrag|brutto\s*gesamt|gesamt\s*brutto|summe\s*brutto|grand\s*total|total\s*due|amount\s*due|total\s*amount|invoice\s*total|offener\s*betrag/i;
const KW_SUMME = /summe|gesamt|brutto|total|betrag|endpreis|zahlung|bezahlt|paid|ec-?karte|girocard|kartenzahlung|kreditkarte|visa|mastercard|amount/i;
const KW_NICHT =
  /netto|zwischensumme|sub-?total|mwst|\bust\b|umsatzsteuer|mehrwertsteuer|\bvat\b|\btax\b|steuer|rabatt|skonto|nachlass|r[üu]ckgeld|wechselgeld|gegeben|einzelpreis|e-preis|st[üu]ckpreis|unit\s*price|(?:^|\s)à(?:\s|$)|\bje\b|anzahlung|bereits|trinkgeld|versand|pfand|gutschein|guthaben|ersparnis|gespart/i;

function betragScore(l: string): number {
  const t = l.toLowerCase();
  const stark = KW_TOTAL.test(t);
  const mittel = KW_SUMME.test(t);
  let s = stark ? 10 : mittel ? 5 : 0;
  if (KW_NICHT.test(t) && !(/inkl|incl|einschl/.test(t) && (stark || mittel))) s -= stark ? 4 : 8;
  return s;
}

/** Gesamtbetrag: Schlüsselwort davor, darüber oder im Tabellenkopf; sonst der größte plausible Betrag. */
export function findeBetrag(Z: readonly string[], heute: string): { c: number; s: Sicherheit } | null {
  const g = grenzen(heute);
  const c: { c: number; s: number; i: number; j: number }[] = [];
  Z.forEach((z, i) => {
    const geld = geldIn(z);
    geld.forEach((x, j) => {
      if (x.c <= 0) return;
      const l = labelLinks(z, x.idx) || kopfLabel(Z, i, x.idx) || vorzeile(Z, i, g);
      c.push({ c: x.c, s: betragScore(l) - (j < geld.length - 1 ? 1 : 0), i, j });
    });
  });
  if (!c.length) return null;
  const anzahl = new Map<number, number>();
  for (const x of c) anzahl.set(x.c, (anzahl.get(x.c) ?? 0) + 1);
  for (const x of c) if ((anzahl.get(x.c) ?? 0) > 1) x.s += 1;
  c.sort((a, b) => b.s - a.s || b.i - a.i || b.j - a.j);
  let best = c[0];
  let s: Sicherheit = best.s >= 10 ? 'hoch' : best.s >= 4 ? 'mittel' : 'niedrig';
  if (best.s < 4) {
    // kein Schlüsselwort: größter plausibler Betrag
    const pool = c.filter((x) => x.s > -4);
    best = (pool.length ? pool : c).reduce((m, x) => (x.c > m.c ? x : m));
    s = 'niedrig';
  }
  // Netto + Steuer = Brutto bestätigt
  const ziel = best.c;
  const w = c.map((x) => x.c);
  if (s !== 'hoch' && w.some((a, k) => a < ziel && w.some((b, l) => l !== k && a + b === ziel))) s = s === 'niedrig' ? 'mittel' : 'hoch';
  return { c: ziel, s };
}

/* ================= Datum ================= */

const KW_D_STARK =
  /rechnungsdatum|rechnungs-datum|belegdatum|kaufdatum|bondatum|quittungsdatum|ausstellungsdatum|invoice\s*date|datum\s*der\s*rechnung|tag\s*der\s*bewirtung|date\s*of\s*issue|issue\s*date/i;
const KW_D_SCHWACH = /leistungsdatum|lieferdatum|bestelldatum|order\s*date|leistung/i;
const KW_D = /datum|\bdate\b|\bvom\b/i;
const KW_D_NICHT = /f[äa]llig|zahlbar|\bdue\b|\bbis\b|zeitraum|period|g[üu]ltig|valid|unterschrift|geburt|ablauf|expir|erfolgte|abbuchung|einzug|lastschrift/i;

function datumScore(l: string): number {
  const t = l.toLowerCase();
  let s = KW_D_STARK.test(t) ? 10 : KW_D_SCHWACH.test(t) ? 3 : KW_D.test(t) ? 6 : 0;
  if (KW_D_NICHT.test(t)) s -= 8;
  return s;
}

/** Beleg- bzw. Rechnungsdatum: Beschriftung, weiter oben besser, Kassenbon-Muster „Datum Uhrzeit“. */
export function findeDatum(Z: readonly string[], heute: string): { d: string; s: Sicherheit } | null {
  const g = grenzen(heute);
  const c: { d: string; s: number; i: number }[] = [];
  Z.forEach((z, i) => {
    for (const t of datenIn(z, g)) {
      const l = labelLinks(z, t.idx) || kopfLabel(Z, i, t.idx) || vorzeile(Z, i, g);
      let s = datumScore(l) + 2 * (1 - i / Z.length);
      if (/^\s*\d{1,2}:\d{2}/.test(z.slice(t.end))) s += 4; // Kassenbon: Datum + Uhrzeit
      c.push({ d: t.d, s, i });
    }
  });
  if (!c.length) return null;
  c.sort((a, b) => b.s - a.s || a.i - b.i);
  const n = new Set(c.map((x) => x.d)).size;
  return { d: c[0].d, s: c[0].s >= 9 ? 'hoch' : c[0].s >= 5 || n === 1 ? 'mittel' : 'niedrig' };
}

/* Abbuchungsdatum (Lastschrift): „Der Rechnungsbetrag wird am 20.10.2026 von Ihrem Konto abgebucht“, „Abbuchung am …“,
 * „Lastschrift … am …“, „Einzug am …“. Nach § 11 EStG zählt der Abfluss – dieses Datum ist das Zahlungsdatum.
 * „zahlbar bis“ / „fällig“ ist nur eine Frist. */
const KW_ABBUCHUNG = /abgebucht|abbuchung|lastschrift|bankeinzug|eingezogen|\beinzug\b|belastet/i;
const KW_FRIST = /zahlbar|f[äa]llig|\bbis\b/i;

export function findeAbbuchung(Z: readonly string[], heute: string): string | null {
  const g = grenzen(heute);
  for (const z of Z) {
    if (!KW_ABBUCHUNG.test(z) || KW_FRIST.test(z)) continue;
    const d = datenIn(z, g)[0];
    if (d) return d.d;
  }
  return null;
}

/* ================= Rechnungs- bzw. Bonnummer ================= */

const NR_LABEL: readonly [RegExp, number][] = [
  [/rechnungs?\s*-?\s*(?:nummer|nr|no)\b\.?|rechnung\s+(?:nr|no|nummer)\b\.?|\bre\.?\s?-?\s?nr\b\.?|invoice\s*(?:no\b\.?|number|nr\b\.?|#|id\b)/i, 10],
  [
    /beleg\s*-?\s*(?:nummer|nr\b\.?)|\bbon\s*-?\s*(?:nummer|nr\b\.?)|\bbon\b(?=\s*[#:]?\s*\d)|quittungs?\s*-?\s*(?:nummer|nr\b\.?)|kassenbon\s*-?\s*nr\b\.?|receipt\s*(?:no\b\.?|number|#)|transaktions?\s*-?\s*(?:nummer|nr\b\.?)|vorgangs?\s*-?\s*(?:nummer|nr\b\.?)/i,
    7,
  ],
  [/^rechnung\s+(?=[a-z]{0,5}-?\d)/i, 5],
  [/bestell\s*-?\s*(?:nummer|nr\b\.?)|auftrags?\s*-?\s*(?:nummer|nr\b\.?)|order\s*(?:no\b\.?|number|#|id\b)/i, 3],
];

function nrToken(t: string | undefined): string | null {
  const roh = (t ?? '').trim();
  if (/^\d{1,3}(?:\.\d{3})*,\d{2}(?!\d)/.test(roh)) return null; // „12,50“ ist ein Betrag
  const m = /^#?\s?([A-Za-z0-9][A-Za-z0-9\-/._]*)/.exec(roh);
  if (!m) return null;
  const v = m[1].replace(/[.,;:/-]+$/, '');
  if (!/\d/.test(v) || v.length < 2 || v.length > 32) return null;
  // Betrag oder Datum ist keine Nummer
  if (
    /^\d+[,.]\d{2}$/.test(v) ||
    DATUM_MUSTER.some(([re]) => {
      re.lastIndex = 0;
      const treffer = re.test(v);
      re.lastIndex = 0;
      return treffer;
    })
  )
    return null;
  return v;
}

/** Wert zur Beschriftung: dahinter, sonst in der Zeile darunter (gleiche Spalte). */
function nrWert(Z: readonly string[], i: number, m: RegExpExecArray): string | null {
  const z = Z[i];
  let rest = z.slice(m.index + m[0].length).replace(/^\s?[:#.]?/, '');
  rest = rest.replace(/^\s*\/\s*[A-Za-z][A-Za-z .]*?(?:no|number|nr|nummer)\b\.?\s?[:#]?/i, ''); // „/ Invoice Number:“
  const direkt = nrToken(rest.trim().split(/\s{2,}/)[0]);
  if (direkt) return direkt;
  if (i + 1 >= Z.length) return null;
  const k = segmente(z);
  const w = segmente(Z[i + 1]);
  const j = k.findIndex((s) => m.index >= s.a && m.index < s.b);
  if (k.length > 1 && j >= 0 && k.length === w.length) return nrToken(w[j].t);
  if (k.length === 1) return nrToken(w[0]?.t);
  if (j === k.length - 1 && w.length) return nrToken(w[w.length - 1].t);
  return null;
}

/** Nummer zur stärksten Beschriftung (Rechnungs-Nr. vor Beleg-/Bon-Nr. vor Bestell-Nr.), bei gleicher die erste. */
export function findeNummer(Z: readonly string[]): { w: string; s: Sicherheit } | null {
  let best: { w: string; p: number } | null = null;
  for (let i = 0; i < Z.length; i++) {
    for (const [re, p] of NR_LABEL) {
      if (best && best.p >= p) continue;
      const m = re.exec(Z[i]);
      const w = m ? nrWert(Z, i, m) : null;
      if (w) best = { w, p };
    }
  }
  return best ? { w: best.w, s: best.p >= 7 ? 'hoch' : 'mittel' } : null;
}

/* ================= Eigene Firma ================= */

/** Eigene Angaben (klein geschrieben), die auf fremden Belegen als Empfänger stehen. */
function eigenTeile(F: Firma | null): string[] {
  if (!F) return [];
  return [F.name, F.inhaber, F.strasse, F.email, F.web, F.telefon, F.plz && F.ort ? `${F.plz} ${F.ort}` : '', F.steuernummer, F.ust_idnr]
    .map((x) => x.trim())
    .filter((x) => x.length >= 4)
    .map((x) => x.toLowerCase());
}

/** Gehört ein Segment zu uns (Name, Anschrift …)? */
function eigenFilter(F: Firma | null): (s: string) => boolean {
  const teile = eigenTeile(F);
  return (s) => {
    const t = s.toLowerCase().trim();
    return !!t && teile.some((p) => t.includes(p) || (t.length >= 6 && p.includes(t)));
  };
}

const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Steuernummer im Text? Trennzeichen (Leerzeichen, /, -, .) zählen gleich; ohne Trennzeichen nur genau so –
 *  sonst passte „12/345/67890“ auf jede Kundennummer „1234567890“. */
function hatSteuernummer(t: string, nr: string): boolean {
  const gruppen = nr.trim().split(/[\s/.-]+/).filter(Boolean);
  if (gruppen.join('').replace(/\D/g, '').length < 10 || gruppen.some((x) => !/^\d+$/.test(x))) return false;
  return new RegExp(`(?<![\\dA-Za-z])${gruppen.map(escRe).join('[\\s/.-]+')}(?!\\d)`).test(t);
}

/** Zeilen mit der eigenen IBAN als Lastschrift-Konto (fremde Rechnung, die von uns abbucht) zählen nicht. */
const RE_LASTSCHRIFT_KONTO = /lastschrift|abbuch|abgebucht|einzug|eingezogen|mandat|ihre?m?\s+konto/i;

/** Stammt der Beleg von uns (eigene Rechnung/Quittung ⇒ Einnahme)? */
function eigenerBeleg(Z: readonly string[], F: Firma | null): Sicherheit | null {
  const name = F?.name.trim().toLowerCase() ?? '';
  if (!F || !name) return null;
  const t = Z.join('\n');
  let p = 0;
  if (F.steuernummer && hatSteuernummer(t, F.steuernummer)) p += 3;
  const kompakt = (s: string) => s.replace(/\s+/g, '').toUpperCase();
  const ust = kompakt(F.ust_idnr);
  if (ust.length >= 8 && kompakt(t).includes(ust)) p += 3;
  const iban = kompakt(F.iban);
  if (iban.length >= 15) {
    const zeilen = Z.map((z, i) => ({ z, i })).filter(({ z }) => kompakt(z).includes(iban));
    if (zeilen.length && !zeilen.some(({ z, i }) => RE_LASTSCHRIFT_KONTO.test(z) || RE_LASTSCHRIFT_KONTO.test(Z[i - 1] ?? ''))) p += 3;
  }
  if (Z.slice(0, 3).some((z) => z.toLowerCase().startsWith(name))) p += 2; // Briefkopf
  if (p && t.toLowerCase().includes(name) && /§\s*19\s*UStG|kleinunternehmer/i.test(t)) p += 1;
  return p >= 5 ? 'hoch' : p >= 3 ? 'mittel' : null;
}

/* ================= Geschäft ================= */

/** Kurzform ohne Rechtsform und Länderzusätze: „Telekom Deutschland GmbH“ ⇒ „Telekom“. */
export function kurzName(n: string): string {
  return (
    n
      .replace(/\(.*?\)/g, ' ')
      .replace(
        /\b(?:GmbH(?:\s?&\s?Co\.?\s?KG)?|AG|UG|KG|OHG|GbR|e\.\s?K\.?|e\.\s?V\.?|Ltd\.?|Inc\.?|LLC|SE|UC|mbH|Systems|Deutschland|Germany|Ireland|Europe|Software|Services)(?=$|[\s,.])/gi,
        ' ',
      )
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/[,·&-]+$/, '')
      .trim() || n
  );
}

/** Gattungswörter zählen beim Abgleich nicht („Aral Tankstelle“ wird über „Aral“ gefunden). */
const GATTUNG = /^(?:tankstelle|station|baumarkt|markt|gartencenter|filiale|versicherung|werkstatt|deutschland|druckerei|musterstadt|und|der|die|das|von|fuer|the|and)$/;

/** Bekanntes Geschäft im Belegkopf: markante Wörter des Namens oben ⇒ 3, weiter unten ⇒ 2, irgendwo ⇒ 1 (Mittel ≥ 1). */
function findeGeschaeft(Z: readonly string[], liste: readonly Geschaeft[]): { g: Geschaeft; s: number } | null {
  if (!liste.length || !Z.length) return null;
  const kopf = Z.slice(0, 15).map((z) => ` ${norm(z)} `);
  const alle = ` ${norm(Z.join(' '))} `;
  let best: { g: Geschaeft; s: number } | null = null;
  for (const g of liste) {
    const tok = norm(kurzName(g.name))
      .split(' ')
      .filter((w) => w.length >= 3 && !GATTUNG.test(w));
    if (!tok.length) continue;
    let p = 0;
    for (const w of tok) {
      const i = kopf.findIndex((z) => z.includes(` ${w} `));
      p += i >= 0 ? (i < 6 ? 3 : 2) : alle.includes(` ${w} `) ? 1 : 0;
    }
    p /= tok.length;
    if (p >= 1 && (!best || p > best.s)) best = { g, s: p };
  }
  return best;
}

const RE_RECHTSFORM =
  /(?:^|[\s,])(?:GmbH(?:\s?&\s?Co\.?\s?KG)?|AG|UG(?:\s?\(haftungsbeschränkt\))?|KG|OHG|GbR|e\.\s?K\.?|e\.\s?Kfm\.?|e\.\s?Kfr\.?|e\.\s?V\.?|Ltd\.?|Limited|Inc\.?|LLC|SE|UC|B\.V\.|mbH|PartG)(?=$|[\s,.·|)])/;
/** Kopfzeilen, die kein Geschäftsname sind. Kurze Wörter nur ganz – „Tel.“ ja, „Telekom“ nein. */
const RE_KEIN_NAME =
  /^(?:rechnung|invoice|quittung|kassenbon|kassenbeleg|beleg|bon\b|lieferschein|gutschrift|angebot|seite\b|page\b|datum|date\b|tel(?:efon)?\b|fax\b|e-?mail|www\.|http|kunde|bill\s*to|an:|z\.?\s?hd|herrn?\b|frau\b|firma\b|betreff|steuer|st\.?-?nr|ust\b|iban\b|bic\b|filiale|inh\.?|vielen|danke|sehr\s+geehrte)/i;

/** Geschäft raten (kein bekanntes): Zeile mit Rechtsform, sonst die erste namensartige Kopfzeile. */
function lieferantRaten(Z: readonly string[], eigen: (s: string) => boolean): { name: string; s: Sicherheit } | null {
  const segs: string[] = [];
  for (const z of Z.slice(0, 15)) {
    for (const roh of z.split(/\s{2,}|\s[·|•]\s/)) {
      const t = roh.trim();
      if (t && !eigen(t)) segs.push(t);
    }
  }
  const sauber = (roh: string): string => {
    const t = roh
      .split(/\s[·|•]\s|,\s/)[0]
      .replace(/^(?:inh\.?|inhaber(?:in)?:?)\s+/i, '')
      .trim()
      .slice(0, 60);
    // „BAUHAUS“ ⇒ „Bauhaus“
    return t === t.toUpperCase() && buchstaben(t) > 3 ? t.toLowerCase().replace(/(^|[\s-])(\S)/g, (_m: string, a: string, b: string) => a + b.toUpperCase()) : t;
  };
  const i = segs.findIndex((t) => RE_RECHTSFORM.test(t) && !RE_KEIN_NAME.test(t));
  if (i >= 0) {
    // umbrochene Überschrift: „Gartencenter Blütenreich“ ↵ „GmbH“
    const allein = buchstaben(segs[i].replace(RE_RECHTSFORM, ' ')) < 3;
    return { name: sauber(allein && i > 0 ? `${segs[i - 1]} ${segs[i]}` : segs[i]), s: 'mittel' };
  }
  const name = segs.find(
    (t) =>
      buchstaben(t) >= 3 &&
      t.length <= 50 &&
      (t.match(/\d/g) ?? []).length <= t.length * 0.2 &&
      !RE_KEIN_NAME.test(t) &&
      !/@|www\.|https?:/.test(t) &&
      !/\d+\s*[a-z]?$/i.test(t) &&
      !/^\d{4,5}\s/.test(t) &&
      !KW_TOTAL.test(t) &&
      !KW_SUMME.test(t) &&
      !/:/.test(t),
  );
  return name ? { name: sauber(name), s: 'niedrig' } : null;
}

/* ================= Kategorie ================= */

/** Interne Wortliste (Rückfall bzw. Stichentscheid): Thema ⇒ Muster. */
const KAT_AUS: readonly [string, RegExp][] = [
  [
    'material',
    /(?:blumen|pflanz|garten|kompost|rasen)erde|d[üu]nger|saatgut|samen\b|rindenmulch|holz|leim|schraube|beschl[äa]g|\black|lasur|beize|wachs(?!tum)|öl\b|oel\b|d[üu]bel|scharnier|eiche|esche\b|buche\b|nussbaum|kiefer|fichte|l[äa]rche|multiplex|sperrholz|spanplatte|\bmdf\b|bohle|schleifpapier|schleifmittel|furnier|kantenumleimer|n[äa]gel\b|schnittholz|plattenwerkstoff|zuschnitt/g,
  ],
  ['werkzeug', /werkzeug|schleifer\b|bohrer\b|bohrmaschine|akku|s[äa]ge(?!werk|rau)|fr[äa]se|hobel|zwinge|stechbeitel|schraubendreher|bit-?set|maschine|wasserwaage|zollstock|exzenter/g],
  ['software', /adobe|software|lizenz|\babo\b|abonnement|subscription|cloud|domain|hosting|webspace|microsoft|office\s?365|google workspace|saas|shopify|canva|lexoffice|sevdesk|ionos|strato/g],
  ['telefon', /telekom|vodafone|\bo2\b|1&1|congstar|mobilfunk|festnetz|\bdsl\b|glasfaser|telefonie|internet(?!\s*:)|handyvertrag|magenta/g],
  ['buero', /\bdhl\b|hermes|\bdpd\b|\bgls\b|\bups\b|deutsche post|porto|briefmarke|paketmarke|b[üu]ro|druckerpatrone|toner|(?<!schleif)papier|ordner/g],
  ['bewirtung', /restaurant|bewirtung|caf[eé](?![a-zäöü])|gastst[äa]tte|gasthaus|gasthof|bistro|pizzeria|trattoria|imbiss|trinkgeld|speisen|getr[äa]nke|bedienung(?!s)/g],
  ['versicherung', /versicherung|haftpflicht|police|versicherungsschein/g],
  ['gebuehren', /standgeb[üu]hr|standgeld|marktgeb[üu]hr|geb[üu]hr|etsy|paypal|sumup|kontof[üu]hrung|provision|ebay|kammerbeitrag|\bihk\b|\bhwk\b|handwerkskammer|rundfunkbeitrag/g],
  ['fahrt', /tankstelle|\baral\b|\bshell\b|\besso\b|deutsche bahn|\bdb\b|bahncard|fahrkarte|parkhaus|parkschein|parkgeb|\bparken\b|benzin|diesel|kraftstoff|\d\s?km\b|\bmaut\b|\btaxi\b/g],
  ['fortbildung', /seminar|\bkurs(?:e|es)?\b|kursgeb|schulung|workshop|weiterbildung|fortbildung|lehrgang|webinar|fachbuch/g],
  ['werbung', /werbung|flyer|visitenkarte|druckerei|plakat|banner|anzeige|instagram|google ads|facebook|inserat|werbemittel|vistaprint|flyeralarm|marketing/g],
  ['raum', /miete\b|mietzins|\bpacht\b|nebenkosten/g],
];
const KAT_EIN: readonly [string, RegExp][] = [
  ['markt', /quittung|barverkauf|marktverkauf|\bmarkt\b/g],
  ['shop', /etsy|online-?shop|\bshop\b|bestellung/g],
  ['auftrag', /rechnung|auftrag|leistung/g],
];

/** Treffer je internem Thema, häufigstes zuerst. */
function katWoerter(text: string, typ: BuchungTyp): [string, number][] {
  const t = text.toLowerCase();
  const out: [string, number][] = [];
  for (const [kat, re] of typ === 'einnahme' ? KAT_EIN : KAT_AUS) {
    const n = Math.min(6, (t.match(re) ?? []).length);
    if (n) out.push([kat, n]);
  }
  return out.sort((a, b) => b[1] - a[1]);
}

const stichworte = (k: Pick<ErkennungKategorie, 'stichworte'>): string[] =>
  (k.stichworte ?? '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

/** Internes Thema auf eine vorhandene Kategorie abbilden (nie eine erfundene id). `kat` ist schon nach Typ gefiltert. */
function abbilden(thema: string, typ: BuchungTyp, kat: readonly ErkennungKategorie[]): number | null {
  if (!kat.length) return null;
  if (typ === 'einnahme') return (kat.find((k) => k.zaehlt_ku_umsatz) ?? kat[0]).id;
  // eigene Kategorie mit passendem Namen („Telefon & Internet“, „Bewirtung (70 %)“)
  const benannt = thema ? kat.find((k) => norm(k.name).split(' ').some((w) => w.startsWith(thema))) : undefined;
  if (benannt) return benannt.id;
  if (thema === 'material') {
    const w = kat.find((k) => k.wareneingang);
    if (w) return w.id;
  }
  if (thema === 'fahrt') {
    const f = kat.find((k) => stichworte(k).includes('tankstelle'));
    if (f) return f.id;
  }
  const sonst = kat.find((k) => /^sonst/.test(norm(k.name)));
  return sonst ? sonst.id : null;
}

/** Stichwort-Treffer: kurze Wörter (Marken wie „aral“, „obi“) nur ganz, längere auch als Wortanfang/-ende („Rasendünger“). */
const reCache = new Map<string, RegExp>();
function stichwortRe(w: string): RegExp {
  let re = reCache.get(w);
  if (!re) {
    const e = escRe(w).replace(/\s+/g, '\\s*');
    re = w.length <= 4 ? new RegExp(`(?<![a-zäöüß0-9])${e}(?![a-zäöüß0-9])`, 'g') : new RegExp(`(?<![a-zäöüß])${e}|${e}(?![a-zäöüß])`, 'g');
    reCache.set(w, re);
  }
  return re;
}

/** Bank-, Zahlungs- und Registerzeilen sowie Summen-„Total“ tragen nichts zur Kategorie bei. */
const stichwortText = (t: string): string =>
  t
    .toLowerCase()
    .split('\n')
    .filter((z) => !/iban|\bbic\b|bankverbindung|konto\s*(?:nr|nummer|inhaber)|abgebucht|lastschrift|überweis|amtsgericht|ust-?id|steuer-?n(?:r|ummer)|st\.?-?nr|geschäftsführ/.test(z))
    .join('\n')
    .replace(/\b(?:sub-?)?total\b/g, ' ');

/** Text ⇒ Kategorie über die Stichworte der Kategorien; interne Liste nur als Rückfall bzw. Stichentscheid. */
function katAusText(text: string, typ: BuchungTyp, kat: readonly ErkennungKategorie[]): { id: number; n: number; q: 'stichwort' | 'intern' } | null {
  const t = stichwortText(text);
  const p = new Map<number, number>();
  for (const k of kat) {
    for (const w of stichworte(k)) {
      const n = Math.min(3, (t.match(stichwortRe(w)) ?? []).length);
      if (n) p.set(k.id, (p.get(k.id) ?? 0) + n);
    }
  }
  const intern = new Map<number, number>();
  for (const [th, n] of katWoerter(t, typ)) {
    const id = abbilden(th, typ, kat);
    if (id != null) intern.set(id, (intern.get(id) ?? 0) + n);
  }
  const reihe = (o: Map<number, number>): number[] => [...o.keys()].sort((a, b) => (o.get(b) ?? 0) - (o.get(a) ?? 0) || (intern.get(b) ?? 0) - (intern.get(a) ?? 0));
  const sw = reihe(p)[0];
  if (sw != null) return { id: sw, n: p.get(sw) ?? 0, q: 'stichwort' };
  const iw = reihe(intern)[0];
  return iw != null ? { id: iw, n: intern.get(iw) ?? 0, q: 'intern' } : null;
}

/** Kategorie: 1. Historie des Geschäfts, 2. Stichworte der Kategorien, 3. interne Wortliste (PDF-Text vor Dateiname). */
function katVorschlag(
  lieferant: string | undefined,
  typ: BuchungTyp,
  texte: readonly [string, Quelle][],
  ctx: ErkennungKontext,
): { id: number; q: Quelle | 'historie'; s: Sicherheit } | null {
  const kat = ctx.kategorien.filter((k) => k.typ === typ);
  if (!kat.length) return null;
  if (typ === 'ausgabe' && lieferant) {
    const g = geschaeftZu(lieferant, ctx.geschaefte);
    if (g && g.kategorie_id != null && kat.some((k) => k.id === g.kategorie_id)) return { id: g.kategorie_id, q: 'historie', s: g.anzahl >= 2 ? 'hoch' : 'mittel' };
  }
  for (const [t, q] of texte) {
    const w = katAusText(t, typ, kat);
    if (w) return { id: w.id, q, s: w.n >= 3 || (w.q === 'stichwort' && w.n >= 2) ? 'mittel' : 'niedrig' };
  }
  // Einnahme ohne Hinweise: Kleinunternehmer- bzw. erste Einnahmekategorie
  const e = typ === 'einnahme' ? abbilden('', typ, kat) : null;
  return e != null ? { id: e, q: texte[0]?.[1] ?? 'pdf', s: 'niedrig' } : null;
}

/** Internes Hauptthema (für die Beschreibung, z. B. Bewirtung). */
const thema = (text: string): string | null => katWoerter(stichwortText(text), 'ausgabe')[0]?.[0] ?? null;

/* ================= Positionen & Beschreibung ================= */

const RE_KOPFWORT = /\b(?:pos|artikel|menge|preis|beschreibung|bezeichnung|anzahl|einheit|produkt|product|qty)\b/i;
/** Echtes Wort (≥ 3 Buchstaben, ohne Währung) – „x 1,866 EUR/l“ und „Säule 4“ zählen nicht. */
const hatBezeichnung = (s: string): boolean =>
  /[a-zäöüß]{3,}/i.test(s.replace(/\b(?:eur|euro)\b/gi, '')) && !/^(?:zapf)?s[äa]ule\b|^kasse\b|^tisch\b/i.test(s);

function kurzPosition(segs: readonly string[]): string {
  let t = segs.find(hatBezeichnung) ?? '';
  t = t.replace(/^\d{1,3}[.)]?\s+(?=\D)/, '').replace(/^\d+(?:[.,]\d+)?\s*(?:x|×|stk\.?|st\.?)\s+/i, '');
  t = t.split(/\s[/(]|,|\s-\s/)[0];
  const r: string[] = [];
  for (const w of t.split(/\s+/)) {
    // „Super E10“, „Schleifpapier K120“ – sonst endet die Bezeichnung an der ersten Zahl
    if (r.length >= 3 || (/\d/.test(w) && !(r.length && /^[A-Za-z]\d{1,3}$/.test(w)))) break;
    r.push(w);
  }
  // nicht mit „und“, „mit“ … enden („Rasen mähen und“ ⇒ „Rasen mähen“)
  while (r.length > 1 && /^(?:und|mit|für|fuer|der|die|das|von|im|in|&|\+|-)$/i.test(r[r.length - 1])) r.pop();
  return r.join(' ').slice(0, 32).trim();
}

/** Bis zu drei Positionen (Bezeichnung links vom ersten Betrag einer Zeile bzw. in der Zeile darüber). */
function positionen(Z: readonly string[], eigen: (s: string) => boolean, g: Grenzen): string[] {
  const out: string[] = [];
  for (let i = 0; i < Z.length && out.length < 3; i++) {
    const z = Z[i];
    const geld = geldIn(z);
    if (!geld.length) continue;
    let segs = z
      .slice(0, geld[0].idx)
      .split(/\s{2,}/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!segs.some(hatBezeichnung)) {
      const p = vorzeile(Z, i, g);
      if (!p) continue;
      segs = p.split(/\s{2,}/);
    }
    const l = segs.join('  ');
    if (/:/.test(l) || KW_TOTAL.test(l) || KW_SUMME.test(l) || KW_NICHT.test(l) || RE_KOPFWORT.test(l) || eigen(l)) continue;
    const n = kurzPosition(segs);
    if (n && buchstaben(n) >= 3 && !out.includes(n)) out.push(n);
  }
  return out;
}

function buchungstext(typ: BuchungTyp, lieferant: string | undefined, nr: string | undefined, liste: readonly string[], betreff: string | null, th: string | null): string | null {
  const kurz = lieferant ? kurzName(lieferant) : '';
  const pos = liste.filter((p) => p.toLowerCase() !== kurz.toLowerCase());
  let t: string;
  if (typ === 'einnahme') {
    const art = /^qu-/i.test(nr ?? '') ? 'Quittung' : 'Rechnung';
    t = [nr ? `${art} ${nr}` : art, betreff || pos[0] || kurz].filter(Boolean).join(' · ');
  } else if (th === 'bewirtung' && kurz) t = `Bewirtung · ${kurz}`;
  else if (kurz && pos.length) t = `${kurz} · ${pos.slice(0, 2).join(', ')}`;
  else if (kurz && nr) t = `Rechnung ${nr} · ${kurz}`;
  else t = kurz || pos.slice(0, 2).join(', ');
  return t ? t.slice(0, 80) : null;
}

/* ================= Quelle 1: Text des Belegs ================= */

function setzeIn<K extends ErkanntesFeld>(teil: Teil, k: K, v: ErkannteFelder[K], s: Sicherheit): void {
  if (v === undefined) return;
  teil.felder[k] = v;
  teil.sicherheit[k] = s;
}

function ausText(Z: readonly string[], ctx: ErkennungKontext): Teil {
  const teil = leererTeil();
  if (!Z.length) return teil;
  const g = grenzen(ctx.heute);
  const eigen = eigenFilter(ctx.firma);
  const e = eigenerBeleg(Z, ctx.firma);
  if (e) setzeIn(teil, 'typ', 'einnahme', e);
  const b = findeBetrag(Z, ctx.heute);
  if (b) setzeIn(teil, 'betrag_cent', b.c, b.s);
  const d = findeDatum(Z, ctx.heute);
  if (d) setzeIn(teil, 'zahlungsdatum', d.d, d.s);
  // Lastschrift: Abbuchungstag wird Zahlungsdatum, das Rechnungsdatum bleibt als Belegdatum erhalten
  const ab = findeAbbuchung(Z, ctx.heute);
  if (ab && ab !== teil.felder.zahlungsdatum) {
    setzeIn(teil, 'belegdatum', teil.felder.zahlungsdatum, teil.sicherheit.zahlungsdatum ?? 'mittel');
    setzeIn(teil, 'zahlungsdatum', ab, 'mittel');
  }
  const n = findeNummer(Z);
  if (n) setzeIn(teil, 'belegnummer', n.w, n.s);
  // Geschäft nur bei Ausgaben: bekanntes zuerst, sonst geraten
  if (!e) {
    const gs = findeGeschaeft(Z, ctx.geschaefte);
    const l = gs ? null : lieferantRaten(Z, eigen);
    if (gs) setzeIn(teil, 'lieferant', gs.g.name, gs.s >= 2 ? 'hoch' : 'mittel');
    else if (l) setzeIn(teil, 'lieferant', l.name, l.s);
  }
  // Text für die Kategorie ohne eigene Firmendaten
  let kt = Z.join('\n').toLowerCase();
  for (const p of eigenTeile(ctx.firma)) kt = kt.split(p).join(' ');
  teil.katText = kt;
  teil.pos = positionen(Z, eigen, g);
  teil.thema = thema(kt);
  const bz = Z.map((z) => /^(?:betreff|betrifft|betr\.|subject)\s*:?\s*(.+)/i.exec(z)).find((m): m is RegExpExecArray => m !== null);
  teil.betreff = bz ? bz[1].split(/\s{2,}/)[0].trim() : null;
  return teil;
}

/* ================= Quelle 2: Dateiname ================= */

const NAME_STOP = new Set([
  'rechnung', 'rechnungen', 'rechnungsnr', 'nr', 'beleg', 'belege', 'quittung', 'kassenbon', 'bon', 'invoice', 'receipt', 'scan',
  'scanned', 'img', 'image', 'dsc', 'dcim', 'foto', 'photo', 'bild', 'pdf', 'eur', 'euro', 'kopie', 'copy', 'datum', 'betrag',
  'document', 'dokument', 'datei', 'whatsapp', 'screenshot', 'bildschirmfoto', 'und', 'vom', 'fuer', 'für', 'von', 'the', 'final',
  'neu', 'new', 'signed', 'original', 'gutschrift', 'lieferschein', 'auftrag', 'bestellung', 'order', 'brutto', 'netto', 'mwst', 'ust',
  'tankquittung', 'tankbeleg',
]);

const DATUM_NAME: readonly [RegExp, (m: RegExpExecArray) => [Roh, Roh, Roh]][] = [
  [/(?<!\d)(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})(?!\d)/, (m) => [m[1], m[2], m[3]]],
  [/(?<!\d)(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2}|\d{2})(?!\d)/, (m) => [m[3], m[2], m[1]]],
  [/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/, (m) => [m[1], m[2], m[3]]],
];

/** Werte aus dem Dateinamen, z. B. „2026-09-14_Bauhaus_47,83.pdf“ oder „Rechnung_RE-2026-012.pdf“. */
function ausName(name: string, ctx: ErkennungKontext): Teil {
  const teil = leererTeil();
  const basis = name
    .replace(/^.*[\\/]/, '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .normalize('NFC')
    .trim();
  if (!basis) return teil;
  const g = grenzen(ctx.heute);
  let rest = ` ${basis.replace(/\+/g, ' ')} `;
  const raus = (m: RegExpExecArray): void => {
    rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`;
  };
  for (const [re, f] of DATUM_NAME) {
    const m = re.exec(rest);
    const t = m ? f(m) : null;
    const d = t ? mkDatum(t[0], t[1], t[2], g) : null;
    if (m && d) {
      setzeIn(teil, 'zahlungsdatum', d, 'mittel');
      raus(m);
      break;
    }
  }
  let m = /(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d+)[,.](\d{2})(?!\d)(\s?(?:€|eur|euro)(?![a-z]))?/i.exec(rest);
  if (m) {
    setzeIn(teil, 'betrag_cent', Number(m[1].replace(/\./g, '')) * 100 + Number(m[2]), m[3] ? 'mittel' : 'niedrig');
    raus(m);
  } else {
    m = /(?<![\d.,])(\d{1,6})\s?(?:€|eur|euro)(?![a-z])/i.exec(rest);
    if (m) {
      setzeIn(teil, 'betrag_cent', Number(m[1]) * 100, 'mittel');
      raus(m);
    }
  }
  m =
    /(?:^|[\s_])((?:RE|RG|RN|INV|AR|QU|BN)[-_.]?\d[A-Za-z0-9-]*|R-\d[A-Za-z0-9-]*)(?=[\s_]|$)/i.exec(rest) ??
    /(?:rechnungs?-?nr|rechnungsnummer|rechnung|invoice|beleg|nr\.?)[\s_.:#-]+(?:nr\.?[\s_.:#-]*)?([A-Za-z]{0,4}-?\d[A-Za-z0-9-]*)/i.exec(rest);
  if (m && /\d/.test(m[1]) && m[1].length >= 3) setzeIn(teil, 'belegnummer', m[1], 'mittel');
  // Geschäft: bekanntes; sonst Wörter des Namens, aber nur wenn er auch sonst etwas hergab
  const worte = rest.replace(/_+/g, ' ');
  teil.katText = worte.toLowerCase();
  const gs = findeGeschaeft([worte], ctx.geschaefte);
  if (gs) setzeIn(teil, 'lieferant', gs.g.name, 'mittel');
  else if (teil.felder.zahlungsdatum || teil.felder.betrag_cent != null || teil.felder.belegnummer) {
    const w = worte
      .split(/\s+/)
      .filter((x) => /^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß&.-]{2,}$/.test(x) && !NAME_STOP.has(x.toLowerCase()) && MONAT[x.toLowerCase()] == null)
      .slice(0, 2);
    if (w.length) setzeIn(teil, 'lieferant', w.map((x) => x[0].toUpperCase() + x.slice(1)).join(' '), 'niedrig');
  }
  return teil;
}

/* ================= Zusammenführen ================= */

const HAUPTFELDER: readonly ErkanntesFeld[] = ['betrag_cent', 'zahlungsdatum', 'lieferant', 'belegnummer'];
const hatEtwas = (X: Teil | null): boolean => !!X && HAUPTFELDER.some((k) => X.felder[k] !== undefined);

/** „Erkannt: 47,83 € · 14.09.2026 · Bauhaus · Produkte & Material“ – leer, wenn nichts davon erkannt wurde. */
export function zusammenfassung(f: ErkannteFelder, kategorien: readonly Pick<ErkennungKategorie, 'id' | 'name'>[]): string {
  const teile = [
    f.betrag_cent != null ? formatBetrag(f.betrag_cent) : '',
    f.zahlungsdatum ? datumKurz(f.zahlungsdatum) : '',
    f.lieferant ?? '',
    f.kategorie_id != null ? (kategorien.find((k) => k.id === f.kategorie_id)?.name ?? '') : '',
  ].filter(Boolean);
  return teile.length ? `Erkannt: ${teile.join(' · ')}` : '';
}

export interface ErkennenEingabe {
  /** Text des Belegs (Zeilen mit \n), null bei Bildern oder unlesbaren PDFs */
  text: string | null;
  /** Originalname der Datei */
  dateiname: string;
  kontext: ErkennungKontext;
  /** Hinweise aus dem Lesen (z. B. „PDF ist passwortgeschützt …“) */
  hinweise?: readonly string[];
}

/** PDF-Text und Dateiname auswerten und zusammenführen: Text gewinnt, der Dateiname füllt Lücken. Wirft nie. */
export function erkenne(eingabe: ErkennenEingabe): Erkennung {
  const hinweise = [...(eingabe.hinweise ?? [])];
  try {
    const ctx = eingabe.kontext;
    const Z = eingabe.text ? zeilenVon(eingabe.text) : [];
    const lesbar = buchstaben(Z.join('')) >= 12;
    if (eingabe.text !== null && !lesbar) hinweise.push('Im PDF steht kein lesbarer Text (Scan?) – nur der Dateiname wurde ausgewertet.');
    const A = lesbar ? ausText(Z, ctx) : null;
    const B = ausName(eingabe.dateiname, ctx);

    const felder: ErkannteFelder = {};
    const herkunft: Partial<Record<ErkanntesFeld, Quelle>> = {};
    const sicherheit: Partial<Record<ErkanntesFeld, Sicherheit>> = {};
    const von = <K extends ErkanntesFeld>(X: Teil | null, q: Quelle, k: K): boolean => {
      const v = X?.felder[k];
      if (!X || v === undefined) return false;
      felder[k] = v;
      herkunft[k] = q;
      sicherheit[k] = X.sicherheit[k] ?? 'mittel';
      return true;
    };

    // Typ: nur eigene Belege (aus dem PDF) werden zur Einnahme
    if (A?.felder.typ === 'einnahme') von(A, 'pdf', 'typ');
    const typ: BuchungTyp = felder.typ ?? 'ausgabe';
    // Text gewinnt, Dateiname füllt Lücken; Übereinstimmung erhöht die Sicherheit
    for (const k of ['betrag_cent', 'zahlungsdatum', 'belegnummer'] as const) {
      if (von(A, 'pdf', k)) {
        const a = A?.felder[k];
        const b = B.felder[k];
        if (b !== undefined && String(b).toLowerCase() === String(a).toLowerCase()) sicherheit[k] = 'hoch';
      } else von(B, 'dateiname', k);
    }
    if (herkunft.zahlungsdatum === 'pdf') von(A, 'pdf', 'belegdatum'); // Lastschrift (nur aus dem PDF-Text)
    if (typ === 'ausgabe' && !von(A, 'pdf', 'lieferant')) von(B, 'dateiname', 'lieferant');

    // Kategorie mit endgültigem Typ und Geschäft
    if (A || hatEtwas(B)) {
      const texte: [string, Quelle][] = A ? [[A.katText, 'pdf'], [B.katText, 'dateiname']] : [[B.katText, 'dateiname']];
      const kat = katVorschlag(felder.lieferant, typ, texte, ctx);
      if (kat) {
        felder.kategorie_id = kat.id;
        herkunft.kategorie_id = kat.q === 'historie' ? (herkunft.lieferant ?? 'pdf') : kat.q;
        sicherheit.kategorie_id = kat.s;
      }
      const text = buchungstext(typ, felder.lieferant, felder.belegnummer, A?.pos ?? [], A?.betreff ?? null, A?.thema ?? null);
      if (text) {
        felder.beschreibung = text;
        herkunft.beschreibung = A ? 'pdf' : 'dateiname';
        sicherheit.beschreibung = A ? 'mittel' : 'niedrig';
      }
    }

    const quelle: Erkennung['quelle'] = hatEtwas(A) ? 'pdf' : hatEtwas(B) ? 'dateiname' : 'keine';
    if (felder.belegdatum && felder.zahlungsdatum)
      hinweise.push(`Lastschrift: Rechnungsdatum ${datumKurz(felder.belegdatum)} · abgebucht am ${datumKurz(felder.zahlungsdatum)} – als Zahlungsdatum zählt die Abbuchung (§ 11 EStG).`);
    const ap = A?.felder.betrag_cent;
    const bp = B.felder.betrag_cent;
    if (ap !== undefined && bp !== undefined && ap !== bp) hinweise.push(`Betrag im Dateinamen (${formatBetrag(bp)}) weicht vom PDF (${formatBetrag(ap)}) ab – bitte prüfen.`);
    if (felder.typ === 'einnahme') hinweise.push('Eigener Beleg erkannt (eigene Steuernummer bzw. Briefkopf) – als Einnahme vorgeschlagen.');
    if (quelle !== 'keine' && felder.betrag_cent === undefined) hinweise.push('Kein Betrag erkannt – bitte eintragen.');
    return { felder, herkunft, sicherheit, quelle, hinweise, zusammenfassung: zusammenfassung(felder, ctx.kategorien) };
  } catch {
    hinweise.push('Der Beleg konnte nicht ausgewertet werden – bitte die Felder selbst ausfüllen.');
    return { felder: {}, herkunft: {}, sicherheit: {}, quelle: 'keine', hinweise, zusammenfassung: '' };
  }
}
