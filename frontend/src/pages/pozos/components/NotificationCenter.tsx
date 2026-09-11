import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';

export type NotificationType = 'success' | 'error' | 'warning' | 'critical' | 'info';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  actionLabel?: string;
  route?: string;
  durationMs?: number;
  createdAt: number;
}

interface NotificationContextValue {
  notify: (item: Omit<NotificationItem, 'id' | 'createdAt'> & { id?: string }) => string;
  dismiss: (id: string) => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);
const MAX_QUEUE = 8;
let notificationCounter = 0;

function defaultDuration(type: NotificationType): number {
  if (type === 'critical' || type === 'error') return 14000;
  if (type === 'warning') return 12000;
  return 8000;
}

function isPriorityNotification(type: NotificationType): boolean {
  return type === 'critical' || type === 'error' || type === 'warning';
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [minimized, setMinimized] = useState(false);
  const navigate = useNavigate();
  const activeItem = items[0] || null;

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
    setMinimized(false);
  }, []);

  const notify = useCallback((payload: Omit<NotificationItem, 'id' | 'createdAt'> & { id?: string }) => {
    const id = payload.id || `toast-${Date.now()}-${notificationCounter++}`;
    const item: NotificationItem = { ...payload, id, createdAt: Date.now() };

    setItems((current) => {
      const existingIndex = current.findIndex((entry) => entry.id === id);
      if (existingIndex === 0) return [item, ...current.slice(1)].slice(0, MAX_QUEUE);

      const withoutDuplicate = current.filter((entry) => entry.id !== id);
      if (!withoutDuplicate.length) return [item];

      const active = withoutDuplicate[0];
      const queued = withoutDuplicate.slice(1);
      const nextQueue = isPriorityNotification(item.type) ? [item, ...queued] : [...queued, item];
      return [active, ...nextQueue].slice(0, MAX_QUEUE);
    });

    if (payload.type === 'critical' || payload.type === 'error') setMinimized(false);
    return id;
  }, []);

  useEffect(() => {
    if (!activeItem || minimized || activeItem.durationMs === 0) return undefined;
    const timeoutId = window.setTimeout(
      () => dismiss(activeItem.id),
      activeItem.durationMs ?? defaultDuration(activeItem.type),
    );
    return () => window.clearTimeout(timeoutId);
  }, [activeItem?.id, activeItem?.durationMs, activeItem?.type, minimized, dismiss]);

  useEffect(() => {
    if (!items.length && minimized) setMinimized(false);
  }, [items.length, minimized]);

  const value = useMemo(() => ({ notify, dismiss, clearAll }), [notify, dismiss, clearAll]);

  const openActiveRoute = () => {
    if (activeItem?.route) navigate(activeItem.route);
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
      {activeItem ? (
        <div className="notification-viewport" aria-live="polite" aria-relevant="additions text">
          {minimized ? (
            <div className={`notification-toast notification-${activeItem.type} notification-toast-minimized`} role="status">
              <button
                type="button"
                className="notification-minimized-main"
                onClick={() => setMinimized(false)}
                aria-label="Expandir notificaciones"
              >
                <span className="notification-dot" aria-hidden="true" />
                <strong>{activeItem.title}</strong>
                {items.length > 1 ? <span className="notification-queue-count">+{items.length - 1}</span> : null}
              </button>
              <button type="button" className="notification-clear-all" onClick={clearAll}>Cerrar todas</button>
            </div>
          ) : (
            <div
              className={`notification-toast notification-${activeItem.type}`}
              role={activeItem.type === 'critical' || activeItem.type === 'error' ? 'alert' : 'status'}
              tabIndex={activeItem.route ? 0 : -1}
              onClick={openActiveRoute}
              onKeyDown={(event) => {
                if (!activeItem.route) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openActiveRoute();
                }
              }}
            >
              <div className="notification-toast-main">
                <span className="notification-dot" aria-hidden="true" />
                <div className="notification-copy">
                  <div className="notification-title-row">
                    <strong>{activeItem.title}</strong>
                    {items.length > 1 ? <span className="notification-queue-count">1 de {items.length}</span> : null}
                  </div>
                  {activeItem.message ? <p>{activeItem.message}</p> : null}
                  {activeItem.actionLabel ? <em>{activeItem.actionLabel}</em> : null}
                </div>
              </div>
              <div className="notification-toast-actions">
                {items.length > 1 ? (
                  <button
                    type="button"
                    className="notification-clear-all"
                    onClick={(event) => {
                      event.stopPropagation();
                      clearAll();
                    }}
                  >
                    Cerrar todas
                  </button>
                ) : null}
                <button
                  type="button"
                  className="notification-icon-button"
                  aria-label="Minimizar notificación"
                  title="Minimizar"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMinimized(true);
                  }}
                >
                  −
                </button>
                <button
                  type="button"
                  className="notification-icon-button"
                  aria-label="Cerrar notificación"
                  title="Cerrar"
                  onClick={(event) => {
                    event.stopPropagation();
                    dismiss(activeItem.id);
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    return {
      notify: () => '',
      dismiss: () => {},
      clearAll: () => {},
    };
  }
  return context;
}
