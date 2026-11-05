/* Vorlagen-Baukasten (ANLEITUNG §7.0, §6.7; Prototyp js/pages/vorlagen.js): Belege aus Bausteinen zusammenstellen.
 * - Art-Umschalter Rechnung · Quittung · Angebot · Eigenbeleg, auch aus der Adresse (?art=rechnung), damit die
 *   Beleg-Maske direkt hierher verlinken kann. Ohne ?art= gilt die zuletzt gewählte Art.
 * - Leiste über dem Baukasten: alle mitgelieferten Designs (lib/vorlagen/standard.ts) und die eigenen Vorlagen der Art
 *   (lib/vorlagen/eigene.ts), gezeigt wird die gewählte (?design=formular bzw. ?design=eigen:12; sonst die zuletzt
 *   gezeigte je Art, sonst die aktive). Zeigen ändert nie, was neue Belege nehmen – das tun „Diese verwenden“
 *   (Einstellung 'vorlagen_design') und die erste Änderung am aktiven Design (die Kopie wird aktiv). „Neue Vorlage“ legt mit Namen eine eigene an (Bausteine der gezeigten),
 *   Stift = umbenennen, Papierkorb = entfernen (archiviert, mit Rückgängig; Belege, die sie nutzen, bleiben gültig).
 * - Links: Bausteinliste (Griff zum Ziehen per Zeiger, ↑/↓ auf dem Griff; Auge = ausblenden, × = entfernen mit
 *   Rückgängig), „+ Baustein hinzufügen“ (Palette mit allen Bausteinen der Art, eingefügt unter dem ausgewählten),
 *   darunter die Einstellungen des gewählten Bausteins mit Platzhalter-Chips (fügen {name} an der Schreibmarke ein) und
 *   der Pflichtangaben-Check (§2.3) mit den Daten der Vorschau – ohne „Steuerhinweis (§ 19)“ sofort rot.
 * - Rechts: Live-Vorschau mit Beispieldaten (eigene Firmendaten, sobald eingetragen) oder – Umschalter „Beispiel ·
 *   Letzter Beleg“, nur wenn es einen gibt, je Art gemerkt – mit dem letzten Beleg der Art in den aktuellen Bausteinen
 *   (lib/vorlagen/vorschau.ts: nur gelesen, ohne Nummer ⇒ Wasserzeichen ENTWURF). Bei Quittung und Eigenbeleg
 *   zusätzlich „Blanko“: Formular zum Ausdrucken und Ausfüllen von Hand (beispiel.ts `blankobeleg`: Firmendaten
 *   gedruckt, Werte als Schreiblinien, kein Wasserzeichen, keine Nummer, nichts gespeichert). Klick ins Blatt wählt den
 *   Baustein; Klick auf einen Text aus einer Einstellung bearbeitet ihn direkt im Blatt (FormatEditor: fett, kursiv,
 *   unterstrichen, Platzhalter als Chips; Esc oder Klick daneben beendet). Die Einstellungskarte nutzt denselben Editor.
 *   Jede Eingabe läuft über `einstellen` (Autosave, eigene Kopie, Protokoll wie bisher). „PDF“ setzt das Blatt mit Tectonic wie der Testbeleg (Entwurf, keine Nummer, nichts wird abgelegt) und
 *   öffnet es, Fehler mit Baustein und Zeile. „LaTeX“ zeigt die erzeugte main.tex (nur lesen).
 * - Speichern: Mitgelieferte Designs bleiben unverändert. Die erste Änderung an einem Design legt sofort eine eigene
 *   Vorlage an („Meine Quittung“, bei Bedarf mit Nummer; war das Design aktiv, wird sie es auch), der Baukasten bleibt
 *   dabei offen. Danach automatisch (entprellt, beim Verlassen sofort). „Zurücksetzen“ (nur eigene) holt die Bausteine
 *   des Designs, von dem sie stammt (mit Rückgängig). Unter den Einstellungen ein Hinweis auf Einstellungen › Firma.
 *   Bedeutung der Tabelle `vorlagen`: lib/queries/vorlagen.ts. Im Browser ohne Datenbank: nur die Designs,
 *   Änderungen nur auf dieser Seite.
 * Logik in lib/vorlagen/baukasten.ts, Stile in styles/vorlagen.css. */
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Blocks,
  Building2,
  Check,
  CircleCheck,
  Clock,
  Code,
  Eye,
  EyeOff,
  FileText,
  GripVertical,
  Heading,
  Info,
  Landmark,
  List,
  LoaderCircle,
  Lock,
  Mail,
  Minus,
  MoveVertical,
  PanelTop,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Receipt,
  RotateCcw,
  Send,
  Sigma,
  Signature,
  SquareDashed,
  Stamp,
  Trash2,
  TriangleAlert,
  Type,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { BlattVorschau, type BlattBearbeitung } from '../components/belege/Blatt';
import { FormatEditor, type FormatEditorHandle } from '../components/belege/FormatEditor';
import { PageHead, reveal } from '../components/ui/PageHead';
import { Seg, type SegOption } from '../components/ui/Seg';
import { Switch } from '../components/ui/Switch';
import { datenbankVerfuegbar } from '../lib/db';
import { bereichPfad } from '../lib/einstellungen-index';
import { fehlerText } from '../lib/fehler';
import type { Firma } from '../lib/firma';
import { texTeile, type TexTeilArt } from '../lib/latex/hervorheben';
import { KompilierFehler, belegLogo, belegTex, fehlerZeilen, kompiliere, pdfOeffnen } from '../lib/latex/kompilieren';
import { mainTex } from '../lib/latex/vorlage';
import { useFirmenlogo } from '../lib/logoablage';
import { inTauri } from '../lib/menu';
import { UST_MODUS_STANDARD, ladeFirma, ladeUstModus, type UstModus } from '../lib/queries/einstellungen';
import { ladeBelege } from '../lib/queries/rechnungen';
import {
  ladeAktivenSchluessel,
  ladeEigeneVorlagen,
  speichereAktiveVorlage,
  speichereVorlage,
  vorlageAnlegen,
  vorlageEntfernen,
  vorlageUmbenennen,
  vorlageWiederherstellen,
  type EigeneVorlage,
} from '../lib/queries/vorlagen';
import type { BelegZeile } from '../lib/rechnungen';
import { BAUSTEINE, aufloesen, type Baustein, type BausteinTyp, type Einstellung } from '../lib/vorlagen/bausteine';
import {
  einfuegen,
  einstellen,
  entfernen,
  erlaubteTypen,
  stelleAusMitten,
  umschalten,
  verschieben,
  ziehen,
  ziehenAendert,
  zurueckEinfuegen,
  zusammenfassung,
} from '../lib/vorlagen/baukasten';
import { BEISPIEL_FIRMA, beispielbeleg, blankobeleg, firmaOderBeispiel, hatBlanko } from '../lib/vorlagen/beispiel';
import { ARTEN, BELEGARTEN, PLATZHALTER, PLATZHALTER_KURZ, istBelegart, zerlegen, type BelegDokument, type Belegart, type PlatzhalterName } from '../lib/vorlagen/dokument';
import { pflichtCheck, type Pflichtangabe } from '../lib/vorlagen/pflicht';
import {
  NAME_MAX,
  designName,
  eigenSchluessel,
  istWaehlbar,
  nameBereinigen,
  namePruefen,
  vergebeneNamen,
  wahlListe,
  type VorlagenWahl,
} from '../lib/vorlagen/eigene';
import { designFuer, designSchluessel, standardVorlage } from '../lib/vorlagen/standard';
import {
  ladeGezeigteDesigns,
  ladeQuellen,
  ladeVorschauBeleg,
  letzterBeleg,
  speichereGezeigtesDesign,
  speichereQuelle,
  type Vorschauquelle,
} from '../lib/vorlagen/vorschau';
import { heute } from '../lib/zeitraum';
import { useUi } from '../store/ui';
import { akzentPapier } from '../lib/settings';
import { Ladeansicht } from './einstellungen/Laden';

