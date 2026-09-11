import api from './api';

export interface DailyWaterReportFilters {
  date?: string;
  startDate?: string;
  endDate?: string;
  forceRefresh?: boolean;
  requestTimeoutMs?: number;
}

type ReportCacheEntry = { ts: number; ttlMs: number; data: unknown };

const reportPreviewCache = new Map<string, ReportCacheEntry>();
const reportPendingRequests = new Map<string, Promise<unknown>>();
const REPORT_CURRENT_TTL_MS = 25 * 1000;
const REPORT_HISTORY_TTL_MS = 10 * 60 * 1000;
const REPORT_MAX_CACHE_ENTRIES = 40;

export type DailyWaterReportAttachmentFormat = 'pdf' | 'excel';

export interface DailyWaterReportEmailPayload extends DailyWaterReportFilters {
  to: string;
  cc?: string[];
  subject?: string;
  message?: string;
  formats?: DailyWaterReportAttachmentFormat[];
}

function reportParams({ date, startDate, endDate }: DailyWaterReportFilters = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (date) params.set('date', date);
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  return params;
}

function suffixFrom(filters: DailyWaterReportFilters = {}): string {
  const params = reportParams(filters);
  return params.toString() ? `?${params.toString()}` : '';
}

function fallbackDate({ date, startDate, endDate }: DailyWaterReportFilters = {}): string {
  return startDate && endDate && startDate !== endDate
    ? `${startDate}-a-${endDate}`
    : (date || startDate || new Date().toISOString().slice(0, 10));
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function filenameFromHeaders(headers: Record<string, unknown>, fallback: string): string {
  const contentDisposition = String(headers?.['content-disposition'] || '');
  const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return filenameMatch?.[1] || fallback;
}

function reportPreviewKey(filters: DailyWaterReportFilters = {}): string {
  const params = reportParams(filters);
  return params.toString() || 'today';
}

function reportTtlFor(filters: DailyWaterReportFilters = {}): number {
  const today = new Date().toISOString().slice(0, 10);
  const date = filters.date || filters.endDate || filters.startDate || today;
  if (filters.date === today || filters.endDate === today || (!filters.date && !filters.startDate && !filters.endDate)) {
    return REPORT_CURRENT_TTL_MS;
  }
  return date < today ? REPORT_HISTORY_TTL_MS : REPORT_CURRENT_TTL_MS;
}


function shouldCacheReportPayload(data: unknown): boolean {
  if (!data || typeof data !== 'object') return true;
  const status = String((data as { source_status?: unknown }).source_status || '').toLowerCase();
  return status !== 'sql_error';
}

function rememberReportCacheEntry(key: string, data: unknown, ttlMs: number): unknown {
  if (reportPreviewCache.size >= REPORT_MAX_CACHE_ENTRIES && !reportPreviewCache.has(key)) {
    const oldestKey = reportPreviewCache.keys().next().value;
    if (oldestKey) reportPreviewCache.delete(oldestKey);
  }
  reportPreviewCache.set(key, { ts: Date.now(), ttlMs, data });
  return data;
}

export async function getDailyWaterReport(filters: DailyWaterReportFilters = {}): Promise<unknown> {
  const key = reportPreviewKey(filters);
  const ttlMs = reportTtlFor(filters);
  const cached = reportPreviewCache.get(key);
  const now = Date.now();
  if (!filters.forceRefresh && cached && now - cached.ts < ttlMs) return cached.data;

  const pending = reportPendingRequests.get(key);
  if (pending) return pending;

  const previewParams = reportParams(filters);
  if (filters.forceRefresh) previewParams.set('force_refresh', 'true');
  const previewSuffix = previewParams.toString() ? `?${previewParams.toString()}` : '';
  const request = api
    .get<unknown>(`/water/reports/daily${previewSuffix}`, {
      timeout: Number(filters.requestTimeoutMs || 45000),
    })
    .then(({ data }) => (shouldCacheReportPayload(data) ? rememberReportCacheEntry(key, data, ttlMs) : data))
    .finally(() => reportPendingRequests.delete(key));

  reportPendingRequests.set(key, request);
  return request;
}

export async function downloadDailyWaterReportPdf(filters: DailyWaterReportFilters = {}): Promise<void> {
  const response = await api.get<Blob>(`/water/reports/daily/pdf${suffixFrom(filters)}`, { responseType: 'blob' });
  const blob = new Blob([response.data], { type: 'application/pdf' });
  const filename = filenameFromHeaders(response.headers || {}, `reporte-diario-control-hidrico-insurgentes-${fallbackDate(filters)}.pdf`);
  downloadBlob(blob, filename);
}

export async function downloadDailyWaterReportExcel(filters: DailyWaterReportFilters = {}): Promise<void> {
  const response = await api.get<Blob>(`/water/reports/daily/excel${suffixFrom(filters)}`, { responseType: 'blob' });
  const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const filename = filenameFromHeaders(response.headers || {}, `reporte-diario-control-hidrico-insurgentes-${fallbackDate(filters)}.xlsx`);
  downloadBlob(blob, filename);
}


export async function downloadFullWaterHistoryExcel(): Promise<void> {
  const response = await api.get('/water/history/full/excel', { responseType: 'blob', timeout: 900000 });
  const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const filename = filenameFromHeaders(response.headers || {}, 'insurgentes_historico_completo.xlsx');
  downloadBlob(blob, filename);
}

export async function downloadFullWaterHistoryPdf(): Promise<void> {
  const response = await api.get('/water/history/full/pdf', { responseType: 'blob', timeout: 900000 });
  const blob = new Blob([response.data], { type: 'application/pdf' });
  const filename = filenameFromHeaders(response.headers || {}, 'insurgentes_historico_completo.pdf');
  downloadBlob(blob, filename);
}

export async function openDailyWaterReportHtml(filters: DailyWaterReportFilters = {}): Promise<void> {
  const response = await api.get<Blob>(`/water/reports/daily/html${suffixFrom(filters)}`, { responseType: 'blob' });
  const blob = new Blob([response.data], { type: 'text/html;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
}

export async function sendDailyWaterReportEmail(payload: DailyWaterReportEmailPayload): Promise<unknown> {
  const body = {
    to: payload.to,
    cc: payload.cc?.filter(Boolean),
    subject: payload.subject,
    message: payload.message,
    date: payload.date,
    start_date: payload.startDate,
    end_date: payload.endDate,
    formats: payload.formats?.length ? payload.formats : ['pdf', 'excel'],
  };
  const { data } = await api.post<unknown>('/water/reports/daily/email', body);
  return data;
}

export type ReportEmailSchedulePeriodMode = 'previous_calendar_day_24h' | 'fixed_12h_blocks';

export interface ReportEmailSchedule {
  id: string;
  name: string;
  enabled: boolean;
  period_mode: ReportEmailSchedulePeriodMode;
  formats: DailyWaterReportAttachmentFormat[];
  recipients: string[];
  timezone: string;
  send_delay_minutes: number;
  created_by_user_id: number;
  created_at: string;
  updated_at: string;
  next_run_at?: string | null;
}

export interface ReportEmailSchedulePayload {
  name: string;
  period_mode: ReportEmailSchedulePeriodMode;
  formats: DailyWaterReportAttachmentFormat[];
  recipients: string[];
  enabled?: boolean;
  send_delay_minutes?: number;
}

export async function getReportEmailSchedules(): Promise<ReportEmailSchedule[]> {
  const { data } = await api.get<ReportEmailSchedule[]>('/water/report-email-schedules');
  return data;
}

export async function createReportEmailSchedule(payload: ReportEmailSchedulePayload): Promise<ReportEmailSchedule> {
  const { data } = await api.post<ReportEmailSchedule>('/water/report-email-schedules', payload);
  return data;
}

export async function updateReportEmailSchedule(id: string, payload: Partial<ReportEmailSchedulePayload>): Promise<ReportEmailSchedule> {
  const { data } = await api.patch<ReportEmailSchedule>(`/water/report-email-schedules/${encodeURIComponent(id)}`, payload);
  return data;
}

export async function deleteReportEmailSchedule(id: string): Promise<void> {
  await api.delete(`/water/report-email-schedules/${encodeURIComponent(id)}`);
}

export async function runReportEmailScheduleNow(id: string): Promise<unknown> {
  const { data } = await api.post(`/water/report-email-schedules/${encodeURIComponent(id)}/run-now`);
  return data;
}
