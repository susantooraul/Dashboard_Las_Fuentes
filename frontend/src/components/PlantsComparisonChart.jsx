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

function ComparisonTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const consumption = payload.find((entry) => entry.dataKey === 'currentLoad');
  const utilization = payload.find((entry) => entry.dataKey === 'utilizationPct');

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      <div className="chart-tooltip-list">
        {consumption ? (
          <div className="chart-tooltip-row">
            <span className="chart-tooltip-dot" style={{ background: '#e9082c' }} />
            <span className="chart-tooltip-name">Consumo</span>
            <span className="chart-tooltip-value">{consumption.value} kW</span>
          </div>
        ) : null}
        {utilization ? (
          <div className="chart-tooltip-row">
            <span className="chart-tooltip-dot" style={{ background: '#f59e0b' }} />
            <span className="chart-tooltip-name">Capacidad utilizada</span>
            <span className="chart-tooltip-value">{utilization.value}%</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function PlantsComparisonChart({ plants }) {
  return (
    <section className="panel comparison-panel fade-up">
      <div className="comparison-panel-head">
        <div>
          <div className="panel-title">Comparativo entre plantas</div>
          <div className="panel-subtitle">
            Consumo total actual y porcentaje de capacidad utilizada para las plantas seleccionadas.
          </div>
        </div>
      </div>

      <div className="comparison-chart-wrap">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={plants} barCategoryGap={18}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: '#9fb1cc', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left" tick={{ fill: '#9fb1cc', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={(value) => `${value}%`} tick={{ fill: '#9fb1cc', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 100]} />
            <Tooltip content={<ComparisonTooltip />} />
            <Bar yAxisId="left" dataKey="currentLoad" radius={[10, 10, 0, 0]}>
              {plants.map((plant) => (
                <Cell
                  key={plant.id}
                  fill={
                    plant.indicatorClass === 'critical'
                      ? '#e9082c'
                      : plant.indicatorClass === 'warning'
                        ? '#f59e0b'
                        : '#10b981'
                  }
                />
              ))}
            </Bar>
            <Bar yAxisId="right" dataKey="utilizationPct" fill="rgba(255,255,255,0.28)" radius={[10, 10, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
