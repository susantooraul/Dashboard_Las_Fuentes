import ChartEmptyState from './ChartEmptyState';
import ChartPeriodNote from './ChartPeriodNote';
import FiveMinuteExcelExportButton from './FiveMinuteExcelExportButton';
import PanelHeader from './PanelHeader';
import SqlChartDateControls from './SqlChartDateControls';
import WaterHistoryChart from './WaterHistoryChart';
import useWaterHistory from '../hooks/useWaterHistory';
import { formatNumber } from '../insurgentesUtils';
import type { WaterHistoryPoint } from '../types';

interface AdvancedElementHistoryPanelProps {
  module: 'well' | 'line' | 'flow';
  sensorId: number;
  title: string;
  subtitle: string;
  sourceLabel: string;
  shortHistorySubtitle?: string;
}

function dateTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function historyStatus(point: WaterHistoryPoint): string {
  const status = String(point.data_status || point.status || '').toLowerCase();
  if (status === 'operational' || status === 'validated') return 'Validado';
  if (status === 'zero_consumption') return 'Sin volumen';
  if (status === 'partial') return 'Cobertura parcial';
  if (status === 'totalizer_retained') return 'Totalizador retenido';
  if (status === 'invalid_totalizer') return 'En revisión';
  if (status === 'no_data') return 'Sin datos';
  return status || 'Sin datos';
}

function totalizerClose(point: WaterHistoryPoint): number | null {
  const value = point.effective_totalizer_close_m3 ?? point.totalizer_close_m3;
  return value === null || value === undefined ? null : Number(value);
}

export default function AdvancedElementHistoryPanel({
  module,
  sensorId,
  title,
  subtitle,
  sourceLabel,
  shortHistorySubtitle = 'Promedio, volumen y totalizador del elemento seleccionado',
}: AdvancedElementHistoryPanelProps) {
  const controller = useWaterHistory({ module, sensorId });
  const points = controller.data?.points || [];
  const historicalRows = points.filter((point) => Number(point.samples || 0) > 0).slice(-8).reverse();
  const hasData = points.some((point) => Number(point.samples || 0) > 0);

  return (
    <>
      <section className="panel chart-panel fade-up detail-history-panel advanced-history-panel">
        <PanelHeader title={title} subtitle={subtitle} />
        <SqlChartDateControls
          controller={controller}
          title="Rango de fechas"
          showHeader={false}
          extraAction={(
            <FiveMinuteExcelExportButton
              module={module}
              sensorId={sensorId}
              range={controller.range}
            />
          )}
        />
        <ChartPeriodNote range={controller.range} source={sourceLabel} />
        {hasData ? (
          <WaterHistoryChart
            points={points}
            aggregation={controller.aggregation}
            flowUnit={controller.data?.flow_unit || 'L/s'}
            height={430}
          />
        ) : (
          <ChartEmptyState message={controller.loading ? 'Cargando histórico...' : controller.error || 'Sin histórico válido para el periodo seleccionado.'} />
        )}
      </section>

      <section className="panel table-wrapper fade-up well-history-panel advanced-history-table-panel">
        <PanelHeader title="Histórico corto" subtitle={shortHistorySubtitle} />
        <div className="pozos-table-scroll">
          <table className="pozos-operacion-table well-history-table advanced-history-table">
            <thead>
              <tr>
                <th>Intervalo</th>
                <th>Flujo promedio</th>
                <th>Volumen validado</th>
                <th>Totalizador cierre</th>
                <th>Muestras</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {historicalRows.length ? historicalRows.map((point) => {
                const close = totalizerClose(point);
                return (
                  <tr key={`${point.sensor_id}-${point.bucket_start}`}>
                    <td>{dateTimeLabel(point.bucket_start)}</td>
                    <td>{point.flow_avg_lps === null ? '—' : `${formatNumber(point.flow_avg_lps)} ${point.flow_unit || 'L/s'}`}</td>
                    <td>{point.volume_m3 === null ? '—' : `${formatNumber(point.volume_m3)} m³`}</td>
                    <td>{close === null ? '—' : `${formatNumber(close)} m³`}</td>
                    <td>{Number(point.samples || 0).toLocaleString('es-MX')}</td>
                    <td>{historyStatus(point)}</td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={6}>{controller.loading ? 'Cargando histórico...' : controller.error || 'Sin registros para este periodo.'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
