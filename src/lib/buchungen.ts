/* Ein- & Ausgänge (§6.3) und Erfassen-Schublade (§6.4) – reine Logik ohne Datenbank:
 * Zeilen-Typ, Regel „ohne Beleg“, Sperren (GoBD), Filter/Suche/Zähler der Liste, Kategorie-Vorschlag über Stichworte,
 * Kunden über ihre Nummer („Name · K-0012“) inkl. Nachfrage bei gleichem Namen, Geschäfte-Vorschläge und
 * Formular-Prüfung ⇒ `daten` für die Rust-Commands buchung_anlegen / buchung_aendern.
 * Geld nur in Cent (money.ts). Mit Vitest getestet (buchungen.test.ts). */
import { anteil, formatBetrag, parseBetrag } from './money';
import { normalize, normalizeWithMap } from './suche';
import { istDatum } from './zeitraum';

export type BuchungTyp = 'einnahme' | 'ausgabe';
export type Zahlungsart = 'bar' | 'bank' | 'paypal';

export interface ZahlungswegInfo {
  id: Zahlungsart;
  /** Anzeige in Liste, Filter, Chips */
  name: string;
  /** Untertitel der Kachel „Bezahlt per“ */
  text: string;
}

/** Nur Zahlungsweg, keine Konten (§6 Grundsätze). Kartenzahlung läuft übers Konto ⇒ Überweisung. */
export const ZAHLUNGSWEGE: readonly ZahlungswegInfo[] = [
  { id: 'bar', name: 'Bar', text: 'Bargeld' },
  { id: 'bank', name: 'Überweisung', text: 'auch Karte' },
  { id: 'paypal', name: 'PayPal', text: 'PayPal' },
];

export const zahlungswegName = (id: string | null): string => ZAHLUNGSWEGE.find((z) => z.id === id)?.name ?? '–';
export const istZahlungsart = (v: unknown): v is Zahlungsart => v === 'bar' || v === 'bank' || v === 'paypal';
export const typName = (typ: BuchungTyp): string => (typ === 'einnahme' ? 'Einnahme' : 'Ausgabe');

/** Eine Zeile der Liste (lib/queries/buchungen.ts → ladeBuchungen). Storno-Gegenbuchungen selbst sind nie dabei. */
export interface BuchungZeile {
  id: number;
  nummer: string;
  typ: BuchungTyp;
  zahlungsdatum: string;
  belegdatum: string | null;
  betrag_cent: number;
  privatanteil_prozent: number;
  kategorie_id: number;
  kategorie_name: string;
  kategorie_icon: string | null;
  kategorie_farbe: string | null;
  kunde_id: number | null;
  kunde_name: string | null;
  kunde_nummer: string | null;
  lieferant: string | null;
  art: 'zahlung' | 'afa' | 'pauschale';
  zahlungsart: Zahlungsart | null;
  belegnummer: string | null;
  beschreibung: string;
  rechnung_id: number | null;
  rechnung_nummer: string | null;
  /** gesetzt bei einer Storno-Gegenbuchung (ID des Originals); an die lassen sich keine Belege hängen */
  storno_von_id?: number | null;
  /** Anzahl Dateien in `belege` zu dieser Buchung */
  belege_anzahl: number;
  /** 1 = es gibt eine Storno-Gegenbuchung */
  storniert: number;
  /** 1 = festgeschrieben (Spalte oder Zeitraum bis festschreibungen.bis_datum) */
  festgeschrieben: number;
}

/* ================= Regeln ================= */

/** Fehlt der Beleg? Nur echte Zahlungen, nicht storniert, ohne Datei und ohne eigenen Beleg (QU/RE). */
export const fehltBeleg = (b: Pick<BuchungZeile, 'art' | 'storniert' | 'belege_anzahl' | 'rechnung_id'>): boolean =>
  b.art === 'zahlung' && !b.storniert && !b.belege_anzahl && b.rechnung_id == null;

