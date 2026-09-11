import api from './api';

export type FiveMinuteExportModule = 'line' | 'flow' | 'well';

export interface FiveMinuteExportRequest {
  module: FiveMinuteExportModule;
  sensorId: number;
  startDate: string;
  endDate: string;
}

export const FIVE_MINUTE_EXPORT_MAX_DAYS = 3;

function parseDateOnly(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return timestamp;
}

export function validateFiveMinuteExportRange(startDate: string, endDate: string): string | null {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (start === null || end === null) return 'Selecciona un rango de fechas válido para exportar.';
  if (start > end) return 'La fecha inicial no puede ser posterior a la fecha final.';
  const inclusiveDays = Math.floor((end - start) / 86_400_000) + 1;
  if (inclusiveDays > FIVE_MINUTE_EXPORT_MAX_DAYS) {
    return 'La exportación cada 5 minutos permite un máximo de 3 días calendario.';
  }
  return null;
}

function filenameFromDisposition(header: unknown, fallback: string): string {
  const value = String(header || '');
  const utfMatch = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1].replace(/["']/g, ''));
  const regular = /filename="?([^";]+)"?/i.exec(value);
  return regular?.[1]?.trim() || fallback;
}

async function detailFromBlobError(error: unknown): Promise<string> {
  const candidate = error as { response?: { data?: unknown; status?: number }; message?: string };
  const payload = candidate?.response?.data;
  if (payload instanceof Blob) {
    try {
      const text = await payload.text();
      const parsed = JSON.parse(text) as { detail?: unknown };
      if (typeof parsed.detail === 'string' && parsed.detail.trim()) return parsed.detail;
    } catch {
      // Se usa el mensaje genérico de abajo.
    }
  }
  if (candidate?.response?.status === 504) return 'La consulta de 5 minutos tardó demasiado. Reduce el rango e inténtalo de nuevo.';
  if (typeof candidate?.message === 'string' && candidate.message.trim()) return candidate.message;
  return 'No fue posible generar la exportación Excel de 5 minutos.';
}

export async function downloadFiveMinuteHistoryExcel(options: FiveMinuteExportRequest): Promise<string> {
  const validation = validateFiveMinuteExportRange(options.startDate, options.endDate);
  if (validation) throw new Error(validation);

  try {
    const response = await api.get<Blob>('/water/history/five-minute/excel', {
      params: {
        module: options.module,
        sensor_id: options.sensorId,
        start_date: options.startDate,
        end_date: options.endDate,
      },
      responseType: 'blob',
      timeout: 45_000,
    });
    const fallback = `ARCA_Las_Fuentes_${options.sensorId}_5min_${options.startDate}_${options.endDate}.xlsx`;
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

export interface FiveMinuteModuleExportRequest {
  module: FiveMinuteExportModule;
  sensorIds: number[];
  startDate: string;
  endDate: string;
}

export async function downloadFiveMinuteModuleHistoryExcel(options: FiveMinuteModuleExportRequest): Promise<string> {
  const validation = validateFiveMinuteExportRange(options.startDate, options.endDate);
  if (validation) throw new Error(validation);
  const sensorIds = Array.from(new Set((options.sensorIds || []).map(Number).filter((value) => Number.isInteger(value) && value > 0)));
  if (!sensorIds.length) throw new Error('Selecciona al menos un elemento con sensor de minuto para exportar.');

  try {
    const response = await api.get<Blob>('/water/history/five-minute/module/excel', {
      params: {
        module: options.module,
        sensor_ids: sensorIds.join(','),
        start_date: options.startDate,
        end_date: options.endDate,
      },
      responseType: 'blob',
      timeout: 90_000,
    });
    const fallback = `ARCA_Las_Fuentes_${options.module}_5min_${options.startDate}_${options.endDate}.xlsx`;
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
