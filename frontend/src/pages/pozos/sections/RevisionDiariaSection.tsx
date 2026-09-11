import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import KpiCard from '../../../components/KpiCard';
import ChartEmptyState from '../components/ChartEmptyState';
import OperationalAlertsPanel from '../components/OperationalAlertsPanel';
import PanelHeader from '../components/PanelHeader';
import StatusBadge from '../components/StatusBadge';
import useDailyWaterReview from '../hooks/useDailyWaterReview';
import { todayInputDate } from '../dateUtils';
import { asRecord, asRows, formatLocalDate, formatNumber, numberOrNull } from '../insurgentesUtils';
import type { FlexibleRecord } from '../types';

type ModuleKey = 'entrada' | 'pozos' | 'lineas' | 'flujos' | 'niveles' | 'uv';
type ElementFilter = 'todos' | ModuleKey | 'atencion';

const MODULE_LABELS: Record<ModuleKey, string> = {
  entrada: 'Pozos Corporativos',
  pozos: 'Pozos',
  lineas: 'Líneas',
  flujos: 'Flujos',
  niveles: 'Niveles',
  uv: 'Lámparas UV',
};

const MODULE_ROUTES: Record<ModuleKey, string> = {
  entrada: '/pozos/entrada',
  pozos: '/pozos/pozos',
  lineas: '/pozos/lineas',
  flujos: '/pozos/flujos',
  niveles: '/pozos/niveles',
  uv: '/pozos/uv',
};

const FILTERS: Array<{ key: ElementFilter; label: string }> = [
  { key: 'todos', label: 'Todos' },
  { key: 'entrada', label: 'Pozos Corporativos' },
  { key: 'pozos', label: 'Pozos' },
  { key: 'lineas', label: 'Líneas' },
  { key: 'flujos', label: 'Flujos' },
  { key: 'niveles', label: 'Niveles' },
  { key: 'uv', label: 'UV' },
  { key: 'atencion', label: 'Con atención' },
];

function sameDayAsToday(value?: string): boolean {
  return (value || todayInputDate()) === todayInputDate();
}