/** Symbol je Baustein (wie App.sheet.BLOCKS im Prototyp) */
const ICON: Readonly<Record<BausteinTyp, LucideIcon>> = {
  kopf: PanelTop,
  absenderzeile: Send,
  anschrift_meta: Users,
  titel: Heading,
  betreff: Pencil,
  text: Type,
  positionen: List,
  summe: Sigma,
  betrag_worte: Pencil,
  steuerhinweis: Info,
  zahlung: QrCode,
  quittung_felder: Receipt,
  eigenbeleg_felder: Stamp,
  gruss: Mail,
  unterschrift: Signature,
  trennlinie: Minus,
  abstand: MoveVertical,
  fusszeile: Landmark,
  datenschutz: Lock,
  firmenblock: Building2,
  rahmen: SquareDashed,
};

const ART_OPTIONEN: readonly SegOption<Belegart>[] = BELEGARTEN.map((a) => ({ value: a, label: ARTEN[a].label }));

type Ansicht = 'vorschau' | 'latex';

/** Autosave: so lange nach der letzten Änderung warten (sonst landet jeder Tastendruck im Protokoll) */
const SPEICHERN_MS = 600;
/** Toast mit „Rückgängig“: ein neuer ersetzt den alten, beim Verlassen der Seite verschwindet er */
const RUECKGAENGIG = 'vorlage-rueckgaengig';
/** Rechtsgrundlage im Pflichtangaben-Check (wie im Prototyp) */
const GRUNDLAGE: Readonly<Record<Belegart, string>> = { rechnung: '§ 34a UStDV', quittung: '§ 33/§ 34a UStDV', angebot: '', eigenbeleg: '' };
const KEINE_OPTIONEN: readonly (readonly [string, string])[] = [];
const TX_KLASSE: Readonly<Record<TexTeilArt, string>> = { kommentar: 'tx-c', befehl: 'tx-k', klammer: 'tx-b', text: '' };
/** Hinweis unter dem Blanko-Formular: von Hand ausgefüllt heißt nicht gebucht */
const BLANKO_HINWEIS: Readonly<Record<Belegart, string>> = {
  quittung:
    'Ohne Nummer, es wird nichts gespeichert. Die Einnahme buchst du wie gewohnt über „+ Erfassen“ › „Nur buchen“ und schreibst die Buchungsnummer ins Feld „Nr.“ – dann gehören Zettel und Buchung zusammen.',
  eigenbeleg:
    'Ohne Nummer, es wird nichts gespeichert. Die Ausgabe buchst du über „+ Erfassen“ und schreibst die Buchungsnummer ins Feld „Nr.“.',
  rechnung: '',
  angebot: '',
};
/** „Neue Quittungen verwenden …“ */
const MEHRZAHL: Readonly<Record<Belegart, string>> = { rechnung: 'Rechnungen', quittung: 'Quittungen', angebot: 'Angebote', eigenbeleg: 'Eigenbelege' };
const QUELLE_BEISPIEL: SegOption<Vorschauquelle> = { value: 'beispiel', label: 'Beispiel' };
const QUELLE_BELEG: SegOption<Vorschauquelle> = { value: 'beleg', label: 'Letzter Beleg' };
const QUELLE_BLANKO: SegOption<Vorschauquelle> = { value: 'blanko', label: 'Blanko' };

const speicher = (): Storage | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

// Zuletzt gewählte Art bleibt beim Seitenwechsel erhalten (wenn die Adresse keine nennt)
let zuletzt: Belegart = 'rechnung';

/** Letzter Schreibauftrag dieser Seite. Laden wartet darauf, damit ein eben (beim Verlassen der Art) gespeicherter
 *  Stand nicht veraltet zurückkommt; untereinander laufen die Aufträge ohnehin der Reihe nach (nacheinander). */
let schreibt: Promise<unknown> = Promise.resolve();
function merkeSchreiben<T>(auftrag: Promise<T>): Promise<T> {
  schreibt = auftrag.catch(() => undefined);
  return auftrag;
}

type Basis = { firma: Firma; ust: UstModus };
/** Letzter Beleg je Art (null = keiner); ohne Datenbank oder bei Fehler: keiner, dann gibt es nur Beispieldaten */
type Letzte = Record<Belegart, BelegZeile | null>;
const KEINE: Letzte = { rechnung: null, quittung: null, angebot: null, eigenbeleg: null };
/** Gelesen für eine Art: eigene Vorlagen (auch entfernte) und der Schlüssel der aktiven */
type Stand =
  | { art: Belegart; status: 'ok'; eigene: readonly EigeneVorlage[]; aktiv: string }
  | { art: Belegart; status: 'fehler'; fehler: string };
/** Namensfeld der Leiste: neue Vorlage anlegen oder die gezeigte umbenennen */
type NamensEingabe = { modus: 'neu' | 'umbenennen'; wert: string; gezeigt: boolean };

