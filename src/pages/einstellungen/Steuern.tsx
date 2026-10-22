/* Einstellungen › Steuern (§6.10, §2.6, §2.8): Kleinunternehmer oder Regelbesteuerung, Steuer-Kennwerte pro Jahr
 * (Anzeige in €, gespeichert in Cent bzw. ganzen Prozent), „Jahr anlegen“ mit den Werten des Vorjahres,
 * Kategorien und EÜR-Zuordnung pro Jahr (Kategorien.tsx). Speichern über lib/queries (jede Änderung ins Protokoll). */
import { useEffect, useState, type KeyboardEvent } from 'react';
import { CalendarPlus, Landmark, TriangleAlert } from 'lucide-react';
import type { EuerZeile, Kategorie } from '../../lib/kategorien';
import { ladeEuerZeilen, ladeKategorien } from '../../lib/queries/kategorien';
import { ladeUstModus, speichereUstModus, type UstModus } from '../../lib/queries/einstellungen';
import { ladeKennwerte, legeJahrAn, speichereKennwert } from '../../lib/queries/steuer';
import {
  KENNWERTE,
  anzeigeJahr,
  jahrFehler,
  jahrVorschlag,
  kennwertAlsEingabe,
  kennwertLesen,
  kopierQuelle,
  type Kennwert,
  type KennwerteJahr,
} from '../../lib/steuer-kennwerte';
import { useUi } from '../../store/ui';
import { Seg } from '../../components/ui/Seg';
import { EuerZuordnungKarte, KategorienKarte } from './Kategorien';
import { Ladeansicht, fehlerText, useLaden } from './Laden';
import { SetCard, SetRow } from './SetRow';

interface SteuerDaten {
  modus: UstModus;
  kennwerte: Map<number, KennwerteJahr>;
  /** alle, auch ausgeblendete */
  kategorien: Kategorie[];
  euer: EuerZeile[];
}

const ladeSteuern = async (): Promise<SteuerDaten> => {
  const [modus, kennwerte, kategorien, euer] = await Promise.all([ladeUstModus(), ladeKennwerte(), ladeKategorien(), ladeEuerZeilen()]);
  return { modus, kennwerte, kategorien, euer };
};

const diesesJahr = () => new Date().getFullYear();

export default function Steuern() {
  const { zustand, neuLaden, erneut } = useLaden(ladeSteuern);
  if (zustand.status !== 'ok') return <Ladeansicht zustand={zustand} icon={Landmark} was="Die Steuer-Einstellungen" erneut={erneut} />;
  return (
    <>
      <Steuermodus modus={zustand.daten.modus} neuLaden={neuLaden} />
      <Kennwerte kennwerte={zustand.daten.kennwerte} neuLaden={neuLaden} />
      <KategorienKarte kategorien={zustand.daten.kategorien} neuLaden={neuLaden} i={3} />
      <EuerZuordnungKarte kategorien={zustand.daten.kategorien} zeilen={zustand.daten.euer} neuLaden={neuLaden} i={4} />
    </>
  );
}

/* ---------- Kleinunternehmer / Regelbesteuerung ---------- */

function Steuermodus({ modus, neuLaden }: { modus: UstModus; neuLaden: () => Promise<void> }) {
  const toast = useUi((s) => s.toast);
  const [wert, setWert] = useState(modus);
  useEffect(() => setWert(modus), [modus]);

  const wechseln = async (neu: UstModus) => {
    if (neu === wert) return;
    setWert(neu);
    try {
      await speichereUstModus(neu);
      toast(neu === 'klein' ? 'Kleinunternehmer (§ 19 UStG) eingestellt' : 'Regelbesteuerung eingestellt');
    } catch (e) {
      toast(`Nicht gespeichert: ${fehlerText(e)}`, 'warn');
    }
    await neuLaden();
  };

  return (
    <SetCard title="Umsatzsteuer" i={1}>
      <SetRow id="steuermodus" label="Besteuerung">
        <Seg
          options={[
            { value: 'klein', label: 'Kleinunternehmer (§ 19 UStG)' },
            { value: 'regel', label: 'Regelbesteuerung' },
          ]}
          value={wert}
          onChange={(v) => void wechseln(v)}
          ariaLabel="Besteuerung"
        />
        <p className="hint">
          {wert === 'klein'
            ? 'Keine Umsatzsteuer auf Einnahmen, kein Vorsteuerabzug. Belege tragen den Hinweis auf die Steuerbefreiung nach § 19 UStG.'
            : 'Beim Erfassen und auf Belegen kommen Nettobetrag, Steuersatz und Steuerbetrag dazu (§ 14 Abs. 4 UStG).'}
        </p>
      </SetRow>
      {wert === 'regel' ? (
        <div className="set-note warn">
          <TriangleAlert />
          <span>
            <b>Vorher klären.</b> Wer freiwillig zur Regelbesteuerung wechselt, ist daran mehrere Jahre gebunden. Im Zweifel
            Steuerberatung oder Finanzamt fragen.
          </span>
        </div>
      ) : null}
    </SetCard>
  );
}

/* ---------- Steuer-Kennwerte pro Jahr ---------- */

