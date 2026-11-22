/* „Eintrag löschen?“ – eigener modaler Bestätigungsdialog für das endgültige Löschen einer Buchung (§6.3, §6.4).
 * Geöffnet von „Löschen“ in „Buchung bearbeiten“ und vom Papierkorb an der Zeile in Ein- & Ausgänge über
 * `loeschDialog(…)`; hängt im AppShell und liegt per Portal über allem, auch über der offenen Erfassen-Schublade.
 * Fragt Rust erst, ob und was gelöscht wird (`buchung_loeschbar`), löscht dann in einem Command (`buchung_loeschen`).
 * Standardfokus auf „Abbrechen“, Esc = Abbrechen, Tab bleibt im Dialog; Tastenkürzel dahinter (⌘↩, ⌘N) sind gesperrt.
 * Optik: dieselben Klassen wie Drawer (§9.4), Texte aus lib/loeschen.ts. */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { create } from 'zustand';
import { fehlerText } from '../../lib/fehler';
import { loeschHinweise, loeschToast, loeschZusammenfassung, type LoeschZiel } from '../../lib/loeschen';
import { buchungLoeschbar, buchungLoeschen, type Loeschbarkeit } from '../../lib/queries/buchungen';
import { useUi } from '../../store/ui';

interface Auftrag {
  ziel: LoeschZiel;
  /** in der Schublade gibt es ungespeicherte Eingaben (gehen verloren) */
  ungespeichert: boolean;
  /** nach dem Löschen, z. B. die Schublade schließen */
  danach?: () => void;
  n: number;
}

type Pruefung = { status: 'laden' } | { status: 'ok'; l: Loeschbarkeit } | { status: 'fehler'; text: string };

const useLoeschDialog = create<{ auftrag: Auftrag | null }>(() => ({ auftrag: null }));
let zaehler = 0;

export function loeschDialog(ziel: LoeschZiel, o: { ungespeichert?: boolean; danach?: () => void } = {}): void {
  useLoeschDialog.setState({ auftrag: { ziel, ungespeichert: Boolean(o.ungespeichert), danach: o.danach, n: ++zaehler } });
}

