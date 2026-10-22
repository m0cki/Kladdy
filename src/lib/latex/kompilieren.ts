/* PDF-Satz über Rust (src-tauri/src/latex.rs, ANLEITUNG §7.1–7.3): main.tex + daten.tex (+ Bilder) ⇒ PDF-Bytes.
 * Rust schreibt alles in einen frischen Temp-Ordner, ruft `tectonic -X compile main.tex --untrusted` ohne Shell auf
 * (60 s Zeitlimit) und liefert das PDF als ArrayBuffer. Ein neuer Auftrag bricht einen laufenden ab (Live-Vorschau).
 * Fehler kommen als Objekt mit Zeilen aus dem Log; `KompilierFehler` macht daraus eine lesbare Meldung und ordnet
 * Zeilen von main.tex dem Baustein zu. Bilder eines Belegs (girocode.png, logo.png) liefert `belegAssets` bzw. `belegTex`
 * mit – wer einen Beleg setzt, gibt `assets` immer mit, sonst fehlen GiroCode bzw. Logo und Tectonic bricht ab. Die
 * Bytes des Logos lädt vorher `belegLogo(doc)` (Datei aus `doc.logo`). */
import { invoke } from '@tauri-apps/api/core';
import { fehlerText } from '../fehler';
import { LOGO_TEX_DATEI, vorlageZeigtLogo } from '../firmenlogo';
import { GIROCODE_DATEI, girocodePng, vorlageZeigtGirocode } from '../girocode/girocode';
import { logoBytes } from '../queries/firmenlogo';
import type { Baustein } from '../vorlagen/bausteine';
import type { BelegDokument } from '../vorlagen/dokument';
import { datenTex } from './daten';
import { bereichZuZeile, mainTex, type MainTex } from './vorlage';

/** Zusatzdatei im Temp-Ordner (z. B. Logo). Name: Buchstaben/Ziffern/-/_ mit .png/.jpg/.jpeg/.pdf (Rust prüft). */
export interface TexAsset {
  name: string;
  daten: Uint8Array;
}

export interface TexAuftrag {
  main: string;
  daten: string;
  assets?: TexAsset[];
}

export interface LogFehler {
  datei: string | null;
  zeile: number | null;
  meldung: string;
  kontext: string | null;
}

/** Fehlerobjekt aus Rust (latex.rs `KompilierFehler`). */
export interface KompilierFehlerDaten {
  meldung: string;
  fehler: LogFehler[];
  abgebrochen: boolean;
  log: string;
}

export class KompilierFehler extends Error {
  readonly fehler: LogFehler[];
  readonly abgebrochen: boolean;
  readonly log: string;
  constructor(d: KompilierFehlerDaten) {
    super(d.meldung);
    this.name = 'KompilierFehler';
    this.fehler = d.fehler;
    this.abgebrochen = d.abgebrochen;
    this.log = d.log;
  }
}

const istFehlerDaten = (e: unknown): e is KompilierFehlerDaten =>
  !!e && typeof e === 'object' && typeof (e as KompilierFehlerDaten).meldung === 'string' && Array.isArray((e as KompilierFehlerDaten).fehler);

/**
 * Kompiliert und liefert die PDF-Bytes. `ablage` (z. B. 'Kladdy-Testbeleg.pdf'): Rust legt das PDF zusätzlich im
 * Cache-Ordner der App ab, damit `pdfOeffnen` es in der Vorschau-App zeigen kann.
 */
export async function kompiliere(auftrag: TexAuftrag, ablage?: string): Promise<Uint8Array> {
  try {
    const buf = await invoke<ArrayBuffer>('compile_latex', {
      auftrag: {
        main: auftrag.main,
        daten: auftrag.daten,
        assets: (auftrag.assets ?? []).map((a) => ({ name: a.name, daten: Array.from(a.daten) })),
        ablage: ablage ?? null,
      },
    });
    return new Uint8Array(buf);
  } catch (e) {
    throw istFehlerDaten(e) ? new KompilierFehler(e) : e;
  }
}

/** Abgelegtes PDF (Name wie bei `kompiliere(…, ablage)`) mit der Standard-App öffnen. */
export const pdfOeffnen = (name: string): Promise<void> => invoke<void>('pdf_oeffnen', { name });

/** Bilder für den Satz eines Belegs: girocode.png, wenn ein sichtbarer Baustein „Zahlung“ den GiroCode zeigt und
 * \GiroCode in daten.tex gesetzt ist (offene Rechnung mit gültigen Daten); logo.png, wenn der Beleg ein Logo hat
 * (`doc.logo`, Bytes in `logo`) und ein sichtbarer Baustein „Kopf“ es zeigt. */
export function belegAssets(doc: BelegDokument, bausteine: readonly Baustein[], logo: Uint8Array | null = null): TexAsset[] {
  const assets: TexAsset[] = [];
  const png = vorlageZeigtGirocode(bausteine) ? girocodePng(doc) : null;
  if (png) assets.push({ name: GIROCODE_DATEI, daten: png });
  if (doc.logo && logo && vorlageZeigtLogo(bausteine)) assets.push({ name: LOGO_TEX_DATEI, daten: logo });
  return assets;
}

/** Beide Dateien für einen Beleg und die Bilder dazu (`kompiliere({ main: main.tex, daten, assets })`). `logo`: Bytes
 * des Firmenlogos (`belegLogo(doc)`); ohne sie bleibt \LogoDatei leer, damit nie eine fehlende Datei eingebunden wird. */
export function belegTex(
  doc: BelegDokument,
  bausteine: readonly Baustein[],
  akzent: string,
  logo: Uint8Array | null = null,
): { main: MainTex; daten: string; assets: TexAsset[] } {
  const d = doc.logo && !logo ? { ...doc, logo: null } : doc;
  return { main: mainTex(d.art, bausteine, akzent), daten: datenTex(d), assets: belegAssets(d, bausteine, logo) };
}

/** Bytes des Firmenlogos eines Belegs für den PDF-Satz (null = keins). Fehlt die Datei, scheitert das bei einem
 * ausgestellten Beleg (sein PDF muss aussehen wie ausgestellt); Entwürfe und Vorschauen setzen dann ohne Logo. */
export async function belegLogo(doc: BelegDokument): Promise<Uint8Array | null> {
  if (!doc.logo) return null;
  try {
    return await logoBytes(doc.logo);
  } catch (e) {
    if (doc.nummer) throw new Error(`Das Firmenlogo des Belegs (${doc.logo}) fehlt: ${fehlerText(e)}`);
    return null;
  }
}

/** Lesbare Zeilen für die Fehleranzeige: „Baustein „Positionen“ (main.tex Zeile 88): Undefined control sequence“. */
export function fehlerZeilen(f: KompilierFehler, main?: MainTex): string[] {
  return f.fehler.map((x) => {
    const datei = x.datei ?? 'main.tex';
    const bereich = main && datei === 'main.tex' && x.zeile != null ? bereichZuZeile(main, x.zeile) : null;
    const ort = x.zeile != null ? `${datei} Zeile ${x.zeile}` : datei;
    return bereich ? `Baustein „${bereich.name}“ (${ort}): ${x.meldung}` : `${ort}: ${x.meldung}`;
  });
}
