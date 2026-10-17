/* Demo-Daten (ANLEITUNG §10 Phase 1, nach referenz/prototyp/js/data.js): fiktives Kleingewerbe
 * „Mustermann Haus- & Gartenservice“ mit Rasen, Hecke, Gartenpflege, Kleinreparaturen, Montage und Winterdienst.
 * - Komplettes Vorjahr + laufendes Jahr bis heute (22 Monate im Oktober), deterministisch (fester Zufalls-Seed) relativ
 *   zu `heute`: ca. 450 Buchungen, 220 Kunden. Reine Funktion, mit Vitest getestet (demo-daten.test.ts).
 * - Einnahmen fast immer über Quittungen an viele Einzelkunden (einige kommen öfter wieder), größere Aufträge über
 *   Rechnungen an wenige Auftraggeber, dazu ein Pflegevertrag mit Überweisung ohne eigenen Beleg. Ausgaben in den drei
 *   Standardkategorien mit Zahlungsweg bar/bank/paypal, zwei stornierte Fehlbuchungen.
 * - Kleinunternehmer plausibel: Vorjahr unter 25.000 €, im laufenden Jahr wächst das Geschäft, die Hochrechnung landet
 *   im Herbst knapp unter der Grenze (Status „knapp“ in der Auswertung, Phase 2).
 * - Nummern wie in der App vergeben (Standardmuster der Nummernkreise): Kunden K-0001 … nach dem ersten Kontakt,
 *   Belege je Art und Jahr nach Datum (Entwürfe ohne Nummer), Buchungen je Jahr nach Datum. Rust vergibt beim Einfügen
 *   über den echten Nummernkreis und prüft, dass dieselben Nummern herauskommen (src-tauri/src/demo.rs).
 * - Verweise per Index (kunde, beleg, termin, storno_von) in die jeweilige Liste, nie per Name.
 * Geld immer in ganzen Cent, Datum immer 'YYYY-MM-DD'. Feldnamen exakt wie die Rust-Seite (snake_case). */
import { formatNummer, STANDARD_MUSTER, type NummernkreisId } from '../numbering';
import { istDatum } from '../zeitraum';
import type { Firma } from '../firma';

/* ================= Form der Daten (wie DemoDaten in src-tauri/src/demo.rs) ================= */

export interface DemoKunde {
  /** K-0001 … */
  nummer: string;
  name: string;
  zusatz: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  email: string | null;
  telefon: string | null;
  notiz: string | null;
  /** Tag des ersten Kontakts */
  erstellt_am: string;
}

export interface DemoPosition {
  beschreibung: string;
  menge: number;
  einheit: string;
  einzelpreis_cent: number;
}

export type DemoBelegArt = 'quittung' | 'rechnung' | 'angebot';
export type DemoBelegStatus = 'entwurf' | 'offen' | 'bezahlt';

/** Quittung, Rechnung oder Angebot (Tabelle rechnungen). */
export interface DemoBeleg {
  art: DemoBelegArt;
  /** null = Entwurf */
  nummer: string | null;
  status: DemoBelegStatus;
  /** Index in `kunden` */
  kunde: number;
  datum: string;
  faellig_am: string | null;
  betreff: string;
  bezahlt_am: string | null;
  /** Index in `termine` (vorbereitet für bzw. ausgestellt zu diesem Termin) */
  termin: number | null;
  positionen: DemoPosition[];
}

export type DemoTerminStatus = 'geplant' | 'erledigt' | 'abgesagt';

export interface DemoTermin {
  /** Index in `kunden` */
  kunde: number;
  datum: string;
  von: string;
  bis: string;
  adresse: string | null;
  leistung: string;
  betrag_geschaetzt_cent: number | null;
  notiz: string | null;
  status: DemoTerminStatus;
}

export type DemoZahlungsart = 'bar' | 'bank' | 'paypal';

export interface DemoBuchung {
  /** 2026-0001 … */
  nummer: string;
  typ: 'einnahme' | 'ausgabe';
  zahlungsdatum: string;
  betrag_cent: number;
  kategorie_id: number;
  /** Index in `kunden` (nur Einnahmen) */
  kunde: number | null;
  /** Geschäft (nur Ausgaben) */
  lieferant: string | null;
  zahlungsart: DemoZahlungsart;
  belegnummer: string | null;
  beschreibung: string;
  /** Index in `belege`: Zahlung zu dieser Quittung bzw. Rechnung */
  beleg: number | null;
  /** Index in `buchungen`: diese Zeile ist die Storno-Gegenbuchung dazu */
  storno_von: number | null;
}

/** Wie PlanpostenEingabe in src-tauri/src/liquiditaet.rs. */
export interface DemoPlanposten {
  /** nach heute */
  datum: string;
  text: string;
  /** negativ = Ausgabe */
  betrag_cent: number;
}

/** Wie WiederkehrendEingabe in src-tauri/src/liquiditaet.rs. */
export interface DemoWiederkehrend {
  name: string;
  betrag_cent: number;
  typ: 'einnahme' | 'ausgabe';
  kategorie_id: number | null;
  rhythmus: 'monatlich' | 'vierteljaehrlich' | 'jaehrlich';
  /** nächster Termin nach heute */
  naechstes_datum: string;
  tag: number;
  aktiv: boolean;
}

export interface DemoDaten {
  heute: string;
  firma: Firma;
  kunden: DemoKunde[];
  belege: DemoBeleg[];
  termine: DemoTermin[];
  buchungen: DemoBuchung[];
  /** Liquidität: einmalige erwartete Zahlungen */
  planposten: DemoPlanposten[];
  /** Liquidität: die festen Kosten von oben als wiederkehrende Posten (die Demo-Buchungen sind bewusst nicht verknüpft) */
  wiederkehrend: DemoWiederkehrend[];
}

/** Kategorien aus 0002_standarddaten.sql (feste IDs). */
export const DEMO_KATEGORIE = { dienstleistung: 1, produkte: 2, sprit: 3, sonstiges: 4 } as const;

