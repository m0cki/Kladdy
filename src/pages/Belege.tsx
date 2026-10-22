/* Rechnungen & Quittungen (§6.6): Liste nach laufender Nummer mit genau drei Reitern (Alle · Offen · Bezahlt), Suche,
 * Zeitraum Monat · Jahr · Gesamt nach Belegdatum (Offen und Suche über alle Zeiträume), Status-Menü am Badge, „Vorlagen“
 * und kleinem „Neu“-Menü mit den nächsten Nummern. Keine KPI-Kacheln, unten nur die Anzahl.
 * Optik und Verhalten wie referenz/prototyp/js/pages/belege.js (renderListe); Logik in lib/rechnungen.ts. */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  Blocks,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Handshake,
  Info,
  Paperclip,
  Printer,
  Receipt,
  Search,
  Stamp,
  type LucideIcon,
} from 'lucide-react';
import { pdfOeffnenFuer } from '../lib/belegaktionen';
import { anzahlText } from '../lib/buchungen';
import { erfassen } from '../lib/erfassen';
import { naechsteNummer } from '../lib/numbering';
import { ladeNummernkreise } from '../lib/queries/nummernkreise';
import { ladeBelege } from '../lib/queries/rechnungen';
import {
  ART_NAME,
  LISTEN_ZEITRAEUME,
  REITER,
  SORT_START,
  faelligText,
  filtere,
  listenBetrag,
  listenZeitraum,
  statusSchluessel,
  type BelegZeile,
  type ListenArt,
  type ListenZeitraumModus,
  type Reiter,
  type SortFeld,
  type Sortierung,
} from '../lib/rechnungen';
import { heute as heuteIso, verschiebe } from '../lib/zeitraum';
import type { Belegart } from '../lib/vorlagen/dokument';
import { useUi } from '../store/ui';
import { EmptyState } from '../components/ui/EmptyState';
import { reveal } from '../components/ui/PageHead';
import { Seg } from '../components/ui/Seg';
import { StatusKnopf, statusAktionAusfuehren } from '../components/belege/BelegStatus';
import { Ladeansicht, useLaden } from './einstellungen/Laden';

export const ART_SYMBOL: Readonly<Record<ListenArt, LucideIcon>> = {
  rechnung: FileText,
  quittung: Receipt,
  angebot: Handshake,
  eigenbeleg: Stamp,
  storno: FileText,
};

const zahl = (n: number) => new Intl.NumberFormat('de-DE').format(n);

/* Reiter, Zeitraum und Sortierung überleben den Seitenwechsel (Modulvariablen wie im Prototyp); der Zeitraum beginnt
 * bei jedem Start mit dem aktuellen Monat */
let gemerkt: { reiter: Reiter; sortierung: Sortierung; modus: ListenZeitraumModus; anker: string } = {
  reiter: 'alle',
  sortierung: { feld: 'nr', richtung: -1 },
  modus: 'monat',
  anker: heuteIso(),
};

type Daten = { zeilen: BelegZeile[]; naechste: Partial<Record<Belegart, string>> };

export default function Belege() {
  const datenStand = useUi((s) => s.datenStand);
  const laden = useCallback(async (): Promise<Daten> => {
    void datenStand; // nach jedem Schreibvorgang neu laden
    const [zeilen, kreise] = await Promise.all([ladeBelege(), ladeNummernkreise()]);
    const jahr = Number(heuteIso().slice(0, 4));
    const naechste: Partial<Record<Belegart, string>> = {};
    for (const k of kreise) {
      if (k.id === 'rechnung' || k.id === 'quittung' || k.id === 'angebot' || k.id === 'eigenbeleg') {
        try {
          naechste[k.id] = naechsteNummer(k, Math.max(jahr, k.jahr)).nummer;
        } catch {
          /* kaputtes Muster: dann ohne Vorschau */
        }
      }
    }
    return { zeilen, naechste };
  }, [datenStand]);
  const { zustand, erneut } = useLaden(laden);

  return zustand.status === 'ok' ? (
    <Liste zeilen={zustand.daten.zeilen} naechste={zustand.daten.naechste} />
  ) : (
    <div className="page bl-list">
      <Kopf naechste={{}} zeitraum={null} />
      <Ladeansicht zustand={zustand} icon={FileText} was="Rechnungen und Quittungen" erneut={erneut} />
    </div>
  );
}

