import type { DateRange } from '../types';
import { rangeMeta } from './DateRangeControls';

interface ChartPeriodNoteProps {
  range: DateRange;
  source?: string;
}

function ChartPeriodNote({ range, source }: ChartPeriodNoteProps) {
  const meta = rangeMeta(range);
  return (
    <div className="chart-period-note">
      <span>{meta.periodTitle}</span>
      <span>Rango: {meta.rangeLabel}</span>
      {source ? <span>{source}</span> : null}
    </div>
  );
}

export default ChartPeriodNote;