function Kennwerte({ kennwerte, neuLaden }: { kennwerte: Map<number, KennwerteJahr>; neuLaden: () => Promise<void> }) {
  const toast = useUi((s) => s.toast);
  const jahre = [...kennwerte.keys()].sort((a, b) => a - b);
  const [jahr, setJahr] = useState<number | null>(() => anzeigeJahr(jahre, diesesJahr()));
  const [entwurf, setEntwurf] = useState<Partial<Record<string, string>>>({});
  const [fehler, setFehler] = useState<Partial<Record<string, string>>>({});
  const [neuesJahr, setNeuesJahr] = useState(() => String(jahrVorschlag(jahre, diesesJahr())));
  const [jahrMeldung, setJahrMeldung] = useState<string | null>(null);
  const [legeAn, setLegeAn] = useState(false);

  const werte: KennwerteJahr = (jahr !== null && kennwerte.get(jahr)) || {};

  const jahrWaehlen = (j: number) => {
    setJahr(j);
    setEntwurf({});
    setFehler({});
  };

  const setEintrag = <T,>(set: (f: (m: Partial<Record<string, T>>) => Partial<Record<string, T>>) => void, k: string, v: T | null) =>
    set((m) => {
      const n = { ...m };
      if (v === null) delete n[k];
      else n[k] = v;
      return n;
    });

  const uebernehmen = async (k: Kennwert) => {
    const eingabe = entwurf[k.schluessel];
    if (eingabe === undefined || jahr === null) return;
    const r = kennwertLesen(eingabe, k.einheit);
    if ('fehler' in r) {
      setEintrag(setFehler, k.schluessel, r.fehler);
      return;
    }
    setEintrag(setFehler, k.schluessel, null);
    const alt = werte[k.schluessel];
    if (r.wert !== alt) {
      try {
        await speichereKennwert(jahr, k.schluessel, alt, r.wert);
        toast(`${k.label} (${jahr}) gespeichert`);
      } catch (e) {
        toast(`Nicht gespeichert: ${fehlerText(e)}`, 'warn');
      }
      await neuLaden();
    }
    setEintrag(setEntwurf, k.schluessel, null);
  };

  const onKey = (k: Kennwert) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      e.preventDefault(); // nicht die Einstellungen verlassen
      setEintrag(setEntwurf, k.schluessel, null);
      setEintrag(setFehler, k.schluessel, null);
    }
  };

  const jahrAnlegen = async () => {
    const j = Number(neuesJahr.trim());
    const meldung = jahrFehler(j, jahre);
    const quelle = kopierQuelle(jahre, j);
    if (meldung || quelle === null) {
      setJahrMeldung(meldung ?? 'Es gibt noch kein Jahr, aus dem Werte übernommen werden können.');
      return;
    }
    setJahrMeldung(null);
    setLegeAn(true);
    try {
      await legeJahrAn(j, quelle);
      toast(`Kennwerte ${j} angelegt, Werte aus ${quelle} übernommen – bitte prüfen`);
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
    <SetCard title="Steuer-Kennwerte" i={2}>
      <div className="set-row" data-setting="kennwerte">
        <div className="set-label">
          <span>Jahr</span>
        </div>
        {jahre.length && jahr !== null ? (
          <Seg
            options={jahre.map((j) => ({ value: String(j), label: String(j) }))}
            value={String(jahr)}
            onChange={(v) => jahrWaehlen(Number(v))}
            ariaLabel="Jahr der Kennwerte"
          />
        ) : (
          <p className="hint">Noch keine Kennwerte gespeichert.</p>
        )}
      </div>

      {jahr !== null ? (
        <div className="table-wrap">
          <table className="fin-table kw-table">
            <thead>
              <tr>
                <th className="l">Kennwert {jahr}</th>
                <th>Wert</th>
              </tr>
            </thead>
            <tbody>
              {KENNWERTE.map((k) => {
                const id = `kw-${k.schluessel}`;
                const gespeichert = werte[k.schluessel];
                const wert = entwurf[k.schluessel] ?? (gespeichert === undefined ? '' : kennwertAlsEingabe(gespeichert, k.einheit));
                const meldung = fehler[k.schluessel];
                return (
                  <tr key={k.schluessel} data-setting={id}>
                    <td className="l wrap">
                      <label htmlFor={id} className="kw-label">
                        {k.label}
                        {k.hinweis ? <small>{k.hinweis}</small> : null}
                      </label>
                      {meldung ? (
                        <p className="hint neg" id={`${id}-fehler`} role="alert">
                          {meldung}
                        </p>
                      ) : null}
                    </td>
                    <td>
                      <div className="input-wrap kw-wert">
                        <input
                          id={id}
                          className={`input sm num ${meldung ? 'invalid' : ''}`}
                          inputMode={k.einheit === 'cent' ? 'decimal' : 'numeric'}
                          value={wert}
                          placeholder="—"
                          spellCheck={false}
                          autoComplete="off"
                          aria-invalid={meldung ? true : undefined}
                          aria-describedby={meldung ? `${id}-fehler` : undefined}
                          onChange={(e) => setEintrag(setEntwurf, k.schluessel, e.target.value)}
                          onBlur={() => void uebernehmen(k)}
                          onKeyDown={onKey(k)}
                        />
                        <span className="suffix">{k.einheit === 'cent' ? '€' : '%'}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="set-row" data-setting="kennwerte-jahr">
        <div className="set-label">
          <span>Jahr anlegen</span>
        </div>
        <div className="row wrap">
          <input
            className={`input sm num set-jahr ${jahrMeldung ? 'invalid' : ''}`}
            inputMode="numeric"
            value={neuesJahr}
            aria-label="Neues Jahr"
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
              ? `Übernimmt die Werte aus ${quelleVorschau}. Grenzen und Pauschalen ändern sich manchmal zum Jahreswechsel – danach bitte prüfen.`
              : 'Neue Jahre übernehmen die Werte des Vorjahres.'}
          </p>
        )}
      </div>
    </SetCard>
  );
}
