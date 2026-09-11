import type { ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';
import type { DateRange, HistoryAggregation, Period } from '../types';
import { dateRangePeriod, formatDateRangeStatus, periodLabel, periodTitle } from '../dateUtils';

interface RangeMeta {
  period: Period;
  periodLabel: string;
  periodTitle: string;
  rangeLabel: string;
}

export interface DateRangeControlsProps {
  draftRange: DateRange;
  activeRange?: DateRange | null;
  onDraftChange: (range: DateRange) => void;
  onApply: () => void;
  onReset?: () => void;
  status?: string;
  title?: string;
  subtitle?: string;
  className?: string;
  showDateIcons?: boolean;
  aggregation?: HistoryAggregation;
  onAggregationChange?: (value: HistoryAggregation) => void;
  extraAction?: ReactNode;
  showHeader?: boolean;
}

export function rangeMeta(range: DateRange = {}, aggregation?: Period): RangeMeta {
  const period = aggregation || dateRangePeriod(range);
  const rangeLabel = formatDateRangeStatus(range, 'Hoy');
  return {
    period,
    periodLabel: periodLabel(period),
    periodTitle: periodTitle(period),
    rangeLabel,
  };
}

function DateRangeControls({
  draftRange,
  activeRange,
  onDraftChange,
  onApply,
  onReset,
  status,
  title = 'Rango de fechas',
  subtitle = '',
  className = '',
  showDateIcons = true,
  aggregation,
  onAggregationChange,
  extraAction,
  showHeader = true,
}: DateRangeControlsProps) {
  const meta = rangeMeta(activeRange || draftRange, aggregation);
  const renderDateInput = (field: 'startDate' | 'endDate') => {
    const input = (
      <input
        type="date"
        value={draftRange[field] || ''}
        onChange={(event) => onDraftChange({ ...draftRange, [field]: event.target.value })}
      />
    );
    if (!showDateIcons) return input;
    return (
      <div className="date-input-with-icon">
        <CalendarDays size={16} aria-hidden="true" />
        {input}
      </div>
    );
  };

  return (
    <section className={`date-range-panel panel fade-up ${className}`.trim()}>
      <div>
        {showHeader ? (
          <>
            <div className="panel-title">{title}</div>
            {subtitle ? <div className="panel-subtitle">{subtitle}</div> : null}
          </>
        ) : null}
        <div className="date-range-meta">
          <span>{meta.periodTitle}</span>
          <span>{meta.rangeLabel}</span>
        </div>
      </div>
      <div className="date-range-fields">
        <label>
          <span>Desde</span>
          {renderDateInput('startDate')}
        </label>
        <label>
          <span>Hasta</span>
          {renderDateInput('endDate')}
        </label>
        {aggregation && onAggregationChange ? (
          <label>
            <span>Agrupación</span>
            <select
              className="history-aggregation-native"
              value={aggregation}
              onChange={(event) => onAggregationChange(event.target.value as HistoryAggregation)}
              aria-label="Agrupación del histórico"
            >
              <option value="minute">1 minuto (máx. 1 día)</option>
              <option value="quarter_hour">15 minutos</option>
              <option value="hourly">1 hora</option>
              <option value="daily">1 día</option>
            </select>
          </label>
        ) : null}
        <button type="button" className="date-range-apply" onClick={onApply}>Actualizar</button>
        {onReset ? <button type="button" className="date-range-reset" onClick={onReset}>Restablecer</button> : null}
        {extraAction}
        <div className="date-range-status">{status || `${meta.periodTitle} · ${meta.rangeLabel}`}</div>
      </div>
    </section>
  );
}

export default DateRangeControls;
