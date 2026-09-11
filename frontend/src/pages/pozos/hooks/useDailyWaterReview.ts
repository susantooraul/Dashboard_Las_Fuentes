import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDailyWaterReview } from '../../../services/waterService';
import { todayInputDate } from '../dateUtils';

const REFRESH_INTERVAL_MS = 60 * 1000;

function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'No se pudo cargar la revisión diaria';
}

export default function useDailyWaterReview() {
  const initialDate = todayInputDate();
  const [draftDate, setDraftDate] = useState(initialDate);
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState<unknown | null>(null);
  const dataRef = useRef<unknown | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const latestRequestRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const isToday = date === todayInputDate();

  const load = useCallback((mode: 'initial' | 'refresh' = 'initial') => {
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    const hasData = dataRef.current !== null;
    const isRefresh = mode === 'refresh' || hasData;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    if (!hasData) setError('');

    fetchDailyWaterReview({ date, forceRefresh: isRefresh })
      .then((payload) => {
        if (latestRequestRef.current !== requestId) return;
        dataRef.current = payload;
        setData(payload);
        setError('');
      })
      .catch((requestError) => {
        if (latestRequestRef.current !== requestId) return;
        if (!dataRef.current) setData(null);
        setError(errorText(requestError));
      })
      .finally(() => {
        if (latestRequestRef.current !== requestId) return;
        setLoading(false);
        setRefreshing(false);
      });
  }, [date]);

  useEffect(() => {
    dataRef.current = null;
    setData(null);
    load('initial');
    return () => { latestRequestRef.current += 1; };
  }, [date, load]);

  useEffect(() => {
    if (!isToday) return undefined;
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
      }, REFRESH_INTERVAL_MS);
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
  }, [isToday, load]);

  const apply = () => {
    const nextDate = draftDate || date;
    if (nextDate === date) load('refresh');
    else setDate(nextDate);
  };
  const reset = () => {
    const today = todayInputDate();
    setDraftDate(today);
    if (date === today) load('refresh');
    else setDate(today);
  };
  const refresh = () => load('refresh');

  return { draftDate, setDraftDate, date, data, error, loading, refreshing, isToday, apply, reset, refresh };
}
