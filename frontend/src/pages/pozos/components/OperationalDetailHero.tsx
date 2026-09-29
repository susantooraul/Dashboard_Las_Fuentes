import { Link, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ArrowLeft, Activity } from 'lucide-react';
import StatusBadge from './StatusBadge';

export interface DetailHeroMetric {
  label: string;
  value: ReactNode;
  unit?: string;
  context?: boolean;
  wide?: boolean;
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
      <div className="operational-detail-toolbar">
        <Link to={target} className="detail-back-link" aria-label={`Volver a ${typeLabel}`}>
          <ArrowLeft size={16} aria-hidden="true" /> Volver
        </Link>
        <span className="operational-detail-breadcrumb">{typeLabel} / {title}</span>
        {children}
      </div>
      <div className="operational-detail-main">
        <div className="operational-detail-icon" aria-hidden="true"><Activity size={23} /></div>
        <div className="operational-detail-title-block">
          <span className="section-eyebrow">{typeLabel}</span>
          <div className="operational-detail-title-row">
            <h2>{title}</h2>
            {status ? <StatusBadge type={statusType || 'normal'}>{status}</StatusBadge> : null}
          </div>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      <div className="operational-detail-kpis" aria-label="Indicadores principales">
        {metrics.filter((metric) => !metric.context).map((metric) => (
          <div className="operational-detail-kpi" key={metric.label}>
            <span>{metric.label}</span>
            <div className="operational-detail-value">{metric.value}{metric.unit ? <small> {metric.unit}</small> : null}</div>
          </div>
        ))}
      </div>
      {metrics.some((metric) => metric.context) ? (
        <div className="operational-detail-context">
          {metrics.filter((metric) => metric.context).map((metric) => (
            <div className={`operational-detail-context-item${metric.wide ? ' is-wide' : ''}`} key={metric.label}>
              <span className="operational-detail-context-label">{metric.label}</span>
              <div className="operational-detail-context-value">{metric.value}{metric.unit ? <small> {metric.unit}</small> : null}</div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export default OperationalDetailHero;
