import {
  Activity,
  ArrowLeftRight,
  BellRing,
  Droplets,
  Factory,
  FileBarChart2,
  FileText,
  FlaskConical,
  Gauge,
  GitBranch,
  Home,
  Lamp,
  Lightbulb,
  LayoutGrid,
  LineChart as LineChartIcon,
  Menu,
  Moon,
  Sun,
  Network,
  ClipboardCheck,
  Settings,
  Snowflake,
  Truck,
  Waves,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import BrandLogo from './BrandLogo';

function WellPumpIcon({ size = 16, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M9 3h6v3H9z" />
      <path d="M10 6h4v4.2" />
      <path d="M9.5 10.2h5a3.5 3.5 0 0 1 3.5 3.5V18H6v-4.3a3.5 3.5 0 0 1 3.5-3.5Z" />
      <path d="M6 14H3.5v2.4H6" />
      <path d="M18 12.2l3-2" />
      <path d="M16.8 8.6 21 11.2" />
      <circle cx="15.8" cy="10.2" r="1.1" />
      <path d="M8 18v3h8v-3" />
    </svg>
  );
}

const iconMap = {
  dashboard: Home,
  subestacion: Factory,
  linea1: LineChartIcon,
  linea2: LineChartIcon,
  linea3: LineChartIcon,
  lineas: LineChartIcon,
  jarabes: Waves,
  tag: Gauge,
  ptar: Gauge,
  refrigeracion: Snowflake,
  auxiliares: Settings,
  alumbrado: Lamp,
  transporte: Truck,
  transformador1: Activity,
  transformador2: Activity,
  transformador3: Activity,
  transformador4: Activity,
  transformador5: Activity,
  alertas: BellRing,
  'multi-plant-dashboard': LayoutGrid,
  'pozos-dashboard': Droplets,
  'pozos-pozos': WellPumpIcon,
  'pozos-consumos': Waves,
  'pozos-tanques': Gauge,
  'pozos-lineas': GitBranch,
  'pozos-flujos': Waves,
  'pozos-balance': ArrowLeftRight,
  'pozos-concesion': ShieldCheck,
  'pozos-revision': ClipboardCheck,
  'pozos-cip': FlaskConical,
  'pozos-uv': Lightbulb,
  'pozos-diagrama': Network,
  'pozos-reportes': FileText,
  usuarios: UsersRound,
};

function getIcon(key, iconKey) {
  return iconMap[iconKey || key] || Activity;
}

export default function Sidebar({
  collapsed,
  onToggle,
  sections = [],
  basePath = '',
  brandTitle = 'PLANTA ZAPOPAN',
  brandSubtitle = '',
  domainSwitchPath,
  domainSwitchLabel = 'Cambiar dominio',
  mobileOpen = false,
  onMobileClose,
  onNavigate,
  footerContent = null,
  theme = 'dark',
  onThemeToggle,
}) {
  const handleMenuClick = () => {
    if (mobileOpen && onMobileClose) {
      onMobileClose();
      return;
    }
    onToggle?.();
  };
  const menuLabel = mobileOpen ? 'Cerrar menú' : collapsed ? 'Expandir menú' : 'Contraer menú';

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`.trim()}>
      <div className="brand-row">
        <button className="menu-button" onClick={handleMenuClick} aria-label={menuLabel} title={menuLabel}><Menu size={18} /></button>
        {!collapsed && (
          <>
            <div className="brand-mark logo-mark"><BrandLogo className="brand-logo sidebar-logo" /></div>
            <div className="brand-copy">
              <div className="brand-title">{brandTitle}</div>
              {brandSubtitle ? <div className="brand-subtitle">{brandSubtitle}</div> : null}
            </div>
          </>
        )}
      </div>

      {onThemeToggle ? (
        <div className="sidebar-theme-control">
          <button
            type="button"
            className="nav-item theme-toggle-button"
            onClick={onThemeToggle}
            aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}
            aria-pressed={theme === 'light'}
            title={collapsed ? (theme === 'dark' ? 'Modo claro' : 'Modo oscuro') : undefined}
          >
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            {!collapsed && <span>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>}
          </button>
        </div>
      ) : null}

      <nav className="sidebar-nav">
        {sections.map((group) => (
          <div className="nav-group" key={group.group}>
            {!collapsed && <div className="nav-group-title">{group.group}</div>}
            {group.items.map((item) => {
              const Icon = getIcon(item.key, item.iconKey);
              return (
                <NavLink key={item.key} to={`${basePath}/${item.key}`} title={collapsed ? item.label : undefined} aria-label={item.label} onClick={onNavigate} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <Icon size={16} />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {(footerContent || domainSwitchPath) ? (
        <div className="sidebar-footer">
          {footerContent ? <div className="sidebar-session-slot">{footerContent}</div> : null}
          {domainSwitchPath ? (
            <NavLink to={domainSwitchPath} className="nav-item switch-domain-link" onClick={onNavigate}>
              <ArrowLeftRight size={16} />
              {!collapsed && <span>{domainSwitchLabel}</span>}
            </NavLink>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
