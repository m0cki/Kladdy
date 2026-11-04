import { describe, expect, it } from 'vitest';
import { STANDARD_NAME } from './baukasten';
import {
  type EigeneVorlage,
  NAME_MAX,
  aktiverSchluessel,
  designName,
  eigeneId,
  eigenSchluessel,
  freierName,
  istWaehlbar,
  nameBereinigen,
  namePruefen,
  vergebeneNamen,
  waehlbar,
  wahlFinden,
  wahlListe,
  wahlName,
} from './eigene';

const v = (id: number, name: string, extra: Partial<EigeneVorlage> = {}): EigeneVorlage => ({
  id,
  name,
  art: 'quittung',
  basis: 'klassisch',
  bausteine: [{ typ: 'quittung_felder' }],
  archiviert: false,
  ...extra,
});

describe('Schlüssel', () => {
  it('eigen:<id> hin und zurück, alles andere ist keine eigene Vorlage', () => {
    expect(eigenSchluessel(12)).toBe('eigen:12');
    expect(eigeneId('eigen:12')).toBe(12);
    for (const x of ['klassisch', 'eigen:', 'eigen:0', 'eigen:-3', 'eigen:1.5', 'eigen:012', 'eigen:abc', 12, null, undefined]) expect(eigeneId(x)).toBeNull();
  });

  it('wählbar: Designs der Art und nicht entfernte eigene', () => {
    const eigene = [v(1, 'A'), v(2, 'B', { archiviert: true })];
    expect(istWaehlbar('quittung', 'formular', eigene)).toBe(true);
    expect(istWaehlbar('rechnung', 'formular', eigene)).toBe(false);
    expect(istWaehlbar('quittung', 'eigen:1', eigene)).toBe(true);
    expect(istWaehlbar('quittung', 'eigen:2', eigene)).toBe(false);
    expect(istWaehlbar('quittung', 'eigen:9', eigene)).toBe(false);
  });

  it('aktiver Schlüssel: Ungültiges fällt auf das Design zurück', () => {
    const eigene = [v(1, 'A'), v(2, 'B', { archiviert: true })];
    expect(aktiverSchluessel('quittung', 'eigen:1', eigene)).toBe('eigen:1');
    expect(aktiverSchluessel('quittung', 'eigen:2', eigene)).toBe('klassisch');
    expect(aktiverSchluessel('quittung', 'formular', eigene)).toBe('formular');
    expect(aktiverSchluessel('quittung', undefined, eigene)).toBe('klassisch');
    expect(aktiverSchluessel('rechnung', 'formular', [])).toBe('klassisch');
  });
});

describe('Liste der Vorlagen', () => {
  it('Designs zuerst, dann eigene nach Name, entfernte zuletzt; genau eine aktiv', () => {
    const eigene = [v(3, 'zebra'), v(4, 'Alt', { archiviert: true }), v(5, 'Äpfel', { basis: 'formular' }), v(6, 'Fremd', { art: 'rechnung' })];
    const l = wahlListe('quittung', eigene, 'eigen:5');
    expect(l.map((x) => x.schluessel)).toEqual(['klassisch', 'formular', 'eigen:5', 'eigen:3', 'eigen:4']);
    expect(l.filter((x) => x.aktiv).map((x) => x.schluessel)).toEqual(['eigen:5']);
    expect(l.find((x) => x.id === 5)?.design).toBe('formular');
    expect(l.find((x) => x.id === 4)?.archiviert).toBe(true);
    expect(l[0].id).toBeNull();
    expect(l[0].bausteine.length).toBeGreaterThan(0);
  });

  it('Name eines Designs: „Standardvorlage“, wenn die Art nur eins hat', () => {
    expect(designName('rechnung', 'klassisch')).toBe(STANDARD_NAME);
    expect(designName('quittung', 'formular')).toBe('Formular');
    expect(designName('quittung', 'gibtsnicht')).toBe('Klassisch');
  });

  it('wahlFinden: eigene über die ID, sonst das Design; fehlende ID ⇒ Design', () => {
    const l = wahlListe('quittung', [v(3, 'A', { basis: 'formular' })], 'klassisch');
    expect(wahlFinden(l, { id: 3, design: 'formular' })?.schluessel).toBe('eigen:3');
    expect(wahlFinden(l, { id: 99, design: 'formular' })?.schluessel).toBe('formular');
    expect(wahlFinden(l, { id: null })?.schluessel).toBe('klassisch');
    expect(wahlFinden(l, { id: null, design: 'weg' })).toBeUndefined();
    expect(wahlFinden(l, null)).toBeUndefined();
  });

  it('Auswahl zeigt entfernte nur, wenn sie gewählt sind, mit Zusatz', () => {
    const l = wahlListe('quittung', [v(3, 'A'), v(4, 'Alt', { archiviert: true })], 'klassisch');
    expect(waehlbar(l).map((x) => x.schluessel)).toEqual(['klassisch', 'formular', 'eigen:3']);
    const alt = l.find((x) => x.id === 4)!;
    expect(waehlbar(l, alt).map((x) => x.schluessel)).toContain('eigen:4');
    expect(wahlName(alt)).toBe('Alt (entfernt)');
    expect(wahlName(l[0])).toBe('Klassisch');
  });
});

describe('Namen', () => {
  it('bereinigen und prüfen', () => {
    expect(nameBereinigen('  Quittung \n  Garten ')).toBe('Quittung Garten');
    const vergeben = ['Klassisch', 'Formular', 'Meine Quittung'];
    expect(namePruefen('   ', vergeben)).toBe('Bitte einen Namen eingeben.');
    expect(namePruefen('x'.repeat(NAME_MAX + 1), vergeben)).toBe(`Höchstens ${NAME_MAX} Zeichen.`);
    expect(namePruefen('meine quittung', vergeben)).toBe('„meine quittung“ gibt es schon.');
    expect(namePruefen('klassisch', vergeben)).not.toBeNull();
    expect(namePruefen('Quittung Garten', vergeben)).toBeNull();
  });

  it('freier Name zählt hoch', () => {
    expect(freierName('Meine Quittung', [])).toBe('Meine Quittung');
    expect(freierName('Meine Quittung', ['meine quittung'])).toBe('Meine Quittung 2');
    expect(freierName('Meine Quittung', ['Meine Quittung', 'Meine Quittung 2'])).toBe('Meine Quittung 3');
  });

  it('vergebene Namen: Designs und nicht entfernte eigene, ohne die umbenannte', () => {
    const eigene = [v(1, 'A'), v(2, 'B', { archiviert: true }), v(3, 'C')];
    expect(vergebeneNamen('quittung', eigene)).toEqual(['Klassisch', 'Formular', 'A', 'C']);
    expect(vergebeneNamen('quittung', eigene, 3)).toEqual(['Klassisch', 'Formular', 'A']);
    expect(vergebeneNamen('rechnung', [])).toEqual([STANDARD_NAME]);
  });
});