export const DEMO_SEED = 20261009;

/** Firmendaten der Demo (wie FIRMA im Prototyp), damit spätere PDFs echt aussehen. */
export const DEMO_FIRMA: Firma = {
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
  paypal: 'hallo@mustermann-service.de',
};

/** Zahlungsziel der Rechnungen in Tagen. */
const ZAHLUNGSZIEL = 14;
/** Im laufenden Jahr läuft das Geschäft besser (mehr Aufträge): so liegt die Hochrechnung nahe an 25.000 €. */
const WACHSTUM = 1.45;

/* ================= Datum (rein über UTC, unabhängig von der Zeitzone) ================= */

const pad = (n: number, l = 2) => String(n).padStart(l, '0');
const alsZeit = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const alsIso = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
export const plusTage = (s: string, n: number): string => alsIso(alsZeit(s) + n * 86_400_000);
const tageImMonat = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const datumIn = (y: number, m: number, t: number) => `${pad(y, 4)}-${pad(m)}-${pad(Math.min(t, tageImMonat(y, m)))}`;
const wochentag = (s: string) => new Date(alsZeit(s)).getUTCDay();
/** Nächster Werktag (Mo–Fr) ab `s` in Richtung `richtung`. */
const werktag = (s: string, richtung: 1 | -1 = 1) => {
  let d = s;
  while (wochentag(d) === 0 || wochentag(d) === 6) d = plusTage(d, richtung);
  return d;
};

/* ================= Zufall (deterministisch, mulberry32 wie im Prototyp) ================= */

function zufallsquelle(seed: number) {
  let s = seed | 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ganz = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const zwischen = (a: number, b: number) => a + rnd() * (b - a);
  const ziffern = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');
  const gewichtet = <T>(paare: readonly (readonly [T, number])[]): T => {
    let r = rnd() * paare.reduce((s2, p) => s2 + p[1], 0);
    for (const [v, w] of paare) {
      r -= w;
      if (r <= 0) return v;
    }
    return paare[0][0];
  };
  return { rnd, ganz, pick, zwischen, ziffern, gewichtet };
}

/** Euro (auch krumm) ⇒ ganze Cent. */
const cent = (eur: number) => Math.round(eur * 100);

/* ================= Stammdaten der Demo ================= */

const VORNAMEN = ['Anna', 'Lukas', 'Sophie', 'Jonas', 'Marie', 'Paul', 'Lea', 'Felix', 'Emma', 'Leon', 'Mia', 'Noah', 'Hannah', 'Elias', 'Lina', 'Ben', 'Clara', 'Finn', 'Laura', 'Tim', 'Julia', 'Moritz', 'Sarah', 'Jan', 'Katharina', 'David', 'Nina', 'Simon', 'Johanna', 'Florian', 'Lisa', 'Tobias', 'Eva', 'Matthias', 'Ida', 'Henrik', 'Greta', 'Karl', 'Frieda', 'Ole', 'Ursula', 'Gerhard', 'Monika', 'Helmut', 'Renate', 'Wolfgang'];
const NACHNAMEN = ['Schmidt', 'Müller', 'Becker', 'Hoffmann', 'Wagner', 'Schulz', 'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hartmann', 'Lange', 'Werner', 'Krause', 'Lehmann', 'Köhler', 'Maier', 'Fuchs', 'Peters', 'Scholz', 'Möller', 'Weiß', 'Jung', 'Hahn', 'Vogel', 'Friedrich', 'Keller', 'Günther', 'Frank', 'Berger', 'Winkler', 'Roth', 'Beck', 'Lorenz', 'Baumann'];
const STRASSEN = ['Lindenallee', 'Birkenweg', 'Hauptstraße', 'Am Markt', 'Gartenstraße', 'Schulweg', 'Bergstraße', 'Mühlenweg', 'Kirchplatz', 'Ahornring', 'Seeufer', 'Rosenweg', 'Bahnhofstraße', 'Am Anger'];
const ORTE: readonly (readonly [string, string])[] = [['12345', 'Musterstadt'], ['12347', 'Musterdorf'], ['12346', 'Musterstadt'], ['12390', 'Seehausen'], ['12399', 'Weindorf'], ['12350', 'Waldheim']];
const FIRMEN = ['Hausverwaltung Kaiser', 'Praxis Dr. Sommer', 'Kita Sonnenschein e. V.', 'Café Lindenblatt', 'Kanzlei Brandt & Partner', 'Hotel Am See', 'Bäckerei Kornfeld', 'Weinhaus Rebstock GmbH', 'Physiotherapie Bewegt', 'Gasthaus Zur Linde', 'Wohnungsbau Seehausen eG'];
/* Sachliche Notizen (§2.10: nur, was für den Auftrag gebraucht wird) */
const NOTIZEN = ['Hund im Garten – Tor immer schließen', 'Schlüssel liegt beim Nachbarn (Nr. 14)', 'Grünschnitt bitte mitnehmen', 'Zahlt gern bar', 'Parken in der Einfahrt ok', 'Lieber vormittags anrufen', 'Wasseranschluss hinter der Garage', 'Klingel defekt – bitte anrufen'];
const FIRMEN_NOTIZEN = ['Schlüssel beim Hausmeister', 'Rechnung per E-Mail an die Buchhaltung', 'Ansprechpartnerin: Frau Brandt', 'Arbeiten nur außerhalb der Öffnungszeiten'];

