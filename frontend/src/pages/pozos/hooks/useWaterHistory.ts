import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { fetchWaterHistory } from '../../../services/waterService';
import { defaultTodayRange, recommendedHistoryAggregation } from '../dateUtils';
import type { DateRange, HistoryAggregation, WaterHistoryResponse } from '../types';

interface UseWaterHistoryOptions {
  module: 'line' | 'flow' | 'well';
  sensorId?: number | null;
  initialRangeFactory?: () => DateRange;
}

export interface UseWaterHistoryResult {
  draftRange: DateRange;
  setDraftRange: Dispatch<SetStateAction<DateRange>>;
  range: DateRange;
  aggregation: HistoryAggregation;
  setAggregation: (value: HistoryAggregation) => void;
  data: WaterHistoryResponse | null;
  error: string;
  loading: boolean;
  apply: () => void;
  reset: () => void;
}

function detailFromError(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: unknown;
      code?: unknown;
      response?: { data?: { detail?: unknown }; status?: number };
    };
    if (candidate.response?.status === 504 || candidate.code === 'ECONNABORTED' || String(candidate.message || '').toLowerCase().includes('timeout')) {
      return 'La consulta tardó demasiado. Reduce el rango o utiliza agrupación diaria.';
    }
    const detail = candidate.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (typeof candidate.message === 'string' && candidate.message.trim()) return candidate.message;
  }
  return 'No fue posible consultar el histórico de planta.';
}

export default function useWaterHistory({
  module,
  sensorId,
  initialRangeFactory = defaultTodayRange,
}: UseWaterHistoryOptions): UseWaterHistoryResult {
  const initialRange = useMemo(() => initialRangeFactory(), [initialRangeFactory]);
  const [draftRange, setDraftRange] = useState<DateRange>(initialRange);
  const [range, setRange] = useState<DateRange>(initialRange);
  const [aggregation, setAggregationState] = useState<HistoryAggregation>(() => recommendedHistoryAggregation(initialRange));
  const [data, setData] = useState<WaterHistoryResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const manualAggregation = useRef(false);
  const lastRequestedRefresh = useRef(0);
  const lastIdentity = useRef('');

  useEffect(() => {
    if (!manualAggregation.current) {
      setAggregationState(recommendedHistoryAggregation(draftRange));
    }
  }, [draftRange.startDate, draftRange.endDate]);

  useEffect(() => {
    if (!sensorId || !range.startDate || !range.endDate) return undefined;
    let mounted = true;
    const identity = `${module}:${sensorId}`;
    if (lastIdentity.current && lastIdentity.current !== identity) setData(null);
    lastIdentity.current = identity;
    const refreshKey = Number(range.refreshKey || 0);
    const forceRefresh = refreshKey > lastRequestedRefresh.current;
    lastRequestedRefresh.current = Math.max(lastRequestedRefresh.current, refreshKey);
    setLoading(true);
    setError('');
    fetchWaterHistory({
      module,
      sensorId,
      startDate: range.startDate,
      endDate: range.endDate,
      aggregation,
      forceRefresh,
    })
      .then((response) => {
        if (!mounted) return;
        setData(response);
        setError('');
      })
      .catch((fetchError: unknown) => {
        if (!mounted) return;
        // Conservar la última gráfica válida frente a un error temporal.
        setError(detailFromError(fetchError));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [module, sensorId, range.startDate, range.endDate, range.refreshKey, aggregation]);

  const setAggregation = (value: HistoryAggregation) => {
    manualAggregation.current = true;
    setAggregationState(value);
  };

  const apply = () => {
    setRange((previous) => ({
      ...draftRange,
      refreshKey: Number(previous.refreshKey || 0) + 1,
    }));
  };

  const reset = () => {
    const next = initialRangeFactory();
    manualAggregation.current = false;
    setDraftRange(next);
    setAggregationState(recommendedHistoryAggregation(next));
    setRange((previous) => ({
      ...next,
      refreshKey: Number(previous.refreshKey || 0) + 1,
    }));
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
    apply,
    reset,
  };
}
