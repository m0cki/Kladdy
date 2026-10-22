/* Beleg-Maske (§6.6): EINE Maske für Rechnung, Quittung, Angebot und Eigenbeleg – links das Formular in Karten je Art,
 * rechts die Live-Papiervorschau (skaliert auf die Spaltenbreite), darunter die klebende Aktionsleiste.
 * - Neu (/belege/neu?art=…&betrag=…&datum=…&text=…&kunde=…&name=…&zahlungsart=…&bezahlt=1&kategorie=…&buchung=…),
 *   Entwurf (frei änderbar, „Als Entwurf speichern“ ⌘S) oder ausgestellt (gesperrt; Status-Menü am Badge, PDF, Mail,
 *   unterschriebenes Exemplar).
 * - Ausstellen = Finalisieren (bei Quittung „Finalisieren & buchen“, Eigenbeleg „Buchen“): Rust vergibt die Nummer,
 *   legt ggf. den Kunden an, friert Dokument und Bausteine ein und bucht die Zahlung – eine Transaktion; danach setzt
 *   Tectonic das PDF aus dem Schnappschuss und Rust legt es ab. Vorher Pflichtangaben-Check (§2.3) und Kundenklärung.
 * - Kunde per ID („Name · K-0012“), bei gleichem Namen wird nachgefragt (wie in der Erfassen-Schublade).
 * Optik und Verhalten wie referenz/prototyp/js/pages/belege.js (renderBeleg); Logik in lib/rechnungen.ts. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { open as dateiDialog } from '@tauri-apps/plugin-dialog';
import {
  Banknote,
  Blocks,
  CalendarDays,
  Check,
  ChevronLeft,
  CircleCheck,
  Clock,
  Copy,
  FileText,
  FolderSearch,
  Info,
  Landmark,
  List,
  Lock,
  Mail,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Receipt,
  Search,
  Stamp,
  Store,
  Trash2,
  TriangleAlert,
  Upload,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { pdfNachholen, pdfOeffnenFuer } from '../lib/belegaktionen';
import { setzeDropZiel } from '../lib/belegablage';
import { ausgestellterBeleg, entwurfOeffnen, mailText, type Schnappschuss } from '../lib/belegpdf';
import { ZAHLUNGSWEGE, kundenLabel, nameSchluessel, type KategorieWahl } from '../lib/buchungen';
import { datenbankVerfuegbar } from '../lib/db';
import { erfassen } from '../lib/erfassen';
import { fehlerText } from '../lib/fehler';
import type { Firma } from '../lib/firma';
import { ibanFormat } from '../lib/firma';
import { girocodeFuer, girocodeMoeglich, vorlageZeigtGirocode } from '../lib/girocode/girocode';
import { kundeOeffnen } from '../lib/kunden-schublade';
import { betragInWorten } from '../lib/latex/zahl-in-worten';
import { inTauri } from '../lib/menu';
import { formatBetrag, parseBetrag } from '../lib/money';
import { naechsteNummer, type Nummernkreis } from '../lib/numbering';
import { belegOeffnen, belegZeigen } from '../lib/queries/belege';
import { ladeKategorienWahl } from '../lib/queries/buchungen';
import {
  ladeBelegEinstellungen,
  ladeFirma,
  ladeUstModus,
  type BelegEinstellungen,
  type UstModus,
} from '../lib/queries/einstellungen';
import { linkOeffnen } from '../lib/queries/kunden';
import { ladeNummernkreise } from '../lib/queries/nummernkreise';
import {
  belegAusstellen,
  belegEntwurfSpeichern,
  belegScanAnhaengen,
  ladeBeleg,
  ladeGeschaeftsnamen,
  ladeKundenAnschrift,
  ladePositionsVorschlaege,
  type BelegVoll,
} from '../lib/queries/rechnungen';
import { ladeKennwerte } from '../lib/queries/steuer';
import { ladeVorlagenFuerArt, type VorlagenWahl } from '../lib/queries/vorlagen';
import {
  anschriftText,
  artWechseln,
  betragSetzen,
  betreffSetzen,
  faelligAus,
  formularAusDokument,
  formularAusEntwurf,
  formularKunde,
  formularSchluessel,
  formularSumme,
  formularZuDaten,
  formularZuDokument,
  neuesFormular,
  preisEingabe,
  type BelegFormular,
  type BelegZeile,
  type FormularFehler,
  type KundeAnschrift,
} from '../lib/rechnungen';
import type { KennwerteJahr } from '../lib/steuer-kennwerte';
import { istBausteinTyp, type Baustein } from '../lib/vorlagen/bausteine';
import {
  ARTEN,
  BELEGARTEN,
  EIGENBELEG_GRUENDE,
  bausteineFuer,
  datumText,
  istBelegart,
  type BelegDokument,
  type Belegart,
  type EigenbelegGrund,
} from '../lib/vorlagen/dokument';
import { KLEINBETRAG_STANDARD_CENT, pflichtCheck, type Pflichtangabe } from '../lib/vorlagen/pflicht';
import { standardVorlage } from '../lib/vorlagen/standard';
import { heute as heuteIso } from '../lib/zeitraum';
import { useUi } from '../store/ui';
import { BlattVorschau } from '../components/belege/Blatt';
import { StatusBadge, StatusKnopf, statusAktionAusfuehren } from '../components/belege/BelegStatus';
import { belegDialog } from '../components/belege/BelegDialog';
import { PositionenEditor, type PositionsVorschlag } from '../components/belege/PositionenEditor';
import { KategorieIcon, ZAHLUNGSWEG_ICON } from '../components/buchungen/Symbole';
import { Monogramm } from '../components/kunden/Monogramm';
import { EmptyState } from '../components/ui/EmptyState';
import { reveal } from '../components/ui/PageHead';
import { Seg } from '../components/ui/Seg';
import { ART_SYMBOL } from './Belege';

/* ================= Laden ================= */

interface Stamm {
  kunden: KundeAnschrift[];
  firma: Firma;
  ustModus: UstModus;
  kategorien: KategorieWahl[];
  kreise: Nummernkreis[];
  kennwerte: Map<number, KennwerteJahr>;
  einstellungen: BelegEinstellungen;
  vorschlaege: PositionsVorschlag[];
  geschaefte: string[];
  vorlagen: Record<Belegart, VorlagenWahl[]>;
}

async function ladeStamm(): Promise<Stamm> {
  const [[kunden, firma, ustModus, kategorien, kreise, kennwerte, einstellungen, vorschlaege, geschaefte], vorlagen] = await Promise.all([
    Promise.all([
      ladeKundenAnschrift(),
      ladeFirma(),
      ladeUstModus(),
      ladeKategorienWahl(),
      ladeNummernkreise(),
      ladeKennwerte(),
      ladeBelegEinstellungen(),
      ladePositionsVorschlaege(),
      ladeGeschaeftsnamen(),
    ]),
    Promise.all(BELEGARTEN.map((a) => ladeVorlagenFuerArt(a))),
  ]);
  return {
    kunden,
    firma,
    ustModus,
    kategorien,
    kreise,
    kennwerte,
    einstellungen,
    vorschlaege,
    geschaefte: geschaefte.map((g) => g.name),
    vorlagen: Object.fromEntries(BELEGARTEN.map((a, i) => [a, vorlagen[i]])) as Record<Belegart, VorlagenWahl[]>,
  };
}

/** Ungespeicherte Eingaben überleben einen kurzen Seitenwechsel (gleiche Adresse ⇒ gleicher Stand). */
let arbeit: { schluessel: string; form: BelegFormular; start: string } | null = null;

type Geladen =
  | { status: 'laden' }
  | { status: 'ohne-db' }
  | { status: 'fehler'; fehler: string }
  | { status: 'fehlt' }
  | { status: 'ok'; stamm: Stamm; beleg: BelegVoll | null; ausgestellt: Schnappschuss | null; form: BelegFormular };

const zahlParam = (v: string | null): number | null => (v && /^\d+$/.test(v) ? Number(v) : null);

export default function BelegEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const neu = !id || id === 'neu';
  const belegId = neu ? null : zahlParam(id);
  const schluessel = neu ? `neu?${params.toString()}` : `id:${id}`;
  return <Maske key={schluessel} belegId={belegId} params={params} schluessel={schluessel} />;
}

