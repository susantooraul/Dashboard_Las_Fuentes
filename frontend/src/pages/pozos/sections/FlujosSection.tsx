import { Link, useLocation } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AdvancedElementHistoryPanel from '../components/AdvancedElementHistoryPanel';
import ChartEmptyState from '../components/ChartEmptyState';
import ChartTooltip from '../components/ChartTooltip';
import DetailElementNavigator from '../components/DetailElementNavigator';
import DetailPeriodStatus from '../components/DetailPeriodStatus';
import OperationalDetailHero from '../components/OperationalDetailHero';
import PanelHeader from '../components/PanelHeader';
import SqlChartDateControls from '../components/SqlChartDateControls';
import StatusBadge from '../components/StatusBadge';
import ShiftCutsPanel from '../components/ShiftCutsPanel';
import useSqlChartDashboard from '../hooks/useSqlChartDashboard';
import useWaterModuleHistory from '../hooks/useWaterModuleHistory';
import { asRecord, asRows, formatNumber, pivotCommonHistorySeries } from '../insurgentesUtils';
import { activeMinutesValue, countActive, currentTotalizerValue, flowText, flowValue, itemUpdateText, periodVolumeText, periodVolumeValue, previousTotalizerValue, startCountText, sumValues, totalizerCurrentText, totalizerStartText, formatMinutes } from '../operationalPresentation';
import type { FlexibleRecord } from '../types';

const colors = ['#38bdf8', '#34d399'];
const axisColor = '#b9e7ff';
const gridColor = 'rgba(56,189,248,0.14)';

interface FlujosSectionProps {
  itemId?: string;
  group: 'tam' | 'embotellado' | 'cisterna';
  title: string;
  eyebrow: string;
  basePath: string;
}

function nameOf(item: FlexibleRecord): string {
  return String(item.name || item.nombre || item.id || 'Flujo');
}

function idOf(item: FlexibleRecord): string {
  return String(item.id || item.sensor_id || item.name || '');
}

