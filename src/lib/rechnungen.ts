/* Rechnungen & Quittungen (§6.6) – reine Logik ohne Datenbank: Status und Badges, Liste (Alle · Offen · Bezahlt,
 * Zeitraum Monat · Jahr · Gesamt nach Belegdatum, Suche, Sortierung), Status-Menü je Art, Formular der Beleg-Maske
 * ⇄ Belegdokument (Vorschau, Pflichtangaben) ⇄ Eingabe für die Rust-Commands (src-tauri/src/rechnungen.rs).
 * Geld nur in Cent. Kunden per ID („Name · K-0012“, Nachfrage bei gleichem Namen wie in der Erfassen-Schublade).
 * Optik und Verhalten wie referenz/prototyp/js/pages/belege.js. Tests: rechnungen.test.ts */
import { kundeAufloesen, kundenLabel, type KundeKurz, type Zahlungsart } from './buchungen';
import type { Firma } from './firma';
import { formatBetrag, parseBetrag } from './money';
import type { UstModus } from './queries/einstellungen';
import { normalize } from './suche';
import {
  EIGENBELEG_GRUENDE,
  STANDARD_TEXTE,
  belegSumme,
  datumText,
  mengeTausendstel,
  tageZwischen,
  type BelegDokument,
  type BelegPosition,
  type Belegart,
  type EigenbelegGrund,
  type KundeSchnappschuss,
} from './vorlagen/dokument';
import { plusTage, zeitraum, type Zeitraum } from './zeitraum';

/* ================= Zeilen der Liste ================= */

/** Belegart in der Tabelle; 'storno' = Stornobeleg (entsteht nur beim Stornieren). */
export type ListenArt = Belegart | 'storno';
export type BelegStatus = 'entwurf' | 'offen' | 'bezahlt' | 'storniert' | 'angenommen' | 'abgelehnt';

/** Eine Zeile der Liste (lib/queries/rechnungen.ts → ladeBelege). */
export interface BelegZeile {
  id: number;
  art: ListenArt;
  /** null = Entwurf */
  nummer: string | null;
  status: BelegStatus;
  kunde_id: number | null;
  /** Schnappschuss bzw. beim Entwurf der Name des gewählten oder neuen Kunden */
  kunde_name: string | null;
  datum: string | null;
  faellig_am: string | null;
  bezahlt_am: string | null;
  zahlungsart: Zahlungsart | null;
  /** Betreff, sonst die erste Position */
  betreff: string | null;
  summe_cent: number;
  termin_id: number | null;
  termin_datum: string | null;
  termin_von: string | null;
  termin_status: string | null;
  storno_von_id: number | null;
  /** beim Original: Datum des Stornobelegs */
  storniert_am: string | null;
  pdf_beleg_id: number | null;
  scan_beleg_id: number | null;
}

export const ART_NAME: Readonly<Record<ListenArt, string>> = {
  rechnung: 'Rechnung',
  quittung: 'Quittung',
  angebot: 'Angebot',
  eigenbeleg: 'Eigenbeleg',
  storno: 'Storno',
};

/** Für einen Termin vorbereiteter Beleg: Entwurf mit Termin (Nummer erst beim Ausstellen, §6.5). */
export const istVorbereitet = (z: Pick<BelegZeile, 'status' | 'termin_id'>): boolean => z.status === 'entwurf' && z.termin_id != null;

export type StatusSchluessel =
  | 'entwurf'
  | 'vorbereitet'
  | 'offen'
  | 'ueberfaellig'
  | 'bezahlt'
  | 'gebucht'
  | 'storniert'
  | 'stornobeleg'
  | 'angenommen'
  | 'abgelehnt'
  | 'abgelaufen';

/** Status zur Anzeige: „überfällig“, „vorbereitet“ und die Sonderfälle je Art (Prototyp statusKey/statusBadge). */
export function statusSchluessel(z: Pick<BelegZeile, 'art' | 'status' | 'termin_id' | 'faellig_am'>, heute: string): StatusSchluessel {
  if (z.art === 'storno') return 'stornobeleg';
  if (z.status === 'entwurf') return z.termin_id != null ? 'vorbereitet' : 'entwurf';
  if (z.status === 'storniert') return 'storniert';
  if (z.art === 'angebot') {
    if (z.status === 'angenommen' || z.status === 'abgelehnt') return z.status;
    return z.faellig_am && z.faellig_am < heute ? 'abgelaufen' : 'offen';
  }
  if (z.art === 'rechnung' && z.status === 'offen') return z.faellig_am && z.faellig_am < heute ? 'ueberfaellig' : 'offen';
  if (z.art === 'eigenbeleg' && z.status === 'bezahlt') return 'gebucht';
  return z.status === 'bezahlt' ? 'bezahlt' : 'offen';
}

export const STATUS_BADGE: Readonly<Record<StatusSchluessel, { klasse: string; text: string }>> = {
  entwurf: { klasse: 'entwurf', text: 'Entwurf' },
  vorbereitet: { klasse: 'vorbereitet', text: 'Vorbereitet' },
  offen: { klasse: 'offen', text: 'Offen' },
  ueberfaellig: { klasse: 'ueberfaellig', text: 'Überfällig' },
  bezahlt: { klasse: 'bezahlt', text: 'Bezahlt' },
  gebucht: { klasse: 'bezahlt', text: 'Gebucht' },
  storniert: { klasse: 'storniert', text: 'Storniert' },
  stornobeleg: { klasse: 'entwurf', text: 'Stornobeleg' },
  angenommen: { klasse: 'bezahlt', text: 'Angenommen' },
  abgelehnt: { klasse: 'abgelehnt', text: 'Abgelehnt' },
  abgelaufen: { klasse: 'entwurf', text: 'Abgelaufen' },
};

