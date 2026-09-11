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
import type { HistoryAggregation, WaterHistoryPoint, WaterModuleHistorySeries } from '../types';
import WaterHistoryTooltip from './WaterHistoryTooltip';

const axisColor = '#b9e7ff';
const gridColor = 'rgba(56,189,248,0.14)';
const totalizerAxisColor = '#c084fc';
const modulePalette = ['#14b8ff', '#a78bfa', '#34d399', '#f59e0b', '#fb7185', '#facc15', '#38bdf8', '#c084fc'];

type ModuleHistoryMetric = 'flow' | 'totalizer' | 'both';
type ModuleTotalizerDisplay = 'delta' | 'absolute';

interface WaterHistoryChartProps {
  points?: WaterHistoryPoint[];
  aggregation: HistoryAggregation;
  height?: number;
  flowUnit?: string;
  series?: WaterModuleHistorySeries[];
  showVolume?: boolean;
  moduleMetric?: ModuleHistoryMetric;
  moduleTotalizerDisplay?: ModuleTotalizerDisplay;
}

interface ChartPoint {
  timestamp: number;
  bucketStart: string;
  bucketEnd: string;
  flow: number | null;
  flowMin: number | null;
  flowMax: number | null;
  volume: number | null;
  samples: number;
  dataStatus: string;
  rawTotalizerClose: number | null;
  effectiveTotalizerClose: number | null;
  totalizerRetained: boolean;
  tooltipAnchor: number;
}

interface ModuleChartPoint {
  timestamp: number;
  bucketStart: string;
  bucketEnd: string;
  tooltipAnchor: number;
  [key: string]: number | string | null;
}

interface ModuleTooltipSeriesMeta {
  identity: string;
  name: string;
  color: string;
  flowUnit: string;
}

