/* Kunden (ANLEITUNG §6.8, §2.10): reine Logik für Liste und Schublade, mit Vitest getestet (kunden.test.ts).
 * Daten kommen aus lib/queries/kunden.ts (je eine Abfrage für alle Kunden und den ganzen Verlauf, kein N+1).
 *
 * Besuch = jede Quittung oder Rechnung bis heute (ohne Storno-Belege, stornierte und Entwürfe) sowie jede Einnahme mit
 * Kunde ohne eigenen Beleg (ohne Gegenbuchungen und stornierte). Datum eines Besuchs = Leistungsdatum, sonst Belegdatum
 * bzw. Zahlungsdatum. Angebote und Termine stehen im Verlauf, zählen aber nie als Besuch. Ein für einen Termin
 * vorbereiteter Beleg (Entwurf mit termin_id, Termin noch nicht erledigt) hängt am Termin statt als eigener Eintrag;
 * erledigte Termine, die schon über einen Beleg oder eine Einnahme im Verlauf stehen, erscheinen nicht doppelt.
 * Keine Statistik in der Liste: Umsatz steht nur dezent je Zeile (wie im Prototyp), keine Summen, keine Kacheln. */
import type { Zahlungsart } from './buchungen';
import { anzahlText, datumKurz, nameSchluessel } from './buchungen';
import { summe } from './money';
import { normalize } from './suche';

/* ================= Zeilen aus der Datenbank ================= */

export interface KundeZeile {
  id: number;
  nummer: string;
  name: string;
  zusatz: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  email: string | null;
  telefon: string | null;
  notiz: string | null;
  /** ISO-Zeitstempel (UTC) */
  erstellt_am: string;
  /** 1, wenn Buchungen, Belege (auch Entwürfe), Termine oder Fahrten am Kunden hängen ⇒ nicht löschbar */
  gebunden: number;
  /** jüngstes Zahlungsdatum einer Buchung bzw. Datum eines ausgestellten Belegs (Aufbewahrungsfrist), sonst null */
  frist_datum: string | null;
}

export type VerlaufQuelle = 'beleg' | 'einnahme' | 'termin';
export type VerlaufArt = 'rechnung' | 'quittung' | 'angebot' | 'einnahme' | 'termin';

/** Ein Eintrag im Verlauf, wie ihn ladeVerlauf() liefert (drei Quellen, eine Form). */
export interface VerlaufZeile {
  quelle: VerlaufQuelle;
  /** ID in rechnungen, buchungen bzw. termine */
  id: number;
  kunde_id: number;
  art: VerlaufArt;
  /** Leistungsdatum, sonst Beleg- bzw. Zahlungsdatum; bei Terminen der Termintag */
  datum: string;
  /** Termine: 'HH:MM' */
  von: string | null;
  bis: string | null;
  /** Belegnummer (QU-/RE-/AN-…, null bei Entwürfen) bzw. Buchungsnummer der Einnahme */
  nummer: string | null;
  /** Beleg: rechnungen.status · Einnahme: 'bezahlt' | 'storniert' · Termin: termine.status */
  status: string;
  /** Beleg: Summe · Einnahme: Betrag · Termin: geschätzt (oder null) */
  betrag_cent: number | null;
  /** Betreff bzw. erste Position · Beschreibung · Leistung */
  leistung: string | null;
  /** Belege: alle Positionen (für Suche und Anzeige), sonst null */
  positionen: string | null;
  zahlungsart: Zahlungsart | null;
  faellig_am: string | null;
  /** Termine: Notiz */
  notiz: string | null;
  /** Beleg bzw. Einnahme zu diesem Termin */
  termin_id: number | null;
  /** Einnahme: Nummer auf dem Fremdbeleg / QU-Nummer */
  belegnummer: string | null;
  /** Einnahme: angehängte Belegdateien */
  belege_anzahl: number;
}

/* ================= Einträge ================= */

export type EintragStatus =
  | 'bezahlt'
  | 'offen'
  | 'ueberfaellig'
  | 'entwurf'
  | 'vorbereitet'
  | 'storniert'
  | 'angebot'
  | 'angenommen'
  | 'abgelehnt'
  | 'geplant'
  | 'nachtragen'
  | 'erledigt'
  | 'abgesagt';

