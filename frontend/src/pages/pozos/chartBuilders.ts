import { bucketLabel, dashboardPeriod } from './dateUtils';
import { normalizeSqlLine, normalizeSqlWell } from './normalizers';
import type { ChartDataPoint, DashboardData, DateRange, FlexibleRecord, NormalizedWaterItem } from './types';

export function buildEnergyWaterSeries(dashboard?: DashboardData | null, fallbackRange: DateRange = {}): ChartDataPoint[] {
  const rows = Array.isArray(dashboard?.energy_water_rows) ? dashboard.energy_water_rows : [];
  const period = dashboardPeriod(dashboard, fallbackRange);
  const buckets = new Map<unknown, ChartDataPoint>();
  rows.forEach((row) => {
    const key = row.bucket || row.period || row.fecha || row.date || row.time_stamp || row.timestamp || 'Periodo';
    const item = buckets.get(key) || { bucket: key, hour: bucketLabel(key, period), agua: 0, energia: 0 };
    item.agua += Number(row.m3_value ?? row.water_m3 ?? row.m3 ?? 0);
    item.energia += Number(row.kwh_value ?? row.kwh ?? row.energy_kwh ?? 0);
    buckets.set(key, item);
  });
  return Array.from(buckets.values()).sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}

export function buildWellPeriodRows(dashboard?: DashboardData | null): ChartDataPoint[] {
  const wells = dashboard?.wells?.length ? dashboard.wells.map(normalizeSqlWell) : [];
  return wells.map((well) => {
    const status = String(well.bombeado_hoy_status || '').toLowerCase();
    const validWater = !status || status === 'valid' || status === 'ok';
    return {
      name: `P${String(well.numero || '').padStart(2, '0')}`,
      fullName: well.nombre || well.name,
      agua: validWater ? Number(well.bombeado_hoy_m3 ?? well.period_m3 ?? well.entry_m3 ?? 0) : 0,
      energia: Number(well.period_kwh ?? 0),
      flujo: Number(well.flow ?? 0),
    };
  }).filter((row) => row.agua || row.energia || row.flujo);
}

export function buildWellHistoryProductionSeries(dashboard?: DashboardData | null, fallbackRange: DateRange = {}): ChartDataPoint[] {
  const rows = Array.isArray(dashboard?.well_flow_history) ? dashboard.well_flow_history : [];
  const period = dashboardPeriod(dashboard, fallbackRange);
  const buckets = new Map<unknown, ChartDataPoint>();
  rows.forEach((row) => {
    const key = row.bucket || row.timestamp || row.time_stamp || 'Periodo';
    const item = buckets.get(key) || { bucket: key, hour: bucketLabel(key, period), agua: 0, energia: 0 };
    item.agua += Number(row.period_m3 ?? row.m3_value ?? 0);
    item.energia += Number(row.energy_delta_kwh ?? row.kwh_value ?? 0);
    buckets.set(key, item);
  });
  return Array.from(buckets.values())
    .filter((row) => row.agua || row.energia)
    .sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}

export function buildTemporalProductionSeries(dashboard?: DashboardData | null, fallbackRange: DateRange = {}): ChartDataPoint[] {
  const hasEnergyWaterRows = Array.isArray(dashboard?.energy_water_rows) && dashboard.energy_water_rows.length > 0;
  const energyRows = buildEnergyWaterSeries(dashboard, fallbackRange);
  if (hasEnergyWaterRows) return energyRows;

  const hasWellFlowHistory = Array.isArray(dashboard?.well_flow_history) && dashboard.well_flow_history.length > 0;
  const historyRows = buildWellHistoryProductionSeries(dashboard, fallbackRange);
  if (hasWellFlowHistory) return historyRows;

  return [];
}

