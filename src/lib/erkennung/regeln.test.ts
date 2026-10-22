import { describe, expect, it } from 'vitest';
import { leereFirma, type Firma } from '../firma';
import { erkenne, findeAbbuchung, findeBetrag, findeDatum, findeNummer, geldIn, kurzName, zeilenVon, zusammenfassung, type ErkennungKontext } from './regeln';

/* Kategorien wie Migration 0002 (§2.8), Firma wie die Demo-Daten */
const KATEGORIEN: ErkennungKontext['kategorien'] = [
  { id: 1, name: 'Dienstleistungen', typ: 'einnahme', stichworte: 'rasen,hecke,garten,montage,reparatur,winterdienst,quittung,rechnung', wareneingang: 0, zaehlt_ku_umsatz: 1 },
  {
    id: 2,
    name: 'Produkte & Material',
    typ: 'ausgabe',
    stichworte: 'bauhaus,obi,hornbach,toom,gartencenter,erde,mulch,dünger,pflanzen,saatgut,rasensamen,ersatzteil,schrauben,dübel,material,müllsäcke,handschuhe',
    wareneingang: 1,
    zaehlt_ku_umsatz: 0,
  },
  { id: 3, name: 'Sprit & Fahrzeug', typ: 'ausgabe', stichworte: 'tankstelle,aral,shell,esso,jet,total,diesel,benzin,super,kraftstoff,liter,werkstatt,reifen,kfz,inspektion', wareneingang: 0, zaehlt_ku_umsatz: 0 },
  { id: 4, name: 'Sonstige Kosten', typ: 'ausgabe', stichworte: 'telekom,vodafone,o2,versicherung,gebühr,porto,werbung,flyer,software,werkzeug,paypal,wertstoffhof', wareneingang: 0, zaehlt_ku_umsatz: 0 },
];

const FIRMA: Firma = {
  ...leereFirma(),
  name: 'Mustermann Haus- & Gartenservice',
  inhaber: 'Max Mustermann',
  strasse: 'Lindenweg 12',
  plz: '12345',
  ort: 'Musterstadt',
  email: 'hallo@mustermann-service.de',
  telefon: '0123 456789',
  web: 'mustermann-service.de',
  steuernummer: '12/345/67890',
  iban: 'DE89370400440532013000',
};

const HEUTE = '2026-10-22';
const ctx = (o: Partial<ErkennungKontext> = {}): ErkennungKontext => ({ heute: HEUTE, kategorien: KATEGORIEN, geschaefte: [], firma: FIRMA, ...o });
const HISTORIE: ErkennungKontext['geschaefte'] = [
  { name: 'Aral Tankstelle', anzahl: 12, kategorie_id: 3 },
  { name: 'Bauhaus', anzahl: 8, kategorie_id: 2 },
  { name: 'Telekom Deutschland', anzahl: 10, kategorie_id: 4 },
];
const NBSP = ' ';

/* Texte der Beispielbelege (referenz/beispiel-belege), so wie pdf.js + zeilenAus sie liefern */
const BAUHAUS = [
  'BAUHAUS',
  'Filiale Musterstadt',
  'Gewerbering 1 · 12345 Musterstadt',
  'Tel. 0123 98765-0',
  'Schleifpapier K120 10 St.',
  '2 x 3,49  6,98 A',
  'Ponal Holzleim Express 760g 9,99 A',
  'Spax Schrauben 4x40 200 St.12,49 A',
  'Hartwachsöl farblos 0,75 l 18,37 A',
  'Summe EUR  47,83',
  'EC-Karte EUR  47,83',
  'MwSt  Netto  Steuer  Brutto',
  'A 19%  40,19  7,64  47,83',
  '14.09.2026 15:42  Bon-Nr. 4711',
  'Kasse 03',
  'St.-Nr. 21/815/08150 · USt-IdNr.',
  'DE811111111',
  'Vielen Dank für Ihren Einkauf!',
  'Umtausch nur mit Kassenbon.',
].join('\n');

