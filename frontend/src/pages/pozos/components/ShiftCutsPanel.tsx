import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import ChartEmptyState from './ChartEmptyState';
import PanelHeader from './PanelHeader';
import StatusBadge from './StatusBadge';
import useShiftCuts from '../hooks/useShiftCuts';
import { asRecord, asRows, formatNumber } from '../insurgentesUtils';
import type { FlexibleRecord } from '../types';
import { formatExplicitDateTimeRange, formatShiftDateTimeRange } from '../dateUtils';

type ShiftCutsPanelProps = {
  module: 'entrada' | 'pozos' | 'lineas' | 'flujos' | 'niveles' | 'uv';
  elementId?: string;
  title?: string;
  variant?: 'module' | 'detail';
  group?: 'tam' | 'embotellado' | 'cisterna';
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

function moduleItems(shift: FlexibleRecord, moduleName: string, group?: string): FlexibleRecord[] {
  const items = asRows(modulePayload(shift, moduleName).items);
  if (moduleName !== 'flujos' || !group) return items;
  return items.filter((item) => String(item.module_group || '') === group);
}

function filteredSummary(summary: FlexibleRecord, items: FlexibleRecord[], moduleName: string, group?: string): FlexibleRecord {
  if (moduleName !== 'flujos' || !group) return summary;
  const volumes = items.map((item) => Number(item.volume_m3)).filter((value) => Number.isFinite(value));
  return {
    ...summary,
    type: 'volume',
    volume_m3: volumes.length ? volumes.reduce((total, value) => total + value, 0) : null,
    active_count: items.filter((item) => String(item.activity) === 'Con actividad').length,
    data_count: items.filter((item) => Boolean(item.has_data)).length,
    total_count: items.length,
  };
}

function statusType(status: unknown): string {
  const code = String(status || '').toLowerCase();
  if (code === 'partial') return 'warning';
  if (code === 'pending') return 'idle';
  return 'normal';
}

function shiftLineNumber(item: FlexibleRecord): number | null {
  const configured = Number(item.operational_number ?? item.numero);
  if (Number.isFinite(configured) && configured > 0) return Math.trunc(configured);
  const match = String(item.name || item.nombre || '').match(/(?:línea|linea)\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function shiftVolumeSum(items: FlexibleRecord[], from: number, to: number): number | null {
  let total = 0;
  let count = 0;
  items.forEach((item) => {
    const number = shiftLineNumber(item);
    const value = Number(item.volume_m3);
    if (number !== null && number >= from && number <= to && Number.isFinite(value)) {
      total += value;
      count += 1;
    }
  });
  return count ? total : null;
}

function mainValue(summary: FlexibleRecord, shift: FlexibleRecord, moduleName: string, items: FlexibleRecord[] = []): ReactNode {
  if (shift.status === 'pending') return moduleName === 'uv' ? null : 'Pendiente';
  if (moduleName === 'flujos') {
    const rows = items
      .map((item) => {
        const value = item.volume_m3;
        if (value === null || value === undefined) return null;
        return { name: String(item.name || 'Flujo'), value: `${formatNumber(value)} m³` };
      })
      .filter((value): value is { name: string; value: string } => Boolean(value));
    return rows.length ? (
      <span className="shift-summary-breakdown">
        {rows.map((row) => <span key={row.name}><b>{row.name}</b><em>{row.value}</em></span>)}
      </span>
    ) : 'Sin volumen validado';
  }
  if (moduleName === 'lineas') {
    const firstGroup = shiftVolumeSum(items, 1, 3);
    const secondGroup = shiftVolumeSum(items, 4, 7);
    return (
      <span className="shift-summary-breakdown shift-summary-breakdown--lines">
        <span><b>Líneas 1–3</b><em>{firstGroup === null ? '—' : `${formatNumber(firstGroup)} m³`}</em></span>
        <span><b>Líneas 4–7</b><em>{secondGroup === null ? '—' : `${formatNumber(secondGroup)} m³`}</em></span>
      </span>
    );
  }
  if (summary.type === 'volume' || moduleName === 'entrada' || moduleName === 'pozos') {
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

function rangeValue(minValue: unknown, maxValue: unknown, suffix = ''): string {
  if ((minValue === null || minValue === undefined || minValue === '') && (maxValue === null || maxValue === undefined || maxValue === '')) return '—';
  return `${fieldValue(minValue, suffix)} / ${fieldValue(maxValue, suffix)}`;
}

function renderUvSystemSummary(systemSummary: FlexibleRecord) {
  if (!systemSummary || !Object.keys(systemSummary).length || !systemSummary.has_data) return null;
  return (
    <div className="shift-system-summary">
      <strong>Sistema UV · mínimos y máximos del intervalo</strong>
      <div className="shift-system-metrics">
        <div className="shift-system-metric"><span>UVT mín. / máx.</span><b>{rangeValue(systemSummary.min_uvt, systemSummary.max_uvt, ' %')}</b></div>
        <div className="shift-system-metric"><span>Potencia mín. / máx.</span><b>{rangeValue(systemSummary.min_power, systemSummary.max_power, ' %')}</b></div>
        <div className="shift-system-metric"><span>Flujo mín. / máx.</span><b>{rangeValue(systemSummary.min_flow, systemSummary.max_flow, ' L/s')}</b></div>
        <div className="shift-system-metric"><span>Dosis mín. / máx.</span><b>{rangeValue(systemSummary.min_dose, systemSummary.max_dose, ' mJ/cm²')}</b></div>
        <div className="shift-system-metric"><span>Cobertura</span><b>{fieldValue(systemSummary.coverage_pct, ' %')}</b></div>
      </div>
    </div>
  );
}

function renderShiftTable(items: FlexibleRecord[], moduleName: string) {
  const isVolume = moduleName === 'entrada' || moduleName === 'pozos' || moduleName === 'lineas' || moduleName === 'flujos';
  return (
    <div className="shift-table-wrap">
      <table className="shift-table">
        <thead>
          <tr>
            <th>Elemento</th>
            {isVolume ? <><th>Totalizador apertura</th><th>Totalizador cierre</th><th>{moduleName === 'lineas' ? 'Volumen consumido' : 'Volumen'}</th><th>Flujo prom.</th><th>Mín. / Máx.</th></> : moduleName === 'niveles' ? <><th>Inicial</th><th>Final</th><th>Promedio</th><th>Mín. / Máx.</th></> : <><th>Estado inicial</th><th>Estado final</th><th>Estado mín. / máx.</th><th>Age mín./máx. · Status mín./máx.</th></>}
            <th>Cobertura</th>
            <th>Actividad</th>
            <th>Comunicación</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={String(item.id || item.name)}>
              <td>{String(item.name || 'Elemento')}</td>
              {isVolume ? <><td>{fieldValue(item.opening_m3, ' m³')}</td><td>{fieldValue(item.closing_m3, ' m³')}</td><td>{fieldValue(item.volume_m3, ' m³')}</td><td>{fieldValue(item.avg_flow, ' L/s')}</td><td>{fieldValue(item.min_flow, ' L/s')} / {fieldValue(item.max_flow, ' L/s')}</td></> : moduleName === 'niveles' ? <><td>{fieldValue(item.initial_level_m, ' m')}</td><td>{fieldValue(item.final_level_m, ' m')}</td><td>{fieldValue(item.avg_level_m, ' m')}</td><td>{fieldValue(item.min_level_m, ' m')} / {fieldValue(item.max_level_m, ' m')}</td></> : <><td>{fieldValue(item.initial_state)}</td><td>{fieldValue(item.final_state)}</td><td>{rangeValue(item.min_state, item.max_state)}</td><td>{rangeValue(item.min_agel, item.max_agel)} · {rangeValue(item.min_status_reading, item.max_status_reading, ' %')}</td></>}
              <td>{fieldValue(item.coverage_pct, ' %')}</td>
              <td>{String(item.activity || 'Sin datos')}</td>
              <td>{String(item.communication || 'Sin información')}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
                <div><span>Totalizador apertura</span><b>{fieldValue(item.opening_m3, ' m³')}</b></div>
                <div><span>Totalizador cierre</span><b>{fieldValue(item.closing_m3, ' m³')}</b></div>
                <div><span>{moduleName === 'lineas' ? 'Volumen consumido' : 'Volumen'}</span><b>{fieldValue(item.volume_m3, ' m³')}</b></div>
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
                <div><span>Estado mín. / máx.</span><b>{rangeValue(item.min_state, item.max_state)}</b></div>
                <div><span>Age mín. / máx.</span><b>{rangeValue(item.min_agel, item.max_agel)}</b></div>
                <div><span>Status mín. / máx.</span><b>{rangeValue(item.min_status_reading, item.max_status_reading, ' %')}</b></div>
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

  if (moduleName === 'lineas') {
    const firstGroup = items.filter((item) => { const number = shiftLineNumber(item); return number !== null && number >= 1 && number <= 3; });
    const secondGroup = items.filter((item) => { const number = shiftLineNumber(item); return number !== null && number >= 4 && number <= 7; });
    return (
      <div className="shift-line-groups">
        <section>
          <header><span>Proceso de alimentación 01</span><strong>Líneas 1, 2 y 3</strong></header>
          {renderShiftTable(firstGroup, moduleName)}
        </section>
        <section>
          <header><span>Proceso de alimentación 02</span><strong>Líneas 4, 5, 6 y 7</strong></header>
          {renderShiftTable(secondGroup, moduleName)}
        </section>
      </div>
    );
  }

  return (
    <>
      {uvSystem}
      {renderShiftTable(items, moduleName)}
    </>
  );
}

function ShiftCutsPanel({ module, elementId, title, variant = 'module', group }: ShiftCutsPanelProps) {
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
  const dayInterval = formatExplicitDateTimeRange(
    { startDate: controller.date, endDate: controller.date },
    { aggregation: 'minute', useLastUpdateWhenCurrent: false },
  );
  const selectedShift = allShifts.find((shift) => String(shift.id) === turnFilter);
  const selectionInterval = turnFilter === 'all'
    ? dayInterval
    : formatShiftDateTimeRange(controller.date, selectedShift?.schedule);
  const showSelectionSummary = !((module === 'pozos' || module === 'uv') && variant === 'module');

  const toggle = (id: string) => {
    setExpanded((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  return (
    <section className={`panel shift-cuts-panel shift-cuts-panel--${module} fade-up`}>
      <PanelHeader title={heading} subtitle={`Día consultado: ${dayInterval}.`} />
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
        {showSelectionSummary ? <span className="shift-chip">{turnFilter === 'all' ? 'Todos los turnos' : String(selectedShift?.label || turnFilter)} · {selectionInterval}</span> : null}
      </div>
      {controller.error && !payload.shifts ? <ChartEmptyState message={controller.error} /> : null}
      {controller.loading && !allShifts.length ? <ChartEmptyState message="Cargando cortes por turno..." /> : null}
      {controller.refreshing && allShifts.length ? <p className="shift-refresh-note">Actualizando cortes por turno...</p> : null}
      {visibleShifts.length ? (
        <>
          <div className="shift-summary-grid">
            {visibleShifts.map((shift) => {
              const items = moduleItems(shift, module, group);
              const summary = filteredSummary(moduleSummary(shift, module), items, module, group);
              const primaryValue = mainValue(summary, shift, module, items);
              return (
                <article className={`shift-summary-card status-${String(shift.status)}`} key={String(shift.id)}>
                  <div>
                    <span>{String(shift.label).toUpperCase()}</span>
                    <small>{formatShiftDateTimeRange(controller.date, shift.schedule)}</small>
                  </div>
                  {primaryValue !== null ? <div className="shift-summary-main">{primaryValue}</div> : null}
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
                    <span><strong>{String(shift.label)}</strong><small>{formatShiftDateTimeRange(controller.date, shift.schedule)}</small></span>
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
