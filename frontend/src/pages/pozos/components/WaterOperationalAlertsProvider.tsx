import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { evaluateOperationalAlerts } from '../operationalAlerts.js';
import useSqlChartDashboard from '../hooks/useSqlChartDashboard';
import { useNotifications } from './NotificationCenter';

export interface OperationalAlert {
  id: string;
  module: string;
  moduleLabel: string;
  elementId: string;
  elementName: string;
  condition: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  route: string;
  timestamp?: string;
}

interface OperationalAlertsContextValue {
  alerts: OperationalAlert[];
  loading: boolean;
  refreshing: boolean;
  error: string;
  lastUpdatedAt: number | null;
}

const OperationalAlertsContext = createContext<OperationalAlertsContextValue>({
  alerts: [],
  loading: false,
  refreshing: false,
  error: '',
  lastUpdatedAt: null,
});

const sessionNotifiedAlertIds = new Set<string>();

export function WaterOperationalAlertsProvider({ children }: { children: ReactNode }) {
  const controller = useSqlChartDashboard('dashboard', undefined, {
    includeHistory: false,
    includePeriodDeltas: true,
    includeEnergyWater: false,
  });
  const { notify } = useNotifications();
  const previousIdsRef = useRef<Set<string>>(new Set());
  const alerts = useMemo(() => evaluateOperationalAlerts(controller.dashboard) as OperationalAlert[], [controller.dashboard]);

  useEffect(() => {
    const currentIds = new Set(alerts.map((alert) => alert.id));
    const previousIds = previousIdsRef.current;
    alerts.forEach((alert) => {
      const isNewlyActive = !previousIds.has(alert.id);
      const wasNotifiedWhileActive = sessionNotifiedAlertIds.has(alert.id);
      if (isNewlyActive && !wasNotifiedWhileActive) {
        notify({
          id: `alert:${alert.id}`,
          type: alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warning' : 'info',
          title: alert.title,
          message: `${alert.elementName} · ${alert.message}`,
          actionLabel: alert.route ? 'Ver detalle' : undefined,
          route: alert.route,
          durationMs: alert.severity === 'critical' ? 12000 : 10000,
        });
        sessionNotifiedAlertIds.add(alert.id);
      }
    });

    sessionNotifiedAlertIds.forEach((id) => {
      if (!currentIds.has(id)) sessionNotifiedAlertIds.delete(id);
    });
    previousIdsRef.current = currentIds;
  }, [alerts, notify]);

  const value = useMemo(() => ({
    alerts,
    loading: controller.loading,
    refreshing: controller.refreshing,
    error: controller.error,
    lastUpdatedAt: controller.lastUpdatedAt,
  }), [alerts, controller.loading, controller.refreshing, controller.error, controller.lastUpdatedAt]);

  return <OperationalAlertsContext.Provider value={value}>{children}</OperationalAlertsContext.Provider>;
}

export function useOperationalAlerts() {
  return useContext(OperationalAlertsContext);
}
