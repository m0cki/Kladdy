import { describe, expect, it } from 'vitest';
import { BAUSTEINE, type Baustein } from './bausteine';
import {
  EIGENER_NAME,
  einfuegen,
  einstellen,
  entfernen,
  erlaubteTypen,
  nurErlaubte,
  platzhalterEinfuegen,
  stelleAusMitten,
  umschalten,
  verschieben,
  ziehen,
  ziehenAendert,
  zurueckEinfuegen,
  zusammenfassung,
} from './baukasten';
import { BEISPIEL_FIRMA, beispielbeleg } from './beispiel';
import { BELEGARTEN } from './dokument';
import { pflichtCheck, pflichtOk } from './pflicht';
import { standardVorlage } from './standard';

const L: Baustein[] = [{ typ: 'titel' }, { typ: 'positionen' }, { typ: 'summe' }, { typ: 'gruss' }];
const typen = (liste: readonly Baustein[]) => liste.map((b) => b.typ);

describe('Bausteine je Art', () => {
  it('Palette: nur passende Bausteine, in Katalog-Reihenfolge', () => {
    expect(erlaubteTypen('quittung')).toContain('quittung_felder');
    expect(erlaubteTypen('quittung')).not.toContain('zahlung');
    expect(erlaubteTypen('quittung')).not.toContain('eigenbeleg_felder');
    expect(erlaubteTypen('eigenbeleg')).not.toContain('datenschutz');
    expect(erlaubteTypen('rechnung')).toContain('zahlung');
    expect(erlaubteTypen('rechnung')[0]).toBe('kopf');
    for (const art of BELEGARTEN) for (const t of erlaubteTypen(art)) expect(BAUSTEINE[t].arten).toContain(art);
  });
  it('nurErlaubte entfernt Fremdes', () => {
    expect(typen(nurErlaubte([{ typ: 'titel' }, { typ: 'zahlung' }, { typ: 'quittung_felder' }], 'quittung'))).toEqual(['titel', 'quittung_felder']);
  });
  it('Standardvorlagen enthalten nur erlaubte Bausteine', () => {
    for (const art of BELEGARTEN) expect(nurErlaubte(standardVorlage(art), art)).toEqual(standardVorlage(art));
  });
  it('Namen der eigenen Kopie', () => {
    expect(EIGENER_NAME.rechnung).toBe('Meine Rechnung');
    expect(EIGENER_NAME.angebot).toBe('Mein Angebot');
  });
});

describe('Bearbeiten', () => {
  it('einfügen unter dem ausgewählten, sonst ans Ende', () => {
    expect(einfuegen(L, 'trennlinie', 1)).toEqual({ liste: [L[0], L[1], { typ: 'trennlinie' }, L[2], L[3]], index: 2 });
    expect(einfuegen(L, 'trennlinie', null).index).toBe(4);
    expect(einfuegen([], 'titel', 0)).toEqual({ liste: [{ typ: 'titel' }], index: 0 });
    expect(einfuegen(L, 'abstand', 99).index).toBe(4);
    expect(L).toHaveLength(4); // Original unverändert
  });
  it('entfernen hält die Auswahl auf demselben Baustein', () => {
    const r = entfernen(L, 1, 3);
    expect(typen(r.liste)).toEqual(['titel', 'summe', 'gruss']);
    expect(r.weg).toEqual({ typ: 'positionen' });
    expect(r.auswahl).toBe(2); // „gruss“ rückt nach oben
    expect(entfernen(L, 3, 3).auswahl).toBe(2); // ausgewählter letzter weg ⇒ neuer letzter
    expect(entfernen(L, 2, 0).auswahl).toBe(0);
    expect(entfernen([{ typ: 'titel' }], 0, 0)).toEqual({ liste: [], weg: { typ: 'titel' }, auswahl: 0 });
    expect(entfernen(L, 7, 1)).toEqual({ liste: L, weg: null, auswahl: 1 });
  });
  it('Rückgängig setzt an die alte Stelle zurück', () => {
    const { liste, weg } = entfernen(L, 1, 0);
    expect(zurueckEinfuegen(liste, 1, weg!)).toEqual({ liste: L, index: 1 });
    expect(zurueckEinfuegen([], 5, { typ: 'titel' })).toEqual({ liste: [{ typ: 'titel' }], index: 0 });
  });
  it('Auge: ausblenden und wieder einblenden (ohne Rest)', () => {
    const aus = umschalten(L, 2);
    expect(aus[2]).toEqual({ typ: 'summe', aus: true });
    expect(umschalten(aus, 2)[2]).toEqual({ typ: 'summe' });
    expect(L[2]).toEqual({ typ: 'summe' });
  });
  it('Einstellung setzen, aber nie typ/aus', () => {
    const r = einstellen(L, 0, 'text', '{art} {nr}');
    expect(r[0]).toEqual({ typ: 'titel', text: '{art} {nr}' });
    expect(einstellen(L, 0, 'linie', true)[0]).toEqual({ typ: 'titel', linie: true });
    expect(einstellen(L, 0, 'typ', 'kopf')).toEqual(L);
    expect(L[0]).toEqual({ typ: 'titel' });
  });
});

