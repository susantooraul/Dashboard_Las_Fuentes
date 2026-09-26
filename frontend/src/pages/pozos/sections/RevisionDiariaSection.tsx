import { useMemo } from 'react';
import KpiCard from '../../../components/KpiCard';
import ChartEmptyState from '../components/ChartEmptyState';
import PanelHeader from '../components/PanelHeader';
import StatusBadge from '../components/StatusBadge';
import useDailyWaterReview from '../hooks/useDailyWaterReview';
import { formatShiftDateTimeRange, todayInputDate } from '../dateUtils';
import { asRecord, asRows, formatLocalDate, formatNumber, numberOrNull } from '../insurgentesUtils';
import type { FlexibleRecord } from '../types';

type GroupKey = 'pozos' | 'tam' | 'embotellado' | 'cisterna';

const GROUP_LABELS: Record<GroupKey, string> = {
  pozos: 'Pozos',
  tam: 'TAM',
  embotellado: 'Embotellado',
  cisterna: 'Cisterna',
};

function rowsFor(dashboard: FlexibleRecord): Record<GroupKey, FlexibleRecord[]> {
  const flows = asRows(dashboard.flows ?? dashboard.distribution_flows);
  return {
    pozos: asRows(dashboard.wells ?? dashboard.pozos),
    tam: flows.filter((item) => String(item.module_group || '') === 'tam'),
    embotellado: flows.filter((item) => String(item.module_group || '') === 'embotellado'),
    cisterna: flows.filter((item) => String(item.module_group || '') === 'cisterna'),
  };
}

function volumeOf(item: FlexibleRecord): number | null {
  return numberOrNull(item.period_m3 ?? item.period_delta_m3 ?? item.volume_m3);
}

