import api from './api';

const cache = new Map();
const TTL_MS = 60 * 1000;

function cacheKey(plantId, section, filters = {}) {
  return JSON.stringify({
    plantId,
    section,
    startDate: filters.startDate || '',
    endDate: filters.endDate || '',
  });
}

export const clearDashboardCache = () => cache.clear();

export const fetchDashboard = async (plantId, section, filters = {}) => {
  const key = cacheKey(plantId, section, filters);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.ts < TTL_MS) return cached.data;

  const params = {};
  if (filters.startDate) params.start_date = filters.startDate;
  if (filters.endDate) params.end_date = filters.endDate;
  const { data } = await api.get(`/dashboard/plant/${plantId}/${section}`, { params });
  cache.set(key, { ts: now, data });
  return data;
};
