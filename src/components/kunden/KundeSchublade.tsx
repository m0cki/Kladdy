/* Kunden-Schublade (§6.8, 560 px): Kopf mit Monogramm, Kundennummer, Adresse/Telefon/E-Mail (öffnen Karten, Telefon,
 * Mail über Rust `link_oeffnen`), Kennzeile („3 Besuche · zuletzt vor 12 Tagen · Kunde seit März 2025“) und Hinweisen
 * (nächster Termin, nachzutragende Termine, offene Rechnungen) · Notiz (speichert selbst: kurz nach dem Tippen, beim
 * Verlassen des Feldes und beim Schließen) · Stammdaten (einklappbar) · Verlauf neueste zuerst.
 * Fuß: Löschen nur ohne Bezüge, sonst Schloss „Löschen ab JJJJ“; „Neuen Auftrag erfassen“ öffnet die eine
 * Erfassen-Schublade vorbelegt (Einnahme für diesen Kunden). Im Modus „neu“ dieselbe Schublade als Formular.
 * Geöffnet nur über lib/kunden-schublade.ts; hängt im AppShell. Geschrieben wird nur über Rust (kunden.rs). */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  FileText,
  Info,
  Lock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Trash2,
  TriangleAlert,
  User,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { datumKurz, zahlungswegName, type KundeKurz } from '../../lib/buchungen';
import { datenbankVerfuegbar } from '../../lib/db';
import { bearbeiten, erfassen } from '../../lib/erfassen';
import { fehlerText } from '../../lib/fehler';
import {
  ART_NAME,
  STATUS_BADGE,
  adresseVoll,
  formularAus,
  gleicherName,
  kartenLink,
  kennzeile,
  kundenIndex,
  leeresKundeFormular,
  loeschenAb,
  mailLink,
  notizWert,
  pruefeKunde,
  telLink,
  terminLang,
  vorText,
  zeitspanne,
  type Eintrag,
  type KundeFormular,
  type KundenFeld,
  type KundenInfo,
  type KundeZeile,
  type VerlaufArt,
} from '../../lib/kunden';
import { kundeOeffnen, kundeSchliessen, useKundeSchublade } from '../../lib/kunden-schublade';
import { formatBetrag } from '../../lib/money';
import { ladeKundenKurz } from '../../lib/queries/buchungen';
import { kundeAendern, kundeAnlegen, kundeLoeschen, kundeNotiz, ladeKunde, ladeVerlauf, linkOeffnen } from '../../lib/queries/kunden';
import { heute } from '../../lib/zeitraum';
import { useUi } from '../../store/ui';
import { Drawer } from '../ui/Drawer';
import { EmptyState } from '../ui/EmptyState';
import { ZAHLUNGSWEG_ICON } from '../buchungen/Symbole';
import { BelegClip } from '../belege/BelegClip';
import { Monogramm } from './Monogramm';

const NOTIZ_HINWEIS = 'Nur notieren, was du für den Auftrag brauchst, keine Angaben zu Gesundheit, Religion o. Ä.';
const NOTIZ_BEISPIEL = 'z. B. Hund im Garten, Tor immer schließen';
const NOTIZ_PAUSE_MS = 900;

const ART_ICON: Readonly<Record<VerlaufArt, LucideIcon>> = {
  quittung: Receipt,
  rechnung: FileText,
  angebot: ClipboardList,
  einnahme: ArrowLeftRight,
  termin: CalendarDays,
};

const warnToast = (text: string) => useUi.getState().showToast({ text, icon: 'warn', sticky: true });

export function KundeSchublade() {
  const open = useUi((s) => s.drawer === 'kunde');
  const auftrag = useKundeSchublade((s) => s.auftrag);
  // Der Fuß gehört dem Inhalt (Löschen/Anlegen hängen an dessen Zustand): Inhalt rendert per Portal in diesen Platz.
  const [fuss, setFuss] = useState<HTMLDivElement | null>(null);
  const neu = auftrag?.art === 'neu';

  return (
    <Drawer
      open={open}
      onClose={kundeSchliessen}
      title={neu ? 'Kunde anlegen' : 'Kunde'}
      icon={neu ? UserPlus : User}
      width={560}
      className="ku-drawer"
      foot={<div className="ku-fuss" ref={setFuss} />}
    >
      {auftrag?.art === 'neu' ? (
        <NeuerKunde key={auftrag.n} name={auftrag.name} open={open} fuss={fuss} />
      ) : auftrag ? (
        <KundeAnsicht key={auftrag.n} id={auftrag.id} open={open} fuss={fuss} />
      ) : null}
    </Drawer>
  );
}

