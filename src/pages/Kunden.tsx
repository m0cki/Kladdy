/* Kunden (§6.8): ruhige Liste aller Kunden, Standard „zuletzt da“ zuerst. Je Zeile Monogramm, Name, kurze Adresse,
 * Besuche, letzter Besuch (Datum + „vor 12 Tagen“, darunter der nächste Termin), letzte Leistung, Umsatz (dezent) und
 * Notiz-Symbol. Suche über Name, Straße, Ort, Telefon, Notiz und Leistung; Umschalter Alle · Stammkunden · mit Notiz.
 * Keine KPI-Kacheln, keine Summen (Statistik nur in der Auswertung). Klick öffnet die Kunden-Schublade.
 * Optik und Verhalten wie referenz/prototyp/js/pages/kunden.js; Logik in lib/kunden.ts, Daten in lib/queries/kunden.ts. */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { CalendarDays, Mail, Phone, Plus, Search, StickyNote, Users } from 'lucide-react';
import { anzahlText, datumKurz, markiere } from '../lib/buchungen';
import {
  SORT_START,
  STATUS_BADGE,
  adresseKurz,
  hatNotiz,
  kundenIndex,
  kundenListe,
  terminKurz,
  terminLang,
  vorText,
  zaehleFilter,
  type KundenFilter,
  type KundenInfo,
  type KundenTreffer,
  type ListenOptionen,
  type SortFeld,
} from '../lib/kunden';
import { kundeNeu, kundeOeffnen, useKundeSchublade } from '../lib/kunden-schublade';
import { formatBetrag } from '../lib/money';
import { ladeKunden, ladeVerlauf } from '../lib/queries/kunden';
import { normalize, teile } from '../lib/suche';
import { heute } from '../lib/zeitraum';
import { useUi } from '../store/ui';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHead, reveal } from '../components/ui/PageHead';
import { Seg } from '../components/ui/Seg';
import { Monogramm } from '../components/kunden/Monogramm';
import { Ladeansicht, useLaden } from './einstellungen/Laden';

function Hl({ text, q }: { text: string; q: string }) {
  const marks = useMemo(() => markiere(text, q), [text, q]);
  if (!marks.length) return <>{text}</>;
  return (
    <>
      {teile(text, marks).map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

// Suche, Filter und Sortierung überleben den Seitenwechsel (wie im Prototyp)
let gemerkt: ListenOptionen = { q: '', filter: 'alle', sort: 'zuletzt', richtung: SORT_START.zuletzt };

export default function Kunden() {
  const datenStand = useUi((s) => s.datenStand);
  const laden = useCallback(async () => {
    void datenStand; // nach jedem Schreibvorgang neu laden (auch nach dem Speichern in der Erfassen-Schublade)
    const [kunden, verlauf] = await Promise.all([ladeKunden(), ladeVerlauf()]);
    const h = heute();
    return { index: kundenIndex(kunden, verlauf, h), heute: h };
  }, [datenStand]);
  const { zustand, erneut } = useLaden(laden);

  const [o, setO] = useState<ListenOptionen>(gemerkt);
  const [q, setQ] = useState(o.q); // Eingabe sofort, Liste kurz entprellt
  const suchRef = useRef<HTMLInputElement>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    gemerkt = o;
  }, [o]);
  useEffect(() => {
    if (q === o.q) return;
    const t = setTimeout(() => setO((x) => ({ ...x, q })), 60);
    return () => clearTimeout(t);
  }, [q, o.q]);

  const sucheLeeren = () => {
    setQ('');
    setO((x) => ({ ...x, q: '' }));
  };

  const ersteZeile = () => tbodyRef.current?.querySelector<HTMLTableRowElement>('tr[data-k]') ?? null;

  return (
    <div className="page ku-page">
      <PageHead
        icon={Users}
        title="Kunden"
        sub="Bei wem du warst, wann und was gemacht wurde"
        actions={
          <>
            <label className="ku-search">
              <Search />
              <input
                ref={suchRef}
                type="search"
                className="input"
                value={q}
                placeholder="Name, Straße, Ort, Telefon, Notiz, Leistung …"
                aria-label="Kunden durchsuchen"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && q) {
                    e.preventDefault();
                    e.stopPropagation();
                    sucheLeeren();
                  } else if (e.key === 'ArrowDown') {
                    const tr = ersteZeile();
                    if (tr) {
                      e.preventDefault();
                      tr.focus();
                    }
                  } else if (e.key === 'Enter') {
                    const trs = tbodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-k]');
                    if (trs?.length === 1) kundeOeffnen(Number(trs[0].dataset.k));
                  }
                }}
              />
            </label>
            <button type="button" className="btn-primary head-add" onClick={() => kundeNeu()}>
              <Plus />
              Kunde anlegen
            </button>
          </>
        }
      />
      {zustand.status === 'ok' ? (
        <Liste
          index={zustand.daten.index}
          h={zustand.daten.heute}
          o={o}
          setO={setO}
          tbodyRef={tbodyRef}
          suchFeld={() => suchRef.current?.focus()}
          sucheLeeren={sucheLeeren}
        />
      ) : (
        <Ladeansicht zustand={zustand} icon={Users} was="Kunden" erneut={erneut} />
      )}
    </div>
  );
}