/** Zahl der überfälligen Rechnungen (Seitenleiste, roter Zähler). */
export const anzahlUeberfaellig = (zeilen: readonly BelegZeile[], heute: string): number =>
  zeilen.filter((z) => statusSchluessel(z, heute) === 'ueberfaellig').length;

/* ================= Filter, Zeitraum, Suche, Sortierung ================= */

export type Reiter = 'alle' | 'offen' | 'bezahlt';
export const REITER: readonly { value: Reiter; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'offen', label: 'Offen' },
  { value: 'bezahlt', label: 'Bezahlt' },
];

/** Offen = offene Rechnungen plus Vorbereitungen für geplante Termine; Bezahlt = bezahlte Rechnungen, Quittungen und
 * gebuchte Eigenbelege. Entwürfe, Angebote und Stornos nur unter „Alle“. */
export function passtReiter(z: BelegZeile, r: Reiter): boolean {
  if (r === 'offen') return (z.art === 'rechnung' && z.status === 'offen') || (istVorbereitet(z) && z.termin_status === 'geplant');
  if (r === 'bezahlt') return z.status === 'bezahlt' && z.art !== 'angebot' && z.art !== 'storno';
  return true;
}

export type ListenZeitraumModus = 'monat' | 'jahr' | 'gesamt';
export const LISTEN_ZEITRAEUME: readonly { value: ListenZeitraumModus; label: string }[] = [
  { value: 'monat', label: 'Monat' },
  { value: 'jahr', label: 'Jahr' },
  { value: 'gesamt', label: 'Gesamt' },
];

/** Zeitraum der Liste (nach Belegdatum); „Gesamt“ = alles. */
export function listenZeitraum(modus: ListenZeitraumModus, anker: string): Zeitraum | null {
  return modus === 'gesamt' ? null : zeitraum(modus, anker);
}

const betragSuchtext = (cent: number): string => {
  const de = formatBetrag(cent, { waehrung: false, vorzeichen: 'nie' });
  return `${de} ${de.replace(/\./g, '')} ${de.replace(/\./g, '').replace(',', '.')}`;
};

/** Suchtext einer Zeile: Nummer (oder „Entwurf“), Kunde, Betreff, Betrag, Art. */
export const heuhaufen = (z: BelegZeile): string =>
  normalize([z.nummer ?? 'Entwurf', z.kunde_name ?? '', z.betreff ?? '', betragSuchtext(z.summe_cent), ART_NAME[z.art]].join(' '));

export type SortFeld = 'nr' | 'kunde' | 'datum' | 'faellig' | 'betrag';
export interface Sortierung {
  feld: SortFeld;
  /** 1 aufsteigend, −1 absteigend */
  richtung: 1 | -1;
}

/** Start-Richtung je Spalte (Kunde und Fälligkeit aufsteigend, sonst neueste/größte zuerst). */
export const SORT_START: Readonly<Record<SortFeld, 1 | -1>> = { nr: -1, kunde: 1, datum: -1, faellig: 1, betrag: -1 };

/** Sortierwert „Fällig / Zahlung“: bei vorbereiteten Belegen der Termin. */
export const faelligSchluessel = (z: BelegZeile): string =>
  (istVorbereitet(z) && z.termin_datum ? `${z.termin_datum} ${z.termin_von ?? ''}` : (z.faellig_am ?? z.datum)) ?? '';

const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Wie im Prototyp: Entwürfe oben, dann nach Datum und Nummer; andere Spalten nach ihrem Wert. */
export function vergleiche(a: BelegZeile, b: BelegZeile, s: Sortierung): number {
  const r = s.richtung;
  if (s.feld === 'betrag') return r * (a.summe_cent - b.summe_cent) || b.id - a.id;
  if (s.feld === 'kunde') return r * (a.kunde_name ?? '').localeCompare(b.kunde_name ?? '', 'de') || b.id - a.id;
  if (s.feld === 'faellig') return r * text(faelligSchluessel(a), faelligSchluessel(b)) || text(a.nummer ?? '', b.nummer ?? '');
  if (!a.nummer !== !b.nummer) return a.nummer ? 1 : -1;
  if (s.feld === 'datum' || (a.datum !== b.datum && a.art !== b.art)) return r * text(a.datum ?? '', b.datum ?? '') || r * (a.id - b.id);
  return r * text(a.nummer ?? a.datum ?? '', b.nummer ?? b.datum ?? '') || r * (a.id - b.id);
}

export interface ListenErgebnis {
  zeilen: BelegZeile[];
  /** Zähler an den Reitern: im Zeitraum, „Offen“ immer über alle */
  reiter: Record<Reiter, number>;
  ueberfaellig: number;
  /** Suche oder „Offen“: über alle Zeiträume */
  ohneZeitraum: boolean;
}

export function filtere(
  alle: readonly BelegZeile[],
  o: { reiter: Reiter; q: string; zeitraum: Pick<Zeitraum, 'von' | 'bis'> | null; sortierung: Sortierung; heute: string },
): ListenErgebnis {
  const woerter = normalize(o.q.trim()).split(/\s+/).filter(Boolean);
  const imZeitraum = (z: BelegZeile) => !o.zeitraum || (!!z.datum && z.datum >= o.zeitraum.von && z.datum <= o.zeitraum.bis);
  const imZr = alle.filter(imZeitraum);
  const reiter: Record<Reiter, number> = {
    alle: imZr.length,
    offen: alle.filter((z) => passtReiter(z, 'offen')).length,
    bezahlt: imZr.filter((z) => passtReiter(z, 'bezahlt')).length,
  };
  const ohneZeitraum = woerter.length > 0 || o.reiter === 'offen';
  const basis = ohneZeitraum ? alle : imZr;
  const zeilen = basis
    .filter((z) => passtReiter(z, o.reiter))
    .filter((z) => {
      if (!woerter.length) return true;
      const h = heuhaufen(z);
      return woerter.every((w) => h.includes(w));
    })
    .sort((a, b) => vergleiche(a, b, o.sortierung));
  return { zeilen, reiter, ueberfaellig: anzahlUeberfaellig(alle, o.heute), ohneZeitraum };
}