/* ================= Formularfelder (Anlegen und Stammdaten) ================= */

interface FelderProps {
  form: KundeFormular;
  fehler: Partial<Record<KundenFeld, string>>;
  setze: (feld: KundenFeld, wert: string) => void;
  mitNotiz: boolean;
  nameRef?: RefObject<HTMLInputElement | null>;
  strasseRef?: RefObject<HTMLInputElement | null>;
  /** unter dem Namen (Hinweis auf gleichen Namen) */
  nachName?: ReactNode;
}

function Felder({ form, fehler, setze, mitNotiz, nameRef, strasseRef, nachName }: FelderProps) {
  const feld = (name: KundenFeld, label: ReactNode, extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {}, ref?: RefObject<HTMLInputElement | null>) => (
    <div className="field">
      <label htmlFor={`ku-${name}`}>{label}</label>
      <input
        ref={ref}
        id={`ku-${name}`}
        className={`input ${fehler[name] ? 'invalid' : ''}`}
        value={form[name]}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setze(name, e.target.value)}
        aria-invalid={fehler[name] ? true : undefined}
        {...extra}
      />
      {fehler[name] ? (
        <p className="hint neg-t" role="alert">
          {fehler[name]}
        </p>
      ) : null}
    </div>
  );
  return (
    <div className="form-grid ku-form">
      <div className="full">
        {feld(
          'name',
          <>
            Name <span className="ku-pfl">Pflicht</span>
          </>,
          { placeholder: 'Vor- und Nachname oder Firma', required: true },
          nameRef,
        )}
      </div>
      {nachName}
      <div className="full">{feld('zusatz', 'Zusatz', { placeholder: 'z. B. Ansprechpartner, Objekt' })}</div>
      <div className="full">{feld('strasse', 'Straße und Hausnummer', {}, strasseRef)}</div>
      <div className="full ku-plzort">
        {feld('plz', 'PLZ', { inputMode: 'numeric', maxLength: 10 })}
        {feld('ort', 'Ort')}
      </div>
      {feld('telefon', 'Telefon', { type: 'tel' })}
      {feld('email', 'E-Mail', { type: 'email' })}
      {mitNotiz ? (
        <div className="field full">
          <label htmlFor="ku-notiz-neu">Notiz</label>
          <textarea id="ku-notiz-neu" className="textarea" rows={2} value={form.notiz} placeholder={NOTIZ_BEISPIEL} onChange={(e) => setze('notiz', e.target.value)} />
          <p className="hint ku-notiz-hint">{NOTIZ_HINWEIS}</p>
        </div>
      ) : null}
    </div>
  );
}

/* ================= Neuer Kunde ================= */

