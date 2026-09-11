import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchWaterShifts } from '../../../services/waterService';

type ShiftCutsOptions = {
  module: string;
  elementId?: string;
  initialDate?: string;
  enabled?: boolean;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isToday(value: string): boolean {
  return value === today();
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'No se pudieron cargar cortes por turno';
}

export default function useShiftCuts({ module, elementId, initialDate, enabled = true }: ShiftCutsOptions) {
  const [date, setDate] = useState(initialDate || today());
  const [data, setData] = useState<unknown | null>(null);
  const dataRef = useRef<unknown | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const latestRequestRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const paramsKey = useMemo(() => `${module}:${elementId || ''}:${date}`, [module, elementId, date]);
  const shouldPoll = enabled && isToday(date);

  useEffect(() => {
    if (initialDate && initialDate !== date) setDate(initialDate);
  }, [initialDate, date]);

  const load = useCallback((mode: 'initial' | 'refresh' = 'initial') => {
    if (!enabled) return;
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    const hasData = dataRef.current !== null;
    const isRefresh = mode === 'refresh' || hasData;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    if (!hasData) setError('');

    fetchWaterShifts({ module, elementId, date, forceRefresh: isRefresh })
      .then((payload) => {
        if (latestRequestRef.current !== requestId) return;
        dataRef.current = payload;
        setData(payload);
        setError('');
      })
      .catch((err) => {
        if (latestRequestRef.current !== requestId) return;
        if (!dataRef.current) setData(null);
        setError(errorText(err));
      })
      .finally(() => {
        if (latestRequestRef.current !== requestId) return;
        setLoading(false);
        setRefreshing(false);
      });
  }, [enabled, module, elementId, date]);

  useEffect(() => {
    dataRef.current = null;
    setData(null);
    load('initial');
    return () => {
      latestRequestRef.current += 1;
    };
  }, [paramsKey, load]);

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
        if (document.visibilityState === 'visible') load('refresh');
      }, 60 * 1000);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        load('refresh');
        startTimer();
      } else {
        clearTimer();
      }
    };
    if (document.visibilityState === 'visible') startTimer();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [shouldPoll, load]);

  const reset = () => setDate(today());
  const refresh = () => load('refresh');

  return { date, setDate, data, error, loading, refreshing, refresh, reset, isToday: isToday(date) };
}
