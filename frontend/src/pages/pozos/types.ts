export type Period = 'minute' | 'quarter_hour' | 'hourly' | 'daily' | 'monthly';
export type HistoryAggregation = 'minute' | 'quarter_hour' | 'hourly' | 'daily';

export type FlexibleRecord = Record<string, unknown>;

export interface DateRange extends FlexibleRecord {
  startDate?: string;
  endDate?: string;
  refreshKey?: number;
}


export interface WaterHistoryPoint extends FlexibleRecord {
  sensor_id: number | null;
  bucket_start: string;
  bucket_end: string;
  aggregation: HistoryAggregation;
  samples: number;
  flow_samples?: number;
  coverage_pct?: number;
  flow_avg_lps: number | null;
  flow_min_lps: number | null;
  flow_max_lps: number | null;
  flow_unit?: string;
  unit_status?: string;
  totalizer_open_m3: number | null;
  totalizer_close_m3: number | null;
  raw_totalizer_close_m3?: number | null;
  observed_totalizer_close_m3?: number | null;
  effective_totalizer_close_m3?: number | null;
  totalizer_retained?: boolean;
  volume_m3: number | null;
  volume_reliable: boolean;
  data_status: 'operational' | 'zero_consumption' | 'no_data' | 'invalid_totalizer' | 'missing_totalizer' | 'stale_data' | 'frozen_flow' | 'mapping_pending' | 'totalizer_retained' | 'partial' | 'validated' | string;
  status?: string;
  last_sample_ts?: string | null;
}

export interface WaterHistoryResponse extends FlexibleRecord {
  module: 'line' | 'flow' | 'well';
  sensor_id: number;
  name: string;
  start_date: string;
  end_date: string;
  aggregation: HistoryAggregation;
  source: string;
  status: string;
  has_data: boolean;
  partial_gaps: boolean;
  flow_unit?: string;
  unit_status?: string;
  points: WaterHistoryPoint[];
}

export interface WaterModuleHistorySeries extends FlexibleRecord {
  sensor_id: number | null;
  operational_key?: string;
  name: string;
  color?: string;
  flow_unit?: string;
  unit_status?: string;
  source_status?: string;
  status?: string;
  has_data: boolean;
  partial_gaps?: boolean;
  points: WaterHistoryPoint[];
}

export interface WaterModuleHistoryResponse extends FlexibleRecord {
  plant?: string;
  module: 'line' | 'flow' | 'well';
  start_date: string;
  end_date: string;
  aggregation: HistoryAggregation;
  source: string;
  source_status?: string;
  status: string;
  message?: string;
  has_data: boolean;
  partial_gaps: boolean;
  series: WaterModuleHistorySeries[];
}

export interface StatusFromFlowResult {
  status: string;
  statusType: string;
}

export interface DashboardData extends FlexibleRecord {
  aggregation?: string;
  date_range?: FlexibleRecord;
  energy_water_rows?: FlexibleRecord[];
  wells?: FlexibleRecord[];
  well_flow_history?: FlexibleRecord[];
  entry_vs_exit?: FlexibleRecord[];
  tank_inputs?: FlexibleRecord[];
  tank_level_readings?: FlexibleRecord[];
  tank_level_history?: FlexibleRecord[];
  tank_level_columns?: FlexibleRecord[];
  production_lines?: FlexibleRecord[];
  production_line_history?: FlexibleRecord[];
  flows?: FlexibleRecord[];
  flow_history?: FlexibleRecord[];
  water_consumption?: FlexibleRecord[];
  summary?: FlexibleRecord;
  daily_well_total_m3?: number;
  previous_well_total_m3?: number;
  bombeado_ayer_total_m3?: number;
  distribution_flows?: FlexibleRecord[];
}

export interface ChartDataPoint extends FlexibleRecord {
  bucket?: unknown;
  hour?: unknown;
  time?: unknown;
  name?: unknown;
  fullName?: unknown;
  label?: unknown;
  agua?: number;
  energia?: number;
  entrada?: number;
  salida?: number;
  diferencia?: number;
  flujo?: number;
  flow?: number;
  flowAvg?: number;
  amps?: number | null;
  efficiency?: number | null | unknown;
  loadFactor?: null;
  volumen?: number;
  total?: number;
  totalizador?: number;
  value?: number;
}

export interface NormalizedWaterItem extends FlexibleRecord {
  id?: unknown;
  numero?: unknown;
  nombre?: unknown;
  name?: unknown;
  ubicacion?: unknown;
  status?: unknown;
  statusType?: unknown;
  estado_comunicacion?: unknown;
  communicationType?: unknown;
  flujo_salida?: number;
  flujo_entrada?: number;
  flow?: number;
  flujo_salida_status?: string;
  flujo_entrada_status?: string;
  flow_status?: string;
  flujo_salida_note?: string;
  flujo_entrada_note?: string;
  flow_note?: string;
  kwh?: number | null;
  dailyKwh?: number | null;
  totalizador_m3?: number;
  period_m3?: number;
  period_kwh?: number;
  period_delta_m3?: number;
  entry_m3?: number;
  bombeado_hoy_m3?: number | null;
  bombeado_hoy_status?: string;
  bombeado_hoy_note?: string;
  bombeado_ayer_m3?: number | null;
  bombeado_ayer_status?: string;
  bombeado_ayer_note?: string;
  totalizador_cierre_anterior_m3?: number | null;
  totalizador_actual_m3?: number | null;
  last_totalizador_m3?: number | null;
  amps?: number | null;
  efficiency?: unknown;
  loadFactor?: unknown;
  updated?: string;
  ultima_lectura?: string;
  diagnosis?: unknown;
}
