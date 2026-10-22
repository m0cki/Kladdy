/* Die eine Erfassen-Schublade (§6.4, 520 px): Einnahme oder Ausgabe erfassen bzw. eine Buchung bearbeiten.
 * Geöffnet nur über lib/erfassen.ts (erfassen(vorbelegung) · bearbeiten(id)); hängt im AppShell, also auf jeder Seite.
 * Reihenfolge wie im Prototyp (referenz/prototyp/js/pages/buchungen.js): Typ · Betrag groß · Kategorie-Kacheln (Vorschlag
 * über Stichworte) · Zahlungsdatum, Beleg-Nr., Beschreibung, Kunde bzw. Geschäft · Mehr Optionen (Privatanteil) ·
 * Bezahlt per · Beleg. Speichern ⌘↩, „Speichern & neu“ ⇧⌘↩. Geschrieben wird nur über Rust (buchung_anlegen/_aendern).
 * Ungespeicherte Eingaben setzen useUi.ungespeichert (Neustart nach Update fragt dann nach; Schließen auch).
 * Belege: vorgemerkte Dateien (Drop aufs Fenster, ⌘O, Klick auf die Dropzone) stehen in useErfassen.belege und gehen
 * beim Speichern als `belege` mit; bei gesperrten Einträgen (festgeschrieben) nur über „Beleg anhängen“ (beleg_anhaengen).
 * Neue Einnahme: „Beleg zum Ertrag“ (BelegZumErtrag.tsx, lib/ertrag.ts) – Beleg erstellen stellt Quittung bzw. Rechnung
 * samt Einnahme in EINER Transaktion aus (beleg_ausstellen), „Offene Rechnung zuordnen“ bucht deren Zahlung
 * (beleg_bezahlt), „Ohne eigenen Beleg“ ist die einfache Einnahme (buchung_anlegen).
 * Belegerkennung: useBelegErkennung (BelegErkennung.tsx) füllt leere Felder, zeigt oben die Zusammenfassung und an den
 * Feldern „aus PDF“ / „aus Dateiname“.
 * Termin bzw. vorbereiteter Beleg (Vorbelegung `termin`/`entwurf`, §6.5): oben eine Hinweiszeile; „Beleg erstellen“ stellt
 * den Entwurf mit Nummer aus (Termin ⇒ erledigt), „Offene Rechnung zuordnen“ macht die Rechnung zum Beleg des Termins,
 * „Ohne eigenen Beleg“ schließt ihn „ohne Beleg“ ab – der Entwurf wird dabei verworfen, alles in Rust. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  Ban,
  CalendarDays,
  Check,
  ChevronDown,
  Clock,
  FilePlus,
  Info,
  Lock,
  Minus,
  Paperclip,
  Pencil,
  Plus,
  Sparkles,
  TriangleAlert,
  User,
  Users,
} from 'lucide-react';
import {
  SPERR_TEXT,
  ZAHLUNGSWEGE,
  abziehbar,
  datumKurz,
  formularSchluessel,
  geschaefte,
  geschaeftZu,
  kannStornieren,
  kategorieAusText,
  kundeAufloesen,
  kundenLabel,
  nameSchluessel,
  privatProzent,
  pruefeFormular,
  sperre,
  typName,
  type BuchungTyp,
  type BuchungZeile,
  type FormFeld,
  type Formular,
  type Geschaeft,
  type KategorieWahl,
  type KundeKurz,
  type Sperre,
} from '../../lib/buchungen';
import { anhaengen, vorgemerkteAnhaengen } from '../../lib/belegablage';
import { pdfNachholen } from '../../lib/belegaktionen';
import { belegZusatz, belegeAnzahl, type VorgemerkterBeleg } from '../../lib/belege';
import { datenbankVerfuegbar } from '../../lib/db';
import { belegeLeeren, erfassenFertig, erfassenSchliessen, useErfassen, type Vorbelegung } from '../../lib/erfassen';
import {
  belegVorbereiten,
  ertragPruefen,
  ertragSchluessel,
  ertragStart,
  maskenPfad,
  rechnungOffen,
  type Ertrag,
  type ErtragsArt,
  type Ertragsweg,
} from '../../lib/ertrag';
import { fehlerText } from '../../lib/fehler';
import { betragAlsEingabe, formatBetrag, parseBetrag } from '../../lib/money';
import {
  buchungAendern,
  buchungAnlegen,
  ladeBuchung,
  ladeFestBis,
  ladeKategorienWahl,
  ladeKundenKurz,
  ladeLieferanten,
} from '../../lib/queries/buchungen';
import { ladeErtragStamm, type ErtragStamm } from '../../lib/queries/ertrag';
import { belegAusstellen, belegBezahlt, belegScanAnhaengen, ladeBeleg } from '../../lib/queries/rechnungen';
import { ladeTermin } from '../../lib/queries/termine';
import { formularAusEntwurf, type BelegZeile as RechnungsZeile } from '../../lib/rechnungen';
import { storniere, storniereMitNachfrage } from '../../lib/storno';
import { ART_LABEL, erfassenHinweis, ertragAusEntwurf, ertragBezug, vorbelegungMitBezug, type ErfassenBezug } from '../../lib/termine';
import { heute, imZeitraum, istDatum, zeitraum } from '../../lib/zeitraum';
import { useUi, type Toast, type ToastAction } from '../../store/ui';
import { Drawer } from '../ui/Drawer';
import { EmptyState } from '../ui/EmptyState';
import { Seg } from '../ui/Seg';
import { KategorieIcon, ZAHLUNGSWEG_ICON } from '../buchungen/Symbole';
import { BelegDropzone, VorgemerkteBelege, VorhandeneBelege, useBelegeZuBuchung } from '../belege/BelegDateien';
import { belegDialog } from '../belege/BelegDialog';
import { BelegZumErtrag } from './BelegZumErtrag';
import { useBelegErkennung, type ErkennungAnsicht } from './BelegErkennung';

interface Stamm {
  kategorien: KategorieWahl[];
  kunden: KundeKurz[];
  geschaefte: Geschaeft[];
  festBis: string | null;
}

async function ladeStamm(): Promise<Stamm> {
  const [kategorien, kunden, lieferanten, festBis] = await Promise.all([ladeKategorienWahl(), ladeKundenKurz(), ladeLieferanten(), ladeFestBis()]);
  return { kategorien, kunden, geschaefte: geschaefte(lieferanten), festBis };
}

const standardKategorie = (kats: readonly KategorieWahl[], typ: BuchungTyp): number | null => kats.find((k) => k.typ === typ)?.id ?? null;

/** Termin bzw. vorbereiteter Beleg zur neuen Einnahme (Termine › „Quittung ausstellen“, Maske eines vorbereiteten
 *  Belegs, §6.5). Ein schon ausgestellter Entwurf zählt nicht mehr; ohne `entwurf` gilt der des Termins. */
async function ladeBezug(v: Vorbelegung, h: string): Promise<ErfassenBezug | null> {
  if (v.termin == null && v.entwurf == null) return null;
  let termin = v.termin != null ? await ladeTermin(v.termin) : null;
  const entwurfId = v.entwurf ?? termin?.entwurf?.id ?? null;
  let entwurf: ErfassenBezug['entwurf'] = null;
  if (entwurfId != null) {
    const b = await ladeBeleg(entwurfId);
    if (b && !b.beleg.nummer) {
      entwurf = { id: entwurfId, kundeId: b.beleg.kunde_id, formular: formularAusEntwurf(b.beleg, b.positionen, h) };
      if (!termin && b.beleg.termin_id != null) termin = await ladeTermin(b.beleg.termin_id);
    }
  }
  return termin || entwurf ? { termin, entwurf } : null;
}

