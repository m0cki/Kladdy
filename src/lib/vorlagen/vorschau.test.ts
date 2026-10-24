import { describe, expect, it } from 'vitest';
import type { BelegVoll } from '../queries/rechnungen';
import type { ListenArt } from '../rechnungen';
import type { KeyValueStore } from '../settings';
import { BEISPIEL_FIRMA, testbeleg } from './beispiel';
import { ersetzen, istEntwurf, platzhalterWerte } from './dokument';
import { standardVorlage } from './standard';
import { VORSCHAU_KEY, ladeQuellen, letzterBeleg, speichereQuelle, vorschauDokument } from './vorschau';

const zeile = (id: number, art: ListenArt, nummer: string | null, datum: string | null) => ({ id, art, nummer, datum });

describe('Letzter Beleg je Art', () => {
  it('ausgestellt vor Entwurf, dann Belegdatum, dann ID', () => {
    const zeilen = [
      zeile(1, 'rechnung', 'RE-2026-001', '2026-10-01'),
      zeile(2, 'rechnung', 'RE-2026-002', '2026-10-05'),
      zeile(3, 'rechnung', null, '2026-10-20'), // Entwurf ist neuer, zählt aber erst ohne ausgestellten
      zeile(4, 'rechnung', 'RE-2026-003', '2026-10-05'),
      zeile(5, 'quittung', 'QU-2026-009', '2026-10-30'),
    ];
    expect(letzterBeleg(zeilen, 'rechnung')?.id).toBe(4);
    expect(letzterBeleg(zeilen, 'quittung')?.id).toBe(5);
  });

  it('ohne ausgestellten der neueste Entwurf; ohne Datum zuletzt', () => {
    const zeilen = [zeile(7, 'angebot', null, null), zeile(6, 'angebot', null, '2026-09-01'), zeile(8, 'angebot', null, '2026-08-01')];
    expect(letzterBeleg(zeilen, 'angebot')?.id).toBe(6);
  });

  it('Stornobelege zählen nicht, keine Belege ⇒ null', () => {
    expect(letzterBeleg([zeile(9, 'storno', 'RE-2026-004', '2026-10-21')], 'rechnung')).toBeNull();
    expect(letzterBeleg([], 'eigenbeleg')).toBeNull();
  });
});

/** Beleg wie ladeBeleg ihn liefert (nur die Felder, die hier zählen) */
function voll(teil: Partial<BelegVoll>): BelegVoll {
  return {
    id: 1,
    art: 'rechnung',
    nummer: null,
    status: 'entwurf',
    kunde_id: null,
    kunde_name: null,
    kunde_adresse: null,
    kunde_nummer: null,
    kunde_name_live: null,
    kunde_nummer_live: null,
    kunde_email_live: null,
    datum: '2026-10-20',
    leistung_von: '2026-10-20',
    leistung_bis: null,
    faellig_am: '2026-11-03',
    betreff: 'Gartenpflege',
    einleitung: 'Hallo',
    schlusstext: '',
    summe_cent: 0,
    zahlungsart: null,
    bezahlt_am: null,
    vorlage_id: null,
    termin_id: null,
    entwurf_json: null,
    snapshot_json: null,
    pdf_beleg_id: null,
    scan_beleg_id: null,
    storno_von_id: null,
    storniert_am: null,
    erstellt_am: '2026-10-20 10:00:00',
    geaendert_am: '2026-10-20 10:00:00',
    termin_datum: null,
    termin_von: null,
    termin_status: null,
    buchung_id: null,
    buchung_nummer: null,
    buchung_zahlungsart: null,
    storno_von_nummer: null,
    storno_von_datum: null,
    storno_von_art: null,
    storno_id: null,
    storno_nummer: null,
    rechnung_aus_angebot_id: null,
    angebot_id: null,
    angebot_nummer: null,
    ...teil,
  };
}

const KTX = { firma: BEISPIEL_FIRMA, ustModus: 'klein' as const, logo: '', kunden: [], heute: '2026-10-24' };

