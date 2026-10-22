/* Einstellungen als eigene Seite (Wunsch des Nutzers, abweichend von §6.10 „Schublade“).
 * Die Bereichs-Navigation steht dann in der Seitenleiste (Sidebar.tsx). ⚙ oder Esc führen zur vorherigen Seite zurück.
 * `?feld=<id>` (aus der Suche) scrollt zur Einstellung und hebt sie kurz hervor. */
import { useEffect, useRef, type ComponentType } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { bereich, bereichPfad, isBereichId, type Bereich, type BereichId } from '../lib/einstellungen-index';
import { START } from '../lib/navigation';
import { useUi } from '../store/ui';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHead, reveal } from '../components/ui/PageHead';
import Darstellung from './einstellungen/Darstellung';
import Belege from './einstellungen/Belege';
import Daten from './einstellungen/Daten';
import Firma from './einstellungen/Firma';
import Nummernkreise from './einstellungen/Nummernkreise';
import Steuern from './einstellungen/Steuern';
import UpdatesUeber from './einstellungen/UpdatesUeber';

const FLASH_MS = 1800;

/** Gebaute Bereiche; alle anderen zeigen den Platzhalter. */
const INHALT: Partial<Record<BereichId, ComponentType>> = {
  darstellung: Darstellung,
  firma: Firma,
  belege: Belege,
  steuern: Steuern,
  nummernkreise: Nummernkreise,
  daten: Daten,
  updates: UpdatesUeber,
};

function Platzhalter({ b }: { b: Bereich }) {
  return (
    <section className="card reveal" style={reveal(1)} data-setting={b.id}>
      <EmptyState icon={b.icon} title={b.phase ? `Kommt mit Phase ${b.phase}` : 'Kommt bald'}>
        {b.inhalt}
      </EmptyState>
    </section>
  );
}

/** Element kurz hervorheben (Animation über Tokens; bei „Bewegung: Aus“ bleibt nur die ruhige Markierung). */
function hervorheben(el: HTMLElement, smooth: boolean) {
  el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  el.classList.remove('set-flash');
  void el.offsetWidth; // Animation neu starten
  el.classList.add('set-flash');
  window.setTimeout(() => el.classList.remove('set-flash'), FLASH_MS);
  const fokus = el.querySelector<HTMLElement>('input, button, select, textarea');
  fokus?.focus({ preventScroll: true });
}

export default function Einstellungen() {
  const { bereich: param } = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const zurueck = useUi((s) => s.zurueck);
  const motion = useUi((s) => s.settings.motion);
  const inhalt = useRef<HTMLDivElement>(null);
  const feld = search.get('feld');

  // Esc: zurück zur vorherigen Seite (nicht, wenn gerade eine Schublade offen ist oder ein Feld Esc braucht)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || useUi.getState().drawer) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('.search, .overlay')) return;
      navigate(zurueck || START);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, zurueck]);

  // Sprung zu einer einzelnen Einstellung (nach dem Seitenwechsel, der selbst nach oben scrollt)
  useEffect(() => {
    if (!feld) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const root = inhalt.current;
        if (!root) return;
        const el = root.querySelector<HTMLElement>(`[data-setting="${CSS.escape(feld)}"]`) ?? root.querySelector<HTMLElement>('[data-setting]');
        if (el) hervorheben(el, motion === 'full');
        const next = new URLSearchParams(search);
        next.delete('feld');
        setSearch(next, { replace: true });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [feld, param, motion, search, setSearch]);

  if (!isBereichId(param)) return <Navigate to={bereichPfad('darstellung')} replace />;
  const b = bereich(param);
  const Inhalt = INHALT[b.id];

  return (
    <div className="page">
      <PageHead icon={Settings} title="Einstellungen" sub={`${b.label} · gilt nur für diesen Mac`} />
      <div className="set-content" ref={inhalt} key={b.id}>
        {Inhalt ? <Inhalt /> : <Platzhalter b={b} />}
      </div>
    </div>
  );
}
