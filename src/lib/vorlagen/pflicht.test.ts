import { describe, expect, it } from 'vitest';
import { BEISPIEL_FIRMA, beispielbeleg, testbeleg } from './beispiel';
import type { BelegDokument } from './dokument';
import { pflichtCheck, pflichtOk, pflichtTitel } from './pflicht';
import { standardVorlage } from './standard';

const rechnung = (): BelegDokument => testbeleg('rechnung', BEISPIEL_FIRMA, 'klein', '2026-10-18');
const quittung = (): BelegDokument => testbeleg('quittung', BEISPIEL_FIRMA, 'klein', '2026-10-18');
const punkt = (liste: ReturnType<typeof pflichtCheck>, label: string) => {
  const p = liste.find((x) => x.label === label);
  if (!p) throw new Error(`Pflichtangabe „${label}“ fehlt in der Liste`);
  return p;
};

describe('Pflichtangaben (§ 2.3)', () => {
  it('Testrechnung mit Standardvorlage: alles da, Nummer offen', () => {
    const l = pflichtCheck(rechnung(), standardVorlage('rechnung'), { naechste_nummer: 'RE-2026-0007' });
    expect(pflichtOk(l)).toBe(true);
    const nr = punkt(l, 'Fortlaufende Nummer');
    expect(nr.offen).toBe(true);
    expect(nr.hint).toContain('RE-2026-0007');
    expect(punkt(l, 'Leistungsdatum / -zeitraum').hint).toBe('12.10.–18.10.2026');
    expect(pflichtTitel(rechnung(), l)).toBe('Rechnung: alle Pflichtangaben vorhanden');
  });

  it('§ 19-Baustein entfernt ⇒ nicht ok (Kleinunternehmer)', () => {
    const v = standardVorlage('rechnung').filter((b) => b.typ !== 'steuerhinweis');
    const l = pflichtCheck(rechnung(), v);
    const p = punkt(l, 'Entgelt und § 19-Hinweis');
    expect(p.ok).toBe(false);
    expect(p.hint).toContain('Steuerhinweis');
    expect(pflichtOk(l)).toBe(false);
    expect(pflichtTitel(rechnung(), l)).toBe('Rechnung: 1 Pflichtangabe fehlt');
  });

  it('§ 19-Baustein ausgeblendet zählt wie entfernt', () => {
    const v = standardVorlage('rechnung').map((b) => (b.typ === 'steuerhinweis' ? { ...b, aus: true } : b));
    expect(punkt(pflichtCheck(rechnung(), v), 'Entgelt und § 19-Hinweis').ok).toBe(false);
  });

  it('§ 19-Hinweis in einem eigenen Freitext reicht', () => {
    const v = standardVorlage('rechnung').filter((b) => b.typ !== 'steuerhinweis');
    v.push({ typ: 'text', text: 'Kein Ausweis der Umsatzsteuer nach §19 UStG.' });
    expect(punkt(pflichtCheck(rechnung(), v), 'Entgelt und § 19-Hinweis').ok).toBe(true);
  });

  it('fehlende Daten: Kunde, Steuernummer, Positionen', () => {
    const d = { ...rechnung(), kunde: null, positionen: [], firma: { ...BEISPIEL_FIRMA, steuernummer: '' } };
    const l = pflichtCheck(d, standardVorlage('rechnung'));
    expect(punkt(l, 'Name und Anschrift (Kunde)')).toMatchObject({ ok: false, hint: 'Kunde fehlt' });
    expect(punkt(l, 'Steuernummer')).toMatchObject({ ok: false, hint: 'in den Firmendaten ergänzen' });
    expect(punkt(l, 'Menge und Art der Leistung').ok).toBe(false);
    expect(punkt(l, 'Entgelt und § 19-Hinweis')).toMatchObject({ ok: false, hint: 'Betrag fehlt' });
  });

  it('Nummer wird nirgends gedruckt ⇒ nicht ok', () => {
    const v = standardVorlage('rechnung').map((b) =>
      b.typ === 'titel' ? { ...b, text: '{art}' } : b.typ === 'anschrift_meta' ? { ...b, nr: false } : b,
    );
    expect(punkt(pflichtCheck(rechnung(), v), 'Fortlaufende Nummer')).toMatchObject({ ok: false, hint: 'Nummer wird nirgends gedruckt' });
  });

  it('ausgestellte Nummer erscheint, nicht offen', () => {
    const l = pflichtCheck({ ...rechnung(), nummer: 'RE-2026-0003' }, standardVorlage('rechnung'));
    expect(punkt(l, 'Fortlaufende Nummer')).toEqual({ label: 'Fortlaufende Nummer', ok: true, hint: 'RE-2026-0003' });
  });
});