/** Spalte „Fällig / Zahlung“ (Prototyp faelligHTML). `klasse`: 'neg' | 'warn' | 'muted' | ''. */
export function faelligText(z: BelegZeile, heute: string): { text: string; klasse: string; titel?: string } {
  if (istVorbereitet(z)) {
    if (!z.termin_datum) return { text: 'Termin', klasse: 'muted' };
    const vorbei = z.termin_status === 'geplant' && z.termin_datum < heute;
    return { text: `Termin ${datumText(z.termin_datum).slice(0, 6)}${z.termin_von ? ` · ${z.termin_von}` : ''}`, klasse: vorbei ? 'warn' : '' };
  }
  if (z.art === 'storno') return { text: 'Stornobeleg', klasse: 'muted' };
  if (z.status === 'entwurf') return { text: '—', klasse: 'muted' };
  if (z.status === 'storniert') return { text: `storniert${z.storniert_am ? ` ${datumText(z.storniert_am).slice(0, 6)}` : ''}`, klasse: 'muted' };
  if (z.art === 'rechnung' && z.status === 'offen' && z.faellig_am) {
    const n = tageZwischen(heute, z.faellig_am);
    if (n < 0) return { text: `${-n} T. überfällig`, klasse: 'neg', titel: `fällig war ${datumText(z.faellig_am)}` };
    if (n === 0) return { text: 'heute fällig', klasse: 'warn' };
    return { text: `in ${n} ${n === 1 ? 'Tag' : 'Tagen'}`, klasse: '', titel: `fällig am ${datumText(z.faellig_am)}` };
  }
  if (z.art === 'angebot') {
    if (z.status === 'angenommen') return { text: '→ Rechnung', klasse: 'muted' };
    if (z.status === 'abgelehnt') return { text: 'abgelehnt', klasse: 'muted' };
    const n = tageZwischen(heute, z.faellig_am ?? z.datum ?? heute);
    return n < 0 ? { text: 'abgelaufen', klasse: 'muted' } : { text: `gültig noch ${n} T.`, klasse: '' };
  }
  if (z.status === 'bezahlt') {
    const wie = z.art === 'eigenbeleg' ? 'gebucht' : z.art === 'quittung' ? zahlungswegKurz(z.zahlungsart) : 'bezahlt';
    const am = z.bezahlt_am ?? z.datum;
    return { text: `${wie}${am ? ` · ${datumText(am).slice(0, 6)}` : ''}`, klasse: 'muted' };
  }
  return { text: '—', klasse: 'muted' };
}

const zahlungswegKurz = (z: Zahlungsart | null): string => (z === 'bank' ? 'Überweisung' : z === 'paypal' ? 'PayPal' : 'bar');

/** Betrag in der Liste: Eigenbelege sind Ausgaben (−), Stornobelege negativ. */
export function listenBetrag(z: Pick<BelegZeile, 'art' | 'summe_cent'>): string {
  if (z.art === 'eigenbeleg') return formatBetrag(-z.summe_cent);
  return formatBetrag(z.summe_cent);
}

/* ================= Status-Menü (Prototyp statusMenu) ================= */

export type StatusAktion =
  | 'bezahlt'
  | 'doch-offen'
  | 'stornieren'
  | 'als-rechnung'
  | 'duplizieren'
  | 'umwandeln'
  | 'rechnung-oeffnen'
  | 'angebot-offen'
  | 'angebot-abgelehnt'
  | 'oeffnen'
  | 'ausstellen'
  | 'zum-termin'
  | 'vorbereitung-weg'
  | 'pdf';

export interface StatusPunkt {
  aktion: StatusAktion;
  label: string;
  sub: string;
  /** 'neg' = gefährlich (rot), 'on' = aktueller Zustand */
  art?: 'neg' | 'on';
}

export interface StatusMenue {
  text: string;
  punkte: StatusPunkt[];
}

