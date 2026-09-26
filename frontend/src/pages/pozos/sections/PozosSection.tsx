import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AdvancedElementHistoryPanel from '../components/AdvancedElementHistoryPanel';
import type { DetailHistoryPeriodSummary } from '../components/AdvancedElementHistoryPanel';
import DetailHistoryPeriodMetric from '../components/DetailHistoryPeriodMetric';
import ChartEmptyState from '../components/ChartEmptyState';
import ChartTooltip from '../components/ChartTooltip';
import DetailElementNavigator from '../components/DetailElementNavigator';
import OperationalDetailHero from '../components/OperationalDetailHero';
import OperationalModuleHistoryPanel from '../components/OperationalModuleHistoryPanel';
import PanelHeader from '../components/PanelHeader';
import SqlChartDateControls from '../components/SqlChartDateControls';
import StatusBadge from '../components/StatusBadge';
import ShiftCutsPanel from '../components/ShiftCutsPanel';
import useSqlChartDashboard from '../hooks/useSqlChartDashboard';
import useWaterModuleHistory from '../hooks/useWaterModuleHistory';
import { asRecord, asRows, formatNumber, pivotCommonHistorySeries } from '../insurgentesUtils';
import { activeMinutesValue, countActive, currentTotalizerValue, flowText, flowValue, itemUpdateText, periodVolumeText, periodVolumeValue, startCountText, sumValues, totalizerCurrentText, totalizerStartText, formatMinutes } from '../operationalPresentation';
import type { FlexibleRecord } from '../types';

const colors = ['#38bdf8', '#22d3ee', '#34d399', '#fbbf24', '#a78bfa', '#fb7185'];
const axisColor = '#b9e7ff';
const gridColor = 'rgba(56,189,248,0.14)';

interface PozosSectionProps {
  itemId?: string;
}

function idOf(item: FlexibleRecord): string {
  return String(item.id || item.sensor_id || item.name || '');
}

function nameOf(item: FlexibleRecord): string {
  return String(item.name || item.nombre || item.id || 'Pozo');
}

