import { describe, expect, it } from 'vitest';
import {
  SORT_START,
  adresseKurz,
  adresseVoll,
  eintragStatus,
  farbton,
  formularAus,
  gleicherName,
  initialen,
  istBesuch,
  kartenLink,
  kennzeile,
  kundenIndex,
  kundenListe,
  leeresKundeFormular,
  loeschenAb,
  mailLink,
  monatJahr,
  notizWert,
  pruefeKunde,
  suchTreffer,
  tageZwischen,
  telLink,
  terminKurz,
  terminLang,
  vorText,
  zaehleFilter,
  type KundeZeile,
  type KundenInfo,
  type VerlaufZeile,
} from './kunden';

const HEUTE = '2026-10-15';

const kunde = (k: Partial<KundeZeile> & { id: number; name: string }): KundeZeile => ({
  nummer: `K-${String(k.id).padStart(4, '0')}`,
  zusatz: null,
  strasse: null,
  plz: null,
  ort: null,
  email: null,
  telefon: null,
  notiz: null,
  erstellt_am: '2025-03-10T09:00:00Z',
  gebunden: 0,
  frist_datum: null,
  ...k,
});

let naechsteId = 1;
const beleg = (z: Partial<VerlaufZeile> & { kunde_id: number; datum: string }): VerlaufZeile => ({
  quelle: 'beleg',
  id: naechsteId++,
  art: 'quittung',
  von: null,
  bis: null,
  nummer: `QU-${naechsteId}`,
  status: 'bezahlt',
  betrag_cent: 10_000,
  leistung: 'Rasen mähen',
  positionen: null,
  zahlungsart: 'bar',
  faellig_am: null,
  notiz: null,
  termin_id: null,
  belegnummer: null,
  belege_anzahl: 0,
  ...z,
});
const einnahme = (z: Partial<VerlaufZeile> & { kunde_id: number; datum: string }): VerlaufZeile =>
  beleg({ quelle: 'einnahme', art: 'einnahme', nummer: `2026-${naechsteId}`, leistung: 'Hecke schneiden', ...z });
const termin = (z: Partial<VerlaufZeile> & { kunde_id: number; datum: string }): VerlaufZeile =>
  beleg({ quelle: 'termin', art: 'termin', nummer: null, status: 'geplant', betrag_cent: null, leistung: 'Fenster putzen', zahlungsart: null, ...z });

const info = (k: KundeZeile, verlauf: VerlaufZeile[], heute = HEUTE): KundenInfo => kundenIndex([k], verlauf, heute).get(k.id)!;