/** Erklärung und erlaubte Schritte je Art und Status. `hier` = in der Maske dieses Belegs (dort steht „Ausstellen“ unten). */
export function statusMenue(z: BelegZeile, heute: string, hier = false): StatusMenue {
  const s = statusSchluessel(z, heute);
  const p: StatusPunkt[] = [];
  if (istVorbereitet(z)) {
    const wann = z.termin_datum ? ` für den Termin am ${datumText(z.termin_datum)}${z.termin_von ? ` · ${z.termin_von}` : ''}` : '';
    const wasEntsteht = z.art === 'quittung' ? 'Nummer und Einnahme entstehen' : 'Die Nummer entsteht';
    if (!hier) {
      if (z.art === 'quittung' || z.art === 'rechnung')
        p.push({ aktion: 'ausstellen', label: z.art === 'rechnung' ? 'Rechnung schreiben …' : 'Quittung ausstellen …', sub: 'Nummer vergeben' });
      else p.push({ aktion: 'oeffnen', label: 'Öffnen …', sub: 'Entwurf prüfen und ausstellen' });
    }
    p.push({ aktion: 'zum-termin', label: 'Zum Termin', sub: z.termin_datum ? datumText(z.termin_datum) : '' });
    p.push({ aktion: 'vorbereitung-weg', label: 'Vorbereitung entfernen', sub: 'Termin bleibt geplant – kein Storno nötig', art: 'neg' });
    return { text: `Vorbereitet${wann}. ${wasEntsteht} erst beim Ausstellen.`, punkte: p };
  }
  if (z.art === 'storno') {
    p.push({ aktion: 'pdf', label: 'PDF öffnen', sub: 'Stornobeleg drucken oder versenden' });
    return { text: 'Stornobeleg – hebt das Original auf. Endgültig (GoBD).', punkte: p };
  }
  if (z.status === 'storniert') {
    p.push({ aktion: 'duplizieren', label: 'Duplizieren', sub: 'Mit gleichen Angaben neu als Entwurf' });
    const am = z.storniert_am ? ` am ${datumText(z.storniert_am)}` : '';
    return { text: `Storniert${am} – endgültig (GoBD). Die Nummer bleibt vergeben, der Beleg archiviert.`, punkte: p };
  }
  if (z.art === 'rechnung') {
    if (z.status === 'bezahlt') {
      p.push({ aktion: 'doch-offen', label: 'Doch offen …', sub: 'Versehentlich abgehakt – Einnahme wird zurückgenommen' });
      p.push({ aktion: 'stornieren', label: 'Stornieren …', sub: 'Rechnung ungültig machen, Einnahme zurücknehmen', art: 'neg' });
      const am = z.bezahlt_am ? datumText(z.bezahlt_am) : '';
      return { text: `Bezahlt${am ? ` am ${am}` : ''}${z.zahlungsart ? ` · ${zahlungswegKurz(z.zahlungsart)}` : ''}.`, punkte: p };
    }
    p.push({ aktion: 'bezahlt', label: 'Bezahlt …', sub: 'Zahlungseingang mit Datum und Zahlungsweg buchen' });
    p.push({ aktion: 'stornieren', label: 'Stornieren …', sub: 'Rechnung ungültig machen, Nummer bleibt vergeben', art: 'neg' });
    const n = z.faellig_am ? tageZwischen(z.faellig_am, heute) : 0;
    const text =
      s === 'ueberfaellig' && z.faellig_am
        ? `Seit ${n} ${n === 1 ? 'Tag' : 'Tagen'} überfällig (fällig war ${datumText(z.faellig_am)}).`
        : `Wartet auf Zahlung${z.faellig_am ? ` – fällig ${datumText(z.faellig_am)}` : ''}.`;
    return { text, punkte: p };
  }
  if (z.art === 'quittung') {
    p.push({ aktion: 'als-rechnung', label: 'Als Rechnung neu ausstellen …', sub: 'Storniert die Quittung, legt eine Rechnung als Entwurf an' });
    p.push({ aktion: 'stornieren', label: 'Stornieren …', sub: 'Quittung ungültig machen, Einnahme zurücknehmen', art: 'neg' });
    return { text: 'Eine Quittung bestätigt, dass bezahlt wurde – ihr Status ist immer „Bezahlt“. War sie ein Versehen, wird sie storniert.', punkte: p };
  }
  if (z.art === 'angebot') {
    if (z.status === 'angenommen') {
      p.push({ aktion: 'rechnung-oeffnen', label: 'Rechnung öffnen', sub: 'Der Entwurf aus diesem Angebot' });
      return { text: 'Angenommen und in eine Rechnung umgewandelt.', punkte: p };
    }
    p.push({ aktion: 'angebot-offen', label: 'Offen', sub: 'Wartet auf Antwort des Kunden', art: z.status === 'offen' ? 'on' : undefined });
    p.push({ aktion: 'umwandeln', label: 'Angenommen …', sub: 'In eine Rechnung umwandeln (Entwurf)' });
    p.push({ aktion: 'angebot-abgelehnt', label: 'Abgelehnt', sub: 'Kunde hat abgesagt', art: z.status === 'abgelehnt' ? 'on' : undefined });
    const text = z.status === 'abgelehnt' ? 'Der Kunde hat das Angebot abgelehnt.' : `Wartet auf Antwort${z.faellig_am ? ` – gültig bis ${datumText(z.faellig_am)}` : ''}.`;
    return { text, punkte: p };
  }
  p.push({ aktion: 'stornieren', label: 'Stornieren …', sub: 'Eigenbeleg ungültig machen, Ausgabe zurücknehmen', art: 'neg' });
  return { text: 'Gebucht – der Eigenbeleg ersetzt den fehlenden Originalbeleg.', punkte: p };
}

/* ================= Formular der Beleg-Maske ================= */

export interface PositionFormular {
  beschreibung: string;
  /** wie eingegeben, z. B. „1,5“ */
  menge: string;
  einheit: string;
  /** wie eingegeben, z. B. „45,00“ */
  preis: string;
  /** Kategorie (Eigenbeleg: die der Ausgabe) */
  kategorieId: number | null;
}

export interface BelegFormular {
  art: Belegart;
  /** Kunde: „Name · K-0012“ (gebunden), ein neuer Name oder leer; beim Eigenbeleg der Zahlungsempfänger (Freitext) */
  kunde: string;
  /** „Neuer Kunde mit diesem Namen“ gewählt (nameSchluessel) */
  kundeBewusstNeu: string | null;
  /** Anschrift eines neuen Kunden bzw. des Empfängers, Zeilen mit \n */
  adresse: string;
  datum: string;
  leistungVon: string;
  /** '' = einzelnes Datum */
  leistungBis: string;
  /** Zahlungsziel (Rechnung) bzw. Gültigkeit (Angebot) in Tagen, wie eingegeben */
  zielTage: string;
  betreff: string;
  einleitung: string;
  schlusstext: string;
  positionen: PositionFormular[];
  /** Quittung: mehrere Positionen statt eines Betrags */
  mehrere: boolean;
  zahlungsart: Zahlungsart;
  /** Rechnung: schon bezahlt am (dann wird beim Ausstellen gebucht), null = offen */
  bezahltAm: string | null;
  grund: EigenbelegGrund;
  grundText: string;
  /** null = Standardvorlage, sonst vorlagen.id */
  vorlageId: number | null;
  terminId: number | null;
  /** schon erfasste Zahlung, die beim Ausstellen verknüpft wird */
  buchungId: number | null;
}

export const EINHEITEN = ['Stk.', 'Std.', 'pausch.', 'm', 'm²', 'lfm', 'km', 'Tag', 'Satz'] as const;

