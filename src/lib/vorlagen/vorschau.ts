/* Vorschau der Vorlagen-Seite mit einem echten Beleg (ANLEITUNG §7.0 „Vorschau mit Beispieldaten oder einem echten
 * Beleg“; Prototyp vorlagen.js docs()/vorschauDoc()).
 * - letzterBeleg: je Art der neueste ausgestellte Beleg (Belegdatum, dann ID), ohne einen ausgestellten der neueste
 *   Entwurf. Stornobelege (Art 'storno') zählen nicht – sie haben keine eigene Vorlage.
 * - vorschauDokument: Beleg wie in der Beleg-Maske laden (ausgestellt: Schnappschuss über ausgestellterBeleg, Entwurf:
 *   formularAusEntwurf ⇒ formularZuDokument), gezeigt aber mit den aktuellen Bausteinen der Seite. GoBD: Es wird nur
 *   gelesen, nichts zurückgeschrieben, kein PDF abgelegt. Damit der Nachbau nicht mit dem echten Beleg verwechselt wird,
 *   fällt die Nummer weg: Blatt und PDF tragen das Wasserzeichen ENTWURF, {nr} druckt „Entwurf“ (wie der Testbeleg).
 *   Logo und Akzentfarbe sind die aktuellen – gezeigt wird, wie die Vorlage heute aussieht.
 * - Auswahl „Beispiel · Letzter Beleg“ je Art im localStorage (wie Darstellung und Updates), Standard: Beispiel.
 * Tests: vorschau.test.ts */
import { ausgestellterBeleg } from '../belegpdf';
import type { Firma } from '../firma';
import type { UstModus } from '../queries/einstellungen';
import { ladeBeleg, ladeKundenAnschrift, type BelegVoll } from '../queries/rechnungen';
import { formularAusEntwurf, formularZuDokument, type BelegZeile, type KundeAnschrift, type PositionZeile } from '../rechnungen';
import type { KeyValueStore } from '../settings';
import { BELEGARTEN, type BelegDokument, type Belegart } from './dokument';

export type Vorschauquelle = 'beispiel' | 'beleg';
export type Quellen = Record<Belegart, Vorschauquelle>;

export const VORSCHAU_KEY = 'kladdy.vorlagen.v1';

/** Neuester Beleg der Art: ausgestellt vor Entwurf, dann Belegdatum (ohne Datum zuletzt), dann ID. null = keiner. */
export function letzterBeleg<Z extends Pick<BelegZeile, 'id' | 'art' | 'nummer' | 'datum'>>(zeilen: readonly Z[], art: Belegart): Z | null {
  let best: Z | null = null;
  const rang = (z: Z) => [z.nummer ? 1 : 0, z.datum ?? '', z.id] as const;
  for (const z of zeilen) {
    if (z.art !== art) continue;
    if (!best) {
      best = z;
      continue;
    }
    const [a1, a2, a3] = rang(z);
    const [b1, b2, b3] = rang(best);
    if (a1 !== b1 ? a1 > b1 : a2 !== b2 ? a2 > b2 : a3 > b3) best = z;
  }
  return best;
}

export interface VorschauKontext {
  firma: Firma;
  ustModus: UstModus;
  /** aktuelles Firmenlogo (Dateiname, '' = keins) */
  logo: string;
  /** Kunden mit Anschrift – nur für Entwürfe nötig (Kunde per ID wie in der Maske) */
  kunden: readonly KundeAnschrift[];
  heute: string;
}

/** Geladener Beleg ⇒ Dokument für Vorschau und PDF der Vorlagen-Seite: immer ein Entwurf ohne Nummer. */
export function vorschauDokument(b: BelegVoll, positionen: readonly PositionZeile[], ctx: VorschauKontext): BelegDokument {
  const doc = b.nummer
    ? ausgestellterBeleg(b, positionen, ctx.firma, ctx.ustModus).dokument
    : formularZuDokument(formularAusEntwurf(b, positionen, ctx.heute), { kunden: ctx.kunden, firma: ctx.firma, ustModus: ctx.ustModus });
  // neue Objekte statt Änderung: der Schnappschuss des Belegs bleibt, wie er ist
  return { ...doc, nummer: null, storniert: false, storno_von: null, logo: ctx.logo || null };
}

/** Beleg lesen (wie die Beleg-Maske) und als Vorschau-Dokument liefern; null = nicht (mehr) da. Schreibt nichts. */
export async function ladeVorschauBeleg(id: number, ctx: Omit<VorschauKontext, 'kunden'>): Promise<BelegDokument | null> {
  const g = await ladeBeleg(id);
  if (!g || g.beleg.art === 'storno') return null;
  const kunden = g.beleg.nummer ? [] : await ladeKundenAnschrift();
  return vorschauDokument(g.beleg, g.positionen, { ...ctx, kunden });
}

/* ---------- Auswahl je Art merken ---------- */

const standardQuellen = (): Quellen => ({ rechnung: 'beispiel', quittung: 'beispiel', angebot: 'beispiel', eigenbeleg: 'beispiel' });

export function ladeQuellen(store: KeyValueStore | undefined): Quellen {
  const q = standardQuellen();
  try {
    const raw = store?.getItem(VORSCHAU_KEY);
    const r: unknown = raw ? JSON.parse(raw) : null;
    const quelle = r && typeof r === 'object' && !Array.isArray(r) ? (r as { quelle?: unknown }).quelle : null;
    if (quelle && typeof quelle === 'object') {
      for (const a of BELEGARTEN) if ((quelle as Record<string, unknown>)[a] === 'beleg') q[a] = 'beleg';
    }
  } catch {
    /* kaputt ⇒ Beispiel */
  }
  return q;
}

export function speichereQuelle(store: KeyValueStore | undefined, art: Belegart, quelle: Vorschauquelle): Quellen {
  const q = { ...ladeQuellen(store), [art]: quelle };
  try {
    store?.setItem(VORSCHAU_KEY, JSON.stringify({ quelle: q }));
  } catch {
    /* Speicher gesperrt – dann gilt die Auswahl nur bis zum Neustart */
  }
  return q;
}
