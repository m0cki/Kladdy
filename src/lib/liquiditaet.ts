/* Auswertung › Liquidität (ANLEITUNG §6.9.2) – reine Rechenlogik ohne Datenbank, mit Vitest getestet (liquiditaet.test.ts).
 * Port von referenz/prototyp/js/core.js → prognose() (mit historie: 0, wie js/pages/liquiditaet.js), aber in ganzen Cent.
 *
 * Es gibt keinen Kontostand (Geschäfts- und Privatkonto sind oft dasselbe). Die Kurve ist der kumulierte Überschuss ab
 * heute (Start 0) aus erwarteten Zahlungen, alle NACH heute und bis heute + Horizont (30/60/90 Tage):
 * - offene Rechnungen am Fälligkeitstag + Ø Zahlungsverzug (aus der Historie, per Regler änderbar); landet der Tag auf
 *   heute oder davor, frühestens heute + 3 Tage. Überfällige (Fälligkeit vor heute) lassen sich ausschalten.
 * - wiederkehrende Kosten (Tabelle wiederkehrend, nur aktive) nach Rhythmus und Tag, Monatsende wird gekappt (31. ⇒ 28./29.2.)
 * - Planposten (Tabelle planposten, negativ = Ausgabe)
 * - Ø variable Ein- und Ausgänge der letzten 90 Tage, wöchentlich gebündelt (heute + 7, + 14 …), als „Ø“ markiert.
 *   Ohne Buchungen ohne Geldfluss (AfA/Pauschale, §5), ohne Zahlungen zu Rechnungen (stehen einzeln oben) und ohne
 *   wiederkehrende Zahlungen. Weil heute noch keine Buchung auf ihre Vorlage verweist (buchungen.wiederkehrend_id kommt
 *   mit Phase 7), werden die Termine der aktiven wiederkehrenden Posten im Rückblick abgezogen, soweit keine verknüpfte
 *   Buchung sie abdeckt – sonst zählten Handy & Co. doppelt (einzeln und im Durchschnitt).
 * Gerundet wird nur an zwei Stellen: Ø Zahlungsverzug auf ganze Tage, Wochen-Ø auf ganze Cent. */
import type { BuchungTyp } from './buchungen';
import { tageZwischen } from './kunden';
import { plusTage } from './zeitraum';

/* ================= Eingaben ================= */

/** Buchung, wie sie lib/queries/auswertung.ts liefert (AuswertungBuchung erfüllt das). Storno-Gegenbuchungen zählen negativ. */
export interface LiqBuchung {
  typ: BuchungTyp;
  zahlungsdatum: string;
  /** immer positiv */
  betrag_cent: number;
  art: 'zahlung' | 'afa' | 'pauschale';
  storno_von_id: number | null;
  /** Art des Belegs, zu dem die Zahlung gehört ('rechnung', 'quittung' …), sonst null */
  rechnung_art: string | null;
  /** Vorlage aus wiederkehrend (ab Phase 7) */
  wiederkehrend_id: number | null;
}

/** Ausgestellte, offene Rechnung. */
export interface LiqRechnung {
  id: number;
  nummer: string | null;
  /** Schnappschuss beim Ausstellen */
  kunde_name: string | null;
  datum: string | null;
  faellig_am: string | null;
  summe_cent: number;
}

/** Bezahlte Rechnung für den Ø Zahlungsverzug. */
export interface BezahlteRechnung {
  faellig_am: string;
  bezahlt_am: string;
}

export interface Planposten {
  id: number;
  datum: string;
  text: string;
  /** negativ = Ausgabe */
  betrag_cent: number;
}

/* ---------- Wiederkehrende Zahlungen (Tabelle wiederkehrend) ---------- */

export type Rhythmus = 'monatlich' | 'vierteljaehrlich' | 'jaehrlich';

export const RHYTHMEN: readonly { value: Rhythmus; label: string; monate: number }[] = [
  { value: 'monatlich', label: 'Monatlich', monate: 1 },
  { value: 'vierteljaehrlich', label: 'Vierteljährlich', monate: 3 },
  { value: 'jaehrlich', label: 'Jährlich', monate: 12 },
];