describe('Vorschau-Dokument aus einem echten Beleg', () => {
  it('ausgestellt: Daten aus dem Schnappschuss, aber ohne Nummer (Wasserzeichen ENTWURF); Schnappschuss unverändert', () => {
    const original = { ...testbeleg('rechnung', { ...BEISPIEL_FIRMA, name: 'Firma von damals' }, 'klein', '2026-10-01'), nummer: 'RE-2026-014' };
    const json = JSON.stringify({ version: 1, dokument: original, bausteine: standardVorlage('rechnung') });
    const b = voll({ nummer: 'RE-2026-014', status: 'storniert', snapshot_json: json });
    const doc = vorschauDokument(b, [], { ...KTX, logo: `logo-${'ab'.repeat(32)}.png` });
    expect(doc.nummer).toBeNull();
    expect(doc.storniert).toBe(false);
    expect(istEntwurf(doc)).toBe(true);
    expect(ersetzen('{nr}', platzhalterWerte(doc))).toBe('Entwurf');
    expect(doc.kunde?.name).toBe('Müller & Söhne 100%');
    expect(doc.firma.name).toBe('Firma von damals');
    expect(doc.positionen).toHaveLength(3);
    expect(doc.logo).toBe(`logo-${'ab'.repeat(32)}.png`);
    expect(b.snapshot_json).toBe(json);
    expect(b.nummer).toBe('RE-2026-014');
  });

  it('Entwurf: wie die Beleg-Maske (Kunde per ID mit Anschrift aus der Kartei)', () => {
    const kunden = [{ id: 12, nummer: 'K-0012', name: 'Anna Schmidt', zusatz: null, strasse: 'Lindenweg 4', plz: '12345', ort: 'Musterstadt', email: null }];
    const b = voll({ art: 'quittung', kunde_id: 12, kunde_name_live: 'Anna Schmidt', kunde_nummer_live: 'K-0012', zahlungsart: 'bar', faellig_am: null });
    const doc = vorschauDokument(b, [{ beschreibung: 'Rasenmähen', menge: 1, einheit: 'pausch.', einzelpreis_cent: 6500, kategorie_id: null }], { ...KTX, kunden });
    expect(doc.art).toBe('quittung');
    expect(doc.nummer).toBeNull();
    expect(doc.kunde).toMatchObject({ id: 12, nummer: 'K-0012', strasse: 'Lindenweg 4', ort: 'Musterstadt' });
    expect(doc.positionen[0].einzelpreis_cent).toBe(6500);
    expect(doc.zahlungsweg).toBe('bar');
    expect(doc.logo).toBeNull();
  });
});

const speicher = (init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

describe('Auswahl Beispiel · Letzter Beleg je Art', () => {
  it('Standard Beispiel, gemerkt je Art', () => {
    const s = speicher();
    expect(ladeQuellen(s).rechnung).toBe('beispiel');
    speichereQuelle(s, 'quittung', 'beleg');
    expect(ladeQuellen(s)).toEqual({ rechnung: 'beispiel', quittung: 'beleg', angebot: 'beispiel', eigenbeleg: 'beispiel' });
    speichereQuelle(s, 'quittung', 'beispiel');
    expect(ladeQuellen(s).quittung).toBe('beispiel');
  });

  it('kaputte oder fremde Werte ⇒ Beispiel; ohne Speicher kein Fehler', () => {
    expect(ladeQuellen(speicher({ [VORSCHAU_KEY]: '{kaputt' })).rechnung).toBe('beispiel');
    expect(ladeQuellen(speicher({ [VORSCHAU_KEY]: JSON.stringify({ quelle: { rechnung: 'irgendwas' } }) })).rechnung).toBe('beispiel');
    expect(ladeQuellen(undefined).angebot).toBe('beispiel');
    expect(speichereQuelle(undefined, 'angebot', 'beleg').angebot).toBe('beleg');
  });
});