const GARTENCENTER = [
  'Gartencenter Blütenreich',
  'GmbH',
  'Am Gewerbepark 3 · 12347 Musterdorf',
  'www.bluetenreich-garten.de',
  'Blumenerde 40 l  2 x 6,99  13,98',
  'Rasendünger 5 kg  24,99',
  'Lavendel im Topf  3 x 4,49  13,47',
  'Saatgut Wildblumen  3,99',
  'Gesamt EUR  56,43',
  'Bar  60,00',
  'Rückgeld  3,57',
  'enthaltene MwSt: 7 % 0,26 · 19 % 8,37',
  '05.10.2026 10:12  Bon 0042-118  Kasse 2',
  'Danke für Ihren Einkauf!',
].join('\n');

const ARAL = [
  'ARAL',
  'Aral Tankstelle Musterstadt',
  'Hauptstraße 80 · 12345 Musterstadt',
  'Tel. 0123 88990',
  'Säule 4  Super E10',
  '42,31 l  x 1,866 EUR/l  78,95 A',
  'S u m m e E U R  7 8 , 9 5',
  'Kartenzahlung girocard  78,95',
  'MwSt 19%  Netto 66,34  MwSt 12,61',
  'Datum 07.10.2026  Zeit 17:32',
  'Beleg-Nr. 5528  Terminal 6612034',
  'Vielen Dank und gute Fahrt!',
].join('\n');

const TELEKOM = [
  'Telekom Deutschland GmbH',
  'Landgrabenweg 151 · 53227 Bonn',
  'Mustermann Haus- & Gartenservice · Lindenweg 12 · 12345 Musterstadt',
  'Ihre Rechnung für September 2026',
  'Rechnungsdatum  05.10.2026',
  'Rechnungsnummer  710023456789',
  'Kundennummer  1234567890',
  'MagentaZuhause M (Internet & Festnetz)  33,57 €',
  'Summe netto  33,57 €',
  'Umsatzsteuer 19 %  6,38 €',
  'Rechnungsbetrag  39,95 €',
  'Der Rechnungsbetrag wird am 20.10.2026 von Ihrem Konto abgebucht. Grüße',
  'Telekom Deutschland GmbH, Landgrabenweg 151, 53227 Bonn, Amtsgericht Bonn HRB 5919',
].join('\n');

const Z = (text: string) => zeilenVon(text);

