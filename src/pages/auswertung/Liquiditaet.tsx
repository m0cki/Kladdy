/* Auswertung › Liquidität (ANLEITUNG §6.9.2): „Was in den nächsten 30/60/90 Tagen rein- und rausgeht“.
 * Es gibt keinen Kontostand – die Kurve startet heute bei 0 € und zeigt den erwarteten Überschuss ab heute.
 * Aufbau wie referenz/prototyp/js/pages/liquiditaet.js: Kennzahlen (erwartete Eingänge, Ausgaben, Überschuss, engster
 * Moment), Treppen-Diagramm mit Hinweis bei Engpass, erwartete Zahlungen je Kalenderwoche, Annahmen (wirken sofort,
 * gespeichert als Einstellung 'liquiditaet_annahmen'), wiederkehrende Kosten und Planposten.
 * Zeitraum in der Adresse (?tage=30|60|90). Rechnen in lib/liquiditaet.ts, Daten in lib/queries/{auswertung,liquiditaet}.ts. */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays, Check, FileText, Filter, Info, List, RotateCcw, Repeat, Sigma, TriangleAlert, Waves } from 'lucide-react';
import type { KategorieWahl } from '../../lib/buchungen';
import {
  ANNAHMEN_STANDARD,
  HORIZONTE,
  VERZUG_MAX,
  datumKurz,
  horizontAusParam,
  nachWochen,
  tagKurz,
  vorschau,
  type Annahmen,
  type Vorschau,
  type Zahlung,
  type ZahlungArt,
} from '../../lib/liquiditaet';
import { formatBetrag } from '../../lib/money';
import { ladeLiquiditaet, type LiquiditaetDaten } from '../../lib/queries/auswertung';
import { ladeKategorienWahl } from '../../lib/queries/buchungen';
import { speichereAnnahmen } from '../../lib/queries/liquiditaet';
import { fehlerText } from '../../lib/fehler';
import { heute as heuteIso } from '../../lib/zeitraum';
import { useUi } from '../../store/ui';
import { PrognoseChart } from '../../components/charts/PrognoseChart';
import { EmptyState } from '../../components/ui/EmptyState';
import { reveal } from '../../components/ui/PageHead';
import { Seg } from '../../components/ui/Seg';
import { Ladeansicht, useLaden } from '../einstellungen/Laden';
import { AuswertungKopf } from './AuswertungKopf';
import { PlanpostenKarte, WiederkehrendListe, planVerschieben } from './LiqPosten';
import { useHochzaehlen } from './useHochzaehlen';

type Daten = LiquiditaetDaten & { kategorien: KategorieWahl[] };

const euro0 = (c: number, vorzeichen = false) => formatBetrag(c, { nachkomma: 0, vorzeichen: vorzeichen ? 'immer' : 'auto' });
const datumLang = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const zahl = (n: number) => new Intl.NumberFormat('de-DE').format(n);
const plural = (n: number, eins: string, viele: string) => `${zahl(n)} ${n === 1 ? eins : viele}`;
const HORIZONT_OPTIONEN = HORIZONTE.map((t) => ({ value: String(t), label: `${t} Tage` }));
/** Regler: so lange warten, bevor gespeichert (und protokolliert) wird */
const ENTPRELLEN_MS = 500;

export default function Liquiditaet() {
  const [params, setParams] = useSearchParams();
  const tage = horizontAusParam(params.get('tage'));
  const datenStand = useUi((s) => s.datenStand);

  const laden = useCallback(async (): Promise<Daten> => {
    void datenStand; // nach jedem Schreibvorgang neu laden
    const [d, kategorien] = await Promise.all([ladeLiquiditaet(), ladeKategorienWahl()]);
    return { ...d, kategorien };
  }, [datenStand]);
  const { zustand, erneut } = useLaden(laden);

  const seg = (
    <Seg
      options={HORIZONT_OPTIONEN}
      value={String(tage)}
      onChange={(v) =>
        setParams(
          (p) => {
            const n = new URLSearchParams(p);
            n.set('tage', v);
            return n;
          },
          { replace: true },
        )
      }
      ariaLabel="Zeitraum der Vorschau"
    />
  );

  return (
    <div className="page liq">
      <AuswertungKopf aktionen={seg} />
      {zustand.status === 'ok' ? (
        <Inhalt d={zustand.daten} tage={tage} />
      ) : zustand.status === 'laden' ? (
        <Skelett />
      ) : (
        <Ladeansicht zustand={zustand} icon={Waves} was="Die Zahlen" erneut={erneut} />
      )}
    </div>
  );
}

