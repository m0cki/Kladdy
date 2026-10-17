/* Auswertung › Überblick (ANLEITUNG §6.9.1): Status-Pillen, KPI-Reihe mit Hochzählen und ▲/▼ ggü. Vorperiode,
 * Eingänge & Ausgaben je Monat (Klick wählt den Monat), Überschuss kumuliert vs. Vorjahr, zwei Donuts.
 * Zeitraum steht in der Adresse (?modus=…&anker=…, Deep-Link und Zurück-Taste) und gilt auch für Ein- & Ausgänge.
 * Optik wie referenz/prototyp/js/pages/ueberblick.js; Rechnen in lib/auswertung.ts, Daten in lib/queries/auswertung.ts.
 * Bewusst NICHT hier: „Nächste 90 Tage“ (kommt mit Liquidität) und „Meine Kennzahlen“ (Phase 4). */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, ChartColumn, CreditCard, Info, LayoutDashboard, List, Sigma } from 'lucide-react';
import {
  MONAT_KURZ,
  aenderung,
  auftraege,
  ausgabenNachKategorie,
  balkenEnde,
  deltaAnzeige,
  eingaengeNachZahlungsweg,
  kuGrenzen,
  kuStatus,
  kumuliert,
  monatsReihe,
  offeneRechnungen,
  ohneBelegAnzahl,
  summen,
  vergleich,
  type Anteil,
} from '../../lib/auswertung';
import { listenAdresse } from '../../lib/buchungen';
import { hochzaehlWert } from '../../lib/charts';
import { formatBetrag } from '../../lib/money';
import { ladeUeberblick, type UeberblickDaten } from '../../lib/queries/auswertung';
import { heute, zeitraum, zeitraumAusParams, zeitraumParams, type ZeitraumModus } from '../../lib/zeitraum';
import { useUi } from '../../store/ui';
import { AreaChart } from '../../components/charts/AreaChart';
import { BarChart } from '../../components/charts/BarChart';
import { Donut } from '../../components/charts/Donut';
import { Legend } from '../../components/charts/Legend';
import { EmptyState } from '../../components/ui/EmptyState';
import { reveal } from '../../components/ui/PageHead';
import { ZeitraumWahl } from '../../components/ui/ZeitraumWahl';
import { Ladeansicht, useLaden } from '../einstellungen/Laden';
import { AuswertungKopf } from './AuswertungKopf';

type Wahl = { modus: ZeitraumModus; anker: string };

const MONAT_LANG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const euro0 = (c: number) => formatBetrag(c, { nachkomma: 0 });
const euro = (c: number) => formatBetrag(c);
const zahl = (n: number) => new Intl.NumberFormat('de-DE').format(n);
const plural = (n: number, eins: string, viele: string) => `${zahl(n)} ${n === 1 ? eins : viele}`;

export default function Ueberblick() {
  const [params, setParams] = useSearchParams();
  const gemerkt = useUi((s) => s.zeitraum);
  const setZeitraum = useUi((s) => s.setZeitraum);
  const datenStand = useUi((s) => s.datenStand);
  // Adresse vor gemerktem Zeitraum; ohne Parameter (Menü) gilt der zuletzt gewählte
  const ausAdresse = zeitraumAusParams(params);
  const wahl: Wahl = ausAdresse ?? gemerkt;

  // Ohne Parameter den gemerkten Zeitraum in die Adresse schreiben (ersetzen), damit „Zurück“ genau dorthin führt
  const ohneAdresse = !ausAdresse;
  useEffect(() => {
    if (ohneAdresse) setParams(zeitraumParams(gemerkt.modus, gemerkt.anker), { replace: true });
  }, [ohneAdresse, gemerkt.modus, gemerkt.anker, setParams]);

  // Ein- & Ausgänge folgt dem hier gewählten Zeitraum (ein Zeitraum für die ganze App, wie im Prototyp)
  useEffect(() => {
    if (wahl.modus !== gemerkt.modus || wahl.anker !== gemerkt.anker) setZeitraum({ modus: wahl.modus, anker: wahl.anker });
  }, [wahl.modus, wahl.anker, gemerkt.modus, gemerkt.anker, setZeitraum]);

  const waehle = useCallback((z: Wahl) => setParams(zeitraumParams(z.modus, z.anker)), [setParams]);

  const laden = useCallback(() => {
    void datenStand; // nach jedem Schreibvorgang neu laden
    return ladeUeberblick();
  }, [datenStand]);
  const { zustand, erneut } = useLaden(laden);

  return (
    <div className="page ub-page">
      <AuswertungKopf aktionen={<ZeitraumWahl modus={wahl.modus} anker={wahl.anker} onChange={waehle} />} />
      {zustand.status === 'ok' ? (
        <Inhalt d={zustand.daten} wahl={wahl} waehle={waehle} />
      ) : zustand.status === 'laden' ? (
        <Skelett />
      ) : (
        <Ladeansicht zustand={zustand} icon={LayoutDashboard} was="Die Zahlen" erneut={erneut} />
      )}
    </div>
  );
}