/** Badge-Klasse (components.css) und Text je Status. */
export const STATUS_BADGE: Readonly<Record<EintragStatus, { klasse: string; text: string }>> = {
  bezahlt: { klasse: 'bezahlt', text: 'bezahlt' },
  offen: { klasse: 'offen', text: 'offen' },
  ueberfaellig: { klasse: 'ueberfaellig', text: 'überfällig' },
  entwurf: { klasse: 'entwurf', text: 'Entwurf' },
  vorbereitet: { klasse: 'entwurf', text: 'vorbereitet' },
  storniert: { klasse: 'storniert', text: 'storniert' },
  angebot: { klasse: 'accent', text: 'Angebot' },
  angenommen: { klasse: 'pos', text: 'angenommen' },
  abgelehnt: { klasse: 'entwurf', text: 'abgelehnt' },
  geplant: { klasse: 'accent', text: 'geplant' },
  nachtragen: { klasse: 'warn', text: 'nachtragen' },
  erledigt: { klasse: 'bezahlt', text: 'erledigt' },
  abgesagt: { klasse: 'entwurf', text: 'abgesagt' },
};

export const ART_NAME: Readonly<Record<VerlaufArt, string>> = {
  rechnung: 'Rechnung',
  quittung: 'Quittung',
  angebot: 'Angebot',
  einnahme: 'Einnahme',
  termin: 'Termin',
};

export interface Eintrag {
  z: VerlaufZeile;
  status: EintragStatus;
  /** zählt als Besuch */
  besuch: boolean;
  /** zählt zum Umsatz des Kunden (Anzeige in der Zeile) */
  umsatz: boolean;
  /** Was gemacht wurde (nie leer) */
  titel: string;
  /** Termine: der dafür vorbereitete Beleg (Entwurf ohne Nummer) */
  vorbereitet: VerlaufZeile | null;
  /** normalisierter Suchtext */
  hay: string;
}

/** Status eines Eintrags am Tag `heute`. */
export function eintragStatus(z: Pick<VerlaufZeile, 'quelle' | 'art' | 'status' | 'datum' | 'faellig_am' | 'termin_id'>, heute: string): EintragStatus {
  if (z.quelle === 'termin') {
    if (z.status === 'geplant') return z.datum < heute ? 'nachtragen' : 'geplant';
    return z.status === 'abgesagt' ? 'abgesagt' : 'erledigt';
  }
  if (z.quelle === 'einnahme') return z.status === 'storniert' ? 'storniert' : 'bezahlt';
  if (z.status === 'storniert') return 'storniert';
  if (z.status === 'entwurf') return z.termin_id != null ? 'vorbereitet' : 'entwurf';
  if (z.art === 'angebot') return z.status === 'angenommen' ? 'angenommen' : z.status === 'abgelehnt' ? 'abgelehnt' : 'angebot';
  if (z.status === 'offen') return z.art === 'rechnung' && !!z.faellig_am && z.faellig_am < heute ? 'ueberfaellig' : 'offen';
  return 'bezahlt';
}

/** Zählt als Besuch? Quittung/Rechnung (ausgestellt, nicht storniert) bzw. Einnahme ohne Beleg – nur bis heute. */
export function istBesuch(z: Pick<VerlaufZeile, 'quelle' | 'art' | 'status' | 'datum'>, heute: string): boolean {
  if (z.datum > heute) return false;
  if (z.quelle === 'einnahme') return z.status !== 'storniert';
  if (z.quelle === 'beleg') return (z.art === 'quittung' || z.art === 'rechnung') && z.status !== 'entwurf' && z.status !== 'storniert';
  return false; // Termine nie
}

/** Zählt zum Umsatz? Wie ein Besuch, aber auch mit künftigem Leistungsdatum. */
const zaehltUmsatz = (z: VerlaufZeile): boolean =>
  z.quelle === 'einnahme'
    ? z.status !== 'storniert'
    : z.quelle === 'beleg' && (z.art === 'quittung' || z.art === 'rechnung') && z.status !== 'entwurf' && z.status !== 'storniert';

