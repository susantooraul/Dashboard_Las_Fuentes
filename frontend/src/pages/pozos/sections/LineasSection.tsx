import { Link, useLocation } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AdvancedElementHistoryPanel from '../components/AdvancedElementHistoryPanel';
import ChartEmptyState from '../components/ChartEmptyState';
import ChartTooltip from '../components/ChartTooltip';
import DetailElementNavigator from '../components/DetailElementNavigator';
import DetailPeriodStatus from '../components/DetailPeriodStatus';
import OperationalDetailHero from '../components/OperationalDetailHero';
import OperationalModuleHistoryPanel from '../components/OperationalModuleHistoryPanel';
import PanelHeader from '../components/PanelHeader';
import SqlChartDateControls from '../components/SqlChartDateControls';
import StatusBadge from '../components/StatusBadge';
import ShiftCutsPanel from '../components/ShiftCutsPanel';
import useSqlChartDashboard from '../hooks/useSqlChartDashboard';
import useWaterModuleHistory from '../hooks/useWaterModuleHistory';
import { asRecord, asRows, formatNumber, pivotCommonHistorySeries } from '../insurgentesUtils';
import { activeMinutesValue, countActive, currentTotalizerValue, flowText, flowValue, itemUpdateText, periodVolumeText, periodVolumeValue, previousTotalizerValue, startCountText, sumValues, totalizerCurrentText, totalizerStartText, formatMinutes } from '../operationalPresentation';
import type { FlexibleRecord } from '../types';

const colors = ['#38bdf8', '#22d3ee', '#34d399', '#fbbf24', '#fb7185', '#c084fc', '#60a5fa'];
const axisColor = '#b9e7ff';
const gridColor = 'rgba(56,189,248,0.14)';

interface LineasSectionProps {
  itemId?: string;
}