export const istRhythmus = (v: unknown): v is Rhythmus => RHYTHMEN.some((r) => r.value === v);
const schrittMonate = (r: Rhythmus): number => RHYTHMEN.find((x) => x.value === r)!.monate;

/**
 * Inhalt von wiederkehrend.vorlage_json (Version 1, geschrieben von src-tauri/src/liquiditaet.rs, dort ebenso geprüft):
 *   { "name": "Handyvertrag", "betrag_cent": 2999, "typ": "ausgabe", "kategorie_id": 4, "tag": 20 }
 * - name: 1–80 Zeichen · betrag_cent: ganze Cent > 0 (Richtung über typ) · typ: 'einnahme' | 'ausgabe'
 * - kategorie_id: optional (null), sonst eine Kategorie mit passendem typ
 * - tag: 1–31, Tag im Monat; in kürzeren Monaten der letzte Tag (31. ⇒ 30.4., 28./29.2.)
 * Rhythmus und nächster Termin stehen in eigenen Spalten (rhythmus, naechstes_datum = Anker: ab da alle 1/3/12 Monate).
 * Phase 7 („wiederkehrende Buchungen“) darf weitere Felder ergänzen (z. B. zahlungsart, lieferant, beschreibung);
 * unbekannte Felder werden hier ignoriert und beim Ändern in Rust erhalten.
 */
export interface WiederkehrendVorlage {
  name: string;
  betrag_cent: number;
  typ: BuchungTyp;
  kategorie_id: number | null;
  tag: number;
}

export interface Wiederkehrend {
  id: number;
  vorlage: WiederkehrendVorlage;
  rhythmus: Rhythmus;
  /** Anker 'YYYY-MM-DD' */
  naechstes_datum: string;
  aktiv: boolean;
}

/** Zeile aus der Datenbank. */
export interface WiederkehrendZeile {
  id: number;
  vorlage_json: string;
  rhythmus: string;
  naechstes_datum: string;
  aktiv: number;
}

const istDatumText = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Prüft eine Vorlage; null, wenn sie nicht der Form oben entspricht. */
export function vorlageLesen(v: unknown): WiederkehrendVorlage | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const { betrag_cent, typ, tag } = o;
  const kategorie_id = o.kategorie_id ?? null;
  if (!name || name.length > 80) return null;
  if (!Number.isSafeInteger(betrag_cent) || (betrag_cent as number) <= 0) return null;
  if (typ !== 'einnahme' && typ !== 'ausgabe') return null;
  if (kategorie_id !== null && (!Number.isSafeInteger(kategorie_id) || (kategorie_id as number) < 1)) return null;
  if (!Number.isInteger(tag) || (tag as number) < 1 || (tag as number) > 31) return null;
  return { name, betrag_cent: betrag_cent as number, typ, kategorie_id: kategorie_id as number | null, tag: tag as number };
}

/** Datenbankzeile ⇒ Wiederkehrend; null bei unlesbarer Vorlage oder unbekanntem Rhythmus (wird dann übergangen). */
export function wiederkehrendAusZeile(z: WiederkehrendZeile): Wiederkehrend | null {
  let roh: unknown;
  try {
    roh = JSON.parse(z.vorlage_json);
  } catch {
    return null;
  }
  const vorlage = vorlageLesen(roh);
  if (!vorlage || !istRhythmus(z.rhythmus) || !istDatumText(z.naechstes_datum)) return null;
  return { id: z.id, vorlage, rhythmus: z.rhythmus, naechstes_datum: z.naechstes_datum, aktiv: !!z.aktiv };
}

/* ---------- Annahmen (einstellungen['liquiditaet_annahmen']) ---------- */