/** Text zum Termin im Toast nach dem Speichern. */
function terminText(b: ErfassenBezug | null, abschluss: string): string {
  if (!b?.termin) return '';
  const art = b.entwurf?.formular.art;
  const verworfen = abschluss !== 'erledigt' && (art === 'quittung' || art === 'rechnung') ? ` · vorbereitete ${ART_LABEL[art]} verworfen` : '';
  return ` · Termin ${abschluss}${verworfen}`;
}

/** Toast, dessen Knöpfe ihn auch schließen. */
function toastMit(t: Omit<Toast, 'id' | 'actions'>, aktionen: ToastAction[]): void {
  let id = 0;
  id = useUi.getState().showToast({
    ...t,
    actions: aktionen.map((a) => ({
      label: a.label,
      run: () => {
        useUi.getState().dismissToast(id);
        a.run();
      },
    })),
  });
}

/** Feld bzw. Kasten kurz wackeln lassen und in Sicht holen. */
function wackeln(el: Element | null): void {
  if (!(el instanceof HTMLElement)) return;
  el.scrollIntoView({ block: 'nearest' });
  el.classList.remove('bu-shake');
  void el.offsetWidth;
  el.classList.add('bu-shake');
}

function leeresFormular(stamm: Stamm, v: Vorbelegung): Formular {
  const typ: BuchungTyp = v.typ ?? (v.kunde != null || v.beleg ? 'einnahme' : 'ausgabe');
  const kunde = v.kunde != null ? stamm.kunden.find((k) => k.id === v.kunde) : undefined;
  return {
    typ,
    betrag: v.betrag && v.betrag > 0 ? betragAlsEingabe(v.betrag) : '',
    kategorieId: standardKategorie(stamm.kategorien, typ),
    zahlungsdatum: v.datum ?? heute(),
    belegnummer: v.belegnummer ?? '',
    beschreibung: v.text ?? '',
    wer: typ === 'einnahme' ? (kunde ? kundenLabel(kunde) : '') : (v.lieferant ?? ''),
    kundeBewusstNeu: null,
    privat: '',
    zahlungsart: v.zahlungsart ?? 'bank',
  };
}

function formularAus(b: BuchungZeile): Formular {
  return {
    typ: b.typ,
    betrag: betragAlsEingabe(b.betrag_cent),
    kategorieId: b.kategorie_id,
    zahlungsdatum: b.zahlungsdatum,
    belegnummer: b.belegnummer ?? '',
    beschreibung: b.beschreibung,
    wer: b.typ === 'einnahme' ? (b.kunde_name ? kundenLabel({ name: b.kunde_name, nummer: b.kunde_nummer ?? '' }) : '') : (b.lieferant ?? ''),
    kundeBewusstNeu: null,
    privat: b.privatanteil_prozent ? String(b.privatanteil_prozent) : '',
    zahlungsart: b.zahlungsart ?? 'bank',
  };
}

type Ladezustand = { status: 'laden' } | { status: 'ohne-db' } | { status: 'fehler'; fehler: string } | { status: 'ok' };

