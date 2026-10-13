/* Einstellungen › Updates & Über Kladdy (§6.10 „Über Kladdy“, §3.2). Auch über das macOS-Menü „Kladdy → Über Kladdy“. */
import { useEffect, useState } from 'react';
import { Download, Info, LoaderCircle, Lock, RefreshCw, Sparkles } from 'lucide-react';
import { inTauri } from '../../lib/menu';
import { appVersion, checkForUpdate, installUpdate, useUpdates } from '../../lib/updates';
import { useUi } from '../../store/ui';
import { Logo } from '../../components/ui/Logo';
import { Switch } from '../../components/ui/Switch';
import { SetCard } from './SetRow';

const fmtZeit = (iso: string) =>
  new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

export default function UpdatesUeber() {
  const [version, setVersion] = useState<string>('');
  const auto = useUpdates((s) => s.auto);
  const setAuto = useUpdates((s) => s.setAuto);
  const lastCheck = useUpdates((s) => s.lastCheck);
  const status = useUpdates((s) => s.status);
  const neu = useUpdates((s) => s.version);
  const openDrawer = useUi((s) => s.openDrawer);
  const nativ = inTauri();

  useEffect(() => {
    let aktiv = true;
    void appVersion().then((v) => aktiv && setVersion(v));
    return () => {
      aktiv = false;
    };
  }, []);

  const sucht = status === 'checking';
  const laedt = status === 'downloading' || status === 'restarting';

  return (
    <>
      <SetCard title="Über Kladdy" i={1}>
        <p className="set-version" data-setting="version">
          <Logo />
          <span>
            <b>Kladdy</b>
            <small>Version {version || '…'} · Buchhaltung für das Kleingewerbe</small>
          </span>
        </p>
      </SetCard>

      <SetCard title="Updates" i={2}>
        <div className="toggle-row" data-setting="auto-updates">
          <span>
            Automatisch nach Updates suchen
            <small>Beim Start, höchstens einmal am Tag</small>
          </span>
          <Switch checked={auto} onChange={setAuto} label="Automatisch nach Updates suchen" />
        </div>
        <div className="set-row" data-setting="nach-updates-suchen">
          <div className="row wrap">
            <button type="button" className="btn subtle" disabled={sucht || laedt} onClick={() => void checkForUpdate({ manual: true })}>
              {sucht ? <LoaderCircle className="ic spin" /> : <RefreshCw />}
              {sucht ? 'Suche …' : 'Nach Updates suchen …'}
            </button>
            {status === 'available' && neu ? (
              <>
                <button type="button" className="btn ghost" onClick={() => openDrawer('update-notes')}>
                  <Sparkles />
                  Was ist neu?
                </button>
                <button type="button" className="btn-primary sm" onClick={() => void installUpdate()}>
                  <Download />
                  Version {neu} installieren
                </button>
              </>
            ) : null}
          </div>
          <p className="hint">
            {!nativ
              ? 'Die Update-Prüfung gibt es nur in der Mac-App.'
              : laedt
                ? 'Update wird geladen …'
                : lastCheck
                  ? `Zuletzt geprüft: ${fmtZeit(lastCheck)}`
                  : 'Noch nie nach Updates gesucht.'}
          </p>
        </div>
      </SetCard>

      <SetCard title="Hinweise" i={3}>
        <div className="set-note" data-setting="haftung">
          <Info />
          <span>
            <b>Keine Steuerberatung.</b> Kladdy hilft dir, alles festzuhalten und auszuwerten. Berechnungen, Hinweise und
            Exporte sind ohne Gewähr – im Zweifel Steuerberatung oder Finanzamt fragen.
          </span>
        </div>
        <div className="set-note" data-setting="datenschutz">
          <Lock />
          <span>
            <b>Deine Daten bleiben auf diesem Mac.</b> Kein Konto, keine Cloud, kein Tracking. Ins Internet geht die App
            nur für die Update-Prüfung (eine Versionsdatei bei GitHub) und einmalig für den PDF-Satz.
          </span>
        </div>
      </SetCard>
    </>
  );
}
