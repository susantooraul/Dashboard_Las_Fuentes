import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import KpiCard from '../../../components/KpiCard';
import ChartEmptyState from '../components/ChartEmptyState';
import ChartTooltip from '../components/ChartTooltip';
import PanelHeader from '../components/PanelHeader';
import SqlChartDateControls from '../components/SqlChartDateControls';
import StatusBadge from '../components/StatusBadge';
import ShiftCutsPanel from '../components/ShiftCutsPanel';
import useSqlChartDashboard from '../hooks/useSqlChartDashboard';
import { asRecord, asRows, chartLabel, formatLocalDate, formatNumber, periodText } from '../insurgentesUtils';

const axisColor = '#b9e7ff';
const gridColor = 'rgba(56,189,248,0.14)';

function EntradaAguaSection() {
  const controller = useSqlChartDashboard('entrada', undefined, {
    includeHistory: true,
    includePeriodDeltas: true,
  });
  const dashboard = asRecord(controller.dashboard);
  const entry = asRecord(dashboard.water_entry);
  const history = asRows(dashboard.entry_flow_history || dashboard.well_flow_history).map((row) => ({
    ...row,
    label: chartLabel(row.bucket || row.timestamp),
  }));

  return (
    <>
      <section className="insurgentes-hero panel fade-up">
        <div>
          <span className="section-eyebrow">Entrada de agua</span>
          <h2>Pozos Corporativos</h2>
          <p>Una sola medición operativa visible. La señal de respaldo se utiliza únicamente cuando la principal no es válida o está desactualizada.</p>
        </div>
        <div className="insurgentes-hero-state">
          <span>Estado</span>
          <StatusBadge type={String(entry.statusType || 'communication')}>{String(entry.status || 'Sin datos operativos')}</StatusBadge>
          <small>{String(entry.estado_comunicacion || 'Sin comunicación')}</small>
        </div>
      </section>

      <section className="cards-grid insurgentes-kpi-grid">
        <KpiCard label="Flujo actual" value={formatNumber(entry.flow_lps)} unit="L/s" trend="Pozos Corporativos · medición conjunta" accent="blue" />
        <KpiCard label="Totalizador" value={formatNumber(entry.totalizador_m3)} unit="m³" trend="Lectura acumulada actual" accent="cyan" />
        <KpiCard label="Volumen del periodo" value={periodText(entry)} unit="" trend={String(entry.period_note || 'Lectura final menos lectura inicial válida')} accent={entry.period_status === 'dato_en_revision' ? 'amber' : 'green'} />
        <KpiCard label="Última actualización" value={formatLocalDate(entry.updated)} unit="" trend={String(entry.estado_comunicacion || '')} accent="blue" />
      </section>

      <section className="panel chart-panel fade-up">
        <PanelHeader title="Histórico de entrada" subtitle="Flujo y volumen del periodo de la señal principal confirmada" />
        <SqlChartDateControls controller={controller} />
        {history.length ? (
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={history} margin={{ top: 20, right: 24, bottom: 32, left: 12 }}>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke={axisColor} minTickGap={28} />
              <YAxis stroke={axisColor} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="flow_lps" name="Flujo actual (L/s)" stroke="#38bdf8" strokeWidth={2.8} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <ChartEmptyState message={controller.loading ? 'Cargando histórico...' : 'Sin histórico válido para el periodo seleccionado.'} />}
      </section>

      <section className="panel fade-up insurgentes-source-note">
        <PanelHeader title="Criterio de lectura" subtitle="Regla operativa aplicada" />
        <p>La medición principal se usa mientras exista una lectura válida y reciente. La señal de respaldo no se suma; solamente sustituye temporalmente a la principal cuando es necesario.</p>
      </section>

      <ShiftCutsPanel module="entrada" />
    </>
  );
}

export default EntradaAguaSection;