describe('Kleinbetragsrechnung (Quittung bis 250 €)', () => {
  it('Kunde optional bis 250 €', () => {
    const q = { ...quittung(), kunde: null };
    const l = pflichtCheck(q, standardVorlage('quittung'));
    expect(punkt(l, 'Name und Anschrift (Kunde)')).toMatchObject({ ok: true });
    expect(punkt(l, 'Name und Anschrift (Kunde)').hint).toContain('Kleinbetragsrechnung');
    expect(pflichtOk(l)).toBe(true);
  });

  it('genau 250,00 € ist noch Kleinbetrag, 250,01 € nicht mehr', () => {
    const genau = { ...quittung(), kunde: null, positionen: [{ beschreibung: 'X', menge: 1, einheit: '', einzelpreis_cent: 25000 }] };
    expect(punkt(pflichtCheck(genau, standardVorlage('quittung')), 'Name und Anschrift (Kunde)').ok).toBe(true);
    const drueber = { ...genau, positionen: [{ beschreibung: 'X', menge: 1, einheit: '', einzelpreis_cent: 25001 }] };
    expect(punkt(pflichtCheck(drueber, standardVorlage('quittung')), 'Name und Anschrift (Kunde)')).toMatchObject({ ok: false, hint: 'Kunde fehlt' });
  });

  it('Grenze aus den Steuer-Kennwerten', () => {
    const q = { ...quittung(), kunde: null };
    expect(punkt(pflichtCheck(q, standardVorlage('quittung'), { kleinbetrag_cent: 5000 }), 'Name und Anschrift (Kunde)').ok).toBe(false);
  });

  it('über der Grenze: Name ohne Anschrift reicht nicht', () => {
    const q = quittung();
    const d = {
      ...q,
      kunde: q.kunde && { ...q.kunde, zusatz: '', strasse: '', plz: '', ort: '' },
      positionen: [{ beschreibung: 'X', menge: 1, einheit: '', einzelpreis_cent: 30000 }],
    };
    expect(punkt(pflichtCheck(d, standardVorlage('quittung')), 'Name und Anschrift (Kunde)').hint).toContain('Anschrift fehlt');
  });

  it('Quittung: Leistungsdatum = Ausstellungsdatum', () => {
    expect(punkt(pflichtCheck(quittung(), standardVorlage('quittung')), 'Leistungsdatum')).toMatchObject({ ok: true, hint: '= Ausstellungsdatum' });
  });
});

describe('weitere Arten und Modi', () => {
  it('Angebot hat keine Pflichtangaben', () => {
    expect(pflichtCheck({ ...rechnung(), art: 'angebot' }, standardVorlage('angebot'))).toEqual([]);
  });

  it('Regelbesteuerung: Umsatzsteuer fehlt noch', () => {
    const l = pflichtCheck({ ...rechnung(), ust_modus: 'regel' }, standardVorlage('rechnung'));
    expect(l.find((x) => x.label === 'Entgelt und § 19-Hinweis')).toBeUndefined();
    expect(punkt(l, 'Entgelt').ok).toBe(true);
    expect(punkt(l, 'Steuersatz und Steuerbetrag').ok).toBe(false);
  });

  it('Eigenbeleg: Grund und Zweck nötig, Unterschrift offen', () => {
    const eb: BelegDokument = {
      ...quittung(),
      art: 'eigenbeleg',
      betreff: '',
      eigenbeleg: { grund: 'sonstiges', grund_text: '', gebucht: null },
    };
    const l = pflichtCheck(eb, standardVorlage('eigenbeleg'));
    expect(punkt(l, 'Gegenstand / Zweck').ok).toBe(false);
    expect(punkt(l, 'Grund für den Eigenbeleg').ok).toBe(false);
    expect(punkt(l, 'Unterschrift')).toMatchObject({ ok: true, offen: true });
    const ok = pflichtCheck({ ...eb, betreff: 'Parkgebühr', eigenbeleg: { grund: 'verloren', grund_text: '', gebucht: null } }, standardVorlage('eigenbeleg'));
    expect(pflichtOk(ok)).toBe(true);
  });

  it('Eigenbeleg ohne Angaben-Baustein ⇒ alles rot', () => {
    const eb: BelegDokument = { ...quittung(), art: 'eigenbeleg', eigenbeleg: { grund: 'verloren', grund_text: '', gebucht: null } };
    const l = pflichtCheck(eb, [{ typ: 'titel' }, { typ: 'unterschrift' }]);
    expect(l.filter((p) => !p.ok).map((p) => p.hint)).toContain('Baustein „Eigenbeleg-Angaben“ fehlt');
  });
});

