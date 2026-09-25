import type { HistoryAggregation } from '../types';
import type { DetailVolumeDisplay } from './WaterHistoryChart';

interface TooltipPayloadEntry {
  payload?: Record<string, unknown>;
}

interface WaterHistoryTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  aggregation: HistoryAggregation;
  flowUnit?: string;
  volumeDisplay?: DetailVolumeDisplay;
}

interface IntervalParts {
  date: string;
  interval: string;
}

function formatNumber(value: unknown, decimals = 2): string {
  if (value === null || value === undefined || value === '') return 'Sin datos';
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'Sin datos';
  return parsed.toLocaleString('es-MX', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function intervalParts(startValue: unknown, endValue: unknown, aggregation: HistoryAggregation): IntervalParts {
  const start = new Date(String(startValue || ''));
  const end = new Date(String(endValue || ''));
  if (Number.isNaN(start.getTime())) return { date: 'Periodo', interval: '' };
  const date = start.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (aggregation === 'daily') return { date, interval: '' };
  const startTime = start.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const endTime = Number.isNaN(end.getTime())
    ? ''
    : end.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  return { date, interval: endTime ? `${startTime} – ${endTime}` : startTime };
}

const STATUS_LABELS: Record<string, string> = {
  operational: 'Con actividad',
  zero_consumption: 'Sin consumo',
  no_data: 'Sin registros guardados',
  invalid_totalizer: 'Normal',
  missing_totalizer: 'Sin totalizador disponible',
  stale_data: 'Lectura atrasada',
  frozen_flow: 'Normal',
  mapping_pending: 'Pendiente de confirmación de sensor',
  partial: 'Cobertura parcial',
  totalizer_retained: 'Totalizador retenido',
  validated: 'Validado',
};

export default function WaterHistoryTooltip({ active, payload, aggregation, flowUnit = 'Unidad por confirmar', volumeDisplay = 'interval' }: WaterHistoryTooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload.find((entry) => entry.payload)?.payload;
  if (!row) return null;
  const samples = Number(row.samples || 0);
  const dataStatus = String(row.dataStatus || '');
  const flowDisplay = dataStatus === 'mapping_pending'
      ? 'Pendiente de confirmación de sensor'
      : row.flow === null
        ? 'Sin datos'
        : `${formatNumber(row.flow)} ${flowUnit}`;
  const interval = intervalParts(row.bucketStart, row.bucketEnd, aggregation);

  return (
    <div className="chart-tooltip solid-tooltip pozos-tooltip water-history-tooltip">
      <div className="chart-tooltip-label water-history-tooltip-heading">
        <span className="water-history-tooltip-date">{interval.date}</span>
        {interval.interval ? <span className="water-history-tooltip-interval">{interval.interval}</span> : null}
      </div>
      <div className="chart-tooltip-list">
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-name">Flujo promedio</span>
          <span className="chart-tooltip-value">{flowDisplay}</span>
        </div>
        {samples > 0 && row.flowMin !== null && row.flowMin !== undefined && row.flowMax !== null && row.flowMax !== undefined ? (
          <div className="chart-tooltip-row">
            <span className="chart-tooltip-name">Mínimo / máximo</span>
            <span className="chart-tooltip-value">{formatNumber(row.flowMin)} / {formatNumber(row.flowMax)} {flowUnit}</span>
          </div>
        ) : null}
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-name">Totalizador observado</span>
          <span className="chart-tooltip-value">{row.rawTotalizerClose === null || row.rawTotalizerClose === undefined ? 'Sin datos' : `${formatNumber(row.rawTotalizerClose)} m³`}</span>
        </div>
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-name">Totalizador efectivo</span>
          <span className="chart-tooltip-value">{row.effectiveTotalizerClose === null || row.effectiveTotalizerClose === undefined ? 'Sin datos' : `${formatNumber(row.effectiveTotalizerClose)} m³`}{row.totalizerRetained ? ' · retenido' : ''}</span>
        </div>
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-name">{volumeDisplay === 'cumulative' ? 'Volumen acumulado del periodo' : 'Volumen del intervalo'}</span>
          <span className="chart-tooltip-value">
            {volumeDisplay === 'cumulative'
              ? (row.cumulativeVolume === null ? 'Sin datos' : `${formatNumber(row.cumulativeVolume)} m³`)
              : (row.volume === null ? 'Sin datos' : `${formatNumber(row.volume)} m³`)}
          </span>
        </div>
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-name">Muestras</span>
          <span className="chart-tooltip-value">{samples.toLocaleString('es-MX')}</span>
        </div>
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-name">Estado</span>
          <span className="chart-tooltip-value">{STATUS_LABELS[dataStatus] || 'Sin datos'}</span>
        </div>
      </div>
    </div>
  );
}
