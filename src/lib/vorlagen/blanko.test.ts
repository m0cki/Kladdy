/* Blanko-Formular zum Ausfüllen von Hand (ANLEITUNG §7.0): Dokument, Platzhalter, Firmenkopf, Pflichtangaben-Check
 * und die gemerkte Vorschau-Quelle. Vorschau (Blatt.tsx) und PDF (latex.test.ts) nutzen dieselbe Logik. */
import { describe, expect, it } from 'vitest';
import type { KeyValueStore } from '../settings';
import type { Baustein } from './bausteine';
import { BEISPIEL_FIRMA, BLANKO_ARTEN, beispielbeleg, blankobeleg, hatBlanko } from './beispiel';
import { BELEG_PLATZHALTER, istEntwurf, luecken, platzhalterWerte } from './dokument';
import { sichtbareZeilen } from './firmenblock';
import { ersetzteZeilen } from './formatierung';
import { pflichtCheck, pflichtOk } from './pflicht';
import { standardVorlage } from './standard';
import { VORSCHAU_KEY, ladeQuellen, speichereQuelle } from './vorschau';

const blanko = (art: 'quittung' | 'eigenbeleg' = 'quittung') => blankobeleg(art, BEISPIEL_FIRMA, 'klein');

describe('Blanko-Dokument', () => {
  it('nur Quittung und Eigenbeleg, ohne Nummer, aber kein Entwurf (kein Wasserzeichen)', () => {
    expect(BLANKO_ARTEN).toEqual(['quittung', 'eigenbeleg']);
    expect(hatBlanko('rechnung')).toBe(false);
    expect(hatBlanko('angebot')).toBe(false);
    const d = blanko();
    expect(d.nummer).toBeNull();
    expect(d.blanko).toBe(true);
    expect(istEntwurf(d)).toBe(false);
    expect(istEntwurf({ ...d, blanko: false })).toBe(true);
    expect(d.positionen).toEqual([]);
    expect(d.kunde).toBeNull();
    expect(d.zahlungsweg).toBeNull();
  });

  it('Platzhalter: Werte des Belegs leer (auch kein „Barverkauf“), Firmendaten bleiben', () => {
    const w = platzhalterWerte(blanko());
    for (const n of BELEG_PLATZHALTER) expect(w[n]).toBe('');
    expect(w.firma).toBe(BEISPIEL_FIRMA.name);
    expect(w.steuernummer).toBe(BEISPIEL_FIRMA.steuernummer);
    expect(w.inhaber).toBe(BEISPIEL_FIRMA.inhaber);
    expect(w.art).toBe('Quittung');
    expect(w.schlusstext).toBe(''); // Quittung: kein § 14b-Hinweis vorgegeben (Kleinbetragsrechnung)
    expect(luecken(blanko())).toBe(BELEG_PLATZHALTER);
    expect(luecken(beispielbeleg('quittung', BEISPIEL_FIRMA, 'klein', '2026-11-04')).size).toBe(0);
  });

  it('ersetzteZeilen: Platzhalter des Belegs werden Lücken (statt „Entwurf“), Firmendaten Text', () => {
    const d = blanko();
    const z = ersetzteZeilen('Nr. {nr} · <b>{datum}</b> · {firma}', platzhalterWerte(d), luecken(d));
    expect(z).toEqual([
      [
        { text: 'Nr. ', entwurf: false, fett: false, kursiv: false, unterstrichen: false },
        { text: '', entwurf: false, luecke: true, fett: false, kursiv: false, unterstrichen: false },
        { text: ' · ', entwurf: false, fett: false, kursiv: false, unterstrichen: false },
        { text: '', entwurf: false, luecke: true, fett: true, kursiv: false, unterstrichen: false },
        { text: ` · ${BEISPIEL_FIRMA.name}`, entwurf: false, fett: false, kursiv: false, unterstrichen: false },
      ],
    ]);
    // nur eine Lücke ⇒ wird trotzdem gedruckt; ohne Lücken bleibt {nr} „Entwurf“
    expect(ersetzteZeilen('{kunde}', platzhalterWerte(d), luecken(d))).not.toBeNull();
    expect(ersetzteZeilen('{nr}', platzhalterWerte(d))?.[0][0]).toMatchObject({ text: 'Entwurf', entwurf: true });
  });

  it('Firmenkopf: eine Zeile mit Lücke bleibt, leere Firmendaten fallen weiter weg', () => {
    const d = { ...blanko(), firma: { ...BEISPIEL_FIRMA, telefon: '' } };
    const zeilen = sichtbareZeilen('Datum: {datum}\nTel. {telefon}\n{email}', platzhalterWerte(d), luecken(d)).map((z) => z.text);
    expect(zeilen).toEqual(['Datum: {datum}', '{email}']);
    expect(sichtbareZeilen('Datum: {datum}', platzhalterWerte(d))).toEqual([]);
  });
});