export function buildProductionSeries(dashboard?: DashboardData | null, fallbackRange: DateRange = {}): ChartDataPoint[] {
  const hasEnergyWaterRows = Array.isArray(dashboard?.energy_water_rows) && dashboard.energy_water_rows.length > 0;
  const energyRows = buildEnergyWaterSeries(dashboard, fallbackRange);
  if (hasEnergyWaterRows) return energyRows;

  const hasWellFlowHistory = Array.isArray(dashboard?.well_flow_history) && dashboard.well_flow_history.length > 0;
  const historyRows = buildWellHistoryProductionSeries(dashboard, fallbackRange);
  if (hasWellFlowHistory) return historyRows;

  return buildWellPeriodRows(dashboard).map((row) => ({ hour: row.name, agua: row.agua, energia: row.energia }));
}

const WELL_FLOW_COLORS = ['#38bdf8', '#f59e0b', '#34d399', '#a78bfa', '#f472b6', '#22d3ee', '#fb7185', '#84cc16', '#eab308', '#60a5fa'];

function wellFlowValue(row: FlexibleRecord): number {
  const status = String(row.flow_status || row.flujo_status || row.flow_lps_status || '').trim().toLowerCase();
  if (status === 'invalid_flow') return 0;
  const outStatus = String(row.flow_out_lps_status || row.flujo_salida_status || row.flow_out_status || '').trim().toLowerCase();
  const inStatus = String(row.flow_in_lps_status || row.flujo_entrada_status || row.flow_in_status || '').trim().toLowerCase();
  const candidates = [
    row.flow_lps,
    row.flujo_lps,
    row.flow,
    row.flujo,
    outStatus === 'invalid_flow' ? 0 : row.flow_out_lps,
    inStatus === 'invalid_flow' ? 0 : row.flow_in_lps,
    outStatus === 'invalid_flow' ? 0 : row.flujo_salida,
    inStatus === 'invalid_flow' ? 0 : row.flujo_entrada,
  ];
  return candidates.map((value) => Number(value ?? 0)).filter(Number.isFinite).reduce((max, value) => Math.max(max, value), 0);
}

export interface MultiWellFlowSeries {
  key: string;
  name: string;
  numero: number;
  color: string;
}

export interface MultiWellFlowChartResult {
  data: ChartDataPoint[];
  series: MultiWellFlowSeries[];
  aggregation: string;
}

export function buildMultiWellFlowSeries(
  dashboard?: DashboardData | null,
  selectedWellNumbers: number[] = [],
  fallbackRange: DateRange = {},
): MultiWellFlowChartResult {
  const rows = Array.isArray(dashboard?.well_flow_history) ? dashboard.well_flow_history : [];
  const period = dashboardPeriod(dashboard, fallbackRange);
  const selected = new Set(selectedWellNumbers.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0));
  const wells = dashboard?.wells?.length ? dashboard.wells.map(normalizeSqlWell) : [];
  const namesByNumber = new Map<number, string>();
  wells.forEach((well) => {
    const numero = Number(well.numero || 0);
    if (numero) namesByNumber.set(numero, String(well.nombre || well.name || `Pozo ${numero}`));
  });

  const buckets = new Map<string, ChartDataPoint>();
  const seenNumbers = new Set<number>();
  rows.forEach((row) => {
    const numero = Number(row.numero ?? row.well_number ?? row.pozo ?? 0);
    if (!numero || (selected.size && !selected.has(numero))) return;
    const bucket = String(row.bucket || row.timestamp || row.time_stamp || '');
    if (!bucket) return;
    const flow = wellFlowValue(row);
    const key = `pozo_${numero}`;
    const item = buckets.get(bucket) || { bucket, hour: bucketLabel(bucket, period), timestamp: bucket };
    item[key] = flow;
    buckets.set(bucket, item);
    seenNumbers.add(numero);
    if (!namesByNumber.has(numero)) namesByNumber.set(numero, String(row.nombre || row.name || `Pozo ${numero}`));
  });

  const seriesNumbers = Array.from(seenNumbers).sort((a, b) => a - b);
  const series = seriesNumbers.map((numero, index) => ({
    key: `pozo_${numero}`,
    name: namesByNumber.get(numero) || `Pozo ${numero}`,
    numero,
    color: WELL_FLOW_COLORS[index % WELL_FLOW_COLORS.length],
  }));

  const data = Array.from(buckets.values())
    .map((item) => {
      series.forEach((current) => {
        if (item[current.key] === undefined) item[current.key] = null;
      });
      return item;
    })
    .filter((item) => series.some((current) => Number(item[current.key] ?? 0) > 0))
    .sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));

  return { data, series, aggregation: period };
}


