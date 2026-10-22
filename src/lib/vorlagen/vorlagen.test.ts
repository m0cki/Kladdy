import { describe, expect, it } from 'vitest';
import { BAUSTEINE, BAUSTEIN_TYPEN, aufloesen, bausteineAusJson, istUnten, sichtbare } from './bausteine';
import { BEISPIEL_FIRMA, firmaOderBeispiel, testbeleg } from './beispiel';
import {
  ARTEN,
  BELEGARTEN,
  belegSumme,
  datumText,
  empfaenger,
  ersetzen,
  formatVon,
  istEntwurf,
  leistungLabel,
  leistungText,
  mengeText,
  platzhalterWerte,
  positionBetrag,
  zerlegen,
} from './dokument';
import { belegAkzent } from './farbe';
import { STANDARD_VORLAGEN, standardVorlage } from './standard';

const rechnung = () => testbeleg('rechnung', BEISPIEL_FIRMA, 'klein', '2026-10-18');
const quittung = () => testbeleg('quittung', BEISPIEL_FIRMA, 'klein', '2026-10-18');

describe('Positionen rechnen (Integer-Cent)', () => {
  it('Menge × Einzelpreis, kaufmännisch gerundet', () => {
    expect(positionBetrag({ menge: 3, einzelpreis_cent: 4500 })).toBe(13500);
    expect(positionBetrag({ menge: 2.5, einzelpreis_cent: 399 })).toBe(998); // 997,5 ⇒ 998
    expect(positionBetrag({ menge: 0.333, einzelpreis_cent: 100 })).toBe(33);
    expect(positionBetrag({ menge: 1.5, einzelpreis_cent: 1 })).toBe(2);
    expect(positionBetrag({ menge: -1.5, einzelpreis_cent: 1 })).toBe(-2);
    expect(positionBetrag({ menge: 0, einzelpreis_cent: 999 })).toBe(0);
  });
  it('Float-Mengen ohne Rundungsfehler (0,1 + 0,2)', () => {
    expect(positionBetrag({ menge: 0.1 + 0.2, einzelpreis_cent: 1000 })).toBe(300);
  });
  it('Cent müssen Ganzzahlen sein', () => {
    expect(() => positionBetrag({ menge: 1, einzelpreis_cent: 1.5 })).toThrow();
  });
  it('Summe des Testbelegs', () => {
    expect(belegSumme(rechnung())).toBe(13500 + 1800 + 998);
  });
  it('Menge deutsch formatiert', () => {
    expect(mengeText(2.5)).toBe('2,5');
    expect(mengeText(1000)).toBe('1.000');
    expect(mengeText(-1)).toBe('−1');
  });
});

describe('Anzeige', () => {
  it('Datum und Leistungszeitraum', () => {
    expect(datumText('2026-03-07')).toBe('07.03.2026');
    expect(datumText(null)).toBe('');
    const d = rechnung();
    expect(leistungLabel(d)).toBe('Leistungszeitraum');
    expect(leistungText(d)).toBe('12.10.–18.10.2026');
    expect(leistungLabel({ leistung_von: '2026-10-18', leistung_bis: null })).toBe('Leistungsdatum');
  });
  it('Quittung ohne Kunde ⇒ Barverkauf', () => {
    const q = { ...quittung(), kunde: null };
    expect(empfaenger(q).anzeige).toBe('Barverkauf');
    expect(empfaenger(q).name).toBe('');
  });
  it('Entwurf = ohne Nummer und nicht storniert', () => {
    expect(istEntwurf(rechnung())).toBe(true);
    expect(istEntwurf({ nummer: 'RE-2026-0001', storniert: false })).toBe(false);
  });
});

describe('Platzhalter', () => {
  it('zerlegen erkennt nur bekannte Namen', () => {
    expect(zerlegen('Hallo {kunde}, {unbekannt}!')).toEqual([
      { art: 'text', text: 'Hallo ' },
      { art: 'platzhalter', name: 'kunde' },
      { art: 'text', text: ', ' },
      { art: 'text', text: '{unbekannt}' },
      { art: 'text', text: '!' },
    ]);
  });
  it('ersetzen: Werte einsetzen, leere Nummer ⇒ „Entwurf“', () => {
    const w = platzhalterWerte(rechnung());
    expect(ersetzen('{art} {nr}', w)).toBe('Rechnung Entwurf');
    expect(ersetzen('{kunde} · {summe}', w)).toBe('Müller & Söhne 100% · 162,98 €');
    expect(ersetzen('Mit freundlichen Grüßen\n{inhaber}', w)).toBe('Mit freundlichen Grüßen\nMax Mustermann');
    expect(ersetzen('{zahlungsziel} Tage', w)).toBe('14 Tage');
  });
  it('ersetzen: leere Werte am Rand hinterlassen keine Leerzeilen', () => {
    const w = { ...platzhalterWerte(rechnung()), einleitung: '' };
    expect(ersetzen('Guten Tag,\n{einleitung}', w)).toBe('Guten Tag,');
  });
});

