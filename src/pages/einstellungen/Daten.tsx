/* Einstellungen › Daten (§6.10, §3.1, §7.3): Tectonic-Pfad für den PDF-Satz, Testbeleg und (nur Entwicklerversion) Demo-Daten.
 * - Tectonic: Rust sucht in der Reihenfolge aus §3.1 (mitgeliefert, Homebrew, eigener Pfad) und prüft mit `--version`.
 *   Ein eigener Pfad wird vor dem Speichern geprüft (vorhandene, ausführbare Datei); „Automatisch“ löscht ihn wieder.
 * - Testbeleg (§7.3, Abnahme Phase 3): Rechnung oder Quittung an „Müller & Söhne 100%“ aus der Standardvorlage über
 *   compile_latex setzen und in der Vorschau-App öffnen; daneben dieselbe HTML-Vorschau zum Vergleich. Entwurf ohne
 *   Nummer, es wird nichts gespeichert. Die Rechnung trägt den GiroCode (girocode.png über belegTex → assets); fehlt er
 *   wegen ungültiger Firmendaten, steht der Grund unter dem Knopf (nie auf dem Blatt). Mit Firmenlogo (logo.png).
 * - Demo-Daten: nur bei `import.meta.env.DEV` (lib/demo.ts). Laden und Entfernen fragen per Warn-Toast nach und laden
 *   danach die Oberfläche neu, weil die App dann eine andere Datenbankdatei öffnet. */