export default function Vorlagen() {
  const [params, setParams] = useSearchParams();
  const roh = params.get('art');
  const art: Belegart = istBelegart(roh) ? roh : zuletzt;
  // gewünschte Vorlage: aus der Adresse, sonst die zuletzt gezeigte der Art; '' = die aktive
  const wunsch = params.get('design') ?? ladeGezeigteDesigns(speicher())[art] ?? '';
  const [basis, setBasis] = useState<Basis | null>(null);
  const [stand, setStand] = useState<Stand | null>(null);
  const [versuch, setVersuch] = useState(0);
  /** null = wird noch gelesen (ein gemerktes „Letzter Beleg“ soll nicht erst die Beispieldaten zeigen) */
  const [letzte, setLetzte] = useState<Letzte | null>(() => (datenbankVerfuegbar() ? null : KEINE));
  const [laeuft, setLaeuft] = useState(false);
  /** Baukasten neu aufbauen: zählt bei jedem Wechsel der gezeigten Vorlage hoch */
  const [wechsel, setWechsel] = useState(0);
  /** Erste Änderung an einem Design hat eine eigene Vorlage angelegt: Der Baukasten bleibt (Schreibmarke, Auswahl),
   *  nur die Leiste zeigt jetzt die neue. `key` = Schlüssel des Baukastens von vorher. */
  const [uebernommen, setUebernommen] = useState<{ zu: string; key: string } | null>(null);
  /** Bausteine des Baukastens (für „Neue Vorlage“: startet mit der gerade gezeigten) */
  const aktuelleBausteine = useRef<Baustein[]>([]);

  useEffect(() => {
    zuletzt = art;
  }, [art]);

  // Letzter Beleg je Art für „Beispiel · Letzter Beleg“ (nur lesen)
  useEffect(() => {
    if (!datenbankVerfuegbar()) return;
    let weg = false;
    ladeBelege().then(
      (zeilen) => {
        if (!weg) setLetzte(Object.fromEntries(BELEGARTEN.map((a) => [a, letzterBeleg(zeilen, a)])) as Letzte);
      },
      () => {
        if (!weg) setLetzte(KEINE); // ohne Liste eben nur Beispieldaten
      },
    );
    return () => {
      weg = true;
    };
  }, []);

  // Firmendaten für die Beispieldaten (ohne Datenbank oder bei Fehler: Beispielfirma, wie beim Testbeleg)
  useEffect(() => {
    let weg = false;
    const fertig = (b: Basis) => {
      if (!weg) setBasis(b);
    };
    if (!datenbankVerfuegbar()) fertig({ firma: BEISPIEL_FIRMA, ust: UST_MODUS_STANDARD });
    else
      Promise.all([ladeFirma(), ladeUstModus()]).then(
        ([f, ust]) => fertig({ firma: firmaOderBeispiel(f), ust }),
        () => fertig({ firma: BEISPIEL_FIRMA, ust: UST_MODUS_STANDARD }),
      );
    return () => {
      weg = true;
    };
  }, []);

  // Eigene Vorlagen und aktive Vorlage der Art, erst nach dem letzten Schreibauftrag dieser Seite gelesen, damit ein
  // eben (beim Verlassen der Art) gespeicherter Stand nicht veraltet zurückkommt. Danach hält die Seite den Stand selbst.
  useEffect(() => {
    void versuch; // „Erneut versuchen“
    let weg = false;
    schreibt
      .then(async () => {
        const eigene = await ladeEigeneVorlagen(art);
        return { eigene, aktiv: await ladeAktivenSchluessel(art, eigene) };
      })
      .then(
        ({ eigene, aktiv }) => {
          if (!weg) setStand({ art, status: 'ok', eigene, aktiv });
        },
        (e: unknown) => {
          if (!weg) setStand({ art, status: 'fehler', fehler: fehlerText(e) });
        },
      );
    return () => {
      weg = true;
    };
  }, [art, versuch]);

  const bereit = basis && stand?.art === art ? stand : null;
  const ok = bereit?.status === 'ok' ? bereit : null;
  const liste = useMemo(() => (ok ? wahlListe(art, ok.eigene, ok.aktiv) : []), [art, ok]);
  // gezeigt: die gewünschte, wenn es sie (noch) gibt, sonst die aktive
  const gezeigt = ok ? (istWaehlbar(art, wunsch, ok.eigene) ? wunsch : ok.aktiv) : null;
  const wahl = liste.find((v) => v.schluessel === gezeigt) ?? null;

  // Vorlage aus der Adresse (z. B. aus der Beleg-Maske) als gezeigte merken; ohne Wunsch bleibt es bei der aktiven
  useEffect(() => {
    if (gezeigt && wunsch === gezeigt) speichereGezeigtesDesign(speicher(), art, gezeigt);
  }, [art, gezeigt, wunsch]);

  const adresse = (n: { art?: Belegart; design?: string | null }) =>
    setParams(
      (p) => {
        const x = new URLSearchParams(p);
        if (n.art) x.set('art', n.art);
        if (n.design) x.set('design', n.design);
        else if (n.design === null) x.delete('design');
        return x;
      },
      { replace: true },
    );
  // andere Art ⇒ deren zuletzt gezeigte (sonst aktive) Vorlage
  const artWaehlen = (v: Belegart) => {
    setWechsel((n) => n + 1);
    adresse({ art: v, design: null });
  };
  const zeigen = (s: string) => {
    speichereGezeigtesDesign(speicher(), art, s);
    setWechsel((n) => n + 1);
    adresse({ design: s });
  };
  const designWaehlen = (s: string) => {
    if (s !== gezeigt) zeigen(s);
  };

  /** Stand der Seite ändern (eigene Vorlage neu/geändert, aktive), ohne neu zu lesen. */
  const standSetzen = (f: (st: Extract<Stand, { status: 'ok' }>) => Partial<Extract<Stand, { status: 'ok' }>>) =>
    setStand((st) => (st?.status === 'ok' && st.art === art ? { ...st, ...f(st) } : st));
  const eigeneSetzen = (v: EigeneVorlage) =>
    standSetzen((st) => ({ eigene: st.eigene.some((x) => x.id === v.id) ? st.eigene.map((x) => (x.id === v.id ? v : x)) : [...st.eigene, v] }));

  /** Erste Änderung an einem Design: eigene Vorlage angelegt (und, wenn das Design aktiv war, gleich aktiv). */
  const kopieAngelegt = (v: EigeneVorlage, vonKey: string, aktiviert: boolean) => {
    const s = eigenSchluessel(v.id);
    setUebernommen({ zu: s, key: vonKey });
    standSetzen((st) => ({ eigene: [...st.eigene.filter((x) => x.id !== v.id), v], ...(aktiviert ? { aktiv: s } : {}) }));
    speichereGezeigtesDesign(speicher(), art, s);
    adresse({ design: s });
  };

  const verwenden = () => {
    if (!wahl || !ok) return;
    const w = wahl;
    setLaeuft(true);
    merkeSchreiben(speichereAktiveVorlage(art, w.schluessel)).then(
      () => {
        setLaeuft(false);
        standSetzen(() => ({ aktiv: w.schluessel }));
        useUi.getState().toast(`Neue ${MEHRZAHL[art]} verwenden jetzt „${w.name}“`);
      },
      (e: unknown) => {
        setLaeuft(false);
        useUi.getState().showToast({ text: `Vorlage nicht übernommen: ${fehlerText(e)}`, icon: 'warn', sticky: true });
      },
    );
  };

  const anlegen = (name: string) => {
    if (!wahl) return Promise.resolve(false);
    setLaeuft(true);
    return merkeSchreiben(vorlageAnlegen(art, aktuelleBausteine.current, { basis: wahl.design, name })).then(
      (v) => {
        setLaeuft(false);
        eigeneSetzen(v);
        zeigen(eigenSchluessel(v.id));
        useUi.getState().toast(`Vorlage „${v.name}“ angelegt – Änderungen speichern sich automatisch`);
        return true;
      },
      (e: unknown) => {
        setLaeuft(false);
        useUi.getState().showToast({ text: `Vorlage nicht angelegt: ${fehlerText(e)}`, icon: 'warn', sticky: true });
        return false;
      },
    );
  };

  const umbenennen = (name: string) => {
    if (wahl?.id == null) return Promise.resolve(false);
    setLaeuft(true);
    return merkeSchreiben(vorlageUmbenennen(wahl.id, name)).then(
      (v) => {
        setLaeuft(false);
        eigeneSetzen(v);
        useUi.getState().toast(`Vorlage heißt jetzt „${v.name}“`);
        return true;
      },
      (e: unknown) => {
        setLaeuft(false);
        useUi.getState().showToast({ text: `Nicht umbenannt: ${fehlerText(e)}`, icon: 'warn', sticky: true });
        return false;
      },
    );
  };

  const entfernen = () => {
    if (wahl?.id == null) return;
    const { id, design, name } = wahl;
    // zuerst wegschalten: der Baukasten schreibt dabei ausstehende Änderungen
    zeigen(design);
    merkeSchreiben(vorlageEntfernen(id)).then(
      ({ vorlage, warAktiv }) => {
        standSetzen(() => ({ ...(warAktiv ? { aktiv: designSchluessel(art, vorlage.basis) } : {}) }));
        eigeneSetzen(vorlage);
        useUi.getState().showToast({
          key: RUECKGAENGIG,
          text: `Vorlage „${name}“ entfernt${warAktiv ? ` – neue ${MEHRZAHL[art]} nehmen wieder „${designName(art, vorlage.basis)}“` : ''}`,
          actions: [
            {
              label: 'Rückgängig',
              run: () => {
                rueckgaengigWeg();
                merkeSchreiben(vorlageWiederherstellen(id, warAktiv)).then(
                  (v) => {
                    eigeneSetzen(v);
                    if (warAktiv) standSetzen(() => ({ aktiv: eigenSchluessel(id) }));
                    zeigen(eigenSchluessel(id));
                  },
                  (e: unknown) => useUi.getState().showToast({ text: `Nicht wiederhergestellt: ${fehlerText(e)}`, icon: 'warn', sticky: true }),
                );
              },
            },
          ],
        });
      },
      (e: unknown) => {
        zeigen(eigenSchluessel(id));
        useUi.getState().showToast({ text: `Vorlage nicht entfernt: ${fehlerText(e)}`, icon: 'warn', sticky: true });
      },
    );
  };

  // Schlüssel des Baukastens: neu bei jedem Wechsel; nach dem automatischen Anlegen einer Kopie derselbe wie vorher
  const baukastenKey = uebernommen && uebernommen.zu === gezeigt ? uebernommen.key : `${art}-${gezeigt ?? ''}-${wechsel}`;

  return (
    <div className="page vl-page">
      <PageHead
        icon={Blocks}
        title="Vorlagen"
        sub="So sehen deine Belege aus. Baustein wählen und einstellen – oder direkt ins Blatt klicken und Texte ändern."
        back={{ to: '/belege', label: 'Rechnungen & Quittungen' }}
        actions={<Seg options={ART_OPTIONEN} value={art} onChange={artWaehlen} ariaLabel="Belegart der Vorlage" />}
      />
      {!basis || !bereit || !letzte ? (
        <Skelett />
      ) : bereit.status === 'fehler' ? (
        <Ladeansicht
          zustand={{ status: 'fehler', fehler: bereit.fehler }}
          icon={Blocks}
          was="Die Vorlagen"
          erneut={() => {
            setStand(null);
            setVersuch((n) => n + 1);
          }}
        />
      ) : (
        wahl &&
        ok && (
          <>
            <VorlagenLeiste
              art={art}
              liste={liste}
              wahl={wahl}
              aktiv={ok.aktiv}
              vergeben={(ohneId) => vergebeneNamen(art, ok.eigene, ohneId)}
              waehlen={designWaehlen}
              verwenden={verwenden}
              anlegen={anlegen}
              umbenennen={umbenennen}
              entfernen={entfernen}
              laeuft={laeuft}
            />
            <Baukasten
              key={baukastenKey}
              art={art}
              wahl={wahl}
              aktiv={ok.aktiv === wahl.schluessel}
              basis={basis}
              letzter={letzte[art]}
              aktuell={aktuelleBausteine}
              angelegt={(v, aktiviert) => kopieAngelegt(v, baukastenKey, aktiviert)}
              gespeichert={eigeneSetzen}
            />
          </>
        )
      )}
    </div>
  );
}

