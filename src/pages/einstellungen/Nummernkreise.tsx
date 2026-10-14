/* Einstellungen › Nummernkreise (§5, §6.10 „Muster mit Vorschau“). Pro Kreis: Muster mit Live-Vorschau der nächsten
 * Nummer und „Nächste laufende Nummer“ nur erhöhen (nie senken, GoBD: Nummern nie wiederverwenden).
 * Prüfungen in lib/numbering.ts, Speichern samt Protokoll in lib/queries/nummernkreise.ts. Vergeben wird hier nichts. */
import { useEffect, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Hash, Info, RotateCcw } from 'lucide-react';
import {
  KREIS_REIHENFOLGE,
  NUMMER_NAMEN,
  STANDARD_MUSTER,
  ZAEHLER_MAX,
  formatNummer,
  istJahresabhaengig,
  kreisVorschau,
  laufendeLesen,
  musterFehler,
  musterWechselFehler,
  zaehlerErhoehen,
  type Nummernkreis,
} from '../../lib/numbering';
import { ladeNummernkreise, nachbarn, speichereMuster, speichereZaehler, vergebeneNummern } from '../../lib/queries/nummernkreise';
import { useUi } from '../../store/ui';
import { Ladeansicht, fehlerText, useLaden } from './Laden';
import { SetCard } from './SetRow';

const diesesJahr = () => new Date().getFullYear();
const zahl = (n: number) => n.toLocaleString('de-DE');

export default function Nummernkreise() {
  const { zustand, neuLaden, erneut } = useLaden(ladeNummernkreise);
  if (zustand.status !== 'ok') return <Ladeansicht zustand={zustand} icon={Hash} was="Die Nummernkreise" erneut={erneut} />;
  const kreise = zustand.daten;
  const jahr = diesesJahr();

  return (
    <>
      <SetCard title="Nummernkreise" i={1}>
        <div className="set-row" data-setting="nummernkreise">
          <dl className="facts">
            <div className="fact">
              <dt className="mono">{'{JJJJ}'}</dt>
              <dd>Jahr, z. B. {jahr}</dd>
            </div>
            <div className="fact">
              <dt className="mono">{'{JJ}'}</dt>
              <dd>Jahr zweistellig, z. B. {String(jahr % 100).padStart(2, '0')}</dd>
            </div>
            <div className="fact">
              <dt className="mono">{'{NNN}'}</dt>
              <dd>laufende Nummer, mit Nullen auf so viele Stellen, wie N dastehen (1 bis 8), z. B. 001</dd>
            </div>
            <div className="fact">
              <dt>Übrige Zeichen</dt>
              <dd>Buchstaben, Ziffern und - _ / . (keine Leerzeichen)</dd>
            </div>
          </dl>
          <div className="set-note">
            <Info />
            <span>
              <b>Nummern werden erst beim Ausstellen vergeben und nie wiederverwendet.</b> Mit Jahr im Muster beginnt ein Kreis
              jedes Jahr wieder bei 1, ohne Jahr (Kundennummer) läuft er immer weiter. Die nächste Nummer lässt sich nur
              erhöhen, etwa beim Umstieg aus einem anderen Programm.
            </span>
          </div>
        </div>
      </SetCard>

      <SetCard title="Muster und nächste Nummer" i={2}>
        {kreise.map((k) => (
          <KreisZeile key={k.id} kreis={k} alle={kreise} jahr={jahr} neuLaden={neuLaden} />
        ))}
        {kreise.length < KREIS_REIHENFOLGE.length ? (
          <p className="hint warn">Nicht alle Nummernkreise wurden gefunden. Bitte die App neu starten.</p>
        ) : null}
      </SetCard>
    </>
  );
}

interface ZeileProps {
  kreis: Nummernkreis;
  alle: readonly Nummernkreis[];
  jahr: number;
  neuLaden: () => Promise<void>;
}