/* Leistungen für Quittungen: [Text, Einheit, Menge min/max, Preis je Einheit min/max (€), Saison] */
type Saison = 'sommer' | 'herbst' | 'winter' | 'immer';
const LEISTUNGEN: readonly (readonly [string, string, number, number, number, number, Saison])[] = [
  ['Rasenmähen inkl. Grünschnitt', 'pausch.', 1, 1, 45, 95, 'sommer'],
  ['Heckenschnitt', 'Std.', 2, 6, 35, 38, 'sommer'],
  ['Gartenpflege', 'Std.', 2, 5, 35, 35, 'sommer'],
  ['Beet anlegen inkl. Pflanzen', 'pausch.', 1, 1, 120, 340, 'sommer'],
  ['Laub entfernen', 'pausch.', 1, 1, 50, 140, 'herbst'],
  ['Regenrinne reinigen', 'pausch.', 1, 1, 70, 150, 'herbst'],
  ['Möbelmontage', 'Std.', 1, 4, 38, 38, 'immer'],
  ['Kleinreparatur im Haushalt', 'Std.', 1, 3, 38, 38, 'immer'],
  ['Lampen & Regale anbringen', 'pausch.', 1, 1, 45, 110, 'immer'],
  ['Winterdienst (Einsatz)', 'Einsatz', 1, 3, 30, 45, 'winter'],
];
const ZAHLWEG_QUITTUNG: readonly (readonly [DemoZahlungsart, number])[] = [['bar', 55], ['bank', 28], ['paypal', 17]];

type Geschaeft = 'bauhaus' | 'obi' | 'gruenland' | 'aral' | 'shell' | 'telekom' | 'haftpflicht' | 'paypal' | 'kfz' | 'werkstatt';
const GESCHAEFT: Readonly<Record<Geschaeft, string>> = {
  bauhaus: 'Bauhaus',
  obi: 'OBI Baumarkt',
  gruenland: 'Gartencenter Grünland',
  aral: 'Aral Tankstelle',
  shell: 'Shell Station',
  telekom: 'Telekom Deutschland',
  haftpflicht: 'Handwerker-Versicherung AG',
  paypal: 'PayPal',
  kfz: 'Auto-Schutz Versicherung',
  werkstatt: 'Kfz-Werkstatt Meier',
};

/* Wiederkehrende Ausgaben (Bank) */
const WIEDERKEHREND = [
  { text: 'Handyvertrag', betrag: 2999, kat: DEMO_KATEGORIE.sonstiges, g: 'telekom', tag: 20, monate: null },
  { text: 'Kfz-Versicherung Transporter', betrag: 3800, kat: DEMO_KATEGORIE.sprit, g: 'kfz', tag: 1, monate: null },
  { text: 'Betriebshaftpflicht', betrag: 9600, kat: DEMO_KATEGORIE.sonstiges, g: 'haftpflicht', tag: 15, monate: [1, 4, 7, 10] },
] as const satisfies readonly { text: string; betrag: number; kat: number; g: Geschaeft; tag: number; monate: readonly number[] | null }[];

const PRODUKTE: readonly (readonly [Geschaeft, string])[] = [
  ['gruenland', 'Blumenerde & Rindenmulch'],
  ['gruenland', 'Pflanzen für Kundenbeet'],
  ['gruenland', 'Dünger & Rasensamen'],
  ['bauhaus', 'Schrauben, Dübel, Kleinteile'],
  ['obi', 'Ersatzmesser Rasenmäher'],
  ['bauhaus', 'Müllsäcke & Arbeitshandschuhe'],
  ['obi', 'Silikon & Montagekleber'],
  ['bauhaus', 'Rasenkantensteine'],
];
const SONSTIGES: readonly (readonly [string, string, number, number])[] = [
  ['Akku-Heckenschere', 'werkzeug', 159, 229],
  ['Flyer-Druck (500 Stk.)', 'werbung', 39, 69],
  ['Grünschnitt-Entsorgung Wertstoffhof', 'entsorgung', 12, 35],
  ['Bohrer- & Bit-Set', 'werkzeug', 29, 59],
  ['Anzeige Gemeindeblatt', 'werbung', 35, 80],
];
type PosZeile = readonly [string, number, string, number];
const JOBS: readonly { betreff: string; pos: readonly PosZeile[] }[] = [
  { betreff: 'Grünanlagenpflege', pos: [['Grünanlagenpflege Außenbereich', 12, 'Std.', 3800], ['Grünschnitt-Entsorgung', 1, 'pausch.', 6500]] },
  { betreff: 'Heckenschnitt Außenanlage', pos: [['Heckenschnitt inkl. Entsorgung', 9, 'Std.', 3800]] },
  { betreff: 'Möbelmontage Büro', pos: [['Montage Schreibtische & Schränke', 7, 'Std.', 3800], ['Kleinmaterial', 1, 'pausch.', 2400]] },
  { betreff: 'Laubbeseitigung Herbst', pos: [['Laubbeseitigung Grundstück', 1, 'pausch.', 42000]] },
  { betreff: 'Winterdienst Saison', pos: [['Winterdienst Einsätze', 8, 'Einsatz', 4500]] },
  { betreff: 'Neuanlage Beet Eingangsbereich', pos: [['Beet anlegen', 24, 'm²', 1800], ['Pflanzen & Erde', 1, 'pausch.', 21000]] },
];
const ZEITEN: readonly (readonly [string, string])[] = [['08:00', '10:00'], ['09:30', '11:30'], ['10:00', '12:00'], ['13:00', '15:00'], ['14:30', '16:00'], ['16:00', '17:30']];

const saison = (m: number): Exclude<Saison, 'immer'> => (m >= 4 && m <= 8 ? 'sommer' : m >= 9 && m <= 11 ? 'herbst' : 'winter');
const slug = (s: string) =>
  s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);

/** Summe der Positionen in Cent (Menge × Einzelpreis, je Zeile gerundet). Rust rechnet genauso. */
export const positionenSumme = (pos: readonly DemoPosition[]): number =>
  pos.reduce((s, p) => s + Math.round(p.menge * p.einzelpreis_cent), 0);

const positionen = (zeilen: readonly PosZeile[]): DemoPosition[] =>
  zeilen.map(([beschreibung, menge, einheit, einzelpreis_cent]) => ({ beschreibung, menge, einheit, einzelpreis_cent }));

/* ================= Erzeugen ================= */

