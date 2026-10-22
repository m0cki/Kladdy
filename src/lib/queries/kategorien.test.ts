import { beforeEach, describe, expect, it, vi } from 'vitest';

// Datenbank nachgebildet: Kategorien und EÜR-Zuordnung als Listen, alle Schreibbefehle mitgeschrieben.
// Die SQL-Befehle selbst prüft der Rust-Test der Migration (Trigger) bzw. die App; hier geht es um Ablauf und Protokoll.
type Zeile = Record<string, unknown> & { id: number; typ: string; archiviert: number };
type Euer = { jahr: number; kategorie_id: number; euer_bereich: string | null; euer_zeile: number | null };
const db = vi.hoisted(() => ({
  kategorien: [] as Zeile[],
  euer: [] as Euer[],
  sql: [] as { sql: string; werte: unknown[] }[],
  protokoll: [] as unknown[][],
}));

vi.mock('../db', async (original) => ({
  ...(await original<typeof import('../db')>()),
  abfrage: vi.fn(async (sql: string, werte: unknown[] = []) => {
    if (sql.includes('FROM kategorien k')) return db.kategorien.map((k) => ({ buchungen: 0, ...k }));
    if (sql.includes('FROM euer_zuordnung')) return db.euer.filter((z) => !sql.includes('WHERE jahr') || z.jahr === werte[0]);
    throw new Error(`unerwartete Abfrage: ${sql}`);
  }),
  eine: vi.fn(async (sql: string, werte: unknown[] = []) => {
    if (sql.includes('FROM kategorien WHERE id')) return db.kategorien.find((k) => k.id === werte[0]) ?? null;
    if (sql.includes('FROM euer_zuordnung WHERE jahr = $1 AND kategorie_id = $2')) {
      const z = db.euer.find((x) => x.jahr === werte[0] && x.kategorie_id === werte[1]);
      return z ? { euer_bereich: z.euer_bereich, euer_zeile: z.euer_zeile } : null;
    }
    if (sql.includes('FROM euer_zuordnung WHERE jahr = $1 LIMIT 1')) return db.euer.find((z) => z.jahr === werte[0]) ?? null;
    throw new Error(`unerwartete Abfrage: ${sql}`);
  }),
  ausfuehren: vi.fn(async (sql: string, werte: unknown[] = []) => {
    db.sql.push({ sql, werte });
    const k = db.kategorien.find((x) => x.id === werte[0]);
    if (sql.startsWith('INSERT INTO protokoll')) {
      db.protokoll.push(werte);
      return { geaendert: 1, id: db.protokoll.length };
    }
    if (sql.startsWith('INSERT INTO kategorien')) {
      const id = Math.max(0, ...db.kategorien.map((x) => x.id)) + 1;
      const [name, typ, euer_bereich, abziehbar_prozent, zaehlt_ku_umsatz, wareneingang, stichworte, icon, farbe] = werte;
      db.kategorien.push({ id, name, typ: String(typ), euer_bereich, abziehbar_prozent, zaehlt_ku_umsatz, wareneingang, stichworte, icon, farbe, sortierung: id, archiviert: 0 });
      return { geaendert: 1, id };
    }
    if (sql.startsWith('UPDATE kategorien SET archiviert = 0')) {
      if (!k || k.archiviert === 0) return { geaendert: 0, id: null };
      k.archiviert = 0;
      return { geaendert: 1, id: null };
    }
    if (sql.startsWith('UPDATE kategorien SET archiviert = 1')) {
      const andere = db.kategorien.some((x) => k && x.typ === k.typ && x.archiviert === 0 && x.id !== k.id);
      if (!k || k.archiviert !== 0 || !andere) return { geaendert: 0, id: null };
      k.archiviert = 1;
      return { geaendert: 1, id: null };
    }
    if (sql.startsWith('UPDATE kategorien')) {
      const z = db.kategorien.find((x) => x.id === werte[8]);
      if (!z) return { geaendert: 0, id: null };
      const spalten = ['name', 'euer_bereich', 'abziehbar_prozent', 'zaehlt_ku_umsatz', 'wareneingang', 'stichworte', 'icon', 'farbe'];
      Object.assign(z, Object.fromEntries(spalten.map((s, i) => [s, werte[i]])));
      return { geaendert: 1, id: null };
    }
    if (sql.startsWith('INSERT INTO euer_zuordnung') && sql.includes('ON CONFLICT')) {
      const [jahr, kategorie_id, euer_bereich, euer_zeile] = werte as [number, number, string | null, number | null];
      db.euer = db.euer.filter((z) => !(z.jahr === jahr && z.kategorie_id === kategorie_id));
      db.euer.push({ jahr, kategorie_id, euer_bereich, euer_zeile });
      return { geaendert: 1, id: null };
    }
    if (sql.startsWith('INSERT INTO euer_zuordnung')) {
      const [jahr, quelle] = werte as [number, number | null];
      for (const kat of db.kategorien) {
        const q = db.euer.find((z) => z.jahr === quelle && z.kategorie_id === kat.id);
        db.euer.push({ jahr, kategorie_id: kat.id, euer_bereich: q?.euer_bereich ?? null, euer_zeile: q?.euer_zeile ?? null });
      }
      return { geaendert: db.kategorien.length, id: null };
    }
    throw new Error(`unerwarteter Befehl: ${sql}`);
  }),
}));

