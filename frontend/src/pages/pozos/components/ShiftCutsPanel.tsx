import { useEffect, useMemo, useState } from 'react';
import ChartEmptyState from './ChartEmptyState';
import PanelHeader from './PanelHeader';
import StatusBadge from './StatusBadge';
import useShiftCuts from '../hooks/useShiftCuts';
import { asRecord, asRows, formatNumber } from '../insurgentesUtils';
import type { FlexibleRecord } from '../types';

type ShiftCutsPanelProps = {
  module: 'entrada' | 'pozos' | 'lineas' | 'flujos' | 'niveles' | 'uv';
  elementId?: string;
  title?: string;
  variant?: 'module' | 'detail';
};

const MODULE_LABELS: Record<string, string> = {
  entrada: 'Pozos Corporativos',
  pozos: 'Pozos',
  lineas: 'Líneas',
  flujos: 'Flujos',
  niveles: 'Niveles',
  uv: 'Lámparas UV',
};

function modulePayload(shift: FlexibleRecord, moduleName: string): FlexibleRecord {
  const modules = asRows(shift.modules);
  return asRecord(modules.find((item) => String(item.module) === moduleName));
}

function moduleSummary(shift: FlexibleRecord, moduleName: string): FlexibleRecord {
  return asRecord(modulePayload(shift, moduleName).summary);
}

function moduleItems(shift: FlexibleRecord, moduleName: string): FlexibleRecord[] {
  return asRows(modulePayload(shift, moduleName).items);
}

function statusType(status: unknown): string {
  const code = String(status || '').toLowerCase();
  if (code === 'partial') return 'warning';
  if (code === 'pending') return 'idle';
  return 'normal';
}

function mainValue(summary: FlexibleRecord, shift: FlexibleRecord, moduleName: string): string {
  if (shift.status === 'pending') return 'Pendiente';
  if (summary.type === 'volume' || moduleName === 'entrada' || moduleName === 'pozos' || moduleName === 'lineas' || moduleName === 'flujos') {
    return summary.volume_m3 === null || summary.volume_m3 === undefined ? 'Sin datos' : `${formatNumber(summary.volume_m3)} m³`;
  }
  const dataCount = Number(summary.data_count || 0);
  const totalCount = Number(summary.total_count || 0);
  return totalCount ? `${dataCount}/${totalCount} con lectura` : 'Sin datos';
}

function activityLine(summary: FlexibleRecord, shift: FlexibleRecord): string {
  if (shift.status === 'pending') return 'Sin registros todavía';
  const active = Number(summary.active_count || 0);
  const total = Number(summary.total_count || 0);
  const data = Number(summary.data_count || 0);
  if (!total) return 'Sin elementos configurados';
  return `Con actividad ${active} · Con datos ${data}`;
}

function fieldValue(value: unknown, suffix = ''): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') return `${formatNumber(value)}${suffix}`;
  return String(value);
}

function renderUvSystemSummary(systemSummary: FlexibleRecord) {
  if (!systemSummary || !Object.keys(systemSummary).length || !systemSummary.has_data) return null;
  return (
    <div className="shift-system-summary">
      <strong>Sistema UV · parámetros compartidos</strong>
      <div className="shift-system-metrics">
        <div className="shift-system-metric"><span>UVT promedio</span><b>{fieldValue(systemSummary.avg_uvt, ' %')}</b></div>
        <div className="shift-system-metric"><span>Potencia promedio</span><b>{fieldValue(systemSummary.avg_power, ' %')}</b></div>
        <div className="shift-system-metric"><span>Flujo promedio</span><b>{fieldValue(systemSummary.avg_flow, ' m³/h')}</b></div>
        <div className="shift-system-metric"><span>Dosis promedio</span><b>{fieldValue(systemSummary.avg_dose, ' mJ/cm²')}</b></div>
        <div className="shift-system-metric"><span>Cobertura</span><b>{fieldValue(systemSummary.coverage_pct, ' %')}</b></div>
      </div>
    </div>
  );
}

