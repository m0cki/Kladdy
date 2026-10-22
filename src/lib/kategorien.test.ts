import { describe, expect, it } from 'vitest';
import {
  BEREICH_MAX,
  EUER_BEREICHE,
  ICON_NAMEN,
  KATEGORIE_FARBEN,
  KATEGORIE_ICONS,
  LETZTE_SICHTBARE,
  ausblendenFehler,
  ersterFehler,
  euerBereichLesen,
  euerJahre,
  euerKategorien,
  euerVorschlaege,
  euerZeileLesen,
  euerZuordnungFuer,
  formularAus,
  istKategorieIcon,
  kategoriePruefen,
  neuesFormular,
  standardBereich,
  stichworteLesen,
  stichworteText,
  type EuerZeile,
  type Kategorie,
  type KategorieFormular,
} from './kategorien';

const kat = (k: Partial<Kategorie> & Pick<Kategorie, 'id' | 'name' | 'typ'>): Kategorie => ({
  euer_bereich: null,
  abziehbar_prozent: 100,
  zaehlt_ku_umsatz: 0,
  wareneingang: 0,
  farbe: '#6366f1',
  icon: 'tag',
  stichworte: null,
  sortierung: k.id,
  archiviert: 0,
  buchungen: 0,
  ...k,
});

/** Wie nach den Migrationen (Standardset und Katalog, ohne AfA und Homeoffice), mit ein paar Buchungen. */
const ALLE: Kategorie[] = [
  kat({ id: 1, name: 'Dienstleistungen', typ: 'einnahme', euer_bereich: 'Betriebseinnahmen als Kleinunternehmer', zaehlt_ku_umsatz: 1, icon: 'wrench', stichworte: 'rasen,hecke', buchungen: 12 }),
  kat({ id: 2, name: 'Produkte & Material', typ: 'ausgabe', euer_bereich: 'Waren, Roh- und Hilfsstoffe', wareneingang: 1, farbe: '#f59e0b', icon: 'box' }),
  kat({ id: 3, name: 'Sprit & Fahrzeug', typ: 'ausgabe', euer_bereich: 'Kraftfahrzeugkosten', farbe: '#0ea5e9', icon: 'fuel' }),
  kat({ id: 4, name: 'Sonstige Kosten', typ: 'ausgabe', euer_bereich: 'Übrige Betriebsausgaben', farbe: '#a855f7', icon: 'ellipsis', buchungen: 3 }),
  kat({ id: 6, name: 'Bewirtung', typ: 'ausgabe', euer_bereich: 'Bewirtungsaufwendungen', abziehbar_prozent: 70, farbe: '#ec4899', icon: 'utensils', archiviert: 1 }),
  kat({ id: 7, name: 'Geschenke', typ: 'ausgabe', euer_bereich: 'Geschenke', farbe: '#10b981', icon: 'gift', archiviert: 1, buchungen: 2 }),
];

const formular = (teil: Partial<KategorieFormular> = {}): KategorieFormular => ({ ...neuesFormular('ausgabe', ALLE), name: 'Werkzeug (GWG)', ...teil });

describe('Stichworte', () => {
  it('trennt an Komma, Semikolon und Zeilenumbruch, klein und ohne Dubletten', () => {
    expect(stichworteLesen(' Aral, Shell ;diesel\n  ARAL ,  , Super  Plus')).toEqual(['aral', 'shell', 'diesel', 'super plus']);
    expect(stichworteLesen('')).toEqual([]);
  });

  it('zeigt gespeicherte Stichworte mit Leerzeichen', () => {
    expect(stichworteText('rasen,hecke')).toBe('rasen, hecke');
    expect(stichworteText(null)).toBe('');
  });
});