describe('Besuche', () => {
  it('zählt Quittungen, Rechnungen und Einnahmen ohne Beleg bis heute', () => {
    const x = info(kunde({ id: 1, name: 'Anna' }), [
      beleg({ kunde_id: 1, datum: '2026-10-03' }),
      beleg({ kunde_id: 1, datum: '2026-09-01', art: 'rechnung', status: 'offen', faellig_am: '2026-09-15' }),
      einnahme({ kunde_id: 1, datum: '2026-08-20' }),
    ]);
    expect(x.besuche).toBe(3);
    expect(x.zuletzt).toBe('2026-10-03');
    expect(x.letzterBesuch?.titel).toBe('Rasen mähen');
  });

  it('zählt keine Entwürfe, stornierten, Angebote, Termine und nichts nach heute', () => {
    const x = info(kunde({ id: 1, name: 'Anna' }), [
      beleg({ kunde_id: 1, datum: '2026-10-01', status: 'entwurf', nummer: null }),
      beleg({ kunde_id: 1, datum: '2026-10-02', status: 'storniert' }),
      beleg({ kunde_id: 1, datum: '2026-10-03', art: 'angebot', status: 'offen' }),
      einnahme({ kunde_id: 1, datum: '2026-10-04', status: 'storniert' }),
      termin({ kunde_id: 1, datum: '2026-10-05', status: 'erledigt' }),
      termin({ kunde_id: 1, datum: '2026-10-06', status: 'geplant' }),
      beleg({ kunde_id: 1, datum: '2026-10-20' }),
    ]);
    expect(x.besuche).toBe(0);
    expect(x.zuletzt).toBeNull();
    expect(x.eintraege).toHaveLength(7);
  });

  it('istBesuch einzeln', () => {
    expect(istBesuch({ quelle: 'beleg', art: 'quittung', status: 'bezahlt', datum: HEUTE }, HEUTE)).toBe(true);
    expect(istBesuch({ quelle: 'beleg', art: 'rechnung', status: 'offen', datum: '2026-01-01' }, HEUTE)).toBe(true);
    expect(istBesuch({ quelle: 'beleg', art: 'quittung', status: 'bezahlt', datum: '2026-10-16' }, HEUTE)).toBe(false);
    expect(istBesuch({ quelle: 'einnahme', art: 'einnahme', status: 'bezahlt', datum: HEUTE }, HEUTE)).toBe(true);
    expect(istBesuch({ quelle: 'termin', art: 'termin', status: 'erledigt', datum: '2026-01-01' }, HEUTE)).toBe(false);
  });

  it('Umsatz: ausgestellte Quittungen/Rechnungen und Einnahmen, ohne Entwürfe, Angebote und Storno', () => {
    const x = info(kunde({ id: 1, name: 'Anna' }), [
      beleg({ kunde_id: 1, datum: '2026-10-01', betrag_cent: 12_050 }),
      beleg({ kunde_id: 1, datum: '2026-10-02', betrag_cent: 5_000, art: 'rechnung', status: 'offen' }),
      einnahme({ kunde_id: 1, datum: '2026-10-03', betrag_cent: 3_333 }),
      beleg({ kunde_id: 1, datum: '2026-10-04', betrag_cent: 99_999, status: 'entwurf' }),
      beleg({ kunde_id: 1, datum: '2026-10-05', betrag_cent: 99_999, art: 'angebot', status: 'offen' }),
      beleg({ kunde_id: 1, datum: '2026-10-06', betrag_cent: 99_999, status: 'storniert' }),
      einnahme({ kunde_id: 1, datum: '2026-10-07', betrag_cent: 99_999, status: 'storniert' }),
      termin({ kunde_id: 1, datum: '2026-10-20', betrag_cent: 99_999 }),
    ]);
    expect(x.umsatz).toBe(20_383);
  });
});