function renderDetailRows(items: FlexibleRecord[], moduleName: string, detail: boolean, payload?: FlexibleRecord) {
  if (!items.length) return <ChartEmptyState message="Sin elementos para este turno." />;
  const uvSystem = moduleName === 'uv' ? renderUvSystemSummary(asRecord(payload?.system_summary)) : null;
  if (detail) {
    return (
      <>
        {uvSystem}
        <div className="shift-detail-cards">
        {items.map((item) => (
          <div className="shift-detail-card" key={String(item.id || item.name)}>
            <strong>{String(item.name || 'Elemento')}</strong>
            {item.type === 'volume' ? (
              <>
                <div><span>Apertura</span><b>{fieldValue(item.opening_m3, ' m³')}</b></div>
                <div><span>Cierre</span><b>{fieldValue(item.closing_m3, ' m³')}</b></div>
                <div><span>Volumen</span><b>{fieldValue(item.volume_m3, ' m³')}</b></div>
                <div><span>Flujo promedio</span><b>{fieldValue(item.avg_flow, ' L/s')}</b></div>
                <div><span>Mínimo / Máximo</span><b>{fieldValue(item.min_flow, ' L/s')} / {fieldValue(item.max_flow, ' L/s')}</b></div>
              </>
            ) : item.type === 'level' ? (
              <>
                <div><span>Inicial</span><b>{fieldValue(item.initial_level_m, ' m')}</b></div>
                <div><span>Final</span><b>{fieldValue(item.final_level_m, ' m')}</b></div>
                <div><span>Promedio</span><b>{fieldValue(item.avg_level_m, ' m')}</b></div>
                <div><span>Mínimo / Máximo</span><b>{fieldValue(item.min_level_m, ' m')} / {fieldValue(item.max_level_m, ' m')}</b></div>
              </>
            ) : (
              <>
                <div><span>Estado inicial</span><b>{fieldValue(item.initial_state)}</b></div>
                <div><span>Estado final</span><b>{fieldValue(item.final_state)}</b></div>
                <div><span>Estado prom.</span><b>{fieldValue(item.avg_state)}</b></div>
                <div><span>Age prom.</span><b>{fieldValue(item.avg_agel)}</b></div>
                <div><span>Status prom.</span><b>{fieldValue(item.avg_status_reading, ' %')}</b></div>
              </>
            )}
            <div><span>Cobertura</span><b>{fieldValue(item.coverage_pct, ' %')}</b></div>
            <div><span>Actividad</span><b>{String(item.activity || 'Sin datos')}</b></div>
            <div><span>Comunicación</span><b>{String(item.communication || 'Sin información')}</b></div>
          </div>
        ))}
      </div>
      </>
    );
  }

  const isVolume = moduleName === 'entrada' || moduleName === 'pozos' || moduleName === 'lineas' || moduleName === 'flujos';
  return (
    <>
    {uvSystem}
    <div className="shift-table-wrap">
      <table className="shift-table">
        <thead>
          <tr>
            <th>Elemento</th>
            {isVolume ? <><th>Apertura</th><th>Cierre</th><th>Volumen</th><th>Flujo prom.</th><th>Mín. / Máx.</th></> : moduleName === 'niveles' ? <><th>Inicial</th><th>Final</th><th>Promedio</th><th>Mín. / Máx.</th></> : <><th>Estado inicial</th><th>Estado final</th><th>Estado prom.</th><th>Age / Status</th></>}
            <th>Cobertura</th>
            <th>Actividad</th>
            <th>Comunicación</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={String(item.id || item.name)}>
              <td>{String(item.name || 'Elemento')}</td>
              {isVolume ? <><td>{fieldValue(item.opening_m3, ' m³')}</td><td>{fieldValue(item.closing_m3, ' m³')}</td><td>{fieldValue(item.volume_m3, ' m³')}</td><td>{fieldValue(item.avg_flow, ' L/s')}</td><td>{fieldValue(item.min_flow, ' L/s')} / {fieldValue(item.max_flow, ' L/s')}</td></> : moduleName === 'niveles' ? <><td>{fieldValue(item.initial_level_m, ' m')}</td><td>{fieldValue(item.final_level_m, ' m')}</td><td>{fieldValue(item.avg_level_m, ' m')}</td><td>{fieldValue(item.min_level_m, ' m')} / {fieldValue(item.max_level_m, ' m')}</td></> : <><td>{fieldValue(item.initial_state)}</td><td>{fieldValue(item.final_state)}</td><td>{fieldValue(item.avg_state)}</td><td>{fieldValue(item.avg_agel)} / {fieldValue(item.avg_status_reading, ' %')}</td></>}
              <td>{fieldValue(item.coverage_pct, ' %')}</td>
              <td>{String(item.activity || 'Sin datos')}</td>
              <td>{String(item.communication || 'Sin información')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

function ShiftCutsPanel({ module, elementId, title, variant = 'module' }: ShiftCutsPanelProps) {
  const controller = useShiftCuts({ module, elementId });
  const payload = asRecord(controller.data);
  const allShifts = asRows(payload.shifts);
  const [turnFilter, setTurnFilter] = useState('all');
  const currentShiftId = String(allShifts.find((shift) => shift.is_current)?.id || allShifts[0]?.id || '');
  const [expanded, setExpanded] = useState<string[]>([]);

  useEffect(() => {
    if (!allShifts.length) return;
    if (!expanded.length) setExpanded([currentShiftId || String(allShifts[0].id)]);
  }, [allShifts.length, currentShiftId]);

  const visibleShifts = useMemo(() => allShifts.filter((shift) => turnFilter === 'all' || String(shift.id) === turnFilter), [allShifts, turnFilter]);
  const heading = title || `Cortes por turno${variant === 'detail' ? '' : ` · ${MODULE_LABELS[module] || module}`}`;
  const isDetail = variant === 'detail';

  const toggle = (id: string) => {
    setExpanded((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  return (
    <section className="panel shift-cuts-panel fade-up">
      <PanelHeader title={heading} subtitle="Turnos provisionales sin traslape; apertura y cierre se calculan con lecturas normalizadas." />
      <div className="shift-toolbar">
        <label>
          <span>Día</span>
          <input type="date" value={controller.date} onChange={(event) => controller.setDate(event.target.value)} />
        </label>
        <label>
          <span>Turno operativo</span>
          <select value={turnFilter} onChange={(event) => setTurnFilter(event.target.value)}>
            <option value="all">Todos los turnos</option>
            {allShifts.map((shift) => <option key={String(shift.id)} value={String(shift.id)}>{String(shift.label)}</option>)}
          </select>
        </label>
        <button type="button" className="btn primary" onClick={controller.refresh}>Actualizar</button>
        <button type="button" className="btn secondary" onClick={controller.reset}>Restablecer</button>
        <span className="shift-chip">{turnFilter === 'all' ? 'Todos los turnos' : String(allShifts.find((shift) => String(shift.id) === turnFilter)?.label || turnFilter)} · {controller.date}</span>
      </div>
      {controller.error && !payload.shifts ? <ChartEmptyState message={controller.error} /> : null}
      {controller.loading && !allShifts.length ? <ChartEmptyState message="Cargando cortes por turno..." /> : null}
      {controller.refreshing && allShifts.length ? <p className="shift-refresh-note">Actualizando cortes por turno...</p> : null}
      {visibleShifts.length ? (
        <>
          <div className="shift-summary-grid">
            {visibleShifts.map((shift) => {
              const summary = moduleSummary(shift, module);
              return (
                <article className={`shift-summary-card status-${String(shift.status)}`} key={String(shift.id)}>
                  <div>
                    <span>{String(shift.label).toUpperCase()}</span>
                    <small>{String(shift.schedule)}</small>
                  </div>
                  <strong>{mainValue(summary, shift, module)}</strong>
                  <p>{activityLine(summary, shift)}</p>
                  <StatusBadge type={statusType(shift.status)}>{String(shift.status_label || 'Sin estado')}</StatusBadge>
                </article>
              );
            })}
          </div>
          <div className="shift-accordion">
            {visibleShifts.map((shift) => {
              const id = String(shift.id);
              const payloadForModule = modulePayload(shift, module);
              const items = asRows(payloadForModule.items);
              const isOpen = expanded.includes(id) || turnFilter !== 'all';
              return (
                <article className="shift-accordion-item" key={id}>
                  <button type="button" onClick={() => toggle(id)} aria-expanded={isOpen}>
                    <span><strong>{String(shift.label)}</strong><small>{String(shift.schedule)}</small></span>
                    <StatusBadge type={statusType(shift.status)}>{String(shift.status_label || 'Sin estado')}</StatusBadge>
                  </button>
                  {isOpen ? <div className="shift-accordion-body">{renderDetailRows(items, module, isDetail, payloadForModule)}</div> : null}
                </article>
              );
            })}
          </div>
        </>
      ) : !controller.loading ? <ChartEmptyState message="Sin cortes disponibles para la selección actual." /> : null}
    </section>
  );
}

export default ShiftCutsPanel;
