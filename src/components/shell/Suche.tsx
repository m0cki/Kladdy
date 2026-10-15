/* Suche in der Kopfzeile (§6.2, ⌘K): findet Seiten, Reiter der Auswertung, Vorlagen und einzelne Einstellungen;
 * mit „>“ nur Befehle. Tastatur: ↑ ↓ wählen, ↵ öffnen, Esc schließen.
 * Phase 2 erweitert das zur vollen Befehlspalette: weitere Quellen in `quellen()` anhängen (Einträge, Belege, Termine,
 * Kunden, Kennzahlen) und weitere Befehle in BEFEHLE – Logik und Darstellung bleiben gleich (lib/suche.ts). */
import { forwardRef, useMemo, useState, type ForwardedRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileStack, Minus, Moon, Plus, RefreshCw, Search, Settings, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { EINSTELLUNGEN, EINSTELLUNGEN_PFAD, bereich, bereichPfad } from '../../lib/einstellungen-index';
import { AUSWERTUNG, NAV } from '../../lib/navigation';
import { gruppiere, suche, teile, type SuchEintrag } from '../../lib/suche';
import { erfassen } from '../../lib/erfassen';
import { checkForUpdate } from '../../lib/updates';
import { toggleMode } from '../../store/ui';

interface Ziel extends SuchEintrag {
  icon: LucideIcon;
  run: (nav: (to: string) => void) => void;
}

const go = (to: string) => (nav: (to: string) => void) => nav(to);

const SEITEN: Ziel[] = [
  ...NAV.map((n) => ({ id: `seite:${n.to}`, art: 'seite' as const, gruppe: 'Seiten', label: n.label, icon: n.icon, run: go(n.to) })),
  ...AUSWERTUNG.filter((t) => t.to !== '/auswertung').map((t) => ({
    id: `seite:${t.to}`,
    art: 'seite' as const,
    gruppe: 'Seiten',
    label: t.label,
    sub: `Auswertung · ${t.sub}`,
    keywords: ['Auswertung'],
    icon: t.icon,
    run: go(t.to),
  })),
  { id: 'seite:/auswertung#ueberblick', art: 'seite', gruppe: 'Seiten', label: 'Überblick', sub: 'Auswertung · Wie läuft das Geschäft?', keywords: ['Auswertung', 'Dashboard'], icon: AUSWERTUNG[0].icon, run: go('/auswertung') },
  { id: 'seite:/belege/vorlagen', art: 'seite', gruppe: 'Seiten', label: 'Vorlagen', sub: 'Rechnungen & Quittungen · Bausteine', keywords: ['Vorlage', 'Baukasten', 'Layout'], icon: FileStack, run: go('/belege/vorlagen') },
  { id: 'seite:/einstellungen', art: 'seite', gruppe: 'Seiten', label: 'Einstellungen', keywords: ['Optionen', 'Präferenzen'], icon: Settings, run: go(EINSTELLUNGEN_PFAD) },
];

const EINSTELLUNGS_ZIELE: Ziel[] = EINSTELLUNGEN.map((e) => {
  const b = bereich(e.bereich);
  return {
    id: `einstellung:${e.id}`,
    art: 'einstellung',
    gruppe: 'Einstellungen',
    label: e.label,
    sub: `Einstellungen · ${b.label}${b.phase ? ` (kommt mit Phase ${b.phase})` : ''}`,
    keywords: e.keywords,
    icon: SlidersHorizontal,
    run: go(bereichPfad(e.bereich, e.id)),
  };
});

const BEFEHLE: Ziel[] = [
  { id: 'befehl:ausgabe', art: 'befehl', gruppe: 'Befehle', label: 'Ausgabe erfassen', sub: '⌘N', keywords: ['Erfassen', 'Neu', 'Buchung', 'Kosten'], icon: Minus, run: () => erfassen({ typ: 'ausgabe' }) },
  { id: 'befehl:einnahme', art: 'befehl', gruppe: 'Befehle', label: 'Einnahme erfassen', sub: '⌘N', keywords: ['Erfassen', 'Neu', 'Buchung', 'Umsatz'], icon: Plus, run: () => erfassen({ typ: 'einnahme' }) },
  { id: 'befehl:hell-dunkel', art: 'befehl', gruppe: 'Befehle', label: 'Hell/Dunkel umschalten', sub: '⇧⌘L', keywords: ['Modus', 'Dark Mode'], icon: Moon, run: () => toggleMode() },
  { id: 'befehl:einstellungen', art: 'befehl', gruppe: 'Befehle', label: 'Einstellungen öffnen', keywords: ['Optionen'], icon: Settings, run: go(EINSTELLUNGEN_PFAD) },
  { id: 'befehl:updates', art: 'befehl', gruppe: 'Befehle', label: 'Nach Updates suchen …', keywords: ['Update', 'Version'], icon: RefreshCw, run: () => void checkForUpdate({ manual: true }) },
];

/** Alle Quellen der Suche. Ohne Eingabe: nur die Seiten als Vorschlag. */
const quellen = (q: string): Ziel[] => (q.trim() === '' ? SEITEN : [...SEITEN, ...EINSTELLUNGS_ZIELE, ...BEFEHLE]);

export const Suche = forwardRef(function Suche(_props: object, ref: ForwardedRef<HTMLInputElement>) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const treffer = useMemo(() => suche(quellen(q), q, 24), [q]);
  const gruppen = useMemo(() => gruppiere(treffer), [treffer]);
  const flach = useMemo(() => gruppen.flatMap((g) => g.treffer), [gruppen]);

  const close = (blur: boolean, input?: HTMLInputElement) => {
    setOpen(false);
    if (blur) input?.blur();
  };
  const ausfuehren = (i: number, input?: HTMLInputElement | null) => {
    const t = flach[i];
    if (!t) return;
    setQ('');
    setActive(0);
    close(true, input ?? undefined);
    t.eintrag.run(navigate);
  };

  const listId = 'suche-liste';
  const optId = (i: number) => `suche-opt-${i}`;
  let idx = -1;

  return (
    <div className={`search ${open ? 'open' : ''}`} id="search">
      <Search className="search-ic" />
      <input
        ref={ref}
        type="search"
        autoComplete="off"
        spellCheck={false}
        placeholder="Suchen oder Befehl …"
        title="Seiten, Einstellungen und Befehle durchsuchen (später auch Einträge, Belege, Termine, Kunden, Kennzahlen)"
        aria-label="Suchen"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && flach.length ? optId(active) : undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (q) setQ('');
            else close(true, e.currentTarget);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(flach.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            ausfuehren(active, e.currentTarget);
          }
        }}
      />
      <kbd>⌘K</kbd>
      <div
        className="sd"
        id={listId}
        role="listbox"
        aria-label="Suchergebnisse"
        // Klick in die Liste darf das Eingabefeld nicht verlassen (sonst schließt onBlur vor dem Klick)
        onMouseDown={(e) => e.preventDefault()}
      >
        {gruppen.length ? (
          gruppen.map((g) => (
            <div className="sd-group" key={g.gruppe} role="group" aria-label={g.gruppe}>
              <div className="sd-gtitle">
                <span>{q.trim() ? g.gruppe : 'Vorschläge'}</span>
              </div>
              {g.treffer.map((t) => {
                idx += 1;
                const i = idx;
                const Icon = t.eintrag.icon;
                return (
                  <div
                    key={t.eintrag.id}
                    id={optId(i)}
                    className={`sd-item ${i === active ? 'active' : ''}`}
                    role="option"
                    aria-selected={i === active}
                    ref={(el) => {
                      if (el && i === active) el.scrollIntoView({ block: 'nearest' });
                    }}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => ausfuehren(i, ref && 'current' in ref ? ref.current : null)}
                  >
                    <Icon />
                    <div className="sd-main">
                      <span className="sd-name">
                        {teile(t.eintrag.label, t.marks).map((p, k) => (p.mark ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>))}
                      </span>
                      {t.eintrag.sub ? <span className="sd-sub">{t.eintrag.sub}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        ) : (
          <div className="sd-empty">
            <Search />
            Nichts gefunden für „{q.trim()}“.
          </div>
        )}
        <div className="sd-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> auswählen
          </span>
          <span>
            <kbd>↵</kbd> öffnen
          </span>
          <span>
            <kbd>&gt;</kbd> nur Befehle
          </span>
          <span>
            <kbd>Esc</kbd> schließen
          </span>
        </div>
      </div>
    </div>
  );
});