function KreisZeile({ kreis, alle, jahr, neuLaden }: ZeileProps) {
  const toast = useUi((s) => s.toast);
  const id = `nk-${kreis.id}`;
  const aktuell = kreisVorschau(kreis, kreis.muster, jahr);
  const minimum = 'laufend' in aktuell ? aktuell.laufend : null;

  const [muster, setMuster] = useState(kreis.muster);
  const [musterMeldung, setMusterMeldung] = useState<string | null>(null);
  const [zaehler, setZaehler] = useState(minimum === null ? '' : String(minimum));
  const [zaehlerMeldung, setZaehlerMeldung] = useState<string | null>(null);
  const [beschaeftigt, setBeschaeftigt] = useState(false);

  // Nach dem Speichern (neuer Stand aus der Datenbank) die Felder angleichen
  useEffect(() => {
    setMuster(kreis.muster);
    setMusterMeldung(null);
    setZaehler(minimum === null ? '' : String(minimum));
    setZaehlerMeldung(null);
  }, [kreis.muster, kreis.jahr, kreis.naechste, minimum]);

  const vorschau = kreisVorschau(kreis, muster.trim(), jahr);

  const musterSpeichern = async (eingabe: string) => {
    const neu = eingabe.trim();
    setMuster(neu);
    if (neu === kreis.muster) {
      setMusterMeldung(null);
      return;
    }
    const fehler = musterFehler(neu);
    if (fehler) {
      setMusterMeldung(fehler);
      return;
    }
    setBeschaeftigt(true);
    try {
      const vergebene = await vergebeneNummern(kreis.id);
      const wechsel = musterWechselFehler(kreis, neu, jahr, vergebene, nachbarn(alle, kreis.id));
      if (wechsel) {
        setMusterMeldung(wechsel);
        return;
      }
      await speichereMuster(kreis, neu);
      toast(`Muster für die ${NUMMER_NAMEN[kreis.id]} gespeichert`);
      await neuLaden();
    } catch (e) {
      setMusterMeldung(fehlerText(e));
    } finally {
      setBeschaeftigt(false);
    }
  };

  const onMusterKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur();
    if (e.key === 'Escape') {
      e.preventDefault(); // nicht die Einstellungen verlassen
      setMuster(kreis.muster);
      setMusterMeldung(null);
    }
  };

  /* Nächste laufende Nummer: Live-Prüfung ohne Datenbank, beim Erhöhen zusätzlich gegen die vergebenen Nummern. */
  const gewuenscht = laufendeLesen(zaehler);
  const zaehlerPruefung =
    minimum === null || gewuenscht === null || gewuenscht === minimum ? null : zaehlerErhoehen(kreis, gewuenscht, jahr);
  const kannErhoehen = !!zaehlerPruefung && 'stand' in zaehlerPruefung && !beschaeftigt;

  const zaehlerHinweis = (): { text: string; art: 'neg' | '' } => {
    if (zaehlerMeldung) return { text: zaehlerMeldung, art: 'neg' };
    if (minimum === null) return { text: '', art: '' };
    if (gewuenscht === null) return { text: `Bitte eine ganze Zahl von ${zahl(minimum)} bis ${zahl(ZAEHLER_MAX)} eintragen.`, art: 'neg' };
    if (gewuenscht < minimum) return { text: `Kleiner als ${zahl(minimum)} geht nicht: Nummern werden nie wiederverwendet.`, art: 'neg' };
    if (zaehlerPruefung && 'fehler' in zaehlerPruefung) return { text: zaehlerPruefung.fehler, art: 'neg' };
    if (gewuenscht > minimum) {
      const ab = formatNummer(kreis.muster, jahr, gewuenscht);
      const luecke = gewuenscht - minimum === 1 ? `Die Nummer ${zahl(minimum)} wird` : `Die Nummern ${zahl(minimum)} bis ${zahl(gewuenscht - 1)} werden`;
      return { text: `Nächste Nummer wäre ${ab}. ${luecke} übersprungen und nie vergeben.`, art: '' };
    }
    return { text: 'Nur erhöhen möglich, nie senken.', art: '' };
  };

  const erhoehen = async () => {
    if (gewuenscht === null) return;
    setBeschaeftigt(true);
    try {
      const vergebene = await vergebeneNummern(kreis.id);
      const r = zaehlerErhoehen(kreis, gewuenscht, jahr, vergebene);
      if ('fehler' in r) {
        setZaehlerMeldung(r.fehler);
        return;
      }
      await speichereZaehler(kreis, r.stand);
      toast(`${NUMMER_NAMEN[kreis.id]}: weiter mit ${formatNummer(kreis.muster, jahr, gewuenscht)}`);
      await neuLaden();
    } catch (e) {
      setZaehlerMeldung(fehlerText(e));
    } finally {
      setBeschaeftigt(false);
    }
  };

  const hinweis = zaehlerHinweis();
  const standard = STANDARD_MUSTER[kreis.id];

  return (
    <div className="set-row nk-row" data-setting={id}>
      <div className="set-label">
        <span>{NUMMER_NAMEN[kreis.id]}</span>
        {'nummer' in vorschau ? (
          <span className="nk-next">
            nächste
            <span className="chip strong">{vorschau.nummer}</span>
          </span>
        ) : null}
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`${id}-muster`}>Muster</label>
          <input
            id={`${id}-muster`}
            className={`input mono ${musterMeldung || 'fehler' in vorschau ? 'invalid' : ''}`}
            value={muster}
            disabled={beschaeftigt}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={musterMeldung || 'fehler' in vorschau ? true : undefined}
            aria-describedby={`${id}-muster-hint`}
            onChange={(e) => {
              setMuster(e.target.value);
              setMusterMeldung(null);
            }}
            onBlur={() => void musterSpeichern(muster)}
            onKeyDown={onMusterKey}
          />
          {musterMeldung || 'fehler' in vorschau ? (
            <p className="hint neg" id={`${id}-muster-hint`} role="alert">
              {musterMeldung ?? ('fehler' in vorschau ? vorschau.fehler : '')}
            </p>
          ) : (
            <p className="hint" id={`${id}-muster-hint`}>
              {istJahresabhaengig(muster) ? 'Beginnt jedes Jahr wieder bei 1.' : 'Läuft über alle Jahre weiter.'}
              {kreis.muster !== standard ? (
                <>
                  {' '}
                  <button type="button" className="nk-std" disabled={beschaeftigt} onClick={() => void musterSpeichern(standard)}>
                    <RotateCcw />
                    Standard {standard}
                  </button>
                </>
              ) : null}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor={`${id}-zaehler`}>Nächste laufende Nummer</label>
          <div className="row">
            <input
              id={`${id}-zaehler`}
              className={`input num ${hinweis.art === 'neg' ? 'invalid' : ''}`}
              type="number"
              min={minimum ?? 1}
              max={ZAEHLER_MAX}
              step={1}
              value={zaehler}
              disabled={beschaeftigt || minimum === null}
              aria-describedby={`${id}-zaehler-hint`}
              onChange={(e) => {
                setZaehler(e.target.value);
                setZaehlerMeldung(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && kannErhoehen) void erhoehen();
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setZaehler(minimum === null ? '' : String(minimum));
                  setZaehlerMeldung(null);
                }
              }}
            />
            <button type="button" className="btn ghost" disabled={!kannErhoehen} onClick={() => void erhoehen()}>
              <ArrowUp />
              Erhöhen
            </button>
          </div>
          {hinweis.text ? (
            <p className={`hint ${hinweis.art}`} id={`${id}-zaehler-hint`} role={hinweis.art === 'neg' ? 'alert' : undefined}>
              {hinweis.text}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
