/* Baustein „Anschrift & Belegdaten“: die Angaben rechts neben dem Empfänger (ANLEITUNG §7.0).
 * Je Vorlage einstellbar: Sichtbarkeit (Schalter `nr`, `datum` …), eigene Beschriftung (`nr_label` … – leer = Standard
 * der Art, z. B. „Rechnungs-Nr.“), Reihenfolge (`reihenfolge`, Schlüssel mit Komma) und Datumsformat (`datumsformat`).
 * Fehlende Einstellungen (ältere Vorlagen, eingefrorene Belege) = bisheriges Aussehen.
 * Vorschau (Blatt.tsx über `metaZeilen`) und PDF (latex/vorlage.ts über `metaAngaben`) nehmen dieselbe Reihenfolge,
 * dieselben Beschriftungen und dieselben Bedingungen. Der Pflichtangaben-Check (pflicht.ts) prüft weiter die Schalter.
 * Tests: meta.test.ts */
import type { Aufgeloest } from './bausteine';
import { klartext } from './formatierung';
import {
  ARTEN,
  datumFormat,
  empfaenger,
  leistungLabel,
  leistungText,
  type BelegDokument,
  type Belegart,
  type Datumsformat,
} from './dokument';

export const META_ANGABEN = ['nr', 'datum', 'leistung', 'kundennr', 'steuernr', 'faellig'] as const;
export type MetaAngabe = (typeof META_ANGABEN)[number];
export const istMetaAngabe = (v: unknown): v is MetaAngabe => typeof v === 'string' && (META_ANGABEN as readonly string[]).includes(v);

/** Standard-Reihenfolge (wie bisher gedruckt) */
export const META_REIHENFOLGE = META_ANGABEN.join(',');

/** Name der Angabe in der Einstellungskarte */
export const META_NAME: Readonly<Record<MetaAngabe, string>> = {
  nr: 'Belegnummer',
  datum: 'Datum',
  leistung: 'Leistungsdatum',
  kundennr: 'Kunden-Nr.',
  steuernr: 'Steuernummer',
  faellig: 'Fälligkeit / gültig bis',
};

/** Schlüssel der eigenen Beschriftung einer Angabe */
export const labelKey = (k: MetaAngabe): string => `${k}_label`;

/** Reihenfolge lesen: bekannte Schlüssel in der gespeicherten Folge (doppelte einmal), fehlende in Standardfolge dahinter. */
export function metaReihenfolge(wert: string): MetaAngabe[] {
  const out: MetaAngabe[] = [];
  for (const t of String(wert ?? '').split(',')) {
    const k = t.trim();
    if (istMetaAngabe(k) && !out.includes(k)) out.push(k);
  }
  for (const k of META_ANGABEN) if (!out.includes(k)) out.push(k);
  return out;
}

/** Angabe in der Reihenfolge um eins nach oben (-1) oder unten (1) schieben; am Rand unverändert. */
export function metaVerschieben(wert: string, key: MetaAngabe, richtung: -1 | 1): string {
  const r = metaReihenfolge(wert);
  const i = r.indexOf(key);
  const j = i + richtung;
  if (i < 0 || j < 0 || j >= r.length) return r.join(',');
  [r[i], r[j]] = [r[j], r[i]];
  return r.join(',');
}

/** Standard-Beschriftung je Art (wie bisher). Leistung: ohne Beleg „Leistungsdatum“; mit Zeitraum sagt `metaZeilen` bzw.
 *  \LeistungsdatumLabel im PDF „Leistungszeitraum“. */
export function metaStandardLabel(key: MetaAngabe, art: Belegart): string {
  switch (key) {
    case 'nr':
      return ARTEN[art].nrLabel;
    case 'datum':
      return 'Datum';
    case 'leistung':
      return 'Leistungsdatum';
    case 'kundennr':
      return 'Kunden-Nr.';
    case 'steuernr':
      return 'Steuernummer';
    case 'faellig':
      return art === 'angebot' ? 'Gültig bis' : 'Fällig am';
  }
}