export type HistoricalModuleKey = 'wells' | 'tanks' | 'flows' | 'lines';

export interface ModuleHistoricalChartResult {
  data: ChartDataPoint[];
  primaryKey: 'agua' | 'valor';
  primaryLabel: string;
  primaryUnit: string;
  secondaryKey?: 'energia';
  secondaryLabel?: string;
  subtitle: string;
  emptyMessage: string;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bucketKey(row: FlexibleRecord): unknown {
  return row.bucket || row.timestamp || row.time_stamp || row.period || row.fecha || row.date || 'Periodo';
}

function volumeOrFlowValue(row: FlexibleRecord): { value: number; metric: 'volume' | 'flow' } {
  const volume = finiteNumber(row.period_m3 ?? row.volumen_periodo_m3 ?? row.period_delta_m3);
  if (volume !== null && volume > 0) return { value: volume, metric: 'volume' };
  const flow = finiteNumber(row.flow_lps ?? row.flujo_lps ?? row.flow ?? row.flujo ?? row.flujo_salida ?? row.flujo_entrada);
  return { value: Math.max(0, flow ?? 0), metric: 'flow' };
}

function buildBucketedOperationalSeries(
  rows: FlexibleRecord[] = [],
  fallbackRange: DateRange = {},
): { data: ChartDataPoint[]; metric: 'volume' | 'flow' } {
  const period = dashboardPeriod({ aggregation: undefined } as DashboardData, fallbackRange);
  const buckets = new Map<unknown, ChartDataPoint>();
  let hasVolume = false;

  rows.forEach((row) => {
    const key = bucketKey(row);
    const { value, metric } = volumeOrFlowValue(row);
    if (metric === 'volume' && value > 0) hasVolume = true;
    const item = buckets.get(key) || { bucket: key, hour: bucketLabel(key, period), valor: 0 };
    item.valor = Number(item.valor ?? 0) + value;
    buckets.set(key, item);
  });

  return {
    metric: hasVolume ? 'volume' : 'flow',
    data: Array.from(buckets.values())
      .filter((row) => Number(row.valor ?? 0) > 0)
      .sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))),
  };
}

const TANK_MAX_HEIGHT_BY_KEY: Record<string, number> = {
  nivel_1k: 6.5,
  nivel750a: 13.5,
  nivel_750a: 13.5,
  nivel750b: 13.5,
  nivel_750b: 13.5,
  nivel_500: 6.5,
  nivel750c: 13.5,
  nivel_750c: 13.5,
  nivel750d: 13.5,
  nivel_750d: 13.5,
  nivel_dura: 2.55,
  nivel_suave: 2.9,
  nivel_recuperada: 2.5,
  nivel_salmuera: 2.5,
};