describe('Beispielbelege', () => {
  it('Kassenbon Bauhaus: Summe, Datum mit Uhrzeit, Bon-Nr., Geschäft aus dem Kopf, Kategorie über Stichworte', () => {
    const e = erkenne({ text: BAUHAUS, dateiname: 'Kassenbon_Bauhaus.pdf', kontext: ctx() });
    expect(e.felder).toEqual({
      betrag_cent: 4783,
      zahlungsdatum: '2026-09-14',
      belegnummer: '4711',
      lieferant: 'Bauhaus',
      kategorie_id: 2,
      beschreibung: 'Bauhaus · Schleifpapier K120, Ponal Holzleim Express',
    });
    expect(e.sicherheit.betrag_cent).toBe('hoch'); // 40,19 + 7,64 = 47,83
    expect(e.herkunft.betrag_cent).toBe('pdf');
    expect(e.quelle).toBe('pdf');
    expect(e.zusammenfassung).toBe(`Erkannt: 47,83${NBSP}€ · 14.09.2026 · Bauhaus · Produkte & Material`);
    expect(e.hinweise).toEqual([]);
  });

  it('Kassenbon Gartencenter: umbrochene Überschrift mit Rechtsform, Bar/Rückgeld zählen nicht', () => {
    const e = erkenne({ text: GARTENCENTER, dateiname: 'Kassenbon_Gartencenter.pdf', kontext: ctx() });
    expect(e.felder).toMatchObject({
      betrag_cent: 5643,
      zahlungsdatum: '2026-10-05',
      belegnummer: '0042-118',
      lieferant: 'Gartencenter Blütenreich GmbH',
      kategorie_id: 2,
      beschreibung: 'Gartencenter Blütenreich · Blumenerde, Rasendünger',
    });
  });

  it('Tankquittung Aral: gesperrte Summe, Literpreis ist kein Betrag, Sprit über Stichworte', () => {
    const e = erkenne({ text: ARAL, dateiname: 'Tankquittung_Aral.pdf', kontext: ctx() });
    expect(e.felder).toMatchObject({ betrag_cent: 7895, zahlungsdatum: '2026-10-07', belegnummer: '5528', lieferant: 'Aral', kategorie_id: 3, beschreibung: 'Aral · Super E10' });
    expect(e.sicherheit.lieferant).toBe('niedrig');
  });

  it('Tankquittung Aral mit Historie: bekanntes Geschäft und dessen Kategorie', () => {
    const e = erkenne({ text: ARAL, dateiname: 'Tankquittung_Aral.pdf', kontext: ctx({ geschaefte: HISTORIE }) });
    expect(e.felder.lieferant).toBe('Aral Tankstelle');
    expect(e.sicherheit.lieferant).toBe('hoch');
    expect(e.felder.kategorie_id).toBe(3);
    expect(e.sicherheit.kategorie_id).toBe('hoch');
    expect(e.zusammenfassung).toBe(`Erkannt: 78,95${NBSP}€ · 07.10.2026 · Aral Tankstelle · Sprit & Fahrzeug`);
  });

  it('Rechnung Telekom (Lastschrift): Abbuchungstag ist Zahlungsdatum, Rechnungsdatum bleibt Belegdatum', () => {
    const e = erkenne({ text: TELEKOM, dateiname: 'Rechnung_Telekom.pdf', kontext: ctx() });
    expect(e.felder).toMatchObject({
      betrag_cent: 3995,
      zahlungsdatum: '2026-10-20',
      belegdatum: '2026-10-05',
      belegnummer: '710023456789',
      lieferant: 'Telekom Deutschland GmbH',
      kategorie_id: 4,
      beschreibung: 'Telekom · MagentaZuhause M',
    });
    expect(e.sicherheit.betrag_cent).toBe('hoch');
    expect(e.hinweise).toEqual(['Lastschrift: Rechnungsdatum 05.10.2026 · abgebucht am 20.10.2026 – als Zahlungsdatum zählt die Abbuchung (§ 11 EStG).']);
    expect(e.zusammenfassung).toBe(`Erkannt: 39,95${NBSP}€ · 20.10.2026 · Telekom Deutschland GmbH · Sonstige Kosten`);
  });

  it('Rechnung Telekom: eigene Anschrift als Empfänger und Kundennummer „1234567890“ machen keine Einnahme', () => {
    // Steuernummer der Firma ist 12/345/67890 – dieselben Ziffern ohne Trennzeichen sind nur eine Kundennummer
    const e = erkenne({ text: TELEKOM, dateiname: 'x.pdf', kontext: ctx() });
    expect(e.felder.typ).toBeUndefined();
  });
});

