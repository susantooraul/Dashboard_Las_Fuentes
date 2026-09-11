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
import { buildEntryExitRows, buildProductionSeries } from '../chartBuilders';
import { defaultTodayRange } from '../dateUtils';
import type { ChartDataPoint, DashboardData, FlexibleRecord } from '../types';
import ChartEmptyState from '../components/ChartEmptyState';
import ChartPeriodNote from '../components/ChartPeriodNote';
import ChartTooltip from '../components/ChartTooltip';
import PanelHeader from '../components/PanelHeader';
import SqlChartDateControls from '../components/SqlChartDateControls';
import StatusBadge from '../components/StatusBadge';
import useSqlChartDashboard from '../hooks/useSqlChartDashboard';

const axisColor = '#b9e7ff';
const gridColor = 'rgba(56,189,248,0.14)';

type BalanceStatus = 'normal' | 'warning' | 'communication';

interface StageBalanceRow extends ChartDataPoint {
  key: string;
  label: string;
  entrada: number;
  salida: number;
  diferencia: number;
  diferenciaPct: number | null;
  status: BalanceStatus;
  statusLabel: string;
}

function numeric(value: unknown): number {
  const parsed = Number(String(value ?? 0).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number, decimals = 1): string {
  return value.toLocaleString('es-MX', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: Math.abs(value) > 0 && Math.abs(value) < 10 ? Math.min(decimals, 2) : 0,
  });
}