/* Arbeitsformen mit Objektverweisen; am Ende sortiert, nummeriert und in Indizes übersetzt. */
interface K {
  name: string;
  zusatz: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  email: string | null;
  telefon: string | null;
  notiz: string | null;
  seq: number;
}
interface T {
  k: K;
  datum: string;
  von: string;
  bis: string;
  leistung: string;
  betrag: number | null;
  notiz: string | null;
  status: DemoTerminStatus;
  /** Tag, an dem der Termin eingetragen wurde (zählt als erster Kontakt) */
  eingetragen: string;
  seq: number;
}
interface R {
  art: DemoBelegArt;
  status: DemoBelegStatus;
  k: K;
  datum: string;
  faellig: string | null;
  betreff: string;
  pos: DemoPosition[];
  bezahltAm: string | null;
  zahlungsart: DemoZahlungsart;
  t: T | null;
  seq: number;
}
interface B {
  typ: 'einnahme' | 'ausgabe';
  datum: string;
  betrag: number;
  kat: number;
  k: K | null;
  lieferant: string | null;
  zahlungsart: DemoZahlungsart;
  belegnr: string | null;
  text: string;
  r: R | null;
  stornoVon: B | null;
  seq: number;
}

const adresseVon = (k: K): string | null => (k.strasse ? `${k.strasse}\n${k.plz} ${k.ort}` : null);

/**
 * Erzeugt die Demo-Daten für `heute` ('YYYY-MM-DD'). Gleiches `heute` und gleicher `seed` ⇒ exakt dieselben Daten.
 * Nichts liegt nach `heute` außer geplanten Terminen, ihren vorbereiteten Entwürfen und Fälligkeiten offener Rechnungen.
 */
