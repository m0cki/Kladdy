/* Termine (§6.5) – reine Logik ohne Datenbank: Zustand je Termin (nachtragen, „Beleg fehlt“, bezahlt ohne Beleg …),
 * Filter Anstehend · Erledigt · Alle, Agenda nach Tagen mit „Nachtragen“ oben, Wochenstreifen, Beleg-Chip, Knöpfe und
 * „⋯“-Menü je Termin, Formular der Termin-Schublade ⇒ Eingabe für Rust (src-tauri/src/termine.rs), vorbereiteter Beleg
 * (Entwurf ohne Nummer) als Formular der Beleg-Maske, Vorbelegung der Erfassen-Schublade und deren Hinweiszeile.
 * Geld nur in Cent, Kunden per ID („Name · K-0012“). Optik und Verhalten wie referenz/prototyp/js/pages/termine.js.
 * Tests: termine.test.ts */
import { datumKurz, kundeAufloesen, zahlungswegName, type KundeKurz, type Zahlungsart } from './buchungen';
import type { Vorbelegung } from './erfassen';
import type { ErtragBezug, ErtragsArt, Ertragsweg } from './ertrag';
import { tageZwischen, vorText } from './kunden';
import { isoWoche, wochenStart } from './liquiditaet';
import { formatBetrag, parseBetrag } from './money';
import { artWechseln, formularSumme, formularZuDaten, neuesFormular, preisEingabe, type BelegDaten, type BelegFormular } from './rechnungen';
import { normalize } from './suche';
import { istDatum, plusTage } from './zeitraum';

/* ================= Zeilen aus der Datenbank ================= */

export type TerminStatus = 'geplant' | 'erledigt' | 'abgesagt';
/** „Beleg vorbereiten: Quittung | Rechnung | Keinen“ */
export type BelegWahl = ErtragsArt | 'keinen';

/** Ein Termin (lib/queries/termine.ts). */
export interface TerminZeile {
  id: number;
  kunde_id: number | null;
  kunde_name: string | null;
  kunde_nummer: string | null;
  kunde_notiz: string | null;
  /** 'YYYY-MM-DD' */
  datum: string;
  /** 'HH:MM' */
  von: string | null;
  bis: string | null;
  adresse: string | null;
  leistung: string;
  betrag_geschaetzt_cent: number | null;
  notiz: string | null;
  status: TerminStatus;
  /** 1 = erledigt und bewusst ohne Beleg abgeschlossen */
  ohne_beleg: number;
}

/** Beleg zu einem Termin: am Termin selbst (rechnungen.termin_id) oder als bezahlte Rechnung, deren Einnahme auf den
 *  Termin verweist („Offene Rechnung zuordnen“). Ohne Nummer = vorbereiteter Entwurf. */
export interface TerminBelegZeile {
  id: number;
  termin_id: number;
  art: string;
  nummer: string | null;
  status: string;
  summe_cent: number;
}

/** Einnahme mit buchungen.termin_id. */
export interface TerminEinnahmeZeile {
  id: number;
  termin_id: number;
  nummer: string;
  betrag_cent: number;
  zahlungsdatum: string;
  zahlungsart: Zahlungsart | null;
  rechnung_id: number | null;
  /** 1 = per Gegenbuchung storniert */
  storniert: number;
}

export interface Termin extends TerminZeile {
  /** vorbereiteter Beleg (Entwurf ohne Nummer) */
  entwurf: TerminBelegZeile | null;
  /** ausgestellter Beleg – ein gültiger vor einem stornierten */
  beleg: TerminBelegZeile | null;
  /** Einnahme ohne eigenen Beleg („bezahlt ohne Beleg“), nicht storniert */
  einnahme: TerminEinnahmeZeile | null;
}

const istStorniert = (b: Pick<TerminBelegZeile, 'status'>): boolean => b.status === 'storniert';

/** Termine mit ihrem Entwurf, Beleg und ihrer Einnahme zusammenführen. */
export function termineZusammenfuehren(
  zeilen: readonly TerminZeile[],
  belege: readonly TerminBelegZeile[],
  einnahmen: readonly TerminEinnahmeZeile[],
): Termin[] {
  const entwurf = new Map<number, TerminBelegZeile>();
  const beleg = new Map<number, TerminBelegZeile>();
  for (const b of [...belege].sort((x, y) => x.id - y.id)) {
    if (!b.nummer) {
      if (!entwurf.has(b.termin_id)) entwurf.set(b.termin_id, b);
      continue;
    }
    if (b.art !== 'quittung' && b.art !== 'rechnung') continue;
    const bisher = beleg.get(b.termin_id);
    if (!bisher || istStorniert(bisher) || !istStorniert(b)) beleg.set(b.termin_id, b);
  }
  const einnahme = new Map<number, TerminEinnahmeZeile>();
  for (const e of einnahmen) {
    if (e.storniert || e.rechnung_id != null) continue;
    const bisher = einnahme.get(e.termin_id);
    if (!bisher || e.id > bisher.id) einnahme.set(e.termin_id, e);
  }
  return zeilen.map((t) => ({ ...t, entwurf: entwurf.get(t.id) ?? null, beleg: beleg.get(t.id) ?? null, einnahme: einnahme.get(t.id) ?? null }));
}

/* ================= Zustand ================= */

export const ART_LABEL: Readonly<Record<ErtragsArt, string>> = { quittung: 'Quittung', rechnung: 'Rechnung' };
const artVon = (art: string | undefined, standard: ErtragsArt): ErtragsArt => (art === 'rechnung' ? 'rechnung' : art === 'quittung' ? 'quittung' : standard);

/** Geplant, aber schon vorbei („War der Termin?“). */
export const istNachtragen = (t: Pick<TerminZeile, 'status' | 'datum'>, heute: string): boolean => t.status === 'geplant' && t.datum < heute;

