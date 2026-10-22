/* Einstellungen › Steuern: Kategorien und EÜR-Zuordnung pro Jahr (ANLEITUNG §2.8, §6.10).
 * - Kategorien: Liste je Art mit Symbol, Stichworten, EÜR-Bereich, abziehbarem Anteil und den Kennzeichen
 *   „Kleinunternehmer-Umsatz“ und „Wareneingangsbuch“; hinzufügen, bearbeiten, aus- und einblenden. Ausgeblendete (auch die
 *   optionalen aus dem Katalog: Abschreibungen, Bewirtung, Geschenke, Homeoffice) bietet die Erfassen-Schublade nicht an,
 *   bestehende Buchungen behalten sie. Gelöscht wird nie, je Art bleibt eine sichtbar, die Art steht nach dem Anlegen fest.
 * - EÜR-Zuordnung: je Jahr die Zeile der Anlage EÜR und bei Bedarf ein eigener EÜR-Bereich (leer = wie die Kategorie);
 *   „Jahr anlegen“ übernimmt das Vorjahr. Speichert beim Verlassen des Feldes wie die Steuer-Kennwerte.
 * Prüfen in lib/kategorien.ts, Speichern samt Protokoll in lib/queries/kategorien.ts. */
import { Fragment, useState, type FormEvent, type KeyboardEvent } from 'react';
import { CalendarPlus, Eye, EyeOff, Info, Pencil, Plus, X } from 'lucide-react';
import { anzahlText, typName, type BuchungTyp } from '../../lib/buchungen';
import {
  BEREICH_MAX,
  ICON_NAMEN,
  KATEGORIE_FARBEN,
  KATEGORIE_ICONS,
  NAME_MAX,
  ausblendenFehler,
  euerBereichLesen,
  euerJahre,
  euerKategorien,
  euerVorschlaege,
  euerZeileLesen,
  formularAus,
  kategoriePruefen,
  neuesFormular,
  standardBereich,
  stichworteText,
  type EuerZeile,
  type Kategorie,
  type KategorieFeld,
  type KategorieFormular,
} from '../../lib/kategorien';
import {
  kategorieAendern,
  kategorieAnlegen,
  kategorieSichtbar,
  legeEuerJahrAn,
  speichereEuerZuordnung,
  type EuerWerte,
} from '../../lib/queries/kategorien';
import { anzeigeJahr, jahrFehler, jahrVorschlag, kopierQuelle } from '../../lib/steuer-kennwerte';
import { useUi } from '../../store/ui';
import { farbVar } from '../../components/charts/farbe';
import { KategorieIcon } from '../../components/buchungen/Symbole';
import { Seg } from '../../components/ui/Seg';
import { Switch } from '../../components/ui/Switch';
import { fehlerText } from './Laden';
import { SetCard } from './SetRow';

const TYPEN = [
  { value: 'ausgabe', label: 'Ausgabe' },
  { value: 'einnahme', label: 'Einnahme' },
] as const;

const ART_MEHRZAHL: Readonly<Record<BuchungTyp, string>> = { einnahme: 'Einnahmen', ausgabe: 'Ausgaben' };

const diesesJahr = () => new Date().getFullYear();
const datenGeaendert = () => useUi.getState().datenGeaendert();

/** Symbol in der Kategoriefarbe, Name und eine graue Zeile darunter (Stichworte oder `unter`). */
function KategorieName({ k, unter }: { k: Kategorie; unter?: string }) {
  const zusatz = unter ?? stichworteText(k.stichworte);
  return (
    <span className="kat-name" style={farbVar(k.farbe ?? undefined)}>
      <i className="kat-ic">
        <KategorieIcon icon={k.icon} />
      </i>
      <span>
        <b>{k.name}</b>
        {zusatz ? <small title={zusatz}>{zusatz}</small> : null}
      </span>
    </span>
  );
}

/* ================= Kategorien ================= */

interface FormZustand {
  /** null = neue Kategorie */
  id: number | null;
  werte: KategorieFormular;
}

