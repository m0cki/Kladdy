/* Kategorien und EÜR-Zuordnung pro Jahr in der Datenbank (ANLEITUNG §2.8, Tabellen kategorien und euer_zuordnung aus
 * der Migration „kategorien“). Prüfen und die wirksame Zuordnung eines Jahres rechnet lib/kategorien.ts.
 * Schreiben wie die übrigen Einstellungen (queries/einstellungen.ts, steuer.ts): je Änderung EIN SQL-Befehl und danach
 * der Protokolleintrag, beides in der Schreib-Warteschlange (nacheinander). Regeln über mehrere Zeilen prüft der Befehl
 * selbst – Ausblenden nur, wenn eine andere Kategorie derselben Art sichtbar bleibt; „Jahr anlegen“ ist ein einziges
 * INSERT … SELECT –, dahinter stehen die Trigger der Migration. Ein Rust-Command wäre erst für Vorgänge über mehrere
 * Befehle nötig (CLAUDE.md), die gibt es hier nicht.
 * Protokoll: kategorien mit datensatz_id = ID; euer_zuordnung wie steuer_parameter (datensatz_id 0, schluessel = Jahr)
 * mit kategorie_id in alt/neu. Mit Vitest getestet (kategorien.test.ts, Datenbank nachgebildet). */
import { abfrage, ausfuehren, eine, nacheinander } from '../db';
import {
  LETZTE_SICHTBARE,
  ersterFehler,
  euerZuordnungFuer,
  kategoriePruefen,
  type EuerZeile,
  type EuerZuordnung,
  type Kategorie,
  type KategorieDaten,
  type KategorieFormular,
} from '../kategorien';
import { aenderungen, protokollieren, type ProtokollEintrag } from './protokoll';

const FEHLT = 'Diese Kategorie gibt es nicht (mehr).';

const KATEGORIEN_SQL = `
  SELECT k.id, k.name, k.typ, k.euer_bereich, k.abziehbar_prozent, k.zaehlt_ku_umsatz, k.wareneingang, k.farbe, k.icon,
         k.stichworte, k.sortierung, k.archiviert,
         (SELECT COUNT(*) FROM buchungen b WHERE b.kategorie_id = k.id) AS buchungen
    FROM kategorien k
   ORDER BY k.typ DESC, k.sortierung, k.name`;

/** Alle Kategorien, auch ausgeblendete: Einnahmen zuerst, dann in der Reihenfolge der Kacheln beim Erfassen. */
export const ladeKategorien = (): Promise<Kategorie[]> => abfrage<Kategorie>(KATEGORIEN_SQL);

/** Spalten, die das Formular ändert (die Art nur beim Anlegen). */
const FELDER = ['name', 'euer_bereich', 'abziehbar_prozent', 'zaehlt_ku_umsatz', 'wareneingang', 'stichworte', 'icon', 'farbe'] as const;
type Feld = (typeof FELDER)[number];

const felderVon = (d: Record<Feld, unknown>): Record<string, unknown> => Object.fromEntries(FELDER.map((f) => [f, d[f]]));

/** Protokolleintrag „Kategorie geändert“: nur die geänderten Spalten; null, wenn sich nichts ändert. */
export function protokollFuerKategorie(alt: Kategorie, neu: KategorieDaten): ProtokollEintrag | null {
  const diff = aenderungen(felderVon(alt), felderVon(neu));
  return diff ? { tabelle: 'kategorien', datensatzId: alt.id, aktion: 'geaendert', ...diff } : null;
}

/** Neue Kategorie anlegen: sichtbar, hinter allen anderen einsortiert. Gibt die ID zurück; ungültige Eingaben werfen. */
export function kategorieAnlegen(f: KategorieFormular): Promise<number> {
  return nacheinander(async () => {
    const r = kategoriePruefen(f, await ladeKategorien(), null);
    if (!r.ok) throw new Error(ersterFehler(r.fehler));
    const d = r.daten;
    const { id } = await ausfuehren(
      `INSERT INTO kategorien
         (name, typ, euer_bereich, abziehbar_prozent, zaehlt_ku_umsatz, wareneingang, stichworte, icon, farbe, sortierung, archiviert)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE(MAX(sortierung), 0) + 1, 0 FROM kategorien`,
      [d.name, d.typ, d.euer_bereich, d.abziehbar_prozent, d.zaehlt_ku_umsatz, d.wareneingang, d.stichworte, d.icon, d.farbe],
    );
    if (id == null) throw new Error('Die Kategorie wurde nicht angelegt.');
    const zeile = await eine<Record<string, unknown>>('SELECT * FROM kategorien WHERE id = $1', [id]);
    await protokollieren({ tabelle: 'kategorien', datensatzId: id, aktion: 'neu', neu: zeile ?? { ...d } });
    return id;
  });
}

