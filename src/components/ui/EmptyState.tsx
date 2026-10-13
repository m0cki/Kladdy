/* Leerer Zustand (§9.4) */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}

export function EmptyState({ icon: Icon, title, children }: Props) {
  return (
    <div className="empty">
      <Icon />
      <b>{title}</b>
      {children ? <span>{children}</span> : null}
    </div>
  );
}
