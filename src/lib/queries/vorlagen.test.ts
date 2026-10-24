import { beforeEach, describe, expect, it, vi } from 'vitest';

// Datenbank nachgebildet: Tabelle vorlagen als Liste, Protokoll-Einträge mitgeschrieben
const db = vi.hoisted(() => ({
  verfuegbar: true,
  naechsteId: 1,
  zeilen: [] as { id: number; name: string; art: string; basis: string; bloecke_json: string; ist_standard: number; geaendert_am: string }[],
  einstellungen: new Map<string, string>(),
  protokoll: [] as unknown[][],
}));
vi.mock('../db', async (original) => ({
  ...(await original<typeof import('../db')>()),
  datenbankVerfuegbar: () => db.verfuegbar,
  abfrage: vi.fn(async (sql: string, werte: unknown[] = []) => {
    if (!sql.startsWith('SELECT id, name, art, basis, bloecke_json, ist_standard FROM vorlagen')) throw new Error(`Unerwartet: ${sql}`);
    return db.zeilen
      .filter((z) => z.art === werte[0])
      .sort((a, b) => b.ist_standard - a.ist_standard || b.id - a.id)
      .map(({ id, name, art, basis, bloecke_json, ist_standard }) => ({ id, name, art, basis, bloecke_json, ist_standard }));
  }),
  eine: vi.fn(async (sql: string, werte: unknown[] = []) => {
    if (!sql.startsWith('SELECT wert FROM einstellungen')) throw new Error(`Unerwartet: ${sql}`);
    const wert = db.einstellungen.get(String(werte[0]));
    return wert === undefined ? null : { wert };
  }),
  ausfuehren: vi.fn(async (sql: string, werte: unknown[] = []) => {
    if (sql.startsWith('INSERT INTO protokoll')) {
      db.protokoll.push(werte);
      return { geaendert: 1, id: db.protokoll.length };
    }
    if (sql.startsWith('INSERT INTO einstellungen')) {
      db.einstellungen.set(String(werte[0]), String(werte[1]));
      return { geaendert: 1, id: null };
    }
    if (sql.startsWith('INSERT INTO vorlagen')) {
      const id = db.naechsteId++;
      db.zeilen.push({
        id,
        name: String(werte[0]),
        art: String(werte[1]),
        bloecke_json: String(werte[2]),
        ist_standard: 1,
        geaendert_am: String(werte[3]),
        basis: String(werte[4]),
      });
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
import {
  designsAusWert,
  ladeAktiveBausteine,
  ladeAktivesDesign,
  ladeEigeneVorlage,
  ladeEigeneVorlagen,
  ladeVorlagenFuerArt,
  speichereAktivesDesign,
  speichereVorlage,
  vorlageAusZeile,
  vorlageZuruecksetzen,
} from './vorlagen';

beforeEach(() => {
  db.verfuegbar = true;
  db.naechsteId = 1;
  db.zeilen.length = 0;
  db.einstellungen.clear();
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
    expect(await ladeVorlagenFuerArt('rechnung')).toEqual([
      { id: null, design: 'klassisch', name: 'Standardvorlage', bausteine: standardVorlage('rechnung'), aktiv: true },
    ]);
  });
  it('ohne Datenbank (Browser) ganz ohne SQL', async () => {
    db.verfuegbar = false;
    const vorher = vi.mocked(abfrage).mock.calls.length;
    expect(await ladeAktiveBausteine('quittung')).toEqual(standardVorlage('quittung'));
    expect(await ladeAktivesDesign('quittung')).toBe('klassisch');
    expect((await ladeVorlagenFuerArt('quittung')).map((v) => [v.design, v.aktiv])).toEqual([
      ['klassisch', true],
      ['formular', false],
    ]);
    expect(vi.mocked(abfrage).mock.calls.length).toBe(vorher);
  });
});

describe('erste Änderung legt die eigene Kopie an', () => {
  it('anlegen, danach dieselbe Zeile überschreiben, ohne Änderung nichts schreiben', async () => {
    const v = await speichereVorlage('rechnung', geaendert());
    expect(v).toEqual({ id: 1, name: 'Meine Rechnung', art: 'rechnung', basis: 'klassisch', bausteine: geaendert(), aktiv: true });
    expect(db.zeilen).toHaveLength(1);
    expect(await ladeAktiveBausteine('rechnung')).toEqual(geaendert());
    expect(protokoll()).toEqual([
      {
        tabelle: 'vorlagen',
        id: 1,
        aktion: 'neu',
        alt: null,
        neu: { name: 'Meine Rechnung', art: 'rechnung', basis: 'klassisch', bloecke_json: JSON.stringify(geaendert()), ist_standard: 1 },
      },
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
  it('Auswahl für die Beleg-Maske: je Design eine, mit der eigenen Kopie statt des Standards', async () => {
    await speichereVorlage('rechnung', geaendert());
    expect(await ladeVorlagenFuerArt('rechnung')).toEqual([{ id: 1, design: 'klassisch', name: 'Meine Rechnung', bausteine: geaendert(), aktiv: true }]);
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
    ).toEqual({ id: 3, name: 'Meine Quittung', art: 'quittung', basis: 'klassisch', bausteine: [{ typ: 'titel' }], aktiv: true });
  });
  it('fremde Art ⇒ null, kaputtes JSON ⇒ leere Vorlage', () => {
    expect(vorlageAusZeile({ id: 4, name: 'X', art: 'gutschrift', bloecke_json: '[]', ist_standard: 1 })).toBeNull();
    expect(vorlageAusZeile({ id: 5, name: 'X', art: 'angebot', basis: null, bloecke_json: '{kaputt', ist_standard: 0 })).toEqual({
      id: 5,
      name: 'X',
      art: 'angebot',
      basis: 'klassisch',
      bausteine: [],
      aktiv: false,
    });
  });
});

describe('Designs: eigene Kopie je (Art, Design), aktives Design je Art', () => {
  const formular = (): Baustein[] => standardVorlage('quittung', 'formular').filter((b) => b.typ !== 'rahmen');

  it('Kopie des Formulars ist eine eigene Zeile und schaltet das aktive Design nicht um', async () => {
    const v = await speichereVorlage('quittung', formular(), 'formular');
    expect(v).toMatchObject({ id: 1, name: 'Meine Quittung (Formular)', basis: 'formular', aktiv: true });
    expect(db.zeilen[0].basis).toBe('formular');
    // neue Quittungen nehmen weiter „Klassisch“
    expect(await ladeAktivesDesign('quittung')).toBe('klassisch');
    expect(await ladeAktiveBausteine('quittung')).toEqual(standardVorlage('quittung'));
    expect(await ladeEigeneVorlage('quittung')).toBeNull();
    expect(await ladeEigeneVorlage('quittung', 'formular')).toMatchObject({ id: 1 });

    // klassische Kopie daneben: eigene Zeile
    const k = await speichereVorlage('quittung', standardVorlage('quittung').slice(1));
    expect(k).toMatchObject({ id: 2, name: 'Meine Quittung', basis: 'klassisch' });
    expect([...(await ladeEigeneVorlagen('quittung')).keys()].sort()).toEqual(['formular', 'klassisch']);
    expect(await ladeVorlagenFuerArt('quittung')).toEqual([
      { id: 2, design: 'klassisch', name: 'Meine Quittung', bausteine: standardVorlage('quittung').slice(1), aktiv: true },
      { id: 1, design: 'formular', name: 'Meine Quittung (Formular)', bausteine: formular(), aktiv: false },
    ]);
  });

  it('aktives Design wählen: gilt für die Art, wirksam ist dessen Kopie, sonst das Design selbst', async () => {
    expect(await speichereAktivesDesign('quittung', 'formular')).toBe(true);
    expect(JSON.parse(db.einstellungen.get('vorlagen_design') ?? '')).toEqual({ quittung: 'formular' });
    expect(await ladeAktivesDesign('quittung')).toBe('formular');
    expect(await ladeAktivesDesign('rechnung')).toBe('klassisch');
    expect(await ladeAktiveBausteine('quittung')).toEqual(standardVorlage('quittung', 'formular'));
    await speichereVorlage('quittung', formular(), 'formular');
    expect(await ladeAktiveBausteine('quittung')).toEqual(formular());
    expect((await ladeVorlagenFuerArt('quittung')).map((v) => [v.design, v.id, v.aktiv])).toEqual([
      ['klassisch', null, false],
      ['formular', 1, true],
    ]);
    // protokolliert als Einstellung; nochmal dasselbe ⇒ nichts
    expect(protokoll()[0]).toMatchObject({ tabelle: 'einstellungen', aktion: 'neu', neu: { quittung: 'formular' } });
    expect(await speichereAktivesDesign('quittung', 'formular')).toBe(false);
    // andere Arten bleiben beim Ändern erhalten
    await speichereAktivesDesign('rechnung', 'klassisch');
    expect(JSON.parse(db.einstellungen.get('vorlagen_design') ?? '')).toEqual({ quittung: 'formular', rechnung: 'klassisch' });
  });

  it('unbekannte Designs: Einstellung fällt auf klassisch, Speichern wird abgelehnt, fremde Zeilen bleiben liegen', async () => {
    db.einstellungen.set('vorlagen_design', JSON.stringify({ quittung: 'gibtsnicht', rechnung: 'formular' }));
    expect(await ladeAktivesDesign('quittung')).toBe('klassisch');
    // „formular“ gibt es nur bei der Quittung
    expect(await ladeAktivesDesign('rechnung')).toBe('klassisch');
    await expect(speichereAktivesDesign('rechnung', 'formular')).rejects.toThrow('Unbekanntes Design');
    await expect(speichereVorlage('quittung', [], 'gibtsnicht')).rejects.toThrow('Unbekanntes Design');
    db.zeilen.push({ id: 9, name: 'Neuer', art: 'quittung', basis: 'zukunft', bloecke_json: '[]', ist_standard: 1, geaendert_am: '' });
    expect((await ladeEigeneVorlagen('quittung')).size).toBe(0);
    expect(await ladeAktiveBausteine('quittung')).toEqual(standardVorlage('quittung'));
  });

  it('designsAusWert: Unbekanntes und Kaputtes ⇒ klassisch', () => {
    expect(designsAusWert(undefined)).toEqual({ rechnung: 'klassisch', angebot: 'klassisch', quittung: 'klassisch', eigenbeleg: 'klassisch' });
    expect(designsAusWert([1]).quittung).toBe('klassisch');
    expect(designsAusWert({ quittung: 'formular', angebot: 7 })).toMatchObject({ quittung: 'formular', angebot: 'klassisch' });
  });

  it('Zurücksetzen trifft nur das gezeigte Design', async () => {
    await speichereVorlage('quittung', formular(), 'formular');
    await speichereVorlage('quittung', standardVorlage('quittung').slice(1));
    expect(await vorlageZuruecksetzen('quittung', 'formular')).toBe(true);
    expect(await ladeEigeneVorlage('quittung', 'formular')).toBeNull();
    expect(await ladeEigeneVorlage('quittung')).toMatchObject({ id: 2 });
    expect(await vorlageZuruecksetzen('quittung', 'formular')).toBe(false);
    // Rückgängig nimmt dieselbe Zeile
    expect((await speichereVorlage('quittung', formular(), 'formular')).id).toBe(1);
    expect(db.zeilen).toHaveLength(2);
  });
});
