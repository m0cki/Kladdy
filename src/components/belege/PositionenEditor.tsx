/* Positionen der Beleg-Maske (§6.6 „Positionen mit Ziehen zum Umsortieren“, Prototyp posEditorHTML): Beschreibung,
 * Menge × Einheit × Einzelpreis = Betrag je Zeile, darunter der Gesamtbetrag. Umsortieren über den Griff per Zeiger
 * (kein HTML5-Drag-and-drop: die Mac-App fängt Drops am Fenster für Belege ab) oder mit ↑/↓ auf dem Griff.
 * Bekannte Positionstexte übernehmen Einheit und Preis, solange noch keiner eingetragen ist. */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { formatBetrag, parseBetrag } from '../../lib/money';
import { EINHEITEN, leerePosition, parseMenge, preisEingabe, type PositionFormular } from '../../lib/rechnungen';
import { positionBetrag } from '../../lib/vorlagen/dokument';

export interface PositionsVorschlag {
  beschreibung: string;
  einheit: string | null;
  einzelpreis_cent: number;
}

interface Props {
  positionen: PositionFormular[];
  onChange: (p: PositionFormular[]) => void;
  vorschlaege: readonly PositionsVorschlag[];
  /** gesperrt (ausgestellt) */
  nurLesen?: boolean;
  summe: number;
  /** Unterzeile der Summe, z. B. „umsatzsteuerfrei nach § 19 UStG“ */
  summeHinweis?: string;
}

/** Betrag einer Zeile; leere Felder zählen 0, unlesbare ⇒ null („–“). */
const zeilenBetrag = (p: PositionFormular): number | null => {
  const menge = p.menge.trim() ? parseMenge(p.menge) : 0;
  const preis = p.preis.trim() ? parseBetrag(p.preis) : 0;
  if (menge === null || preis === null) return null;
  try {
    return positionBetrag({ menge, einzelpreis_cent: preis });
  } catch {
    return null;
  }
};

