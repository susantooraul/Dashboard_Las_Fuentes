import api from './api';
import type { ID } from '../types';

const extensionMap: Record<string, string> = {
  excel: 'xlsx',
  csv: 'csv',
  html: 'html',
  pdf: 'pdf',
  png: 'png',
  jpg: 'jpg',
};

interface ReportFilters {
  startDate?: string;
  endDate?: string;
  [key: string]: unknown;
}

export const downloadReport = async (_plantId: ID, section: string, format: string, filters: ReportFilters = {}): Promise<void> => {
  const params: Record<string, string> = {};
  if (filters.startDate) params.start_date = filters.startDate;
  if (filters.endDate) params.end_date = filters.endDate;
  const response = await api.get<Blob>(`/export/plant/${_plantId}/${section}/${format}`, { responseType: 'blob', params });
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  const disposition = response.headers['content-disposition'] as string | undefined;
  const filenameMatch = disposition?.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
  const fallbackExtension = extensionMap[format] || format;
  const fallbackName = `${section}.${fallbackExtension}`;
  const resolvedName = filenameMatch?.[1] ? decodeURIComponent(filenameMatch[1].replace(/"/g, '')) : fallbackName;
  link.setAttribute('download', resolvedName.endsWith(`.${fallbackExtension}`) ? resolvedName : `${resolvedName}.${fallbackExtension}`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export const sendReportByEmail = async (payload: Record<string, unknown>): Promise<unknown> => {
  const { data } = await api.post<unknown>('/email/report', payload);
  return data;
};
