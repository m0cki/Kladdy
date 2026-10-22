/* Status-Aktionen für Belege (§6.6 „Status selbst festlegen“, Prototyp statusAktion): gemeinsam für Liste und Maske.
 * Jede Aktion ruft genau einen Rust-Command (eine Transaktion) und meldet das Ergebnis als Toast; danach
 * `datenGeaendert`, damit Listen und Zähler neu laden. Nach Ausstellen und Storno setzt Tectonic das PDF aus dem
 * Schnappschuss und Rust legt es ab – scheitert das, bleibt der Beleg gültig und das PDF lässt sich nachholen. */
import { useUi } from '../store/ui';
import { ausgestellterBeleg, belegPdfOeffnen, pdfErzeugenUndAblegen } from './belegpdf';
import { fehlerText } from './fehler';
import { ladeBelegEinstellungen, ladeFirma, ladeUstModus } from './queries/einstellungen';
import {
  belegAngebotStatus,
  belegBezahlt,
  belegEntwurfLoeschen,
  belegEntwurfSpeichern,
  belegOffen,
  belegStornieren,
  belegUmwandeln,
  ladeBeleg,
  ladeKundenAnschrift,
} from './queries/rechnungen';
import { artWechseln, formularAusDokument, formularZuDaten, ART_NAME, type BelegZeile } from './rechnungen';
import type { Zahlungsart } from './buchungen';
import { HINWEIS_14B, type Belegart } from './vorlagen/dokument';
import { heute as heuteIso, plusTage } from './zeitraum';

type Ziel = Pick<BelegZeile, 'id' | 'nummer' | 'art'>;

const ui = () => useUi.getState();
const akzent = () => useUi.getState().settings.accent;
const nr = (z: Ziel) => z.nummer ?? 'Entwurf';

function fehler(was: string, e: unknown): void {
  ui().showToast({ text: `${was} ging nicht: ${fehlerText(e)}`, icon: 'warn', sticky: true });
}

/** PDF eines ausgestellten Belegs (neu) setzen und ablegen; Fehler nur als Hinweis, der Beleg bleibt gültig. */
export async function pdfNachholen(id: number): Promise<number | null> {
  try {
    const geladen = await ladeBeleg(id);
    if (!geladen || !geladen.beleg.nummer) return null;
    if (geladen.beleg.pdf_beleg_id) return geladen.beleg.pdf_beleg_id;
    const [firma, ust] = await Promise.all([ladeFirma(), ladeUstModus()]);
    const s = ausgestellterBeleg(geladen.beleg, geladen.positionen, firma, ust);
    const pdf = await pdfErzeugenUndAblegen(id, s, akzent());
    ui().datenGeaendert();
    return pdf;
  } catch (e) {
    ui().showToast({
      text: `Das PDF konnte nicht erzeugt werden: ${fehlerText(e)} – der Beleg ist trotzdem ausgestellt. Später über „PDF erzeugen“ nachholen.`,
      icon: 'warn',
      sticky: true,
    });
    return null;
  }
}

/** PDF öffnen (Vorschau-App: Drucken oder „Als PDF sichern“); fehlt es, wird es zuerst erzeugt und abgelegt. */
export async function pdfOeffnenFuer(id: number): Promise<void> {
  try {
    const geladen = await ladeBeleg(id);
    if (!geladen || !geladen.beleg.nummer) throw new Error('Den Beleg gibt es nicht (mehr).');
    const [firma, ust] = await Promise.all([ladeFirma(), ladeUstModus()]);
    const s = ausgestellterBeleg(geladen.beleg, geladen.positionen, firma, ust);
    const vorher = geladen.beleg.pdf_beleg_id;
    await belegPdfOeffnen(geladen.beleg, s, akzent());
    if (!vorher) ui().datenGeaendert();
  } catch (e) {
    fehler('PDF öffnen', e);
  }
}

/** Rechnung als bezahlt markieren: Einnahme am Tag des Zahlungseingangs. */
export async function alsBezahlt(z: Ziel, datum: string, zahlungsart: Zahlungsart): Promise<boolean> {
  try {
    const r = await belegBezahlt(z.id, datum, zahlungsart, heuteIso());
    ui().datenGeaendert();
    ui().showToast({ text: `${nr(z)} bezahlt · Einnahme ${r.buchung_nummer ?? ''} gebucht (im Protokoll)`, icon: 'check' });
    return true;
  } catch (e) {
    fehler('Als bezahlt markieren', e);
    return false;
  }
}

/** Bezahlte Rechnung wieder offen: Einnahme per Gegenbuchung zurücknehmen. */
export async function dochOffen(z: Ziel): Promise<boolean> {
  try {
    const r = await belegOffen(z.id, heuteIso());
    ui().datenGeaendert();
    const gegen = r.gegenbuchung_nummer ? ` · Einnahme per Storno ${r.gegenbuchung_nummer} zurückgenommen` : '';
    ui().showToast({ text: `${nr(z)} wieder offen${gegen}`, icon: 'check' });
    return true;
  } catch (e) {
    fehler('Wieder offen', e);
    return false;
  }
}

