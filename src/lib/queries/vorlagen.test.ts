import { beforeEach, describe, expect, it, vi } from 'vitest';

// Datenbank nachgebildet: Tabelle vorlagen als Liste, Protokoll-Einträge mitgeschrieben
const db = vi.hoisted(() => ({
  verfuegbar: true,
  naechsteId: 1,
  zeilen: [] as { id: number; name: string; art: string; bloecke_json: string; ist_standard: number; geaendert_am: string }[],
  protokoll: [] as unknown[][],
}));
vi.mock('../db', async (original) => ({
  ...(await original<typeof import('../db')>()),
  datenbankVerfuegbar: () => db.verfuegbar,
  abfrage: vi.fn(async (sql: string, werte: unknown[] = []) => {
    if (!sql.startsWith('SELECT id, name, art, bloecke_json, ist_standard FROM vorlagen')) throw new Error(`Unerwartet: ${sql}`);
    return db.zeilen
      .filter((z) => z.art === werte[0])
      .sort((a, b) => b.ist_standard - a.ist_standard || b.id - a.id)
      .map(({ id, name, art, bloecke_json, ist_standard }) => ({ id, name, art, bloecke_json, ist_standard }));
  }),
  ausfuehren: vi.fn(async (sql: string, werte: unknown[] = []) => {
    if (sql.startsWith('INSERT INTO protokoll')) {
      db.protokoll.push(werte);
      return { geaendert: 1, id: db.protokoll.length };
    }
    if (sql.startsWith('INSERT INTO vorlagen')) {
      const id = db.naechsteId++;
      db.zeilen.push({ id, name: String(werte[0]), art: String(werte[1]), bloecke_json: String(werte[2]), ist_standard: 1, geaendert_am: String(werte[3]) });
      return { geaendert: 1, id };
    }
    const z = db.zeilen.find((x) => x.id === werte[werte.length - 1]);
    if (!z) throw new Error(`Zeile fehlt: ${sql}`);
    if (sql.startsWith('UPDATE vorlagen SET bloecke_json')) {
      z.bloecke_json = String(werte[0]);
      z.ist_standard = 1;
      z.geaendert_am = String(werte[1]);
    } else if (sql.startsWith('UPDATE vorlagen SET ist_standard = 0')) {
      z.ist_standard = 0;
      z.geaendert_am = String(werte[0]);
    } else throw new Error(`Unerwartet: ${sql}`);
    return { geaendert: 1, id: null };
  }),
}));

import { abfrage } from '../db';
import type { Baustein } from '../vorlagen/bausteine';
import { standardVorlage } from '../vorlagen/standard';
import { ladeAktiveBausteine, ladeEigeneVorlage, ladeVorlagenFuerArt, speichereVorlage, vorlageAusZeile, vorlageZuruecksetzen } from './vorlagen';

beforeEach(() => {
  db.verfuegbar = true;
  db.naechsteId = 1;
  db.zeilen.length = 0;
  db.protokoll.length = 0;
});

/** Protokoll lesbar: tabelle, datensatz_id, aktion, alt/neu als Objekt */
const protokoll = () =>
  db.protokoll.map((w) => ({
    tabelle: w[1],
    id: w[2],
    aktion: w[3],
    alt: w[4] == null ? null : (JSON.parse(String(w[4])) as unknown),
    neu: w[5] == null ? null : (JSON.parse(String(w[5])) as unknown),
  }));

/** Standard-Rechnung ohne Steuerhinweis = erste Änderung */
const geaendert = (): Baustein[] => standardVorlage('rechnung').filter((b) => b.typ !== 'steuerhinweis');

describe('ohne eigene Vorlage gilt der Standard', () => {
  it('Datenbank leer', async () => {
    expect(await ladeEigeneVorlage('rechnung')).toBeNull();
    expect(await ladeAktiveBausteine('rechnung')).toEqual(standardVorlage('rechnung'));
    expect(await ladeVorlagenFuerArt('rechnung')).toEqual([{ id: null, name: 'Standardvorlage', bausteine: standardVorlage('rechnung'), aktiv: true }]);
  });
  it('ohne Datenbank (Browser) ganz ohne SQL', async () => {
    db.verfuegbar = false;
    const vorher = vi.mocked(abfrage).mock.calls.length;
    expect(await ladeAktiveBausteine('quittung')).toEqual(standardVorlage('quittung'));
    expect(await ladeVorlagenFuerArt('quittung')).toHaveLength(1);
    expect(vi.mocked(abfrage).mock.calls.length).toBe(vorher);
  });
});

