import api from './api';

export type ModuleHistoryExportModule = 'well' | 'line' | 'flow' | 'level' | 'uv';
export type ModuleHistoryExportMetric = 'flow' | 'totalizer' | 'both' | 'detail' | 'level' | 'uv_horometer' | 'uv_flow';
export type ModuleHistoryTotalizerDisplay = 'delta' | 'absolute';

interface ModuleHistoryPdfRequest {
  module: ModuleHistoryExportModule;
  startDate: string;
  endDate: string;
  aggregation: string;
  metric: ModuleHistoryExportMetric;
  totalizerDisplay?: ModuleHistoryTotalizerDisplay;
  detailVolumeDisplay?: 'interval' | 'cumulative';
  selectedIds?: string[];
}

function filenameFromDisposition(value: unknown, fallback: string): string {
  const header = String(value || '');
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try { return decodeURIComponent(utf8[1]); } catch { return utf8[1]; }
  }
  const regular = header.match(/filename="?([^";]+)"?/i);
  return regular?.[1] || fallback;
}

async function detailFromBlobError(error: unknown): Promise<string> {
  const candidate = error as { response?: { data?: Blob | { detail?: unknown } }; message?: unknown };
  const data = candidate?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (typeof parsed?.detail === 'string' && parsed.detail.trim()) return parsed.detail;
      if (Array.isArray(parsed?.detail)) return parsed.detail.map((issue: { msg?: string }) => issue.msg || 'Parámetro inválido').join('. ');
    } catch { /* usar fallback */ }
  } else if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
  }
  return typeof candidate?.message === 'string' && candidate.message.trim()
    ? candidate.message
    : 'No fue posible generar el PDF del historico.';
}

export async function downloadWaterModuleHistoryPdf(options: ModuleHistoryPdfRequest): Promise<string> {
  try {
    const response = await api.get<Blob>('/water/history/module/pdf', {
      params: {
        module: options.module,
        start_date: options.startDate,
        end_date: options.endDate,
        aggregation: options.aggregation,
        metric: options.metric,
        totalizer_display: options.metric === 'both' ? 'delta' : (options.totalizerDisplay || 'delta'),
        detail_volume_display: options.detailVolumeDisplay || 'interval',
        selected: (options.selectedIds || []).join(','),
      },
      responseType: 'blob',
      timeout: 120_000,
    });
    const fallback = `ARCA_Las_Fuentes_${options.module}_${options.startDate}_${options.endDate}.pdf`;
    const filename = filenameFromDisposition(response.headers['content-disposition'], fallback);
    const url = window.URL.createObjectURL(response.data);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    return filename;
  } catch (error) {
    throw new Error(await detailFromBlobError(error));
  }
}

export interface IndividualThresholdExportRequest {
  module: 'well' | 'line' | 'flow';
  sensorId: number;
  startDate: string;
  endDate: string;
  aggregation: string;
  detailVolumeDisplay: 'interval' | 'cumulative';
  direction: 'below' | 'above' | 'both';
  basis: 'extreme' | 'average';
  minValue: number | null;
  maxValue: number | null;
}

export async function downloadWaterDetailThresholdExport(
  format: 'pdf' | 'excel', options: IndividualThresholdExportRequest,
): Promise<string> {
  try {
    const response = await api.get<Blob>(`/water/history/detail/${format}`, {
      params: {
        module: options.module, sensor_id: options.sensorId,
        start_date: options.startDate, end_date: options.endDate,
        aggregation: options.aggregation, detail_volume_display: options.detailVolumeDisplay,
        threshold_enabled: true, threshold_direction: options.direction, threshold_basis: options.basis,
        threshold_min_value: options.direction === 'above' ? undefined : options.minValue,
        threshold_max_value: options.direction === 'below' ? undefined : options.maxValue,
      },
      responseType: 'blob', timeout: 120_000,
    });
    const fallback = `ARCA_Las_Fuentes_${options.sensorId}_${options.startDate}_${options.endDate}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
    const filename = filenameFromDisposition(response.headers['content-disposition'], fallback);
    const url = window.URL.createObjectURL(response.data);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
    return filename;
  } catch (error) {
    const candidate = error as { response?: { status?: number } };
    const status = candidate?.response?.status;
    if (status === 401) throw new Error('La sesión caducó. Inicia sesión nuevamente para exportar.');
    if (status === 404) throw new Error('El backend no tiene instalada la exportación individual de umbrales.');
    if (status === 504 || status === 503) throw new Error('El histórico no está disponible o tardó demasiado en responder.');
    throw new Error(await detailFromBlobError(error));
  }
}
