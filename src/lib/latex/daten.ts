/* daten.tex erzeugen (ANLEITUNG §7.1, §7.4): alle Werte eines Belegs als LaTeX-Makros, jedes immer definiert
 * (leer, wenn nicht vorhanden). Jeder Nutzerwert läuft durch escape.ts; Beträge sind fertig formatiert (`1.234,50\,€`).
 * Werte und Layout bleiben getrennt: main.tex (vorlage.ts) enthält keine Daten des Belegs, nur diese Makros.
 *
 * Zusätzlich zu §7.4 (für die Bausteine): \KundeAnzeige (Name, Quittung ohne Namen „Barverkauf“),
 * \KundeAdresseEinzeilig, \FirmaPLZ, \FirmaStadt, \LeistungsdatumLabel, \Zahlungsziel, \AnzahlPositionen,
 * \QuittungFuer, \Quittiert, \EigenbelegGrund, \GebuchtAls, \UnterschriftDatum, \Storniert (1 oder leer).
 * Tests: latex.test.ts */
import { formatBetrag } from '../money';
import { ibanFormat } from '../firma';
import {
  ARTEN,
  HINWEIS_19,
  belegSumme,
  datumText,
  eigenbelegGrundText,
  empfaenger,
  ersetzen,
  gebuchtText,
  leistungLabel,
  leistungText,
  mengeText,
  platzhalterWerte,
  positionBetrag,
  quittiertText,
  quittungFuer,
  unterschriftDatum,
  zahlungswegText,
  type BelegDokument,
} from '../vorlagen/dokument';
import { betragInWorten } from './zahl-in-worten';
import { betragLatex, escapeLatex } from './escape';

/** Einzeiliger Wert (Namen, Nummern, Adressteile): Umbrüche werden Leerzeichen, damit er auch in Tabellenzellen passt. */
const e1 = (s: string | null | undefined) => escapeLatex(s, { umbruch: 'einzeilig' });
/** Mehrzeiliger Text (Einleitung, Schlusstext …): Umbrüche ⇒ `\\{}`. */
const em = (s: string | null | undefined) => escapeLatex(s);

/** Reihenfolge wie §7.4, danach die Zusätze. */
export const MAKRO_NAMEN = [
  'Belegart', 'Nummer', 'Datum', 'Leistungsdatum', 'Faellig',
  'Firma', 'FirmaInhaber', 'FirmaStrasse', 'FirmaOrt', 'FirmaEmail', 'FirmaTelefon', 'FirmaWeb', 'Steuernummer', 'Bank', 'IBAN', 'BIC', 'LogoDatei',
  'KundeName', 'KundeZusatz', 'KundeStrasse', 'KundeOrt', 'Kundennummer',
  'Betreff', 'Einleitung', 'Positionen', 'Gesamt', 'BetragInWorten', 'Zahlungsart', 'Steuerhinweis', 'Zahlungshinweis',
  'Schlusstext', 'Gruss',
  'KundeAnzeige', 'KundeAdresseEinzeilig', 'FirmaPLZ', 'FirmaStadt', 'LeistungsdatumLabel', 'Zahlungsziel', 'AnzahlPositionen',
  'QuittungFuer', 'Quittiert', 'EigenbelegGrund', 'GebuchtAls', 'UnterschriftDatum', 'Storniert',
] as const;

export type MakroName = (typeof MAKRO_NAMEN)[number];

/** Folge von \Position{Nr}{Beschreibung}{Menge}{Einheit}{Einzelpreis}{Gesamt} (§7.4). */
export function positionenTex(doc: Pick<BelegDokument, 'positionen'>): string {
  return doc.positionen
    .map((p, i) =>
      `  \\Position{${i + 1}}{${escapeLatex(p.beschreibung, { umbruch: 'newline' })}}{${mengeText(p.menge)}}{${e1(p.einheit)}}` +
      `{${betragLatex(p.einzelpreis_cent)}}{${betragLatex(positionBetrag(p))}}%`,
    )
    .join('\n');
}

