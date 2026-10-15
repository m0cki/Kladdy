/* „Was ist neu?“ zur gefundenen Version (Release-Notizen aus latest.json) mit „Jetzt aktualisieren“ bzw. nach dem
 * Installieren „Jetzt neu starten“. In der Entwicklerversion nur lesen, nie installieren. */
import { Download, RotateCw, Sparkles } from 'lucide-react';
import { installUpdate, kannInstallieren, neuStarten, useUpdates } from '../../lib/updates';
import { useUi } from '../../store/ui';
import { Drawer } from '../ui/Drawer';

const fmtDatum = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' }).format(d);
};

export function UpdateNotesDrawer() {
  const open = useUi((s) => s.drawer === 'update-notes');
  const close = useUi((s) => s.closeDrawer);
  const version = useUpdates((s) => s.version);
  const notes = useUpdates((s) => s.notes);
  const date = useUpdates((s) => s.date);
  const status = useUpdates((s) => s.status);
  const entwickler = useUpdates((s) => s.entwickler);
  const datum = date ? fmtDatum(date) : '';

  return (
    <Drawer
      open={open && Boolean(version)}
      onClose={close}
      title="Was ist neu?"
      sub={version ? `Version ${version}${datum ? ` · ${datum}` : ''}` : undefined}
      icon={Sparkles}
      width={480}
      foot={
        <>
          <button type="button" className="btn ghost" onClick={close}>
            Später
          </button>
          {status === 'ready' ? (
            <button type="button" className="btn-primary" onClick={() => void neuStarten()}>
              <RotateCw />
              Jetzt neu starten
            </button>
          ) : (
            <button type="button" className="btn-primary" disabled={!kannInstallieren(status, entwickler)} onClick={() => void installUpdate()}>
              <Download />
              Jetzt aktualisieren
            </button>
          )}
        </>
      }
    >
      <section>
        {notes ? <div className="update-notes">{notes}</div> : <p className="hint">Zu dieser Version gibt es keine Notizen.</p>}
        <p className="hint">
          {entwickler
            ? 'In der Entwicklerversion wird nicht installiert. Updates nur in der installierten Kladdy-App.'
            : status === 'ready'
              ? 'Das Update ist installiert. Die neue Version startet mit dem nächsten Neustart von Kladdy.'
              : 'Kladdy lädt das Update und installiert es, du kannst dabei weiterarbeiten. Neu gestartet wird erst, wenn du es sagst.'}
        </p>
      </section>
    </Drawer>
  );
}
