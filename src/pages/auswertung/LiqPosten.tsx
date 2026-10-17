/* Auswertung › Liquidität: Planposten (einmalige erwartete Zahlungen) und wiederkehrende Kosten (§6.9.2).
 * Anlegen, Ändern, Löschen über Rust (je eine Transaktion mit Protokolleintrag), danach lädt die Seite neu
 * (datenGeaendert). Löschen mit „Rückgängig“ im Toast (legt den Posten neu an). Wiederkehrende Kosten erzeugen hier
 * keine Buchungen – sie fließen nur in die Vorschau ein (Buchungen daraus kommen in Phase 7).
 * Optik wie referenz/prototyp/js/pages/liquiditaet.js (Planposten-Liste und -Formular). */
import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Repeat, Trash2, X } from 'lucide-react';
import type { BuchungTyp, KategorieWahl } from '../../lib/buchungen';
import { fehlerText } from '../../lib/fehler';
import { vorText } from '../../lib/kunden';
import { RHYTHMEN, datumKurz, naechsterTermin, type Planposten, type Rhythmus, type Wiederkehrend } from '../../lib/liquiditaet';
import { betragAlsEingabe, formatBetrag, parseBetrag } from '../../lib/money';
import {
  planpostenAendern,
  planpostenAnlegen,
  planpostenLoeschen,
  wiederkehrendAendern,
  wiederkehrendAktiv,
  wiederkehrendAnlegen,
  wiederkehrendLoeschen,
  type PlanpostenDaten,
  type WiederkehrendDaten,
} from '../../lib/queries/liquiditaet';
import { plusTage } from '../../lib/zeitraum';
import { useUi } from '../../store/ui';
import { Seg } from '../../components/ui/Seg';

const TYPEN = [
  { value: 'ausgabe', label: 'Ausgabe' },
  { value: 'einnahme', label: 'Einnahme' },
] as const;

const euro0 = (c: number) => formatBetrag(c, { nachkomma: 0, vorzeichen: 'immer' });
const datumLang = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const rhythmusText = (r: Rhythmus) => RHYTHMEN.find((x) => x.value === r)?.label ?? r;

const geaendert = () => useUi.getState().datenGeaendert();
const fehlerToast = (e: unknown) => useUi.getState().showToast({ text: fehlerText(e), icon: 'warn', sticky: true });
const rueckgaengig = (text: string, run: () => Promise<unknown>) =>
  useUi.getState().showToast({
    text,
    icon: 'check',
    actions: [
      {
        label: 'Rückgängig',
        run: () => {
          run().then(geaendert, fehlerToast);
        },
      },
    ],
  });

/* ================= Planposten ================= */

interface PlanForm {
  id: number | null;
  typ: BuchungTyp;
  datum: string;
  betrag: string;
  text: string;
}

const leererPlan = (heute: string): PlanForm => ({ id: null, typ: 'ausgabe', datum: plusTage(heute, 30), betrag: '', text: '' });