function NeuerKunde({ name, open, fuss }: { name: string; open: boolean; fuss: HTMLDivElement | null }) {
  const [form, setForm] = useState<KundeFormular>(() => leeresKundeFormular(name));
  const [fehler, setFehler] = useState<Partial<Record<KundenFeld, string>>>({});
  const [speichert, setSpeichert] = useState(false);
  const [kunden, setKunden] = useState<KundeKurz[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);
  const setUngespeichert = useUi((s) => s.setUngespeichert);

  useEffect(() => {
    if (!datenbankVerfuegbar()) return;
    let aktiv = true;
    ladeKundenKurz()
      .then((l) => aktiv && setKunden(l))
      .catch(() => undefined); // nur für den Hinweis auf gleiche Namen
    return () => {
      aktiv = false;
    };
  }, []);

  // Fokus ins Namensfeld, wenn die Schublade hereingeglitten ist
  useEffect(() => {
    const t = setTimeout(() => {
      const i = nameRef.current;
      if (i) {
        i.focus({ preventScroll: true });
        i.setSelectionRange(i.value.length, i.value.length);
      }
    }, 80);
    return () => clearTimeout(t);
  }, []);

  const dirty = Object.values(form).some((v) => v.trim());
  useEffect(() => {
    if (open) setUngespeichert(dirty);
  }, [open, dirty, setUngespeichert]);

  const gleich = useMemo(() => gleicherName(form.name, kunden), [form.name, kunden]);

  const setze = (feld: KundenFeld, wert: string) => {
    setForm((f) => ({ ...f, [feld]: wert }));
    if (fehler[feld]) setFehler((x) => ({ ...x, [feld]: undefined }));
  };

  const anlegen = async (e?: FormEvent) => {
    e?.preventDefault();
    if (speichert) return;
    const p = pruefeKunde(form);
    if (!p.ok) {
      setFehler(p.fehler);
      if (p.fehler.name) nameRef.current?.focus();
      return;
    }
    setSpeichert(true);
    try {
      const r = await kundeAnlegen(p.daten, heute());
      const ui = useUi.getState();
      ui.setUngespeichert(false);
      ui.datenGeaendert();
      ui.toast(`${p.daten.name} angelegt · ${r.nummer}`);
      kundeOeffnen(r.id);
    } catch (err) {
      warnToast(`Anlegen ging nicht: ${fehlerText(err)}`);
      setSpeichert(false);
    }
  };

  const hinweis = gleich.length ? (
    <p className="hint full ku-dup">
      <Info />
      <span>
        Gibt es schon:{' '}
        {gleich.slice(0, 3).map((k, i) => (
          <span key={k.id}>
            {i ? ', ' : ''}
            <button type="button" className="link" onClick={() => kundeOeffnen(k.id)}>
              {[k.nummer, k.ort].filter(Boolean).join(' · ')}
            </button>
          </span>
        ))}
        {gleich.length > 3 ? ` (+${gleich.length - 3})` : ''}. Trotzdem neu anlegen? Jeder Kunde bekommt seine eigene Nummer.
      </span>
    </p>
  ) : null;

  return (
    <>
      <section>
        <h3>Stammdaten</h3>
        <form id="ku-form-neu" noValidate onSubmit={(e) => void anlegen(e)}>
          <Felder form={form} fehler={fehler} setze={setze} mitNotiz nameRef={nameRef} nachName={hinweis} />
        </form>
      </section>
      {fuss
        ? createPortal(
            <>
              <span className="spacer" />
              <button type="button" className="btn ghost" onClick={kundeSchliessen}>
                Abbrechen
              </button>
              <button type="submit" form="ku-form-neu" className="btn-primary sm" disabled={speichert}>
                <Check />
                Kunde anlegen
              </button>
            </>,
            fuss,
          )
        : null}
    </>
  );
}

/* ================= Bestehender Kunde ================= */

type Laden =
  | { status: 'laden' }
  | { status: 'ohne-db' }
  | { status: 'weg' }
  | { status: 'fehler'; fehler: string }
  | { status: 'ok'; info: KundenInfo; heute: string };

const LOESCH_FRAGE = 'kunde-loeschen';

