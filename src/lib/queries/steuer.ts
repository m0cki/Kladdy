/* Steuer-Kennwerte pro Jahr in der Datenbank (ANLEITUNG §2.6, §5 Tabelle steuer_parameter).
 * Werte als JSON-Zahl im Text (Cent bzw. Prozent), Logik in lib/steuer-kennwerte.ts.
 * Protokoll: tabelle 'steuer_parameter', schluessel = Jahr ('2026'), alt/neu = { kennwert: zahl }. */
import { abfrage, ausfuehren, nacheinander } from '../db';
import { kennwerteNachJahr, type KennwerteJahr } from '../steuer-kennwerte';
import { protokollieren } from './protokoll';

export async function ladeKennwerte(): Promise<Map<number, KennwerteJahr>> {
  const zeilen = await abfrage<{ jahr: number; schluessel: string; wert: string }>(
    'SELECT jahr, schluessel, wert FROM steuer_parameter ORDER BY jahr, schluessel',
  );
  return kennwerteNachJahr(zeilen);
}

/** Einen Kennwert eines Jahres setzen. `alt` = bisheriger Wert (undefined, wenn es ihn in dem Jahr noch nicht gab). */
export function speichereKennwert(jahr: number, schluessel: string, alt: number | undefined, neu: number): Promise<boolean> {
  return nacheinander(async () => {
    if (alt === neu) return false;
    await ausfuehren(
      'INSERT INTO steuer_parameter (jahr, schluessel, wert) VALUES ($1, $2, $3) ON CONFLICT (jahr, schluessel) DO UPDATE SET wert = excluded.wert',
      [jahr, schluessel, String(neu)],
    );
    await protokollieren(
      alt === undefined
        ? { tabelle: 'steuer_parameter', schluessel: String(jahr), aktion: 'neu', neu: { [schluessel]: neu } }
        : { tabelle: 'steuer_parameter', schluessel: String(jahr), aktion: 'geaendert', alt: { [schluessel]: alt }, neu: { [schluessel]: neu } },
    );
    return true;
  });
}

/**
 * Neues Jahr mit den Werten aus `quelle` anlegen – ein einziges INSERT … SELECT, also ganz oder gar nicht.
 * Gibt es das Jahr schon, schlägt es am Primärschlüssel fehl.
 */
export function legeJahrAn(jahr: number, quelle: number): Promise<KennwerteJahr> {
  return nacheinander(async () => {
    const r = await ausfuehren(
      'INSERT INTO steuer_parameter (jahr, schluessel, wert) SELECT $1, schluessel, wert FROM steuer_parameter WHERE jahr = $2',
      [jahr, quelle],
    );
    if (r.geaendert === 0) throw new Error(`Für ${quelle} gibt es keine Kennwerte zum Übernehmen.`);
    const werte = (await ladeKennwerte()).get(jahr) ?? {};
    await protokollieren({ tabelle: 'steuer_parameter', schluessel: String(jahr), aktion: 'neu', neu: werte });
    return werte;
  });
}
