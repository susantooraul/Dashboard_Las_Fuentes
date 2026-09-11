import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import KpiCard from '../../../components/KpiCard';
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
import { asRecord, asRows, chartLabel, formatLocalDate, formatNumber } from '../insurgentesUtils';
import type { FlexibleRecord } from '../types';

const axisColor = '#b9e7ff';
const gridColor = 'rgba(56,189,248,0.14)';

const SYSTEM_METRICS = [
  { key: 'uvt', label: 'UVT', unit: '%' },
  { key: 'power', label: 'Potencia', unit: '%' },
  { key: 'flow', label: 'Flujo', unit: 'm³/h' },
  { key: 'dose', label: 'Dosis', unit: 'mJ/cm²' },
];

interface UvSectionProps {
  itemId?: string;
}

function nameOf(item: FlexibleRecord): string {
  return String(item.name || item.nombre || item.id || 'Lámpara UV');
}

function idOf(item: FlexibleRecord): string {
  return String(item.id || item.state_field || item.name || '');
}

function lampDataKey(item: FlexibleRecord): string {
  const id = idOf(item);
  if (id.includes('2')) return 'lamp_2_state';
  return 'lamp_1_state';
}

function metricValue(value: unknown, unit = ''): string {
  if (value === null || value === undefined || value === '') return '—';
  return `${formatNumber(value)}${unit ? ` ${unit}` : ''}`;
}

function scadaIdOf(item: FlexibleRecord): string {
  return String(item.scada_id || 'TRATAMIENTO');
}