describe('Einträge im Verlauf', () => {
  it('Status je Quelle', () => {
    const b = { quelle: 'beleg' as const, art: 'rechnung' as const, datum: '2026-09-01', faellig_am: '2026-09-15', termin_id: null };
    expect(eintragStatus({ ...b, status: 'offen' }, HEUTE)).toBe('ueberfaellig');
    expect(eintragStatus({ ...b, status: 'offen', faellig_am: '2026-10-20' }, HEUTE)).toBe('offen');
    expect(eintragStatus({ ...b, status: 'offen', faellig_am: HEUTE }, HEUTE)).toBe('offen');
    expect(eintragStatus({ ...b, status: 'bezahlt' }, HEUTE)).toBe('bezahlt');
    expect(eintragStatus({ ...b, status: 'entwurf' }, HEUTE)).toBe('entwurf');
    expect(eintragStatus({ ...b, status: 'entwurf', termin_id: 4 }, HEUTE)).toBe('vorbereitet');
    expect(eintragStatus({ ...b, status: 'storniert' }, HEUTE)).toBe('storniert');
    expect(eintragStatus({ ...b, art: 'quittung', status: 'offen', faellig_am: '2026-01-01' }, HEUTE)).toBe('offen');
    expect(eintragStatus({ ...b, art: 'angebot', status: 'offen' }, HEUTE)).toBe('angebot');
    expect(eintragStatus({ ...b, art: 'angebot', status: 'angenommen' }, HEUTE)).toBe('angenommen');
    const t = { quelle: 'termin' as const, art: 'termin' as const, faellig_am: null, termin_id: null };
    expect(eintragStatus({ ...t, status: 'geplant', datum: HEUTE }, HEUTE)).toBe('geplant');
    expect(eintragStatus({ ...t, status: 'geplant', datum: '2026-10-14' }, HEUTE)).toBe('nachtragen');
    expect(eintragStatus({ ...t, status: 'abgesagt', datum: '2026-10-14' }, HEUTE)).toBe('abgesagt');
    expect(eintragStatus({ ...t, status: 'erledigt', datum: '2026-10-14' }, HEUTE)).toBe('erledigt');
    const e = { quelle: 'einnahme' as const, art: 'einnahme' as const, datum: HEUTE, faellig_am: null, termin_id: null };
    expect(eintragStatus({ ...e, status: 'bezahlt' }, HEUTE)).toBe('bezahlt');
    expect(eintragStatus({ ...e, status: 'storniert' }, HEUTE)).toBe('storniert');
  });

  it('neueste zuerst, Kommendes oben', () => {
    const x = info(kunde({ id: 1, name: 'Anna' }), [
      beleg({ kunde_id: 1, datum: '2026-05-01', leistung: 'alt' }),
      termin({ kunde_id: 1, datum: '2026-10-20', leistung: 'kommt' }),
      einnahme({ kunde_id: 1, datum: '2026-10-01', leistung: 'neu' }),
    ]);
    expect(x.eintraege.map((e) => e.titel)).toEqual(['kommt', 'neu', 'alt']);
  });

  it('vorbereiteter Beleg hängt am Termin; erledigte Termine mit Beleg erscheinen nicht doppelt', () => {
    const t1 = termin({ kunde_id: 1, datum: '2026-10-20', leistung: 'Hecke' });
    const vorb = beleg({ kunde_id: 1, datum: '2026-10-20', status: 'entwurf', nummer: null, termin_id: t1.id });
    const t2 = termin({ kunde_id: 1, datum: '2026-10-01', status: 'erledigt', leistung: 'Rasen' });
    const zuT2 = beleg({ kunde_id: 1, datum: '2026-10-01', termin_id: t2.id });
    const t3 = termin({ kunde_id: 1, datum: '2026-09-01', status: 'erledigt', leistung: 'Laub' });
    const zuT3 = einnahme({ kunde_id: 1, datum: '2026-09-02', termin_id: t3.id });
    const t4 = termin({ kunde_id: 1, datum: '2026-08-01', status: 'erledigt', leistung: 'ohne Beleg' });
    const t5 = termin({ kunde_id: 1, datum: '2026-07-01', status: 'erledigt', leistung: 'Entwurf offen' });
    const entwurf5 = beleg({ kunde_id: 1, datum: '2026-07-01', status: 'entwurf', nummer: null, termin_id: t5.id });
    const x = info(kunde({ id: 1, name: 'Anna' }), [t1, vorb, t2, zuT2, t3, zuT3, t4, t5, entwurf5]);
    const ids = x.eintraege.map((e) => e.z.id);
    expect(ids).toContain(t1.id);
    expect(ids).not.toContain(vorb.id);
    expect(x.eintraege.find((e) => e.z.id === t1.id)?.vorbereitet).toBe(vorb);
    expect(ids).not.toContain(t2.id);
    expect(ids).not.toContain(t3.id);
    expect(ids).toContain(t4.id);
    expect(ids).toContain(t5.id);
    expect(x.eintraege.find((e) => e.z.id === entwurf5.id)?.status).toBe('entwurf');
    expect(x.besuche).toBe(2);
    expect(x.naechster?.z.id).toBe(t1.id);
  });

  it('nächster Termin, nachtragen, offene Rechnungen', () => {
    const x = info(kunde({ id: 1, name: 'Anna' }), [
      termin({ kunde_id: 1, datum: '2026-11-02', von: '08:00' }),
      termin({ kunde_id: 1, datum: '2026-10-22', von: '14:00' }),
      termin({ kunde_id: 1, datum: '2026-10-22', von: '09:00', leistung: 'früh' }),
      termin({ kunde_id: 1, datum: '2026-10-10' }),
      beleg({ kunde_id: 1, datum: '2026-09-01', art: 'rechnung', status: 'offen', faellig_am: '2026-09-15' }),
      beleg({ kunde_id: 1, datum: '2026-10-10', art: 'rechnung', status: 'offen', faellig_am: '2026-10-24' }),
      beleg({ kunde_id: 1, datum: '2026-10-11', art: 'rechnung', status: 'bezahlt' }),
    ]);
    expect(x.naechster?.titel).toBe('früh');
    expect(x.geplant).toBe(3);
    expect(x.nachtragen).toHaveLength(1);
    expect(x.offen.map((e) => e.status)).toEqual(['offen', 'ueberfaellig']);
  });

  it('Titel: Name am Ende weg, sonst Positionen bzw. Art', () => {
    const k = kunde({ id: 7, name: 'Anna Schmidt' });
    const x = info(k, [
      einnahme({ kunde_id: 7, datum: '2026-10-01', leistung: 'Rasen mähen · Anna Schmidt' }),
      einnahme({ kunde_id: 7, datum: '2026-09-01', leistung: 'Hecke · Anna Schmidt · K-0007' }),
      beleg({ kunde_id: 7, datum: '2026-08-01', leistung: null, positionen: 'Fenster · Rahmen' }),
      beleg({ kunde_id: 7, datum: '2026-07-01', art: 'rechnung', leistung: '  ' }),
    ]);
    expect(x.eintraege.map((e) => e.titel)).toEqual(['Rasen mähen', 'Hecke', 'Fenster', 'Rechnung']);
  });

  it('Kunde seit: Anlage oder früherer Eintrag', () => {
    const k = kunde({ id: 1, name: 'Anna', erstellt_am: '2026-10-01T10:00:00Z' });
    expect(info(k, []).seit).toBe('2026-10-01');
    expect(info(k, [beleg({ kunde_id: 1, datum: '2025-03-04' })]).seit).toBe('2025-03-04');
    expect(info(k, [termin({ kunde_id: 1, datum: '2026-12-01' })]).seit).toBe('2026-10-01');
  });

  it('gruppiert nach Kunde, Kunden ohne Verlauf sind dabei', () => {
    const ix = kundenIndex(
      [kunde({ id: 1, name: 'A' }), kunde({ id: 2, name: 'B' })],
      [beleg({ kunde_id: 2, datum: '2026-10-01' }), beleg({ kunde_id: 3, datum: '2026-10-01' })],
      HEUTE,
    );
    expect(ix.size).toBe(2);
    expect(ix.get(1)?.eintraege).toHaveLength(0);
    expect(ix.get(2)?.besuche).toBe(1);
  });
});