describe('Symbole und Farben', () => {
  it('kennt alle Symbole der Migrationen, jedes mit Namen', () => {
    expect(new Set(KATEGORIE_ICONS).size).toBe(KATEGORIE_ICONS.length);
    for (const i of ['wrench', 'box', 'fuel', 'ellipsis', 'trending-down', 'utensils', 'gift', 'house']) expect(istKategorieIcon(i)).toBe(true);
    for (const i of KATEGORIE_ICONS) expect(ICON_NAMEN[i]).toBeTruthy();
    expect(istKategorieIcon('dots')).toBe(false);
    expect(istKategorieIcon(null)).toBe(false);
  });

  it('Farben als Hex, eindeutig, mit allen Farben der Migrationen', () => {
    const werte = KATEGORIE_FARBEN.map((f) => f.wert);
    expect(new Set(werte).size).toBe(werte.length);
    for (const w of werte) expect(w).toMatch(/^#[0-9a-f]{6}$/);
    for (const w of ['#6366f1', '#f59e0b', '#0ea5e9', '#a855f7', '#64748b', '#ec4899', '#10b981', '#f97316']) expect(werte).toContain(w);
  });
});

describe('neue Kategorie', () => {
  it('Ausgabe: „Übrige Betriebsausgaben“, eine Farbe, die noch keine sichtbare Kategorie hat', () => {
    const f = neuesFormular('ausgabe', ALLE);
    expect(f).toMatchObject({ typ: 'ausgabe', name: '', euer_bereich: 'Übrige Betriebsausgaben', abziehbar: '100', ku: false, icon: 'tag' });
    // Indigo und Ozean sind vergeben, Smaragd hat nur die ausgeblendeten Geschenke
    expect(f.farbe).toBe('#10b981');
  });

  it('Einnahme: Bereich wie die vorhandene Einnahme-Kategorie, zählt zum KU-Umsatz', () => {
    expect(neuesFormular('einnahme', ALLE)).toMatchObject({ euer_bereich: 'Betriebseinnahmen als Kleinunternehmer', ku: true });
    expect(standardBereich('einnahme', [])).toBe(EUER_BEREICHE.einnahme[0]);
    expect(standardBereich('ausgabe', ALLE)).toBe('Übrige Betriebsausgaben');
  });

  it('schlägt zuerst die Bereiche vorhandener Kategorien vor, ohne Dubletten', () => {
    const v = euerVorschlaege('ausgabe', ALLE);
    expect(v.slice(0, 3)).toEqual(['Waren, Roh- und Hilfsstoffe', 'Kraftfahrzeugkosten', 'Übrige Betriebsausgaben']);
    expect(new Set(v).size).toBe(v.length);
    expect(euerVorschlaege('einnahme', ALLE)).toEqual(EUER_BEREICHE.einnahme);
  });
});

describe('kategoriePruefen', () => {
  it('liefert die Spaltenwerte', () => {
    const r = kategoriePruefen(formular({ name: '  Werkzeug   (GWG) ', stichworte: 'Hilti, Makita, hilti', abziehbar: '100 %' }), ALLE, null);
    expect(r).toEqual({
      ok: true,
      daten: {
        typ: 'ausgabe',
        name: 'Werkzeug (GWG)',
        euer_bereich: 'Übrige Betriebsausgaben',
        abziehbar_prozent: 100,
        zaehlt_ku_umsatz: 0,
        wareneingang: 0,
        stichworte: 'hilti,makita',
        icon: 'tag',
        farbe: '#10b981',
      },
    });
  });

  it('Name: Pflicht, je Art eindeutig (Groß/klein, Akzente, Leerzeichen egal)', () => {
    expect(kategoriePruefen(formular({ name: '  ' }), ALLE, null)).toMatchObject({ ok: false, fehler: { name: 'Bitte einen Namen eingeben.' } });
    expect(kategoriePruefen(formular({ name: 'sprit  &  FAHRZEUG' }), ALLE, null)).toMatchObject({ ok: false, fehler: { name: '„Sprit & Fahrzeug“ gibt es schon.' } });
    const aus = kategoriePruefen(formular({ name: 'Bewírtung' }), ALLE, null);
    expect(aus.ok ? '' : aus.fehler.name).toContain('ausgeblendet');
    expect(kategoriePruefen(formular({ name: 'x'.repeat(41) }), ALLE, null).ok).toBe(false);
    // gleicher Name bei der anderen Art ist erlaubt
    expect(kategoriePruefen({ ...neuesFormular('einnahme', ALLE), name: 'Sonstige Kosten' }, ALLE, null).ok).toBe(true);
  });

  it('Bearbeiten: eigener Name bleibt erlaubt, die Art steht fest', () => {
    const sprit = ALLE[2];
    expect(kategoriePruefen(formularAus(sprit), ALLE, sprit)).toMatchObject({ ok: true, daten: { name: 'Sprit & Fahrzeug', icon: 'fuel', farbe: '#0ea5e9' } });
    expect(kategoriePruefen({ ...formularAus(sprit), typ: 'einnahme' }, ALLE, sprit)).toMatchObject({
      ok: false,
      fehler: { typ: 'Die Art lässt sich nach dem Anlegen nicht mehr ändern.' },
    });
  });

  it('abziehbarer Anteil nur bei Ausgaben, ganze Prozent bis 100', () => {
    expect(kategoriePruefen(formular({ abziehbar: '70 %' }), ALLE, null)).toMatchObject({ ok: true, daten: { abziehbar_prozent: 70 } });
    expect(kategoriePruefen(formular({ abziehbar: '0' }), ALLE, null)).toMatchObject({ ok: true, daten: { abziehbar_prozent: 0 } });
    for (const a of ['101', '7,5', '', '-5']) expect(kategoriePruefen(formular({ abziehbar: a }), ALLE, null).ok).toBe(false);
    const einnahme = { ...neuesFormular('einnahme', ALLE), name: 'Verkauf', abziehbar: 'egal' };
    expect(kategoriePruefen(einnahme, ALLE, null)).toMatchObject({ ok: true, daten: { abziehbar_prozent: 100 } });
  });

  it('KU-Umsatz nur bei Einnahmen, Wareneingangsbuch nur bei Ausgaben', () => {
    expect(kategoriePruefen(formular({ ku: true, wareneingang: true }), ALLE, null)).toMatchObject({
      ok: true,
      daten: { zaehlt_ku_umsatz: 0, wareneingang: 1 },
    });
    const einnahme = { ...neuesFormular('einnahme', ALLE), name: 'Verkauf', ku: true, wareneingang: true };
    expect(kategoriePruefen(einnahme, ALLE, null)).toMatchObject({ ok: true, daten: { zaehlt_ku_umsatz: 1, wareneingang: 0 } });
  });

  it('EÜR-Bereich Pflicht, Stichworte begrenzt, Symbol und Farbe aus der Auswahl', () => {
    const r = kategoriePruefen(formular({ euer_bereich: ' ', stichworte: 'x'.repeat(31), icon: 'rakete', farbe: 'rot' }), ALLE, null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.fehler).sort()).toEqual(['euer_bereich', 'farbe', 'icon', 'stichworte']);
    expect(ersterFehler(r.fehler)).toBe(r.fehler.euer_bereich);
    expect(kategoriePruefen(formular({ euer_bereich: 'x'.repeat(BEREICH_MAX + 1) }), ALLE, null).ok).toBe(false);
    expect(kategoriePruefen(formular({ stichworte: Array.from({ length: 41 }, (_, i) => `w${i}`).join(',') }), ALLE, null).ok).toBe(false);
    // kurze Stichworte wie „o2“ sind erlaubt (Standardset), Farbe wird klein gespeichert
    expect(kategoriePruefen(formular({ stichworte: 'o2', farbe: '#10B981' }), ALLE, null)).toMatchObject({ ok: true, daten: { stichworte: 'o2', farbe: '#10b981' } });
  });

  it('ein unbekanntes Symbol, das die Kategorie schon hatte, bleibt erlaubt', () => {
    const alt = kat({ id: 9, name: 'Alt', typ: 'ausgabe', euer_bereich: 'Übrige Betriebsausgaben', icon: 'rakete' });
    expect(kategoriePruefen(formularAus(alt), [...ALLE, alt], alt).ok).toBe(true);
    expect(formularAus({ ...alt, icon: null, farbe: null })).toMatchObject({ icon: 'tag', farbe: KATEGORIE_FARBEN[0].wert });
  });
});

