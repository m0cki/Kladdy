/* Suche/Befehlspalette in der Kopfzeile (§6.2, ⌘K): durchsucht Ein- & Ausgänge, Belege, Termine, Kunden, Kennzahlen,
 * Seiten (auch die Reiter der Auswertung, Vorlagen) und einzelne Einstellungen; mit „>“ nur Befehle. Ohne Eingabe:
 * die ersten vier Befehle und „Springen zu“ (die fünf Menüpunkte). Tastatur: ↑ ↓ wählen, ↵ öffnen, Esc schließen.
 * Die Daten werden beim Öffnen einmal geladen (lib/queries/suche.ts), solange die Liste offen ist wiederverwendet und
 * beim nächsten Öffnen frisch geholt; ein Fehler leert nur die betroffene Quelle. Logik: lib/suche.ts, lib/suche-daten.ts.
 * Quittung/Rechnung schreiben öffnen bis Phase 3 die Erfassen-Schublade als Einnahme (Vorbelegung kennt noch keinen
 * Beleg); Termin, Angebot und Eigenbeleg führen zu ihren Seiten, die das ab Phase 3 auswerten. */
import { forwardRef, useEffect, useMemo, useState, type ForwardedRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Ban,
  Blocks,
  CalendarDays,
  CalendarPlus,
  FilePen,
  FileStack,
  FileText,
  Minus,
  Moon,
  Plus,
  Receipt,
  ReceiptText,
  RefreshCw,
  Search,
  Settings,
  Sigma,
  SlidersHorizontal,
  Stamp,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { EINSTELLUNGEN, EINSTELLUNGEN_PFAD, bereich, bereichPfad } from '../../lib/einstellungen-index';
import { AUSWERTUNG, NAV } from '../../lib/navigation';
import { begrenze, gruppiere, markiere, parseAnfrage, suche, teile, type SuchEintrag } from '../../lib/suche';
import { DATEN_LIMITS, datenEintraege, sprungPfad, type DatenEintrag, type DatenSymbol } from '../../lib/suche-daten';
import { ladeSuchDaten } from '../../lib/queries/suche';
import { datenbankVerfuegbar } from '../../lib/db';
import { bearbeiten, erfassen } from '../../lib/erfassen';
import { kundeNeu, kundeOeffnen } from '../../lib/kunden-schublade';
import { checkForUpdate } from '../../lib/updates';
import { heute } from '../../lib/zeitraum';
import { toggleMode } from '../../store/ui';
import { Monogramm } from '../kunden/Monogramm';

type Nav = (to: string) => void;

interface Ziel extends SuchEintrag {
  icon: LucideIcon;
  run: (nav: Nav) => void;
}

/** Alles, was in der Liste stehen kann. */
type Eintrag = Ziel | DatenEintrag;

const go = (to: string) => (nav: Nav) => nav(to);

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

/** Ohne Eingabe: die fünf Menüpunkte. */
const SPRINGEN: Ziel[] = NAV.map((n) => ({ id: `springen:${n.to}`, art: 'seite' as const, gruppe: 'Springen zu', label: n.label, icon: n.icon, run: go(n.to) }));

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

const befehl = (id: string, label: string, sub: string, icon: LucideIcon, run: (nav: Nav) => void, keywords: string[] = []): Ziel => ({
  id: `befehl:${id}`,
  art: 'befehl',
  gruppe: 'Befehle',
  label,
  sub,
  keywords,
  icon,
  run,
});

/** Befehle nach §6.2, Untertitel wie im Prototyp. Die ersten vier stehen ohne Eingabe oben. */
const BEFEHLE: Ziel[] = [
  befehl('ausgabe', 'Ausgabe erfassen', 'Kosten eintragen · ⌘N', Minus, () => erfassen({ typ: 'ausgabe' }), ['Erfassen', 'Neu', 'Buchung']),
  befehl('einnahme', 'Einnahme erfassen', 'Geld von Kunden eintragen', Plus, () => erfassen({ typ: 'einnahme' }), ['Erfassen', 'Neu', 'Buchung', 'Umsatz']),
  // Quittung und Rechnung: dieselbe Erfassen-Schublade, Beleg vorgewählt (Beleg und Einnahme in einem Schritt)
  befehl('quittung', 'Quittung schreiben', 'Einnahme mit Quittung erfassen · nächste Nummer', Receipt, () => erfassen({ typ: 'einnahme', beleg: 'quittung' }), ['Beleg', 'Neu']),
  befehl('rechnung', 'Rechnung schreiben', 'Einnahme mit Rechnung – bezahlt oder offen', ReceiptText, () => erfassen({ typ: 'einnahme', beleg: 'rechnung' }), ['Beleg', 'Neu']),
  befehl('termin', 'Termin eintragen', 'Kundentermin, auf Wunsch mit vorbereiteter Quittung · kommt mit Phase 3', CalendarPlus, go('/termine?neu=1'), ['Neu', 'Kalender']),
  befehl('angebot', 'Angebot schreiben', 'Angebot an einen Kunden – noch keine Einnahme', FileText, go('/belege/neu?art=angebot'), ['Beleg', 'Neu']),
  befehl('eigenbeleg', 'Eigenbeleg erstellen', 'Wenn der Originalbeleg einer Ausgabe fehlt', Stamp, go('/belege/neu?art=eigenbeleg'), ['Beleg', 'Neu']),
  befehl('vorlagen', 'Vorlagen bearbeiten', 'Quittung & Rechnung aus Bausteinen gestalten', Blocks, go('/belege/vorlagen'), ['Baukasten', 'Layout']),
  befehl('kunde', 'Kunde anlegen', 'Neuen Kunden mit Adresse und Notiz anlegen', UserPlus, () => kundeNeu(), ['Neu', 'Kontakt']),
  befehl('hell-dunkel', 'Hell/Dunkel umschalten', '⇧⌘L', Moon, () => toggleMode(), ['Modus', 'Dark Mode']),
  befehl('einstellungen', 'Einstellungen öffnen', 'Darstellung, Firma, Daten', Settings, go(EINSTELLUNGEN_PFAD), ['Optionen']),
  befehl('updates', 'Nach Updates suchen …', 'Neue Version von Kladdy prüfen', RefreshCw, () => void checkForUpdate({ manual: true }), ['Update', 'Version']),
];

const VORSCHLAEGE: Ziel[] = [...BEFEHLE.slice(0, 4), ...SPRINGEN];
const FESTE: Ziel[] = [...SEITEN, ...EINSTELLUNGS_ZIELE, ...BEFEHLE];

/** Höchstzahl je Gruppe bei Eingabe (mit „>“ alle Befehle). */
const LIMITS: Readonly<Record<string, number>> = { ...DATEN_LIMITS, Seiten: 6, Einstellungen: 5, Befehle: 3 };

const SYMBOL: Readonly<Record<Exclude<DatenSymbol, 'kunde'>, LucideIcon>> = {
  einnahme: Plus,
  ausgabe: Minus,
  quittung: Receipt,
  rechnung: ReceiptText,
  angebot: FileText,
  eigenbeleg: Stamp,
  gutschrift: FilePen,
  storno: Ban,
  termin: CalendarDays,
  kennzahl: Sigma,
};

const istDaten = (e: Eintrag): e is DatenEintrag => e.art === 'daten';

/** Was ein Daten-Treffer tut: Buchung wie ein Klick auf die Zeile in Ein- & Ausgänge, Kunde öffnet seine Schublade,
 *  Beleg/Termin/Kennzahl führen zur Seite (lib/suche-daten.ts → sprungPfad). */
function springe(e: DatenEintrag, nav: Nav): void {
  if (e.sprung.art === 'buchung') bearbeiten(e.sprung.id);
  else if (e.sprung.art === 'kunde') kundeOeffnen(e.sprung.id);
  else {
    const pfad = sprungPfad(e.sprung);
    if (pfad) nav(pfad);
  }
}

function Markiert({ text, marks }: { text: string; marks: readonly [number, number][] }) {
  return (
    <>
      {teile(text, marks).map((p, k) => (p.mark ? <mark key={k}>{p.text}</mark> : <span key={k}>{p.text}</span>))}
    </>
  );
}

function TrefferSymbol({ e }: { e: Eintrag }) {
  if (!istDaten(e)) {
    const Icon = e.icon;
    return <Icon />;
  }
  if (e.symbol === 'kunde') return <Monogramm name={e.label} size="xs" />;
  const Icon = SYMBOL[e.symbol];
  return <Icon />;
}

export const Suche = forwardRef(function Suche(_props: object, ref: ForwardedRef<HTMLInputElement>) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [daten, setDaten] = useState<DatenEintrag[]>([]);

  // Beim Öffnen einmal laden, solange offen wiederverwenden, beim Schließen verwerfen (nächstes Öffnen = frisch)
  useEffect(() => {
    if (!open || !datenbankVerfuegbar()) return;
    let aktiv = true;
    ladeSuchDaten()
      .then((d) => {
        if (aktiv) setDaten(datenEintraege(d, heute()));
      })
      .catch((e: unknown) => console.warn('Suche: Daten nicht geladen', e));
    return () => {
      aktiv = false;
      setDaten([]);
    };
  }, [open]);

  const leer = q.trim() === '';
  const nurBefehle = useMemo(() => parseAnfrage(q).nurBefehle, [q]);
  const quellen = useMemo<Eintrag[]>(() => (leer ? VORSCHLAEGE : nurBefehle ? BEFEHLE : [...FESTE, ...daten]), [leer, nurBefehle, daten]);
  const treffer = useMemo(() => begrenze(suche<Eintrag>(quellen, q, Infinity), nurBefehle || leer ? {} : LIMITS, 40), [quellen, q, nurBefehle, leer]);
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
    const e = t.eintrag;
    if (istDaten(e)) springe(e, navigate);
    else e.run(navigate);
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
        title="Einträge, Belege, Termine, Kunden, Kennzahlen, Seiten und Einstellungen durchsuchen – mit „>“ nur Befehle"
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
                <span>{g.gruppe}</span>
              </div>
              {g.treffer.map((t) => {
                idx += 1;
                const i = idx;
                const e = t.eintrag;
                const d = istDaten(e) ? e : null;
                const rechtsKlasse = d?.rechts ? (d.rechts.startsWith('+') ? 'pos' : d.rechts.startsWith('−') ? 'neg' : '') : '';
                return (
                  <div
                    key={e.id}
                    id={optId(i)}
                    className={`sd-item ${i === active ? 'active' : ''} ${d?.storniert ? 'is-storno' : ''}`}
                    role="option"
                    aria-selected={i === active}
                    ref={(el) => {
                      if (el && i === active) el.scrollIntoView({ block: 'nearest' });
                    }}
                    onMouseMove={() => i !== active && setActive(i)}
                    onClick={() => ausfuehren(i, ref && 'current' in ref ? ref.current : null)}
                  >
                    <TrefferSymbol e={e} />
                    <div className="sd-main">
                      <span className="sd-name">
                        <Markiert text={e.label} marks={t.marks} />
                      </span>
                      {e.sub ? (
                        <span className="sd-sub">
                          <Markiert text={e.sub} marks={leer ? [] : markiere(e.sub, q)} />
                        </span>
                      ) : null}
                    </div>
                    {d?.rechts ? (
                      <span className={`sd-right ${rechtsKlasse}`} title={d.storniert ? 'storniert – zählt nicht mehr' : undefined}>
                        {d.rechts}
                      </span>
                    ) : null}
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
