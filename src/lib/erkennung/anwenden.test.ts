import { describe, expect, it } from 'vitest';
import type { Formular } from '../buchungen';
import { erkennungAnwenden, vorschlagAktiv, type AnwendenOptionen } from './anwenden';
import type { Erkennung } from './regeln';

const KATS: AnwendenOptionen['kategorien'] = [
  { id: 1, typ: 'einnahme' },
  { id: 2, typ: 'ausgabe' },
  { id: 3, typ: 'ausgabe' },
  { id: 4, typ: 'ausgabe' },
];

const LEER: Formular = {
  typ: 'ausgabe',
  betrag: '',
  kategorieId: 2,
  zahlungsdatum: '2026-10-22',
  belegnummer: '',
  beschreibung: '',
  wer: '',
  kundeBewusstNeu: null,
  privat: '',
  zahlungsart: 'bank',
};

const ERKANNT: Erkennung = {
  felder: { betrag_cent: 7895, zahlungsdatum: '2026-10-07', belegnummer: '5528', lieferant: 'Aral', kategorie_id: 3, beschreibung: 'Aral · Super E10' },
  herkunft: { betrag_cent: 'pdf', zahlungsdatum: 'pdf', belegnummer: 'pdf', lieferant: 'dateiname', kategorie_id: 'pdf', beschreibung: 'pdf' },
  sicherheit: { betrag_cent: 'hoch', zahlungsdatum: 'mittel', belegnummer: 'hoch', lieferant: 'niedrig', kategorie_id: 'mittel', beschreibung: 'mittel' },
  quelle: 'pdf',
  hinweise: [],
  zusammenfassung: 'Erkannt: …',
};

const opt = (o: Partial<AnwendenOptionen> = {}): AnwendenOptionen => ({ basis: LEER, neu: true, katGewaehlt: false, kategorien: KATS, ...o });

describe('erkennungAnwenden', () => {
  it('neuer Eintrag: füllt alle freien Felder und merkt Herkunft und Sicherheit', () => {
    const r = erkennungAnwenden(LEER, ERKANNT, opt());
    expect(r.form).toEqual({ ...LEER, betrag: '78,95', zahlungsdatum: '2026-10-07', belegnummer: '5528', beschreibung: 'Aral · Super E10', wer: 'Aral', kategorieId: 3 });
    expect(r.vorschlaege.betrag).toEqual({ wert: '78,95', quelle: 'pdf', sicherheit: 'hoch' });
    expect(r.vorschlaege.wer).toEqual({ wert: 'Aral', quelle: 'dateiname', sicherheit: 'niedrig' });
    expect(r.gefuellt).toEqual(['betrag', 'zahlungsdatum', 'belegnummer', 'beschreibung', 'wer', 'kategorieId']);
  });

  it('getippte Werte bleiben, geändertes Datum und selbst gewählte Kategorie auch', () => {
    const form: Formular = { ...LEER, betrag: '80,00', zahlungsdatum: '2026-10-08', beschreibung: 'Tanken', kategorieId: 4 };
    const r = erkennungAnwenden(form, ERKANNT, opt({ katGewaehlt: true }));
    expect(r.form).toEqual({ ...form, belegnummer: '5528', wer: 'Aral' });
    expect(r.gefuellt).toEqual(['belegnummer', 'wer']);
  });

  it('Kategorie aus den Stichworten (nicht selbst gewählt) darf ersetzt werden', () => {
    expect(erkennungAnwenden({ ...LEER, kategorieId: 4 }, ERKANNT, opt()).form.kategorieId).toBe(3);
  });

  it('Bearbeiten: nur leere Textfelder, nie Datum, Typ oder Kategorie', () => {
    const form: Formular = { ...LEER, betrag: '78,95', beschreibung: 'Diesel', zahlungsdatum: '2026-10-01' };
    const r = erkennungAnwenden(form, { ...ERKANNT, felder: { ...ERKANNT.felder, typ: 'einnahme' } }, opt({ basis: form, neu: false }));
    expect(r.form).toEqual({ ...form, belegnummer: '5528', wer: 'Aral' });
  });

  it('eigener Beleg ⇒ Einnahme: Kategorie des neuen Typs, kein Geschäft im Kundenfeld', () => {
    const e: Erkennung = { ...ERKANNT, felder: { typ: 'einnahme', betrag_cent: 12000, lieferant: 'Irgendwer', kategorie_id: 1 }, herkunft: { typ: 'pdf' }, sicherheit: { typ: 'hoch' } };
    const r = erkennungAnwenden(LEER, e, opt({ katGewaehlt: true }));
    expect(r.form).toMatchObject({ typ: 'einnahme', betrag: '120,00', kategorieId: 1, wer: '' });
    expect(r.vorschlaege.typ).toEqual({ wert: 'einnahme', quelle: 'pdf', sicherheit: 'hoch' });
  });

  it('selbst umgestellter Typ bleibt; Kategorie eines anderen Typs wird nicht übernommen', () => {
    const form: Formular = { ...LEER, typ: 'einnahme', kategorieId: 1 };
    const r = erkennungAnwenden(form, ERKANNT, opt());
    expect(r.form).toMatchObject({ typ: 'einnahme', kategorieId: 1, wer: '' });
    expect(r.gefuellt).not.toContain('kategorieId');
  });

  it('zweite Erkennung ersetzt unveränderte Vorschläge der ersten, aber keine Eingaben', () => {
    const erste = erkennungAnwenden(LEER, ERKANNT, opt());
    const form: Formular = { ...erste.form, beschreibung: 'Diesel für den Transporter' };
    const zweite: Erkennung = { ...ERKANNT, felder: { betrag_cent: 4783, beschreibung: 'Bauhaus · Schrauben', zahlungsdatum: '2026-09-14' } };
    const r = erkennungAnwenden(form, zweite, opt({ bisher: erste.vorschlaege }));
    expect(r.form).toMatchObject({ betrag: '47,83', zahlungsdatum: '2026-09-14', beschreibung: 'Diesel für den Transporter', wer: 'Aral' });
    expect(vorschlagAktiv(r.form, r.vorschlaege, 'betrag')?.wert).toBe('47,83');
    expect(vorschlagAktiv(r.form, r.vorschlaege, 'wer')?.quelle).toBe('dateiname');
  });

  it('vorschlagAktiv: nur solange der Wert unverändert drinsteht', () => {
    const r = erkennungAnwenden(LEER, ERKANNT, opt());
    expect(vorschlagAktiv(r.form, r.vorschlaege, 'betrag')).toEqual({ wert: '78,95', quelle: 'pdf', sicherheit: 'hoch' });
    expect(vorschlagAktiv({ ...r.form, betrag: '78,96' }, r.vorschlaege, 'betrag')).toBeNull();
    expect(vorschlagAktiv(r.form, r.vorschlaege, 'typ')).toBeNull();
  });

  it('nichts erkannt ⇒ Formular unverändert', () => {
    const r = erkennungAnwenden(LEER, { ...ERKANNT, felder: {}, herkunft: {}, sicherheit: {} }, opt());
    expect(r.form).toEqual(LEER);
    expect(r.gefuellt).toEqual([]);
  });
});
