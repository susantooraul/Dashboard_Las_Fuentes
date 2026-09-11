import { formatLocalDate, formatNumber, numberOrNull, periodText } from './insurgentesUtils';
import type { FlexibleRecord } from './types';

export function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = numberOrNull(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

export function previousTotalizerValue(item: FlexibleRecord): number | null {
  return firstNumber(
    item.totalizador_inicio_dia_m3,
    item.totalizador_cierre_anterior_m3,
    item.previous_totalizer_m3,
    item.previous_totalizador_m3,
    item.first_totalizador_m3,
    item.opening_totalizer_m3,
  );
}

export function currentTotalizerValue(item: FlexibleRecord): number | null {
  return firstNumber(
    item.totalizador_actual_m3,
    item.totalizador_m3,
    item.last_totalizador_m3,
    item.current_totalizer_m3,
    item.cierre_totalizador_m3,
  );
}

export function periodVolumeValue(item: FlexibleRecord): number | null {
  const status = String(item.period_status || item.bombeado_hoy_status || item.water_status || '').toLowerCase();
  if (status === 'sin_datos' || status === 'missing') return null;
  return firstNumber(item.period_m3, item.period_delta_m3, item.bombeado_hoy_m3, item.entry_m3, item.volumen_periodo_m3);
}

export function flowValue(item: FlexibleRecord): number | null {
  return firstNumber(item.flow_lps, item.flow, item.flujo_salida, item.flujo_entrada, item.instant_value);
}

export function activeMinutesValue(item: FlexibleRecord): number | null {
  return firstNumber(item.active_minutes, item.tiempo_activo_min, item.tiempo_activo_minutos);
}

export function startCountValue(item: FlexibleRecord): number | null {
  return firstNumber(item.start_count, item.encendidos_periodo, item.numero_encendidos, item.starts);
}

export function startCountText(item: FlexibleRecord): string {
  const value = startCountValue(item);
  return value === null ? 'Sin datos' : Math.max(Math.round(value), 0).toLocaleString('es-MX');
}

export function itemUpdateText(item: FlexibleRecord): string {
  return formatLocalDate(item.updated || item.ultima_lectura || item.timestamp || item.Time_Stamp);
}

export function totalizerStartText(item: FlexibleRecord): string {
  const value = previousTotalizerValue(item);
  return value === null ? 'Sin cierre disponible' : `${formatNumber(value)} m³`;
}

export function totalizerCurrentText(item: FlexibleRecord): string {
  const value = currentTotalizerValue(item);
  return value === null ? 'Sin totalizador actual' : `${formatNumber(value)} m³`;
}

export function periodVolumeText(item: FlexibleRecord): string {
  const value = periodVolumeValue(item);
  return value === null ? periodText(item) : `${formatNumber(value)} m³`;
}

export function flowText(item: FlexibleRecord, fallbackUnit = 'L/s'): string {
  const value = flowValue(item);
  const unit = String(item.flow_unit || fallbackUnit);
  return value === null ? '—' : `${formatNumber(value)} ${unit}`;
}

export function formatMinutes(value: unknown): string {
  const numeric = numberOrNull(value);
  if (numeric === null) return '—';
  if (numeric < 60) return `${Math.max(Math.round(numeric), 0)} min`;
  const hours = Math.floor(numeric / 60);
  const minutes = Math.round(numeric % 60);
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function sumValues(items: FlexibleRecord[], getter: (item: FlexibleRecord) => number | null): number | null {
  let total = 0;
  let count = 0;
  items.forEach((item) => {
    const value = getter(item);
    if (value !== null) {
      total += value;
      count += 1;
    }
  });
  return count ? total : null;
}

export function countActive(items: FlexibleRecord[]): number {
  return items.filter((item) => item.active === true || (flowValue(item) ?? 0) > 0 || String(item.status || '').toLowerCase().includes('operando') || String(item.status || '').toLowerCase().includes('encendido')).length;
}

export function countIdle(items: FlexibleRecord[]): number {
  return items.filter((item) => item.active === false || ((flowValue(item) ?? 0) === 0 && item.estado_comunicacion !== 'Sin datos') || String(item.status || '').toLowerCase().includes('apagado')).length;
}
