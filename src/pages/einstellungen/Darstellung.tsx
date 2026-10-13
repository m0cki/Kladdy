/* Einstellungen › Darstellung (§6.10, §9.1): Modus, Themes, Akzent, Farbton, Radius, Schriftgröße, Dichte,
 * Plus/Minus, Monospace-Zahlen, Bewegung, Glas, Aurora. Gespeichert in localStorage (lib/settings.ts). */
import type { CSSProperties, ReactNode } from 'react';
import { Moon, RotateCcw, Sun } from 'lucide-react';
import { THEMES, type Settings } from '../../lib/settings';
import { useUi } from '../../store/ui';
import { Seg } from '../../components/ui/Seg';
import { Switch } from '../../components/ui/Switch';
import { SetCard, SetRow } from './SetRow';

type NumKey = 'tintH' | 'tintS' | 'radius' | 'fontScale';

export default function Darstellung() {
  const s = useUi((st) => st.settings);
  const set = useUi((st) => st.setSetting);
  const setTheme = useUi((st) => st.setTheme);
  const reset = useUi((st) => st.resetSettings);
  const toast = useUi((st) => st.toast);

  const range = (key: NumKey, min: number, max: number, label: string, step = 1) => (
    <input
      type="range"
      className={key === 'tintH' ? 'hue' : undefined}
      min={min}
      max={max}
      step={step}
      value={s[key]}
      aria-label={label}
      onChange={(e) => set(key, Number(e.target.value))}
    />
  );
  const seg = <K extends 'mode' | 'density' | 'posneg' | 'numFont' | 'motion'>(
    key: K,
    options: readonly { value: Settings[K]; label: ReactNode }[],
    ariaLabel: string,
  ) => <Seg options={options} value={s[key]} onChange={(v) => set(key, v)} ariaLabel={ariaLabel} />;

  return (
    <>
      <SetCard title="Darstellung" i={1}>
        <SetRow id="modus" label="Modus">
          {seg(
            'mode',
            [
              { value: 'light', label: (<><Sun />Hell</>) },
              { value: 'dark', label: (<><Moon />Dunkel</>) },
              { value: 'system', label: 'System' },
            ],
            'Modus',
          )}
        </SetRow>
        <div className="set-row" data-setting="farbthema">
          <div className="set-label">
            <span>Farbthema</span>
            {s.theme === 'custom' ? <span className="badge accent">Eigenes Theme</span> : null}
          </div>
          <div className="themes">
            {THEMES.map((th) => (
              <button
                key={th.id}
                type="button"
                className={`theme-sw ${s.theme === th.id ? 'active' : ''}`}
                aria-pressed={s.theme === th.id}
                onClick={() => setTheme(th.id)}
                style={{ '--sw-a': th.accent, '--sw-h': th.tintH, '--sw-s': `${th.tintS}%` } as CSSProperties}
              >
                <span className="sw-prev">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="sw-name">{th.name}</span>
              </button>
            ))}
          </div>
        </div>
      </SetCard>

      <SetCard title="Feinabstimmung" i={2}>
        <SetRow id="akzentfarbe" label="Akzentfarbe">
          <div className="color-row">
            <input type="color" value={s.accent} aria-label="Akzentfarbe" onChange={(e) => set('accent', e.target.value.toLowerCase())} />
            <code>{s.accent.toUpperCase()}</code>
          </div>
        </SetRow>
        <SetRow id="farbton" label="Farbton Hintergrund" value={`${s.tintH}°`}>
          {range('tintH', 0, 360, 'Farbton Hintergrund')}
        </SetRow>
        <SetRow id="saettigung" label="Sättigung Hintergrund" value={`${s.tintS}%`}>
          {range('tintS', 0, 40, 'Sättigung Hintergrund')}
        </SetRow>
        <SetRow id="radius" label="Eckenrundung" value={`${s.radius}px`}>
          {range('radius', 0, 24, 'Eckenrundung')}
        </SetRow>
        <SetRow id="schriftgroesse" label="Schriftgröße" value={`${s.fontScale}%`}>
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
          <span>Glas-Effekt</span>
          <Switch checked={s.glass} onChange={(v) => set('glass', v)} label="Glas-Effekt" />
        </div>
        <div className="toggle-row" data-setting="aurora">
          <span>Farbverlauf im Hintergrund</span>
          <Switch checked={s.aurora} onChange={(v) => set('aurora', v)} label="Farbverlauf im Hintergrund" />
        </div>
        <div className="row wrap" data-setting="darstellung-zuruecksetzen">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              reset();
              toast('Darstellung zurückgesetzt');
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