function tickFormatter(value: number, aggregation: HistoryAggregation, spansMultipleDays: boolean): string {
  const date = new Date(value);
  if (aggregation === 'daily') {
    return date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }
  if (spansMultipleDays) {
    return date.toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function seriesIdentity(item: WaterModuleHistorySeries): string {
  return String(item.sensor_id ?? item.operational_key ?? item.name).replace(/[^a-zA-Z0-9_]/g, '_');
}

function valueOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildModuleRows(series: WaterModuleHistorySeries[]): ModuleChartPoint[] {
  const byBucket = new Map<string, ModuleChartPoint>();
  const totalizerBases = new Map<string, number>();

  series.forEach((item) => {
    const identity = seriesIdentity(item);
    const orderedPoints = [...item.points].sort((left, right) => new Date(left.bucket_start).getTime() - new Date(right.bucket_start).getTime());
    const firstValidTotalizer = orderedPoints
      .map((point) => valueOrNull(point.totalizer_close_m3))
      .find((value): value is number => value !== null);
    if (firstValidTotalizer !== undefined) totalizerBases.set(identity, firstValidTotalizer);
  });

  series.forEach((item) => {
    const identity = seriesIdentity(item);
    const totalizerBase = totalizerBases.get(identity);
    item.points.forEach((point) => {
      const timestamp = new Date(point.bucket_start).getTime();
      if (!Number.isFinite(timestamp)) return;
      const row = byBucket.get(point.bucket_start) || {
        timestamp,
        bucketStart: point.bucket_start,
        bucketEnd: point.bucket_end,
        tooltipAnchor: 0,
      };
      const observedTotalizer = valueOrNull(point.totalizer_close_m3);
      row[`flow_${identity}`] = valueOrNull(point.flow_avg_lps);
      const observedRawTotalizer = valueOrNull(point.raw_totalizer_close_m3 ?? point.observed_totalizer_close_m3 ?? point.totalizer_close_m3);
      const effectiveTotalizer = valueOrNull(point.effective_totalizer_close_m3 ?? point.totalizer_close_m3);
      const retained = point.totalizer_retained === true || (observedRawTotalizer === 0 && effectiveTotalizer !== null && effectiveTotalizer > 0);
      row[`totalizer_absolute_${identity}`] = effectiveTotalizer;
      row[`totalizer_observed_${identity}`] = observedRawTotalizer;
      row[`totalizer_effective_${identity}`] = effectiveTotalizer;
      row[`totalizer_retained_${identity}`] = retained ? 1 : 0;
      row[`totalizer_delta_${identity}`] = effectiveTotalizer !== null && totalizerBase !== undefined
        ? effectiveTotalizer - totalizerBase
        : null;
      row[`samples_${identity}`] = Number(point.samples || 0);
      byBucket.set(point.bucket_start, row);
    });
  });
  return [...byBucket.values()].sort((left, right) => Number(left.timestamp) - Number(right.timestamp));
}

function finiteValues(data: ModuleChartPoint[], keys: string[]): number[] {
  return data.flatMap((row) => keys.map((key) => valueOrNull(row[key])).filter((value): value is number => value !== null));
}

function zeroPaddedDomain(values: number[]): [number, number] {
  if (!values.length) return [-1, 1];
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const spread = maxValue - minValue;
  const margin = spread > 0 ? spread * 0.08 : 1;
  return [minValue - margin, maxValue + margin];
}

function formatNumber(value: unknown, unit: string, options: Intl.NumberFormatOptions = {}): string {
  const numericValue = valueOrNull(value);
  if (numericValue === null) return 'Sin datos';
  return `${numericValue.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2, ...options })} ${unit}`;
}

function ModuleTooltip({
  active,
  payload,
  label,
  seriesMeta,
  metricMode,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Record<string, unknown> }>;
  label?: unknown;
  seriesMeta: ModuleTooltipSeriesMeta[];
  metricMode: ModuleHistoryMetric;
}) {
  if (!active || !payload?.length) return null;
  const row = payload.find((entry) => entry?.payload)?.payload;
  if (!row) return null;
  const visible = seriesMeta.filter((item) => (
    valueOrNull(row[`flow_${item.identity}`]) !== null
    || valueOrNull(row[`totalizer_absolute_${item.identity}`]) !== null
    || valueOrNull(row[`totalizer_observed_${item.identity}`]) !== null
    || valueOrNull(row[`totalizer_effective_${item.identity}`]) !== null
    || valueOrNull(row[`totalizer_delta_${item.identity}`]) !== null
  ));
  if (!visible.length) return null;
  const date = new Date(Number(label));
  const showFlow = metricMode === 'flow' || metricMode === 'both';
  return (
    <div className="chart-tooltip solid-tooltip pozos-tooltip module-history-tooltip module-history-tooltip-rich">
      <div className="chart-tooltip-label">
        {Number.isNaN(date.getTime()) ? 'Periodo' : date.toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="chart-tooltip-list">
        {visible.map((item) => {
          const flow = row[`flow_${item.identity}`];
          const absoluteTotalizer = row[`totalizer_absolute_${item.identity}`];
          const observedTotalizer = row[`totalizer_observed_${item.identity}`];
          const effectiveTotalizer = row[`totalizer_effective_${item.identity}`];
          const retained = Number(row[`totalizer_retained_${item.identity}`] || 0) > 0;
          const deltaTotalizer = row[`totalizer_delta_${item.identity}`];
          return (
            <div className="module-history-tooltip-item" key={item.identity}>
              <div className="module-history-tooltip-title">
                <span className="chart-tooltip-dot" style={{ background: item.color }} />
                <strong>{item.name}</strong>
              </div>
              {showFlow ? (
                <div className="chart-tooltip-row compact">
                  <span>Flujo promedio</span>
                  <strong>{formatNumber(flow, item.flowUnit)}</strong>
                </div>
              ) : null}
              <div className="chart-tooltip-row compact">
                <span>Totalizador observado</span>
                <strong>{formatNumber(observedTotalizer ?? absoluteTotalizer, 'm³')}</strong>
              </div>
              <div className="chart-tooltip-row compact">
                <span>Totalizador efectivo</span>
                <strong>{formatNumber(effectiveTotalizer ?? absoluteTotalizer, 'm³')}{retained ? ' · retenido' : ''}</strong>
              </div>
              <div className="chart-tooltip-row compact">
                <span>Variación desde el inicio</span>
                <strong>{formatNumber(deltaTotalizer, 'm³')}</strong>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function WaterHistoryChart({
  points = [],
  aggregation,
  height = 430,
  flowUnit = 'Unidad por confirmar',
  series,
  showVolume = true,
  moduleMetric = 'flow',
  moduleTotalizerDisplay = 'delta',
}: WaterHistoryChartProps) {
  if (series) {
    const data = buildModuleRows(series);
    const validTimestamps = data.map((point) => Number(point.timestamp)).filter(Number.isFinite);
    const spansMultipleDays = validTimestamps.length > 1
      ? new Date(Math.min(...validTimestamps)).toDateString() !== new Date(Math.max(...validTimestamps)).toDateString()
      : false;
    const domainStart = data.length ? Number(data[0].timestamp) : 0;
    const domainEnd = data.length ? new Date(String(data[data.length - 1].bucketEnd)).getTime() : 1;
    const showFlow = moduleMetric === 'flow' || moduleMetric === 'both';
    const showTotalizer = moduleMetric === 'totalizer' || moduleMetric === 'both';
    const totalizerDisplay: ModuleTotalizerDisplay = moduleMetric === 'both' ? 'delta' : moduleTotalizerDisplay;
    const totalizerPrefix = totalizerDisplay === 'absolute' ? 'totalizer_absolute' : 'totalizer_delta';
    const totalizerAxisId = moduleMetric === 'both' ? 'totalizer' : 'flow';
    const rightMargin = moduleMetric === 'both' ? 72 : 36;
    const seriesMeta = series.map((item, index) => ({
      identity: seriesIdentity(item),
      name: item.name,
      color: item.color || modulePalette[index % modulePalette.length],
      flowUnit: item.flow_unit || flowUnit,
    }));
    const totalizerKeys = seriesMeta.map((item) => `${totalizerPrefix}_${item.identity}`);
    const totalizerDomain = totalizerDisplay === 'delta' ? zeroPaddedDomain(finiteValues(data, totalizerKeys)) : undefined;
    const totalizerAxisLabel = totalizerDisplay === 'delta' ? 'Variación del totalizador (m³)' : 'Totalizador (m³)';

    return (
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 12, right: rightMargin, bottom: 14, left: 8 }}>
          <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={[domainStart, Number.isFinite(domainEnd) ? domainEnd : 'dataMax']}
            stroke={axisColor}
            tickFormatter={(value) => tickFormatter(Number(value), aggregation, spansMultipleDays)}
            minTickGap={28}
            padding={{ left: 18, right: 18 }}
          />
          <YAxis
            yAxisId="flow"
            stroke={showFlow ? axisColor : totalizerAxisColor}
            width={showFlow ? 58 : 76}
            domain={!showFlow && totalizerDisplay === 'delta' ? totalizerDomain : undefined}
            label={{ value: showFlow ? flowUnit : totalizerAxisLabel, angle: -90, position: 'insideLeft', fill: showFlow ? axisColor : totalizerAxisColor }}
          />
          {moduleMetric === 'both' ? (
            <YAxis
              yAxisId="totalizer"
              orientation="right"
              stroke={totalizerAxisColor}
              width={76}
              domain={totalizerDisplay === 'delta' ? totalizerDomain : undefined}
              label={{ value: totalizerAxisLabel, angle: 90, position: 'insideRight', fill: totalizerAxisColor }}
            />
          ) : null}
          <Tooltip
            content={<ModuleTooltip seriesMeta={seriesMeta} metricMode={moduleMetric} />}
            cursor={{ fill: 'rgba(56,189,248,0.05)' }}
            filterNull={false}
            offset={14}
            wrapperStyle={{ zIndex: 60, pointerEvents: 'none', maxWidth: 'calc(100vw - 32px)' }}
            isAnimationActive={false}
          />
          <Legend />
          <Line yAxisId="flow" type="linear" dataKey="tooltipAnchor" stroke="transparent" dot={false} activeDot={false} legendType="none" isAnimationActive={false} />
          {showFlow ? seriesMeta.map((item) => (
              <Line
                key={`flow-${item.identity}`}
                yAxisId="flow"
                type="linear"
                dataKey={`flow_${item.identity}`}
                name={`${item.name} · Flujo (${item.flowUnit})`}
                stroke={item.color}
                strokeWidth={2.4}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
          )) : null}
          {showTotalizer ? seriesMeta.map((item) => (
              <Line
                key={`totalizer-${item.identity}`}
                yAxisId={totalizerAxisId}
                type="linear"
                dataKey={`${totalizerPrefix}_${item.identity}`}
                name={`${item.name} · ${totalizerDisplay === 'delta' ? 'Variación totalizador' : 'Totalizador'} (m³)`}
                stroke={item.color}
                strokeWidth={moduleMetric === 'both' ? 2 : 2.3}
                strokeDasharray={moduleMetric === 'both' ? '7 5' : undefined}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
                isAnimationActive={false}
              />
          )) : null}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  const data: ChartPoint[] = points.map((point) => ({
    timestamp: new Date(point.bucket_start).getTime(),
    bucketStart: point.bucket_start,
    bucketEnd: point.bucket_end,
    flow: point.flow_avg_lps,
    flowMin: point.flow_min_lps,
    flowMax: point.flow_max_lps,
    volume: point.volume_m3,
    samples: point.samples,
    dataStatus: point.data_status,
    rawTotalizerClose: valueOrNull(point.raw_totalizer_close_m3 ?? point.observed_totalizer_close_m3 ?? point.totalizer_close_m3),
    effectiveTotalizerClose: valueOrNull(point.effective_totalizer_close_m3 ?? point.totalizer_close_m3),
    totalizerRetained: point.totalizer_retained === true,
    tooltipAnchor: 0,
  }));
  const validTimestamps = data.map((point) => point.timestamp).filter(Number.isFinite);
  const spansMultipleDays = validTimestamps.length > 1
    ? new Date(Math.min(...validTimestamps)).toDateString() !== new Date(Math.max(...validTimestamps)).toDateString()
    : false;
  const showDots = data.length <= 24;
  const domainStart = data.length ? new Date(data[0].bucketStart).getTime() : 0;
  const domainEnd = data.length ? new Date(data[data.length - 1].bucketEnd).getTime() : 1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 28, bottom: 14, left: 8 }}>
        <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
        <XAxis
          dataKey="timestamp"
          type="number"
          scale="time"
          domain={[domainStart, domainEnd]}
          stroke={axisColor}
          tickFormatter={(value) => tickFormatter(Number(value), aggregation, spansMultipleDays)}
          minTickGap={28}
          padding={{ left: 18, right: 18 }}
        />
        <YAxis yAxisId="flow" stroke={axisColor} width={58} />
        {showVolume ? <YAxis yAxisId="volume" orientation="right" stroke="#a855f7" width={58} /> : null}
        <Tooltip
          content={<WaterHistoryTooltip aggregation={aggregation} flowUnit={flowUnit} />}
          cursor={{ fill: 'rgba(56,189,248,0.05)' }}
          filterNull={false}
          offset={14}
          allowEscapeViewBox={{ x: false, y: false }}
          wrapperStyle={{ zIndex: 60, pointerEvents: 'none', maxWidth: 'calc(100vw - 32px)' }}
          isAnimationActive={false}
        />
        <Legend />
        <Line
          yAxisId="flow"
          type="linear"
          dataKey="tooltipAnchor"
          stroke="transparent"
          dot={false}
          activeDot={false}
          legendType="none"
          isAnimationActive={false}
        />
        {showVolume ? <Bar
          yAxisId="volume"
          dataKey="volume"
          name="Volumen del intervalo (m³)"
          fill="#a855f7"
          maxBarSize={30}
          radius={[4, 4, 0, 0]}
        /> : null}
        <Line
          yAxisId="flow"
          type="linear"
          dataKey="flow"
          name={`Flujo promedio (${flowUnit})`}
          stroke="#14b8ff"
          strokeWidth={2.6}
          dot={showDots ? { r: 2.8 } : false}
          activeDot={{ r: 4 }}
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
