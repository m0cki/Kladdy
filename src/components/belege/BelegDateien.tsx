/* Bausteine für den Beleg-Abschnitt der Erfassen-Schublade (§6.4 „Beleg“):
 * - BelegDropzone: .dropzone (Klick öffnet den Datei-Dialog, „.over“ solange eine Datei über das Fenster gezogen wird)
 * - VorgemerkteBelege: noch nicht abgelegte Dateien mit Größe, Art, Hinweis auf schon abgelegte Doppel, Entfernen-Knopf
 * - VorhandeneBelege: abgelegte Dateien einer Buchung mit „Öffnen“ und „Im Finder zeigen“ (nie entfernen, GoBD)
 * Optik wie die file-chip/bu-file im Prototyp (referenz/prototyp/js/pages/buchungen.js, fileArea). */
import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, File, FileCode, FileImage, FileText, FolderSearch, Upload, X, type LucideProps } from 'lucide-react';
import { belegImportieren, useBelegZiehen } from '../../lib/belegablage';
import { DATEI_ART_NAME, dateiArt, dateiName, doppeltText, groesseText, zeitpunktDatum, type DateiArt, type VorgemerkterBeleg } from '../../lib/belege';
import { belegEntfernen } from '../../lib/erfassen';
import { fehlerText } from '../../lib/fehler';
import { belegOeffnen, belegZeigen, ladeBelegeZuBuchung, type BelegZeile } from '../../lib/queries/belege';
import { useUi } from '../../store/ui';

const ART_ICON = { pdf: FileText, bild: FileImage, xml: FileCode, datei: File } as const;

export function DateiSymbol({ art, ...props }: { art: DateiArt } & LucideProps) {
  const Icon = ART_ICON[art];
  return <Icon {...props} />;
}

const warn = (text: string) => useUi.getState().showToast({ text, icon: 'warn', sticky: true });

/** Datei öffnen bzw. im Finder zeigen; Fehler aus Rust als Toast. */
export function belegAktion(was: 'oeffnen' | 'zeigen', id: number): void {
  (was === 'oeffnen' ? belegOeffnen(id) : belegZeigen(id)).catch((e: unknown) => warn(fehlerText(e)));
}

/** Abgelegte Dateien einer Buchung (lädt nach jedem Schreibvorgang neu). */
export function useBelegeZuBuchung(id: number | null): BelegZeile[] {
  const stand = useUi((s) => s.datenStand);
  const [liste, setListe] = useState<BelegZeile[]>([]);
  useEffect(() => {
    if (id == null) {
      setListe([]);
      return;
    }
    let aktiv = true;
    ladeBelegeZuBuchung(id)
      .then((l) => {
        if (aktiv) setListe(l);
      })
      .catch((e: unknown) => {
        if (aktiv) warn(`Belege konnten nicht geladen werden: ${fehlerText(e)}`);
      });
    return () => {
      aktiv = false;
    };
  }, [id, stand]);
  return liste;
}

export function BelegDropzone({ titel, text, kompakt }: { titel: string; text: string; kompakt?: boolean }) {
  const ziehen = useBelegZiehen((s) => s.ziehen);
  const motion = useUi((s) => s.settings.motion);
  const ref = useRef<HTMLDivElement>(null);

  // Datei kommt übers Fenster ⇒ Dropzone sichtbar machen (die Schublade nimmt den Drop an)
  useEffect(() => {
    if (ziehen) ref.current?.scrollIntoView({ block: 'nearest', behavior: motion === 'full' ? 'smooth' : 'auto' });
  }, [ziehen, motion]);

  return (
    <div
      ref={ref}
      className={`dropzone bu-dz ${kompakt ? 'bl-dz-klein' : ''} ${ziehen ? 'over' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Beleg auswählen oder hierher ziehen"
      title="Datei aufs Fenster ziehen oder klicken (⌘O)"
      onClick={() => void belegImportieren()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void belegImportieren();
        }
      }}
    >
      <Upload />
      <b>{titel}</b>
      {kompakt ? null : <span>{text}</span>}
    </div>
  );
}

export function VorgemerkteBelege({ belege, wann }: { belege: readonly VorgemerkterBeleg[]; wann: string }) {
  if (!belege.length) return null;
  return (
    <ul className="bl-dateien" aria-label="Vorgemerkte Belege">
      {belege.map((b) => {
        const art = dateiArt(b.name, b.mime);
        const d = doppeltText(b.doppelt);
        return (
          <li key={b.pfad}>
            <div className="file-chip bu-file">
              <DateiSymbol art={art} />
              <span className="bl-file-t">
                <b title={b.pfad}>{b.name}</b>
                <small>{[groesseText(b.groesse), DATEI_ART_NAME[art], wann].filter(Boolean).join(' · ')}</small>
              </span>
              <button type="button" className="icon-btn sm" title="Nicht ablegen" aria-label={`${b.name} nicht ablegen`} onClick={() => belegEntfernen(b.pfad)}>
                <X />
              </button>
            </div>
            {d ? (
              <p className="hint warn bl-dup">
                <Copy />
                {d}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function VorhandeneBelege({ liste }: { liste: readonly BelegZeile[] }) {
  if (!liste.length) return null;
  return (
    <ul className="bl-dateien" aria-label="Abgelegte Belege">
      {liste.map((b) => {
        const name = b.originalname || dateiName(b.pfad);
        const art = dateiArt(name, b.mime);
        return (
          <li key={b.id}>
            <div className="file-chip bu-file bl-abgelegt">
              <DateiSymbol art={art} />
              <span className="bl-file-t">
                <b title={name}>{name}</b>
                <small>{[groesseText(b.groesse), DATEI_ART_NAME[art], `abgelegt am ${zeitpunktDatum(b.erstellt_am)}`, 'unveränderbar'].filter(Boolean).join(' · ')}</small>
              </span>
              <button type="button" className="icon-btn sm" title="Öffnen" aria-label={`${name} öffnen`} onClick={() => belegAktion('oeffnen', b.id)}>
                <ExternalLink />
              </button>
              <button type="button" className="icon-btn sm" title="Im Finder zeigen" aria-label={`${name} im Finder zeigen`} onClick={() => belegAktion('zeigen', b.id)}>
                <FolderSearch />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
