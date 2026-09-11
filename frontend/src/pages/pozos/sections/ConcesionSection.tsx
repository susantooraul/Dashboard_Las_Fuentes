import type { CSSProperties } from 'react';
import { AlertTriangle } from 'lucide-react';
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
import KpiCard from '../../../components/KpiCard';
import {
  concesiones,
  concessionAlerts,
  concessionProjection,
  concessionSummary,
} from '../../../data/pozosMock';
import { buildEnergyWaterSeries } from '../chartBuilders';
import type { DashboardData } from '../types';
import ChartEmptyState from '../components/ChartEmptyState';
import ChartTooltip from '../components/ChartTooltip';
import PanelHeader from '../components/PanelHeader';
import SqlChartDateControls from '../components/SqlChartDateControls';
import StatusBadge from '../components/StatusBadge';
import useSqlChartDashboard from '../hooks/useSqlChartDashboard';

const axisColor = '#b9e7ff';
const gridColor = 'rgba(56,189,248,0.14)';

type ConcessionGaugeStyle = CSSProperties & Record<'--used' | '--remaining', string>;

function ConcesionSection() {
  const usedPct = concessionSummary.usedPct;
  const remainingPct = Math.max(0, 100 - usedPct);
  const projectedPct = concessionProjection.projectedPct;
  const concessionChart = useSqlChartDashboard('dashboard');
  const concessionRows = buildEnergyWaterSeries(concessionChart.dashboard as DashboardData | null, concessionChart.range).map((row, index, arr) => ({
    ...row,
    acumulado: arr.slice(0, index + 1).reduce((sum, item) => sum + Number(item.agua || 0), 0),
  }));

  return (
    <>
      <section className="concession-hero panel fade-up">
        <div className="concession-hero-copy">
          <h2>Concesión</h2>
          <p>Da seguimiento al volumen autorizado y consumido.</p>
        </div>
        <div className="concession-gauge-wrap">
          <div className="concession-gauge" style={{ '--used': `${usedPct}%`, '--remaining': `${remainingPct}%` } as ConcessionGaugeStyle}>
            <div>
              <strong>{usedPct.toFixed(1)}%</strong>
              <span>usado</span>
            </div>
          </div>
          <div className="concession-gauge-caption">
            <span>{concessionSummary.period}</span>
            <strong>{concessionSummary.status}</strong>
          </div>
        </div>
      </section>

      <section className="cards-grid concession-kpi-grid">
        <KpiCard label="Concesión autorizada" value={concessionSummary.authorized.toLocaleString('es-MX')} unit="m³" trend={concessionSummary.validity} accent="red" />
        <KpiCard label="Consumo acumulado" value={concessionSummary.used.toLocaleString('es-MX')} unit="m³" trend="Volumen ejercido en el periodo actual" accent="crimson" />
        <KpiCard label="Remanente" value={concessionSummary.remaining.toLocaleString('es-MX')} unit="m³" trend={`${remainingPct.toFixed(1)}% disponible`} accent="wine" />
        <KpiCard label="Porcentaje usado" value={usedPct.toFixed(1)} unit="%" trend={concessionSummary.cutoff} accent="brown" />
      </section>

      <section className="content-grid concession-main-grid">
        <div className="panel chart-panel fade-up">
          <PanelHeader title="Histórico de consumo de agua" subtitle="Consumo y acumulado del periodo seleccionado" />
          <SqlChartDateControls controller={concessionChart} />
          {concessionRows.length ? (
            <ResponsiveContainer width="100%" height={330}>
              <ComposedChart data={concessionRows}>
                <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                <XAxis dataKey="hour" stroke={axisColor} />
                <YAxis stroke={axisColor} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                <Legend />
                <Bar dataKey="agua" name="Consumo del periodo (m³)" fill="#0ea5e9" radius={[10, 10, 0, 0]} />
                <Line type="monotone" dataKey="acumulado" name="Acumulado del rango (m³)" stroke="#7dd3fc" strokeWidth={2.6} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <ChartEmptyState message="Sin datos históricos SQL para graficar concesión en este rango." />}
        </div>

        <div className="panel summary-panel fade-up concession-projection-panel">
          <PanelHeader title="Proyección de cierre" subtitle="Lectura ejecutiva con el ritmo actual" />
          <div className="concession-projection-stack">
            <article>
              <span>Tendencia de consumo</span>
              <strong>{concessionProjection.trend}</strong>
              <p>{concessionProjection.trendNote}</p>
            </article>
            <article className={projectedPct >= 90 ? 'warning' : ''}>
              <span>Cierre proyectado</span>
              <strong>{concessionProjection.projectedUsed.toLocaleString('es-MX')} m³</strong>
              <p>{projectedPct.toFixed(1)}% de la concesión autorizada.</p>
            </article>
            <article>
              <span>Margen estimado</span>
              <strong>{concessionProjection.projectedRemaining.toLocaleString('es-MX')} m³</strong>
              <p>{concessionProjection.recommendation}</p>
            </article>
          </div>
        </div>
      </section>

      <section className="content-grid concession-bottom-grid">
        <div className="panel fade-up concession-breakdown-panel">
          <PanelHeader title="Concesiones activas" subtitle="Contratos y vigencias considerados en el uso acumulado" />
          <div className="concession-contract-list">
            {concesiones.map((item) => (
              <article key={item.name}>
                <div>
                  <span>{item.name}</span>
                  <strong>{item.volumen}</strong>
                  <p>{item.vigencia}</p>
                </div>
                <StatusBadge type="normal">{item.status}</StatusBadge>
              </article>
            ))}
          </div>
        </div>

        <div className="panel fade-up concession-alert-panel">
          <PanelHeader title="Alertas de concesión" subtitle="Riesgos que conviene vigilar antes del cierre" />
          <div className="concession-alert-list">
            {concessionAlerts.map((alert) => (
              <article className={alert.level} key={alert.title}>
                <div className="alert-icon"><AlertTriangle size={16} /></div>
                <div>
                  <strong>{alert.title}</strong>
                  <span>{alert.detail}</span>
                </div>
                <em>{alert.priority}</em>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

export default ConcesionSection;
