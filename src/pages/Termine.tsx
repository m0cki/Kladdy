/* Termine (§6.5, Prototyp termine.js): ruhige Agenda nach Tagen in einer Karte – Filter Anstehend · Erledigt · Alle (mit
 * Zählern), Wochenstreifen (diese und nächste Woche, ein Punkt je Termin; Klick springt zum Tag), oben „Nachtragen“
 * (vorbei, aber nicht abgehakt bzw. erledigt ohne Beleg). Je Termin: Uhrzeit, Kunde (öffnet die Kunden-Schublade),
 * Leistung, Adresse (Apple Karten), Betrag („ca.“ geschätzt bzw. laut Beleg), Beleg-Chip und Aktionen – „✓ Erledigt“ (nur
 * heute und Vergangenes), „Quittung ausstellen“ (die eine Erfassen-Schublade), „⋯“ (Bearbeiten, Quittung vorbereiten,
 * Absagen, Ohne Beleg abschließen, Doch nicht erledigt). Keine Statistik. Klick auf die Zeile öffnet die Termin-Schublade.
 * Adresse: ?t=<id> öffnet den Termin (Suche ⌘K, Beleg-Maske), ?neu=1[&kunde=<id>][&datum=…] einen neuen (Befehlspalette);
 * danach wird sie geleert. Logik in lib/termine.ts, Aktionen in lib/termin-aktionen.ts. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeftRight,
  CalendarDays,
  Check,
  Ellipsis,
  FileText,
  MapPin,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  StickyNote,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { datumTagMonat } from '../lib/buchungen';
import { bearbeiten } from '../lib/erfassen';
import type { ErtragsArt } from '../lib/ertrag';
import { fehlerText } from '../lib/fehler';
import { kundeOeffnen } from '../lib/kunden-schublade';
import { linkOeffnen } from '../lib/queries/kunden';
import { ladeTerminEinstellungen, ladeTermine, type TerminStamm } from '../lib/queries/termine';
import { abhaken, belegAusstellen, einnahmeOeffnen, nichtErledigt, ohneBelegAbschliessen, vorbereiten } from '../lib/termin-aktionen';
import { terminAbsagenFragen, terminFlash, terminNeu, terminOeffnen, useTerminSchublade } from '../lib/termin-schublade';
import {
  FILTER,
  adresseEinzeilig,
  ausstellArt,
  ausstellLabel,
  betragAnzeige,
  betragKurz,
  chip,
  filterZaehler,
  gruppen,
  kartenUrl,
  knoepfe,
  menue,
  nachtragenText,
  punktArt,
  sichtbar,
  tagKopf,
  tagLang,
  wocheZeigen,
  wochenStreifen,
  wochentagKurz,
  zeilenStatus,
  type MenueEintrag,
  type Termin,
  type TerminAktion,
  type TerminFilter,
} from '../lib/termine';
import { heute } from '../lib/zeitraum';
import { useUi } from '../store/ui';
import { Monogramm } from '../components/kunden/Monogramm';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHead, reveal } from '../components/ui/PageHead';
import { Seg } from '../components/ui/Seg';
import { Ladeansicht, useLaden } from './einstellungen/Laden';

type Einstellungen = Pick<TerminStamm, 'belegArt' | 'zielTage' | 'vorlagen'>;

// Filter überlebt den Seitenwechsel (wie im Prototyp)
let gemerkt: TerminFilter = 'anstehend';

const zahlParam = (v: string | null): number | undefined => (v && /^\d+$/.test(v) ? Number(v) : undefined);

const warnen = (e: unknown) => useUi.getState().showToast({ text: fehlerText(e), icon: 'warn', sticky: true });

export default function Termine() {
  const datenStand = useUi((s) => s.datenStand);
  const laden = useCallback(async () => {
    void datenStand; // nach jedem Schreibvorgang neu laden
    const [termine, einstellungen] = await Promise.all([ladeTermine(), ladeTerminEinstellungen()]);
    return { termine, einstellungen };
  }, [datenStand]);
  const { zustand, erneut } = useLaden(laden);
  const [filter, setFilterWert] = useState<TerminFilter>(gemerkt);
  const setFilter = useCallback((f: TerminFilter) => {
    gemerkt = f;
    setFilterWert(f);
  }, []);

  // Direktlinks ?t=<id> bzw. ?neu=1 – erst nach dem Laden (sonst schließt der Seitenwechsel die Schublade gleich wieder)
  const [params, setParams] = useSearchParams();
  const daten = zustand.status === 'ok' ? zustand.daten : null;
  useEffect(() => {
    if (!daten) return;
    const t = zahlParam(params.get('t'));
    const neu = params.get('neu') === '1';
    if (t == null && !neu) return;
    const kunde = zahlParam(params.get('kunde'));
    const datum = params.get('datum') ?? undefined;
    setParams({}, { replace: true });
    if (neu) {
      terminNeu({ kunde, datum });
      return;
    }
    const ziel = daten.termine.find((x) => x.id === t);
    if (!ziel || t == null) {
      useUi.getState().showToast({ text: 'Diesen Termin gibt es nicht (mehr).', icon: 'warn' });
      return;
    }
    if (!sichtbar(ziel, filter, heute())) setFilter('alle');
    terminOeffnen(t);
    terminFlash(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur bei neuer Adresse bzw. nach dem Laden
  }, [params, daten !== null]);

  return (
    <div className="page tm-page">
      <PageHead
        icon={CalendarDays}
        title="Termine"
        sub="Kundentermine – auf Wunsch mit vorbereiteter Quittung"
        actions={
          <button type="button" className="btn-primary head-add" onClick={() => terminNeu()}>
            <Plus />
            Termin eintragen
          </button>
        }
      />
      {daten ? (
        <Agenda termine={daten.termine} einstellungen={daten.einstellungen} filter={filter} setFilter={setFilter} />
      ) : (
        <Ladeansicht zustand={zustand} icon={CalendarDays} was="Termine" erneut={erneut} />
      )}
    </div>
  );
}

/* ================= Agenda ================= */

