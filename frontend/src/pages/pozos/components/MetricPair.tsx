import type { ReactNode } from 'react';

interface MetricPairProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  emphasis?: boolean;
  className?: string;
}

function MetricPair({ label, value, unit, emphasis, className }: MetricPairProps) {
  const classes = ['metric-pair', emphasis ? 'emphasis' : '', className || ''].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      <span>{label}</span>
      <strong>{value}{unit ? <small>{unit}</small> : null}</strong>
    </div>
  );
}

export default MetricPair;
