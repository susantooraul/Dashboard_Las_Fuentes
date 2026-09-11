import type { ReactNode } from 'react';

export interface DetailStatusRow {
  label: string;
  value: ReactNode;
}

interface DetailPeriodStatusProps {
  title?: string;
  subtitle?: string;
  rows: DetailStatusRow[];
}

function DetailPeriodStatus({ title = 'Estado del periodo', subtitle = 'Actividad, comunicación y validación se muestran por separado.', rows }: DetailPeriodStatusProps) {
  const visibleRows = rows.filter((row) => row.value !== null && row.value !== undefined && row.value !== '');
  if (!visibleRows.length) return null;

  return (
    <section className="panel detail-period-status fade-up">
      <div className="detail-period-status-header">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      <div className="detail-period-status-list">
        {visibleRows.map((row) => (
          <div className="detail-period-status-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export default DetailPeriodStatus;