/* ================= Liste ================= */

interface ListeProps {
  index: Map<number, KundenInfo>;
  h: string;
  o: ListenOptionen;
  setO: (f: (x: ListenOptionen) => ListenOptionen) => void;
  tbodyRef: RefObject<HTMLTableSectionElement | null>;
  suchFeld: () => void;
  sucheLeeren: () => void;
}

const FILTER: { value: KundenFilter; label: string; title?: string }[] = [
  { value: 'alle', label: 'Alle' },
  { value: 'stamm', label: 'Stammkunden', title: 'Kunden mit 2 oder mehr Besuchen' },
  { value: 'notiz', label: 'mit Notiz' },
];

function Liste({ index, h, o, setO, tbodyRef, suchFeld, sucheLeeren }: ListeProps) {
  const zeilen = useMemo(() => kundenListe(index.values(), o), [index, o]);
  const zahlen = useMemo(() => zaehleFilter(index.values()), [index]);
  const offen = useUi((s) => s.drawer === 'kunde');
  const auftrag = useKundeSchublade((s) => s.auftrag);
  const gewaehlt = offen && auftrag?.art === 'kunde' ? auftrag.id : null;
  const gesamt = index.size;
  const qt = o.q.trim();

  const sortiere = (feld: SortFeld) =>
    setO((x) => (x.sort === feld ? { ...x, richtung: x.richtung === 1 ? -1 : 1 } : { ...x, sort: feld, richtung: SORT_START[feld] }));

  const kopf = (feld: SortFeld, label: string, klasse: string) => {
    const an = o.sort === feld;
    return (
      <th className={`${klasse} ${an ? 'on' : ''}`} aria-sort={an ? (o.richtung < 0 ? 'descending' : 'ascending') : 'none'} data-dir={an ? (o.richtung < 0 ? '↓' : '↑') : ''}>
        <button type="button" className="ku-th" onClick={() => sortiere(feld)}>
          {label}
        </button>
      </th>
    );
  };

  return (
    <section className="card flush ku-liste reveal" style={reveal(1)}>
      <div className="ku-bar">
        <Seg
          ariaLabel="Kunden filtern"
          value={o.filter}
          onChange={(filter) => setO((x) => ({ ...x, filter }))}
          options={FILTER.map((f) => ({
            value: f.value,
            label: (
              <span title={f.title}>
                {f.label} <span className="cnt">{zahlen[f.value]}</span>
              </span>
            ),
          }))}
        />
        <span className="ku-count">{zeilen.length === gesamt ? anzahlText(gesamt, 'Kunde', 'Kunden') : `${zeilen.length} von ${gesamt}`}</span>
      </div>
      <div className="table-wrap">
        <table className="fin-table ku-table">
          <thead>
            <tr>
              {kopf('name', 'Kunde', 'l')}
              <th className="l ku-c-adr">Adresse</th>
              {kopf('besuche', 'Besuche', 'c ku-c-bes')}
              {kopf('zuletzt', 'Zuletzt da', 'l ku-c-last')}
              <th className="l ku-c-leist">Letzte Leistung</th>
              <th className="ku-c-ums">Umsatz</th>
              <th className="c ku-c-ntz">
                <span className="sr-only">Notiz</span>
              </th>
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {zeilen.length ? (
              zeilen.map((t) => <Zeile key={t.info.k.id} t={t} q={qt} h={h} gewaehlt={gewaehlt === t.info.k.id} suchFeld={suchFeld} />)
            ) : (
              <tr className="ku-leer">
                <td colSpan={7}>
                  <Leer gesamt={gesamt} q={qt} filter={o.filter} alleZeigen={() => setO((x) => ({ ...x, filter: 'alle' }))} sucheLeeren={sucheLeeren} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Leer({ gesamt, q, filter, alleZeigen, sucheLeeren }: { gesamt: number; q: string; filter: KundenFilter; alleZeigen: () => void; sucheLeeren: () => void }) {
  if (!gesamt) {
    return (
      <EmptyState icon={Users} title="Noch keine Kunden">
        Kunden entstehen mit jeder Einnahme für einen neuen Kunden oder hier über „Kunde anlegen“.
      </EmptyState>
    );
  }
  if (q) {
    return (
      <EmptyState icon={Search} title={`Keine Treffer für „${q}“`}>
        Name, Straße, Ort, Telefon, Notiz oder eine Leistung versuchen.
        <span className="row wrap ku-leer-act">
          <button type="button" className="btn ghost" onClick={() => kundeNeu(q)}>
            <Plus />„{q}“ als Kunde anlegen
          </button>
          {filter !== 'alle' ? (
            <button type="button" className="link" onClick={alleZeigen}>
              <Users />
              In allen Kunden suchen
            </button>
          ) : (
            <button type="button" className="link" onClick={sucheLeeren}>
              Suche leeren
            </button>
          )}
        </span>
      </EmptyState>
    );
  }
  return filter === 'stamm' ? (
    <EmptyState icon={Users} title="Noch keine Stammkunden">
      Hier erscheinen Kunden, bei denen du mindestens zweimal warst.
    </EmptyState>
  ) : (
    <EmptyState icon={StickyNote} title="Noch keine Notizen">
      Notizen wie „Hund im Garten, Tor schließen“ schreibst du in der Kundenansicht.
    </EmptyState>
  );
}

/* ---------- eine Zeile ---------- */

function LeistungZelle({ t, q }: { t: KundenTreffer; q: string }) {
  const x = t.info;
  const e = t.eintrag ?? x.letzterBesuch ?? x.naechster ?? x.eintraege[0] ?? null;
  if (!e) return <span className="ku-z muted">noch kein Besuch</span>;
  // Badge: Status des Eintrags, bei bezahlten der Hinweis auf offene/überfällige Rechnungen des Kunden
  const b =
    e.status !== 'bezahlt'
      ? STATUS_BADGE[e.status]
      : x.offen.some((v) => v.status === 'ueberfaellig')
        ? STATUS_BADGE.ueberfaellig
        : x.offen.length
          ? STATUS_BADGE.offen
          : null;
  let unter: string | null = null;
  if (t.eintrag) {
    const nq = normalize(q);
    const wort = nq.split(/\s+/).filter(Boolean);
    const imTitel = wort.some((w) => normalize(e.titel).includes(w));
    const pos = imTitel ? '' : (e.z.positionen ?? e.z.nummer ?? '');
    const wann = e !== x.letzterBesuch ? datumKurz(e.z.datum) : '';
    unter = [pos, wann].filter(Boolean).join(' · ') || null;
  }
  return (
    <>
      <span className="ku-z ku-lz">
        <span className="ku-tx">
          <Hl text={e.titel} q={q} />
        </span>
        {b ? <span className={`badge ${b.klasse}`}>{b.text}</span> : null}
      </span>
      {unter ? (
        <small className="ku-z">
          <Hl text={unter} q={q} />
        </small>
      ) : null}
    </>
  );
}

function Zeile({ t, q, h, gewaehlt, suchFeld }: { t: KundenTreffer; q: string; h: string; gewaehlt: boolean; suchFeld: () => void }) {
  const x = t.info;
  const k = x.k;
  const notiz = hatNotiz(k) ? (k.notiz ?? '').trim() : '';
  const nq = normalize(q);
  const ziffern = /^[\d\s+()/-]+$/.test(q) ? q.replace(/\D/g, '') : '';
  const telTreffer = !!q && !!k.telefon && (normalize(k.telefon).includes(nq) || (ziffern.length >= 3 && x.tel.includes(ziffern)));
  const mailTreffer = !!q && !!k.email && normalize(k.email).includes(nq);
  const adresse = adresseKurz(k);
  const n = x.naechster;
  const nt = x.nachtragen[0];

  const onKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      kundeOeffnen(k.id);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const ziel = (e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling) as HTMLElement | null;
      if (ziel?.dataset.k) ziel.focus();
      else if (e.key === 'ArrowUp') suchFeld();
    }
  };

  return (
    <tr className={`row ${gewaehlt ? 'selected' : ''}`} data-k={k.id} tabIndex={0} onClick={() => kundeOeffnen(k.id)} onKeyDown={onKey}>
      <td className="l">
        <div className="cell-main">
          <Monogramm name={k.name} />
          <span className="t">
            <b>
              <Hl text={k.name} q={q} />
            </b>
            {k.zusatz ? (
              <small>
                <Hl text={k.zusatz} q={q} />
              </small>
            ) : null}
          </span>
        </div>
      </td>
      <td className="l ku-c-adr">
        <span className="ku-z ku-adr">
          {telTreffer ? (
            <>
              <Phone />
              <Hl text={k.telefon ?? ''} q={q} />
            </>
          ) : mailTreffer ? (
            <>
              <Mail />
              <Hl text={k.email ?? ''} q={q} />
            </>
          ) : adresse ? (
            <Hl text={adresse} q={q} />
          ) : (
            <span className="muted">–</span>
          )}
        </span>
      </td>
      <td className="c num ku-c-bes">{x.besuche || <span className="muted">–</span>}</td>
      <td className="l ku-c-last">
        {x.zuletzt ? <span className="ku-z num">{datumKurz(x.zuletzt)}</span> : <span className="ku-z muted">–</span>}
        {n ? (
          <small className="ku-z ku-next" title={`Nächster Termin: ${terminLang(n.z, h)} · ${n.titel}`}>
            <CalendarDays />
            nächster: {terminKurz(n.z, h)}
          </small>
        ) : nt && !x.zuletzt ? (
          <small className="ku-z warn-t" title={`Termin nachtragen: ${terminLang(nt.z, h)} · ${nt.titel}`}>
            <CalendarDays />
            {terminKurz(nt.z, h)} nachtragen
          </small>
        ) : x.zuletzt ? (
          <small className="ku-z">{vorText(x.zuletzt, h)}</small>
        ) : null}
      </td>
      <td className="l ku-c-leist">
        <LeistungZelle t={t} q={q} />
      </td>
      <td className="num ku-c-ums">{x.umsatz ? formatBetrag(x.umsatz) : <span className="muted">–</span>}</td>
      <td className="c ku-c-ntz">
        {notiz ? (
          <span className={`ku-ntz ${q && normalize(notiz).includes(nq) ? 'on' : ''}`} title={`Notiz: ${notiz}`} role="img" aria-label={`Notiz: ${notiz}`}>
            <StickyNote />
          </span>
        ) : null}
      </td>
    </tr>
  );
}
