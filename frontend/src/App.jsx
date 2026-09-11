import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { LogOut, UserRound } from 'lucide-react';
import Header from './components/Header';
import loginLogo from './assets/arca-continental-logo.png';
import { DASHBOARD_NAME, PLANT_NAME } from './config/plant';
import { WATER_MENU_ITEMS } from './config/plantCapabilities';
import Sidebar from './components/Sidebar';
import LoginPage from './pages/LoginPage';
import PozosDashboardPage from './pages/PozosDashboardPage';
import { getCurrentSession, hasBrowserSession, logout } from './services/authService';
import { fetchWaterDashboard } from './services/waterService';
import { NotificationProvider } from './pages/pozos/components/NotificationCenter';
import { WaterOperationalAlertsProvider } from './pages/pozos/components/WaterOperationalAlertsProvider';

const DEFAULT_POZOS_SECTION = 'dashboard';
const THEME_STORAGE_KEY = 'arca-las-fuentes-theme';

function readStoredTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}


const POZOS_MENU_ITEMS = WATER_MENU_ITEMS.filter((item) => item.enabled);

const ROLE_LABELS = {
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Consulta',
};

function SessionControl({ user, onLogout, pending = false, compact = false, sidebar = false }) {
  const displayName = user?.display_name || user?.name || user?.username || 'Usuario';
  const username = user?.username || '';
  const roleLabel = ROLE_LABELS[user?.role] || 'Usuario';

  return (
    <div
      className={`session-control ${compact ? 'compact' : ''} ${sidebar ? 'sidebar-session-control' : ''}`.trim()}
      aria-label={`Sesión activa: ${displayName}`}
    >
      <div className="session-main">
        <div className="session-avatar" aria-hidden="true">
          <UserRound size={compact ? 16 : 18} />
        </div>
        <div className="session-identity">
          <span className="session-label">
            <span className="session-status-dot" aria-hidden="true" />
            Sesión activa
          </span>
          <strong title={displayName}>{displayName}</strong>
          <small title={username ? `${username} · ${roleLabel}` : roleLabel}>
            {username ? `${username} · ${roleLabel}` : roleLabel}
          </small>
        </div>
      </div>
      <button
        type="button"
        className="session-logout-button"
        onClick={onLogout}
        disabled={pending}
        aria-label={pending ? 'Cerrando sesión' : 'Cerrar sesión'}
        title={pending ? 'Cerrando sesión…' : 'Cerrar sesión'}
      >
        <LogOut size={16} />
        <span>{pending ? 'Saliendo…' : 'Cerrar sesión'}</span>
      </button>
    </div>
  );
}

function nowText() {
  return new Date().toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function preloadDefaultRange() {
  const today = new Date().toISOString().slice(0, 10);
  return { startDate: today, endDate: today, period: 'hourly' };
}

function rememberInitialPreload(fastData, temporalData, temporalRange) {
  window.__ARCA_WATER_PRELOAD__ = {
    fastData,
    temporalData,
    temporalRange,
    createdAt: Date.now(),
  };
}

function preloadWithTimeout(timeoutMs = 15000) {
  const temporalRange = preloadDefaultRange();
  const fastRequest = fetchWaterDashboard('dashboard', {
    include_history: false,
    include_energy_water: false,
    include_period_deltas: true,
    requestScope: 'initial-dashboard-fast',
    requestTimeoutMs: 12000,
  }).then((fastData) => {
    if (String(fastData?.source_status || '').toLowerCase() === 'sql_error') {
      throw new Error('No se pudo preparar la información de planta.');
    }
    rememberInitialPreload(fastData, null, temporalRange);
    return { fastData, temporalData: null };
  });
  const timeout = new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error('Tiempo de espera agotado al preparar los datos actuales de planta.')), timeoutMs);
  });
  return Promise.race([fastRequest, timeout]);
}