function textValue(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function lowerText(value: unknown): string {
  return textValue(value, '').toLowerCase();
}

function itemName(item: FlexibleRecord, fallback: string): string {
  return textValue(item.name ?? item.nombre ?? item.label, fallback);
}

function itemId(item: FlexibleRecord): string {
  return textValue(item.id ?? item.numero ?? item.sensor_id ?? item.name, '');
}

function isActive(item: FlexibleRecord): boolean {
  const dailyActivity = lowerText(item.daily_activity);
  if (dailyActivity) return dailyActivity.includes('con actividad') || dailyActivity.includes('encendida');
  if (item.active === true) return true;
  const status = lowerText(item.status ?? item.state ?? item.activity ?? item.estado_actual);
  return status.includes('activo') || status.includes('encendido') || status.includes('con actividad') || status === 'normal';
}

function isCommunicationOk(item: FlexibleRecord): boolean {
  const dailyCommunication = lowerText(item.daily_communication);
  if (dailyCommunication) return dailyCommunication.includes('actualizado');
  const type = lowerText(item.communicationType ?? item.statusType ?? item.source_status);
  const label = lowerText(item.estado_comunicacion ?? item.communication ?? item.status ?? item.updated);
  if (type.includes('critical') || type.includes('warning') || type.includes('error') || type.includes('offline')) return false;
  if (label.includes('sin comunicación') || label.includes('sin comunicacion') || label.includes('sin lectura')) return false;
  return type === 'normal' || type === 'communication' || label.includes('actualizado') || label.includes('normal') || label.includes('disponible') || Boolean(item.updated || item.ultima_lectura);
}

function hasPartialValidation(item: FlexibleRecord): boolean {
  const status = lowerText(item.daily_validation ?? item.period_status ?? item.validation ?? item.validacion ?? item.period_note);
  return status.includes('partial') || status.includes('parcial') || status.includes('revision') || status.includes('revisión');
}

function hasNoData(item: FlexibleRecord): boolean {
  const status = lowerText(item.daily_validation ?? item.period_status ?? item.status ?? item.validation);
  return status.includes('sin datos') || status.includes('no disponible') || status.includes('sin lectura');
}

function statusTypeFor(item: FlexibleRecord): string {
  if (!isCommunicationOk(item)) return 'warning';
  if (hasPartialValidation(item)) return 'warning';
  if (hasNoData(item)) return 'idle';
  return 'normal';
}

function valueForElement(module: ModuleKey, item: FlexibleRecord, includeSnapshotFlow = true): string {
  if (module === 'entrada') {
    const flow = numberOrNull(item.flow_lps ?? item.flow ?? item.flujo);
    const volume = numberOrNull(item.period_m3 ?? item.period_delta_m3);
    if (!includeSnapshotFlow) return volume !== null ? `${formatNumber(volume)} m³` : textValue(item.daily_validation, 'Sin volumen validado');
    if (flow !== null) return `${formatNumber(flow)} L/s · ${volume !== null ? `${formatNumber(volume)} m³` : 'sin volumen validado'}`;
    return volume !== null ? `${formatNumber(volume)} m³` : 'Sin lectura actual';
  }
  if (module === 'pozos' || module === 'lineas' || module === 'flujos') {
    const flow = numberOrNull(item.flow_lps ?? item.flow ?? item.flujo ?? item.instant_value);
    const volume = numberOrNull(item.period_m3 ?? item.period_delta_m3 ?? item.volume_m3);
    if (!includeSnapshotFlow) return volume !== null ? `${formatNumber(volume)} m³` : textValue(item.daily_validation, 'Sin datos');
    if (flow !== null && volume !== null) return `${formatNumber(flow)} L/s · ${formatNumber(volume)} m³`;
    if (flow !== null) return `${formatNumber(flow)} L/s`;
    if (volume !== null) return `${formatNumber(volume)} m³`;
    return 'Sin datos';
  }
  if (module === 'niveles') {
    const pct = numberOrNull(item.level_pct ?? item.fill_pct ?? item.pct ?? item.value_pct);
    const level = numberOrNull(item.level_value ?? item.level ?? item.value ?? item.altura_actual_m);
    if (pct !== null) return `${formatNumber(pct, 1)} %`;
    if (level !== null) return `${formatNumber(level, 2)} ${textValue(item.unit, '')}`.trim();
    return 'Sin lectura de nivel';
  }
  const state = textValue(item.state_label ?? item.status ?? item.state, 'Sin lectura');
  const agel = numberOrNull(item.agel ?? item.avg_agel);
  return agel !== null ? `${state} · Age ${formatNumber(agel, 1)}` : state;
}

function routeFor(module: ModuleKey, item?: FlexibleRecord): string {
  if (!item || module === 'entrada') return MODULE_ROUTES[module];
  const id = itemId(item);
  return id ? `${MODULE_ROUTES[module]}/${encodeURIComponent(id)}` : MODULE_ROUTES[module];
}

function moduleRows(dashboard: FlexibleRecord): Record<ModuleKey, FlexibleRecord[]> {
  const entry = asRecord(dashboard.water_entry);
  return {
    entrada: Object.keys(entry).length ? [entry] : [],
    pozos: asRows(dashboard.wells || dashboard.pozos),
    lineas: asRows(dashboard.production_lines),
    flujos: asRows(dashboard.flows ?? dashboard.distribution_flows),
    niveles: asRows(dashboard.tank_inputs),
    uv: asRows(dashboard.uv_lamps),
  };
}

function volumeSum(items: FlexibleRecord[]): number | null {
  const values = items
    .map((item) => numberOrNull(item.period_m3 ?? item.period_delta_m3 ?? item.volume_m3))
    .filter((value): value is number => value !== null);
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0);
}

function activeCount(items: FlexibleRecord[]): number {
  return items.filter(isActive).length;
}

function communicationCount(items: FlexibleRecord[]): number {
  return items.filter(isCommunicationOk).length;
}

function validationCount(items: FlexibleRecord[]): number {
  return items.filter(hasPartialValidation).length;
}

function mainModuleValue(module: ModuleKey, items: FlexibleRecord[], includeSnapshotFlow = true): string {
  if (module === 'entrada') return items[0] ? valueForElement(module, items[0], includeSnapshotFlow) : 'Sin datos';
  if (module === 'pozos' || module === 'lineas' || module === 'flujos') {
    const volume = volumeSum(items);
    return volume !== null ? `${formatNumber(volume)} m³` : `${activeCount(items)}/${items.length} con actividad`;
  }
  if (module === 'niveles') return `${communicationCount(items)}/${items.length} actualizados`;
  return `${activeCount(items)}/${items.length} encendidas`;
}

