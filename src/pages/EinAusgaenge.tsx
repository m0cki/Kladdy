/* Ein- & Ausgänge (Startseite, §6.3): ruhige Liste aller geschäftlichen Zahlungen eines Zeitraums – keine Salden, keine Summen.
 * Kopf in drei Teilen (Titel · Zeitraum mittig · „+ Erfassen“), klebrige Filterleiste (Tabs, Suche, Filter-Popover, Chips,
 * „N ohne Beleg“), Tabelle neueste zuerst, darunter nur die Anzahl. Ändern über die Erfassen-Schublade, Entfernen = Storno.
 * Filter und Zeitraum lassen sich per Adresse vorgeben (Sprung aus der Auswertung, lib/buchungen.ts → listenVorgabe).
 * Büroklammer öffnet den Beleg (mehrere: Menü), „Beleg anhängen …“ im Zeilenmenü (nicht bei Gegenbuchungen).
 * Optik und Verhalten wie referenz/prototyp/js/pages/buchungen.js; Logik in lib/buchungen.ts, Daten in lib/queries/buchungen.ts. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeftRight,
  Ban,
  CalendarDays,
  Eye,
  FileUp,
  Funnel,
  Lock,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  LEERER_FILTER,
  SPERR_TEXT,
  ZAHLUNGSWEGE,
  anzahlErweitert,
  anzahlText,
  betragAnzeige,
  datumTagMonat,
  fehltBeleg,
  filtere,
  gegenueber,
  kannStornieren,
  listenSummen,
  listenVorgabe,
  markiere,
  quittungNachholbar,
  quittungZuBuchungPfad,
  sperre,
  zahlungswegName,
  type BuchungZeile,
  type Filter,
  type KategorieWahl,
  type TypFilter,
} from '../lib/buchungen';
import { belegAnhaengenDialog } from '../lib/belegablage';
import { bearbeiten, erfassen } from '../lib/erfassen';
import { ladeBuchungen, ladeKategorienWahl } from '../lib/queries/buchungen';
import { storniereMitNachfrage } from '../lib/storno';
import { teile } from '../lib/suche';
import { formatBetrag } from '../lib/money';
import { zeitraum } from '../lib/zeitraum';
import { useUi } from '../store/ui';
import { EmptyState } from '../components/ui/EmptyState';
import { reveal } from '../components/ui/PageHead';
import { Seg } from '../components/ui/Seg';
import { ZeitraumWahl } from '../components/ui/ZeitraumWahl';
import { KategorieIcon, ZAHLUNGSWEG_ICON } from '../components/buchungen/Symbole';
import { BelegClip } from '../components/belege/BelegClip';
import { Ladeansicht, useLaden } from './einstellungen/Laden';

const DF_LANG = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const datumLang = (iso: string) => DF_LANG.format(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
const zahl = (n: number) => new Intl.NumberFormat('de-DE').format(n);
/** Kategorie-Farbe kommt aus den Daten (kategorien.farbe) und wird nur als CSS-Variable gesetzt, wie im Prototyp. */
const farbe = (c: string | null): CSSProperties => ({ '--c': c ?? 'var(--muted)' }) as CSSProperties;

