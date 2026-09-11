import { formatSqlDate } from './dateUtils';
import type { FlexibleRecord, NormalizedWaterItem, StatusFromFlowResult } from './types';

export function statusFromFlow(flow: unknown, explicitActive: unknown): StatusFromFlowResult {
  if (Number(flow || 0) > 0) {
    return { status: 'Encendido', statusType: 'normal' };
  }
  if (explicitActive === true) {
    return { status: 'Revisar señal', statusType: 'warning' };
  }
  return { status: 'Apagado', statusType: 'idle' };
}

function cleanWellNamePrefix(name: string, number: number): string {
  if (!number) return name;
  return String(name || '')
    .replace(new RegExp(`^Pozo\\s*(?:#|No\\.?|Num\\.?|Núm\\.?)?\\s*0*${number}\\s*[-–—:]?\\s*`, 'i'), '')
    .trim();
}

function formatWellDisplayName(number: number, name: unknown): string {
  const cleanName = cleanWellNamePrefix(String(name || '').trim(), number);
  return cleanName ? `Pozo ${number} - ${cleanName}` : `Pozo ${number}`;
}

function pumpedTodayStatus(well: FlexibleRecord): string {
  return String(well.bombeado_hoy_status || well.water_status || '').trim().toLowerCase();
}

function pumpedTodaySource(well: FlexibleRecord): unknown {
  const status = pumpedTodayStatus(well);
  if (status && status !== 'valid' && status !== 'ok') return null;
  return well.bombeado_hoy_m3 ?? well.period_m3 ?? well.period_delta_m3 ?? well.entry_m3 ?? null;
}

function pumpedYesterdayStatus(well: FlexibleRecord): string {
  return String(well.bombeado_ayer_status || '').trim().toLowerCase();
}

