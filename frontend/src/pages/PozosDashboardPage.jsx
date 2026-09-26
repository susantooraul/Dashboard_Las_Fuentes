import { useEffect, useMemo } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import DashboardBaseSection from './pozos/sections/DashboardBaseSection';
import PozosSection from './pozos/sections/PozosSection';
import FlujosSection from './pozos/sections/FlujosSection';
import UsersPage from './UsersPage';
import RevisionDiariaSection from './pozos/sections/RevisionDiariaSection';
import ReportesSection from './pozos/sections/ReportesSection';
import '../styles/reportes.css';
import '../styles/insurgentesVisualPolish.css';
import '../styles/insurgentesTheme.css';
import '../styles/pages/resumen.css';

const sectionMap = {
  dashboard: {
    title: 'Resumen',
    render: () => <DashboardBaseSection />,
  },
  pozos: {
    title: 'Pozos',
    render: ({ itemId } = {}) => <PozosSection itemId={itemId} />,
  },
  tam: {
    title: 'Medidores de TAM',
    render: ({ itemId } = {}) => <FlujosSection itemId={itemId} group="tam" title="Medidores de TAM" eyebrow="Área TAM" basePath="/pozos/tam" />,
  },
  cisterna: {
    title: 'Medidor de cisterna',
    render: ({ itemId } = {}) => <FlujosSection itemId={itemId} group="cisterna" title="Medidor de cisterna" eyebrow="Cisterna" basePath="/pozos/cisterna" />,
  },
  embotellado: {
    title: 'Medidores de embotellado',
    render: ({ itemId } = {}) => <FlujosSection itemId={itemId} group="embotellado" title="Medidores de embotellado" eyebrow="Embotellado" basePath="/pozos/embotellado" />,
  },
  revision: {
    title: 'Revisión diaria',
    render: () => <RevisionDiariaSection />,
  },
  reportes: {
    title: 'Reportes',
    render: ({ user } = {}) => <ReportesSection currentUser={user} />,
  },
  usuarios: {
    title: 'Usuarios',
    render: ({ user } = {}) => user?.role === 'admin' ? <UsersPage /> : <Navigate to="/pozos/dashboard" replace />,
  },
};

export default function PozosDashboardPage({ section = 'dashboard', itemId, setHeaderMeta, user }) {
  const current = sectionMap[section] || sectionMap.dashboard;
  const location = useLocation();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);

  useEffect(() => {
    setHeaderMeta({
      title: current.title,
      subtitle: '',
      onExport: null,
      onEmail: null,
    });
  }, [current, setHeaderMeta]);

  const content = useMemo(() => current.render({ itemId, user }), [current, itemId, user]);

  return (
    <div className="page-grid pozos-page insurgentes-page" data-section={section}>
      {content}
    </div>
  );
}