export function ErfassenSchublade() {
  const navigate = useNavigate();
  const open = useUi((s) => s.drawer === 'erfassen');
  const auftrag = useErfassen((s) => s.auftrag);
  const belege = useErfassen((s) => s.belege);
  const [laden, setLaden] = useState<Ladezustand>({ status: 'laden' });
  // Beleg zum Ertrag (nur neue Einnahmen)
  const [ertrag, setErtragWert] = useState<Ertrag>(() => ertragStart({}, 'quittung'));
  const [ertragStartWert, setErtragStartWert] = useState('');
  const [ertragStamm, setErtragStamm] = useState<ErtragStamm | null>(null);
  const [ertragLadeFehler, setErtragLadeFehler] = useState<string | null>(null);
  const [ertragFehler, setErtragFehler] = useState<string | undefined>(undefined);
  const setErtrag = useCallback((teil: Partial<Ertrag>) => {
    setErtragWert((e) => ({ ...e, ...teil }));
    setErtragFehler(undefined);
  }, []);
  const [stamm, setStamm] = useState<Stamm | null>(null);
  // Termin bzw. vorbereiteter Beleg (nur neue Einnahmen aus Termine bzw. der Maske eines vorbereiteten Belegs)
  const [bezug, setBezug] = useState<ErfassenBezug | null>(null);
  const [zeile, setZeile] = useState<BuchungZeile | null>(null);
  const [form, setForm] = useState<Formular | null>(null);
  const [start, setStart] = useState('');
  const [fehler, setFehler] = useState<Partial<Record<FormFeld, string>>>({});
  const [katVorschlag, setKatVorschlag] = useState(false);
  const [katGewaehlt, setKatGewaehlt] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  /** zu welchem Auftrag (n) das geladene Formular gehört – bis zum Laden zeigt die Schublade noch den alten Stand */
  const [geladenN, setGeladenN] = useState(0);

  // Öffnen bzw. neuer Auftrag ⇒ Stammdaten (und ggf. die Buchung) laden, Formular aufbauen
  const auftragN = open ? (auftrag?.n ?? 0) : 0;
  useEffect(() => {
    if (!open || !auftrag) return;
    if (!datenbankVerfuegbar()) {
      setLaden({ status: 'ohne-db' });
      return;
    }
    let aktiv = true;
    setLaden({ status: 'laden' });
    setFehler({});
    setKatVorschlag(false);
    setKatGewaehlt(false);
    (async () => {
      const neu = auftrag.art === 'neu';
      // Belege zum Ertrag nur für neue Einträge; scheitert das Laden, bleibt „Ohne eigenen Beleg“
      const [s, es, b] = await Promise.all([
        ladeStamm(),
        neu ? ladeErtragStamm().then((x): ErtragStamm | string => x, (e: unknown) => fehlerText(e)) : Promise.resolve(null),
        neu ? ladeBezug(auftrag.vorbelegung, heute()) : Promise.resolve(null),
      ]);
      // was der Aufrufer nicht vorgibt, kommt aus Termin bzw. Entwurf (Kunde, Betrag, Leistung, Art)
      const v: Vorbelegung = auftrag.art === 'neu' ? vorbelegungMitBezug(auftrag.vorbelegung, b) : {};
      let f: Formular;
      let z: BuchungZeile | null = null;
      if (auftrag.art === 'bearbeiten') {
        z = await ladeBuchung(auftrag.id);
        if (!z) throw new Error('Diesen Eintrag gibt es nicht (mehr).');
        f = formularAus(z);
      } else f = leeresFormular(s, v);
      if (!aktiv) return;
      const esOk = es && typeof es !== 'string' ? es : null;
      const e0: Ertrag = { ...ertragStart(v, esOk?.belegArt ?? 'quittung'), ...(b?.entwurf ? ertragAusEntwurf(b.entwurf) : {}) };
      const e: Ertrag = esOk ? e0 : { ...e0, weg: 'ohne' };
      setStamm(s);
      setBezug(b);
      setZeile(z);
      setForm(f);
      setStart(formularSchluessel(f));
      setErtragStamm(esOk);
      setErtragLadeFehler(typeof es === 'string' ? es : null);
      setErtragWert(e);
      setErtragStartWert(ertragSchluessel(e));
      setErtragFehler(undefined);
      setGeladenN(auftrag.n);
      setLaden({ status: 'ok' });
    })().catch((e: unknown) => {
      if (aktiv) setLaden({ status: 'fehler', fehler: fehlerText(e) });
    });
    return () => {
      aktiv = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur bei neuem Auftrag
  }, [auftragN]);

  const sp: Sperre | null = zeile ? sperre(zeile) : null;
  const nurLesen = sp !== null;
  const bearbeitung = auftrag?.art === 'bearbeiten';
  // Belege annehmen: nicht an Gegenbuchungen (Rust lehnt ab) und nicht an stornierte Einträge
  const gegenbuchung = zeile?.storno_von_id != null;
  const aktuell = laden.status === 'ok' && geladenN === auftragN;
  const nimmtBelege = aktuell ? !gegenbuchung && sp !== 'storniert' : laden.status === 'laden' || laden.status === 'ok';
  // Beleg zum Ertrag: nur bei neuen Einnahmen, sonst wie „Ohne eigenen Beleg“
  const ertragAktiv = !bearbeitung && form?.typ === 'einnahme';
  const weg: Ertragsweg = ertragAktiv ? ertrag.weg : 'ohne';
  const dirty =
    laden.status === 'ok' &&
    !!form &&
    ((!nurLesen && formularSchluessel(form) !== start) || (nimmtBelege && belege.length > 0) || (ertragAktiv && ertragSchluessel(ertrag) !== ertragStartWert));

  useEffect(() => {
    if (!open) return;
    useErfassen.setState({ nimmtBelege });
    // während des Ladens angekommene Dateien, die hier nicht abgelegt werden können, wieder verwerfen
    if (aktuell && !nimmtBelege && useErfassen.getState().belege.length) belegeLeeren();
  }, [open, nimmtBelege, aktuell]);

  useEffect(() => {
    if (open) useUi.getState().setUngespeichert(dirty);
  }, [open, dirty]);

  // Betrag fokussieren, sobald das Formular steht
  useEffect(() => {
    if (laden.status !== 'ok' || nurLesen) return;
    const t = setTimeout(() => {
      const el = document.getElementById('bf-betrag') as HTMLInputElement | null;
      el?.focus({ preventScroll: true });
      if (bearbeitung) el?.select();
    }, 260);
    return () => clearTimeout(t);
  }, [laden.status, auftragN, nurLesen, bearbeitung]);

  const set = useCallback(<K extends keyof Formular>(k: K, v: Formular[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }, []);
  const fehlerWeg = (k: FormFeld) => setFehler((x) => (x[k] ? { ...x, [k]: undefined } : x));
  // beim eigenen Beleg ist die Datei das unterschriebene Exemplar – daraus wird nichts ins Formular übernommen
  const erkannt = useBelegErkennung({
    auftragN,
    bereit: aktuell,
    form,
    start,
    neu: !bearbeitung,
    nurLesen: nurLesen || weg === 'beleg',
    katGewaehlt,
    kategorien: stamm?.kategorien,
    setForm,
    fehlerWeg,
  });

  /* ---------- Speichern ---------- */
  const speichern = useCallback(
    async (undNeu: boolean) => {
      if (!form || !stamm || nurLesen || speichert) return;
      const h = heute();
      const ui = useUi.getState();

      /** Nach dem Speichern: schließen bzw. („Speichern & neu“) Typ, Datum, Zahlungsweg und Beleg-Art stehen lassen. */
      const danach = async () => {
        if (!undNeu) {
          erfassenFertig();
          return;
        }
        const [s, es] = await Promise.all([
          ladeStamm().catch(() => stamm),
          ertragAktiv ? ladeErtragStamm().catch(() => ertragStamm) : Promise.resolve(ertragStamm),
        ]);
        const f = leeresFormular(s, { typ: form.typ, datum: form.zahlungsdatum, zahlungsart: form.zahlungsart });
        const e: Ertrag = { ...ertrag, adresse: '', leistung: '', offenId: null, ...(bezug ? { vorlage: null, bezahlt: true } : {}) };
        setStamm(s);
        setBezug(null); // der nächste Eintrag gehört zu keinem Termin mehr
        setForm(f);
        setStart(formularSchluessel(f));
        setErtragStamm(es);
        setErtragWert(e);
        setErtragStartWert(ertragSchluessel(e));
        setErtragFehler(undefined);
        belegeLeeren();
        setFehler({});
        setKatVorschlag(false);
        setKatGewaehlt(false);
        document.querySelector('.bu-drawer .drawer-body')?.scrollTo({ top: 0 });
        setTimeout(() => document.getElementById('bf-betrag')?.focus({ preventScroll: true }), 30);
      };

      /* Offene Rechnung zuordnen: Betrag, Text und Kunde kommen aus der Rechnung – hier zählt nur das Zahlungsdatum */
      if (weg === 'offen') {
        const re = ertragStamm?.offene.find((x) => x.id === ertrag.offenId);
        if (!re) {
          setErtragFehler(ertragPruefen(form, ertrag, belege.length)?.text ?? 'Bitte eine offene Rechnung auswählen.');
          wackeln(document.querySelector('.bu-drawer .bu-offen, .bu-drawer .bu-offen-empty'));
          return;
        }
        const datumFehler = !istDatum(form.zahlungsdatum)
          ? 'Bitte das Zahlungsdatum wählen.'
          : stamm.festBis && form.zahlungsdatum <= stamm.festBis
            ? `Bis ${datumKurz(stamm.festBis)} ist festgeschrieben – bitte ein späteres Datum.`
            : null;
        if (datumFehler) {
          setFehler({ zahlungsdatum: datumFehler });
          wackeln(document.getElementById('bf-zahlungsdatum')?.closest('.field') ?? null);
          return;
        }
        setSpeichert(true);
        try {
          // zum Termin: die bezahlte Rechnung wird sein Beleg, ein vorbereiteter Entwurf wird verworfen (Rust)
          const termin = bezug?.termin?.id ?? null;
          const res = await belegBezahlt(re.id, form.zahlungsdatum, form.zahlungsart, h, termin);
          ui.datenGeaendert();
          if (belege.length && res.buchung_id != null && res.buchung_nummer) {
            await anhaengen({ id: res.buchung_id, nummer: res.buchung_nummer, typ: 'einnahme' }, belege);
          }
          const ziel = { ...re, status: 'bezahlt' as const, bezahlt_am: form.zahlungsdatum, zahlungsart: form.zahlungsart };
          const zumTermin = re.termin_id != null && re.termin_id === termin ? '' : terminText(bezug, 'erledigt (mit dieser Rechnung)');
          toastMit({ text: `${re.nummer} bezahlt · Einnahme ${res.buchung_nummer ?? ''} gespeichert${zumTermin}`, icon: 'check' }, [
            { label: 'Beleg öffnen', run: () => navigate(`/belege/${re.id}`) },
            { label: 'Rückgängig', run: () => belegDialog('doch-offen', ziel) },
          ]);
          await danach();
        } catch (e) {
          ui.showToast({ text: fehlerText(e), icon: 'warn', sticky: true });
        } finally {
          setSpeichert(false);
        }
        return;
      }

      const offenRechnung = weg === 'beleg' && rechnungOffen(ertrag);
      // eine noch offene Rechnung trägt das Rechnungsdatum, keine Zahlung – die Festschreibung betrifft sie nicht
      const r = pruefeFormular(form, {
        kategorien: stamm.kategorien,
        kunden: stamm.kunden,
        heute: h,
        festBis: offenRechnung ? null : stamm.festBis,
        belegdatum: zeile?.belegdatum ?? erkannt.belegdatum,
      });
      const ef = weg === 'beleg' ? ertragPruefen(form, ertrag, belege.length) : null;
      if (!r.ok || ef) {
        const alle: Partial<Record<FormFeld, string>> = { ...(ef?.feld === 'wer' ? { wer: ef.text } : {}), ...(r.ok ? {} : r.fehler) };
        setFehler(alle);
        if (ef && ef.feld !== 'wer') setErtragFehler(ef.text);
        const erstes = (['betrag', 'kategorie', 'zahlungsdatum', 'beschreibung', 'wer', 'privat'] as const).find((k) => alle[k]);
        if (erstes) {
          const el = document.getElementById(`bf-${erstes}`);
          if (erstes === 'privat') (el?.closest('details') as HTMLDetailsElement | null)?.setAttribute('open', '');
          (el?.matches('input') ? el : el?.querySelector<HTMLElement>('button'))?.focus();
          wackeln(el?.closest('.field') ?? null);
        } else wackeln(document.querySelector('.bu-drawer .bu-scan'));
        return;
      }

      /* Beleg erstellen: Quittung bzw. Rechnung samt Einnahme (außer bei offener Rechnung) in einer Transaktion */
      if (weg === 'beleg') {
        if (!ertragStamm) return;
        // mit vorbereitetem Entwurf: genau dieser bekommt seine Nummer (Termin ⇒ erledigt, beides in Rust)
        const entwurfId = bezug?.entwurf?.id ?? null;
        const v = belegVorbereiten(form, ertrag, r.daten.betrag_cent, { ...ertragStamm, heute: h }, ertragBezug(bezug));
        if (v.fehlt.length || !v.daten) {
          const pfad = entwurfId != null ? `/belege/${entwurfId}` : maskenPfad(ertrag.art, {
            betrag: r.daten.betrag_cent,
            datum: form.zahlungsdatum,
            text: form.beschreibung,
            kundeId: r.daten.kunde_id,
            name: r.daten.neuer_kunde ?? undefined,
            zahlungsart: form.zahlungsart,
            bezahlt: ertrag.art === 'rechnung' && ertrag.bezahlt,
            kategorieId: r.daten.kategorie_id,
          });
          const was = ertrag.art === 'rechnung' ? 'Rechnung' : 'Quittung';
          toastMit({ key: 'ertrag-pflicht', text: `Für die ${was} fehlt noch: ${v.fehlt.join(' · ')}`, icon: 'warn', sticky: true }, [
            {
              label: 'In der Maske ergänzen',
              run: () => {
                erfassenFertig();
                navigate(pfad);
              },
            },
          ]);
          return;
        }
        setSpeichert(true);
        try {
          const res = await belegAusstellen(entwurfId, v.daten, {
            dokument: { ...v.dokument, akzent: ui.settings.accent },
            bausteine: v.gedruckt,
            kategorie_id: r.daten.kategorie_id,
            heute: h,
          });
          ui.datenGeaendert();
          const teile = [offenRechnung ? `${res.nummer} ausgestellt · noch offen` : `Einnahme gespeichert · ${res.nummer} erstellt`];
          if (bezug?.termin) teile.push('Termin erledigt');
          if (res.kunde_neu && res.kunde_nummer) teile.push(`neuer Kunde ${res.kunde_nummer}`);
          // Schritt 2: unterschriebenes Exemplar (ergänzt den Beleg, ersetzt ihn nicht)
          const scan = belege[0];
          if (scan) {
            try {
              await belegScanAnhaengen(res.id, scan.pfad);
              teile.push('unterschriebenes Exemplar abgelegt');
            } catch (e) {
              ui.showToast({ text: `Das unterschriebene Exemplar ließ sich nicht anhängen: ${fehlerText(e)} – in der Maske erneut versuchen.`, icon: 'warn', sticky: true });
            }
          }
          const ziel = {
            id: res.id,
            nummer: res.nummer,
            art: ertrag.art,
            status: offenRechnung ? ('offen' as const) : ('bezahlt' as const),
            summe_cent: r.daten.betrag_cent,
            zahlungsart: offenRechnung ? null : form.zahlungsart,
            bezahlt_am: offenRechnung ? null : form.zahlungsdatum,
            termin_id: bezug?.termin?.id ?? null,
          };
          toastMit({ text: teile.join(' · '), icon: 'check' }, [
            { label: 'Beleg öffnen', run: () => navigate(`/belege/${res.id}`) },
            { label: 'Rückgängig', run: () => belegDialog('stornieren', ziel) },
          ]);
          void pdfNachholen(res.id);
          await danach();
        } catch (e) {
          ui.showToast({ text: `Ausstellen ging nicht: ${fehlerText(e)}`, icon: 'warn', sticky: true });
        } finally {
          setSpeichert(false);
        }
        return;
      }

      // neue Einnahme ohne eigenen Beleg zum Termin: schließt ihn „ohne Beleg“ ab (Rust, dieselbe Transaktion)
      const terminId = !zeile && r.daten.typ === 'einnahme' ? (bezug?.termin?.id ?? null) : null;
      const mitDateien = belege.length ? { ...r.daten, belege: belege.map((b) => b.pfad) } : r.daten;
      const daten = terminId != null ? { ...mitDateien, termin_id: terminId } : mitDateien;
      setSpeichert(true);
      try {
        if (zeile) {
          const res = await buchungAendern(zeile.id, daten);
          ui.datenGeaendert();
          ui.showToast({ text: `Änderung gespeichert (im Protokoll) · ${zeile.nummer}${belegZusatz(res.belege_neu)}`, icon: 'check' });
          erfassenFertig();
          return;
        }
        const res = await buchungAnlegen(daten);
        ui.datenGeaendert();
        const { modus, anker } = ui.zeitraum;
        const z = zeitraum(modus, anker);
        const extra = `${res.kunde_neu && res.kunde_nummer ? ` · neuer Kunde ${res.kunde_nummer}` : ''}${imZeitraum(z, r.daten.zahlungsdatum) ? '' : ` · liegt außerhalb von ${z.label}`}`;
        const zumTermin = terminId != null ? terminText(bezug, 'ohne Beleg abgeschlossen') : '';
        const ziel = { id: res.id, nummer: res.nummer, typ: r.daten.typ };
        toastMit({ text: `${typName(r.daten.typ)} gespeichert · ${res.nummer}${belegZusatz(res.belege_neu)}${extra}${zumTermin}`, icon: 'check' }, [
          { label: 'Rückgängig', run: () => void storniere(ziel, undefined, `${typName(r.daten.typ)} ${res.nummer} zurückgenommen · storniert (im Protokoll)`) },
        ]);
        await danach();
      } catch (e) {
        ui.showToast({ text: fehlerText(e), icon: 'warn', sticky: true });
      } finally {
        setSpeichert(false);
      }
    },
    [form, stamm, zeile, nurLesen, speichert, belege, weg, ertrag, ertragStamm, ertragAktiv, navigate, erkannt.belegdatum, bezug],
  );

  // ⌘↩ speichern, ⇧⌘↩ speichern & neu
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void speichern(e.shiftKey && !bearbeitung);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, speichern, bearbeitung]);

  /* ---------- Kopf und Fuß ---------- */
  const typ = form?.typ ?? 'ausgabe';
  const titel = bearbeitung ? (nurLesen ? 'Buchung ansehen' : 'Buchung bearbeiten') : `${typName(typ)} erfassen`;
  const sub = zeile
    ? `Nr. ${zeile.nummer}${sp === 'storniert' ? ' · storniert' : sp === 'beleg' || sp === 'festgeschrieben' ? ' · festgeschrieben' : ''}`
    : bearbeitung
      ? undefined
      : 'Nr. wird beim Speichern vergeben';
  const icon = nurLesen ? Lock : bearbeitung ? Pencil : ArrowLeftRight;

  const stornoKnopf =
    zeile && kannStornieren(zeile) ? (
      <button
        type="button"
        className="btn danger"
        title="Stornieren statt Löschen: Gegenbuchung, das Original bleibt sichtbar (GoBD)"
        onClick={() =>
          storniereMitNachfrage(zeile, () => {
            if (useErfassen.getState().auftrag === auftrag) erfassenFertig();
          })
        }
      >
        <Ban />
        Stornieren
      </button>
    ) : null;

  /* ---------- Beleg zum Ertrag ---------- */
  const onWeg = (w: Ertragsweg) => {
    if (w === ertrag.weg) return;
    // „Offene Rechnung zuordnen“ verlassen: deren Nummer gehört nicht an eine andere Einnahme (die Rechnung bleibt offen)
    const re = ertrag.weg === 'offen' ? ertragStamm?.offene.find((x) => x.id === ertrag.offenId) : undefined;
    if (re) setForm((f) => (f && f.belegnummer.trim() === re.nummer ? { ...f, belegnummer: '' } : f));
    setErtrag({ weg: w, offenId: null });
    setFehler({});
  };
  const onOffen = (z: RechnungsZeile) => {
    const k = stamm?.kunden.find((x) => x.id === z.kunde_id);
    setErtrag({ offenId: z.id });
    setForm((f) =>
      f
        ? {
            ...f,
            betrag: betragAlsEingabe(z.summe_cent),
            beschreibung: z.betreff ?? f.beschreibung,
            wer: k ? kundenLabel(k) : (z.kunde_name ?? ''),
            kundeBewusstNeu: null,
            belegnummer: z.nummer ?? '',
          }
        : f,
    );
    setFehler({});
  };
  // Ausgabe ohne Beleg ⇒ Eigenbeleg in der Maske, mit den Eingaben (dort bucht „Buchen“ die Ausgabe mit)
  const eigenbeleg = () => {
    if (!form) return;
    const pfad = maskenPfad('eigenbeleg', {
      betrag: parseBetrag(form.betrag),
      datum: form.zahlungsdatum,
      text: form.beschreibung,
      name: form.wer,
      zahlungsart: form.zahlungsart,
      kategorieId: form.kategorieId,
    });
    erfassenFertig();
    navigate(pfad);
  };

  const fuss = (
    <>
      {stornoKnopf}
      {nurLesen && sp !== 'festgeschrieben' ? (
        <span className="bu-foot-lock" title={sp ? SPERR_TEXT[sp] : undefined}>
          <Lock />
          {sp === 'storniert' ? 'storniert' : 'festgeschrieben'}
        </span>
      ) : null}
      <span className="spacer" />
      <button type="button" className="btn ghost" onClick={erfassenSchliessen}>
        {nurLesen ? 'Schließen' : 'Abbrechen'}
      </button>
      {nurLesen && zeile && nimmtBelege && belege.length ? (
        <button
          type="button"
          className="btn-primary sm"
          title="Nur die Dateien ablegen – der Eintrag selbst bleibt unverändert"
          onClick={() => void vorgemerkteAnhaengen({ id: zeile.id, nummer: zeile.nummer, typ: zeile.typ })}
        >
          <Paperclip />
          {belege.length === 1 ? 'Beleg anhängen' : `${belegeAnzahl(belege.length)} anhängen`}
        </button>
      ) : null}
      {nurLesen ? null : (
        <>
          {bearbeitung ? null : (
            <button type="button" className="btn subtle" title="Speichern und gleich den nächsten Eintrag erfassen (⇧⌘↩)" disabled={laden.status !== 'ok' || speichert} onClick={() => void speichern(true)}>
              Speichern &amp; neu
            </button>
          )}
          <button type="button" className="btn-primary sm" title="Speichern (⌘↩)" disabled={laden.status !== 'ok' || speichert} onClick={() => void speichern(false)}>
            <Check />
            Speichern
            <kbd>⌘↩</kbd>
          </button>
        </>
      )}
    </>
  );

  return (
    <Drawer open={open} onClose={erfassenSchliessen} title={titel} sub={sub} icon={icon} width={520} foot={fuss} className="bu-drawer">
      <>
        {laden.status === 'ohne-db' ? (
          <section>
            <EmptyState icon={ArrowLeftRight} title="Nur in der Mac-App">
              Ein- und Ausgänge liegen in der Datenbank auf diesem Mac. Im Browser-Vorschaumodus gibt es sie nicht – bitte die App starten (npm run tauri dev).
            </EmptyState>
          </section>
        ) : laden.status === 'fehler' ? (
          <section>
            <EmptyState icon={TriangleAlert} title="Konnte nicht geladen werden">
              {laden.fehler}
            </EmptyState>
          </section>
        ) : laden.status === 'laden' || !form || !stamm ? (
          <section aria-busy="true">
            <div className="sk bu-sk" />
          </section>
        ) : (
          <FormularInhalt
            key={auftragN}
            form={form}
            stamm={stamm}
            zeile={zeile}
            sp={sp}
            belege={belege}
            nimmtBelege={nimmtBelege}
            fehler={fehler}
            katVorschlag={katVorschlag}
            erkannt={erkannt}
            set={set}
            fehlerWeg={fehlerWeg}
            weg={weg}
            belegArt={weg === 'beleg' ? ertrag.art : null}
            offenRechnung={weg === 'beleg' && rechnungOffen(ertrag)}
            ertragBereich={
              ertragAktiv ? (
                <BelegZumErtrag
                  form={form}
                  ertrag={ertrag}
                  setErtrag={setErtrag}
                  stamm={ertragStamm}
                  ladeFehler={ertragLadeFehler}
                  belege={belege}
                  nimmtBelege={nimmtBelege}
                  fehler={ertragFehler}
                  onWeg={onWeg}
                  onOffen={onOffen}
                />
              ) : null
            }
            onEigenbeleg={eigenbeleg}
            terminHinweis={
              bezug && form.typ === 'einnahme' && !bearbeitung ? (
                <TerminHinweis bezug={bezug} weg={weg} art={ertrag.art} />
              ) : null
            }
            onTyp={(t) => {
              setForm((f) => {
                if (!f || f.typ === t) return f;
                const kat = stamm.kategorien.find((k) => k.id === f.kategorieId);
                // Ausgabe: das Geschäft ist Freitext – Kundennummer aus dem Feld nehmen
                const wer = t === 'ausgabe' ? kundeAufloesen(f.wer, stamm.kunden).art === 'kunde' ? f.wer.replace(/\s*·\s*K-\d{3,}\s*$/i, '') : f.wer : f.wer;
                return { ...f, typ: t, wer, kategorieId: kat?.typ === t ? f.kategorieId : standardKategorie(stamm.kategorien, t) };
              });
              setKatVorschlag(false);
              setFehler({});
            }}
            onKategorie={(id) => {
              set('kategorieId', id);
              setKatGewaehlt(true);
              setKatVorschlag(false);
              fehlerWeg('kategorie');
            }}
            vorschlagen={(id) => {
              if (katGewaehlt || bearbeitung || id == null) return;
              setForm((f) => (f && f.kategorieId !== id ? { ...f, kategorieId: id } : f));
              setKatVorschlag(true);
            }}
          />
        )}
      </>
    </Drawer>
  );
}