/** Standard-Zahlungsziel bzw. -Gültigkeit in Tagen. */
export const ZIEL_STANDARD: Readonly<Record<Belegart, number>> = { rechnung: 14, angebot: 30, quittung: 0, eigenbeleg: 0 };

/** Menge aus der Eingabe („1,5“, „2“, „0.25“) ⇒ Zahl (höchstens drei Nachkommastellen zählen); null = unlesbar. */
export function parseMenge(eingabe: string): number | null {
  const s = eingabe.trim().replace(/\s/g, '').replace('−', '-');
  if (!s) return null;
  if (!/^-?(\d+([.,]\d+)?|[.,]\d+)$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? mengeTausendstel(n) / 1000 : null;
}

const MENGE = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3, useGrouping: false });
export const mengeEingabe = (menge: number): string => MENGE.format(menge);
/** Cent ⇒ Eingabetext „1234,50“ (ohne Tausenderpunkte); 0 ⇒ ''. */
export const preisEingabe = (cent: number): string =>
  cent ? `${cent < 0 ? '-' : ''}${Math.trunc(Math.abs(cent) / 100)},${String(Math.abs(cent) % 100).padStart(2, '0')}` : '';

export const leerePosition = (einheit = 'Stk.', beschreibung = ''): PositionFormular => ({ beschreibung, menge: '1', einheit, preis: '', kategorieId: null });

/** Positionen aus dem Formular ⇒ Belegpositionen (unlesbare Zahlen zählen 0). Ganz leere Zeilen fallen weg, solange
 * es noch andere gibt. */
export function positionenAus(f: Pick<BelegFormular, 'positionen'>): BelegPosition[] {
  const liste = f.positionen.map((p) => ({
    beschreibung: p.beschreibung.trim(),
    menge: parseMenge(p.menge) ?? 0,
    einheit: p.einheit.trim(),
    einzelpreis_cent: parseBetrag(p.preis) ?? 0,
  }));
  const voll = liste.filter((p) => p.beschreibung || p.einzelpreis_cent);
  return voll.length ? voll : liste.slice(0, 1);
}

/** Fälligkeit aus Datum und Zahlungsziel (Rechnung, Angebot); sonst null. */
export function faelligAus(f: Pick<BelegFormular, 'art' | 'datum' | 'zielTage'>): string | null {
  if ((f.art !== 'rechnung' && f.art !== 'angebot') || !f.datum) return null;
  const tage = Math.max(0, Math.min(365, Number.parseInt(f.zielTage, 10) || 0));
  return plusTage(f.datum, tage);
}

/** Kunde mit Anschrift (für Vorschläge und Schnappschuss); Felder wie die Tabelle kunden. */
export interface KundeAnschrift extends KundeKurz {
  zusatz: string | null;
  strasse: string | null;
  plz: string | null;
  email: string | null;
}

/** Anschrift aus freier Eingabe („z. Hd. …\nStraße 1\n12345 Ort“), wie Anschrift::lesen in rechnungen.rs. */
export function anschriftLesen(text: string): { zusatz: string; strasse: string; plz: string; ort: string } {
  const z = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const a = { zusatz: '', strasse: '', plz: '', ort: '' };
  const m = z.length ? /^(\d{4,5})\s+(.+)$/.exec(z[z.length - 1]) : null;
  if (m) {
    a.plz = m[1];
    a.ort = m[2].trim();
    z.pop();
  }
  a.strasse = z.pop() ?? '';
  a.zusatz = z.join(', ');
  return a;
}

/** Anschrift eines Kunden als Zeilen (für das Feld „Anschrift“). */
export const anschriftText = (k: Pick<KundeAnschrift, 'zusatz' | 'strasse' | 'plz' | 'ort'>): string =>
  [k.zusatz, k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].map((s) => (s ?? '').trim()).filter(Boolean).join('\n');

/** Welcher Kunde steht im Formular? (Eigenbeleg: nie ein Kunde.) */
export function formularKunde(f: Pick<BelegFormular, 'art' | 'kunde' | 'kundeBewusstNeu'>, kunden: readonly KundeAnschrift[]) {
  if (f.art === 'eigenbeleg') return { art: 'leer' as const };
  return kundeAufloesen(f.kunde, kunden, f.kundeBewusstNeu);
}

/** Schnappschuss des Kunden für die Vorschau (beim Ausstellen setzt Rust die endgültigen Werte). */
export function kundeVorschau(f: BelegFormular, kunden: readonly KundeAnschrift[]): KundeSchnappschuss | null {
  if (f.art === 'eigenbeleg') {
    const name = f.kunde.trim();
    if (!name) return null;
    const a = anschriftLesen(f.adresse);
    return { id: null, nummer: '', name, ...a, email: '' };
  }
  const k = formularKunde(f, kunden);
  if (k.art === 'kunde') {
    const x = kunden.find((y) => y.id === k.kunde.id);
    const eigene = x && (x.strasse || x.ort) ? null : f.adresse.trim() ? anschriftLesen(f.adresse) : null;
    return {
      id: k.kunde.id,
      nummer: k.kunde.nummer,
      name: k.kunde.name,
      zusatz: eigene?.zusatz ?? x?.zusatz ?? '',
      strasse: eigene?.strasse ?? x?.strasse ?? '',
      plz: eigene?.plz ?? x?.plz ?? '',
      ort: eigene?.ort ?? x?.ort ?? '',
      email: x?.email ?? '',
    };
  }
  if (k.art === 'neu' || k.art === 'wahl') return { id: null, nummer: '', name: k.name, ...anschriftLesen(f.adresse), email: '' };
  return null;
}

export interface DokumentKontext {
  kunden: readonly KundeAnschrift[];
  firma: Firma;
  ustModus: UstModus;
  /** aktuelles Firmenlogo (Dateiname, '' bzw. fehlt = keins) – wird beim Ausstellen mit eingefroren */
  logo?: string;
}

