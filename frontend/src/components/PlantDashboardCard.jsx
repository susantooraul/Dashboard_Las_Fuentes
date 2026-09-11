import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

function MiniTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">{label}</div>
      <div className="chart-tooltip-list">
        <div className="chart-tooltip-row">
          <span className="chart-tooltip-dot" style={{ background: '#e9082c' }} />
          <span className="chart-tooltip-name">Consumo</span>
          <span className="chart-tooltip-value">{payload[0].value} kW</span>
        </div>
      </div>
    </div>
  );
}

export default function PlantDashboardCard({ plant }) {
  return (
    <article className="panel plant-dashboard-card fade-up">
      <div className="plant-card-head">
        <div>
          <div className="plant-card-label">Planta eléctrica</div>
          <div className="plant-card-title">{plant.name}</div>
        </div>
        <div className={`plant-status-chip ${plant.indicatorClass}`}>{plant.statusLabel}</div>
      </div>

      <div className="plant-metrics-grid">
        <div>
          <div className="plant-metric-label">Consumo total</div>
          <div className="plant-metric-value">{plant.currentLoad} <span>kW</span></div>
        </div>
        <div>
          <div className="plant-metric-label">Capacidad utilizada</div>
          <div className="plant-capacity-value">{plant.utilizationPct}<span>%</span></div>
        </div>
      </div>

      <div className="plant-capacity-row">
        <div className={`plant-indicator ${plant.indicatorClass}`}>
          <span className="plant-indicator-dot" />
          <span>{plant.trendLabel}</span>
        </div>
        <div className="plant-capacity-meta">
          <span>Capacidad total</span>
          <strong>{plant.capacityTotal} kW</strong>
        </div>
      </div>

      <div className="capacity-progress">
        <div className="capacity-progress-track">
          <div className={`capacity-progress-fill ${plant.indicatorClass}`} style={{ width: `${plant.utilizationPct}%` }} />
        </div>
      </div>

      <div className="plant-chart-wrap">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={plant.history}>
            <defs>
              <linearGradient id={`plant-gradient-${plant.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#e9082c" stopOpacity={0.45} />
                <stop offset="95%" stopColor="#e9082c" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#9fb1cc', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis hide domain={['dataMin - 10', 'dataMax + 10']} />
            <Tooltip content={<MiniTooltip />} />
            <Area
              type="monotone"
              dataKey="consumo"
              stroke="#e9082c"
              strokeWidth={2.5}
              fill={`url(#plant-gradient-${plant.id})`}
              dot={false}
              activeDot={{ r: 4, fill: '#fff', stroke: '#e9082c', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="plant-card-footer">
        <div className="plant-footer-item">
          <span>Pico</span>
          <strong>{plant.peakLoad} kW</strong>
        </div>
        <div className="plant-footer-item">
          <span>Promedio</span>
          <strong>{plant.averageLoad} kW</strong>
        </div>
        <div className="plant-footer-item">
          <span>Disponible</span>
          <strong>{plant.availableCapacity} kW</strong>
        </div>
      </div>
    </article>
  );
}
