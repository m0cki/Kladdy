/* Toasts (invertiert, unten mittig, §9.4) */
import { useEffect, useState } from 'react';
import { Check, Info } from 'lucide-react';
import { useUi, type Toast } from '../../store/ui';

const SHOW_MS = 3200;

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUi((s) => s.dismissToast);
  const [out, setOut] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setOut(true), SHOW_MS);
    const b = setTimeout(() => dismiss(toast.id), SHOW_MS + 400);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [toast.id, dismiss]);
  return (
    <div className={`toast ${out ? 'out' : ''}`} role="status">
      {toast.icon === 'info' ? <Info /> : <Check />}
      <span>{toast.text}</span>
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
