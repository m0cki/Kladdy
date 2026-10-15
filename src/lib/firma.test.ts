import { describe, expect, it } from 'vitest';
import {
  feldAnzeige,
  feldFehler,
  feldUebernehmen,
  fehlendePflichtangaben,
  firmaAusJson,
  firmaFehler,
  ibanFehler,
  ibanFormat,
  ibanGueltig,
  leereFirma,
  normalisiere,
} from './firma';

describe('IBAN', () => {
  it('erkennt gültige IBANs (mit und ohne Leerzeichen, klein geschrieben)', () => {
    expect(ibanGueltig('DE89370400440532013000')).toBe(true);
    expect(ibanGueltig('de89 3704 0044 0532 0130 00')).toBe(true);
    expect(ibanGueltig('AT611904300234573201')).toBe(true);
    expect(ibanGueltig('GB82WEST12345698765432')).toBe(true);
    expect(ibanGueltig('NL91ABNA0417164300')).toBe(true);
  });

  it('meldet Tippfehler über die Prüfziffer', () => {
    expect(ibanFehler('DE89370400440532013001')).toMatch(/Prüfziffer/);
    expect(ibanFehler('DE98370400440532013000')).toMatch(/Prüfziffer/); // Zahlendreher in der Prüfziffer
  });

  it('prüft die Länge je Land', () => {
    expect(ibanFehler('DE8937040044053201300')).toMatch(/22 Zeichen \(hier 21\)/);
    expect(ibanFehler('DE89 3704 0044 0532 0130 000')).toMatch(/22 Zeichen/);
  });

  it('lehnt falschen Aufbau ab', () => {
    expect(ibanFehler('1234')).toMatch(/Ländercode/);
    expect(ibanFehler('DEXX370400440532013000')).toMatch(/Ländercode/);
    expect(ibanFehler('DE89-3704-0044')).toMatch(/Ländercode/);
  });

  it('formatiert in Vierergruppen', () => {
    expect(ibanFormat('de89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00');
  });
});

describe('Felder', () => {
  it('normalisiert IBAN, BIC, USt-IdNr. und PLZ', () => {
    expect(normalisiere('iban', ' de89 3704 0044 0532 0130 00 ')).toBe('DE89370400440532013000');
    expect(normalisiere('bic', 'cobadeffxxx')).toBe('COBADEFFXXX');
    expect(normalisiere('ust_idnr', 'de 123 456 789')).toBe('DE123456789');
    expect(normalisiere('plz', '12 345')).toBe('12345');
    expect(normalisiere('name', '  Mustermann   Haus- &  Gartenservice ')).toBe('Mustermann Haus- & Gartenservice');
  });

  it('leere Felder sind erlaubt', () => {
    for (const f of ['iban', 'bic', 'email', 'plz', 'steuernummer', 'ust_idnr'] as const) expect(feldFehler(f, '')).toBeNull();
  });

  it('BIC mit 8 oder 11 Zeichen', () => {
    expect(feldFehler('bic', 'COBADEFF')).toBeNull();
    expect(feldFehler('bic', 'COBADEFFXXX')).toBeNull();
    expect(feldFehler('bic', 'COBADEF')).toMatch(/8 oder 11/);
  });

  it('E-Mail und PayPal', () => {
    expect(feldFehler('email', 'hallo@mustermann-service.de')).toBeNull();
    expect(feldFehler('paypal', 'hallo@mustermann')).toMatch(/E-Mail/);
  });

  it('PLZ, Telefon, Steuernummer', () => {
    expect(feldFehler('plz', '12345')).toBeNull();
    expect(feldFehler('plz', '1234')).toMatch(/fünf/);
    expect(feldFehler('telefon', '0123 456789')).toBeNull();
    expect(feldFehler('telefon', '+49 (123) 456-789')).toBeNull();
    expect(feldFehler('telefon', 'abc')).toMatch(/Ziffern/);
    expect(feldFehler('steuernummer', '12/345/67890')).toBeNull(); // 10 Ziffern (Länderformat)
    expect(feldFehler('steuernummer', '1121081508150')).toBeNull(); // 13 Ziffern (bundeseinheitlich)
    expect(feldFehler('steuernummer', '12/345')).toMatch(/10 bis 13/);
    expect(feldFehler('steuernummer', 'DE123')).toMatch(/Erlaubt/);
  });

  it('USt-IdNr.', () => {
    expect(feldFehler('ust_idnr', 'DE123456789')).toBeNull();
    expect(feldFehler('ust_idnr', 'DE12345678')).toMatch(/neun Ziffern/);
    expect(feldFehler('ust_idnr', 'ATU12345678')).toBeNull();
    expect(feldFehler('ust_idnr', '123456789')).toMatch(/Ländercode/);
  });

  it('firmaFehler sammelt nur fehlerhafte Felder', () => {
    const f = { ...leereFirma(), iban: 'DE00', plz: '12345', email: 'x' };
    expect(Object.keys(firmaFehler(f)).sort()).toEqual(['email', 'iban']);
  });
});

describe('firmaAusJson', () => {
  it('füllt fehlende Felder auf und ignoriert Fremdes', () => {
    const f = firmaAusJson({ name: 'Mustermann', iban: 42, logo: 'x.png' });
    expect(f.name).toBe('Mustermann');
    expect(f.iban).toBe('');
    expect('logo' in f).toBe(false);
    expect(firmaAusJson(null)).toEqual(leereFirma());
    expect(firmaAusJson(['a'])).toEqual(leereFirma());
  });
});

describe('fehlendePflichtangaben (§2.3)', () => {
  it('leere Firma: Name, Anschrift, Steuernummer', () => {
    expect(fehlendePflichtangaben(leereFirma())).toEqual([
      'Name',
      'Anschrift (Straße, PLZ, Ort)',
      'Steuernummer, USt-IdNr. oder KU-ID',
    ]);
  });

  it('eine der drei Steuer-Kennungen genügt', () => {
    const basis = { ...leereFirma(), name: 'Mustermann', strasse: 'Lindenweg 12', plz: '12345', ort: 'Musterstadt' };
    expect(fehlendePflichtangaben({ ...basis, steuernummer: '12/345/67890' })).toEqual([]);
    expect(fehlendePflichtangaben({ ...basis, ust_idnr: 'DE123456789' })).toEqual([]);
    expect(fehlendePflichtangaben({ ...basis, ku_id: 'x' })).toEqual([]);
    expect(fehlendePflichtangaben({ ...basis, ort: '' })).toEqual(['Anschrift (Straße, PLZ, Ort)', 'Steuernummer, USt-IdNr. oder KU-ID']);
  });
});

describe('feldUebernehmen / feldAnzeige', () => {
  it('normalisiert gültige Eingaben zum Speichern', () => {
    expect(feldUebernehmen('iban', 'de89 3704 0044 0532 0130 00')).toEqual({ wert: 'DE89370400440532013000' });
    expect(feldUebernehmen('name', '  Mustermann   Service ')).toEqual({ wert: 'Mustermann Service' });
    expect(feldUebernehmen('email', '')).toEqual({ wert: '' });
  });
  it('meldet Fehler verständlich, z. B. eine falsche IBAN-Prüfziffer', () => {
    const r = feldUebernehmen('iban', 'DE88 3704 0044 0532 0130 00');
    expect(r).toEqual({ fehler: expect.stringContaining('Prüfziffer') });
    expect(feldUebernehmen('plz', '1234')).toEqual({ fehler: expect.stringContaining('fünf Ziffern') });
  });
  it('zeigt die IBAN in Vierergruppen, andere Felder unverändert', () => {
    expect(feldAnzeige('iban', 'DE89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00');
    expect(feldAnzeige('iban', '')).toBe('');
    expect(feldAnzeige('bic', 'COBADEFFXXX')).toBe('COBADEFFXXX');
  });
  it('Anzeige und Übernahme passen zusammen (kein Speichern ohne Änderung)', () => {
    const gespeichert = 'DE89370400440532013000';
    expect(feldUebernehmen('iban', feldAnzeige('iban', gespeichert))).toEqual({ wert: gespeichert });
  });
});
