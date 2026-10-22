/* Ausgestellte Belege als Dokument und PDF (§6.6 „Finalisieren … erzeugt das PDF, speichert es als Beleg“, §7).
 * - schnappschussLesen: snapshot_json ({ version, dokument, bausteine }, geschrieben von rechnungen.rs beim Ausstellen)
 *   ⇒ Belegdokument und eingefrorene Bausteine. Fehlt der Schnappschuss (Demo-Daten), baut dokumentAusZeile den Beleg
 *   aus den Spalten nach (Kunde aus dem Schnappschuss der Spalten, Standardvorlage der Art).
 * - pdfErzeugenUndAblegen: Tectonic setzt das PDF aus dem Schnappschuss, Rust legt es genau einmal unverändert ab
 *   (beleg_pdf_ablegen). Ein Fehler hier macht den Beleg nicht ungültig: Er ist ausgestellt, das PDF lässt sich
 *   jederzeit aus demselben Schnappschuss nachholen.
 * - Entwürfe werden nur zum Ansehen/Drucken in den Cache gesetzt (mit Wasserzeichen ENTWURF), nie abgelegt.
 * - Firmenlogo: das aus dem Schnappschuss (`dokument.logo`), nie das aktuelle – ein ausgestellter Beleg behält sein Logo. */
import { istZahlungsart, type Zahlungsart } from './buchungen';
import { firmaAusJson, type Firma } from './firma';
import { logoAusWert } from './firmenlogo';
import { KompilierFehler, belegLogo, belegTex, fehlerZeilen, kompiliere, pdfOeffnen } from './latex/kompilieren';
import { formatBetrag } from './money';
import type { UstModus } from './queries/einstellungen';
import { belegOeffnen } from './queries/belege';
import { belegPdfAblegen, type BelegVoll } from './queries/rechnungen';
import { anschriftLesen, type PositionZeile } from './rechnungen';
import { bausteineAusJson, type Baustein } from './vorlagen/bausteine';
import {
  ARTEN,
  EIGENBELEG_GRUENDE,
  STANDARD_TEXTE,
  bausteineFuer,
  belegSumme,
  istBelegart,
  type BelegDokument,
  type BelegPosition,
  type Belegart,
  type EigenbelegGrund,
  type KundeSchnappschuss,
} from './vorlagen/dokument';
import { standardVorlage } from './vorlagen/standard';

export interface Schnappschuss {
  dokument: BelegDokument;
  bausteine: Baustein[];
  /** Akzentfarbe beim Ausstellen ('#rrggbb'), null = aktuelle */
  akzent: string | null;
}

const istObjekt = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOderNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const zahl = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const istGrund = (v: unknown): v is EigenbelegGrund => typeof v === 'string' && v in EIGENBELEG_GRUENDE;

function kundeAusJson(v: unknown): KundeSchnappschuss | null {
  if (!istObjekt(v)) return null;
  return {
    id: typeof v.id === 'number' ? v.id : null,
    nummer: str(v.nummer),
    name: str(v.name),
    zusatz: str(v.zusatz),
    strasse: str(v.strasse),
    plz: str(v.plz),
    ort: str(v.ort),
    email: str(v.email),
  };
}

function positionenAusJson(v: unknown): BelegPosition[] {
  if (!Array.isArray(v)) return [];
  return v.filter(istObjekt).map((p) => ({
    beschreibung: str(p.beschreibung),
    menge: zahl(p.menge),
    einheit: str(p.einheit),
    einzelpreis_cent: Math.round(zahl(p.einzelpreis_cent)),
  }));
}