export interface Annahmen {
  /** offene Rechnungen einrechnen */
  offene: boolean;
  /** überfällige davon einrechnen (frühestens heute + 3) */
  ueberfaellige: boolean;
  /** wiederkehrende Kosten */
  wiederkehrend: boolean;
  /** Planposten */
  plan: boolean;
  /** Ø variable Ein- und Ausgänge */
  variabel: boolean;
  /** Ø Zahlungsverzug in Tagen; null = aus der Historie */
  verzug: number | null;
  /** Ø-Zeilen in der Tabelle zeigen (nur Anzeige) */
  avgZeilen: boolean;
}

export const ANNAHMEN_STANDARD: Readonly<Annahmen> = {
  offene: true,
  ueberfaellige: true,
  wiederkehrend: true,
  plan: true,
  variabel: true,
  verzug: null,
  avgZeilen: true,
};

/** Höchster Wert des Reglers (wie im Prototyp 45 Tage). */
export const VERZUG_MAX = 45;

/** Gespeicherter Wert ⇒ Annahmen; fehlende oder kaputte Felder bekommen den Standard. */
export function annahmenAusWert(v: unknown): Annahmen {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const bool = (k: keyof Annahmen): boolean => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (ANNAHMEN_STANDARD[k] as boolean));
  const verzug = Number.isInteger(o.verzug) && (o.verzug as number) >= 0 && (o.verzug as number) <= 365 ? (o.verzug as number) : null;
  return {
    offene: bool('offene'),
    ueberfaellige: bool('ueberfaellige'),
    wiederkehrend: bool('wiederkehrend'),
    plan: bool('plan'),
    variabel: bool('variabel'),
    verzug,
    avgZeilen: bool('avgZeilen'),
  };
}

/* ---------- Horizont (in der Adresse: ?tage=30|60|90) ---------- */

export const HORIZONTE = [30, 60, 90] as const;
export type Horizont = (typeof HORIZONTE)[number];
export const HORIZONT_STANDARD: Horizont = 90;

export const horizontAusParam = (s: string | null): Horizont => {
  const n = Number(s);
  return (HORIZONTE as readonly number[]).includes(n) ? (n as Horizont) : HORIZONT_STANDARD;
};

/* ================= Bausteine ================= */

const pad = (n: number, l = 2) => String(n).padStart(l, '0');
const tageImMonat = (jahr: number, monat: number): number => new Date(Date.UTC(jahr, monat, 0)).getUTCDate();

/** Tag `tag` im Monat, in kürzeren Monaten der letzte (wie dateIn im Prototyp). */
export const datumIn = (jahr: number, monat: number, tag: number): string =>
  `${pad(jahr, 4)}-${pad(monat)}-${pad(Math.min(tag, tageImMonat(jahr, monat)))}`;

/** Geldfluss einer Buchung mit Vorzeichen (Einnahme +, Ausgabe −, Storno umgekehrt); ohne Geldfluss 0. Voller Betrag. */
export function geldfluss(b: Pick<LiqBuchung, 'typ' | 'betrag_cent' | 'art' | 'storno_von_id'>): number {
  if (b.art !== 'zahlung') return 0;
  const v = (b.typ === 'einnahme' ? 1 : -1) * (b.storno_von_id == null ? 1 : -1);
  return v * b.betrag_cent;
}

/** Ø Tage nach Fälligkeit (zu früh = 0) über alle bezahlten Rechnungen, auf ganze Tage gerundet; ohne Historie 0. */
export function zahlungsverzug(bezahlt: readonly BezahlteRechnung[]): number {
  if (!bezahlt.length) return 0;
  const summe = bezahlt.reduce((s, r) => s + Math.max(0, tageZwischen(r.faellig_am, r.bezahlt_am)), 0);
  return Math.round(summe / bezahlt.length);
}

/**
 * Termine eines wiederkehrenden Postens mit `von` < Datum ≤ `bis`. Ab dem Anker (naechstes_datum) alle 1/3/12 Monate
 * am Tag aus der Vorlage; `rueckwaerts` = auch vor dem Anker weiterzählen (für den Rückblick des Ø).
 */