import { formularAus, neuesFormular, type Kategorie } from '../kategorien';
import {
  euerJahrProtokoll,
  kategorieAendern,
  kategorieAnlegen,
  kategorieSichtbar,
  ladeEuerZuordnung,
  ladeKategorien,
  legeEuerJahrAn,
  protokollFuerEuer,
  protokollFuerKategorie,
  speichereEuerZuordnung,
} from './kategorien';

const json = (t: unknown) => (typeof t === 'string' ? (JSON.parse(t) as unknown) : null);
/** Protokolleinträge als { tabelle, datensatz_id, aktion, alt, neu, schluessel } (Spalten wie protokollSql). */
const protokoll = () =>
  db.protokoll.map(([, tabelle, datensatz_id, aktion, alt, neu, schluessel]) => ({ tabelle, datensatz_id, aktion, alt: json(alt), neu: json(neu), schluessel }));
const befehle = () => db.sql.filter((s) => !s.sql.startsWith('INSERT INTO protokoll'));

beforeEach(() => {
  db.kategorien = [
    { id: 1, name: 'Dienstleistungen', typ: 'einnahme', euer_bereich: 'Betriebseinnahmen als Kleinunternehmer', abziehbar_prozent: 100, zaehlt_ku_umsatz: 1, wareneingang: 0, farbe: '#6366f1', icon: 'wrench', stichworte: 'rasen', sortierung: 1, archiviert: 0 },
    { id: 2, name: 'Produkte & Material', typ: 'ausgabe', euer_bereich: 'Waren, Roh- und Hilfsstoffe', abziehbar_prozent: 100, zaehlt_ku_umsatz: 0, wareneingang: 1, farbe: '#f59e0b', icon: 'box', stichworte: 'obi', sortierung: 2, archiviert: 0 },
    { id: 4, name: 'Sonstige Kosten', typ: 'ausgabe', euer_bereich: 'Übrige Betriebsausgaben', abziehbar_prozent: 100, zaehlt_ku_umsatz: 0, wareneingang: 0, farbe: '#a855f7', icon: 'ellipsis', stichworte: null, sortierung: 4, archiviert: 0, buchungen: 3 },
    { id: 6, name: 'Bewirtung', typ: 'ausgabe', euer_bereich: 'Bewirtungsaufwendungen', abziehbar_prozent: 70, zaehlt_ku_umsatz: 0, wareneingang: 0, farbe: '#ec4899', icon: 'utensils', stichworte: 'restaurant', sortierung: 6, archiviert: 1 },
  ];
  db.euer = [1, 2, 4, 6].map((kategorie_id) => ({ jahr: 2026, kategorie_id, euer_bereich: null, euer_zeile: null }));
  db.sql.length = 0;
  db.protokoll.length = 0;
});

const kategorie = async (id: number): Promise<Kategorie> => {
  const k = (await ladeKategorien()).find((x) => x.id === id);
  if (!k) throw new Error(`Kategorie ${id} fehlt`);
  return k;
};

