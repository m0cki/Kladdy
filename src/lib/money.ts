/* Geld (ANLEITUNG §3, CLAUDE.md): Beträge sind IMMER ganze Cent (Integer). Keine Floats zum Rechnen.
 * - parseBetrag: Eingabe wie „1.234,56“, „12,5“, „47,83 €“, „−3“ → Cent (null = leer oder unlesbar)
 * - formatBetrag: Cent → „1.234,56 €“ (de-DE, echtes Minus U+2212, geschütztes Leerzeichen vor €)
 * - summe, anteil: Rechnen nur mit sicheren Ganzzahlen; alles andere ist ein Programmfehler und wirft.
 * Tests: money.test.ts */

/** Echtes Minuszeichen für Anzeigen (CLAUDE.md). */
export const MINUS = '−';
/** Geschütztes Leerzeichen zwischen Betrag und €, wie Intl.NumberFormat('de-DE', { currency: 'EUR' }). */
const NBSP = ' ';

/** Wirft, wenn `cent` kein sicherer Ganzzahl-Centbetrag ist (z. B. 12.5 oder NaN). */
export function pruefeCent(cent: number, wo = 'Betrag'): number {
  if (!Number.isSafeInteger(cent)) throw new RangeError(`${wo}: ${cent} ist kein ganzer Centbetrag`);
  return cent;
}

/**
 * Betrag aus einer Eingabe lesen → Cent.
 * Erlaubt: „12“, „12,5“, „12,50“, „1.234,56“, „1234,56“, „12.50“, „1,234.56“, „,5“, „47,83 €“, „€ 5“,
 * Vorzeichen „−“ (U+2212), „-“ oder „+“. Leerzeichen (auch geschützte) werden ignoriert.
 * Regeln wie im Prototyp (pages/buchungen.js → parseMoney): stehen Komma und Punkt drin, trennt das hintere die Cent ab;
 * ein einzelner Punkt mit genau drei Ziffern dahinter ist ein Tausenderpunkt („1.234“ = 1.234 €). Tausender nur in
 * Dreiergruppen, höchstens zwei Nachkommastellen – „1,234“, „1.23,45“ oder „1,2,3“ sind Tippfehler ⇒ null.
 */
export function parseBetrag(eingabe: string | null | undefined): number | null {
  let s = String(eingabe ?? '').replace(/[\s  €]/g, '');
  if (!s) return null;
  let negativ = false;
  if (/^[-−+]/.test(s)) {
    negativ = s[0] !== '+';
    s = s.slice(1);
  }
  if (!/^(\d[\d.,]*|[.,]\d+)$/.test(s)) return null;

  const iKomma = s.lastIndexOf(',');
  const iPunkt = s.lastIndexOf('.');
  let dez = -1;
  if (iKomma >= 0 && iPunkt >= 0) dez = Math.max(iKomma, iPunkt);
  else if (iKomma >= 0) dez = s.indexOf(',') === iKomma ? iKomma : -1;
  else if (iPunkt >= 0) dez = s.indexOf('.') === iPunkt && s.length - iPunkt - 1 !== 3 ? iPunkt : -1;

  const kopf = dez >= 0 ? s.slice(0, dez) : s;
  const nachkomma = dez >= 0 ? s.slice(dez + 1) : '';
  if (/[.,]/.test(kopf) && !/^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.test(kopf)) return null;
  if (/[.,]/.test(nachkomma) || nachkomma.length > 2) return null;

  const euro = kopf.replace(/[.,]/g, '') || '0';
  const cent = (nachkomma + '00').slice(0, 2);
  // Über Ziffern-Strings statt Multiplikation mit 100: kein Float-Rundungsfehler möglich.
  const wert = Number(euro + cent);
  if (!Number.isSafeInteger(wert)) return null;
  return negativ && wert !== 0 ? -wert : wert;
}