function Agenda({
  termine,
  einstellungen,
  filter,
  setFilter,
}: {
  termine: Termin[];
  einstellungen: Einstellungen;
  filter: TerminFilter;
  setFilter: (f: TerminFilter) => void;
}) {
  const navigate = useNavigate();
  const h = heute();
  const standard = einstellungen.belegArt;
  const agendaRef = useRef<HTMLDivElement>(null);
  const zaehler = useMemo(() => filterZaehler(termine, h), [termine, h]);
  const g = useMemo(() => gruppen(termine, filter, h), [termine, filter, h]);
  const wochen = useMemo(() => wochenStreifen(termine, h), [termine, h]);
  const [menueAuf, setMenueAuf] = useState<{ t: Termin; anker: HTMLElement } | null>(null);
  const menueZu = useCallback(() => setMenueAuf(null), []);
  // neue Daten (nach einer Aktion): ein offenes Menü zeigt sonst den alten Stand
  useEffect(() => setMenueAuf(null), [termine]);

  // ausgewählt = der Termin in der offenen Schublade
  const schubladeOffen = useUi((s) => s.drawer === 'termin');
  const auftrag = useTerminSchublade((s) => s.auftrag);
  const ausgewaehlt = schubladeOffen && auftrag && auftrag.art !== 'neu' ? auftrag.id : null;

  // nach einer Aktion kurz hervorheben und (falls außer Sicht) hinscrollen
  const flash = useTerminSchublade((s) => s.flash);
  const [blink, setBlink] = useState<number | null>(null);
  const gescrollt = useRef(0);
  useEffect(() => {
    if (!flash || Date.now() - flash.zeit > 3000) return; // nur frische Aktionen, nicht beim späteren Öffnen der Seite
    setBlink(flash.id);
    const tm = setTimeout(() => setBlink(null), 2400);
    return () => clearTimeout(tm);
  }, [flash]);
  useEffect(() => {
    if (!flash || gescrollt.current === flash.n || Date.now() - flash.zeit > 5000) return;
    const el = agendaRef.current?.querySelector<HTMLElement>(`.tm-item[data-t="${flash.id}"]`);
    if (!el) return;
    gescrollt.current = flash.n;
    const r = el.getBoundingClientRect();
    if (r.top < 120 || r.bottom > innerHeight - 20) el.scrollIntoView({ block: 'center', behavior: useUi.getState().settings.motion === 'full' ? 'smooth' : 'auto' });
  }, [flash, termine, filter]);

  // Klick auf einen Tag im Wochenstreifen: zur Tagesgruppe springen (steht er nicht im Filter, auf „Alle“ wechseln)
  const [sprung, setSprung] = useState<{ datum: string; n: number } | null>(null);
  useEffect(() => {
    if (!sprung) return;
    const a = agendaRef.current;
    const gruppe = a?.querySelector<HTMLElement>(`#tm-d-${sprung.datum}`);
    const ziel = gruppe?.querySelector('.tm-item') ? gruppe : (a?.querySelector<HTMLElement>(`.tm-item[data-d="${sprung.datum}"]`) ?? null);
    if (!ziel) {
      if (filter !== 'alle') setFilter('alle');
      else setSprung(null);
      return;
    }
    ziel.scrollIntoView({ block: 'start', behavior: useUi.getState().settings.motion === 'full' ? 'smooth' : 'auto' });
    const kopf = ziel.matches('.tm-tag') ? ziel.querySelector<HTMLElement>('.tm-tag-h') : ziel;
    if (kopf) {
      kopf.classList.remove('tm-ping');
      void kopf.offsetWidth;
      kopf.classList.add('tm-ping');
    }
    setSprung(null);
  }, [sprung, filter, setFilter]);

  const aktion = (a: TerminAktion, t: Termin) => {
    if (a === 'bearbeiten') terminOeffnen(t.id);
    else if (a === 'wieder') terminOeffnen(t.id, true);
    else if (a === 'absagen') terminAbsagenFragen(t.id);
    else if (a === 'abhaken') void abhaken(t, standard);
    else if (a === 'ausstellen' || a === 'mitbeleg') belegAusstellen(t, standard);
    else if (a === 'ohne') void ohneBelegAbschliessen(t);
    else if (a === 'nichterledigt') void nichtErledigt(t);
    else if (a === 'einnahme') einnahmeOeffnen(t);
    else if (a === 'vorbereiten') void vorbereiten(t, einstellungen, (id) => navigate(`/belege/${id}`));
  };

  // Pfeiltasten zwischen den Zeilen, Enter/Leertaste öffnet
  const tasten = (e: ReactKeyboardEvent<HTMLLIElement>, t: Termin) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      terminOeffnen(t.id);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const liste = [...(agendaRef.current?.querySelectorAll<HTMLElement>('.tm-item[data-t]') ?? [])];
      const i = liste.indexOf(e.currentTarget);
      liste[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  };

  const zeile = (t: Termin, mitDatum = false) => (
    <Zeile
      key={t.id}
      t={t}
      h={h}
      standard={standard}
      mitDatum={mitDatum}
      ausgewaehlt={ausgewaehlt === t.id}
      blink={blink === t.id}
      menueOffen={menueAuf?.t.id === t.id}
      onTasten={tasten}
      onAktion={aktion}
      onMenue={(anker) => setMenueAuf((m) => (m?.t.id === t.id ? null : { t, anker }))}
    />
  );

  const leer = !g.some((x) => x.typ !== 'trenner' && x.items.length);

  return (
    <section className="card flush tm-liste reveal" style={reveal(1)}>
      <div className="tm-bar">
        <Seg<TerminFilter>
          ariaLabel="Termine filtern"
          value={filter}
          onChange={(f) => {
            setMenueAuf(null);
            setFilter(f);
          }}
          options={FILTER.map((f) => ({
            value: f.value,
            label: (
              <>
                {f.label} <span className="cnt">{zaehler[f.value]}</span>
              </>
            ),
          }))}
        />
      </div>
      {wocheZeigen(termine, filter, h) ? (
        <div className="tm-woche">
          {wochen.map((w) => (
            <div key={w.label} className="tm-wo">
              <div className="tm-wo-h">
                {w.label}
                <span>KW {w.kw}</span>
              </div>
              <div className="tm-wo-d">
                {w.tage.map((d) => {
                  const n = d.termine.length;
                  const titel = d.termine.map((t) => `${t.von ?? ''} ${t.kunde_name ?? ''}${t.status === 'erledigt' ? ' ✓' : ''}`.trim()).join(' · ');
                  return (
                    <button
                      key={d.datum}
                      type="button"
                      className={`tm-d ${d.heute ? 'heute' : ''} ${d.vorbei ? 'vorbei' : ''} ${n ? '' : 'frei'} ${d.wochenende ? 'we' : ''}`}
                      aria-label={`${tagLang(d.datum, h)}: ${n} ${n === 1 ? 'Termin' : 'Termine'}`}
                      title={n ? `${tagLang(d.datum, h)} – ${titel}` : undefined}
                      tabIndex={n ? 0 : -1}
                      aria-disabled={n ? undefined : true}
                      onClick={() => {
                        if (n) setSprung({ datum: d.datum, n: Date.now() });
                      }}
                    >
                      <small>{wochentagKurz(d.datum)}</small>
                      <b>{Number(d.datum.slice(8, 10))}</b>
                      <span className="tm-dots">
                        {d.termine.slice(0, 4).map((t) => (
                          <i key={t.id} className={punktArt(t, h)} />
                        ))}
                        {n > 4 ? <em>+{n - 4}</em> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="tm-agenda" ref={agendaRef}>
        {leer ? (
          <Leer filter={filter} />
        ) : (
          g.map((gr) => {
            if (gr.typ === 'trenner') {
              return (
                <div key={`trenner-${gr.text}`} className="tm-trenner" role="separator">
                  <span>{gr.text}</span>
                </div>
              );
            }
            if (gr.typ === 'nachtragen') {
              return (
                <section key="nachtragen" className="tm-tag tm-nach" id="tm-nachtragen" aria-label="Nachtragen">
                  <h3 className="tm-tag-h">
                    <TriangleAlert />
                    <b>Nachtragen</b>
                    <span>· {nachtragenText(gr.items, h)}</span>
                  </h3>
                  <ul className="tm-items">{gr.items.map((t) => zeile(t, true))}</ul>
                </section>
              );
            }
            const k = tagKopf(gr.datum, h);
            return (
              <section key={gr.datum} className={`tm-tag ${gr.datum === h ? 'heute' : ''}`} id={`tm-d-${gr.datum}`}>
                <h3 className="tm-tag-h">
                  <b>{k.titel}</b>
                  <span>{k.zusatz}</span>
                </h3>
                <ul className="tm-items">{gr.items.length ? gr.items.map((t) => zeile(t)) : <li className="tm-frei">Heute keine Termine.</li>}</ul>
              </section>
            );
          })
        )}
      </div>
      {menueAuf ? (
        <MehrMenue
          anker={menueAuf.anker}
          punkte={menue(menueAuf.t, h, standard)}
          titel={`Termin ${menueAuf.t.kunde_name ?? ''}`.trim()}
          onZu={menueZu}
          onWahl={(a) => {
            const t = menueAuf.t;
            setMenueAuf(null);
            aktion(a, t);
          }}
        />
      ) : null}
    </section>
  );
}

function Leer({ filter }: { filter: TerminFilter }) {
  if (filter === 'erledigt') {
    return (
      <div className="tm-leer">
        <EmptyState icon={Check} title="Noch keine erledigten Termine">
          Hak Termine mit „✓ Erledigt“ ab – sie stehen dann hier, die Quittung stellst du danach aus.
        </EmptyState>
      </div>
    );
  }
  const alle = filter === 'alle';
  return (
    <div className="tm-leer">
      <EmptyState icon={CalendarDays} title={alle ? 'Noch keine Termine' : 'Keine anstehenden Termine'}>
        {alle ? 'Trag deinen ersten Kundentermin ein' : 'Trag den nächsten Kundentermin ein'} – auf Wunsch gleich mit vorbereiteter Quittung.
      </EmptyState>
      <div className="row tm-leer-row">
        <button type="button" className="btn ghost" onClick={() => terminNeu()}>
          <Plus />
          Termin eintragen
        </button>
      </div>
    </div>
  );
}

/* ================= Zeile ================= */

const ART_ICON: Readonly<Record<ErtragsArt, LucideIcon>> = { quittung: Receipt, rechnung: FileText };

function Zeile({
  t,
  h,
  standard,
  mitDatum,
  ausgewaehlt,
  blink,
  menueOffen,
  onTasten,
  onAktion,
  onMenue,
}: {
  t: Termin;
  h: string;
  standard: ErtragsArt;
  mitDatum: boolean;
  ausgewaehlt: boolean;
  blink: boolean;
  menueOffen: boolean;
  onTasten: (e: ReactKeyboardEvent<HTMLLIElement>, t: Termin) => void;
  onAktion: (a: TerminAktion, t: Termin) => void;
  onMenue: (anker: HTMLElement) => void;
}) {
  const name = t.kunde_name || 'ohne Kunde';
  const kundeId = t.kunde_id;
  // Notiz des Termins und des Kunden als Symbol mit Tooltip
  const notizen: [string, string][] = [];
  if (t.notiz?.trim()) notizen.push(['Termin', t.notiz.trim().split('\n').join(' · ')]);
  if (t.kunde_notiz?.trim()) notizen.push(['Kunde', t.kunde_notiz.trim()]);
  const notizText = notizen.map(([was, text]) => (notizen.length > 1 ? `${was}: ${text}` : text)).join(' · ');
  const notizTitel = notizen.length > 1 ? 'Notizen' : notizen[0]?.[0] === 'Kunde' ? 'Notiz zum Kunden' : 'Notiz';
  const adresse = adresseEinzeilig(t.adresse);
  const karte = kartenUrl(t.adresse);
  const b = betragAnzeige(t);
  const k = knoepfe(t, h);
  const art = ausstellArt(t, standard);
  const ArtIcon = ART_ICON[art];

  return (
    <li
      className={`tm-item s-${zeilenStatus(t, h)} ${ausgewaehlt ? 'selected' : ''} ${blink ? 'tm-flash' : ''}`}
      data-t={t.id}
      data-d={t.datum}
      tabIndex={0}
      onKeyDown={(e) => onTasten(e, t)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, button, .tm-ntz')) return; // Links, Knöpfe und Notiz nicht abfangen
        terminOeffnen(t.id);
      }}
    >
      <div className="tm-zeit">
        {mitDatum ? (
          <small>
            {wochentagKurz(t.datum)} {datumTagMonat(t.datum)}
          </small>
        ) : null}
        <b>{t.von ?? '–'}</b>
        <span>{t.bis ?? ''}</span>
      </div>
      <Monogramm name={name} size="sm" />
      <div className="tm-main">
        <div className="tm-l1">
          {kundeId != null ? (
            <button type="button" className="tm-kunde" title="Kunde öffnen" onClick={() => kundeOeffnen(kundeId)}>
              {name}
            </button>
          ) : (
            <span className="tm-kunde">{name}</span>
          )}
          {notizText ? (
            <span className="tm-ntz" tabIndex={0} role="img" aria-label={`${notizTitel}: ${notizText}`} title={`${notizTitel}: ${notizText}`}>
              <StickyNote />
            </span>
          ) : null}
        </div>
        <div className="tm-l2">
          <span className="tm-leist">{t.leistung || '–'}</span>
          {adresse && karte ? (
            <button type="button" className="tm-adr" title="In Karten öffnen" onClick={() => void linkOeffnen(karte).catch(warnen)}>
              <MapPin />
              <span>{adresse}</span>
            </button>
          ) : null}
        </div>
      </div>
      <div className="tm-info">
        {b ? (
          <span className={`tm-betrag ${b.ist ? 'ist' : ''}`} title={b.titel}>
            {b.ist ? '' : 'ca. '}
            {betragKurz(b.cent)}
          </span>
        ) : null}
        <BelegChip t={t} />
      </div>
      <div className="tm-acts">
        {k.frage ? <span className="tm-frage">War der Termin?</span> : null}
        {k.haupt === 'abhaken' ? (
          <button type="button" className="btn-primary sm tm-kass" title="Termin abhaken – den Beleg stellst du danach aus" onClick={() => onAktion('abhaken', t)}>
            <Check />
            Erledigt
          </button>
        ) : null}
        {k.haupt === 'ausstellen' ? (
          <button
            type="button"
            className="btn-primary sm tm-kass"
            title={`Öffnet „Erfassen“: ${art === 'rechnung' ? 'Rechnung' : 'Quittung'} mit Nummer ausstellen`}
            onClick={() => onAktion('ausstellen', t)}
          >
            <ArtIcon />
            {ausstellLabel(art)}
          </button>
        ) : null}
        {k.haupt === 'wieder' ? (
          <button type="button" className="btn subtle tm-btn" onClick={() => onAktion('wieder', t)}>
            <RotateCcw />
            Wieder einplanen
          </button>
        ) : null}
        {k.absagen ? (
          <button type="button" className="btn ghost tm-btn" onClick={() => onAktion('absagen', t)}>
            Absagen
          </button>
        ) : null}
        {k.mehr ? (
          <button
            type="button"
            className={`icon-btn sm tm-mehr ${menueOffen ? 'open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={menueOffen}
            title="Weitere Aktionen"
            aria-label="Weitere Aktionen"
            onClick={(e) => onMenue(e.currentTarget)}
          >
            <Ellipsis />
          </button>
        ) : null}
      </div>
    </li>
  );
}

function BelegChip({ t }: { t: Termin }) {
  const c = chip(t);
  const Icon = c.belegArt ? ART_ICON[c.belegArt] : null;
  switch (c.art) {
    case 'abgesagt':
      return <span className="tm-chip ab">abgesagt</span>;
    case 'fehlt':
      return (
        <span className="tm-chip fehlt" title={c.titel}>
          <TriangleAlert />
          Beleg fehlt
        </span>
      );
    case 'bezahlt':
      return (
        <button type="button" className="tm-chip bez" title={c.titel} onClick={() => c.einnahme != null && bearbeiten(c.einnahme)}>
          bezahlt ohne Beleg
          <Check className="ic tm-ok" />
        </button>
      );
    case 'ohne':
      return (
        <span className="tm-chip ohne" title={c.titel}>
          <Check />
          ohne Beleg
        </span>
      );
    case 'leer':
      return (
        <span className="tm-chip leer" title={c.titel}>
          ohne Beleg
        </span>
      );
    case 'vorbereitet':
      return (
        <Link className="tm-chip vor" to={`/belege/${c.beleg}`} title={c.titel}>
          {Icon ? <Icon /> : null}
          {c.text}
        </Link>
      );
    case 'storniert':
      return (
        <Link className="tm-chip storno" to={`/belege/${c.beleg}`} title={c.titel}>
          {Icon ? <Icon /> : null}
          <span>{c.text}</span>
        </Link>
      );
    default:
      return (
        <Link className={`tm-chip ok ${c.offen ? 'offen' : ''}`} to={`/belege/${c.beleg}`} title={c.titel}>
          {Icon ? <Icon /> : null}
          <span>{c.text}</span>
          {c.offen ? <small>offen</small> : <Check className="ic tm-ok" />}
        </Link>
      );
  }
}

/* ================= „⋯“-Menü (Popover am <body>, wie das Status-Menü der Belege) ================= */

const MENUE_ICON: Readonly<Record<TerminAktion, LucideIcon>> = {
  abhaken: Check,
  ausstellen: Receipt,
  ohne: Check,
  mitbeleg: Receipt,
  nichterledigt: RotateCcw,
  absagen: X,
  wieder: RotateCcw,
  bearbeiten: Pencil,
  vorbereiten: FileText,
  einnahme: ArrowLeftRight,
};

function MehrMenue({
  anker,
  punkte,
  titel,
  onZu,
  onWahl,
}: {
  anker: HTMLElement;
  punkte: MenueEintrag[];
  titel: string;
  onZu: () => void;
  onWahl: (a: TerminAktion) => void;
}) {
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const platzieren = useCallback(() => {
    const b = anker.getBoundingClientRect();
    const p = pop.current;
    if (!p) return;
    if (!anker.isConnected || b.bottom < 0 || b.top > innerHeight) return onZu();
    const w = p.offsetWidth;
    const hoehe = p.offsetHeight;
    let top = b.bottom + 6;
    if (top + hoehe > innerHeight - 12) top = Math.max(12, b.top - hoehe - 6);
    const left = Math.round(Math.min(innerWidth - w - 12, Math.max(12, b.right - w)));
    const oben = Math.round(top);
    setPos((alt) => (alt && alt.left === left && alt.top === oben ? alt : { left, top: oben }));
  }, [anker, onZu]);

  useLayoutEffect(() => {
    platzieren();
  }, [platzieren]);

  useEffect(() => {
    pop.current?.querySelector<HTMLButtonElement>('.tm-mi')?.focus({ preventScroll: true });
    const maus = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !anker.contains(t)) onZu();
    };
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onZu();
        anker.focus({ preventScroll: true });
      }
    };
    document.addEventListener('mousedown', maus);
    window.addEventListener('keydown', taste, true);
    window.addEventListener('scroll', platzieren, true);
    window.addEventListener('resize', platzieren);
    return () => {
      document.removeEventListener('mousedown', maus);
      window.removeEventListener('keydown', taste, true);
      window.removeEventListener('scroll', platzieren, true);
      window.removeEventListener('resize', platzieren);
    };
  }, [anker, onZu, platzieren]);

  const tasten = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const liste = [...(pop.current?.querySelectorAll<HTMLButtonElement>('.tm-mi') ?? [])];
    const i = liste.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (liste.length) liste[(i + (e.key === 'ArrowDown' ? 1 : liste.length - 1)) % liste.length].focus();
    } else if (e.key === 'Tab') onZu();
  };

  return createPortal(
    <div
      ref={pop}
      className="tm-menu"
      role="menu"
      aria-label={titel}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      onKeyDown={tasten}
    >
      {punkte.map((p, i) => {
        if ('trenner' in p) return <div key={`sep-${i}`} className="tm-mi-sep" role="separator" />;
        const Icon = MENUE_ICON[p.aktion];
        return (
          <button key={p.aktion} type="button" role="menuitem" tabIndex={-1} className={`tm-mi ${p.neg ? 'neg' : ''}`} onClick={() => onWahl(p.aktion)}>
            <Icon />
            <span>
              <b>{p.label}</b>
              {p.sub ? <small>{p.sub}</small> : null}
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