export function PositionenEditor({ positionen, onChange, vorschlaege, nurLesen = false, summe, summeHinweis }: Props) {
  const liste = useRef<HTMLDivElement>(null);
  const [ziehen, setZiehen] = useState<{ von: number; nach: number } | null>(null);

  const setzen = (i: number, teil: Partial<PositionFormular>) => onChange(positionen.map((p, j) => (j === i ? { ...p, ...teil } : p)));
  const verschieben = (von: number, nach: number) => {
    if (von === nach || nach < 0 || nach >= positionen.length) return;
    const neu = [...positionen];
    const [x] = neu.splice(von, 1);
    neu.splice(nach, 0, x);
    onChange(neu);
  };

  /* Ziehen am Griff: Zielzeile = die, über deren Mitte der Zeiger steht */
  const ziel = (y: number): number => {
    const zeilen = [...(liste.current?.querySelectorAll<HTMLElement>('.bl-pos') ?? [])];
    let nach = zeilen.length - 1;
    for (let i = 0; i < zeilen.length; i++) {
      const r = zeilen[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        nach = i;
        break;
      }
    }
    return nach;
  };
  const start = (e: PointerEvent<HTMLButtonElement>, i: number) => {
    if (nurLesen || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setZiehen({ von: i, nach: i });
  };
  const bewegen = (e: PointerEvent<HTMLButtonElement>) => {
    if (!ziehen) return;
    const nach = ziel(e.clientY);
    if (nach !== ziehen.nach) setZiehen({ ...ziehen, nach });
  };
  const ende = () => {
    if (ziehen) verschieben(ziehen.von, ziehen.nach);
    setZiehen(null);
  };
  const tasten = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const j = i + (e.key === 'ArrowUp' ? -1 : 1);
    verschieben(i, j);
    requestAnimationFrame(() => liste.current?.querySelectorAll<HTMLButtonElement>('.bl-pos-grip')[j]?.focus());
  };

  const textGewaehlt = (i: number) => {
    const p = positionen[i];
    if (p.preis.trim()) return;
    const v = vorschlaege.find((x) => x.beschreibung === p.beschreibung);
    if (v) setzen(i, { einheit: v.einheit ?? p.einheit, preis: preisEingabe(v.einzelpreis_cent) });
  };

  return (
    <div className="bl-pos-ed">
      <div className="bl-pos-list" ref={liste}>
        {positionen.map((p, i) => {
          const betrag = zeilenBetrag(p);
          const klasse = ziehen?.von === i ? 'dragging' : ziehen && ziehen.nach === i && ziehen.von !== i ? (ziehen.von < i ? 'drop-after' : 'drop-before') : '';
          return (
            <div key={i} className={`bl-pos ${klasse}`}>
              <button
                type="button"
                className="bl-pos-grip"
                title="Ziehen zum Sortieren (oder ↑ / ↓)"
                aria-label={`Position ${i + 1} verschieben`}
                disabled={nurLesen}
                onPointerDown={(e) => start(e, i)}
                onPointerMove={bewegen}
                onPointerUp={ende}
                onPointerCancel={() => setZiehen(null)}
                onKeyDown={(e) => tasten(e, i)}
              >
                <span>{i + 1}</span>
                <GripVertical />
              </button>
              <input
                className="input sm bl-pos-text"
                list="bl-postexte"
                value={p.beschreibung}
                placeholder="Beschreibung der Leistung"
                aria-label={`Position ${i + 1}: Beschreibung`}
                readOnly={nurLesen}
                onChange={(e) => setzen(i, { beschreibung: e.target.value })}
                onBlur={() => textGewaehlt(i)}
              />
              <button
                type="button"
                className="icon-btn sm bl-pos-del"
                title="Position entfernen"
                aria-label={`Position ${i + 1} entfernen`}
                disabled={nurLesen}
                onClick={() => onChange(positionen.length > 1 ? positionen.filter((_, j) => j !== i) : [leerePosition(p.einheit)])}
              >
                <Trash2 />
              </button>
              <div className="bl-pos-line2">
                <input
                  className={`input sm num ${p.menge.trim() && parseMenge(p.menge) === null ? 'invalid' : ''}`}
                  inputMode="decimal"
                  value={p.menge}
                  aria-label={`Position ${i + 1}: Menge`}
                  readOnly={nurLesen}
                  onChange={(e) => setzen(i, { menge: e.target.value })}
                />
                <input
                  className="input sm"
                  list="bl-einheiten"
                  value={p.einheit}
                  placeholder="Einheit"
                  aria-label={`Position ${i + 1}: Einheit`}
                  readOnly={nurLesen}
                  onChange={(e) => setzen(i, { einheit: e.target.value })}
                />
                <span className="bl-pos-op">×</span>
                <div className="input-wrap">
                  <input
                    className={`input sm money ${p.preis.trim() && parseBetrag(p.preis) === null ? 'invalid' : ''}`}
                    inputMode="decimal"
                    value={p.preis}
                    placeholder="0,00"
                    aria-label={`Position ${i + 1}: Einzelpreis`}
                    readOnly={nurLesen}
                    onChange={(e) => setzen(i, { preis: e.target.value })}
                    onBlur={(e) => {
                      const c = parseBetrag(e.target.value);
                      if (c !== null) setzen(i, { preis: preisEingabe(c) });
                    }}
                  />
                  <span className="suffix">€</span>
                </div>
                <span className="bl-pos-op">=</span>
                <b className="bl-pos-sum num">{betrag === null ? '–' : formatBetrag(betrag)}</b>
              </div>
            </div>
          );
        })}
      </div>
      {nurLesen ? null : (
        <button
          type="button"
          className="btn ghost bl-pos-add"
          onClick={() => {
            onChange([...positionen, leerePosition(positionen[positionen.length - 1]?.einheit || 'Stk.')]);
            requestAnimationFrame(() => {
              const t = liste.current?.querySelectorAll<HTMLInputElement>('.bl-pos-text');
              t?.[t.length - 1]?.focus();
            });
          }}
        >
          <Plus />
          Position hinzufügen
        </button>
      )}
      <div className="bl-pos-total">
        <span>
          Gesamtbetrag
          {summeHinweis ? <small>{summeHinweis}</small> : null}
        </span>
        <b className="num">{formatBetrag(summe)}</b>
      </div>
      <datalist id="bl-einheiten">
        {EINHEITEN.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <datalist id="bl-postexte">
        {vorschlaege.map((v) => (
          <option key={v.beschreibung} value={v.beschreibung} />
        ))}
      </datalist>
    </div>
  );
}