function Skelett() {
  return (
    <div className="stack" aria-busy="true" aria-label="Wird geladen">
      <div className="sk ub-sk-pills reveal" style={reveal(1)} />
      <div className="kpis k4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="sk ub-sk-kpi reveal" style={reveal(2 + i)} />
        ))}
      </div>
      <div className="grid-2">
        {[0, 1].map((i) => (
          <div key={i} className="sk ub-sk-chart reveal" style={reveal(6 + i)} />
        ))}
      </div>
    </div>
  );
}

/* ================= Inhalt ================= */

function Inhalt({ d, wahl, waehle }: { d: UeberblickDaten; wahl: Wahl; waehle: (z: Wahl) => void }) {
  const h = heute();
  const z = zeitraum(wahl.modus, wahl.anker);

  if (!d.buchungen.length) {
    return (
      <section className="card reveal" style={reveal(1)}>
        <EmptyState icon={LayoutDashboard} title="Noch keine Ein- oder Ausgänge">
          Sobald unter Ein- &amp; Ausgänge etwas erfasst ist (+ Erfassen, ⌘N), steht hier, wie das Geschäft läuft.
          <span className="row">
            <Link className="btn ghost" to="/ein-ausgaenge">
              <ArrowLeftRight />
              Zu Ein- &amp; Ausgänge
            </Link>
          </span>
        </EmptyState>
      </section>
    );
  }

  const v = vergleich(z, h);
  const s = summen(d.buchungen, z);
  const sv = summen(d.buchungen, v);
  const a = auftraege(d.auftraege, z, h);
  const av = auftraege(d.auftraege, v, h);
  const ku = d.ustModus === 'klein' ? kuStatus(d.buchungen, h, kuGrenzen(d.kennwerte, Number(h.slice(0, 4)))) : null;
  const offen = offeneRechnungen(d.offen, h);
  const ohne = ohneBelegAnzahl(d.buchungen, z);
  const monate = monatsReihe(d.buchungen, balkenEnde(z, h));
  const jahr = Number(z.von.slice(0, 4));
  const kum = kumuliert(d.buchungen, jahr, h);
  const kats = ausgabenNachKategorie(d.buchungen, z);
  const wege = eingaengeNachZahlungsweg(d.buchungen, z);
  const animKey = `${z.modus}-${z.von}`; // neuer Zeitraum ⇒ Diagramme zeichnen sich neu
  const imZeitraum = (monat: string) => monat >= z.von.slice(0, 7) && monat <= z.bis.slice(0, 7);
  const liste = (o: { typ?: 'einnahme' | 'ausgabe'; ohneBeleg?: boolean } = {}) => listenAdresse({ ...o, modus: wahl.modus, anker: wahl.anker });

  const auftragTeile = [plural(a.quittungen, 'Quittung', 'Quittungen'), plural(a.rechnungen, 'Rechnung', 'Rechnungen')];
  if (a.ohneBeleg) auftragTeile.push(`${zahl(a.ohneBeleg)} ohne Beleg`);

  const pillen: ReactNode[] = [];
  if (ku)
    pillen.push(
      <Link
        key="ku"
        className={`status-pill ${ku.stufe}`}
        to="/auswertung/steuer"
        title={`Kleinunternehmer-Umsatz ${ku.jahr}, hochgerechnet ${euro0(ku.hochrechnung)}. Grenzen: Vorjahr ${euro0(ku.grenzen.vorjahr)}, laufendes Jahr ${euro0(ku.grenzen.laufend)} (Steuer-Kennwerte ${ku.jahr}).`}
      >
        <i className="status-dot" />
        <b>Kleinunternehmer</b>
        <span>{ku.text}</span>
      </Link>,
    );
  if (offen.anzahl)
    pillen.push(
      <Link key="offen" className={`status-pill ${offen.ueberfaellig ? 'alarm' : 'ok'}`} to="/belege">
        <i className="status-dot" />
        <b>
          {plural(offen.anzahl, 'offene Rechnung', 'offene Rechnungen')}
          {offen.ueberfaellig ? ` · ${zahl(offen.ueberfaellig)} überfällig` : ''}
        </b>
        <span>{euro0(offen.summe)}</span>
      </Link>,
    );
  if (ohne)
    pillen.push(
      <Link key="ohne" className="status-pill warn" to={liste({ ohneBeleg: true })} title="In Ein- & Ausgänge genau diese Einträge zeigen">
        <i className="status-dot" />
        <b>{zahl(ohne)} ohne Beleg</b>
        <span>{z.label} · nachreichen</span>
      </Link>,
    );

  const kumSerien = [
    { name: String(jahr), farbe: 'var(--accent)', werte: kum.aktuell, flaeche: true },
    { name: String(jahr - 1), werte: kum.vorjahr, bezug: true },
  ];

  return (
    <>
      {pillen.length ? (
        <div className="status-pills ub-pills reveal" style={reveal(1)}>
          {pillen}
        </div>
      ) : null}

      <div className="kpis k4">
        <Kpi
          i={2}
          label="Eingänge"
          wert={s.eingaenge}
          format={euro0}
          delta={deltaAnzeige(aenderung(s.eingaenge, sv.eingaenge))}
          unten={v.text}
          to={liste({ typ: 'einnahme' })}
          hinweis="Alle Einnahmen mit Zahlungseingang im Zeitraum (Zuflussprinzip). Stornierte zählen nicht."
        />
        <Kpi
          i={3}
          label="Ausgaben"
          wert={s.ausgaben}
          format={euro0}
          delta={deltaAnzeige(aenderung(s.ausgaben, sv.ausgaben), true)}
          unten={v.text}
          to={liste({ typ: 'ausgabe' })}
          hinweis="Abziehbare Betriebsausgaben im Zeitraum (ohne Privatanteile). Stornierte zählen nicht."
        />
        <Kpi
          i={4}
          label="Überschuss"
          wert={s.ueberschuss}
          format={euro0}
          delta={deltaAnzeige(aenderung(s.ueberschuss, sv.ueberschuss))}
          unten={v.text}
          to={liste()}
          hinweis="Eingänge minus abziehbare Ausgaben – der Gewinn laut EÜR."
        />
        <Kpi
          i={5}
          label="Aufträge"
          wert={a.gesamt}
          format={zahl}
          delta={deltaAnzeige(aenderung(a.gesamt, av.gesamt))}
          unten={auftragTeile.join(' · ')}
          to="/belege"
          hinweis={`Ausgestellte Quittungen und Rechnungen (nach Leistungsdatum, ohne Stornos) und Einnahmen mit Kunde ohne eigenen Beleg – wie die Besuche bei den Kunden. Vergleich ${v.text}.`}
        />
      </div>

      <div className="grid-2">
        <section className="card reveal" style={reveal(6)}>
          <div className="card-head wrap">
            <div>
              <div className="card-title">
                <ChartColumn />
                Eingänge &amp; Ausgaben
              </div>
              <div className="card-sub">
                {monate[0].lang} – {monate[monate.length - 1].lang} · in € · Klick wählt den Monat
              </div>
            </div>
            <Legend
              serien={[
                { name: 'Eingänge', farbe: 'var(--series-1)' },
                { name: 'Ausgaben', farbe: 'var(--series-2)' },
              ]}
            />
          </div>
          <BarChart
            key={animKey}
            titel="Eingänge und Ausgaben je Monat"
            labels={monate.map((m) => m.kurz)}
            serien={[
              { name: 'Eingänge', farbe: 'var(--series-1)', werte: monate.map((m) => m.eingaenge) },
              { name: 'Ausgaben', farbe: 'var(--series-2)', werte: monate.map((m) => m.ausgaben) },
            ]}
            formatWert={euro}
            langLabel={(i) => monate[i].lang}
            extra={{ name: 'Überschuss', wert: (i) => formatBetrag(monate[i].ueberschuss, { vorzeichen: 'immer' }) }}
            blass={(i) => !imZeitraum(monate[i].monat)}
            onWahl={(i) => waehle({ modus: 'monat', anker: monate[i].von })}
            wahlText="Diesen Monat als Zeitraum wählen"
          />
        </section>
        <section className="card reveal" style={reveal(7)}>
          <div className="card-head wrap">
            <div>
              <div className="card-title">
                <Sigma />
                Überschuss kumuliert
              </div>
              <div className="card-sub">
                {jahr} im Vergleich zu {jahr - 1} · in €
              </div>
            </div>
            <Legend
              serien={[
                { name: String(jahr), farbe: 'var(--accent)' },
                { name: String(jahr - 1), farbe: 'var(--muted)', gestrichelt: true },
              ]}
            />
          </div>
          <AreaChart
            key={animKey}
            titel={`Überschuss kumuliert ${jahr} im Vergleich zu ${jahr - 1}`}
            labels={[...MONAT_KURZ]}
            serien={kumSerien}
            formatWert={(c) => formatBetrag(c, { nachkomma: 0, vorzeichen: 'immer' })}
            langLabel={(i) => `${MONAT_LANG[i]} (bis Monatsende)`}
          />
        </section>
      </div>

      <div className="grid-2">
        <section className="card reveal" style={reveal(8)}>
          <div className="card-head">
            <div>
              <div className="card-title">
                <List />
                Wofür das Geld rausgeht
              </div>
              <div className="card-sub">{z.label} · abziehbare Ausgaben nach Kategorie</div>
            </div>
          </div>
          <Anteile eintraege={kats} was="Ausgaben" titel="Ausgaben nach Kategorie" />
        </section>
        <section className="card reveal" style={reveal(9)}>
          <div className="card-head">
            <div>
              <div className="card-title">
                <CreditCard />
                Wie Kunden bezahlen
              </div>
              <div className="card-sub">{z.label} · Eingänge nach Zahlungsweg</div>
            </div>
          </div>
          <Anteile eintraege={wege} was="Eingänge" titel="Eingänge nach Zahlungsweg" />
        </section>
      </div>
    </>
  );
}

