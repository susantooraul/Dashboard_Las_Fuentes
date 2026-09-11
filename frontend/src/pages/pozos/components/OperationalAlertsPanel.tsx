import { Link } from 'react-router-dom';
import PanelHeader from './PanelHeader';
import { useOperationalAlerts } from './WaterOperationalAlertsProvider';

interface OperationalAlertsPanelProps {
  title?: string;
  subtitle?: string;
}

function severityLabel(severity: string): string {
  if (severity === 'critical') return 'Crítica';
  if (severity === 'warning') return 'Atención';
  return 'Info';
}

function OperationalAlertsPanel({ title = 'Alertas y prioridades', subtitle = 'Condiciones operativas actuales evaluadas desde datos reales.' }: OperationalAlertsPanelProps) {
  const { alerts, loading, error } = useOperationalAlerts();

  return (
    <section className="panel fade-up operational-alerts-panel">
      <PanelHeader title={title} subtitle={loading ? `${subtitle} · actualizando...` : subtitle} />
      {error ? <p className="operational-alerts-note">No se pudo actualizar el estado de alertas. Se conserva la última información válida cuando existe.</p> : null}
      {!alerts.length ? (
        <div className="operational-alert-empty">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Sin alertas operativas activas</strong>
            <p>No se detectan condiciones actuales que requieran atención.</p>
          </div>
        </div>
      ) : (
        <div className="operational-alert-list">
          {alerts.map((alert) => {
            const content = (
              <>
                <div className="operational-alert-head">
                  <span className={`operational-alert-dot severity-${alert.severity}`} aria-hidden="true" />
                  <span>{severityLabel(alert.severity)}</span>
                  <em>{alert.moduleLabel}</em>
                </div>
                <strong>{alert.elementName}</strong>
                <p>{alert.message}</p>
                <small>{alert.route ? 'Ver origen →' : 'Sin ruta disponible'}</small>
              </>
            );
            return alert.route ? (
              <Link className={`operational-alert-card severity-${alert.severity}`} to={alert.route} key={alert.id}>
                {content}
              </Link>
            ) : (
              <article className={`operational-alert-card severity-${alert.severity}`} key={alert.id}>
                {content}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default OperationalAlertsPanel;