describe('Beträge', () => {
  const cent = (z: string) => geldIn(z).map((x) => x.c);
  it('deutsche und englische Schreibweisen, Währung davor oder dahinter', () => {
    expect(cent('Gesamt € 1.234,56')).toEqual([123456]);
    expect(cent('Gesamt 1234,56 EUR')).toEqual([123456]);
    expect(cent('Gesamt 1 234,56')).toEqual([123456]);
    expect(cent('Total EUR 59,49')).toEqual([5949]);
    expect(cent('Total 59,49 Euro')).toEqual([5949]);
    expect(cent('Total 59.49')).toEqual([5949]);
    expect(cent('Total 1,234.56')).toEqual([123456]);
    expect(cent('Total 12.345.678,90 €')).toEqual([1234567890]);
  });
  it('ganze Zahlen nur mit Währung, Mengen und Prozente nie', () => {
    expect(cent('Summe 12 €')).toEqual([1200]);
    expect(cent('Summe 12')).toEqual([]);
    expect(cent('MwSt 19 %  7,64')).toEqual([764]);
    expect(cent('42,31 l  x 1,866 EUR/l  78,95')).toEqual([7895]);
    expect(cent('Holz 2,5 kg 3,00')).toEqual([300]);
  });
  it('Datum, Uhrzeit, IBAN, Telefon und Steuernummer sind keine Beträge', () => {
    expect(cent('14.09.2026 15:42')).toEqual([]);
    expect(cent('IBAN DE89 3704 0044 0532 0130 00')).toEqual([]);
    expect(cent('Tel. 0123 456789-10')).toEqual([]);
    expect(cent('St.-Nr. 21/815/08150')).toEqual([]);
  });
  it('Minus davor ⇒ negativ', () => {
    expect(cent('Rabatt -5,00 €')).toEqual([-500]);
  });

  it('Gesamtbetrag in eigener Zeile darüber', () => {
    expect(findeBetrag(['Zwischensumme  75,97 €', 'Gesamtbetrag:', '90,40 €'], HEUTE)).toEqual({ c: 9040, s: 'hoch' });
  });
  it('Tabellenkopf über den Werten (Netto · MwSt · Brutto), Netto + Steuer bestätigt', () => {
    expect(findeBetrag(['Netto  MwSt  Brutto', '100,00  19,00  119,00'], HEUTE)).toEqual({ c: 11900, s: 'hoch' });
  });
  it('Zwischensumme, Rückgeld und Netto verlieren gegen „zu zahlen“', () => {
    const Zs = ['Zwischensumme 50,00', 'Rabatt -5,00', 'Zu zahlen 45,00 €', 'Gegeben 50,00', 'Rückgeld 5,00'];
    expect(findeBetrag(Zs, HEUTE)?.c).toBe(4500);
  });
  it('„inkl. MwSt“ an der Summe stört nicht', () => {
    expect(findeBetrag(['Netto 100,00', 'Gesamtbetrag inkl. MwSt 119,00 €'], HEUTE)?.c).toBe(11900);
  });
  it('ohne Schlüsselwort: größter Betrag, unsicher', () => {
    expect(findeBetrag(['Brot 3,20', 'Kaffee 12,90'], HEUTE)).toEqual({ c: 1290, s: 'niedrig' });
  });
  it('kein Betrag ⇒ null', () => {
    expect(findeBetrag(['Vielen Dank'], HEUTE)).toBeNull();
  });
});

describe('Datum', () => {
  const d = (z: string) => findeDatum([z], HEUTE)?.d ?? null;
  it('Schreibweisen', () => {
    expect(d('Datum: 14.09.2026')).toBe('2026-09-14');
    expect(d('Datum: 14.09.26')).toBe('2026-09-14');
    expect(d('Datum 2026-09-14')).toBe('2026-09-14');
    expect(d('Datum 14/09/2026')).toBe('2026-09-14');
    expect(d('Rechnungsdatum 14. September 2026')).toBe('2026-09-14');
    expect(d('Rechnungsdatum 3. März 2026')).toBe('2026-03-03');
    expect(d('Invoice date Sep 14, 2026')).toBe('2026-09-14');
    expect(d('Datum 1.9.2026')).toBe('2026-09-01');
  });
  it('unmögliche oder unplausible Daten zählen nicht (älter als 3 Jahre, mehr als 60 Tage voraus)', () => {
    expect(d('Datum 31.02.2026')).toBeNull();
    expect(d('Datum 01.01.2020')).toBeNull();
    expect(d('Datum 01.03.2027')).toBeNull();
    expect(d('Datum 01.12.2026')).toBe('2026-12-01');
  });
  it('Rechnungsdatum schlägt Liefer- und Fälligkeitsdatum', () => {
    const Zs = ['Lieferdatum: 01.10.2026', 'Zahlbar bis: 15.10.2026', 'Rechnungsdatum: 03.10.2026'];
    expect(findeDatum(Zs, HEUTE)).toEqual({ d: '2026-10-03', s: 'hoch' });
  });
  it('Lastschrift: Abbuchungsdatum, aber „zahlbar bis“ ist nur eine Frist', () => {
    expect(findeAbbuchung(['Der Betrag wird am 02.11.2026 per Lastschrift eingezogen.'], HEUTE)).toBe('2026-11-02');
    expect(findeAbbuchung(['Abbuchung am 30.10.2026'], HEUTE)).toBe('2026-10-30');
    expect(findeAbbuchung(['Zahlbar bis 30.10.2026 per Lastschrift'], HEUTE)).toBeNull();
    expect(findeAbbuchung(['Rechnungsdatum 01.10.2026'], HEUTE)).toBeNull();
  });
  it('Lastschrift am selben Tag ⇒ kein Hinweis, kein Belegdatum', () => {
    const e = erkenne({ text: 'Firma GmbH\nRechnungsdatum  05.10.2026\nGesamtbetrag  10,00 €\nWird am 05.10.2026 abgebucht.', dateiname: 'r.pdf', kontext: ctx() });
    expect(e.felder.zahlungsdatum).toBe('2026-10-05');
    expect(e.felder.belegdatum).toBeUndefined();
    expect(e.hinweise).toEqual([]);
  });
});

