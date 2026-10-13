/* Seitenkopf (§9.3): Titel mit Icon, Untertitel, rechts höchstens eine Hauptaktion (.btn-primary.head-add). */
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, type LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  title: string;
  sub?: string;
  back?: { to: string; label: string };
  actions?: ReactNode;
  className?: string;
}

export const reveal = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties;

export function PageHead({ icon: Icon, title, sub, back, actions, className = '' }: Props) {
  return (
    <div className={`page-head reveal ${className}`} style={reveal(0)}>
      <div>
        {back ? (
          <Link className="bl-back" to={back.to}>
            <ChevronLeft />
            {back.label}
          </Link>
        ) : null}
        <h1>
          <Icon />
          {title}
        </h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
