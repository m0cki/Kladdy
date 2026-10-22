/* Die eine Termin-Schublade (§6.5, 480 px, Prototyp termine.js openTermin/formHTML/speichern): Kunde & Ort (Vorschläge
 * „Name · K-0012“, Nachfrage bei gleichem Namen, ein neuer Name legt den Kunden an; Adresse folgt dem Kunden, solange
 * sie nicht selbst geändert wurde) · Wann (Datum, von–bis; „bis“ folgt „von“ + 2 h; Hinweis auf Überschneidungen) ·
 * Was (Leistung mit Vorschlägen, geschätzter Betrag mit Ø, Notiz) · „Beleg vorbereiten: Quittung | Rechnung | Keinen“
 * (Vorauswahl Einstellungen › Belege). Mit ausgestelltem Beleg bzw. bei erledigten Terminen steht dort der Beleg bzw.
 * „Beleg fehlt“ mit „Quittung ausstellen“ (die eine Erfassen-Schublade). Fuß: Absagen (geplant) bzw. Löschen (abgesagt).
 * Zweite Ansicht derselben Schublade: „Termin absagen“ mit optionalem Grund.
 * Geöffnet nur über lib/termin-schublade.ts; hängt im AppShell. Geschrieben wird nur über Rust (termin_speichern). */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronRight,
  FileText,
  Info,
  Plus,
  Receipt,
  RotateCcw,
  StickyNote,
  Trash2,
  TriangleAlert,
  User,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { datumKurz, kundeAufloesen, kundenLabel, nameSchluessel, zahlungswegName } from '../../lib/buchungen';
import { datenbankVerfuegbar } from '../../lib/db';
import { fehlerText } from '../../lib/fehler';
import { formatBetrag, parseBetrag } from '../../lib/money';
import { ladeTermine, ladeTerminStamm, terminSpeichern, type TerminStamm } from '../../lib/queries/termine';
import type { BelegDaten, BelegFormular } from '../../lib/rechnungen';
import { absagen, belegAusstellen, einnahmeOeffnen, entwurfFormular, loeschen } from '../../lib/termin-aktionen';
import { terminAbsagenFragen, terminFlash, terminOeffnen, terminSchliessen, useTerminSchublade, type TerminAuftrag } from '../../lib/termin-schublade';
import {
  ART_LABEL,
  BETRAG_FEHLER,
  adresseVon,
  ausstellArt,
  ausstellLabel,
  belegAus,
  vorbereitenHinweis,
  betragAnzeige,
  betragFeld,
  betragVorschlag,
  formularStart,
  minuten,
  plus2h,
  tagLang,
  terminPruefen,
  vorbereitungDaten,
  wannHinweis,
  zeitText,
  type BelegWahl,
  type Termin,
  type TerminFeld,
  type TerminFormular,
} from '../../lib/termine';
import { heute } from '../../lib/zeitraum';
import { useUi } from '../../store/ui';
import { Drawer } from '../ui/Drawer';
import { EmptyState } from '../ui/EmptyState';
import { Seg } from '../ui/Seg';
import { Monogramm } from '../kunden/Monogramm';

type Geladen =
  | { status: 'laden' }
  | { status: 'ohne-db' }
  | { status: 'fehler'; fehler: string }
  | { status: 'ok'; n: number; stamm: TerminStamm; termin: Termin | null; liste: Termin[]; entwurf: BelegFormular | null };

