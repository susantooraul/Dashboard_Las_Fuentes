import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { fetchWaterDashboard } from '../../../services/waterService';
import { dateInputDay, dateRangePeriod, defaultTodayRange, todayInputDate } from '../dateUtils';
import type { DateRange } from '../types';

const REFRESH_INTERVAL_MS = 60 * 1000;

function errorMessage(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { name?: unknown; code?: unknown; message?: unknown };
  return record.name === 'AbortError' || record.code === 'ERR_CANCELED' || String(record.message || '').toLowerCase().includes('canceled');
}

function rangeIncludesToday(range: DateRange): boolean {
  const today = dateInputDay(todayInputDate());
  const start = dateInputDay(range.startDate);
  const end = dateInputDay(range.endDate);
  if (today === null) return false;
  if (start === null && end === null) return true;
  if (start !== null && end !== null) return start <= today && today <= end;
  if (start !== null) return start <= today;
  if (end !== null) return today <= end;
  return false;
}

export interface UseSqlChartDashboardResult {
  draftRange: DateRange;
  setDraftRange: Dispatch<SetStateAction<DateRange>>;
  range: DateRange;
  setRange: Dispatch<SetStateAction<DateRange>>;
  dashboard: unknown | null;
  error: string;
  loading: boolean;
  refreshing: boolean;
  lastUpdatedAt: number | null;
  apply: () => void;
  reset: () => void;
  refresh: () => void;
}

export interface UseSqlChartDashboardOptions {
  includeHistory?: boolean;
  includeEnergyWater?: boolean;
  includePeriodDeltas?: boolean;
  enabled?: boolean;
  polling?: boolean;
  params?: Record<string, unknown>;
}

export default function useSqlChartDashboard(
  section = 'dashboard',
  initialRangeFactory: () => DateRange = defaultTodayRange,
  options: UseSqlChartDashboardOptions = {},
): UseSqlChartDashboardResult {
  const [draftRange, setDraftRange] = useState(initialRangeFactory);
  const [range, setRange] = useState(initialRangeFactory);
  const [dashboard, setDashboard] = useState<unknown | null>(null);
  const dashboardRef = useRef<unknown | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const latestRequestRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const enabled = options.enabled !== false;
  const pollingEnabled = options.polling !== false;
  const includeHistory = options.includeHistory === true;
  const includeEnergyWater = options.includeEnergyWater === true;
  const includePeriodDeltas = options.includePeriodDeltas === true;
  const extraParams = useMemo(() => options.params || {}, [JSON.stringify(options.params || {})]);
  const extraParamsKey = useMemo(() => JSON.stringify(extraParams), [extraParams]);
  const shouldPoll = enabled && pollingEnabled && rangeIncludesToday(range);

  const loadDashboard = useCallback((mode: 'initial' | 'refresh' | 'poll' = 'initial') => {
    if (!enabled) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    const hasCurrentData = dashboardRef.current !== null;
    const isRefresh = mode === 'refresh' || hasCurrentData;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    if (!hasCurrentData) setError('');

    fetchWaterDashboard(section, {
      ...range,
      ...extraParams,
      period: dateRangePeriod(range),
      include_history: includeHistory,
      include_energy_water: includeEnergyWater,
      include_period_deltas: includePeriodDeltas,
      force_refresh: mode === 'refresh',
      requestScope: `sql-chart:${section}:${extraParamsKey}`,
    })
      .then((data) => {
        if (latestRequestRef.current !== requestId) return;
        dashboardRef.current = data;
        setDashboard(data);
        setError('');
        setLastUpdatedAt(Date.now());
      })
      .catch((fetchError: unknown) => {
        if (latestRequestRef.current !== requestId || isAbortError(fetchError)) return;
        if (!dashboardRef.current) {
          setDashboard(null);
        }
        setError(errorMessage(fetchError) || 'No se pudo leer la fuente de monitoreo');
      })
      .finally(() => {
        if (latestRequestRef.current !== requestId) return;
        setLoading(false);
        setRefreshing(false);
      });
  }, [enabled, section, range.startDate, range.endDate, range.refreshKey, includeHistory, includeEnergyWater, includePeriodDeltas, extraParamsKey]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setRefreshing(false);
      return undefined;
    }
    loadDashboard('initial');
    return () => {
      latestRequestRef.current += 1;
    };
  }, [loadDashboard, enabled]);

  useEffect(() => {
    if (!shouldPoll) return undefined;

    const clearTimer = () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const startTimer = () => {
      clearTimer();
      intervalRef.current = window.setInterval(() => {
        if (document.visibilityState === 'visible') loadDashboard('poll');
      }, REFRESH_INTERVAL_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadDashboard('poll');
        startTimer();
      } else {
        clearTimer();
      }
    };

    if (document.visibilityState === 'visible') startTimer();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [shouldPoll, loadDashboard]);

  const apply = () => {
    setRange((previous) => ({ ...draftRange, refreshKey: (previous.refreshKey || 0) + 1 }));
  };
  const reset = () => {
    const next = defaultTodayRange();
    setDraftRange(next);
    setRange((previous) => ({ ...next, refreshKey: (previous.refreshKey || 0) + 1 }));
  };
  const refresh = () => loadDashboard('refresh');

  return { draftRange, setDraftRange, range, setRange, dashboard, error, loading, refreshing, lastUpdatedAt, apply, reset, refresh };
}