/** Stornieren: Stornobeleg mit eigener Nummer, Gegenbuchung der Zahlung; danach das PDF des Stornobelegs. */
export async function stornieren(z: Ziel): Promise<number | null> {
  try {
    const r = await belegStornieren(z.id, heuteIso());
    ui().datenGeaendert();
    const was = z.art === 'eigenbeleg' ? 'Ausgabe' : 'Einnahme';
    const gegen = r.gegenbuchung_nummer ? ` · ${was} per ${r.gegenbuchung_nummer} zurückgenommen` : '';
    const stornoId = r.storno_id;
    ui().showToast({
      text: `${nr(z)} storniert · Stornobeleg ${r.storno_nummer ?? ''}${gegen} (im Protokoll)`,
      icon: 'check',
      actions: stornoId ? [{ label: 'Stornobeleg öffnen', run: () => void pdfOeffnenFuer(stornoId) }] : undefined,
    });
    if (stornoId) void pdfNachholen(stornoId);
    return stornoId;
  } catch (e) {
    fehler('Stornieren', e);
    return null;
  }
}

/** Angebot offen bzw. abgelehnt. */
export async function angebotStatus(z: Ziel, status: 'offen' | 'abgelehnt'): Promise<void> {
  try {
    await belegAngebotStatus(z.id, status);
    ui().datenGeaendert();
    ui().showToast({ text: status === 'abgelehnt' ? `${nr(z)} als abgelehnt markiert` : `${nr(z)} wieder offen`, icon: 'check' });
  } catch (e) {
    fehler('Status ändern', e);
  }
}

/** Angebot ⇒ Rechnung (Entwurf mit Kunde, Betreff und Positionen); gibt die ID des Entwurfs zurück. */
export async function umwandeln(z: Ziel): Promise<number | null> {
  try {
    const heute = heuteIso();
    const e = await ladeBelegEinstellungen();
    const r = await belegUmwandeln(z.id, {
      heute,
      einleitung: `vielen Dank für Ihren Auftrag gemäß meinem Angebot ${nr(z)}. Ich berechne Ihnen folgende Leistungen:`,
      schlusstext: HINWEIS_14B,
      faellig_am: plusTage(heute, e.zahlungsziel_tage),
    });
    ui().datenGeaendert();
    ui().showToast({ text: `Rechnungsentwurf aus ${nr(z)} erstellt`, icon: 'check' });
    return r.entwurf_id;
  } catch (e) {
    fehler('Umwandeln', e);
    return null;
  }
}

/** Kopie als Entwurf (Duplizieren, „als Rechnung neu ausstellen“): gleiche Angaben, Datum heute, ohne Terminbezug. */
export async function alsEntwurfKopieren(id: number, art?: Belegart): Promise<number | null> {
  try {
    const geladen = await ladeBeleg(id);
    if (!geladen) throw new Error('Den Beleg gibt es nicht (mehr).');
    const [firma, ust, kunden, e] = await Promise.all([ladeFirma(), ladeUstModus(), ladeKundenAnschrift(), ladeBelegEinstellungen()]);
    const s = ausgestellterBeleg(geladen.beleg, geladen.positionen, firma, ust);
    const heute = heuteIso();
    const ziel = { rechnung: e.zahlungsziel_tage, angebot: e.angebot_tage };
    let f = formularAusDokument(s.dokument, { vorlageId: null, terminId: null });
    // Stornobeleg: das Original kopieren (positive Beträge)
    f = { ...f, positionen: f.positionen.map((p) => ({ ...p, preis: p.preis.replace(/^-/, '') })) };
    if (art && art !== f.art) f = artWechseln(f, art, ziel);
    f = { ...f, datum: heute, leistungVon: heute, leistungBis: '', bezahltAm: null, zielTage: String(ziel[f.art as 'rechnung' | 'angebot'] ?? f.zielTage) };
    if (s.dokument.storno_von) f = { ...f, betreff: '' };
    const d = formularZuDaten(f, kunden);
    if (!d.ok) throw new Error(Object.values(d.fehler).join(' '));
    const r = await belegEntwurfSpeichern(null, d.daten);
    ui().datenGeaendert();
    return r.id;
  } catch (e) {
    fehler('Kopieren', e);
    return null;
  }
}

/** Quittung war ein Versehen: stornieren und dieselben Angaben als Rechnungsentwurf anlegen. */
export async function alsRechnungNeu(z: Ziel): Promise<number | null> {
  const storno = await stornieren(z);
  if (storno == null) return null;
  const neu = await alsEntwurfKopieren(z.id, 'rechnung');
  if (neu != null) ui().showToast({ text: `${nr(z)} storniert · Rechnung als Entwurf angelegt`, icon: 'check' });
  return neu;
}

/** Vorbereitung (Entwurf für einen Termin) bzw. Entwurf löschen – noch ohne Nummer, deshalb kein Storno. */
export async function entwurfLoeschen(z: Ziel): Promise<boolean> {
  try {
    await belegEntwurfLoeschen(z.id);
    ui().datenGeaendert();
    ui().showToast({ text: `${ART_NAME[z.art]}-Entwurf gelöscht (im Protokoll)`, icon: 'check' });
    return true;
  } catch (e) {
    fehler('Löschen', e);
    return false;
  }
}
