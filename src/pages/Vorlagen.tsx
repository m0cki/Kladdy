/* Vorlagen-Baukasten (ANLEITUNG §7.0, §6.7; Prototyp js/pages/vorlagen.js): Belege aus Bausteinen zusammenstellen.
 * - Art-Umschalter Rechnung · Quittung · Angebot · Eigenbeleg, auch aus der Adresse (?art=rechnung), damit die
 *   Beleg-Maske direkt hierher verlinken kann. Ohne ?art= gilt die zuletzt gewählte Art.
 * - Links: Bausteinliste (Griff zum Ziehen per Zeiger, ↑/↓ auf dem Griff; Auge = ausblenden, × = entfernen mit
 *   Rückgängig), „+ Baustein hinzufügen“ (Palette mit allen Bausteinen der Art, eingefügt unter dem ausgewählten),
 *   darunter die Einstellungen des gewählten Bausteins mit Platzhalter-Chips (fügen {name} an der Schreibmarke ein) und
 *   der Pflichtangaben-Check (§2.3) mit den Daten der Vorschau – ohne „Steuerhinweis (§ 19)“ sofort rot.
 * - Rechts: Live-Vorschau mit Beispieldaten (eigene Firmendaten, sobald eingetragen) oder – Umschalter „Beispiel ·
 *   Letzter Beleg“, nur wenn es einen gibt, je Art gemerkt – mit dem letzten Beleg der Art in den aktuellen Bausteinen
 *   (lib/vorlagen/vorschau.ts: nur gelesen, ohne Nummer ⇒ Wasserzeichen ENTWURF). Klick ins Blatt wählt den
 *   Baustein. „PDF“ setzt das Blatt mit Tectonic wie der Testbeleg (Entwurf, keine Nummer, nichts wird abgelegt) und
 *   öffnet es, Fehler mit Baustein und Zeile. „LaTeX“ zeigt die erzeugte main.tex (nur lesen).
 * - Speichern: Die erste Änderung an der Standardvorlage legt die eigene Kopie an, danach automatisch (entprellt, beim
 *   Verlassen sofort). „Zurücksetzen“ kehrt zum Standard zurück (mit Rückgängig). Bedeutung der Tabelle `vorlagen`:
 *   lib/queries/vorlagen.ts. Im Browser ohne Datenbank: Standardvorlagen, Änderungen nur auf dieser Seite.
 * Logik in lib/vorlagen/baukasten.ts, Stile in styles/vorlagen.css. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Blocks,
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
  SlidersHorizontal,
  Stamp,
  TriangleAlert,
  Type,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { BlattVorschau } from '../components/belege/Blatt';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHead, reveal } from '../components/ui/PageHead';
import { Seg, type SegOption } from '../components/ui/Seg';
import { Switch } from '../components/ui/Switch';
import { datenbankVerfuegbar } from '../lib/db';
import { fehlerText } from '../lib/fehler';
import type { Firma } from '../lib/firma';
import { texTeile, type TexTeilArt } from '../lib/latex/hervorheben';
import { KompilierFehler, belegLogo, belegTex, fehlerZeilen, kompiliere, pdfOeffnen } from '../lib/latex/kompilieren';
import { mainTex } from '../lib/latex/vorlage';
import { useFirmenlogo } from '../lib/logoablage';
import { inTauri } from '../lib/menu';
import { UST_MODUS_STANDARD, ladeFirma, ladeUstModus, type UstModus } from '../lib/queries/einstellungen';
import { ladeBelege } from '../lib/queries/rechnungen';
import { ladeEigeneVorlage, speichereVorlage, vorlageZuruecksetzen, type EigeneVorlage } from '../lib/queries/vorlagen';
import type { BelegZeile } from '../lib/rechnungen';
import { BAUSTEINE, aufloesen, type Baustein, type BausteinTyp, type Einstellung } from '../lib/vorlagen/bausteine';
import {
  EIGENER_NAME,
  einfuegen,
  einstellen,
  entfernen,
  erlaubteTypen,
  platzhalterEinfuegen,
  stelleAusMitten,
  umschalten,
  verschieben,
  ziehen,
  ziehenAendert,
  zurueckEinfuegen,
  zusammenfassung,
} from '../lib/vorlagen/baukasten';
import { BEISPIEL_FIRMA, beispielbeleg, firmaOderBeispiel } from '../lib/vorlagen/beispiel';
import { ARTEN, BELEGARTEN, PLATZHALTER, istBelegart, type BelegDokument, type Belegart } from '../lib/vorlagen/dokument';
import { pflichtCheck, type Pflichtangabe } from '../lib/vorlagen/pflicht';
import { standardVorlage } from '../lib/vorlagen/standard';
import { ladeQuellen, ladeVorschauBeleg, letzterBeleg, speichereQuelle, type Vorschauquelle } from '../lib/vorlagen/vorschau';
import { heute } from '../lib/zeitraum';
import { useUi } from '../store/ui';
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
};

const ART_OPTIONEN: readonly SegOption<Belegart>[] = BELEGARTEN.map((a) => ({ value: a, label: ARTEN[a].label }));

type Ansicht = 'vorschau' | 'latex';
const ANSICHTEN: readonly SegOption<Ansicht>[] = [
  {
    value: 'vorschau',
    label: (
      <>
        <Eye />
        Vorschau
      </>
    ),
  },
  {
    value: 'latex',
    label: (
      <>
        <Code />
        LaTeX
      </>
    ),
  },
];

/** Autosave: so lange nach der letzten Änderung warten (sonst landet jeder Tastendruck im Protokoll) */
const SPEICHERN_MS = 600;
/** Toast mit „Rückgängig“: ein neuer ersetzt den alten, beim Verlassen der Seite verschwindet er */
const RUECKGAENGIG = 'vorlage-rueckgaengig';
/** Rechtsgrundlage im Pflichtangaben-Check (wie im Prototyp) */
const GRUNDLAGE: Readonly<Record<Belegart, string>> = { rechnung: '§ 34a UStDV', quittung: '§ 33/§ 34a UStDV', angebot: '', eigenbeleg: '' };
const KEINE_OPTIONEN: readonly (readonly [string, string])[] = [];
const TX_KLASSE: Readonly<Record<TexTeilArt, string>> = { kommentar: 'tx-c', befehl: 'tx-k', klammer: 'tx-b', text: '' };
const QUELLEN: readonly SegOption<Vorschauquelle>[] = [
  { value: 'beispiel', label: 'Beispiel' },
  { value: 'beleg', label: 'Letzter Beleg' },
];

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
type Stand = { art: Belegart; status: 'ok'; eigene: EigeneVorlage | null } | { art: Belegart; status: 'fehler'; fehler: string };

