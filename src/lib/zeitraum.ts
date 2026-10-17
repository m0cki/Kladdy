/* Zeitraum (Monat · Quartal · Jahr) für Ein- & Ausgänge (§6.3), später auch für die Auswertung.
 * Alle Daten als 'YYYY-MM-DD' (lokaler Kalendertag, nie UTC). Reine Funktionen, mit Vitest getestet (zeitraum.test.ts). */

export type ZeitraumModus = 'monat' | 'quartal' | 'jahr';

export interface Zeitraum {
  modus: ZeitraumModus;
  /** erster Tag, z. B. '2026-10-01' */
  von: string;
  /** letzter Tag, z. B. '2026-10-31' */
  bis: string;
  /** „Oktober 2026“ · „4. Quartal 2026“ · „2026“ */
  label: string;
}

export const ZEITRAUM_MODI: readonly { value: ZeitraumModus; label: string }[] = [
  { value: 'monat', label: 'Monat' },
  { value: 'quartal', label: 'Quartal' },
  { value: 'jahr', label: 'Jahr' },
];

const pad = (n: number, l = 2) => String(n).padStart(l, '0');

/** Heutiges Datum nach lokaler Uhr als 'YYYY-MM-DD'. */
export function heute(d: Date = new Date()): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const istDatum = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, t] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && t >= 1 && t <= tageImMonat(y, m);
};

const tageImMonat = (jahr: number, monat: number): number => new Date(jahr, monat, 0).getDate();

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Zeitraum, in dem `anker` liegt. */
export function zeitraum(modus: ZeitraumModus, anker: string): Zeitraum {
  const y = Number(anker.slice(0, 4));
  const m = Number(anker.slice(5, 7));
  if (modus === 'monat') {
    return { modus, von: `${pad(y, 4)}-${pad(m)}-01`, bis: `${pad(y, 4)}-${pad(m)}-${pad(tageImMonat(y, m))}`, label: `${MONATE[m - 1]} ${y}` };
  }
  if (modus === 'quartal') {
    const q = Math.ceil(m / 3);
    const m0 = (q - 1) * 3 + 1;
    return { modus, von: `${pad(y, 4)}-${pad(m0)}-01`, bis: `${pad(y, 4)}-${pad(m0 + 2)}-${pad(tageImMonat(y, m0 + 2))}`, label: `${q}. Quartal ${y}` };
  }
  return { modus: 'jahr', von: `${pad(y, 4)}-01-01`, bis: `${pad(y, 4)}-12-31`, label: String(y) };
}

/** Anker des vorherigen (richtung −1) bzw. nächsten (+1) Zeitraums: dessen erster Tag. */
export function verschiebe(modus: ZeitraumModus, anker: string, richtung: -1 | 1): string {
  const y = Number(anker.slice(0, 4));
  const m = Number(anker.slice(5, 7));
  const schritt = modus === 'monat' ? 1 : modus === 'quartal' ? 3 : 12;
  const start = Number(zeitraum(modus, anker).von.slice(5, 7)); // Monat, mit dem der Zeitraum beginnt
  const index = y * 12 + (modus === 'monat' ? m : start) - 1 + richtung * schritt;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}-01`;
}

/** Liegt `datum` im Zeitraum? */
export const imZeitraum = (z: Pick<Zeitraum, 'von' | 'bis'>, datum: string): boolean => datum >= z.von && datum <= z.bis;

/** Gibt es einen nächsten Zeitraum, der nicht ganz in der Zukunft liegt? */
export const hatNaechsten = (modus: ZeitraumModus, anker: string, heuteIso: string): boolean =>
  zeitraum(modus, verschiebe(modus, anker, 1)).von <= heuteIso;

/** Nach dem Verschieben: Liegt heute im neuen Zeitraum, wird heute wieder der Anker (Wechsel Monat ⇄ Quartal passt dann). */
export function naechsterAnker(modus: ZeitraumModus, anker: string, richtung: -1 | 1, heuteIso: string): string {
  const neu = verschiebe(modus, anker, richtung);
  return imZeitraum(zeitraum(modus, neu), heuteIso) ? heuteIso : neu;
}

/** Kalendertage addieren (negativ = zurück), rechnet in UTC, damit Sommerzeit nichts verschiebt. */
export function plusTage(iso: string, tage: number): string {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + tage));
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/* ---------- Zeitraum in der Adresse (Deep-Link, Zurück-Taste): ?modus=monat&anker=2026-10-01 ---------- */

const istModus = (v: unknown): v is ZeitraumModus => v === 'monat' || v === 'quartal' || v === 'jahr';

/** Zeitraum aus den Adress-Parametern; null, wenn keiner (oder ein ungültiger) drinsteht. */
export function zeitraumAusParams(p: Pick<URLSearchParams, 'get'>): { modus: ZeitraumModus; anker: string } | null {
  const modus = p.get('modus');
  const anker = p.get('anker');
  return istModus(modus) && istDatum(anker) ? { modus, anker } : null;
}

/** Parameter für einen Zeitraum (Anker bleibt, wie er ist: liegt heute im Zeitraum, ist es heute – wie ZeitraumWahl). */
export const zeitraumParams = (modus: ZeitraumModus, anker: string): Record<string, string> => ({ modus, anker });