describe('Kategorie anlegen', () => {
  it('prüft, legt sichtbar an und protokolliert die ganze Zeile', async () => {
    const f = { ...neuesFormular('ausgabe', await ladeKategorien()), name: ' Werkzeug (GWG) ', stichworte: 'Hilti, Makita' };
    const id = await kategorieAnlegen(f);
    expect(id).toBe(7);
    expect(befehle()[0].werte).toEqual(['Werkzeug (GWG)', 'ausgabe', 'Übrige Betriebsausgaben', 100, 0, 0, 'hilti,makita', 'tag', '#0ea5e9']);
    expect(protokoll()).toEqual([
      {
        tabelle: 'kategorien',
        datensatz_id: 7,
        aktion: 'neu',
        alt: null,
        neu: expect.objectContaining({ id: 7, name: 'Werkzeug (GWG)', archiviert: 0 }),
        schluessel: null,
      },
    ]);
  });

  it('ungültige Eingaben: Fehler, nichts geschrieben', async () => {
    const f = { ...neuesFormular('ausgabe', await ladeKategorien()), name: 'sonstige kosten' };
    await expect(kategorieAnlegen(f)).rejects.toThrow('„Sonstige Kosten“ gibt es schon.');
    expect(db.sql).toEqual([]);
  });
});

describe('Kategorie ändern', () => {
  it('schreibt alle Felder, protokolliert nur die geänderten', async () => {
    const f = { ...formularAus(await kategorie(4)), name: 'Sonstiges', abziehbar: '50' };
    expect(await kategorieAendern(4, f)).toBe(true);
    expect(befehle()[0].werte).toEqual(['Sonstiges', 'Übrige Betriebsausgaben', 50, 0, 0, null, 'ellipsis', '#a855f7', 4]);
    expect(protokoll()).toEqual([
      {
        tabelle: 'kategorien',
        datensatz_id: 4,
        aktion: 'geaendert',
        alt: { name: 'Sonstige Kosten', abziehbar_prozent: 100 },
        neu: { name: 'Sonstiges', abziehbar_prozent: 50 },
        schluessel: null,
      },
    ]);
  });

  it('ohne Änderung: nichts schreiben, nichts protokollieren', async () => {
    expect(await kategorieAendern(2, formularAus(await kategorie(2)))).toBe(false);
    expect(db.sql).toEqual([]);
  });

  it('die Art bleibt, unbekannte Kategorie wird gemeldet', async () => {
    await expect(kategorieAendern(2, { ...formularAus(await kategorie(2)), typ: 'einnahme' })).rejects.toThrow('Die Art lässt sich');
    await expect(kategorieAendern(99, formularAus(await kategorie(2)))).rejects.toThrow('Diese Kategorie gibt es nicht (mehr).');
    expect(db.sql).toEqual([]);
  });

  it('protokollFuerKategorie vergleicht nur die Formularspalten', async () => {
    const alt = await kategorie(1);
    const neu = { typ: 'einnahme' as const, name: 'Dienstleistungen', euer_bereich: 'Betriebseinnahmen als Kleinunternehmer', abziehbar_prozent: 100, zaehlt_ku_umsatz: 1, wareneingang: 0, stichworte: 'rasen', icon: 'wrench', farbe: '#6366f1' };
    expect(protokollFuerKategorie(alt, neu)).toBeNull();
    expect(protokollFuerKategorie(alt, { ...neu, stichworte: 'rasen,hecke' })).toEqual({
      tabelle: 'kategorien',
      datensatzId: 1,
      aktion: 'geaendert',
      alt: { stichworte: 'rasen' },
      neu: { stichworte: 'rasen,hecke' },
    });
  });
});

describe('Ein- und Ausblenden', () => {
  it('blendet aus und wieder ein, jeweils im Protokoll', async () => {
    expect(await kategorieSichtbar(4, false)).toBe(true);
    expect(await kategorieSichtbar(6, true)).toBe(true);
    expect(protokoll().map((p) => [p.datensatz_id, p.alt, p.neu])).toEqual([
      [4, { archiviert: 0 }, { archiviert: 1 }],
      [6, { archiviert: 1 }, { archiviert: 0 }],
    ]);
  });

  it('schon so: false ohne Protokoll; letzte sichtbare je Art: Fehler', async () => {
    expect(await kategorieSichtbar(6, false)).toBe(false);
    await expect(kategorieSichtbar(1, false)).rejects.toThrow('Mindestens eine Kategorie für Einnahmen');
    await kategorieSichtbar(2, false);
    await expect(kategorieSichtbar(4, false)).rejects.toThrow('Mindestens eine Kategorie für Ausgaben');
    await expect(kategorieSichtbar(99, true)).rejects.toThrow('Diese Kategorie gibt es nicht (mehr).');
    expect(protokoll()).toHaveLength(1);
  });
});

