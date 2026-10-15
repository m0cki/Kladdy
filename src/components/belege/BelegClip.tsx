/* Büroklammer in der Liste Ein- & Ausgänge (§6.3, Spalte Beleg-Nr.): ein Beleg ⇒ gleich öffnen,
 * mehrere ⇒ kleines Menü mit den Originalnamen. Das Menü hängt am <body> (fixed), damit die Tabelle es nicht abschneidet;
 * Klicks darin erreichen die Zeile nicht (die würde sonst die Schublade öffnen). */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderSearch, Paperclip } from 'lucide-react';
import { dateiArt, dateiName, groesseText } from '../../lib/belege';
import { fehlerText } from '../../lib/fehler';
import { ladeBelegeZuBuchung, type BelegZeile } from '../../lib/queries/belege';
import { useUi } from '../../store/ui';
import { DateiSymbol, belegAktion } from './BelegDateien';

interface Menue {
  liste: BelegZeile[];
  x: number;
  y: number;
}

export function BelegClip({ buchungId, anzahl }: { buchungId: number; anzahl: number }) {
  const [menue, setMenue] = useState<Menue | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const klick = async () => {
    if (menue) return setMenue(null);
    try {
      const liste = await ladeBelegeZuBuchung(buchungId);
      if (liste.length === 1) return belegAktion('oeffnen', liste[0].id);
      if (!liste.length) return;
      const r = btn.current?.getBoundingClientRect();
      setMenue({ liste, x: r ? r.left : 0, y: r ? r.bottom + 6 : 0 });
    } catch (e) {
      useUi.getState().showToast({ text: fehlerText(e), icon: 'warn', sticky: true });
    }
  };

  // Klick daneben, Esc, Scrollen oder Größenänderung schließen das Menü
  useEffect(() => {
    if (!menue) return;
    const zu = () => setMenue(null);
    const maus = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) zu();
    };
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        zu();
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', maus);
    window.addEventListener('keydown', taste, true);
    window.addEventListener('scroll', zu, true);
    window.addEventListener('resize', zu);
    return () => {
      document.removeEventListener('mousedown', maus);
      window.removeEventListener('keydown', taste, true);
      window.removeEventListener('scroll', zu, true);
      window.removeEventListener('resize', zu);
    };
  }, [menue]);

  // erste Zeile fokussieren (Tastatur)
  useEffect(() => {
    if (menue) pop.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [menue]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="bu-clip"
        title={anzahl === 1 ? 'Beleg öffnen' : `${anzahl} Belege · zum Auswählen klicken`}
        aria-label={anzahl === 1 ? 'Beleg öffnen' : `${anzahl} Belege`}
        aria-haspopup={anzahl > 1 ? 'menu' : undefined}
        aria-expanded={anzahl > 1 ? menue !== null : undefined}
        onClick={() => void klick()}
      >
        <Paperclip />
      </button>
      {menue
        ? createPortal(
            <div
              ref={pop}
              className="bl-menue"
              role="menu"
              aria-label="Belege"
              style={{ left: menue.x, top: menue.y }}
              onClick={(e) => e.stopPropagation()}
            >
              {menue.liste.map((b) => {
                const name = b.originalname || dateiName(b.pfad);
                return (
                  <div key={b.id} className="bl-menue-z">
                    <button
                      type="button"
                      role="menuitem"
                      className="bl-menue-o"
                      title={`${name} öffnen`}
                      onClick={() => {
                        setMenue(null);
                        belegAktion('oeffnen', b.id);
                      }}
                    >
                      <DateiSymbol art={dateiArt(name, b.mime)} />
                      <span>{name}</span>
                      <small>{groesseText(b.groesse)}</small>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="icon-btn sm"
                      title="Im Finder zeigen"
                      aria-label={`${name} im Finder zeigen`}
                      onClick={() => {
                        setMenue(null);
                        belegAktion('zeigen', b.id);
                      }}
                    >
                      <FolderSearch />
                    </button>
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