export type Sperre = 'storniert' | 'beleg' | 'festgeschrieben' | 'modul';

/** Warum eine Zeile nicht geändert werden darf (null = änderbar). Spiegelt die Prüfungen in Rust (buchung_aendern). */
export function sperre(b: Pick<BuchungZeile, 'storniert' | 'rechnung_id' | 'festgeschrieben' | 'art'>): Sperre | null {
  if (b.storniert) return 'storniert';
  if (b.rechnung_id != null) return 'beleg';
  if (b.festgeschrieben) return 'festgeschrieben';
  if (b.art !== 'zahlung') return 'modul';
  return null;
}

/** Darf storniert werden? Nicht doppelt, nicht Zahlungen zu einem eigenen Beleg (die nur per Storno des Belegs). */
export const kannStornieren = (b: Pick<BuchungZeile, 'storniert' | 'rechnung_id' | 'art'>): boolean =>
  !b.storniert && b.rechnung_id == null && b.art === 'zahlung';

export const SPERR_TEXT: Readonly<Record<Sperre, string>> = {
  storniert: 'Storniert – die Gegenbuchung hebt diesen Eintrag auf. Nichts mehr zu ändern.',
  beleg: 'Gehört zu einem ausgestellten Beleg und ist festgeschrieben. Ändern nur per Storno des Belegs (GoBD).',
  festgeschrieben: 'Der Zeitraum ist festgeschrieben. Ändern geht nicht mehr, nur noch stornieren (GoBD).',
  modul: 'Buchung ohne Geldfluss (AfA/Pauschale) – nur im zugehörigen Modul änderbar.',
};

/** Gegenüber unter der Beschreibung: Kunde „Name · K-0012“ bzw. Geschäft. */
export function gegenueber(b: Pick<BuchungZeile, 'typ' | 'kunde_name' | 'kunde_nummer' | 'lieferant'>): string {
  if (b.typ === 'einnahme') return b.kunde_name ? kundenLabel({ name: b.kunde_name, nummer: b.kunde_nummer ?? '' }) : '';
  return b.lieferant?.trim() ?? '';
}

/** Betrag mit Vorzeichen: Eingang „+12,50 €“, Ausgang „−12,50 €“ (nie nur über Farbe). */
export const betragAnzeige = (b: Pick<BuchungZeile, 'typ' | 'betrag_cent'>): string =>
  formatBetrag(b.typ === 'einnahme' ? b.betrag_cent : -b.betrag_cent, { vorzeichen: 'immer' });

/** Abziehbarer Teil einer Ausgabe: ohne Privatanteil, ggf. nur anteilig abziehbar (z. B. Bewirtung 70 %). */
export function abziehbar(betragCent: number, privatProzent: number, abziehbarProzent = 100): number {
  const betrieblich = betragCent - anteil(betragCent, privatProzent);
  return abziehbarProzent === 100 ? betrieblich : anteil(betrieblich, abziehbarProzent);
}

/* ================= Liste: Filter, Suche, Zähler ================= */

export type TypFilter = 'alle' | BuchungTyp;

export interface Filter {
  typ: TypFilter;
  q: string;
  kategorien: readonly number[];
  zahlungsart: Zahlungsart | 'alle';
  ohneBeleg: boolean;
}

export const LEERER_FILTER: Filter = { typ: 'alle', q: '', kategorien: [], zahlungsart: 'alle', ohneBeleg: false };

/** Anzahl der Filter im Popover (für das Bläschen am „Filter“-Knopf). */
export const anzahlErweitert = (f: Filter): number => f.kategorien.length + (f.zahlungsart !== 'alle' ? 1 : 0) + (f.ohneBeleg ? 1 : 0);

const betragSuchtext = (cent: number) => {
  const de = formatBetrag(cent, { waehrung: false, vorzeichen: 'nie' });
  return `${de} ${de.replace(/\./g, '')} ${de.replace(/\./g, '').replace(',', '.')}`;
};

