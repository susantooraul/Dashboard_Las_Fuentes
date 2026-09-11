import api from './api';
import type { ID } from '../types';

const cache = new Map<string, { ts: number; data: unknown }>();
const TTL_MS = 60 * 1000;

interface DashboardFilters {
  startDate?: string;
  endDate?: string;
  [key: string]: unknown;
}

function cacheKey(plantId: ID, section: string, filters: DashboardFilters = {}): string {
  return JSON.stringify({
    plantId,
    section,
    startDate: filters.startDate || '',
    endDate: filters.endDate || '',
  });
}

export const clearDashboardCache = (): void => cache.clear();

export const fetchDashboard = async (plantId: ID, section: string, filters: DashboardFilters = {}): Promise<unknown> => {
  const key = cacheKey(plantId, section, filters);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.ts < TTL_MS) return cached.data;

  const params: Record<string, string> = {};
  if (filters.startDate) params.start_date = filters.startDate;
  if (filters.endDate) params.end_date = filters.endDate;
  const { data } = await api.get<unknown>(`/dashboard/plant/${plantId}/${section}`, { params });
  cache.set(key, { ts: now, data });
  return data;
};
