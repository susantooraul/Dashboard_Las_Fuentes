interface ChartEmptyStateProps {
  message?: string;
}

function ChartEmptyState({ message = 'Sin datos disponibles para esta gráfica.' }: ChartEmptyStateProps) {
  return <div className="chart-empty-state">{message}</div>;
}

export default ChartEmptyState;