export function PlanpostenKarte({ planposten, heute, bis, tage }: { planposten: readonly Planposten[]; heute: string; bis: string; tage: number }) {
  const [form, setForm] = useState<PlanForm>(() => leererPlan(heute));
  const [fehler, setFehler] = useState<{ text: string; felder: (keyof PlanForm)[] } | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const morgen = plusTage(heute, 1);
  const liste = [...planposten].sort((a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : a.id - b.id));

  const setze = (teil: Partial<PlanForm>) => {
    setForm((f) => ({ ...f, ...teil }));
    setFehler(null);
  };

  const bearbeiten = (p: Planposten) => {
    setForm({ id: p.id, typ: p.betrag_cent < 0 ? 'ausgabe' : 'einnahme', datum: p.datum, betrag: betragAlsEingabe(p.betrag_cent), text: p.text });
    setFehler(null);
  };

  const absenden = async (e: FormEvent) => {
    e.preventDefault();
    const cent = parseBetrag(form.betrag);
    const text = form.text.trim();
    const felder: (keyof PlanForm)[] = [];
    const teile: string[] = [];
    if (!form.datum || form.datum <= heute) {
      felder.push('datum');
      teile.push('ein Datum nach heute');
    }
    if (cent == null || cent === 0) {
      felder.push('betrag');
      teile.push('einen Betrag');
    }
    if (!text) {
      felder.push('text');
      teile.push('eine Beschreibung');
    }
    if (felder.length || cent == null) {
      setFehler({ text: `Bitte ${teile.join(', ')} angeben.`, felder });
      return;
    }
    const daten: PlanpostenDaten = { datum: form.datum, text, betrag_cent: (form.typ === 'ausgabe' ? -1 : 1) * Math.abs(cent) };
    setLaeuft(true);
    try {
      if (form.id == null) await planpostenAnlegen(daten, heute);
      else await planpostenAendern(form.id, daten, heute);
      const ausserhalb = daten.datum > bis ? ` (außerhalb der ${tage}-Tage-Vorschau)` : '';
      useUi.getState().toast(`Planposten „${text}“ ${form.id == null ? 'am' : 'gespeichert für den'} ${datumLang(daten.datum)}${form.id == null ? ' eingeplant' : ''}${ausserhalb}`);
      setForm(leererPlan(heute));
      geaendert();
    } catch (err) {
      setFehler({ text: fehlerText(err), felder: [] });
    } finally {
      setLaeuft(false);
    }
  };

  const loeschen = async (p: Planposten) => {
    try {
      await planpostenLoeschen(p.id);
      if (form.id === p.id) setForm(leererPlan(heute));
      geaendert();
      const daten = { datum: p.datum, text: p.text, betrag_cent: p.betrag_cent };
      if (p.datum > heute) rueckgaengig(`Planposten „${p.text}“ gelöscht`, () => planpostenAnlegen(daten, heute));
      else useUi.getState().toast(`Planposten „${p.text}“ gelöscht`);
    } catch (err) {
      fehlerToast(err);
    }
  };

  const ungueltig = (f: keyof PlanForm) => (fehler?.felder.includes(f) ? 'invalid' : '');

  return (
    <>
      {liste.length ? (
        <ul className="liq-plan">
          {liste.map((p) => {
            const vorbei = p.datum <= heute;
            const aus = vorbei || p.datum > bis;
            return (
              <li key={p.id} className={`${aus ? 'out' : ''} ${form.id === p.id ? 'edit' : ''}`} title={vorbei ? 'Liegt nicht mehr in der Zukunft' : p.datum > bis ? `Liegt außerhalb der ${tage}-Tage-Vorschau` : undefined}>
                <span className="liq-plan-d">
                  <b>{datumKurz(p.datum)}</b>
                  <small>{vorText(p.datum, heute)}</small>
                </span>
                <span className="liq-plan-t">{p.text}</span>
                <b className={`num ${p.betrag_cent > 0 ? 'pos-t' : ''}`}>{euro0(p.betrag_cent)}</b>
                <span className="liq-plan-a">
                  {vorbei ? null : (
                    <button type="button" className="icon-btn sm" title="Planposten ändern" aria-label={`Planposten „${p.text}“ ändern`} onClick={() => bearbeiten(p)}>
                      <Pencil />
                    </button>
                  )}
                  <button type="button" className="icon-btn sm loeschen" title="Planposten löschen" aria-label={`Planposten „${p.text}“ löschen`} onClick={() => void loeschen(p)}>
                    <Trash2 />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="liq-plan-empty">Noch keine Planposten. Trag z. B. eine geplante Anschaffung oder einen großen Auftrag ein.</p>
      )}
      <form className="liq-pf" noValidate autoComplete="off" onSubmit={(e) => void absenden(e)}>
        {form.id != null ? <div className="liq-pf-titel">Planposten ändern</div> : null}
        <div className="liq-pf-row">
          <Seg options={TYPEN} value={form.typ} onChange={(typ) => setze({ typ })} className="full" ariaLabel="Art des Planpostens" />
        </div>
        <div className="liq-pf-row two">
          <input type="date" className={`input sm ${ungueltig('datum')}`} min={morgen} value={form.datum} onChange={(e) => setze({ datum: e.target.value })} aria-label="Datum" />
          <div className="input-wrap">
            <input className={`input sm money ${ungueltig('betrag')}`} inputMode="decimal" placeholder="0,00" value={form.betrag} onChange={(e) => setze({ betrag: e.target.value })} aria-label="Betrag" />
            <span className="suffix">€</span>
          </div>
        </div>
        <div className="liq-pf-row two wide">
          <input className={`input sm ${ungueltig('text')}`} placeholder="Was? z. B. Neue Heckenschere" maxLength={80} value={form.text} onChange={(e) => setze({ text: e.target.value })} aria-label="Beschreibung" />
          <button type="submit" className="btn-primary sm" disabled={laeuft}>
            {form.id == null ? <Plus /> : null}
            {form.id == null ? 'Hinzufügen' : 'Speichern'}
          </button>
        </div>
        {form.id != null ? (
          <button type="button" className="liq-linkbtn" onClick={() => setForm(leererPlan(heute))}>
            Abbrechen
          </button>
        ) : null}
        {fehler ? (
          <p className="hint neg" role="alert">
            {fehler.text}
          </p>
        ) : null}
      </form>
    </>
  );
}

/** „Um 30 Tage verschieben“ aus dem Engpass-Hinweis (mit Rückgängig). */
export async function planVerschieben(p: Planposten, heute: string) {
  const neu = plusTage(p.datum, 30);
  try {
    await planpostenAendern(p.id, { datum: neu, text: p.text, betrag_cent: p.betrag_cent }, heute);
    geaendert();
    rueckgaengig(`„${p.text}“ auf ${datumLang(neu)} verschoben`, () => planpostenAendern(p.id, { datum: p.datum, text: p.text, betrag_cent: p.betrag_cent }, heute));
  } catch (err) {
    fehlerToast(err);
  }
}

/* ================= Wiederkehrende Kosten ================= */

interface WkForm {
  id: number | null;
  typ: BuchungTyp;
  name: string;
  betrag: string;
  rhythmus: Rhythmus;
  datum: string;
  kategorie: string;
  /** beim Ändern: ursprünglicher Tag und das dazu gezeigte Datum (bleibt erhalten, solange das Datum gleich bleibt) */
  tag: number | null;
  datumAlt: string | null;
  aktiv: boolean;
}

const leeresWk = (heute: string): WkForm => ({
  id: null,
  typ: 'ausgabe',
  name: '',
  betrag: '',
  rhythmus: 'monatlich',
  datum: plusTage(heute, 1),
  kategorie: '',
  tag: null,
  datumAlt: null,
  aktiv: true,
});

export function WiederkehrendListe({ wiederkehrend, kategorien, heute }: { wiederkehrend: readonly Wiederkehrend[]; kategorien: readonly KategorieWahl[]; heute: string }) {
  const [form, setForm] = useState<WkForm | null>(null);
  const [fehler, setFehler] = useState<{ text: string; felder: (keyof WkForm)[] } | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const setze = (teil: Partial<WkForm>) => {
    setForm((f) => (f ? { ...f, ...teil } : f));
    setFehler(null);
  };

  const bearbeiten = (w: Wiederkehrend) => {
    const datum = naechsterTermin(w, heute) ?? w.naechstes_datum;
    setForm({
      id: w.id,
      typ: w.vorlage.typ,
      name: w.vorlage.name,
      betrag: betragAlsEingabe(w.vorlage.betrag_cent),
      rhythmus: w.rhythmus,
      datum,
      kategorie: w.vorlage.kategorie_id == null ? '' : String(w.vorlage.kategorie_id),
      tag: w.vorlage.tag,
      datumAlt: datum,
      aktiv: w.aktiv,
    });
    setFehler(null);
  };

  const daten = (f: WkForm, cent: number): WiederkehrendDaten => ({
    name: f.name.trim(),
    betrag_cent: cent,
    typ: f.typ,
    kategorie_id: f.kategorie ? Number(f.kategorie) : null,
    rhythmus: f.rhythmus,
    naechstes_datum: f.datum,
    tag: f.datum === f.datumAlt ? f.tag : null,
    aktiv: f.aktiv,
  });

  const absenden = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const cent = parseBetrag(form.betrag);
    const felder: (keyof WkForm)[] = [];
    const teile: string[] = [];
    if (!form.name.trim()) {
      felder.push('name');
      teile.push('einen Namen');
    }
    if (cent == null || cent <= 0) {
      felder.push('betrag');
      teile.push('einen Betrag über 0');
    }
    if (!form.datum) {
      felder.push('datum');
      teile.push('die nächste Zahlung');
    }
    if (felder.length || cent == null) {
      setFehler({ text: `Bitte ${teile.join(', ')} angeben.`, felder });
      return;
    }
    const d = daten(form, cent);
    setLaeuft(true);
    try {
      if (form.id == null) await wiederkehrendAnlegen(d);
      else await wiederkehrendAendern(form.id, d);
      useUi.getState().toast(`„${d.name}“ ${form.id == null ? 'angelegt' : 'gespeichert'}`);
      setForm(null);
      geaendert();
    } catch (err) {
      setFehler({ text: fehlerText(err), felder: [] });
    } finally {
      setLaeuft(false);
    }
  };

  const umschalten = async (w: Wiederkehrend) => {
    try {
      await wiederkehrendAktiv(w.id, !w.aktiv);
      geaendert();
    } catch (err) {
      fehlerToast(err);
    }
  };

  const loeschen = async (w: Wiederkehrend) => {
    try {
      await wiederkehrendLoeschen(w.id);
      if (form?.id === w.id) setForm(null);
      geaendert();
      const d: WiederkehrendDaten = { ...w.vorlage, rhythmus: w.rhythmus, naechstes_datum: w.naechstes_datum, tag: w.vorlage.tag, aktiv: w.aktiv };
      rueckgaengig(`„${w.vorlage.name}“ gelöscht`, () => wiederkehrendAnlegen(d));
    } catch (err) {
      fehlerToast(err);
    }
  };

  const ungueltig = (f: keyof WkForm) => (fehler?.felder.includes(f) ? 'invalid' : '');
  const passend = form ? kategorien.filter((k) => k.typ === form.typ) : [];

  return (
    <div className="liq-wk">
      <div className="liq-wk-head">
        <span>
          Wiederkehrende Kosten
          <small>Termine für die Vorschau – es entstehen keine Buchungen.</small>
        </span>
        {form ? null : (
          <button type="button" className="btn subtle liq-reset" onClick={() => setForm(leeresWk(heute))}>
            <Plus />
            Hinzufügen
          </button>
        )}
      </div>
      {wiederkehrend.length ? (
        <ul className="liq-wk-list">
          {wiederkehrend.map((w) => {
            const naechster = naechsterTermin(w, heute);
            const betrag = (w.vorlage.typ === 'einnahme' ? 1 : -1) * w.vorlage.betrag_cent;
            return (
              <li key={w.id} className={`${w.aktiv ? '' : 'out'} ${form?.id === w.id ? 'edit' : ''}`}>
                <span className="switch" title={w.aktiv ? 'Pausieren' : 'Wieder einrechnen'}>
                  <input type="checkbox" checked={w.aktiv} onChange={() => void umschalten(w)} aria-label={`„${w.vorlage.name}“ in der Vorschau einrechnen`} />
                  <span />
                </span>
                <span className="liq-wk-t">
                  <b>{w.vorlage.name}</b>
                  <small>
                    {rhythmusText(w.rhythmus)}
                    {w.aktiv ? (naechster ? ` · nächste ${datumKurz(naechster)}` : '') : ' · pausiert'}
                  </small>
                </span>
                <b className={`num ${betrag > 0 ? 'pos-t' : ''}`}>{formatBetrag(betrag, { vorzeichen: 'immer' })}</b>
                <span className="liq-plan-a">
                  <button type="button" className="icon-btn sm" title="Ändern" aria-label={`„${w.vorlage.name}“ ändern`} onClick={() => bearbeiten(w)}>
                    <Pencil />
                  </button>
                  <button type="button" className="icon-btn sm loeschen" title="Löschen" aria-label={`„${w.vorlage.name}“ löschen`} onClick={() => void loeschen(w)}>
                    <Trash2 />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : form ? null : (
        <p className="liq-plan-empty">
          <Repeat />
          Noch keine wiederkehrenden Kosten – z. B. Handyvertrag, Versicherung, Miete.
        </p>
      )}
      {form ? (
        <form className="liq-pf" noValidate autoComplete="off" onSubmit={(e) => void absenden(e)}>
          <div className="liq-pf-titel">
            {form.id == null ? 'Wiederkehrende Zahlung anlegen' : 'Wiederkehrende Zahlung ändern'}
            <button type="button" className="icon-btn sm" title="Schließen" aria-label="Formular schließen" onClick={() => setForm(null)}>
              <X />
            </button>
          </div>
          <div className="liq-pf-row">
            <Seg options={TYPEN} value={form.typ} onChange={(typ) => setze({ typ, kategorie: '' })} className="full" ariaLabel="Art der Zahlung" />
          </div>
          <div className="liq-pf-row two wide">
            <input className={`input sm ${ungueltig('name')}`} placeholder="Name, z. B. Handyvertrag" maxLength={80} value={form.name} onChange={(e) => setze({ name: e.target.value })} aria-label="Name" />
            <div className="input-wrap liq-pf-betrag">
              <input className={`input sm money ${ungueltig('betrag')}`} inputMode="decimal" placeholder="0,00" value={form.betrag} onChange={(e) => setze({ betrag: e.target.value })} aria-label="Betrag" />
              <span className="suffix">€</span>
            </div>
          </div>
          <div className="liq-pf-row two">
            <select className="select sm" value={form.rhythmus} onChange={(e) => setze({ rhythmus: e.target.value as Rhythmus })} aria-label="Rhythmus">
              {RHYTHMEN.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <input type="date" className={`input sm ${ungueltig('datum')}`} value={form.datum} onChange={(e) => setze({ datum: e.target.value })} aria-label="Nächste Zahlung" title="Nächste Zahlung" />
          </div>
          <div className="liq-pf-row two wide">
            <select className="select sm" value={form.kategorie} onChange={(e) => setze({ kategorie: e.target.value })} aria-label="Kategorie">
              <option value="">Ohne Kategorie</option>
              {passend.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-primary sm" disabled={laeuft}>
              {form.id == null ? 'Anlegen' : 'Speichern'}
            </button>
          </div>
          {fehler ? (
            <p className="hint neg" role="alert">
              {fehler.text}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