/* ---------- Seitenkopf mit Zeitraum, „Vorlagen“ und „Neu“-Menü ---------- */

interface ZeitraumSteuerung {
  modus: ListenZeitraumModus;
  label: string;
  aus: boolean;
  hinweis: string;
  zurueck: boolean;
  vor: boolean;
  setModus: (m: ListenZeitraumModus) => void;
  blaettern: (r: -1 | 1) => void;
}

const NEU: readonly { art: Belegart; sub: string }[] = [
  { art: 'quittung', sub: 'Einnahme mit Quittung erfassen' },
  { art: 'rechnung', sub: 'Einnahme erfassen – bezahlt oder offen' },
  { art: 'angebot', sub: 'Für einen Kunden – noch keine Einnahme' },
  { art: 'eigenbeleg', sub: 'Originalbeleg einer Ausgabe fehlt' },
];

function NeuMenue({ naechste }: { naechste: Partial<Record<Belegart, string>> }) {
  const [offen, setOffen] = useState(false);
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const knopf = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!offen) return;
    box.current?.querySelector<HTMLButtonElement>('.bl-mi')?.focus({ preventScroll: true });
    const maus = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOffen(false);
    };
    const taste = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOffen(false);
        knopf.current?.focus();
      }
    };
    document.addEventListener('mousedown', maus);
    window.addEventListener('keydown', taste, true);
    return () => {
      document.removeEventListener('mousedown', maus);
      window.removeEventListener('keydown', taste, true);
    };
  }, [offen]);

  const waehle = (art: Belegart) => {
    setOffen(false);
    navigate(`/belege/neu?art=${art}`);
  };

  const tasten = (e: KeyboardEvent<HTMLDivElement>) => {
    const liste = [...(box.current?.querySelectorAll<HTMLButtonElement>('.bl-mi') ?? [])];
    const i = liste.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (liste.length) liste[(i + (e.key === 'ArrowDown' ? 1 : liste.length - 1)) % liste.length].focus();
    } else if (e.key === 'Tab') setOffen(false);
  };

  return (
    <div ref={box} className={`bl-neu ${offen ? 'open' : ''}`} onKeyDown={tasten}>
      <button
        ref={knopf}
        type="button"
        className="btn ghost bl-neu-btn"
        aria-haspopup="menu"
        aria-expanded={offen}
        title="Neuer Beleg mit der nächsten laufenden Nummer"
        onClick={() => setOffen((o) => !o)}
      >
        Neu
        <ChevronDown />
      </button>
      <div className="bl-menu" role="menu" aria-label="Neuer Beleg">
        <div className="bl-menu-head">Nächste Nummer</div>
        {NEU.map(({ art, sub }, i) => {
          const Icon = ART_SYMBOL[art];
          return (
            <div key={art}>
              {i === 2 ? <div className="bl-menu-sep" role="separator" /> : null}
              <button type="button" className="bl-mi" role="menuitem" tabIndex={-1} onClick={() => waehle(art)}>
                <Icon />
                <span>
                  <b>{ART_NAME[art]}</b>
                  <small>{sub}</small>
                </span>
                {naechste[art] ? <code>{naechste[art]}</code> : <span />}
              </button>
            </div>
          );
        })}
        <p className="bl-menu-foot">
          <Info />
          <span>Einnahmen ohne eigenen Beleg erfasst du über „+ Erfassen“ bei Ein- &amp; Ausgänge (⌘N).</span>
        </p>
      </div>
    </div>
  );
}

