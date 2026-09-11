import { useMemo, useState, type CSSProperties } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import ChartEmptyState from './ChartEmptyState';
import ChartTooltip from './ChartTooltip';

export interface FlowChartRow {
  name: string;
  flujo: number;
  ubicacion?: string;
  nombre?: string;
  label?: string;
}

export interface FlowChartHistoryRow {
  bucket: string;
  label: string;
  wellKey: string;
  wellLabel: string;
  wellFullLabel: string;
  flujo: number;
  sortKey: string;
}

interface FlowChartOptionsProps {
  rows: FlowChartRow[];
  historyRows?: FlowChartHistoryRow[];
  historyPeriod?: string;
  historyLoading?: boolean;
  historyError?: string;
  onVariantChange?: (variant: FlowChartVariant) => void;
}

export type FlowChartVariant = 'simple' | 'colored' | 'area' | 'executive' | 'history';

type FlowChartDisplayRow = FlowChartRow & {
  fullLabel: string;
};

interface YAxisScale {
  max: number;
  ticks: number[];
}

interface LollipopBarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
}

interface HistorySeries {
  key: string;
  label: string;
  fullLabel: string;
  color: string;
}

type HistoryChartPoint = Record<string, unknown> & {
  bucket: string;
  hour: string;
  sortKey: string;
};

interface HistoryTooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  color?: string;
  stroke?: string;
  value?: unknown;
}

interface HistoryTooltipProps {
  active?: boolean;
  payload?: HistoryTooltipEntry[];
  label?: string | number;
  seriesByKey: Map<string, HistorySeries>;
}

const axisColor = '#b9e7ff';
const gridColor = 'rgba(56,189,248,0.14)';
const flowPalette = ['#14b8ff', '#22c55e', '#a855f7', '#f472b6', '#fb7185', '#2dd4bf', '#60a5fa', '#34d399', '#e879f9', '#f87171'];

const chartOptions: Array<{ id: FlowChartVariant; label: string; helper: string }> = [
  { id: 'simple', label: 'Actual', helper: 'Barras simples' },
  { id: 'colored', label: 'Opción 1', helper: 'Barras por pozo' },
  { id: 'area', label: 'Opción 2', helper: 'Puntos por pozo' },
  { id: 'executive', label: 'Opción 3', helper: 'Ejecutivo' },
  { id: 'history', label: 'Opción 4', helper: 'Histórico por hora' },
];

function formatFlow(value: number): string {
  return value.toLocaleString('es-MX', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

function colorForIndex(index: number): string {
  return flowPalette[index % flowPalette.length];
}

function maxFlow(rows: FlowChartRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.flujo || 0)), 0);
}

function displayLabel(row: FlowChartRow): string {
  return row.label || [row.name, row.ubicacion || row.nombre].filter(Boolean).join(' · ');
}

function compactLabelPart(value: string): string {
  return value
    .replace(/Guadalupe/gi, 'Gpe.')
    .replace(/Estacionamiento/gi, 'Estac.')
    .replace(/Estación/gi, 'Est.')
    .replace(/Estacion/gi, 'Est.')
    .replace(/Principal/gi, 'Ppal.')
    .replace(/Producción/gi, 'Prod.')
    .replace(/Produccion/gi, 'Prod.')
    .replace(/Tratamiento/gi, 'Trat.')
    .replace(/Industrial/gi, 'Ind.')
    .replace(/Banco/gi, 'Bco.')
    .replace(/Cisterna/gi, 'Cist.')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortAxisLabel(value: string | number): string {
  const label = compactLabelPart(String(value || ''));
  return label.length > 28 ? `${label.slice(0, 25)}...` : label;
}

function shortLegendLabel(value: string | number): string {
  const label = compactLabelPart(String(value || ''));
  return label.length > 30 ? `${label.slice(0, 27)}...` : label;
}

function yAxisStep(maxValue: number): number {
  if (maxValue <= 26) return 2;
  if (maxValue <= 55) return 5;
  if (maxValue <= 120) return 10;
  const roughStep = Math.ceil(maxValue / 8);
  return Math.ceil(roughStep / 10) * 10;
}

function buildYAxisScale(maxValue: number): YAxisScale {
  const step = yAxisStep(maxValue);
  const paddedMax = Math.max(step, maxValue * 1.16);
  const max = Math.ceil(paddedMax / step) * step;
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, index) => index * step);
  return { max, ticks };
}

