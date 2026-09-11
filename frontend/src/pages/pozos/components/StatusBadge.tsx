import type { ReactNode } from 'react';

interface StatusBadgeProps {
  type?: string;
  children: ReactNode;
}

function StatusBadge({ type, children }: StatusBadgeProps) {
  return <span className={`status-pill ${type || 'normal'} resumen-status-pill`}>{children}</span>;
}

export default StatusBadge;