function Anteile({ eintraege, was, titel }: { eintraege: Anteil[]; was: string; titel: string }) {
  if (!eintraege.length) return <EmptyState icon={Info} title={`Keine ${was} im Zeitraum`} />;
  const gesamt = eintraege.reduce((x, e) => x + e.wert, 0);
  return <Donut eintraege={eintraege} mitte={euro0(gesamt)} mitteSub={was} format={euro0} titel={titel} />;
}

/* ================= KPI-Kachel mit Hochzählen (§9.5: 900 ms, ease-out cubic) ================= */

function useHochzaehlen(ziel: number): number {
  const voll = useUi((s) => s.settings.motion === 'full');
  const [wert, setWert] = useState(voll ? 0 : ziel);
  useEffect(() => {
    if (!voll) {
      setWert(ziel);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const schritt = (jetzt: number) => {
      const t = (jetzt - t0) / 900;
      setWert(hochzaehlWert(ziel, t));
      if (t < 1) raf = requestAnimationFrame(schritt);
    };
    raf = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(raf);
  }, [ziel, voll]);
  return wert;
}

interface KpiProps {
  i: number;
  label: string;
  wert: number;
  format: (v: number) => string;
  delta: ReturnType<typeof deltaAnzeige>;
  /** Zeile unter dem Wert neben dem Pfeil */
  unten: string;
  to: string;
  hinweis: string;
}

function Kpi({ i, label, wert, format, delta, unten, to, hinweis }: KpiProps) {
  const sichtbar = useHochzaehlen(wert);
  return (
    <Link className="kpi reveal" style={reveal(i)} to={to} title={hinweis}>
      <div className="kpi-label">
        <span>{label}</span>
      </div>
      <div className="kpi-val">
        <span aria-hidden="true">{format(sichtbar)}</span>
        <span className="sr-only">{format(wert)}</span>
      </div>
      <div className="kpi-sub">
        <span className={`delta ${delta.klasse}`}>
          {delta.pfeil ? <i aria-hidden="true">{delta.pfeil}</i> : null}
          {delta.text}
        </span>
        <span className="muted">{unten}</span>
      </div>
    </Link>
  );
}