export function wiederkehrTermine(w: Pick<Wiederkehrend, 'vorlage' | 'rhythmus' | 'naechstes_datum'>, von: string, bis: string, rueckwaerts = false): string[] {
  const schritt = schrittMonate(w.rhythmus);
  const monatsIndex = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
  const anker = monatsIndex(w.naechstes_datum);
  let k = Math.floor((monatsIndex(von) - anker) / schritt) - 1;
  if (!rueckwaerts && k < 0) k = 0;
  const out: string[] = [];
  for (; ; k++) {
    const i = anker + k * schritt;
    const t = datumIn(Math.floor(i / 12), (i % 12) + 1, w.vorlage.tag);
    if (t > bis) break;
    if (t > von && (rueckwaerts || t >= w.naechstes_datum)) out.push(t);
  }
  return out;
}

/** Tage des Rückblicks für den Ø (§6.9.2). */
export const RUECKBLICK_TAGE = 90;

export interface VariablerSchnitt {
  /** Ø Eingänge je Woche (Cent, ≥ 0) */
  ein: number;
  /** Ø Ausgaben je Woche (Cent, ≥ 0, als Betrag) */
  aus: number;
}

/**
 * Ø variable Ein- und Ausgänge je Woche aus den letzten 90 Tagen (heute − 90 < Zahlungsdatum ≤ heute), siehe Kopf.
 * Je Typ summiert (Storno zieht ab), abzüglich nicht verknüpfter Termine aktiver wiederkehrender Posten, nie unter 0.
 */
export function variablerSchnitt(buchungen: readonly LiqBuchung[], wiederkehrend: readonly Wiederkehrend[], heute: string): VariablerSchnitt {
  const von = plusTage(heute, -RUECKBLICK_TAGE);
  let ein = 0;
  let aus = 0;
  const verknuepft = new Map<number, number>();
  for (const b of buchungen) {
    if (b.zahlungsdatum <= von || b.zahlungsdatum > heute) continue;
    if (b.wiederkehrend_id != null) {
      verknuepft.set(b.wiederkehrend_id, (verknuepft.get(b.wiederkehrend_id) ?? 0) + (b.storno_von_id == null ? 1 : -1));
      continue;
    }
    if (b.rechnung_art === 'rechnung') continue;
    const g = geldfluss(b);
    if (b.typ === 'einnahme') ein += g;
    else aus -= g;
  }
  for (const w of wiederkehrend) {
    if (!w.aktiv) continue;
    const offen = Math.max(0, wiederkehrTermine(w, von, heute, true).length - (verknuepft.get(w.id) ?? 0));
    if (w.vorlage.typ === 'einnahme') ein -= offen * w.vorlage.betrag_cent;
    else aus -= offen * w.vorlage.betrag_cent;
  }
  const woche = (summe: number) => Math.round((Math.max(0, summe) * 7) / RUECKBLICK_TAGE);
  return { ein: woche(ein), aus: woche(aus) };
}

/* ================= Vorschau ================= */

export type ZahlungArt = 'rechnung' | 'wiederkehrend' | 'plan' | 'variabel';

export interface Zahlung {
  datum: string;
  text: string;
  /** Cent mit Vorzeichen (+ rein, − raus) */
  betrag_cent: number;
  art: ZahlungArt;
  /** ID der Rechnung, des Planpostens bzw. des wiederkehrenden Postens; null beim Ø */
  ref: number | null;
  /** nur Rechnungen: Fälligkeit vor heute */
  ueberfaellig: boolean;
  /** Überschuss ab heute nach dieser Zahlung */
  saldo: number;
}

export interface Tag {
  datum: string;
  /** kumulierter Überschuss am Ende des Tages (heute = 0) */
  wert: number;
  zahlungen: Zahlung[];
}

export interface VorschauDaten {
  buchungen: readonly LiqBuchung[];
  offen: readonly LiqRechnung[];
  bezahlt: readonly BezahlteRechnung[];
  planposten: readonly Planposten[];
  wiederkehrend: readonly Wiederkehrend[];
}

