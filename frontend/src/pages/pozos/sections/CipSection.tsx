import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ChartTooltip from '../components/ChartTooltip';
import PanelHeader from '../components/PanelHeader';
import SqlChartDateControls from '../components/SqlChartDateControls';
import ChartEmptyState from '../components/ChartEmptyState';
import useSqlChartDashboard from '../hooks/useSqlChartDashboard';

const axisColor = '#b9e7ff';
const gridColor = 'rgba(56,189,248,0.14)';

type CipRow = Record<string, unknown>;

interface CipDashboard {
  cip_weekly?: CipRow[];
}

function isCipDashboard(value: unknown): value is CipDashboard {
  return Boolean(value && typeof value === 'object');
}

function CipSection() {
  const cipChart = useSqlChartDashboard('dashboard');
  const cipDashboard = isCipDashboard(cipChart.dashboard) ? cipChart.dashboard : null;
  const cipRows = Array.isArray(cipDashboard?.cip_weekly) ? cipDashboard.cip_weekly : [];

  return (
    <section className="content-grid pozos-main-grid single-wide-grid">
      <div className="panel chart-panel fade-up">
        <PanelHeader title="Consumo hora CIP" subtitle="Histórico filtrable cuando exista lectura disponible" />
        <SqlChartDateControls controller={cipChart} />
        {cipRows.length ? (
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={cipRows}>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
              <XAxis dataKey="day" stroke={axisColor} />
              <YAxis stroke={axisColor} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
              <Bar dataKey="hours" name="Consumo CIP" fill="#14b8ff" radius={[12, 12, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <ChartEmptyState message="CIP aún no tiene lecturas disponibles. No se muestran datos demo." />}
      </div>
    </section>
  );
}



export default CipSection;
