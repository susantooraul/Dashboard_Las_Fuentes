import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

let csrfToken = '';
let authExpiryDispatched = false;
let lastHumanActivityAt = 0;

const BROWSER_SESSION_STORAGE_KEY = 'arca_lfu_browser_session';
const CSRF_STORAGE_KEY = 'arca_lfu_csrf_token';
const BOS_LOCAL_SESSION_STORAGE_KEY = 'arca_lfu_bos_local_session';
const LEGACY_TAB_SESSION_STORAGE_KEY = 'arca_lfu_tab_session';
const LEGACY_TOKEN_KEY = 'siem_demo_token';
const LEGACY_USER_KEY = 'siem_demo_user';
const AUTH_CHANNEL = 'arca-lfu-auth';
const USER_ACTIVITY_WINDOW_MS = 30_000;
const BOS_LOCAL_HTTP_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  ...String(import.meta.env.VITE_BOS_LOCAL_HTTP_HOSTS || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean),
]);
const ACTIVE_TABS_STORAGE_KEY = 'arca_lfu_active_tabs';
const TAB_ID_STORAGE_KEY = 'arca_lfu_tab_id';
const ACTIVE_TAB_TTL_MS = 20_000;
const ACTIVE_TAB_HEARTBEAT_MS = 5_000;

function safeStorage(kind: 'localStorage' | 'sessionStorage'): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try { return window[kind]; } catch { return undefined; }
}

function createAuthChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return null;
  try { return new BroadcastChannel(AUTH_CHANNEL); } catch { return null; }
}

const sharedStorage = safeStorage('localStorage');
const tabStorage = safeStorage('sessionStorage');
const authChannel = createAuthChannel();
const memoryStorage = new Map<string, string>();

function readSharedValue(key: string): string {
  try {
    const value = sharedStorage?.getItem(key);
    if (value) return value;
  } catch { /* continuar con fallback */ }
  try {
    const value = tabStorage?.getItem(key);
    if (value) return value;
  } catch { /* continuar con fallback */ }
  return memoryStorage.get(key) || '';
}

function writeSharedValue(key: string, value: string): void {
  memoryStorage.set(key, value);
  try { sharedStorage?.setItem(key, value); } catch { /* fallback abajo */ }
  try { tabStorage?.setItem(key, value); } catch { /* memoria mantiene la sesión de esta vista */ }
}

function removeSharedValue(key: string): void {
  memoryStorage.delete(key);
  try { sharedStorage?.removeItem(key); } catch { /* sin acción */ }
  try { tabStorage?.removeItem(key); } catch { /* sin acción */ }
}

function isPrivateOrLocalHost(host: string): boolean {
  if (BOS_LOCAL_HTTP_HOSTS.has(host)) return true;
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
}

function isBosLocalHttpPage(): boolean {
  if (typeof window === 'undefined') return false;
  const protocol = String(window.location?.protocol || '').toLowerCase();
  const host = String(window.location?.hostname || '').toLowerCase();
  return protocol === 'http:' && isPrivateOrLocalHost(host);
}

function readBosLocalSessionToken(): string {
  if (!isBosLocalHttpPage()) return '';
  return readSharedValue(BOS_LOCAL_SESSION_STORAGE_KEY);
}

export function setBosLocalSessionToken(value?: string | null): void {
  if (isBosLocalHttpPage() && value) writeSharedValue(BOS_LOCAL_SESSION_STORAGE_KEY, String(value));
  else removeSharedValue(BOS_LOCAL_SESSION_STORAGE_KEY);
}

function postAuthMessage(message: { type: string }): void {
  try { authChannel?.postMessage(message); } catch { /* storage sigue sincronizando */ }
}

function emitAuthExpired(): void {
  if (typeof window === 'undefined' || authExpiryDispatched) return;
  authExpiryDispatched = true;
  window.dispatchEvent(new CustomEvent('arca-auth-expired'));
}

function emitAuthUpdated(): void {
  if (typeof window === 'undefined') return;
  authExpiryDispatched = false;
  window.dispatchEvent(new CustomEvent('arca-auth-updated'));
}