describe('Sortieren', () => {
  it('↑/↓ tauscht mit dem Nachbarn, am Rand nichts', () => {
    expect(verschieben(L, 1, -1)).toEqual({ liste: [L[1], L[0], L[2], L[3]], index: 0 });
    expect(verschieben(L, 1, 1)).toEqual({ liste: [L[0], L[2], L[1], L[3]], index: 2 });
    expect(verschieben(L, 0, -1)).toEqual({ liste: L, index: 0 });
    expect(verschieben(L, 3, 1)).toEqual({ liste: L, index: 3 });
  });
  it('Ziehen an eine Einfügestelle', () => {
    expect(typen(ziehen(L, 0, 4).liste)).toEqual(['positionen', 'summe', 'gruss', 'titel']);
    expect(ziehen(L, 0, 4).index).toBe(3);
    expect(typen(ziehen(L, 3, 0).liste)).toEqual(['gruss', 'titel', 'positionen', 'summe']);
    expect(ziehen(L, 3, 0).index).toBe(0);
    expect(ziehen(L, 1, 3)).toEqual({ liste: [L[0], L[2], L[1], L[3]], index: 2 });
    expect(ziehen(L, 1, 1)).toEqual({ liste: L, index: 1 });
    expect(ziehen(L, 1, 2)).toEqual({ liste: L, index: 1 });
  });
  it('vor oder hinter sich selbst ändert nichts', () => {
    expect(ziehenAendert(1, 1)).toBe(false);
    expect(ziehenAendert(1, 2)).toBe(false);
    expect(ziehenAendert(1, 0)).toBe(true);
    expect(ziehenAendert(1, 3)).toBe(true);
  });
  it('Einfügestelle aus der Zeigerhöhe', () => {
    const mitten = [20, 60, 100];
    expect(stelleAusMitten(mitten, 5)).toBe(0);
    expect(stelleAusMitten(mitten, 30)).toBe(1);
    expect(stelleAusMitten(mitten, 99)).toBe(2);
    expect(stelleAusMitten(mitten, 140)).toBe(3);
    expect(stelleAusMitten([], 10)).toBe(0);
  });
});

describe('Platzhalter und Kurzinfo', () => {
  it('an der Schreibmarke einfügen, Markierung ersetzen, sonst ans Ende', () => {
    expect(platzhalterEinfuegen('Hallo !', 6, 6, 'kunde')).toEqual({ text: 'Hallo {kunde}!', cursor: 13 });
    expect(platzhalterEinfuegen('Hallo Welt', 6, 10, 'kunde')).toEqual({ text: 'Hallo {kunde}', cursor: 13 });
    expect(platzhalterEinfuegen('Nr. ', null, null, 'nr')).toEqual({ text: 'Nr. {nr}', cursor: 8 });
    expect(platzhalterEinfuegen('', 5, 9, 'nr')).toEqual({ text: '{nr}', cursor: 4 });
  });
  it('Kurzinfo: erster gefüllter Text, sonst die Beschreibung', () => {
    expect(zusammenfassung({ typ: 'gruss' })).toBe('Mit freundlichen Grüßen · {inhaber}');
    expect(zusammenfassung({ typ: 'text', text: '' })).toBe(BAUSTEINE.text.beschreibung);
    expect(zusammenfassung({ typ: 'titel', text: '', rechts: 'Nr. {nr}' })).toBe('Nr. {nr}');
    expect(zusammenfassung({ typ: 'positionen' })).toBe(BAUSTEINE.positionen.beschreibung);
  });
});

describe('Beispielbeleg der Vorlagen-Seite', () => {
  it('Standardvorlagen erfüllen mit Beispieldaten alle Pflichtangaben', () => {
    for (const art of BELEGARTEN) {
      const doc = beispielbeleg(art, BEISPIEL_FIRMA, 'klein', '2026-10-22');
      expect(doc.art).toBe(art);
      expect(doc.nummer).toBeNull();
      expect(pflichtOk(pflichtCheck(doc, standardVorlage(art)))).toBe(true);
    }
  });
  it('ohne „Steuerhinweis (§ 19)“ wird es sofort rot', () => {
    const doc = beispielbeleg('rechnung', BEISPIEL_FIRMA, 'klein', '2026-10-22');
    const ohne = entfernen(standardVorlage('rechnung'), standardVorlage('rechnung').findIndex((b) => b.typ === 'steuerhinweis'), 0).liste;
    const fehlt = pflichtCheck(doc, ohne).filter((p) => !p.ok);
    expect(fehlt.map((p) => p.label)).toEqual(['Entgelt und § 19-Hinweis']);
    expect(fehlt[0].hint).toBe('Baustein „Steuerhinweis (§ 19)“ fehlt');
    // ausgeblendet zählt wie entfernt
    const aus = umschalten(standardVorlage('rechnung'), standardVorlage('rechnung').findIndex((b) => b.typ === 'steuerhinweis'));
    expect(pflichtOk(pflichtCheck(doc, aus))).toBe(false);
  });
  it('Fälligkeit: Rechnung 14 Tage, Angebot 30 Tage gültig', () => {
    expect(beispielbeleg('rechnung', BEISPIEL_FIRMA, 'klein', '2026-10-22').faellig_am).toBe('2026-11-05');
    expect(beispielbeleg('angebot', BEISPIEL_FIRMA, 'klein', '2026-10-22').faellig_am).toBe('2026-11-21');
  });
});