export interface FormatOptionen {
  /** 'auto' (Standard): nur „−“ bei negativen Beträgen · 'immer': auch „+“ bei positiven · 'nie': Betrag ohne Vorzeichen */
  vorzeichen?: 'auto' | 'immer' | 'nie';
  /** € anhängen (Standard true) */
  waehrung?: boolean;
  /** Nachkommastellen 2 (Standard) oder 0 (kaufmännisch auf ganze Euro gerundet, z. B. für Achsen) */
  nachkomma?: 0 | 2;
}

const gruppierer = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0, useGrouping: true });

/** Ganze Euro mit Tausenderpunkten. Number-Formatierung einer Ganzzahl ist exakt. */
const gruppiert = (euro: number): string => gruppierer.format(euro);

/**
 * Cent → Anzeige, z. B. 123456 → „1.234,56 €“, −300 → „−3,00 €“.
 * Rechnet ohne Division durch 100 als Float: Euro und Cent werden als Ganzzahlen getrennt.
 */
export function formatBetrag(cent: number, optionen: FormatOptionen = {}): string {
  pruefeCent(cent);
  const { vorzeichen = 'auto', waehrung = true, nachkomma = 2 } = optionen;
  let betrag = Math.abs(cent);
  if (nachkomma === 0) betrag = rundeAufEuro(betrag);
  const euro = Math.trunc(betrag / 100);
  const rest = betrag % 100;
  let text = gruppiert(euro);
  if (nachkomma === 2) text += ',' + String(rest).padStart(2, '0');
  if (waehrung) text += NBSP + '€';
  const istNull = nachkomma === 0 ? euro === 0 : betrag === 0;
  if (vorzeichen === 'nie' || istNull) return text;
  if (cent < 0) return MINUS + text;
  return vorzeichen === 'immer' ? '+' + text : text;
}

/** Positive Cent kaufmännisch auf volle 100 runden (50 Cent aufwärts). */
function rundeAufEuro(betrag: number): number {
  const rest = betrag % 100;
  return rest >= 50 ? betrag - rest + 100 : betrag - rest;
}

/** Cent als Eingabetext für Formularfelder, z. B. 123456 → „1234,56“ (ohne Tausenderpunkte, ohne €). */
export function betragAlsEingabe(cent: number): string {
  pruefeCent(cent);
  const betrag = Math.abs(cent);
  const text = `${Math.trunc(betrag / 100)},${String(betrag % 100).padStart(2, '0')}`;
  return cent < 0 ? '-' + text : text;
}

/** Summe von Centbeträgen. Wirft bei Nicht-Ganzzahlen oder wenn das Ergebnis den sicheren Bereich verlässt. */
export function summe(betraege: Iterable<number>): number {
  let s = 0;
  for (const b of betraege) {
    s += pruefeCent(b, 'Summand');
    if (!Number.isSafeInteger(s)) throw new RangeError('Summe außerhalb des sicheren Bereichs');
  }
  return s;
}

/**
 * Prozentanteil eines Centbetrags, kaufmännisch gerundet (halbe Cent vom Nullpunkt weg), nur mit Ganzzahlen.
 * Beispiel: anteil(1999, 70) = 1399 (Bewirtung 70 %), anteil(−5, 50) = −3.
 * `prozent` muss eine Ganzzahl sein (Spalten abziehbar_prozent, privatanteil_prozent sind INTEGER).
 */
export function anteil(cent: number, prozent: number): number {
  pruefeCent(cent);
  if (!Number.isSafeInteger(prozent)) throw new RangeError(`Prozent: ${prozent} ist keine Ganzzahl`);
  const produkt = cent * prozent;
  if (!Number.isSafeInteger(produkt)) throw new RangeError('Anteil außerhalb des sicheren Bereichs');
  const vz = produkt < 0 ? -1 : 1;
  const abs = Math.abs(produkt);
  const ganz = (abs - (abs % 100)) / 100;
  return vz * (abs % 100 >= 50 ? ganz + 1 : ganz) || 0;
}