describe('ausblenden', () => {
  it('je Art bleibt mindestens eine Kategorie sichtbar', () => {
    expect(ausblendenFehler(ALLE[0], ALLE)).toBe(LETZTE_SICHTBARE.einnahme);
    expect(ausblendenFehler(ALLE[3], ALLE)).toBeNull();
    const nurNochSonstige = ALLE.map((k) => (k.id === 2 || k.id === 3 ? { ...k, archiviert: 1 } : k));
    expect(ausblendenFehler(ALLE[3], nurNochSonstige)).toBe(LETZTE_SICHTBARE.ausgabe);
  });
});

describe('EÜR-Zuordnung pro Jahr', () => {
  const zeilen: EuerZeile[] = [
    { jahr: 2027, kategorie_id: 1, euer_bereich: null, euer_zeile: 12 },
    { jahr: 2026, kategorie_id: 1, euer_bereich: null, euer_zeile: 11 },
    { jahr: 2026, kategorie_id: 4, euer_bereich: 'Sonstige unbeschränkt abziehbare Betriebsausgaben', euer_zeile: 60 },
  ];
  const fuer = (jahr: number, id: number, z: readonly EuerZeile[] = zeilen) => euerZuordnungFuer(jahr, ALLE, z).find((x) => x.kategorie_id === id);

  it('Jahre aufsteigend', () => {
    expect(euerJahre(zeilen)).toEqual([2026, 2027]);
    expect(euerJahre([])).toEqual([]);
  });

  it('eigener Bereich des Jahres, sonst der der Kategorie; Zeile des Jahres', () => {
    expect(fuer(2026, 1)).toEqual({
      kategorie_id: 1,
      name: 'Dienstleistungen',
      typ: 'einnahme',
      ausgeblendet: false,
      euer_bereich: 'Betriebseinnahmen als Kleinunternehmer',
      euer_zeile: 11,
      quelle: 2026,
      eigener_bereich: false,
    });
    expect(fuer(2026, 4)).toMatchObject({ euer_bereich: 'Sonstige unbeschränkt abziehbare Betriebsausgaben', euer_zeile: 60, eigener_bereich: true });
    expect(fuer(2026, 2)).toMatchObject({ euer_bereich: 'Waren, Roh- und Hilfsstoffe', euer_zeile: null, eigener_bereich: false });
    // 2027 hat eine eigene Zuordnung: was dort fehlt, gilt wie die Kategorie (nicht aus 2026)
    expect(fuer(2027, 1)).toMatchObject({ euer_zeile: 12, quelle: 2027 });
    expect(fuer(2027, 4)).toMatchObject({ euer_bereich: 'Übrige Betriebsausgaben', euer_zeile: null, eigener_bereich: false });
  });

  it('Jahr ohne Zuordnung: die des nächstälteren, sonst des ältesten Jahres', () => {
    expect(fuer(2030, 1)).toMatchObject({ euer_zeile: 12, quelle: 2027 });
    expect(fuer(2025, 4)).toMatchObject({ euer_zeile: 60, quelle: 2026, eigener_bereich: true });
    expect(fuer(2026, 1, [])).toMatchObject({ euer_bereich: 'Betriebseinnahmen als Kleinunternehmer', euer_zeile: null, quelle: null });
  });

  it('enthält auch ausgeblendete Kategorien (alte Buchungen zählen weiter)', () => {
    expect(euerZuordnungFuer(2026, ALLE, zeilen)).toHaveLength(ALLE.length);
    expect(fuer(2026, 6)).toMatchObject({ ausgeblendet: true, euer_bereich: 'Bewirtungsaufwendungen' });
    // Tabelle in den Einstellungen: sichtbare und ausgeblendete mit Buchungen
    expect(euerKategorien(ALLE).map((k) => k.id)).toEqual([1, 2, 3, 4, 7]);
  });

  it('liest die Eingaben', () => {
    expect(euerBereichLesen('  ', 'Kraftfahrzeugkosten')).toEqual({ wert: null });
    expect(euerBereichLesen(' Kraftfahrzeugkosten ', 'Kraftfahrzeugkosten')).toEqual({ wert: null });
    expect(euerBereichLesen('Fahrtkosten  Kfz', 'Kraftfahrzeugkosten')).toEqual({ wert: 'Fahrtkosten Kfz' });
    expect(euerBereichLesen('x'.repeat(BEREICH_MAX + 1), null)).toHaveProperty('fehler');
    expect(euerZeileLesen('')).toEqual({ wert: null });
    expect(euerZeileLesen(' 27 ')).toEqual({ wert: 27 });
    for (const z of ['0', '1000', '2a', '-3', '1,5']) expect(euerZeileLesen(z)).toHaveProperty('fehler');
  });
});