function getTabId(): string {
  let value = '';
  try { value = tabStorage?.getItem(TAB_ID_STORAGE_KEY) || ''; } catch { value = ''; }
  if (!value) {
    value = `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try { tabStorage?.setItem(TAB_ID_STORAGE_KEY, value); } catch { /* memoria no necesita id estable */ }
  }
  return value;
}

function readActiveTabs(): Record<string, number> {
  try {
    const parsed = JSON.parse(sharedStorage?.getItem(ACTIVE_TABS_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, number> : {};
  } catch {
    return {};
  }
}

function writeActiveTabs(tabs: Record<string, number>): void {
  try { sharedStorage?.setItem(ACTIVE_TABS_STORAGE_KEY, JSON.stringify(tabs)); } catch { /* sin accion */ }
}

function pruneActiveTabs(): Record<string, number> {
  const now = Date.now();
  const tabs = readActiveTabs();
  const active = Object.fromEntries(
    Object.entries(tabs).filter(([, timestamp]) => Number(timestamp) >= now - ACTIVE_TAB_TTL_MS),
  ) as Record<string, number>;
  writeActiveTabs(active);
  return active;
}

function registerActiveTab(): void {
  const active = pruneActiveTabs();
  active[getTabId()] = Date.now();
  writeActiveTabs(active);
}

function cleanupStaleTabHeartbeats(): void {
  // Los timers de pestañas en segundo plano pueden quedar throttled durante
  // decenas de segundos o minutos. Un heartbeat vencido no demuestra que el
  // usuario haya cerrado el navegador y nunca debe invalidar una sesión válida.
  pruneActiveTabs();
}

function clearLegacyAuthStorage(): void {
  removeSharedValue(LEGACY_TOKEN_KEY);
  removeSharedValue(LEGACY_USER_KEY);
  try { tabStorage?.removeItem(LEGACY_TAB_SESSION_STORAGE_KEY); } catch { /* sin acción */ }
}

export function readBrowserSession(): string {
  return readSharedValue(BROWSER_SESSION_STORAGE_KEY);
}

export function hasBrowserSession(): boolean {
  return Boolean(readBrowserSession());
}

export function setAuthSession(browserSession: string, nextCsrfToken?: string): void {
  registerActiveTab();
  if (!browserSession) {
    clearAuthSession();
    return;
  }
  writeSharedValue(BROWSER_SESSION_STORAGE_KEY, String(browserSession));
  csrfToken = typeof nextCsrfToken === 'string' ? nextCsrfToken : '';
  if (csrfToken) writeSharedValue(CSRF_STORAGE_KEY, csrfToken);
  else removeSharedValue(CSRF_STORAGE_KEY);
  clearLegacyAuthStorage();
  authExpiryDispatched = false;
  postAuthMessage({ type: 'session-updated' });
}

export function setCsrfToken(value?: string): void {
  csrfToken = typeof value === 'string' ? value : '';
  if (csrfToken) writeSharedValue(CSRF_STORAGE_KEY, csrfToken);
  else removeSharedValue(CSRF_STORAGE_KEY);
}

export function clearAuthSession({ broadcast = true, notify = true }: { broadcast?: boolean; notify?: boolean } = {}): void {
  removeSharedValue(BROWSER_SESSION_STORAGE_KEY);
  removeSharedValue(CSRF_STORAGE_KEY);
  removeSharedValue(BOS_LOCAL_SESSION_STORAGE_KEY);
  removeSharedValue(ACTIVE_TABS_STORAGE_KEY);
  csrfToken = '';
  clearLegacyAuthStorage();
  if (broadcast) postAuthMessage({ type: 'session-cleared' });
  if (notify) emitAuthExpired();
}

function currentCsrfToken(): string {
  if (!csrfToken) csrfToken = readSharedValue(CSRF_STORAGE_KEY);
  return csrfToken;
}

function markHumanActivity(): void {
  lastHumanActivityAt = Date.now();
}

function hasRecentHumanActivity(): boolean {
  return lastHumanActivityAt > 0 && (Date.now() - lastHumanActivityAt) <= USER_ACTIVITY_WINDOW_MS;
}

if (typeof window !== 'undefined') {
  cleanupStaleTabHeartbeats();
  registerActiveTab();
  window.setInterval(registerActiveTab, ACTIVE_TAB_HEARTBEAT_MS);
  window.addEventListener('visibilitychange', registerActiveTab);
  clearLegacyAuthStorage();
  ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
    window.addEventListener(eventName, markHumanActivity, { capture: true, passive: true });
  });

  window.addEventListener('storage', (event) => {
    if (event.key === BROWSER_SESSION_STORAGE_KEY) {
      if (!event.newValue) {
        csrfToken = '';
        emitAuthExpired();
      } else {
        emitAuthUpdated();
      }
    }
    if (event.key === CSRF_STORAGE_KEY) csrfToken = event.newValue || '';
  });

  authChannel?.addEventListener('message', (event) => {
    if (event.data?.type === 'session-cleared') {
      clearAuthSession({ broadcast: false, notify: true });
    }
    if (event.data?.type === 'session-updated') {
      csrfToken = readSharedValue(CSRF_STORAGE_KEY);
      emitAuthUpdated();
    }
  });
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

// Instancia sin interceptores para confirmar una sesión cuando una petición
// operativa recibe 401. Evita bucles recursivos del interceptor principal.
const authProbeApi = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

let authValidationPromise: Promise<boolean | null> | null = null;

function authProbeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const browserSession = readBrowserSession();
  const localSessionToken = readBosLocalSessionToken();
  if (localSessionToken) headers['X-ARCA-Local-Session'] = localSessionToken;
  if (browserSession) headers['X-ARCA-Browser-Session'] = browserSession;
  if (hasRecentHumanActivity()) headers['X-ARCA-User-Activity'] = '1';
  return headers;
}

function confirmSessionStillValid(): Promise<boolean | null> {
  if (authValidationPromise) return authValidationPromise;
  authValidationPromise = authProbeApi.get('/auth/me', { headers: authProbeHeaders() })
    .then((response) => {
      const nextCsrf = response?.data?.csrf_token;
      if (nextCsrf) setCsrfToken(nextCsrf);
      return true;
    })
    .catch((probeError: AxiosError) => {
      if (probeError.response?.status === 401) {
        clearAuthSession({ broadcast: true, notify: true });
        return false;
      }
      // Error de red/5xx: no convertir una falla transitoria en logout.
      return null;
    })
    .finally(() => {
      authValidationPromise = null;
    });
  return authValidationPromise;
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const browserSession = readBrowserSession();
  const localSessionToken = readBosLocalSessionToken();
  if (localSessionToken) config.headers['X-ARCA-Local-Session'] = localSessionToken;
  if (browserSession) config.headers['X-ARCA-Browser-Session'] = browserSession;

  const method = String(config.method || 'get').toLowerCase();
  const csrf = currentCsrfToken();
  if (csrf && ['post', 'put', 'patch', 'delete'].includes(method)) {
    config.headers['X-CSRF-Token'] = csrf;
  }
  if (hasRecentHumanActivity()) {
    config.headers['X-ARCA-User-Activity'] = '1';
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ detail?: string }>) => {
    const url = String(error.config?.url || '');
    if (error.response?.status === 401 && !url.includes('/auth/login')) {
      if (url.includes('/auth/me')) {
        // /auth/me es la comprobación autoritativa: aquí sí se confirma que la
        // sesión dejó de ser válida.
        clearAuthSession({ broadcast: true, notify: true });
      } else {
        // Una sola API operativa puede fallar de forma transitoria. Confirmar la
        // sesión antes de expulsar al usuario y sincronizar el logout.
        await confirmSessionStillValid();
      }
    }
    if (error.response?.status === 403 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('arca-auth-forbidden', {
        detail: error.response?.data?.detail || 'No cuenta con permisos para esta operación.',
      }));
    }
    return Promise.reject(error);
  },
);

export default api;