function Hl({ text, q }: { text: string; q: string }) {
  const marks = useMemo(() => markiere(text, q), [text, q]);
  if (!marks.length) return <>{text}</>;
  return (
    <>
      {teile(text, marks).map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

type Daten = { zeilen: BuchungZeile[]; kategorien: KategorieWahl[] };

export default function EinAusgaenge() {
  const { modus, anker } = useUi((s) => s.zeitraum);
  const setZeitraum = useUi((s) => s.setZeitraum);
  const datenStand = useUi((s) => s.datenStand);
  const z = zeitraum(modus, anker);

  // Sprung aus der Auswertung (?typ=…&ohne-beleg=1&modus=…&anker=…): Filter und Zeitraum übernehmen, Adresse wieder leeren
  const [params, setParams] = useSearchParams();
  const [listenKey, setListenKey] = useState(0);
  useLayoutEffect(() => {
    const v = listenVorgabe(params);
    if (!v) return;
    if (v.zeitraum) setZeitraum(v.zeitraum);
    gemerkterFilter = v.filter;
    setListenKey((k) => k + 1); // Liste neu aufbauen ⇒ übernimmt den Filter
    setParams({}, { replace: true });
  }, [params, setParams, setZeitraum]);

  const laden = useCallback(
    async (): Promise<Daten> => {
      void datenStand; // nach jedem Schreibvorgang neu laden
      // Filter: auch ausgeblendete Kategorien, die Buchungen haben (Einstellungen › Steuern)
      const [zeilen, kategorien] = await Promise.all([ladeBuchungen(z.von, z.bis), ladeKategorienWahl({ benutzte: true })]);
      return { zeilen, kategorien };
    },
    [z.von, z.bis, datenStand],
  );
  const { zustand, erneut } = useLaden(laden);

  return (
    <div className="page bu-page">
      <div className="page-head bu-head reveal" style={reveal(0)}>
        <div className="bu-head-titel">
          <h1>
            <ArrowLeftRight />
            Ein- &amp; Ausgänge
          </h1>
          <p className="page-sub">Alle geschäftlichen Zahlungen · es zählt das Zahlungsdatum</p>
        </div>
        <div className="bu-head-suche" id="bu-suche-slot" />
        <div className="bu-head-neu">
          <button type="button" className="btn-primary head-add" title="Einnahme oder Ausgabe erfassen (⌘N)" onClick={() => erfassen()}>
            <Plus />
            <span>Erfassen</span>
          </button>
        </div>
      </div>
      {zustand.status === 'ok' ? (
        <Liste
          key={listenKey}
          zeilen={zustand.daten.zeilen}
          kategorien={zustand.daten.kategorien}
          zeitraumLabel={z.label}
          zeitraumWahl={<ZeitraumWahl modus={modus} anker={anker} onChange={setZeitraum} />}
        />
      ) : (
        <Ladeansicht zustand={zustand} icon={ArrowLeftRight} was="Ein- und Ausgänge" erneut={erneut} />
      )}
    </div>
  );
}

/* ================= Filterleiste + Tabelle ================= */

const TABS: { value: TypFilter; label: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'einnahme', label: 'Eingänge' },
  { value: 'ausgabe', label: 'Ausgänge' },
];

// Filter überleben den Seitenwechsel (wie im Prototyp: Modulvariable)
let gemerkterFilter: Filter = LEERER_FILTER;

function Liste({
  zeilen,
  kategorien,
  zeitraumLabel,
  zeitraumWahl,
}: {
  zeilen: BuchungZeile[];
  kategorien: KategorieWahl[];
  zeitraumLabel: string;
  /** Zeitraum steht bei den Reitern (wie auf „Rechnungen & Quittungen“) */
  zeitraumWahl: ReactNode;
}) {
  // Suche steht im Seitenkopf (wie auf „Rechnungen & Quittungen“ und „Kunden“), ihr Zustand bleibt hier
  const [sucheSlot, setSucheSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setSucheSlot(document.getElementById('bu-suche-slot')), []);
  const [f, setF] = useState<Filter>(gemerkterFilter);
  const [q, setQ] = useState(f.q); // Eingabe sofort, Filter kurz entprellt
  const [pop, setPop] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    gemerkterFilter = f;
  }, [f]);
  useEffect(() => {
    if (q === f.q) return;
    const t = setTimeout(() => setF((x) => ({ ...x, q })), 90);
    return () => clearTimeout(t);
  }, [q, f.q]);

  const r = useMemo(() => filtere(zeilen, f), [zeilen, f]);
  const nErweitert = anzahlErweitert(f);
  const katById = useMemo(() => new Map(kategorien.map((k) => [k.id, k])), [kategorien]);
  const popKats = kategorien.filter((k) => f.typ === 'alle' || k.typ === f.typ || f.kategorien.includes(k.id));

  // Höhe der Filterleiste ⇒ klebriger Tabellenkopf sitzt direkt darunter
  useLayoutEffect(() => {
    const bar = barRef.current;
    const page = bar?.closest<HTMLElement>('.bu-page');
    if (!bar || !page) return;
    const ro = new ResizeObserver(() => page.style.setProperty('--bu-bar-h', `${bar.offsetHeight}px`));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  // Popover: Klick daneben oder Esc schließt
  useEffect(() => {
    if (!pop) return;
    const klick = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.('.bu-filter')) setPop(false);
    };
    const taste = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPop(false);
      }
    };
    document.addEventListener('mousedown', klick);
    window.addEventListener('keydown', taste, true);
    return () => {
      document.removeEventListener('mousedown', klick);
      window.removeEventListener('keydown', taste, true);
    };
  }, [pop]);

  const setTyp = (typ: TypFilter) =>
    setF((x) => ({ ...x, typ, kategorien: typ === 'alle' ? x.kategorien : x.kategorien.filter((id) => katById.get(id)?.typ === typ) }));
  const toggleKat = (id: number) =>
    setF((x) => ({ ...x, kategorien: x.kategorien.includes(id) ? x.kategorien.filter((k) => k !== id) : [...x.kategorien, id] }));
  const sucheLeeren = () => {
    setQ('');
    setF((x) => ({ ...x, q: '' }));
  };
  const allesZuruecksetzen = () => {
    setQ('');
    setF(LEERER_FILTER);
  };

  const chips = [];
  if (f.q.trim())
    chips.push(
      <button key="q" type="button" className="chip on" onClick={sucheLeeren}>
        <Search />„{f.q.trim()}“<X />
      </button>,
    );
  for (const id of f.kategorien) {
    const k = katById.get(id);
    chips.push(
      <button key={`k${id}`} type="button" className="chip on" onClick={() => toggleKat(id)}>
        <i className="dot bu-dot" style={farbe(k?.farbe ?? null)} />
        {k?.name ?? 'Kategorie'}
        <X />
      </button>,
    );
  }
  if (f.zahlungsart !== 'alle') {
    const Icon = ZAHLUNGSWEG_ICON[f.zahlungsart];
    chips.push(
      <button key="za" type="button" className="chip on" onClick={() => setF((x) => ({ ...x, zahlungsart: 'alle' }))}>
        <Icon />
        {zahlungswegName(f.zahlungsart)}
        <X />
      </button>,
    );
  }
  if (f.ohneBeleg)
    chips.push(
      <button key="ob" type="button" className="chip on" onClick={() => setF((x) => ({ ...x, ohneBeleg: false }))}>
        <TriangleAlert />
        ohne Beleg
        <X />
      </button>,
    );

  return (
    <>
      <div className="sticky-bar bu-bar reveal" style={reveal(1)} ref={barRef}>
        <div className="bu-bar-top">
          <Seg
            className="tabs"
            ariaLabel="Ein- oder Ausgänge"
            value={f.typ}
            onChange={setTyp}
            options={TABS.map((t) => ({
              value: t.value,
              label: (
                <>
                  {t.label}
                  <span className="cnt">{zahl(r.tabs[t.value])}</span>
                </>
              ),
            }))}
          />
          {zeitraumWahl}
          {sucheSlot ? createPortal(
          <label className="bu-search">
              <Search />
              <input
                type="search"
                className="input sm"
                value={q}
                placeholder="Suchen …"
                aria-label="Einnahmen und Ausgaben durchsuchen (Text, Nr., Name, Betrag)"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && q) {
                    e.preventDefault();
                    e.stopPropagation();
                    sucheLeeren();
                  }
                }}
              />
            </label>,
            sucheSlot,
          ) : null}
          <span className="spacer" />
          {r.ohneBeleg || f.ohneBeleg ? (
            <button type="button" className={`bu-ob-link ${f.ohneBeleg ? 'on' : ''}`} onClick={() => setF((x) => ({ ...x, ohneBeleg: !x.ohneBeleg }))}>
              <TriangleAlert />
              <span>{f.ohneBeleg ? 'Nur ohne Beleg · aufheben' : `${zahl(r.ohneBeleg)} ohne Beleg`}</span>
            </button>
          ) : null}
          <div className="bu-filter">
            <button
              type="button"
              className={`btn subtle bu-filter-btn ${nErweitert ? 'on' : ''}`}
              aria-expanded={pop}
              aria-haspopup="dialog"
              onClick={() => setPop((p) => !p)}
            >
              <Funnel />
              Filter
              {nErweitert ? <span className="bu-badge">{nErweitert}</span> : null}
            </button>
            {pop ? (
              <div className="bu-pop" role="dialog" aria-label="Weitere Filter">
                <div className="bu-pop-sec">
                  <h4>Kategorie</h4>
                  <div className="bu-pop-kats">
                    {popKats.map((k) => {
                      const n = r.proKategorie.get(k.id) ?? 0;
                      const an = f.kategorien.includes(k.id);
                      return (
                        <label key={k.id} className={`bu-check ${!n && !an ? 'zero' : ''}`}>
                          <input type="checkbox" checked={an} onChange={() => toggleKat(k.id)} />
                          <i className="dot bu-dot" style={farbe(k.farbe)} />
                          <span>{k.name}</span>
                          <small className="num">{zahl(n)}</small>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="bu-pop-sec">
                  <h4>Zahlungsweg</h4>
                  <div className="chips bu-pop-za">
                    <button type="button" className={`chip ${f.zahlungsart === 'alle' ? 'on' : ''}`} onClick={() => setF((x) => ({ ...x, zahlungsart: 'alle' }))}>
                      Alle
                    </button>
                    {ZAHLUNGSWEGE.map((zw) => {
                      const Icon = ZAHLUNGSWEG_ICON[zw.id];
                      return (
                        <button key={zw.id} type="button" className={`chip ${f.zahlungsart === zw.id ? 'on' : ''}`} onClick={() => setF((x) => ({ ...x, zahlungsart: zw.id }))}>
                          <Icon />
                          {zw.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="bu-pop-sec">
                  <label className="toggle-row bu-pop-ob">
                    <span>
                      Nur ohne Beleg (weder Datei noch Belegnummer)
                      <small>{anzahlText(r.ohneBeleg)}</small>
                    </span>
                    <span className="switch">
                      <input type="checkbox" checked={f.ohneBeleg} onChange={(e) => setF((x) => ({ ...x, ohneBeleg: e.target.checked }))} />
                      <span />
                    </span>
                  </label>
                </div>
                <div className="bu-pop-foot">
                  <button type="button" className="link" onClick={() => setF((x) => ({ ...x, kategorien: [], zahlungsart: 'alle', ohneBeleg: false }))}>
                    <RotateCcw />
                    Zurücksetzen
                  </button>
                  <button type="button" className="btn subtle" onClick={() => setPop(false)}>
                    Fertig
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {chips.length ? (
          <div className="bu-active">
            <span className="bu-active-l">Gefiltert:</span>
            {chips}
            {chips.length > 1 ? (
              <button type="button" className="link" onClick={() => {
                setQ('');
                setF((x) => ({ ...x, q: '', kategorien: [], zahlungsart: 'alle', ohneBeleg: false }));
              }}>
                alle entfernen
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card bu-card reveal" style={reveal(2)}>
        <div className="table-wrap">
          <table className="fin-table bu-table">
            <thead>
              <tr>
                <th className="l bu-c-dat">Datum</th>
                <th className="l bu-c-bnr" title="Buchungsnummer, darunter der Beleg (Quittung oder Rechnung aus Kladdy, Nummer eines fremden Belegs oder Datei)">Nr. · Beleg</th>
                <th className="l">Beschreibung</th>
                <th className="l bu-c-kat">Kategorie</th>
                <th className="l bu-c-zw">Zahlungsweg</th>
                <th className="bu-c-amt">Betrag</th>
              </tr>
            </thead>
            <tbody>
              {r.zeilen.length ? (
                r.zeilen.map((b) => <Zeile key={b.id} b={b} q={f.q} />)
              ) : (
                <tr className="bu-empty">
                  <td colSpan={6}>
                    {zeilen.length === 0 ? (
                      <EmptyState icon={CalendarDays} title={`Noch nichts in ${zeitraumLabel}`}>
                        Oben rechts{' '}
                        <span className="bu-erf">
                          <Plus />
                          Erfassen
                        </span>{' '}
                        (⌘N) oder ein Beleg-PDF aufs Fenster ziehen.
                      </EmptyState>
                    ) : (
                      <EmptyState icon={Funnel} title="Kein Eintrag passt zu diesem Filter">
                        Filter lockern oder zurücksetzen.
                        <span className="row">
                          <button type="button" className="btn ghost" onClick={allesZuruecksetzen}>
                            <RotateCcw />
                            Filter zurücksetzen
                          </button>
                        </span>
                      </EmptyState>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {r.zeilen.length ? (
          <p className="bu-foot">
            <span>
              {anzahlText(r.zeilen.length)}
              {r.zeilen.some((b) => sperre(b)) ? (
                <span className="bu-foot-legende">
                  <Lock /> festgeschrieben – ändern nur per Storno
                </span>
              ) : null}
            </span>
            <Summenzeile zeilen={r.zeilen} label={zeitraumLabel} />
          </p>
        ) : null}
      </div>
    </>
  );
}

/* ---------- eine Tabellenzeile ---------- */

function Zeile({ b, q }: { b: BuchungZeile; q: string }) {
  const s = sperre(b);
  const storniert = s === 'storniert';
  const navigate = useNavigate();
  const wer = gegenueber(b);
  const nr = b.belegnummer || b.rechnung_nummer || '';
  const za = b.zahlungsart;
  const ZaIcon = za ? ZAHLUNGSWEG_ICON[za] : null;
  const oeffnen = () => {
    if (!storniert) bearbeiten(b.id);
  };
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      oeffnen();
    }
  };
  let text = b.beschreibung;
  if (wer && text.endsWith(` · ${wer}`)) text = text.slice(0, -(wer.length + 3)); // Name steht in der zweiten Zeile

  return (
    <tr
      className={`row bu-${b.typ} ${storniert ? 'bu-storniert' : ''}`}
      tabIndex={storniert ? undefined : 0}
      onClick={(e) => {
        if (!(e.target as Element).closest('a, button')) oeffnen();
      }}
      onKeyDown={onKey}
    >
      <td className="l bu-dat" title={`${datumLang(b.zahlungsdatum)} · Nr. ${b.nummer}`}>
        {datumTagMonat(b.zahlungsdatum)}
      </td>
      <td className="l bu-nrzelle">
        <span className="bu-bunr" title={`Buchungsnummer ${b.nummer} – auf Papierbelege schreiben, dann findest du beides wieder`}>
          <Hl text={b.nummer} q={q} />
        </span>
        <span className="bu-bnr">
          {nr ? (
            b.rechnung_id != null && b.rechnung_nummer ? (
              <Link className="bu-nr-chip" to={`/belege/${b.rechnung_id}`} title="Beleg öffnen">
                <Hl text={nr} q={q} />
              </Link>
            ) : (
              <span className="bu-nr" title={nr}>
                <Hl text={nr} q={q} />
              </span>
            )
          ) : null}
          {b.belege_anzahl ? (
            <BelegClip buchungId={b.id} anzahl={b.belege_anzahl} />
          ) : fehltBeleg(b) ? (
            <span
              className="badge warn bu-missing"
              title={`Für diesen Eintrag fehlt noch der Beleg. ${b.typ === 'einnahme' ? 'Datei anhängen oder Quittung bzw. Rechnung erstellen.' : 'Datei anhängen oder Eigenbeleg erstellen.'}`}
            >
              Beleg fehlt
            </span>
          ) : null}
          {!nr && !b.belege_anzahl && !fehltBeleg(b) ? <span className="bu-dash">ohne Beleg</span> : null}
        </span>
      </td>
      <td className="l">
        <div className="cell-main">
          <div className="t">
            <b>
              <Hl text={text} q={q} />
            </b>
            {wer ? (
              <small>
                <Hl text={wer} q={q} />
              </small>
            ) : null}
          </div>
          {storniert ? <span className="badge storniert">storniert</span> : null}
        </div>
      </td>
      <td className="l">
        <span className="cat-tag" style={farbe(b.kategorie_farbe)}>
          <i />
          <span className="bu-kat-n">
            <Hl text={b.kategorie_name} q={q} />
          </span>
        </span>
        {b.typ === 'ausgabe' && b.privatanteil_prozent ? <span className="pill bu-pill">{b.privatanteil_prozent} % privat</span> : null}
      </td>
      <td className="l">
        <span className="bu-zw-c" title={zahlungswegName(za)}>
          {ZaIcon ? <ZaIcon /> : <KategorieIcon icon={b.kategorie_icon} />}
          <span>{za ? <Hl text={zahlungswegName(za)} q={q} /> : 'ohne Geldfluss'}</span>
        </span>
      </td>
      <td className="num bu-amt-td">
        <div className="bu-amt-w">
          {storniert ? null : (
            <span className="bu-acts">
              <button
                type="button"
                className="icon-btn sm"
                title={s ? 'Ansehen' : 'Bearbeiten (mit Protokoll)'}
                aria-label={s ? 'Ansehen' : 'Bearbeiten'}
                onClick={() => bearbeiten(b.id)}
              >
                {s ? <Eye /> : <Pencil />}
              </button>
              {b.storno_von_id == null ? (
                <button
                  type="button"
                  className="icon-btn sm"
                  title="Beleg anhängen …"
                  aria-label="Beleg anhängen"
                  onClick={() => void belegAnhaengenDialog({ id: b.id, nummer: b.nummer, typ: b.typ })}
                >
                  <FileUp />
                </button>
              ) : null}
              {quittungNachholbar(b) ? (
                <button
                  type="button"
                  className="icon-btn sm"
                  title={`Quittung aus Kladdy zu ${b.nummer} ausstellen (verknüpft diese Einnahme, bucht nichts doppelt)`}
                  aria-label="Quittung ausstellen"
                  onClick={() => navigate(quittungZuBuchungPfad(b))}
                >
                  <ReceiptText />
                </button>
              ) : null}
              {kannStornieren(b) ? (
                <button
                  type="button"
                  className="icon-btn sm bu-del"
                  title="Stornieren (Gegenbuchung statt Löschen, GoBD)"
                  aria-label="Stornieren"
                  onClick={() => storniereMitNachfrage(b)}
                >
                  <Ban />
                </button>
              ) : null}
              {s === 'beleg' || s === 'festgeschrieben' || s === 'modul' ? (
                <span className="icon-btn sm bu-lock" tabIndex={0} title={s === 'beleg' && b.rechnung_nummer ? `Gehört zu ${b.rechnung_nummer}. ${SPERR_TEXT.beleg}` : SPERR_TEXT[s]}>
                  <Lock />
                </span>
              ) : null}
            </span>
          )}
          {s === 'beleg' ? (
            <span className="bu-lock-ic" title="nur per Storno des Belegs änderbar">
              <Lock />
            </span>
          ) : null}
          <span className={`bu-amt ${b.typ === 'einnahme' ? 'ein' : 'aus'}`} title={storniert ? 'storniert – zählt nicht mehr' : undefined}>
            {betragAnzeige(b)}
          </span>
        </div>
      </td>
    </tr>
  );
}

/** Schlanke Summenzeile unter der Liste (nur Text, keine Kacheln): Zahlungen im gezeigten Ausschnitt. */
function Summenzeile({ zeilen, label }: { zeilen: readonly BuchungZeile[]; label: string }) {
  const s = listenSummen(zeilen);
  return (
    <span className="bu-summen" aria-label={`Summen ${label}`}>
      <span>
        Einnahmen <b className={s.einnahmen ? 'ein' : undefined}>{formatBetrag(s.einnahmen, { vorzeichen: 'immer' })}</b>
      </span>
      <span>
        Ausgaben <b className={s.ausgaben ? 'aus' : undefined}>{formatBetrag(-s.ausgaben, { vorzeichen: 'immer' })}</b>
      </span>
      <span>
        Saldo <b>{formatBetrag(s.saldo, { vorzeichen: 'immer' })}</b>
      </span>
    </span>
  );
}
