/* Einstellungs-Schublade (§6.10). Phase 0: nur „Darstellung“ – Modus, Themes, Akzent, Farbton, Radius,
 * Schriftgröße, Dichte, Plus/Minus, Monospace-Zahlen, Bewegung, Glas, Aurora. Gespeichert in localStorage. */
import type { CSSProperties, ReactNode } from 'react';
import { Moon, RotateCcw, Settings as SettingsIcon, Sun } from 'lucide-react';
import { THEMES, type Settings } from '../../lib/settings';
import { useUi } from '../../store/ui';
import { Drawer } from '../ui/Drawer';
import { Seg } from '../ui/Seg';
import { Switch } from '../ui/Switch';

function Row({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        {value ? <output>{value}</output> : null}
      </div>
      {children}
    </div>
  );
}

type NumKey = 'tintH' | 'tintS' | 'radius' | 'fontScale';

export function SettingsDrawer() {
  const open = useUi((s) => s.drawer === 'settings');
  const close = useUi((s) => s.closeDrawer);
  const s = useUi((st) => st.settings);
  const set = useUi((st) => st.setSetting);
  const setTheme = useUi((st) => st.setTheme);
  const reset = useUi((st) => st.resetSettings);
  const toast = useUi((st) => st.toast);

  const range = (key: NumKey, min: number, max: number, step = 1) => (
    <input
      type="range"
      className={key === 'tintH' ? 'hue' : undefined}
      min={min}
      max={max}
      step={step}
      value={s[key]}
      onChange={(e) => set(key, Number(e.target.value))}
    />
  );
  const seg = <K extends 'mode' | 'density' | 'posneg' | 'numFont' | 'motion'>(
    key: K,
    options: readonly { value: Settings[K]; label: ReactNode }[],
    ariaLabel: string,
  ) => <Seg options={options} value={s[key]} onChange={(v) => set(key, v)} ariaLabel={ariaLabel} />;

  return (
    <Drawer open={open} onClose={close} title="Einstellungen" icon={SettingsIcon} width={440}>
      <section>
        <h3>Darstellung</h3>
        <Row label="Modus">
          {seg(
            'mode',
            [
              { value: 'light', label: (<><Sun />Hell</>) },
              { value: 'dark', label: (<><Moon />Dunkel</>) },
              { value: 'system', label: 'System' },
            ],
            'Modus',
          )}
        </Row>
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
      </section>

      <section>
        <h3>Feinabstimmung</h3>
        <Row label="Akzentfarbe">
          <div className="color-row">
            <input type="color" value={s.accent} aria-label="Akzentfarbe" onChange={(e) => set('accent', e.target.value.toLowerCase())} />
            <code>{s.accent.toUpperCase()}</code>
          </div>
        </Row>
        <Row label="Farbton Hintergrund" value={`${s.tintH}°`}>
          {range('tintH', 0, 360)}
        </Row>
        <Row label="Sättigung Hintergrund" value={`${s.tintS}%`}>
          {range('tintS', 0, 40)}
        </Row>
        <Row label="Eckenrundung" value={`${s.radius}px`}>
          {range('radius', 0, 24)}
        </Row>
        <Row label="Schriftgröße" value={`${s.fontScale}%`}>
          {range('fontScale', 85, 120, 5)}
        </Row>
        <Row label="Dichte">
          {seg(
            'density',
            [
              { value: 'compact', label: 'Kompakt' },
              { value: 'normal', label: 'Normal' },
              { value: 'cozy', label: 'Luftig' },
            ],
            'Dichte',
          )}
        </Row>
        <Row label="Plus/Minus-Farben">
          {seg(
            'posneg',
            [
              { value: 'greenred', label: (<><i className="pn" data-pn="greenred" />Grün/Rot</>) },
              { value: 'blueorange', label: (<><i className="pn" data-pn="blueorange" />Blau/Orange</>) },
              { value: 'tealpink', label: (<><i className="pn" data-pn="tealpink" />Türkis/Pink</>) },
            ],
            'Plus/Minus-Farben',
          )}
        </Row>
        <Row label="Zahlen">
          {seg(
            'numFont',
            [
              { value: 'sans', label: 'Proportional' },
              { value: 'mono', label: 'Monospace' },
            ],
            'Zahlen',
          )}
        </Row>
      </section>

      <section>
        <h3>Bewegung &amp; Effekte</h3>
        <Row label="Animationen">
          {seg(
            'motion',
            [
              { value: 'full', label: 'Voll' },
              { value: 'reduced', label: 'Reduziert' },
              { value: 'off', label: 'Aus' },
            ],
            'Animationen',
          )}
        </Row>
        <div className="toggle-row">
          <span>Glas-Effekt</span>
          <Switch checked={s.glass} onChange={(v) => set('glass', v)} label="Glas-Effekt" />
        </div>
        <div className="toggle-row">
          <span>Farbverlauf im Hintergrund</span>
          <Switch checked={s.aurora} onChange={(v) => set('aurora', v)} label="Farbverlauf im Hintergrund" />
        </div>
        <div className="row wrap">
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
      </section>
    </Drawer>
  );
}
