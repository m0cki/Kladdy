/* Tabellen-Entsprechung eines Diagramms (§9.6 Regel 8): Werte sind nie nur per Hover erreichbar.
 * Aufklappbar unter dem Diagramm („Werte als Tabelle“), für Screenreader eine echte Tabelle. */
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface TabellenZeile {
  schluessel: string;
  label: ReactNode;
  werte: string[];
  /** z. B. ausgewählter Monat */
  hervorheben?: boolean;
}

interface Props {
  /** Unsichtbare Überschrift der Tabelle */
  titel: string;
  kopf: string;
  spalten: string[];
  zeilen: TabellenZeile[];
}

export function ChartTabelle({ titel, kopf, spalten, zeilen }: Props) {
  return (
    <details className="chart-data">
      <summary>
        Werte als Tabelle
        <ChevronDown />
      </summary>
      <div className="table-wrap">
        <table className="fin-table">
          <caption className="sr-only">{titel}</caption>
          <thead>
            <tr>
              <th className="l" scope="col">
                {kopf}
              </th>
              {spalten.map((s) => (
                <th key={s} scope="col">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={z.schluessel} className={z.hervorheben ? 'selected' : undefined}>
                <td className="l">{z.label}</td>
                {z.werte.map((w, i) => (
                  <td key={i} className="num">
                    {w}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
