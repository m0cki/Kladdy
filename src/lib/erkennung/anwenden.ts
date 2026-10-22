/* Belegerkennung ⇒ Erfassen-Schublade (§6.4): erkannte Felder ins Formular übernehmen, ohne Eingaben zu überschreiben.
 * Gefüllt wird nur, was leer ist oder noch unverändert einen früheren Vorschlag enthält: Betrag, Beleg-Nr., Beschreibung
 * und Geschäft (nur Ausgaben). Typ, Zahlungsdatum und Kategorie nur bei neuen Einträgen und nur, solange sie so dastehen
 * wie beim Öffnen (Kategorie: solange nicht selbst gewählt). Jedes übernommene Feld merkt sich Wert und Herkunft – die
 * Schublade markiert es mit „aus PDF“ / „aus Dateiname“, bis der Wert geändert wird. Rein, Tests: anwenden.test.ts */
import type { Formular, KategorieWahl } from '../buchungen';
import { betragAlsEingabe } from '../money';
import type { ErkanntesFeld, Erkennung, Quelle, Sicherheit } from './regeln';

/** Felder der Schublade, die die Erkennung füllen kann. */
export type VorschlagFeld = 'typ' | 'betrag' | 'kategorieId' | 'zahlungsdatum' | 'belegnummer' | 'beschreibung' | 'wer';

export interface Vorschlag {
  /** übernommener Wert, so wie er im Formular steht */
  wert: Formular[VorschlagFeld];
  quelle: Quelle;
  sicherheit: Sicherheit;
}

export type Vorschlaege = Partial<Record<VorschlagFeld, Vorschlag>>;

/** Der Vorschlag zu `feld`, solange er unverändert im Formular steht – sonst null. */
export function vorschlagAktiv(form: Formular, v: Vorschlaege, feld: VorschlagFeld): Vorschlag | null {
  const x = v[feld];
  return x && form[feld] === x.wert ? x : null;
}

export interface AnwendenOptionen {
  /** Formular beim Öffnen (bzw. nach „Speichern & neu“): unveränderte Felder gelten als frei */
  basis: Formular;
  /** neuer Eintrag? Beim Bearbeiten werden nur leere Textfelder gefüllt. */
  neu: boolean;
  /** Kategorie selbst gewählt (Kachel geklickt)? */
  katGewaehlt: boolean;
  kategorien: readonly Pick<KategorieWahl, 'id' | 'typ'>[];
  /** Vorschläge einer früheren Erkennung (dürfen ersetzt werden, solange unverändert) */
  bisher?: Vorschlaege;
}

export interface Angewendet {
  form: Formular;
  /** alle Vorschläge, die jetzt gelten (frühere, soweit nicht ersetzt, und neue) */
  vorschlaege: Vorschlaege;
  /** in diesem Schritt gefüllte Felder */
  gefuellt: VorschlagFeld[];
}

export function erkennungAnwenden(form: Formular, e: Erkennung, o: AnwendenOptionen): Angewendet {
  const f: Formular = { ...form };
  const neu: Vorschlaege = {};
  const bisher = o.bisher ?? {};
  const alterVorschlag = (k: VorschlagFeld): boolean => vorschlagAktiv(form, bisher, k) !== null;
  const leer = (k: VorschlagFeld): boolean => {
    const w = form[k];
    return alterVorschlag(k) || (typeof w === 'string' && !w.trim());
  };
  const unveraendert = (k: VorschlagFeld): boolean => alterVorschlag(k) || form[k] === o.basis[k];
  const setze = <K extends VorschlagFeld>(k: K, wert: Formular[K], quelleVon: ErkanntesFeld): void => {
    f[k] = wert;
    neu[k] = { wert, quelle: e.herkunft[quelleVon] ?? 'pdf', sicherheit: e.sicherheit[quelleVon] ?? 'mittel' };
  };
  const x = e.felder;

  // Typ: eigener Beleg ⇒ Einnahme (nur neu und solange nicht selbst umgestellt); Kategorie und Geschäft passen dann nicht mehr
  let typGewechselt = false;
  if (x.typ && x.typ !== f.typ && o.neu && unveraendert('typ')) {
    setze('typ', x.typ, 'typ');
    typGewechselt = true;
    const gewaehlt = o.kategorien.find((k) => k.id === f.kategorieId);
    if (!gewaehlt || gewaehlt.typ !== x.typ) f.kategorieId = o.kategorien.find((k) => k.typ === x.typ)?.id ?? null;
    if (x.typ === 'einnahme' && alterVorschlag('wer')) f.wer = '';
  }
  if (x.betrag_cent != null && x.betrag_cent > 0 && leer('betrag')) setze('betrag', betragAlsEingabe(x.betrag_cent), 'betrag_cent');
  if (x.zahlungsdatum && o.neu && unveraendert('zahlungsdatum')) setze('zahlungsdatum', x.zahlungsdatum, 'zahlungsdatum');
  if (x.belegnummer && leer('belegnummer')) setze('belegnummer', x.belegnummer, 'belegnummer');
  if (x.beschreibung && leer('beschreibung')) setze('beschreibung', x.beschreibung, 'beschreibung');
  if (x.lieferant && f.typ === 'ausgabe' && leer('wer')) setze('wer', x.lieferant, 'lieferant');
  const kat = x.kategorie_id != null ? o.kategorien.find((k) => k.id === x.kategorie_id) : undefined;
  if (kat && kat.typ === f.typ && o.neu && (!o.katGewaehlt || typGewechselt || alterVorschlag('kategorieId'))) setze('kategorieId', kat.id, 'kategorie_id');

  const gefuellt = Object.keys(neu) as VorschlagFeld[];
  return { form: f, vorschlaege: { ...bisher, ...neu }, gefuellt };
}