/** Werte aller Makros (schon LaTeX, also escaped). */
export function makroWerte(doc: BelegDokument): Record<MakroName, string> {
  const F = doc.firma;
  const k = doc.kunde;
  const emp = empfaenger(doc);
  const s = belegSumme(doc);
  const werte = platzhalterWerte(doc);
  const rechnungOffen = doc.art === 'rechnung' && !doc.quittiert;
  const firmaOrt = [F.plz.trim(), F.ort.trim()].filter(Boolean).join(' ');
  return {
    Belegart: e1(ARTEN[doc.art].label),
    Nummer: e1(doc.nummer),
    Datum: e1(datumText(doc.datum)),
    Leistungsdatum: e1(leistungText(doc)),
    Faellig: e1(datumText(doc.faellig_am)),
    Firma: e1(F.name),
    FirmaInhaber: e1(F.inhaber),
    FirmaStrasse: e1(F.strasse),
    FirmaOrt: e1(firmaOrt),
    FirmaEmail: e1(F.email),
    FirmaTelefon: e1(F.telefon),
    FirmaWeb: e1(F.web),
    Steuernummer: e1(F.steuernummer),
    Bank: e1(F.bank),
    IBAN: e1(F.iban ? ibanFormat(F.iban) : ''),
    BIC: e1(F.bic),
    // Firmenlogo folgt mit der Logo-Ablage (offen aus Phase 1); der Baustein „Kopf“ bindet es ein, sobald es hier steht
    LogoDatei: '',
    KundeName: e1(k?.name),
    KundeZusatz: e1(k?.zusatz),
    KundeStrasse: e1(k?.strasse),
    KundeOrt: e1(emp.ort),
    Kundennummer: e1(emp.nummer),
    Betreff: em(doc.betreff),
    Einleitung: em(doc.einleitung),
    Positionen: positionenTex(doc),
    Gesamt: betragLatex(s),
    BetragInWorten: e1(betragInWorten(s)),
    Zahlungsart: e1(zahlungswegText(doc.quittiert?.zahlungsweg ?? doc.zahlungsweg)),
    Steuerhinweis: doc.ust_modus === 'klein' ? e1(HINWEIS_19) : '',
    Zahlungshinweis: rechnungOffen
      ? em(ersetzen('Bitte überweisen Sie den Betrag bis zum {faellig} unter Angabe der Rechnungsnummer.', werte))
      : '',
    Schlusstext: em(doc.schlusstext),
    Gruss: em(ersetzen('Mit freundlichen Grüßen\n{inhaber}', werte)),
    KundeAnzeige: e1(emp.anzeige),
    KundeAdresseEinzeilig: e1(emp.zeilen.join(', ')),
    FirmaPLZ: e1(F.plz),
    FirmaStadt: e1(F.ort),
    LeistungsdatumLabel: e1(leistungLabel(doc)),
    Zahlungsziel: e1(werte.zahlungsziel),
    AnzahlPositionen: String(doc.positionen.length),
    QuittungFuer: em(quittungFuer(doc)),
    Quittiert: e1(quittiertText(doc)),
    EigenbelegGrund: e1(eigenbelegGrundText(doc)),
    GebuchtAls: e1(gebuchtText(doc)),
    UnterschriftDatum: e1(unterschriftDatum(doc)),
    Storniert: doc.storniert ? '1' : '',
  };
}

/** Inhalt von daten.tex. */
export function datenTex(doc: BelegDokument): string {
  const w = makroWerte(doc);
  const zeilen = MAKRO_NAMEN.map((n) =>
    n === 'Positionen'
      ? w.Positionen
        ? `\\newcommand{\\Positionen}{%\n${w.Positionen}\n}`
        : '\\newcommand{\\Positionen}{}'
      : `\\newcommand{\\${n}}{${w[n]}}`,
  );
  return `% automatisch erzeugt – nicht bearbeiten (Kladdy, ${ARTEN[doc.art].label}, Summe ${formatBetrag(belegSumme(doc), { waehrung: false })})\n${zeilen.join('\n')}\n`;
}