export function demoDaten(heute: string, seed: number = DEMO_SEED): DemoDaten {
  if (!istDatum(heute)) throw new RangeError(`Ungültiges Datum: ${heute}`);
  const z = zufallsquelle(seed);
  const Y = +heute.slice(0, 4);
  const M = +heute.slice(5, 7);
  const START = `${Y - 1}-01-01`;
  const imZeitraum = (d: string) => d >= START && d <= heute;
  let seq = 0;

  /* ---------- Kunden ---------- */
  const kunden: K[] = [];
  const privat: K[] = [];
  const firmen: K[] = [];
  const neuerKunde = (name: string, mitAdresse: boolean, zusatz: string | null = null): K => {
    const [plz, ort] = z.pick(ORTE);
    const k: K = {
      name,
      zusatz,
      strasse: mitAdresse ? `${z.pick(STRASSEN)} ${z.ganz(1, 60)}` : null,
      plz: mitAdresse ? plz : null,
      ort: mitAdresse ? ort : null,
      email: null,
      telefon: z.rnd() < 0.35 ? `0${z.ganz(1, 8)}${z.ziffern(2)} ${z.ziffern(6)}` : null,
      notiz: null,
      seq: ++seq,
    };
    kunden.push(k);
    return k;
  };
  /* Einzelkunde: meist neu; manche der frühen Kunden kommen immer wieder (Stammkunden) */
  const einzelkunde = (): K => {
    if (privat.length > 10 && z.rnd() < 0.1) {
      const k = z.pick(privat.slice(0, 40));
      if (!k.notiz && z.rnd() < 0.4) k.notiz = z.pick(NOTIZEN);
      return k;
    }
    const k = neuerKunde(`${z.pick(VORNAMEN)} ${z.pick(NACHNAMEN)}`, z.rnd() < 0.6);
    if (z.rnd() < 0.05) k.notiz = z.pick(NOTIZEN);
    privat.push(k);
    return k;
  };
  /* Auftraggeber (Rechnungen): oft Firmen, selten wiederkehrend */
  const auftraggeber = (name?: string): K => {
    if (name) {
      const f = firmen.find((x) => x.name === name);
      if (f) return f;
    } else if (firmen.length > 3 && z.rnd() < 0.12) return z.pick(firmen);
    const istFirma = !!name || z.rnd() < 0.6;
    const nm = name ?? (istFirma ? (FIRMEN.find((f) => !firmen.some((x) => x.name === f)) ?? `${z.pick(NACHNAMEN)} GmbH`) : `${z.pick(VORNAMEN)} ${z.pick(NACHNAMEN)}`);
    const k = neuerKunde(nm, true, istFirma ? z.pick(['Objektbetreuung', 'Inhaberin', 'Haustechnik', 'Geschäftsführung']) : null);
    if (istFirma) {
      k.email = `info@${slug(nm.split(' ')[0])}.de`;
      if (z.rnd() < 0.4) k.notiz = z.pick(FIRMEN_NOTIZEN);
    }
    firmen.push(k);
    return k;
  };

  const buchungen: B[] = [];
  const belege: R[] = [];
  const termine: T[] = [];
  const buche = (b: Omit<B, 'seq' | 'k' | 'r' | 'stornoVon' | 'lieferant' | 'belegnr'> & Partial<Pick<B, 'k' | 'r' | 'stornoVon' | 'lieferant' | 'belegnr'>>): B => {
    const x: B = { k: null, r: null, stornoVon: null, lieferant: null, belegnr: null, ...b, seq: ++seq };
    buchungen.push(x);
    return x;
  };
  const beleg = (r: Omit<R, 'seq' | 't'> & { t?: T | null }): R => {
    const x: R = { t: null, ...r, seq: ++seq };
    belege.push(x);
    return x;
  };
  const termin = (t: Omit<T, 'seq' | 'notiz' | 'status' | 'eingetragen'> & Partial<Pick<T, 'notiz' | 'status' | 'eingetragen'>>): T => {
    const x: T = { notiz: null, status: 'geplant', eingetragen: plusTage(t.datum < heute ? t.datum : heute, -z.ganz(2, 9)), ...t, seq: ++seq };
    termine.push(x);
    return x;
  };
  const belegNr: Record<Geschaeft, () => string | null> = {
    bauhaus: () => `BH ${z.ziffern(4)} ${z.ziffern(4)}`,
    obi: () => `OBI-${z.ziffern(8)}`,
    gruenland: () => `GL-${z.ziffern(5)}`,
    aral: () => `Bon ${z.ziffern(4)}`,
    shell: () => `Bon ${z.ziffern(4)}`,
    telekom: () => `RG ${z.ziffern(9)}`,
    haftpflicht: () => `VS-${z.ziffern(7)}`,
    paypal: () => null,
    kfz: () => `KFZ-${z.ziffern(6)}`,
    werkstatt: () => `WS-${z.ziffern(4)}`,
  };

  /* Pflegevertrag: ein Stammkunde zahlt im Sommer monatlich per Überweisung, ohne eigenen Beleg */
  let pflegekunde: K | null = null;

  for (let y = Y - 1; y <= Y; y++) {
    const wachstum = y === Y ? WACHSTUM : 1;
    for (let m = 1; m <= 12; m++) {
      if (y === Y && m > M) break;
      const s = saison(m);
      let paypalUmsatz = 0;
      let paypalAnzahl = 0;

      // wiederkehrende Ausgaben
      for (const w of WIEDERKEHREND) {
        if (w.monate && !(w.monate as readonly number[]).includes(m)) continue;
        const d = datumIn(y, m, w.tag);
        if (imZeitraum(d)) {
          buche({ typ: 'ausgabe', datum: d, betrag: w.betrag, kat: w.kat, lieferant: GESCHAEFT[w.g], zahlungsart: 'bank', text: w.text, belegnr: belegNr[w.g]() });
        }
      }

      // Quittungen: viele Einzelkunden, saisonal
      const nBasis = s === 'sommer' ? z.ganz(10, 13) : s === 'herbst' ? z.ganz(8, 11) : z.ganz(4, 6);
      const nQ = Math.round(nBasis * wachstum);
      const passend = LEISTUNGEN.filter((l) => l[6] === 'immer' || l[6] === s || (s === 'herbst' && l[6] === 'sommer' && m === 9));
      for (let i = 0; i < nQ; i++) {
        const d = datumIn(y, m, z.ganz(1, 28));
        if (!imZeitraum(d)) continue;
        const [text, einheit, mMin, mMax, pMin, pMax] = z.pick(passend);
        const menge = z.ganz(mMin, mMax);
        const preis = cent(einheit === 'pausch.' ? Math.round(z.zwischen(pMin, pMax)) : z.ganz(pMin, pMax));
        const zeilen: PosZeile[] = [[text, menge, einheit, preis]];
        if (/Rasen|Hecke|Laub/.test(text) && z.rnd() < 0.3) zeilen.push(['Grünschnitt-Entsorgung', 1, 'pausch.', 1500]);
        const zw = z.gewichtet(ZAHLWEG_QUITTUNG);
        const r = beleg({ art: 'quittung', status: 'bezahlt', k: einzelkunde(), datum: d, faellig: null, betreff: text, pos: positionen(zeilen), bezahltAm: d, zahlungsart: zw });
        if (zw === 'paypal') {
          paypalUmsatz += positionenSumme(r.pos);
          paypalAnzahl++;
        }
      }

      // Aufträge mit Rechnung (ältere; die letzten Wochen sind unten fest vorgegeben)
      if (z.rnd() < (y === Y ? 0.85 : 0.7)) {
        const d = datumIn(y, m, z.ganz(1, 28));
        if (d >= START && d < plusTage(heute, -40)) {
          const job = z.pick(JOBS.filter((j) => (s === 'winter' ? !/Laub|Hecke|Beet/.test(j.betreff) : !/Winter/.test(j.betreff))));
          const verzug = z.rnd() < 0.7 ? Math.round(z.zwischen(3, 13)) : Math.round(z.zwischen(14, 30));
          beleg({ art: 'rechnung', status: 'bezahlt', k: auftraggeber(), datum: d, faellig: plusTage(d, ZAHLUNGSZIEL), betreff: job.betreff, pos: positionen(job.pos), bezahltAm: plusTage(d, verzug), zahlungsart: 'bank' });
        }
      }

      // Pflegevertrag (April bis Oktober, Monatsende per Überweisung)
      if (m >= 4 && m <= 10) {
        const d = datumIn(y, m, 28);
        if (imZeitraum(d)) {
          if (!pflegekunde) {
            pflegekunde = neuerKunde('Gerhard Becker', true);
            pflegekunde.notiz = 'Pflegevertrag: Rasen und Beete alle zwei Wochen, Zahlung monatlich per Überweisung';
            pflegekunde.telefon = '04213 556271';
          }
          buche({ typ: 'einnahme', datum: d, betrag: 12000, kat: DEMO_KATEGORIE.dienstleistung, k: pflegekunde, zahlungsart: 'bank', text: `Gartenpflege laut Pflegevertrag (${pad(m)}/${y})` });
        }
      }

      // Sprit (2–4× im Monat), Werkstatt einmal im Jahr
      const nSprit = z.ganz(2, 4) - (s === 'winter' ? 1 : 0);
      for (let i = 0; i < nSprit; i++) {
        const d = datumIn(y, m, z.ganz(1, 28));
        if (!imZeitraum(d)) continue;
        const g: Geschaeft = z.rnd() < 0.6 ? 'aral' : 'shell';
        const liter = z.zwischen(32, 58);
        buche({
          typ: 'ausgabe',
          datum: d,
          betrag: cent(liter * z.zwischen(1.68, 1.84)),
          kat: DEMO_KATEGORIE.sprit,
          lieferant: GESCHAEFT[g],
          zahlungsart: z.rnd() < 0.85 ? 'bank' : 'bar',
          text: `Tanken Diesel (${liter.toFixed(1).replace('.', ',')} l)`,
          belegnr: belegNr[g](),
        });
      }
      if (m === 3) {
        const d = datumIn(y, m, 18);
        if (imZeitraum(d)) {
          buche({ typ: 'ausgabe', datum: d, betrag: cent(z.zwischen(290, 470)), kat: DEMO_KATEGORIE.sprit, lieferant: GESCHAEFT.werkstatt, zahlungsart: 'bank', text: 'Inspektion & Reifenwechsel Transporter', belegnr: belegNr.werkstatt() });
        }
      }

      // Produkte & Material (2–4× im Monat, im Winter weniger)
      const nProd = (s === 'winter' ? 1 : 2) + z.ganz(0, 2);
      for (let i = 0; i < nProd; i++) {
        const d = datumIn(y, m, z.ganz(1, 28));
        if (!imZeitraum(d)) continue;
        const [g, text] = z.pick(s === 'winter' ? PRODUKTE.filter((p) => p[0] !== 'gruenland') : PRODUKTE);
        buche({ typ: 'ausgabe', datum: d, betrag: cent(z.zwischen(18, 160)), kat: DEMO_KATEGORIE.produkte, lieferant: GESCHAEFT[g], zahlungsart: z.rnd() < 0.75 ? 'bank' : 'bar', text, belegnr: belegNr[g]() });
      }

      // Sonstige Kosten (gelegentlich)
      if (z.rnd() < 0.45) {
        const d = datumIn(y, m, z.ganz(1, 28));
        if (imZeitraum(d)) {
          const [text, , lo, hi] = z.pick(SONSTIGES);
          const lieferant = /Wertstoffhof/.test(text) ? 'Wertstoffhof Musterstadt' : /Flyer/.test(text) ? 'Druckerei Schnell' : /Anzeige/.test(text) ? 'Gemeindeblatt Musterstadt' : z.pick([GESCHAEFT.bauhaus, GESCHAEFT.obi]);
          buche({ typ: 'ausgabe', datum: d, betrag: cent(z.zwischen(lo, hi)), kat: DEMO_KATEGORIE.sonstiges, lieferant, zahlungsart: z.rnd() < 0.7 ? 'bank' : 'bar', text, belegnr: `Bon ${z.ziffern(4)}` });
        }
      }

      // Gebühren der Zahlungsdienste (monatlich gesammelt)
      const monatsende = datumIn(y, m, 28);
      if (paypalAnzahl && imZeitraum(monatsende)) {
        buche({
          typ: 'ausgabe',
          datum: monatsende,
          betrag: Math.round(paypalUmsatz * 0.0249 + paypalAnzahl * 35),
          kat: DEMO_KATEGORIE.sonstiges,
          lieferant: GESCHAEFT.paypal,
          zahlungsart: 'paypal',
          text: `PayPal-Gebühren (${paypalAnzahl} Zahlungen)`,
          belegnr: `PP-${y}${pad(m)}`,
        });
      }
    }
  }

  /* ---------- Feste aktuelle Belege: zwei offen (eine überfällig), eine bezahlt, ein Entwurf, ein Angebot ---------- */
  const fest: { kunde: string; datum: string; faellig?: string; status: DemoBelegStatus; bezahltAm?: string; betreff: string; pos: readonly PosZeile[] }[] = [
    { kunde: 'Kita Sonnenschein e. V.', datum: plusTage(heute, -31), faellig: plusTage(heute, -17), status: 'offen', betreff: 'Heckenschnitt Außenanlage', pos: [['Heckenschnitt inkl. Entsorgung', 16, 'Std.', 3800], ['Grünschnitt-Entsorgung', 1, 'pausch.', 6800]] },
    { kunde: 'Hausverwaltung Kaiser', datum: plusTage(heute, -6), status: 'offen', betreff: 'Grünanlagenpflege Wohnanlage Seeufer', pos: [['Grünanlagenpflege Wohnanlage Seeufer', 22, 'Std.', 3800], ['Grünschnitt-Entsorgung', 1, 'pausch.', 9500]] },
    { kunde: 'Praxis Dr. Sommer', datum: plusTage(heute, -24), faellig: plusTage(heute, -10), status: 'bezahlt', bezahltAm: plusTage(heute, -12), betreff: 'Möbelmontage Praxisräume', pos: [['Montage Schränke & Regale', 8, 'Std.', 3800], ['Kleinmaterial', 1, 'pausch.', 2900]] },
    { kunde: 'Hausverwaltung Kaiser', datum: plusTage(heute, -1), status: 'entwurf', betreff: 'Laubbeseitigung Wohnanlage Seeufer', pos: [['Laubbeseitigung Wohnanlage Seeufer', 14, 'Std.', 3800]] },
  ];
  for (const f of fest) {
    beleg({ art: 'rechnung', status: f.status, k: auftraggeber(f.kunde), datum: f.datum, faellig: f.faellig ?? plusTage(f.datum, ZAHLUNGSZIEL), betreff: f.betreff, pos: positionen(f.pos), bezahltAm: f.bezahltAm ?? null, zahlungsart: 'bank' });
  }
  beleg({
    art: 'angebot',
    status: 'offen',
    k: auftraggeber('Weinhaus Rebstock GmbH'),
    datum: plusTage(heute, -9),
    faellig: plusTage(heute, 21),
    betreff: 'Neuanlage Vorgarten',
    pos: positionen([['Vorgarten neu anlegen (Rückbau, Boden, Pflanzung)', 45, 'm²', 4200], ['Pflanzen & Material', 1, 'pausch.', 98000], ['Entsorgung', 1, 'pausch.', 18000]]),
    bezahltAm: null,
    zahlungsart: 'bank',
  });
  beleg({
    art: 'rechnung',
    status: 'offen',
    k: auftraggeber(),
    datum: plusTage(heute, -3),
    faellig: plusTage(heute, ZAHLUNGSZIEL - 3),
    betreff: 'Regenrinnen & Laub',
    pos: positionen([['Regenrinnen reinigen', 1, 'pausch.', 14000], ['Laub entfernen', 3, 'Std.', 3800]]),
    bezahltAm: null,
    zahlungsart: 'bank',
  });

  /* ---------- Termine ---------- */
  // Erledigt: gut die Hälfte der Quittungen der letzten sechs Wochen hatte einen Termin
  const juengste = belege.filter((r) => r.art === 'quittung' && r.datum >= plusTage(heute, -42) && r.datum <= heute);
  juengste.forEach((r, i) => {
    if (z.rnd() >= 0.55) return;
    const [von, bis] = ZEITEN[i % ZEITEN.length];
    r.t = termin({ k: r.k, datum: r.datum, von, bis, leistung: r.betreff, betrag: positionenSumme(r.pos), status: 'erledigt' });
  });
  // Abgesagt (letzte Woche) und erledigt ohne Beleg (Nachbesserung, „Beleg fehlt“)
  const k1 = einzelkunde();
  termin({ k: k1, datum: werktag(plusTage(heute, -5), -1), von: '10:00', bis: '12:00', leistung: 'Heckenschnitt', betrag: 14000, status: 'abgesagt', notiz: 'Abgesagt wegen Krankheit, meldet sich wieder' });
  const nachbessern = belege.find((r) => r.art === 'quittung' && r.datum < plusTage(heute, -14) && r.datum >= plusTage(heute, -40) && !r.t);
  if (nachbessern) {
    termin({ k: nachbessern.k, datum: werktag(plusTage(heute, -2), -1), von: '16:00', bis: '17:00', leistung: `Nachbesserung: ${nachbessern.betreff}`, betrag: null, status: 'erledigt' });
  }
  // Gestern geplant, noch nicht nachgetragen, Quittung vorbereitet
  const vorbereiten = (t: T, art: 'quittung' | 'rechnung' = 'quittung') => {
    beleg({
      art,
      status: 'entwurf',
      k: t.k,
      datum: t.datum,
      faellig: art === 'rechnung' ? plusTage(t.datum, ZAHLUNGSZIEL) : null,
      betreff: t.leistung,
      pos: positionen([[t.leistung, 1, 'pausch.', t.betrag ?? 0]]),
      bezahltAm: null,
      zahlungsart: art === 'rechnung' ? 'bank' : 'bar',
      t,
    });
  };
  const k2 = einzelkunde();
  vorbereiten(termin({ k: k2, datum: werktag(plusTage(heute, -1), -1), von: '14:30', bis: '16:00', leistung: 'Laub entfernen', betrag: 9000 }));
  // Anstehend: die nächsten zwei Wochen, teils mit vorbereiteter Quittung, eine Firma mit Rechnung
  const plan: readonly (readonly [number, string, number, boolean])[] = [
    [0, 'Rasenmähen inkl. Grünschnitt', 6500, true],
    [1, 'Regenrinne reinigen', 11000, true],
    [2, 'Möbelmontage (2 Schränke)', 15200, false],
    [4, 'Laub entfernen', 8500, true],
    [6, 'Kleinreparatur im Haushalt', 7600, false],
    [9, 'Beet winterfest machen', 18000, true],
    [13, 'Heckenschnitt', 21000, false],
  ];
  plan.forEach(([tage, leistung, betrag, vor], i) => {
    const mitNotiz = privat.filter((x) => x.notiz);
    const k = (i === 1 || i === 5) && mitNotiz.length ? z.pick(mitNotiz) : einzelkunde();
    const [von, bis] = ZEITEN[(i * 2) % ZEITEN.length];
    const t = termin({ k, datum: werktag(plusTage(heute, tage)), von, bis, leistung, betrag });
    if (vor) vorbereiten(t);
  });
  const hv = auftraggeber('Hausverwaltung Kaiser');
  vorbereiten(
    termin({ k: hv, datum: werktag(plusTage(heute, 3)), von: '08:00', bis: '12:00', leistung: 'Grünanlagenpflege Wohnanlage Seeufer', betrag: 38000, notiz: 'Schlüssel beim Hausmeister' }),
    'rechnung',
  );

  /* ---------- Bezahlte Quittungen/Rechnungen ⇒ Einnahme mit Belegnummer (die Nummer kommt unten) ---------- */
  for (const r of belege) {
    if (r.status !== 'bezahlt' || !r.bezahltAm) continue;
    if (r.bezahltAm > heute) {
      r.status = 'offen';
      r.bezahltAm = null;
      continue;
    }
    buche({ typ: 'einnahme', datum: r.bezahltAm, betrag: positionenSumme(r.pos), kat: DEMO_KATEGORIE.dienstleistung, k: r.k, zahlungsart: r.zahlungsart, text: r.betreff, r });
  }

  /* ---------- Zwei Fehlbuchungen, storniert (Gegenbuchung wie buchung_stornieren in buchungen.rs) ---------- */
  const stornoZiele = [Y - 1, Y]
    .map((jahr) => buchungen.find((b) => b.typ === 'ausgabe' && b.kat === DEMO_KATEGORIE.produkte && b.datum.startsWith(`${jahr}-05`)))
    .filter((b): b is B => !!b);
  const stornos = stornoZiele.map((o) => {
    const spaeter = plusTage(o.datum, 2);
    const datum = spaeter <= heute && spaeter.slice(0, 4) === o.datum.slice(0, 4) ? spaeter : o.datum;
    return buche({ typ: o.typ, datum, betrag: o.betrag, kat: o.kat, lieferant: o.lieferant, zahlungsart: o.zahlungsart, text: o.text, stornoVon: o });
  });

  /* ================= Sortieren, Nummern vergeben, in Indizes übersetzen ================= */

  // Kunden: Nummer nach dem ersten Kontakt (Beleg, Termin oder Einnahme), wie sie in der App entstanden wären
  const erster = new Map<K, string>();
  const merke = (k: K, d: string) => {
    const alt = erster.get(k);
    if (!alt || d < alt) erster.set(k, d);
  };
  for (const r of belege) merke(r.k, r.status === 'entwurf' && r.t ? r.t.eingetragen : r.datum < heute ? r.datum : heute);
  for (const t of termine) merke(t.k, t.eingetragen);
  for (const b of buchungen) if (b.k) merke(b.k, b.datum);
  const kundenSortiert = kunden
    .filter((k) => erster.has(k))
    .sort((a, b) => (erster.get(a)! < erster.get(b)! ? -1 : erster.get(a)! > erster.get(b)! ? 1 : a.seq - b.seq));
  const kundeIndex = new Map(kundenSortiert.map((k, i) => [k, i]));
  const kundenAus: DemoKunde[] = kundenSortiert.map((k, i) => ({
    nummer: formatNummer(STANDARD_MUSTER.kunde, Y, i + 1),
    name: k.name,
    zusatz: k.zusatz,
    strasse: k.strasse,
    plz: k.plz,
    ort: k.ort,
    email: k.email,
    telefon: k.telefon,
    notiz: k.notiz,
    erstellt_am: erster.get(k)!,
  }));

  // Termine nach Datum
  const termineSortiert = [...termine].sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.von < b.von ? -1 : a.von > b.von ? 1 : a.seq - b.seq));
  const terminIndex = new Map(termineSortiert.map((t, i) => [t, i]));
  const termineAus: DemoTermin[] = termineSortiert.map((t) => ({
    kunde: kundeIndex.get(t.k)!,
    datum: t.datum,
    von: t.von,
    bis: t.bis,
    adresse: adresseVon(t.k),
    leistung: t.leistung,
    betrag_geschaetzt_cent: t.betrag,
    notiz: t.notiz,
    status: t.status,
  }));

  // Belege nach Datum; Nummern je Art und Jahr fortlaufend (Entwürfe ohne Nummer)
  const belegeSortiert = [...belege].sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.seq - b.seq));
  const belegIndex = new Map(belegeSortiert.map((r, i) => [r, i]));
  const zaehler = new Map<string, number>();
  const naechste = (kreis: NummernkreisId, jahr: number) => {
    const schluessel = `${kreis}:${jahr}`;
    const n = (zaehler.get(schluessel) ?? 0) + 1;
    zaehler.set(schluessel, n);
    return formatNummer(STANDARD_MUSTER[kreis], jahr, n);
  };
  const belegNummer = new Map<R, string>();
  const belegeAus: DemoBeleg[] = belegeSortiert.map((r) => {
    const nummer = r.status === 'entwurf' ? null : naechste(r.art, +r.datum.slice(0, 4));
    if (nummer) belegNummer.set(r, nummer);
    return {
      art: r.art,
      nummer,
      status: r.status,
      kunde: kundeIndex.get(r.k)!,
      datum: r.datum,
      faellig_am: r.faellig,
      betreff: r.betreff,
      bezahlt_am: r.bezahltAm,
      termin: r.t ? terminIndex.get(r.t)! : null,
      positionen: r.pos,
    };
  });

  // Buchungen nach Zahlungsdatum, am selben Tag Einnahmen zuerst; Nummer je Jahr der Erfassung (= Zahlungstag)
  const buchungenSortiert = [...buchungen].sort(
    (a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : (a.typ === 'einnahme' ? -1 : 0) - (b.typ === 'einnahme' ? -1 : 0) || a.seq - b.seq),
  );
  const buchungIndex = new Map(buchungenSortiert.map((b, i) => [b, i]));
  const buchungNummer = new Map<B, string>();
  for (const b of buchungenSortiert) buchungNummer.set(b, naechste('buchung', +b.datum.slice(0, 4)));
  const buchungenAus: DemoBuchung[] = buchungenSortiert.map((b) => {
    const storno = stornos.includes(b) && b.stornoVon ? b.stornoVon : null;
    return {
      nummer: buchungNummer.get(b)!,
      typ: b.typ,
      zahlungsdatum: b.datum,
      betrag_cent: b.betrag,
      kategorie_id: b.kat,
      kunde: b.k ? kundeIndex.get(b.k)! : null,
      lieferant: b.lieferant,
      zahlungsart: b.zahlungsart,
      belegnummer: storno ? buchungNummer.get(storno)! : b.r ? belegNummer.get(b.r)! : b.belegnr,
      beschreibung: storno ? `Storno von ${buchungNummer.get(storno)!}: ${b.text}` : b.text,
      beleg: b.r ? belegIndex.get(b.r)! : null,
      storno_von: storno ? buchungIndex.get(storno)! : null,
    };
  });

  // Liquidität: Planposten in den nächsten 90 Tagen, feste Kosten ab dem nächsten Termin nach heute
  const planposten: DemoPlanposten[] = [
    { datum: plusTage(heute, 19), text: 'Winterreifen Transporter', betrag_cent: -48000 },
    { datum: plusTage(heute, 33), text: 'Neuer Aufsitzmäher', betrag_cent: -149000 },
    { datum: plusTage(heute, 56), text: 'Winterdienst-Vertrag Hausverwaltung (Vorauszahlung)', betrag_cent: 60000 },
  ];
  const wiederkehrend: DemoWiederkehrend[] = WIEDERKEHREND.map((w) => {
    const monate: readonly number[] = w.monate ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    let y = +heute.slice(0, 4);
    let m = +heute.slice(5, 7);
    let naechstes = '';
    for (let i = 0; i < 24 && !naechstes; i++) {
      const d = datumIn(y, m, w.tag);
      if (monate.includes(m) && d > heute) naechstes = d;
      if (++m > 12) {
        m = 1;
        y++;
      }
    }
    return {
      name: w.text,
      betrag_cent: w.betrag,
      typ: 'ausgabe',
      kategorie_id: w.kat,
      rhythmus: w.monate ? 'vierteljaehrlich' : 'monatlich',
      naechstes_datum: naechstes,
      tag: w.tag,
      aktiv: true,
    };
  });

  return { heute, firma: { ...DEMO_FIRMA }, kunden: kundenAus, belege: belegeAus, termine: termineAus, buchungen: buchungenAus, planposten, wiederkehrend };
}