export default function Vorlagen() {
  const [params, setParams] = useSearchParams();
  const roh = params.get('art');
  const art: Belegart = istBelegart(roh) ? roh : zuletzt;
  const [basis, setBasis] = useState<Basis | null>(null);
  const [stand, setStand] = useState<Stand | null>(null);
  const [versuch, setVersuch] = useState(0);
  /** null = wird noch gelesen (ein gemerktes „Letzter Beleg“ soll nicht erst die Beispieldaten zeigen) */
  const [letzte, setLetzte] = useState<Letzte | null>(() => (datenbankVerfuegbar() ? null : KEINE));

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

  // Eigene Kopie der Art (null = Standard), erst nach dem letzten Schreibauftrag dieser Seite gelesen
  useEffect(() => {
    void versuch; // „Erneut versuchen“
    let weg = false;
    schreibt.then(() => ladeEigeneVorlage(art)).then(
      (eigene) => {
        if (!weg) setStand({ art, status: 'ok', eigene });
      },
      (e: unknown) => {
        if (!weg) setStand({ art, status: 'fehler', fehler: fehlerText(e) });
      },
    );
    return () => {
      weg = true;
    };
  }, [art, versuch]);

  const artWaehlen = (v: Belegart) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set('art', v);
        return n;
      },
      { replace: true },
    );

  const bereit = basis && stand?.art === art ? stand : null;
  return (
    <div className="page vl-page">
      <PageHead
        icon={Blocks}
        title="Vorlagen"
        sub="Belege aus Bausteinen zusammenstellen – ohne LaTeX. Die App erzeugt daraus im Hintergrund das PDF."
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
        <Baukasten key={art} art={art} basis={basis} start={bereit.eigene} letzter={letzte[art]} />
      )}
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

