/* „Was ist neu?“ zur gefundenen Version (Release-Notizen aus latest.json) mit „Jetzt aktualisieren“. */
import { Download, Sparkles } from 'lucide-react';
import { installUpdate, useUpdates } from '../../lib/updates';
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
          <button type="button" className="btn-primary" disabled={status !== 'available'} onClick={() => void installUpdate()}>
            <Download />
            Jetzt aktualisieren
          </button>
        </>
      }
    >
      <section>
        {notes ? <div className="update-notes">{notes}</div> : <p className="hint">Zu dieser Version gibt es keine Notizen.</p>}
        <p className="hint">Kladdy lädt das Update, installiert es und startet danach neu.</p>
      </section>
    </Drawer>
  );
}