describe('Rechnungs- und Bonnummer', () => {
  it('Beschriftung davor, Rechnungsnummer vor Bestellnummer', () => {
    expect(findeNummer(['Bestellnummer: 99887', 'Rechnungs-Nr.: RE-2026-0815'])).toEqual({ w: 'RE-2026-0815', s: 'hoch' });
    expect(findeNummer(['Invoice No. INV-77'])).toEqual({ w: 'INV-77', s: 'hoch' });
    expect(findeNummer(['Rechnungsnr. / Invoice Number: 2026-114'])?.w).toBe('2026-114');
    expect(findeNummer(['Bon 0042-118  Kasse 2'])).toEqual({ w: '0042-118', s: 'hoch' });
    expect(findeNummer(['Auftragsnummer 5521'])).toEqual({ w: '5521', s: 'mittel' });
  });
  it('Wert in der Zeile darunter (gleiche Spalte)', () => {
    expect(findeNummer(['Rechnungsnummer  Datum', 'A-4711  05.10.2026'])?.w).toBe('A-4711');
  });
  it('Betrag oder Datum ist keine Nummer', () => {
    expect(findeNummer(['Rechnungsnr. 05.10.2026'])).toBeNull();
    expect(findeNummer(['Beleg-Nr. 12,50'])).toBeNull();
  });
});

describe('Geschäft und Kategorie', () => {
  it('Kurzname ohne Rechtsform', () => {
    expect(kurzName('Telekom Deutschland GmbH')).toBe('Telekom');
    expect(kurzName('Muster & Co. GmbH & Co. KG')).toBe('Muster & Co.');
    expect(kurzName('GmbH')).toBe('GmbH');
  });
  it('kurze Stichworte nur als ganzes Wort („esso“ ist nicht „Espresso“)', () => {
    const e = erkenne({ text: 'Café Sonne\nEspresso  2,40\nSumme  2,40 €', dateiname: 'bon.pdf', kontext: ctx() });
    expect(e.felder.kategorie_id).toBe(4); // interne Liste: Bewirtung ⇒ keine eigene Kategorie ⇒ Sonstige Kosten
    expect(e.felder.beschreibung).toBe('Bewirtung · Café Sonne');
  });
  it('Historie des Geschäfts schlägt Stichworte', () => {
    const e = erkenne({ text: BAUHAUS, dateiname: 'b.pdf', kontext: ctx({ geschaefte: [{ name: 'Bauhaus', anzahl: 1, kategorie_id: 4 }] }) });
    expect(e.felder.lieferant).toBe('Bauhaus');
    expect(e.felder.kategorie_id).toBe(4);
    expect(e.sicherheit.kategorie_id).toBe('mittel');
  });
  it('ohne Stichwort: interne Wortliste ⇒ Wareneingangs-Kategorie', () => {
    const e = erkenne({ text: 'Holzhandel Meier\nEichenbohle 2 m  89,00\nGesamt  89,00 €', dateiname: 'h.pdf', kontext: ctx() });
    expect(e.felder.kategorie_id).toBe(2);
    expect(e.felder.lieferant).toBe('Holzhandel Meier');
  });
  it('keine Kategorien ⇒ keine Kategorie, nie eine erfundene', () => {
    const e = erkenne({ text: BAUHAUS, dateiname: 'b.pdf', kontext: ctx({ kategorien: [] }) });
    expect(e.felder.kategorie_id).toBeUndefined();
    expect(e.zusammenfassung).toBe(`Erkannt: 47,83${NBSP}€ · 14.09.2026 · Bauhaus`);
  });
});