/* ================= Formular ================= */

interface InhaltProps {
  form: Formular;
  stamm: Stamm;
  zeile: BuchungZeile | null;
  sp: Sperre | null;
  /** vorgemerkte Dateien (useErfassen.belege) */
  belege: VorgemerkterBeleg[];
  /** dürfen hier Dateien abgelegt werden? */
  nimmtBelege: boolean;
  fehler: Partial<Record<FormFeld, string>>;
  katVorschlag: boolean;
  /** Belegerkennung: Kasten oben und Marken „aus PDF“ / „aus Dateiname“ an den Feldern */
  erkannt: ErkennungAnsicht;
  set: <K extends keyof Formular>(k: K, v: Formular[K]) => void;
  fehlerWeg: (k: FormFeld) => void;
  onTyp: (t: BuchungTyp) => void;
  onKategorie: (id: number) => void;
  /** Kategorie als Vorschlag setzen (nur solange nicht selbst gewählt) */
  vorschlagen: (id: number | null) => void;
  /** Beleg zum Ertrag (neue Einnahme), sonst 'ohne' */
  weg: Ertragsweg;
  /** Art des Belegs, der beim Speichern ausgestellt wird */
  belegArt: ErtragsArt | null;
  /** Rechnung „noch offen“: das Datum ist das Rechnungsdatum, gezahlt wird später */
  offenRechnung: boolean;
  ertragBereich: ReactNode;
  /** Hinweiszeile zum Termin bzw. vorbereiteten Beleg (oben) */
  terminHinweis: ReactNode;
  onEigenbeleg: () => void;
}