/** Gültiger ausgestellter Beleg (nicht storniert). */
export const belegAus = (t: Pick<Termin, 'beleg'>): TerminBelegZeile | null => (t.beleg && !istStorniert(t.beleg) ? t.beleg : null);

/** Erledigt, aber noch ohne Beleg (und nicht bewusst „ohne Beleg“ abgeschlossen). */
export const belegFehlt = (t: Pick<Termin, 'status' | 'ohne_beleg' | 'beleg'>): boolean => t.status === 'erledigt' && !t.ohne_beleg && !belegAus(t);

/** Gehört nach „Nachtragen“ (und zählt rot in der Seitenleiste). */
export const istOffen = (t: Pick<Termin, 'status' | 'datum' | 'ohne_beleg' | 'beleg'>, heute: string): boolean => istNachtragen(t, heute) || belegFehlt(t);

/** Art des Belegs zum Ausstellen: die des vorbereiteten Entwurfs, sonst die Einstellung „Beleg bei Einnahmen“. */
export const ausstellArt = (t: Pick<Termin, 'entwurf'>, standard: ErtragsArt): ErtragsArt => artVon(t.entwurf?.art, standard);

export const ausstellLabel = (art: ErtragsArt): string => (art === 'rechnung' ? 'Rechnung schreiben' : 'Quittung ausstellen');

/** Beleg zum erledigten Termin ausstellen? Nicht, wenn es schon einen Beleg oder eine Einnahme gibt (zählt nur einmal). */
export const kannAusstellen = (t: Pick<Termin, 'status' | 'beleg' | 'einnahme'>): boolean => t.status === 'erledigt' && !belegAus(t) && !t.einnahme;

/* ================= Datum und Uhrzeit ================= */

const pad = (n: number) => String(n).padStart(2, '0');
const utcTag = (iso: string): Date => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** 'HH:MM' ⇒ Minuten seit Mitternacht; null = leer bzw. ungültig. */
export function minuten(s: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export const uhr = (min: number): string => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/** Vorschlag für „bis“: zwei Stunden nach „von“ (höchstens 23:59). */
export function plus2h(von: string): string {
  const m = minuten(von);
  return m == null ? '' : uhr(Math.min(23 * 60 + 59, m + 120));
}

/** Nach Tag, dann Uhrzeit (ohne Uhrzeit zuerst), dann Anlage. */
export const chrono = (a: Pick<TerminZeile, 'datum' | 'von' | 'id'>, b: Pick<TerminZeile, 'datum' | 'von' | 'id'>): number =>
  a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : (minuten(a.von) ?? -1) - (minuten(b.von) ?? -1) || a.id - b.id;

/** „Mo“ */
export const wochentagKurz = (iso: string): string => WOCHENTAGE[utcTag(iso).getUTCDay()].slice(0, 2);

/** „Heute“, „Morgen“, „Gestern“ oder ''. */
export function relTag(datum: string, heute: string): string {
  const n = tageZwischen(heute, datum);
  return n === 0 ? 'Heute' : n === 1 ? 'Morgen' : n === -1 ? 'Gestern' : '';
}

/** „Montag, 12. Oktober“ (anderes Jahr: „Montag, 12. Oktober 2025“). */
export function tagLang(datum: string, heute: string): string {
  const d = utcTag(datum);
  const jahr = datum.slice(0, 4) === heute.slice(0, 4) ? '' : ` ${datum.slice(0, 4)}`;
  return `${WOCHENTAGE[d.getUTCDay()]}, ${d.getUTCDate()}. ${MONATE[d.getUTCMonth()]}${jahr}`;
}

/** Kurz mit Uhrzeit: „Mo, 12.10.2026 · 08:00“ (Hinweis in der Erfassen-Schublade). */
export const terminWann = (t: Pick<TerminZeile, 'datum' | 'von'>): string => `${wochentagKurz(t.datum)}, ${datumKurz(t.datum)}${t.von ? ` · ${t.von}` : ''}`;

/** „08:00–10:00“, „08:00“ oder ''. */
export const zeitText = (t: Pick<TerminZeile, 'von' | 'bis'>): string => (t.von ? (t.bis ? `${t.von}–${t.bis}` : t.von) : '');

/* ================= Filter und Agenda ================= */

export type TerminFilter = 'anstehend' | 'erledigt' | 'alle';
export const FILTER: readonly { value: TerminFilter; label: string }[] = [
  { value: 'anstehend', label: 'Anstehend' },
  { value: 'erledigt', label: 'Erledigt' },
  { value: 'alle', label: 'Alle' },
];

/** Steht der Termin im Filter? Anstehend = Nachtragen + heute + Zukunft (heute erledigte bleiben stehen). */
export function sichtbar(t: Termin, f: TerminFilter, heute: string): boolean {
  if (f === 'alle') return true;
  if (f === 'erledigt') return t.status === 'erledigt';
  return t.status === 'geplant' || belegFehlt(t) || (t.status === 'erledigt' && t.datum === heute);
}

/** Zähler an den Filtern: je Filter genau die Zeilen der Liste. */
export function filterZaehler(liste: readonly Termin[], heute: string): Record<TerminFilter, number> {
  return {
    anstehend: liste.filter((t) => sichtbar(t, 'anstehend', heute)).length,
    erledigt: liste.filter((t) => t.status === 'erledigt').length,
    alle: liste.length,
  };
}

export type Gruppe = { typ: 'nachtragen'; items: Termin[] } | { typ: 'tag'; datum: string; items: Termin[] } | { typ: 'trenner'; text: string };

function nachTagen(liste: readonly Termin[], absteigend = false): Gruppe[] {
  const m = new Map<string, Termin[]>();
  for (const t of liste) m.set(t.datum, [...(m.get(t.datum) ?? []), t]);
  const tage = [...m.keys()].sort();
  if (absteigend) tage.reverse();
  return tage.map((d): Gruppe => ({ typ: 'tag', datum: d, items: (m.get(d) ?? []).sort(chrono) }));
}

/** Gruppen der Agenda: oben „Nachtragen“, dann je Tag ab heute („Heute“ steht immer da); unter „Alle“ dazu „Vorbei“
 *  (neueste zuerst); „Erledigt“ = alle erledigten, neueste zuerst. */
export function gruppen(liste: readonly Termin[], f: TerminFilter, heute: string): Gruppe[] {
  if (f === 'erledigt') return nachTagen(liste.filter((t) => t.status === 'erledigt'), true);
  const g: Gruppe[] = [];
  const nach = liste.filter((t) => istOffen(t, heute)).sort(chrono);
  if (nach.length) g.push({ typ: 'nachtragen', items: nach });
  const kommend = nachTagen(liste.filter((t) => t.datum >= heute && !istOffen(t, heute) && sichtbar(t, f, heute)));
  if (!kommend.some((x) => x.typ === 'tag' && x.datum === heute)) kommend.unshift({ typ: 'tag', datum: heute, items: [] });
  g.push(...kommend);
  if (f === 'alle') {
    const vorbei = liste.filter((t) => t.datum < heute && !istOffen(t, heute));
    if (vorbei.length) g.push({ typ: 'trenner', text: 'Vorbei' }, ...nachTagen(vorbei, true));
  }
  return g;
}

/** Untertitel von „Nachtragen“. */
export function nachtragenText(items: readonly Termin[], heute: string): string {
  const a = items.filter((t) => istNachtragen(t, heute)).length;
  const b = items.length - a;
  return a && b ? 'Termin abhaken oder Beleg ausstellen' : a ? 'vorbei, aber noch nicht abgehakt' : 'erledigt, aber noch ohne Beleg';
}

/** Kopf einer Tagesgruppe: „Heute · Montag, 12. Oktober“ bzw. „Donnerstag, 15. Oktober“ mit „in 3 Tagen“. */
export function tagKopf(datum: string, heute: string): { titel: string; zusatz: string } {
  const rel = relTag(datum, heute);
  return rel ? { titel: rel, zusatz: `· ${tagLang(datum, heute)}` } : { titel: tagLang(datum, heute), zusatz: vorText(datum, heute) };
}

/* ================= Wochenstreifen ================= */

export type PunktArt = 'geplant' | 'erledigt' | 'nach';

export interface WochenTag {
  datum: string;
  termine: Termin[];
  heute: boolean;
  vorbei: boolean;
  wochenende: boolean;
}

export interface Woche {
  label: string;
  kw: number;
  tage: WochenTag[];
}

/** Punkt je Termin: nachzutragen (warn) · erledigt (pos) · geplant (Akzent). */
export const punktArt = (t: Termin, heute: string): PunktArt => (istOffen(t, heute) ? 'nach' : t.status === 'erledigt' ? 'erledigt' : 'geplant');

/** Diese und nächste Woche (ab Montag), je Tag die Termine ohne abgesagte. */
export function wochenStreifen(liste: readonly Termin[], heute: string): Woche[] {
  const mo = wochenStart(heute);
  const proTag = new Map<string, Termin[]>();
  for (const t of liste) if (t.status !== 'abgesagt') proTag.set(t.datum, [...(proTag.get(t.datum) ?? []), t]);
  const woche = (start: string, label: string): Woche => ({
    label,
    kw: isoWoche(start).woche,
    tage: [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const d = plusTage(start, i);
      const wt = utcTag(d).getUTCDay();
      return { datum: d, termine: (proTag.get(d) ?? []).sort(chrono), heute: d === heute, vorbei: d < heute, wochenende: wt === 0 || wt === 6 };
    }),
  });
  return [woche(mo, 'Diese Woche'), woche(plusTage(mo, 7), 'Nächste Woche')];
}

