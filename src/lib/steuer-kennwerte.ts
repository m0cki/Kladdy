/* Steuer-Kennwerte pro Jahr (ANLEITUNG §2.6, Tabelle steuer_parameter in §5, Startwerte 2026 in Migration 0002).
 * Gespeichert je (jahr, schluessel) als JSON-Zahl im Text: Geld in Cent, Anteile in ganzen Prozent.
 * Reine Logik: Liste der Kennwerte, Anzeigen/Lesen der Eingaben, neues Jahr vorschlagen. Tests: steuer-kennwerte.test.ts */
import { formatBetrag, parseBetrag } from './money';

export type KennwertEinheit = 'cent' | 'prozent';

export interface Kennwert {
  schluessel: string;
  label: string;
  einheit: KennwertEinheit;
  /** kurze Erläuterung wie in §2.6 */
  hinweis?: string;
}

/** Reihenfolge wie die Tabelle in §2.6. Neue Kennwerte hier und per Migration (für vorhandene Jahre) ergänzen. */
export const KENNWERTE: readonly Kennwert[] = [
  { schluessel: 'ku_grenze_vorjahr_cent', label: 'Kleinunternehmer: Grenze Vorjahr', einheit: 'cent', hinweis: 'Umsatz im Vorjahr höchstens' },
  { schluessel: 'ku_grenze_laufend_cent', label: 'Kleinunternehmer: Grenze laufendes Jahr', einheit: 'cent', hinweis: 'Umsatz im laufenden Jahr höchstens' },
  { schluessel: 'kleinbetragsrechnung_cent', label: 'Kleinbetragsrechnung', einheit: 'cent', hinweis: 'bis zu diesem Betrag brutto' },
  { schluessel: 'gwg_grenze_netto_cent', label: 'Geringwertige Wirtschaftsgüter', einheit: 'cent', hinweis: 'Sofortabzug bis zu diesem Betrag netto' },
  { schluessel: 'gewst_freibetrag_cent', label: 'Gewerbesteuer-Freibetrag', einheit: 'cent', hinweis: 'Gewinn, Einzelunternehmen' },
  { schluessel: 'bewirtung_abziehbar_prozent', label: 'Bewirtung', einheit: 'prozent', hinweis: 'abziehbarer Anteil' },
  { schluessel: 'geschenke_grenze_cent', label: 'Geschenke an Geschäftspartner', einheit: 'cent', hinweis: 'pro Empfänger und Jahr' },
  { schluessel: 'homeoffice_tag_cent', label: 'Homeoffice-Tagespauschale', einheit: 'cent', hinweis: 'pro Tag' },
  { schluessel: 'homeoffice_max_jahr_cent', label: 'Homeoffice-Pauschale höchstens', einheit: 'cent', hinweis: 'pro Jahr' },
  { schluessel: 'km_pauschale_cent', label: 'Dienstreise mit Privat-Pkw', einheit: 'cent', hinweis: 'pro km' },
  { schluessel: 'verpflegung_8h_cent', label: 'Verpflegungspauschale über 8 Std.', einheit: 'cent', hinweis: 'Inland' },
  { schluessel: 'verpflegung_24h_cent', label: 'Verpflegungspauschale 24 Std.', einheit: 'cent', hinweis: 'Inland' },
  { schluessel: 'ihk_beitragsfrei_bis_cent', label: 'IHK-Beitrag', einheit: 'cent', hinweis: 'beitragsfrei bis zu diesem Gewerbeertrag' },
  { schluessel: 'buchfuehrungspflicht_umsatz_cent', label: 'Buchführungspflicht ab Umsatz', einheit: 'cent', hinweis: 'statt EÜR' },
  { schluessel: 'buchfuehrungspflicht_gewinn_cent', label: 'Buchführungspflicht ab Gewinn', einheit: 'cent', hinweis: 'statt EÜR' },
];

/** Werte eines Jahres: schluessel → Zahl (Cent bzw. Prozent). */
export type KennwerteJahr = Record<string, number>;