/** Formular ⇒ Belegdokument für Vorschau, Pflichtangaben und den Schnappschuss beim Ausstellen. */
export function formularZuDokument(f: BelegFormular, ctx: DokumentKontext): BelegDokument {
  const art = f.art;
  const rechnungsartig = art === 'rechnung' || art === 'angebot';
  const quittiert = art === 'rechnung' && f.bezahltAm && f.bezahltAm <= f.datum ? { am: f.bezahltAm, zahlungsweg: f.zahlungsart } : null;
  return {
    art,
    nummer: null,
    storniert: false,
    datum: f.datum,
    leistung_von: art === 'angebot' ? null : f.leistungVon || f.datum || null,
    leistung_bis: art === 'angebot' ? null : f.leistungBis || null,
    faellig_am: rechnungsartig ? faelligAus(f) : art === 'quittung' ? f.datum : null,
    kunde: kundeVorschau(f, ctx.kunden),
    betreff: f.betreff,
    einleitung: f.einleitung,
    schlusstext: f.schlusstext,
    positionen: positionenAus(f),
    zahlungsweg: art === 'quittung' || art === 'eigenbeleg' || (art === 'rechnung' && f.bezahltAm) ? f.zahlungsart : null,
    quittiert,
    eigenbeleg: art === 'eigenbeleg' ? { grund: f.grund, grund_text: f.grundText, gebucht: null } : null,
    ausgestellt_am: null,
    firma: ctx.firma,
    logo: ctx.logo || null,
    ust_modus: ctx.ustModus,
  };
}

/** Was an beleg_entwurf_speichern / beleg_ausstellen geht (Vertrag mit src-tauri/src/rechnungen.rs EntwurfEingabe). */
export interface BelegDaten {
  art: Belegart;
  kunde_id: number | null;
  kunde_name: string | null;
  kunde_adresse: string | null;
  datum: string;
  leistung_von: string | null;
  leistung_bis: string | null;
  faellig_am: string | null;
  betreff: string | null;
  einleitung: string | null;
  schlusstext: string | null;
  zahlungsart: Zahlungsart | null;
  bezahlt_am: string | null;
  vorlage_id: number | null;
  termin_id: number | null;
  positionen: { beschreibung: string; menge: number; einheit: string | null; einzelpreis_cent: number; kategorie_id: number | null }[];
  zusatz: Record<string, unknown>;
}

export type FormularFehler = Partial<Record<'kunde' | 'datum' | 'positionen' | 'betrag' | 'kategorie' | 'betreff', string>>;

const leer = (s: string): string | null => (s.trim() ? s.trim() : null);

/** Formular ⇒ Eingabe für Rust. Fehler nur für das, was sich nicht speichern lässt (Pflichtangaben prüft der Check). */
export function formularZuDaten(f: BelegFormular, kunden: readonly KundeAnschrift[]): { ok: true; daten: BelegDaten } | { ok: false; fehler: FormularFehler } {
  const fehler: FormularFehler = {};
  if (!f.datum) fehler.datum = 'Bitte ein Datum wählen.';
  for (const p of f.positionen) {
    if (p.menge.trim() && parseMenge(p.menge) === null) fehler.positionen = 'Menge nicht lesbar – z. B. 1, 2,5 oder 0,25';
    else if (p.preis.trim() && parseBetrag(p.preis) === null) fehler.positionen = 'Preis nicht lesbar – z. B. 45 oder 45,50';
  }
  let kundeId: number | null = null;
  let kundeName: string | null = null;
  let adresse: string | null = leer(f.adresse);
  if (f.art === 'eigenbeleg') kundeName = leer(f.kunde);
  else {
    const k = formularKunde(f, kunden);
    if (k.art === 'kunde') {
      kundeId = k.kunde.id;
      // die Anschrift eines gewählten Kunden steht in der Kartei; ergänzt wird nur, wenn sie dort fehlt (Rust)
      const x = kunden.find((y) => y.id === k.kunde.id);
      if (x && (x.strasse || x.ort)) adresse = null;
    } else if (k.art === 'neu') kundeName = k.name;
    else if (k.art === 'wahl') fehler.kunde = `Mehrere Kunden heißen „${k.name}“ – bitte wählen, wer gemeint ist.`;
  }
  if (Object.keys(fehler).length) return { ok: false, fehler };
  const zusatz: Record<string, unknown> = {};
  if (f.art === 'eigenbeleg') {
    zusatz.grund = f.grund;
    if (f.grund === 'sonstiges') zusatz.grund_text = f.grundText.trim();
  }
  if (f.buchungId != null) zusatz.buchung_id = f.buchungId;
  if (f.art === 'quittung' && f.mehrere) zusatz.mehrere = true;
  // Kategorie nur beim Eigenbeleg (Ausgabe); die Einnahme-Kategorie setzt Rust beim Ausstellen
  const katEigen = f.art === 'eigenbeleg' ? (f.positionen[0]?.kategorieId ?? null) : null;
  const positionen = positionenAus(f).map((p) => ({
    beschreibung: p.beschreibung,
    menge: p.menge,
    einheit: p.einheit || null,
    einzelpreis_cent: p.einzelpreis_cent,
    kategorie_id: katEigen,
  }));
  const rechnungsartig = f.art === 'rechnung' || f.art === 'angebot';
  return {
    ok: true,
    daten: {
      art: f.art,
      kunde_id: kundeId,
      kunde_name: kundeName,
      kunde_adresse: adresse,
      datum: f.datum,
      leistung_von: f.art === 'angebot' ? null : leer(f.leistungVon) ?? f.datum,
      leistung_bis: f.art === 'angebot' ? null : leer(f.leistungBis),
      faellig_am: rechnungsartig ? faelligAus(f) : null,
      betreff: leer(f.betreff),
      einleitung: leer(f.einleitung),
      schlusstext: leer(f.schlusstext),
      zahlungsart: f.art === 'angebot' || (f.art === 'rechnung' && !f.bezahltAm) ? null : f.zahlungsart,
      bezahlt_am: f.art === 'rechnung' ? f.bezahltAm : null,
      vorlage_id: f.vorlageId,
      termin_id: f.terminId,
      positionen,
      zusatz,
    },
  };
}