describe('Pflichtangaben-Check im Blanko-Formular', () => {
  const punkt = (l: ReturnType<typeof pflichtCheck>, label: string) => l.find((p) => p.label === label)!;

  it('Standardvorlagen: nichts rot, Werte offen „von Hand“', () => {
    for (const art of BLANKO_ARTEN) {
      for (const design of art === 'quittung' ? ['klassisch', 'formular'] : ['klassisch']) {
        const l = pflichtCheck(blanko(art as 'quittung' | 'eigenbeleg'), standardVorlage(art, design));
        expect(pflichtOk(l), `${art}/${design}`).toBe(true);
      }
    }
    const l = pflichtCheck(blanko(), standardVorlage('quittung'));
    expect(punkt(l, 'Ausstellungsdatum')).toMatchObject({ ok: true, offen: true, hint: 'wird von Hand eingetragen' });
    expect(punkt(l, 'Fortlaufende Nummer')).toMatchObject({ ok: true, offen: true, hint: 'von Hand fortlaufend eintragen' });
    expect(punkt(l, 'Entgelt und § 19-Hinweis')).toMatchObject({ ok: true, offen: true });
    expect(punkt(l, 'Name und Anschrift (Kunde)')).toMatchObject({ ok: true, offen: true });
    expect(punkt(l, 'Name und Anschrift (Kunde)').hint).toContain('Pflicht über 250,00');
    // Firmendaten werden weiter geprüft
    expect(punkt(l, 'Steuernummer')).toMatchObject({ ok: true, hint: BEISPIEL_FIRMA.steuernummer });
    const e = pflichtCheck(blanko('eigenbeleg'), standardVorlage('eigenbeleg'));
    expect(punkt(e, 'Grund für den Eigenbeleg')).toMatchObject({ ok: true, offen: true });
  });

  it('prüft weiter, was die Vorlage druckt, und die Firmendaten', () => {
    const ohneHinweis = standardVorlage('quittung').filter((b) => b.typ !== 'steuerhinweis');
    expect(punkt(pflichtCheck(blanko(), ohneHinweis), 'Entgelt und § 19-Hinweis').ok).toBe(false);
    const ohneDatum: Baustein[] = standardVorlage('quittung').map((b) => (b.typ === 'quittung_felder' ? { ...b, datum: false } : b));
    expect(punkt(pflichtCheck(blanko(), ohneDatum), 'Ausstellungsdatum')).toMatchObject({ ok: false, hint: 'Quittungsangaben: „Datum“ ist abgeschaltet' });
    const ohneSteuernr = { ...blanko(), firma: { ...BEISPIEL_FIRMA, steuernummer: '' } };
    expect(punkt(pflichtCheck(ohneSteuernr, standardVorlage('quittung')), 'Steuernummer').ok).toBe(false);
    const ohneKunde: Baustein[] = standardVorlage('quittung').map((b) => (b.typ === 'quittung_felder' ? { ...b, kunde: false } : b));
    const kunde = punkt(pflichtCheck(blanko(), ohneKunde), 'Name und Anschrift (Kunde)');
    expect(kunde).toMatchObject({ ok: true });
    expect(kunde.offen).toBeUndefined();
    expect(kunde.hint).toMatch(/^nicht vorgesehen – reicht nur bis 250,00/);
  });
});

describe('Vorschau-Quelle „Blanko“', () => {
  const speicher = (init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } => {
    const data = { ...init };
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  };

  it('gemerkt für Quittung und Eigenbeleg', () => {
    const s = speicher();
    speichereQuelle(s, 'quittung', 'blanko');
    speichereQuelle(s, 'eigenbeleg', 'blanko');
    expect(ladeQuellen(s)).toEqual({ rechnung: 'beispiel', quittung: 'blanko', angebot: 'beispiel', eigenbeleg: 'blanko' });
    speichereQuelle(s, 'quittung', 'beleg');
    expect(ladeQuellen(s).quittung).toBe('beleg');
  });

  it('nicht für Rechnung und Angebot (weder gelesen noch gemerkt)', () => {
    const s = speicher({ [VORSCHAU_KEY]: JSON.stringify({ quelle: { rechnung: 'blanko', angebot: 'blanko' } }) });
    expect(ladeQuellen(s).rechnung).toBe('beispiel');
    expect(ladeQuellen(s).angebot).toBe('beispiel');
    expect(speichereQuelle(s, 'rechnung', 'blanko').rechnung).toBe('beispiel');
  });
});