/** Suchtext einer Zeile: Nummer, Beschreibung, Beleg-Nr., Kunde/Geschäft, Kategorie, Zahlungsweg, Betrag (deutsch & mit Punkt). */
export const heuhaufen = (b: BuchungZeile): string =>
  normalize(
    [
      b.nummer,
      b.beschreibung,
      b.belegnummer ?? '',
      b.rechnung_nummer ?? '',
      gegenueber(b),
      b.kategorie_name,
      zahlungswegName(b.zahlungsart),
      betragSuchtext(b.betrag_cent),
    ].join(' '),
  );

type Teil = 'typ' | 'kat' | 'za' | 'ob';

/** Passt die Zeile zum Filter (ohne Suche)? `ohne` lässt einen Teil weg (für die Zähler im Popover und an den Tabs). */
function passt(b: BuchungZeile, f: Filter, ohne?: Teil): boolean {
  return (
    (ohne === 'typ' || f.typ === 'alle' || b.typ === f.typ) &&
    (ohne === 'kat' || !f.kategorien.length || f.kategorien.includes(b.kategorie_id)) &&
    (ohne === 'za' || f.zahlungsart === 'alle' || b.zahlungsart === f.zahlungsart) &&
    (ohne === 'ob' || !f.ohneBeleg || fehltBeleg(b))
  );
}

export interface ListenErgebnis {
  /** sichtbare Zeilen, neueste zuerst */
  zeilen: BuchungZeile[];
  /** Zähler an den Tabs (Suche und übrige Filter berücksichtigt, nur der Typ nicht) */
  tabs: Record<TypFilter, number>;
  /** Anzahl je Kategorie (für das Popover) */
  proKategorie: Map<number, number>;
  /** „N ohne Beleg“ (passend zu Suche und übrigen Filtern) */
  ohneBeleg: number;
}

/** Neueste zuerst; am selben Tag die zuletzt erfasste oben. */
export const neuesteZuerst = (a: BuchungZeile, b: BuchungZeile): number =>
  a.zahlungsdatum < b.zahlungsdatum ? 1 : a.zahlungsdatum > b.zahlungsdatum ? -1 : b.id - a.id;

export function filtere(alle: readonly BuchungZeile[], f: Filter): ListenErgebnis {
  const woerter = normalize(f.q.trim()).split(/\s+/).filter(Boolean);
  const basis = woerter.length ? alle.filter((b) => { const h = heuhaufen(b); return woerter.every((w) => h.includes(w)); }) : [...alle];
  const tabs: Record<TypFilter, number> = { alle: 0, einnahme: 0, ausgabe: 0 };
  const proKategorie = new Map<number, number>();
  let ohneBeleg = 0;
  for (const b of basis) {
    if (passt(b, f, 'typ')) {
      tabs[b.typ] += 1;
      tabs.alle += 1;
    }
    if (passt(b, f, 'kat')) proKategorie.set(b.kategorie_id, (proKategorie.get(b.kategorie_id) ?? 0) + 1);
    if (passt(b, f, 'ob') && fehltBeleg(b)) ohneBeleg += 1;
  }
  const zeilen = basis.filter((b) => passt(b, f)).sort(neuesteZuerst);
  return { zeilen, tabs, proKategorie, ohneBeleg };
}

/** Suchwörter (wie in filtere) ⇒ markierte Bereiche im Originaltext, für <mark> über teile() aus lib/suche.ts. */
export function markiere(text: string, q: string): [number, number][] {
  const woerter = normalize(q.trim()).split(/\s+/).filter(Boolean);
  if (!woerter.length || !text) return [];
  const { text: n, map } = normalizeWithMap(text);
  const marks: [number, number][] = [];
  for (const w of woerter) {
    const i = n.indexOf(w);
    if (i >= 0) marks.push([map[i], map[i + w.length]]);
  }
  marks.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const m of marks) {
    const last = out[out.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else out.push(m);
  }
  return out;
}

