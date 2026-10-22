/* GiroCode (EPC-QR) auf Rechnungen (ANLEITUNG §6.6, §7.1; Prototyp pages/belege.js → epcFor/girocode).
 * - Inhalt aus dem Beleg: Firma aus dem Schnappschuss (Name, sonst Inhaber), IBAN, BIC, Gesamtbetrag in Cent,
 *   Verwendungszweck = Rechnungsnummer (Entwurf ohne Nummer ⇒ „Entwurf“, wie im Prototyp). Text: epc.ts, Code: qr.ts
 *   mit Fehlerkorrektur M.
 * - Wo er steht: Baustein „Zahlung“ mit Einstellung `qr`, nur auf offenen Rechnungen (nicht `quittiert`). Fehler
 *   (z. B. IBAN-Prüfsumme) zeigt das Formular aus `girocodeFuer(doc).fehler` – auf dem Blatt steht dann nichts.
 * - Vorschau: Matrix/SVG (components/belege/Blatt.tsx); PDF: dieselbe Matrix als girocode.png (png.ts), Makro
 *   \GiroCode in daten.tex (lib/latex/daten.ts), Datei über belegAssets (lib/latex/kompilieren.ts).
 * - Die Live-Vorschau fragt bei jedem Tastendruck: fertige Codes werden je Inhalt gemerkt (wenige Einträge).
 * Tests: girocode.test.ts, qr.test.ts (Rück-Dekodierung), png.test.ts */
import { sichtbare, type Baustein } from '../vorlagen/bausteine';
import { belegSumme, type BelegDokument } from '../vorlagen/dokument';
import { epcPayload, type EpcErgebnis } from './epc';
import { pngAusMatrix } from './png';
import { qrKodieren, qrSvg } from './qr';

/** Dateiname neben main.tex (Rust latex.rs prüft: `[A-Za-z0-9_-]+.png`) */
export const GIROCODE_DATEI = 'girocode.png';
/** Standardgröße auf dem Blatt in mm (Einstellung `qrgroesse`) */
export const QR_STANDARD_MM = 28;

export type GirocodeErgebnis =
  | {
      ok: true;
      payload: string;
      /** matrix[y][x], true = dunkel, ohne Ruhezone – nicht verändern (wird wiederverwendet) */
      matrix: readonly (readonly boolean[])[];
      /** SVG ohne Ruhezone, Farbe per CSS (`color`) */
      svg: string;
    }
  | { ok: false; fehler: string[] };

type GirocodeOk = Extract<GirocodeErgebnis, { ok: true }>;

/** Größe auf dem Blatt in mm aus der Einstellung `qrgroesse` (wie im Prototyp 18–45 mm, sonst 28). Ganzzahl, damit
 * nie ein fremder Text ins LaTeX gerät. */
export function qrGroesseMm(wert: string): number {
  const mm = Math.round(Number(wert));
  return Number.isFinite(mm) && mm > 0 ? Math.max(18, Math.min(45, mm)) : QR_STANDARD_MM;
}

/** Gehört auf diesen Beleg überhaupt ein GiroCode? Nur Rechnungen, die nicht schon bei Ausstellung bezahlt waren. */
export const girocodeMoeglich = (doc: Pick<BelegDokument, 'art' | 'quittiert'>): boolean => doc.art === 'rechnung' && !doc.quittiert;

/** Zeigt ein sichtbarer Baustein „Zahlung“ der Vorlage den GiroCode (Einstellung `qr`)? */
export const vorlageZeigtGirocode = (bausteine: readonly Baustein[]): boolean =>
  sichtbare(bausteine).some(({ b }) => b.typ === 'zahlung' && b.an('qr'));

/** EPC-Text für den Beleg (ohne Prüfung der Belegart). */
export function epcFuer(doc: BelegDokument): EpcErgebnis {
  const F = doc.firma;
  return epcPayload({
    name: F.name.trim() || F.inhaber.trim(),
    iban: F.iban,
    bic: F.bic,
    betrag_cent: belegSumme(doc),
    zweck: doc.nummer || 'Entwurf',
  });
}

const GEMERKT = new Map<string, GirocodeOk>();
const GEMERKT_MAX = 16;

/** GiroCode für den Beleg: Text, Modulmatrix und SVG – oder die Fehler fürs Formular. */
export function girocodeFuer(doc: BelegDokument): GirocodeErgebnis {
  const epc = epcFuer(doc);
  if (!epc.ok) return epc;
  const alt = GEMERKT.get(epc.payload);
  if (alt) return alt;
  try {
    const qr = qrKodieren(epc.payload, { stufe: 'M' });
    const neu: GirocodeOk = { ok: true, payload: epc.payload, matrix: qr.module, svg: qrSvg(qr.module, { titel: 'GiroCode' }) };
    if (GEMERKT.size >= GEMERKT_MAX) {
      for (const k of GEMERKT.keys()) {
        GEMERKT.delete(k); // ältesten Eintrag verwerfen
        break;
      }
    }
    GEMERKT.set(epc.payload, neu);
    return neu;
  } catch (e) {
    return { ok: false, fehler: [e instanceof Error ? e.message : String(e)] };
  }
}

/** Wert für \GiroCode in daten.tex: der Dateiname, wenn auf diese Rechnung ein gültiger GiroCode gehört, sonst ''. */
export const girocodeDatei = (doc: BelegDokument): string => (girocodeMoeglich(doc) && girocodeFuer(doc).ok ? GIROCODE_DATEI : '');

/** girocode.png für den PDF-Satz, null wenn kein GiroCode auf den Beleg gehört (gleiche Bedingung wie \GiroCode). */
export function girocodePng(doc: BelegDokument): Uint8Array | null {
  if (!girocodeMoeglich(doc)) return null;
  const g = girocodeFuer(doc);
  return g.ok ? pngAusMatrix(g.matrix) : null;
}
