import type * as React from 'react';

export interface KpiCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  trend?: React.ReactNode;
  accent?: string;
  style?: React.CSSProperties;
}

export default function KpiCard({ label, value, unit, trend, accent, style }: KpiCardProps) {
  const valueText = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const sizeClass = valueText.length >= 10 ? ' compact-value' : valueText.length >= 7 ? ' long-value' : '';
  return (
    <div className={`panel kpi-card accent-${accent || 'red'} fade-up${sizeClass}`} style={style}>
      <div className="kpi-glow" />
      <div className="kpi-label">{label}</div>
      <div className="kpi-value-row">
        <div className="kpi-value">{value}</div>
        <div className="kpi-unit">{unit}</div>
      </div>
      <div className="kpi-trend">{trend}</div>
    </div>
  );
}
