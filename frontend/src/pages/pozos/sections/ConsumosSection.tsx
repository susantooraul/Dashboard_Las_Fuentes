import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildEnergyWaterSeries,
  buildWellPeriodRows,
} from '../chartBuilders';
import ChartEmptyState from '../components/ChartEmptyState';
import ChartPeriodNote from '../components/ChartPeriodNote';
import ChartTooltip from '../components/ChartTooltip';
import PanelHeader from '../components/PanelHeader';
import SqlChartDateControls from '../components/SqlChartDateControls';
import useSqlChartDashboard from '../hooks/useSqlChartDashboard';
import type { DashboardData } from '../types';

const axisColor = '#b9e7ff';
const gridColor = 'rgba(56,189,248,0.14)';

function ConsumosSection() {
  const consumoChart = useSqlChartDashboard('dashboard');
  const dashboard = consumoChart.dashboard as DashboardData | null;
  const energyRows = buildEnergyWaterSeries(dashboard, consumoChart.range);
  const wellRows = buildWellPeriodRows(dashboard);

  return (
    <section className="content-grid pozos-main-grid single-wide-grid">
      <div className="panel chart-panel fade-up">
        <PanelHeader title="Consumo de agua y energía" subtitle="Histórico disponible para el periodo seleccionado" />
        <SqlChartDateControls controller={consumoChart} />
        <ChartPeriodNote range={consumoChart.range} source="Un día: consumo por hora · varios días: consumo por día" />
        {energyRows.length ? (
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={energyRows} margin={{ top: 10, right: 18, bottom: 8, left: 4 }}>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
              <XAxis dataKey="hour" stroke={axisColor} />
              <YAxis yAxisId="left" stroke={axisColor} />
              <YAxis yAxisId="right" orientation="right" stroke="#7dd3fc" />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
              <Legend />
              <Bar yAxisId="left" dataKey="agua" name="Agua bombeada (m³)" fill="#0ea5e9" radius={[10, 10, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="energia" name="Consumo (kWh)" stroke="#7dd3fc" strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <ChartEmptyState message="Sin histórico de agua/energía para graficar en el periodo seleccionado." />}
      </div>

      <div className="panel chart-panel fade-up">
        <PanelHeader title="Producción por pozo" subtitle="m³ y kWh calculados por periodo; no usa totalizadores acumulados como consumo" />
        <SqlChartDateControls controller={consumoChart} title="Fechas de producción por pozo" />
        <ChartPeriodNote range={consumoChart.range} source="Comparativo por pozo del periodo seleccionado" />
        {wellRows.length ? (
          <ResponsiveContainer width="100%" height={380}>
            <ComposedChart data={wellRows} margin={{ top: 10, right: 18, bottom: 8, left: 4 }}>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke={axisColor} />
              <YAxis yAxisId="left" stroke={axisColor} />
              <YAxis yAxisId="right" orientation="right" stroke="#7dd3fc" />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
              <Legend />
              <Bar yAxisId="left" dataKey="agua" name="Agua bombeada (m³)" fill="#0ea5e9" radius={[10, 10, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="energia" name="Consumo (kWh)" stroke="#7dd3fc" strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <ChartEmptyState message="Sin datos por pozo para el rango seleccionado." />}
      </div>
    </section>
  );
}


export default ConsumosSection;