function sensorIdOf(item: FlexibleRecord): number | null {
  const value = Number(item.sensor_id);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function activityText(item: FlexibleRecord): string {
  if (item.active === true) return 'Con actividad';
  if (item.active === false) return 'Sin actividad';
  return String(item.status || 'Sin estado');
}

function validationText(item: FlexibleRecord): string {
  const status = String(item.period_status || '').toLowerCase();
  if (status === 'ok' || status === 'valid' || status === 'validado') return 'Válida';
  if (status === 'parcial' || status === 'partial' || status === 'validacion_parcial') return 'Validación parcial';
  if (status === 'dato_en_revision') return 'Validación parcial';
  if (status === 'sin_datos') return 'No disponible';
  return periodVolumeText(item) === 'Sin datos' ? 'No disponible' : 'Válida';
}

function FlujosSection({ itemId, group, title, eyebrow, basePath }: FlujosSectionProps) {
  const location = useLocation();
  const controller = useSqlChartDashboard('flujos', undefined, {
    includeHistory: false,
    includePeriodDeltas: true,
  });
  const historyController = useWaterModuleHistory({ module: 'flow', enabled: Boolean(itemId) });
  const dashboard = asRecord(controller.dashboard);
  const allFlows = asRows(dashboard.flows).filter((item) => String(item.module_group || '') === group);
  const selectedFlow = itemId ? allFlows.find((item) => idOf(item) === itemId) : null;
  const flows = selectedFlow ? [selectedFlow] : allFlows;
  const historySeries = asRows(historyController.data?.series);
  const visibleHistorySeries = itemId
    ? historySeries.filter((series) => String(series.operational_key || '') === String(itemId))
    : historySeries;
  const chartRows = pivotCommonHistorySeries(visibleHistorySeries, 'flow_avg_lps');
  const chartKeys = visibleHistorySeries.map((series) => nameOf(series));
  const visibleHistoryHasData = visibleHistorySeries.some((series) => series.has_data === true);
  const suffix = location.search || '';

  if (itemId) {
    if (!selectedFlow && !controller.loading) {
      return <ChartEmptyState message="No se encontró el flujo solicitado en la configuración actual." />;
    }
    if (!selectedFlow) {
      return <ChartEmptyState message="Cargando flujo..." />;
    }

    return (
      <>
        <OperationalDetailHero
          backTo={basePath}
          typeLabel={title}
          title={nameOf(selectedFlow)}
          status={String(selectedFlow.status || 'Sin estado')}
          statusType={String(selectedFlow.statusType || 'normal')}
          metrics={[
            { label: 'Total día anterior', value: totalizerStartText(selectedFlow) },
            { label: 'Volumen del periodo', value: periodVolumeText(selectedFlow) },
            { label: 'Totalizador actual', value: totalizerCurrentText(selectedFlow) },
            { label: 'Flujo actual', value: flowText(selectedFlow) },
            { label: 'Tiempo activo', value: formatMinutes(activeMinutesValue(selectedFlow)) },
            { label: 'Encendidos periodo', value: startCountText(selectedFlow) },
            { label: 'Comunicación', value: String(selectedFlow.estado_comunicacion || 'Sin estado') },
            { label: 'Última lectura', value: itemUpdateText(selectedFlow) },
          ]}
        >
          <DetailElementNavigator items={allFlows} currentId={String(itemId)} basePath={basePath} moduleLabel={title} />
        </OperationalDetailHero>

        {sensorIdOf(selectedFlow) ? (
          <AdvancedElementHistoryPanel
            module="flow"
            sensorId={sensorIdOf(selectedFlow) as number}
            title="Flujo del elemento"
            sourceLabel="Flujo promedio del elemento · totalizador"
          />
        ) : (
        <section className="panel chart-panel fade-up detail-history-panel">
          <PanelHeader title="Histórico del elemento" subtitle="Flujo registrado para el periodo seleccionado." />
          <SqlChartDateControls controller={historyController} title="Rango de fechas" />
          {visibleHistoryHasData && chartRows.length && chartKeys.length ? (
            <ResponsiveContainer width="100%" height={390}>
              <LineChart data={chartRows} margin={{ top: 18, right: 24, bottom: 42, left: 12 }}>
                <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke={axisColor} minTickGap={30} />
                <YAxis stroke={axisColor} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                {chartKeys.map((key, index) => (
                  <Line key={key} type="monotone" dataKey={key} name={key} stroke={colors[index % colors.length]} strokeWidth={2.8} dot={false} connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : <ChartEmptyState message={historyController.loading ? 'Cargando histórico...' : historyController.error || 'Sin histórico válido para el periodo seleccionado.'} />}
        </section>
        )}

        <ShiftCutsPanel module="flujos" group={group} elementId={String(itemId)} variant="detail" title={`Cortes por turno · ${nameOf(selectedFlow)}`} />

        <DetailPeriodStatus
          rows={[
            { label: 'Actividad', value: activityText(selectedFlow) },
            { label: 'Comunicación', value: String(selectedFlow.estado_comunicacion || 'Sin estado') },
            { label: 'Validación', value: validationText(selectedFlow) },
            { label: 'Volumen del periodo', value: periodVolumeText(selectedFlow) },
            { label: 'Tiempo activo', value: formatMinutes(activeMinutesValue(selectedFlow)) },
            { label: 'Encendidos periodo', value: startCountText(selectedFlow) },
            { label: 'Última actualización', value: itemUpdateText(selectedFlow) },
          ]}
        />
      </>
    );
  }

  const totalPrevious = sumValues(allFlows, previousTotalizerValue);
  const totalCurrent = sumValues(allFlows, currentTotalizerValue);
  const totalPeriod = sumValues(allFlows, periodVolumeValue);
  const totalFlow = sumValues(allFlows, flowValue);
  const totalActiveMinutes = sumValues(allFlows, activeMinutesValue);
  const activeCount = countActive(allFlows);

  return (
    <>
      <section className="insurgentes-hero panel fade-up insurgentes-hero--with-kpis">
        <div>
          <span className="section-eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          <p>Lecturas instantáneas y totalizadores de los medidores confirmados para esta área.</p>
        </div>
        <div className="insurgentes-hero-kpis" aria-label="Resumen operativo de flujos">
          <article><span>Con actividad</span><strong>{activeCount}/{allFlows.length}</strong></article>
          <article><span>Flujo total</span><strong>{totalFlow === null ? '—' : `${formatNumber(totalFlow)} L/s`}</strong></article>
          <article><span>Total día anterior</span><strong>{totalPrevious === null ? '—' : `${formatNumber(totalPrevious)} m³`}</strong></article>
          <article><span>Volumen del periodo</span><strong>{totalPeriod === null ? '—' : `${formatNumber(totalPeriod)} m³`}</strong></article>
          <article><span>Totalizador actual</span><strong>{totalCurrent === null ? '—' : `${formatNumber(totalCurrent)} m³`}</strong></article>
          <article><span>Tiempo activo</span><strong>{formatMinutes(totalActiveMinutes)}</strong></article>
        </div>
      </section>

      <ShiftCutsPanel module="flujos" group={group} title={`Cortes por turno · ${title}`} />

      <section className="insurgentes-equipment-grid two-columns">
        {flows.length ? flows.map((flow) => (
          <Link
            className="panel insurgentes-equipment-card insurgentes-clickable-card fade-up"
            key={idOf(flow)}
            to={`${basePath}/${encodeURIComponent(idOf(flow))}${suffix}`}
            aria-label={`Abrir detalle de ${nameOf(flow)}`}
          >
            <div className="insurgentes-equipment-head">
              <div>
                <span>Medidor configurado</span>
                <h3>{nameOf(flow)}</h3>
              </div>
              <StatusBadge type={String(flow.statusType || 'normal')}>{String(flow.status || 'Sin datos')}</StatusBadge>
            </div>
            <div className="insurgentes-metric-list">
              <div><span>Total día anterior</span><strong>{totalizerStartText(flow)}</strong></div>
              <div><span>Volumen del periodo</span><strong>{periodVolumeText(flow)}</strong></div>
              <div><span>Totalizador actual</span><strong>{totalizerCurrentText(flow)}</strong></div>
              <div><span>Flujo actual</span><strong>{flowText(flow)}</strong></div>
              <div><span>Actividad</span><strong>{activityText(flow)}</strong></div>
              <div><span>Tiempo activo</span><strong>{formatMinutes(activeMinutesValue(flow))}</strong></div>
              <div><span>Encendidos periodo</span><strong>{startCountText(flow)}</strong></div>
              <div><span>Comunicación</span><strong>{String(flow.estado_comunicacion || 'Sin estado')}</strong></div>
              <div><span>Validación</span><strong>{validationText(flow)}</strong></div>
            </div>
            <div className="insurgentes-equipment-footer">
              <span>{itemUpdateText(flow)}</span>
              <strong>Abrir detalle →</strong>
            </div>
          </Link>
        )) : <ChartEmptyState message={controller.loading ? 'Cargando medidores...' : 'Sin datos operativos de los medidores configurados.'} />}
      </section>
    </>
  );
}

export default FlujosSection;