describe('Eigene Belege ⇒ Einnahme', () => {
  const EIGENE = [
    'Mustermann Haus- & Gartenservice',
    'Lindenweg 12 · 12345 Musterstadt',
    'Rechnung',
    'Rechnungsnummer  RE-2026-012',
    'Rechnungsdatum  12.10.2026',
    'Rasen mähen und Hecke schneiden  120,00 €',
    'Gesamtbetrag  120,00 €',
    'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    'Steuernummer 12/345/67890 · IBAN DE89 3704 0044 0532 0130 00',
  ].join('\n');
  it('eigene Steuernummer, IBAN und Briefkopf ⇒ Einnahme mit Kleinunternehmer-Kategorie, ohne Geschäft', () => {
    const e = erkenne({ text: EIGENE, dateiname: 'RE-2026-012.pdf', kontext: ctx() });
    expect(e.felder).toMatchObject({ typ: 'einnahme', betrag_cent: 12000, zahlungsdatum: '2026-10-12', belegnummer: 'RE-2026-012', kategorie_id: 1 });
    expect(e.felder.lieferant).toBeUndefined();
    expect(e.felder.beschreibung).toBe('Rechnung RE-2026-012 · Rasen mähen');
    expect(e.sicherheit.typ).toBe('hoch');
    expect(e.sicherheit.belegnummer).toBe('hoch'); // PDF und Dateiname stimmen überein
    expect(e.hinweise).toContain('Eigener Beleg erkannt (eigene Steuernummer bzw. Briefkopf) – als Einnahme vorgeschlagen.');
  });
  it('Steuernummer mit Leerzeichen statt Schrägstrichen zählt auch', () => {
    const e = erkenne({ text: 'Quittung\nSumme  50,00 €\nSt.-Nr. 12 345 67890', dateiname: 'q.pdf', kontext: ctx() });
    expect(e.felder.typ).toBe('einnahme');
  });
  it('eigene IBAN nur als Lastschrift-Konto einer fremden Rechnung zählt nicht', () => {
    const t = 'Stadtwerke Musterstadt GmbH\nGesamtbetrag  80,00 €\nWir buchen per Lastschrift von Ihrem Konto DE89 3704 0044 0532 0130 00 ab.';
    expect(erkenne({ text: t, dateiname: 's.pdf', kontext: ctx() }).felder.typ).toBeUndefined();
  });
  it('ohne Firmendaten nie Einnahme', () => {
    expect(erkenne({ text: EIGENE, dateiname: 'x.pdf', kontext: ctx({ firma: null }) }).felder.typ).toBeUndefined();
  });
});