/** Belegdokument aus JSON (Schnappschuss); unbekannte oder kaputte Felder ⇒ Standardwerte. null = kein Dokument. */
export function dokumentAusJson(v: unknown): BelegDokument | null {
  if (!istObjekt(v) || !istBelegart(v.art)) return null;
  const q = v.quittiert;
  const e = v.eigenbeleg;
  const s = v.storno_von;
  const gebucht = istObjekt(e) && istObjekt(e.gebucht) ? { nummer: str(e.gebucht.nummer), kategorie: str(e.gebucht.kategorie) } : null;
  return {
    art: v.art,
    nummer: strOderNull(v.nummer),
    storniert: v.storniert === true,
    datum: str(v.datum),
    leistung_von: strOderNull(v.leistung_von),
    leistung_bis: strOderNull(v.leistung_bis),
    faellig_am: strOderNull(v.faellig_am),
    kunde: kundeAusJson(v.kunde),
    betreff: str(v.betreff),
    einleitung: str(v.einleitung),
    schlusstext: str(v.schlusstext),
    positionen: positionenAusJson(v.positionen),
    zahlungsweg: istZahlungsart(v.zahlungsweg) ? v.zahlungsweg : null,
    quittiert: istObjekt(q) && typeof q.am === 'string' && istZahlungsart(q.zahlungsweg) ? { am: q.am, zahlungsweg: q.zahlungsweg } : null,
    eigenbeleg: istObjekt(e) ? { grund: istGrund(e.grund) ? e.grund : 'sonstiges', grund_text: str(e.grund_text), gebucht } : null,
    ausgestellt_am: strOderNull(v.ausgestellt_am),
    firma: firmaAusJson(v.firma),
    // Logo von damals (Name aus dem Schnappschuss); ältere Schnappschüsse haben keins
    logo: logoAusWert(v.logo) || null,
    ust_modus: v.ust_modus === 'regel' ? 'regel' : 'klein',
    storno_von: istObjekt(s) ? { nummer: str(s.nummer), datum: str(s.datum) } : null,
  };
}

/** snapshot_json ⇒ Schnappschuss (null, wenn es keinen gibt oder er nicht lesbar ist). */
export function schnappschussLesen(json: string | null | undefined): Schnappschuss | null {
  if (!json) return null;
  let roh: unknown;
  try {
    roh = JSON.parse(json);
  } catch {
    return null;
  }
  if (!istObjekt(roh)) return null;
  const dokument = dokumentAusJson(roh.dokument);
  if (!dokument) return null;
  const akzent = istObjekt(roh.dokument) && typeof roh.dokument.akzent === 'string' ? roh.dokument.akzent : null;
  const bausteine = bausteineAusJson(roh.bausteine);
  return { dokument, bausteine: bausteine.length ? bausteine : standardVorlage(dokument.art), akzent };
}

/** Beleg ohne Schnappschuss (Demo-Daten, ältere Stände) aus den Spalten nachbauen. Texte wie damals: ohne eigenen
 * Schlusstext keiner (Prototyp SCHLUSS_ALT), Firmendaten von heute, ohne Firmenlogo (das gab es damals nicht). */
export function dokumentAusZeile(b: BelegVoll, positionen: readonly PositionZeile[], firma: Firma, ustModus: UstModus): Schnappschuss {
  const storno = b.art === 'storno';
  const artRoh = storno ? b.storno_von_art : b.art;
  const art: Belegart = istBelegart(artRoh) ? artRoh : 'rechnung';
  const a = anschriftLesen(b.kunde_adresse ?? '');
  const name = b.kunde_name ?? b.kunde_name_live ?? '';
  const kunde: KundeSchnappschuss | null =
    name || b.kunde_id != null ? { id: b.kunde_id, nummer: b.kunde_nummer ?? b.kunde_nummer_live ?? '', name, ...a, email: '' } : null;
  const zahlungsweg: Zahlungsart | null = b.zahlungsart ?? b.buchung_zahlungsart ?? (art === 'quittung' ? 'bar' : null);
  const quittiert =
    art === 'rechnung' && b.status === 'bezahlt' && b.bezahlt_am && b.datum && b.bezahlt_am <= b.datum
      ? { am: b.bezahlt_am, zahlungsweg: zahlungsweg ?? 'bank' }
      : null;
  let zusatz: Record<string, unknown> = {};
  try {
    const roh: unknown = b.entwurf_json ? JSON.parse(b.entwurf_json) : {};
    if (istObjekt(roh)) zusatz = roh;
  } catch {
    /* ohne Zusatzangaben */
  }
  const dokument: BelegDokument = {
    art,
    nummer: b.nummer,
    storniert: b.status === 'storniert' && !storno,
    datum: b.datum ?? '',
    leistung_von: b.leistung_von,
    leistung_bis: b.leistung_bis,
    faellig_am: b.faellig_am,
    kunde,
    betreff: b.betreff ?? '',
    einleitung: b.einleitung ?? STANDARD_TEXTE[art].einleitung,
    schlusstext: b.schlusstext ?? '',
    positionen: positionen.map((p) => ({ beschreibung: p.beschreibung, menge: p.menge, einheit: p.einheit ?? '', einzelpreis_cent: p.einzelpreis_cent })),
    zahlungsweg: art === 'angebot' || (art === 'rechnung' && b.status !== 'bezahlt') ? null : zahlungsweg,
    quittiert,
    eigenbeleg:
      art === 'eigenbeleg'
        ? {
            grund: istGrund(zusatz.grund) ? zusatz.grund : 'sonstiges',
            grund_text: str(zusatz.grund_text),
            gebucht: b.buchung_nummer ? { nummer: b.buchung_nummer, kategorie: '' } : null,
          }
        : null,
    ausgestellt_am: null,
    firma,
    ust_modus: ustModus,
    storno_von: storno && b.storno_von_nummer ? { nummer: b.storno_von_nummer, datum: b.storno_von_datum ?? '' } : null,
  };
  return { dokument, bausteine: standardVorlage(art), akzent: null };
}

