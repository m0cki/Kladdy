/* Nummernkreise in der Datenbank (ANLEITUNG §5 Tabelle nummernkreise, §6.10 „Muster mit Vorschau“).
 * Vergeben wird hier nichts (das macht später der Rust-Command beim Ausstellen). Hier nur: Muster ändern und die
 * nächste Nummer erhöhen – beides als ein UPDATE mit Prüfung des alten Stands (ändert sich der Kreis zwischendurch,
 * wird nichts geschrieben). Logik und Prüfungen in lib/numbering.ts.
 * Protokoll: tabelle 'nummernkreise', schluessel = Kreis-ID ('rechnung'). */
import { abfrage, ausfuehren, nacheinander } from '../db';
import { KREIS_NAMEN, KREIS_REIHENFOLGE, type Nummernkreis, type NummernkreisId } from '../numbering';
import { protokollieren } from './protokoll';

export type NummernTabelle = 'buchungen' | 'rechnungen' | 'kunden';

/** Wo die Nummern eines Kreises landen. rechnungen.nummer ist über alle Belegarten eindeutig. */
export function nummernTabelle(id: NummernkreisId): NummernTabelle {
  if (id === 'buchung') return 'buchungen';
  if (id === 'kunde') return 'kunden';
  return 'rechnungen';
}

/** Die anderen Kreise, deren Nummern in derselben Tabelle stehen (für die Prüfung auf doppelte Muster). */
export function nachbarn(kreise: readonly Nummernkreis[], id: NummernkreisId): { name: string; muster: string }[] {
  const tabelle = nummernTabelle(id);
  return kreise.filter((k) => k.id !== id && nummernTabelle(k.id) === tabelle).map((k) => ({ name: KREIS_NAMEN[k.id], muster: k.muster }));
}

const istKreisId = (id: string): id is NummernkreisId => (KREIS_REIHENFOLGE as readonly string[]).includes(id);

export async function ladeNummernkreise(): Promise<Nummernkreis[]> {
  const zeilen = await abfrage<{ id: string; muster: string; jahr: number; naechste: number }>(
    'SELECT id, muster, jahr, naechste FROM nummernkreise',
  );
  return zeilen
    .filter((z): z is Nummernkreis => istKreisId(z.id))
    .sort((a, b) => KREIS_REIHENFOLGE.indexOf(a.id) - KREIS_REIHENFOLGE.indexOf(b.id));
}

/** Alle schon vergebenen Nummern in der Tabelle des Kreises (Entwürfe haben keine Nummer). */
export async function vergebeneNummern(id: NummernkreisId): Promise<string[]> {
  const zeilen = await abfrage<{ nummer: string }>(`SELECT nummer FROM ${nummernTabelle(id)} WHERE nummer IS NOT NULL`);
  return zeilen.map((z) => z.nummer);
}

const GEAENDERT = 'Der Nummernkreis wurde inzwischen verändert. Bitte die Seite neu öffnen und es noch einmal versuchen.';

/** Muster ändern (vorher mit musterWechselFehler prüfen). */
export function speichereMuster(kreis: Nummernkreis, muster: string): Promise<void> {
  return nacheinander(async () => {
    const r = await ausfuehren('UPDATE nummernkreise SET muster = $1 WHERE id = $2 AND muster = $3 AND jahr = $4 AND naechste = $5', [
      muster,
      kreis.id,
      kreis.muster,
      kreis.jahr,
      kreis.naechste,
    ]);
    if (r.geaendert !== 1) throw new Error(GEAENDERT);
    await protokollieren({ tabelle: 'nummernkreise', schluessel: kreis.id, aktion: 'geaendert', alt: { muster: kreis.muster }, neu: { muster } });
  });
}

/** Neuen Stand setzen (nur aus zaehlerErhoehen). Die Bedingung `naechste < neu OR jahr < neu` hält den Zähler auch hier nur aufwärts. */
export function speichereZaehler(kreis: Nummernkreis, stand: Pick<Nummernkreis, 'jahr' | 'naechste'>): Promise<void> {
  return nacheinander(async () => {
    const r = await ausfuehren(
      'UPDATE nummernkreise SET jahr = $1, naechste = $2 WHERE id = $3 AND muster = $4 AND jahr = $5 AND naechste = $6 AND (naechste < $7 OR jahr < $8)',
      [stand.jahr, stand.naechste, kreis.id, kreis.muster, kreis.jahr, kreis.naechste, stand.naechste, stand.jahr],
    );
    if (r.geaendert !== 1) throw new Error(GEAENDERT);
    await protokollieren({
      tabelle: 'nummernkreise',
      schluessel: kreis.id,
      aktion: 'geaendert',
      alt: { jahr: kreis.jahr, naechste: kreis.naechste },
      neu: { jahr: stand.jahr, naechste: stand.naechste },
    });
  });
}
