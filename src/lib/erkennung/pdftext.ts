/* Belegerkennung – Text aus einer PDF mit pdf.js (ANLEITUNG §3 „pdfjs-dist“, §6.4 „Erkennung in der Mac-App“).
 * Liest nur die ersten Seiten (`getTextContent`) und bündelt die Textstücke zu Zeilen (zeilen.ts). pdf.js wird erst beim
 * ersten Beleg geladen (eigener Chunk); der Worker kommt als Datei über Vites `?url` und läuft als Modul-Worker, die
 * Oberfläche wartet also nie. Legacy-Build: der moderne Build setzt die neuesten JS-Funktionen voraus, WKWebView unter
 * macOS 14 bringt je nach Stand nur Safari 17/18 mit. Sieht der Text nach einer nicht ladbaren Schrift aus, liest pdf.js
 * eine reparierte Kopie ein zweites Mal (pdfreparatur.ts). Wirft nie – Passwort, Fehler oder Zeitüberschreitung ⇒ Status
 * statt Text (die Erkennung nimmt dann nur den Dateinamen). Eigenes Modul, damit es sich in Tests ersetzen lässt. */
import { objektstroemeAnhaengen, verdaechtig } from './pdfreparatur';
import { zeilenAus, type Textstueck } from './zeilen';

export type PdfStatus = 'ok' | 'verschluesselt' | 'fehler' | 'zeit';

export interface PdfText {
  status: PdfStatus;
  /** Zeilen der ersten Seiten (leer, wenn nicht 'ok' oder ohne Textebene, z. B. Scan) */
  zeilen: string[];
}

/** Belege haben die Summe fast immer auf den ersten Seiten. */
const MAX_SEITEN = 3;
const ZEITLIMIT_MS = 15_000;

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

/** Offene Ladeaufgaben – werden am Ende immer freigegeben (Worker, Speicher). */
type Aufgaben = { destroy: () => Promise<void> }[];

let geladen: Promise<PdfJs> | null = null;

/** pdf.js und den Worker einmal laden (schlägt es fehl, beim nächsten Beleg erneut versuchen). */
function pdfjsLaden(): Promise<PdfJs> {
  geladen ??= Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')])
    .then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })
    .catch((e: unknown) => {
      geladen = null;
      throw e;
    });
  return geladen;
}

function mitZeitlimit<T>(p: Promise<T>, ms: number, ersatz: T): Promise<T> {
  return new Promise<T>((ok, fehler) => {
    const t = setTimeout(() => ok(ersatz), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        ok(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        fehler(e);
      },
    );
  });
}

/** Zeilen der ersten Seiten. pdf.js übernimmt den Puffer (Worker) – `daten` danach nicht weiterverwenden. */
async function seitenLesen(pdfjs: PdfJs, daten: Uint8Array, maxSeiten: number, aufgaben: Aufgaben): Promise<string[]> {
  const aufgabe = pdfjs.getDocument({
    data: daten,
    // nur Text: keine Schriften ins Dokument laden, keine System-Schriften, kein WebAssembly für Bilder
    disableFontFace: true,
    useSystemFonts: false,
    useWasm: false,
    stopAtErrors: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  aufgaben.push(aufgabe);
  const doc = await aufgabe.promise;
  const zeilen: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxSeiten); i++) {
    const seite = await doc.getPage(i);
    const inhalt = await seite.getTextContent();
    const stuecke: Textstueck[] = [];
    for (const x of inhalt.items) if ('str' in x) stuecke.push({ str: x.str, transform: x.transform, width: x.width, height: x.height });
    zeilen.push(...zeilenAus(stuecke));
    seite.cleanup();
  }
  return zeilen;
}

/** Zeilen der ersten Seiten mit einem schon geladenen pdf.js (auch für Tests in Node). Wirft bei unlesbaren PDFs. */
export async function textAusPdf(pdfjs: PdfJs, daten: Uint8Array, maxSeiten = MAX_SEITEN, aufgaben: Aufgaben = []): Promise<string[]> {
  const zeilen = await seitenLesen(pdfjs, daten.slice(), maxSeiten, aufgaben);
  if (!verdaechtig(zeilen)) return zeilen;
  // Schrift nicht ladbar (z. B. Objekte in Objekt-Streams ohne Querverweis) ⇒ reparierte Kopie lesen
  const kopie = await objektstroemeAnhaengen(daten).catch(() => null);
  const neu = kopie ? await seitenLesen(pdfjs, kopie, maxSeiten, aufgaben).catch(() => null) : null;
  return neu && !verdaechtig(neu) ? neu : zeilen;
}

/** Text der ersten Seiten einer PDF (Bytes, z. B. über beleg_pdf_lesen). */
export async function pdfText(daten: Uint8Array, maxSeiten = MAX_SEITEN): Promise<PdfText> {
  const aufgaben: Aufgaben = [];
  const lesen = async (): Promise<PdfText> => ({ status: 'ok', zeilen: await textAusPdf(await pdfjsLaden(), daten, maxSeiten, aufgaben) });
  try {
    return await mitZeitlimit(lesen(), ZEITLIMIT_MS, { status: 'zeit', zeilen: [] });
  } catch (e) {
    return { status: e instanceof Error && e.name === 'PasswordException' ? 'verschluesselt' : 'fehler', zeilen: [] };
  } finally {
    for (const a of aufgaben) a.destroy().catch(() => undefined);
  }
}
