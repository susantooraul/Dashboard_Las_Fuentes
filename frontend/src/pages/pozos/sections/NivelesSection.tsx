import { Link, useLocation } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
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
import { asRecord, asRows, formatLocalDate, formatNumber, pivotHistory } from '../insurgentesUtils';
import type { FlexibleRecord } from '../types';

const colors = ['#38bdf8', '#22d3ee', '#34d399', '#c084fc'];
const axisColor = '#b9e7ff';
const gridColor = 'rgba(56,189,248,0.14)';

interface NivelesSectionProps {
  itemId?: string;
}

function nameOf(item: FlexibleRecord): string {
  return String(item.name || item.nombre || item.id || 'Nivel');
}

function idOf(item: FlexibleRecord): string {
  return String(item.id || item.column || item.name || '');
}

function NivelesSection({ itemId }: NivelesSectionProps) {
  const location = useLocation();
  const controller = useSqlChartDashboard('niveles', undefined, { includeHistory: true });
  const dashboard = asRecord(controller.dashboard);
  const allLevels = asRows(dashboard.tank_inputs);
  const selectedLevel = itemId ? allLevels.find((item) => idOf(item) === itemId) : null;
  const levels = selectedLevel ? [selectedLevel] : allLevels;
  const historyRows = asRows(dashboard.tank_level_history).filter((row) => !itemId || idOf(row) === itemId);
  const chartRows = pivotHistory(historyRows, 'level_m');
  const chartKeys = levels.map((item) => nameOf(item));
  const suffix = location.search || '';

  if (itemId) {
    if (!selectedLevel && !controller.loading) {
      return <ChartEmptyState message="No se encontró el nivel solicitado en la configuración actual." />;
    }
    if (!selectedLevel) {
      return <ChartEmptyState message="Cargando nivel..." />;
    }

    return (
      <>
        <OperationalDetailHero
          backTo="/pozos/niveles"
          typeLabel="Niveles"
          title={nameOf(selectedLevel)}
          status={String(selectedLevel.status || 'Sin datos')}
          statusType={String(selectedLevel.statusType || 'normal')}
          description="Análisis individual de nivel. No se calcula volumen sin capacidad y geometría confirmadas."
          metrics={[
            { label: 'Nivel actual', value: `${formatNumber(selectedLevel.level_m)} m` },
            { label: 'Porcentaje', value: `${formatNumber(selectedLevel.fill_pct)}%` },
            { label: 'Mínimo operativo', value: `${formatNumber(selectedLevel.minimum_m)} m` },
            { label: 'Máximo operativo', value: `${formatNumber(selectedLevel.maximum_m)} m` },
            { label: 'Comunicación', value: String(selectedLevel.estado_comunicacion || 'Sin estado') },
            { label: 'Última lectura', value: formatLocalDate(selectedLevel.updated || selectedLevel.ultima_lectura) },
          ]}
        >
          <DetailElementNavigator items={allLevels} currentId={String(itemId)} basePath="/pozos/niveles" moduleLabel="Niveles" />
        </OperationalDetailHero>

        <section className="panel chart-panel fade-up detail-history-panel">
          <PanelHeader title="Histórico del elemento" subtitle="Nivel en metros durante el periodo seleccionado." />
          <SqlChartDateControls controller={controller} title="Rango de fechas" />
          {chartRows.length && chartKeys.length ? (
            <ResponsiveContainer width="100%" height={390}>
              <LineChart data={chartRows} margin={{ top: 18, right: 24, bottom: 42, left: 12 }}>
                <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke={axisColor} minTickGap={30} />
                <YAxis stroke={axisColor} unit=" m" />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                {chartKeys.map((key, index) => (
                  <Line key={key} type="monotone" dataKey={key} name={key} stroke={colors[index % colors.length]} strokeWidth={2.6} dot={false} connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : <ChartEmptyState message={controller.loading ? 'Cargando histórico...' : 'Sin histórico válido para el periodo seleccionado.'} />}
        </section>

        <DetailPeriodStatus
          rows={[
            { label: 'Estado', value: String(selectedLevel.status || 'Sin datos') },
            { label: 'Comunicación', value: String(selectedLevel.estado_comunicacion || 'Sin estado') },
            { label: 'Nivel actual', value: `${formatNumber(selectedLevel.level_m)} m` },
            { label: 'Porcentaje', value: `${formatNumber(selectedLevel.fill_pct)}%` },
            { label: 'Rango operativo', value: `${formatNumber(selectedLevel.minimum_m)} m – ${formatNumber(selectedLevel.maximum_m)} m` },
            { label: 'Última actualización', value: formatLocalDate(selectedLevel.updated || selectedLevel.ultima_lectura) },
          ]}
        />

        <ShiftCutsPanel module="niveles" elementId={String(itemId)} variant="detail" title={`Cortes por turno · ${nameOf(selectedLevel)}`} />
      </>
    );
  }

  return (
    <>
      <section className="insurgentes-hero panel fade-up">
        <div>
          <span className="section-eyebrow">Niveles y cisternas</span>
          <h2>Niveles</h2>
          <p>Altura actual, porcentaje y límites operativos. No se calcula volumen porque la capacidad y geometría no están confirmadas.</p>
        </div>
        <div className="insurgentes-hero-state">
          <span>Elementos normales</span>
          <strong>{allLevels.filter((item) => item.status === 'Normal').length}/{allLevels.length || 4}</strong>
          <small>Comunicación y nivel se evalúan por separado.</small>
        </div>
      </section>

      <section className="insurgentes-level-grid">
        {levels.length ? levels.map((level) => (
          <Link
            className="panel insurgentes-level-card insurgentes-clickable-card fade-up"
            key={idOf(level)}
            to={`/pozos/niveles/${encodeURIComponent(idOf(level))}${suffix}`}
            aria-label={`Abrir detalle de ${nameOf(level)}`}
          >
            <div className="insurgentes-equipment-head">
              <div>
                <span>Nivel operativo</span>
                <h3>{nameOf(level)}</h3>
              </div>
              <StatusBadge type={String(level.statusType || 'normal')}>{String(level.status || 'Sin datos')}</StatusBadge>
            </div>
            <div className="insurgentes-level-visual" aria-label={`Porcentaje ${String(level.fill_pct || 0)}`}>
              <div className="insurgentes-level-fill" style={{ height: `${Math.max(0, Math.min(100, Number(level.fill_pct || 0)))}%` }} />
              <strong>{formatNumber(level.fill_pct)}%</strong>
            </div>
            <div className="insurgentes-metric-list">
              <div><span>Nivel actual</span><strong>{formatNumber(level.level_m)} m</strong></div>
              <div><span>Rango operativo</span><strong>{formatNumber(level.minimum_m)}–{formatNumber(level.maximum_m)} m</strong></div>
              <div><span>Comunicación</span><strong>{String(level.estado_comunicacion || 'Sin estado')}</strong></div>
            </div>
            <div className="insurgentes-equipment-footer">
              <span>{formatLocalDate(level.updated)}</span>
              <strong>Abrir detalle →</strong>
            </div>
          </Link>
        )) : <ChartEmptyState message={controller.loading ? 'Cargando niveles...' : 'Sin lecturas de nivel disponibles.'} />}
      </section>

      <section className="panel chart-panel fade-up">
        <PanelHeader title="Histórico de niveles" subtitle="Altura en metros para el periodo seleccionado" />
        <SqlChartDateControls controller={controller} />
        {chartRows.length && chartKeys.length ? (
          <ResponsiveContainer width="100%" height={370}>
            <LineChart data={chartRows} margin={{ top: 18, right: 24, bottom: 42, left: 12 }}>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke={axisColor} minTickGap={30} />
              <YAxis stroke={axisColor} unit=" m" />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              {chartKeys.map((key, index) => (
                <Line key={key} type="monotone" dataKey={key} name={key} stroke={colors[index % colors.length]} strokeWidth={2.5} dot={false} connectNulls={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : <ChartEmptyState message={controller.loading ? 'Cargando histórico...' : 'Sin histórico válido para el periodo seleccionado.'} />}
      </section>

      <ShiftCutsPanel module="niveles" />
    </>
  );
}

export default NivelesSection;
