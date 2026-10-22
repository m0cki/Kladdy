/* Daten-Quellen der Suche ⌘K (§6.2): Zeilen aus lib/queries/suche.ts ⇒ SuchEintraege (art 'daten') mit Gruppe,
 * Untertitel, rechter Betragsspalte, Stichwörtern und Sprungziel. Reine Logik ohne React, getestet in suche-daten.test.ts.
 * - Beträge sind Cent; als Stichwörter stehen sie deutsch („1.234,56“, „1234,56“, „1.234,56 €“) und mit Punkt
 *   („1234.56“) drin, so findet „49,90“ oder „49“ den Betrag 49,90 €.
 * - Kunden per ID: Name und Nummer kommen aus der Tabelle kunden (Join über kunde_id), bei Belegen zusätzlich der
 *   Schnappschuss-Name als Stichwort.
 * - Reihenfolge der Zeilen = neueste zuerst (macht die Abfrage); die Suche behält sie bei gleicher Bewertung bei.
 * - Sprungziele: Buchung ⇒ dieselbe Schublade wie ein Klick auf die Zeile (bearbeiten), Kunde ⇒ Kunden-Schublade,
 *   Beleg ⇒ Beleg-Maske /belege/<id> (wie der Beleg-Nr.-Link in Ein- & Ausgänge), Termin ⇒ /termine?t=<id>,
 *   Kennzahl ⇒ /auswertung/kennzahlen?k=<id>. Termine öffnen dort die Termin-Schublade, Kennzahlen werten den
 *   Parameter ab Phase 4 aus. */
import { datumKurz, typName, zahlungswegName, type BuchungTyp, type Zahlungsart } from './buchungen';
import { formatBetrag } from './money';
import type { SuchEintrag } from './suche';

/* ---------- Zeilen (lib/queries/suche.ts) ---------- */

export interface SuchBuchung {
  id: number;
  nummer: string;
  typ: BuchungTyp;
  zahlungsdatum: string;
  betrag_cent: number;
  beschreibung: string;
  belegnummer: string | null;
  rechnung_nummer: string | null;
  kategorie_name: string;
  kunde_name: string | null;
  kunde_nummer: string | null;
  lieferant: string | null;
  zahlungsart: Zahlungsart | null;
  /** 1 = es gibt eine Storno-Gegenbuchung */
  storniert: number;
}

export type BelegArt = 'rechnung' | 'quittung' | 'angebot' | 'eigenbeleg' | 'gutschrift' | 'storno';
export type BelegStatus = 'entwurf' | 'offen' | 'bezahlt' | 'storniert' | 'angenommen' | 'abgelehnt';

export interface SuchBeleg {
  id: number;
  art: BelegArt;
  /** null = Entwurf */
  nummer: string | null;
  status: BelegStatus;
  /** Belegdatum, bei Entwürfen ohne Datum der Tag der Anlage */
  datum: string;
  /** Betreff, sonst erste Position */
  betreff: string | null;
  /** aktueller Name über kunde_id */
  kunde_name: string | null;
  kunde_nummer: string | null;
  /** Schnappschuss beim Ausstellen bzw. Geschäft beim Eigenbeleg */
  beleg_name: string | null;
  summe_cent: number;
  faellig_am: string | null;
}

export interface SuchTermin {
  id: number;
  datum: string;
  von: string | null;
  bis: string | null;
  leistung: string;
  status: 'geplant' | 'erledigt' | 'abgesagt';
  kunde_name: string | null;
  kunde_nummer: string | null;
  adresse: string | null;
}

export interface SuchKunde {
  id: number;
  nummer: string;
  name: string;
  zusatz: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  email: string | null;
  telefon: string | null;
}

export interface SuchKennzahl {
  id: number;
  name: string;
  formel: string;
  beschreibung: string | null;
}

export interface SuchDaten {
  buchungen: SuchBuchung[];
  belege: SuchBeleg[];
  termine: SuchTermin[];
  kunden: SuchKunde[];
  kennzahlen: SuchKennzahl[];
}

export const LEERE_SUCHDATEN: SuchDaten = { buchungen: [], belege: [], termine: [], kunden: [], kennzahlen: [] };

/* ---------- Einträge ---------- */

export type Sprung =
  | { art: 'buchung'; id: number }
  | { art: 'kunde'; id: number }
  | { art: 'beleg'; id: number }
  | { art: 'termin'; id: number }
  | { art: 'kennzahl'; id: number };

