import type { DashboardData, DateRange, FlexibleRecord, HistoryAggregation, Period } from './types';

export function formatSqlDate(value: unknown): string {
  if (!value) return 'Última lectura disponible';
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function todayInputDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function defaultTodayRange(): DateRange {
  const today = todayInputDate();
  return { startDate: today, endDate: today, refreshKey: 0 };
}

export function formatDateRangeStatus(range?: DateRange | null, fallback = 'Datos actuales de planta'): string {
  if (!range?.startDate && !range?.endDate) return fallback;
  if (range.startDate && range.endDate && range.startDate === range.endDate) return range.startDate;
  return `${range?.startDate || 'inicio'} → ${range?.endDate || 'último'}`;
}

export function periodLabel(period: string): string {
  if (period === 'minute') return 'por minuto';
  if (period === 'quarter_hour') return 'cada 15 minutos';
  if (period === 'daily') return 'por día';
  if (period === 'monthly') return 'por mes';
  return 'por hora';
}

export function periodTitle(period: string): string {
  if (period === 'minute') return 'Agrupación minuto a minuto';
  if (period === 'quarter_hour') return 'Agrupación cada 15 minutos';
  if (period === 'daily') return 'Agrupación diaria';
  if (period === 'monthly') return 'Agrupación mensual';
  return 'Agrupación horaria';
}

export function dateInputDay(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

export function dateRangeDays(range: DateRange | null = {}): number {
  const startDay = dateInputDay(range?.startDate);
  const endDay = dateInputDay(range?.endDate);
  if (startDay === null || endDay === null) return 1;
  return Math.max(Math.floor(Math.abs(endDay - startDay) / 86_400_000) + 1, 1);
}

export function recommendedHistoryAggregation(range: DateRange | null = {}): HistoryAggregation {
  const days = dateRangeDays(range);
  if (days <= 7) return 'quarter_hour';
  if (days <= 31) return 'hourly';
  return 'daily';
}

export function dateRangePeriod(range: DateRange | null = {}): Period {
  const startDay = dateInputDay(range?.startDate);
  const endDay = dateInputDay(range?.endDate);
  if (startDay !== null && endDay !== null) {
    return startDay === endDay ? 'hourly' : 'daily';
  }
  if (startDay !== null || endDay !== null) return 'hourly';
  return 'hourly';
}

export function dashboardPeriod(dashboard?: DashboardData | null, fallbackRange: DateRange = {}): Period {
  const dateRange = dashboard?.date_range;
  const dateRangeRecord = dateRange && typeof dateRange === 'object' && !Array.isArray(dateRange) ? dateRange as FlexibleRecord : {};
  const period = String(dashboard?.aggregation || dateRangeRecord.period || '').toLowerCase();
  if (['minute', 'quarter_hour', 'hourly', 'daily', 'monthly'].includes(period)) return period as Period;
  return dateRangePeriod(fallbackRange);
}

export function bucketLabel(value: unknown, period: unknown = 'hourly'): string {
  if (!value) return 'Periodo';
  const date = new Date(value as string | number | Date);
  if (Number.isNaN(date.getTime())) return String(value);
  if (period === 'daily') {
    return date.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }
  if (period === 'monthly') {
    return date.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' });
  }
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