/** Dokument und Bausteine eines ausgestellten Belegs: Schnappschuss, sonst nachgebaut. Stornierte Originale tragen im
 * Blatt das Wasserzeichen STORNIERT (das abgelegte PDF bleibt, wie es ausgestellt wurde). */
export function ausgestellterBeleg(b: BelegVoll, positionen: readonly PositionZeile[], firma: Firma, ustModus: UstModus): Schnappschuss {
  const s = schnappschussLesen(b.snapshot_json) ?? dokumentAusZeile(b, positionen, firma, ustModus);
  const storniert = b.status === 'storniert' && b.art !== 'storno';
  return { ...s, dokument: { ...s.dokument, storniert } };
}

/** Meldung zu einem Satzfehler (mit Baustein und Zeile, wenn bekannt). */
export function satzFehlerText(e: unknown, main?: Parameters<typeof fehlerZeilen>[1]): string {
  if (e instanceof KompilierFehler) {
    const zeilen = fehlerZeilen(e, main);
    return zeilen.length ? `${e.message} ${zeilen.slice(0, 2).join(' · ')}` : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/** PDF aus dem Schnappschuss setzen und als Beleg ablegen (genau einmal). Gibt die ID in `belege` zurück. */
export async function pdfErzeugenUndAblegen(id: number, s: Schnappschuss, akzent: string): Promise<number> {
  const bausteine = bausteineFuer(s.dokument, s.bausteine);
  // Das abgelegte PDF zeigt den Beleg, wie er ausgestellt wurde – nie mit Wasserzeichen
  const dokument = { ...s.dokument, storniert: false };
  const tex = belegTex(dokument, bausteine, s.akzent ?? akzent, await belegLogo(dokument));
  let pdf: Uint8Array;
  try {
    pdf = await kompiliere({ main: tex.main.tex, daten: tex.daten, assets: tex.assets });
  } catch (e) {
    throw new Error(satzFehlerText(e, tex.main));
  }
  return belegPdfAblegen(id, pdf);
}

/** Ausgestellten Beleg öffnen (Vorschau-App ⇒ Drucken oder „Als PDF sichern“); ohne abgelegtes PDF erst erzeugen. */
export async function belegPdfOeffnen(b: Pick<BelegVoll, 'id' | 'pdf_beleg_id'>, s: Schnappschuss, akzent: string): Promise<number> {
  const pdfId = b.pdf_beleg_id ?? (await pdfErzeugenUndAblegen(b.id, s, akzent));
  await belegOeffnen(pdfId);
  return pdfId;
}

/** Entwurf ansehen/drucken: in den Cache setzen (Wasserzeichen ENTWURF) und in der Vorschau-App öffnen. */
export async function entwurfOeffnen(doc: BelegDokument, bausteine: readonly Baustein[], akzent: string): Promise<void> {
  const tex = belegTex(doc, bausteineFuer(doc, bausteine), akzent, await belegLogo(doc));
  const name = `Kladdy-Entwurf-${ARTEN[doc.art].label}.pdf`;
  try {
    await kompiliere({ main: tex.main.tex, daten: tex.daten, assets: tex.assets }, name);
  } catch (e) {
    throw new Error(satzFehlerText(e, tex.main));
  }
  await pdfOeffnen(name);
}

/** Betreff und Text für „Per Mail senden“ (mailto:). */
export function mailText(doc: BelegDokument): { betreff: string; text: string } {
  const titel = `${ARTEN[doc.art].label} ${doc.nummer ?? ''}`.trim();
  const summe = formatBetrag(belegSumme(doc));
  const gruss = doc.firma.inhaber.trim() || doc.firma.name.trim();
  const anrede = doc.kunde?.name ? `Guten Tag ${doc.kunde.name},` : 'Guten Tag,';
  const zeilen = [anrede, '', `anbei erhalten Sie ${doc.art === 'rechnung' ? 'meine' : 'die'} ${titel} über ${summe}.`, '', 'Mit freundlichen Grüßen', gruss];
  return { betreff: `${titel}${doc.betreff ? ` · ${doc.betreff}` : ''}`, text: zeilen.join('\n') };
}