function KundeAnsicht({ id, open, fuss }: { id: number; open: boolean; fuss: HTMLDivElement | null }) {
  const datenStand = useUi((s) => s.datenStand);
  const setUngespeichert = useUi((s) => s.setUngespeichert);
  const [laden, setLaden] = useState<Laden>(() => (datenbankVerfuegbar() ? { status: 'laden' } : { status: 'ohne-db' }));

  useEffect(() => {
    if (!datenbankVerfuegbar()) return;
    let aktiv = true;
    void (async () => {
      try {
        const [k, verlauf] = await Promise.all([ladeKunde(id), ladeVerlauf(id)]);
        if (!aktiv) return;
        if (!k) return setLaden({ status: 'weg' });
        const h = heute();
        const info = kundenIndex([k], verlauf, h).get(id);
        setLaden(info ? { status: 'ok', info, heute: h } : { status: 'weg' });
      } catch (e) {
        if (aktiv) setLaden({ status: 'fehler', fehler: fehlerText(e) });
      }
    })();
    return () => {
      aktiv = false;
    };
  }, [id, datenStand]);

  // Gibt es den Kunden nicht (mehr)? Nur melden, solange die Schublade offen ist (nach dem Löschen nicht).
  useEffect(() => {
    if (laden.status === 'weg' && open) {
      useUi.getState().toast('Diesen Kunden gibt es nicht (mehr).', 'warn');
      kundeSchliessen();
    }
  }, [laden.status, open]);

  /* ---------- Notiz: speichert selbst ---------- */
  const k = laden.status === 'ok' ? laden.info.k : null;
  const [notiz, setNotiz] = useState<string | null>(null); // null = wie gespeichert (noch nicht angefasst)
  const notizText = notiz ?? k?.notiz ?? '';
  const [notizStand, setNotizStand] = useState<'ruhe' | 'tippt' | 'gespeichert'>('ruhe');
  const ausstehend = useRef<string | null>(null);
  const dbNotiz = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastGezeigt = useRef(false);

  useEffect(() => {
    if (k) dbNotiz.current = notizWert(k.notiz ?? '');
  }, [k]);

  const notizSpeichern = useCallback(() => {
    clearTimeout(timer.current);
    const text = ausstehend.current;
    if (text === null) return;
    ausstehend.current = null;
    const wert = notizWert(text);
    if (wert === dbNotiz.current) {
      setNotizStand('ruhe');
      return;
    }
    kundeNotiz(id, wert)
      .then((r) => {
        dbNotiz.current = wert;
        setNotizStand('gespeichert');
        const ui = useUi.getState();
        if (r.geaendert) ui.datenGeaendert();
        if (!toastGezeigt.current) {
          toastGezeigt.current = true;
          ui.toast('Notiz gespeichert');
        }
      })
      .catch((e: unknown) => {
        setNotizStand('ruhe');
        warnToast(`Notiz nicht gespeichert: ${fehlerText(e)}`);
      });
  }, [id]);

  // Schließen (Esc, Hintergrund, Seitenwechsel, Erfassen-Schublade) und Wechsel zu einem anderen Kunden: sofort speichern
  useEffect(() => {
    if (!open) notizSpeichern();
  }, [open, notizSpeichern]);
  useEffect(() => () => notizSpeichern(), [notizSpeichern]);

  const notizAendern = (text: string) => {
    setNotiz(text);
    ausstehend.current = text;
    setNotizStand('tippt');
    clearTimeout(timer.current);
    timer.current = setTimeout(notizSpeichern, NOTIZ_PAUSE_MS);
  };

  /* ---------- Stammdaten ---------- */
  const [stammOffen, setStammOffen] = useState(false);
  const [stamm, setStamm] = useState<KundeFormular | null>(null); // null = unverändert
  const [fehler, setFehler] = useState<Partial<Record<KundenFeld, string>>>({});
  const [speichert, setSpeichert] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const strasseRef = useRef<HTMLInputElement>(null);
  const formular = stamm ?? (k ? formularAus(k) : leeresKundeFormular());
  const stammDirty = !!k && stamm !== null && JSON.stringify(stamm) !== JSON.stringify(formularAus(k));

  useEffect(() => {
    if (open) setUngespeichert(stammDirty);
  }, [open, stammDirty, setUngespeichert]);

  const setze = (feld: KundenFeld, wert: string) => {
    setStamm({ ...formular, [feld]: wert });
    if (fehler[feld]) setFehler((x) => ({ ...x, [feld]: undefined }));
  };
  const stammVerwerfen = () => {
    setStamm(null);
    setFehler({});
    setStammOffen(false);
  };
  const ergaenzen = () => {
    setStammOffen(true);
    requestAnimationFrame(() => strasseRef.current?.focus());
  };

  const stammSpeichern = async (e: FormEvent) => {
    e.preventDefault();
    if (speichert) return;
    // Notiz geht im selben Vorgang mit (ein Protokolleintrag)
    const p = pruefeKunde({ ...formular, notiz: notizText });
    if (!p.ok) {
      setFehler(p.fehler);
      if (p.fehler.name) nameRef.current?.focus();
      return;
    }
    clearTimeout(timer.current);
    ausstehend.current = null;
    setSpeichert(true);
    try {
      const r = await kundeAendern(id, p.daten);
      dbNotiz.current = p.daten.notiz;
      const ui = useUi.getState();
      ui.setUngespeichert(false);
      if (r.geaendert) ui.datenGeaendert();
      ui.toast(r.geaendert ? 'Stammdaten gespeichert' : 'Nichts geändert', r.geaendert ? 'check' : 'info');
      setStamm(null);
      setFehler({});
      setStammOffen(false);
    } catch (err) {
      warnToast(`Speichern ging nicht: ${fehlerText(err)}`);
    } finally {
      setSpeichert(false);
    }
  };

  /* ---------- Aktionen ---------- */
  const auftragErfassen = () => {
    notizSpeichern();
    erfassen({ typ: 'einnahme', kunde: id });
  };

  const loeschen = (kunde: KundeZeile) => {
    const ui = useUi.getState();
    const frageWeg = () => {
      const t = useUi.getState().toasts.find((x) => x.key === LOESCH_FRAGE);
      if (t) useUi.getState().dismissToast(t.id);
    };
    ui.showToast({
      key: LOESCH_FRAGE,
      text: `${kunde.name} (${kunde.nummer}) löschen? Die Kundennummer wird nicht wieder vergeben, das Protokoll behält die Angaben.`,
      icon: 'warn',
      sticky: true,
      actions: [
        {
          label: 'Löschen',
          run: () => {
            frageWeg();
            void (async () => {
              try {
                clearTimeout(timer.current);
                ausstehend.current = null; // eine offene Notiz gehört zum gelöschten Kunden
                await kundeLoeschen(kunde.id);
                kundeSchliessen();
                const u = useUi.getState();
                u.datenGeaendert();
                u.toast(`${kunde.name} gelöscht`);
              } catch (e) {
                warnToast(`Löschen ging nicht: ${fehlerText(e)}`);
              }
            })();
          },
        },
        { label: 'Abbrechen', run: frageWeg },
      ],
    });
  };

  if (laden.status !== 'ok') {
    return laden.status === 'ohne-db' ? (
      <section>
        <EmptyState icon={User} title="Nur in der Mac-App">
          Kunden liegen in der Datenbank auf diesem Mac. Im Browser-Vorschaumodus gibt es sie nicht.
        </EmptyState>
      </section>
    ) : laden.status === 'fehler' ? (
      <section>
        <EmptyState icon={TriangleAlert} title="Konnte nicht geladen werden">
          {laden.fehler}
        </EmptyState>
      </section>
    ) : (
      <section aria-busy="true">
        <div className="sk ku-sk" />
      </section>
    );
  }

  const x = laden.info;
  const kunde = x.k;
  const h = laden.heute;

  return (
    <>
      <Kopf x={x} h={h} ergaenzen={ergaenzen} />

      <section className="ku-notiz-sec">
        <div className="ku-sec-h">
          <h3>
            <label htmlFor="ku-notiz">Notiz</label>
          </h3>
          <span aria-live="polite">
            {notizStand === 'tippt' ? (
              '…'
            ) : notizStand === 'gespeichert' ? (
              <>
                <Check />
                gespeichert
              </>
            ) : (
              'speichert automatisch'
            )}
          </span>
        </div>
        <textarea
          id="ku-notiz"
          className={`textarea ku-notiz ${notizText.trim() ? 'voll' : ''}`}
          rows={2}
          value={notizText}
          placeholder={NOTIZ_BEISPIEL}
          onChange={(e) => notizAendern(e.target.value)}
          onFocus={() => {
            toastGezeigt.current = false;
          }}
          onBlur={notizSpeichern}
        />
        <p className="hint ku-notiz-hint">{NOTIZ_HINWEIS}</p>
      </section>

      <section className="ku-stamm-sec">
        <details className="ku-stamm" open={stammOffen} onToggle={(e) => setStammOffen(e.currentTarget.open)}>
          <summary>
            <Pencil />
            <span>Stammdaten bearbeiten</span>
            <ChevronDown className="ic ku-chev" />
          </summary>
          <form noValidate onSubmit={(e) => void stammSpeichern(e)}>
            <Felder form={formular} fehler={fehler} setze={setze} mitNotiz={false} nameRef={nameRef} strasseRef={strasseRef} />
            <p className="hint ku-gobd">
              <Lock />
              <span>Bereits ausgestellte Belege behalten ihre Angaben (GoBD). Änderungen gelten für neue Belege.</span>
            </p>
            <div className="row">
              <button type="submit" className="btn-primary sm" disabled={speichert}>
                <Check />
                Speichern
              </button>
              <button type="button" className="btn ghost" onClick={stammVerwerfen}>
                Abbrechen
              </button>
            </div>
          </form>
        </details>
      </section>

      <Verlauf x={x} h={h} />

      {fuss
        ? createPortal(
            <>
              {kunde.gebunden ? (
                <FristHinweis k={kunde} h={h} />
              ) : (
                <button type="button" className="btn danger ku-del" title="Kunde löschen" aria-label="Kunde löschen" onClick={() => loeschen(kunde)}>
                  <Trash2 />
                </button>
              )}
              <span className="spacer" />
              {/* „Termin eintragen“ kommt mit den Terminen (Phase 3): öffnet dann die Termin-Schublade vorbelegt mit diesem Kunden. */}
              <button type="button" className="btn-primary sm" onClick={auftragErfassen}>
                <Plus />
                Neuen Auftrag erfassen
              </button>
            </>,
            fuss,
          )
        : null}
    </>
  );
}