function LollipopBarShape(props: LollipopBarShapeProps) {
  const x = Number(props.x || 0);
  const y = Number(props.y || 0);
  const width = Number(props.width || 0);
  const height = Number(props.height || 0);
  const color = colorForIndex(Number(props.index || 0));
  const centerX = x + width / 2;
  const baseY = y + height;

  return (
    <g>
      <line x1={centerX} y1={baseY} x2={centerX} y2={y + 5} stroke={color} strokeWidth={4} strokeLinecap="round" opacity={0.62} />
      <circle cx={centerX} cy={y + 5} r={7} fill={color} stroke="#07111f" strokeWidth={3} />
    </g>
  );
}

function HistoryTooltip({ active, payload, label, seriesByKey }: HistoryTooltipProps) {
  const visibleEntries = (payload || []).filter((entry) => entry.value !== null && entry.value !== undefined && !Number.isNaN(Number(entry.value)));
  if (!active || !visibleEntries.length) return null;
  return (
    <div className="chart-tooltip solid-tooltip pozos-tooltip">
      {label ? <div className="chart-tooltip-label">{label}</div> : null}
      <div className="chart-tooltip-list">
        {visibleEntries.map((entry, index) => {
          const key = String(entry.dataKey || '');
          const series = seriesByKey.get(key);
          return (
            <div className="chart-tooltip-row" key={`${key}-${index}`}>
              <span className="chart-tooltip-dot" style={{ background: entry.color || entry.stroke || series?.color || '#fff' }} />
              <span className="chart-tooltip-name">{series?.fullLabel || entry.name || key}</span>
              <span className="chart-tooltip-value">{formatFlow(Number(entry.value || 0))} L/s</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryLegend({ series }: { series: HistorySeries[] }) {
  if (!series.length) return null;
  return (
    <div style={historyLegendStyle}>
      {series.map((item) => (
        <span key={item.key} style={historyLegendItemStyle} title={item.fullLabel}>
          <span style={{ ...historyLegendDotStyle, background: item.color }} />
          <span style={historyLegendLabelStyle}>{shortLegendLabel(item.fullLabel)}</span>
        </span>
      ))}
    </div>
  );
}

const chartShellStyle: CSSProperties = {
  minHeight: 570,
};

const chartMetricRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  margin: '2px 0 10px',
  flexWrap: 'wrap',
};

const chartMetricBadgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 999,
  border: '1px solid rgba(56, 189, 248, .22)',
  background: 'rgba(8, 47, 73, .38)',
  color: '#dff6ff',
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '.02em',
  padding: '6px 10px',
  whiteSpace: 'nowrap',
};

const chartMetricHintStyle: CSSProperties = {
  color: '#9bdcf8',
  fontSize: 12,
  lineHeight: 1.35,
};

const chartNoteStyle: CSSProperties = {
  color: '#9bdcf8',
  fontSize: 13,
  margin: '-2px 0 12px',
};

const executiveGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 10,
  marginBottom: 10,
};

const executiveCardStyle: CSSProperties = {
  padding: '9px 12px',
  borderRadius: 16,
  border: '1px solid rgba(148, 163, 184, .16)',
  background: 'linear-gradient(135deg, rgba(15, 23, 42, .74), rgba(8, 47, 73, .36))',
};

const executiveListStyle: CSSProperties = {
  display: 'grid',
  gap: 5,
};

const executiveLabelStyle: CSSProperties = {
  color: '#f8fbff',
  fontSize: 13,
  lineHeight: 1.18,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const historyLegendStyle: CSSProperties = {
  display: 'flex',
  gap: '8px 12px',
  alignItems: 'center',
  flexWrap: 'wrap',
  margin: '0 0 10px',
  padding: '8px 10px',
  borderRadius: 16,
  background: 'rgba(15, 23, 42, .42)',
  border: '1px solid rgba(148, 163, 184, .12)',
};

const historyLegendItemStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  maxWidth: 220,
};

const historyLegendDotStyle: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 999,
  flex: '0 0 auto',
};

const historyLegendLabelStyle: CSSProperties = {
  color: '#dff6ff',
  fontSize: 12,
  fontWeight: 800,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const chartMargin = { top: 18, right: 32, bottom: 116, left: 8 };
const lollipopChartMargin = { top: 22, right: 32, bottom: 116, left: 8 };
const historyChartMargin = { top: 18, right: 28, bottom: 72, left: 8 };
const chartTick = { fill: axisColor, fontSize: 11, fontWeight: 700 };

function ChartMetricHeader({ hint, label = 'Flujo actual (L/s)' }: { hint: string; label?: string }) {
  return (
    <div style={chartMetricRowStyle}>
      <span style={chartMetricBadgeStyle}>{label}</span>
      <span style={chartMetricHintStyle}>{hint}</span>
    </div>
  );
}

export default function FlowChartOptions({
  rows,
  historyRows = [],
  historyPeriod = 'hourly',
  historyLoading = false,
  historyError = '',
  onVariantChange,
}: FlowChartOptionsProps) {
  const [variant, setVariant] = useState<FlowChartVariant>('simple');
  const chartRows = useMemo<FlowChartDisplayRow[]>(() => rows.map((row) => ({ ...row, fullLabel: displayLabel(row) })), [rows]);
  const maxValue = useMemo(() => maxFlow(chartRows), [chartRows]);
  const yAxisScale = useMemo(() => buildYAxisScale(maxValue), [maxValue]);
  const averageValue = useMemo(() => {
    if (!chartRows.length) return 0;
    return chartRows.reduce((sum, row) => sum + Number(row.flujo || 0), 0) / chartRows.length;
  }, [chartRows]);
  const peakRow = useMemo(() => chartRows.reduce<FlowChartDisplayRow | null>((peak, row) => (!peak || row.flujo > peak.flujo ? row : peak), null), [chartRows]);
  const historyChart = useMemo(() => {
    const buckets = new Map<string, HistoryChartPoint>();
    const series = new Map<string, HistorySeries>();

    historyRows.forEach((row) => {
      const key = String(row.wellKey || '').trim();
      const bucket = String(row.bucket || '').trim();
      const flow = Number(row.flujo);
      if (!key || !bucket || Number.isNaN(flow)) return;

      if (!series.has(key)) {
        series.set(key, {
          key,
          label: row.wellLabel,
          fullLabel: row.wellFullLabel || row.wellLabel,
          color: colorForIndex(series.size),
        });
      }

      const point = buckets.get(bucket) || {
        bucket,
        hour: row.label || bucket,
        sortKey: row.sortKey || bucket,
      };
      point[key] = flow;
      buckets.set(bucket, point);
    });

    const points = Array.from(buckets.values()).sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
    const seriesList = Array.from(series.values());
    const seriesByKey = new Map(seriesList.map((item) => [item.key, item]));
    return { points, series: seriesList, seriesByKey };
  }, [historyRows]);
  const historyMaxValue = useMemo(() => historyRows.reduce((max, row) => Math.max(max, Number(row.flujo || 0)), 0), [historyRows]);
  const historyYAxisScale = useMemo(() => buildYAxisScale(historyMaxValue), [historyMaxValue]);
  const historyTickInterval = historyChart.points.length > 16 ? Math.ceil(historyChart.points.length / 10) - 1 : 0;
  const hasCurrentRows = chartRows.length > 0;
  const hasHistoryRows = historyChart.points.length > 0 && historyChart.series.length > 0;
  const historyHint = historyPeriod === 'daily'
    ? 'Agrupación diaria del rango seleccionado; cada línea representa un pozo.'
    : historyPeriod === 'monthly'
      ? 'Agrupación mensual del rango seleccionado; cada línea representa un pozo.'
      : 'Puntos horarios del rango seleccionado; cada línea representa un pozo.';

  if (!hasCurrentRows && !hasHistoryRows) {
    return <ChartEmptyState message="Sin lecturas de flujo L/s disponibles para pozos en este periodo." />;
  }

  return (
    <div style={chartShellStyle}>
      <div className="tabs-row" style={{ marginBottom: 14 }}>
        {chartOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`tab-chip ${variant === option.id ? 'active' : ''}`}
            onClick={() => {
              setVariant(option.id);
              onVariantChange?.(option.id);
            }}
            title={option.helper}
          >
            <span>{option.label}</span>
            <small>{option.helper}</small>
          </button>
        ))}
      </div>

      {variant === 'simple' ? (
        hasCurrentRows ? (
          <>
            <ChartMetricHeader hint="Barras categóricas por pozo con etiquetas abreviadas y tooltip completo." />
            <ResponsiveContainer width="100%" height={500}>
              <ComposedChart data={chartRows} margin={chartMargin}>
                <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                <XAxis dataKey="fullLabel" stroke={axisColor} tick={chartTick} tickFormatter={shortAxisLabel} interval={0} height={116} angle={-26} textAnchor="end" tickMargin={16} />
                <YAxis stroke={axisColor} tick={chartTick} domain={[0, yAxisScale.max]} ticks={yAxisScale.ticks} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                <Bar dataKey="flujo" name="Flujo actual (L/s)" fill="#14b8ff" radius={[10, 10, 0, 0]}>
                  <LabelList dataKey="flujo" position="top" formatter={(value: number) => `${formatFlow(value)} L/s`} fill="#dff6ff" fontSize={12} fontWeight={800} />
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </>
        ) : <ChartEmptyState message="Sin lecturas actuales de flujo L/s disponibles para pozos en este periodo." />
      ) : null}

      {variant === 'colored' ? (
        hasCurrentRows ? (
          <>
            <ChartMetricHeader hint="Opción multicolor por categoría; el color identifica cada pozo, no energía." />
            <ResponsiveContainer width="100%" height={500}>
              <ComposedChart data={chartRows} margin={chartMargin}>
                <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                <XAxis dataKey="fullLabel" stroke={axisColor} tick={chartTick} tickFormatter={shortAxisLabel} interval={0} height={116} angle={-26} textAnchor="end" tickMargin={16} />
                <YAxis stroke={axisColor} tick={chartTick} domain={[0, yAxisScale.max]} ticks={yAxisScale.ticks} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                <Bar dataKey="flujo" name="Flujo actual (L/s)" radius={[10, 10, 0, 0]}>
                  {chartRows.map((row, index) => <Cell key={row.name} fill={colorForIndex(index)} />)}
                  <LabelList dataKey="flujo" position="top" formatter={(value: number) => `${formatFlow(value)}`} fill="#dff6ff" fontSize={12} fontWeight={800} />
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </>
        ) : <ChartEmptyState message="Sin lecturas actuales de flujo L/s disponibles para pozos en este periodo." />
      ) : null}

      {variant === 'area' ? (
        hasCurrentRows ? (
          <>
            <ChartMetricHeader hint="Lollipop chart: cada pozo es independiente y no hay línea entre categorías." />
            <p style={chartNoteStyle}>Comparación por pozo: la guía vertical va de 0 al valor y el punto superior marca el flujo actual.</p>
            <ResponsiveContainer width="100%" height={480}>
              <ComposedChart data={chartRows} margin={lollipopChartMargin}>
                <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                <XAxis dataKey="fullLabel" stroke={axisColor} tick={chartTick} tickFormatter={shortAxisLabel} interval={0} height={116} angle={-26} textAnchor="end" tickMargin={16} />
                <YAxis stroke={axisColor} tick={chartTick} domain={[0, yAxisScale.max]} ticks={yAxisScale.ticks} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'rgba(20,184,255,.24)', strokeWidth: 1 }} />
                <Bar
                  dataKey="flujo"
                  name="Flujo actual (L/s)"
                  barSize={18}
                  fill="transparent"
                  shape={(props: unknown) => <LollipopBarShape {...(props as LollipopBarShapeProps)} />}
                >
                  <LabelList dataKey="flujo" position="top" formatter={(value: number) => `${formatFlow(value)} L/s`} fill="#dff6ff" fontSize={12} fontWeight={800} offset={12} />
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </>
        ) : <ChartEmptyState message="Sin lecturas actuales de flujo L/s disponibles para pozos en este periodo." />
      ) : null}

      {variant === 'executive' ? (
        hasCurrentRows ? (
          <div>
            <div style={executiveGridStyle}>
              <article style={executiveCardStyle}>
                <span className="eyebrow">Mayor flujo</span>
                <strong style={{ display: 'block', color: '#f8fbff', fontSize: 22, marginTop: 3 }}>{peakRow ? formatFlow(peakRow.flujo) : '—'} L/s</strong>
                <small style={{ color: '#9bdcf8', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={peakRow ? displayLabel(peakRow) : undefined}>{peakRow ? displayLabel(peakRow) : 'Sin lectura'}</small>
              </article>
              <article style={executiveCardStyle}>
                <span className="eyebrow">Promedio operativo</span>
                <strong style={{ display: 'block', color: '#f8fbff', fontSize: 22, marginTop: 3 }}>{formatFlow(averageValue)} L/s</strong>
                <small style={{ color: '#9bdcf8' }}>Promedio de pozos con lectura</small>
              </article>
              <article style={executiveCardStyle}>
                <span className="eyebrow">Pozos con flujo</span>
                <strong style={{ display: 'block', color: '#f8fbff', fontSize: 22, marginTop: 3 }}>{chartRows.length}</strong>
                <small style={{ color: '#9bdcf8' }}>Lecturas disponibles del periodo</small>
              </article>
            </div>

            <div style={executiveListStyle}>
              {chartRows.map((row, index) => {
                const color = colorForIndex(index);
                const width = maxValue > 0 ? Math.max(6, Math.round((row.flujo / maxValue) * 100)) : 0;
                return (
                  <article key={row.name} style={{ padding: '6px 10px', borderRadius: 12, background: 'rgba(15, 23, 42, .6)', border: '1px solid rgba(148, 163, 184, .12)' }} title={displayLabel(row)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 4, minWidth: 0 }}>
                      <strong style={executiveLabelStyle}>{displayLabel(row)}</strong>
                      <span style={{ color, fontWeight: 900, whiteSpace: 'nowrap', fontSize: 16 }}>{formatFlow(row.flujo)} L/s</span>
                    </div>
                    <div style={{ height: 7, borderRadius: 999, background: 'rgba(148, 163, 184, .12)', overflow: 'hidden' }}>
                      <div style={{ width: `${width}%`, height: '100%', borderRadius: 999, background: `linear-gradient(90deg, ${color}, rgba(255,255,255,.72))`, boxShadow: `0 0 14px ${color}55` }} />
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : <ChartEmptyState message="Sin lecturas actuales de flujo L/s disponibles para pozos en este periodo." />
      ) : null}

      {variant === 'history' ? (
        historyLoading && !hasHistoryRows ? (
          <ChartEmptyState message="Cargando histórico horario de pozos..." />
        ) : hasHistoryRows ? (
          <>
            <ChartMetricHeader label="Flujo histórico (L/s)" hint={historyHint} />
            <HistoryLegend series={historyChart.series} />
            <ResponsiveContainer width="100%" height={520}>
              <ComposedChart data={historyChart.points} margin={historyChartMargin}>
                <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                <XAxis dataKey="hour" stroke={axisColor} tick={chartTick} interval={historyTickInterval} height={72} angle={-18} textAnchor="end" tickMargin={14} />
                <YAxis stroke={axisColor} tick={chartTick} domain={[0, historyYAxisScale.max]} ticks={historyYAxisScale.ticks} allowDecimals={false} />
                <Tooltip content={<HistoryTooltip seriesByKey={historyChart.seriesByKey} />} cursor={{ stroke: 'rgba(185,231,255,.18)', strokeWidth: 1 }} />
                {historyChart.series.map((seriesItem) => (
                  <Line
                    key={seriesItem.key}
                    type="monotone"
                    dataKey={seriesItem.key}
                    name={seriesItem.fullLabel}
                    stroke={seriesItem.color}
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 1.5 }}
                    activeDot={{ r: 6, strokeWidth: 2 }}
                    connectNulls={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </>
        ) : <ChartEmptyState message={historyError || "Sin histórico horario disponible para este rango."} />
      ) : null}
    </div>
  );
}