export function KategorienKarte({ kategorien, neuLaden, i }: { kategorien: readonly Kategorie[]; neuLaden: () => Promise<void>; i: number }) {
  const toast = useUi((s) => s.toast);
  const [form, setForm] = useState<FormZustand | null>(null);
  const [fehler, setFehler] = useState<Partial<Record<KategorieFeld, string>>>({});
  const [laeuft, setLaeuft] = useState(false);

  const sichtbar = kategorien.filter((k) => !k.archiviert);
  const ausgeblendet = kategorien.filter((k) => k.archiviert);

  const oeffnen = (k: Kategorie | null) => {
    setForm(k ? { id: k.id, werte: formularAus(k) } : { id: null, werte: neuesFormular('ausgabe', kategorien) });
    setFehler({});
    requestAnimationFrame(() => {
      document.getElementById('kat-form')?.scrollIntoView({ block: 'nearest' });
      document.getElementById('kat-name')?.focus({ preventScroll: true });
    });
  };

  const schliessen = () => {
    setForm(null);
    setFehler({});
  };

  const setze = (teil: Partial<KategorieFormular>) => {
    setForm((f) => (f ? { ...f, werte: { ...f.werte, ...teil } } : f));
    setFehler({});
  };

  const absenden = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || laeuft) return;
    const bisher = form.id === null ? null : (kategorien.find((k) => k.id === form.id) ?? null);
    const r = kategoriePruefen(form.werte, kategorien, bisher);
    if (!r.ok) {
      setFehler(r.fehler);
      return;
    }
    setLaeuft(true);
    try {
      if (form.id === null) {
        await kategorieAnlegen(form.werte);
        toast(`Kategorie „${r.daten.name}“ angelegt – wird beim Erfassen angeboten`);
      } else {
        const geaendert = await kategorieAendern(form.id, form.werte);
        toast(geaendert ? `Kategorie „${r.daten.name}“ gespeichert (im Protokoll)` : 'Nichts geändert', geaendert ? 'check' : 'info');
      }
      schliessen();
      datenGeaendert();
      await neuLaden();
    } catch (err) {
      toast(`Nicht gespeichert: ${fehlerText(err)}`, 'warn');
    } finally {
      setLaeuft(false);
    }
  };

  const sichtbarSetzen = async (k: Kategorie, an: boolean) => {
    setLaeuft(true);
    try {
      await kategorieSichtbar(k.id, an);
      datenGeaendert();
      await neuLaden();
      useUi.getState().showToast({
        text: an ? `„${k.name}“ eingeblendet – wird beim Erfassen angeboten` : `„${k.name}“ ausgeblendet – vorhandene Einträge behalten sie`,
        icon: 'check',
        actions: [
          {
            label: 'Rückgängig',
            run: () => {
              kategorieSichtbar(k.id, !an).then(
                () => {
                  datenGeaendert();
                  return neuLaden();
                },
                (err: unknown) => toast(`Nicht rückgängig gemacht: ${fehlerText(err)}`, 'warn'),
              );
            },
          },
        ],
      });
    } catch (err) {
      toast(`Nicht gespeichert: ${fehlerText(err)}`, 'warn');
    } finally {
      setLaeuft(false);
    }
  };

  const zeile = (k: Kategorie) => {
    const sperre = ausblendenFehler(k, kategorien);
    const kennzeichen = [k.zaehlt_ku_umsatz ? 'Kleinunternehmer-Umsatz' : '', k.wareneingang ? 'Wareneingangsbuch' : ''].filter(Boolean);
    return (
      <tr key={k.id} className={form?.id === k.id ? 'kat-aktiv' : undefined}>
        <td className="l wrap">
          <KategorieName k={k} />
        </td>
        <td className="l wrap">{k.euer_bereich ?? '—'}</td>
        <td className="num">{k.typ === 'ausgabe' ? `${k.abziehbar_prozent} %` : '—'}</td>
        <td className="l wrap">
          <span className="kat-kz">
            {kennzeichen.map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
            <small>{anzahlText(k.buchungen, 'Buchung', 'Buchungen')}</small>
          </span>
        </td>
        <td className="kat-akt">
          <button type="button" className="icon-btn sm" title="Bearbeiten" aria-label={`„${k.name}“ bearbeiten`} onClick={() => oeffnen(k)}>
            <Pencil />
          </button>
          <button
            type="button"
            className="icon-btn sm"
            title={sperre ?? 'Ausblenden – wird beim Erfassen nicht mehr angeboten'}
            aria-label={`„${k.name}“ ausblenden`}
            disabled={!!sperre || laeuft}
            onClick={() => void sichtbarSetzen(k, false)}
          >
            <EyeOff />
          </button>
        </td>
      </tr>
    );
  };

  const ausgeblendetText = (k: Kategorie): string =>
    [
      typName(k.typ),
      k.euer_bereich ?? 'ohne EÜR-Bereich',
      k.typ === 'ausgabe' && k.abziehbar_prozent < 100 ? `${k.abziehbar_prozent} % abziehbar` : '',
      k.buchungen ? anzahlText(k.buchungen, 'Buchung', 'Buchungen') : '',
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <SetCard title="Kategorien" i={i}>
      <div className="set-row" data-setting="kategorien">
        <div className="table-wrap">
          <table className="fin-table kat-table">
            <thead>
              <tr>
                <th className="l">Kategorie</th>
                <th className="l">EÜR-Bereich</th>
                <th>abziehbar</th>
                <th className="l">Kennzeichen</th>
                <th>
                  <span className="sr-only">Aktionen</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(['einnahme', 'ausgabe'] as const).map((typ) => (
                <Fragment key={typ}>
                  <tr className="grp">
                    <td className="l" colSpan={5}>
                      {ART_MEHRZAHL[typ]}
                    </td>
                  </tr>
                  {sichtbar.filter((k) => k.typ === typ).map(zeile)}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Bewusst wenige Kategorien. Die Stichworte schlagen beim Erfassen die passende Kategorie vor. Gelöscht wird nie – nicht mehr
          gebrauchte Kategorien ausblenden; vorhandene Ein- und Ausgänge behalten sie.
        </p>
      </div>

      {form ? (
        <KategorieForm
          form={form}
          alle={kategorien}
          fehler={fehler}
          laeuft={laeuft}
          setze={setze}
          schliessen={schliessen}
          absenden={(e) => void absenden(e)}
        />
      ) : (
        <div className="row wrap" data-setting="kategorie-neu">
          <button type="button" className="btn ghost" onClick={() => oeffnen(null)}>
            <Plus />
            Kategorie hinzufügen
          </button>
        </div>
      )}

      <div className="set-row" data-setting="kategorien-ausgeblendet">
        <div className="set-label">
          <span>Ausgeblendet</span>
        </div>
        {ausgeblendet.length ? (
          <ul className="kat-aus">
            {ausgeblendet.map((k) => (
              <li key={k.id} className={form?.id === k.id ? 'kat-aktiv' : undefined}>
                <KategorieName k={k} unter={ausgeblendetText(k)} />
                <button type="button" className="icon-btn sm" title="Bearbeiten" aria-label={`„${k.name}“ bearbeiten`} onClick={() => oeffnen(k)}>
                  <Pencil />
                </button>
                <button type="button" className="btn subtle" disabled={laeuft} onClick={() => void sichtbarSetzen(k, true)}>
                  <Eye />
                  Einblenden
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="hint">Keine – alle Kategorien werden beim Erfassen angeboten.</p>
        )}
        <p className="hint">
          Ausgeblendete Kategorien bietet die Erfassen-Schublade nicht an; vorhandene Ein- und Ausgänge behalten sie und zählen
          weiter. Abschreibungen (AfA), Bewirtung, Geschenke und Homeoffice sind seltene Spezialfälle – nur einblenden, wenn du sie
          brauchst.
        </p>
      </div>
    </SetCard>
  );
}

interface FormProps {
  form: FormZustand;
  alle: readonly Kategorie[];
  fehler: Partial<Record<KategorieFeld, string>>;
  laeuft: boolean;
  setze: (teil: Partial<KategorieFormular>) => void;
  schliessen: () => void;
  absenden: (e: FormEvent) => void;
}

function KategorieForm({ form, alle, fehler, laeuft, setze, schliessen, absenden }: FormProps) {
  const f = form.werte;
  const neu = form.id === null;
  const ausgabe = f.typ === 'ausgabe';
  const bisher = neu ? null : alle.find((k) => k.id === form.id);

  const meldung = (feld: KategorieFeld) =>
    fehler[feld] ? (
      <p className="hint neg" id={`kat-${feld}-fehler`} role="alert">
        {fehler[feld]}
      </p>
    ) : null;
  const ungueltig = (feld: KategorieFeld) => (fehler[feld] ? 'invalid' : '');

  const typWechseln = (typ: BuchungTyp) =>
    setze({
      typ,
      // Vorbelegung mitnehmen, solange der Bereich nicht von Hand geändert wurde
      euer_bereich: f.euer_bereich === standardBereich(f.typ, alle) ? standardBereich(typ, alle) : f.euer_bereich,
      ku: typ === 'einnahme',
      wareneingang: false,
    });

  const onKey = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault(); // nicht die Einstellungen verlassen
      schliessen();
    }
  };

  return (
    <form id="kat-form" className="kat-form" noValidate autoComplete="off" onSubmit={absenden} onKeyDown={onKey}>
      <div className="kat-form-titel">
        <span>{neu ? 'Neue Kategorie' : `„${bisher?.name ?? f.name}“ bearbeiten`}</span>
        <button type="button" className="icon-btn sm" title="Schließen" aria-label="Formular schließen" onClick={schliessen}>
          <X />
        </button>
      </div>
      <div className="form-grid">
        <div className="field full">
          <span className="field-label">Art</span>
          {neu ? (
            <Seg options={TYPEN} value={f.typ} onChange={typWechseln} ariaLabel="Art der Kategorie" />
          ) : (
            <p className="hint">{typName(f.typ)} – die Art lässt sich nach dem Anlegen nicht mehr ändern.</p>
          )}
          {meldung('typ')}
        </div>
        <div className="field">
          <label htmlFor="kat-name">Name</label>
          <input
            id="kat-name"
            className={`input ${ungueltig('name')}`}
            value={f.name}
            maxLength={NAME_MAX}
            placeholder={ausgabe ? 'z. B. Werkzeug (GWG)' : 'z. B. Verkauf'}
            aria-invalid={fehler.name ? true : undefined}
            onChange={(e) => setze({ name: e.target.value })}
          />
          {meldung('name')}
        </div>
        <div className="field">
          <label htmlFor="kat-euer">EÜR-Bereich</label>
          <input
            id="kat-euer"
            className={`input ${ungueltig('euer_bereich')}`}
            list="kat-euer-vorschlaege"
            value={f.euer_bereich}
            maxLength={BEREICH_MAX}
            aria-invalid={fehler.euer_bereich ? true : undefined}
            onChange={(e) => setze({ euer_bereich: e.target.value })}
          />
          <datalist id="kat-euer-vorschlaege">
            {euerVorschlaege(f.typ, alle).map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
          {meldung('euer_bereich') ?? <p className="hint">Gilt in allen Jahren ohne eigene Angabe unter „EÜR-Zuordnung“.</p>}
        </div>
        {ausgabe ? (
          <div className="field">
            <label htmlFor="kat-abziehbar">Abziehbar</label>
            <div className="input-wrap">
              <input
                id="kat-abziehbar"
                className={`input num ${ungueltig('abziehbar')}`}
                inputMode="numeric"
                value={f.abziehbar}
                aria-invalid={fehler.abziehbar ? true : undefined}
                onChange={(e) => setze({ abziehbar: e.target.value })}
              />
              <span className="suffix">%</span>
            </div>
            {meldung('abziehbar') ?? <p className="hint">Anteil, der als Betriebsausgabe zählt, z. B. Bewirtung 70 %.</p>}
          </div>
        ) : null}
        <div className={`toggle-row kat-schalter ${ausgabe ? '' : 'full'}`}>
          <span>
            {ausgabe ? 'Wareneingangsbuch' : 'Zählt zum Kleinunternehmer-Umsatz'}
            <small>
              {ausgabe ? 'Einkäufe dieser Kategorie stehen im Wareneingangsbuch (§ 143 AO).' : 'Für die Grenzen nach § 19 UStG (Vorjahr und laufendes Jahr).'}
            </small>
          </span>
          <Switch
            checked={ausgabe ? f.wareneingang : f.ku}
            onChange={(v) => setze(ausgabe ? { wareneingang: v } : { ku: v })}
            label={ausgabe ? 'Wareneingangsbuch' : 'Zählt zum Kleinunternehmer-Umsatz'}
          />
        </div>
        <div className="field full">
          <label htmlFor="kat-stichworte">Stichworte</label>
          <input
            id="kat-stichworte"
            className={`input ${ungueltig('stichworte')}`}
            value={f.stichworte}
            placeholder={ausgabe ? 'z. B. tankstelle, aral, diesel' : 'z. B. rasen, hecke, montage'}
            spellCheck={false}
            aria-invalid={fehler.stichworte ? true : undefined}
            onChange={(e) => setze({ stichworte: e.target.value })}
          />
          {meldung('stichworte') ?? (
            <p className="hint">Kommagetrennt. Steht eins davon in Beschreibung oder Geschäft, schlägt die Erfassen-Schublade diese Kategorie vor.</p>
          )}
        </div>
        <div className="field full">
          <span className="field-label" id="kat-symbol-label">
            Symbol
          </span>
          <div className="kat-wahl" role="radiogroup" aria-labelledby="kat-symbol-label" style={farbVar(f.farbe)}>
            {KATEGORIE_ICONS.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={f.icon === name}
                aria-label={ICON_NAMEN[name]}
                title={ICON_NAMEN[name]}
                className={`kat-symbol ${f.icon === name ? 'on' : ''}`}
                onClick={() => setze({ icon: name })}
              >
                <KategorieIcon icon={name} />
              </button>
            ))}
          </div>
          {meldung('icon')}
        </div>
        <div className="field full">
          <span className="field-label" id="kat-farbe-label">
            Farbe
          </span>
          <div className="kat-wahl" role="radiogroup" aria-labelledby="kat-farbe-label">
            {KATEGORIE_FARBEN.map((c) => (
              <button
                key={c.wert}
                type="button"
                role="radio"
                aria-checked={f.farbe.toLowerCase() === c.wert}
                aria-label={c.name}
                title={c.name}
                className={`kat-farbe ${f.farbe.toLowerCase() === c.wert ? 'on' : ''}`}
                style={farbVar(c.wert)}
                onClick={() => setze({ farbe: c.wert })}
              />
            ))}
          </div>
          {meldung('farbe')}
        </div>
      </div>
      <div className="row">
        <button type="submit" className="btn-primary sm" disabled={laeuft}>
          {neu ? <Plus /> : null}
          {neu ? 'Anlegen' : 'Speichern'}
        </button>
        <button type="button" className="btn ghost" onClick={schliessen}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

/* ================= EÜR-Zuordnung pro Jahr ================= */

/** Entwurf/Fehler je Eingabefeld: „<kategorie_id>:b“ (Bereich) bzw. „<kategorie_id>:z“ (Zeile). */
type Feldwerte = Partial<Record<string, string>>;

export function EuerZuordnungKarte({
  kategorien,
  zeilen,
  neuLaden,
  i,
}: {
  kategorien: readonly Kategorie[];
  zeilen: readonly EuerZeile[];
  neuLaden: () => Promise<void>;
  i: number;
}) {
  const toast = useUi((s) => s.toast);
  const jahre = euerJahre(zeilen);
  const [jahr, setJahr] = useState<number | null>(() => anzeigeJahr(jahre, diesesJahr()));
  const [entwurf, setEntwurf] = useState<Feldwerte>({});
  const [fehler, setFehler] = useState<Feldwerte>({});
  const [neuesJahr, setNeuesJahr] = useState(() => String(jahrVorschlag(jahre, diesesJahr())));
  const [jahrMeldung, setJahrMeldung] = useState<string | null>(null);
  const [legeAn, setLegeAn] = useState(false);

  const liste = euerKategorien(kategorien);
  const jeKategorie = new Map(zeilen.filter((z) => z.jahr === jahr).map((z) => [z.kategorie_id, z] as const));

  const jahrWaehlen = (j: number) => {
    setJahr(j);
    setEntwurf({});
    setFehler({});
  };

  const setEintrag = (set: (f: (m: Feldwerte) => Feldwerte) => void, k: string, v: string | null) =>
    set((m) => {
      const n = { ...m };
      if (v === null) delete n[k];
      else n[k] = v;
      return n;
    });

  const uebernehmen = async (k: Kategorie, feld: 'b' | 'z') => {
    const schluessel = `${k.id}:${feld}`;
    const eingabe = entwurf[schluessel];
    if (eingabe === undefined || jahr === null) return;
    let teil: Partial<EuerWerte>;
    if (feld === 'b') {
      const r = euerBereichLesen(eingabe, k.euer_bereich);
      if ('fehler' in r) {
        setEintrag(setFehler, schluessel, r.fehler);
        return;
      }
      teil = { euer_bereich: r.wert };
    } else {
      const r = euerZeileLesen(eingabe);
      if ('fehler' in r) {
        setEintrag(setFehler, schluessel, r.fehler);
        return;
      }
      teil = { euer_zeile: r.wert };
    }
    setEintrag(setFehler, schluessel, null);
    try {
      if (await speichereEuerZuordnung(jahr, k.id, teil)) toast(`EÜR-Zuordnung ${jahr} für „${k.name}“ gespeichert`);
    } catch (e) {
      toast(`Nicht gespeichert: ${fehlerText(e)}`, 'warn');
    }
    await neuLaden();
    setEintrag(setEntwurf, schluessel, null);
  };

  const onKey = (schluessel: string) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      e.preventDefault(); // nicht die Einstellungen verlassen
      setEintrag(setEntwurf, schluessel, null);
      setEintrag(setFehler, schluessel, null);
    }
  };

  const jahrAnlegen = async () => {
    const j = Number(neuesJahr.trim());
    const meldung = jahrFehler(j, jahre, 'eine EÜR-Zuordnung');
    if (meldung) {
      setJahrMeldung(meldung);
      return;
    }
    const quelle = kopierQuelle(jahre, j);
    setJahrMeldung(null);
    setLegeAn(true);
    try {
      await legeEuerJahrAn(j, quelle);
      toast(
        quelle === null
          ? `EÜR-Zuordnung ${j} angelegt`
          : `EÜR-Zuordnung ${j} angelegt, Werte aus ${quelle} übernommen – Zeilen bitte im Formular ${j} prüfen`,
      );
      await neuLaden();
      jahrWaehlen(j);
      setNeuesJahr(String(jahrVorschlag([...jahre, j], diesesJahr())));
    } catch (e) {
      setJahrMeldung(fehlerText(e));
    } finally {
      setLegeAn(false);
    }
  };

  const quelleVorschau = /^\d{4}$/.test(neuesJahr.trim()) ? kopierQuelle(jahre, Number(neuesJahr.trim())) : null;

  return (
    <SetCard title="EÜR-Zuordnung" i={i}>
      <div className="set-row" data-setting="euer-zuordnung">
        <div className="set-label">
          <span>Jahr</span>
        </div>
        {jahre.length && jahr !== null ? (
          <Seg
            options={jahre.map((j) => ({ value: String(j), label: String(j) }))}
            value={String(jahr)}
            onChange={(v) => jahrWaehlen(Number(v))}
            ariaLabel="Jahr der EÜR-Zuordnung"
          />
        ) : (
          <p className="hint">Noch keine Zuordnung gespeichert – unten ein Jahr anlegen.</p>
        )}
      </div>

      {jahr !== null ? (
        <div className="table-wrap">
          <table className="fin-table euer-table">
            <thead>
              <tr>
                <th className="l">Kategorie</th>
                <th className="l">EÜR-Bereich {jahr}</th>
                <th>Zeile</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((k) => {
                const z = jeKategorie.get(k.id);
                const sb = `${k.id}:b`;
                const sz = `${k.id}:z`;
                const bereich = entwurf[sb] ?? z?.euer_bereich ?? '';
                const nr = entwurf[sz] ?? (z?.euer_zeile != null ? String(z.euer_zeile) : '');
                const fb = fehler[sb];
                const fz = fehler[sz];
                return (
                  <tr key={k.id}>
                    <td className="l wrap">
                      <KategorieName k={k} unter={`${typName(k.typ)}${k.archiviert ? ' · ausgeblendet' : ''}`} />
                    </td>
                    <td className="l">
                      <input
                        className={`input sm euer-bereich ${fb ? 'invalid' : ''}`}
                        value={bereich}
                        placeholder={k.euer_bereich ?? 'EÜR-Bereich'}
                        list={`euer-vorschlaege-${k.typ}`}
                        maxLength={BEREICH_MAX}
                        spellCheck={false}
                        aria-label={`EÜR-Bereich ${jahr} für „${k.name}“`}
                        aria-invalid={fb ? true : undefined}
                        onChange={(e) => setEintrag(setEntwurf, sb, e.target.value)}
                        onBlur={() => void uebernehmen(k, 'b')}
                        onKeyDown={onKey(sb)}
                      />
                      {fb ? (
                        <p className="hint neg" role="alert">
                          {fb}
                        </p>
                      ) : null}
                    </td>
                    <td>
                      <input
                        className={`input sm num euer-zeile ${fz ? 'invalid' : ''}`}
                        inputMode="numeric"
                        value={nr}
                        placeholder="—"
                        maxLength={3}
                        aria-label={`Zeile der Anlage EÜR ${jahr} für „${k.name}“`}
                        aria-invalid={fz ? true : undefined}
                        onChange={(e) => setEintrag(setEntwurf, sz, e.target.value)}
                        onBlur={() => void uebernehmen(k, 'z')}
                        onKeyDown={onKey(sz)}
                      />
                      {fz ? (
                        <p className="hint neg" role="alert">
                          {fz}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(['einnahme', 'ausgabe'] as const).map((typ) => (
            <datalist key={typ} id={`euer-vorschlaege-${typ}`}>
              {euerVorschlaege(typ, kategorien).map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          ))}
        </div>
      ) : null}

      <div className="set-note">
        <Info />
        <span>
          <b>Zeilennummern bitte im Formular des Jahres prüfen.</b> Die Anlage EÜR ändert ihre Zeilen manchmal von Jahr zu Jahr. Ein
          leeres Feld „EÜR-Bereich“ heißt: wie bei der Kategorie (grau angezeigt). Die EÜR unter Auswertung › Steuer & Export ordnet
          danach zu.
        </span>
      </div>

      <div className="set-row" data-setting="euer-jahr">
        <div className="set-label">
          <span>Jahr anlegen</span>
        </div>
        <div className="row wrap">
          <input
            className={`input sm num set-jahr ${jahrMeldung ? 'invalid' : ''}`}
            inputMode="numeric"
            value={neuesJahr}
            aria-label="Neues Jahr der EÜR-Zuordnung"
            onChange={(e) => {
              setNeuesJahr(e.target.value);
              setJahrMeldung(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void jahrAnlegen();
            }}
          />
          <button type="button" className="btn ghost" disabled={legeAn} onClick={() => void jahrAnlegen()}>
            <CalendarPlus />
            Jahr anlegen
          </button>
        </div>
        {jahrMeldung ? (
          <p className="hint neg" role="alert">
            {jahrMeldung}
          </p>
        ) : (
          <p className="hint">
            {quelleVorschau !== null
              ? `Übernimmt die Zuordnung aus ${quelleVorschau}. Danach die Zeilen mit dem neuen Formular vergleichen.`
              : 'Neue Jahre übernehmen die Zuordnung des Vorjahres.'}
          </p>
        )}
      </div>
    </SetCard>
  );
}
