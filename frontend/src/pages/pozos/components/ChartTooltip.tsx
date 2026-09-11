interface ChartTooltipEntry {
  dataKey?: string | number;
  name?: string | number;
  color?: string;
  fill?: string;
  value?: unknown;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipEntry[];
  label?: string | number;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip solid-tooltip pozos-tooltip">
      {label ? <div className="chart-tooltip-label">{label}</div> : null}
      <div className="chart-tooltip-list">
        {payload.map((entry, index) => (
          <div className="chart-tooltip-row" key={`${entry.dataKey || entry.name}-${index}`}>
            <span className="chart-tooltip-dot" style={{ background: entry.color || entry.fill || '#fff' }} />
            <span className="chart-tooltip-name">{entry.name || entry.dataKey}</span>
            <span className="chart-tooltip-value">{Number(entry.value || 0).toLocaleString('es-MX')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ChartTooltip;