/* ================= Leiste: Designs und eigene Vorlagen der Art ================= */

interface LeisteProps {
  art: Belegart;
  liste: readonly VorlagenWahl[];
  wahl: VorlagenWahl;
  aktiv: string;
  /** vergebene Namen der Art (ohne die Vorlage mit `ohneId`) */
  vergeben: (ohneId?: number) => string[];
  waehlen: (schluessel: string) => void;
  verwenden: () => void;
  anlegen: (name: string) => Promise<boolean>;
  umbenennen: (name: string) => Promise<boolean>;
  entfernen: () => void;
  laeuft: boolean;
}

function VorlagenLeiste({ art, liste, wahl, aktiv, vergeben, waehlen, verwenden, anlegen, umbenennen, entfernen, laeuft }: LeisteProps) {
  const mitDb = datenbankVerfuegbar();
  const [eingabe, setEingabe] = useState<NamensEingabe | null>(null);
  const eigen = wahl.id != null;
  const optionen: SegOption<string>[] = liste
    .filter((v) => !v.archiviert)
    .map((v) => ({
      value: v.schluessel,
      label: (
        <>
          {v.aktiv && <CircleCheck aria-label="für neue Belege" />}
          {v.name}
          {v.id != null && <small className="vl-design-tag">eigene</small>}
        </>
      ),
    }));
  const aktivName = liste.find((v) => v.schluessel === aktiv)?.name ?? '';
  const fehler = eingabe?.gezeigt ? namePruefen(eingabe.wert, vergeben(eingabe.modus === 'umbenennen' ? (wahl.id ?? undefined) : undefined)) : null;
  const nurMac = 'Nur in der Mac-App';

  const oeffnen = (modus: NamensEingabe['modus']) =>
    setEingabe({ modus, wert: modus === 'umbenennen' ? wahl.name : '', gezeigt: false });
  const absenden = () => {
    if (!eingabe) return;
    const f = namePruefen(eingabe.wert, vergeben(eingabe.modus === 'umbenennen' ? (wahl.id ?? undefined) : undefined));
    if (f) return setEingabe({ ...eingabe, gezeigt: true });
    if (eingabe.modus === 'umbenennen' && nameBereinigen(eingabe.wert) === wahl.name) return setEingabe(null);
    void (eingabe.modus === 'neu' ? anlegen(eingabe.wert) : umbenennen(eingabe.wert)).then((fertig) => {
      if (fertig) setEingabe(null);
    });
  };

  return (
    <div className="vl-designs reveal" style={reveal(1)}>
      <Seg options={optionen} value={wahl.schluessel} onChange={waehlen} ariaLabel="Vorlage" />
      <div className="vl-design-tools">
        <button
          type="button"
          className="btn subtle vl-design-btn"
          disabled={!mitDb || laeuft}
          title={mitDb ? `Neue eigene Vorlage mit den Bausteinen von „${wahl.name}“ anlegen` : nurMac}
          onClick={() => oeffnen('neu')}
        >
          <Plus />
          Neue Vorlage
        </button>
        {eigen && (
          <>
            <button type="button" className="icon-btn sm" title="Umbenennen" aria-label={`„${wahl.name}“ umbenennen`} disabled={laeuft} onClick={() => oeffnen('umbenennen')}>
              <Pencil />
            </button>
            <button
              type="button"
              className="icon-btn sm"
              title="Entfernen (mit Rückgängig) – Belege, die sie nutzen, bleiben, wie sie sind"
              aria-label={`„${wahl.name}“ entfernen`}
              disabled={laeuft}
              onClick={entfernen}
            >
              <Trash2 />
            </button>
          </>
        )}
      </div>
      {eingabe && (
        <form
          className="vl-name"
          onSubmit={(e) => {
            e.preventDefault();
            absenden();
          }}
        >
          <label htmlFor="vl-name">{eingabe.modus === 'neu' ? 'Name der neuen Vorlage' : 'Neuer Name'}</label>
          <input
            id="vl-name"
            className={`input sm${fehler ? ' invalid' : ''}`}
            value={eingabe.wert}
            maxLength={NAME_MAX + 10}
            placeholder={eingabe.modus === 'neu' ? `z. B. ${ARTEN[art].label} Garten` : undefined}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setEingabe({ ...eingabe, wert: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEingabe(null);
            }}
            aria-invalid={!!fehler}
            aria-describedby={fehler ? 'vl-name-fehler' : undefined}
          />
          <button type="submit" className="btn primary vl-design-btn" disabled={laeuft}>
            {laeuft ? <LoaderCircle className="ic spin" /> : <Check />}
            {eingabe.modus === 'neu' ? 'Anlegen' : 'Speichern'}
          </button>
          <button type="button" className="btn ghost vl-design-btn" onClick={() => setEingabe(null)}>
            Abbrechen
          </button>
          {fehler && (
            <small id="vl-name-fehler" className="vl-name-fehler" role="alert">
              {fehler}
            </small>
          )}
        </form>
      )}
      <div className="vl-design-info">
        <span className="vl-design-desc">{eigen ? `Eigene Vorlage auf Basis von „${designName(art, wahl.design)}“` : designFuer(art, wahl.design).beschreibung}</span>
        {wahl.aktiv ? (
          <span className="vl-design-aktiv">
            <CircleCheck />
            Neue {MEHRZAHL[art]} verwenden diese Vorlage
          </span>
        ) : (
          <span className="vl-design-aktiv">
            Neue {MEHRZAHL[art]} verwenden „{aktivName}“ ·
            <button
              type="button"
              className="btn subtle vl-design-btn"
              disabled={laeuft || !mitDb}
              title={mitDb ? `Neue ${MEHRZAHL[art]} mit „${wahl.name}“ ausstellen – bestehende Belege bleiben, wie sie sind` : nurMac}
              onClick={verwenden}
            >
              {laeuft ? <LoaderCircle className="ic spin" /> : <Check />}
              Diese verwenden
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function Skelett() {
  return (
    <div className="vl-layout" aria-busy="true" aria-label="Wird geladen">
      <div className="stack">
        <div className="sk vl-sk-liste reveal" style={reveal(1)} />
        <div className="sk vl-sk-feld reveal" style={reveal(2)} />
      </div>
      <div className="sk vl-sk-blatt reveal" style={reveal(2)} />
    </div>
  );
}

/* ================= Speichern: entprellt, beim Verlassen sofort ================= */

/**
 * `ziel` = ID der eigenen Vorlage, in die gespeichert wird (Promise, solange sie bei der ersten Änderung an einem Design
 * noch angelegt wird; null = es gibt keine, dann wird nichts geschrieben). `gespeichert` meldet den neuen Stand.
 */
function useAutosave(ziel: RefObject<Promise<number> | null>, gespeichert: (v: EigeneVorlage) => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const offen = useRef<Baustein[] | null>(null);
  const melden = useRef(gespeichert);
  useEffect(() => {
    melden.current = gespeichert;
  });

  /** Ausstehende Änderung jetzt schreiben (Seite/Vorlage verlassen, Zurücksetzen). Ohne Datenbank: nichts. */
  const jetzt = useMemo(
    () => () => {
      clearTimeout(timer.current);
      const liste = offen.current;
      offen.current = null;
      const z = ziel.current;
      if (!liste || !z || !datenbankVerfuegbar()) return;
      merkeSchreiben(z.then((id) => speichereVorlage(id, liste))).then(
        (v) => melden.current(v),
        (e: unknown) => {
          useUi.getState().showToast({ text: `Vorlage nicht gespeichert: ${fehlerText(e)}`, icon: 'warn', sticky: true });
        },
      );
    },
    [ziel],
  );

  useEffect(() => () => jetzt(), [jetzt]);

  return {
    jetzt,
    vormerken: (liste: Baustein[]) => {
      offen.current = liste;
      clearTimeout(timer.current);
      timer.current = setTimeout(jetzt, SPEICHERN_MS);
    },
    sofort: (liste: Baustein[]) => {
      offen.current = liste;
      jetzt();
    },
  };
}

const rueckgaengigWeg = () => {
  const ui = useUi.getState();
  const t = ui.toasts.find((x) => x.key === RUECKGAENGIG);
  if (t) ui.dismissToast(t.id);
};

/* ================= Baukasten einer Art ================= */

type PdfLauf = { status: 'laeuft' } | { status: 'fehler'; meldung: string; zeilen: string[]; log: string } | null;
/** Geladener echter Beleg (Dokument ohne Nummer) */
type Echt = { id: number; doc: BelegDokument };

interface BaukastenProps {
  art: Belegart;
  /** gezeigte Vorlage (Design oder eigene) */
  wahl: VorlagenWahl;
  /** ist die aktive der Art (dann wird eine automatisch angelegte Kopie gleich aktiv) */
  aktiv: boolean;
  basis: Basis;
  letzter: BelegZeile | null;
  /** neuester Stand der Bausteine für die Seite („Neue Vorlage“) */
  aktuell: RefObject<Baustein[]>;
  /** erste Änderung an einem Design hat eine eigene Vorlage angelegt */
  angelegt: (v: EigeneVorlage, aktiviert: boolean) => void;
  /** eigene Vorlage gespeichert */
  gespeichert: (v: EigeneVorlage) => void;
}

function Baukasten({ art, wahl, aktiv, basis, letzter, aktuell: seiteAktuell, angelegt, gespeichert: seiteGespeichert }: BaukastenProps) {
  const accent = useUi((s) => akzentPapier(s.settings));
  const motion = useUi((s) => s.settings.motion);
  const showToast = useUi((s) => s.showToast);
  const mitDb = datenbankVerfuegbar();
  const [bausteine, setBausteine] = useState<Baustein[]>(() => wahl.bausteine.map((b) => ({ ...b })));
  /** Design, von dem die gezeigte Vorlage stammt („Zurücksetzen“ nimmt dessen Bausteine) */
  const original = `„${designName(art, wahl.design)}“`;
  /** eigene Vorlage, in die gespeichert wird (Promise, solange sie angelegt wird); null = gezeigt wird ein Design */
  const ziel = useRef<Promise<number> | null>(wahl.id != null ? Promise.resolve(wahl.id) : null);
  /** Design gezeigt und schon geändert (ohne Datenbank: nur auf dieser Seite) */
  const [geaendert, setGeaendert] = useState(false);
  const [sel, setSel] = useState(0);
  const [palette, setPalette] = useState(false);
  const [ansicht, setAnsicht] = useState<Ansicht>('vorschau');
  /** Ziehen am Griff: Baustein `von` an die Einfügestelle `stelle` */
  const [zug, setZug] = useState<{ von: number; stelle: number } | null>(null);
  const [gespeichert, setGespeichert] = useState(0);
  const [pdf, setPdf] = useState<PdfLauf>(null);
  /** Vorschau mit Beispieldaten oder dem letzten Beleg der Art (je Art gemerkt) */
  const [quelle, setQuelle] = useState<Vorschauquelle>(() => ladeQuellen(speicher())[art]);
  const [echt, setEcht] = useState<Echt | null>(null);
  const listeRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const lebt = useRef(false);
  /** Text, der gerade im Blatt bearbeitet wird (Baustein-Index, Einstellung) und der Klickpunkt beim Öffnen */
  const [imBlatt, setImBlatt] = useState<{ index: number; key: string; klick: { x: number; y: number } } | null>(null);
  /** neuester Stand für „Rückgängig“ aus dem Toast */
  const aktuell = useRef({ bausteine });
  useEffect(() => {
    aktuell.current = { bausteine };
    seiteAktuell.current = bausteine;
  });

  const { jetzt, vormerken, sofort } = useAutosave(ziel, (v) => {
    setGespeichert((n) => n + 1);
    seiteGespeichert(v);
  });

  useEffect(() => {
    lebt.current = true;
    return () => {
      lebt.current = false;
      rueckgaengigWeg();
    };
  }, []);

  // Palette schließen: Klick daneben oder Esc
  useEffect(() => {
    if (!palette) return;
    const weg = (e: Event) => {
      if (!addRef.current?.contains(e.target as Node | null)) setPalette(false);
    };
    const taste = (e: { key: string }) => {
      if (e.key === 'Escape') setPalette(false);
    };
    document.addEventListener('pointerdown', weg);
    document.addEventListener('keydown', taste);
    return () => {
      document.removeEventListener('pointerdown', weg);
      document.removeEventListener('keydown', taste);
    };
  }, [palette]);

  const logo = useFirmenlogo((s) => s.name);
  const mitBeleg = quelle === 'beleg' && letzter != null;
  /** Blanko-Formular zum Ausfüllen von Hand (nur Quittung und Eigenbeleg) */
  const blanko = quelle === 'blanko' && hatBlanko(art);
  const quellen = [QUELLE_BEISPIEL, ...(letzter ? [QUELLE_BELEG] : []), ...(hatBlanko(art) ? [QUELLE_BLANKO] : [])];
  const belegId = mitBeleg ? letzter.id : null;

  // Letzten Beleg lesen wie die Beleg-Maske (nichts wird geschrieben); weg oder Fehler ⇒ zurück zu den Beispieldaten
  useEffect(() => {
    if (belegId == null) return;
    let weg = false;
    const zurueck = (text: string) => {
      if (weg) return;
      setEcht(null);
      setQuelle('beispiel');
      useUi.getState().showToast({ text, icon: 'warn' });
    };
    ladeVorschauBeleg(belegId, { firma: basis.firma, ustModus: basis.ust, logo: '', heute: heute() }).then(
      (d) => {
        if (weg) return;
        if (d) setEcht({ id: belegId, doc: d });
        else zurueck('Der letzte Beleg ist nicht mehr da – Vorschau mit Beispieldaten');
      },
      (e: unknown) => zurueck(`Beleg nicht geladen: ${fehlerText(e)} – Vorschau mit Beispieldaten`),
    );
    return () => {
      weg = true;
    };
  }, [belegId, basis]);

  // bis der gewählte Beleg da ist: Platzhalter statt Blatt, PDF gesperrt
  const echtDoc = belegId != null && echt?.id === belegId ? echt.doc : null;
  const laedt = belegId != null && !echtDoc;
  // aktuelles Firmenlogo auch beim echten Beleg: gezeigt wird, wie die Vorlage heute aussieht
  const doc = useMemo(
    () => ({
      ...(echtDoc ?? (blanko ? blankobeleg(art, basis.firma, basis.ust) : beispielbeleg(art, basis.firma, basis.ust, heute()))),
      logo: logo || null,
    }),
    [echtDoc, blanko, art, basis, logo],
  );
  const pflicht = useMemo(() => pflichtCheck(doc, bausteine), [doc, bausteine]);
  const eigeneFirma = basis.firma !== BEISPIEL_FIRMA;

  const quelleWaehlen = (q: Vorschauquelle) => {
    setQuelle(q);
    speichereQuelle(speicher(), art, q);
  };

  /** Erste Änderung an einem Design: gleich eine eigene Vorlage mit dieser Liste anlegen (und, wenn das Design aktiv
   *  ist, aktiv setzen: neue Belege nehmen die Änderung wie bisher). Weitere Änderungen warten, bis sie da ist. */
  const kopieAnlegen = (liste: Baustein[]) => {
    const auftrag = merkeSchreiben(vorlageAnlegen(art, liste, { basis: wahl.design, aktivieren: aktiv }));
    ziel.current = auftrag.then((v) => v.id);
    auftrag.then(
      (v) => {
        setGespeichert((n) => n + 1);
        angelegt(v, aktiv);
      },
      (e: unknown) => {
        ziel.current = null; // nächste Änderung versucht es erneut
        showToast({ text: `Eigene Vorlage nicht angelegt: ${fehlerText(e)}`, icon: 'warn', sticky: true });
      },
    );
  };

  /** Jede Änderung: Liste setzen, beim ersten Mal an einem Design eine eigene Vorlage anlegen, entprellt speichern. */
  const aendern = (liste: Baustein[], auswahl?: number) => {
    aktuell.current = { bausteine: liste };
    setBausteine(liste);
    if (auswahl !== undefined) setSel(auswahl);
    if (wahl.id == null && !geaendert) {
      setGeaendert(true);
      if (mitDb && !ziel.current) {
        kopieAnlegen(liste);
        return;
      }
    }
    vormerken(liste);
  };

  const hinzufuegen = (typ: BausteinTyp) => {
    const r = einfuegen(bausteine, typ, bausteine.length ? sel : null);
    aendern(r.liste, r.index);
    setPalette(false);
    useUi.getState().toast(`Baustein „${BAUSTEINE[typ].name}“ hinzugefügt`);
  };

  const wegnehmen = (i: number) => {
    const r = entfernen(bausteine, i, sel);
    const weg = r.weg;
    if (!weg) return;
    aendern(r.liste, r.auswahl);
    showToast({
      key: RUECKGAENGIG,
      text: `„${BAUSTEINE[weg.typ].name}“ entfernt`,
      actions: [
        {
          label: 'Rückgängig',
          run: () => {
            rueckgaengigWeg();
            if (!lebt.current) return;
            const z = zurueckEinfuegen(aktuell.current.bausteine, i, weg);
            aendern(z.liste, z.index);
          },
        },
      ],
    });
  };

  /** Eigene Vorlage: Bausteine wieder wie im Design, von dem sie stammt (mit Rückgängig). */
  const zuruecksetzen = () => {
    const vorher = { bausteine, sel };
    aendern(standardVorlage(art, wahl.design), 0);
    jetzt();
    showToast({
      key: RUECKGAENGIG,
      text: `Bausteine wie im Design ${original}`,
      actions: [
        {
          label: 'Rückgängig',
          run: () => {
            rueckgaengigWeg();
            if (!lebt.current) return;
            aendern(vorher.bausteine, vorher.sel);
            sofort(vorher.bausteine);
          },
        },
      ],
    });
  };

  const griffFokus = (i: number) => {
    requestAnimationFrame(() => listeRef.current?.querySelector<HTMLElement>(`li[data-i="${i}"] .vl-grip`)?.focus());
  };

  const schieben = (i: number, richtung: -1 | 1, fokus: boolean) => {
    const r = verschieben(bausteine, i, richtung);
    if (r.index === i) return;
    aendern(r.liste, r.index);
    if (fokus) griffFokus(r.index);
  };

  const griffTaste = (e: KeyboardEvent<HTMLElement>, i: number) => {
    const richtung = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!richtung) return;
    e.preventDefault();
    schieben(i, richtung, true);
  };

  /* Ziehen mit Zeiger-Ereignissen (nicht HTML5-DnD: die Mac-App fängt Datei-Drops am Fenster ab) */
  const griffRunter = (e: PointerEvent<HTMLElement>, i: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSel(i);
    setZug({ von: i, stelle: i });
  };
  const griffZiehen = (e: PointerEvent<HTMLElement>) => {
    const lis = listeRef.current?.querySelectorAll<HTMLElement>('li[data-i]');
    if (!zug || !lis) return;
    const mitten = Array.from(lis, (li) => {
      const r = li.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    const stelle = stelleAusMitten(mitten, e.clientY);
    if (stelle !== zug.stelle) setZug({ von: zug.von, stelle });
  };
  const griffLos = () => {
    if (!zug) return;
    setZug(null);
    if (!ziehenAendert(zug.von, zug.stelle)) return;
    const r = ziehen(bausteine, zug.von, zug.stelle);
    aendern(r.liste, r.index);
  };

  /** Eine Einstellung setzen – vom Blatt und von der Karte, immer auf den neuesten Stand (schnelles Tippen). */
  const setzen = (index: number, key: string, wert: Einstellung) => aendern(einstellen(aktuell.current.bausteine, index, key, wert));

  // Bearbeiten im Blatt endet mit der Vorschau (LaTeX-Ansicht, Beleg wird geladen)
  useEffect(() => {
    if (ansicht !== 'vorschau') setImBlatt(null);
  }, [ansicht]);

  const bearbeitung: BlattBearbeitung = {
    aktiv: imBlatt,
    klick: imBlatt?.klick ?? null,
    starten: (index, key, klick) => setImBlatt({ index, key, klick }),
    ende: () => setImBlatt(null),
    setze: setzen,
  };

  const imBlattWaehlen = (i: number) => {
    setSel(i);
    listeRef.current?.querySelector(`li[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: motion === 'full' ? 'smooth' : 'auto' });
  };

  const pdfErzeugen = async () => {
    setPdf({ status: 'laeuft' });
    const tex = belegTex(doc, bausteine, accent, await belegLogo(doc));
    const name = blanko ? `Kladdy-Blanko-${ARTEN[art].label}.pdf` : `Kladdy-Vorlage-${ARTEN[art].label}.pdf`;
    try {
      await kompiliere({ main: tex.main.tex, daten: tex.daten, assets: tex.assets }, name);
    } catch (e) {
      if (e instanceof KompilierFehler) setPdf(e.abgebrochen ? null : { status: 'fehler', meldung: e.message, zeilen: fehlerZeilen(e, tex.main), log: e.log });
      else setPdf({ status: 'fehler', meldung: fehlerText(e), zeilen: [], log: '' });
      return;
    }
    try {
      await pdfOeffnen(name);
      setPdf(null);
      useUi.getState().toast('PDF erzeugt und in der Vorschau-App geöffnet');
    } catch (e) {
      setPdf({ status: 'fehler', meldung: `PDF erzeugt, aber Öffnen ging nicht: ${fehlerText(e)}`, zeilen: [], log: '' });
    }
  };

  const zielStelle = zug && ziehenAendert(zug.von, zug.stelle) ? zug.stelle : null;
  const laeuft = pdf?.status === 'laeuft';
  const nativ = inTauri();

  return (
    <div className="vl-layout">
      <div className="stack">
        <section className="card reveal" style={reveal(1)}>
          <div className="card-head">
            <div>
              <div className="card-title">
                <Blocks />
                Bausteine
              </div>
              <div className="card-sub">
                {wahl.id != null ? (
                  <>
                    <b>{wahl.name}</b> · eigene Vorlage
                    {gespeichert > 0 && (
                      <span key={gespeichert} className="vl-saved">
                        <Check />
                        gespeichert
                      </span>
                    )}
                  </>
                ) : geaendert && !mitDb ? (
                  `${wahl.name} · geändert, nur auf dieser Seite`
                ) : (
                  `${wahl.name} (mitgeliefert) – sobald du etwas änderst, speichert Kladdy es als eigene Vorlage`
                )}
              </div>
            </div>
            {wahl.id != null && (
              <button type="button" className="btn subtle vl-reset" title={`Bausteine wieder wie im Design ${original} (mit Rückgängig)`} onClick={zuruecksetzen}>
                <RotateCcw />
                Zurücksetzen
              </button>
            )}
          </div>
          {!mitDb && <p className="hint vl-ohne-db">Im Browser-Vorschaumodus wird nichts gespeichert – das geht nur in der Mac-App.</p>}
          <ul className={`vl-blocks${zug ? ' zieht' : ''}`} ref={listeRef}>
            {bausteine.length ? (
              bausteine.map((b, i) => {
                const def = BAUSTEINE[b.typ];
                const Icon = ICON[b.typ];
                const klasse = [
                  'vl-blk',
                  i === sel && 'on',
                  b.aus && 'aus',
                  zug?.von === i && 'dragging',
                  zielStelle === i && 'drop-before',
                  zielStelle === bausteine.length && i === bausteine.length - 1 && 'drop-after',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <Fragment key={i}>
                  <li data-i={i} className={klasse} onClick={() => setSel(i)}>
                    <span
                      className="vl-grip"
                      role="button"
                      tabIndex={0}
                      aria-label={`„${def.name}“ verschieben (Pfeiltasten)`}
                      title="Ziehen oder mit ↑/↓ verschieben"
                      onPointerDown={(e) => griffRunter(e, i)}
                      onPointerMove={griffZiehen}
                      onPointerUp={griffLos}
                      onPointerCancel={() => setZug(null)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => griffTaste(e, i)}
                    >
                      <GripVertical />
                    </span>
                    <span className="vl-ic">
                      <Icon />
                    </span>
                    <button type="button" className="vl-meta" aria-current={i === sel ? 'true' : undefined}>
                      <b>{def.name}</b>
                      <small>
                        {zerlegen(zusammenfassung(b)).map((t, k) =>
                          t.art === 'text' ? t.text : (
                            <span key={k} className="vl-ph-mini">
                              {PLATZHALTER_KURZ[t.name]}
                            </span>
                          ),
                        )}
                      </small>
                    </button>
                    <button
                      type="button"
                      className="icon-btn sm vl-eye"
                      title={b.aus ? 'Einblenden' : 'Ausblenden'}
                      aria-label={`„${def.name}“ ${b.aus ? 'einblenden' : 'ausblenden'}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        aendern(umschalten(bausteine, i));
                      }}
                    >
                      {b.aus ? <EyeOff /> : <Eye />}
                    </button>
                    <button
                      type="button"
                      className="icon-btn sm vl-del"
                      title="Entfernen"
                      aria-label={`„${def.name}“ entfernen`}
                      onClick={(e) => {
                        e.stopPropagation();
                        wegnehmen(i);
                      }}
                    >
                      <X />
                    </button>
                  </li>
                  {i === sel && !zug ? (
                    <li className="vl-inline" onClick={(e) => e.stopPropagation()}>
                      <BausteinKarte
                        key={`${sel}-${b.typ}`}
                        b={b}
                        index={sel}
                        anzahl={bausteine.length}
                        setze={(key, wert) => setzen(sel, key, wert)}
                        schieben={(richtung) => schieben(sel, richtung, false)}
                      />
                    </li>
                  ) : null}
                  </Fragment>
                );
              })
            ) : (
              <li className="vl-empty">Noch keine Bausteine – füge unten welche hinzu.</li>
            )}
          </ul>
          <div className="vl-add" ref={addRef}>
            <button type="button" className="btn subtle" aria-expanded={palette} onClick={() => setPalette((p) => !p)}>
              <Plus />
              Baustein hinzufügen
            </button>
            {palette && (
              <div className="vl-palette" role="dialog" aria-label="Baustein hinzufügen">
                <div className="vl-pal-head">
                  <b>Baustein hinzufügen</b>
                  <small>wird unter dem ausgewählten eingefügt</small>
                </div>
                <div className="vl-pal-grid">
                  {erlaubteTypen(art).map((t) => {
                    const PIcon = ICON[t];
                    return (
                      <button key={t} type="button" className="vl-pal-item" onClick={() => hinzufuegen(t)}>
                        <PIcon />
                        <span>
                          <b>{BAUSTEINE[t].name}</b>
                          <small>{BAUSTEINE[t].beschreibung}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
        <PflichtKarte art={art} liste={pflicht} eigeneFirma={eigeneFirma} quelle={blanko ? 'blanko' : mitBeleg ? 'beleg' : 'beispiel'} />
      </div>

      <div className="vl-right reveal" style={reveal(2)}>
        <div className="vl-toolbar">
          {quellen.length > 1 && (
            <div className="vl-quelle">
              <span className="vl-quelle-l">Vorschau mit</span>
              <Seg options={quellen} value={blanko ? 'blanko' : mitBeleg ? 'beleg' : 'beispiel'} onChange={quelleWaehlen} ariaLabel="Daten der Vorschau" />
            </div>
          )}
          <span className="spacer" />
          {blanko ? null : mitBeleg ? (
            <span className="vl-doc" title="Gezeigt als Entwurf ohne Nummer in den aktuellen Bausteinen – der Beleg selbst bleibt unverändert">
              {laedt ? <LoaderCircle className="ic spin" /> : <FileText />}
              {[letzter.nummer ?? 'Entwurf', letzter.kunde_name, letzter.nummer && 'als Entwurf'].filter(Boolean).join(' · ')}
            </span>
          ) : null}
          <button
            type="button"
            className={blanko ? 'btn-primary sm' : 'btn ghost'}
            disabled={laeuft || laedt || !nativ}
            title={
              !nativ
                ? 'Nur in der Mac-App'
                : blanko
                  ? `Blanko-${ARTEN[art].label} als PDF setzen und öffnen (zum Ausfüllen von Hand, ohne Nummer, wird nicht abgelegt)`
                  : `Mit Tectonic als PDF setzen und öffnen (Entwurf ${mitBeleg ? 'ohne Nummer mit dem letzten Beleg' : 'mit Beispieldaten'}, wird nicht abgelegt)`
            }
            onClick={() => void pdfErzeugen()}
          >
            {laeuft ? <LoaderCircle className="ic spin" /> : <Printer />}
            {laeuft ? 'Setze PDF …' : blanko ? 'Blanko drucken' : 'Drucken / PDF'}
          </button>
        </div>
        {blanko ? (
          <p className="vl-blanko-hint">
            <Printer />
            <span>
              <b>Zum Ausdrucken und Ausfüllen von Hand.</b> {BLANKO_HINWEIS[art]}
            </span>
          </p>
        ) : null}
        {pdf && <PdfHinweis pdf={pdf} schliessen={() => setPdf(null)} />}
        {ansicht === 'vorschau' && laedt ? (
          <div className="sk vl-sk-blatt" aria-busy="true" aria-label="Beleg wird geladen" />
        ) : ansicht === 'vorschau' ? (
          <BlattVorschau
            doc={doc}
            bausteine={bausteine}
            editable
            ausgewaehlt={sel}
            onWaehle={imBlattWaehlen}
            bearbeitung={bearbeitung}
            maxScale={1.2}
            className="vl-desk"
          />
        ) : (
          <LatexAnsicht art={art} bausteine={bausteine} accent={accent} blanko={blanko} />
        )}
        <button type="button" className="link vl-latex-link" onClick={() => setAnsicht((a) => (a === 'latex' ? 'vorschau' : 'latex'))}>
          <Code />
          {ansicht === 'latex' ? 'Zurück zur Vorschau' : 'Erzeugten LaTeX-Code ansehen (für Fachleute)'}
        </button>
      </div>
    </div>
  );
}

/* ================= Einstellungen des gewählten Bausteins ================= */

interface KarteProps {
  b: Baustein | undefined;
  index: number;
  anzahl: number;
  setze: (key: string, wert: Einstellung) => void;
  schieben: (richtung: -1 | 1) => void;
}

function BausteinKarte({ b, index, anzahl, setze, schieben }: KarteProps) {
  const felder = useRef<Record<string, FormatEditorHandle | null>>({});
  if (!b) return null;
  const def = BAUSTEINE[b.typ];
  const r = aufloesen(b);
  const Icon = ICON[b.typ];

  /** Platzhalter an der Schreibmarke des Feldes einfügen (als Chip), danach steht die Marke dahinter. */
  const platzhalter = (key: string, name: PlatzhalterName) => felder.current[key]?.platzhalter(name);

  return (
    <div className="vl-karte" aria-label={`Einstellungen: ${def.name}`} role="group">
      <div className="vl-karte-kopf">
        <p className="vl-karte-text">
          <Icon />
          {def.beschreibung}
          {b.aus ? ' – im Blatt ausgeblendet' : ''}
        </p>
        <div className="row vl-move">
          <button type="button" className="icon-btn sm" title="Nach oben" aria-label="Nach oben" disabled={index === 0} onClick={() => schieben(-1)}>
            <ArrowUp />
          </button>
          <button type="button" className="icon-btn sm" title="Nach unten" aria-label="Nach unten" disabled={index >= anzahl - 1} onClick={() => schieben(1)}>
            <ArrowDown />
          </button>
        </div>
      </div>
      {def.felder.length ? (
        <div className="form">
          {def.felder.map((f) => {
            const id = `vl-feld-${f.key}`;
            if (f.typ === 'toggle') {
              return (
                <div key={f.key} className="toggle-row">
                  <span>{f.label}</span>
                  <Switch checked={r.an(f.key)} onChange={(an) => setze(f.key, an)} label={f.label} />
                </div>
              );
            }
            if (f.typ === 'select') {
              return (
                <div key={f.key} className="field">
                  <label htmlFor={id}>{f.label}</label>
                  <select id={id} className="select" value={r.text(f.key)} onChange={(e) => setze(f.key, e.target.value)}>
                    {(f.optionen ?? KEINE_OPTIONEN).map(([wert, text]) => (
                      <option key={wert} value={wert}>
                        {text}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            const merken = (h: FormatEditorHandle | null) => {
              felder.current[f.key] = h;
            };
            return (
              <div key={f.key} className="field">
                <label id={`${id}-label`} onClick={() => felder.current[f.key]?.fokus()}>
                  {f.label}
                </label>
                <FormatEditor
                  ref={merken}
                  id={id}
                  wert={r.text(f.key)}
                  onChange={(w) => setze(f.key, w)}
                  mehrzeilig={f.typ === 'textarea'}
                  leiste="fest"
                  als="div"
                  label={f.label}
                  labelledBy={`${id}-label`}
                  className={f.typ === 'textarea' ? 'textarea' : 'input'}
                  leerText=""
                />
                <details className="vl-ph-wrap">
                  <summary>Daten einfügen (Kunde, Betrag, Datum …)</summary>
                  <div className="vl-ph" role="group" aria-label={`Daten in „${f.label}“ einfügen`}>
                    {PLATZHALTER.map(([name, titel]) => (
                      <button
                        key={name}
                        type="button"
                        className="chip"
                        title={`${titel} – wird im Beleg durch den echten Wert ersetzt`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => platzhalter(f.key, name)}
                      >
                        {PLATZHALTER_KURZ[name]}
                      </button>
                    ))}
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="hint">Dieser Baustein hat keine Einstellungen – er übernimmt die Daten aus dem Beleg und den Firmendaten.</p>
      )}
      <p className="hint vl-firma">
        <Building2 />
        <span>
          Steuernummer, Anschrift und Bankverbindung trägst du einmal unter <Link to={bereichPfad('firma')}>Einstellungen › Firma</Link> ein; Marken wie{' '}
          <span className="vl-ph-mini">Steuernummer</span> setzen sie in jeden Beleg ein.
        </span>
      </p>
    </div>
  );
}

/* ================= Pflichtangaben-Check (§2.3) ================= */

function PflichtKarte({ art, liste, eigeneFirma, quelle }: { art: Belegart; liste: readonly Pflichtangabe[]; eigeneFirma: boolean; quelle: Vorschauquelle }) {
  const fehlt = liste.filter((p) => !p.ok).length;
  const stand = fehlt ? `${fehlt} ${fehlt === 1 ? 'Angabe fehlt' : 'Angaben fehlen'}` : 'alles drin';
  return (
    <section className="card reveal" style={reveal(3)}>
      <div className="card-head">
        <div>
          <div className={`card-title vl-check-titel${fehlt ? ' bad' : ''}`}>
            {fehlt ? <TriangleAlert /> : <CircleCheck />}
            {art === 'eigenbeleg' ? 'Angaben im Eigenbeleg' : 'Pflichtangaben'}
          </div>
          <div className="card-sub">
            {liste.length ? [GRUNDLAGE[art], stand].filter(Boolean).join(' · ') : 'Angebote sind keine Rechnungen – keine Pflichtangaben nach UStDV'}
          </div>
        </div>
      </div>
      {liste.length > 0 && (
        <ul className="vl-check">
          {liste.map((p) => (
            <li key={p.label} className={p.ok ? (p.offen ? 'offen' : 'ok') : 'bad'}>
              {!p.ok ? <X /> : p.offen ? <Clock /> : <Check />}
              <span>
                {p.label}
                {p.hint && <small>{p.hint}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="hint vl-check-fuss">
        {quelle === 'blanko'
          ? 'Geprüft für die Blanko-Vorlage (Werte werden von Hand eingetragen)'
          : quelle === 'beleg'
            ? 'Geprüft mit dem letzten Beleg'
            : `Geprüft mit Beispieldaten und ${eigeneFirma ? 'deinen Firmendaten' : 'einer Beispielfirma'}`}{' '}
        – es zählt nur, was die Bausteine auch drucken.
      </p>
    </section>
  );
}

/* ================= PDF-Hinweis und LaTeX-Ansicht ================= */

function PdfHinweis({ pdf, schliessen }: { pdf: Exclude<PdfLauf, null>; schliessen: () => void }) {
  if (pdf.status === 'laeuft') {
    return (
      <p className="hint vl-pdf-hinweis" role="status">
        Setze das PDF … Beim ersten Mal lädt Tectonic einmalig die TeX-Pakete aus dem Netz, das kann einige Minuten dauern.
      </p>
    );
  }
  return (
    <div className="set-note warn vl-pdf-fehler" role="alert">
      <TriangleAlert />
      <span>
        <b>{pdf.meldung}</b>
        {pdf.zeilen.length > 0 && (
          <ul className="tb-fehler">
            {pdf.zeilen.map((z, i) => (
              <li key={i}>{z}</li>
            ))}
          </ul>
        )}
        {pdf.log && (
          <details className="tb-log">
            <summary>Protokoll von Tectonic</summary>
            <pre className="mono">{pdf.log}</pre>
          </details>
        )}
      </span>
      <button type="button" className="icon-btn sm" title="Schließen" aria-label="Hinweis schließen" onClick={schliessen}>
        <X />
      </button>
    </div>
  );
}

function LatexAnsicht({ art, bausteine, accent, blanko }: { art: Belegart; bausteine: readonly Baustein[]; accent: string; blanko: boolean }) {
  const teile = useMemo(() => texTeile(mainTex(art, bausteine, accent, { blanko }).tex), [art, bausteine, accent, blanko]);
  return (
    <section className="card flush vl-latex">
      <div className="set-note">
        <Info />
        <span>
          <b>Automatisch aus den Bausteinen erzeugt</b> – nur zum Lesen. Die Werte des Belegs stehen getrennt in daten.tex; Tectonic setzt
          beides zum PDF.
        </span>
      </div>
      <pre className="vl-code">{teile.map((t, i) => (t.art === 'text' ? t.text : <span key={i} className={TX_KLASSE[t.art]}>{t.text}</span>))}</pre>
    </section>
  );
}
