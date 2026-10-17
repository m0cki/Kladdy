/* Einstellungen › Daten (§6.10, §3.1): Tectonic-Pfad für den PDF-Satz und (nur Entwicklerversion) Demo-Daten.
 * - Tectonic: Rust sucht in der Reihenfolge aus §3.1 (mitgeliefert, Homebrew, eigener Pfad) und prüft mit `--version`.
 *   Ein eigener Pfad wird vor dem Speichern geprüft (vorhandene, ausführbare Datei); „Automatisch“ löscht ihn wieder.
 * - Demo-Daten: nur bei `import.meta.env.DEV` (lib/demo.ts). Laden und Entfernen fragen per Warn-Toast nach und laden
 *   danach die Oberfläche neu, weil die App dann eine andere Datenbankdatei öffnet. */
import { useState } from 'react';
import { CircleCheck, Database, FlaskConical, FolderOpen, LoaderCircle, PackageSearch, RotateCcw, Stethoscope, Trash2, TriangleAlert } from 'lucide-react';
import { DEMO_MOEGLICH, demoEntfernen, demoLaden, neuStarten, useDemo } from '../../lib/demo';
import { inTauri } from '../../lib/menu';
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
    </SetCard>
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
