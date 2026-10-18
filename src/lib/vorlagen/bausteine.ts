/* Bausteine des Vorlagen-Baukastens (ANLEITUNG §7.0, Prototyp pages/belege.js → App.sheet.BLOCKS).
 * Eine Vorlage ist eine geordnete Liste von Bausteinen mit Einstellungen, gespeichert als JSON
 * (`vorlagen.bloecke_json`): [{ "typ": "kopf", "logo": true }, { "typ": "positionen" }, …]. Fehlende Einstellungen
 * nehmen den Standard aus diesem Katalog; `aus: true` blendet einen Baustein aus, ohne ihn zu entfernen.
 * Jeder Baustein hat zwei Darstellungen, die gleich aussehen müssen: HTML (components/beleg/Blatt.tsx) und
 * LaTeX (lib/latex/vorlage.ts). Tests: vorlagen.test.ts */
import { HINWEIS_19, type Belegart } from './dokument';

export const BAUSTEIN_TYPEN = [
  'kopf',
  'absenderzeile',
  'anschrift_meta',
  'titel',
  'betreff',
  'text',
  'positionen',
  'summe',
  'betrag_worte',
  'steuerhinweis',
  'zahlung',
  'quittung_felder',
  'eigenbeleg_felder',
  'gruss',
  'unterschrift',
  'trennlinie',
  'abstand',
  'fusszeile',
  'datenschutz',
] as const;

export type BausteinTyp = (typeof BAUSTEIN_TYPEN)[number];
export const istBausteinTyp = (v: unknown): v is BausteinTyp => typeof v === 'string' && (BAUSTEIN_TYPEN as readonly string[]).includes(v);

export type Einstellung = string | boolean;

/** Ein Baustein, wie er in `bloecke_json` steht. */
export interface Baustein {
  typ: BausteinTyp;
  /** ausgeblendet */
  aus?: boolean;
  [einstellung: string]: Einstellung | undefined;
}

export type FeldTyp = 'toggle' | 'text' | 'textarea' | 'select';

export interface BausteinFeld {
  key: string;
  label: string;
  typ: FeldTyp;
  default: Einstellung;
  optionen?: readonly (readonly [string, string])[];
}

export interface BausteinDef {
  name: string;
  beschreibung: string;
  arten: readonly Belegart[];
  felder: readonly BausteinFeld[];
  /** steht immer unten auf dem Blatt (Fußzeile) */
  unten?: boolean;
}

const ALLE: readonly Belegart[] = ['quittung', 'rechnung', 'angebot', 'eigenbeleg'];
const GROESSE = [['normal', 'Normal'], ['klein', 'Klein'], ['grau', 'Klein, grau']] as const;

/** Informationspflicht (Art. 13 DSGVO) in Kurzform – optionaler Baustein, nicht in den Standardvorlagen (§2.10). */
export const DATENSCHUTZ_TEXT =
  'Datenschutz: Ihre Angaben (Name, Anschrift, ggf. Telefon/E-Mail) verwende ich nur für diesen Auftrag und bewahre sie wegen der gesetzlichen Aufbewahrungspflichten auf (Art. 6 Abs. 1 lit. b und c DSGVO). Sie haben das Recht auf Auskunft, Berichtigung und – nach Ablauf der Fristen – Löschung. Fragen gern an {email}.';

