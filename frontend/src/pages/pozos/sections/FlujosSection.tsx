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

function detailVolumeLabel(group: FlujosSectionProps['group']): string {
  return group === 'cisterna' ? 'Volumen de salida' : 'Volumen consumido';
}

function generalVolumeLabel(group: FlujosSectionProps['group']): string {
  if (group === 'tam') return 'Consumo hoy';
  if (group === 'cisterna') return 'Salida hoy';
  return 'Consumo hoy';
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
  const [detailPeriodSummary, setDetailPeriodSummary] = useState<DetailHistoryPeriodSummary | null>(null);
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
            { label: 'Totalizador apertura', value: totalizerStartText(selectedFlow) },
            { label: detailVolumeLabel(group), value: periodVolumeText(selectedFlow) },
            { label: 'Totalizador actual', value: totalizerCurrentText(selectedFlow) },
            { label: 'Flujo actual', value: flowText(selectedFlow) },
            { label: 'Tiempo activo', value: formatMinutes(activeMinutesValue(selectedFlow)) },
            { label: 'Encendidos', value: startCountText(selectedFlow) },
            ...(sensorIdOf(selectedFlow) ? [{
              label: 'Periodo seleccionado',
              value: <DetailHistoryPeriodMetric
                summary={detailPeriodSummary}
                sensorId={sensorIdOf(selectedFlow)}
                volumeLabel={detailVolumeLabel(group)}
              />,
            }] : []),
            { label: 'Última lectura', value: itemUpdateText(selectedFlow) },
          ]}
        >
          <DetailElementNavigator items={allFlows} currentId={String(itemId)} basePath={basePath} moduleLabel={title} />
        </OperationalDetailHero>

        {sensorIdOf(selectedFlow) ? (
          <AdvancedElementHistoryPanel
            module="flow"
            sensorId={sensorIdOf(selectedFlow) as number}
            title="Histórico del medidor"
            onPeriodSummaryChange={setDetailPeriodSummary}
          />
        ) : (
        <section className="panel chart-panel fade-up detail-history-panel">
          <PanelHeader title="Histórico del medidor" />
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

      </>
    );
  }

  const totalCurrent = sumValues(allFlows, currentTotalizerValue);
  const totalPeriod = sumValues(allFlows, periodVolumeValue);
  const totalFlow = sumValues(allFlows, flowValue);
  const activeCount = countActive(allFlows);

  if (group === 'tam') {
    const tamElementIds = allFlows.map(idOf).filter(Boolean);

    return (
      <div className="lf-tam-page">
        <section className="insurgentes-hero panel fade-up insurgentes-hero--with-kpis lf-tam-hero">
          <div className="lf-tam-hero__intro">
            <span className="section-eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <div className="insurgentes-hero-kpis lf-tam-hero__kpis" aria-label="Resumen operativo de TAM">
            <article className="lf-tam-kpi"><span>Operando</span><strong>{activeCount}/{allFlows.length}</strong></article>
            <article className="lf-tam-kpi lf-tam-kpi--primary"><span>{generalVolumeLabel(group)}</span><strong>{totalPeriod === null ? '—' : `${formatNumber(totalPeriod)} m³`}</strong></article>
            <article className="lf-tam-kpi"><span>Flujo total</span><strong>{totalFlow === null ? '—' : `${formatNumber(totalFlow)} L/s`}</strong></article>
            <article className="lf-tam-kpi"><span>Totalizador actual</span><strong>{totalCurrent === null ? '—' : `${formatNumber(totalCurrent)} m³`}</strong></article>
          </div>
        </section>

        <section className="insurgentes-equipment-grid two-columns lf-tam-grid" aria-label="Medidores operativos de TAM">
          {flows.length ? flows.map((flow) => (
            <Link
              className="panel insurgentes-equipment-card insurgentes-clickable-card fade-up lf-tam-card"
              key={idOf(flow)}
              to={`${basePath}/${encodeURIComponent(idOf(flow))}${suffix}`}
              aria-label={`Abrir detalle de ${nameOf(flow)}`}
            >
              <div className="insurgentes-equipment-head lf-tam-card__head">
                <h3>{nameOf(flow)}</h3>
                <StatusBadge type={String(flow.statusType || 'normal')}>{String(flow.status || 'Sin datos')}</StatusBadge>
              </div>

              <div className="lf-tam-card__primary">
                <div>
                  <span>Consumo hoy</span>
                  <strong>{periodVolumeText(flow)}</strong>
                </div>
                <div>
                  <span>Flujo actual</span>
                  <strong>{flowText(flow)}</strong>
                </div>
              </div>

              <div className="lf-tam-card__secondary">
                <div><span>Totalizador actual</span><strong>{totalizerCurrentText(flow)}</strong></div>
                <div><span>Tiempo activo</span><strong>{formatMinutes(activeMinutesValue(flow))}</strong></div>
                <div><span>Encendidos</span><strong>{startCountText(flow)}</strong></div>
              </div>

              <div className="insurgentes-equipment-footer lf-tam-card__footer">
                <span>{itemUpdateText(flow)}</span>
                <strong>Abrir detalle →</strong>
              </div>
            </Link>
          )) : <ChartEmptyState message={controller.loading ? 'Cargando medidores...' : 'Sin datos operativos de los medidores configurados.'} />}
        </section>

        <OperationalModuleHistoryPanel
          initialModule="flujos"
          lockedModule="flujos"
          allowedElementIds={tamElementIds}
          titleOverride="Histórico operativo · TAM"
        />

        <ShiftCutsPanel module="flujos" group="tam" title="Cortes por turno · Medidores de TAM" />
      </div>
    );
  }


  if (group === 'embotellado') {
    const embotelladoElementIds = allFlows.map(idOf).filter(Boolean);

    return (
      <div className="lf-embotellado-page">
        <section className="insurgentes-hero panel fade-up insurgentes-hero--with-kpis lf-embotellado-hero">
          <div className="lf-embotellado-hero__intro">
            <span className="section-eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <div className="insurgentes-hero-kpis lf-embotellado-hero__kpis" aria-label="Resumen operativo de Embotellado">
            <article className="lf-embotellado-kpi"><span>Operando</span><strong>{activeCount}/{allFlows.length}</strong></article>
            <article className="lf-embotellado-kpi lf-embotellado-kpi--primary"><span>{generalVolumeLabel(group)}</span><strong>{totalPeriod === null ? '—' : `${formatNumber(totalPeriod)} m³`}</strong></article>
            <article className="lf-embotellado-kpi"><span>Flujo total</span><strong>{totalFlow === null ? '—' : `${formatNumber(totalFlow)} L/s`}</strong></article>
            <article className="lf-embotellado-kpi"><span>Totalizador actual</span><strong>{totalCurrent === null ? '—' : `${formatNumber(totalCurrent)} m³`}</strong></article>
          </div>
        </section>

        <section className="insurgentes-equipment-grid two-columns lf-embotellado-grid" aria-label="Medidores operativos de Embotellado">
          {flows.length ? flows.map((flow) => (
            <Link
              className="panel insurgentes-equipment-card insurgentes-clickable-card fade-up lf-embotellado-card"
              key={idOf(flow)}
              to={`${basePath}/${encodeURIComponent(idOf(flow))}${suffix}`}
              aria-label={`Abrir detalle de ${nameOf(flow)}`}
            >
              <div className="insurgentes-equipment-head lf-embotellado-card__head">
                <h3>{nameOf(flow)}</h3>
                <StatusBadge type={String(flow.statusType || 'normal')}>{String(flow.status || 'Sin datos')}</StatusBadge>
              </div>

              <div className="lf-embotellado-card__primary">
                <div>
                  <span>Consumo hoy</span>
                  <strong>{periodVolumeText(flow)}</strong>
                </div>
                <div>
                  <span>Flujo actual</span>
                  <strong>{flowText(flow)}</strong>
                </div>
              </div>

              <div className="lf-embotellado-card__secondary">
                <div><span>Totalizador actual</span><strong>{totalizerCurrentText(flow)}</strong></div>
                <div><span>Tiempo activo</span><strong>{formatMinutes(activeMinutesValue(flow))}</strong></div>
                <div><span>Encendidos</span><strong>{startCountText(flow)}</strong></div>
              </div>

              <div className="insurgentes-equipment-footer lf-embotellado-card__footer">
                <span>{itemUpdateText(flow)}</span>
                <strong>Abrir detalle →</strong>
              </div>
            </Link>
          )) : <ChartEmptyState message={controller.loading ? 'Cargando medidores...' : 'Sin datos operativos de los medidores configurados.'} />}
        </section>

        <OperationalModuleHistoryPanel
          initialModule="flujos"
          lockedModule="flujos"
          allowedElementIds={embotelladoElementIds}
          titleOverride="Histórico operativo · Embotellado"
        />

        <ShiftCutsPanel module="flujos" group="embotellado" title="Cortes por turno · Medidores de Embotellado" />
      </div>
    );
  }

  if (group === 'cisterna') {
    const cisternaElementIds = allFlows.map(idOf).filter(Boolean);

    return (
      <div className="lf-cisterna-page">
        <section className="insurgentes-hero panel fade-up insurgentes-hero--with-kpis lf-cisterna-hero">
          <div className="lf-cisterna-hero__intro">
            <span className="section-eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <div className="insurgentes-hero-kpis lf-cisterna-hero__kpis" aria-label="Resumen operativo de Cisterna">
            <article className="lf-cisterna-kpi"><span>Operando</span><strong>{activeCount}/{allFlows.length}</strong></article>
            <article className="lf-cisterna-kpi lf-cisterna-kpi--primary"><span>{generalVolumeLabel(group)}</span><strong>{totalPeriod === null ? '—' : `${formatNumber(totalPeriod)} m³`}</strong></article>
            <article className="lf-cisterna-kpi"><span>Flujo actual</span><strong>{totalFlow === null ? '—' : `${formatNumber(totalFlow)} L/s`}</strong></article>
            <article className="lf-cisterna-kpi"><span>Totalizador actual</span><strong>{totalCurrent === null ? '—' : `${formatNumber(totalCurrent)} m³`}</strong></article>
          </div>
        </section>

        <section className="insurgentes-equipment-grid lf-cisterna-grid" aria-label="Medidor operativo de Cisterna">
          {flows.length ? flows.map((flow) => (
            <Link
              className="panel insurgentes-equipment-card insurgentes-clickable-card fade-up lf-cisterna-card"
              key={idOf(flow)}
              to={`${basePath}/${encodeURIComponent(idOf(flow))}${suffix}`}
              aria-label={`Abrir detalle de ${nameOf(flow)}`}
            >
              <div className="insurgentes-equipment-head lf-cisterna-card__head">
                <h3>{nameOf(flow)}</h3>
                <StatusBadge type={String(flow.statusType || 'normal')}>{String(flow.status || 'Sin datos')}</StatusBadge>
              </div>

              <div className="lf-cisterna-card__primary">
                <div>
                  <span>Salida hoy</span>
                  <strong>{periodVolumeText(flow)}</strong>
                </div>
                <div>
                  <span>Flujo actual</span>
                  <strong>{flowText(flow)}</strong>
                </div>
              </div>

              <div className="lf-cisterna-card__secondary">
                <div><span>Totalizador actual</span><strong>{totalizerCurrentText(flow)}</strong></div>
                <div><span>Tiempo activo</span><strong>{formatMinutes(activeMinutesValue(flow))}</strong></div>
                <div><span>Encendidos</span><strong>{startCountText(flow)}</strong></div>
              </div>

              <div className="insurgentes-equipment-footer lf-cisterna-card__footer">
                <span>{itemUpdateText(flow)}</span>
                <strong>Abrir detalle →</strong>
              </div>
            </Link>
          )) : <ChartEmptyState message={controller.loading ? 'Cargando medidor...' : 'Sin datos operativos del medidor de cisterna.'} />}
        </section>

        <OperationalModuleHistoryPanel
          initialModule="flujos"
          lockedModule="flujos"
          allowedElementIds={cisternaElementIds}
          titleOverride="Histórico operativo · Cisterna"
        />

        <ShiftCutsPanel module="flujos" group="cisterna" title="Cortes por turno · Cisterna" />
      </div>
    );
  }

  return <ChartEmptyState message="Grupo de flujos no disponible." />;
}

export default FlujosSection;
