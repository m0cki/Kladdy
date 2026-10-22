/* Beispieldaten für Vorschau und „Testbeleg erzeugen“ (Einstellungen › Daten, später die Vorlagen-Seite).
 * Der Testbeleg ist absichtlich unbequem: Kunde „Müller & Söhne 100%“ (§7.1, Abnahme Phase 3) und Positionen mit allen
 * LaTeX-Sonderzeichen, damit ein Fehler im Escaping sofort beim Kompilieren auffällt. Er bleibt ein Entwurf ohne Nummer –
 * Testbelege verbrauchen nie eine echte Nummer (GoBD). */
import type { Firma } from '../firma';
import type { UstModus } from '../queries/einstellungen';
import { plusTage } from '../zeitraum';
import { STANDARD_TEXTE, type BelegDokument, type Belegart } from './dokument';

export const BEISPIEL_FIRMA: Firma = {
  name: 'Mustermann Haus- & Gartenservice',
  inhaber: 'Max Mustermann',
  strasse: 'Lindenweg 12',
  plz: '12345',
  ort: 'Musterstadt',
  email: 'hallo@mustermann-service.de',
  telefon: '0123 456789',
  web: 'mustermann-service.de',
  steuernummer: '12/345/67890',
  ust_idnr: '',
  ku_id: '',
  bank: 'Musterbank',
  iban: 'DE89370400440532013000',
  bic: 'COBADEFFXXX',
  paypal: '',
};

/** Eigene Firmendaten, wenn sie schon ausgefüllt sind (Name oder Inhaber), sonst die Beispielfirma. */
export const firmaOderBeispiel = (f: Firma | null | undefined): Firma => (f && (f.name.trim() || f.inhaber.trim()) ? f : BEISPIEL_FIRMA);

const MUELLER = {
  id: null,
  nummer: 'K-0042',
  name: 'Müller & Söhne 100%',
  zusatz: 'z. Hd. Frau Müller',
  strasse: 'Gartenweg 3',
  plz: '12390',
  ort: 'Seehausen',
  email: '',
};

/** Testbeleg (Entwurf) für Rechnung oder Quittung. `heute` = 'YYYY-MM-DD'. */
export function testbeleg(art: Extract<Belegart, 'rechnung' | 'quittung'>, firma: Firma, ust_modus: UstModus, heute: string): BelegDokument {
  const rechnung = art === 'rechnung';
  return {
    art,
    nummer: null,
    storniert: false,
    datum: heute,
    leistung_von: rechnung ? plusTage(heute, -6) : heute,
    leistung_bis: rechnung ? heute : null,
    faellig_am: rechnung ? plusTage(heute, 14) : heute,
    kunde: MUELLER,
    betreff: rechnung ? 'Gartenpflege & Heckenschnitt (100% erledigt)' : 'Rasenmähen inkl. Kantenschnitt',
    einleitung: STANDARD_TEXTE[art].einleitung,
    schlusstext: STANDARD_TEXTE[art].schlusstext,
    positionen: rechnung
      ? [
          { beschreibung: 'Heckenschnitt & Rasenpflege', menge: 3, einheit: 'Std.', einzelpreis_cent: 4500 },
          { beschreibung: 'Grünschnitt-Entsorgung\n(Anhänger_1, inkl. Fahrt)', menge: 1, einheit: 'pausch.', einzelpreis_cent: 1800 },
          { beschreibung: 'Dünger "Bio" #5 – 50 % Rabatt {Aktion} ~ ^ \\ $', menge: 2.5, einheit: 'kg', einzelpreis_cent: 399 },
        ]
      : [{ beschreibung: 'Rasenmähen inkl. Kantenschnitt', menge: 1, einheit: 'pausch.', einzelpreis_cent: 6500 }],
    zahlungsweg: rechnung ? null : 'bar',
    quittiert: null,
    eigenbeleg: null,
    ausgestellt_am: null,
    firma,
    ust_modus,
  };
}