function Skelett() {
  return (
    <div className="stack" aria-busy="true" aria-label="Wird geladen">
      <div className="kpis k4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="sk ub-sk-kpi reveal" style={reveal(2 + i)} />
        ))}
      </div>
      <div className="grid-main">
        <div className="sk liq-sk-chart reveal" style={reveal(6)} />
        <div className="sk liq-sk-side reveal" style={reveal(7)} />
      </div>
    </div>
  );
}

/* ================= Annahmen: sofort anwenden, gespeichert (Regler entprellt) ================= */

function useAnnahmen(start: Annahmen) {
  const [a, setA] = useState<Annahmen>(start);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const offen = useRef<Annahmen | null>(null);

  const speichern = useCallback((wert: Annahmen) => {
    offen.current = null;
    speichereAnnahmen(wert).catch((e: unknown) => useUi.getState().showToast({ text: `Annahmen nicht gespeichert: ${fehlerText(e)}`, icon: 'warn', sticky: true }));
  }, []);

  const setze = useCallback(
    (neu: Annahmen, entprellt = false) => {
      setA(neu);
      clearTimeout(timer.current);
      if (entprellt) {
        offen.current = neu;
        timer.current = setTimeout(() => speichern(neu), ENTPRELLEN_MS);
      } else speichern(neu);
    },
    [speichern],
  );

  // Seite verlassen, während der Regler noch wartet ⇒ sofort speichern
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (offen.current) speichern(offen.current);
    },
    [speichern],
  );

  return [a, setze] as const;
}

/* ================= Inhalt ================= */