/* ---------- Kopf ---------- */

function Weg({ url, icon: Icon, title, children }: { url: string; icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      className="ku-weg"
      title={title}
      onClick={() => linkOeffnen(url).catch((e: unknown) => warnToast(fehlerText(e)))}
    >
      <Icon />
      <span>{children}</span>
    </button>
  );
}

function Kopf({ x, h, ergaenzen }: { x: KundenInfo; h: string; ergaenzen: () => void }) {
  const k = x.k;
  const adresse = adresseVoll(k);
  const karte = kartenLink(k);
  const tel = telLink(k.telefon);
  const mail = mailLink(k.email);
  const n = x.naechster;
  const hatWege = !!(adresse || k.telefon || k.email);

  return (
    <section className="ku-kopf">
      <Monogramm name={k.name} size="lg" />
      <div className="ku-kopf-t">
        <div className="ku-name">
          {k.name}
          <span className="ku-knr" title="Kundennummer">
            {k.nummer}
          </span>
        </div>
        {k.zusatz ? <div className="ku-zusatz">{k.zusatz}</div> : null}
        {hatWege ? (
          <div className="ku-wege">
            {adresse ? (
              karte ? (
                <Weg url={karte} icon={MapPin} title="In Karten öffnen">
                  {adresse}
                </Weg>
              ) : null
            ) : null}
            {k.telefon ? (
              tel ? (
                <Weg url={tel} icon={Phone} title="Anrufen">
                  {k.telefon}
                </Weg>
              ) : (
                <span className="ku-weg">
                  <Phone />
                  <span>{k.telefon}</span>
                </span>
              )
            ) : null}
            {k.email ? (
              mail ? (
                <Weg url={mail} icon={Mail} title="E-Mail schreiben">
                  {k.email}
                </Weg>
              ) : (
                <span className="ku-weg">
                  <Mail />
                  <span>{k.email}</span>
                </span>
              )
            ) : null}
          </div>
        ) : (
          <button type="button" className="link ku-ergaenzen" onClick={ergaenzen}>
            <Plus />
            Adresse oder Telefon ergänzen
          </button>
        )}
        <p className="ku-kenn">
          {kennzeile(x, h).map((t, i) => (
            <span key={t}>
              {i ? <i>·</i> : null}
              {i === 0 && x.besuche ? <b>{t}</b> : t}
            </span>
          ))}
        </p>
        {/* Termine öffnen sich ab Phase 3 (Seite Termine); bis dahin sind die Hinweise reine Anzeige. */}
        {n ? (
          <div className="ku-hw">
            <CalendarDays />
            <span>
              <b>Nächster Termin:</b> {terminLang(n.z, h)} · {n.titel}
            </span>
            {n.z.datum > h ? <small>{vorText(n.z.datum, h)}</small> : null}
          </div>
        ) : null}
        {x.nachtragen.map((e) => (
          <div key={e.z.id} className="ku-hw warn">
            <CalendarDays />
            <span>
              <b>Termin {terminLang(e.z, h)}</b> · {e.titel}, noch nicht erledigt
            </span>
            <small>nachtragen</small>
          </div>
        ))}
        {x.offen.map((e) => {
          const ueber = e.status === 'ueberfaellig';
          return (
            <Link key={e.z.id} className={`ku-hw ${ueber ? 'neg' : ''}`} to={`/belege/${e.z.id}`} title="Rechnung öffnen">
              {ueber ? <TriangleAlert /> : <Clock />}
              <span>
                <b className="mono">{e.z.nummer ?? 'Rechnung'}</b> · {formatBetrag(e.z.betrag_cent ?? 0)} offen
                {e.z.faellig_am ? `, ${ueber ? `fällig seit ${datumKurz(e.z.faellig_am)}` : `fällig ${faelligText(e.z.faellig_am, h)}`}` : ''}
              </span>
              <ChevronRight />
            </Link>
          );
        })}
      </div>
    </section>
  );
}

