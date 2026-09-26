import { Link, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import StatusBadge from './StatusBadge';

export interface DetailHeroMetric {
  label: string;
  value: ReactNode;
  unit?: string;
}

interface OperationalDetailHeroProps {
  backTo: string;
  typeLabel: string;
  title: string;
  status?: ReactNode;
  statusType?: string;
  description?: string;
  metrics: DetailHeroMetric[];
  children?: ReactNode;
}

function OperationalDetailHero({ backTo, typeLabel, title, status, statusType, description, metrics, children }: OperationalDetailHeroProps) {
  const location = useLocation();
  const target = `${backTo}${location.search || ''}`;

  return (
    <section className="panel operational-detail-hero fade-up">
      <div className="operational-detail-back-row">
        <Link to={target} className="detail-back-link" aria-label={`Volver a ${typeLabel}`}>
          ← Volver
        </Link>
      </div>
      <div className="operational-detail-main">
        {children}
        <div className="operational-detail-title-block">
          <span className="section-eyebrow">Detalle operativo</span>
          <div className="operational-detail-title-row">
            <h2>{title}</h2>
            {status ? <StatusBadge type={statusType || 'normal'}>{status}</StatusBadge> : null}
          </div>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      <div className="operational-detail-kpis" aria-label="Indicadores principales">
        {metrics.map((metric) => (
          <div className="operational-detail-kpi" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}{metric.unit ? <small> {metric.unit}</small> : null}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export default OperationalDetailHero;