describe('Design „Formular“ der Quittung', () => {
  const formular = () => standardVorlage('quittung', 'formular');
  const beispiel = () => beispielbeleg('quittung', BEISPIEL_FIRMA, 'klein', '2026-10-18');

  it('mit Beispieldaten vollständig: Firmenkopf zählt als Anschrift, Inhaber und Steuernummer, Felder als Nummer', () => {
    for (const d of [beispiel(), quittung(), { ...beispiel(), nummer: 'QU-2026-0001' }]) {
      const l = pflichtCheck(d, formular(), { naechste_nummer: 'QU-2026-0001' });
      expect(l.filter((p) => !p.ok).map((p) => p.label)).toEqual([]);
      expect(pflichtOk(l)).toBe(true);
    }
  });

  it('ohne § 19-Baustein nicht ok', () => {
    const l = pflichtCheck(beispiel(), formular().filter((b) => b.typ !== 'steuerhinweis'));
    expect(punkt(l, 'Entgelt und § 19-Hinweis').ok).toBe(false);
    expect(pflichtOk(l)).toBe(false);
  });

  it('ohne Firmenkopf fehlen Anschrift, Inhaber und Steuernummer', () => {
    const l = pflichtCheck(beispiel(), formular().filter((b) => b.typ !== 'firmenblock'));
    expect(pflichtOk(l)).toBe(false);
    const hints = l.filter((p) => !p.ok).map((p) => p.hint ?? '');
    expect(hints.some((h) => h.includes('Firmenkopf'))).toBe(true);
  });

  it('Felder im Kachel-Stil statt Formular zählen weiter als Nummer (Titel ohne Nr.)', () => {
    const v = formular().map((b) => (b.typ === 'quittung_felder' ? { ...b, stil: 'kacheln' } : b));
    expect(punkt(pflichtCheck({ ...beispiel(), nummer: 'QU-1' }, v), 'Fortlaufende Nummer').ok).toBe(false);
  });

  it('Formatierung zählt nicht: § 19-Hinweis und Platzhalter auch fett, kursiv oder unterstrichen', () => {
    const v = standardVorlage('rechnung').map((b) =>
      b.typ === 'steuerhinweis'
        ? { ...b, text: '<b>Umsatzsteuerfrei</b> aufgrund der Kleinunternehmerregelung gemäß <u>§ <i>19</i></u> UStG.' }
        : b,
    );
    expect(punkt(pflichtCheck(rechnung(), v), 'Entgelt und § 19-Hinweis').ok).toBe(true);
    const ohneFuss = standardVorlage('rechnung')
      .filter((b) => b.typ !== 'fusszeile')
      .map((b) => (b.typ === 'absenderzeile' ? { ...b, text: '<b>{firma}</b> · <i>{inhaber}</i> · <u>{strasse}</u> · {plz} {ort} · {steuernummer}' } : b));
    const l = pflichtCheck(rechnung(), ohneFuss);
    expect(punkt(l, 'Name und Anschrift (Aussteller)').ok).toBe(true);
    expect(punkt(l, 'Vollständiger Name (Inhaber)').ok).toBe(true);
    expect(punkt(l, 'Steuernummer').ok).toBe(true);
  });
});