describe('Liste', () => {
  const kunden = [
    kunde({ id: 1, name: 'Anna Schmidt', strasse: 'Gartenweg 3', ort: 'Musterstadt', telefon: '0171 234 5678', erstellt_am: '2024-01-01T00:00:00Z' }),
    kunde({ id: 2, name: 'Bernd Müller', ort: 'Neustadt', notiz: 'Hund im Garten', erstellt_am: '2024-01-01T00:00:00Z' }),
    kunde({ id: 3, name: 'Carla Neu', erstellt_am: '2026-10-14T08:00:00Z' }),
    kunde({ id: 4, name: 'Dora Bald', erstellt_am: '2024-01-01T00:00:00Z' }),
    kunde({ id: 5, name: 'Emil Alt', erstellt_am: '2024-01-01T00:00:00Z' }),
    kunde({ id: 6, name: 'Frida Frisch', erstellt_am: '2026-10-15T07:00:00Z' }),
  ];
  const verlauf = [
    beleg({ kunde_id: 1, datum: '2026-10-03', leistung: 'Rasen mähen' }),
    beleg({ kunde_id: 1, datum: '2026-05-03', leistung: 'Vertikutieren', positionen: 'Vertikutieren · Moos entfernen' }),
    einnahme({ kunde_id: 2, datum: '2026-10-10', leistung: 'Fenster putzen' }),
    termin({ kunde_id: 4, datum: '2026-10-25', leistung: 'Hecke' }),
    beleg({ kunde_id: 5, datum: '2025-02-01' }),
    beleg({ kunde_id: 5, datum: '2025-03-01' }),
  ];
  const ix = kundenIndex(kunden, verlauf, HEUTE);
  const namen = (o: Partial<Parameters<typeof kundenListe>[1]> = {}) =>
    kundenListe(ix.values(), { q: '', filter: 'alle', sort: 'zuletzt', richtung: SORT_START.zuletzt, ...o }).map((t) => t.info.k.name);

  it('„zuletzt da“: neu ohne Einträge oben (neueste zuerst), dann kommende Termine, dann nach letztem Besuch', () => {
    expect(namen()).toEqual(['Frida Frisch', 'Carla Neu', 'Dora Bald', 'Bernd Müller', 'Anna Schmidt', 'Emil Alt']);
    expect(namen({ richtung: 1 })).toEqual(['Emil Alt', 'Anna Schmidt', 'Bernd Müller', 'Dora Bald', 'Carla Neu', 'Frida Frisch']);
  });

  it('nach Name und nach Besuchen', () => {
    expect(namen({ sort: 'name', richtung: 1 })).toEqual(['Anna Schmidt', 'Bernd Müller', 'Carla Neu', 'Dora Bald', 'Emil Alt', 'Frida Frisch']);
    expect(namen({ sort: 'besuche', richtung: -1 }).slice(0, 3)).toEqual(['Anna Schmidt', 'Emil Alt', 'Bernd Müller']);
  });

  it('Filter und ihre Zähler', () => {
    expect(namen({ filter: 'stamm' })).toEqual(['Anna Schmidt', 'Emil Alt']);
    expect(namen({ filter: 'notiz' })).toEqual(['Bernd Müller']);
    expect(zaehleFilter(ix.values())).toEqual({ alle: 6, stamm: 2, notiz: 1 });
  });

  it('Suche über Name, Straße, Ort, Telefon, Notiz und Leistung', () => {
    expect(namen({ q: 'schmidt' })).toEqual(['Anna Schmidt']);
    expect(namen({ q: 'gartenweg' })).toEqual(['Anna Schmidt']);
    expect(namen({ q: 'NEUSTADT' })).toEqual(['Bernd Müller']);
    expect(namen({ q: 'mueller' })).toEqual([]); // ü ⇒ u, nicht ue
    expect(namen({ q: 'muller' })).toEqual(['Bernd Müller']);
    expect(namen({ q: 'hund' })).toEqual(['Bernd Müller']);
    expect(namen({ q: '01712345678' })).toEqual(['Anna Schmidt']);
    expect(namen({ q: '234 56' })).toEqual(['Anna Schmidt']);
    expect(namen({ q: 'fenster' })).toEqual(['Bernd Müller']);
    expect(namen({ q: 'moos' })).toEqual(['Anna Schmidt']);
    expect(namen({ q: 'anna moos' })).toEqual(['Anna Schmidt']);
    expect(namen({ q: 'anna fenster' })).toEqual([]);
    expect(namen({ q: '  ' })).toHaveLength(6);
  });

  it('Treffer in einer Leistung zeigt diesen Eintrag', () => {
    const anna = ix.get(1)!;
    expect(suchTreffer(anna, 'anna')?.eintrag).toBeNull();
    expect(suchTreffer(anna, 'moos')?.eintrag?.titel).toBe('Vertikutieren');
    expect(suchTreffer(anna, 'gibtsnicht')).toBeNull();
  });
});

