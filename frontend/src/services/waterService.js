import api from "./api";

const cache = new Map();
const pendingRequests = new Map();
const activeControllers = new Map();

const CURRENT_TTL_MS = 25 * 1000;
const HISTORY_TTL_MS = 10 * 60 * 1000;
const MONTHLY_HISTORY_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

function buildParams(options = {}) {
  const params = {};
  if (options.startDate || options.start_date)
    params.start_date = String(options.startDate || options.start_date);
  if (options.endDate || options.end_date)
    params.end_date = String(options.endDate || options.end_date);
  if (options.period) params.period = String(options.period);
  if (typeof options.include_history === "boolean") params.include_history = options.include_history;
  if (typeof options.includeHistory === "boolean") params.include_history = options.includeHistory;
  if (typeof options.include_energy_water === "boolean") params.include_energy_water = options.include_energy_water;
  if (typeof options.includeEnergyWater === "boolean") params.include_energy_water = options.includeEnergyWater;
  if (typeof options.force_refresh === "boolean") params.force_refresh = options.force_refresh;
  if (typeof options.forceRefresh === "boolean") params.force_refresh = options.forceRefresh;
  if (typeof options.include_period_deltas === "boolean") params.include_period_deltas = options.include_period_deltas;
  if (typeof options.includePeriodDeltas === "boolean") params.include_period_deltas = options.includePeriodDeltas;
  const spanDays = dateSpanDays(params.start_date, params.end_date);
  if (spanDays > 31) params.period = "monthly";
  else if (params.period === "hourly" && spanDays > 2) params.period = "daily";
  return params;
}

function dateSpanDays(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.abs(end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000) + 1;
}

function ttlFor(options = {}) {
  const params = buildParams(options);
  const hasExplicitRange = Boolean(params.start_date || params.end_date);
  const isCurrentOnlyRequest = !params.include_history && !hasExplicitRange;
  if (isCurrentOnlyRequest) return CURRENT_TTL_MS;
  if (!params.include_history && !options.include_period_deltas && !options.includePeriodDeltas) return CURRENT_TTL_MS;
  const period = String(params.period || "").toLowerCase();
  if (period.includes("month") || period.includes("mensual") || dateSpanDays(params.start_date, params.end_date) > 31) {
    return MONTHLY_HISTORY_TTL_MS;
  }
  return HISTORY_TTL_MS;
}

function cacheKey(section, options = {}) {
  const params = buildParams(options);
  return `${section}:${params.start_date || ""}:${params.end_date || ""}:${params.period || ""}:${params.include_history ? "history" : "fast"}:${params.include_period_deltas ? "deltas" : "no-deltas"}:${params.include_energy_water ? "energy" : "no-energy"}`;
}

function shouldCachePayload(data) {
  if (!data || typeof data !== "object") return true;
  const status = String(data.source_status || "").toLowerCase();
  return status !== "sql_error";
}

export function clearWaterCache() {
  cache.clear();
  pendingRequests.clear();
  activeControllers.forEach((controller) => controller.abort());
  activeControllers.clear();
}

function rememberCacheEntry(key, data, ttlMs) {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { ts: Date.now(), ttlMs, data });
  return data;
}

export async function fetchWaterDashboard(section = "dashboard", options = {}) {
  const key = cacheKey(section, options);
  const ttlMs = ttlFor(options);
  const params = buildParams(options);
  const forceRefresh = Boolean(params.force_refresh);
  const now = Date.now();
  const cached = cache.get(key);
  if (!forceRefresh && cached && now - cached.ts < ttlMs) return cached.data;

  const pending = pendingRequests.get(key);
  if (pending) return pending;

  const controllerScope = String(options.requestScope || key);
  const previousController = activeControllers.get(controllerScope);
  if (previousController) previousController.abort();
  const controller = new AbortController();
  activeControllers.set(controllerScope, controller);

  const dashboardTimeout = params.include_history && ["daily", "monthly"].includes(String(params.period || "").toLowerCase()) ? 60000 : 45000;
  const request = api
    .get(`/water/dashboard/${section}`, {
      params,
      signal: controller.signal,
      timeout: Number(options.requestTimeoutMs || dashboardTimeout),
    })
    .then(({ data }) => (shouldCachePayload(data) ? rememberCacheEntry(key, data, ttlMs) : data))
    .finally(() => {
      pendingRequests.delete(key);
      if (activeControllers.get(controllerScope) === controller) activeControllers.delete(controllerScope);
    });

  pendingRequests.set(key, request);
  return request;
}


function plantToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function historyTtl(startDate, endDate) {
  const today = plantToday();
  return startDate <= today && today <= endDate ? CURRENT_TTL_MS : HISTORY_TTL_MS;
}

function historyCacheKey(options = {}) {
  return ["history", options.module, options.sensorId, options.startDate, options.endDate, options.aggregation].join(":");
}

export async function fetchWaterHistory(options = {}) {
  const key = historyCacheKey(options);
  const ttlMs = historyTtl(options.startDate, options.endDate);
  const now = Date.now();
  if (options.forceRefresh) cache.delete(key);
  const cached = cache.get(key);
  if (!options.forceRefresh && cached && now - cached.ts < ttlMs) return cached.data;

  const pending = pendingRequests.get(key);
  if (pending) return pending;

  const spanDays = dateSpanDays(options.startDate, options.endDate);
  const longRangeTimeout = options.aggregation === "daily"
    ? (spanDays > 31 ? 180000 : 120000)
    : options.aggregation === "hourly"
      ? 120000
      : 45000;
  const request = api
    .get("/water/history", {
      params: {
        module: options.module,
        sensor_id: options.sensorId,
        start_date: options.startDate,
        end_date: options.endDate,
        aggregation: options.aggregation,
        force_refresh: Boolean(options.forceRefresh),
      },
      timeout: longRangeTimeout,
      signal: options.signal,
    })
    .then(({ data }) => rememberCacheEntry(key, data, ttlMs))
    .finally(() => pendingRequests.delete(key));

  pendingRequests.set(key, request);
  return request;
}

function moduleHistoryCacheKey(options = {}) {
  return ["history-module", options.module, options.startDate, options.endDate, options.aggregation].join(":");
}

export async function fetchWaterModuleHistory(options = {}) {
  const key = moduleHistoryCacheKey(options);
  const pendingKey = `${key}:${options.forceRefresh ? "force" : "normal"}`;
  const ttlMs = historyTtl(options.startDate, options.endDate);
  const now = Date.now();
  if (options.forceRefresh) cache.delete(key);
  const cached = cache.get(key);
  if (!options.forceRefresh && cached && now - cached.ts < ttlMs) return cached.data;

  // React StrictMode can execute the loading effect twice in development.
  // Coalesce identical in-flight module history requests so SQL Server receives one scan.
  const pending = pendingRequests.get(pendingKey);
  if (pending) return pending;

  const spanDays = dateSpanDays(options.startDate, options.endDate);
  const longRangeTimeout = options.aggregation === "daily"
    ? (spanDays > 31 ? 180000 : 120000)
    : options.aggregation === "hourly"
      ? 120000
      : 45000;
  const request = api
    .get("/water/history/module", {
      params: {
        module: options.module,
        start_date: options.startDate,
        end_date: options.endDate,
        aggregation: options.aggregation,
        force_refresh: Boolean(options.forceRefresh),
      },
      timeout: longRangeTimeout,
      signal: options.signal,
    })
    .then(({ data }) => rememberCacheEntry(key, data, ttlMs))
    .finally(() => pendingRequests.delete(pendingKey));

  pendingRequests.set(pendingKey, request);
  return request;
}

