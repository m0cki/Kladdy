/* Nummernkreise (ANLEITUNG §5 Tabelle nummernkreise, §6 „Laufende Nummern“, §6.10 „Nummernkreise (Muster mit Vorschau)“).
 * Reine Logik: Muster prüfen, Nummer formatieren, nächsten Stand berechnen. Vergeben wird später atomar in Rust
 * (eine Transaktion, Nummer erst beim Ausstellen, nie wiederverwenden). Tests: numbering.test.ts
 *
 * Platzhalter im Muster:  {JJJJ} Jahr vierstellig · {JJ} Jahr zweistellig · {N…} laufende Nummer, mit Nullen auf so viele
 * Stellen aufgefüllt, wie N dastehen (1–8). Größere Nummern werden nicht abgeschnitten (RE-2026-1000).
 * Kreise mit Jahr im Muster beginnen jedes Jahr wieder bei 1; Kreise ohne Jahr (Kunde) laufen immer weiter. */

export type NummernkreisId = 'buchung' | 'rechnung' | 'quittung' | 'angebot' | 'eigenbeleg' | 'kunde';

/** Zeile aus der Tabelle nummernkreise. jahr = 0: noch nie benutzt bzw. jahresunabhängig. */
export interface Nummernkreis {
  id: NummernkreisId;
  muster: string;
  jahr: number;
  naechste: number;
}

/** Standardmuster wie in 0002_standarddaten.sql und im Prototyp (QU-2026-105, RE-2026-014, 2026-0001, K-0012). */
export const STANDARD_MUSTER: Readonly<Record<NummernkreisId, string>> = {
  buchung: '{JJJJ}-{NNNN}',
  rechnung: 'RE-{JJJJ}-{NNN}',
  quittung: 'QU-{JJJJ}-{NNN}',
  angebot: 'AN-{JJJJ}-{NNN}',
  eigenbeleg: 'EB-{JJJJ}-{NNN}',
  kunde: 'K-{NNNN}',
};

export const KREIS_NAMEN: Readonly<Record<NummernkreisId, string>> = {
  buchung: 'Buchung',
  rechnung: 'Rechnung',
  quittung: 'Quittung',
  angebot: 'Angebot',
  eigenbeleg: 'Eigenbeleg',
  kunde: 'Kunde',
};

/** Bezeichnung der Nummer selbst (Einstellungen, Suche). */
export const NUMMER_NAMEN: Readonly<Record<NummernkreisId, string>> = {
  buchung: 'Buchungsnummer',
  rechnung: 'Rechnungsnummer',
  quittung: 'Quittungsnummer',
  angebot: 'Angebotsnummer',
  eigenbeleg: 'Eigenbelegnummer',
  kunde: 'Kundennummer',
};

/** Anzeige-Reihenfolge: Buchungen, dann Belege (Quittung zuerst, sie ist der Standard), zuletzt Kunden. */
export const KREIS_REIHENFOLGE: readonly NummernkreisId[] = ['buchung', 'quittung', 'rechnung', 'angebot', 'eigenbeleg', 'kunde'];

const PLATZHALTER = /\{([^{}]*)\}/g;
/** Zeichen außerhalb der Platzhalter: Buchstaben (auch Umlaute), Ziffern und - _ / . (keine Leerzeichen, nichts für LaTeX/Dateinamen Heikles). */
const ERLAUBT = /^[\p{L}\d\-_/.]*$/u;
const MAX_LAENGE = 40;

/** Prüft ein Muster. Gibt eine Fehlermeldung (deutsch, für die Einstellungen) oder null zurück. */
export function musterFehler(muster: string): string | null {
  if (!muster.trim()) return 'Das Muster darf nicht leer sein.';
  if (muster.length > MAX_LAENGE) return `Das Muster darf höchstens ${MAX_LAENGE} Zeichen lang sein.`;
  let nummern = 0;
  for (const [, name] of muster.matchAll(PLATZHALTER)) {
    if (/^N{1,8}$/.test(name)) nummern++;
    else if (name !== 'JJJJ' && name !== 'JJ') return `Unbekannter Platzhalter {${name}}. Erlaubt: {JJJJ}, {JJ}, {NNN} …`;
  }
  if (nummern === 0) return 'Das Muster braucht eine laufende Nummer, z. B. {NNN}.';
  if (nummern > 1) return 'Das Muster darf nur eine laufende Nummer enthalten.';
  const rest = muster.replace(PLATZHALTER, '');
  if (/[{}]/.test(rest)) return 'Geschweifte Klammern nur für Platzhalter verwenden.';
  if (!ERLAUBT.test(rest)) return 'Erlaubt sind Buchstaben, Ziffern und - _ / . (keine Leerzeichen).';
  return null;
}