function InitialPlantLoader({ status, error, onRetry, onSkip }) {
  const hasError = status === 'error';
  return (
    <div className="initial-loader-screen" role="status" aria-live="polite">
      <div className="initial-loader-card">
        <div className="initial-loader-mark login-brand-frame" aria-label="ARCA Continental">
          <div className="login-brand-glow" />
          <div className="login-brand-inner initial-loader-brand-inner">
            <img src={loginLogo} alt="ARCA CONTINENTAL" className="brand-logo login-logo initial-loader-logo" />
          </div>
        </div>
        <div className="initial-loader-copy">
          <span>{PLANT_NAME}</span>
          <h1>Cargando Dashboard ARCA</h1>
          <p>{hasError ? 'No se pudo preparar la información de planta.' : 'Preparando datos de planta...'}</p>
        </div>
        {hasError ? (
          <>
            <div className="initial-loader-error">{error || 'La fuente operativa no respondió dentro del tiempo esperado.'}</div>
            <div className="initial-loader-actions">
              <button type="button" onClick={onRetry}>Reintentar</button>
              <button type="button" className="secondary" onClick={onSkip}>Abrir dashboard sin precarga</button>
            </div>
          </>
        ) : (
          <div className="initial-loader-progress" aria-hidden="true"><span /></div>
        )}
      </div>
    </div>
  );
}

function Shell({ user, onLogout, sidebarProps, children, headerMeta, shellClass = '', theme = 'dark', onThemeToggle }) {
  const [clock, setClock] = useState(nowText());
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setClock(nowText()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!mobileDrawerOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setMobileDrawerOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileDrawerOpen]);

  const handleSessionLogout = async () => {
    if (logoutPending || !onLogout) return;
    setLogoutPending(true);
    try {
      await onLogout();
    } finally {
      setLogoutPending(false);
      setMobileDrawerOpen(false);
    }
  };

  const effectiveSidebarProps = {
    ...sidebarProps,
    collapsed: sidebarProps?.collapsed && !mobileDrawerOpen,
    mobileOpen: mobileDrawerOpen,
    onMobileClose: () => setMobileDrawerOpen(false),
    onNavigate: () => setMobileDrawerOpen(false),
    footerContent: (
      <SessionControl
        user={user}
        onLogout={handleSessionLogout}
        pending={logoutPending}
        sidebar
      />
    ),
  };

  return (
    <div className={`app-shell ${shellClass} ${theme === 'light' ? 'theme-light' : 'theme-dark'} ${mobileDrawerOpen ? 'mobile-drawer-open' : ''}`.trim()} data-theme={theme}>
      {mobileDrawerOpen ? (
        <button
          type="button"
          className="sidebar-mobile-overlay"
          aria-label="Cerrar menú"
          onClick={() => setMobileDrawerOpen(false)}
        />
      ) : null}
      <Sidebar {...effectiveSidebarProps} theme={theme} onThemeToggle={onThemeToggle} />
      <div className="main-shell">
        <div className="mobile-topbar" aria-label="Navegación móvil">
          <button
            type="button"
            className="mobile-menu-button"
            aria-label="Abrir menú"
            aria-expanded={mobileDrawerOpen}
            onClick={() => setMobileDrawerOpen(true)}
          >
            ☰
          </button>
          <span className="mobile-plant-name">{PLANT_NAME}</span>
        </div>
        <Header
          title={headerMeta.title}
          subtitle={headerMeta.subtitle}
          now={clock}
          onExport={headerMeta.onExport}
          onEmail={headerMeta.onEmail}
        />
        <div className="plant-context-bar" aria-label="Planta activa">
          <span className="plant-context-name">{PLANT_NAME}</span>
        </div>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}