const faelligText = (faellig: string, h: string): string => (faellig === h ? 'heute' : vorText(faellig, h));

/* ---------- Verlauf ---------- */

function Verlauf({ x, h }: { x: KundenInfo; h: string }) {
  const kommend = (e: Eintrag) => e.z.datum > h || (e.status === 'geplant' && e.z.datum === h);
  const teile = [
    x.besuche ? `${x.besuche} ${x.besuche === 1 ? 'Besuch' : 'Besuche'}` : 'noch kein Besuch',
    x.geplant ? `${x.geplant} ${x.geplant === 1 ? 'Termin' : 'Termine'} geplant` : '',
    x.angebote ? `${x.angebote} ${x.angebote === 1 ? 'Angebot' : 'Angebote'}` : '',
  ].filter(Boolean);
  const zeilen: ReactNode[] = [];
  let trenner = x.eintraege.some(kommend);
  for (const e of x.eintraege) {
    if (trenner && !kommend(e)) {
      zeilen.push(
        <li key="heute" className="ku-heute" aria-hidden="true">
          <span>heute</span>
        </li>,
      );
      trenner = false;
    }
    zeilen.push(<VerlaufEintrag key={`${e.z.quelle}-${e.z.id}`} e={e} h={h} />);
  }
  return (
    <section className="ku-verlauf">
      <div className="ku-sec-h">
        <h3>Verlauf</h3>
        <span>{teile.join(' · ')}</span>
      </div>
      {x.eintraege.length ? (
        <ol className="ku-tl">{zeilen}</ol>
      ) : (
        <p className="hint">Noch nichts erfasst. Mit „Neuen Auftrag erfassen“ trägst du den ersten Besuch ein.</p>
      )}
    </section>
  );
}