function volumeTotal(items: FlexibleRecord[]): number | null {
  const values = items.map(volumeOf).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function isActive(item: FlexibleRecord): boolean {
  if (item.active === true) return true;
  const activity = String(item.daily_activity ?? item.activity ?? item.status ?? '').toLowerCase();
  return activity.includes('con actividad') || activity.includes('operando') || activity.includes('activo');
}

function qualityLabel(item: FlexibleRecord): string {
  return String(item.daily_validation ?? item.validation ?? item.validacion ?? 'Sin datos');
}

function communicationLabel(item: FlexibleRecord): string {
  return String(item.daily_communication ?? item.estado_comunicacion ?? item.communication ?? 'Sin información');
}

function shiftModule(shift: FlexibleRecord, moduleName: string): FlexibleRecord {
  return asRecord(asRows(shift.modules).find((item) => String(item.module) === moduleName));
}

function shiftGroupItems(shift: FlexibleRecord, group: GroupKey): FlexibleRecord[] {
  if (group === 'pozos') return asRows(shiftModule(shift, 'pozos').items);
  return asRows(shiftModule(shift, 'flujos').items).filter((item) => String(item.module_group || '') === group);
}

function shiftGroupVolume(shift: FlexibleRecord, group: GroupKey): number | null {
  const values = shiftGroupItems(shift, group)
    .map((item) => numberOrNull(item.volume_m3))
    .filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function comparisonRows(payload: FlexibleRecord): Array<{ key: GroupKey; selected: number | null; previous: number | null; week: number | null }> {
  const current = rowsFor(asRecord(payload.dashboard));
  const comparisons = asRecord(payload.comparisons);
  const previous = rowsFor(asRecord(asRecord(comparisons.previous_day).dashboard));
  const week = rowsFor(asRecord(asRecord(comparisons.previous_week).dashboard));
  return (Object.keys(GROUP_LABELS) as GroupKey[]).map((key) => ({
    key,
    selected: volumeTotal(current[key]),
    previous: volumeTotal(previous[key]),
    week: volumeTotal(week[key]),
  }));
}

function dateLabel(value: unknown): string {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return text || '—';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function activityTrend(items: FlexibleRecord[]): string {
  if (!items.length) return 'Sin elementos';
  return `${items.filter(isActive).length}/${items.length} con actividad`;
}

function shiftStatusType(status: unknown): string {
  const value = String(status || '').toLowerCase();
  if (value === 'partial') return 'warning';
  if (value === 'pending') return 'idle';
  return 'normal';
}

export default function RevisionDiariaSection() {
  const review = useDailyWaterReview();
  const payload = asRecord(review.data);
  const dashboard = asRecord(payload.dashboard);
  const groups = useMemo(() => rowsFor(dashboard), [review.data]);
  const shifts = asRows(asRecord(payload.shifts).shifts);
  const comparisons = useMemo(() => comparisonRows(payload), [review.data]);
  const selectedDate = review.date || todayInputDate();
  const comparisonPayload = asRecord(payload.comparisons);
  const previousDay = asRecord(comparisonPayload.previous_day);
  const previousWeek = asRecord(comparisonPayload.previous_week);
  const selectedDateLabel = dateLabel(payload.date ?? selectedDate);
  const previousDateLabel = dateLabel(previousDay.date ?? previousDay.end_date);
  const previousWeekDateLabel = dateLabel(previousWeek.date ?? previousWeek.end_date);

  if (review.loading && !review.data) return <ChartEmptyState message="Cargando revisión diaria..." />;

  return (
    <div className="lf-review-page">
      <section className="daily-modern-hero panel fade-up lf-review-hero">
        <div>
          <h2>Revisión diaria</h2>
        </div>
        <div className="daily-modern-datebox">
          <label><span>Día</span><input type="date" value={review.draftDate || selectedDate} onChange={(event) => review.setDraftDate(event.target.value)} /></label>
          <button type="button" className="btn primary" onClick={review.apply}>Actualizar</button>
          <button type="button" className="btn secondary" onClick={review.reset}>Restablecer</button>
          <em>{review.refreshing ? 'Actualizando…' : review.isToday ? 'Actualización automática cada 60 s' : 'Día histórico sin polling activo'}</em>
        </div>
      </section>

      {review.error && review.data ? <p className="lf-review-inline-warning">No se pudo actualizar la revisión. Se conserva el último dato válido.</p> : null}
      {review.error && !review.data ? <section className="panel lf-review-error"><ChartEmptyState message={review.error} /></section> : null}

      <section className="cards-grid daily-modern-kpis lf-review-kpis" aria-label="Volumen diario por proceso">
        {(Object.keys(GROUP_LABELS) as GroupKey[]).map((key) => {
          const total = volumeTotal(groups[key]);
          return (
            <KpiCard
              key={key}
              label={GROUP_LABELS[key]}
              value={total === null ? '—' : formatNumber(total)}
              unit={total === null ? '' : 'm³'}
              trend={activityTrend(groups[key])}
              accent="blue"
            />
          );
        })}
      </section>

      <section className="panel fade-up daily-modern-shifts lf-review-shifts">
        <PanelHeader title="Cortes por turno" />
        <div className="daily-shift-card-grid">
          {shifts.map((shift) => (
            <article className={`daily-shift-card status-${String(shift.status)}`} key={String(shift.id)}>
              <header className="lf-review-shift-card__header">
                <div>
                  <span>{String(shift.label || 'Turno').toUpperCase()}</span>
                  <small>{formatShiftDateTimeRange(selectedDate, shift.schedule)}</small>
                </div>
                <StatusBadge type={shiftStatusType(shift.status)}>{String(shift.status_label || 'Sin estado')}</StatusBadge>
              </header>
              <div className="daily-shift-summary-grid">
                {(Object.keys(GROUP_LABELS) as GroupKey[]).map((key) => {
                  const value = shiftGroupVolume(shift, key);
                  return <div key={key}><span>{GROUP_LABELS[key]}</span><b>{value === null ? '—' : `${formatNumber(value)} m³`}</b></div>;
                })}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel fade-up lf-review-comparison">
        <PanelHeader title="Comparativo de volúmenes" />
        <div className="shift-table-wrap">
          <table className="shift-table">
            <thead>
              <tr>
                <th>Proceso</th>
                <th>Seleccionado · {selectedDateLabel}</th>
                <th>Día anterior · {previousDateLabel}</th>
                <th>Semana anterior · {previousWeekDateLabel}</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((row) => (
                <tr key={row.key}>
                  <td>{GROUP_LABELS[row.key]}</td>
                  <td>{row.selected === null ? '—' : `${formatNumber(row.selected)} m³`}</td>
                  <td>{row.previous === null ? '—' : `${formatNumber(row.previous)} m³`}</td>
                  <td>{row.week === null ? '—' : `${formatNumber(row.week)} m³`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel fade-up lf-review-elements">
        <PanelHeader title="Resumen de elementos" />
        {review.refreshing ? <p className="lf-review-refreshing">Actualizando…</p> : null}
        <div className="shift-table-wrap">
          <table className="shift-table">
            <thead>
              <tr>
                <th>Proceso</th>
                <th>Elemento</th>
                <th>Volumen</th>
                <th>Actividad</th>
                <th>Comunicación</th>
                <th>Validación</th>
                <th>Última actualización</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(GROUP_LABELS) as GroupKey[]).flatMap((key) => groups[key].map((item) => (
                <tr key={`${key}-${String(item.id || item.sensor_id || item.name)}`}>
                  <td>{GROUP_LABELS[key]}</td>
                  <td>{String(item.name || item.nombre || item.id || 'Elemento')}</td>
                  <td>{volumeOf(item) === null ? '—' : `${formatNumber(volumeOf(item))} m³`}</td>
                  <td>{isActive(item) ? 'Con actividad' : 'Sin actividad'}</td>
                  <td>{communicationLabel(item)}</td>
                  <td>{qualityLabel(item)}</td>
                  <td>{formatLocalDate(item.updated ?? item.ultima_lectura ?? item.last_update ?? dashboard.last_update)}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