function validationLabel(item: FlexibleRecord): string {
  if (item.daily_validation) return textValue(item.daily_validation);
  if (hasPartialValidation(item)) return 'Validación parcial';
  if (hasNoData(item)) return 'No disponible';
  return 'Válida';
}

function activityLabel(item: FlexibleRecord): string {
  if (item.daily_activity) return textValue(item.daily_activity);
  return isActive(item) ? 'Con actividad' : 'Sin actividad';
}

function communicationLabel(item: FlexibleRecord): string {
  if (item.daily_communication) return textValue(item.daily_communication);
  return isCommunicationOk(item) ? 'Actualizado' : 'Revisar comunicación';
}

function shiftModuleSummary(shift: FlexibleRecord, module: ModuleKey): FlexibleRecord {
  const modules = asRows(shift.modules);
  const match = modules.find((item) => String(item.module) === module);
  return asRecord(match?.summary);
}

function shiftSummaryText(shift: FlexibleRecord, module: ModuleKey): string {
  const summary = shiftModuleSummary(shift, module);
  const total = Number(summary.total_count || 0);
  const active = Number(summary.active_count || 0);
  const data = Number(summary.data_count || 0);
  const partial = Number(summary.validation_partial_count || 0);
  const volume = numberOrNull(summary.volume_m3);
  if (String(shift.status) === 'pending') return 'Pendiente';
  if (module === 'pozos' || module === 'lineas' || module === 'flujos' || module === 'entrada') {
    const value = volume === null ? 'Sin datos' : `${formatNumber(volume)} m³`;
    return module === 'entrada' ? value : `${value} · ${active}/${total} con actividad`;
  }
  if (module === 'niveles') return `${data}/${total} actualizados${partial ? ` · ${partial} parciales` : ''}`;
  return `${active}/${total} encendidas${partial ? ` · ${partial} parciales` : ''}`;
}

function shiftStatusType(status: unknown): string {
  const code = lowerText(status);
  if (code === 'partial') return 'warning';
  if (code === 'pending') return 'idle';
  return 'normal';
}

function comparisonValue(dashboard: FlexibleRecord, module: ModuleKey): number | null {
  const rows = moduleRows(dashboard);
  if (module === 'entrada') return numberOrNull(rows.entrada[0]?.period_m3 ?? rows.entrada[0]?.period_delta_m3);
  if (module === 'pozos' || module === 'lineas' || module === 'flujos') return volumeSum(rows[module]);
  if (module === 'niveles') return communicationCount(rows.niveles);
  return activeCount(rows.uv);
}

function comparisonUnit(module: ModuleKey): string {
  if (module === 'pozos' || module === 'lineas' || module === 'flujos' || module === 'entrada') return 'm³';
  if (module === 'niveles') return 'actualizados';
  return 'encendidas';
}

function formatComparisonValue(value: number | null, module: ModuleKey): string {
  if (value === null) return '—';
  if (module === 'pozos' || module === 'lineas' || module === 'flujos' || module === 'entrada') return formatNumber(value);
  return String(Math.round(value));
}

function buildComparisonItems(current: FlexibleRecord, yesterday: FlexibleRecord | null, previousWeek: FlexibleRecord | null) {
  const modules: ModuleKey[] = ['entrada', 'pozos', 'lineas', 'flujos', 'niveles', 'uv'];
  return modules.map((module) => ({
    module,
    label: MODULE_LABELS[module],
    unit: comparisonUnit(module),
    today: comparisonValue(current, module),
    yesterday: yesterday ? comparisonValue(yesterday, module) : null,
    previousWeek: previousWeek ? comparisonValue(previousWeek, module) : null,
  })).filter((item) => item.today !== null || item.yesterday !== null || item.previousWeek !== null);
}

