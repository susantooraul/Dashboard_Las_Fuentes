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
