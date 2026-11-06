import { beforeEach, describe, expect, it, vi } from 'vitest';

// Datenbank nachgebildet: Tabelle vorlagen als Liste, Einstellungen als Map, Protokoll-Einträge mitgeschrieben
const db = vi.hoisted(() => ({
  verfuegbar: true,
  naechsteId: 1,
  zeilen: [] as { id: number; name: string; art: string; basis: string; bloecke_json: string; archiviert: number; geaendert_am: string }[],
  einstellungen: new Map<string, string>(),
  protokoll: [] as unknown[][],
}));
vi.mock('../db', async (original) => ({
  ...(await original<typeof import('../db')>()),
  datenbankVerfuegbar: () => db.verfuegbar,
  abfrage: vi.fn(async (sql: string, werte: unknown[] = []) => {
    const auswahl = ({ id, name, art, basis, bloecke_json, archiviert }: (typeof db.zeilen)[number]) => ({ id, name, art, basis, bloecke_json, archiviert });
    if (sql.startsWith('SELECT id, name, art, basis, bloecke_json, archiviert FROM vorlagen WHERE art = $1'))
      return db.zeilen.filter((z) => z.art === werte[0]).sort((a, b) => a.id - b.id).map(auswahl);
    if (sql.startsWith('SELECT id, name, art, basis, bloecke_json, archiviert FROM vorlagen WHERE id = $1'))
      return db.zeilen.filter((z) => z.id === werte[0]).map(auswahl);
    throw new Error(`Unerwartet: ${sql}`);
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
      db.zeilen.push({ id, name: String(werte[0]), art: String(werte[1]), bloecke_json: String(werte[2]), geaendert_am: String(werte[3]), basis: String(werte[4]), archiviert: 0 });
      return { geaendert: 1, id };
    }
    const z = db.zeilen.find((x) => x.id === werte[werte.length - 1]);
    if (!z) throw new Error(`Zeile fehlt: ${sql}`);
    if (sql.startsWith('UPDATE vorlagen SET bloecke_json')) z.bloecke_json = String(werte[0]);
    else if (sql.startsWith('UPDATE vorlagen SET name')) z.name = String(werte[0]);
    else if (sql.startsWith('UPDATE vorlagen SET archiviert')) z.archiviert = Number(werte[0]);
    else throw new Error(`Unerwartet: ${sql}`);
    z.geaendert_am = String(werte[1]);
    return { geaendert: 1, id: null };
  }),
}));

