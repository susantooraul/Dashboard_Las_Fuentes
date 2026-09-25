import api from './api';
const reportPreviewCache = new Map();
const reportPendingRequests = new Map();
const REPORT_CURRENT_TTL_MS = 25 * 1000;
const REPORT_HISTORY_TTL_MS = 10 * 60 * 1000;
const REPORT_MAX_CACHE_ENTRIES = 40;
function reportParams({ date, startDate, endDate } = {}) {
    const params = new URLSearchParams();
    if (date)
        params.set('date', date);
    if (startDate)
        params.set('start_date', startDate);
    if (endDate)
        params.set('end_date', endDate);
    return params;
}
function suffixFrom(filters = {}) {
    const params = reportParams(filters);
    return params.toString() ? `?${params.toString()}` : '';
}
function fallbackDate({ date, startDate, endDate } = {}) {
    return startDate && endDate && startDate !== endDate
        ? `${startDate}-a-${endDate}`
        : (date || startDate || new Date().toISOString().slice(0, 10));
}
function downloadBlob(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
}
function filenameFromHeaders(headers, fallback) {
    const contentDisposition = String(headers?.['content-disposition'] || '');
    const filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
    return filenameMatch?.[1] || fallback;
}
function reportPreviewKey(filters = {}) {
    const params = reportParams(filters);
    return params.toString() || 'today';
}
function reportTtlFor(filters = {}) {
    const today = new Date().toISOString().slice(0, 10);
    const date = filters.date || filters.endDate || filters.startDate || today;
    if (filters.date === today || filters.endDate === today || (!filters.date && !filters.startDate && !filters.endDate)) {
        return REPORT_CURRENT_TTL_MS;
    }
    return date < today ? REPORT_HISTORY_TTL_MS : REPORT_CURRENT_TTL_MS;
}
function shouldCacheReportPayload(data) {
    if (!data || typeof data !== 'object')
        return true;
    const status = String(data.source_status || '').toLowerCase();
    return status !== 'sql_error';
}
function rememberReportCacheEntry(key, data, ttlMs) {
    if (reportPreviewCache.size >= REPORT_MAX_CACHE_ENTRIES && !reportPreviewCache.has(key)) {
        const oldestKey = reportPreviewCache.keys().next().value;
        if (oldestKey)
            reportPreviewCache.delete(oldestKey);
    }
    reportPreviewCache.set(key, { ts: Date.now(), ttlMs, data });
    return data;
}
export async function getDailyWaterReport(filters = {}) {
    const key = reportPreviewKey(filters);
    const ttlMs = reportTtlFor(filters);
    const cached = reportPreviewCache.get(key);
    const now = Date.now();
    if (!filters.forceRefresh && cached && now - cached.ts < ttlMs)
        return cached.data;
    const pending = reportPendingRequests.get(key);
    if (pending)
        return pending;
    const previewParams = reportParams(filters);
    if (filters.forceRefresh)
        previewParams.set('force_refresh', 'true');
    const previewSuffix = previewParams.toString() ? `?${previewParams.toString()}` : '';
    const request = api
        .get(`/water/reports/daily${previewSuffix}`, {
        timeout: Number(filters.requestTimeoutMs || 45000),
    })
        .then(({ data }) => (shouldCacheReportPayload(data) ? rememberReportCacheEntry(key, data, ttlMs) : data))
        .finally(() => reportPendingRequests.delete(key));
    reportPendingRequests.set(key, request);
    return request;
}
export async function downloadDailyWaterReportPdf(filters = {}) {
    const response = await api.get(`/water/reports/daily/pdf${suffixFrom(filters)}`, { responseType: 'blob' });
    const blob = new Blob([response.data], { type: 'application/pdf' });
    const filename = filenameFromHeaders(response.headers || {}, `reporte-diario-control-hidrico-las-fuentes-${fallbackDate(filters)}.pdf`);
    downloadBlob(blob, filename);
}
export async function downloadDailyWaterReportExcel(filters = {}) {
    const response = await api.get(`/water/reports/daily/excel${suffixFrom(filters)}`, { responseType: 'blob' });
    const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const filename = filenameFromHeaders(response.headers || {}, `reporte-diario-control-hidrico-las-fuentes-${fallbackDate(filters)}.xlsx`);
    downloadBlob(blob, filename);
}
export async function downloadFullWaterHistoryExcel() {
    const response = await api.get('/water/history/full/excel', { responseType: 'blob', timeout: 900000 });
    const blob = new Blob([response.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const filename = filenameFromHeaders(response.headers || {}, 'las_fuentes_historico_completo.xlsx');
    downloadBlob(blob, filename);
}
export async function downloadFullWaterHistoryPdf() {
    const response = await api.get('/water/history/full/pdf', { responseType: 'blob', timeout: 900000 });
    const blob = new Blob([response.data], { type: 'application/pdf' });
    const filename = filenameFromHeaders(response.headers || {}, 'las_fuentes_historico_completo.pdf');
    downloadBlob(blob, filename);
}
export async function openDailyWaterReportHtml(filters = {}) {
    const response = await api.get(`/water/reports/daily/html${suffixFrom(filters)}`, { responseType: 'blob' });
    const blob = new Blob([response.data], { type: 'text/html;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
}
export async function sendDailyWaterReportEmail(payload) {
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
    const { data } = await api.post('/water/reports/daily/email', body);
    return data;
}
export async function getReportEmailSchedules() {
    const { data } = await api.get('/water/report-email-schedules');
    return data;
}
export async function createReportEmailSchedule(payload) {
    const { data } = await api.post('/water/report-email-schedules', payload);
    return data;
}
export async function updateReportEmailSchedule(id, payload) {
    const { data } = await api.patch(`/water/report-email-schedules/${encodeURIComponent(id)}`, payload);
    return data;
}
export async function deleteReportEmailSchedule(id) {
    await api.delete(`/water/report-email-schedules/${encodeURIComponent(id)}`);
}
export async function runReportEmailScheduleNow(id) {
    const { data } = await api.post(`/water/report-email-schedules/${encodeURIComponent(id)}/run-now`);
    return data;
}
