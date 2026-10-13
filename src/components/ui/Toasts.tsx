/* Toasts (invertiert, unten mittig, §9.4). Optional mit Aktionen, Fortschrittsbalken und „bleibt stehen“ (sticky). */
import { useEffect, useState, type CSSProperties } from 'react';
import { Check, Download, Info, TriangleAlert, X } from 'lucide-react';
import { useUi, type Toast } from '../../store/ui';

const SHOW_MS = 3200;
const ICONS = { check: Check, info: Info, warn: TriangleAlert, download: Download } as const;

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUi((s) => s.dismissToast);
  const [out, setOut] = useState(false);
  const sticky = Boolean(toast.sticky);
  const ms = toast.actions?.length ? SHOW_MS * 2 : SHOW_MS;

  useEffect(() => {
    setOut(false);
    if (sticky) return;
    const a = setTimeout(() => setOut(true), ms);
    const b = setTimeout(() => dismiss(toast.id), ms + 400);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [toast.id, toast.text, sticky, ms, dismiss]);

  const Icon = ICONS[toast.icon ?? 'check'];
  const hasProgress = toast.progress !== undefined;
  return (
    <div className={`toast ${out ? 'out' : ''} ${hasProgress ? 'has-prog' : ''}`} role="status" data-icon={toast.icon ?? 'check'}>
      <Icon />
      <span>{toast.text}</span>
      {toast.actions?.map((a) => (
        <button key={a.label} type="button" onClick={a.run}>
          {a.label}
        </button>
      ))}
      {sticky && !hasProgress ? (
        <button type="button" className="toast-x" onClick={() => dismiss(toast.id)} title="Schließen" aria-label="Schließen">
          <X />
        </button>
      ) : null}
      {hasProgress ? (
        <span
          className={`toast-prog ${toast.progress === null ? 'indet' : ''}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={toast.progress === null ? undefined : Math.round((toast.progress ?? 0) * 100)}
        >
          <i style={{ '--p': toast.progress ?? 0 } as CSSProperties} />
        </span>
      ) : null}
    </div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
