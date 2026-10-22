/* Belegerkennung – der Ablauf für eine gezogene bzw. gewählte Datei (§6.4 „Erkennung in der Mac-App“).
 * Kontext laden (Kategorien mit Stichworten, bisherige Geschäfte, eigene Firma), bei PDFs die Bytes über Rust lesen
 * (beleg_pdf_lesen) und den Text mit pdf.js holen (pdftext.ts), dann die Regeln (regeln.ts). Fotos und Scans: nur der
 * Dateiname – Texterkennung mit dem macOS-Vision-Framework folgt in Phase 7. Wirft nie: Fehler ⇒ Werte aus dem
 * Dateinamen und ein ruhiger Hinweis. Aufgerufen von lib/belegablage.ts. */
import { dateiArt, type VorgemerkterBeleg } from '../belege';
import { geschaefte } from '../buchungen';
import { belegPdfLesen } from '../queries/belege';
import { ladeKategorienWahl, ladeLieferanten } from '../queries/buchungen';
import { ladeFirma } from '../queries/einstellungen';
import { heute } from '../zeitraum';
import { pdfText, type PdfStatus } from './pdftext';
import { erkenne, type Erkennung, type ErkennungKontext } from './regeln';

const NUR_NAME = 'nur der Dateiname wurde ausgewertet';

const PDF_HINWEIS: Readonly<Record<Exclude<PdfStatus, 'ok'>, string>> = {
  verschluesselt: `Das PDF ist passwortgeschützt – ${NUR_NAME}.`,
  fehler: `Das PDF ließ sich nicht lesen – ${NUR_NAME}.`,
  zeit: `Das PDF war zu groß oder zu verschachtelt zum Lesen – ${NUR_NAME}.`,
};

/** Kategorien, Geschäfte und Firma; was nicht lädt, bleibt leer (die Erkennung wird dann nur ungenauer). */
async function kontextLaden(): Promise<ErkennungKontext> {
  const [kategorien, lieferanten, firma] = await Promise.all([
    ladeKategorienWahl().catch(() => []),
    ladeLieferanten().catch(() => []),
    ladeFirma().catch(() => null),
  ]);
  return { heute: heute(), kategorien, geschaefte: geschaefte(lieferanten), firma };
}

/** Datei auswerten: PDF-Text + Dateiname bzw. nur Dateiname. */
export async function belegErkennen(datei: Pick<VorgemerkterBeleg, 'pfad' | 'name' | 'mime'>): Promise<Erkennung> {
  const hinweise: string[] = [];
  let kontext: ErkennungKontext = { heute: heute(), kategorien: [], geschaefte: [], firma: null };
  let text: string | null = null;
  try {
    kontext = await kontextLaden();
    const art = dateiArt(datei.name, datei.mime);
    if (art === 'pdf') {
      const r = await pdfText(new Uint8Array(await belegPdfLesen(datei.pfad)));
      if (r.status === 'ok') text = r.zeilen.join('\n');
      else hinweise.push(PDF_HINWEIS[r.status]);
    } else if (art === 'bild') hinweise.push(`Foto bzw. Scan: Texterkennung folgt später – ${NUR_NAME}.`);
    else if (art === 'xml') hinweise.push(`E-Rechnungen (XML) werden noch nicht ausgelesen – ${NUR_NAME}.`);
  } catch {
    hinweise.push(PDF_HINWEIS.fehler);
  }
  return erkenne({ text, dateiname: datei.name, kontext, hinweise });
}
