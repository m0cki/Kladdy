/* Schublade von rechts (§9.4): gleitet herein (.45 s), Hintergrund abgedunkelt + leicht unscharf, Esc schließt. */
import { useEffect, useState, type ReactNode } from 'react';
import { X, type LucideIcon } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  icon: LucideIcon;
  width?: number;
  children: ReactNode;
  foot?: ReactNode;
  /** Zusatzklasse am .drawer (seitenspezifische Styles) */
  className?: string;
}

const CLOSE_MS = 450;

export function Drawer({ open, onClose, title, sub, icon: Icon, width = 440, children, foot, className }: Props) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <div className={`overlay ${shown ? 'open' : ''}`}>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className={className ? `drawer ${className}` : 'drawer'} role="dialog" aria-modal="true" aria-label={title} style={{ ['--drawer-w' as string]: `${width}px` }}>
        <header className="drawer-head">
          <h2>
            <Icon />
            <span>
              {title}
              {sub ? <small>{sub}</small> : null}
            </span>
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} title="Schließen (Esc)" aria-label="Schließen">
            <X />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {foot ? <footer className="drawer-foot">{foot}</footer> : null}
      </aside>
    </div>
  );
}
