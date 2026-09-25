import type { ReactNode } from 'react';
import type { DateRange, HistoryAggregation } from '../types';
import DateRangeControls, { rangeMeta } from './DateRangeControls';

interface SqlChartDateController {
  draftRange: DateRange;
  range: DateRange;
  setDraftRange: (range: DateRange) => void;
  apply: () => void;
  reset: () => void;
  aggregation?: HistoryAggregation;
  setAggregation?: (value: HistoryAggregation) => void;
  error?: string;
  loading?: boolean;
}

interface SqlChartDateControlsProps {
  controller: SqlChartDateController;
  title?: string;
  subtitle?: string;
  extraAction?: ReactNode;
  showHeader?: boolean;
  showMeta?: boolean;
  showStatus?: boolean;
}

function SqlChartDateControls({
  controller,
  title = 'Fechas de la gráfica',
  subtitle = 'Este rango solo afecta esta gráfica y no modifica los estados actuales.',
  extraAction,
  showHeader = true,
  showMeta = true,
  showStatus = true,
}: SqlChartDateControlsProps) {
  const meta = rangeMeta(controller.range, controller.aggregation);
  const status = controller.error || (controller.loading ? 'Cargando datos...' : `${meta.periodTitle} · ${meta.rangeLabel}`);
  return (
    <DateRangeControls
      className="chart-date-range-panel"
      showHeader={showHeader}
      showMeta={showMeta}
      showStatus={showStatus}
      title={title}
      subtitle={subtitle}
      draftRange={controller.draftRange}
      activeRange={controller.range}
      onDraftChange={controller.setDraftRange}
      onApply={controller.apply}
      onReset={controller.reset}
      status={status}
      aggregation={controller.aggregation}
      onAggregationChange={controller.setAggregation}
      extraAction={extraAction}
    />
  );
}

export default SqlChartDateControls;