/** „1 Eintrag“ / „142 Einträge“ (de-DE). */
export const anzahlText = (n: number, eins = 'Eintrag', viele = 'Einträge'): string =>
  `${new Intl.NumberFormat('de-DE').format(n)} ${n === 1 ? eins : viele}`;

/* ================= Kategorien ================= */

export interface KategorieWahl {
  id: number;
  name: string;
  typ: BuchungTyp;
  icon: string | null;
  farbe: string | null;
  /** kommagetrennt, z. B. „tankstelle,aral,diesel“ */
  stichworte: string | null;
  euer_bereich: string | null;
  abziehbar_prozent: number;
  wareneingang: number;
  zaehlt_ku_umsatz: number;
}

/** Kategorie über Stichworte erraten („Tanken bei Aral“ ⇒ Sprit & Fahrzeug). Erst ab 3 Zeichen. */
export function kategorieAusText(text: string, kategorien: readonly KategorieWahl[], typ: BuchungTyp): number | null {
  const n = normalize(text);
  if (n.trim().length < 3) return null;
  for (const k of kategorien) {
    if (k.typ !== typ) continue;
    const worte = (k.stichworte ?? '').split(',').map((w) => normalize(w.trim())).filter(Boolean);
    if (worte.some((w) => n.includes(w))) return k.id;
  }
  return null;
}

/* ================= Kunden (immer per ID, Anzeige „Name · K-0012“) ================= */

export interface KundeKurz {
  id: number;
  nummer: string;
  name: string;
  ort: string | null;
}

export const kundenLabel = (k: Pick<KundeKurz, 'name' | 'nummer'>): string => (k.nummer ? `${k.name} · ${k.nummer}` : k.name);

const NR = /\bK-\d{3,}\b/i;
/** Name ohne angehängte Nummer: „Anna Schmidt · K-0012“ ⇒ „Anna Schmidt“. */
export const nameOhneNummer = (text: string): string => text.trim().replace(/\s*[·(,-]?\s*K-\d{3,}\)?\s*$/i, '').trim();
/** Für den Namensvergleich: Groß/klein, Akzente und doppelte Leerzeichen egal. */
export const nameSchluessel = (name: string): string => normalize(name.trim()).replace(/\s+/g, ' ');

export type KundenAufloesung =
  | { art: 'leer' }
  /** eindeutig über die Nummer im Feld */
  | { art: 'kunde'; kunde: KundeKurz }
  /** gleicher Name wie bestehende Kunden, aber keiner gewählt ⇒ nachfragen */
  | { art: 'wahl'; name: string; liste: KundeKurz[] }
  /** neuer Kunde (unbekannter Name oder bewusst „Neuer Kunde mit diesem Namen“) */
  | { art: 'neu'; name: string; namensvettern: KundeKurz[] };

/**
 * Eingabe im Feld „Kunde“ auflösen. Gebunden wird NUR über die Nummer (Auswahl aus den Vorschlägen setzt „Name · K-0012“).
 * Ein bloßer Name, den es schon gibt, wird nie still zugeordnet: dann wird nachgefragt (auch bei genau einem Treffer).
 * `bewusstNeu` = nameSchluessel des Namens, für den „Neuer Kunde mit diesem Namen“ gewählt wurde.
 */
export function kundeAufloesen(text: string, kunden: readonly KundeKurz[], bewusstNeu: string | null = null): KundenAufloesung {
  const roh = text.trim();
  if (!roh) return { art: 'leer' };
  const nr = roh.match(NR)?.[0];
  if (nr) {
    const k = kunden.find((x) => x.nummer.toUpperCase() === nr.toUpperCase());
    if (k) return { art: 'kunde', kunde: k };
  }
  const name = nameOhneNummer(roh) || roh;
  const schluessel = nameSchluessel(name);
  const liste = kunden.filter((k) => nameSchluessel(k.name) === schluessel);
  if (liste.length && bewusstNeu !== schluessel) return { art: 'wahl', name, liste };
  return { art: 'neu', name, namensvettern: liste };
}