/** Gespeicherten Text ('2500000') als Zahl lesen; null, wenn er keine ganze, nicht negative Zahl ist. */
export function kennwertAusText(wert: string | null | undefined): number | null {
  if (wert == null || !/^\d+$/.test(wert.trim())) return null;
  const n = Number(wert.trim());
  return Number.isSafeInteger(n) ? n : null;
}

/** Zeilen aus steuer_parameter nach Jahr gruppieren (aufsteigend). Unlesbare Werte werden ausgelassen. */
export function kennwerteNachJahr(zeilen: readonly { jahr: number; schluessel: string; wert: string }[]): Map<number, KennwerteJahr> {
  const jahre = new Map<number, KennwerteJahr>();
  for (const z of [...zeilen].sort((a, b) => a.jahr - b.jahr)) {
    const w = kennwertAusText(z.wert);
    if (!jahre.has(z.jahr)) jahre.set(z.jahr, {});
    if (w !== null) jahre.get(z.jahr)![z.schluessel] = w;
  }
  return jahre;
}

/** Wert für das Eingabefeld: Cent als „25.000,00“ (ohne €, das steht daneben), Prozent als „70“. */
export function kennwertAlsEingabe(wert: number, einheit: KennwertEinheit): string {
  return einheit === 'cent' ? formatBetrag(wert, { waehrung: false }) : String(wert);
}

/** Eingabe lesen: { wert } oder { fehler } (deutsch). Beträge über money.ts, nie als Float. */
export function kennwertLesen(eingabe: string, einheit: KennwertEinheit): { wert: number } | { fehler: string } {
  if (!eingabe.trim()) return { fehler: 'Bitte einen Wert eintragen.' };
  if (einheit === 'prozent') {
    const t = eingabe.replace(/[\s%]/g, '');
    if (!/^\d+$/.test(t)) return { fehler: 'Bitte eine ganze Prozentzahl eintragen.' };
    const n = Number(t);
    return n <= 100 ? { wert: n } : { fehler: 'Höchstens 100 %.' };
  }
  const cent = parseBetrag(eingabe);
  if (cent === null) return { fehler: 'Bitte einen Betrag eintragen, z. B. 25.000 oder 0,30.' };
  if (cent < 0) return { fehler: 'Der Betrag darf nicht negativ sein.' };
  return { wert: cent };
}

export const JAHR_MIN = 2000;
export const JAHR_MAX = 2100;

/** Vorschlag für „Jahr anlegen“: das aktuelle Jahr, wenn es fehlt, sonst das Jahr nach dem neuesten. */
export function jahrVorschlag(jahre: readonly number[], aktuell: number): number {
  if (!jahre.includes(aktuell)) return aktuell;
  return Math.max(...jahre) + 1;
}

/** Fehler beim Anlegen eines Jahres oder null. `was` = was es je Jahr gibt (auch für die EÜR-Zuordnung, lib/kategorien.ts). */
export function jahrFehler(jahr: number, jahre: readonly number[], was = 'Kennwerte'): string | null {
  if (!Number.isInteger(jahr) || jahr < JAHR_MIN || jahr > JAHR_MAX) return `Bitte ein Jahr zwischen ${JAHR_MIN} und ${JAHR_MAX} eintragen.`;
  if (jahre.includes(jahr)) return `Für ${jahr} gibt es schon ${was}.`;
  return null;
}

/** Angezeigtes Jahr einer Tabelle pro Jahr: das laufende, wenn es dafür Werte gibt, sonst das neueste (null = noch keins). */
export const anzeigeJahr = (jahre: readonly number[], aktuell: number): number | null =>
  jahre.includes(aktuell) ? aktuell : jahre.length ? Math.max(...jahre) : null;

/**
 * Aus welchem Jahr ein neues Jahr seine Werte übernimmt: das nächstältere vorhandene Jahr,
 * sonst (neues Jahr liegt vor allen anderen) das älteste. null, wenn es noch keine Jahre gibt.
 */
export function kopierQuelle(jahre: readonly number[], neu: number): number | null {
  const frueher = jahre.filter((j) => j < neu);
  if (frueher.length) return Math.max(...frueher);
  return jahre.length ? Math.min(...jahre) : null;
}
