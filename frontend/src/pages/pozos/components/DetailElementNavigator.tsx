import { Link, useLocation } from 'react-router-dom';
import type { FlexibleRecord } from '../types';

interface DetailElementNavigatorProps {
  items: FlexibleRecord[];
  currentId: string;
  basePath: string;
  moduleLabel: string;
}

function itemLabel(item?: FlexibleRecord): string {
  return String(item?.name || item?.nombre || item?.id || 'Elemento');
}

function itemId(item?: FlexibleRecord): string {
  return String(item?.id || item?.sensor_id || item?.name || '');
}

function DetailElementNavigator({ items, currentId, basePath, moduleLabel }: DetailElementNavigatorProps) {
  const location = useLocation();
  const safeItems = Array.isArray(items) ? items : [];
  const currentIndex = safeItems.findIndex((item) => itemId(item) === String(currentId));
  const current = currentIndex >= 0 ? safeItems[currentIndex] : safeItems[0];
  const previous = currentIndex > 0 ? safeItems[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < safeItems.length - 1 ? safeItems[currentIndex + 1] : null;
  const suffix = location.search || '';

  if (!current || safeItems.length <= 1) return null;

  const to = (item: FlexibleRecord) => `${basePath}/${encodeURIComponent(itemId(item))}${suffix}`;

  return (
    <nav className="detail-element-navigator" aria-label={`Navegación de ${moduleLabel}`}>
      <div className="detail-element-nav-slot previous">
        {previous ? (
          <Link to={to(previous)} className="detail-element-nav-link" aria-label={`Abrir ${itemLabel(previous)}`}>
            <span aria-hidden="true">←</span>
            <strong>{itemLabel(previous)}</strong>
          </Link>
        ) : null}
      </div>
      <div className="detail-element-nav-slot next">
        {next ? (
          <Link to={to(next)} className="detail-element-nav-link" aria-label={`Abrir ${itemLabel(next)}`}>
            <strong>{itemLabel(next)}</strong>
            <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

export default DetailElementNavigator;