function PozosShell({ user, onLogout }) {
  const { section = DEFAULT_POZOS_SECTION, itemId } = useParams();
  const [collapsed, setCollapsed] = useState(true);
  const [theme, setTheme] = useState(readStoredTheme);
  const [preloadState, setPreloadState] = useState({ status: 'loading', error: '' });
  const [headerMeta, setHeaderMeta] = useState({
    title: 'Resumen',
    subtitle: '',
    onExport: () => {},
    onEmail: () => {},
  });

  useEffect(() => {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* almacenamiento opcional */ }
    // El selector CSS conserva este nombre interno por compatibilidad con la base visual.
    document.documentElement.dataset.arcaInsurgentesTheme = theme;
  }, [theme]);

  useEffect(() => {
    const syncTheme = (event) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      setTheme(event.newValue === 'light' ? 'light' : 'dark');
    };
    window.addEventListener('storage', syncTheme);
    return () => window.removeEventListener('storage', syncTheme);
  }, []);

  const toggleTheme = () => setTheme((current) => (current === 'light' ? 'dark' : 'light'));

  const menu = useMemo(() => [{
    group: 'Operación de agua',
    items: user?.role === 'admin'
      ? [...POZOS_MENU_ITEMS, { key: 'usuarios', label: 'Usuarios', iconKey: 'usuarios' }]
      : POZOS_MENU_ITEMS,
  }], [user?.role]);

  const runPreload = () => {
    setPreloadState({ status: 'loading', error: '' });
    preloadWithTimeout()
      .then(() => {
        setPreloadState({ status: 'ready', error: '' });
      })
      .catch((error) => {
        setPreloadState({ status: 'error', error: error?.message || 'No se pudo preparar la información de planta.' });
      });
  };

  useEffect(() => {
    runPreload();
  }, []);

  if (preloadState.status !== 'ready') {
    return (
      <InitialPlantLoader
        status={preloadState.status}
        error={preloadState.error}
        onRetry={runPreload}
        onSkip={() => setPreloadState({ status: 'ready', error: '' })}
      />
    );
  }

  return (
    <NotificationProvider>
      <WaterOperationalAlertsProvider>
        <Shell
          user={user}
          onLogout={onLogout}
          headerMeta={headerMeta}
          shellClass="pozos-shell"
          theme={theme}
          onThemeToggle={toggleTheme}
          sidebarProps={{
            collapsed,
            onToggle: () => setCollapsed((value) => !value),
            sections: menu,
            basePath: '/pozos',
            brandTitle: PLANT_NAME,
            brandSubtitle: 'Dashboard ARCA',
          }}
        >
          <PozosDashboardPage section={section} itemId={itemId} setHeaderMeta={setHeaderMeta} user={user} />
        </Shell>
      </WaterOperationalAlertsProvider>
    </NotificationProvider>
  );
}

function ProtectedRoute({ user, children }) {
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function LegacyPozosRedirect() {
  const { legacySection } = useParams();
  return <Navigate to={`/pozos/${legacySection || DEFAULT_POZOS_SECTION}`} replace />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(() => !hasBrowserSession());

  useEffect(() => {
    document.title = user ? DASHBOARD_NAME : 'Login ARCA · Las Fuentes';
  }, [user]);

  useEffect(() => {
    let active = true;
    const expired = () => {
      if (!active) return;
      setUser(null);
      setSessionChecked(true);
    };
    const restoreSession = () => {
      if (!hasBrowserSession()) {
        if (active) {
          setUser(null);
          setSessionChecked(true);
        }
        return;
      }
      if (active) setSessionChecked(false);
      getCurrentSession()
        .then((session) => { if (active) setUser(session.user); })
        .catch(() => { if (active) setUser(null); })
        .finally(() => { if (active) setSessionChecked(true); });
    };
    const updated = () => restoreSession();

    window.addEventListener('arca-auth-expired', expired);
    window.addEventListener('arca-auth-updated', updated);
    restoreSession();
    return () => {
      active = false;
      window.removeEventListener('arca-auth-expired', expired);
      window.removeEventListener('arca-auth-updated', updated);
    };
  }, []);

  const handleLogout = async () => {
    try { await logout(); }
    finally { setUser(null); setSessionChecked(true); }
  };

  const defaultRoute = user ? `/pozos/${DEFAULT_POZOS_SECTION}` : '/login';

  if (!sessionChecked) {
    return <InitialPlantLoader status="loading" error="" onRetry={() => {}} onSkip={() => {}} />;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to={`/pozos/${DEFAULT_POZOS_SECTION}`} replace /> : <LoginPage onSuccess={setUser} />}
      />

      <Route path="/" element={<Navigate to={defaultRoute} replace />} />
      <Route path="/domains" element={<Navigate to={defaultRoute} replace />} />

      <Route path="/electric" element={<Navigate to={`/pozos/${DEFAULT_POZOS_SECTION}`} replace />} />
      <Route path="/electric/:section" element={<Navigate to={`/pozos/${DEFAULT_POZOS_SECTION}`} replace />} />

      <Route path="/pozos" element={<Navigate to={`/pozos/${DEFAULT_POZOS_SECTION}`} replace />} />
      <Route
        path="/pozos/:section"
        element={
          <ProtectedRoute user={user}>
            <PozosShell user={user} onLogout={handleLogout} />
          </ProtectedRoute>
        }
      />
      <Route
        path="/pozos/:section/:itemId"
        element={
          <ProtectedRoute user={user}>
            <PozosShell user={user} onLogout={handleLogout} />
          </ProtectedRoute>
        }
      />

      <Route path="/:legacySection" element={<ProtectedRoute user={user}><LegacyPozosRedirect /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to={defaultRoute} replace />} />
    </Routes>
  );
}