function pumpedYesterdaySource(well: FlexibleRecord): unknown {
  const status = pumpedYesterdayStatus(well);
  if (status && status !== 'valid' && status !== 'ok') return null;
  return well.bombeado_ayer_m3 ?? null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function bestAccumulatedTotalizer(candidates: unknown[]): number | null {
  const numbers = candidates
    .map(numberOrNull)
    .filter((value): value is number => value !== null);
  const positive = numbers.find((value) => value > 0);
  if (positive !== undefined) return positive;
  return numbers.length ? numbers[0] : null;
}

function flowQualityStatus(well: FlexibleRecord, field?: 'entrada' | 'salida' | 'general'): string {
  const candidates = field === 'entrada'
    ? [well.flujo_entrada_status, well.flow_in_status, well.flow_in_lps_status]
    : field === 'salida'
      ? [well.flujo_salida_status, well.flow_out_status, well.flow_out_lps_status]
      : [well.flow_status, well.flujo_status, well.flow_lps_status];
  return String(candidates.find(Boolean) || '').trim().toLowerCase();
}

function hasInvalidWellFlow(well: FlexibleRecord): boolean {
  return [
    flowQualityStatus(well, 'general'),
    flowQualityStatus(well, 'entrada'),
    flowQualityStatus(well, 'salida'),
  ].some((status) => status === 'invalid_flow' || status === 'invalid' || status === 'dato_en_revision');
}

export function normalizeSqlWell(well: FlexibleRecord, index: number): NormalizedWaterItem {
  const flowOut = Number(well.flujo_salida ?? well.flow_out ?? 0);
  const flowIn = Number(well.flujo_entrada ?? well.flow_in ?? 0);
  const providedFlow = well.flow ?? null;
  const flow = Number(providedFlow !== null ? providedFlow : Math.max(flowOut, flowIn));
  const state = statusFromFlow(flow, well.active);
  const isFlowing = flow > 0;
  const rawIdentity = String(well.kind || well.id || well.name || well.nombre || '').toLowerCase();
  const isSosa = well.is_sosa === true || rawIdentity.includes('sosa');
  const invalidFlow = !isSosa && !isFlowing && hasInvalidWellFlow(well);
  const number = Number(well.numero || well.well_number || index + 1);
  const rawName = well.nombre || well.name || well.ubicacion || (isSosa ? 'SOSA 50%' : `Pozo ${number}`);
  const name = isSosa ? String(rawName || 'SOSA 50%') : formatWellDisplayName(number, rawName);
  const updated = formatSqlDate(well.updated || well.ultima_lectura);
  const rawAmps = well.amps ?? well.amperaje ?? null;
  const amps = rawAmps === null || rawAmps === undefined || rawAmps === '' ? null : Number(rawAmps);
  const pumpedSource = pumpedTodaySource(well);
  const pumpedToday = pumpedSource === null || pumpedSource === undefined || pumpedSource === '' ? null : Number(pumpedSource);
  const pumpedYesterdaySourceValue = pumpedYesterdaySource(well);
  const pumpedYesterday = pumpedYesterdaySourceValue === null || pumpedYesterdaySourceValue === undefined || pumpedYesterdaySourceValue === '' ? null : Number(pumpedYesterdaySourceValue);
  const startTotalizer = bestAccumulatedTotalizer([
    well.totalizador_inicio_dia_m3,
    well.totalizador_cierre_anterior_m3,
    well.first_totalizador_m3,
    well.first_flow_out_total_m3,
    well.first_flow_in_total_m3,
  ]);
  const currentTotalizer = bestAccumulatedTotalizer([
    well.totalizador_actual_m3,
    well.last_totalizador_m3,
    well.totalizador_m3,
    well.last_flow_out_total_m3,
    well.last_flow_in_total_m3,
  ]);
  return {
    ...well,
    id: well.id || `pozo-${index + 1}`,
    numero: number,
    nombre: name,
    name,
    ubicacion: well.ubicacion || well.location || (isSosa ? 'Pozos' : cleanWellNamePrefix(String(rawName || name), number)) || name,
    status: invalidFlow ? 'Dato en revisión' : (isFlowing && !well.status ? 'Encendido' : (well.status || state.status)),
    statusType: invalidFlow ? 'warning' : (isFlowing ? 'normal' : (well.statusType || state.statusType)),
    estado_comunicacion: isFlowing ? 'Normal' : (well.estado_comunicacion || 'Normal'),
    communicationType: isFlowing ? 'normal' : (well.communicationType || 'normal'),
    flujo_salida: flowOut,
    flujo_entrada: flowIn,
    flow,
    flujo_salida_status: String(well.flujo_salida_status || well.flow_out_status || well.flow_out_lps_status || 'valid'),
    flujo_entrada_status: String(well.flujo_entrada_status || well.flow_in_status || well.flow_in_lps_status || 'valid'),
    flow_status: String(well.flow_status || well.flujo_status || well.flow_lps_status || (invalidFlow ? 'invalid_flow' : 'valid')),
    flujo_salida_note: String(well.flujo_salida_note || well.flow_out_note || ''),
    flujo_entrada_note: String(well.flujo_entrada_note || well.flow_in_note || ''),
    flow_note: String(well.flow_note || (invalidFlow ? 'Dato en revisión por flujo fuera de rango' : '')),
    kwh: Number(well.kwh ?? well.dailyKwh ?? 0),
    dailyKwh: Number(well.dailyKwh ?? well.kwh ?? 0),
    totalizador_m3: currentTotalizer ?? Number(well.totalizador_m3 ?? 0),
    period_m3: Number(well.period_m3 ?? well.entry_m3 ?? well.period_delta_m3 ?? well.bombeado_hoy_m3 ?? 0),
    period_kwh: Number(well.period_kwh ?? well.period_delta_kwh ?? 0),
    entry_m3: Number(well.entry_m3 ?? well.period_m3 ?? well.period_delta_m3 ?? well.bombeado_hoy_m3 ?? 0),
    bombeado_hoy_m3: pumpedToday === null || Number.isNaN(pumpedToday) ? null : pumpedToday,
    bombeado_hoy_status: String(well.bombeado_hoy_status || well.water_status || (pumpedToday === null || Number.isNaN(pumpedToday) ? 'missing' : 'valid')),
    bombeado_hoy_note: String(well.bombeado_hoy_note || well.water_note || ''),
    bombeado_ayer_m3: pumpedYesterday === null || Number.isNaN(pumpedYesterday) ? null : pumpedYesterday,
    bombeado_ayer_status: String(well.bombeado_ayer_status || (pumpedYesterday === null || Number.isNaN(pumpedYesterday) ? 'missing' : 'valid')),
    bombeado_ayer_note: String(well.bombeado_ayer_note || ''),
    totalizador_inicio_dia_m3: startTotalizer === null ? null : startTotalizer,
    totalizador_cierre_anterior_m3: startTotalizer === null ? null : startTotalizer,
    totalizador_actual_m3: currentTotalizer === null ? null : currentTotalizer,
    amps: amps === null || Number.isNaN(amps) ? null : amps,
    efficiency: well.efficiency ?? null,
    loadFactor: well.loadFactor ?? null,
    updated,
    ultima_lectura: updated,
    diagnosis: invalidFlow ? 'Dato en revisión por flujo fuera de rango.' : (well.diagnosis || (isSosa ? 'Lectura actual de SOSA.' : 'Lectura actual de planta.')),
  };
}

export function normalizeSqlLine(line: FlexibleRecord, index: number): NormalizedWaterItem {
  const flow = Number(line.flow_lps || line.flujo_salida || 0);
  const state = statusFromFlow(flow, line.active);
  const name = line.nombre || line.name || `Línea ${index + 1}`;
  const updated = formatSqlDate(line.updated || line.ultima_lectura || line.timestamp);
  const hasCommunication = flow > 0 || Number(line.quality || 0) === 0;
  return {
    id: line.id || `linea-${index + 1}`,
    numero: line.numero || index + 1,
    nombre: name,
    name,
    ubicacion: line.ubicacion || 'Líneas de producción',
    status: state.status,
    statusType: state.statusType,
    estado_comunicacion: hasCommunication ? 'Normal' : 'Revisar calidad',
    communicationType: hasCommunication ? 'normal' : 'communication',
    kwh: null,
    dailyKwh: null,
    totalizador_m3: Number(line.total_m3 || line.totalizador_m3 || 0),
    period_m3: Number(line.period_m3 ?? line.period_delta_m3 ?? 0),
    period_delta_m3: Number(line.period_delta_m3 ?? line.period_m3 ?? 0),
    flujo_entrada: flow,
    flujo_salida: flow,
    flow,
    updated,
    ultima_lectura: updated,
    sensor_id: line.sensor_id,
    sensor_name: line.sensor_name,
    diagnosis: 'Lectura actual de planta',
  };
}
