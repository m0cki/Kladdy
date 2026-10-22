/* Inhalt des GiroCodes nach EPC069-12 „Quick Response Code“, Version 002 (ANLEITUNG §6.6; Prototyp qr.js → epc).
 * Zeilen, getrennt durch LF: BCD · 002 · 1 (UTF-8) · SCT · BIC (in Version 002 optional) · Name (max. 70 Zeichen) ·
 * IBAN · EUR<Betrag> (EUR0.01 bis EUR999999999.99) · Zweckcode · strukturierte Referenz · Verwendungszweck
 * (max. 140 Zeichen). Leere Zeilen am Ende fallen weg, zusammen höchstens 331 Byte.
 * - Betrag in Cent (Integer); der Text „153.00“ entsteht aus Ganzzahlen, ohne Float.
 * - Umbrüche und Mehrfach-Leerzeichen in Name/Zweck werden ein Leerzeichen: kein Wert kann eine Zeile einschieben.
 * - IBAN (Länge je Land, Prüfziffer mod 97) und BIC prüft firma.ts – dieselben Meldungen wie in Einstellungen › Firma.
 * Fehler sind deutsche Sätze fürs Formular, nie fürs Blatt. Tests: girocode.test.ts */
import { feldFehler, ibanFehler } from '../firma';

export const EPC_MAX_BYTE = 331;
/** 999.999.999,99 € */
export const EPC_MAX_CENT = 99_999_999_999;

export interface EpcDaten {
  /** Zahlungsempfänger */
  name: string;
  iban: string;
  bic?: string;
  /** 1 bis 99.999.999.999 Cent */
  betrag_cent: number;
  /** unstrukturierter Verwendungszweck (Rechnungsnummer) */
  zweck?: string;
}

export type EpcErgebnis = { ok: true; payload: string } | { ok: false; fehler: string[] };

const einzeilig = (s: string | undefined): string => String(s ?? '').replace(/\s+/g, ' ').trim();
const kompakt = (s: string | undefined): string => String(s ?? '').replace(/\s+/g, '').toUpperCase();
/** Zeichen wie die EPC-Grenzen sie zählen (Unicode-Zeichen, nicht UTF-16-Einheiten) */
const zeichen = (s: string): number => Array.from(s).length;

/** 15300 ⇒ „EUR153.00“ */
export function epcBetrag(cent: number): string {
  const rest = cent % 100;
  return `EUR${(cent - rest) / 100}.${String(rest).padStart(2, '0')}`;
}

/** EPC-Text aus den Daten oder alle Fehler auf einmal. */
export function epcPayload(d: EpcDaten): EpcErgebnis {
  const fehler: string[] = [];
  const name = einzeilig(d.name);
  const iban = kompakt(d.iban);
  const bic = kompakt(d.bic);
  const zweck = einzeilig(d.zweck);
  const cent = d.betrag_cent;

  if (!name) fehler.push('Der Name des Zahlungsempfängers fehlt (Einstellungen › Firma).');
  else if (zeichen(name) > 70) fehler.push('Der Name ist für den GiroCode zu lang (höchstens 70 Zeichen).');
  if (!iban) fehler.push('Die IBAN fehlt (Einstellungen › Firma).');
  else {
    const f = ibanFehler(iban);
    if (f) fehler.push(f);
  }
  if (bic) {
    const f = feldFehler('bic', bic);
    if (f) fehler.push(f);
  }
  const betragOk = Number.isSafeInteger(cent) && cent >= 1 && cent <= EPC_MAX_CENT;
  if (cent === 0) fehler.push('Der Betrag ist 0,00 € – ohne Betrag gibt es keinen GiroCode.');
  else if (!betragOk) fehler.push('Der Betrag muss zwischen 0,01 € und 999.999.999,99 € liegen.');
  if (zeichen(zweck) > 140) fehler.push('Der Verwendungszweck ist zu lang (höchstens 140 Zeichen).');

  // Kennung, Version, Zeichensatz, Art, BIC, Name, IBAN, Betrag, Zweckcode, Referenz, Verwendungszweck
  const zeilen = ['BCD', '002', '1', 'SCT', bic, name, iban, betragOk ? epcBetrag(cent) : '', '', '', zweck];
  while (zeilen[zeilen.length - 1] === '') zeilen.pop();
  const payload = zeilen.join('\n');
  if (new TextEncoder().encode(payload).length > EPC_MAX_BYTE) {
    fehler.push(`Der GiroCode wird zu lang (höchstens ${EPC_MAX_BYTE} Byte) – Name oder Verwendungszweck kürzen.`);
  }
  return fehler.length ? { ok: false, fehler } : { ok: true, payload };
}
