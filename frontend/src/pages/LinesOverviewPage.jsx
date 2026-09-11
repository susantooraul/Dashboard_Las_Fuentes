import { useEffect } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import KpiCard from '../components/KpiCard';
import { getLineGroups } from '../data/circuits';

const palette = ['#e9082c', '#c40323', '#8a3d26'];

function ComparisonTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip solid-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      <div className="chart-tooltip-list">
        {payload.map((entry) => (
          <div className="chart-tooltip-row" key={`${entry.dataKey}-${entry.value}`}>
            <span className="chart-tooltip-dot" style={{ background: entry.color || entry.fill || '#fff' }} />
            <span className="chart-tooltip-name">{entry.name || entry.dataKey}</span>
            <span className="chart-tooltip-value">{entry.value}{entry.dataKey === 'utilizationPct' ? '%' : ' kW'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineSummaryCard({ group, index }) {
  return (
    <article className="panel line-summary-card fade-up" style={{ animationDelay: `${index * 70}ms` }}>
      <div className="line-summary-head">
        <div>
          <div className="line-summary-label">Agrupación</div>
          <div className="line-summary-title">{group.title}</div>
          <div className="line-summary-copy">{group.summary}</div>
        </div>
        <div className="line-summary-chip">{group.circuits.length} circuitos</div>
      </div>

      <div className="line-summary-metrics">
        <div>
          <div className="plant-metric-label">Consumo total</div>
          <div className="plant-metric-value">{group.totalKw}<span>kW</span></div>
        </div>
        <div>
          <div className="plant-metric-label">Capacidad utilizada</div>
          <div className="plant-capacity-value">{group.utilizationPct}<span>%</span></div>
        </div>
      </div>

      <div className="capacity-progress">
        <div className="capacity-progress-track">
          <div className="capacity-progress-fill warning" style={{ width: `${group.utilizationPct}%` }} />
        </div>
      </div>

      <div className="line-summary-footer">
        <div className="plant-footer-item">
          <span>Capacidad total</span>
          <strong>{group.capacityKw} kW</strong>
        </div>
        <div className="plant-footer-item">
          <span>Arranque</span>
          <strong>{group.startTime}</strong>
        </div>
        <div className="plant-footer-item">
          <span>Paro</span>
          <strong>{group.stopTime}</strong>
        </div>
      </div>
    </article>
  );
}

export default function LinesOverviewPage({ setHeaderMeta }) {
  const lineGroups = getLineGroups().map((group) => {
    const totalKw = Math.round(group.circuits.reduce((sum, item) => sum + item.kw, 0) * 10) / 10;
    const capacityKw = Math.round(group.circuits.reduce((sum, item) => sum + item.capacityKw, 0) * 10) / 10;
    const utilizationPct = capacityKw ? Math.round((totalKw / capacityKw) * 100) : 0;
    const starts = group.circuits.map((item) => item.startTime).sort();
    const stops = group.circuits.map((item) => item.stopTime).sort();
    return {
      ...group,
      totalKw,
      capacityKw,
      utilizationPct,
      startTime: starts[0],
      stopTime: stops[stops.length - 1],
    };
  });

  const totalConsumption = Math.round(lineGroups.reduce((sum, group) => sum + group.totalKw, 0) * 10) / 10;
  const totalCapacity = Math.round(lineGroups.reduce((sum, group) => sum + group.capacityKw, 0) * 10) / 10;
  const averageUtilization = lineGroups.length ? Math.round(lineGroups.reduce((sum, group) => sum + group.utilizationPct, 0) / lineGroups.length) : 0;

  useEffect(() => {
    setHeaderMeta({
      title: 'Líneas',
      subtitle: 'Vista consolidada demo para todas las líneas de producción',
      onExport: () => {},
      onEmail: () => {},
    });
  }, [setHeaderMeta]);

  return (
    <div className="page-grid">
      <section className="cards-grid stagger-grid">
        <KpiCard label="Consumo total" value={totalConsumption.toLocaleString('es-MX')} unit="kW" trend="Suma de todas las líneas" accent="red" />
        <KpiCard label="Capacidad total" value={totalCapacity.toLocaleString('es-MX')} unit="kW" trend="Capacidad instalada demo" accent="crimson" />
        <KpiCard label="Uso promedio" value={averageUtilization} unit="%" trend="Capacidad utilizada" accent="wine" />
      </section>

      <section className="panel comparison-panel fade-up">
        <div className="panel-header compact">
          <div>
            <div className="panel-title">Comparativo entre líneas</div>
            <div className="panel-subtitle">Consumo total y porcentaje de uso por cada línea.</div>
          </div>
        </div>
        <div className="comparison-chart-wrap">
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={lineGroups} barCategoryGap={20}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="title" tick={{ fill: '#9fb1cc', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="left" tick={{ fill: '#9fb1cc', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fill: '#9fb1cc', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<ComparisonTooltip />} />
              <Bar yAxisId="left" dataKey="totalKw" name="Consumo total" radius={[10, 10, 0, 0]}>
                {lineGroups.map((group, index) => <Cell key={group.key} fill={palette[index % palette.length]} />)}
              </Bar>
              <Bar yAxisId="right" dataKey="utilizationPct" name="Uso" fill="rgba(255,255,255,0.24)" radius={[10, 10, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="line-summary-grid stagger-grid">
        {lineGroups.map((group, index) => <LineSummaryCard key={group.key} group={group} index={index} />)}
      </section>
    </div>
  );
}