function sensorIdOf(item: FlexibleRecord): number | null {
  const value = Number(item.sensor_id);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function PozosSection({ itemId }: PozosSectionProps) {
  const location = useLocation();
  const controller = useSqlChartDashboard('pozos', undefined, {
    includeHistory: false,
    includePeriodDeltas: true,
  });
  const historyController = useWaterModuleHistory({ module: 'well', enabled: Boolean(itemId) });
  const dashboard = asRecord(controller.dashboard);
  const allWells = asRows(dashboard.wells || dashboard.pozos);
  const selectedWell = itemId ? allWells.find((item) => idOf(item) === itemId) : null;
  const [detailPeriodSummary, setDetailPeriodSummary] = useState<DetailHistoryPeriodSummary | null>(null);
  const wells = selectedWell ? [selectedWell] : allWells;
  const historySeries = asRows(historyController.data?.series);
  const visibleHistorySeries = itemId
    ? historySeries.filter((series) => String(series.operational_key || '') === String(itemId))
    : historySeries;
  const chartRows = pivotCommonHistorySeries(visibleHistorySeries, 'flow_avg_lps');
  const chartKeys = visibleHistorySeries.map((series) => nameOf(series));
  const visibleHistoryHasData = visibleHistorySeries.some((series) => series.has_data === true);
  const suffix = location.search || '';

  if (itemId) {
    if (!selectedWell && !controller.loading) {
      return <ChartEmptyState message="No se encontró el pozo solicitado en la configuración actual." />;
    }
    if (!selectedWell) {
      return <ChartEmptyState message="Cargando pozo..." />;
    }

    return (
      <>
        <OperationalDetailHero
          backTo="/pozos/pozos"
          typeLabel="Pozos"
          title={nameOf(selectedWell)}
          status={String(selectedWell.status || 'Sin estado')}
          statusType={String(selectedWell.statusType || 'normal')}
          metrics={[
            { label: 'Totalizador apertura', value: totalizerStartText(selectedWell) },
            { label: 'Volumen bombeado', value: periodVolumeText(selectedWell) },
            { label: 'Totalizador actual', value: totalizerCurrentText(selectedWell) },
            { label: 'Flujo actual', value: flowText(selectedWell) },
            { label: 'Tiempo activo', value: formatMinutes(activeMinutesValue(selectedWell)) },
            { label: 'Encendidos', value: startCountText(selectedWell) },
            ...(sensorIdOf(selectedWell) ? [{
              label: 'Periodo seleccionado',
              value: <DetailHistoryPeriodMetric
                summary={detailPeriodSummary}
                sensorId={sensorIdOf(selectedWell)}
                volumeLabel="Volumen bombeado"
              />,
            }] : []),
            { label: 'Última lectura', value: itemUpdateText(selectedWell) },
          ]}
        >
          <DetailElementNavigator items={allWells} currentId={String(itemId)} basePath="/pozos/pozos" moduleLabel="Pozos" />
        </OperationalDetailHero>

        {sensorIdOf(selectedWell) ? (
          <AdvancedElementHistoryPanel
            module="well"
            sensorId={sensorIdOf(selectedWell) as number}
            title="Flujo de pozo"
            onPeriodSummaryChange={setDetailPeriodSummary}
          />
        ) : (
        <section className="panel chart-panel fade-up detail-history-panel">
          <PanelHeader title="Histórico del pozo" />
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

        <ShiftCutsPanel module="pozos" elementId={String(itemId)} variant="detail" title={`Cortes por turno · ${nameOf(selectedWell)}`} />


      </>
    );
  }

  const totalCurrent = sumValues(allWells, currentTotalizerValue);
  const totalPeriod = sumValues(allWells, periodVolumeValue);
  const totalFlow = sumValues(allWells, flowValue);
  const activeCount = countActive(allWells);

  return (
    <div className="lf-pozos-page">
      <section className="insurgentes-hero panel fade-up insurgentes-hero--with-kpis lf-pozos-hero">
        <div className="lf-pozos-hero__intro">
          <span className="section-eyebrow">Operación de pozos</span>
          <h2>Pozos</h2>
        </div>
        <div className="insurgentes-hero-kpis lf-pozos-hero__kpis" aria-label="Resumen operativo de pozos">
          <article className="lf-pozos-kpi"><span>Operando</span><strong>{activeCount}/{allWells.length || 5}</strong></article>
          <article className="lf-pozos-kpi lf-pozos-kpi--primary"><span>Bombeado hoy</span><strong>{totalPeriod === null ? '—' : `${formatNumber(totalPeriod)} m³`}</strong></article>
          <article className="lf-pozos-kpi"><span>Flujo total</span><strong>{totalFlow === null ? '—' : `${formatNumber(totalFlow)} L/s`}</strong></article>
          <article className="lf-pozos-kpi"><span>Totalizador actual</span><strong>{totalCurrent === null ? '—' : `${formatNumber(totalCurrent)} m³`}</strong></article>
        </div>
      </section>

      <section className="insurgentes-equipment-grid lf-pozos-grid" aria-label="Pozos operativos">
        {wells.length ? wells.map((well) => (
          <Link
            className="panel insurgentes-equipment-card insurgentes-clickable-card fade-up lf-pozos-card"
            key={idOf(well)}
            to={`/pozos/pozos/${encodeURIComponent(idOf(well))}${suffix}`}
            aria-label={`Abrir detalle de ${nameOf(well)}`}
          >
            <div className="insurgentes-equipment-head lf-pozos-card__head">
              <h3>{nameOf(well)}</h3>
              <StatusBadge type={String(well.statusType || 'normal')}>{String(well.status || 'Sin datos')}</StatusBadge>
            </div>

            <div className="lf-pozos-card__primary">
              <div>
                <span>Bombeado hoy</span>
                <strong>{periodVolumeText(well)}</strong>
              </div>
              <div>
                <span>Flujo actual</span>
                <strong>{flowText(well)}</strong>
              </div>
            </div>

            <div className="lf-pozos-card__secondary">
              <div><span>Totalizador actual</span><strong>{totalizerCurrentText(well)}</strong></div>
              <div><span>Tiempo activo</span><strong>{formatMinutes(activeMinutesValue(well))}</strong></div>
              <div><span>Encendidos</span><strong>{startCountText(well)}</strong></div>
            </div>

            <div className="insurgentes-equipment-footer lf-pozos-card__footer">
              <span>{itemUpdateText(well)}</span>
              <strong>Abrir detalle →</strong>
            </div>
          </Link>
        )) : <ChartEmptyState message={controller.loading ? 'Cargando pozos...' : 'Sin datos operativos de los pozos confirmados.'} />}
      </section>

      <OperationalModuleHistoryPanel initialModule="pozos" lockedModule="pozos" />

      <ShiftCutsPanel module="pozos" />
    </div>
  );
}

export default PozosSection;