export async function fetchWellMinuteFlow(options = {}) {
  const params = {};
  if (options.startDate || options.start_date) {
    params.start_date = String(options.startDate || options.start_date);
  }
  if (options.endDate || options.end_date) {
    params.end_date = String(options.endDate || options.end_date);
  }
  if (options.start_datetime) {
    params.start_datetime = String(options.start_datetime);
  }
  if (options.end_datetime) {
    params.end_datetime = String(options.end_datetime);
  }
  const wellNumbers = options.wellNumbers || options.well_numbers;
  if (Array.isArray(wellNumbers) && wellNumbers.length) {
    params.well_numbers = wellNumbers.join(",");
  } else if (typeof wellNumbers === "string" && wellNumbers.trim()) {
    params.well_numbers = wellNumbers.trim();
  }
  const { data } = await api.get("/water/wells/minute-flow", {
    params,
    timeout: Number(options.requestTimeoutMs || 15000),
  });
  return data;
}

export async function fetchWellTotalizerCutoff(options = {}) {
  const params = {};
  if (options.date) params.date = String(options.date);
  const { data } = await api.get("/water/wells/totalizer-cutoff", {
    params,
    timeout: Number(options.requestTimeoutMs || 15000),
  });
  return data;
}

export async function fetchDailyWaterReview(options = {}) {
  const date = String(options.date || plantToday());
  const key = `review-daily:${date}`;
  const ttlMs = historyTtl(date, date);
  const forceRefresh = Boolean(options.forceRefresh || options.force_refresh);
  const now = Date.now();
  if (forceRefresh) cache.delete(key);
  const cached = cache.get(key);
  if (!forceRefresh && cached && now - cached.ts < ttlMs) return cached.data;

  const pending = pendingRequests.get(key);
  if (pending) return pending;

  const request = api
    .get('/water/review/daily', {
      params: { date, force_refresh: forceRefresh },
      timeout: Number(options.requestTimeoutMs || 60000),
      signal: options.signal,
    })
    .then(({ data }) => rememberCacheEntry(key, data, ttlMs))
    .finally(() => pendingRequests.delete(key));
  pendingRequests.set(key, request);
  return request;
}

export async function fetchWaterReportCatalog(options = {}) {
  const { data } = await api.get("/water/reports/catalog", {
    params: buildParams(options),
  });
  return data;
}

export async function fetchWaterSources() {
  const { data } = await api.get("/water/sources");
  return data;
}

export async function validateWaterSource(file) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post("/water/sources/validate", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function uploadWaterSource(file, activate = true) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post(
    `/water/sources/upload?activate=${activate}`,
    formData,
    {
      headers: { "Content-Type": "multipart/form-data" },
    },
  );
  clearWaterCache();
  return data;
}

export async function activateWaterSource(sourceId) {
  const { data } = await api.post(`/water/sources/${sourceId}/activate`);
  clearWaterCache();
  return data;
}

function shiftCacheKey(options = {}) {
  return `shifts:${options.date || ""}:${options.module || "all"}:${options.elementId || options.element_id || ""}`;
}

function shiftTtlFor(dateValue) {
  const today = new Date().toISOString().slice(0, 10);
  if (!dateValue || dateValue === today) return CURRENT_TTL_MS;
  return HISTORY_TTL_MS;
}

export async function fetchWaterShifts(options = {}) {
  const params = {};
  if (options.date) params.date = options.date;
  if (options.module) params.module = options.module;
  if (options.elementId || options.element_id) params.element_id = String(options.elementId || options.element_id);
  if (typeof options.forceRefresh === "boolean") params.force_refresh = options.forceRefresh;
  if (typeof options.force_refresh === "boolean") params.force_refresh = options.force_refresh;

  const key = shiftCacheKey(options);
  const ttlMs = shiftTtlFor(options.date);
  const forceRefresh = Boolean(params.force_refresh);
  const cached = cache.get(key);
  const now = Date.now();
  if (!forceRefresh && cached && now - cached.ts < ttlMs) return cached.data;

  const pending = pendingRequests.get(key);
  if (pending) return pending;

  const request = api
    .get("/water/shifts", {
      params,
      timeout: Number(options.requestTimeoutMs || 45000),
    })
    .then(({ data }) => (shouldCachePayload(data) ? rememberCacheEntry(key, data, ttlMs) : data))
    .finally(() => pendingRequests.delete(key));

  pendingRequests.set(key, request);
  return request;
}