/** Der Streifen schaut nach vorn: nicht unter „Erledigt“ und nicht, wenn in den zwei Wochen nichts ansteht. */
export function wocheZeigen(liste: readonly Termin[], f: TerminFilter, heute: string): boolean {
  if (f === 'erledigt') return false;
  const mo = wochenStart(heute);
  const so = plusTage(mo, 13);
  return liste.some((t) => t.status !== 'abgesagt' && t.datum >= mo && t.datum <= so);
}

/* ================= Zeile: Betrag, Beleg-Chip, Knöpfe, Menü ================= */

/** Betrag rechts: laut Beleg bzw. Einnahme, sonst geschätzt („ca.“). */
export function betragAnzeige(t: Termin): { cent: number; ist: boolean; titel: string } | null {
  const aus = belegAus(t);
  if (aus) return { cent: aus.summe_cent, ist: true, titel: 'laut Beleg' };
  if (t.status === 'erledigt' && t.ohne_beleg && t.einnahme) return { cent: t.einnahme.betrag_cent, ist: true, titel: 'laut Einnahme' };
  const cent = t.entwurf?.summe_cent || t.betrag_geschaetzt_cent || 0;
  return cent > 0 ? { cent, ist: false, titel: 'geschätzt' } : null;
}

/** „65 €“ bzw. „65,50 €“ */
export const betragKurz = (cent: number): string => (cent % 100 ? formatBetrag(cent) : formatBetrag(cent, { nachkomma: 0 }));

export type ChipArt = 'abgesagt' | 'fehlt' | 'bezahlt' | 'ohne' | 'leer' | 'vorbereitet' | 'storniert' | 'ausgestellt';