describe('Bausteine', () => {
  it('Katalog vollständig, Typen eindeutig', () => {
    expect(new Set(BAUSTEIN_TYPEN).size).toBe(BAUSTEIN_TYPEN.length);
    for (const t of BAUSTEIN_TYPEN) expect(BAUSTEINE[t].name).toBeTruthy();
  });
  it('Standardwerte greifen, eigene Werte gewinnen', () => {
    const b = aufloesen({ typ: 'summe' });
    expect(b.text('label')).toBe('Gesamtbetrag');
    expect(aufloesen({ typ: 'summe', label: 'Summe' }).text('label')).toBe('Summe');
    expect(aufloesen({ typ: 'fusszeile' }).an('bank')).toBe(true);
    expect(aufloesen({ typ: 'fusszeile', bank: false }).an('bank')).toBe(false);
  });
  it('ausgeblendete Bausteine fallen weg, Index bleibt', () => {
    const s = sichtbare([{ typ: 'titel' }, { typ: 'betreff', aus: true }, { typ: 'gruss' }]);
    expect(s.map((x) => [x.index, x.b.typ])).toEqual([
      [0, 'titel'],
      [2, 'gruss'],
    ]);
  });
  it('Fußzeile und Unterschrift „unten“ sitzen am Blattende', () => {
    expect(istUnten(aufloesen({ typ: 'fusszeile' }))).toBe(true);
    expect(istUnten(aufloesen({ typ: 'unterschrift', unten: true }))).toBe(true);
    expect(istUnten(aufloesen({ typ: 'unterschrift', unten: false }))).toBe(false);
    expect(istUnten(aufloesen({ typ: 'text' }))).toBe(false);
  });
  it('bausteineAusJson verwirft Unbekanntes', () => {
    const json = JSON.stringify([{ typ: 'titel', text: 'X', zahl: 3 }, { typ: 'gibtsnicht' }, null, 'x', { typ: 'gruss', aus: true }]);
    expect(bausteineAusJson(json)).toEqual([{ typ: 'titel', text: 'X' }, { typ: 'gruss', aus: true }]);
    expect(bausteineAusJson('kein json')).toEqual([]);
    expect(bausteineAusJson({})).toEqual([]);
  });
});

describe('Standardvorlagen (im Code)', () => {
  it('für jede Belegart, Format passend', () => {
    for (const art of BELEGARTEN) expect(STANDARD_VORLAGEN[art].length).toBeGreaterThan(0);
    expect(formatVon('rechnung')).toBe('a4');
    expect(formatVon('angebot')).toBe('a4');
    expect(formatVon('quittung')).toBe('a5q');
    expect(formatVon('eigenbeleg')).toBe('a5q');
  });
  it('nur Bausteine, die zur Belegart passen', () => {
    for (const art of BELEGARTEN) for (const b of STANDARD_VORLAGEN[art]) expect(BAUSTEINE[b.typ].arten, `${art}/${b.typ}`).toContain(art);
  });
  it('Rechnung und Quittung drucken den § 19-Hinweis, die Quittung den Inhaber', () => {
    expect(STANDARD_VORLAGEN.rechnung.some((b) => b.typ === 'steuerhinweis')).toBe(true);
    expect(STANDARD_VORLAGEN.quittung.some((b) => b.typ === 'steuerhinweis')).toBe(true);
    expect(STANDARD_VORLAGEN.quittung.some((b) => String(b.text ?? '').includes('{inhaber}'))).toBe(true);
  });
  it('standardVorlage liefert eine Kopie', () => {
    const v = standardVorlage('rechnung');
    v[0].claim = 'geändert';
    v.pop();
    expect(STANDARD_VORLAGEN.rechnung[0].claim).toBe('{inhaber}');
    expect(standardVorlage('rechnung')).toHaveLength(STANDARD_VORLAGEN.rechnung.length);
  });
  it('Nummernkreise RE/QU/AN/EB', () => {
    expect([ARTEN.rechnung.prefix, ARTEN.quittung.prefix, ARTEN.angebot.prefix, ARTEN.eigenbeleg.prefix]).toEqual(['RE', 'QU', 'AN', 'EB']);
  });
});

describe('Testbeleg', () => {
  it('Entwurf ohne Nummer, Kunde Müller & Söhne 100%', () => {
    const d = rechnung();
    expect(d.nummer).toBeNull();
    expect(d.kunde?.name).toBe('Müller & Söhne 100%');
    expect(d.faellig_am).toBe('2026-11-01');
  });
  it('eigene Firmendaten nur, wenn ausgefüllt', () => {
    const leer = Object.fromEntries(Object.keys(BEISPIEL_FIRMA).map((k) => [k, ''])) as typeof BEISPIEL_FIRMA;
    expect(firmaOderBeispiel(leer)).toBe(BEISPIEL_FIRMA);
    expect(firmaOderBeispiel(null)).toBe(BEISPIEL_FIRMA);
    const eigen = { ...leer, name: 'Meine Firma' };
    expect(firmaOderBeispiel(eigen)).toBe(eigen);
  });
});

describe('Akzentfarbe fürs PDF', () => {
  it('86 % Akzent mit Schwarz in OKLab, Hex groß ohne #', () => {
    const h = belegAkzent('#6366f1');
    expect(h).toMatch(/^[0-9A-F]{6}$/);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    // dunkler als das Original, Blau bleibt dominant
    expect(r).toBeLessThan(0x63);
    expect(g).toBeLessThan(0x66);
    expect(b).toBeLessThan(0xf1);
    expect(b).toBeGreaterThan(r);
  });
  it('Weiß bleibt grau, Schwarz bleibt schwarz, Ungültiges ⇒ Standard', () => {
    const w = belegAkzent('#ffffff');
    expect(w.slice(0, 2)).toBe(w.slice(2, 4));
    expect(belegAkzent('#000000')).toBe('000000');
    expect(belegAkzent('rot')).toBe(belegAkzent('#6366f1'));
  });
});