import { useEffect, useMemo, useState } from 'react';
import {
  CircleCheck,
  Database,
  Eye,
  EyeOff,
  FileText,
  FlaskConical,
  FolderOpen,
  LoaderCircle,
  PackageSearch,
  RotateCcw,
  Stethoscope,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { BlattVorschau } from '../../components/belege/Blatt';
import { Seg } from '../../components/ui/Seg';
import { DEMO_MOEGLICH, demoEntfernen, demoLaden, neuStarten, useDemo } from '../../lib/demo';
import type { Firma } from '../../lib/firma';
import { girocodeFuer, girocodeMoeglich } from '../../lib/girocode/girocode';
import { KompilierFehler, belegLogo, belegTex, fehlerZeilen, kompiliere, pdfOeffnen } from '../../lib/latex/kompilieren';
import { useFirmenlogo } from '../../lib/logoablage';
import { inTauri } from '../../lib/menu';
import { ladeFirma, ladeUstModus, type UstModus } from '../../lib/queries/einstellungen';
import {
  QUELLE_TEXT,
  tectonicAutomatisch,
  tectonicPfadSetzen,
  tectonicPruefen,
  tectonicSuchen,
  tectonicWaehlen,
  type TectonicPruefung,
  type TectonicStand,
} from '../../lib/tectonic';
import { BEISPIEL_FIRMA, firmaOderBeispiel, testbeleg } from '../../lib/vorlagen/beispiel';
import { standardVorlage } from '../../lib/vorlagen/standard';
import { heute } from '../../lib/zeitraum';
import { useUi } from '../../store/ui';
import { Ladeansicht, fehlerText, useLaden } from './Laden';
import { SetCard, SetRow } from './SetRow';

export default function Daten() {
  return (
    <>
      <Tectonic />
      {DEMO_MOEGLICH ? <DemoDaten /> : null}
    </>
  );
}

/* ---------- Tectonic ---------- */

function Tectonic() {
  const { zustand, neuLaden, erneut } = useLaden(tectonicSuchen);
  if (zustand.status !== 'ok') return <Ladeansicht zustand={zustand} icon={PackageSearch} was="Die Tectonic-Angaben" erneut={erneut} />;
  return <TectonicKarte stand={zustand.daten} neuLaden={neuLaden} />;
}

type Pruefung = { status: 'ok'; ergebnis: TectonicPruefung } | { status: 'fehler'; text: string } | null;

function TectonicKarte({ stand, neuLaden }: { stand: TectonicStand; neuLaden: () => Promise<void> }) {
  const showToast = useUi((s) => s.showToast);
  const [beschaeftigt, setBeschaeftigt] = useState<'waehlen' | 'pruefen' | null>(null);
  const [pruefung, setPruefung] = useState<Pruefung>(null);
  const { fund, eingestellt, eingestellt_fehler: eingestelltFehler } = stand;

  const waehlen = async () => {
    setBeschaeftigt('waehlen');
    try {
      const pfad = await tectonicWaehlen();
      if (!pfad) return;
      await tectonicPfadSetzen(pfad);
      setPruefung(null);
      await neuLaden();
      showToast({ text: 'Tectonic-Pfad gespeichert' });
    } catch (e) {
      showToast({ text: `Pfad nicht übernommen: ${fehlerText(e)}`, icon: 'warn', sticky: true });
    } finally {
      setBeschaeftigt(null);
    }
  };

  const automatisch = async () => {
    try {
      await tectonicAutomatisch();
      setPruefung(null);
      await neuLaden();
      showToast({ text: 'Tectonic wird wieder automatisch gesucht' });
    } catch (e) {
      showToast({ text: `Zurücksetzen ging nicht: ${fehlerText(e)}`, icon: 'warn', sticky: true });
    }
  };

  const pruefen = async () => {
    setBeschaeftigt('pruefen');
    try {
      setPruefung({ status: 'ok', ergebnis: await tectonicPruefen() });
    } catch (e) {
      setPruefung({ status: 'fehler', text: fehlerText(e) });
    } finally {
      setBeschaeftigt(null);
    }
  };

  return (
    <SetCard title="Tectonic (PDF-Satz)" i={1}>
      <SetRow id="tectonic" label="Tectonic-Pfad" value={fund ? QUELLE_TEXT[fund.quelle] : eingestellt ? 'eigener Pfad' : 'automatisch'}>
        {fund ? (
          <div className="set-note ok">
            <CircleCheck />
            <span>
              <b>Gefunden:</b> <span className="mono">{fund.pfad}</span>
            </span>
          </div>
        ) : (
          <div className="set-note warn">
            <TriangleAlert />
            <span>
              <b>Tectonic wurde nicht gefunden.</b> Im Terminal mit <span className="mono">brew install tectonic</span> installieren
              oder das Programm über „Pfad wählen …“ angeben. Ohne Tectonic entstehen keine PDFs.
            </span>
          </div>
        )}
        {eingestellt && fund?.quelle !== 'einstellung' ? (
          <p className={`hint ${eingestelltFehler ? 'warn' : ''}`}>
            Eigener Pfad: <span className="mono">{eingestellt}</span>
            {eingestelltFehler ? ` · ${eingestelltFehler}` : fund ? ' · wird nur benutzt, wenn an den festen Orten nichts liegt.' : null}
          </p>
        ) : null}
        <div className="row wrap">
          <button type="button" className="btn subtle" disabled={!!beschaeftigt || !inTauri()} onClick={() => void waehlen()}>
            {beschaeftigt === 'waehlen' ? <LoaderCircle className="ic spin" /> : <FolderOpen />}
            Pfad wählen …
          </button>
          {eingestellt ? (
            <button type="button" className="btn ghost" disabled={!!beschaeftigt} onClick={() => void automatisch()}>
              <RotateCcw />
              Automatisch suchen
            </button>
          ) : null}
        </div>
        <p className="hint">
          Gesucht wird in dieser Reihenfolge: mit Kladdy geliefert (später), /opt/homebrew/bin/tectonic, /usr/local/bin/tectonic,
          sonst der eigene Pfad.
        </p>
      </SetRow>

      <SetRow id="tectonic-pruefen" label="Tectonic prüfen">
        <div className="row wrap">
          <button type="button" className="btn subtle" disabled={!!beschaeftigt || !fund} onClick={() => void pruefen()}>
            {beschaeftigt === 'pruefen' ? <LoaderCircle className="ic spin" /> : <Stethoscope />}
            {beschaeftigt === 'pruefen' ? 'Prüfe …' : 'Prüfen'}
          </button>
        </div>
        {pruefung?.status === 'ok' ? (
          <div className="set-note ok" role="status">
            <CircleCheck />
            <span>
              <b>{pruefung.ergebnis.version}</b> · <span className="mono">{pruefung.ergebnis.pfad}</span> ({QUELLE_TEXT[pruefung.ergebnis.quelle]})
            </span>
          </div>
        ) : pruefung?.status === 'fehler' ? (
          <div className="set-note warn" role="alert">
            <TriangleAlert />
            <span>{pruefung.text}</span>
          </div>
        ) : (
          <p className="hint">Startet Tectonic einmal mit „--version“, ohne etwas zu setzen.</p>
        )}
      </SetRow>

      <Testbeleg gefunden={!!fund} />
    </SetCard>
  );
}

/* ---------- Testbeleg ---------- */

type TestArt = 'rechnung' | 'quittung';
const TEST_ARTEN = [
  { value: 'rechnung', label: 'Rechnung (A4)' },
  { value: 'quittung', label: 'Quittung (A5 quer)' },
] as const;

type Lauf =
  | { status: 'laeuft' }
  | { status: 'ok'; sekunden: number; kb: number; oeffnenFehler: string | null }
  | { status: 'fehler'; meldung: string; zeilen: string[]; log: string }
  | null;

const ZAHL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

function Testbeleg({ gefunden }: { gefunden: boolean }) {
  const accent = useUi((s) => s.settings.accent);
  const [art, setArt] = useState<TestArt>('rechnung');
  const [basis, setBasis] = useState<{ firma: Firma; ust: UstModus; eigen: boolean } | null>(null);
  const [lauf, setLauf] = useState<Lauf>(null);
  const [vorschau, setVorschau] = useState(false);

  useEffect(() => {
    let weg = false;
    Promise.all([ladeFirma(), ladeUstModus()]).then(
      ([f, ust]) => {
        const firma = firmaOderBeispiel(f);
        if (!weg) setBasis({ firma, ust, eigen: firma !== BEISPIEL_FIRMA });
      },
      () => {
        if (!weg) setBasis({ firma: BEISPIEL_FIRMA, ust: 'klein', eigen: false });
      },
    );
    return () => {
      weg = true;
    };
  }, []);

  const logo = useFirmenlogo((s) => s.name);
  const doc = useMemo(() => (basis ? { ...testbeleg(art, basis.firma, basis.ust, heute()), logo: logo || null } : null), [art, basis, logo]);
  const bausteine = useMemo(() => standardVorlage(art), [art]);
  const giro = useMemo(() => (doc && girocodeMoeglich(doc) ? girocodeFuer(doc) : null), [doc]);

  const erzeugen = async () => {
    if (!doc) return;
    setLauf({ status: 'laeuft' });
    const start = performance.now();
    const tex = belegTex(doc, bausteine, accent, await belegLogo(doc));
    const name = `Kladdy-Testbeleg-${art === 'rechnung' ? 'Rechnung' : 'Quittung'}.pdf`;
    let pdf: Uint8Array;
    try {
      pdf = await kompiliere({ main: tex.main.tex, daten: tex.daten, assets: tex.assets }, name);
    } catch (e) {
      if (e instanceof KompilierFehler) {
        if (e.abgebrochen) return;
        setLauf({ status: 'fehler', meldung: e.message, zeilen: fehlerZeilen(e, tex.main), log: e.log });
      } else setLauf({ status: 'fehler', meldung: fehlerText(e), zeilen: [], log: '' });
      return;
    }
    const sekunden = (performance.now() - start) / 1000;
    const kb = Math.max(1, Math.round(pdf.length / 1024));
    let oeffnenFehler: string | null = null;
    try {
      await pdfOeffnen(name);
    } catch (e) {
      oeffnenFehler = fehlerText(e);
    }
    setLauf({ status: 'ok', sekunden, kb, oeffnenFehler });
  };

  const laeuft = lauf?.status === 'laeuft';
  return (
    <SetRow id="testbeleg" label="Testbeleg erzeugen">
      <div className="row wrap">
        <Seg options={TEST_ARTEN} value={art} onChange={(v) => setArt(v)} ariaLabel="Belegart des Testbelegs" />
        <button type="button" className="btn subtle" disabled={laeuft || !doc || !gefunden || !inTauri()} onClick={() => void erzeugen()}>
          {laeuft ? <LoaderCircle className="ic spin" /> : <FileText />}
          {laeuft ? 'Setze PDF …' : 'PDF erzeugen und öffnen'}
        </button>
        <button type="button" className="btn ghost" disabled={!doc} onClick={() => setVorschau((v) => !v)}>
          {vorschau ? <EyeOff /> : <Eye />}
          {vorschau ? 'Vorschau ausblenden' : 'HTML-Vorschau zum Vergleich'}
        </button>
      </div>
      {lauf?.status === 'ok' ? (
        <div className={`set-note ${lauf.oeffnenFehler ? 'warn' : 'ok'}`} role="status">
          {lauf.oeffnenFehler ? <TriangleAlert /> : <CircleCheck />}
          <span>
            <b>PDF erzeugt</b> in {ZAHL.format(lauf.sekunden)} s ({ZAHL.format(lauf.kb)} KB)
            {lauf.oeffnenFehler ? ` · Öffnen ging nicht: ${lauf.oeffnenFehler}` : ' · in der Vorschau-App geöffnet.'}
          </span>
        </div>
      ) : lauf?.status === 'fehler' ? (
        <div className="set-note warn" role="alert">
          <TriangleAlert />
          <span>
            <b>{lauf.meldung}</b>
            {lauf.zeilen.length > 0 && (
              <ul className="tb-fehler">
                {lauf.zeilen.map((z, i) => (
                  <li key={i}>{z}</li>
                ))}
              </ul>
            )}
            {lauf.log && (
              <details className="tb-log">
                <summary>Protokoll von Tectonic</summary>
                <pre className="mono">{lauf.log}</pre>
              </details>
            )}
          </span>
        </div>
      ) : (
        <p className="hint">
          {laeuft
            ? 'Beim ersten Mal lädt Tectonic die nötigen TeX-Pakete aus dem Netz. Das dauert einmalig etwas, danach geht es ohne Netz.'
            : 'Beim ersten PDF lädt Tectonic einmalig die TeX-Pakete aus dem Netz (kann einige Minuten dauern). Danach arbeitet es ohne Netz.'}
        </p>
      )}
      <p className="hint">
        Entwurf ohne Nummer an „Müller &amp; Söhne 100%“ mit Sonderzeichen in den Positionen, aus der Standardvorlage.
        {basis && !basis.eigen ? ' Solange keine Firmendaten eingetragen sind, mit Beispielfirma.' : ''} Es wird nichts gespeichert und keine
        Nummer verbraucht.
      </p>
      {giro && !giro.ok && <p className="hint warn">Ohne GiroCode: {giro.fehler.join(' ')}</p>}
      {vorschau && doc && <BlattVorschau doc={doc} bausteine={bausteine} maxScale={1} className="tb-vorschau" />}
    </SetRow>
  );
}

/* ---------- Demo-Daten (nur Entwicklerversion) ---------- */

const FRAGE = 'demo-frage';

function frageWeg(): void {
  const ui = useUi.getState();
  const t = ui.toasts.find((x) => x.key === FRAGE);
  if (t) ui.dismissToast(t.id);
}

function DemoDaten() {
  const aktiv = useDemo((s) => s.aktiv);
  const showToast = useUi((s) => s.showToast);
  const [laeuft, setLaeuft] = useState(false);
  const nativ = inTauri();

  const ausfuehren = async (aktion: () => Promise<unknown>, was: string) => {
    frageWeg();
    setLaeuft(true);
    try {
      await aktion();
      neuStarten();
    } catch (e) {
      setLaeuft(false);
      showToast({ text: `${was} ging nicht: ${fehlerText(e)}`, icon: 'warn', sticky: true });
    }
  };

  const laden = () =>
    showToast({
      key: FRAGE,
      text: 'Demo-Daten laden? Kladdy wechselt auf eine eigene Demo-Datenbank und lädt neu. Deine Daten bleiben unverändert.',
      icon: 'warn',
      sticky: true,
      actions: [
        { label: 'Laden', run: () => void ausfuehren(demoLaden, 'Laden') },
        { label: 'Abbrechen', run: frageWeg },
      ],
    });

  const entfernen = () =>
    showToast({
      key: FRAGE,
      text: 'Demo-Daten entfernen? Die Demo-Datenbank und im Demo-Modus abgelegte Belege werden gelöscht, danach öffnet Kladdy wieder deine Daten.',
      icon: 'warn',
      sticky: true,
      actions: [
        { label: 'Entfernen', run: () => void ausfuehren(demoEntfernen, 'Entfernen') },
        { label: 'Abbrechen', run: frageWeg },
      ],
    });

  return (
    <SetCard title="Demo-Daten" i={2}>
      <SetRow id="demo-daten" label="Demo-Daten" value={aktiv ? 'aktiv' : 'aus'}>
        <div className={`set-note ${aktiv ? 'warn' : ''}`}>
          {aktiv ? <FlaskConical /> : <Database />}
          <span>
            {aktiv ? (
              <>
                <b>Demo-Daten sind geladen.</b> Alles, was du jetzt erfasst, landet in der Demo-Datenbank und verschwindet beim
                Entfernen. Deine eigenen Daten liegen unverändert daneben.
              </>
            ) : (
              <>
                <b>Nur in der Entwicklerversion.</b> Lädt ein erfundenes Kleingewerbe (Haus- & Gartenservice) mit rund 450
                Buchungen, 220 Kunden, Quittungen, Rechnungen und Terminen über die letzten 22 Monate. Es liegt in einer eigenen
                Datenbankdatei, deine Daten bleiben unberührt.
              </>
            )}
          </span>
        </div>
        <div className="row wrap">
          {aktiv ? (
            <button type="button" className="btn danger" disabled={laeuft || !nativ} onClick={entfernen}>
              {laeuft ? <LoaderCircle className="ic spin" /> : <Trash2 />}
              {laeuft ? 'Entferne …' : 'Demo-Daten entfernen'}
            </button>
          ) : (
            <button type="button" className="btn-primary sm" disabled={laeuft || !nativ} onClick={laden}>
              {laeuft ? <LoaderCircle className="ic spin" /> : <FlaskConical />}
              {laeuft ? 'Lade …' : 'Demo-Daten laden'}
            </button>
          )}
        </div>
        {!nativ ? <p className="hint">Nur in der Mac-App (npm run tauri dev).</p> : null}
      </SetRow>
    </SetCard>
  );
}