/* ================= Geschäfte (Ausgaben, Freitext mit Vorschlägen) ================= */

export interface Geschaeft {
  name: string;
  anzahl: number;
  /** häufigste Kategorie bei diesem Geschäft */
  kategorie_id: number | null;
}

/** Aus (lieferant, kategorie_id, n)-Zeilen: je Geschäft (Groß/klein egal) Anzahl und häufigste Kategorie, häufigste zuerst. */
export function geschaefte(zeilen: readonly { lieferant: string; kategorie_id: number; n: number }[]): Geschaeft[] {
  const m = new Map<string, { name: string; nameN: number; anzahl: number; kats: Map<number, number>; namen: Map<string, number> }>();
  for (const z of zeilen) {
    const name = z.lieferant.trim();
    if (!name) continue;
    const key = nameSchluessel(name);
    const x = m.get(key) ?? { name, nameN: 0, anzahl: 0, kats: new Map(), namen: new Map() };
    x.anzahl += z.n;
    x.kats.set(z.kategorie_id, (x.kats.get(z.kategorie_id) ?? 0) + z.n);
    const nn = (x.namen.get(name) ?? 0) + z.n;
    x.namen.set(name, nn);
    if (nn > x.nameN) {
      x.name = name; // häufigste Schreibweise
      x.nameN = nn;
    }
    m.set(key, x);
  }
  return [...m.values()]
    .map((x) => ({ name: x.name, anzahl: x.anzahl, kategorie_id: [...x.kats].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null }))
    .sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name, 'de'));
}

/** Geschäft zum eingegebenen Namen (Groß/klein egal). */
export const geschaeftZu = (name: string, liste: readonly Geschaeft[]): Geschaeft | null => {
  const s = nameSchluessel(name);
  return s ? (liste.find((g) => nameSchluessel(g.name) === s) ?? null) : null;
};

/* ================= Formular ⇒ daten ================= */

export interface Formular {
  typ: BuchungTyp;
  /** wie eingegeben, z. B. „12,5“ */
  betrag: string;
  kategorieId: number | null;
  zahlungsdatum: string;
  belegnummer: string;
  beschreibung: string;
  /** Kunde (Einnahme) bzw. Geschäft (Ausgabe) */
  wer: string;
  /** „Neuer Kunde mit diesem Namen“ gewählt (nameSchluessel) */
  kundeBewusstNeu: string | null;
  /** Privatanteil in %, wie eingegeben */
  privat: string;
  zahlungsart: Zahlungsart;
}

/** Was an buchung_anlegen / buchung_aendern geht (Vertrag mit src-tauri). */
export interface BuchungDaten {
  typ: BuchungTyp;
  zahlungsdatum: string;
  belegdatum: string | null;
  betrag_cent: number;
  privatanteil_prozent: number;
  kategorie_id: number;
  kunde_id: number | null;
  neuer_kunde: string | null;
  lieferant: string | null;
  zahlungsart: Zahlungsart;
  belegnummer: string | null;
  beschreibung: string;
  heute: string;
  /** Quellpfade von Belegdateien: Rust kopiert und verknüpft sie in derselben Transaktion (nur wenn welche vorgemerkt sind) */
  belege?: string[];
}

export type FormFeld = 'betrag' | 'kategorie' | 'zahlungsdatum' | 'beschreibung' | 'wer' | 'privat';

export interface PruefKontext {
  kategorien: readonly KategorieWahl[];
  kunden: readonly KundeKurz[];
  heute: string;
  /** letzter festgeschriebener Tag (festschreibungen.bis_datum) oder null */
  festBis: string | null;
  /** beim Bearbeiten: Belegdatum der bestehenden Buchung (kein eigenes Feld in der Schublade) */
  belegdatum?: string | null;
}

