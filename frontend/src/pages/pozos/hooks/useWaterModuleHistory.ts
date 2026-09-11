import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { fetchWaterModuleHistory } from '../../../services/waterService';
import { dateInputDay, defaultTodayRange, recommendedHistoryAggregation, todayInputDate } from '../dateUtils';
import type { DateRange, HistoryAggregation, WaterModuleHistoryResponse } from '../types';

const REFRESH_INTERVAL_MS = 60 * 1000;

interface UseWaterModuleHistoryOptions {
  module: 'line' | 'flow' | 'well';
  initialRangeFactory?: () => DateRange;
  enabled?: boolean;
}

export interface UseWaterModuleHistoryResult {
  draftRange: DateRange;
  setDraftRange: Dispatch<SetStateAction<DateRange>>;
  range: DateRange;
  aggregation: HistoryAggregation;
  setAggregation: (value: HistoryAggregation) => void;
  data: WaterModuleHistoryResponse | null;
  error: string;
  loading: boolean;
  refreshing: boolean;
  apply: () => void;
  reset: () => void;
}

function rangeIncludesToday(range: DateRange): boolean {
  const today = dateInputDay(todayInputDate());
  const start = dateInputDay(range.startDate);
  const end = dateInputDay(range.endDate);
  if (today === null || start === null || end === null) return false;
  return start <= today && today <= end;
}

function detailFromError(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: unknown;
      code?: unknown;
      response?: { data?: { detail?: unknown }; status?: number };
    };
    if (candidate.response?.status === 504 || candidate.code === 'ECONNABORTED' || String(candidate.message || '').toLowerCase().includes('timeout')) {
      return 'La consulta tardó demasiado. Reduce el rango o utiliza una agrupación mayor.';
    }
    const detail = candidate.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (typeof candidate.message === 'string' && candidate.message.trim()) return candidate.message;
  }
  return 'No fue posible consultar el histórico del módulo.';
}

export default function useWaterModuleHistory({
  module,
  initialRangeFactory = defaultTodayRange,
  enabled = true,
}: UseWaterModuleHistoryOptions): UseWaterModuleHistoryResult {
  const initialRange = useMemo(() => initialRangeFactory(), [initialRangeFactory]);
  const [draftRange, setDraftRange] = useState<DateRange>(initialRange);
  const [range, setRange] = useState<DateRange>(initialRange);
  const [aggregation, setAggregationState] = useState<HistoryAggregation>(() => recommendedHistoryAggregation(initialRange));
  const [data, setData] = useState<WaterModuleHistoryResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const manualAggregation = useRef(false);
  const lastRequestedRefresh = useRef(0);
  const requestSequence = useRef(0);
  const lastModule = useRef(module);

  useEffect(() => {
    if (lastModule.current === module) return;
    lastModule.current = module;
    requestSequence.current += 1;
    setData(null);
    setError('');
    setLoading(false);
    setRefreshing(false);
  }, [module]);

  useEffect(() => {
    if (!manualAggregation.current) setAggregationState(recommendedHistoryAggregation(draftRange));
  }, [draftRange.startDate, draftRange.endDate]);

  const load = useCallback((forceRefresh = false) => {
    if (!enabled || !range.startDate || !range.endDate) return;
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    if (data) setRefreshing(true);
    else setLoading(true);
    if (!data) setError('');

    fetchWaterModuleHistory({
      module,
      startDate: range.startDate,
      endDate: range.endDate,
      aggregation,
      forceRefresh,
    })
      .then((response) => {
        if (requestSequence.current !== requestId) return;
        setData(response);
        setError('');
      })
      .catch((fetchError: unknown) => {
        if (requestSequence.current !== requestId) return;
        setError(detailFromError(fetchError));
      })
      .finally(() => {
        if (requestSequence.current !== requestId) return;
        setLoading(false);
        setRefreshing(false);
      });
  }, [enabled, module, range.startDate, range.endDate, aggregation, data]);

  useEffect(() => {
    if (!enabled) return undefined;
    const refreshKey = Number(range.refreshKey || 0);
    const forceRefresh = refreshKey > lastRequestedRefresh.current;
    lastRequestedRefresh.current = Math.max(lastRequestedRefresh.current, refreshKey);
    load(forceRefresh);
    return () => {
      requestSequence.current += 1;
    };
  }, [enabled, module, range.startDate, range.endDate, range.refreshKey, aggregation]);

  useEffect(() => {
    if (!enabled || !rangeIncludesToday(range)) return undefined;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(false);
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [enabled, range.startDate, range.endDate, aggregation, load]);

  const setAggregation = (value: HistoryAggregation) => {
    manualAggregation.current = true;
    setAggregationState(value);
  };

  const apply = () => {
    setRange((previous) => ({ ...draftRange, refreshKey: Number(previous.refreshKey || 0) + 1 }));
  };

  const reset = () => {
    const next = initialRangeFactory();
    manualAggregation.current = false;
    setDraftRange(next);
    setAggregationState(recommendedHistoryAggregation(next));
    setRange((previous) => ({ ...next, refreshKey: Number(previous.refreshKey || 0) + 1 }));
  };

  return {
    draftRange,
    setDraftRange,
    range,
    aggregation,
    setAggregation,
    data,
    error,
    loading,
    refreshing,
    apply,
    reset,
  };
}
