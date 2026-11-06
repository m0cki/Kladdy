/* Einstellungen › Darstellung (§6.10, §9.1): Modus, Farbschema (Petrol · Kladde · Pflaume · Graphit & Bernstein, jedes
 * mit eigener Palette für Hell und Dunkel), optional eine eigene Akzentfarbe, Radius, Schriftgröße, Dichte, Plus/Minus,
 * Monospace-Zahlen, Bewegung, Glas. Gespeichert in localStorage (lib/settings.ts). */
import type { CSSProperties, ReactNode } from 'react';
import { Check, Moon, RotateCcw, Sun } from 'lucide-react';
import { FARBSCHEMATA, kontrast, palette, schemaVon, type Settings } from '../../lib/settings';
import { useUi } from '../../store/ui';
import { Seg } from '../../components/ui/Seg';
import { Switch } from '../../components/ui/Switch';
import { SetCard, SetRow } from './SetRow';

type NumKey = 'radius' | 'fontScale';

const fmt = (n: number) => n.toFixed(1).replace('.', ',');

export default function Darstellung() {
  const s = useUi((st) => st.settings);
  const set = useUi((st) => st.setSetting);
  const setTheme = useUi((st) => st.setTheme);
  const reset = useUi((st) => st.resetSettings);
  const toast = useUi((st) => st.toast);
  const schema = schemaVon(s);

  const range = (key: NumKey, min: number, max: number, label: string, step = 1) => (
    <input type="range" min={min} max={max} step={step} value={s[key]} aria-label={label} onChange={(e) => set(key, Number(e.target.value))} />
  );
  const seg = <K extends 'mode' | 'density' | 'posneg' | 'numFont' | 'motion'>(
    key: K,
    options: readonly { value: Settings[K]; label: ReactNode }[],
    ariaLabel: string,
  ) => <Seg options={options} value={s[key]} onChange={(v) => set(key, v)} ariaLabel={ariaLabel} />;

  const eigen = s.akzent != null;
  const hell = palette(s, 'light').akzent;
  const aufWeiss = kontrast(hell, '#ffffff');

  return (
    <>
      <SetCard title="Farbe und Modus" i={1}>
        <SetRow id="modus" label="Modus">
          {seg(
            'mode',
            [
              { value: 'light', label: (<><Sun />Hell</>) },
              { value: 'dark', label: (<><Moon />Dunkel</>) },
              { value: 'system', label: 'Wie der Mac' },
            ],
            'Modus',
          )}
        </SetRow>
        <div className="set-row" data-setting="farbschema">
          <div className="set-label">
            <span>Farbschema</span>
          </div>
          <div className="schemata" role="radiogroup" aria-label="Farbschema">
            {FARBSCHEMATA.map((th) => {
              const aktiv = s.theme === th.id;
              return (
                <button
                  key={th.id}
                  type="button"
                  role="radio"
                  aria-checked={aktiv}
                  className={`schema-sw ${aktiv ? 'active' : ''}`}
                  onClick={() => setTheme(th.id)}
                  style={
                    {
                      '--sw-ah': th.hell.akzent,
                      '--sw-ad': th.dunkel.akzent,
                      '--sw-hh': th.hell.tintH,
                      '--sw-sh': `${th.hell.tintS}%`,
                      '--sw-hd': th.dunkel.tintH,
                      '--sw-sd': `${th.dunkel.tintS}%`,
                    } as CSSProperties
                  }
                >
                  <span className="sw-prev" aria-hidden="true">
                    <span className="sw-hell"><i /><b /><b /></span>
                    <span className="sw-dunkel"><i /><b /><b /></span>
                  </span>
                  <span className="sw-text">
                    <span className="sw-name">
                      {th.name}
                      {th.id === 'petrol' ? <small className="muted"> · Standard</small> : null}
                    </span>
                    <small className="muted">{th.beschreibung}</small>
                  </span>
                  {aktiv ? <Check className="sw-check" aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </div>
        <SetRow id="akzentfarbe" label="Eigene Akzentfarbe" value={eigen ? (s.akzent ?? '').toUpperCase() : undefined}>
          <div className="toggle-row">
            <span>Statt der Farbe des Schemas eine eigene verwenden (z. B. deine Firmenfarbe)</span>
            <Switch
              checked={eigen}
              onChange={(v) => set('akzent', v ? schema.hell.akzent : null)}
              label="Eigene Akzentfarbe"
            />
          </div>
          {eigen ? (
            <div className="color-row">
              <input type="color" value={s.akzent ?? schema.hell.akzent} aria-label="Akzentfarbe wählen" onChange={(e) => set('akzent', e.target.value.toLowerCase())} />
              <code>{(s.akzent ?? '').toUpperCase()}</code>
              <span className={aufWeiss < 3 ? 'neg' : 'muted'}>
                {aufWeiss < 3
                  ? `Kontrast auf Weiß nur ${fmt(aufWeiss)}:1 – Schrift in Akzentfarbe wird automatisch dunkler gesetzt.`
                  : `Kontrast auf Weiß ${fmt(aufWeiss)}:1 · im Dunkelmodus automatisch aufgehellt`}
              </span>
            </div>
          ) : null}
          <p className="hint">Die Akzentfarbe erscheint auch auf deinen Belegen (z. B. im Titel einer Quittung).</p>
        </SetRow>
      </SetCard>

      <SetCard title="Feinabstimmung" i={2}>
        <SetRow id="radius" label="Eckenrundung" value={s.radius === 0 ? "eckig" : `${s.radius} px`}>
          {range('radius', 0, 24, 'Eckenrundung')}
        </SetRow>
        <SetRow id="schriftgroesse" label="Schriftgröße" value={`${s.fontScale} %`}>
          {range('fontScale', 85, 120, 'Schriftgröße', 5)}
        </SetRow>
        <SetRow id="dichte" label="Dichte">
          {seg(
            'density',
            [
              { value: 'compact', label: 'Kompakt' },
              { value: 'normal', label: 'Normal' },
              { value: 'cozy', label: 'Luftig' },
            ],
            'Dichte',
          )}
        </SetRow>
        <SetRow id="plusminus" label="Plus/Minus-Farben">
          {seg(
            'posneg',
            [
              { value: 'greenred', label: (<><i className="pn" data-pn="greenred" />Grün/Rot</>) },
              { value: 'blueorange', label: (<><i className="pn" data-pn="blueorange" />Blau/Orange</>) },
              { value: 'tealpink', label: (<><i className="pn" data-pn="tealpink" />Türkis/Pink</>) },
            ],
            'Plus/Minus-Farben',
          )}
        </SetRow>
        <SetRow id="zahlen" label="Zahlen">
          {seg(
            'numFont',
            [
              { value: 'sans', label: 'Proportional' },
              { value: 'mono', label: 'Monospace' },
            ],
            'Zahlen',
          )}
        </SetRow>
      </SetCard>

      <SetCard title="Bewegung & Effekte" i={3}>
        <SetRow id="animationen" label="Animationen">
          {seg(
            'motion',
            [
              { value: 'full', label: 'Voll' },
              { value: 'reduced', label: 'Reduziert' },
              { value: 'off', label: 'Aus' },
            ],
            'Animationen',
          )}
        </SetRow>
        <div className="toggle-row" data-setting="glas">
          <span>Glas-Effekt in der Kopfzeile</span>
          <Switch checked={s.glass} onChange={(v) => set('glass', v)} label="Glas-Effekt" />
        </div>
        <div className="row wrap" data-setting="darstellung-zuruecksetzen">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              reset();
              toast('Darstellung zurückgesetzt (Petrol, wie der Mac)');
            }}
          >
            <RotateCcw />
            Darstellung zurücksetzen
          </button>
        </div>
      </SetCard>
    </>
  );
}
