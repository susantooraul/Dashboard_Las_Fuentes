import type { FlexibleRecord } from './types';

export function asRecord(value: unknown): FlexibleRecord {
  return value && typeof value === 'object' ? value as FlexibleRecord : {};
}

export function asRows(value: unknown): FlexibleRecord[] {
  return Array.isArray(value) ? value as FlexibleRecord[] : [];
}

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatNumber(value: unknown, decimals = 2): string {
  const numeric = numberOrNull(value);
  if (numeric === null) return '—';
  return numeric.toLocaleString('es-MX', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatLocalDate(value: unknown): string {
  if (!value) return 'Sin lectura';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('es-MX', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function periodText(item: FlexibleRecord): string {
  const status = String(item.period_status || '').toLowerCase();
  if (status === 'dato_en_revision') return 'Dato en revisión';
  if (status === 'sin_datos') return 'Sin datos';
  const value = numberOrNull(item.period_m3 ?? item.period_delta_m3);
  return value === null ? 'Sin datos' : `${formatNumber(value)} m³`;
}

export function statusType(item: FlexibleRecord): string {
  return String(item.statusType || item.communicationType || 'normal');
}

export function chartLabel(value: unknown): string {
  if (!value) return '';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('es-MX', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function pivotHistory(rows: FlexibleRecord[], valueField: string): FlexibleRecord[] {
  const buckets = new Map<string, FlexibleRecord>();
  rows.forEach((row) => {
    const bucket = String(row.bucket || row.timestamp || '');
    if (!bucket) return;
    const point = buckets.get(bucket) || { bucket, label: chartLabel(bucket) };
    const key = String(row.name || row.id || 'Lectura');
    point[key] = numberOrNull(row[valueField]);
    buckets.set(bucket, point);
  });
  return Array.from(buckets.values()).sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}

export function pivotCommonHistorySeries(seriesRows: FlexibleRecord[], valueField = 'flow_avg_lps'): FlexibleRecord[] {
  const buckets = new Map<string, FlexibleRecord>();
  seriesRows.forEach((series) => {
    const key = String(series.name || series.operational_key || series.sensor_id || 'Lectura');
    const points = Array.isArray(series.points) ? series.points as FlexibleRecord[] : [];
    points.forEach((row) => {
      const bucket = String(row.bucket_start || row.bucket || row.timestamp || '');
      if (!bucket) return;
      const point = buckets.get(bucket) || { bucket, label: chartLabel(bucket) };
      point[key] = numberOrNull(row[valueField]);
      buckets.set(bucket, point);
    });
  });
  return Array.from(buckets.values()).sort((a, b) => String(a.bucket).localeCompare(String(b.bucket)));
}