export const BAUSTEINE: Readonly<Record<BausteinTyp, BausteinDef>> = {
  kopf: {
    name: 'Kopf mit Logo',
    beschreibung: 'Firmenname in Akzentfarbe, Untertitel und Logo',
    arten: ALLE,
    felder: [
      { key: 'logo', label: 'Logo anzeigen', typ: 'toggle', default: true },
      { key: 'claim', label: 'Untertitel', typ: 'text', default: '{inhaber}' },
    ],
  },
  absenderzeile: {
    name: 'Absenderzeile',
    beschreibung: 'Kleine Zeile mit Firma und Anschrift (über dem Empfänger)',
    arten: ALLE,
    felder: [
      { key: 'text', label: 'Text', typ: 'text', default: '{firma} · {strasse} · {plz} {ort}' },
      { key: 'linie', label: 'Unterstrichen (Fensterumschlag)', typ: 'toggle', default: true },
    ],
  },
  anschrift_meta: {
    name: 'Anschrift & Belegdaten',
    beschreibung: 'Empfänger links, Nummer, Datum usw. rechts',
    arten: ALLE,
    felder: [
      { key: 'nr', label: 'Belegnummer', typ: 'toggle', default: true },
      { key: 'datum', label: 'Datum', typ: 'toggle', default: true },
      { key: 'leistung', label: 'Leistungsdatum', typ: 'toggle', default: true },
      { key: 'kundennr', label: 'Kunden-Nr.', typ: 'toggle', default: true },
      { key: 'faellig', label: 'Fälligkeit / gültig bis', typ: 'toggle', default: false },
    ],
  },
  titel: {
    name: 'Titel',
    beschreibung: 'Große Überschrift, z. B. „Rechnung RE-2026-013“',
    arten: ALLE,
    felder: [
      { key: 'text', label: 'Text', typ: 'text', default: '{art} {nr}' },
      { key: 'rechts', label: 'Text rechts (optional)', typ: 'text', default: '' },
      { key: 'stil', label: 'Farbe', typ: 'select', default: 'schwarz', optionen: [['schwarz', 'Schwarz'], ['akzent', 'Akzentfarbe']] },
      { key: 'linie', label: 'Linie in Akzentfarbe darunter', typ: 'toggle', default: false },
    ],
  },
  betreff: {
    name: 'Betreff',
    beschreibung: 'Betreffzeile in Fett',
    arten: ALLE,
    felder: [{ key: 'text', label: 'Text', typ: 'text', default: '{betreff}' }],
  },
  text: {
    name: 'Freitext',
    beschreibung: 'Beliebiger Text mit Platzhaltern',
    arten: ALLE,
    felder: [
      { key: 'text', label: 'Text', typ: 'textarea', default: '' },
      { key: 'groesse', label: 'Schrift', typ: 'select', default: 'normal', optionen: GROESSE },
    ],
  },
  positionen: {
    name: 'Positionen',
    beschreibung: 'Tabelle der Leistungen mit Menge und Preis',
    arten: ALLE,
    felder: [
      { key: 'pos', label: 'Spalte „Pos.“', typ: 'toggle', default: true },
      { key: 'einheit', label: 'Einheit hinter der Menge', typ: 'toggle', default: true },
      { key: 'einzelpreis', label: 'Spalte „Einzelpreis“', typ: 'toggle', default: true },
    ],
  },
  summe: {
    name: 'Gesamtbetrag',
    beschreibung: 'Summenzeile, Betrag in Akzentfarbe',
    arten: ALLE,
    felder: [{ key: 'label', label: 'Bezeichnung', typ: 'text', default: 'Gesamtbetrag' }],
  },
  betrag_worte: {
    name: 'Betrag in Worten',
    beschreibung: 'z. B. „einhundertdreiundfünfzig Euro“',
    arten: ALLE,
    felder: [{ key: 'label', label: 'Bezeichnung', typ: 'text', default: 'in Worten' }],
  },
  steuerhinweis: {
    name: 'Steuerhinweis (§ 19)',
    beschreibung: 'Pflichthinweis für Kleinunternehmer',
    arten: ALLE,
    felder: [
      { key: 'text', label: 'Text', typ: 'text', default: HINWEIS_19 },
      { key: 'groesse', label: 'Schrift', typ: 'select', default: 'normal', optionen: GROESSE },
    ],
  },
  zahlung: {
    name: 'Zahlung & GiroCode',
    beschreibung: 'Zahlungshinweis, Bankverbindung und QR-Code zum Bezahlen',
    arten: ['rechnung', 'angebot'],
    felder: [
      { key: 'text', label: 'Zahlungshinweis', typ: 'textarea', default: 'Bitte überweisen Sie {summe} bis zum {faellig} unter Angabe der Rechnungsnummer.' },
      { key: 'bank', label: 'Bankverbindung als Kasten', typ: 'toggle', default: true },
      // GiroCode kommt mit Phase 3 Teil 6 (EPC-QR); die Einstellungen stehen schon im Katalog
      { key: 'qr', label: 'GiroCode (QR) anzeigen', typ: 'toggle', default: true },
      { key: 'qrgroesse', label: 'Größe GiroCode', typ: 'select', default: '28', optionen: [['24', 'klein (24 mm)'], ['28', 'mittel (28 mm)'], ['34', 'groß (34 mm)']] },
    ],
  },
  quittung_felder: {
    name: 'Quittungsangaben',
    beschreibung: 'Betrag, Datum, Zahlungsart, erhalten von, für',
    arten: ['quittung'],
    felder: [
      { key: 'worte', label: 'Betrag in Worten', typ: 'toggle', default: true },
      { key: 'zahlungsart', label: 'Zahlungsart anzeigen', typ: 'toggle', default: true },
      { key: 'von', label: 'Bezeichnung „erhalten von“', typ: 'text', default: 'Erhalten von' },
      { key: 'fuer', label: 'Bezeichnung „für“', typ: 'text', default: 'Für' },
    ],
  },
  eigenbeleg_felder: {
    name: 'Eigenbeleg-Angaben',
    beschreibung: 'Betrag, Datum, Empfänger, Zweck und Grund',
    arten: ['eigenbeleg'],
    felder: [
      { key: 'untertitel', label: 'Untertitel', typ: 'text', default: 'Ersatzbeleg für eine Betriebsausgabe ohne Originalbeleg' },
      { key: 'worte', label: 'Betrag in Worten', typ: 'toggle', default: true },
    ],
  },
  gruss: {
    name: 'Grußformel',
    beschreibung: 'z. B. „Mit freundlichen Grüßen“ und Name',
    arten: ALLE,
    felder: [{ key: 'text', label: 'Text', typ: 'textarea', default: 'Mit freundlichen Grüßen\n{inhaber}' }],
  },
  unterschrift: {
    name: 'Unterschrift',
    beschreibung: 'Linien für Ort/Datum und Unterschrift',
    arten: ALLE,
    felder: [
      { key: 'links', label: 'Beschriftung links', typ: 'text', default: 'Ort, Datum' },
      { key: 'rechts', label: 'Beschriftung rechts', typ: 'text', default: 'Unterschrift' },
      { key: 'vorbelegen', label: 'Ort und Datum vorausfüllen', typ: 'toggle', default: true },
      { key: 'unten', label: 'Am Seitenende', typ: 'toggle', default: true },
    ],
  },
  trennlinie: {
    name: 'Trennlinie',
    beschreibung: 'Waagerechte Linie',
    arten: ALLE,
    felder: [
      { key: 'farbe', label: 'Farbe', typ: 'select', default: 'grau', optionen: [['grau', 'Grau, fein'], ['akzent', 'Akzentfarbe'], ['schwarz', 'Schwarz']] },
    ],
  },
  abstand: {
    name: 'Abstand',
    beschreibung: 'Leerraum zwischen Bausteinen',
    arten: ALLE,
    felder: [
      { key: 'groesse', label: 'Höhe', typ: 'select', default: 'mittel', optionen: [['klein', 'klein (4 mm)'], ['mittel', 'mittel (8 mm)'], ['gross', 'groß (14 mm)']] },
    ],
  },
  fusszeile: {
    name: 'Fußzeile',
    beschreibung: 'Drei Spalten am Seitenende: Adresse · Kontakt & Steuernr. · Bank',
    arten: ALLE,
    unten: true,
    felder: [
      { key: 'adresse', label: 'Spalte Adresse', typ: 'toggle', default: true },
      { key: 'kontakt', label: 'Spalte Kontakt & Steuernummer', typ: 'toggle', default: true },
      { key: 'bank', label: 'Spalte Bankverbindung', typ: 'toggle', default: true },
    ],
  },
  datenschutz: {
    name: 'Datenschutzhinweis',
    beschreibung: 'Kurz: wofür du die Kundendaten speicherst (DSGVO)',
    arten: ['rechnung', 'quittung', 'angebot'],
    felder: [{ key: 'text', label: 'Text', typ: 'textarea', default: DATENSCHUTZ_TEXT }],
  },
};

