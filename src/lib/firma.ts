/* Firmendaten (ANLEITUNG §6.10 Abschnitt „Firma“, §2.3 Pflichtangaben, §7.4 Makros \Firma … \BIC).
 * Gespeichert als ein JSON-Objekt in einstellungen (Schlüssel 'firma', lib/queries/einstellungen.ts).
 * Reine Logik: Felder, Normalisieren, Prüfen (IBAN mit Prüfsumme), fehlende Pflichtangaben. Tests: firma.test.ts */

export const FIRMA_FELDER = [
  'name',
  'inhaber',
  'strasse',
  'plz',
  'ort',
  'email',
  'telefon',
  'web',
  'steuernummer',
  'ust_idnr',
  'ku_id',
  'bank',
  'iban',
  'bic',
  'paypal',
] as const;

export type FirmaFeld = (typeof FIRMA_FELDER)[number];
export type Firma = Record<FirmaFeld, string>;

export const FIRMA_LABEL: Readonly<Record<FirmaFeld, string>> = {
  name: 'Name des Gewerbes',
  inhaber: 'Inhaber/in',
  strasse: 'Straße und Hausnummer',
  plz: 'PLZ',
  ort: 'Ort',
  email: 'E-Mail',
  telefon: 'Telefon',
  web: 'Website',
  steuernummer: 'Steuernummer',
  ust_idnr: 'USt-IdNr.',
  ku_id: 'KU-ID',
  bank: 'Bank',
  iban: 'IBAN',
  bic: 'BIC',
  paypal: 'PayPal-Adresse',
};

export const leereFirma = (): Firma =>
  Object.fromEntries(FIRMA_FELDER.map((f) => [f, ''])) as Firma;

/** Gespeicherten Wert (beliebiges JSON) in eine vollständige Firma wandeln; Unbekanntes wird ignoriert. */
export function firmaAusJson(wert: unknown): Firma {
  const f = leereFirma();
  if (wert && typeof wert === 'object' && !Array.isArray(wert)) {
    for (const k of FIRMA_FELDER) {
      const v = (wert as Record<string, unknown>)[k];
      if (typeof v === 'string') f[k] = v;
    }
  }
  return f;
}

const ohneLeer = (s: string) => s.replace(/\s+/g, '');

/** Eingabe eines Felds so, wie sie gespeichert wird (getrimmt; IBAN/BIC/USt-IdNr. ohne Leerzeichen, groß). */
export function normalisiere(feld: FirmaFeld, wert: string): string {
  const t = wert.trim().replace(/\s+/g, ' ');
  if (feld === 'iban' || feld === 'bic' || feld === 'ust_idnr') return ohneLeer(t).toUpperCase();
  if (feld === 'plz') return ohneLeer(t);
  return t;
}

/* ---------- IBAN (ISO 13616, Prüfziffer nach ISO 7064 Mod 97-10) ---------- */

/** Länge je Land für die häufigsten Länder; andere Länder: nur Aufbau und Prüfsumme. */
const IBAN_LAENGE: Readonly<Record<string, number>> = {
  DE: 22, AT: 20, CH: 21, LI: 21, NL: 18, BE: 16, LU: 20, FR: 27, IT: 27, ES: 24, PL: 28, DK: 18, CZ: 24, GB: 22,
};

/** Rest mod 97 einer alphanumerischen Zeichenkette (A = 10 … Z = 35), ziffernweise ohne große Zahlen. */
function mod97(s: string): number {
  let r = 0;
  for (const c of s) {
    const n = parseInt(c, 36);
    r = ((n > 9 ? r * 100 : r * 10) + n) % 97;
  }
  return r;
}