/** Höchstbetrag (100 Mio. €) – darüber ist es fast sicher ein Tippfehler. */
export const MAX_CENT = 10_000_000_000;

export function privatProzent(eingabe: string): number | null {
  const s = eingabe.trim();
  if (!s) return 0;
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n <= 100 ? n : null;
}

export type PruefErgebnis = { ok: true; daten: BuchungDaten } | { ok: false; fehler: Partial<Record<FormFeld, string>> };

/** Formular prüfen und in `daten` umwandeln. Fehler in Reihenfolge der Felder (das erste bekommt den Fokus). */
export function pruefeFormular(f: Formular, ctx: PruefKontext): PruefErgebnis {
  const fehler: Partial<Record<FormFeld, string>> = {};
  const roh = f.betrag.trim();
  const cent = parseBetrag(roh);
  if (!roh) fehler.betrag = 'Bitte einen Betrag eingeben.';
  else if (cent === null || cent <= 0) fehler.betrag = 'Betrag nicht lesbar – z. B. 12,50 oder 1.234,56';
  else if (cent >= MAX_CENT) fehler.betrag = 'Dieser Betrag ist unrealistisch hoch.';

  const kat = ctx.kategorien.find((k) => k.id === f.kategorieId);
  if (!kat || kat.typ !== f.typ) fehler.kategorie = 'Bitte eine Kategorie wählen.';

  if (!istDatum(f.zahlungsdatum)) fehler.zahlungsdatum = 'Bitte das Zahlungsdatum wählen.';
  else if (ctx.festBis && f.zahlungsdatum <= ctx.festBis) fehler.zahlungsdatum = `Bis ${datumKurz(ctx.festBis)} ist festgeschrieben – bitte ein späteres Datum.`;

  const beschreibung = f.beschreibung.trim();
  if (!beschreibung) fehler.beschreibung = 'Wofür? Bitte kurz beschreiben – das gehört zur Aufzeichnung.';

  let kundeId: number | null = null;
  let neuerKunde: string | null = null;
  let lieferant: string | null = null;
  if (f.typ === 'einnahme') {
    const k = kundeAufloesen(f.wer, ctx.kunden, f.kundeBewusstNeu);
    if (k.art === 'kunde') kundeId = k.kunde.id;
    else if (k.art === 'neu') neuerKunde = k.name;
    else if (k.art === 'wahl') fehler.wer = 'Bitte wählen, wer gemeint ist.';
  } else {
    lieferant = f.wer.trim() || null;
  }

  const privat = f.typ === 'ausgabe' ? privatProzent(f.privat) : 0;
  if (privat === null) fehler.privat = 'Ganze Zahl von 0 bis 100.';

  if (Object.keys(fehler).length || cent === null || !kat || privat === null) return { ok: false, fehler };
  return {
    ok: true,
    daten: {
      typ: f.typ,
      zahlungsdatum: f.zahlungsdatum,
      belegdatum: ctx.belegdatum ?? null,
      betrag_cent: cent,
      privatanteil_prozent: privat,
      kategorie_id: kat.id,
      kunde_id: kundeId,
      neuer_kunde: neuerKunde,
      lieferant,
      zahlungsart: f.zahlungsart,
      belegnummer: f.belegnummer.trim() || null,
      beschreibung,
      heute: ctx.heute,
    },
  };
}

/** 'YYYY-MM-DD' ⇒ „15.10.2026“ */
export const datumKurz = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
/** 'YYYY-MM-DD' ⇒ „15.10.“ (Liste) */
export const datumTagMonat = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** Formular-Vergleich für „ungespeichert“: gleiche Eingaben ⇒ gleicher Schlüssel. */
export const formularSchluessel = (f: Formular): string =>
  JSON.stringify([f.typ, f.betrag.trim(), f.kategorieId, f.zahlungsdatum, f.belegnummer.trim(), f.beschreibung.trim(), f.wer.trim(), f.kundeBewusstNeu, f.privat.trim() || '0', f.zahlungsart]);