function formatSigned(value: number, unit: string): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value, 2)} ${unit}`;
}

function normalizeLabel(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function stageKeyFromLabel(label: unknown): string {
  const normalized = normalizeLabel(label);
  if (normalized.includes('pozo')) return 'pozos';
  if (normalized.includes('tratamiento')) return 'tratamiento';
  if (normalized.includes('linea')) return 'lineas';
  return normalized || 'etapa';
}

function stageDisplayLabel(label: unknown): string {
  const key = stageKeyFromLabel(label);
  if (key === 'pozos') return 'Pozos';
  if (key === 'tratamiento') return 'Tratamiento';
  if (key === 'lineas') return 'Líneas';
  return String(label || 'Etapa');
}

function balanceUnit(dashboard?: DashboardData | null): string {
  const summary = (dashboard?.treatment_flow_summary || {}) as FlexibleRecord;
  return String(summary.balance_unit || 'm³');
}

function balanceBasisLabel(dashboard?: DashboardData | null): string {
  const summary = (dashboard?.treatment_flow_summary || {}) as FlexibleRecord;
  const unit = balanceUnit(dashboard);
  const basis = String(summary.balance_basis || '').toLowerCase();
  if (basis.includes('flow') || unit.toLowerCase().includes('l/s')) return 'flujo actual';
  return 'volumen del periodo';
}

function stageStatus(entrada: number, salida: number, pct: number | null): { status: BalanceStatus; label: string } {
  if (entrada <= 0 && salida <= 0) return { status: 'communication', label: 'Sin datos' };
  if (pct !== null && Math.abs(pct) > 20) return { status: 'warning', label: 'Revisar' };
  return { status: 'normal', label: 'Normal' };
}

function buildStageRows(dashboard?: DashboardData | null): StageBalanceRow[] {
  const rows = buildEntryExitRows(dashboard);
  return rows.map((row) => {
    const entrada = numeric(row.entrada);
    const salida = numeric(row.salida);
    const diferencia = entrada - salida;
    const diferenciaPct = entrada > 0 ? (diferencia / entrada) * 100 : null;
    const status = stageStatus(entrada, salida, diferenciaPct);
    const label = stageDisplayLabel(row.label);
    return {
      ...row,
      key: stageKeyFromLabel(row.label),
      label,
      entrada,
      salida,
      diferencia,
      diferenciaPct,
      status: status.status,
      statusLabel: status.label,
    };
  });
}

function findStage(rows: StageBalanceRow[], key: string): StageBalanceRow | undefined {
  return rows.find((row) => row.key === key);
}

function metricName(value: unknown): string {
  const name = String(value || 'Métrica operativa');
  const normalized = normalizeLabel(name);
  if (normalized.includes('entrada') && normalized.includes('tratamiento')) return 'Entrada a tratamiento';
  if (normalized.includes('salida') && normalized.includes('tratamiento')) return 'Salida de tratamiento';
  if (normalized.includes('caldera')) return 'Flujo Calderas';
  if (normalized.includes('dura')) return 'Flujo Dura';
  return name.replace(/\bsensor\s*\d+\b/gi, '').replace(/\s+/g, ' ').trim() || 'Métrica operativa';
}

function operationalDetail(unit: string, dashboard?: DashboardData | null): string {
  return balanceBasisLabel(dashboard) === 'flujo actual'
    ? `Flujo actual validado para balance (${unit}).`
    : `Volumen del periodo validado para balance (${unit}).`;
}

function metricRows(dashboard?: DashboardData | null): Array<{ name: string; value: number; unit: string; detail: string }> {
  const rows = Array.isArray(dashboard?.water_consumption) ? dashboard.water_consumption : [];
  return rows
    .map((row: FlexibleRecord) => ({
      name: metricName(row.name || row.label),
      value: numeric(row.value ?? row.period_m3 ?? row.volumen_periodo_m3),
      unit: String(row.unit || balanceUnit(dashboard)),
      detail: operationalDetail(String(row.unit || balanceUnit(dashboard)), dashboard),
    }))
    .filter((row) => row.value !== 0 || row.detail);
}

function sanitizedPeriodNote(dashboard?: DashboardData | null): string {
  const summary = (dashboard?.treatment_flow_summary || {}) as FlexibleRecord;
  const note = String(summary.period_volume_note || summary.calculation_note || '').toLowerCase();
  if (note) return 'Medición operativa validada para el periodo seleccionado.';
  return balanceBasisLabel(dashboard) === 'flujo actual'
    ? 'Comparativo con lecturas actuales de operación.'
    : 'Comparativo con volumen del periodo seleccionado.';
}

function BalanceSection() {
  const balanceChart = useSqlChartDashboard('balance', defaultTodayRange, { includePeriodDeltas: true });
  const dashboardData = balanceChart.dashboard as DashboardData | null;
  const balanceSeries = buildProductionSeries(dashboardData, balanceChart.range);
  const stageRows = buildStageRows(dashboardData);
  const metrics = metricRows(dashboardData);
  const unit = balanceUnit(dashboardData);
  const basisLabel = balanceBasisLabel(dashboardData);

  const pozos = findStage(stageRows, 'pozos');
  const tratamiento = findStage(stageRows, 'tratamiento');
  const lineas = findStage(stageRows, 'lineas');
  const totalInput = numeric(pozos?.entrada ?? tratamiento?.entrada);
  const treatmentInput = numeric(tratamiento?.entrada ?? pozos?.salida);
  const treatmentOutput = numeric(tratamiento?.salida ?? lineas?.entrada);
  const lineOutput = numeric(lineas?.salida ?? treatmentOutput);
  const totalDifference = totalInput - lineOutput;
  const totalDifferencePct = totalInput > 0 ? (totalDifference / totalInput) * 100 : null;

  const kpiCards = [
    {
      label: 'Entrada de pozos',
      value: formatNumber(totalInput, 2),
      unit,
      trend: basisLabel,
      accent: 'blue',
    },
    {
      label: 'Entrada a tratamiento',
      value: formatNumber(treatmentInput, 2),
      unit,
      trend: basisLabel,
      accent: 'cyan',
    },
    {
      label: 'Salida de tratamiento',
      value: formatNumber(treatmentOutput, 2),
      unit,
      trend: basisLabel,
      accent: 'teal',
    },
    {
      label: 'Salida a líneas',
      value: formatNumber(lineOutput, 2),
      unit,
      trend: basisLabel,
      accent: 'indigo',
    },
  ].filter((card) => numeric(card.value) !== 0 || stageRows.length);

  const maxMetric = Math.max(...metrics.map((item) => Math.abs(item.value)), 1);

  return (
    <>
      <section className="water-balance-hero panel fade-up">
        <div>
          <h2>Balance de Agua</h2>
          <p>Comparativo operativo de entrada, salida y diferencia por etapa.</p>
          <p className="water-balance-mode">Mostrando {basisLabel} en {unit}.</p>
        </div>
        <div className="water-balance-hero-grid">
          <article>
            <span>Entrada de pozos</span>
            <strong>{formatNumber(totalInput, 2)} <small>{unit}</small></strong>
          </article>
          <article>
            <span>Salida a líneas</span>
            <strong>{formatNumber(lineOutput, 2)} <small>{unit}</small></strong>
          </article>
          <article className={totalDifference >= 0 ? 'positive' : 'warning'}>
            <span>Diferencia total</span>
            <strong>{formatSigned(totalDifference, unit)}</strong>
          </article>
          <article>
            <span>Variación</span>
            <strong>{totalDifferencePct === null ? '—' : `${totalDifferencePct >= 0 ? '+' : ''}${totalDifferencePct.toFixed(1)}%`}</strong>
          </article>
        </div>
      </section>

      {kpiCards.length ? (
        <section className="cards-grid water-balance-kpi-grid">
          {kpiCards.map((card, index) => (
            <KpiCard key={card.label} {...card} style={{ animationDelay: `${index * 60}ms` }} />
          ))}
        </section>
      ) : null}

      <section className="content-grid water-balance-main-grid">
        <div className="panel chart-panel fade-up">
          <PanelHeader title="Entradas vs salidas por etapa" subtitle={`Comparativo de ${basisLabel} por etapa del sistema`} />
          <SqlChartDateControls controller={balanceChart} />
          <ChartPeriodNote range={balanceChart.range} source={sanitizedPeriodNote(dashboardData)} />
          {stageRows.length ? (
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={stageRows} margin={{ top: 10, right: 18, bottom: 8, left: 4 }}>
                <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke={axisColor} />
                <YAxis stroke={axisColor} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                <Legend />
                <Bar dataKey="entrada" name={`Entrada (${unit})`} fill="#0ea5e9" radius={[10, 10, 0, 0]} />
                <Bar dataKey="salida" name={`Salida (${unit})`} fill="#38bdf8" radius={[10, 10, 0, 0]} />
                <Line type="monotone" dataKey="diferencia" name={`Diferencia (${unit})`} stroke="#f59e0b" strokeWidth={2.3} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <ChartEmptyState message="Sin datos suficientes para balance del periodo." />}
        </div>

        <div className="panel summary-panel fade-up water-balance-summary-panel">
          <PanelHeader title="Resumen del periodo" subtitle="Lectura ejecutiva de entradas y salidas" />
          <div className="water-balance-summary-stack">
            <article>
              <span>Estado del balance</span>
              <strong>{stageRows.length ? 'Medición operativa' : 'Sin datos del periodo'}</strong>
              <p>{stageRows.length ? `La comparación usa ${basisLabel} del periodo seleccionado.` : 'No hay lecturas suficientes para construir el balance.'}</p>
            </article>
            <article>
              <span>Criterio temporal</span>
              <strong>{basisLabel === 'flujo actual' ? 'Lectura actual' : 'Volumen del periodo'}</strong>
              <p>No mezcla lecturas instantáneas con volúmenes acumulados.</p>
            </article>
            <article>
              <span>Tratamiento</span>
              <strong>Entrada y salida de tratamiento</strong>
              <p>Comparativo operativo validado para el balance hidráulico.</p>
            </article>
          </div>
        </div>
      </section>

      {stageRows.length ? (
        <section className="panel fade-up water-balance-stage-panel">
          <PanelHeader title="Balance por etapa" subtitle="Entrada, salida y diferencia operativa" />
          <div className="water-balance-stage-grid">
            {stageRows.map((row) => (
              <article className={`water-balance-stage-card ${row.status}`} key={row.key}>
                <div className="water-balance-stage-head">
                  <div>
                    <span>Etapa</span>
                    <strong>{row.label}</strong>
                  </div>
                  <StatusBadge type={row.status}>{row.statusLabel}</StatusBadge>
                </div>
                <dl>
                  <div>
                    <dt>Entrada</dt>
                    <dd>{formatNumber(row.entrada, 2)} {unit}</dd>
                  </div>
                  <div>
                    <dt>Salida</dt>
                    <dd>{formatNumber(row.salida, 2)} {unit}</dd>
                  </div>
                  <div>
                    <dt>Diferencia</dt>
                    <dd>{formatSigned(row.diferencia, unit)}</dd>
                  </div>
                  <div>
                    <dt>Porcentaje</dt>
                    <dd>{row.diferenciaPct === null ? '—' : `${row.diferenciaPct >= 0 ? '+' : ''}${row.diferenciaPct.toFixed(1)}%`}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {metrics.length ? (
        <section className="panel fade-up water-type-panel">
          <PanelHeader title="Balance por flujo" subtitle="Mediciones operativas del periodo seleccionado" />
          <div className="water-type-grid">
            {metrics.map((item) => {
              const pct = Math.min(100, Math.max(0, Math.abs(item.value) / maxMetric * 100));
              return (
                <article className="water-type-card normal" key={item.name}>
                  <div className="water-type-head">
                    <div>
                      <span>{item.unit}</span>
                      <strong>{item.name}</strong>
                    </div>
                    <StatusBadge type="normal">Operativo</StatusBadge>
                  </div>
                  <div className="water-type-bars">
                    <div>
                      <span>{basisLabel === 'flujo actual' ? 'Flujo actual' : 'Volumen del periodo'}</span>
                      <div className="water-type-track"><em style={{ width: `${pct}%` }} /></div>
                      <strong>{formatNumber(item.value, 2)} {item.unit}</strong>
                    </div>
                  </div>
                  <div className="water-type-foot">
                    <span>Criterio</span>
                    <strong>{basisLabel === 'flujo actual' ? 'Lectura operativa' : 'Volumen del periodo'}</strong>
                    <p>{item.detail}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {balanceSeries.length ? (
        <section className="panel chart-panel fade-up">
          <PanelHeader title="Agua y energía del periodo" subtitle="Referencia secundaria cuando hay datos válidos" />
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={balanceSeries} margin={{ top: 10, right: 18, bottom: 8, left: 4 }}>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
              <XAxis dataKey="hour" stroke={axisColor} />
              <YAxis yAxisId="left" stroke={axisColor} />
              <YAxis yAxisId="right" orientation="right" stroke="#7dd3fc" />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
              <Legend />
              <Bar yAxisId="left" dataKey="agua" name="Agua bombeada (m³)" fill="#0ea5e9" radius={[10, 10, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="energia" name="Energía (kWh)" stroke="#7dd3fc" strokeWidth={2.7} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </section>
      ) : null}
    </>
  );
}

export default BalanceSection;