const Fehler = ({ text }: { text?: string }) =>
  text ? (
    <p className="hint neg bu-err" role="alert">
      {text}
    </p>
  ) : null;

const TIP_DATUM = 'Für die EÜR zählt der Tag, an dem das Geld geflossen ist (Zufluss-/Abflussprinzip, § 11 EStG) – nicht das Rechnungsdatum.';
const TIP_RECHNUNGSDATUM = 'Datum der Rechnung. Die Einnahme wird erst erfasst, wenn das Geld eingeht – dann zählt der Zahlungstag (§ 11 EStG).';
const TIP_NR = 'Bei Ausgaben die Rechnungs- oder Bonnummer des Geschäfts. Eigene Quittungen und Rechnungen (QU-/RE-…) bekommen ihre Nummer beim Ausstellen.';

function FormularInhalt(props: InhaltProps) {
  const { form, stamm, zeile, sp, belege, nimmtBelege, fehler, katVorschlag, erkannt, set, fehlerWeg, onTyp, onKategorie, vorschlagen } = props;
  const { weg, belegArt, offenRechnung, ertragBereich, onEigenbeleg, terminHinweis } = props;
  const { pathname } = useLocation();
  const seiteZeitraum = useUi((s) => s.zeitraum);
  const ro = sp !== null;
  const typ = form.typ;
  const ausgabe = typ === 'ausgabe';
  // „Offene Rechnung zuordnen“: Betrag, Text und Kunde kommen aus der Rechnung
  const zuordnen = weg === 'offen';
  // Beleg-Nr. nur ohne eigenen Beleg (sonst vergibt der Beleg die Nummer)
  const mitNr = weg === 'ohne';
  const kats = stamm.kategorien.filter((k) => k.typ === typ);
  const kat = stamm.kategorien.find((k) => k.id === form.kategorieId);
  const cent = parseBetrag(form.betrag);

  /* Hinweise */
  let betragHint: ReactNode = null;
  if (ausgabe && cent !== null && cent > 0) {
    const pr = privatProzent(form.privat) ?? 0;
    const a = abziehbar(cent, pr, kat?.abziehbar_prozent ?? 100);
    if (a !== cent)
      betragHint = (
        <>
          Als Betriebsausgabe zählen <b className="num">{formatBetrag(a)}</b>
          {pr ? ` (${pr} % privat)` : ''}
        </>
      );
  }
  const katBits: string[] = [];
  if (kat?.euer_bereich) katBits.push(`EÜR: ${kat.euer_bereich}`);
  if (kat?.wareneingang) katBits.push('erscheint im Wareneingangsbuch');
  if (kat && kat.abziehbar_prozent < 100) katBits.push(`nur ${kat.abziehbar_prozent} % abziehbar`);

  const h = heute();
  const z = zeitraum(seiteZeitraum.modus, seiteZeitraum.anker);
  // eine offene Rechnung trägt das Rechnungsdatum – Zahlungshinweise passen dort nicht
  let datumHint: ReactNode = null;
  if (!offenRechnung && form.zahlungsdatum && form.zahlungsdatum > h)
    datumHint = (
      <>
        <Clock />
        Liegt in der Zukunft – erfasst wird, wenn das Geld tatsächlich fließt.
      </>
    );
  else if (!offenRechnung && form.zahlungsdatum && pathname === '/ein-ausgaenge' && !imZeitraum(z, form.zahlungsdatum))
    datumHint = (
      <>
        <CalendarDays />
        Liegt außerhalb von {z.label} – der Eintrag erscheint deshalb nicht in der aktuellen Liste.
      </>
    );

  const kundenOptionen = useMemo(() => stamm.kunden.map((k) => ({ value: kundenLabel(k), label: k.ort || 'ohne Adresse' })), [stamm.kunden]);
  const katName = useMemo(() => new Map(stamm.kategorien.map((k) => [k.id, k.name])), [stamm.kategorien]);
  const abgelegt = useBelegeZuBuchung(zeile?.id ?? null);
  const hatDateien = abgelegt.length > 0 || belege.length > 0;
  const wann = ro ? 'wird mit „Beleg anhängen“ abgelegt' : 'wird beim Speichern abgelegt';

  return (
    <>
      {erkannt.kopf}
      {terminHinweis}
      {zeile && sp ? (
        <div className={`bu-link ${sp !== 'festgeschrieben' ? 'lock' : ''}`}>
          <Lock />
          <span>
            {sp === 'beleg' && zeile.rechnung_nummer ? (
              <>
                Zahlung zu <b>{zeile.rechnung_nummer}</b>
              </>
            ) : sp === 'storniert' ? (
              'Storniert'
            ) : (
              'Festgeschrieben'
            )}
            <small>{SPERR_TEXT[sp]}</small>
          </span>
        </div>
      ) : null}

      <section className="bu-sec-betrag">
        <Seg
          className={`full ${ro ? 'bu-locked' : ''}`}
          ariaLabel="Ausgabe oder Einnahme"
          value={typ}
          onChange={(t) => {
            if (!ro) onTyp(t);
          }}
          options={[
            {
              value: 'ausgabe',
              label: (
                <>
                  <Minus />
                  Ausgabe
                </>
              ),
            },
            {
              value: 'einnahme',
              label: (
                <>
                  <Plus />
                  Einnahme
                </>
              ),
            },
          ]}
        />
        <div className="field">
          <label className="field-label" htmlFor="bf-betrag">
            Betrag
            {erkannt.marke('betrag')}
          </label>
          <div className="input-wrap">
            <input
              id="bf-betrag"
              className={`input money-input ${fehler.betrag ? 'invalid' : ''}`}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder="0,00"
              value={form.betrag}
              readOnly={ro || zuordnen}
              onChange={(e) => {
                set('betrag', e.target.value);
                fehlerWeg('betrag');
              }}
              onBlur={(e) => {
                const c = parseBetrag(e.target.value);
                if (c !== null && c > 0) set('betrag', betragAlsEingabe(c));
              }}
            />
            <span className="suffix">€</span>
          </div>
          <Fehler text={fehler.betrag} />
          {betragHint && !fehler.betrag ? <p className="hint">{betragHint}</p> : null}
          {zuordnen && !ro ? <p className="hint">Betrag der gewählten Rechnung – gebucht wird die Rechnungssumme.</p> : null}
        </div>
        {!zuordnen && (kats.length > 1 || (kat && kat.typ !== typ)) ? (
          <div className="field">
            <span className="field-label">
              Kategorie
              {erkannt.marke('kategorieId') ??
                (katVorschlag ? (
                  <span className="sugg-tag" title="Aus den Stichworten vorgeschlagen – bitte kurz prüfen">
                    <Sparkles />
                    Vorschlag
                  </span>
                ) : null)}
            </span>
            <div id="bf-kategorie" className={`bu-tiles bu-kat-tiles ${katVorschlag ? 'suggested' : ''} ${fehler.kategorie ? 'invalid' : ''}`} role="radiogroup" aria-label="Kategorie">
              {kats.map((k) => {
                const an = k.id === form.kategorieId;
                return (
                  <button
                    key={k.id}
                    type="button"
                    className={`bu-tile ${an ? 'on' : ''}`}
                    role="radio"
                    aria-checked={an}
                    disabled={ro}
                    style={{ '--c': k.farbe ?? 'var(--accent)' } as React.CSSProperties}
                    onClick={() => onKategorie(k.id)}
                  >
                    <i className="bu-tile-ic">
                      <KategorieIcon icon={k.icon} />
                    </i>
                    <b>{k.name}</b>
                  </button>
                );
              })}
            </div>
            <Fehler text={fehler.kategorie} />
            {katBits.length ? <p className="hint">{katBits.join(' · ')}</p> : null}
          </div>
        ) : null}
      </section>

      <section>
        <h3>Angaben</h3>
        <div className="form-grid">
          <div className={mitNr ? 'field' : 'field full'}>
            <label className="field-label" htmlFor="bf-zahlungsdatum" title={offenRechnung ? TIP_RECHNUNGSDATUM : TIP_DATUM}>
              {offenRechnung ? 'Rechnungsdatum' : 'Zahlungsdatum'}
              <span className="q" aria-hidden="true">
                ?
              </span>
              {erkannt.marke('zahlungsdatum')}
            </label>
            <input
              id="bf-zahlungsdatum"
              type="date"
              className={`input ${fehler.zahlungsdatum ? 'invalid' : ''}`}
              value={form.zahlungsdatum}
              readOnly={ro}
              required
              onChange={(e) => {
                set('zahlungsdatum', e.target.value);
                fehlerWeg('zahlungsdatum');
              }}
            />
          </div>
          {mitNr ? (
            <div className="field">
              <label className="field-label" htmlFor="bf-belegnummer" title={TIP_NR}>
                Beleg-Nr.
                <span className="q" aria-hidden="true">
                  ?
                </span>
                {erkannt.marke('belegnummer')}
              </label>
              <input
                id="bf-belegnummer"
                className="input bu-nr-in"
                autoComplete="off"
                spellCheck={false}
                placeholder="z. B. Bon 4711"
                value={form.belegnummer}
                readOnly={ro}
                onChange={(e) => set('belegnummer', e.target.value)}
              />
            </div>
          ) : null}
          {fehler.zahlungsdatum ? (
            <div className="full">
              <Fehler text={fehler.zahlungsdatum} />
            </div>
          ) : datumHint ? (
            <p className="hint full">{datumHint}</p>
          ) : null}
          <div className="field full">
            <label className="field-label" htmlFor="bf-beschreibung">
              Beschreibung
              {erkannt.marke('beschreibung')}
            </label>
            <input
              id="bf-beschreibung"
              className={`input ${fehler.beschreibung ? 'invalid' : ''}`}
              autoComplete="off"
              placeholder={ausgabe ? 'Wofür? z. B. Diesel für den Transporter' : 'Wofür? z. B. Rasen mähen, Hecke schneiden'}
              value={form.beschreibung}
              readOnly={ro || zuordnen}
              onChange={(e) => {
                set('beschreibung', e.target.value);
                fehlerWeg('beschreibung');
                vorschlagen(kategorieAusText(e.target.value, stamm.kategorien, typ));
              }}
            />
            <Fehler text={fehler.beschreibung} />
          </div>
          {zuordnen ? null : (
            <div className="field full">
              <label className="field-label" htmlFor="bf-wer">
                {ausgabe ? 'Geschäft' : 'Kunde'}
                <small className="muted">{belegArt === 'rechnung' ? 'für die Rechnung nötig' : 'optional'}</small>
                {erkannt.marke('wer')}
              </label>
              <input
                id="bf-wer"
                className={`input ${fehler.wer ? 'invalid' : ''}`}
                list={ro ? undefined : ausgabe ? 'bf-wer-geschaefte' : 'bf-wer-kunden'}
                autoComplete="off"
                placeholder={ausgabe ? 'z. B. Aral Tankstelle, Bauhaus …' : 'Name – aus deinen Kunden oder neu'}
                value={form.wer}
                readOnly={ro}
                onChange={(e) => {
                  const v = e.target.value;
                  set('wer', v);
                  fehlerWeg('wer');
                  if (ausgabe) vorschlagen(geschaeftZu(v, stamm.geschaefte)?.kategorie_id ?? kategorieAusText(v, stamm.kategorien, typ));
                }}
              />
              {ausgabe ? (
                <datalist id="bf-wer-geschaefte">
                  {stamm.geschaefte.map((g) => (
                    <option key={g.name} value={g.name}>
                      {`${g.anzahl}× · ${g.kategorie_id != null ? (katName.get(g.kategorie_id) ?? '') : ''}`}
                    </option>
                  ))}
                </datalist>
              ) : (
                <datalist id="bf-wer-kunden">
                  {kundenOptionen.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </datalist>
              )}
              {!ausgabe && !ro ? <KundenHinweis form={form} kunden={stamm.kunden} set={set} fehlerWeg={fehlerWeg} /> : null}
              <Fehler text={fehler.wer} />
            </div>
          )}
        </div>
        {ausgabe ? (
          <details className="bu-more" open={Boolean(privatProzent(form.privat)) || Boolean(fehler.privat)}>
            <summary>
              Mehr Optionen
              <ChevronDown />
            </summary>
            <div className="bu-more-body">
              <div className="field">
                <label className="field-label" htmlFor="bf-privat">
                  Privatanteil
                </label>
                <div className="input-wrap">
                  <input
                    id="bf-privat"
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    className={`input num ${fehler.privat ? 'invalid' : ''}`}
                    value={form.privat}
                    placeholder="0"
                    readOnly={ro}
                    onChange={(e) => {
                      set('privat', e.target.value);
                      fehlerWeg('privat');
                    }}
                  />
                  <span className="suffix">%</span>
                </div>
                <Fehler text={fehler.privat} />
              </div>
              <p className="hint">Nur wenn etwas auch privat genutzt wird (z. B. Handy zu 30 % privat) – dann zählt nur der Rest als Ausgabe.</p>
            </div>
          </details>
        ) : null}
      </section>

      {offenRechnung ? null : (
        <section>
          <h3>Bezahlt per</h3>
          <div className="bu-zw" role="radiogroup" aria-label="Bezahlt per">
            {ZAHLUNGSWEGE.map((zw) => {
              const Icon = ZAHLUNGSWEG_ICON[zw.id];
              const an = form.zahlungsart === zw.id;
              return (
                <button key={zw.id} type="button" className={`bu-zw-opt ${an ? 'on' : ''}`} role="radio" aria-checked={an} disabled={ro} onClick={() => set('zahlungsart', zw.id)}>
                  <Icon />
                  <b>{zw.name}</b>
                  <small>{zw.text}</small>
                </button>
              );
            })}
          </div>
          {form.zahlungsart === 'bar' && !ro && weg !== 'beleg' ? (
            <p className="hint">Bargeld einzeln und zeitnah festhalten (§ 146 AO) – Bon bzw. Quittung aufheben.</p>
          ) : null}
        </section>
      )}

      <section>
        <h3>{ausgabe ? 'Beleg' : 'Beleg zum Ertrag'}</h3>
        {ausgabe ? null : ertragBereich}
        <VorhandeneBelege liste={abgelegt} />
        {nimmtBelege && weg !== 'beleg' ? <VorgemerkteBelege belege={belege} wann={wann} /> : null}
        {nimmtBelege && weg !== 'beleg' ? (
          hatDateien ? (
            <BelegDropzone kompakt titel="Weiteren Beleg hierher ziehen oder klicken" text="" />
          ) : (
            <BelegDropzone
              titel={ausgabe ? 'Beleg hierher ziehen' : 'Abrechnung oder Zahlungsnachweis hierher ziehen'}
              text={ausgabe ? 'oder klicken zum Auswählen · PDF, Foto oder E-Rechnung (XML), bis 50 MB' : 'oder klicken zum Auswählen · auch Scan oder Foto einer Quittung'}
            />
          )
        ) : null}
        {ausgabe && !ro && !hatDateien ? (
          <div className="bu-nobeleg">
            <p className="hint warn">
              <TriangleAlert />
              Ohne Beleg fehlt der Nachweis fürs Finanzamt. Rechnung oder Kassenbon hierher ziehen.
            </p>
            <div className="bu-nobeleg-links">
              <button type="button" className="link" title="Eigenbeleg mit diesen Angaben in der Beleg-Maske erstellen – „Buchen“ bucht die Ausgabe mit" onClick={onEigenbeleg}>
                <FilePlus />
                Kein Beleg? Eigenbeleg erstellen
              </button>
            </div>
          </div>
        ) : null}
        {ro && nimmtBelege && belege.length ? (
          <p className="hint">
            <Lock />
            Der Eintrag selbst bleibt unverändert – „Beleg anhängen“ legt nur die Dateien dazu ab (im Protokoll).
          </p>
        ) : null}
        {zeile ? (
          <p className="hint">
            <Info />
            Erfasst am Zahlungstag {datumKurz(zeile.zahlungsdatum)} · Nr. {zeile.nummer}. Änderungen landen im Protokoll.
          </p>
        ) : null}
      </section>
    </>
  );
}

/* ---------- Oben: Termin bzw. vorbereiteter Beleg (Prototyp terminHint) ---------- */

function TerminHinweis({ bezug, weg, art }: { bezug: ErfassenBezug; weg: Ertragsweg; art: ErtragsArt }) {
  const teile = erfassenHinweis({ termin: bezug.termin, entwurfArt: bezug.entwurf?.formular.art ?? null, weg, art });
  if (!teile.length) return null;
  return (
    <div className="bu-link bu-termin" role="note">
      <CalendarDays />
      <span>{teile.map((t, i) => (t.fett ? <b key={i}>{t.text}</b> : <span key={i}>{t.text}</span>))}</span>
    </div>
  );
}

/* ---------- Unter „Kunde“: bekannter Kunde, Nachfrage bei gleichem Namen oder „neu“ ---------- */

function KundenHinweis({
  form,
  kunden,
  set,
  fehlerWeg,
}: {
  form: Formular;
  kunden: readonly KundeKurz[];
  set: InhaltProps['set'];
  fehlerWeg: InhaltProps['fehlerWeg'];
}) {
  const k = kundeAufloesen(form.wer, kunden, form.kundeBewusstNeu);
  const waehle = (kunde: KundeKurz) => {
    set('wer', kundenLabel(kunde));
    set('kundeBewusstNeu', null);
    fehlerWeg('wer');
    document.getElementById('bf-wer')?.focus({ preventScroll: true });
  };
  if (k.art === 'leer') return null;
  if (k.art === 'kunde')
    return (
      <p className="hint bu-wer-hint">
        <User />
        Bekannter Kunde · {[k.kunde.nummer, k.kunde.ort].filter(Boolean).join(' · ')}
      </p>
    );
  if (k.art === 'wahl')
    return (
      <div className="hint bu-wer-hint bu-wahl">
        <span>
          <Users />
          {k.liste.length > 1 ? `Mehrere Kunden heißen „${k.name}“ – wer ist gemeint?` : `Es gibt schon einen Kunden „${k.name}“ – ist es derselbe?`}
        </span>
        <span className="bu-kwahl">
          {k.liste.map((x) => (
            <button key={x.id} type="button" className="bu-kwahl-btn" onClick={() => waehle(x)}>
              <b className="mono">{x.nummer}</b>
              {x.ort || 'ohne Adresse'}
            </button>
          ))}
          <button
            type="button"
            className="bu-kwahl-btn neu"
            onClick={() => {
              set('wer', k.name);
              set('kundeBewusstNeu', nameSchluessel(k.name));
              fehlerWeg('wer');
            }}
          >
            <Plus />
            Neuer Kunde mit diesem Namen
          </button>
        </span>
      </div>
    );
  return (
    <p className="hint bu-wer-hint">
      <Plus />
      {k.namensvettern.length ? `Neuer Kunde „${k.name}“ mit eigener Nummer` : 'Neuer Kunde'} – wird beim Speichern unter „Kunden“ angelegt.
      {k.namensvettern.length === 1 ? (
        <button type="button" className="link bu-kalt" onClick={() => waehle(k.namensvettern[0])}>
          Doch {k.namensvettern[0].nummer} nehmen
        </button>
      ) : k.namensvettern.length > 1 ? (
        <button type="button" className="link bu-kalt" onClick={() => set('kundeBewusstNeu', null)}>
          Doch einen der bestehenden wählen
        </button>
      ) : null}
    </p>
  );
}