describe('EÜR-Zuordnung', () => {
  it('setzt nur die übergebenen Werte und protokolliert mit Jahr und Kategorie', async () => {
    expect(await speichereEuerZuordnung(2026, 4, { euer_zeile: 60 })).toBe(true);
    expect(await speichereEuerZuordnung(2026, 4, { euer_bereich: 'Sonstige Betriebsausgaben' })).toBe(true);
    expect(db.euer.find((z) => z.jahr === 2026 && z.kategorie_id === 4)).toEqual({
      jahr: 2026,
      kategorie_id: 4,
      euer_bereich: 'Sonstige Betriebsausgaben',
      euer_zeile: 60,
    });
    expect(await speichereEuerZuordnung(2026, 4, { euer_zeile: 60 })).toBe(false);
    expect(protokoll()).toEqual([
      { tabelle: 'euer_zuordnung', datensatz_id: 0, aktion: 'geaendert', alt: { kategorie_id: 4, euer_zeile: null }, neu: { kategorie_id: 4, euer_zeile: 60 }, schluessel: '2026' },
      {
        tabelle: 'euer_zuordnung',
        datensatz_id: 0,
        aktion: 'geaendert',
        alt: { kategorie_id: 4, euer_bereich: null },
        neu: { kategorie_id: 4, euer_bereich: 'Sonstige Betriebsausgaben' },
        schluessel: '2026',
      },
    ]);
  });

  it('neue Zeile (z. B. neue Kategorie) ⇒ Protokoll „neu“; leer bleibt leer', () => {
    expect(protokollFuerEuer(2026, 7, null, { euer_bereich: null, euer_zeile: null })).toBeNull();
    expect(protokollFuerEuer(2026, 7, null, { euer_bereich: null, euer_zeile: 33 })).toEqual({
      tabelle: 'euer_zuordnung',
      schluessel: '2026',
      aktion: 'neu',
      neu: { kategorie_id: 7, euer_bereich: null, euer_zeile: 33 },
    });
  });

  it('Jahr anlegen kopiert das Vorjahr für alle Kategorien und protokolliert es', async () => {
    db.euer.push({ jahr: 2025, kategorie_id: 1, euer_bereich: null, euer_zeile: 99 });
    await speichereEuerZuordnung(2026, 1, { euer_zeile: 11 });
    db.protokoll.length = 0;
    const zeilen = await legeEuerJahrAn(2027, 2026);
    expect(zeilen.map((z) => [z.kategorie_id, z.euer_zeile])).toEqual([
      [1, 11],
      [2, null],
      [4, null],
      [6, null],
    ]);
    expect(protokoll()).toEqual([
      {
        tabelle: 'euer_zuordnung',
        datensatz_id: 0,
        aktion: 'neu',
        alt: null,
        neu: euerJahrProtokoll(zeilen, 2026),
        schluessel: '2027',
      },
    ]);
    expect(euerJahrProtokoll(zeilen, 2026)).toMatchObject({ aus_jahr: 2026, zuordnung: { '1': { euer_bereich: null, euer_zeile: 11 } } });
    await expect(legeEuerJahrAn(2027, 2026)).rejects.toThrow('Für 2027 gibt es schon eine EÜR-Zuordnung.');
  });

  it('ladeEuerZuordnung: wirksame Zuordnung aller Kategorien eines Jahres', async () => {
    await speichereEuerZuordnung(2026, 4, { euer_bereich: 'Sonstige Betriebsausgaben', euer_zeile: 60 });
    const z = await ladeEuerZuordnung(2028);
    expect(z.map((x) => [x.kategorie_id, x.euer_bereich, x.euer_zeile, x.quelle])).toEqual([
      [1, 'Betriebseinnahmen als Kleinunternehmer', null, 2026],
      [2, 'Waren, Roh- und Hilfsstoffe', null, 2026],
      [4, 'Sonstige Betriebsausgaben', 60, 2026],
      [6, 'Bewirtungsaufwendungen', null, 2026],
    ]);
  });
});
