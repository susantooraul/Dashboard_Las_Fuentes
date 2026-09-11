import type { ReactNode } from 'react';

interface ReportPreviewTableProps {
  title: string;
  subtitle?: string;
  headers: string[];
  rows?: ReactNode[][];
  emptyMessage?: string;
}

function ReportPreviewTable({ title, subtitle, headers, rows, emptyMessage = 'Sin datos disponibles.' }: ReportPreviewTableProps) {
  if (!rows?.length) {
    return (
      <section className="report-preview-section">
        <div className="report-preview-section-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </div>
        <div className="report-preview-empty">{emptyMessage}</div>
      </section>
    );
  }

  return (
    <section className="report-preview-section">
      <div className="report-preview-section-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <span className="report-preview-count">{rows.length} registros</span>
      </div>
      <div className="report-preview-table-scroll">
        <table className="report-preview-table">
          <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={`${title}-${index}`}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell || '—'}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

export default ReportPreviewTable;