function normalizedTankLevelKey(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

function tankLevelPct(name: string, value: unknown): number | null {
  const heightM = finiteNumber(value);
  if (heightM === null || heightM < 0) return null;
  const maxHeightM = TANK_MAX_HEIGHT_BY_KEY[normalizedTankLevelKey(name)];
  if (!maxHeightM || maxHeightM <= 0) return null;
  return Math.max(0, Math.min(100, (heightM / maxHeightM) * 100));
}

function buildTankHistoricalAverageSeries(
  dashboard?: DashboardData | null,
  fallbackRange: DateRange = {},
): ChartDataPoint[] {
  const rows = Array.isArray(dashboard?.tank_level_history) ? dashboard.tank_level_history : [];
  const period = dashboardPeriod(dashboard, fallbackRange);

  return rows
    .map((row) => {
      const key = bucketKey(row);
      const values = Object.entries(row)
        .map(([name, value]) => tankLevelPct(name, value))
        .filter((value): value is number => value !== null);
      if (!values.length) return null;
      const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
      return { bucket: key, hour: bucketLabel(key, period), valor: avg } as ChartDataPoint;
    })
    .filter((row): row is ChartDataPoint => Boolean(row && Number(row.valor ?? 0) > 0))
    .sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}

export function buildModuleHistoricalSeries(
  dashboard?: DashboardData | null,
  selectedModule: HistoricalModuleKey = 'wells',
  fallbackRange: DateRange = {},
): ModuleHistoricalChartResult {
  if (selectedModule === 'wells') {
    const data = buildTemporalProductionSeries(dashboard, fallbackRange);
    return {
      data,
      primaryKey: 'agua',
      primaryLabel: 'Agua bombeada (m³)',
      primaryUnit: 'm³',
      secondaryKey: data.some((row) => Number(row.energia ?? 0) > 0) ? 'energia' : undefined,
      secondaryLabel: 'Consumo (kWh)',
      subtitle: 'Agua bombeada y consumo energético en el rango seleccionado.',
      emptyMessage: 'Sin datos históricos disponibles para pozos en el rango seleccionado.',
    };
  }

  if (selectedModule === 'tanks') {
    return {
      data: buildTankHistoricalAverageSeries(dashboard, fallbackRange),
      primaryKey: 'valor',
      primaryLabel: 'Nivel promedio (%)',
      primaryUnit: '%',
      subtitle: 'Promedio de llenado de tanques en el rango seleccionado.',
      emptyMessage: 'Sin datos históricos disponibles para tanques en el rango seleccionado.',
    };
  }

  if (selectedModule === 'flows') {
    const { data, metric } = buildBucketedOperationalSeries(
      Array.isArray(dashboard?.flow_history) ? dashboard.flow_history : [],
      fallbackRange,
    );
    return {
      data,
      primaryKey: 'valor',
      primaryLabel: metric === 'volume' ? 'Volumen del periodo (m³)' : 'Flujo total (L/s)',
      primaryUnit: metric === 'volume' ? 'm³' : 'L/s',
      subtitle: 'Flujo o volumen registrado por medidor en el rango seleccionado.',
      emptyMessage: 'Sin datos históricos disponibles para flujos en el rango seleccionado.',
    };
  }

  const { data, metric } = buildBucketedOperationalSeries(
    Array.isArray(dashboard?.production_line_history) ? dashboard.production_line_history : [],
    fallbackRange,
  );
  return {
    data,
    primaryKey: 'valor',
    primaryLabel: metric === 'volume' ? 'Volumen del periodo (m³)' : 'Flujo total (L/s)',
    primaryUnit: metric === 'volume' ? 'm³' : 'L/s',
    subtitle: 'Flujo o volumen registrado por línea en el rango seleccionado.',
    emptyMessage: 'Sin datos históricos disponibles para líneas en el rango seleccionado.',
  };
}

export function buildEntryExitRows(dashboard?: DashboardData | null): ChartDataPoint[] {
  const direct = Array.isArray(dashboard?.entry_vs_exit) ? dashboard.entry_vs_exit : [];
  if (direct.length) {
    return direct.map((row) => ({
      label: row.label || row.name || 'Periodo',
      entrada: Number(row.entrada ?? row.input ?? 0),
      salida: Number(row.salida ?? row.output ?? 0),
      diferencia: Number(row.entrada ?? row.input ?? 0) - Number(row.salida ?? row.output ?? 0),
    }));
  }
  const wells = dashboard?.wells?.length
    ? dashboard.wells.map(normalizeSqlWell).filter((item) => item.exclude_from_balance !== true && item.is_sosa !== true && String(item.kind || '').toLowerCase() !== 'sosa')
    : [];
  if (!wells.length) return [];
  const entrada = wells.reduce((sum, item) => sum + Number(item.period_m3 ?? item.entry_m3 ?? 0), 0);
  return [{ label: 'Pozos', entrada, salida: 0, diferencia: entrada }];
}


export function buildTankLevelRows(dashboard?: DashboardData | null): ChartDataPoint[] {
  const rows = dashboard?.tank_level_readings || [];
  return rows
    .map((item, index) => {
      const heightM = Number(item.height_m ?? item.level_value ?? 0);
      const maxHeight = Number(item.max_height_m ?? item.altura_maxima_m ?? 0);
      const capacity = Number(item.capacity_m3 ?? 0);
      const fillPct = maxHeight > 0
        ? Math.max(0, Math.min(100, (heightM / maxHeight) * 100))
        : Number(item.fill_pct ?? 0);
      const volume = Number(item.volume_m3 ?? (capacity > 0 ? capacity * fillPct / 100 : 0));

      return {
        name: item.name || item.label || `Tanque ${index + 1}`,
        label: item.label || item.display_name || item.name || `Tanque ${index + 1}`,
        displayName: item.display_name || item.label || item.name || `Tanque ${index + 1}`,
        shortName: item.short_name || item.source_column || item.level_key || '',
        type: item.type || 'Nivel BOS',
        kind: item.kind || 'tanque',
        nivel: heightM,
        metros: heightM,
        maxHeight,
        m3: volume,
        capacidad: capacity,
        llenado: fillPct,
        sourceColumn: item.source_column || item.level_key || '',
        volumeSource: item.volume_source || 'estimated',
        volumeSourceColumn: item.volume_source_column || '',
        diagnosis: item.diagnosis || '',
        status: item.status || 'Sin lectura',
        statusType: item.statusType || 'communication',
        updated: item.updated || item.ultima_lectura || '',
      };
    })
    .filter((row) => row.nivel !== 0 || row.llenado !== 0 || row.sourceColumn);
}

export function buildTankLevelHistoryRows(dashboard?: DashboardData | null): ChartDataPoint[] {
  const rows = dashboard?.tank_level_history || [];
  return rows
    .map((item) => ({
      ...item,
      time: bucketLabel(item.bucket || item.timestamp, dashboardPeriod(dashboard)),
    }))
    .filter((row) => Object.keys(row).some((key) => key.startsWith('nivel_') && Number(row[key] ?? 0) !== 0));
}

export function buildTankLineRows(dashboard?: DashboardData | null): ChartDataPoint[] {
  const rows: ChartDataPoint[] = [];
  (dashboard?.tank_inputs || []).forEach((item, index) => {
    rows.push({ name: item.name || item.label || `Tanque ${index + 1}`, entrada: Number(item.flow_lps || 0), total: Number(item.total_m3 || 0) });
  });
  (dashboard?.production_lines || []).forEach((item, index) => {
    rows.push({ name: item.sensor_name || item.name || `Línea ${index + 1}`, entrada: Number(item.flow_lps || 0), total: Number(item.total_m3 || 0) });
  });
  return rows.filter((row) => row.entrada || row.total);
}

export function buildDistributionRows(dashboard?: DashboardData | null): ChartDataPoint[] {
  const rows = dashboard?.water_consumption || dashboard?.distribution_flows || [];
  return rows.map((item) => ({
    name: item.name || item.label || 'Consumo',
    value: Number(item.value ?? item.flow_lps ?? item.total_m3 ?? 0),
  })).filter((row) => row.value);
}

function matchesWell(row: FlexibleRecord, wellId: number, wellNumber: number): boolean {
  if (!wellId && !wellNumber) return true;
  const rowWellId = Number(row.well_id ?? row.wellId ?? 0);
  const rowNumber = Number(row.numero ?? row.well_number ?? row.pozo ?? 0);
  const normalizedWellIdFromNumber = wellNumber ? 100 + wellNumber : 0;
  return Boolean(
    (rowWellId && (rowWellId === wellId || rowWellId === wellNumber || rowWellId === normalizedWellIdFromNumber))
    || (rowNumber && rowNumber === wellNumber)
  );
}

export function buildWellTimeline(dashboard?: DashboardData | null, well?: NormalizedWaterItem | FlexibleRecord | null): ChartDataPoint[] {
  const wellId = Number(well?.well_id || 0);
  const wellNumber = Number(well?.numero || 0);
  const period = dashboardPeriod(dashboard);

  const flowRows = Array.isArray(dashboard?.well_flow_history) ? dashboard.well_flow_history : [];
  const ampsByBucket = new Map<string, number>();
  flowRows
    .filter((row) => matchesWell(row, wellId, wellNumber))
    .forEach((row) => {
      const bucket = row.bucket || row.timestamp || row.time_stamp;
      const amps = Number(row.amps ?? row.amperaje ?? 0);
      if (bucket && amps) ampsByBucket.set(String(bucket), amps);
    });

  const energyRows = Array.isArray(dashboard?.energy_water_rows) ? dashboard.energy_water_rows : [];
  const energyMapped = energyRows
    .filter((row) => matchesWell(row, wellId, wellNumber))
    .map((row) => {
      const bucket = row.bucket || row.period || row.fecha || row.date;
      const agua = Number(row.m3_value ?? row.water_m3 ?? 0);
      const energia = Number(row.kwh_value ?? row.kwh ?? 0);
      return {
        time: bucketLabel(bucket, period),
        flow: agua,
        energia,
        amps: ampsByBucket.get(String(bucket)) ?? (Number(well?.amps ?? well?.amperaje ?? 0) || null),
        efficiency: agua ? energia / agua : null,
        loadFactor: null,
      };
    })
    .filter((row) => row.flow || row.energia);
  if (energyMapped.length) return energyMapped;

  const flowMapped = flowRows
    .filter((row) => matchesWell(row, wellId, wellNumber))
    .map((row) => {
      const agua = Number(row.period_m3 ?? row.m3_value ?? 0);
      const energia = Number(row.energy_delta_kwh ?? row.kwh_value ?? 0);
      const flowAvg = Number(row.flow_lps ?? row.flow ?? row.flow_out_lps ?? row.flow_in_lps ?? 0);
      return {
        time: bucketLabel(row.timestamp || row.time_stamp || row.bucket, row.aggregation || period),
        flow: agua || flowAvg,
        flowAvg,
        energia,
        amps: Number(row.amps ?? row.amperaje ?? 0) || null,
        efficiency: agua && energia ? energia / agua : null,
        loadFactor: null,
      };
    })
    .filter((row) => row.flow || row.energia || row.flowAvg);
  if (flowMapped.length) return flowMapped;

  return [];
}

export function buildLineTimeline(dashboard?: DashboardData | null, line?: NormalizedWaterItem | FlexibleRecord | null): ChartDataPoint[] {
  const lineNumber = Number(line?.numero || 0);
  const period = dashboardPeriod(dashboard);
  const history = Array.isArray(dashboard?.production_line_history) ? dashboard.production_line_history : [];
  const mapped = history
    .filter((row) => !lineNumber || Number(row.numero || 0) === lineNumber || row.id === line?.id)
    .map((row) => ({
      time: bucketLabel(row.timestamp || row.time_stamp || row.bucket, row.aggregation || period),
      flow: Number(row.flow_lps ?? 0),
      volumen: Number(row.period_m3 ?? row.m3_value ?? 0),
      totalizador: Number(row.total_m3 ?? row.totalizador_m3 ?? 0),
    }))
    .filter((row) => row.flow || row.volumen || row.totalizador);
  if (mapped.length) return mapped;
  return [];
}