function Kopf({ naechste, zeitraum }: { naechste: Partial<Record<Belegart, string>>; zeitraum: ZeitraumSteuerung | null }) {
  return (
    <div className="page-head reveal" style={reveal(0)}>
      <div>
        <h1>
          <FileText />
          Rechnungen &amp; Quittungen
        </h1>
        <p className="page-sub">Alle Belege mit laufender Nummer · es zählt das Belegdatum</p>
      </div>
      <div className="page-actions">
        {zeitraum ? (
          <div className={`period bl-zr ${zeitraum.aus ? 'aus' : ''}`} title={zeitraum.aus ? zeitraum.hinweis : undefined}>
            <Seg options={LISTEN_ZEITRAEUME} value={zeitraum.modus} onChange={zeitraum.setModus} ariaLabel="Zeitraum" />
            {zeitraum.modus !== 'gesamt' ? (
              <div className="period-nav">
                <button type="button" className="icon-btn sm" title="Vorheriger Zeitraum" aria-label="Vorheriger Zeitraum" disabled={!zeitraum.zurueck} onClick={() => zeitraum.blaettern(-1)}>
                  <ChevronLeft />
                </button>
                <b aria-live="polite">{zeitraum.label}</b>
                <button type="button" className="icon-btn sm" title="Nächster Zeitraum" aria-label="Nächster Zeitraum" disabled={!zeitraum.vor} onClick={() => zeitraum.blaettern(1)}>
                  <ChevronRight />
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        <Link className="btn ghost" to="/belege/vorlagen" title="Quittung & Rechnung aus Bausteinen gestalten">
          <Blocks />
          Vorlagen
        </Link>
        <NeuMenue naechste={naechste} />
      </div>
    </div>
  );
}

/* ---------- Liste ---------- */

const SPALTEN: readonly { feld: SortFeld | null; label: string; klasse: string }[] = [
  { feld: 'nr', label: 'Nr.', klasse: 'l' },
  { feld: null, label: 'Art', klasse: 'l' },
  { feld: 'kunde', label: 'Kunde', klasse: 'l' },
  { feld: null, label: 'Betreff', klasse: 'l bl-c-betreff' },
  { feld: 'datum', label: 'Datum', klasse: '' },
  { feld: 'faellig', label: 'Fällig / Zahlung', klasse: 'l' },
  { feld: 'betrag', label: 'Betrag', klasse: '' },
];

function Liste({ zeilen, naechste }: { zeilen: BelegZeile[]; naechste: Partial<Record<Belegart, string>> }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const h = heuteIso();
  const [reiter, setReiter] = useState<Reiter>(gemerkt.reiter);
  const [sortierung, setSortierung] = useState<Sortierung>(gemerkt.sortierung);
  const [modus, setModus] = useState<ListenZeitraumModus>(gemerkt.modus);
  const [anker, setAnker] = useState(gemerkt.anker);
  const [q, setQ] = useState('');

  // „Offen“ sortiert nach Fälligkeit (älteste überfällige zuerst), die anderen nach Nummer
  const waehleReiter = (r: Reiter) => {
    setReiter(r);
    if (r === 'offen') setSortierung({ feld: 'faellig', richtung: 1 });
    else setSortierung((s) => (s.feld === 'faellig' ? { feld: 'nr', richtung: -1 } : s));
  };

  // Adresse ?reiter=offen (Sprung aus der Auswertung bzw. der Seitenleiste) – übernehmen und wieder leeren
  useEffect(() => {
    const r = params.get('reiter');
    if (r === 'alle' || r === 'offen' || r === 'bezahlt') {
      waehleReiter(r);
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur bei neuer Adresse
  }, [params]);

  useEffect(() => {
    gemerkt = { reiter, sortierung, modus, anker };
  }, [reiter, sortierung, modus, anker]);

  const zr = listenZeitraum(modus, anker);
  const r = useMemo(() => filtere(zeilen, { reiter, q, zeitraum: zr, sortierung, heute: h }), [zeilen, reiter, q, zr?.von, zr?.bis, sortierung, h]); // eslint-disable-line react-hooks/exhaustive-deps
  const erster = zeilen.reduce((m, z) => (z.datum && z.datum < m ? z.datum : m), h);
  const letzter = zeilen.reduce((m, z) => (z.datum && z.datum > m ? z.datum : m), h);
  const zeitraum: ZeitraumSteuerung = {
    modus,
    label: zr?.label ?? 'Gesamt',
    aus: r.ohneZeitraum,
    hinweis: q.trim() ? 'Suche über alle Zeiträume' : 'alle offenen, unabhängig vom Zeitraum',
    zurueck: !!zr && zr.von > erster,
    vor: !!zr && modus !== 'gesamt' && verschiebe(modus, anker, 1) <= letzter,
    setModus: (m) => {
      setModus(m);
      if (m !== 'gesamt') setAnker(h);
    },
    blaettern: (richtung) => {
      if (modus !== 'gesamt') setAnker(verschiebe(modus, anker, richtung));
    },
  };

  const sortiere = (feld: SortFeld) =>
    setSortierung((s) => (s.feld === feld ? { feld, richtung: s.richtung === 1 ? -1 : 1 } : { feld, richtung: SORT_START[feld] }));

  const leer = () => {
    if (q.trim()) return <EmptyState icon={Search} title="Nichts gefunden">{`Keine Belege zu „${q.trim()}“ – in keinem Zeitraum.`}</EmptyState>;
    if (reiter === 'offen')
      return (
        <EmptyState icon={Check} title="Nichts offen">
          Alle Rechnungen bezahlt, nichts für Termine vorbereitet.
        </EmptyState>
      );
    if (zr)
      return (
        <EmptyState icon={FileText} title={`${modus === 'jahr' ? 'Im Jahr' : 'Im'} ${zr.label} ${reiter === 'bezahlt' ? 'nichts bezahlt' : 'keine Belege'}`}>
          <button type="button" className="link" onClick={() => zeitraum.setModus('gesamt')}>
            Gesamt anzeigen
            <ArrowRight />
          </button>
        </EmptyState>
      );
    return (
      <EmptyState icon={FileText} title={reiter === 'bezahlt' ? 'Noch nichts bezahlt' : 'Noch keine Belege'}>
        Quittungen und Rechnungen entstehen über „Neu“ oder beim Erfassen einer Einnahme.
      </EmptyState>
    );
  };

  const nOffen = r.zeilen.length;
  const fussText = q.trim()
    ? `${zahl(nOffen)} ${nOffen === 1 ? 'Treffer' : 'Treffer'} · alle Zeiträume`
    : reiter === 'offen'
      ? `${anzahlText(nOffen, 'offener Beleg', 'offene Belege')}${r.ueberfaellig ? ` · ${zahl(r.ueberfaellig)} überfällig` : ''} · unabhängig vom Zeitraum`
      : `${anzahlText(nOffen, 'Beleg', 'Belege')} · ${zr ? zr.label : 'alle Zeiträume'}`;

  return (
    <div className="page bl-list">
      <Kopf naechste={naechste} zeitraum={zeitraum} />
      <section className="card flush bl-tablecard reveal" style={reveal(1)}>
        <div className="bl-tabs">
          <div className="bl-tabsl">
            <Seg
              className="tabs"
              ariaLabel="Belege filtern"
              value={reiter}
              onChange={waehleReiter}
              options={REITER.map((t) => ({
                value: t.value,
                label: (
                  <>
                    {t.label}
                    <span className={`cnt ${t.value === 'offen' && r.ueberfaellig ? 'alarm' : ''}`} title={t.value === 'offen' && r.ueberfaellig ? `${r.ueberfaellig} überfällig` : undefined}>
                      {zahl(r.reiter[t.value])}
                    </span>
                  </>
                ),
              }))}
            />
            {r.ohneZeitraum ? (
              <span className="bl-zrhint">
                <Info />
                {zeitraum.hinweis}
              </span>
            ) : null}
          </div>
          <label className="bl-filter">
            <Search />
            <input
              className="input sm"
              type="search"
              value={q}
              placeholder="Nr., Kunde, Betreff, Betrag …"
              aria-label="Belege filtern"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && q) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQ('');
                }
              }}
            />
          </label>
        </div>
        <div className="table-wrap">
          <table className="fin-table bl-table">
            <thead>
              <tr>
                {SPALTEN.map((s) =>
                  s.feld ? (
                    <th
                      key={s.label}
                      className={`${s.klasse} sortable ${sortierung.feld === s.feld ? 'on' : ''}`}
                      data-dir={sortierung.feld === s.feld ? (sortierung.richtung < 0 ? '↓' : '↑') : ''}
                      aria-sort={sortierung.feld === s.feld ? (sortierung.richtung < 0 ? 'descending' : 'ascending') : undefined}
                      onClick={() => sortiere(s.feld as SortFeld)}
                    >
                      {s.label}
                    </th>
                  ) : (
                    <th key={s.label} className={s.klasse}>
                      {s.label}
                    </th>
                  ),
                )}
                <th className="c">Status</th>
                <th className="bl-c-acts" />
              </tr>
            </thead>
            <tbody>
              {r.zeilen.length ? (
                r.zeilen.map((z) => (
                  <Zeile
                    key={z.id}
                    z={z}
                    heute={h}
                    oeffnen={() => navigate(`/belege/${z.id}`)}
                    aktion={(a) => statusAktionAusfuehren(a, z, navigate)}
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={9}>{leer()}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="bl-tfoot">
          <span>{fussText}</span>
        </div>
      </section>
      {/* der Erfassen-Weg bleibt der eine: Einnahmen ohne eigenen Beleg über „+ Erfassen“ */}
      <p className="hint bl-erfassen-hint reveal" style={reveal(2)}>
        <Info />
        Zahlungen ohne eigenen Beleg (z. B. Plattform-Auszahlungen) über{' '}
        <button type="button" className="link" onClick={() => erfassen({ typ: 'einnahme' })}>
          + Erfassen
        </button>
        .
      </p>
    </div>
  );
}

function Zeile({ z, heute, oeffnen, aktion }: { z: BelegZeile; heute: string; oeffnen: () => void; aktion: Parameters<typeof StatusKnopf>[0]['onAktion'] }) {
  const Icon = ART_SYMBOL[z.art];
  const f = faelligText(z, heute);
  const s = statusSchluessel(z, heute);
  const kunde = z.kunde_name || (z.art === 'quittung' && z.nummer ? 'Barverkauf' : '—');
  const offen = z.art === 'rechnung' && z.status === 'offen' && z.nummer;
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      oeffnen();
    }
  };
  return (
    <tr
      className={`row ${z.status === 'storniert' && z.art !== 'storno' ? 'is-storno' : ''} ${s === 'ueberfaellig' ? 'is-ueber' : ''}`}
      tabIndex={0}
      onClick={(e) => {
        if (!(e.target as Element).closest('a, button')) oeffnen();
      }}
      onKeyDown={onKey}
    >
      <td className="l bl-nr">
        <Link to={`/belege/${z.id}`} className={z.nummer ? '' : 'bl-draftnr'}>
          {z.nummer ?? (z.termin_id != null ? 'Vorbereitet' : 'Entwurf')}
        </Link>
        {z.scan_beleg_id != null ? (
          <span className="bl-clip" title="Unterschriebenes Exemplar angehängt">
            <Paperclip />
          </span>
        ) : null}
      </td>
      <td className="l bl-artc">
        <span className="bl-art" title={ART_NAME[z.art]}>
          <Icon />
          <span>{ART_NAME[z.art]}</span>
        </span>
      </td>
      <td className="l bl-kunde">
        {kunde}
        {z.betreff ? <small className="bl-sub2">{z.betreff}</small> : null}
      </td>
      <td className="l bl-betreff">{z.betreff || '—'}</td>
      <td className="num">{z.datum ? `${z.datum.slice(8, 10)}.${z.datum.slice(5, 7)}.${z.datum.slice(0, 4)}` : '—'}</td>
      <td className="l bl-due">
        <span className={f.klasse ? `${f.klasse}-t` : ''} title={f.titel}>
          {f.text}
        </span>
      </td>
      <td className="num bl-amt">{listenBetrag(z)}</td>
      <td className="c">
        <StatusKnopf z={z} heute={heute} onAktion={aktion} />
      </td>
      <td className="bl-acts">
        <div className="row-acts">
          {offen ? (
            <button type="button" className="icon-btn sm ok" title="Als bezahlt markieren …" aria-label="Als bezahlt markieren" onClick={() => aktion('bezahlt')}>
              <Check />
            </button>
          ) : null}
          {z.nummer ? (
            <button type="button" className="icon-btn sm" title="PDF öffnen (drucken, sichern)" aria-label="PDF öffnen" onClick={() => void pdfOeffnenFuer(z.id)}>
              <Printer />
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