function UvScadaTable({ lamps, suffix = '' }: { lamps: FlexibleRecord[]; suffix?: string }) {
  if (!lamps.length) return null;
  return (
    <section className="panel fade-up uv-scada-panel">
      <PanelHeader
        title="Lectura actual de lámparas UV"
        subtitle="Contrato homologado con la tabla del SCADA. UVT, Power, Flow y Dosis son lecturas compartidas del sistema y se repiten por fila como en planta."
      />
      <div className="uv-scada-table-wrap">
        <table className="uv-scada-table">
          <thead>
            <tr>
              <th>Lámpara</th>
              <th>ID</th>
              <th>Age</th>
              <th>UVT</th>
              <th>Power</th>
              <th>Flow</th>
              <th>Dosis</th>
              <th>Ignition</th>
              <th>State</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {lamps.map((lamp) => (
              <tr key={idOf(lamp)}>
                <td><Link className="uv-scada-equipment-link" to={`/pozos/uv/${encodeURIComponent(idOf(lamp))}${suffix}`}>{nameOf(lamp)}</Link></td>
                <td><strong>{scadaIdOf(lamp)}</strong></td>
                <td>{metricValue(lamp.agel)}</td>
                <td>{metricValue(lamp.uvt, '%')}</td>
                <td>{metricValue(lamp.power, '%')}</td>
                <td>{metricValue(lamp.flow, 'm³/h')}</td>
                <td>{metricValue(lamp.dose, 'mJ/cm²')}</td>
                <td><span className="uv-ignition-code">{lamp.ignition ?? lamp.state_code ?? '—'}</span></td>
                <td>
                  <span className="uv-state-cell">
                    <span className={`uv-state-dot state-${String(lamp.state_code ?? 'unknown')}`} aria-hidden="true" />
                    <StatusBadge type={String(lamp.statusType || 'communication')}>{String(lamp.state || 'Sin lectura')}</StatusBadge>
                  </span>
                </td>
                <td>{metricValue(lamp.status_reading, '%')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UvSystemParameters({ summary }: { summary: FlexibleRecord }) {
  return (
    <section className="panel fade-up uv-system-panel">
      <PanelHeader title="Parámetros del sistema UV" subtitle="Variables compartidas por el sistema; no pertenecen individualmente a una sola lámpara." />
      <div className="cards-grid insurgentes-kpi-grid uv-system-grid">
        <KpiCard label="UVT" value={formatNumber(summary.uvt)} unit="%" trend="Sistema UV" accent="blue" />
        <KpiCard label="Potencia" value={formatNumber(summary.power)} unit="%" trend="Sistema UV" accent="cyan" />
        <KpiCard label="Flujo" value={formatNumber(summary.flow)} unit="m³/h" trend="Sistema UV" accent="green" />
        <KpiCard label="Dosis" value={formatNumber(summary.dose)} unit="mJ/cm²" trend="Sistema UV" accent="blue" />
      </div>
    </section>
  );
}

function UvSection({ itemId }: UvSectionProps) {
  const location = useLocation();
  const [systemMetric, setSystemMetric] = useState(SYSTEM_METRICS[0].key);
  const controller = useSqlChartDashboard('uv', undefined, { includeHistory: true });
  const dashboard = asRecord(controller.dashboard);
  const allLamps = asRows(dashboard.uv_lamps);
  const selectedLamp = itemId ? allLamps.find((item) => idOf(item) === itemId) : null;
  const lamps = selectedLamp ? [selectedLamp] : allLamps;
  const summary = asRecord(dashboard.uv_summary);
  const history = asRows(dashboard.uv_history).map((row) => ({
    ...row,
    label: chartLabel(row.timestamp || row.bucket),
  }));
  const suffix = location.search || '';
  const selectedMetric = SYSTEM_METRICS.find((item) => item.key === systemMetric) || SYSTEM_METRICS[0];

  if (itemId) {
    if (!selectedLamp && !controller.loading) {
      return <ChartEmptyState message="No se encontró la lámpara UV solicitada en la configuración actual." />;
    }
    if (!selectedLamp) {
      return <ChartEmptyState message="Cargando lámpara UV..." />;
    }

    return (
      <>
        <OperationalDetailHero
          backTo="/pozos/uv"
          typeLabel="Lámparas UV"
          title={nameOf(selectedLamp)}
          status={String(selectedLamp.state || selectedLamp.status || 'Sin lectura')}
          statusType={String(selectedLamp.statusType || 'communication')}
          description="Lectura individual homologada con el SCADA. Ignition conserva el código crudo 0/1/2 y State muestra su interpretación operativa."
          metrics={[
            { label: 'ID', value: scadaIdOf(selectedLamp) },
            { label: 'Age', value: metricValue(selectedLamp.agel) },
            { label: 'Ignition', value: metricValue(selectedLamp.ignition ?? selectedLamp.state_code) },
            { label: 'State', value: String(selectedLamp.state || 'Sin lectura') },
            { label: 'Status', value: metricValue(selectedLamp.status_reading, '%') },
            { label: 'Comunicación', value: String(selectedLamp.estado_comunicacion || 'Sin estado') },
            { label: 'Última lectura', value: formatLocalDate(selectedLamp.updated || selectedLamp.ultima_lectura) },
          ]}
        >
          <DetailElementNavigator items={allLamps} currentId={String(itemId)} basePath="/pozos/uv" moduleLabel="Lámparas UV" />
        </OperationalDetailHero>

        <UvScadaTable lamps={[selectedLamp]} suffix={suffix} />

        <section className="panel chart-panel fade-up detail-history-panel">
          <PanelHeader title="Histórico de estado de lámpara" subtitle="0 Apagada · 1 Ignición · 2 Encendida. Serie discreta sin suavizado." />
          <SqlChartDateControls controller={controller} title="Rango de fechas" />
          {history.length ? (
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={history} margin={{ top: 18, right: 24, bottom: 42, left: 12 }}>
                <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke={axisColor} minTickGap={30} />
                <YAxis stroke={axisColor} domain={[0, 2]} ticks={[0, 1, 2]} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Line type="stepAfter" dataKey={lampDataKey(selectedLamp)} name={nameOf(selectedLamp)} stroke="#38bdf8" strokeWidth={2.8} dot={false} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <ChartEmptyState message={controller.loading ? 'Cargando histórico...' : 'Sin histórico UV disponible para el periodo seleccionado.'} />}
        </section>

        <UvSystemParameters summary={summary} />

        <DetailPeriodStatus
          rows={[
            { label: 'Estado', value: String(selectedLamp.state || 'Sin lectura') },
            { label: 'Comunicación', value: String(selectedLamp.estado_comunicacion || 'Sin estado') },
            { label: 'Age', value: metricValue(selectedLamp.agel) },
            { label: 'Status', value: metricValue(selectedLamp.status_reading, '%') },
            { label: 'Última actualización', value: formatLocalDate(selectedLamp.updated || selectedLamp.ultima_lectura) },
          ]}
        />

        <ShiftCutsPanel module="uv" elementId={String(itemId)} variant="detail" title={`Cortes por turno · ${nameOf(selectedLamp)}`} />
      </>
    );
  }

  return (
    <>
      <section className="insurgentes-hero panel fade-up">
        <div>
          <span className="section-eyebrow">Sistema UV</span>
          <h2>Lámparas UV</h2>
          <p>ID, Age, UVT, Power, Flow, Dosis, Ignition, State y Status se muestran con el mismo contrato visual del SCADA.</p>
        </div>
        <div className="insurgentes-hero-state">
          <span>Comunicación</span>
          <StatusBadge type={String(summary.communicationType || 'communication')}>{String(summary.estado_comunicacion || 'Sin comunicación')}</StatusBadge>
          <small>{formatLocalDate(summary.updated)}</small>
        </div>
      </section>

      <UvScadaTable lamps={lamps} suffix={suffix} />

      <section className="insurgentes-uv-grid">
        {lamps.length ? lamps.map((lamp) => (
          <Link
            className="panel insurgentes-uv-card insurgentes-clickable-card fade-up"
            key={idOf(lamp)}
            to={`/pozos/uv/${encodeURIComponent(idOf(lamp))}${suffix}`}
            aria-label={`Abrir detalle de ${nameOf(lamp)}`}
          >
            <div className="insurgentes-equipment-head">
              <div>
                <span>Lámpara UV</span>
                <h3>{nameOf(lamp)}</h3>
              </div>
              <StatusBadge type={String(lamp.statusType || 'communication')}>{String(lamp.state || 'Sin lectura')}</StatusBadge>
            </div>
            <div className={`insurgentes-uv-lamp state-${String(lamp.state_code ?? 'unknown')}`} aria-hidden="true">
              <span />
            </div>
            <div className="insurgentes-metric-list">
              <div><span>ID</span><strong>{scadaIdOf(lamp)}</strong></div>
              <div><span>Age</span><strong>{metricValue(lamp.agel)}</strong></div>
              <div><span>Ignition</span><strong>{metricValue(lamp.ignition ?? lamp.state_code)}</strong></div>
              <div><span>Status</span><strong>{metricValue(lamp.status_reading, '%')}</strong></div>
              <div><span>State</span><strong>{String(lamp.state || 'Sin lectura')}</strong></div>
              <div><span>Comunicación</span><strong>{String(lamp.estado_comunicacion || 'Sin estado')}</strong></div>
            </div>
            <div className="insurgentes-equipment-footer">
              <span>{formatLocalDate(lamp.updated)}</span>
              <strong>Abrir detalle →</strong>
            </div>
          </Link>
        )) : <ChartEmptyState message={controller.loading ? 'Cargando lámparas...' : 'Sin lecturas del sistema UV.'} />}
      </section>

      <UvSystemParameters summary={summary} />

      <section className="panel chart-panel fade-up">
        <PanelHeader title="Histórico de estado de lámparas" subtitle="0 Apagada · 1 Ignición · 2 Encendida" />
        <SqlChartDateControls controller={controller} />
        {history.length ? (
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={history} margin={{ top: 18, right: 24, bottom: 42, left: 12 }}>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke={axisColor} minTickGap={30} />
              <YAxis stroke={axisColor} domain={[0, 2]} ticks={[0, 1, 2]} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Line type="stepAfter" dataKey="lamp_1_state" name="Lámpara UV 1" stroke="#38bdf8" strokeWidth={2.6} dot={false} connectNulls={false} />
              <Line type="stepAfter" dataKey="lamp_2_state" name="Lámpara UV 2" stroke="#34d399" strokeWidth={2.6} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <ChartEmptyState message={controller.loading ? 'Cargando histórico...' : 'Sin histórico UV disponible para el periodo seleccionado.'} />}
      </section>

      <section className="panel chart-panel fade-up uv-system-history-panel">
        <PanelHeader title="Histórico del sistema UV" subtitle="Selecciona una métrica compartida. No se mezclan %, m³/h y mJ/cm² en un mismo eje." />
        <div className="insurgentes-history-control-group uv-system-selector" role="group" aria-label="Seleccionar métrica del sistema UV">
          {SYSTEM_METRICS.map((item) => {
            const isActive = systemMetric === item.key;
            return (
              <button
                key={item.key}
                type="button"
                className={isActive ? 'active' : ''}
                aria-pressed={isActive}
                onClick={() => setSystemMetric(item.key)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {history.length ? (
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={history} margin={{ top: 18, right: 24, bottom: 42, left: 12 }}>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke={axisColor} minTickGap={30} />
              <YAxis stroke={axisColor} unit={` ${selectedMetric.unit}`} />
              <Tooltip content={<ChartTooltip />} />
              <Legend />
              <Line type="monotone" dataKey={selectedMetric.key} name={`${selectedMetric.label} (${selectedMetric.unit})`} stroke="#f59e0b" strokeWidth={2.6} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <ChartEmptyState message={controller.loading ? 'Cargando histórico del sistema UV...' : 'Sin histórico del sistema UV disponible para el periodo seleccionado.'} />}
      </section>

      <ShiftCutsPanel module="uv" />
    </>
  );
}

export default UvSection;