function RevisionDiariaSection() {
  const navigate = useNavigate();
  const review = useDailyWaterReview();
  const reviewPayload = asRecord(review.data);
  const dashboard = asRecord(reviewPayload.dashboard);
  const selectedDate = review.date || todayInputDate();
  const isToday = sameDayAsToday(selectedDate);
  const shiftPayload = asRecord(reviewPayload.shifts);
  const shiftRows = asRows(shiftPayload.shifts);
  const [expandedShifts, setExpandedShifts] = useState<string[]>([]);
  const [filter, setFilter] = useState<ElementFilter>('todos');

  const rowsByModule = useMemo(() => moduleRows(dashboard), [review.data]);
  const allElements = useMemo(() => {
    const entries: Array<{ module: ModuleKey; item: FlexibleRecord; route: string }> = [];
    (Object.keys(rowsByModule) as ModuleKey[]).forEach((module) => {
      rowsByModule[module].forEach((item) => entries.push({ module, item, route: routeFor(module, item) }));
    });
    return entries;
  }, [rowsByModule]);

  const filteredElements = useMemo(() => allElements.filter(({ module, item }) => {
    if (filter === 'todos') return true;
    if (filter === 'atencion') return !isCommunicationOk(item) || hasNoData(item) || hasPartialValidation(item);
    return module === filter;
  }), [allElements, filter]);

  useEffect(() => {
    if (!shiftRows.length) return;
    setExpandedShifts((current) => {
      const currentIds = new Set(shiftRows.map((shift) => String(shift.id)));
      const kept = current.filter((id) => currentIds.has(id));
      if (kept.length) return kept;
      const preferred = shiftRows.find((shift) => Boolean(shift.is_current)) || shiftRows[0];
      return preferred ? [String(preferred.id)] : [];
    });
  }, [shiftRows.map((shift) => String(shift.id)).join('|'), shiftRows.map((shift) => String(shift.is_current)).join('|')]);



  const partialCount = validationCount([rowsByModule.entrada[0], ...rowsByModule.pozos, ...rowsByModule.lineas, ...rowsByModule.flujos].filter(Boolean));
  const communicationTotal = allElements.length;
  const communicationOk = communicationCount(allElements.map((entry) => entry.item));
  const comparisons = asRecord(reviewPayload.comparisons);
  const previousDay = asRecord(asRecord(comparisons.previous_day).dashboard);
  const previousWeek = asRecord(asRecord(comparisons.previous_week).dashboard);
  const comparisonItems = buildComparisonItems(dashboard, previousDay, previousWeek);

  const applyDate = () => review.apply();

  const resetDate = () => {
    review.reset();
    setFilter('todos');
  };

  const toggleShift = (id: string) => {
    setExpandedShifts((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  return (
    <>
      <section className="daily-modern-hero panel fade-up">
        <div>
          <span className="section-eyebrow">REVISIÓN DIARIA</span>
          <h2>Revisión diaria</h2>
          <p>Resumen operativo del día seleccionado.</p>
        </div>
        <div className="daily-modern-datebox">
          <label>
            <span>Día</span>
            <input
              type="date"
              value={review.draftDate || selectedDate}
              onChange={(event) => review.setDraftDate(event.target.value)}
            />
          </label>
          <button type="button" className="btn primary" onClick={applyDate}>Actualizar</button>
          <button type="button" className="btn secondary" onClick={resetDate}>Restablecer</button>
          <em>{isToday ? 'Actualización automática cada 60 s' : 'Día histórico sin polling activo'}</em>
        </div>
      </section>

      <section className="cards-grid daily-modern-kpis">
        <KpiCard label={isToday ? "Entrada actual" : "Entrada del periodo"} value={rowsByModule.entrada[0] ? valueForElement('entrada', rowsByModule.entrada[0], isToday).split('·')[0].trim() : '—'} unit="" trend={isToday ? "Medición conjunta actual" : "Volumen del día seleccionado"} accent="blue" />
        <KpiCard label="Pozos con actividad" value={`${activeCount(rowsByModule.pozos)}/${rowsByModule.pozos.length || 0}`} unit="pozos" trend="Pozos individuales y SOSA 50%" accent="cyan" />
        <KpiCard label="Volumen de pozos" value={volumeSum(rowsByModule.pozos) !== null ? formatNumber(volumeSum(rowsByModule.pozos)) : '—'} unit={volumeSum(rowsByModule.pozos) !== null ? 'm³' : ''} trend="Pozos individuales confirmados" accent="blue" />
        <KpiCard label="Líneas con actividad" value={`${activeCount(rowsByModule.lineas)}/${rowsByModule.lineas.length || 0}`} unit="líneas" trend="Actividad separada de comunicación" accent="green" />
        <KpiCard label="Flujos con actividad" value={`${activeCount(rowsByModule.flujos)}/${rowsByModule.flujos.length || 0}`} unit="flujos" trend="Cero válido no implica falla" accent="cyan" />
        <KpiCard label="Niveles actualizados" value={`${communicationCount(rowsByModule.niveles)}/${rowsByModule.niveles.length || 0}`} unit="niveles" trend="No se calcula volumen" accent="blue" />
        <KpiCard label="UV actualizadas" value={`${communicationCount(rowsByModule.uv)}/${rowsByModule.uv.length || 0}`} unit="lámparas" trend="Estado real disponible" accent="green" />
        <KpiCard label="Comunicación" value={`${communicationOk}/${communicationTotal || 0}`} unit="elementos" trend="Actividad y comunicación separadas" accent="blue" />
        <KpiCard label="Validación parcial" value={String(partialCount)} unit="elementos" trend="No implica alerta crítica" accent={partialCount ? 'amber' : 'green'} />
        <KpiCard label={isToday ? "Última actualización" : "Revisión generada"} value={formatLocalDate(isToday ? dashboard.last_update : reviewPayload.updated_at).replace(', ', '\n')} unit="" trend={review.refreshing ? 'Actualizando...' : 'Datos del día visibles'} accent="cyan" />
      </section>

      <section className="panel fade-up daily-modern-shifts">
        <PanelHeader title="Cortes por turno" subtitle="Síntesis del día seleccionado. Los módulos se muestran por separado; no se calcula un total hidráulico global." />
        {review.error && shiftRows.length ? <p className="daily-modern-note">No se pudo refrescar la revisión completa. Se conserva el último dato válido cuando existe.</p> : null}
        <div className="daily-shift-card-grid">
          {shiftRows.map((shift) => (
            <article className={`daily-shift-card status-${String(shift.status)}`} key={String(shift.id)}>
              <span>{String(shift.label).toUpperCase()}</span>
              <small>{String(shift.schedule)}</small>
              <strong>{String(shift.status_label || 'Sin estado')}</strong>
              <div className="daily-shift-module-lines">
                {(['entrada', 'pozos', 'lineas', 'flujos', 'niveles', 'uv'] as ModuleKey[]).map((module) => (
                  <p key={module}><b>{MODULE_LABELS[module]}</b><em>{shiftSummaryText(shift, module)}</em></p>
                ))}
              </div>
            </article>
          ))}
        </div>
        {review.loading && !shiftRows.length ? <ChartEmptyState message="Cargando revisión diaria..." /> : null}
        <div className="daily-shift-accordion">
          {shiftRows.map((shift) => {
            const id = String(shift.id);
            const isOpen = expandedShifts.includes(id);
            return (
              <article className="daily-shift-accordion-item" key={id}>
                <button type="button" onClick={() => toggleShift(id)} aria-expanded={isOpen}>
                  <span><strong>{String(shift.label)}</strong><small>{String(shift.schedule)}</small></span>
                  <StatusBadge type={shiftStatusType(shift.status)}>{String(shift.status_label || 'Sin estado')}</StatusBadge>
                </button>
                {isOpen ? (
                  <div className="daily-shift-accordion-body">
                    {(['entrada', 'pozos', 'lineas', 'flujos', 'niveles', 'uv'] as ModuleKey[]).map((module) => (
                      <div className="daily-shift-module-summary" key={module}>
                        <strong>{MODULE_LABELS[module]}</strong>
                        <span>{shiftSummaryText(shift, module)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel fade-up daily-module-status-panel">
        <PanelHeader title="Estado por módulo" subtitle="Resumen operativo con actividad, comunicación y validación separados." />
        <div className="daily-module-grid">
          {(['entrada', 'pozos', 'lineas', 'flujos', 'niveles', 'uv'] as ModuleKey[]).map((module) => {
            const items = rowsByModule[module];
            return (
              <Link className="daily-module-card insurgentes-clickable-card" to={MODULE_ROUTES[module]} key={module}>
                <span>{MODULE_LABELS[module]}</span>
                <strong>{mainModuleValue(module, items, isToday)}</strong>
                <div>
                  <p><b>Elementos</b><em>{items.length || 0}</em></p>
                  <p><b>Con actividad</b><em>{activeCount(items)}/{items.length || 0}</em></p>
                  <p><b>Comunicación</b><em>{communicationCount(items)}/{items.length || 0}</em></p>
                  <p><b>Validación parcial</b><em>{validationCount(items)}</em></p>
                </div>
                <small>Abrir módulo →</small>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="panel fade-up daily-comparison-panel">
        <PanelHeader title="Comparativo del día" subtitle="Referencia compacta: hoy, ayer y mismo día de la semana anterior. No sustituye al histórico por módulo." />
        <div className="daily-comparison-grid">
          {comparisonItems.map((item) => (
            <article key={item.module}>
              <span>{item.label}</span>
              <div><b>Seleccionado</b><strong>{formatComparisonValue(item.today, item.module)} <small>{item.unit}</small></strong></div>
              <div><b>Ayer</b><strong>{formatComparisonValue(item.yesterday, item.module)} <small>{item.unit}</small></strong></div>
              <div><b>Semana ant.</b><strong>{formatComparisonValue(item.previousWeek, item.module)} <small>{item.unit}</small></strong></div>
            </article>
          ))}
        </div>
      </section>

      <OperationalAlertsPanel
        title={isToday ? 'Alertas y prioridades' : 'Alertas operativas actuales'}
        subtitle={isToday ? 'Condiciones actuales evaluadas desde datos reales.' : 'Estas alertas corresponden al estado actual de la planta y no al día histórico seleccionado.'}
      />

      <section className="panel fade-up daily-elements-panel">
        <PanelHeader title="Resumen de elementos" subtitle="Inspección rápida. Las filas abren el detalle correspondiente cuando existe." />
        <div className="daily-filter-row" role="group" aria-label="Filtrar elementos de revisión diaria">
          {FILTERS.map((item) => (
            <button type="button" className={filter === item.key ? 'active' : ''} onClick={() => setFilter(item.key)} key={item.key}>{item.label}</button>
          ))}
        </div>
        <div className="daily-elements-table-wrap">
          <table className="pozos-table daily-elements-table">
            <thead>
              <tr>
                <th>Elemento</th>
                <th>Módulo</th>
                <th>Valor principal</th>
                <th>Actividad</th>
                <th>Validación</th>
                <th>Comunicación</th>
                <th>Última actualización</th>
              </tr>
            </thead>
            <tbody>
              {filteredElements.map(({ module, item, route }, index) => (
                <tr key={`${module}-${itemId(item) || index}`} onClick={() => navigate(route)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') navigate(route); }}>
                  <td>{itemName(item, MODULE_LABELS[module])}</td>
                  <td>{MODULE_LABELS[module]}</td>
                  <td>{valueForElement(module, item, isToday)}</td>
                  <td><StatusBadge type={isActive(item) ? 'normal' : 'idle'}>{activityLabel(item)}</StatusBadge></td>
                  <td><StatusBadge type={hasPartialValidation(item) ? 'warning' : hasNoData(item) ? 'idle' : 'normal'}>{validationLabel(item)}</StatusBadge></td>
                  <td><StatusBadge type={statusTypeFor(item)}>{communicationLabel(item)}</StatusBadge></td>
                  <td>{formatLocalDate(item.updated ?? item.ultima_lectura ?? dashboard.last_update)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredElements.length ? <ChartEmptyState message="No hay elementos para el filtro seleccionado." /> : null}
        </div>
      </section>

      <section className="panel fade-up daily-update-panel">
        <PanelHeader title="Estado de actualización" subtitle="La revisión consume una única fuente diaria con módulos, turnos y comparativos." />
        <div className="daily-update-grid">
          <article><span>Día revisado</span><strong>{selectedDate}</strong></article>
          <article><span>Polling</span><strong>{isToday ? 'Activo cada 60 s' : 'Inactivo en histórico'}</strong></article>
          <article><span>Fuente diaria</span><strong>{textValue(reviewPayload.source_status, '—')}</strong></article>
          <article><span>Última generación</span><strong>{formatLocalDate(reviewPayload.updated_at ?? shiftPayload.updated_at)}</strong></article>
        </div>
      </section>

      {review.error && !review.data ? <ChartEmptyState message="No se pudo actualizar Revisión diaria." /> : null}
    </>
  );
}

export default RevisionDiariaSection;