/** Enthält das Muster ein Jahr? Dann beginnt der Kreis jedes Jahr neu. */
export function istJahresabhaengig(muster: string): boolean {
  return /\{JJ(JJ)?\}/.test(muster);
}

/** Nummer nach Muster, z. B. formatNummer('RE-{JJJJ}-{NNN}', 2026, 14) = 'RE-2026-014'. */
export function formatNummer(muster: string, jahr: number, laufend: number): string {
  const fehler = musterFehler(muster);
  if (fehler) throw new Error(`Ungültiges Muster „${muster}“: ${fehler}`);
  if (!Number.isSafeInteger(laufend) || laufend < 1) throw new RangeError(`Laufende Nummer ${laufend} ist ungültig`);
  if (istJahresabhaengig(muster) && !(Number.isInteger(jahr) && jahr >= 1000 && jahr <= 9999)) {
    throw new RangeError(`Jahr ${jahr} ist ungültig`);
  }
  return muster.replace(PLATZHALTER, (_, name: string) => {
    if (name === 'JJJJ') return String(jahr);
    if (name === 'JJ') return String(jahr % 100).padStart(2, '0');
    return String(laufend).padStart(name.length, '0');
  });
}

/** Vorschau für die Einstellungen: die erste Nummer im Jahr, z. B. 'QU-2026-001'. null bei ungültigem Muster. */
export function vorschau(muster: string, jahr: number): string | null {
  return musterFehler(muster) ? null : formatNummer(muster, jahr, 1);
}

export interface Vergabe {
  /** die vergebene Nummer, z. B. 'QU-2026-105' */
  nummer: string;
  /** laufender Teil der vergebenen Nummer */
  laufend: number;
  /** neuer Stand des Kreises (jahr, naechste), der in derselben Transaktion gespeichert wird */
  stand: Pick<Nummernkreis, 'jahr' | 'naechste'>;
}

/**
 * Nächste Nummer eines Kreises im Jahr `jahrJetzt` (Jahr des Belegs bzw. Zahlungsdatums), ohne etwas zu speichern.
 * - Jahresabhängig und neues Jahr ⇒ beginnt bei 1, jahr wird gesetzt.
 * - Jahresabhängig und älteres Jahr als der Kreis ⇒ Fehler: Der Kreis hat nur einen Stand (eine Zeile je Kreis),
 *   ein abgeschlossenes Jahr lässt sich nicht weiterzählen, ohne Nummern doppelt zu vergeben.
 * - Ohne Jahr im Muster ⇒ jahr bleibt 0, es wird einfach weitergezählt.
 * Für die Anzeige „erhält Nr. QU-2026-105“ genügt `naechsteNummer(kreis, jahr).nummer`.
 */
export function naechsteNummer(kreis: Pick<Nummernkreis, 'muster' | 'jahr' | 'naechste'>, jahrJetzt: number): Vergabe {
  if (!Number.isSafeInteger(kreis.naechste) || kreis.naechste < 1) {
    throw new RangeError(`Nummernkreis-Stand ${kreis.naechste} ist ungültig`);
  }
  if (!istJahresabhaengig(kreis.muster)) {
    const laufend = kreis.naechste;
    return { nummer: formatNummer(kreis.muster, jahrJetzt, laufend), laufend, stand: { jahr: 0, naechste: laufend + 1 } };
  }
  if (jahrJetzt < kreis.jahr) {
    throw new RangeError(`Der Nummernkreis steht schon auf ${kreis.jahr}; für ${jahrJetzt} kann keine Nummer mehr vergeben werden`);
  }
  const laufend = jahrJetzt > kreis.jahr ? 1 : kreis.naechste;
  return {
    nummer: formatNummer(kreis.muster, jahrJetzt, laufend),
    laufend,
    stand: { jahr: jahrJetzt, naechste: laufend + 1 },
  };
}

/* ---------- Einstellungen › Nummernkreise: Muster wechseln, Zähler erhöhen (GoBD: nie eine Nummer doppelt) ---------- */

const regexText = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** Regex für genau die Nummern dieses Musters im Jahr `jahr`; Gruppe 1 = laufende Nummer (auch länger als die Nullen). */
export function musterRegex(muster: string, jahr: number): RegExp {
  let quelle = '';
  let pos = 0;
  for (const m of muster.matchAll(PLATZHALTER)) {
    quelle += regexText(muster.slice(pos, m.index));
    const name = m[1];
    if (name === 'JJJJ') quelle += String(jahr);
    else if (name === 'JJ') quelle += String(jahr % 100).padStart(2, '0');
    else quelle += `(\\d{${name.length},})`;
    pos = m.index + m[0].length;
  }
  quelle += regexText(muster.slice(pos));
  return new RegExp(`^${quelle}$`);
}