/** Titel, Untertitel und Symbol je Auftrag. */
function kopf(a: TerminAuftrag | null, t: Termin | null, h: string): { titel: string; sub?: string; icon: LucideIcon } {
  const wann = t ? `${tagLang(t.datum, h)}${t.von ? ` · ${zeitText(t)}` : ''}` : undefined;
  if (!a || a.art === 'neu') return { titel: 'Termin eintragen', sub: 'Kundentermin, auf Wunsch mit vorbereiteter Quittung', icon: CalendarPlus };
  if (a.art === 'absagen') return { titel: 'Termin absagen', sub: wann, icon: X };
  if (a.wieder) return { titel: 'Wieder einplanen', sub: wann, icon: CalendarDays };
  const titel = t?.status === 'erledigt' ? 'Termin · erledigt' : t?.status === 'abgesagt' ? 'Termin · abgesagt' : 'Termin bearbeiten';
  return { titel, sub: wann, icon: CalendarDays };
}

export function TerminSchublade() {
  const open = useUi((s) => s.drawer === 'termin');
  const auftrag = useTerminSchublade((s) => s.auftrag);
  const [geladen, setGeladen] = useState<Geladen>({ status: 'laden' });
  // Der Fuß gehört dem Inhalt: der rendert per Portal in diesen Platz (wie die Kunden-Schublade).
  const [fuss, setFuss] = useState<HTMLDivElement | null>(null);
  const n = open ? (auftrag?.n ?? 0) : 0;

  useEffect(() => {
    if (!open || !auftrag) return;
    if (!datenbankVerfuegbar()) {
      setGeladen({ status: 'ohne-db' });
      return;
    }
    let aktiv = true;
    setGeladen({ status: 'laden' });
    (async () => {
      const [stamm, liste] = await Promise.all([ladeTerminStamm(), ladeTermine()]);
      const id = auftrag.art === 'neu' ? null : auftrag.id;
      const termin = id != null ? (liste.find((t) => t.id === id) ?? null) : null;
      if (id != null && !termin) throw new Error('Diesen Termin gibt es nicht (mehr).');
      const entwurf = termin?.entwurf ? await entwurfFormular(termin.entwurf.id, heute()) : null;
      if (aktiv) setGeladen({ status: 'ok', n: auftrag.n, stamm, termin, liste, entwurf });
    })().catch((e: unknown) => {
      if (aktiv) setGeladen({ status: 'fehler', fehler: fehlerText(e) });
    });
    return () => {
      aktiv = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur bei neuem Auftrag
  }, [n]);

  const h = heute();
  const ok = geladen.status === 'ok' && geladen.n === n ? geladen : null;
  const k = kopf(auftrag, ok?.termin ?? null, h);

  return (
    <Drawer
      open={open}
      onClose={terminSchliessen}
      title={k.titel}
      sub={k.sub}
      icon={k.icon}
      width={auftrag?.art === 'absagen' ? 440 : 480}
      className="tm-drawer"
      foot={<div className="tm-fuss" ref={setFuss} />}
    >
      {geladen.status === 'ohne-db' ? (
        <section>
          <EmptyState icon={CalendarDays} title="Nur in der Mac-App">
            Termine liegen in der Datenbank auf diesem Mac. Im Browser-Vorschaumodus gibt es sie nicht – bitte die App starten (npm run tauri dev).
          </EmptyState>
        </section>
      ) : geladen.status === 'fehler' ? (
        <section>
          <EmptyState icon={TriangleAlert} title="Konnte nicht geladen werden">
            {geladen.fehler}
          </EmptyState>
        </section>
      ) : !ok || !auftrag ? (
        <section aria-busy="true">
          <div className="sk bu-sk" />
        </section>
      ) : auftrag.art === 'absagen' && ok.termin ? (
        <AbsagenAnsicht key={auftrag.n} t={ok.termin} ausSchublade={auftrag.ausSchublade} fuss={fuss} />
      ) : auftrag.art !== 'absagen' ? (
        <TerminFormularAnsicht key={auftrag.n} auftrag={auftrag} g={ok} fuss={fuss} />
      ) : null}
    </Drawer>
  );
}

/* ================= Formular ================= */

const Fehler = ({ text }: { text?: string }) =>
  text ? (
    <p className="hint neg tm-err" role="alert">
      {text}
    </p>
  ) : null;

function TerminFormularAnsicht({
  auftrag,
  g,
  fuss,
}: {
  auftrag: Exclude<TerminAuftrag, { art: 'absagen' }>;
  g: Extract<Geladen, { status: 'ok' }>;
  fuss: HTMLDivElement | null;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { stamm, liste, entwurf } = g;
  const t = g.termin;
  const h = heute();
  const neu = auftrag.art === 'neu';
  const wieder = auftrag.art === 'termin' && auftrag.wieder;
  const standard = stamm.belegArt;
  const [form, setForm] = useState<TerminFormular>(() =>
    t ? formularStart({ termin: t, wieder, standard, heute: h }) : formularStart({ termin: null, vorgabe: auftrag.art === 'neu' ? auftrag.vorgabe : {}, kunden: stamm.kunden, standard, heute: h }),
  );
  const [start] = useState(() => JSON.stringify(form));
  const [fehler, setFehler] = useState<Partial<Record<TerminFeld, string>>>({});
  const [speichert, setSpeichert] = useState(false);
  // Adresse folgt dem Kunden, „bis“ folgt „von“ – solange nicht selbst geändert
  const adrAuto = useRef(!form.adresse.trim() || form.adresse === adresseVon(aufgeloest(form)));
  const bisAuto = useRef(!t || form.bis === plus2h(form.von));
  const dirty = JSON.stringify(form) !== start;

  function aufgeloest(f: TerminFormular) {
    const k = kundeAufloesen(f.kunde, stamm.kunden, f.kundeBewusstNeu);
    return k.art === 'kunde' ? (stamm.kunden.find((x) => x.id === k.kunde.id) ?? null) : null;
  }

  // „ungespeichert“ nur für diese Schublade melden – wechselt sie zur Erfassen-Schublade, gehört der Wert dieser
  useEffect(() => {
    if (useUi.getState().drawer === 'termin') useUi.getState().setUngespeichert(dirty);
  }, [dirty]);
  useEffect(
    () => () => {
      if (useUi.getState().drawer !== 'erfassen') useUi.getState().setUngespeichert(false);
    },
    [],
  );

  // Fokus: Wiedereinplanen ⇒ Datum, ohne Kunde ⇒ Kunde, neu ohne Leistung ⇒ Leistung
  useEffect(() => {
    const feld = wieder ? 'datum' : !form.kunde ? 'kunde' : neu && !form.leistung ? 'leistung' : null;
    if (!feld) return;
    const tm = setTimeout(() => document.getElementById(`tm-f-${feld}`)?.focus({ preventScroll: true }), 260);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur beim Öffnen
  }, []);

  const set = <K extends keyof TerminFormular>(key: K, v: TerminFormular[K]) => setForm((f) => ({ ...f, [key]: v }));
  const fehlerWeg = (feld: TerminFeld) => setFehler((x) => (x[feld] ? { ...x, [feld]: undefined } : x));

  const setKunde = (kunde: string, bewusstNeu: string | null = null) => {
    setForm((f) => {
      const n = { ...f, kunde, kundeBewusstNeu: bewusstNeu };
      return adrAuto.current ? { ...n, adresse: adresseVon(aufgeloest(n)) } : n;
    });
    fehlerWeg('kunde');
  };

  const fix = t ? belegAus(t) : null;
  // „Beleg vorbereiten“ nur bei neuen, geplanten und wieder einzuplanenden Terminen ohne ausgestellten Beleg
  const mitBeleg = !fix && (!t || t.status === 'geplant' || wieder);

  /* ---------- Speichern ---------- */
  const speichern = useCallback(async () => {
    if (speichert) return;
    // erledigt: ein vorbereiteter Entwurf folgt dem Termin, bis er ausgestellt ist; sonst bleibt der Beleg, wie er ist
    const wahl = mitBeleg ? form.beleg : t?.status === 'erledigt' && t.entwurf ? ausstellArt(t, standard) : 'behalten';
    const p = terminPruefen(form, stamm.kunden, { heute: h, beleg: wahl, wiederEinplanen: wieder });
    if (!p.ok) {
      setFehler(p.fehler);
      const erstes = (['kunde', 'datum', 'von', 'bis', 'leistung', 'betrag'] as const).find((f) => p.fehler[f]);
      if (erstes) document.getElementById(`tm-f-${erstes}`)?.focus();
      return;
    }
    const d = p.daten;
    let vorbereitet: BelegDaten | null = null;
    if (d.beleg === 'quittung' || d.beleg === 'rechnung') {
      vorbereitet = vorbereitungDaten({
        art: d.beleg,
        termin: { datum: d.datum, leistung: d.leistung, betrag: d.betrag_geschaetzt_cent },
        vorhanden: entwurf,
        altLeistung: t?.leistung ?? '',
        zielTage: stamm.zielTage,
        vorlageId: stamm.vorlagen[d.beleg],
        heute: h,
      });
      if (!vorbereitet) {
        useUi.getState().showToast({ text: 'Der Beleg lässt sich so nicht vorbereiten – bitte Datum und Betrag prüfen.', icon: 'warn' });
        return;
      }
    }
    setSpeichert(true);
    try {
      const r = await terminSpeichern(t?.id ?? null, d, vorbereitet);
      const ui = useUi.getState();
      ui.setUngespeichert(false);
      ui.datenGeaendert();
      terminFlash(r.id);
      terminSchliessen();
      const was = neu ? 'Termin eingetragen' : wieder ? `Wieder eingeplant · ${datumKurz(d.datum).slice(0, 6)} ${d.von ?? ''}`.trim() : 'Termin gespeichert';
      const teile = [was];
      const art = d.beleg === 'quittung' || d.beleg === 'rechnung' ? ART_LABEL[d.beleg] : null;
      if (art && r.entwurf_aktion === 'neu') teile.push(`${art} vorbereitet`);
      else if (art && r.entwurf_aktion === 'geaendert') teile.push(t?.entwurf && t.entwurf.art !== d.beleg ? `jetzt mit ${art}` : `${art} angepasst`);
      else if (r.verworfen.length) teile.push(`${ART_LABEL[r.verworfen[0].art === 'rechnung' ? 'rechnung' : 'quittung']} verworfen`);
      if (r.kunde_neu && r.kunde_nummer) teile.push(`Kunde ${r.kunde_nummer} angelegt`);
      const hier = pathname === '/termine';
      ui.showToast({
        text: teile.join(' · '),
        icon: 'check',
        actions: hier ? undefined : [{ label: 'Ansehen', run: () => navigate(`/termine?t=${r.id}`) }],
      });
    } catch (e) {
      useUi.getState().showToast({ text: fehlerText(e), icon: 'warn', sticky: true });
    } finally {
      setSpeichert(false);
    }
  }, [speichert, mitBeleg, form, t, standard, stamm, h, wieder, entwurf, neu, pathname, navigate]);

  // ⌘↩ speichert
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void speichern();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [speichern]);

  /* ---------- Hinweise ---------- */
  const geplant = neu || wieder || t?.status === 'geplant';
  const wann = wannHinweis({ datum: form.datum, von: form.von, bis: form.bis, heute: h, geplant, liste, selbst: t?.id ?? null });
  const cent = parseBetrag(form.betrag);
  const betragUnlesbar = !!form.betrag.trim() && (cent == null || cent < 0);
  const vorschlag = betragVorschlag(form.leistung, stamm.leistungen);
  const kundenOptionen = useMemo(() => stamm.kunden.map((k) => ({ value: kundenLabel(k), label: k.ort || 'ohne Adresse' })), [stamm.kunden]);

  const fussInhalt = (
    <>
      {t && !wieder && t.status === 'geplant' ? (
        <button type="button" className="btn danger" onClick={() => terminAbsagenFragen(t.id, true)}>
          <X />
          Absagen
        </button>
      ) : null}
      {t && !wieder && t.status === 'abgesagt' ? (
        <button type="button" className="btn danger" title="Abgesagten Termin löschen (im Protokoll)" onClick={() => void loeschen(t)}>
          <Trash2 />
          Löschen
        </button>
      ) : null}
      <span className="spacer" />
      <button type="button" className="btn ghost" onClick={terminSchliessen}>
        Abbrechen
      </button>
      <button type="button" className="btn-primary sm" disabled={speichert} title="Speichern (⌘↩)" onClick={() => void speichern()}>
        {wieder ? <CalendarDays /> : <Check />}
        {neu ? 'Termin eintragen' : wieder ? 'Wieder einplanen' : 'Speichern'}
      </button>
    </>
  );

  return (
    <>
      <section>
        <h3>Kunde &amp; Ort</h3>
        <div className="field">
          <label className="field-label" htmlFor="tm-f-kunde">
            Kunde
          </label>
          <input
            id="tm-f-kunde"
            className={`input ${fehler.kunde ? 'invalid' : ''}`}
            list="tm-kunden"
            autoComplete="off"
            spellCheck={false}
            placeholder="Name – aus deinen Kunden oder neu"
            value={form.kunde}
            onChange={(e) => setKunde(e.target.value)}
          />
          <datalist id="tm-kunden">
            {kundenOptionen.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </datalist>
          <KundenHinweis form={form} stamm={stamm} waehle={(label, neuName) => setKunde(label, neuName)} />
          <Fehler text={fehler.kunde} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="tm-f-adresse">
            Adresse
          </label>
          <textarea
            id="tm-f-adresse"
            className="textarea tm-adresse"
            rows={2}
            placeholder={'Straße und Hausnummer\nPLZ Ort'}
            value={form.adresse}
            onChange={(e) => {
              adrAuto.current = !e.target.value.trim();
              set('adresse', e.target.value);
            }}
          />
        </div>
      </section>

      <section>
        <h3>Wann</h3>
        <div className="tm-zeitrow">
          <div className="field">
            <label className="field-label" htmlFor="tm-f-datum">
              Datum
            </label>
            <input
              id="tm-f-datum"
              type="date"
              className={`input ${fehler.datum ? 'invalid' : ''}`}
              value={form.datum}
              onChange={(e) => {
                set('datum', e.target.value);
                fehlerWeg('datum');
              }}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="tm-f-von">
              von
            </label>
            <input
              id="tm-f-von"
              type="time"
              className={`input ${fehler.von ? 'invalid' : ''}`}
              value={form.von}
              onChange={(e) => {
                const von = e.target.value;
                const a = minuten(von);
                const b = minuten(form.bis);
                // „bis“ folgt „von“ (+2 h), solange es nicht selbst geändert wurde oder sonst vor dem Beginn läge
                const nachziehen = a != null && (bisAuto.current || b == null || b <= a);
                if (nachziehen) bisAuto.current = true;
                setForm((f) => ({ ...f, von, bis: nachziehen ? plus2h(von) : f.bis }));
                fehlerWeg('von');
                fehlerWeg('bis');
              }}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="tm-f-bis">
              bis
            </label>
            <input
              id="tm-f-bis"
              type="time"
              className={`input ${fehler.bis ? 'invalid' : ''}`}
              value={form.bis}
              onChange={(e) => {
                bisAuto.current = false;
                set('bis', e.target.value);
                fehlerWeg('bis');
              }}
            />
          </div>
        </div>
        {fehler.datum || fehler.von || fehler.bis ? (
          <Fehler text={fehler.datum ?? fehler.von ?? fehler.bis} />
        ) : wann ? (
          <div className="hint tm-hint tm-wann-hint">
            <span>
              <CalendarDays />
              {wann.tag}
            </span>
            {wann.warnung ? (
              <span className="warn-t">
                <TriangleAlert />
                {wann.warnung}
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      <section>
        <h3>Was</h3>
        <div className="field">
          <label className="field-label" htmlFor="tm-f-leistung">
            Leistung
          </label>
          <input
            id="tm-f-leistung"
            className={`input ${fehler.leistung ? 'invalid' : ''}`}
            list="tm-leistungen"
            autoComplete="off"
            placeholder="z. B. Rasenmähen inkl. Grünschnitt"
            value={form.leistung}
            onChange={(e) => {
              set('leistung', e.target.value);
              fehlerWeg('leistung');
            }}
          />
          <datalist id="tm-leistungen">
            {stamm.leistungen.map((l) => (
              <option key={l.text} value={l.text}>
                {`${l.n}×`}
              </option>
            ))}
          </datalist>
          <Fehler text={fehler.leistung} />
        </div>
        <div className="field tm-betrag-f">
          <label className="field-label" htmlFor="tm-f-betrag">
            Geschätzter Betrag <small className="muted">optional</small>
          </label>
          <div className="input-wrap">
            <input
              id="tm-f-betrag"
              className={`input ${fehler.betrag || betragUnlesbar ? 'invalid' : ''}`}
              inputMode="decimal"
              autoComplete="off"
              placeholder={`z. B. ${vorschlag ? betragFeld(vorschlag.cent) : '65'}`}
              value={form.betrag}
              onChange={(e) => {
                set('betrag', e.target.value);
                fehlerWeg('betrag');
              }}
            />
            <span className="suffix">€</span>
          </div>
          {fehler.betrag || betragUnlesbar ? (
            <Fehler text={BETRAG_FEHLER} />
          ) : !form.betrag.trim() && vorschlag ? (
            <p className="hint">{vorschlag.text}</p>
          ) : null}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="tm-f-notiz">
            Notiz
          </label>
          <textarea
            id="tm-f-notiz"
            className="textarea tm-notiz"
            rows={2}
            placeholder="z. B. Schlüssel beim Nachbarn, Grünschnitt mitnehmen"
            value={form.notiz}
            onChange={(e) => set('notiz', e.target.value)}
          />
        </div>
      </section>

      <BelegBereich t={t} wieder={wieder} mitBeleg={mitBeleg} wahl={form.beleg} setWahl={(w) => set('beleg', w)} stamm={stamm} />

      {fuss ? createPortal(fussInhalt, fuss) : null}
    </>
  );
}

/* ---------- Unter „Kunde“: bekannter Kunde (mit Notiz), Nachfrage bei gleichem Namen oder „neu“ ---------- */

function KundenHinweis({ form, stamm, waehle }: { form: TerminFormular; stamm: TerminStamm; waehle: (label: string, bewusstNeu: string | null) => void }) {
  const k = kundeAufloesen(form.kunde, stamm.kunden, form.kundeBewusstNeu);
  if (k.art === 'leer') return null;
  if (k.art === 'kunde') {
    const x = stamm.kunden.find((y) => y.id === k.kunde.id);
    const ohneAdr = !x?.strasse && !x?.ort;
    return (
      <div className="tm-kunde-hint">
        <p className="hint tm-hint">
          <User />
          <span>
            Bekannter Kunde · {[k.kunde.nummer, k.kunde.ort].filter(Boolean).join(' · ')}
            {ohneAdr && form.adresse.trim() ? ' · Adresse wird beim Kunden ergänzt' : ''}
          </span>
        </p>
        {x?.notiz ? (
          <p className="tm-knotiz">
            <StickyNote />
            <span>{x.notiz}</span>
          </p>
        ) : null}
      </div>
    );
  }
  if (k.art === 'wahl') {
    return (
      <div className="tm-kunde-hint">
        <p className="hint tm-hint">
          <Users />
          <span>{k.liste.length > 1 ? `Mehrere Kunden heißen „${k.name}“ – wer ist gemeint?` : `Es gibt schon einen Kunden „${k.name}“ – ist es derselbe?`}</span>
        </p>
        <div className="tm-kwahl" role="group" aria-label="Kunde wählen">
          {k.liste.map((x) => (
            <button key={x.id} type="button" className="tm-kw" onClick={() => waehle(kundenLabel(x), null)}>
              <b>{x.nummer}</b>
              <span>{x.ort || 'ohne Adresse'}</span>
            </button>
          ))}
          <button type="button" className="tm-kw neu" onClick={() => waehle(k.name, nameSchluessel(k.name))}>
            <Plus />
            <span>Neuer Kunde mit diesem Namen</span>
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="tm-kunde-hint">
      <p className="hint tm-hint tm-neuk">
        <Plus />
        <span>
          {k.namensvettern.length ? `Neuer Kunde „${k.name}“ mit eigener Nummer` : 'Neuer Kunde'} – wird angelegt{form.adresse.trim() ? ' (mit dieser Adresse)' : ''}.
          {k.namensvettern.length === 1 ? (
            <>
              {' '}
              <button type="button" className="link tm-klink" onClick={() => waehle(kundenLabel(k.namensvettern[0]), null)}>
                Doch {k.namensvettern[0].nummer} nehmen
              </button>
            </>
          ) : null}
        </span>
      </p>
    </div>
  );
}

/* ---------- Beleg: vorbereiten, ausgestellt, fehlt ---------- */

function BelegBereich({
  t,
  wieder,
  mitBeleg,
  wahl,
  setWahl,
  stamm,
}: {
  t: Termin | null;
  wieder: boolean;
  mitBeleg: boolean;
  wahl: BelegWahl;
  setWahl: (w: BelegWahl) => void;
  stamm: TerminStamm;
}) {
  const fix = t ? belegAus(t) : null;
  if (t && fix) {
    const art = fix.art === 'rechnung' ? 'rechnung' : 'quittung';
    const Icon = art === 'rechnung' ? FileText : Receipt;
    return (
      <section className="tm-beleg-sec">
        <h3>Beleg</h3>
        <Link className="tm-fix" to={`/belege/${fix.id}`}>
          <Icon />
          <span>
            <b>{fix.nummer}</b> · {ART_LABEL[art]} ausgestellt · {formatBetrag(fix.summe_cent)}
            <small>Ausgestellte Belege bleiben unverändert (GoBD) – Änderungen am Termin betreffen sie nicht.</small>
          </span>
          <ChevronRight />
        </Link>
      </section>
    );
  }
  if (t && t.status === 'erledigt' && !wieder) {
    if (t.einnahme) {
      const e = t.einnahme;
      return (
        <section className="tm-beleg-sec">
          <h3>Beleg</h3>
          <button type="button" className="tm-fix" onClick={() => einnahmeOeffnen(t)}>
            <Check />
            <span>
              <strong>Bezahlt ohne Beleg</strong> · Einnahme {formatBetrag(e.betrag_cent)} am {datumKurz(e.zahlungsdatum)} · {zahlungswegName(e.zahlungsart)}
              <small>Die Einnahme ist gebucht – einen eigenen Beleg gibt es dazu bewusst nicht.</small>
            </span>
            <ChevronRight />
          </button>
        </section>
      );
    }
    if (t.ohne_beleg) {
      return (
        <section className="tm-beleg-sec">
          <h3>Beleg</h3>
          <p className="hint tm-hint">
            <Check />
            <span>Ohne Beleg abgeschlossen (z. B. Nachbesserung, kostenlos).</span>
          </p>
        </section>
      );
    }
    const art = ausstellArt(t, stamm.belegArt);
    const Icon = art === 'rechnung' ? FileText : Receipt;
    const b = betragAnzeige(t);
    return (
      <section className="tm-beleg-sec">
        <h3>Beleg</h3>
        <p className="tm-note warn">
          <TriangleAlert />
          <span>
            Beleg fehlt – der Termin ist erledigt.
            {t.entwurf ? ` Die vorbereitete ${ART_LABEL[art]} bekommt beim Ausstellen ihre Nummer.` : ''}
            {b ? ` Betrag ${b.ist ? '' : 'ca. '}${formatBetrag(b.cent)}.` : ''}
          </span>
        </p>
        <div className="row">
          <button type="button" className="btn-primary sm" onClick={() => belegAusstellen(t, stamm.belegArt)}>
            <Icon />
            {ausstellLabel(art)}
          </button>
        </div>
      </section>
    );
  }
  if (!mitBeleg) return null;
  return (
    <section className="tm-beleg-sec">
      <h3>Beleg vorbereiten</h3>
      <Seg<BelegWahl>
        className="full"
        ariaLabel="Beleg vorbereiten"
        value={wahl}
        onChange={setWahl}
        options={[
          {
            value: 'quittung',
            label: (
              <>
                <Receipt />
                Quittung
              </>
            ),
          },
          {
            value: 'rechnung',
            label: (
              <>
                <FileText />
                Rechnung
              </>
            ),
          },
          { value: 'keinen', label: 'Keinen' },
        ]}
      />
      <p className="hint tm-hint">
        <Info />
        <span>{vorbereitenHinweis(wahl, t?.entwurf?.art ?? null, stamm.zielTage)}</span>
      </p>
    </section>
  );
}

/* ================= Absagen ================= */

function AbsagenAnsicht({ t, ausSchublade, fuss }: { t: Termin; ausSchublade: boolean; fuss: HTMLDivElement | null }) {
  const [grund, setGrund] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const h = heute();
  const name = t.kunde_name ?? 'ohne Kunde';
  const art = t.entwurf ? ART_LABEL[ausstellArt(t, 'quittung')] : null;

  const los = useCallback(async () => {
    if (laeuft) return;
    setLaeuft(true);
    const ok = await absagen(t, grund);
    setLaeuft(false);
    if (ok) terminSchliessen();
  }, [laeuft, t, grund]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void los();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [los]);

  useEffect(() => {
    const tm = setTimeout(() => document.getElementById('tm-grund')?.focus({ preventScroll: true }), 120);
    return () => clearTimeout(tm);
  }, []);

  const fussInhalt: ReactNode = (
    <>
      <span className="spacer" />
      <button type="button" className="btn ghost" onClick={() => (ausSchublade ? terminOeffnen(t.id) : terminSchliessen())}>
        {ausSchublade ? <RotateCcw /> : null}
        Zurück
      </button>
      <button type="button" className="btn danger" disabled={laeuft} onClick={() => void los()}>
        <X />
        Termin absagen
      </button>
    </>
  );

  return (
    <section>
      <div className="tm-kurz">
        <Monogramm name={name} size="sm" />
        <div>
          <b>{name}</b>
          <small>
            {t.leistung} · {tagLang(t.datum, h)}
            {t.von ? `, ${zeitText(t)}` : ''}
          </small>
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="tm-grund">
          Grund <small className="muted">optional</small>
        </label>
        <textarea
          id="tm-grund"
          className="textarea"
          rows={2}
          placeholder="z. B. Kunde krank, Regen – wird an die Notiz angehängt"
          value={grund}
          onChange={(e) => setGrund(e.target.value)}
        />
      </div>
      {art ? (
        <p className="tm-note">
          <Info />
          <span>Die vorbereitete {art} hatte noch keine Nummer – sie wird einfach verworfen, ein Storno ist nicht nötig.</span>
        </p>
      ) : null}
      {fuss ? createPortal(fussInhalt, fuss) : null}
    </section>
  );
}