/** Eigene Beschriftung (Vorlagentext mit Formatierung) oder '' = Standard. Nur Leerzeichen zählt als leer. */
export const eigeneBeschriftung = (b: Pick<Aufgeloest, 'text'>, key: MetaAngabe): string => {
  const t = b.text(labelKey(key));
  return klartext(t).trim() ? t : '';
};

export const metaDatumsformat = (b: Pick<Aufgeloest, 'text'>): Datumsformat => (b.text('datumsformat') === 'lang' ? 'lang' : 'kurz');

/** Eingeschaltete Angaben in Druckreihenfolge mit eigener Beschriftung ('' = Standard). Leistungsdatum nie beim Angebot. */
export function metaAngaben(b: Pick<Aufgeloest, 'an' | 'text'>, art: Belegart): { key: MetaAngabe; eigen: string }[] {
  return metaReihenfolge(b.text('reihenfolge'))
    .filter((k) => b.an(k) && !(k === 'leistung' && art === 'angebot'))
    .map((key) => ({ key, eigen: eigeneBeschriftung(b, key) }));
}

/** Wert einer Zeile in der Vorschau */
export type MetaWert =
  | { art: 'text'; text: string }
  /** Belegnummer (fett) */
  | { art: 'nummer'; text: string }
  /** keine Nummer: graues „Entwurf“ */
  | { art: 'entwurf' }
  /** Blanko-Formular: kurze Schreiblinie */
  | { art: 'luecke' };

export interface MetaZeile {
  key: MetaAngabe;
  /** Beschriftung als Vorlagentext (Platzhalter und Formatierung möglich) */
  label: string;
  /** true = eigene Beschriftung aus der Vorlage */
  eigen: boolean;
  wert: MetaWert;
}

/** Zeilen der Belegdaten für die Vorschau: Reihenfolge, Beschriftung, Datumsformat; leere Werte fallen weg (wie
 *  \ifdefempty im PDF). Blanko: Werte des Belegs als Schreiblinie, Steuernummer aus den Firmendaten. */
export function metaZeilen(b: Pick<Aufgeloest, 'an' | 'text'>, doc: BelegDokument): MetaZeile[] {
  const fmt = metaDatumsformat(b);
  const e = empfaenger(doc);
  const steuernr = doc.firma.steuernummer.trim();
  const out: MetaZeile[] = [];
  for (const { key, eigen } of metaAngaben(b, doc.art)) {
    let wert: MetaWert | null;
    let standard = metaStandardLabel(key, doc.art);
    if (key === 'steuernr') wert = steuernr ? { art: 'text', text: doc.firma.steuernummer } : null;
    else if (doc.blanko) wert = { art: 'luecke' };
    else if (key === 'nr') wert = doc.nummer ? { art: 'nummer', text: doc.nummer } : { art: 'entwurf' };
    else if (key === 'datum') wert = { art: 'text', text: datumFormat(doc.datum, fmt) };
    else if (key === 'leistung') {
      standard = leistungLabel(doc);
      wert = doc.leistung_von ? { art: 'text', text: leistungText(doc, fmt) } : null;
    } else if (key === 'kundennr') wert = e.nummer ? { art: 'text', text: e.nummer } : null;
    else wert = doc.faellig_am ? { art: 'text', text: datumFormat(doc.faellig_am, fmt) } : null;
    if (wert) out.push({ key, label: eigen || standard, eigen: !!eigen, wert });
  }
  return out;
}

const META_KURZ: Readonly<Record<MetaAngabe, string>> = { ...META_NAME, nr: 'Nr.', faellig: 'Fälligkeit' };

/** Kurzinfo in der Bausteinliste: gedruckte Angaben in Reihenfolge, eigene Beschriftungen statt der Namen. */
export function metaZusammenfassung(b: Pick<Aufgeloest, 'an' | 'text'>): string {
  const teile = metaReihenfolge(b.text('reihenfolge'))
    .filter((k) => b.an(k))
    .map((k) => klartext(eigeneBeschriftung(b, k)).trim() || META_KURZ[k]);
  const fmt = metaDatumsformat(b) === 'lang' ? ' · Datum ausgeschrieben' : '';
  return teile.length ? `Empfänger · ${teile.join(' · ')}${fmt}` : 'Nur Empfänger';
}