function nameOf(item: FlexibleRecord): string {
  return String(item.name || item.nombre || item.id || 'Línea');
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

function LineasSection({ itemId }: LineasSectionProps) {
  const location = useLocation();
  const controller = useSqlChartDashboard('lineas', undefined, {
    includeHistory: false,
    includePeriodDeltas: true,
  });
  const historyController = useWaterModuleHistory({ module: 'line', enabled: Boolean(itemId) });
  const dashboard = asRecord(controller.dashboard);
  const allLines = asRows(dashboard.production_lines);
  const selectedLine = itemId ? allLines.find((item) => idOf(item) === itemId) : null;
  const lines = selectedLine ? [selectedLine] : allLines;
  const historySeries = asRows(historyController.data?.series);
  const visibleHistorySeries = itemId
    ? historySeries.filter((series) => String(series.operational_key || '') === String(itemId))
    : historySeries;
  const chartRows = pivotCommonHistorySeries(visibleHistorySeries, 'flow_avg_lps');
  const chartKeys = visibleHistorySeries.map((series) => nameOf(series));
  const visibleHistoryHasData = visibleHistorySeries.some((series) => series.has_data === true);
  const suffix = location.search || '';

  if (itemId) {
    if (!selectedLine && !controller.loading) {
      return <ChartEmptyState message="No se encontró la línea solicitada en la configuración actual." />;
    }
    if (!selectedLine) {
      return <ChartEmptyState message="Cargando línea..." />;
    }

    return (
      <>
        <OperationalDetailHero
          backTo="/pozos/lineas"
          typeLabel="Líneas"
          title={nameOf(selectedLine)}
          status={String(selectedLine.status || 'Sin estado')}
          statusType={String(selectedLine.statusType || 'normal')}
          description="Análisis individual de la línea para el periodo seleccionado."
          metrics={[
            { label: 'Total día anterior', value: totalizerStartText(selectedLine) },
            { label: 'Total bombeado hoy', value: periodVolumeText(selectedLine) },
            { label: 'Totalizador actual', value: totalizerCurrentText(selectedLine) },
            { label: 'Flujo actual', value: flowText(selectedLine) },
            { label: 'Tiempo activo', value: formatMinutes(activeMinutesValue(selectedLine)) },
            { label: 'Encendidos periodo', value: startCountText(selectedLine) },
            { label: 'Comunicación', value: String(selectedLine.estado_comunicacion || 'Sin estado') },
            { label: 'Última lectura', value: itemUpdateText(selectedLine) },
          ]}
        >
          <DetailElementNavigator items={allLines} currentId={String(itemId)} basePath="/pozos/lineas" moduleLabel="Líneas" />
        </OperationalDetailHero>

        {sensorIdOf(selectedLine) ? (
          <AdvancedElementHistoryPanel
            module="line"
            sensorId={sensorIdOf(selectedLine) as number}
            title="Flujo de línea"
            subtitle="Promedio, volumen y totalizador de la línea seleccionada."
            sourceLabel="Flujo promedio de la línea · totalizador"
            shortHistorySubtitle="Promedio, volumen y totalizador de la línea seleccionada"
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
                  <Line key={key} type="monotone" dataKey={key} name={key} stroke={colors[index % colors.length]} strokeWidth={2.6} dot={false} connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : <ChartEmptyState message={historyController.loading ? 'Cargando histórico...' : historyController.error || 'Sin histórico válido para el periodo seleccionado.'} />}
        </section>
        )}

        <DetailPeriodStatus
          rows={[
            { label: 'Actividad', value: activityText(selectedLine) },
            { label: 'Comunicación', value: String(selectedLine.estado_comunicacion || 'Sin estado') },
            { label: 'Validación', value: validationText(selectedLine) },
            { label: 'Volumen del periodo', value: periodVolumeText(selectedLine) },
            { label: 'Tiempo activo', value: formatMinutes(activeMinutesValue(selectedLine)) },
            { label: 'Encendidos periodo', value: startCountText(selectedLine) },
            { label: 'Última actualización', value: itemUpdateText(selectedLine) },
          ]}
        />

        <ShiftCutsPanel module="lineas" elementId={String(itemId)} variant="detail" title={`Cortes por turno · ${nameOf(selectedLine)}`} />
      </>
    );
  }

  const totalPrevious = sumValues(allLines, previousTotalizerValue);
  const totalCurrent = sumValues(allLines, currentTotalizerValue);
  const totalPeriod = sumValues(allLines, periodVolumeValue);
  const totalFlow = sumValues(allLines, flowValue);
  const totalActiveMinutes = sumValues(allLines, activeMinutesValue);
  const activeCount = countActive(allLines);

  return (
    <>
      <section className="insurgentes-hero panel fade-up insurgentes-hero--with-kpis">
        <div>
          <span className="section-eyebrow">Operación de agua</span>
          <h2>Líneas</h2>
          <p>Este módulo permanecerá oculto hasta confirmar líneas operativas de Planta Las Fuentes.</p>
        </div>
        <div className="insurgentes-hero-kpis" aria-label="Resumen operativo de líneas">
          <article><span>Operando</span><strong>{activeCount}/{allLines.length || 7}</strong></article>
          <article><span>Flujo total</span><strong>{totalFlow === null ? '—' : `${formatNumber(totalFlow)} L/s`}</strong></article>
          <article><span>Total día anterior</span><strong>{totalPrevious === null ? '—' : `${formatNumber(totalPrevious)} m³`}</strong></article>
          <article><span>Total bombeado hoy</span><strong>{totalPeriod === null ? '—' : `${formatNumber(totalPeriod)} m³`}</strong></article>
          <article><span>Totalizador actual</span><strong>{totalCurrent === null ? '—' : `${formatNumber(totalCurrent)} m³`}</strong></article>
          <article><span>Tiempo activo</span><strong>{formatMinutes(totalActiveMinutes)}</strong></article>
        </div>
      </section>

      <section className="insurgentes-equipment-grid">
        {lines.length ? lines.map((line) => (
          <Link
            className="panel insurgentes-equipment-card insurgentes-clickable-card fade-up"
            key={idOf(line)}
            to={`/pozos/lineas/${encodeURIComponent(idOf(line))}${suffix}`}
            aria-label={`Abrir detalle de ${nameOf(line)}`}
          >
            <div className="insurgentes-equipment-head">
              <div>
                <span>Línea operativa</span>
                <h3>{nameOf(line)}</h3>
              </div>
              <StatusBadge type={String(line.statusType || 'normal')}>{String(line.status || 'Sin datos')}</StatusBadge>
            </div>
            <div className="insurgentes-metric-list">
              <div><span>Total día anterior</span><strong>{totalizerStartText(line)}</strong></div>
              <div><span>Total bombeado hoy</span><strong>{periodVolumeText(line)}</strong></div>
              <div><span>Totalizador actual</span><strong>{totalizerCurrentText(line)}</strong></div>
              <div><span>Flujo actual</span><strong>{flowText(line)}</strong></div>
              <div><span>Actividad</span><strong>{activityText(line)}</strong></div>
              <div><span>Tiempo activo</span><strong>{formatMinutes(activeMinutesValue(line))}</strong></div>
              <div><span>Encendidos periodo</span><strong>{startCountText(line)}</strong></div>
              <div><span>Comunicación</span><strong>{String(line.estado_comunicacion || 'Sin estado')}</strong></div>
              <div><span>Validación</span><strong>{validationText(line)}</strong></div>
            </div>
            <div className="insurgentes-equipment-footer">
              <span>{itemUpdateText(line)}</span>
              <strong>Abrir detalle →</strong>
            </div>
          </Link>
        )) : <ChartEmptyState message={controller.loading ? 'Cargando líneas...' : 'Sin datos operativos de las líneas confirmadas.'} />}
      </section>

      <OperationalModuleHistoryPanel initialModule="lineas" lockedModule="lineas" />

      <ShiftCutsPanel module="lineas" />
    </>
  );
}

export default LineasSection;