const FOKUSSIERBAR = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function LoeschDialog() {
  const auftrag = useLoeschDialog((s) => s.auftrag);
  const [pruefung, setPruefung] = useState<Pruefung>({ status: 'laden' });
  const [laeuft, setLaeuft] = useState(false);
  const [shown, setShown] = useState(false);
  const box = useRef<HTMLElement>(null);
  const abbrechenKnopf = useRef<HTMLButtonElement>(null);
  const vorher = useRef<HTMLElement | null>(null);
  const laeuftRef = useRef(false);
  useEffect(() => {
    laeuftRef.current = laeuft;
  }, [laeuft]);

  const schliessen = useCallback(() => {
    useLoeschDialog.setState({ auftrag: null });
    setShown(false);
    if (vorher.current?.isConnected) vorher.current.focus({ preventScroll: true });
    vorher.current = null;
  }, []);

  // neuer Auftrag: Fokus merken, Rust fragen, einblenden und „Abbrechen“ fokussieren
  useEffect(() => {
    if (!auftrag) return;
    let aktiv = true;
    vorher.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPruefung({ status: 'laden' });
    setLaeuft(false);
    setShown(false);
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!aktiv) return;
        setShown(true);
        abbrechenKnopf.current?.focus({ preventScroll: true });
      }),
    );
    buchungLoeschbar(auftrag.ziel.id).then(
      (l) => {
        if (aktiv) setPruefung({ status: 'ok', l });
      },
      (e: unknown) => {
        if (aktiv) setPruefung({ status: 'fehler', text: fehlerText(e) });
      },
    );
    return () => {
      aktiv = false;
      cancelAnimationFrame(raf);
    };
  }, [auftrag]);

  // Tastatur: im Einfangmodus (capture), damit Esc nicht auch die Schublade dahinter schließt
  useEffect(() => {
    if (!auftrag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (!laeuftRef.current) schliessen();
        return;
      }
      if (e.key === 'Tab') {
        e.stopPropagation();
        const el = box.current ? Array.from(box.current.querySelectorAll<HTMLElement>(FOKUSSIERBAR)) : [];
        if (!el.length) {
          e.preventDefault();
          return;
        }
        const erstes = el[0];
        const letztes = el[el.length - 1];
        const aktiv = document.activeElement;
        if (!box.current?.contains(aktiv) || (e.shiftKey && aktiv === erstes) || (!e.shiftKey && aktiv === letztes)) {
          e.preventDefault();
          (e.shiftKey ? letztes : erstes).focus();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey) e.stopPropagation(); // keine Kürzel der Seite/Schublade hinter dem Dialog
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [auftrag, schliessen]);

  if (!auftrag) return null;
  const { ziel } = auftrag;
  const l = pruefung.status === 'ok' ? pruefung.l : null;
  const gesperrt = l !== null && !l.loeschbar;
  const kannLos = l?.loeschbar === true && !laeuft;

  const los = async () => {
    if (!kannLos) return;
    setLaeuft(true);
    try {
      const r = await buchungLoeschen(ziel.id);
      schliessen();
      auftrag.danach?.();
      const ui = useUi.getState();
      ui.datenGeaendert();
      ui.showToast({ text: loeschToast(r), icon: 'check' });
    } catch (e) {
      setLaeuft(false);
      setPruefung({ status: 'fehler', text: `Löschen ging nicht: ${fehlerText(e)}` });
    }
  };

  return createPortal(
    <div className={`overlay lo-overlay ${shown ? 'open' : ''}`}>
      <div className="drawer-backdrop" onClick={() => (laeuft ? undefined : schliessen())} />
      <aside
        ref={box}
        tabIndex={-1}
        className="drawer lo-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="lo-titel"
        aria-describedby="lo-frage"
      >
        <header className="drawer-head">
          <h2 id="lo-titel">
            <Trash2 />
            <span>
              {gesperrt ? 'Löschen geht nicht' : 'Eintrag löschen?'}
              <small>Buchung {ziel.nummer}</small>
            </span>
          </h2>
        </header>
        <div className="drawer-body">
          <section>
            <p id="lo-frage">
              {gesperrt ? 'Dieser Eintrag lässt sich nicht löschen.' : 'Wirklich diesen Eintrag löschen? Das lässt sich nicht rückgängig machen.'}
            </p>
            <dl className="lo-zus">
              {loeschZusammenfassung(ziel).map((z) => (
                <Fragment key={z.label}>
                  <dt>{z.label}</dt>
                  <dd className={z.label === 'Beschreibung' ? undefined : 'num'}>{z.wert}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
          <section>
            {pruefung.status === 'laden' ? (
              <p className="hint">Prüfe, was an der Buchung hängt …</p>
            ) : pruefung.status === 'fehler' ? (
              <p className="hint neg" role="alert">
                {pruefung.text}
              </p>
            ) : gesperrt ? (
              <p className="hint warn">{pruefung.l.grund}</p>
            ) : (
              <ul className="lo-hinweise">
                {loeschHinweise(pruefung.l, { ungespeichert: auftrag.ungespeichert }).map((h) => (
                  <li key={h} className="hint">
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <footer className="drawer-foot">
          <span className="spacer" />
          <button ref={abbrechenKnopf} type="button" className="btn ghost" disabled={laeuft} onClick={schliessen}>
            {gesperrt || pruefung.status === 'fehler' ? 'Schließen' : 'Abbrechen'}
          </button>
          {gesperrt ? null : (
            <button type="button" className="btn danger" disabled={!kannLos} onClick={() => void los()}>
              <Trash2 />
              Endgültig löschen
            </button>
          )}
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