/** Welches Symbol die Zeile bekommt (Suche.tsx macht daraus ein Icon bzw. beim Kunden das Monogramm). */
export type DatenSymbol = 'einnahme' | 'ausgabe' | BelegArt | 'termin' | 'kunde' | 'kennzahl';

export interface DatenEintrag extends SuchEintrag {
  art: 'daten';
  sprung: Sprung;
  symbol: DatenSymbol;
  /** rechte Spalte, z. B. „+49,90 €“ – Vorzeichen als Zeichen (+ bzw. −), nie nur über Farbe */
  rechts?: string;
  /** storniert: „storniert“ im Untertitel, Betrag durchgestrichen */
  storniert?: boolean;
}

export const GRUPPE = {
  buchungen: 'Ein- & Ausgänge',
  belege: 'Belege',
  termine: 'Termine',
  kunden: 'Kunden',
  kennzahlen: 'Kennzahlen',
} as const;

/** Höchstzahl je Daten-Gruppe (wie im Prototyp). */
export const DATEN_LIMITS: Readonly<Record<string, number>> = {
  [GRUPPE.buchungen]: 6,
  [GRUPPE.belege]: 6,
  [GRUPPE.termine]: 4,
  [GRUPPE.kunden]: 5,
  [GRUPPE.kennzahlen]: 4,
};

const teil = (...xs: (string | null | undefined | false)[]): string[] => xs.filter((x): x is string => !!x && !!x.trim());

/** Stichwörter zu einem Centbetrag: „1.234,56“, „1234,56“, „1234.56“, „1.234,56 €“ (ohne Vorzeichen). */
export function betragStichworte(cent: number): string[] {
  const de = formatBetrag(cent, { waehrung: false, vorzeichen: 'nie' });
  const ohnePunkt = de.replace(/\./g, '');
  return [...new Set([de, ohnePunkt, ohnePunkt.replace(',', '.'), formatBetrag(cent, { vorzeichen: 'nie' })])];
}

export function buchungEintrag(b: SuchBuchung): DatenEintrag {
  const wer = b.typ === 'einnahme' ? b.kunde_name : b.lieferant;
  const nr = b.belegnummer || b.rechnung_nummer || b.nummer;
  const storniert = !!b.storniert;
  return {
    id: `buchung:${b.id}`,
    art: 'daten',
    gruppe: GRUPPE.buchungen,
    label: b.beschreibung,
    sub: teil(nr, datumKurz(b.zahlungsdatum), b.kategorie_name, wer && !b.beschreibung.includes(wer) && wer, storniert && 'storniert').join(' · '),
    keywords: teil(
      b.nummer,
      b.belegnummer,
      b.rechnung_nummer,
      b.kunde_name,
      b.kunde_nummer,
      b.lieferant,
      b.kategorie_name,
      b.zahlungsart && zahlungswegName(b.zahlungsart),
      typName(b.typ),
      b.zahlungsdatum,
      ...betragStichworte(b.betrag_cent),
    ),
    sprung: { art: 'buchung', id: b.id },
    symbol: b.typ,
    rechts: formatBetrag(b.typ === 'einnahme' ? b.betrag_cent : -b.betrag_cent, { vorzeichen: 'immer' }),
    storniert,
  };
}

export const BELEG_ART_NAME: Readonly<Record<BelegArt, string>> = {
  rechnung: 'Rechnung',
  quittung: 'Quittung',
  angebot: 'Angebot',
  eigenbeleg: 'Eigenbeleg',
  gutschrift: 'Gutschrift',
  storno: 'Storno',
};

/** Status als Text; offene Rechnungen nach Fälligkeit „überfällig“. */
export function belegStatusText(r: Pick<SuchBeleg, 'status' | 'faellig_am'>, heute: string): string {
  if (r.status === 'offen' && r.faellig_am && r.faellig_am < heute) return 'überfällig';
  return r.status === 'entwurf' ? 'Entwurf' : r.status;
}

/** Betrag mit Richtung: Rechnung/Quittung = Einnahme (+), Eigenbeleg/Gutschrift = Ausgabe (−), sonst ohne Richtung. */
export function belegBetrag(r: Pick<SuchBeleg, 'art' | 'summe_cent'>): string {
  if (r.art === 'rechnung' || r.art === 'quittung') return formatBetrag(r.summe_cent, { vorzeichen: 'immer' });
  if (r.art === 'eigenbeleg' || r.art === 'gutschrift') return formatBetrag(-r.summe_cent, { vorzeichen: 'immer' });
  return formatBetrag(r.summe_cent);
}