/** Kategorie ändern (alles außer der Art). false = nichts geändert (dann auch kein Protokoll). */
export function kategorieAendern(id: number, f: KategorieFormular): Promise<boolean> {
  return nacheinander(async () => {
    const alle = await ladeKategorien();
    const alt = alle.find((k) => k.id === id);
    if (!alt) throw new Error(FEHLT);
    const r = kategoriePruefen(f, alle, alt);
    if (!r.ok) throw new Error(ersterFehler(r.fehler));
    const d = r.daten;
    const eintrag = protokollFuerKategorie(alt, d);
    if (!eintrag) return false;
    await ausfuehren(
      `UPDATE kategorien
          SET name = $1, euer_bereich = $2, abziehbar_prozent = $3, zaehlt_ku_umsatz = $4, wareneingang = $5,
              stichworte = $6, icon = $7, farbe = $8
        WHERE id = $9`,
      [d.name, d.euer_bereich, d.abziehbar_prozent, d.zaehlt_ku_umsatz, d.wareneingang, d.stichworte, d.icon, d.farbe, id],
    );
    await protokollieren(eintrag);
    return true;
  });
}

/**
 * Ein- oder ausblenden. false = war schon so. Ausblenden nur, solange eine andere Kategorie derselben Art sichtbar
 * bleibt – geprüft im UPDATE selbst (dahinter der Trigger kategorien_letzte_sichtbare).
 */
export function kategorieSichtbar(id: number, sichtbar: boolean): Promise<boolean> {
  return nacheinander(async () => {
    const r = await ausfuehren(
      sichtbar
        ? 'UPDATE kategorien SET archiviert = 0 WHERE id = $1 AND archiviert <> 0'
        : `UPDATE kategorien SET archiviert = 1
            WHERE id = $1 AND archiviert = 0
              AND EXISTS (SELECT 1 FROM kategorien a WHERE a.typ = kategorien.typ AND a.archiviert = 0 AND a.id <> kategorien.id)`,
      [id],
    );
    if (r.geaendert === 0) {
      const k = await eine<{ typ: Kategorie['typ']; archiviert: number }>('SELECT typ, archiviert FROM kategorien WHERE id = $1', [id]);
      if (!k) throw new Error(FEHLT);
      if ((k.archiviert === 0) === sichtbar) return false;
      throw new Error(LETZTE_SICHTBARE[k.typ]);
    }
    await protokollieren({
      tabelle: 'kategorien',
      datensatzId: id,
      aktion: 'geaendert',
      alt: { archiviert: sichtbar ? 1 : 0 },
      neu: { archiviert: sichtbar ? 0 : 1 },
    });
    return true;
  });
}

/* ---------- EÜR-Zuordnung pro Jahr ---------- */

const EUER_SQL = 'SELECT jahr, kategorie_id, euer_bereich, euer_zeile FROM euer_zuordnung';

/** Alle gespeicherten Zuordnungen (alle Jahre). */
export const ladeEuerZeilen = (): Promise<EuerZeile[]> => abfrage<EuerZeile>(`${EUER_SQL} ORDER BY jahr, kategorie_id`);

/**
 * Für die EÜR (Phase 5): wirksame Zuordnung ALLER Kategorien (auch ausgeblendeter, ältere Buchungen zählen weiter) in
 * einem Jahr – EÜR-Bereich des Jahres, sonst der der Kategorie, und die Zeile der Anlage EÜR (null = nicht eingetragen).
 * Hat das Jahr keine eigene Zuordnung, gilt die des nächstälteren (euerZuordnungFuer in lib/kategorien.ts).
 */
export async function ladeEuerZuordnung(jahr: number): Promise<EuerZuordnung[]> {
  const [kategorien, zeilen] = await Promise.all([ladeKategorien(), ladeEuerZeilen()]);
  return euerZuordnungFuer(jahr, kategorien, zeilen);
}

/** Werte einer Zuordnung: Bereich null = der der Kategorie, Zeile null = keine. */
export type EuerWerte = Pick<EuerZeile, 'euer_bereich' | 'euer_zeile'>;