export interface Chip {
  art: ChipArt;
  text: string;
  titel: string;
  /** Symbol: Quittung oder Rechnung */
  belegArt?: ErtragsArt;
  /** Klick öffnet diesen Beleg (Beleg-Maske) */
  beleg?: number;
  /** Klick öffnet diese Einnahme (Erfassen-Schublade) */
  einnahme?: number;
  /** ausgestellte Rechnung, noch nicht bezahlt */
  offen?: boolean;
}

/** Beleg-Chip: vorbereitet · Nummer ✓ · Beleg fehlt · bezahlt ohne Beleg · ohne Beleg · abgesagt. */
export function chip(t: Termin): Chip {
  if (t.status === 'abgesagt') return { art: 'abgesagt', text: 'abgesagt', titel: 'Termin abgesagt' };
  if (belegFehlt(t)) {
    const titel = t.entwurf ? `${ART_LABEL[artVon(t.entwurf.art, 'quittung')]} vorbereitet, noch ohne Nummer` : 'Noch kein Beleg zu diesem Termin';
    return { art: 'fehlt', text: 'Beleg fehlt', titel };
  }
  const aus = belegAus(t);
  if (t.status === 'erledigt' && t.ohne_beleg && !aus) {
    if (t.einnahme) {
      const titel = `Einnahme ${t.einnahme.nummer} ohne Beleg · ${zahlungswegName(t.einnahme.zahlungsart)} – öffnen`;
      return { art: 'bezahlt', text: 'bezahlt ohne Beleg', titel, einnahme: t.einnahme.id };
    }
    return { art: 'ohne', text: 'ohne Beleg', titel: 'Ohne Beleg abgeschlossen (z. B. Nachbesserung, kostenlos)' };
  }
  if (aus) {
    const art = artVon(aus.art, 'quittung');
    const offen = aus.status !== 'bezahlt';
    return { art: 'ausgestellt', text: aus.nummer ?? '', titel: `${ART_LABEL[art]} ${offen ? 'offen' : 'bezahlt'} – öffnen`, belegArt: art, beleg: aus.id, offen };
  }
  if (t.entwurf) {
    const art = artVon(t.entwurf.art, 'quittung');
    return { art: 'vorbereitet', text: `${ART_LABEL[art]} vorbereitet`, titel: 'Entwurf ohne Nummer – öffnen', belegArt: art, beleg: t.entwurf.id };
  }
  if (t.beleg) {
    const art = artVon(t.beleg.art, 'quittung');
    return { art: 'storniert', text: t.beleg.nummer ?? '', titel: `${ART_LABEL[art]} storniert – öffnen`, belegArt: art, beleg: t.beleg.id };
  }
  return { art: 'leer', text: 'ohne Beleg', titel: 'Kein Beleg vorbereitet' };
}

/** Zustandsklasse der Zeile (farbige Zeitkante). */
export const zeilenStatus = (t: Termin, heute: string): 'abgesagt' | 'fehlt' | 'erledigt' | 'nach' | 'geplant' =>
  t.status === 'abgesagt' ? 'abgesagt' : belegFehlt(t) ? 'fehlt' : t.status === 'erledigt' ? 'erledigt' : istNachtragen(t, heute) ? 'nach' : 'geplant';

export type TerminAktion = 'abhaken' | 'ausstellen' | 'ohne' | 'mitbeleg' | 'nichterledigt' | 'absagen' | 'wieder' | 'bearbeiten' | 'vorbereiten' | 'einnahme';

/** Knöpfe rechts in der Zeile. */
export interface Knoepfe {
  /** „War der Termin?“ */
  frage: boolean;
  /** Hauptknopf */
  haupt: 'abhaken' | 'ausstellen' | 'wieder' | null;
  absagen: boolean;
  /** „⋯“-Menü */
  mehr: boolean;
}

export function knoepfe(t: Termin, heute: string): Knoepfe {
  if (t.status === 'abgesagt') return { frage: false, haupt: 'wieder', absagen: false, mehr: false };
  if (t.status === 'erledigt') {
    if (belegAus(t)) return { frage: false, haupt: null, absagen: false, mehr: false };
    if (t.ohne_beleg || t.einnahme) return { frage: false, haupt: null, absagen: false, mehr: true };
    return { frage: false, haupt: 'ausstellen', absagen: false, mehr: true };
  }
  const nach = istNachtragen(t, heute);
  return { frage: nach, haupt: t.datum <= heute ? 'abhaken' : null, absagen: nach, mehr: true };
}

export interface MenuePunkt {
  aktion: TerminAktion;
  label: string;
  sub: string;
  neg?: boolean;
}
export type MenueEintrag = MenuePunkt | { trenner: true };

/** „⋯“-Menü je Termin (Prototyp menuItems; „In Kalender“ kommt mit Phase 7). */
export function menue(t: Termin, heute: string, standard: ErtragsArt): MenueEintrag[] {
  if (t.status === 'erledigt') {
    const zurueck: MenuePunkt = { aktion: 'nichterledigt', label: 'Doch nicht erledigt', sub: 'Zurück auf geplant' };
    const art = ART_LABEL[ausstellArt(t, standard)];
    if (t.einnahme) {
      return [{ aktion: 'einnahme', label: 'Einnahme öffnen', sub: `Bezahlt ohne Beleg · ${formatBetrag(t.einnahme.betrag_cent)} am ${datumKurz(t.einnahme.zahlungsdatum)}` }];
    }
    if (t.ohne_beleg) return [{ aktion: 'mitbeleg', label: `Doch mit ${art}`, sub: 'Öffnet „Erfassen“ zum Ausstellen' }, zurueck];
    const sub = t.entwurf ? `z. B. Nachbesserung, kostenlos – vorbereitete ${art} wird verworfen` : 'z. B. Nachbesserung, kostenlos';
    return [{ aktion: 'ohne', label: 'Ohne Beleg abschließen', sub }, zurueck];
  }
  if (t.status !== 'geplant') return [];
  const punkte: MenueEintrag[] = [{ aktion: 'bearbeiten', label: 'Bearbeiten / Verschieben', sub: 'Tag, Uhrzeit, Adresse, Leistung' }];
  if (!t.entwurf && !t.beleg) {
    punkte.push({ aktion: 'vorbereiten', label: `${ART_LABEL[standard]} vorbereiten`, sub: 'Entwurf ohne Nummer – die Nummer kommt beim Ausstellen' });
  }
  if (!istNachtragen(t, heute)) {
    const sub = t.entwurf ? `Vorbereitete ${ART_LABEL[artVon(t.entwurf.art, standard)]} wird verworfen` : '';
    punkte.push({ trenner: true }, { aktion: 'absagen', label: 'Absagen', sub, neg: true });
  }
  return punkte;
}