export interface Vorschau {
  heute: string;
  /** letzter Tag (heute + Horizont) */
  bis: string;
  /** heute … bis, je Tag */
  tage: Tag[];
  /** alle erwarteten Zahlungen, nach Datum (am selben Tag Eingänge zuerst) */
  zahlungen: Zahlung[];
  eingaenge: number;
  /** als Betrag (≥ 0) */
  ausgaben: number;
  ueberschuss: number;
  /** davon offene Rechnungen */
  ausRechnungen: number;
  /** davon feste Kosten (wiederkehrende Ausgaben, als Betrag) */
  festeKosten: number;
  /** tiefster Punkt der Kurve (erster Tag mit dem kleinsten Wert; ohne Rückgang heute mit 0) */
  engster: { datum: string; wert: number };
  /** bis zum engsten Moment geht mindestens ein Euro mehr raus als rein */
  engpass: boolean;
  /** benutzter Ø Zahlungsverzug (Tage) */
  verzug: number;
  /** Ø Zahlungsverzug aus der Historie */
  verzugAuto: number;
  schnitt: VariablerSchnitt;
}

/** Mindestens so tief (Cent) muss die Kurve fallen, damit es als Engpass gilt (angezeigt wird auf ganze Euro). */
const ENGPASS_AB = -50;

export function vorschau(d: VorschauDaten, heute: string, horizont: number, a: Annahmen): Vorschau {
  const bis = plusTage(heute, horizont);
  const verzugAuto = zahlungsverzug(d.bezahlt);
  const verzug = a.verzug ?? verzugAuto;
  const zahlungen: Zahlung[] = [];
  const add = (z: Omit<Zahlung, 'saldo' | 'ueberfaellig'> & { ueberfaellig?: boolean }) => {
    if (z.datum > heute && z.datum <= bis && z.betrag_cent !== 0) zahlungen.push({ ueberfaellig: false, ...z, saldo: 0 });
  };

  if (a.offene) {
    for (const r of d.offen) {
      const faellig = r.faellig_am ?? r.datum ?? heute;
      const ueberfaellig = faellig < heute;
      if (ueberfaellig && !a.ueberfaellige) continue;
      let t = plusTage(faellig, verzug);
      if (t <= heute) t = plusTage(heute, 3);
      const text = `${r.nummer ?? 'Rechnung'} · ${r.kunde_name || 'Kunde'}${ueberfaellig ? ' (überfällig)' : ''}`;
      add({ datum: t, text, betrag_cent: r.summe_cent, art: 'rechnung', ref: r.id, ueberfaellig });
    }
  }
  if (a.wiederkehrend) {
    for (const w of d.wiederkehrend) {
      if (!w.aktiv) continue;
      const betrag = (w.vorlage.typ === 'einnahme' ? 1 : -1) * w.vorlage.betrag_cent;
      for (const t of wiederkehrTermine(w, heute, bis)) add({ datum: t, text: w.vorlage.name, betrag_cent: betrag, art: 'wiederkehrend', ref: w.id });
    }
  }
  if (a.plan) for (const p of d.planposten) add({ datum: p.datum, text: p.text, betrag_cent: p.betrag_cent, art: 'plan', ref: p.id });

  const schnitt = variablerSchnitt(d.buchungen, d.wiederkehrend, heute);
  if (a.variabel) {
    for (let t = plusTage(heute, 7); t <= bis; t = plusTage(t, 7)) {
      add({ datum: t, text: 'Ø Einnahmen aus Aufträgen (Woche)', betrag_cent: schnitt.ein, art: 'variabel', ref: null });
      add({ datum: t, text: 'Ø laufende Ausgaben (Woche)', betrag_cent: -schnitt.aus, art: 'variabel', ref: null });
    }
  }

  zahlungen.sort((x, y) => (x.datum < y.datum ? -1 : x.datum > y.datum ? 1 : y.betrag_cent - x.betrag_cent));
  let saldo = 0;
  for (const z of zahlungen) {
    saldo += z.betrag_cent;
    z.saldo = saldo;
  }

  // Tagesreihe: heute 0, danach am Ende jedes Tages
  const tage: Tag[] = [];
  let i = 0;
  let wert = 0;
  for (let t = heute; t <= bis; t = plusTage(t, 1)) {
    const heuteZ: Zahlung[] = [];
    while (i < zahlungen.length && zahlungen[i].datum === t) {
      wert += zahlungen[i].betrag_cent;
      heuteZ.push(zahlungen[i++]);
    }
    tage.push({ datum: t, wert, zahlungen: heuteZ });
  }

  let engster = tage[0];
  for (const t of tage) if (t.wert < engster.wert) engster = t;

  let eingaenge = 0;
  let ausgaben = 0;
  let ausRechnungen = 0;
  let festeKosten = 0;
  for (const z of zahlungen) {
    if (z.betrag_cent > 0) {
      eingaenge += z.betrag_cent;
      if (z.art === 'rechnung') ausRechnungen += z.betrag_cent;
    } else {
      ausgaben -= z.betrag_cent;
      if (z.art === 'wiederkehrend') festeKosten -= z.betrag_cent;
    }
  }

  return {
    heute,
    bis,
    tage,
    zahlungen,
    eingaenge,
    ausgaben,
    ueberschuss: eingaenge - ausgaben,
    ausRechnungen,
    festeKosten,
    engster: { datum: engster.datum, wert: engster.wert },
    engpass: engster.wert <= ENGPASS_AB,
    verzug,
    verzugAuto,
    schnitt,
  };
}