function useAutosave(art: Belegart, gespeichert: (v: EigeneVorlage) => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const offen = useRef<Baustein[] | null>(null);
  const melden = useRef(gespeichert);
  useEffect(() => {
    melden.current = gespeichert;
  });

  /** Ausstehende Änderung jetzt schreiben (Seite/Art verlassen, Zurücksetzen). Ohne Datenbank: nichts. */
  const jetzt = useMemo(
    () => () => {
      clearTimeout(timer.current);
      const liste = offen.current;
      offen.current = null;
      if (!liste || !datenbankVerfuegbar()) return;
      merkeSchreiben(speichereVorlage(art, liste)).then(
        (v) => melden.current(v),
        (e: unknown) => {
          useUi.getState().showToast({ text: `Vorlage nicht gespeichert: ${fehlerText(e)}`, icon: 'warn', sticky: true });
        },
      );
    },
    [art],
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
  basis: Basis;
  start: EigeneVorlage | null;
  letzter: BelegZeile | null;
}

function Baukasten({ art, basis, start, letzter }: BaukastenProps) {
  const accent = useUi((s) => s.settings.accent);
  const motion = useUi((s) => s.settings.motion);
  const showToast = useUi((s) => s.showToast);
  const mitDb = datenbankVerfuegbar();
  const [bausteine, setBausteine] = useState<Baustein[]>(() => start?.bausteine ?? standardVorlage(art));
  /** Name der eigenen Kopie; null = Standardvorlage */
  const [eigenName, setEigenName] = useState<string | null>(start?.name ?? null);
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
  /** neuester Stand für „Rückgängig“ aus dem Toast */
  const aktuell = useRef({ bausteine, eigenName });
  useEffect(() => {
    aktuell.current = { bausteine, eigenName };
  });

  const { jetzt, vormerken, sofort } = useAutosave(art, (v) => {
    // nach „Zurücksetzen“ nicht wieder als eigene Vorlage anzeigen
    setEigenName((n) => (n ? v.name : n));
    setGespeichert((n) => n + 1);
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
  const doc = useMemo(() => ({ ...(echtDoc ?? beispielbeleg(art, basis.firma, basis.ust, heute())), logo: logo || null }), [echtDoc, art, basis, logo]);
  const pflicht = useMemo(() => pflichtCheck(doc, bausteine), [doc, bausteine]);
  const eigeneFirma = basis.firma !== BEISPIEL_FIRMA;

  const quelleWaehlen = (q: Vorschauquelle) => {
    setQuelle(q);
    speichereQuelle(speicher(), art, q);
  };

  /** Jede Änderung: Liste setzen, beim ersten Mal als eigene Kopie zeigen, entprellt speichern. */
  const aendern = (liste: Baustein[], auswahl?: number) => {
    setBausteine(liste);
    if (auswahl !== undefined) setSel(auswahl);
    setEigenName((n) => n ?? EIGENER_NAME[art]);
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

  const zuruecksetzen = () => {
    const vorher = { bausteine, eigenName, sel };
    jetzt(); // ausstehende Änderung zuerst schreiben: „Rückgängig“ stellt genau diesen Stand wieder her
    setBausteine(standardVorlage(art));
    setEigenName(null);
    setSel(0);
    const wiederherstellen = () => {
      setBausteine(vorher.bausteine);
      setEigenName(vorher.eigenName);
      setSel(vorher.sel);
    };
    const fertig = () => {
      showToast({
        key: RUECKGAENGIG,
        text: 'Standardvorlage wiederhergestellt',
        actions: [
          {
            label: 'Rückgängig',
            run: () => {
              rueckgaengigWeg();
              // inzwischen wieder geändert ⇒ diesen Stand nicht überschreiben
              if (!lebt.current || aktuell.current.eigenName) return;
              wiederherstellen();
              sofort(vorher.bausteine);
            },
          },
        ],
      });
    };
    if (!mitDb) {
      fertig();
      return;
    }
    merkeSchreiben(vorlageZuruecksetzen(art)).then(fertig, (e: unknown) => {
      if (lebt.current) wiederherstellen();
      showToast({ text: `Zurücksetzen ging nicht: ${fehlerText(e)}`, icon: 'warn', sticky: true });
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

  const imBlattWaehlen = (i: number) => {
    setSel(i);
    listeRef.current?.querySelector(`li[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: motion === 'full' ? 'smooth' : 'auto' });
  };

  const pdfErzeugen = async () => {
    setPdf({ status: 'laeuft' });
    const tex = belegTex(doc, bausteine, accent, await belegLogo(doc));
    const name = `Kladdy-Vorlage-${ARTEN[art].label}.pdf`;
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

  const gewaehlt: Baustein | undefined = bausteine[sel];
  const ziel = zug && ziehenAendert(zug.von, zug.stelle) ? zug.stelle : null;
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
                {eigenName ? (
                  <>
                    <b>{eigenName}</b> · eigene Vorlage
                    {gespeichert > 0 && (
                      <span key={gespeichert} className="vl-saved">
                        <Check />
                        gespeichert
                      </span>
                    )}
                  </>
                ) : (
                  'Standardvorlage · die erste Änderung legt eine eigene Kopie an'
                )}
              </div>
            </div>
            {eigenName && (
              <button type="button" className="btn subtle vl-reset" title="Zur Standardvorlage zurückkehren (mit Rückgängig)" onClick={zuruecksetzen}>
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
                  ziel === i && 'drop-before',
                  ziel === bausteine.length && i === bausteine.length - 1 && 'drop-after',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <li key={i} data-i={i} className={klasse} onClick={() => setSel(i)}>
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
                      <small>{zusammenfassung(b)}</small>
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
        <BausteinKarte
          key={`${sel}-${gewaehlt?.typ ?? ''}`}
          b={gewaehlt}
          index={sel}
          anzahl={bausteine.length}
          setze={(key, wert) => aendern(einstellen(bausteine, sel, key, wert))}
          schieben={(richtung) => schieben(sel, richtung, false)}
        />
        <PflichtKarte art={art} liste={pflicht} eigeneFirma={eigeneFirma} mitBeleg={mitBeleg} />
      </div>

      <div className="vl-right reveal" style={reveal(2)}>
        <div className="vl-toolbar">
          <Seg options={ANSICHTEN} value={ansicht} onChange={setAnsicht} ariaLabel="Ansicht" />
          <span className="spacer" />
          {letzter && <Seg options={QUELLEN} value={mitBeleg ? 'beleg' : 'beispiel'} onChange={quelleWaehlen} ariaLabel="Daten der Vorschau" />}
          {mitBeleg ? (
            <span className="vl-doc" title="Gezeigt als Entwurf ohne Nummer in den aktuellen Bausteinen – der Beleg selbst bleibt unverändert">
              {laedt ? <LoaderCircle className="ic spin" /> : <FileText />}
              {[letzter.nummer ?? 'Entwurf', letzter.kunde_name, letzter.nummer && 'als Entwurf'].filter(Boolean).join(' · ')}
            </span>
          ) : (
            <span className="vl-doc">
              <FileText />
              Beispieldaten{eigeneFirma ? ' · deine Firmendaten' : ''}
            </span>
          )}
          <button
            type="button"
            className="btn ghost"
            disabled={laeuft || laedt || !nativ}
            title={
              nativ
                ? `Mit Tectonic als PDF setzen und öffnen (Entwurf ${mitBeleg ? 'ohne Nummer mit dem letzten Beleg' : 'mit Beispieldaten'}, wird nicht abgelegt)`
                : 'Nur in der Mac-App'
            }
            onClick={() => void pdfErzeugen()}
          >
            {laeuft ? <LoaderCircle className="ic spin" /> : <Printer />}
            {laeuft ? 'Setze PDF …' : 'PDF'}
          </button>
        </div>
        {pdf && <PdfHinweis pdf={pdf} schliessen={() => setPdf(null)} />}
        {ansicht === 'vorschau' && laedt ? (
          <div className="sk vl-sk-blatt" aria-busy="true" aria-label="Beleg wird geladen" />
        ) : ansicht === 'vorschau' ? (
          <BlattVorschau doc={doc} bausteine={bausteine} editable ausgewaehlt={sel} onWaehle={imBlattWaehlen} maxScale={1.2} className="vl-desk" />
        ) : (
          <LatexAnsicht art={art} bausteine={bausteine} accent={accent} />
        )}
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
  const felder = useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});
  if (!b) {
    return (
      <section className="card reveal" style={reveal(2)}>
        <EmptyState icon={SlidersHorizontal} title="Kein Baustein ausgewählt">
          Einen Baustein in der Liste oder im Blatt anklicken, um ihn einzustellen.
        </EmptyState>
      </section>
    );
  }
  const def = BAUSTEINE[b.typ];
  const r = aufloesen(b);
  const Icon = ICON[b.typ];

  /** Platzhalter an der Schreibmarke des Feldes einfügen, danach steht die Marke dahinter. */
  const platzhalter = (key: string, name: string) => {
    const el = felder.current[key];
    const neu = platzhalterEinfuegen(r.text(key), el ? el.selectionStart : null, el ? el.selectionEnd : null, name);
    setze(key, neu.text);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(neu.cursor, neu.cursor);
    });
  };

  return (
    <section className="card reveal" style={reveal(2)}>
      <div className="card-head">
        <div>
          <div className="card-title">
            <Icon />
            {def.name}
          </div>
          <div className="card-sub">
            {def.beschreibung}
            {b.aus ? ' · ausgeblendet' : ''}
          </div>
        </div>
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
            const merken = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
              felder.current[f.key] = el;
            };
            return (
              <div key={f.key} className="field">
                <label htmlFor={id}>{f.label}</label>
                {f.typ === 'textarea' ? (
                  <textarea id={id} ref={merken} className="textarea" rows={3} value={r.text(f.key)} onChange={(e) => setze(f.key, e.target.value)} />
                ) : (
                  <input id={id} ref={merken} className="input" value={r.text(f.key)} onChange={(e) => setze(f.key, e.target.value)} />
                )}
                <div className="vl-ph" role="group" aria-label={`Platzhalter in „${f.label}“ einfügen`}>
                  {PLATZHALTER.map(([name, titel]) => (
                    <button
                      key={name}
                      type="button"
                      className="chip"
                      title={titel}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => platzhalter(f.key, name)}
                    >
                      {`{${name}}`}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="hint">Dieser Baustein hat keine Einstellungen – er übernimmt die Daten aus dem Beleg und den Firmendaten.</p>
      )}
    </section>
  );
}

/* ================= Pflichtangaben-Check (§2.3) ================= */

function PflichtKarte({ art, liste, eigeneFirma, mitBeleg }: { art: Belegart; liste: readonly Pflichtangabe[]; eigeneFirma: boolean; mitBeleg: boolean }) {
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
        {mitBeleg ? 'Geprüft mit dem letzten Beleg' : `Geprüft mit Beispieldaten und ${eigeneFirma ? 'deinen Firmendaten' : 'einer Beispielfirma'}`} – es zählt nur, was die
        Bausteine auch drucken.
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

function LatexAnsicht({ art, bausteine, accent }: { art: Belegart; bausteine: readonly Baustein[]; accent: string }) {
  const teile = useMemo(() => texTeile(mainTex(art, bausteine, accent).tex), [art, bausteine, accent]);
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