/* ================= Termin-Schublade: Formular ⇒ Eingabe für Rust ================= */

/** Kunde mit Anschrift und Notiz (Vorschläge, Adresse übernehmen, Notiz zeigen). */
export interface TerminKunde extends KundeKurz {
  zusatz: string | null;
  strasse: string | null;
  plz: string | null;
  notiz: string | null;
}

/** Adresse eines Kunden für das Feld „Adresse“ (Straße, PLZ Ort). */
export const adresseVon = (k: Pick<TerminKunde, 'strasse' | 'plz' | 'ort'> | null | undefined): string =>
  k ? [k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].map((s) => (s ?? '').trim()).filter(Boolean).join('\n') : '';

/** Adresse einzeilig: „Gartenweg 3, 12390 Seehausen“. */
export const adresseEinzeilig = (a: string | null | undefined): string =>
  (a ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');

/** Link für Apple Karten (öffnet Rust über link_oeffnen, nur diese Form ist erlaubt). */
export const kartenUrl = (a: string | null | undefined): string | null => {
  const e = adresseEinzeilig(a);
  return e ? `https://maps.apple.com/?q=${encodeURIComponent(e)}` : null;
};

export interface TerminFormular {
  /** „Name · K-0012“ (gebunden) oder ein neuer Name */
  kunde: string;
  /** „Neuer Kunde mit diesem Namen“ gewählt (nameSchluessel) */
  kundeBewusstNeu: string | null;
  datum: string;
  von: string;
  bis: string;
  adresse: string;
  leistung: string;
  /** wie eingegeben, z. B. „65“ */
  betrag: string;
  notiz: string;
  beleg: BelegWahl;
}

export type TerminFeld = 'kunde' | 'datum' | 'von' | 'bis' | 'leistung' | 'betrag';

/** Was an termin_speichern geht (Vertrag mit src-tauri/src/termine.rs TerminEingabe). */
export interface TerminDaten {
  kunde_id: number | null;
  neuer_kunde: string | null;
  datum: string;
  von: string | null;
  bis: string | null;
  adresse: string | null;
  leistung: string;
  betrag_geschaetzt_cent: number | null;
  notiz: string | null;
  /** 'behalten' = den vorbereiteten Beleg nicht anfassen (ausgestellt, erledigt, abgesagt) */
  beleg: BelegWahl | 'behalten';
  wieder_einplanen: boolean;
  heute: string;
}

export const BETRAG_FEHLER = 'Betrag nicht lesbar – z. B. 65 oder 65,50';

/** Formular prüfen und in die Eingabe für Rust umwandeln (Fehler in Reihenfolge der Felder). */
export function terminPruefen(
  f: TerminFormular,
  kunden: readonly KundeKurz[],
  o: { heute: string; beleg: TerminDaten['beleg']; wiederEinplanen: boolean },
): { ok: true; daten: TerminDaten } | { ok: false; fehler: Partial<Record<TerminFeld, string>> } {
  const fehler: Partial<Record<TerminFeld, string>> = {};
  const k = kundeAufloesen(f.kunde, kunden, f.kundeBewusstNeu);
  if (k.art === 'leer') fehler.kunde = 'Bitte einen Kunden eintragen';
  else if (k.art === 'wahl') fehler.kunde = 'Bitte wählen, wer gemeint ist';
  if (!istDatum(f.datum)) fehler.datum = 'Bitte ein Datum wählen';
  const von = minuten(f.von);
  const bisText = f.bis.trim() || (von != null ? plus2h(f.von) : '');
  const bis = minuten(bisText);
  if (von == null) fehler.von = 'Beginn fehlt';
  else if (bisText && (bis == null || bis <= von)) fehler.bis = 'Ende vor Beginn';
  const leistung = f.leistung.trim();
  if (!leistung) fehler.leistung = 'Was wird gemacht?';
  const cent = f.betrag.trim() ? parseBetrag(f.betrag) : null;
  if (f.betrag.trim() && (cent == null || cent < 0)) fehler.betrag = BETRAG_FEHLER;
  if (Object.keys(fehler).length || von == null) return { ok: false, fehler };
  const adresse = adresseZeilen(f.adresse);
  return {
    ok: true,
    daten: {
      kunde_id: k.art === 'kunde' ? k.kunde.id : null,
      neuer_kunde: k.art === 'neu' ? k.name : null,
      datum: f.datum,
      von: uhr(von),
      bis: bis != null ? uhr(bis) : null,
      adresse: adresse || null,
      leistung,
      betrag_geschaetzt_cent: cent && cent > 0 ? cent : null,
      notiz: f.notiz.trim() || null,
      beleg: o.beleg,
      wieder_einplanen: o.wiederEinplanen,
      heute: o.heute,
    },
  };
}

/** Adresse: Zeilen getrimmt, leere weg. */
const adresseZeilen = (a: string): string =>
  a
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n');

/** Termin ⇒ Eingabe für Rust (z. B. „Quittung vorbereiten“ aus dem Menü: alles bleibt, nur der Beleg kommt dazu). */
export function terminDatenAus(t: TerminZeile, beleg: TerminDaten['beleg'], heute: string): TerminDaten {
  return {
    kunde_id: t.kunde_id,
    neuer_kunde: t.kunde_id == null ? (t.kunde_name ?? null) : null,
    datum: t.datum,
    von: t.von,
    bis: t.bis,
    adresse: t.adresse,
    leistung: t.leistung,
    betrag_geschaetzt_cent: t.betrag_geschaetzt_cent,
    notiz: t.notiz,
    beleg,
    wieder_einplanen: false,
    heute,
  };
}

/** Überschneidungen mit anderen geplanten Terminen am selben Tag (ohne Ende: zwei Stunden). */
export function ueberschneidungen(liste: readonly Termin[], selbst: number | null, datum: string, von: string, bis: string): Termin[] {
  const a = minuten(von);
  if (a == null) return [];
  const b = minuten(bis) ?? a + 120;
  return liste.filter((x) => {
    if (x.id === selbst || x.status !== 'geplant' || x.datum !== datum) return false;
    const xa = minuten(x.von) ?? 0;
    const xb = minuten(x.bis) ?? xa + 120;
    return a < xb && xa < b;
  });
}

/** Hinweis unter „Wann“: Tag und Abstand, dazu höchstens eine Warnung. */
export function wannHinweis(o: {
  datum: string;
  von: string;
  bis: string;
  heute: string;
  /** neuer, geplanter oder wieder einzuplanender Termin */
  geplant: boolean;
  liste: readonly Termin[];
  selbst: number | null;
}): { tag: string; warnung: string | null } | null {
  if (!istDatum(o.datum)) return null;
  const tag = `${tagLang(o.datum, o.heute)} · ${vorText(o.datum, o.heute)}`;
  const a = minuten(o.von);
  const b = minuten(o.bis);
  let warnung: string | null = null;
  if (a != null && b != null && b <= a) warnung = 'Das Ende liegt vor dem Beginn.';
  else if (o.geplant) {
    const x = ueberschneidungen(o.liste, o.selbst, o.datum, o.von, o.bis);
    if (x.length) warnung = `Überschneidet sich mit ${x.map((t) => `${zeitText(t)} ${t.kunde_name ?? ''}`.trim()).join(', ')}.`;
    else if (o.datum < o.heute) warnung = 'Liegt in der Vergangenheit – erscheint unter „Nachtragen“.';
  }
  return { tag, warnung };
}

/* ---------- Leistungen (Vorschläge mit Ø-Betrag aus den Quittungen) ---------- */

export interface LeistungsVorschlag {
  text: string;
  /** wie oft (Quittungen + Termine) */
  n: number;
  /** Ø-Betrag aus Quittungen (Cent) bzw. null */
  schnitt: number | null;
  /** Anzahl Quittungen im Schnitt */
  nb: number;
}

/** Aus Betreffs der Quittungen (mit Betrag) und Leistungen der Termine (ohne): häufigste zuerst, höchstens 24. */
export function leistungsVorschlaege(zeilen: readonly { text: string | null; cent: number | null }[]): LeistungsVorschlag[] {
  const m = new Map<string, { text: string; n: number; summe: number; nb: number }>();
  for (const z of zeilen) {
    const text = (z.text ?? '').trim();
    const key = normalize(text).replace(/\s+/g, ' ');
    if (!key) continue;
    const x = m.get(key) ?? { text, n: 0, summe: 0, nb: 0 };
    x.n++;
    if (z.cent != null && z.cent > 0) {
      x.summe += z.cent;
      x.nb++;
    }
    m.set(key, x);
  }
  return [...m.values()]
    .sort((a, b) => b.n - a.n || a.text.localeCompare(b.text, 'de'))
    .slice(0, 24)
    .map((x) => ({ text: x.text, n: x.n, schnitt: x.nb ? Math.round(x.summe / x.nb) : null, nb: x.nb }));
}

/** „Sonst meist um 65 € (Ø aus 3 Quittungen)“ und ein passender Platzhalter; gerundet auf 1 € bzw. ab 20 € auf 5 €. */
export function betragVorschlag(leistung: string, vorschlaege: readonly LeistungsVorschlag[]): { cent: number; text: string } | null {
  const key = normalize(leistung.trim()).replace(/\s+/g, ' ');
  const x = key ? vorschlaege.find((v) => normalize(v.text).replace(/\s+/g, ' ') === key) : undefined;
  if (!x?.schnitt) return null;
  const cent = x.schnitt >= 2000 ? Math.round(x.schnitt / 500) * 500 : Math.round(x.schnitt / 100) * 100;
  if (!cent) return null;
  return { cent, text: `Sonst meist um ${betragKurz(cent)} (Ø aus ${x.nb} ${x.nb === 1 ? 'Quittung' : 'Quittungen'})` };
}

/* ---------- Vorbereiteter Beleg (Entwurf ohne Nummer) ---------- */

/**
 * Formular des vorbereiteten Belegs (Prototyp vorbereiten/belegAngleichen): neu = eine Position „Leistung × geschätzter
 * Betrag“, Datum und Leistungsdatum = Termin, bei Rechnung Zahlungsziel ab dem Termin. Ein vorhandener Entwurf folgt dem
 * Termin, behält aber in der Maske ergänzte Positionen und einen eigenen Betreff; ein Artwechsel nimmt die Standardtexte
 * der neuen Art. Kunde und Termin setzt Rust (immer die des Termins).
 */
export function vorbereitungFormular(o: {
  art: ErtragsArt;
  termin: { datum: string; leistung: string; betrag: number | null };
  /** bisheriger Entwurf (formularAusEntwurf) */
  vorhanden: BelegFormular | null;
  /** Leistung vor der Änderung (ein eigener Betreff bleibt stehen) */
  altLeistung: string;
  zielTage: number;
  /** aktive Vorlage der Art (null = Standard) */
  vorlageId: number | null;
  heute: string;
}): BelegFormular {
  const { art, termin } = o;
  const neu = neuesFormular({ art, datum: termin.datum, text: termin.leistung }, { heute: o.heute, zielTage: { rechnung: o.zielTage } });
  const position = { ...neu.positionen[0], beschreibung: termin.leistung, menge: '1', einheit: 'pausch.', preis: termin.betrag ? preisEingabe(termin.betrag) : '' };
  if (!o.vorhanden) return { ...neu, kunde: '', positionen: [position], vorlageId: o.vorlageId };
  const w = o.vorhanden.art === art ? o.vorhanden : { ...artWechseln(o.vorhanden, art, { rechnung: o.zielTage }), vorlageId: o.vorlageId };
  const eigenerBetreff = !!w.betreff.trim() && w.betreff.trim() !== o.altLeistung.trim();
  const einzeln = w.positionen.length <= 1;
  return {
    ...w,
    kunde: '',
    kundeBewusstNeu: null,
    adresse: '',
    datum: termin.datum,
    leistungVon: termin.datum,
    leistungBis: '',
    zielTage: art === 'rechnung' ? String(o.zielTage) : w.zielTage,
    betreff: eigenerBetreff ? w.betreff : termin.leistung,
    positionen: einzeln ? [{ ...position, einheit: w.positionen[0]?.einheit || position.einheit }] : w.positionen,
    mehrere: art === 'quittung' && !einzeln,
    bezahltAm: null,
    buchungId: null,
  };
}

/** Eingabe für termin_speichern (`entwurf`) bzw. null, wenn sich das Formular nicht speichern lässt. */
export function vorbereitungDaten(o: Parameters<typeof vorbereitungFormular>[0]): BelegDaten | null {
  const d = formularZuDaten(vorbereitungFormular(o), []);
  return d.ok ? d.daten : null;
}

/** Hinweis unter „Beleg vorbereiten“ (Prototyp belegHint). `entwurfArt` = Art des schon vorbereiteten Entwurfs. */
export function vorbereitenHinweis(wahl: BelegWahl, entwurfArt: string | null, zielTage: number): string {
  const alt = entwurfArt != null ? ART_LABEL[artVon(entwurfArt, 'quittung')] : null;
  if (wahl === 'keinen') {
    return alt
      ? `Die vorbereitete ${alt} wird beim Speichern verworfen – sie hatte noch keine Nummer, ein Storno ist nicht nötig.`
      : 'Ohne Beleg. Beim Erledigen kannst du die Quittung immer noch ausstellen.';
  }
  const neu = ART_LABEL[wahl];
  const ziel = wahl === 'rechnung' ? ` Zahlungsziel ${zielTage} Tage ab Termin.` : '';
  if (!alt) {
    return `Wird als Entwurf ohne Nummer angelegt und erscheint unter Rechnungen & Quittungen → Offen als „vorbereitet“. Die Nummer kommt erst beim Ausstellen.${ziel}`;
  }
  const was = alt !== neu ? `Die vorbereitete ${alt} wird zur ${neu}.` : `${neu} ist vorbereitet (noch ohne Nummer).`;
  return `${was} Datum, Leistung und Betrag werden beim Speichern übernommen.${ziel}`;
}

/** Cent ⇒ Eingabe im Feld „Geschätzter Betrag“: „65“ bzw. „65,50“, leer ohne Betrag. */
export const betragFeld = (cent: number | null | undefined): string =>
  !cent ? '' : cent % 100 ? `${Math.trunc(cent / 100)},${String(cent % 100).padStart(2, '0')}` : String(Math.trunc(cent / 100));

/** Startwerte der Termin-Schublade: bestehender Termin (beim Wiedereinplanen frühestens heute) bzw. Vorbelegung. */
export function formularStart(
  o:
    | { termin: Termin; wieder: boolean; standard: ErtragsArt; heute: string }
    | {
        termin: null;
        vorgabe: { kunde?: number; datum?: string; von?: string; bis?: string; adresse?: string; leistung?: string; betrag?: number; notiz?: string; beleg?: BelegWahl };
        kunden: readonly TerminKunde[];
        standard: ErtragsArt;
        heute: string;
      },
): TerminFormular {
  if ('wieder' in o) {
    const t = o.termin;
    const von = minuten(t.von) != null ? (t.von ?? '09:00') : '09:00';
    return {
      kunde: t.kunde_id != null && t.kunde_name ? (t.kunde_nummer ? `${t.kunde_name} · ${t.kunde_nummer}` : t.kunde_name) : (t.kunde_name ?? ''),
      kundeBewusstNeu: null,
      datum: o.wieder && t.datum < o.heute ? o.heute : t.datum,
      von,
      bis: t.bis ?? plus2h(von),
      adresse: t.adresse ?? '',
      leistung: t.leistung,
      betrag: betragFeld(t.betrag_geschaetzt_cent),
      notiz: t.notiz ?? '',
      beleg: t.entwurf ? artVon(t.entwurf.art, o.standard) : o.wieder ? o.standard : 'keinen',
    };
  }
  const v = o.vorgabe;
  const k = v.kunde != null ? o.kunden.find((x) => x.id === v.kunde) : undefined;
  const von = minuten(v.von) != null ? (v.von ?? '09:00') : '09:00';
  const bisOk = minuten(v.bis) != null && (minuten(v.bis) ?? 0) > (minuten(von) ?? 0);
  return {
    kunde: k ? `${k.name} · ${k.nummer}` : '',
    kundeBewusstNeu: null,
    datum: istDatum(v.datum) ? v.datum : o.heute,
    von,
    bis: bisOk && v.bis ? v.bis : plus2h(von),
    adresse: v.adresse ?? adresseVon(k),
    leistung: v.leistung ?? '',
    betrag: betragFeld(v.betrag),
    notiz: v.notiz ?? '',
    beleg: v.beleg ?? o.standard,
  };
}

/* ================= Erfassen-Schublade ================= */

/** Termin bzw. vorbereiteter Beleg der Erfassen-Schublade (geladen in ErfassenSchublade). */
export interface ErfassenBezug {
  termin: Termin | null;
  entwurf: { id: number; kundeId: number | null; formular: BelegFormular } | null;
}

/** Vorbelegung aus Termin und Entwurf ergänzen, wo der Aufrufer nichts vorgibt (Prototyp makeState; die Beleg-Maske
 *  übergibt z. B. nur `entwurf`). */
export function vorbelegungMitBezug(v: Vorbelegung, b: ErfassenBezug | null): Vorbelegung {
  if (!b || (!b.termin && !b.entwurf)) return v;
  const e = b.entwurf;
  const t = b.termin;
  const summe = e ? formularSumme(e.formular) : 0;
  const art = e && (e.formular.art === 'quittung' || e.formular.art === 'rechnung') ? e.formular.art : undefined;
  const kunde = v.kunde ?? e?.kundeId ?? t?.kunde_id ?? undefined;
  const betrag = v.betrag ?? (summe > 0 ? summe : (t?.betrag_geschaetzt_cent ?? undefined));
  const text = v.text ?? (e?.formular.betreff.trim() || t?.leistung || undefined);
  const beleg = v.beleg ?? art;
  return {
    ...v,
    typ: 'einnahme',
    ...(beleg ? { beleg } : {}),
    ...(kunde != null ? { kunde } : {}),
    ...(betrag ? { betrag } : {}),
    ...(text ? { text } : {}),
    ...(t ? { termin: t.id } : {}),
    ...(e ? { entwurf: e.id } : {}),
  };
}

/** Beleg-Angaben aus dem Entwurf: Text der einzigen Position (wenn er vom Betreff abweicht), Anschrift, Vorlage. */
export function ertragAusEntwurf(e: ErfassenBezug['entwurf']): { leistung: string; adresse: string; vorlage: { id: number | null } | null } {
  if (!e) return { leistung: '', adresse: '', vorlage: null };
  const f = e.formular;
  const pos = f.positionen.length === 1 ? f.positionen[0].beschreibung.trim() : '';
  return { leistung: pos && pos !== f.betreff.trim() ? pos : '', adresse: f.adresse, vorlage: { id: f.vorlageId } };
}

/** Bezug für belegVorbereiten (lib/ertrag.ts): Termin (Leistungsdatum) und Formular des Entwurfs. */
export const ertragBezug = (b: ErfassenBezug | null): ErtragBezug | null =>
  b && (b.termin || b.entwurf) ? { termin: b.termin ? { id: b.termin.id, datum: b.termin.datum } : null, entwurf: b.entwurf?.formular ?? null } : null;

/** „Quittung ausstellen“ bzw. „Rechnung schreiben“ ⇒ die eine Erfassen-Schublade, vorbefüllt aus Termin und Entwurf. */
export function vorbelegungZumAusstellen(t: Termin, standard: ErtragsArt, heute: string): Vorbelegung {
  const betrag = t.entwurf?.summe_cent || t.betrag_geschaetzt_cent || 0;
  return {
    typ: 'einnahme',
    beleg: ausstellArt(t, standard),
    termin: t.id,
    ...(t.entwurf ? { entwurf: t.entwurf.id } : {}),
    ...(t.kunde_id != null ? { kunde: t.kunde_id } : {}),
    ...(betrag > 0 ? { betrag } : {}),
    text: t.leistung,
    datum: heute,
  };
}

export interface HinweisTeil {
  text: string;
  fett?: boolean;
}

/**
 * Hinweiszeile oben in der Erfassen-Schublade bei Termin bzw. vorbereitetem Beleg (Prototyp terminHint), z. B.
 * „Vorbereitete Quittung zum Termin am Mo, 12.10.2026 · 08:00 – wird jetzt mit Nummer ausgestellt“.
 */
export function erfassenHinweis(o: {
  termin: Pick<TerminZeile, 'datum' | 'von'> | null;
  /** Art des vorbereiteten Entwurfs (null = keiner) */
  entwurfArt: string | null;
  weg: Ertragsweg;
  /** gewählte Art beim Ausstellen */
  art: ErtragsArt;
}): HinweisTeil[] {
  const { termin: t, weg } = o;
  const wann: HinweisTeil[] = t ? [{ text: ' zum Termin am ' }, { text: terminWann(t), fett: true }] : [];
  const abschluss = !t ? '' : weg === 'offen' ? 'mit der zugeordneten Rechnung abgeschlossen' : weg === 'ohne' ? 'ohne Beleg abgeschlossen' : '';
  if (o.entwurfArt != null) {
    if (weg === 'beleg') return [{ text: `Vorbereitete ${ART_LABEL[o.art]}` }, ...wann, { text: ' – wird jetzt mit Nummer ausgestellt' }];
    if (abschluss) return [{ text: `Vorbereitete ${ART_LABEL[artVon(o.entwurfArt, 'quittung')]}` }, ...wann, { text: ` wird verworfen – der Termin wird ${abschluss}` }];
    return [{ text: 'Vorbereiteter Beleg' }, ...wann, { text: ' bleibt Entwurf' }];
  }
  if (!t) return [];
  const am: HinweisTeil[] = [{ text: 'Termin am ' }, { text: terminWann(t), fett: true }];
  return [...am, { text: abschluss ? ` – wird beim Speichern ${abschluss}` : ' – wird beim Speichern als erledigt abgehakt' }];
}