/* ---------- neues Formular, Entwurf laden, Art wechseln ---------- */

/** Vorgaben für ein neues Formular (aus der Adresse, dem Neu-Menü, der Erfassen-Schublade). */
export interface NeuVorgabe {
  art: Belegart;
  /** Cent */
  betrag?: number;
  datum?: string;
  text?: string;
  kunde?: KundeAnschrift | null;
  /** Name eines neuen Kunden bzw. Empfängers */
  name?: string;
  zahlungsart?: Zahlungsart;
  bezahlt?: boolean;
  kategorieId?: number | null;
  buchungId?: number | null;
  terminId?: number | null;
}

export function neuesFormular(v: NeuVorgabe, o: { heute: string; zielTage: Partial<Record<Belegart, number>> }): BelegFormular {
  const art = v.art;
  const datum = v.datum ?? o.heute;
  const betreff = (v.text ?? '').trim();
  const einheit = art === 'quittung' ? 'Stk.' : art === 'eigenbeleg' ? '' : 'pausch.';
  const pos = leerePosition(art === 'rechnung' || art === 'angebot' ? 'Stk.' : einheit, betreff);
  if (v.betrag) {
    pos.preis = preisEingabe(v.betrag);
    pos.einheit = einheit;
  }
  pos.kategorieId = v.kategorieId ?? null;
  const ziel = o.zielTage[art] ?? ZIEL_STANDARD[art];
  return {
    art,
    kunde: v.kunde ? kundenLabel(v.kunde) : (v.name ?? ''),
    kundeBewusstNeu: null,
    adresse: v.kunde && art === 'quittung' ? anschriftText(v.kunde) : '',
    datum,
    leistungVon: datum,
    leistungBis: '',
    zielTage: String(ziel),
    betreff,
    einleitung: STANDARD_TEXTE[art].einleitung,
    schlusstext: STANDARD_TEXTE[art].schlusstext,
    positionen: [pos],
    mehrere: false,
    zahlungsart: v.zahlungsart ?? (art === 'rechnung' || art === 'angebot' ? 'bank' : 'bar'),
    bezahltAm: art === 'rechnung' && v.bezahlt ? datum : null,
    grund: 'verloren',
    grundText: '',
    vorlageId: null,
    terminId: v.terminId ?? null,
    buchungId: v.buchungId ?? null,
  };
}

/** Gespeicherter Entwurf (Zeile + Positionen) ⇒ Formular. */
export interface EntwurfZeile {
  id: number;
  art: string;
  kunde_id: number | null;
  kunde_name: string | null;
  kunde_adresse: string | null;
  kunde_nummer_live: string | null;
  kunde_name_live: string | null;
  datum: string | null;
  leistung_von: string | null;
  leistung_bis: string | null;
  faellig_am: string | null;
  betreff: string | null;
  einleitung: string | null;
  schlusstext: string | null;
  zahlungsart: string | null;
  bezahlt_am: string | null;
  vorlage_id: number | null;
  termin_id: number | null;
  entwurf_json: string | null;
}

export interface PositionZeile {
  beschreibung: string;
  menge: number;
  einheit: string | null;
  einzelpreis_cent: number;
  kategorie_id: number | null;
}

const istZahlungsart = (v: unknown): v is Zahlungsart => v === 'bar' || v === 'bank' || v === 'paypal';
const istGrund = (v: unknown): v is EigenbelegGrund => typeof v === 'string' && v in EIGENBELEG_GRUENDE;

export function formularAusEntwurf(z: EntwurfZeile, positionen: readonly PositionZeile[], heute: string): BelegFormular {
  const art: Belegart = z.art === 'rechnung' || z.art === 'angebot' || z.art === 'eigenbeleg' ? z.art : 'quittung';
  let zusatz: Record<string, unknown> = {};
  try {
    const roh: unknown = z.entwurf_json ? JSON.parse(z.entwurf_json) : {};
    if (roh && typeof roh === 'object' && !Array.isArray(roh)) zusatz = roh as Record<string, unknown>;
  } catch {
    /* kaputte Zusatzangaben: ignorieren */
  }
  const datum = z.datum ?? heute;
  const ziel = z.faellig_am && datum ? Math.max(0, tageZwischen(datum, z.faellig_am)) : ZIEL_STANDARD[art];
  const kunde =
    z.kunde_id != null && z.kunde_name_live ? kundenLabel({ name: z.kunde_name_live, nummer: z.kunde_nummer_live ?? '' }) : (z.kunde_name ?? '');
  const pos: PositionFormular[] = positionen.map((p) => ({
    beschreibung: p.beschreibung,
    menge: mengeEingabe(p.menge),
    einheit: p.einheit ?? '',
    preis: preisEingabe(p.einzelpreis_cent),
    kategorieId: p.kategorie_id,
  }));
  return {
    art,
    kunde,
    kundeBewusstNeu: null,
    adresse: z.kunde_adresse ?? '',
    datum,
    leistungVon: z.leistung_von ?? datum,
    leistungBis: z.leistung_bis && z.leistung_bis !== z.leistung_von ? z.leistung_bis : '',
    zielTage: String(ziel),
    betreff: z.betreff ?? '',
    einleitung: z.einleitung ?? '',
    schlusstext: z.schlusstext ?? '',
    positionen: pos.length ? pos : [leerePosition(art === 'eigenbeleg' ? '' : 'Stk.', z.betreff ?? '')],
    mehrere: art === 'quittung' && (zusatz.mehrere === true || pos.length > 1),
    zahlungsart: istZahlungsart(z.zahlungsart) ? z.zahlungsart : art === 'rechnung' || art === 'angebot' ? 'bank' : 'bar',
    bezahltAm: art === 'rechnung' ? z.bezahlt_am : null,
    grund: istGrund(zusatz.grund) ? zusatz.grund : 'verloren',
    grundText: typeof zusatz.grund_text === 'string' ? zusatz.grund_text : '',
    vorlageId: z.vorlage_id,
    terminId: z.termin_id,
    buchungId: typeof zusatz.buchung_id === 'number' ? zusatz.buchung_id : null,
  };
}

