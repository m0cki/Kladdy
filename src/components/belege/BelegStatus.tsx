/* Status-Badge eines Belegs als Knopf mit Menü (§6.6 „Status selbst festlegen“, Prototyp statusPopover/statusMenu):
 * Klick aufs Badge (Liste und Maske) zeigt eine kurze Erklärung und die erlaubten Schritte je Art und Status.
 * Entwürfe zeigen nur das Badge – sie werden in der Maske ausgestellt. Das Menü hängt am <body> (fixed), damit die
 * Tabelle es nicht abschneidet; Esc, Tab, Klick daneben und Scrollen (Knopf außer Sicht) schließen es. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  Ban,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  Copy,
  FileText,
  Pencil,
  Receipt,
  RotateCcw,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { alsEntwurfKopieren, angebotStatus, pdfOeffnenFuer, umwandeln } from '../../lib/belegaktionen';
import { erfassen } from '../../lib/erfassen';
import { ladeBeleg } from '../../lib/queries/rechnungen';
import { STATUS_BADGE, istVorbereitet, statusMenue, statusSchluessel, type BelegZeile, type StatusAktion } from '../../lib/rechnungen';
import { belegDialog } from './BelegDialog';

export function StatusBadge({ z, heute }: { z: BelegZeile; heute: string }) {
  const b = STATUS_BADGE[statusSchluessel(z, heute)];
  return <span className={`badge ${b.klasse}`}>{b.text}</span>;
}

const SYMBOL: Readonly<Record<StatusAktion, LucideIcon>> = {
  bezahlt: Check,
  'doch-offen': RotateCcw,
  stornieren: X,
  'als-rechnung': FileText,
  duplizieren: Copy,
  umwandeln: ArrowRight,
  'rechnung-oeffnen': ArrowRight,
  'angebot-offen': Clock,
  'angebot-abgelehnt': Ban,
  oeffnen: Pencil,
  ausstellen: Receipt,
  'zum-termin': CalendarDays,
  'vorbereitung-weg': Trash2,
  pdf: FileText,
};

/** Führt eine Aktion aus dem Status-Menü aus (Liste und Maske). */
export function statusAktionAusfuehren(aktion: StatusAktion, z: BelegZeile, navigate: (to: string) => void): void {
  const oeffne = (id: number | null) => {
    if (id != null) navigate(`/belege/${id}`);
  };
  switch (aktion) {
    case 'bezahlt':
    case 'doch-offen':
    case 'stornieren':
      belegDialog(aktion, z);
      break;
    case 'als-rechnung':
      belegDialog('als-rechnung', z, oeffne);
      break;
    case 'vorbereitung-weg':
      belegDialog('loeschen', z);
      break;
    case 'duplizieren':
      void alsEntwurfKopieren(z.id).then(oeffne);
      break;
    case 'umwandeln':
      void umwandeln(z).then(oeffne);
      break;
    case 'rechnung-oeffnen':
      void ladeBeleg(z.id).then((b) => oeffne(b?.beleg.rechnung_aus_angebot_id ?? null));
      break;
    case 'angebot-offen':
      void angebotStatus(z, 'offen');
      break;
    case 'angebot-abgelehnt':
      void angebotStatus(z, 'abgelehnt');
      break;
    case 'oeffnen':
      navigate(`/belege/${z.id}`);
      break;
    case 'ausstellen':
      // vorbereiteter Beleg: ausgestellt wird nur über die eine Erfassen-Schublade (§6.5)
      erfassen({ typ: 'einnahme', entwurf: z.id, termin: z.termin_id ?? undefined, beleg: z.art === 'rechnung' ? 'rechnung' : 'quittung' });
      break;
    case 'zum-termin':
      if (z.termin_id != null) navigate(`/termine?t=${z.termin_id}`);
      break;
    case 'pdf':
      void pdfOeffnenFuer(z.id);
      break;
  }
}

interface Props {
  z: BelegZeile;
  heute: string;
  /** in der Maske dieses Belegs (dort steht das Ausstellen unten) */
  hier?: boolean;
  onAktion: (aktion: StatusAktion) => void;
}

export function StatusKnopf({ z, heute, hier = false, onAktion }: Props) {
  const [offen, setOffen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const nurBadge = z.status === 'entwurf' && !istVorbereitet(z);

  const zu = (fokus = false) => {
    setOffen(false);
    setPos(null);
    if (fokus) btn.current?.focus({ preventScroll: true });
  };

  // Lage: unter dem Knopf, rechtsbündig; passt es unten nicht, darüber
  const platzieren = () => {
    const b = btn.current?.getBoundingClientRect();
    const p = pop.current;
    if (!b || !p) return;
    if (b.bottom < 0 || b.top > innerHeight) return zu();
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    let top = b.bottom + 6;
    if (top + h > innerHeight - 12) top = Math.max(12, b.top - h - 6);
    setPos({ left: Math.round(Math.min(innerWidth - w - 12, Math.max(12, b.right - w))), top: Math.round(top) });
  };

  useLayoutEffect(() => {
    if (offen) platzieren();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur beim Öffnen messen
  }, [offen]);

  useEffect(() => {
    if (!offen) return;
    pop.current?.querySelector<HTMLButtonElement>('.bl-mi')?.focus({ preventScroll: true });
    const maus = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !btn.current?.contains(t)) zu();
    };
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        zu(true);
      }
    };
    const scroll = () => platzieren();
    document.addEventListener('mousedown', maus);
    window.addEventListener('keydown', taste, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    return () => {
      document.removeEventListener('mousedown', maus);
      window.removeEventListener('keydown', taste, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', scroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Handler je Öffnen
  }, [offen]);

  if (nurBadge) return <StatusBadge z={z} heute={heute} />;
  const menue = offen ? statusMenue(z, heute, hier) : null;

  const tasten = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const liste = [...(pop.current?.querySelectorAll<HTMLButtonElement>('.bl-mi') ?? [])];
    const i = liste.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (liste.length) liste[(i + (e.key === 'ArrowDown' ? 1 : liste.length - 1)) % liste.length].focus();
    } else if (e.key === 'Tab') zu();
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`bl-stbtn ${offen ? 'open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={offen}
        title="Status ändern"
        onClick={(e) => {
          e.stopPropagation();
          if (offen) zu();
          else setOffen(true);
        }}
      >
        <StatusBadge z={z} heute={heute} />
        <ChevronDown />
      </button>
      {menue
        ? createPortal(
            <div
              ref={pop}
              className="bl-stmenu"
              role="menu"
              aria-label={`Status ${z.nummer ?? ''}`}
              style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={tasten}
            >
              <div className="bl-st-head">
                <StatusBadge z={z} heute={heute} />
                <p>{menue.text}</p>
              </div>
              {menue.punkte.map((p) => {
                const Icon = SYMBOL[p.aktion];
                return (
                  <button
                    key={p.aktion}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={`bl-mi ${p.art ?? ''}`}
                    onClick={() => {
                      zu();
                      onAktion(p.aktion);
                    }}
                  >
                    <Icon />
                    <span>
                      <b>{p.label}</b>
                      {p.sub ? <small>{p.sub}</small> : null}
                    </span>
                    {p.art === 'on' ? <Check className="ic bl-mi-on" /> : <span />}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