function VerlaufEintrag({ e, h }: { e: Eintrag; h: string }) {
  const z = e.z;
  const badge = STATUS_BADGE[e.status];
  const ArtIcon = ART_ICON[z.art];
  const ZwIcon = z.zahlungsart ? ZAHLUNGSWEG_ICON[z.zahlungsart] : null;

  let nummer: ReactNode = null;
  if (z.quelle === 'beleg') {
    nummer = (
      <Link className={`ku-nr ${z.nummer ? '' : 'leer'}`} to={`/belege/${z.id}`} title={`${ART_NAME[z.art]} öffnen`}>
        <ArtIcon />
        {z.nummer ?? 'Entwurf'}
      </Link>
    );
  } else if (z.quelle === 'einnahme') {
    const text = z.belegnummer || z.nummer || 'Einnahme';
    nummer =
      e.status === 'storniert' ? (
        <span className="ku-nr leer">
          <ArtIcon />
          {text}
        </span>
      ) : (
        <button type="button" className="ku-nr" title="Einnahme öffnen" onClick={() => bearbeiten(z.id)}>
          <ArtIcon />
          {text}
        </button>
      );
  } else {
    // Termin: Link auf die Terminansicht kommt mit Phase 3
    nummer = (
      <span className="ku-nr txt">
        <CalendarDays />
        Termin{z.von ? ` ${zeitspanne(z.von, z.bis)}` : ''}
      </span>
    );
  }

  const vb = e.vorbereitet;
  const frist =
    z.art === 'rechnung' && z.faellig_am && (e.status === 'offen' || e.status === 'ueberfaellig')
      ? e.status === 'ueberfaellig'
        ? `fällig seit ${datumKurz(z.faellig_am)}`
        : `fällig ${faelligText(z.faellig_am, h)}`
      : '';
  const unter = z.quelle === 'termin' ? z.notiz : z.positionen && z.positionen !== e.titel ? z.positionen : null;

  return (
    <li className={`ku-ev s-${e.status} ${z.quelle === 'termin' ? 'ku-ev-t' : ''}`}>
      <div className="ku-ev-d">
        <b className="num">{datumKurz(z.datum)}</b>
        <small>{vorText(z.datum, h)}</small>
      </div>
      <div className="ku-ev-m">
        <b>{e.titel}</b>
        {unter ? <small className={z.quelle === 'termin' ? 'ku-ev-ntz' : undefined}>{unter}</small> : null}
        <span className="ku-ev-meta">
          {nummer}
          {z.quelle === 'einnahme' && z.belege_anzahl ? <BelegClip buchungId={z.id} anzahl={z.belege_anzahl} /> : null}
          {vb ? (
            <Link className="ku-nr txt" to={`/belege/${vb.id}`} title="Vorbereiteten Beleg öffnen">
              <FileText />
              {ART_NAME[vb.art]} vorbereitet
            </Link>
          ) : null}
          {ZwIcon && z.zahlungsart ? (
            <span>
              <ZwIcon />
              {zahlungswegName(z.zahlungsart)}
            </span>
          ) : null}
          {frist ? (
            <span className={e.status === 'ueberfaellig' ? 'neg-t' : undefined}>
              <Clock />
              {frist}
            </span>
          ) : null}
        </span>
      </div>
      <div className="ku-ev-r">
        {z.betrag_cent != null && (z.quelle !== 'termin' || z.betrag_cent > 0) ? (
          <b className="num" title={z.quelle === 'termin' ? 'geschätzt' : undefined}>
            {z.quelle === 'termin' ? 'ca. ' : ''}
            {formatBetrag(z.betrag_cent)}
          </b>
        ) : null}
        <span className={`badge ${badge.klasse}`}>{badge.text}</span>
      </div>
    </li>
  );
}

/* ---------- Fuß: Aufbewahrungsfrist statt Löschen ---------- */

function FristHinweis({ k, h }: { k: KundeZeile; h: string }) {
  const f = loeschenAb(k.frist_datum);
  if (!f) {
    return (
      <span
        className="ku-frist"
        tabIndex={0}
        title="An diesem Kunden hängen noch Termine, Fahrten oder Entwürfe. Löschen geht erst, wenn nichts mehr daran hängt."
      >
        <Lock />
        Löschen gesperrt
      </span>
    );
  }
  if (Number(h.slice(0, 4)) >= f.ab) {
    return (
      <span className="ku-frist" tabIndex={0} title={`Aufbewahrungsfrist bis ${datumKurz(f.bis)} abgelaufen. Anonymisieren kommt mit einem späteren Update.`}>
        <Lock />
        Frist abgelaufen
      </span>
    );
  }
  return (
    <span className="ku-frist" tabIndex={0} title={`Aufzubewahren bis ${datumKurz(f.bis)}, danach anonymisierbar`}>
      <Lock />
      Löschen ab {f.ab}
    </span>
  );
}