/** Höchste laufende Nummer unter `nummern`, die zum Muster im Jahr `jahr` passt (0 = keine). */
export function hoechsteLaufende(muster: string, jahr: number, nummern: readonly string[]): number {
  const re = musterRegex(muster, jahr);
  let max = 0;
  for (const n of nummern) {
    const m = re.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** Könnten zwei Muster dieselbe Nummer erzeugen? Vorsichtig: gleiche Form ohne Rücksicht auf Stellenzahl und Jahresformat. */
export function musterKollidieren(a: string, b: string): boolean {
  const form = (m: string) => m.replace(/\{JJ(JJ)?\}/g, '{J}').replace(/\{N+\}/g, '{N}');
  return form(a) === form(b);
}

/**
 * Prüft ein neues Muster für einen Kreis, bevor es gespeichert wird. null = in Ordnung.
 * - `vergebene`: alle Nummern, die es in der Zieltabelle schon gibt (buchungen, rechnungen bzw. kunden)
 * - `andere`: die übrigen Kreise, die in dieselbe Tabelle schreiben (rechnungen.nummer ist über alle Belegarten eindeutig)
 */
export function musterWechselFehler(
  kreis: Pick<Nummernkreis, 'muster' | 'jahr' | 'naechste'>,
  neu: string,
  jahrJetzt: number,
  vergebene: readonly string[],
  andere: readonly { name: string; muster: string }[] = [],
): string | null {
  const fehler = musterFehler(neu);
  if (fehler) return fehler;
  const gleich = andere.find((k) => musterKollidieren(k.muster, neu));
  if (gleich) return `Zu ähnlich wie das Muster für ${gleich.name} (${gleich.muster}) – Nummern könnten doppelt vorkommen.`;
  let v: Vergabe;
  try {
    v = naechsteNummer({ ...kreis, muster: neu }, jahrJetzt);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  const hoechste = hoechsteLaufende(neu, jahrJetzt, vergebene);
  if (hoechste >= v.laufend) {
    return `Mit diesem Muster wäre ${v.nummer} schon vergeben (bis ${formatNummer(neu, jahrJetzt, hoechste)}). Nummern werden nie wiederverwendet.`;
  }
  return null;
}

/** Größte erlaubte laufende Nummer beim Erhöhen (Schutz vor Tippfehlern wie 1000000). */
export const ZAEHLER_MAX = 99_999_999;

/**
 * Nächste laufende Nummer erhöhen, z. B. beim Umstieg aus einem anderen Programm (RE-2026-015 statt -001).
 * Nur nach oben: Übersprungene Nummern werden nie vergeben, kleinere sind ausgeschlossen (GoBD, nie wiederverwenden).
 * Liefert den neuen Stand (jahr, naechste) für ein UPDATE oder eine Fehlermeldung.
 */
export function zaehlerErhoehen(
  kreis: Pick<Nummernkreis, 'muster' | 'jahr' | 'naechste'>,
  neu: number,
  jahrJetzt: number,
  vergebene: readonly string[] = [],
): { stand: Pick<Nummernkreis, 'jahr' | 'naechste'> } | { fehler: string } {
  let v: Vergabe;
  try {
    v = naechsteNummer(kreis, jahrJetzt);
  } catch (e) {
    return { fehler: e instanceof Error ? e.message : String(e) };
  }
  if (!Number.isSafeInteger(neu) || neu < 1 || neu > ZAEHLER_MAX) return { fehler: `Bitte eine ganze Zahl von 1 bis ${ZAEHLER_MAX.toLocaleString('de-DE')} eintragen.` };
  if (neu === v.laufend) return { fehler: `${v.nummer} ist schon die nächste Nummer.` };
  if (neu < v.laufend) return { fehler: `Kleiner als ${v.laufend} geht nicht: Nummern werden nie wiederverwendet.` };
  const hoechste = hoechsteLaufende(kreis.muster, jahrJetzt, vergebene);
  if (hoechste >= neu) return { fehler: `${formatNummer(kreis.muster, jahrJetzt, hoechste)} ist schon vergeben.` };
  return { stand: { jahr: istJahresabhaengig(kreis.muster) ? jahrJetzt : 0, naechste: neu } };
}