export function belegEintrag(r: SuchBeleg, heute: string): DatenEintrag {
  const artName = BELEG_ART_NAME[r.art];
  const wer = r.kunde_name || r.beleg_name || (r.art === 'quittung' || r.art === 'rechnung' ? 'Barverkauf' : '');
  const storniert = r.status === 'storniert';
  return {
    id: `beleg:${r.id}`,
    art: 'daten',
    gruppe: GRUPPE.belege,
    label: `${r.nummer ?? 'Entwurf'} · ${r.betreff?.trim() || artName}`,
    sub: teil(artName, wer, datumKurz(r.datum), belegStatusText(r, heute)).join(' · '),
    keywords: teil(artName, r.kunde_name, r.kunde_nummer, r.beleg_name, r.datum, r.nummer ? null : 'ohne Nummer', ...betragStichworte(r.summe_cent)),
    sprung: { art: 'beleg', id: r.id },
    symbol: r.art,
    rechts: belegBetrag(r),
    storniert,
  };
}

/** Status eines Termins: geplant in der Vergangenheit = „nachtragen“. */
export function terminStatusText(t: Pick<SuchTermin, 'status' | 'datum'>, heute: string): string {
  if (t.status === 'geplant') return t.datum < heute ? 'nachtragen' : 'geplant';
  return t.status === 'erledigt' ? 'erledigt ✓' : t.status;
}

export function terminEintrag(t: SuchTermin, heute: string): DatenEintrag {
  const zeit = t.von ? (t.bis ? `${t.von}–${t.bis}` : t.von) : null;
  return {
    id: `termin:${t.id}`,
    art: 'daten',
    gruppe: GRUPPE.termine,
    label: teil(t.leistung, t.kunde_name).join(' · '),
    sub: teil(datumKurz(t.datum), zeit, terminStatusText(t, heute)).join(' · '),
    keywords: teil(t.kunde_nummer, t.adresse, t.datum),
    sprung: { art: 'termin', id: t.id },
    symbol: 'termin',
  };
}

export function kundeEintrag(k: SuchKunde): DatenEintrag {
  const ort = teil(k.plz, k.ort).join(' ');
  const adresse = teil(k.strasse, ort).join(', ');
  return {
    id: `kunde:${k.id}`,
    art: 'daten',
    gruppe: GRUPPE.kunden,
    label: k.name,
    sub: teil(k.nummer, adresse || 'Kunde').join(' · '),
    keywords: teil(k.nummer, k.zusatz, k.strasse, k.plz, k.ort, k.email, k.telefon),
    sprung: { art: 'kunde', id: k.id },
    symbol: 'kunde',
  };
}

/** Kennzahl: nur Name und Formel – den Wert rechnet erst der Formel-Parser aus Phase 4. */
export function kennzahlEintrag(k: SuchKennzahl): DatenEintrag {
  return {
    id: `kennzahl:${k.id}`,
    art: 'daten',
    gruppe: GRUPPE.kennzahlen,
    label: k.name,
    sub: k.formel,
    keywords: teil(k.beschreibung),
    sprung: { art: 'kennzahl', id: k.id },
    symbol: 'kennzahl',
  };
}

/** Alle Daten-Einträge (abgesagte Termine fallen weg). */
export function datenEintraege(d: SuchDaten, heute: string): DatenEintrag[] {
  return [
    ...d.buchungen.map(buchungEintrag),
    ...d.belege.map((r) => belegEintrag(r, heute)),
    ...d.termine.filter((t) => t.status !== 'abgesagt').map((t) => terminEintrag(t, heute)),
    ...d.kunden.map(kundeEintrag),
    ...d.kennzahlen.map(kennzahlEintrag),
  ];
}

/** Adresse für Sprünge auf eine Seite; null bei Buchung/Kunde (die öffnen ihre Schublade). */
export function sprungPfad(s: Sprung): string | null {
  switch (s.art) {
    case 'beleg':
      return `/belege/${s.id}`;
    case 'termin':
      return `/termine?t=${s.id}`;
    case 'kennzahl':
      return `/auswertung/kennzahlen?k=${s.id}`;
    default:
      return null;
  }
}