/** Art im Entwurf wechseln (Prototyp wechsleArt): Standardtexte mitwechseln, Kunde/Empfänger und Zahlungsweg anpassen. */
export function artWechseln(f: BelegFormular, art: Belegart, zielTage: Partial<Record<Belegart, number>> = {}): BelegFormular {
  if (art === f.art) return f;
  const alt = STANDARD_TEXTE[f.art];
  const neu = STANDARD_TEXTE[art];
  const einleitung = f.einleitung === alt.einleitung || !f.einleitung.trim() ? neu.einleitung : f.einleitung;
  const schlusstext = f.schlusstext === alt.schlusstext ? neu.schlusstext : f.schlusstext;
  const wechselEigen = art === 'eigenbeleg' || f.art === 'eigenbeleg';
  const summe = formularSumme(f);
  let positionen = f.positionen;
  if (art === 'eigenbeleg') positionen = [{ ...leerePosition('', f.betreff), preis: preisEingabe(summe) }];
  else if (f.art === 'eigenbeleg') positionen = [{ ...leerePosition(art === 'quittung' ? 'Stk.' : 'pausch.', f.betreff), preis: preisEingabe(summe) }];
  const rechnungsartig = art === 'rechnung' || art === 'angebot';
  return {
    ...f,
    art,
    einleitung,
    schlusstext,
    kunde: wechselEigen ? '' : f.kunde,
    kundeBewusstNeu: wechselEigen ? null : f.kundeBewusstNeu,
    adresse: wechselEigen ? '' : f.adresse,
    positionen: positionen.map((p) => ({ ...p, kategorieId: art === 'eigenbeleg' ? p.kategorieId : null })),
    mehrere: art === 'quittung' && positionen.length > 1,
    zielTage: rechnungsartig ? String(zielTage[art] ?? ZIEL_STANDARD[art]) : f.zielTage,
    zahlungsart: f.buchungId != null ? f.zahlungsart : rechnungsartig ? 'bank' : 'bar',
    bezahltAm: art === 'rechnung' ? f.bezahltAm : null,
    buchungId: art === 'angebot' ? null : f.buchungId,
    vorlageId: null,
  };
}

/** Vergleichsschlüssel für „ungespeichert“. */
export const formularSchluessel = (f: BelegFormular): string => JSON.stringify(f);

/** „Für“ auf der Quittung mit nur einem Betrag: Betreff ist zugleich der Text der einzigen Position. */
export function betreffSetzen(f: BelegFormular, betreff: string): BelegFormular {
  const einzeln = f.art === 'eigenbeleg' || (f.art === 'quittung' && !f.mehrere);
  if (!einzeln) return { ...f, betreff };
  const [erste, ...rest] = f.positionen.length ? f.positionen : [leerePosition()];
  return { ...f, betreff, positionen: [{ ...erste, beschreibung: betreff }, ...rest] };
}

/** Quittung/Eigenbeleg mit einem Betrag: Betrag ⇒ einzige Position (Menge 1). */
export function betragSetzen(f: BelegFormular, eingabe: string): BelegFormular {
  const [erste, ...rest] = f.positionen.length ? f.positionen : [leerePosition()];
  return { ...f, positionen: [{ ...erste, menge: '1', preis: eingabe, beschreibung: erste.beschreibung || f.betreff }, ...rest] };
}

/** Summe des Formulars in Cent (Vorschau, Hinweise). */
export const formularSumme = (f: BelegFormular): number => belegSumme({ positionen: positionenAus(f) });

/** Ausgestellter Beleg ⇒ Formular, nur zum Anzeigen in der gesperrten Maske (so steht es auf dem Beleg). */
export function formularAusDokument(d: BelegDokument, extra: { vorlageId: number | null; terminId: number | null }): BelegFormular {
  const k = d.kunde;
  return {
    art: d.art,
    kunde: k ? (k.nummer ? kundenLabel({ name: k.name, nummer: k.nummer }) : k.name) : '',
    kundeBewusstNeu: null,
    adresse: k ? anschriftText(k) : '',
    datum: d.datum,
    leistungVon: d.leistung_von ?? d.datum,
    leistungBis: d.leistung_bis && d.leistung_bis !== d.leistung_von ? d.leistung_bis : '',
    zielTage: d.faellig_am && d.datum ? String(Math.max(0, tageZwischen(d.datum, d.faellig_am))) : '0',
    betreff: d.betreff,
    einleitung: d.einleitung,
    schlusstext: d.schlusstext,
    positionen: d.positionen.map((p) => ({
      beschreibung: p.beschreibung,
      menge: mengeEingabe(p.menge),
      einheit: p.einheit,
      preis: preisEingabe(p.einzelpreis_cent),
      kategorieId: null,
    })),
    mehrere: d.art === 'quittung' && d.positionen.length > 1,
    zahlungsart: d.quittiert?.zahlungsweg ?? d.zahlungsweg ?? 'bank',
    bezahltAm: d.quittiert?.am ?? null,
    grund: d.eigenbeleg?.grund ?? 'verloren',
    grundText: d.eigenbeleg?.grund_text ?? '',
    vorlageId: extra.vorlageId,
    terminId: extra.terminId,
    buchungId: null,
  };
}