/** Titel ohne angehängten Kundennamen (die Erfassen-Schublade schreibt bei Einnahmen „Leistung · Name“). */
function titelVon(z: VerlaufZeile, k: Pick<KundeZeile, 'name' | 'nummer'>): string {
  let t = (z.leistung ?? '').trim();
  if (z.quelle === 'einnahme') {
    for (const wer of [`${k.name} · ${k.nummer}`, k.name]) {
      if (t.length > wer.length + 3 && t.endsWith(` · ${wer}`)) {
        t = t.slice(0, -(wer.length + 3));
        break;
      }
    }
  }
  if (!t && z.positionen) t = z.positionen.split(' · ')[0].trim();
  return t || ART_NAME[z.art];
}

/* ================= Index: Kunde → Infos ================= */

export interface KundenInfo {
  k: KundeZeile;
  /** neueste zuerst (Kommendes oben) */
  eintraege: Eintrag[];
  besuche: number;
  letzterBesuch: Eintrag | null;
  /** Datum des letzten Besuchs (nie in der Zukunft) */
  zuletzt: string | null;
  /** nächster geplanter Termin (heute oder später) */
  naechster: Eintrag | null;
  /** geplante Termine in der Vergangenheit (noch nicht erledigt) */
  nachtragen: Eintrag[];
  /** offene bzw. überfällige Rechnungen */
  offen: Eintrag[];
  /** Cent */
  umsatz: number;
  /** 'YYYY-MM-DD': erstes Datum (Anlage oder frühester vergangener Eintrag) */
  seit: string;
  geplant: number;
  angebote: number;
  /** Sortierschlüssel „zuletzt da“ (absteigend): neu angelegt ohne Einträge ganz oben, dann nur kommende Termine
   *  (nächster zuerst), dann nach letztem Besuch bzw. jüngstem vergangenen Eintrag */
  sortKey: string;
  /** normalisierte Stammdaten und Notiz */
  hay: string;
  /** nur Ziffern der Telefonnummer */
  tel: string;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Neueste zuerst; am gleichen Tag spätere Uhrzeit zuerst, Besuche vor Terminen, dann höhere ID. */
const neuesteZuerst = (a: Eintrag, b: Eintrag): number =>
  cmp(b.z.datum, a.z.datum) || cmp(b.z.von ?? '', a.z.von ?? '') || Number(b.besuch) - Number(a.besuch) || b.z.id - a.z.id;

function auswerten(k: KundeZeile, zeilen: readonly VerlaufZeile[], heute: string): KundenInfo {
  const termine = new Map(zeilen.filter((z) => z.quelle === 'termin').map((z) => [z.id, z]));
  // Termine, die schon über einen Beleg oder eine Einnahme im Verlauf stehen
  const abgedeckt = new Set<number>();
  // Termin-ID → vorbereiteter Beleg (wird am Termin gezeigt)
  const vorbereitet = new Map<number, VerlaufZeile>();
  for (const z of zeilen) {
    if (z.quelle === 'termin' || z.termin_id == null || z.status === 'storniert') continue;
    const t = termine.get(z.termin_id);
    if (z.status === 'entwurf') {
      if (t && t.status !== 'erledigt' && !vorbereitet.has(t.id)) vorbereitet.set(t.id, z);
    } else abgedeckt.add(z.termin_id);
  }

  const eintraege: Eintrag[] = [];
  for (const z of zeilen) {
    if (z.quelle === 'termin' && z.status === 'erledigt' && abgedeckt.has(z.id)) continue;
    if (z.quelle === 'beleg' && z.status === 'entwurf' && z.termin_id != null && vorbereitet.get(z.termin_id) === z) continue;
    const titel = titelVon(z, k);
    let status = eintragStatus(z, heute);
    // Termin schon erledigt, Beleg aber noch nicht ausgestellt: ein ganz normaler Entwurf
    if (status === 'vorbereitet' && termine.get(z.termin_id ?? -1)?.status === 'erledigt') status = 'entwurf';
    eintraege.push({
      z,
      status,
      besuch: istBesuch(z, heute),
      umsatz: zaehltUmsatz(z),
      titel,
      vorbereitet: z.quelle === 'termin' ? (vorbereitet.get(z.id) ?? null) : null,
      hay: normalize([titel, z.positionen, z.nummer, z.belegnummer, z.notiz].filter(Boolean).join(' ')),
    });
  }
  eintraege.sort(neuesteZuerst);

  const besuche = eintraege.filter((e) => e.besuch);
  const letzterBesuch = besuche[0] ?? null;
  const zuletzt = letzterBesuch?.z.datum ?? null;
  const naechster =
    eintraege
      .filter((e) => e.status === 'geplant')
      .sort((a, b) => cmp(a.z.datum, b.z.datum) || cmp(a.z.von ?? '', b.z.von ?? ''))[0] ?? null;
  const vergangen = eintraege.filter((e) => e.z.datum <= heute);
  const angelegt = k.erstellt_am.slice(0, 10);
  const fruehester = vergangen.length ? vergangen[vergangen.length - 1].z.datum : null;
  const seit = fruehester && fruehester < angelegt ? fruehester : angelegt;

  let sortKey: string;
  if (zuletzt) sortKey = zuletzt;
  else if (naechster) sortKey = '9' + String(99_999_999 - Number(naechster.z.datum.replace(/-/g, '')));
  else if (vergangen.length) sortKey = vergangen[0].z.datum;
  else if (eintraege.length) sortKey = eintraege[eintraege.length - 1].z.datum;
  else sortKey = '9999' + k.erstellt_am;

  return {
    k,
    eintraege,
    besuche: besuche.length,
    letzterBesuch,
    zuletzt,
    naechster,
    nachtragen: eintraege.filter((e) => e.status === 'nachtragen'),
    offen: eintraege.filter((e) => e.z.art === 'rechnung' && (e.status === 'offen' || e.status === 'ueberfaellig')),
    umsatz: summe(eintraege.filter((e) => e.umsatz).map((e) => e.z.betrag_cent ?? 0)),
    seit,
    geplant: eintraege.filter((e) => e.status === 'geplant').length,
    angebote: eintraege.filter((e) => e.z.art === 'angebot').length,
    sortKey,
    hay: normalize([k.name, k.zusatz, k.nummer, k.strasse, k.plz, k.ort, k.telefon, k.email, k.notiz].filter(Boolean).join(' ')),
    tel: (k.telefon ?? '').replace(/\D/g, ''),
  };
}

/** Einmal je Laden: Kunde → Infos (Verlauf nach Kunde gruppiert). */
export function kundenIndex(kunden: readonly KundeZeile[], verlauf: readonly VerlaufZeile[], heute: string): Map<number, KundenInfo> {
  const proKunde = new Map<number, VerlaufZeile[]>();
  for (const z of verlauf) {
    const l = proKunde.get(z.kunde_id);
    if (l) l.push(z);
    else proKunde.set(z.kunde_id, [z]);
  }
  return new Map(kunden.map((k) => [k.id, auswerten(k, proKunde.get(k.id) ?? [], heute)]));
}

/* ================= Liste: Filter, Suche, Sortierung ================= */

export type KundenFilter = 'alle' | 'stamm' | 'notiz';
export type SortFeld = 'zuletzt' | 'name' | 'besuche';
export type Richtung = 1 | -1;

/** Startrichtung je Spalte (erneuter Klick dreht um). */
export const SORT_START: Readonly<Record<SortFeld, Richtung>> = { zuletzt: -1, name: 1, besuche: -1 };

/** Stammkunde = mindestens 2 Besuche. */
export const STAMM_AB = 2;

export const hatNotiz = (k: Pick<KundeZeile, 'notiz'>): boolean => !!k.notiz?.trim();

export const passtFilter = (x: KundenInfo, f: KundenFilter): boolean =>
  f === 'stamm' ? x.besuche >= STAMM_AB : f === 'notiz' ? hatNotiz(x.k) : true;

export function zaehleFilter(infos: Iterable<KundenInfo>): Record<KundenFilter, number> {
  const n = { alle: 0, stamm: 0, notiz: 0 };
  for (const x of infos) {
    n.alle++;
    if (passtFilter(x, 'stamm')) n.stamm++;
    if (passtFilter(x, 'notiz')) n.notiz++;
  }
  return n;
}

export interface KundenTreffer {
  info: KundenInfo;
  /** Treffer in einem Verlaufseintrag (Leistung, Position, Nummer), der statt der letzten Leistung gezeigt wird */
  eintrag: Eintrag | null;
}

/** Suchanfrage wie eine Telefonnummer (nur Ziffern, Leerzeichen, + - / ( ))? Dann zählen auch nur die Ziffern. */
const telefonZiffern = (q: string): string => (/^[\d\s+()/-]+$/.test(q) ? q.replace(/\D/g, '') : '');

/**
 * Suche über Name, Zusatz, Nummer, Adresse, Telefon (auch ohne Leerzeichen), E-Mail, Notiz und die Leistungen im Verlauf.
 * Jedes Wort muss irgendwo vorkommen. null = kein Treffer.
 */
export function suchTreffer(x: KundenInfo, q: string): KundenTreffer | null {
  const roh = q.trim();
  if (!roh) return { info: x, eintrag: null };
  const ziffern = telefonZiffern(roh);
  if (ziffern.length >= 3 && x.tel.includes(ziffern)) return { info: x, eintrag: null };
  const woerter = normalize(roh).split(/\s+/).filter(Boolean);
  const offen = woerter.filter((w) => !x.hay.includes(w));
  if (!offen.length) return { info: x, eintrag: null };
  const eintrag = x.eintraege.find((e) => offen.some((w) => e.hay.includes(w))) ?? null;
  if (!eintrag) return null;
  const alle = offen.every((w) => x.eintraege.some((e) => e.hay.includes(w)));
  return alle ? { info: x, eintrag } : null;
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

export function vergleiche(a: KundenInfo, b: KundenInfo, feld: SortFeld, richtung: Richtung): number {
  const r =
    feld === 'name'
      ? collator.compare(a.k.name, b.k.name)
      : feld === 'besuche'
        ? a.besuche - b.besuche || cmp(a.sortKey, b.sortKey)
        : cmp(a.sortKey, b.sortKey);
  return r * richtung || collator.compare(a.k.name, b.k.name) || a.k.id - b.k.id;
}

export interface ListenOptionen {
  q: string;
  filter: KundenFilter;
  sort: SortFeld;
  richtung: Richtung;
}

/** Gefilterte, durchsuchte und sortierte Liste. */
export function kundenListe(infos: Iterable<KundenInfo>, o: ListenOptionen): KundenTreffer[] {
  const out: KundenTreffer[] = [];
  for (const x of infos) {
    if (!passtFilter(x, o.filter)) continue;
    const t = suchTreffer(x, o.q);
    if (t) out.push(t);
  }
  return out.sort((a, b) => vergleiche(a.info, b.info, o.sort, o.richtung));
}

/* ================= Anzeige ================= */

/** Initialen fürs Monogramm: zwei Wörter ⇒ je erster Buchstabe, ein Wort ⇒ die ersten zwei; Rechtsform zählt nicht. */
export function initialen(name: string): string {
  const w = (name || '?')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter((x) => x && !/^(GmbH|AG|UG|e|V|UC|KG|Dr|und)$/i.test(x));
  const a = [...(w[0] ?? '?')];
  const zweiter = w[1] ? [...w[1]][0] : (a[1] ?? '');
  return (a[0] + zweiter).toLocaleUpperCase('de-DE');
}

/** Farbton 0–359 aus dem Namen (gleicher Name ⇒ gleiche Farbe), wie im Prototyp. */
export function farbton(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

const utc = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** Tage von `von` bis `bis` (positiv, wenn `bis` später ist). Ohne Zeitzonen- und Sommerzeitfehler. */
export const tageZwischen = (von: string, bis: string): number => Math.round((utc(bis) - utc(von)) / 86_400_000);

/** „heute“, „gestern“, „vor 12 Tagen“, „vor 3 Wochen“, „vor 5 Monaten“, „vor 2 Jahren“; Zukunft: „morgen“, „in 3 Tagen“ … */
export function vorText(datum: string, heute: string): string {
  const n = tageZwischen(datum, heute);
  if (n === 0) return 'heute';
  const m = Math.abs(n);
  if (m === 1) return n > 0 ? 'gestern' : 'morgen';
  let text: string;
  if (m < 14) text = `${m} Tagen`;
  else if (m < 60) text = `${Math.round(m / 7)} Wochen`;
  else {
    const monate = Math.round(m / 30.44);
    text = monate < 24 ? `${monate} Monaten` : `${Math.round(m / 365.25)} Jahren`;
  }
  return n > 0 ? `vor ${text}` : `in ${text}`;
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** „März 2025“ */
export const monatJahr = (iso: string): string => `${MONATE[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

const wochentag = (iso: string): string => WOCHENTAGE[new Date(utc(iso)).getUTCDay()];
const tagMonat = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** Uhrzeit eines Termins: „08:00–10:00“, „08:00“ oder ''. */
export const zeitspanne = (von: string | null, bis: string | null): string => (von ? (bis ? `${von}–${bis}` : von) : '');

/** Kurz für die Liste: „heute 08:00“, „morgen“, „Di 14.10.“ */
export function terminKurz(z: Pick<VerlaufZeile, 'datum' | 'von'>, heute: string): string {
  const n = tageZwischen(heute, z.datum);
  if (n === 0) return `heute ${z.von ?? ''}`.trim();
  if (n === 1) return `morgen ${z.von ?? ''}`.trim();
  return `${wochentag(z.datum)} ${tagMonat(z.datum)}`;
}

/** Lang für die Schublade: „Morgen · 08:00–10:00“, „Di, 14.10. · 08:00“ (anderes Jahr mit Jahreszahl). */
export function terminLang(z: Pick<VerlaufZeile, 'datum' | 'von' | 'bis'>, heute: string): string {
  const n = tageZwischen(heute, z.datum);
  const rel = n === 0 ? 'Heute' : n === 1 ? 'Morgen' : n === -1 ? 'Gestern' : '';
  const tag = rel || `${wochentag(z.datum)}, ${z.datum.slice(0, 4) === heute.slice(0, 4) ? tagMonat(z.datum) : datumKurz(z.datum)}`;
  return [tag, zeitspanne(z.von, z.bis)].filter(Boolean).join(' · ');
}

/** Kennzeile der Schublade: „3 Besuche · zuletzt vor 12 Tagen · Kunde seit März 2025“. */
export function kennzeile(x: Pick<KundenInfo, 'besuche' | 'zuletzt' | 'seit'>, heute: string): string[] {
  const seit = `Kunde seit ${monatJahr(x.seit)}`;
  if (!x.besuche || !x.zuletzt) return ['Noch kein Besuch', seit];
  return [anzahlText(x.besuche, 'Besuch', 'Besuche'), `zuletzt ${vorText(x.zuletzt, heute)}`, seit];
}

/** Aufbewahrungsfrist (§2.10): 10 Jahre ab Ende des Jahres der letzten Buchung bzw. des letzten Belegs. */
export const AUFBEWAHRUNG_JAHRE = 10;

/** `bis` = letzter Tag der Frist, `ab` = Jahr, ab dem anonymisiert werden darf. null ohne Buchungen und Belege. */
export function loeschenAb(fristDatum: string | null): { bis: string; ab: number } | null {
  if (!fristDatum || !/^\d{4}/.test(fristDatum)) return null;
  const j = Number(fristDatum.slice(0, 4)) + AUFBEWAHRUNG_JAHRE;
  return { bis: `${j}-12-31`, ab: j + 1 };
}

/** Kurz für die Liste: „Gartenweg 3, Musterstadt“ */
export const adresseKurz = (k: Pick<KundeZeile, 'strasse' | 'ort'>): string => [k.strasse, k.ort].filter(Boolean).join(', ');

/** Voll für die Schublade: „Gartenweg 3, 12345 Musterstadt“ */
export const adresseVoll = (k: Pick<KundeZeile, 'strasse' | 'plz' | 'ort'>): string =>
  [k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ');

/* ---------- Links (nur diese öffnet Rust: src-tauri/src/kunden.rs → link_erlaubt) ---------- */

export function kartenLink(k: Pick<KundeZeile, 'strasse' | 'plz' | 'ort'>): string | null {
  const a = adresseVoll(k);
  return a ? `https://maps.apple.com/?q=${encodeURIComponent(a)}` : null;
}

export function telLink(telefon: string | null): string | null {
  const t = (telefon ?? '').trim();
  const ziffern = t.replace(/\D/g, '');
  if (ziffern.length < 3) return null;
  return `tel:${t.startsWith('+') ? '+' : ''}${ziffern}`;
}

const EMAIL = /^[^\s@?&<>"\\]+@[^\s@?&<>"\\]+\.[^\s@?&<>"\\]+$/;
export const emailGueltig = (email: string): boolean => EMAIL.test(email.trim());

export function mailLink(email: string | null): string | null {
  const e = (email ?? '').trim();
  return e && emailGueltig(e) ? `mailto:${e}` : null;
}

/* ================= Formular (Anlegen, Stammdaten) ================= */

export const KUNDEN_FELDER = ['name', 'zusatz', 'strasse', 'plz', 'ort', 'email', 'telefon', 'notiz'] as const;
export type KundenFeld = (typeof KUNDEN_FELDER)[number];
export type KundeFormular = Record<KundenFeld, string>;

/** Was an kunde_anlegen / kunde_aendern geht (Feldnamen wie KundeEingabe in kunden.rs). */
export type KundeDaten = { name: string } & Record<Exclude<KundenFeld, 'name'>, string | null>;

export const leeresKundeFormular = (name = ''): KundeFormular => ({
  name,
  zusatz: '',
  strasse: '',
  plz: '',
  ort: '',
  email: '',
  telefon: '',
  notiz: '',
});

export const formularAus = (k: KundeZeile): KundeFormular => ({
  name: k.name,
  zusatz: k.zusatz ?? '',
  strasse: k.strasse ?? '',
  plz: k.plz ?? '',
  ort: k.ort ?? '',
  email: k.email ?? '',
  telefon: k.telefon ?? '',
  notiz: k.notiz ?? '',
});

export type KundePruefung = { ok: true; daten: KundeDaten } | { ok: false; fehler: Partial<Record<KundenFeld, string>> };

/** Name Pflicht, E-Mail plausibel; alles getrimmt, leer ⇒ null (wie pruefen() in kunden.rs). */
export function pruefeKunde(f: KundeFormular): KundePruefung {
  const fehler: Partial<Record<KundenFeld, string>> = {};
  if (!f.name.trim()) fehler.name = 'Bitte einen Namen eingeben.';
  if (f.email.trim() && !emailGueltig(f.email)) fehler.email = 'Die E-Mail-Adresse sieht nicht vollständig aus.';
  if (Object.keys(fehler).length) return { ok: false, fehler };
  const t = (s: string): string | null => s.trim() || null;
  return {
    ok: true,
    daten: {
      name: f.name.trim(),
      zusatz: t(f.zusatz),
      strasse: t(f.strasse),
      plz: t(f.plz),
      ort: t(f.ort),
      email: t(f.email),
      telefon: t(f.telefon),
      notiz: t(f.notiz),
    },
  };
}

/** Kunden mit gleichem Namen (Hinweis beim Anlegen: „Gibt es schon: K-0003 · Musterstadt“). */
export function gleicherName<T extends Pick<KundeZeile, 'id' | 'name'>>(name: string, kunden: readonly T[], ohneId: number | null = null): T[] {
  const s = nameSchluessel(name);
  return s ? kunden.filter((k) => k.id !== ohneId && nameSchluessel(k.name) === s) : [];
}

/** Notiz-Text zum Speichern: getrimmt, leer ⇒ null. Gleich ⇒ nichts zu tun. */
export const notizWert = (text: string): string | null => text.trim() || null;