describe('Anzeige', () => {
  it('Initialen', () => {
    expect(initialen('Anna Schmidt')).toBe('AS');
    expect(initialen('Müller')).toBe('MÜ');
    expect(initialen('Gartenbau Krause GmbH')).toBe('GK');
    expect(initialen('Dr. Ödön von Horváth')).toBe('ÖV');
    expect(initialen('  émile  zola ')).toBe('ÉZ');
    expect(initialen('')).toBe('?');
    expect(initialen('X')).toBe('X');
  });

  it('Farbton aus dem Namen: stabil, 0–359', () => {
    expect(farbton('Anna Schmidt')).toBe(farbton('Anna Schmidt'));
    expect(farbton('Anna Schmidt')).not.toBe(farbton('Anna Schmid'));
    for (const n of ['', 'a', 'Zacharias Ölmüller-Großkreutz GmbH & Co. KG']) {
      const h = farbton(n);
      expect(Number.isInteger(h) && h >= 0 && h < 360).toBe(true);
    }
    expect(farbton('a')).toBe(97);
  });

  it('Tage zwischen zwei Daten (über Sommerzeit und Jahreswechsel)', () => {
    expect(tageZwischen('2026-10-15', '2026-10-15')).toBe(0);
    expect(tageZwischen('2026-03-28', '2026-03-30')).toBe(2);
    expect(tageZwischen('2026-10-24', '2026-10-26')).toBe(2);
    expect(tageZwischen('2025-12-31', '2026-01-01')).toBe(1);
    expect(tageZwischen('2026-10-15', '2026-10-01')).toBe(-14);
  });

  it('relativer Text', () => {
    expect(vorText(HEUTE, HEUTE)).toBe('heute');
    expect(vorText('2026-10-14', HEUTE)).toBe('gestern');
    expect(vorText('2026-10-03', HEUTE)).toBe('vor 12 Tagen');
    expect(vorText('2026-10-01', HEUTE)).toBe('vor 2 Wochen');
    expect(vorText('2026-08-17', HEUTE)).toBe('vor 8 Wochen');
    expect(vorText('2026-08-16', HEUTE)).toBe('vor 2 Monaten');
    expect(vorText('2025-03-15', HEUTE)).toBe('vor 19 Monaten');
    expect(vorText('2024-10-15', HEUTE)).toBe('vor 2 Jahren');
    expect(vorText('2016-10-15', HEUTE)).toBe('vor 10 Jahren');
    expect(vorText('2026-10-16', HEUTE)).toBe('morgen');
    expect(vorText('2026-10-20', HEUTE)).toBe('in 5 Tagen');
    expect(vorText('2026-11-15', HEUTE)).toBe('in 4 Wochen');
  });

  it('Termine kurz und lang', () => {
    expect(terminKurz({ datum: HEUTE, von: '08:00' }, HEUTE)).toBe('heute 08:00');
    expect(terminKurz({ datum: '2026-10-16', von: null }, HEUTE)).toBe('morgen');
    expect(terminKurz({ datum: '2026-10-20', von: '08:00' }, HEUTE)).toBe('Di 20.10.');
    expect(terminLang({ datum: '2026-10-16', von: '08:00', bis: '10:00' }, HEUTE)).toBe('Morgen · 08:00–10:00');
    expect(terminLang({ datum: '2026-10-20', von: null, bis: null }, HEUTE)).toBe('Di, 20.10.');
    expect(terminLang({ datum: '2027-01-05', von: '09:30', bis: null }, HEUTE)).toBe('Di, 05.01.2027 · 09:30');
  });

  it('Kennzeile', () => {
    expect(kennzeile({ besuche: 3, zuletzt: '2026-10-03', seit: '2025-03-10' }, HEUTE).join(' · ')).toBe(
      '3 Besuche · zuletzt vor 12 Tagen · Kunde seit März 2025',
    );
    expect(kennzeile({ besuche: 1, zuletzt: HEUTE, seit: HEUTE }, HEUTE).join(' · ')).toBe('1 Besuch · zuletzt heute · Kunde seit Oktober 2026');
    expect(kennzeile({ besuche: 0, zuletzt: null, seit: '2026-01-02' }, HEUTE)).toEqual(['Noch kein Besuch', 'Kunde seit Januar 2026']);
    expect(monatJahr('2025-12-01')).toBe('Dezember 2025');
  });

  it('Löschen ab: Jahr der letzten Buchung bzw. des letzten Belegs + 10, danach anonymisierbar', () => {
    expect(loeschenAb('2026-03-01')).toEqual({ bis: '2036-12-31', ab: 2037 });
    expect(loeschenAb('2019-12-31')).toEqual({ bis: '2029-12-31', ab: 2030 });
    expect(loeschenAb(null)).toBeNull();
    expect(loeschenAb('')).toBeNull();
  });

  it('Adresse und Links', () => {
    const k = { strasse: 'Gartenweg 3', plz: '12345', ort: 'Musterstadt' };
    expect(adresseKurz(k)).toBe('Gartenweg 3, Musterstadt');
    expect(adresseVoll(k)).toBe('Gartenweg 3, 12345 Musterstadt');
    expect(adresseVoll({ strasse: null, plz: '12345', ort: null })).toBe('12345');
    expect(kartenLink(k)).toBe('https://maps.apple.com/?q=Gartenweg%203%2C%2012345%20Musterstadt');
    expect(kartenLink({ strasse: null, plz: null, ort: null })).toBeNull();
    expect(telLink('+49 (171) 234-5678')).toBe('tel:+491712345678');
    expect(telLink('0171 / 23 45')).toBe('tel:01712345');
    expect(telLink('12')).toBeNull();
    expect(telLink(null)).toBeNull();
    expect(mailLink(' anna@example.de ')).toBe('mailto:anna@example.de');
    expect(mailLink('anna@example')).toBeNull();
    expect(mailLink('anna@example.de?subject=x')).toBeNull();
    expect(mailLink('')).toBeNull();
  });
});