/* ================= Kalenderwochen (ISO 8601, wie in Deutschland üblich) ================= */

const utc = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));

/** ISO-Kalenderwoche: Woche mit dem Donnerstag, Montag als erster Tag; Jahr der Woche kann vom Kalenderjahr abweichen. */
export function isoWoche(iso: string): { jahr: number; woche: number } {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // Donnerstag dieser Woche
  const jahr = d.getUTCFullYear();
  const woche = Math.ceil(((d.getTime() - Date.UTC(jahr, 0, 1)) / 86_400_000 + 1) / 7);
  return { jahr, woche };
}

/** Montag der Woche. */
export const wochenStart = (iso: string): string => plusTage(iso, -((utc(iso).getUTCDay() + 6) % 7));

/** „19.10.“ */
export const datumKurz = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
/** „Mo 19.10.“ */
export const tagKurz = (iso: string): string => `${WOCHENTAG[utc(iso).getUTCDay()]} ${datumKurz(iso)}`;

/** „KW 43 · 19.–25.10.“ bzw. über den Monatswechsel „KW 44 · 26.10.–01.11.“ */
export function kwText(start: string): string {
  const ende = plusTage(start, 6);
  const von = start.slice(5, 7) === ende.slice(5, 7) ? `${start.slice(8, 10)}.` : datumKurz(start);
  return `KW ${isoWoche(start).woche} · ${von}–${datumKurz(ende)}`;
}

export interface Woche {
  /** Montag */
  start: string;
  text: string;
  zahlungen: Zahlung[];
  /** Summe aller Zahlungen der Woche (auch Ø) */
  summe: number;
  /** Überschuss ab heute nach der letzten Zahlung der Woche */
  saldo: number;
}

/** Zahlungen (nach Datum sortiert, wie aus vorschau()) nach Kalenderwoche. */
export function nachWochen(zahlungen: readonly Zahlung[]): Woche[] {
  const out: Woche[] = [];
  for (const z of zahlungen) {
    const start = wochenStart(z.datum);
    let w = out[out.length - 1];
    if (!w || w.start !== start) out.push((w = { start, text: kwText(start), zahlungen: [], summe: 0, saldo: 0 }));
    w.zahlungen.push(z);
    w.summe += z.betrag_cent;
    w.saldo = z.saldo;
  }
  return out;
}

/** Nächster Termin eines wiederkehrenden Postens ab morgen (für die Liste), null wenn keiner im nächsten Jahr. */
export const naechsterTermin = (w: Pick<Wiederkehrend, 'vorlage' | 'rhythmus' | 'naechstes_datum'>, heute: string): string | null =>
  wiederkehrTermine(w, heute, plusTage(heute, 400))[0] ?? null;