/**
 * Protokolleintrag für eine Zuordnung (immer mit kategorie_id): 'neu', wenn es die Zeile noch nicht gab, sonst nur die
 * geänderten Werte. null, wenn sich nichts ändert.
 */
export function protokollFuerEuer(jahr: number, kategorieId: number, alt: EuerWerte | null, neu: EuerWerte): ProtokollEintrag | null {
  const n = { euer_bereich: neu.euer_bereich, euer_zeile: neu.euer_zeile };
  const schluessel = String(jahr);
  if (!alt) {
    if (n.euer_bereich === null && n.euer_zeile === null) return null;
    return { tabelle: 'euer_zuordnung', schluessel, aktion: 'neu', neu: { kategorie_id: kategorieId, ...n } };
  }
  const diff = aenderungen({ euer_bereich: alt.euer_bereich, euer_zeile: alt.euer_zeile }, n);
  if (!diff) return null;
  return {
    tabelle: 'euer_zuordnung',
    schluessel,
    aktion: 'geaendert',
    alt: { kategorie_id: kategorieId, ...diff.alt },
    neu: { kategorie_id: kategorieId, ...diff.neu },
  };
}

/** Bereich und/oder Zeile einer Kategorie in einem Jahr setzen; nur die übergebenen Werte ändern sich. false = keine Änderung. */
export function speichereEuerZuordnung(jahr: number, kategorieId: number, teil: Partial<EuerWerte>): Promise<boolean> {
  return nacheinander(async () => {
    const alt = await eine<EuerWerte>(
      'SELECT euer_bereich, euer_zeile FROM euer_zuordnung WHERE jahr = $1 AND kategorie_id = $2',
      [jahr, kategorieId],
    );
    const neu: EuerWerte = {
      euer_bereich: teil.euer_bereich !== undefined ? teil.euer_bereich : (alt?.euer_bereich ?? null),
      euer_zeile: teil.euer_zeile !== undefined ? teil.euer_zeile : (alt?.euer_zeile ?? null),
    };
    const eintrag = protokollFuerEuer(jahr, kategorieId, alt, neu);
    if (!eintrag) return false;
    await ausfuehren(
      `INSERT INTO euer_zuordnung (jahr, kategorie_id, euer_bereich, euer_zeile) VALUES ($1, $2, $3, $4)
       ON CONFLICT (jahr, kategorie_id) DO UPDATE SET euer_bereich = excluded.euer_bereich, euer_zeile = excluded.euer_zeile`,
      [jahr, kategorieId, neu.euer_bereich, neu.euer_zeile],
    );
    await protokollieren(eintrag);
    return true;
  });
}

/** Protokoll „Jahr angelegt“: Herkunft und je Kategorie (Schlüssel = kategorie_id) Bereich und Zeile. */
export const euerJahrProtokoll = (zeilen: readonly EuerZeile[], quelle: number | null): Record<string, unknown> => ({
  aus_jahr: quelle,
  zuordnung: Object.fromEntries(zeilen.map((z) => [String(z.kategorie_id), { euer_bereich: z.euer_bereich, euer_zeile: z.euer_zeile }])),
});

/**
 * Neues Jahr anlegen: je Kategorie die Zuordnung aus `quelle` (null = es gibt noch keine: alles wie die Kategorien,
 * ohne Zeilen). Ein einziges INSERT … SELECT über alle Kategorien, also ganz oder gar nicht.
 */
export function legeEuerJahrAn(jahr: number, quelle: number | null): Promise<EuerZeile[]> {
  return nacheinander(async () => {
    if (await eine(`${EUER_SQL} WHERE jahr = $1 LIMIT 1`, [jahr])) throw new Error(`Für ${jahr} gibt es schon eine EÜR-Zuordnung.`);
    await ausfuehren(
      `INSERT INTO euer_zuordnung (jahr, kategorie_id, euer_bereich, euer_zeile)
       SELECT $1, k.id, z.euer_bereich, z.euer_zeile
         FROM kategorien k LEFT JOIN euer_zuordnung z ON z.kategorie_id = k.id AND z.jahr = $2
        ORDER BY k.id`,
      [jahr, quelle],
    );
    const zeilen = await abfrage<EuerZeile>(`${EUER_SQL} WHERE jahr = $1 ORDER BY kategorie_id`, [jahr]);
    await protokollieren({ tabelle: 'euer_zuordnung', schluessel: String(jahr), aktion: 'neu', neu: euerJahrProtokoll(zeilen, quelle) });
    return zeilen;
  });
}