function Inhalt({ d, tage }: { d: Daten; tage: number }) {
  const h = heuteIso();
  const [a, setA] = useAnnahmen(d.annahmen);
  const v = useMemo(() => vorschau(d, h, tage, a), [d, h, tage, a]);
  const schalte = (k: SchalterKey | 'avgZeilen') => setA({ ...a, [k]: !a[k] });

  return (
    <>
      <p className="page-sub liq-intro reveal" style={reveal(1)}>
        Was in den nächsten {tage} Tagen voraussichtlich rein- und rausgeht – aus offenen Rechnungen, festen Kosten, Planposten und Durchschnittswerten.
      </p>
      <Kennzahlen v={v} />
      <div className="grid-main">
        <div className="stack">
          <section className="card reveal" style={reveal(7)}>
            <div className="card-head wrap">
              <div>
                <div className="card-title">
                  <Waves />
                  Überschuss ab heute
                </div>
                <div className="card-sub">
                  Start heute bei 0 € · {tage} Tage bis {datumLang(v.bis)} · über 0 = mehr rein als raus
                </div>
              </div>
              <div className="legend liq-legend">
                <span>
                  <i className="ln" />
                  Erwarteter Überschuss
                </span>
                <span>
                  <i className="dt pos" />
                  Einnahme
                </span>
                <span>
                  <i className="dt neg" />
                  Ausgabe
                </span>
                <span>
                  <i className="neg-area" />
                  unter 0 = mehr raus als rein
                </span>
              </div>
            </div>
            <PrognoseChart tage={v.tage} titel={`Erwarteter Überschuss ab heute für ${tage} Tage`} />
            <Banner v={v} d={d} h={h} />
          </section>
          <Tabelle v={v} avg={a.avgZeilen} umschalten={() => schalte('avgZeilen')} />
        </div>
        <div className="stack">
          <section className="card reveal" style={reveal(8)}>
            <div className="card-head">
              <div>
                <div className="card-title">
                  <Filter />
                  Annahmen
                </div>
                <div className="card-sub">Was in die Vorschau einfließt – wirkt sofort.</div>
              </div>
              <button
                type="button"
                className="btn subtle liq-reset"
                title="Alle Annahmen auf Standard"
                onClick={() => {
                  setA({ ...ANNAHMEN_STANDARD });
                  useUi.getState().toast('Annahmen auf Standard zurückgesetzt');
                }}
              >
                <RotateCcw />
                Standard
              </button>
            </div>
            <AnnahmenSchalter d={d} v={v} a={a} h={h} schalte={schalte} setA={setA} />
            <WiederkehrendListe wiederkehrend={d.wiederkehrend} kategorien={d.kategorien} heute={h} />
          </section>
          <section className="card reveal" style={reveal(10)}>
            <div className="card-head">
              <div>
                <div className="card-title">
                  <CalendarDays />
                  Planposten
                </div>
                <div className="card-sub">Einmalige Zahlungen, die du erwartest – z. B. Anschaffungen oder große Aufträge.</div>
              </div>
            </div>
            <PlanpostenKarte planposten={d.planposten} heute={h} bis={v.bis} tage={tage} />
          </section>
          <div className="proto-note reveal" style={reveal(11)}>
            <Info />
            <span>
              <b>So rechnet die Vorschau:</b> Einen Kontostand gibt es nicht – dein Geschäftskonto ist zugleich dein Privatkonto. Die Kurve startet heute bei 0 € und
              zählt nur, was ab morgen rein- und rausgeht: offene Rechnungen zur Fälligkeit plus Ø Zahlungsverzug, feste Kosten und Planposten an ihrem Termin, alles
              Übrige als Wochendurchschnitt der letzten 90 Tage (ohne Rechnungen und ohne die festen Kosten). Eine Schätzung, keine Garantie.
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

/* ================= Kennzahlen ================= */

function Kennzahlen({ v }: { v: Vorschau }) {
  const bisText = `bis ${datumKurz(v.bis)}`;
  const tief = v.engster.wert;
  return (
    <div className="kpis k4">
      <Kpi
        i={2}
        label="Erwartete Eingänge"
        wert={v.eingaenge}
        unten={v.ausRechnungen ? `davon ${euro0(v.ausRechnungen)} offene Rechnungen` : bisText}
        hinweis={`Was bis ${datumLang(v.bis)} voraussichtlich reinkommt: offene Rechnungen, eingeplante Einnahmen und der Wochendurchschnitt der übrigen Einnahmen.`}
      />
      <Kpi
        i={3}
        label="Erwartete Ausgaben"
        wert={v.ausgaben}
        unten={v.festeKosten ? `davon ${euro0(v.festeKosten)} feste Kosten` : bisText}
        hinweis={`Was bis ${datumLang(v.bis)} voraussichtlich rausgeht: feste Kosten (z. B. Versicherung, Handy), Planposten und der Wochendurchschnitt der übrigen Ausgaben.`}
      />
      <Kpi
        i={4}
        label="Erwarteter Überschuss"
        wert={v.ueberschuss}
        vorzeichen
        ampel={v.ueberschuss < 0}
        unten={`Eingänge − Ausgaben ${bisText}`}
        hinweis="Erwartete Eingänge minus erwartete Ausgaben im gewählten Zeitraum."
      />
      <div
        className={`kpi reveal liq-eng ${v.engpass ? 'neg' : 'ok'}`}
        style={reveal(5)}
        title="Größter Rückgang ab heute: der Tag, an dem bis dahin am meisten mehr raus- als reingegangen ist. Liegt er unter 0, musst du kurz aus eigener Tasche vorstrecken."
      >
        <div className="kpi-label">
          <span>Engster Moment{v.engpass ? ` · ${datumKurz(v.engster.datum)}` : ''}</span>
        </div>
        <div className="kpi-val">
          {v.engpass ? (
            <span className="neg-t">{euro0(tief)}</span>
          ) : (
            <span className="pos-t">
              <Check />
              Kein Engpass
            </span>
          )}
        </div>
        <p className="liq-eng-t">
          {v.engpass
            ? `Bis ${datumKurz(v.engster.datum)} gehen ${euro0(-tief)} mehr raus als rein – ggf. vorstrecken.`
            : `Durchgehend im Plus – bis ${datumKurz(v.bis)} kommt immer mindestens so viel rein wie rausgeht.`}
        </p>
      </div>
    </div>
  );
}

function Kpi({ i, label, wert, unten, hinweis, vorzeichen = false, ampel = false }: { i: number; label: string; wert: number; unten: string; hinweis: string; vorzeichen?: boolean; ampel?: boolean }) {
  const sichtbar = useHochzaehlen(wert, true);
  return (
    <div className="kpi reveal" style={reveal(i)} title={hinweis}>
      {ampel ? <i className="ampel rot" aria-hidden="true" /> : null}
      <div className="kpi-label">
        <span>{label}</span>
      </div>
      <div className="kpi-val">
        <span aria-hidden="true">{euro0(sichtbar, vorzeichen)}</span>
        <span className="sr-only">{euro0(wert, vorzeichen)}</span>
      </div>
      <div className="kpi-sub">
        <span className="muted">{unten}</span>
      </div>
    </div>
  );
}

/* ================= Hinweis bei Engpass ================= */

function Banner({ v, d, h }: { v: Vorschau; d: Daten; h: string }) {
  if (!v.engpass) return null;
  // größte geplante Ausgabe bis zum engsten Moment verschieben; überfällige (sonst nächste) Rechnung anmahnen
  const planZ = v.zahlungen.filter((z) => z.art === 'plan' && z.betrag_cent < 0 && z.datum <= v.engster.datum).sort((x, y) => x.betrag_cent - y.betrag_cent)[0];
  const plan = planZ ? d.planposten.find((p) => p.id === planZ.ref) : undefined;
  const faellig = (r: (typeof d.offen)[number]) => r.faellig_am ?? r.datum ?? h;
  const offen = [...d.offen].sort((x, y) => (faellig(x) < faellig(y) ? -1 : faellig(x) > faellig(y) ? 1 : 0));
  const re = offen.find((r) => faellig(r) < h) ?? offen[0];
  const tipps: string[] = [];
  if (plan) tipps.push(`„${plan.text}“ verschieben`);
  if (re) tipps.push(`Rechnung ${re.nummer ? `${re.nummer} ` : ''}${faellig(re) < h ? 'anmahnen' : 'nachfassen'}`);
  tipps.push(`${euro0(-v.engster.wert)} kurz privat vorstrecken`);
  const satz = tipps.length > 1 ? `${tipps.slice(0, -1).join(', ')} oder ${tipps[tipps.length - 1]}` : tipps[0];
  return (
    <div className="liq-banner" role="status">
      <TriangleAlert />
      <div className="liq-banner-t">
        <b>Engpass um den {datumKurz(v.engster.datum)} überbrücken</b>
        <span>Z. B. {satz}.</span>
      </div>
      {plan || re ? (
        <div className="liq-banner-a">
          {plan ? (
            <button type="button" className="chip" onClick={() => void planVerschieben(plan, h)}>
              <CalendarDays />
              Um 30 Tage verschieben
            </button>
          ) : null}
          {re ? (
            <Link className="chip" to={`/belege/${re.id}`}>
              <FileText />
              {re.nummer ?? 'Rechnung'} öffnen
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ================= Erwartete Zahlungen je Kalenderwoche ================= */

const ART: Record<ZahlungArt, { icon: ReactNode; label: string }> = {
  rechnung: { icon: <FileText />, label: 'Offene Rechnung' },
  wiederkehrend: { icon: <Repeat />, label: 'Wiederkehrende Zahlung' },
  plan: { icon: <CalendarDays />, label: 'Planposten' },
  variabel: { icon: <Sigma />, label: 'Durchschnittswert' },
};

function Tabelle({ v, avg, umschalten }: { v: Vorschau; avg: boolean; umschalten: () => void }) {
  const navigate = useNavigate();
  const wochen = useMemo(() => nachWochen(v.zahlungen), [v.zahlungen]);

  const zeile = (z: Zahlung, k: number) => {
    const istAvg = z.art === 'variabel';
    const href = z.art === 'rechnung' && z.ref != null ? `/belege/${z.ref}` : null;
    const text = istAvg ? z.text.replace(/^Ø\s*/, '') : z.text;
    return (
      <tr key={`${z.datum}-${k}`} className={`${href ? 'row' : ''} ${istAvg ? 'liq-avg' : ''}`} onClick={href ? (e) => !(e.target as HTMLElement).closest('a') && navigate(href) : undefined}>
        <td className="l num liq-d">{tagKurz(z.datum)}</td>
        <td className="l liq-what">
          <div className="liq-what-in">
            <span className="liq-ic" data-art={z.art} title={ART[z.art].label}>
              {ART[z.art].icon}
            </span>
            {href ? (
              <Link to={href}>{text}</Link>
            ) : (
              <span className="t">{text}</span>
            )}
            {istAvg ? (
              <span className="pill" title="Durchschnittswert aus den letzten 90 Tagen">
                Ø
              </span>
            ) : null}
          </div>
        </td>
        <td className={`num ${z.betrag_cent > 0 ? 'pos-v' : ''}`}>{euro0(z.betrag_cent, true)}</td>
        <td className={`num ${z.saldo < 0 ? 'neg-v' : ''}`}>{euro0(z.saldo)}</td>
      </tr>
    );
  };

  return (
    <section className="card reveal" style={reveal(9)}>
      <div className="card-head wrap">
        <div>
          <div className="card-title">
            <List />
            Erwartete Zahlungen <span className="muted">· bis {datumLang(v.bis)}</span>
          </div>
          <div className="card-sub">Nach Kalenderwoche · Überschuss ab heute nach jeder Zahlung · Rechnungen lassen sich öffnen</div>
        </div>
        <label className="toggle-row liq-avgtoggle">
          <span>Ø-Werte zeigen</span>
          <span className="switch">
            <input type="checkbox" checked={avg} onChange={umschalten} />
            <span />
          </span>
        </label>
      </div>
      {wochen.length ? (
        <div className="table-wrap">
          <table className="fin-table liq-table">
            <thead>
              <tr>
                <th className="l">Datum</th>
                <th className="l">Was</th>
                <th>Betrag</th>
                <th title="Erwartete Einnahmen minus Ausgaben von heute bis zu dieser Zahlung">Überschuss bis dahin</th>
              </tr>
            </thead>
            <tbody>
              {wochen.flatMap((w) => [
                <tr key={w.start} className="grp">
                  <td className="l" colSpan={2}>
                    {w.text}
                  </td>
                  <td className="num">{euro0(w.summe, true)}</td>
                  <td className={`num ${w.saldo < 0 ? 'neg-v' : ''}`}>{euro0(w.saldo)}</td>
                </tr>,
                ...w.zahlungen.filter((z) => avg || z.art !== 'variabel').map((z, k) => zeile(z, k)),
              ])}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={CalendarDays} title="Keine erwarteten Zahlungen">
          Schalte Annahmen ein oder lege einen Planposten an.
        </EmptyState>
      )}
    </section>
  );
}

/* ================= Annahmen-Schalter und Regler ================= */

type SchalterKey = 'offene' | 'ueberfaellige' | 'wiederkehrend' | 'plan' | 'variabel';

interface SchalterProps {
  d: Daten;
  v: Vorschau;
  a: Annahmen;
  h: string;
  schalte: (k: SchalterKey) => void;
  setA: (a: Annahmen, entprellt?: boolean) => void;
}

const verzugText = (t: number) => (t === 0 ? 'pünktlich zur Fälligkeit' : `${plural(t, 'Tag', 'Tage')} nach Fälligkeit`);

function AnnahmenSchalter({ d, v, a, h, schalte, setA }: SchalterProps) {
  const summe = (l: readonly { summe_cent: number }[]) => l.reduce((s, r) => s + r.summe_cent, 0);
  const ueber = d.offen.filter((r) => (r.faellig_am ?? r.datum ?? h) < h);
  const aktiv = d.wiederkehrend.filter((w) => w.aktiv);
  const plan = d.planposten.filter((p) => p.datum > h);
  const max = Math.max(VERZUG_MAX, v.verzugAuto, a.verzug ?? 0);
  const namen = aktiv.slice(0, 3).map((w) => w.vorlage.name).join(', ') + (aktiv.length > 3 ? ' …' : '');

  const schalter = (k: SchalterKey, label: string, sub: string, cls = '') => (
    <label className={`toggle-row ${cls}`}>
      <span>
        {label}
        <small>{sub}</small>
      </span>
      <span className="switch">
        <input type="checkbox" checked={a[k]} onChange={() => schalte(k)} />
        <span />
      </span>
    </label>
  );

  return (
    <>
      <div className="liq-opts">
        {schalter('offene', 'Offene Rechnungen', `${plural(d.offen.length, 'Rechnung', 'Rechnungen')} · ${euro0(summe(d.offen))} · zur Fälligkeit + Verzug`)}
        {schalter(
          'ueberfaellige',
          'Überfällige einrechnen',
          ueber.length ? `${plural(ueber.length, 'Rechnung', 'Rechnungen')} · ${euro0(summe(ueber))} · frühestens in 3 Tagen` : 'derzeit keine überfällig',
          `sub ${a.offene ? '' : 'off'}`,
        )}
        {schalter('wiederkehrend', 'Feste Kosten', aktiv.length ? `${plural(aktiv.length, 'wiederkehrender Posten', 'wiederkehrende Posten')} · ${namen}` : 'noch keine eingetragen')}
        {schalter('plan', 'Planposten', plan.length ? `${plural(plan.length, 'Posten', 'Posten')} · ${euro0(plan.reduce((s, p) => s + p.betrag_cent, 0), true)}` : 'noch keine eingetragen')}
        {schalter('variabel', 'Ø übrige Einnahmen und Ausgaben', `${euro0(v.schnitt.ein, true)} / ${euro0(-v.schnitt.aus, true)} pro Woche · Quittungen, Sprit, Material … der letzten 90 Tage`)}
      </div>
      <div className="liq-sl">
        <div className="liq-sl-head">
          <label htmlFor="liqVerzug">Kunden zahlen im Schnitt</label>
          <output htmlFor="liqVerzug">{verzugText(v.verzug)}</output>
        </div>
        <input
          type="range"
          id="liqVerzug"
          min={0}
          max={max}
          step={1}
          value={v.verzug}
          disabled={!a.offene}
          style={{ '--fill': `${(v.verzug / max) * 100}%` } as CSSProperties}
          onChange={(e) => {
            const t = Number(e.target.value);
            setA({ ...a, verzug: t === v.verzugAuto ? null : t }, true);
          }}
        />
        <div className="hint">
          Ø aus deiner Historie: {plural(v.verzugAuto, 'Tag', 'Tage')}
          {a.verzug != null && a.verzug !== v.verzugAuto ? (
            <>
              {' · '}
              <button type="button" className="liq-linkbtn" onClick={() => setA({ ...a, verzug: null })}>
                übernehmen
              </button>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