describe('Formular', () => {
  it('prüft und bereinigt wie kunden.rs', () => {
    const f = { ...leeresKundeFormular('  Anna  '), ort: ' Musterstadt ', telefon: '   ', email: 'anna@example.de' };
    expect(pruefeKunde(f)).toEqual({
      ok: true,
      daten: { name: 'Anna', zusatz: null, strasse: null, plz: null, ort: 'Musterstadt', email: 'anna@example.de', telefon: null, notiz: null },
    });
    expect(pruefeKunde(leeresKundeFormular(' '))).toEqual({ ok: false, fehler: { name: 'Bitte einen Namen eingeben.' } });
    const r = pruefeKunde({ ...leeresKundeFormular('Anna'), email: 'anna(at)example' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fehler.email).toBeTruthy();
  });

  it('Formular aus Kunde und zurück', () => {
    const k = kunde({ id: 1, name: 'Anna', ort: 'Musterstadt', notiz: 'Tor' });
    const f = formularAus(k);
    expect(f.zusatz).toBe('');
    expect(pruefeKunde(f)).toMatchObject({ ok: true, daten: { name: 'Anna', ort: 'Musterstadt', notiz: 'Tor', zusatz: null } });
  });

  it('gleicher Name (Groß/klein, Leerzeichen, Akzente egal), ohne den Kunden selbst', () => {
    const l = [kunde({ id: 1, name: 'Anna Schmidt' }), kunde({ id: 2, name: 'anna  schmidt ' }), kunde({ id: 3, name: 'Anna Schmid' })];
    expect(gleicherName('ANNA SCHMIDT', l).map((k) => k.id)).toEqual([1, 2]);
    expect(gleicherName('Anna Schmidt', l, 1).map((k) => k.id)).toEqual([2]);
    expect(gleicherName('  ', l)).toEqual([]);
  });

  it('Notiz-Wert', () => {
    expect(notizWert('  Tor schließen \n')).toBe('Tor schließen');
    expect(notizWert(' \n ')).toBeNull();
  });
});