/** Fehlermeldung zur IBAN oder null, wenn gültig. Leerzeichen und Kleinschreibung sind erlaubt. */
export function ibanFehler(iban: string): string | null {
  const s = ohneLeer(iban).toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return 'Eine IBAN beginnt mit Ländercode und zwei Prüfziffern, z. B. DE89 …';
  const soll = IBAN_LAENGE[s.slice(0, 2)];
  if (soll ? s.length !== soll : s.length < 15 || s.length > 34) {
    return soll ? `Eine IBAN aus ${s.slice(0, 2)} hat ${soll} Zeichen (hier ${s.length}).` : 'Die IBAN hat eine ungültige Länge.';
  }
  if (mod97(s.slice(4) + s.slice(0, 4)) !== 1) return 'Die Prüfziffer der IBAN stimmt nicht – bitte auf Tippfehler prüfen.';
  return null;
}

export const ibanGueltig = (iban: string): boolean => ibanFehler(iban) === null;

/** IBAN in Vierergruppen, z. B. „DE89 3704 0044 0532 0130 00“. */
export const ibanFormat = (iban: string): string => ohneLeer(iban).toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');

/* ---------- Einzelne Felder prüfen ---------- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Fehlermeldung zu einem (normalisierten) Feldwert oder null. Leere Felder sind hier immer erlaubt. */
export function feldFehler(feld: FirmaFeld, wert: string): string | null {
  if (!wert) return null;
  switch (feld) {
    case 'iban':
      return ibanFehler(wert);
    case 'bic':
      return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(wert) ? null : 'Eine BIC hat 8 oder 11 Zeichen, z. B. COBADEFFXXX.';
    case 'email':
    case 'paypal':
      return EMAIL.test(wert) ? null : 'Bitte eine E-Mail-Adresse angeben, z. B. name@beispiel.de.';
    case 'plz':
      return /^\d{5}$/.test(wert) ? null : 'Eine deutsche PLZ hat fünf Ziffern.';
    case 'telefon':
      return /^\+?[\d\s/()-]{4,}$/.test(wert) ? null : 'Erlaubt sind Ziffern, Leerzeichen und + / ( ) -.';
    case 'steuernummer': {
      if (!/^[\d\s/-]+$/.test(wert)) return 'Erlaubt sind Ziffern, Leerzeichen und / -, z. B. 12/345/67890.';
      const ziffern = wert.replace(/\D/g, '').length;
      return ziffern >= 10 && ziffern <= 13 ? null : 'Eine Steuernummer hat 10 bis 13 Ziffern.';
    }
    case 'ust_idnr':
      if (wert.startsWith('DE')) return /^DE\d{9}$/.test(wert) ? null : 'Eine deutsche USt-IdNr. ist DE und neun Ziffern, z. B. DE123456789.';
      return /^[A-Z]{2}[0-9A-Z+*]{2,12}$/.test(wert) ? null : 'Eine USt-IdNr. beginnt mit dem Ländercode, z. B. DE123456789.';
    default:
      return null;
  }
}

/** Alle Fehler einer Firma (nur Felder mit Fehler). */
export function firmaFehler(f: Firma): Partial<Record<FirmaFeld, string>> {
  const fehler: Partial<Record<FirmaFeld, string>> = {};
  for (const k of FIRMA_FELDER) {
    const e = feldFehler(k, f[k]);
    if (e) fehler[k] = e;
  }
  return fehler;
}

/**
 * Was für Belege nach § 34a UStDV noch fehlt (§2.3): vollständiger Name und Anschrift, Steuernummer oder USt-IdNr.
 * oder KU-ID. Leere Liste = alles da. Das sperrt nichts, die Einstellungen zeigen es nur an.
 */
export function fehlendePflichtangaben(f: Firma): string[] {
  const fehlt: string[] = [];
  if (!f.name.trim() && !f.inhaber.trim()) fehlt.push('Name');
  if (!f.strasse.trim() || !f.plz.trim() || !f.ort.trim()) fehlt.push('Anschrift (Straße, PLZ, Ort)');
  if (!f.steuernummer.trim() && !f.ust_idnr.trim() && !f.ku_id.trim()) fehlt.push('Steuernummer, USt-IdNr. oder KU-ID');
  return fehlt;
}
