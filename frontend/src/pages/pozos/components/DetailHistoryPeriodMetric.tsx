import { formatNumber } from '../insurgentesUtils';
import type { DetailHistoryPeriodSummary } from './AdvancedElementHistoryPanel';

interface DetailHistoryPeriodMetricProps {
  summary: DetailHistoryPeriodSummary | null;
  sensorId: number | null;
  volumeLabel: string;
}

export default function DetailHistoryPeriodMetric({ summary, sensorId, volumeLabel }: DetailHistoryPeriodMetricProps) {
  const pending = !summary || summary.sensorId !== sensorId || summary.loading;

  if (pending) {
    return (
      <div className="detail-period-kpi-content detail-period-kpi-content--loading" aria-live="polite">
        <b>Calculando…</b>
        <small>Actualizando el periodo seleccionado</small>
      </div>
    );
  }

  const flowText = summary.flowAverageLps === null ? '—' : `${formatNumber(summary.flowAverageLps)} L/s`;
  const volumeText = summary.volumeM3 === null ? '—' : `${formatNumber(summary.volumeM3)} m³`;

  return (
    <div className="detail-period-kpi-content" aria-live="polite">
      <div className="detail-period-kpi-values">
        <span><b>{flowText}</b><small>Flujo promedio</small></span>
        <span><b>{volumeText}</b><small>{volumeLabel}</small></span>
      </div>
      <small className="detail-period-kpi-range">{summary.intervalLabel}</small>
      {summary.error ? <small className="detail-period-kpi-error">{summary.error}</small> : null}
    </div>
  );
}