import { abfrage } from '../db';
import type { Baustein } from '../vorlagen/bausteine';
import { standardVorlage } from '../vorlagen/standard';
import {
  ladeAktiveBausteine,
  ladeAktivenSchluessel,
  ladeAktiveWahl,
  ladeEigeneVorlagen,
  ladeVorlagenFuerArt,
  speichereAktiveVorlage,
  speichereVorlage,
  vorlageAnlegen,
  vorlageAusZeile,
  vorlageEntfernen,
  vorlageUmbenennen,
  vorlageWiederherstellen,
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
const einstellung = () => JSON.parse(db.einstellungen.get('vorlagen_design') ?? 'null') as unknown;

/** Standard-Rechnung ohne Steuerhinweis = erste Änderung */
const geaendert = (): Baustein[] => standardVorlage('rechnung').filter((b) => b.typ !== 'steuerhinweis');
const formular = (): Baustein[] => standardVorlage('quittung', 'formular').filter((b) => b.typ !== 'rahmen');

describe('ohne eigene Vorlage gilt das Design', () => {
  it('Datenbank leer', async () => {
    expect(await ladeAktiveBausteine('rechnung')).toEqual(standardVorlage('rechnung'));
    expect(await ladeVorlagenFuerArt('rechnung')).toEqual([
      { schluessel: 'klassisch', id: null, design: 'klassisch', name: 'Klassisch', bausteine: standardVorlage('rechnung'), aktiv: true },
    ]);
  });
  it('ohne Datenbank (Browser) ganz ohne SQL', async () => {
    db.verfuegbar = false;
    const vorher = vi.mocked(abfrage).mock.calls.length;
    expect(await ladeAktiveBausteine('quittung')).toEqual(standardVorlage('quittung'));
    expect(await ladeAktivenSchluessel('quittung')).toBe('klassisch');
    expect((await ladeVorlagenFuerArt('quittung')).map((v) => [v.schluessel, v.aktiv])).toEqual([
      ['klassisch', true],
      ['formular', false],
    ]);
    expect(vi.mocked(abfrage).mock.calls.length).toBe(vorher);
  });
});

describe('eigene Vorlage anlegen', () => {
  it('erste Änderung am Design: „Meine Rechnung“, protokolliert; Speichern überschreibt dieselbe Zeile', async () => {
    const v = await vorlageAnlegen('rechnung', geaendert(), { basis: 'klassisch' });
    expect(v).toEqual({ id: 1, name: 'Meine Rechnung', art: 'rechnung', basis: 'klassisch', bausteine: geaendert(), archiviert: false });
    expect(protokoll()).toEqual([
      { tabelle: 'vorlagen', id: 1, aktion: 'neu', alt: null, neu: { name: 'Meine Rechnung', art: 'rechnung', basis: 'klassisch', bloecke_json: JSON.stringify(geaendert()) } },
    ]);
    // nicht aktiviert: neue Rechnungen nehmen weiter das Design
    expect(await ladeAktivenSchluessel('rechnung')).toBe('klassisch');

    const zwei: Baustein[] = [...geaendert(), { typ: 'trennlinie' }];
    expect((await speichereVorlage(1, zwei)).bausteine).toEqual(zwei);
    expect(db.zeilen).toHaveLength(1);
    expect(protokoll()[1]).toEqual({
      tabelle: 'vorlagen',
      id: 1,
      aktion: 'geaendert',
      alt: { bloecke_json: JSON.stringify(geaendert()) },
      neu: { bloecke_json: JSON.stringify(zwei) },
    });
    await speichereVorlage(1, zwei);
    expect(protokoll()).toHaveLength(2);
  });

  it('am aktiven Design: gleich aktiv, neue Belege nehmen die Änderung (wie früher die Kopie)', async () => {
    const v = await vorlageAnlegen('rechnung', geaendert(), { basis: 'klassisch', aktivieren: true });
    expect(einstellung()).toEqual({ rechnung: 'eigen:1' });
    expect(await ladeAktiveBausteine('rechnung')).toEqual(geaendert());
    expect((await ladeAktiveWahl('rechnung')).id).toBe(v.id);
    expect(protokoll().map((p) => [p.tabelle, p.aktion])).toEqual([
      ['vorlagen', 'neu'],
      ['einstellungen', 'neu'],
    ]);
  });

  it('weitere Kopien bekommen eine Nummer; eigener Name wird geprüft', async () => {
    await vorlageAnlegen('quittung', [], { basis: 'klassisch' });
    expect((await vorlageAnlegen('quittung', [], { basis: 'klassisch' })).name).toBe('Meine Quittung 2');
    expect((await vorlageAnlegen('quittung', formular(), { basis: 'formular' })).name).toBe('Meine Quittung (Formular)');
    expect((await vorlageAnlegen('quittung', formular(), { basis: 'formular', name: '  Quittung   Garten ' })).name).toBe('Quittung Garten');
    await expect(vorlageAnlegen('quittung', [], { basis: 'klassisch', name: 'quittung garten' })).rejects.toThrow('gibt es schon');
    await expect(vorlageAnlegen('quittung', [], { basis: 'klassisch', name: 'Formular' })).rejects.toThrow('gibt es schon');
    await expect(vorlageAnlegen('quittung', [], { basis: 'klassisch', name: ' ' })).rejects.toThrow('Namen');
    await expect(vorlageAnlegen('quittung', [], { basis: 'gibtsnicht' })).rejects.toThrow('Unbekanntes Design');
    // gleicher Name in einer anderen Art ist erlaubt
    expect((await vorlageAnlegen('rechnung', [], { basis: 'klassisch', name: 'Quittung Garten' })).art).toBe('rechnung');
  });

  it('nicht erlaubte Bausteine werden nicht gespeichert', async () => {
    const v = await vorlageAnlegen('quittung', [{ typ: 'titel' }, { typ: 'zahlung' }], { basis: 'klassisch' });
    expect(v.bausteine).toEqual([{ typ: 'titel' }]);
    expect(db.zeilen[0].bloecke_json).toBe('[{"typ":"titel"}]');
    await speichereVorlage(v.id, [{ typ: 'zahlung' }, { typ: 'betreff' }]);
    expect(db.zeilen[0].bloecke_json).toBe('[{"typ":"betreff"}]');
  });
});

describe('Liste und aktive Vorlage', () => {
  it('Designs zuerst, dann eigene nach Name; „Diese verwenden“ für eine eigene', async () => {
    await vorlageAnlegen('quittung', formular(), { basis: 'formular', name: 'Zelt' });
    await vorlageAnlegen('quittung', [{ typ: 'titel' }], { basis: 'klassisch', name: 'Garten' });
    expect(await speichereAktiveVorlage('quittung', 'eigen:1')).toBe(true);
    expect(await ladeVorlagenFuerArt('quittung')).toEqual([
      { schluessel: 'klassisch', id: null, design: 'klassisch', name: 'Klassisch', bausteine: standardVorlage('quittung'), aktiv: false },
      { schluessel: 'formular', id: null, design: 'formular', name: 'Formular', bausteine: standardVorlage('quittung', 'formular'), aktiv: false },
      { schluessel: 'eigen:2', id: 2, design: 'klassisch', name: 'Garten', bausteine: [{ typ: 'titel' }], aktiv: false },
      { schluessel: 'eigen:1', id: 1, design: 'formular', name: 'Zelt', bausteine: formular(), aktiv: true },
    ]);
    // andere Arten bleiben beim Ändern erhalten, nochmal dasselbe ⇒ nichts
    await speichereAktiveVorlage('rechnung', 'klassisch');
    expect(einstellung()).toEqual({ quittung: 'eigen:1', rechnung: 'klassisch' });
    expect(await speichereAktiveVorlage('quittung', 'eigen:1')).toBe(false);
  });

  it('ungültige Schlüssel: Speichern abgelehnt, gespeicherte fallen auf das Design zurück', async () => {
    await expect(speichereAktiveVorlage('rechnung', 'formular')).rejects.toThrow('gibt es nicht');
    await expect(speichereAktiveVorlage('rechnung', 'eigen:9')).rejects.toThrow('gibt es nicht');
    const q = await vorlageAnlegen('quittung', [], { basis: 'klassisch' });
    // eigene Vorlage einer anderen Art zählt nicht
    await expect(speichereAktiveVorlage('rechnung', `eigen:${q.id}`)).rejects.toThrow('gibt es nicht');
    db.einstellungen.set('vorlagen_design', JSON.stringify({ quittung: 'eigen:77', rechnung: 'formular', angebot: 7 }));
    expect(await ladeAktivenSchluessel('quittung')).toBe('klassisch');
    expect(await ladeAktivenSchluessel('rechnung')).toBe('klassisch');
    expect(await ladeAktivenSchluessel('angebot')).toBe('klassisch');
    db.einstellungen.set('vorlagen_design', '{kaputt');
    expect(await ladeAktivenSchluessel('quittung')).toBe('klassisch');
  });
});

describe('Umbenennen, Entfernen, Rückgängig', () => {
  it('umbenennen: geprüft, protokolliert, gleicher Name ⇒ nichts', async () => {
    await vorlageAnlegen('quittung', [], { basis: 'klassisch' });
    await vorlageAnlegen('quittung', [], { basis: 'klassisch', name: 'Garten' });
    await expect(vorlageUmbenennen(1, 'garten')).rejects.toThrow('gibt es schon');
    expect((await vorlageUmbenennen(1, 'Quittung Hecke')).name).toBe('Quittung Hecke');
    expect(protokoll()[protokoll().length - 1]).toEqual({ tabelle: 'vorlagen', id: 1, aktion: 'geaendert', alt: { name: 'Meine Quittung' }, neu: { name: 'Quittung Hecke' } });
    const n = protokoll().length;
    await vorlageUmbenennen(2, 'Garten');
    expect(protokoll()).toHaveLength(n);
  });

  it('entfernen archiviert (nie löschen); die aktive fällt auf ihr Design zurück; Rückgängig stellt beides her', async () => {
    const v = await vorlageAnlegen('quittung', formular(), { basis: 'formular', aktivieren: true });
    const r = await vorlageEntfernen(v.id);
    expect(r).toMatchObject({ warAktiv: true, vorlage: { id: v.id, archiviert: true } });
    expect(db.zeilen).toHaveLength(1);
    expect(db.zeilen[0].archiviert).toBe(1);
    expect(einstellung()).toEqual({ quittung: 'formular' });
    expect(await ladeAktivenSchluessel('quittung')).toBe('formular');
    // entfernte bleibt in der Liste (für Entwürfe, die sie nutzen), ist aber markiert und nie aktiv
    expect((await ladeVorlagenFuerArt('quittung'))[2]).toMatchObject({ id: v.id, archiviert: true, aktiv: false });
    expect((await ladeEigeneVorlagen('quittung'))[0].archiviert).toBe(true);
    // als aktive nicht mehr wählbar
    await expect(speichereAktiveVorlage('quittung', `eigen:${v.id}`)).rejects.toThrow('gibt es nicht');
    // ihr Name ist wieder frei
    expect((await vorlageAnlegen('quittung', [], { basis: 'formular' })).name).toBe('Meine Quittung (Formular)');

    expect((await vorlageWiederherstellen(v.id, r.warAktiv)).archiviert).toBe(false);
    expect(einstellung()).toEqual({ quittung: `eigen:${v.id}` });
    expect(protokoll().filter((p) => p.tabelle === 'vorlagen' && p.id === v.id).map((p) => [p.aktion, p.neu])).toEqual([
      ['neu', { name: 'Meine Quittung (Formular)', art: 'quittung', basis: 'formular', bloecke_json: JSON.stringify(formular()) }],
      ['geaendert', { archiviert: 1 }],
      ['geaendert', { archiviert: 0 }],
    ]);
  });

  it('entfernen einer nicht aktiven lässt die Einstellung', async () => {
    await vorlageAnlegen('quittung', [], { basis: 'klassisch' });
    expect((await vorlageEntfernen(1)).warAktiv).toBe(false);
    expect(db.einstellungen.has('vorlagen_design')).toBe(false);
    // zweimal ⇒ nichts mehr
    const n = protokoll().length;
    await vorlageEntfernen(1);
    expect(protokoll()).toHaveLength(n);
  });

  it('unbekannte ID ⇒ Fehler', async () => {
    await expect(speichereVorlage(5, [])).rejects.toThrow('gibt es nicht');
    await expect(vorlageEntfernen(5)).rejects.toThrow('gibt es nicht');
  });
});

describe('vorlageAusZeile', () => {
  it('unbekannte und für die Art nicht erlaubte Bausteine fallen weg', () => {
    expect(
      vorlageAusZeile({ id: 3, name: 'Meine Quittung', art: 'quittung', bloecke_json: '[{"typ":"titel"},{"typ":"zahlung"},{"typ":"gibtsnicht"}]' }),
    ).toEqual({ id: 3, name: 'Meine Quittung', art: 'quittung', basis: 'klassisch', bausteine: [{ typ: 'titel' }], archiviert: false });
  });
  it('fremde Art ⇒ null, kaputtes JSON ⇒ leere Vorlage', () => {
    expect(vorlageAusZeile({ id: 4, name: 'X', art: 'gutschrift', bloecke_json: '[]' })).toBeNull();
    expect(vorlageAusZeile({ id: 5, name: 'X', art: 'angebot', basis: null, bloecke_json: '{kaputt', archiviert: 1 })).toEqual({
      id: 5,
      name: 'X',
      art: 'angebot',
      basis: 'klassisch',
      bausteine: [],
      archiviert: true,
    });
  });
});