describe('erste Änderung legt die eigene Kopie an', () => {
  it('anlegen, danach dieselbe Zeile überschreiben, ohne Änderung nichts schreiben', async () => {
    const v = await speichereVorlage('rechnung', geaendert());
    expect(v).toEqual({ id: 1, name: 'Meine Rechnung', art: 'rechnung', bausteine: geaendert(), aktiv: true });
    expect(db.zeilen).toHaveLength(1);
    expect(await ladeAktiveBausteine('rechnung')).toEqual(geaendert());
    expect(protokoll()).toEqual([
      { tabelle: 'vorlagen', id: 1, aktion: 'neu', alt: null, neu: { name: 'Meine Rechnung', art: 'rechnung', bloecke_json: JSON.stringify(geaendert()), ist_standard: 1 } },
    ]);

    const zwei: Baustein[] = [...geaendert(), { typ: 'trennlinie' }];
    expect((await speichereVorlage('rechnung', zwei)).id).toBe(1);
    expect(db.zeilen).toHaveLength(1);
    expect(protokoll()[1]).toEqual({
      tabelle: 'vorlagen',
      id: 1,
      aktion: 'geaendert',
      alt: { bloecke_json: JSON.stringify(geaendert()) },
      neu: { bloecke_json: JSON.stringify(zwei) },
    });

    await speichereVorlage('rechnung', zwei);
    expect(protokoll()).toHaveLength(2);
  });
  it('Auswahl für die Beleg-Maske: Standard und eigene Kopie, die eigene ist aktiv', async () => {
    await speichereVorlage('rechnung', geaendert());
    expect(await ladeVorlagenFuerArt('rechnung')).toEqual([
      { id: null, name: 'Standardvorlage', bausteine: standardVorlage('rechnung'), aktiv: false },
      { id: 1, name: 'Meine Rechnung', bausteine: geaendert(), aktiv: true },
    ]);
  });
  it('andere Arten bleiben beim Standard', async () => {
    await speichereVorlage('rechnung', geaendert());
    expect(await ladeAktiveBausteine('quittung')).toEqual(standardVorlage('quittung'));
  });
  it('nicht erlaubte Bausteine werden nicht gespeichert', async () => {
    const v = await speichereVorlage('quittung', [{ typ: 'titel' }, { typ: 'zahlung' }]);
    expect(v.bausteine).toEqual([{ typ: 'titel' }]);
    expect(db.zeilen[0].bloecke_json).toBe('[{"typ":"titel"}]');
  });
});

describe('Zurücksetzen und Rückgängig', () => {
  it('schaltet die Kopie ab; Rückgängig nimmt dieselbe Zeile wieder', async () => {
    await speichereVorlage('rechnung', geaendert());
    expect(await vorlageZuruecksetzen('rechnung')).toBe(true);
    expect(db.zeilen[0].ist_standard).toBe(0);
    expect(await ladeEigeneVorlage('rechnung')).toBeNull();
    expect(await ladeAktiveBausteine('rechnung')).toEqual(standardVorlage('rechnung'));
    expect(protokoll()[1]).toEqual({ tabelle: 'vorlagen', id: 1, aktion: 'geaendert', alt: { ist_standard: 1 }, neu: { ist_standard: 0 } });
    expect(await vorlageZuruecksetzen('rechnung')).toBe(false);
    expect(protokoll()).toHaveLength(2);

    const v = await speichereVorlage('rechnung', geaendert());
    expect(v.id).toBe(1);
    expect(db.zeilen).toHaveLength(1);
    expect(protokoll()[2]).toEqual({ tabelle: 'vorlagen', id: 1, aktion: 'geaendert', alt: { ist_standard: 0 }, neu: { ist_standard: 1 } });
    expect(await ladeAktiveBausteine('rechnung')).toEqual(geaendert());
  });
});

describe('vorlageAusZeile', () => {
  it('unbekannte und für die Art nicht erlaubte Bausteine fallen weg', () => {
    expect(
      vorlageAusZeile({ id: 3, name: 'Meine Quittung', art: 'quittung', bloecke_json: '[{"typ":"titel"},{"typ":"zahlung"},{"typ":"gibtsnicht"}]', ist_standard: 1 }),
    ).toEqual({ id: 3, name: 'Meine Quittung', art: 'quittung', bausteine: [{ typ: 'titel' }], aktiv: true });
  });
  it('fremde Art ⇒ null, kaputtes JSON ⇒ leere Vorlage', () => {
    expect(vorlageAusZeile({ id: 4, name: 'X', art: 'gutschrift', bloecke_json: '[]', ist_standard: 1 })).toBeNull();
    expect(vorlageAusZeile({ id: 5, name: 'X', art: 'angebot', bloecke_json: '{kaputt', ist_standard: 0 })).toEqual({
      id: 5,
      name: 'X',
      art: 'angebot',
      bausteine: [],
      aktiv: false,
    });
  });
});