/** Standardwerte eines Bausteins. */
export function standardWerte(typ: BausteinTyp): Record<string, Einstellung> {
  const o: Record<string, Einstellung> = {};
  for (const f of BAUSTEINE[typ].felder) o[f.key] = f.default;
  return o;
}

/** Baustein mit allen Einstellungen (fehlende = Standard). Unpassende Typen fallen auf den Standard zurück. */
export interface Aufgeloest {
  typ: BausteinTyp;
  text(key: string): string;
  an(key: string): boolean;
  /** alle Textwerte (für den Pflichtangaben-Check) */
  texte(): string[];
}

export function aufloesen(b: Baustein): Aufgeloest {
  const werte: Record<string, Einstellung> = { ...standardWerte(b.typ) };
  for (const f of BAUSTEINE[b.typ].felder) {
    const v = b[f.key];
    if (typeof v === typeof f.default) werte[f.key] = v as Einstellung;
  }
  return {
    typ: b.typ,
    text: (key) => (typeof werte[key] === 'string' ? (werte[key] as string) : ''),
    an: (key) => werte[key] === true,
    texte: () => Object.values(werte).filter((v): v is string => typeof v === 'string'),
  };
}

/** Steht der Baustein immer unten (Fußzeile) oder per Einstellung „Am Seitenende“? */
export const istUnten = (b: Aufgeloest): boolean => !!BAUSTEINE[b.typ].unten || (b.typ === 'unterschrift' && b.an('unten'));

/** Sichtbare Bausteine (ohne ausgeblendete), aufgelöst, mit ihrem Index in der Vorlage. */
export function sichtbare(bausteine: readonly Baustein[]): { index: number; b: Aufgeloest }[] {
  return bausteine.flatMap((x, index) => (x && istBausteinTyp(x.typ) && !x.aus ? [{ index, b: aufloesen(x) }] : []));
}

/** `bloecke_json` lesen: unbekannte Typen und kaputte Einträge fallen weg, Einstellungen nur string/boolean. */
export function bausteineAusJson(json: string | unknown): Baustein[] {
  let roh: unknown = json;
  if (typeof json === 'string') {
    try {
      roh = JSON.parse(json);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(roh)) return [];
  return roh.flatMap((x): Baustein[] => {
    if (!x || typeof x !== 'object' || !istBausteinTyp((x as { typ?: unknown }).typ)) return [];
    const b: Baustein = { typ: (x as { typ: BausteinTyp }).typ };
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (k === 'typ') continue;
      if (typeof v === 'string' || typeof v === 'boolean') b[k] = v;
    }
    return [b];
  });
}