function Maske({ belegId, params, schluessel }: { belegId: number | null; params: URLSearchParams; schluessel: string }) {
  const datenStand = useUi((s) => s.datenStand);
  const [geladen, setGeladen] = useState<Geladen>(() => (datenbankVerfuegbar() ? { status: 'laden' } : { status: 'ohne-db' }));

  const laden = useCallback(async () => {
    if (!datenbankVerfuegbar()) return;
    try {
      const h = heuteIso();
      const stamm = await ladeStamm();
      if (belegId == null) {
        const art = params.get('art');
        const kundeId = zahlParam(params.get('kunde'));
        const f = neuesFormular(
          {
            art: istBelegart(art) ? art : stamm.einstellungen.beleg_art,
            betrag: zahlParam(params.get('betrag')) ?? undefined,
            datum: params.get('datum') ?? undefined,
            text: params.get('text') ?? undefined,
            kunde: kundeId != null ? (stamm.kunden.find((k) => k.id === kundeId) ?? null) : null,
            name: params.get('name') ?? undefined,
            zahlungsart: (['bar', 'bank', 'paypal'] as const).find((z) => z === params.get('zahlungsart')),
            bezahlt: params.get('bezahlt') === '1',
            kategorieId: zahlParam(params.get('kategorie')),
            buchungId: zahlParam(params.get('buchung')),
          },
          { heute: h, zielTage: { rechnung: stamm.einstellungen.zahlungsziel_tage, angebot: stamm.einstellungen.angebot_tage } },
        );
        const aktiv = stamm.vorlagen[f.art].find((v) => v.aktiv);
        const form = { ...f, vorlageId: aktiv?.id ?? null };
        setGeladen({ status: 'ok', stamm, beleg: null, ausgestellt: null, form: arbeit?.schluessel === schluessel ? arbeit.form : form });
        return;
      }
      const b = await ladeBeleg(belegId);
      if (!b) return setGeladen({ status: 'fehlt' });
      if (b.beleg.nummer) {
        const s = ausgestellterBeleg(b.beleg, b.positionen, stamm.firma, stamm.ustModus);
        const form = formularAusDokument(s.dokument, { vorlageId: b.beleg.vorlage_id, terminId: b.beleg.termin_id });
        setGeladen({ status: 'ok', stamm, beleg: b.beleg, ausgestellt: s, form });
      } else {
        const form = formularAusEntwurf(b.beleg, b.positionen, h);
        setGeladen({ status: 'ok', stamm, beleg: b.beleg, ausgestellt: null, form: arbeit?.schluessel === schluessel ? arbeit.form : form });
      }
    } catch (e) {
      setGeladen({ status: 'fehler', fehler: fehlerText(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Adresse steckt im key der Maske
  }, [belegId, schluessel]);

  // Nach Status-Aktionen (bezahlt, storniert …) neu laden; ein offener Entwurf behält seine Eingaben
  useEffect(() => {
    void laden();
  }, [laden, datenStand]);

  if (geladen.status === 'ok') return <Inhalt key={geladen.beleg?.geaendert_am ?? 'neu'} g={geladen} schluessel={schluessel} />;
  return (
    <div className="page bl-page">
      <div className="bl-head reveal" style={reveal(0)}>
        <div className="bl-htitle">
          <Link className="bl-back" to="/belege">
            <ChevronLeft />
            Rechnungen &amp; Quittungen
          </Link>
          <h1>
            <FileText />
            <span>Beleg</span>
          </h1>
        </div>
      </div>
      <section className="card reveal" style={reveal(1)}>
        {geladen.status === 'laden' ? (
          <div className="sk set-sk" aria-busy="true" />
        ) : geladen.status === 'ohne-db' ? (
          <EmptyState icon={FileText} title="Nur in der Mac-App">
            Belege liegen in der Datenbank auf diesem Mac. Im Browser-Vorschaumodus gibt es sie nicht – bitte die App starten (npm run tauri dev).
          </EmptyState>
        ) : geladen.status === 'fehlt' ? (
          <EmptyState icon={Info} title="Beleg nicht gefunden">
            Vielleicht wurde der Entwurf gelöscht.{' '}
            <Link className="link" to="/belege">
              Zu Rechnungen &amp; Quittungen
            </Link>
          </EmptyState>
        ) : (
          <EmptyState icon={TriangleAlert} title="Der Beleg konnte nicht geladen werden">
            {geladen.fehler}
          </EmptyState>
        )}
      </section>
    </div>
  );
}

/* ================= Inhalt ================= */

const ART_TIPP =
  'Quittung: bestätigt, dass bezahlt wurde – meist bar oder per PayPal direkt vor Ort; sie enthält zugleich alle Rechnungsangaben. Rechnung: fordert zur Zahlung auf, mit Zahlungsziel – der Kunde zahlt später per Überweisung (GiroCode). Eine Rechnung brauchst du, wenn eine Firma beauftragt oder ein Privatkunde die Arbeitskosten nach § 35a EStG absetzen will (dafür Rechnung und unbare Zahlung).';

const NEU_TITEL: Readonly<Record<Belegart, string>> = { rechnung: 'Neue Rechnung', quittung: 'Neue Quittung', angebot: 'Neues Angebot', eigenbeleg: 'Neuer Eigenbeleg' };
const ZIEL_CHIPS: Readonly<Record<'rechnung' | 'angebot', readonly number[]>> = { rechnung: [7, 14, 30], angebot: [14, 30, 60] };
const DF_WOCHE = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const datumMitTag = (iso: string | null) => (iso ? DF_WOCHE.format(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))) : '—');

function Inhalt({ g, schluessel }: { g: Extract<Geladen, { status: 'ok' }>; schluessel: string }) {
  const navigate = useNavigate();
  const { stamm, beleg, ausgestellt } = g;
  const akzent = useUi((s) => s.settings.accent);
  const [form, setForm] = useState<BelegFormular>(g.form);
  const [start, setStart] = useState(() => (arbeit?.schluessel === schluessel ? arbeit.start : formularSchluessel(g.form)));
  const [fehler, setFehler] = useState<FormularFehler>({});
  const [laeuft, setLaeuft] = useState(false);
  const [zeitraum, setZeitraum] = useState(() => !!g.form.leistungBis);
  const formRef = useRef<HTMLDivElement>(null);
  const h = heuteIso();

  const editierbar = !ausgestellt;
  const art = form.art;
  const dirty = editierbar && formularSchluessel(form) !== start;

  // ungespeicherte Eingaben merken (kurzer Seitenwechsel) und für den Neustart nach einem Update melden
  useEffect(() => {
    if (!editierbar) return;
    arbeit = dirty ? { schluessel, form, start } : arbeit?.schluessel === schluessel ? null : arbeit;
    useUi.getState().setUngespeichert(dirty);
  }, [form, start, dirty, editierbar, schluessel]);
  useEffect(() => () => useUi.getState().setUngespeichert(false), []);

  const set = <K extends keyof BelegFormular>(k: K, v: BelegFormular[K]) => setForm((f) => ({ ...f, [k]: v }));

  /* ---------- abgeleitet ---------- */
  const doc: BelegDokument = ausgestellt ? ausgestellt.dokument : formularZuDokument(form, { kunden: stamm.kunden, firma: stamm.firma, ustModus: stamm.ustModus });
  const vorlagen = stamm.vorlagen[art];
  const gewaehlt = vorlagen.find((v) => v.id === form.vorlageId) ?? vorlagen.find((v) => v.aktiv) ?? vorlagen[0];
  const bausteine: Baustein[] = ausgestellt ? ausgestellt.bausteine : (gewaehlt?.bausteine ?? standardVorlage(art));
  const gedruckt = useMemo(() => bausteineFuer(doc, bausteine).filter((b) => istBausteinTyp(b.typ)), [doc, bausteine]);
  const summe = ausgestellt ? (beleg?.summe_cent ?? 0) : formularSumme(form);
  const jahr = Number((form.datum || h).slice(0, 4));
  const kennwerte: KennwerteJahr = stamm.kennwerte.get(jahr) ?? [...stamm.kennwerte.values()].pop() ?? {};
  const kleinbetrag = kennwerte.kleinbetragsrechnung_cent ?? KLEINBETRAG_STANDARD_CENT;
  const kreis = stamm.kreise.find((k) => k.id === art);
  let naechste: string | null = null;
  try {
    naechste = kreis ? naechsteNummer(kreis, Math.max(jahr, kreis.jahr)).nummer : null;
  } catch {
    naechste = null;
  }
  const kunde = formularKunde(form, stamm.kunden);
  const pflicht: Pflichtangabe[] = useMemo(() => {
    if (!editierbar) return [];
    const liste = pflichtCheck(doc, gedruckt, { kleinbetrag_cent: kleinbetrag, naechste_nummer: naechste });
    if (kunde.art === 'wahl') liste.unshift({ label: 'Kunde eindeutig', ok: false, hint: `Mehrere Kunden heißen „${kunde.name}“ – bitte wählen, wer gemeint ist` });
    return liste;
  }, [doc, gedruckt, kleinbetrag, naechste, kunde, editierbar]);
  const zeile: BelegZeile | null = beleg
    ? {
        id: beleg.id,
        art: beleg.art,
        nummer: beleg.nummer,
        status: beleg.status,
        kunde_id: beleg.kunde_id,
        kunde_name: beleg.kunde_name ?? beleg.kunde_name_live,
        datum: beleg.datum,
        faellig_am: beleg.faellig_am,
        bezahlt_am: beleg.bezahlt_am,
        zahlungsart: beleg.zahlungsart,
        betreff: beleg.betreff,
        summe_cent: beleg.summe_cent,
        termin_id: beleg.termin_id,
        termin_datum: beleg.termin_datum,
        termin_von: beleg.termin_von,
        termin_status: beleg.termin_status,
        storno_von_id: beleg.storno_von_id,
        storniert_am: beleg.storniert_am,
        pdf_beleg_id: beleg.pdf_beleg_id,
        scan_beleg_id: beleg.scan_beleg_id,
      }
    : null;

  /* ---------- Aktionen ---------- */
  const ui = useUi.getState;
  const wackeln = (sel: string) => {
    const el = formRef.current?.querySelector<HTMLElement>(sel);
    if (!el) return;
    el.scrollIntoView({ behavior: ui().settings.motion === 'full' ? 'smooth' : 'auto', block: 'center' });
    el.classList.remove('bl-shake');
    void el.offsetWidth;
    el.classList.add('bl-shake');
  };

  const daten = () => {
    const d = formularZuDaten(form, stamm.kunden);
    if (!d.ok) {
      setFehler(d.fehler);
      ui().showToast({ text: Object.values(d.fehler).join(' '), icon: 'warn' });
      if (d.fehler.kunde) wackeln('[data-card="kunde"], [data-card="angaben"]');
      return null;
    }
    setFehler({});
    return d.daten;
  };

  const speichern = async () => {
    if (!editierbar || laeuft) return;
    const d = daten();
    if (!d) return;
    setLaeuft(true);
    try {
      const r = await belegEntwurfSpeichern(beleg?.id ?? null, d);
      arbeit = null;
      setStart(formularSchluessel(form));
      ui().datenGeaendert();
      ui().showToast({ text: beleg ? 'Entwurf gespeichert' : 'Entwurf gespeichert · die Nummer wird erst beim Ausstellen vergeben', icon: 'check' });
      if (!beleg) navigate(`/belege/${r.id}`, { replace: true });
    } catch (e) {
      ui().showToast({ text: `Speichern ging nicht: ${fehlerText(e)}`, icon: 'warn', sticky: true });
    } finally {
      setLaeuft(false);
    }
  };

  const ausstellen = async () => {
    if (!editierbar || laeuft) return;
    if (kunde.art === 'wahl') {
      ui().showToast({ text: `Mehrere Kunden heißen „${kunde.name}“ – bitte wählen, wer gemeint ist`, icon: 'warn' });
      wackeln('.bl-kwahl');
      return;
    }
    const fehlt = pflicht.filter((p) => !p.ok).map((p) => p.label);
    if (art === 'angebot' && kunde.art === 'leer') fehlt.push('Kunde');
    if (summe <= 0 && !fehlt.some((l) => /Betrag|Entgelt/.test(l))) fehlt.push('Betrag');
    if (!form.datum) fehlt.push('Datum');
    if (fehlt.length) {
      ui().showToast({ text: `Noch nicht vollständig: ${[...new Set(fehlt)].join(' · ')}`, icon: 'warn' });
      wackeln('[data-card="pflicht"], .bl-card');
      return;
    }
    const d = daten();
    if (!d) return;
    setLaeuft(true);
    try {
      const r = await belegAusstellen(beleg?.id ?? null, d, {
        dokument: { ...doc, akzent },
        bausteine: gedruckt,
        kategorie_id: null,
        heute: heuteIso(),
      });
      arbeit = null;
      setStart(formularSchluessel(form));
      ui().datenGeaendert();
      const was = art === 'eigenbeleg' ? 'Ausgabe' : 'Einnahme';
      const teile = [`${r.nummer} ausgestellt`];
      if (r.buchung_nummer) teile.push(`${was} ${r.buchung_nummer} ${d.zusatz.buchung_id != null ? 'verknüpft' : 'gebucht'}`);
      if (r.kunde_neu && r.kunde_nummer) teile.push(`Kunde ${r.kunde_nummer} angelegt`);
      ui().showToast({ text: teile.join(' · '), icon: 'check', actions: [{ label: 'PDF öffnen', run: () => void pdfOeffnenFuer(r.id) }] });
      navigate(`/belege/${r.id}`, { replace: true });
      void pdfNachholen(r.id);
    } catch (e) {
      ui().showToast({ text: `Ausstellen ging nicht: ${fehlerText(e)}`, icon: 'warn', sticky: true });
    } finally {
      setLaeuft(false);
    }
  };

  // Für einen Termin vorbereitet: Ausstellen nur über die eine Erfassen-Schublade (§6.5 – kein zweiter Ausstell-Weg).
  // Ungespeicherte Änderungen am Entwurf werden vorher gespeichert; die Schublade liest ihn dann frisch.
  const vorbereitet = editierbar && !!beleg && beleg.termin_id != null && (art === 'quittung' || art === 'rechnung');
  const vorbereitetAusstellen = async () => {
    if (!beleg || laeuft) return;
    if (dirty) {
      const d = daten();
      if (!d) return;
      setLaeuft(true);
      try {
        await belegEntwurfSpeichern(beleg.id, d);
        arbeit = null;
        setStart(formularSchluessel(form));
        ui().datenGeaendert();
      } catch (e) {
        ui().showToast({ text: `Speichern ging nicht: ${fehlerText(e)}`, icon: 'warn', sticky: true });
        return;
      } finally {
        setLaeuft(false);
      }
    }
    erfassen({ typ: 'einnahme', entwurf: beleg.id, termin: beleg.termin_id ?? undefined, beleg: art === 'rechnung' ? 'rechnung' : 'quittung' });
  };

  const drucken = async () => {
    if (!editierbar && beleg) return pdfOeffnenFuer(beleg.id);
    try {
      await entwurfOeffnen(doc, gedruckt, akzent);
    } catch (e) {
      ui().showToast({ text: `Das PDF konnte nicht gesetzt werden: ${fehlerText(e)}`, icon: 'warn', sticky: true });
    }
  };

  const mailen = async () => {
    if (!beleg) return;
    const m = mailText(doc);
    const an = beleg.kunde_email_live?.trim() || doc.kunde?.email?.trim() || '';
    const url = `mailto:${an}?subject=${encodeURIComponent(m.betreff)}&body=${encodeURIComponent(m.text)}`;
    try {
      const pdf = beleg.pdf_beleg_id ?? (await pdfNachholen(beleg.id));
      await linkOeffnen(url);
      if (pdf) await belegZeigen(pdf);
      ui().showToast({ text: 'E-Mail vorbereitet · das PDF liegt im Finder bereit – einfach in die Mail ziehen.', icon: 'info' });
    } catch (e) {
      ui().showToast({ text: `Mail ging nicht: ${fehlerText(e)}`, icon: 'warn', sticky: true });
    }
  };

  // ⌘S speichert den Entwurf, ⌘P druckt nur das Blatt
  useEffect(() => {
    const taste = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void speichern();
      } else if (k === 'p') {
        e.preventDefault();
        void drucken();
      }
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  });

  // Ausgestellt: eine Datei aufs Fenster gezogen ⇒ unterschriebenes Exemplar (statt Erfassen)
  const scanAnhaengen = useCallback(
    async (pfad: string) => {
      if (!beleg) return;
      try {
        await belegScanAnhaengen(beleg.id, pfad);
        useUi.getState().datenGeaendert();
        useUi.getState().showToast({ text: `Unterschriebenes Exemplar an ${beleg.nummer ?? 'den Beleg'} angehängt (im Protokoll)`, icon: 'check' });
      } catch (e) {
        useUi.getState().showToast({ text: `Anhängen ging nicht: ${fehlerText(e)}`, icon: 'warn', sticky: true });
      }
    },
    [beleg],
  );
  useEffect(() => {
    if (!ausgestellt || !beleg || beleg.scan_beleg_id != null || beleg.art === 'storno') return;
    setzeDropZiel((pfade) => void scanAnhaengen(pfade[0]));
    return () => setzeDropZiel(null);
  }, [ausgestellt, beleg, scanAnhaengen]);

  const artWaehlen = (a: Belegart) => {
    const ziel = { rechnung: stamm.einstellungen.zahlungsziel_tage, angebot: stamm.einstellungen.angebot_tage };
    setForm((f) => {
      const n = artWechseln(f, a, ziel);
      return { ...n, vorlageId: stamm.vorlagen[a].find((v) => v.aktiv)?.id ?? null };
    });
    setZeitraum(false);
    setFehler({});
  };

  /* ---------- Kopf ---------- */
  const Icon = beleg ? ART_SYMBOL[beleg.art] : ART_SYMBOL[art];
  const titel = beleg?.nummer ?? (beleg ? ARTEN[art].label : NEU_TITEL[art]);
  const untertitel = (() => {
    const t: string[] = [];
    const name = doc.kunde?.name || (art === 'quittung' && !editierbar ? 'Barverkauf' : '');
    t.push(art === 'eigenbeleg' ? (name ? `an ${name}` : 'Empfänger fehlt') : name || 'Noch kein Kunde');
    t.push(formatBetrag(beleg?.art === 'storno' ? beleg.summe_cent : summe));
    if (art === 'quittung' || art === 'eigenbeleg') t.push(ZAHLUNGSWEGE.find((z) => z.id === form.zahlungsart)?.name ?? '');
    if (art === 'rechnung' && editierbar && form.bezahltAm) t.push('schon bezahlt');
    if (!editierbar && doc.datum) t.push(datumText(doc.datum));
    return t.filter(Boolean).join(' · ');
  })();

  const m: MaskeKontext = { form, set, setForm, stamm, doc, editierbar, kunde, fehler, summe, kleinbetrag, zeitraum, setZeitraum, beleg };
  const karten: Record<Belegart, ReactNode> = {
    rechnung: (
      <>
        <KundeKarte m={m} i={1} />
        <DatenKarte m={m} i={2} />
        <LeistungenKarte m={m} i={3} />
        <ZahlungKarte m={m} i={4} bausteine={gedruckt} />
        {editierbar ? <PflichtKarte liste={pflicht} art={art} i={5} /> : null}
      </>
    ),
    angebot: (
      <>
        <KundeKarte m={m} i={1} />
        <DatenKarte m={m} i={2} />
        <LeistungenKarte m={m} i={3} />
      </>
    ),
    quittung: (
      <>
        <QuittungBetragKarte m={m} i={1} />
        <QuittungAngabenKarte m={m} i={2} />
        {editierbar ? <PflichtKarte liste={pflicht} art={art} i={3} /> : null}
      </>
    ),
    eigenbeleg: (
      <>
        <div className="bl-info reveal" style={reveal(1)} data-card="ebinfo">
          <Info />
          <div>
            <b>Eigenbeleg = Ersatzbeleg</b>
            <p>
              Für Ausgaben, deren Originalbeleg fehlt: verloren, unleserlich oder gar nicht erhältlich (Parkautomat, Trinkgeld). Mit Datum,
              Betrag, Empfänger, Zweck, Grund und deiner Unterschrift wird er in der Regel anerkannt – aber nur als Ausnahme.
            </p>
          </div>
        </div>
        <EigenZahlungKarte m={m} i={2} />
        <EmpfaengerKarte m={m} i={3} />
        <ZweckKarte m={m} i={4} />
        {editierbar ? <PflichtKarte liste={pflicht} art={art} i={5} /> : null}
      </>
    ),
  };

  return (
    <div className="page bl-page">
      <div className="bl-head reveal" style={reveal(0)}>
        <div className="bl-htitle">
          <Link className="bl-back" to="/belege">
            <ChevronLeft />
            Rechnungen &amp; Quittungen
          </Link>
          <h1>
            <Icon />
            <span>{titel}</span>
            {!beleg ? (
              <span className="badge entwurf">Neu</span>
            ) : zeile ? (
              <StatusKnopf z={zeile} heute={h} hier onAktion={(a) => statusAktionAusfuehren(a, zeile, navigate)} />
            ) : null}
            {editierbar && naechste ? (
              <span className="bl-willnr" title="Vergeben wird die Nummer erst beim Ausstellen">
                <Lock />
                wird <b className="mono">{naechste}</b>
              </span>
            ) : null}
          </h1>
          <div className="page-sub">{untertitel}</div>
        </div>
        <div className="page-actions">
          {editierbar ? (
            <div className="bl-artwrap">
              <Seg
                className="bl-artseg"
                ariaLabel="Belegart"
                value={art}
                onChange={artWaehlen}
                options={BELEGARTEN.map((a) => {
                  const AIcon = ART_SYMBOL[a];
                  return {
                    value: a,
                    label: (
                      <>
                        <AIcon />
                        {ARTEN[a].label}
                      </>
                    ),
                  };
                })}
              />
              <span className="q bl-artq" title={ART_TIPP} aria-label="Unterschied zwischen Quittung und Rechnung">
                ?
              </span>
            </div>
          ) : null}
          {editierbar && beleg && zeile ? (
            <button type="button" className="btn ghost" onClick={() => belegDialog('loeschen', zeile, () => navigate('/belege'))}>
              <Trash2 />
              Löschen
            </button>
          ) : null}
          {!editierbar && zeile ? (
            <button type="button" className="btn ghost" onClick={() => statusAktionAusfuehren('duplizieren', zeile, navigate)}>
              <Copy />
              Duplizieren
            </button>
          ) : null}
        </div>
      </div>

      <div className="bl-grid">
        <div className="bl-form" ref={formRef}>
          {editierbar && beleg?.termin_id != null ? (
            <div className="bl-termin reveal" style={reveal(1)}>
              <CalendarDays />
              <div>
                <b>Vorbereitet für den Termin am {datumMitTag(beleg.termin_datum)}{beleg.termin_von ? ` · ${beleg.termin_von}` : ''}</b>
                <span>
                  Die Nummer{art === 'quittung' ? ' und die Einnahme entstehen' : ' entsteht'} erst beim Ausstellen
                  {vorbereitet ? ` – über „${art === 'rechnung' ? 'Rechnung schreiben' : 'Quittung ausstellen'}“ (Erfassen), dabei wird der Termin abgehakt` : ''}.
                </span>
              </div>
              <Link className="link" to={`/termine?t=${beleg.termin_id}`}>
                Zum Termin
              </Link>
            </div>
          ) : null}
          {beleg && !editierbar ? <SperrHinweis beleg={beleg} /> : null}
          {beleg && !editierbar && beleg.art !== 'storno' ? <ScanKarte beleg={beleg} onDatei={(p) => void scanAnhaengen(p)} /> : null}
          <fieldset className="bl-fs" disabled={!editierbar}>
            {karten[art]}
          </fieldset>
          <div className="bl-actions">
            {editierbar ? (
              <>
                <span className="bl-dirty">
                  {dirty ? (
                    <>
                      <i />
                      Nicht gespeichert
                    </>
                  ) : beleg ? (
                    <>
                      <Check />
                      Gespeichert
                    </>
                  ) : null}
                </span>
                <span className="spacer" />
                <button type="button" className="btn subtle" title="Als Entwurf speichern (⌘S)" disabled={laeuft} onClick={() => void speichern()}>
                  Als Entwurf speichern
                </button>
                {vorbereitet ? (
                  <button
                    type="button"
                    className="btn-primary sm"
                    title="Öffnet „Erfassen“: Nummer vergeben, Einnahme buchen bzw. Rechnung offen lassen, Termin abhaken"
                    disabled={laeuft}
                    onClick={() => void vorbereitetAusstellen()}
                  >
                    {art === 'rechnung' ? <FileText /> : <Receipt />}
                    {art === 'rechnung' ? 'Rechnung schreiben' : 'Quittung ausstellen'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-primary sm"
                    title={naechste ? `Nummer ${naechste} vergeben und festschreiben` : 'Nummer vergeben und festschreiben'}
                    disabled={laeuft}
                    onClick={() => void ausstellen()}
                  >
                    {art === 'eigenbeleg' ? <Stamp /> : <Lock />}
                    {art === 'quittung' || (art === 'rechnung' && form.bezahltAm) ? 'Finalisieren & buchen' : art === 'eigenbeleg' ? 'Buchen' : 'Finalisieren'}
                  </button>
                )}
              </>
            ) : beleg && zeile ? (
              <AusgestelltAktionen beleg={beleg} zeile={zeile} mailen={() => void mailen()} />
            ) : null}
          </div>
        </div>

        <aside className="bl-preview reveal" style={reveal(2)} aria-label="Vorschau">
          <div className="bl-ptools">
            <div className="bl-pinfo">
              {editierbar ? (
                <label className="bl-vl">
                  <Blocks />
                  <span>Vorlage</span>
                  <select
                    className="select sm"
                    aria-label="Vorlage"
                    value={gewaehlt?.id == null ? '' : String(gewaehlt.id)}
                    onChange={(e) => set('vorlageId', e.target.value ? Number(e.target.value) : null)}
                  >
                    {vorlagen.map((v) => (
                      <option key={v.id ?? 'standard'} value={v.id == null ? '' : String(v.id)}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <span className="bl-vl" title="Beim Ausstellen eingefroren – ein Nachdruck sieht aus wie das Original">
                  <Blocks />
                  Vorlage <b>eingefroren</b>
                </span>
              )}
              {editierbar ? (
                <Link className="icon-btn sm" to={`/belege/vorlagen?art=${art}`} title="Vorlagen bearbeiten" aria-label="Vorlagen bearbeiten">
                  <Pencil />
                </Link>
              ) : null}
            </div>
            <button type="button" className="btn ghost" title="Nur das Blatt drucken – in der Vorschau „Drucken“ oder „Als PDF sichern“ (⌘P)" onClick={() => void drucken()}>
              <Printer />
              Drucken / PDF
            </button>
          </div>
          <BlattVorschau doc={doc} bausteine={gedruckt} maxScale={1.2} />
          <div className="bl-pcap">{ARTEN[art].format === 'a4' ? 'A4 hoch' : 'A5 quer'} · gedruckt 1:1, ohne Skalierung</div>
        </aside>
      </div>
      {art === 'eigenbeleg' ? (
        <datalist id="bl-empf">
          {[...new Set([...stamm.geschaefte, 'Parkautomat', 'Parkhaus', 'Tankstelle (Automat)', 'Wertstoffhof', 'Trinkgeld'])].map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      ) : (
        <datalist id="bl-kunden">
          {stamm.kunden.map((k) => (
            <option key={k.id} value={kundenLabel(k)}>
              {[k.strasse, k.ort].filter(Boolean).join(', ') || 'ohne Adresse'}
            </option>
          ))}
        </datalist>
      )}
    </div>
  );
}

/* ================= Karten ================= */

interface MaskeKontext {
  form: BelegFormular;
  set: <K extends keyof BelegFormular>(k: K, v: BelegFormular[K]) => void;
  setForm: (f: (alt: BelegFormular) => BelegFormular) => void;
  stamm: Stamm;
  doc: BelegDokument;
  editierbar: boolean;
  kunde: ReturnType<typeof formularKunde>;
  fehler: FormularFehler;
  summe: number;
  kleinbetrag: number;
  zeitraum: boolean;
  setZeitraum: (z: boolean) => void;
  beleg: BelegVoll | null;
}

function Karte({ k, titel, icon: Icon, i, rechts, children }: { k: string; titel: ReactNode; icon: LucideIcon; i: number; rechts?: ReactNode; children: ReactNode }) {
  return (
    <section className="card bl-card reveal" style={reveal(i)} data-card={k}>
      <div className="card-head">
        <div className="card-title">
          <Icon />
          {titel}
        </div>
        {rechts}
      </div>
      {children}
    </section>
  );
}

const Fehler = ({ text }: { text?: string }) =>
  text ? (
    <p className="hint neg" role="alert">
      {text}
    </p>
  ) : null;

/* ---------- Kunde (Rechnung, Angebot) ---------- */

function KundeKarte({ m, i }: { m: MaskeKontext; i: number }) {
  const { form, set, editierbar } = m;
  return (
    <Karte k="kunde" titel="Kunde" icon={Users} i={i}>
      <div className="bl-stack">
        <label className="bl-search">
          <Search />
          <input
            className={`input ${m.fehler.kunde ? 'invalid' : ''}`}
            list="bl-kunden"
            value={form.kunde}
            placeholder="Name eingeben – vorhandene Kunden werden vorgeschlagen"
            autoComplete="off"
            aria-label="Kunde"
            readOnly={!editierbar}
            onChange={(e) => set('kunde', e.target.value)}
          />
        </label>
        <KundeInfo m={m} mitAnschrift />
        <Fehler text={m.fehler.kunde} />
      </div>
    </Karte>
  );
}

/** Unter dem Kundenfeld: gewählter Kunde (Anschrift aus der Kartei), Namensvettern zur Wahl oder neuer Kunde. */
function KundeInfo({ m, mitAnschrift }: { m: MaskeKontext; mitAnschrift: boolean }) {
  const { form, set, setForm, editierbar, stamm, kunde } = m;
  if (!editierbar) {
    const k = m.doc.kunde;
    if (!k || !k.name) return null;
    const zeilen = anschriftText(k).split('\n').filter(Boolean);
    return (
      <div className="bl-addr">
        <Monogramm name={k.name} />
        <div className="bl-addr-t">
          <b>{k.name}</b>
          {zeilen.map((z) => (
            <span key={z}>{z}</span>
          ))}
        </div>
        <div className="bl-addr-m">
          {k.nummer ? <span className="chip strong">{k.nummer}</span> : null}
          {k.id != null ? (
            <button type="button" className="link bl-klink" onClick={() => kundeOeffnen(k.id as number)}>
              Kunde öffnen
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  if (kunde.art === 'wahl')
    return (
      <div className="bl-kwahl" role="group" aria-label="Welcher Kunde?">
        <p>
          <TriangleAlert />
          <span>{kunde.liste.length > 1 ? `Mehrere Kunden heißen „${kunde.name}“ – wer ist gemeint?` : `Es gibt schon einen Kunden „${kunde.name}“ – ist es derselbe?`}</span>
        </p>
        {kunde.liste.map((x) => {
          const v = stamm.kunden.find((y) => y.id === x.id);
          return (
            <button key={x.id} type="button" className="bl-kwahl-k" onClick={() => set('kunde', kundenLabel(x))}>
              <b>{x.nummer}</b>
              <span>{[v?.strasse, v?.ort].filter(Boolean).join(', ') || 'ohne Adresse'}</span>
            </button>
          );
        })}
        <button type="button" className="bl-mini bl-kwahl-neu" onClick={() => setForm((f) => ({ ...f, kunde: kunde.name, kundeBewusstNeu: nameSchluessel(kunde.name) }))}>
          <Plus />
          Neuer Kunde mit diesem Namen
        </button>
      </div>
    );
  if (kunde.art === 'kunde') {
    const v = stamm.kunden.find((y) => y.id === kunde.kunde.id);
    const zeilen = v ? anschriftText(v).split('\n').filter(Boolean) : [];
    return (
      <>
        <div className="bl-addr">
          <Monogramm name={kunde.kunde.name} />
          <div className="bl-addr-t">
            <b>{kunde.kunde.name}</b>
            {zeilen.length ? zeilen.map((z) => <span key={z}>{z}</span>) : <span className="muted">ohne Anschrift</span>}
          </div>
          <div className="bl-addr-m">
            <span className="chip strong">{kunde.kunde.nummer}</span>
            <button type="button" className="link bl-klink" onClick={() => kundeOeffnen(kunde.kunde.id)}>
              Kunde öffnen
            </button>
          </div>
        </div>
        {mitAnschrift && !zeilen.length ? (
          <div className="field">
            <label className="field-label" htmlFor="bl-adresse">
              Anschrift <span className="muted">(fehlt in der Kartei – wird beim Ausstellen ergänzt)</span>
            </label>
            <textarea id="bl-adresse" className="textarea" rows={3} value={form.adresse} placeholder={'Straße und Hausnummer\nPLZ Ort'} onChange={(e) => set('adresse', e.target.value)} />
          </div>
        ) : null}
      </>
    );
  }
  if (kunde.art === 'neu') {
    const vetter = kunde.namensvettern;
    return (
      <div className="field">
        <label className="field-label" htmlFor="bl-adresse">
          Anschrift <span className="badge accent">Neuer Kunde</span>
        </label>
        <textarea id="bl-adresse" className="textarea" rows={3} value={form.adresse} placeholder={'Straße und Hausnummer\nPLZ Ort'} onChange={(e) => set('adresse', e.target.value)} />
        <span className="hint">
          {vetter.length ? `Neuer Kunde „${kunde.name}“ mit eigener Nummer – ` : ''}wird beim Ausstellen unter „Kunden“ angelegt.
          {vetter.length === 1 ? (
            <button type="button" className="bl-mini" onClick={() => setForm((f) => ({ ...f, kunde: kundenLabel(vetter[0]), kundeBewusstNeu: null }))}>
              Doch {vetter[0].nummer} nehmen
            </button>
          ) : vetter.length > 1 ? (
            <button type="button" className="bl-mini" onClick={() => set('kundeBewusstNeu', null)}>
              Doch einen vorhandenen wählen
            </button>
          ) : null}
        </span>
      </div>
    );
  }
  return (
    <p className="hint">
      <Info /> Name und Anschrift des Kunden gehören zu den Pflichtangaben einer Rechnung.
    </p>
  );
}

/* ---------- Daten (Rechnung, Angebot) ---------- */

function DatenKarte({ m, i }: { m: MaskeKontext; i: number }) {
  const { form, set, editierbar, zeitraum, setZeitraum } = m;
  const ang = form.art === 'angebot';
  const chips = ZIEL_CHIPS[ang ? 'angebot' : 'rechnung'];
  const faellig = faelligAus(form);
  return (
    <Karte k="daten" titel={ang ? 'Angebotsdaten' : 'Rechnungsdaten'} icon={CalendarDays} i={i}>
      <div className="form-grid">
        <div className="field">
          <label className="field-label" htmlFor="bl-datum">
            {ang ? 'Angebotsdatum' : 'Rechnungsdatum'}
          </label>
          <input
            id="bl-datum"
            type="date"
            className={`input ${m.fehler.datum ? 'invalid' : ''}`}
            value={form.datum}
            onChange={(e) => {
              const v = e.target.value;
              m.setForm((f) => ({ ...f, datum: v, leistungVon: !zeitraum && f.leistungVon === f.datum ? v : f.leistungVon }));
            }}
          />
        </div>
        {ang ? null : (
          <div className="field">
            <label className="field-label" htmlFor="bl-leistung">
              {zeitraum ? 'Leistung vom' : 'Leistungsdatum'}
              <span className="spacer" />
              {editierbar ? (
                <button
                  type="button"
                  className="bl-mini"
                  onClick={() => {
                    setZeitraum(!zeitraum);
                    m.setForm((f) => ({ ...f, leistungBis: zeitraum ? '' : f.leistungBis || f.leistungVon }));
                  }}
                >
                  {zeitraum ? 'Einzelnes Datum' : 'Zeitraum'}
                </button>
              ) : null}
            </label>
            <input id="bl-leistung" type="date" className="input" value={form.leistungVon} onChange={(e) => set('leistungVon', e.target.value)} />
          </div>
        )}
        {!ang && zeitraum ? (
          <div className="field">
            <label className="field-label" htmlFor="bl-leistung-bis">
              bis
            </label>
            <input id="bl-leistung-bis" type="date" className="input" min={form.leistungVon} value={form.leistungBis} onChange={(e) => set('leistungBis', e.target.value)} />
          </div>
        ) : null}
        <div className="field">
          <label className="field-label" htmlFor="bl-ziel">
            {ang ? 'Gültig' : 'Zahlungsziel'}
          </label>
          <div className="input-wrap">
            <input id="bl-ziel" type="number" className="input num" min={0} max={365} value={form.zielTage} onChange={(e) => set('zielTage', e.target.value)} />
            <span className="suffix">Tage</span>
          </div>
          <div className="bl-zielrow">
            <span className="hint">{ang ? `gültig bis ${datumMitTag(faellig)}` : Number(form.zielTage) > 0 ? `fällig am ${datumMitTag(faellig)}` : 'sofort fällig'}</span>
            {editierbar ? (
              <span className="chips">
                {chips.map((n) => (
                  <button key={n} type="button" className={`chip ${Number(form.zielTage) === n ? 'on' : ''}`} onClick={() => set('zielTage', String(n))}>
                    {n}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
        </div>
        <div className="field full">
          <label className="field-label" htmlFor="bl-betreff">
            Betreff
          </label>
          <input id="bl-betreff" className="input" value={form.betreff} placeholder="z. B. Gartenpflege Oktober" onChange={(e) => set('betreff', e.target.value)} />
        </div>
      </div>
    </Karte>
  );
}

/* ---------- Leistungen (Rechnung, Angebot) ---------- */

function LeistungenKarte({ m, i }: { m: MaskeKontext; i: number }) {
  const { form, set, editierbar, stamm } = m;
  return (
    <Karte k="positionen" titel="Leistungen" icon={List} i={i} rechts={<span className="muted bl-count">{`${form.positionen.length} ${form.positionen.length === 1 ? 'Position' : 'Positionen'}`}</span>}>
      <div className="bl-stack">
        <div className="field">
          <label className="field-label" htmlFor="bl-einleitung">
            Einleitung
          </label>
          <textarea id="bl-einleitung" className="textarea" rows={2} value={form.einleitung} onChange={(e) => set('einleitung', e.target.value)} />
        </div>
        <PositionenEditor
          positionen={form.positionen}
          onChange={(p) => set('positionen', p)}
          vorschlaege={stamm.vorschlaege}
          nurLesen={!editierbar}
          summe={m.summe}
          summeHinweis={m.doc.ust_modus === 'klein' ? 'umsatzsteuerfrei nach § 19 UStG' : undefined}
        />
        <Fehler text={m.fehler.positionen} />
        <div className="field">
          <label className="field-label" htmlFor="bl-schluss">
            Schlusstext <span className="muted">(optional)</span>
          </label>
          <textarea id="bl-schluss" className="textarea" rows={2} value={form.schlusstext} placeholder="z. B. Ich freue mich auf die weitere Zusammenarbeit." onChange={(e) => set('schlusstext', e.target.value)} />
        </div>
      </div>
    </Karte>
  );
}

/* ---------- Zahlung (Rechnung) ---------- */

function ZahlungsartWahl({ m, id }: { m: MaskeKontext; id: string }) {
  return (
    <Seg
      className="full bl-zaseg"
      ariaLabel="Zahlungsweg"
      value={m.form.zahlungsart}
      onChange={(z) => {
        if (m.editierbar) m.set('zahlungsart', z);
      }}
      options={ZAHLUNGSWEGE.map((z) => {
        const ZIcon = ZAHLUNGSWEG_ICON[z.id];
        return {
          value: z.id,
          label: (
            <span id={`${id}-${z.id}`} className="bl-za">
              <ZIcon />
              {z.name}
            </span>
          ),
        };
      })}
    />
  );
}

function ZahlungKarte({ m, i, bausteine }: { m: MaskeKontext; i: number; bausteine: readonly Baustein[] }) {
  const { form, set, setForm, editierbar, stamm, doc, beleg } = m;
  const F = stamm.firma;
  if (form.bezahltAm) {
    return (
      <Karte k="zahlung" titel="Zahlung" icon={Check} i={i}>
        <div className="bl-stack">
          <div className="bl-note ok">
            <CircleCheck />
            <span>
              <b>Schon bezahlt</b> am {datumText(form.bezahltAm)}
              {form.buchungId != null ? ' · gehört zur schon erfassten Einnahme – es entsteht keine zweite.' : editierbar ? ' · die Einnahme wird beim Ausstellen gleich mitgebucht.' : '.'}
            </span>
          </div>
          {editierbar && form.buchungId == null ? (
            <div className="form-grid">
              <div className="field">
                <label className="field-label" htmlFor="bl-bezahlt">
                  Bezahlt am
                </label>
                <input id="bl-bezahlt" type="date" className="input" max={heuteIso()} value={form.bezahltAm} onChange={(e) => set('bezahltAm', e.target.value || null)} />
              </div>
              <div className="field full">
                <span className="field-label">Zahlungsweg</span>
                <ZahlungsartWahl m={m} id="bl-za" />
              </div>
            </div>
          ) : null}
          {editierbar ? (
            <div>
              <button type="button" className="bl-mini" onClick={() => setForm((f) => ({ ...f, bezahltAm: null, buchungId: null, zahlungsart: 'bank' }))}>
                Doch noch offen – mit Zahlungsziel und GiroCode
              </button>
            </div>
          ) : null}
        </div>
      </Karte>
    );
  }
  const gc = girocodeMoeglich(doc) ? girocodeFuer(doc) : null;
  const gcOk = gc !== null && gc.ok;
  const gcFehler = gc !== null && !gc.ok ? gc.fehler : null;
  const zeigtQr = vorlageZeigtGirocode(bausteine);
  return (
    <Karte k="zahlung" titel="Zahlung" icon={Landmark} i={i}>
      <div className="bl-stack">
        <div className="bl-bank">
          <Landmark />
          <div>
            <b>{F.bank || 'Bank'}</b>
            <span className="mono">{F.iban ? ibanFormat(F.iban) : 'IBAN fehlt (Einstellungen › Firma)'}</span>
            <small>
              {F.bic ? `BIC ${F.bic} · ` : ''}Empfänger {F.name || F.inhaber || '—'}
            </small>
          </div>
        </div>
        {!zeigtQr ? (
          <p className="hint">
            <QrCode /> Die gewählte Vorlage zeigt keinen GiroCode (Baustein „Zahlung & GiroCode“).
          </p>
        ) : gcOk ? (
          <div className="bl-note ok">
            <QrCode />
            <span>
              GiroCode bereit – Verwendungszweck <b className="mono">{doc.nummer ?? beleg?.nummer ?? 'Rechnungsnummer'}</b>, Betrag {formatBetrag(m.summe)}.
            </span>
          </div>
        ) : gcFehler ? (
          <div className="bl-note neg">
            <TriangleAlert />
            <span>
              <b>GiroCode kann nicht erzeugt werden</b>
              <br />
              {gcFehler.join(' · ')}
            </span>
          </div>
        ) : null}
        {editierbar ? (
          <div>
            <button type="button" className="bl-mini" onClick={() => setForm((f) => ({ ...f, bezahltAm: f.datum || heuteIso() }))}>
              Schon bezahlt? Dann gleich als bezahlt ausstellen
            </button>
          </div>
        ) : null}
      </div>
    </Karte>
  );
}

/* ---------- Pflichtangaben ---------- */

function PflichtKarte({ liste, art, i }: { liste: readonly Pflichtangabe[]; art: Belegart; i: number }) {
  const fehlt = liste.filter((p) => !p.ok).length;
  const titel =
    art === 'eigenbeleg' ? (
      'Angaben im Eigenbeleg'
    ) : (
      <>
        Pflichtangaben <span className="muted">{art === 'quittung' ? '§ 33/§ 34a UStDV' : '§ 34a UStDV'}</span>
      </>
    );
  return (
    <Karte k="pflicht" titel={titel} icon={CircleCheck} i={i} rechts={fehlt ? <span className="badge neg">{fehlt} fehlt</span> : <span className="badge pos">vollständig</span>}>
      <ul className="bl-check">
        {liste.map((p) => {
          const s = p.ok ? (p.offen ? 'info' : 'ok') : 'fail';
          return (
            <li key={p.label} className={s}>
              <span className="st">{s === 'ok' ? <Check /> : s === 'fail' ? <X /> : <Clock />}</span>
              <b>{p.label}</b>
              <small>{p.hint}</small>
            </li>
          );
        })}
      </ul>
    </Karte>
  );
}

/* ---------- Quittung ---------- */

function BetragFeld({ m, id }: { m: MaskeKontext; id: string }) {
  const { form, setForm, editierbar } = m;
  const p = form.positionen[0];
  const ungueltig = !!p?.preis.trim() && parseBetrag(p.preis) === null;
  return (
    <div className="input-wrap bl-money">
      <input
        id={id}
        className={`input money-input ${ungueltig ? 'invalid' : ''}`}
        inputMode="decimal"
        value={p?.preis ?? ''}
        placeholder="0,00"
        aria-label="Betrag"
        readOnly={!editierbar}
        onChange={(e) => {
          const v = e.target.value;
          setForm((f) => betragSetzen(f, v));
        }}
        onBlur={(e) => {
          const c = parseBetrag(e.target.value);
          if (c !== null) setForm((f) => betragSetzen(f, preisEingabe(c)));
        }}
      />
      <span className="suffix">€</span>
    </div>
  );
}

function QuittungBetragKarte({ m, i }: { m: MaskeKontext; i: number }) {
  const { form, setForm, editierbar, stamm, summe, kleinbetrag } = m;
  return (
    <Karte k="betrag" titel="Betrag" icon={Banknote} i={i}>
      <div className="bl-stack">
        {form.mehrere ? (
          <PositionenEditor positionen={form.positionen} onChange={(p) => setForm((f) => ({ ...f, positionen: p }))} vorschlaege={stamm.vorschlaege} nurLesen={!editierbar} summe={summe} />
        ) : (
          <BetragFeld m={m} id="bl-betrag" />
        )}
        <div className="bl-worte">
          <small>in Worten</small>
          <span>{betragInWorten(Math.max(0, summe))}</span>
        </div>
        {editierbar ? (
          summe <= kleinbetrag ? (
            <div className="bl-note ok">
              <Check />
              <span>
                <b>Kleinbetragsrechnung</b> (bis {formatBetrag(kleinbetrag)}, § 33 UStDV) – Name und Anschrift des Kunden sind nicht nötig.
              </span>
            </div>
          ) : (
            <div className="bl-note warn">
              <TriangleAlert />
              <span>
                <b>Über {formatBetrag(kleinbetrag)}:</b> Name und Anschrift des Kunden sind Pflicht.
              </span>
            </div>
          )
        ) : null}
        {form.buchungId != null && editierbar ? (
          <div className="bl-note ok">
            <Paperclip />
            <span>Gehört zur schon erfassten Einnahme – es entsteht keine zweite.</span>
          </div>
        ) : null}
        {editierbar ? (
          <label className="toggle-row">
            <span>
              Mehrere Positionen aufführen
              <small>Für mehrere Artikel – die Summe wird zum Betrag.</small>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={form.mehrere}
                onChange={(e) => {
                  const an = e.target.checked;
                  setForm((f) =>
                    an
                      ? { ...f, mehrere: true, positionen: f.positionen.map((p, j) => (j === 0 && !p.beschreibung ? { ...p, beschreibung: f.betreff } : p)) }
                      : { ...f, mehrere: false, positionen: [{ ...f.positionen[0], beschreibung: f.betreff, menge: '1', preis: preisEingabe(formularSumme(f)) }] },
                  );
                }}
              />
              <span />
            </span>
          </label>
        ) : null}
      </div>
    </Karte>
  );
}

function QuittungAngabenKarte({ m, i }: { m: MaskeKontext; i: number }) {
  const { form, set, setForm, editierbar, kunde } = m;
  const gebunden = kunde.art === 'kunde';
  return (
    <Karte k="angaben" titel="Angaben" icon={Receipt} i={i}>
      <div className="bl-stack">
        <div className="field">
          <label className="field-label" htmlFor="bl-von">
            Erhalten von <span className="muted">(Kunde · optional bis {formatBetrag(m.kleinbetrag)})</span>
          </label>
          <div className="bl-search">
            <Search />
            <input
              id="bl-von"
              className={`input ${m.fehler.kunde ? 'invalid' : ''}`}
              list="bl-kunden"
              value={form.kunde}
              placeholder="Barverkauf – oder Name, Kunden werden vorgeschlagen"
              autoComplete="off"
              readOnly={!editierbar}
              onChange={(e) => set('kunde', e.target.value)}
            />
          </div>
          {form.kunde.trim() || !editierbar ? <KundeInfo m={m} mitAnschrift={false} /> : null}
          <Fehler text={m.fehler.kunde} />
        </div>
        {(!gebunden || !anschriftAusKartei(m)) && kunde.art !== 'wahl' && (editierbar || form.adresse) ? (
          <div className="field">
            <label className="field-label" htmlFor="bl-adresse-q">
              Anschrift <span className="muted">(optional)</span>
            </label>
            <textarea id="bl-adresse-q" className="textarea" rows={2} value={form.adresse} placeholder={'Straße und Hausnummer\nPLZ Ort'} onChange={(e) => set('adresse', e.target.value)} />
          </div>
        ) : null}
        <div className="field">
          <label className="field-label" htmlFor="bl-fuer">
            Für (Leistung / Gegenstand)
          </label>
          <input id="bl-fuer" className="input" list="bl-postexte" value={form.betreff} placeholder="z. B. Rasenmähen inkl. Kantenschnitt" onChange={(e) => {
            const v = e.target.value;
            setForm((f) => betreffSetzen(f, v));
          }} />
        </div>
        <div className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor="bl-datum-q">
              Datum
            </label>
            <input id="bl-datum-q" type="date" className="input" value={form.datum} onChange={(e) => {
              const v = e.target.value;
              setForm((f) => ({ ...f, datum: v, leistungVon: v }));
            }} />
          </div>
          <div className="field full">
            <span className="field-label">Zahlungsweg</span>
            <ZahlungsartWahl m={m} id="bl-za-q" />
          </div>
        </div>
        {editierbar && form.zahlungsart === 'bar' ? (
          <p className="hint">
            <Info /> Will der Kunde die Arbeitskosten absetzen (§ 35a EStG)? Dann eine Rechnung schreiben – absetzbar nur bei Überweisung.
          </p>
        ) : null}
      </div>
    </Karte>
  );
}

/** Hat der gewählte Kunde eine Anschrift in der Kartei? */
function anschriftAusKartei(m: MaskeKontext): boolean {
  if (m.kunde.art !== 'kunde') return false;
  const id = m.kunde.kunde.id;
  const v = m.stamm.kunden.find((y) => y.id === id);
  return !!(v && (v.strasse || v.ort));
}

/* ---------- Eigenbeleg ---------- */

function EigenZahlungKarte({ m, i }: { m: MaskeKontext; i: number }) {
  const { form, setForm, editierbar, stamm, summe } = m;
  const kats = stamm.kategorien.filter((k) => k.typ === 'ausgabe');
  const kat = form.positionen[0]?.kategorieId ?? null;
  return (
    <Karte k="ebzahlung" titel="Zahlung" icon={Banknote} i={i}>
      <div className="bl-stack">
        <BetragFeld m={m} id="bl-betrag-eb" />
        <div className="bl-worte">
          <small>in Worten</small>
          <span>{betragInWorten(Math.max(0, summe))}</span>
        </div>
        <div className="form-grid">
          <div className="field">
            <label className="field-label" htmlFor="bl-datum-eb">
              Datum der Zahlung
            </label>
            <input id="bl-datum-eb" type="date" className="input" max={heuteIso()} value={form.datum} onChange={(e) => {
              const v = e.target.value;
              setForm((f) => ({ ...f, datum: v, leistungVon: v }));
            }} />
          </div>
          <div className="field full">
            <span className="field-label">Zahlungsweg</span>
            <ZahlungsartWahl m={m} id="bl-za-eb" />
          </div>
          <div className="field full">
            <span className="field-label" id="bl-kat-l">
              Kategorie
            </span>
            <div className={`bl-kats ${m.fehler.kategorie ? 'invalid' : ''}`} role="radiogroup" aria-labelledby="bl-kat-l">
              {kats.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={k.id === kat}
                  className={`bl-kat ${k.id === kat ? 'on' : ''}`}
                  style={{ '--k': k.farbe ?? 'var(--accent)' } as React.CSSProperties}
                  title={k.euer_bereich ?? undefined}
                  disabled={!editierbar}
                  onClick={() => setForm((f) => ({ ...f, positionen: f.positionen.map((p, j) => (j === 0 ? { ...p, kategorieId: k.id } : p)) }))}
                >
                  <KategorieIcon icon={k.icon} />
                  <span>{k.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        {form.buchungId != null && editierbar ? (
          <div className="bl-note ok">
            <Paperclip />
            <span>Wird an die schon erfasste Ausgabe angehängt – es entsteht keine zweite.</span>
          </div>
        ) : null}
      </div>
    </Karte>
  );
}

function EmpfaengerKarte({ m, i }: { m: MaskeKontext; i: number }) {
  const { form, set } = m;
  return (
    <Karte k="empf" titel="Zahlungsempfänger" icon={Store} i={i}>
      <div className="bl-stack">
        <div className="field">
          <label className="field-label" htmlFor="bl-empf">
            Name <span className="muted">(Geschäft, kein Kunde)</span>
          </label>
          <input id="bl-empf" className="input" list="bl-empf" value={form.kunde} placeholder="z. B. Parkhaus am Markt" autoComplete="off" onChange={(e) => set('kunde', e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="bl-empf-adr">
            Anschrift <span className="muted">(soweit bekannt)</span>
          </label>
          <textarea id="bl-empf-adr" className="textarea" rows={2} value={form.adresse} placeholder={'Straße und Hausnummer\nPLZ Ort'} onChange={(e) => set('adresse', e.target.value)} />
        </div>
      </div>
    </Karte>
  );
}

function ZweckKarte({ m, i }: { m: MaskeKontext; i: number }) {
  const { form, set, setForm } = m;
  return (
    <Karte k="zweck" titel="Gegenstand & Grund" icon={Pencil} i={i}>
      <div className="bl-stack">
        <div className="field">
          <label className="field-label" htmlFor="bl-zweck">
            Gegenstand / Zweck der Ausgabe
          </label>
          <textarea id="bl-zweck" className="textarea" rows={2} value={form.betreff} placeholder="z. B. Parkgebühr beim Kundentermin" onChange={(e) => {
            const v = e.target.value;
            setForm((f) => betreffSetzen(f, v));
          }} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="bl-grund">
            Grund für den Eigenbeleg
          </label>
          <select id="bl-grund" className="select" value={form.grund} onChange={(e) => set('grund', e.target.value as EigenbelegGrund)}>
            {(Object.entries(EIGENBELEG_GRUENDE) as [EigenbelegGrund, string][]).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {form.grund === 'sonstiges' ? (
          <div className="field">
            <label className="field-label" htmlFor="bl-grund-text">
              Grund (Beschreibung)
            </label>
            <input id="bl-grund-text" className="input" value={form.grundText} placeholder="Warum gibt es keinen Originalbeleg?" onChange={(e) => set('grundText', e.target.value)} />
          </div>
        ) : null}
      </div>
    </Karte>
  );
}

/* ---------- ausgestellt: Sperre, unterschriebenes Exemplar, Aktionen ---------- */

function SperrHinweis({ beleg }: { beleg: BelegVoll }) {
  const storniert = beleg.status === 'storniert' && beleg.art !== 'storno';
  return (
    <div className="bl-lock reveal" style={reveal(1)}>
      <Lock />
      <div>
        <b>{beleg.art === 'storno' ? `Stornobeleg zu ${beleg.storno_von_nummer ?? '—'}` : 'Ausgestellt – Änderungen nur per Storno (GoBD)'}</b>
        <span>
          {beleg.art === 'storno'
            ? 'Hebt das Original auf. Endgültig und unverändert archiviert.'
            : storniert
              ? `Storniert${beleg.storno_nummer ? ` durch ${beleg.storno_nummer}` : ''} – bleibt unverändert archiviert.`
              : 'Nummer, Datum und Beträge sind festgeschrieben. Für Korrekturen stornieren und neu erstellen – oder duplizieren.'}
        </span>
        {beleg.angebot_nummer ? <span>Aus Angebot {beleg.angebot_nummer}.</span> : null}
      </div>
      {beleg.art === 'storno' && beleg.storno_von_id != null ? (
        <Link className="link" to={`/belege/${beleg.storno_von_id}`}>
          Original
        </Link>
      ) : beleg.storno_id != null ? (
        <Link className="link" to={`/belege/${beleg.storno_id}`}>
          Stornobeleg
        </Link>
      ) : null}
    </div>
  );
}

function ScanKarte({ beleg, onDatei }: { beleg: BelegVoll; onDatei: (pfad: string) => void }) {
  const waehlen = async () => {
    if (!inTauri()) return;
    const r: string | string[] | null = await dateiDialog({
      title: `Unterschriebenes Exemplar zu ${beleg.nummer ?? 'diesem Beleg'}`,
      multiple: false,
      directory: false,
      filters: [{ name: 'PDF oder Bild', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'heic', 'heif', 'webp', 'tif', 'tiff'] }],
    });
    const pfad = Array.isArray(r) ? r[0] : r;
    if (pfad) onDatei(pfad);
  };
  const sub = beleg.art === 'eigenbeleg' ? 'Ausdrucken, unterschreiben, einscannen – gehört zum Beleg.' : 'Optional: Scan oder Foto des unterschriebenen Belegs.';
  return (
    <section className="card bl-card bl-scan reveal" style={reveal(1)} data-card="scan">
      <div className="card-head">
        <div>
          <div className="card-title">
            <Paperclip />
            Unterschriebenes Exemplar
          </div>
          <div className="card-sub">{sub}</div>
        </div>
      </div>
      {beleg.scan_beleg_id != null ? (
        <div className="file-chip">
          <FileText />
          <b>angehängt</b>
          <span className="badge bezahlt">ergänzt den Beleg</span>
          <button type="button" className="icon-btn sm" title="Öffnen" aria-label="Unterschriebenes Exemplar öffnen" onClick={() => void belegOeffnen(beleg.scan_beleg_id as number)}>
            <FileText />
          </button>
          <button type="button" className="icon-btn sm" title="Im Finder zeigen" aria-label="Im Finder zeigen" onClick={() => void belegZeigen(beleg.scan_beleg_id as number)}>
            <FolderSearch />
          </button>
        </div>
      ) : (
        <button type="button" className="dropzone bl-drop" onClick={() => void waehlen()}>
          <Upload />
          <span>
            <b>Datei aufs Fenster ziehen</b> oder klicken zum Auswählen
          </span>
          <small>PDF oder Foto</small>
        </button>
      )}
    </section>
  );
}

function AusgestelltAktionen({ beleg, zeile, mailen }: { beleg: BelegVoll; zeile: BelegZeile; mailen: () => void }) {
  const navigate = useNavigate();
  const h = heuteIso();
  const status = (() => {
    if (beleg.art === 'storno') return `Stornobeleg vom ${datumText(beleg.datum)}`;
    if (beleg.status === 'storniert') return `Storniert${beleg.storniert_am ? ` am ${datumText(beleg.storniert_am)}` : ''}`;
    if (beleg.art === 'rechnung' && beleg.status === 'offen') return `Offen · fällig ${datumText(beleg.faellig_am)}`;
    if (beleg.art === 'angebot') return beleg.status === 'angenommen' ? 'In Rechnung umgewandelt' : beleg.status === 'abgelehnt' ? 'Vom Kunden abgelehnt' : `gültig bis ${datumText(beleg.faellig_am)}`;
    if (beleg.status === 'bezahlt') {
      const was = beleg.art === 'eigenbeleg' ? 'Ausgabe gebucht' : beleg.art === 'quittung' ? 'Bezahlt' : 'Bezahlt';
      return `${was} am ${datumText(beleg.bezahlt_am ?? beleg.datum)}${beleg.buchung_nummer ? ` · ${beleg.buchung_nummer}` : ''}`;
    }
    return '';
  })();
  return (
    <>
      <span className="bl-status">
        <StatusBadge z={zeile} heute={h} />
        {status}
      </span>
      <span className="spacer" />
      {beleg.pdf_beleg_id != null ? (
        <>
          <button type="button" className="icon-btn" title="Im Finder zeigen" aria-label="PDF im Finder zeigen" onClick={() => void belegZeigen(beleg.pdf_beleg_id as number)}>
            <FolderSearch />
          </button>
          <button type="button" className="icon-btn" title="Per Mail senden" aria-label="Per Mail senden" onClick={mailen}>
            <Mail />
          </button>
        </>
      ) : null}
      <button type="button" className="btn ghost" onClick={() => void pdfOeffnenFuer(beleg.id)}>
        <Printer />
        {beleg.pdf_beleg_id != null ? 'PDF öffnen' : 'PDF erzeugen'}
      </button>
      {beleg.art === 'rechnung' && beleg.status === 'offen' ? (
        <button type="button" className="btn-primary sm" onClick={() => belegDialog('bezahlt', zeile)}>
          <Check />
          Als bezahlt markieren
        </button>
      ) : beleg.art === 'angebot' && beleg.status !== 'angenommen' ? (
        <button type="button" className="btn-primary sm" onClick={() => statusAktionAusfuehren('umwandeln', zeile, navigate)}>
          <FileText />
          In Rechnung umwandeln
        </button>
      ) : null}
    </>
  );
}