describe('Dateiname', () => {
  it('Datum, Betrag und Wörter als Geschäft (unsicher)', () => {
    const e = erkenne({ text: null, dateiname: '2026-09-14_Bauhaus_47,83.jpg', kontext: ctx() });
    expect(e.felder).toMatchObject({ betrag_cent: 4783, zahlungsdatum: '2026-09-14', lieferant: 'Bauhaus', kategorie_id: 2 });
    expect(e.herkunft).toMatchObject({ betrag_cent: 'dateiname', zahlungsdatum: 'dateiname', lieferant: 'dateiname', kategorie_id: 'dateiname' });
    expect(e.sicherheit.lieferant).toBe('niedrig');
    expect(e.quelle).toBe('dateiname');
  });
  it('weitere Muster: 14.09.2026, 20260914, Betrag mit €, Rechnungsnummer', () => {
    expect(erkenne({ text: null, dateiname: 'Beleg 14.09.2026 12 EUR.pdf', kontext: ctx() }).felder).toMatchObject({ zahlungsdatum: '2026-09-14', betrag_cent: 1200 });
    expect(erkenne({ text: null, dateiname: 'IMG_20260914_101500.jpg', kontext: ctx() }).felder.zahlungsdatum).toBe('2026-09-14');
    expect(erkenne({ text: null, dateiname: 'Rechnung_RE-2026-012.pdf', kontext: ctx() }).felder.belegnummer).toBe('RE-2026-012');
  });
  it('bekanntes Geschäft im Namen ⇒ Geschäft und dessen Kategorie', () => {
    const e = erkenne({ text: null, dateiname: 'Rechnung_Telekom.pdf', kontext: ctx({ geschaefte: HISTORIE }) });
    expect(e.felder).toMatchObject({ lieferant: 'Telekom Deutschland', kategorie_id: 4 });
    expect(e.felder.betrag_cent).toBeUndefined();
    expect(e.hinweise).toContain('Kein Betrag erkannt – bitte eintragen.');
  });
  it('nichtssagender Name ⇒ nichts erkannt', () => {
    const e = erkenne({ text: null, dateiname: 'Scan_0001.jpg', kontext: ctx(), hinweise: ['Foto bzw. Scan: …'] });
    expect(e.felder).toEqual({});
    expect(e.quelle).toBe('keine');
    expect(e.zusammenfassung).toBe('');
    expect(e.hinweise).toEqual(['Foto bzw. Scan: …']);
  });
});

describe('Zusammenführen', () => {
  it('PDF gewinnt, Dateiname füllt Lücken; Übereinstimmung erhöht die Sicherheit', () => {
    const e = erkenne({ text: 'Beispiel Handel GmbH\nGesamt  12,50 €', dateiname: '2026-10-01_Beispiel_12,50.pdf', kontext: ctx() });
    expect(e.felder).toMatchObject({ betrag_cent: 1250, zahlungsdatum: '2026-10-01', lieferant: 'Beispiel Handel GmbH' });
    expect(e.herkunft).toMatchObject({ betrag_cent: 'pdf', zahlungsdatum: 'dateiname', lieferant: 'pdf' });
    expect(e.sicherheit.betrag_cent).toBe('hoch');
  });
  it('abweichender Betrag im Dateinamen ⇒ Hinweis', () => {
    const e = erkenne({ text: 'Beispiel Handel GmbH\nGesamt  12,50 €', dateiname: 'Beispiel_13,00.pdf', kontext: ctx() });
    expect(e.felder.betrag_cent).toBe(1250);
    expect(e.hinweise).toEqual([`Betrag im Dateinamen (13,00${NBSP}€) weicht vom PDF (12,50${NBSP}€) ab – bitte prüfen.`]);
  });
  it('PDF ohne lesbaren Text (Scan) ⇒ Hinweis, nur Dateiname', () => {
    const e = erkenne({ text: '', dateiname: 'Bauhaus 2026-09-14.pdf', kontext: ctx() });
    expect(e.quelle).toBe('dateiname');
    expect(e.hinweise[0]).toBe('Im PDF steht kein lesbarer Text (Scan?) – nur der Dateiname wurde ausgewertet.');
  });
});

describe('Textaufbereitung', () => {
  it('gesperrte Schrift wird zusammengezogen, Steuerzeichen fallen weg, geschützte Leerzeichen werden normal', () => {
    expect(zeilenVon('S u m m e E U R  7 8 , 9 5\n\u0002Te\u0003xt\nA B\n\n  ')).toEqual(['SummeEUR  78,95', 'Text', 'A B']);
  });
  it('kurze Folgen bleiben (2 x 3,49)', () => {
    expect(Z('2 x 3,49  6,98 A')).toEqual(['2 x 3,49  6,98 A']);
  });
  it('Zusammenfassung nur aus vorhandenen Teilen', () => {
    expect(zusammenfassung({ betrag_cent: 123456, kategorie_id: 3 }, KATEGORIEN)).toBe(`Erkannt: 1.234,56${NBSP}€ · Sprit & Fahrzeug`);
    expect(zusammenfassung({}, KATEGORIEN)).toBe('');
  });
});
