function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
function format(value, suffix = '', decimals = 2) {
    if (value === null || value === undefined || value === '')
        return '—';
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return `${numeric.toLocaleString('es-MX', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        })}${suffix}`;
    }
    return `${value}${suffix}`;
}
function count(value, total) {
    const current = Number(value);
    const maximum = Number(total);
    if (!Number.isFinite(current) || !Number.isFinite(maximum))
        return '—';
    return `${current}/${maximum}`;
}
function reportFileBase(report) {
    const start = String(report.start_date || report.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const end = String(report.end_date || report.date || start).slice(0, 10);
    const period = start === end ? start : `${start}-a-${end}`;
    return `reporte-diario-control-hidrico-las-fuentes-${period}`;
}
function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
}
function table(title, headers, rows) {
    if (!rows.length) {
        return `<section class="block"><h2>${escapeHtml(title)}</h2><p class="empty">Sin datos operativos disponibles.</p></section>`;
    }
    return `<section class="block"><h2>${escapeHtml(title)}</h2><div class="table-wrap"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(format(row[header.key], header.suffix || ''))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
}
function uvSummaryTable(summary) {
    return table('Lecturas generales del sistema UV', [
        { key: 'uvt', label: 'UVT', suffix: '%' },
        { key: 'potencia', label: 'Potencia', suffix: '%' },
        { key: 'flujo', label: 'Flujo', suffix: ' L/s' },
        { key: 'dosis', label: 'Dosis', suffix: ' mJ/cm²' },
        { key: 'comunicacion', label: 'Comunicación' },
        { key: 'ultima_actualizacion', label: 'Última actualización' },
    ], [summary]);
}
export function buildDailyWaterReportHtml(report, logoUrl) {
    const summary = report.summary || {};
    const entryRows = report.water_entry?.rows || [];
    const lineRows = report.lines?.rows || [];
    const flowRows = report.flows?.rows || [];
    const levelRows = report.levels?.rows || [];
    const uvRows = report.uv?.rows || [];
    const uvSummary = report.uv?.summary || {};
    const title = report.title || 'Reporte Diario de Control Hídrico Las Fuentes';
    const period = report.period_label || report.date || '—';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><title>${escapeHtml(reportFileBase(report))}</title><style>
  @page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111827;background:#fff;margin:0}.page{padding:10mm}.brand{text-align:center;margin-bottom:4mm}.brand img{width:42mm;height:14mm;object-fit:contain}.header{text-align:center;margin-bottom:14px}.header h1{font-size:22px;margin:0 0 8px}.header p{font-size:11px;color:#64748b;margin:3px 0}.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.kpi{border:1px solid #e5e7eb;border-radius:10px;padding:10px;background:#f8fafc}.kpi span{display:block;font-size:10px;color:#64748b}.kpi strong{display:block;margin-top:4px;font-size:15px}.block{margin:16px 0;break-inside:avoid}.block h2{font-size:14px;margin:0 0 7px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:9.5px}th{background:#eef3f8;color:#334155;text-align:left}th,td{border:1px solid #d9e1ea;padding:5px;vertical-align:middle}.empty{color:#64748b}.note{font-size:10px;color:#64748b;margin-top:6px}.footer{font-size:9px;color:#94a3b8;text-align:right;margin-top:18px}@media print{.page{padding:0}}
  </style></head><body><main class="page">
  <div class="brand">${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="Arca Continental"/>` : ''}</div>
  <header class="header"><h1>${escapeHtml(title)}</h1><p>Planta: Las Fuentes</p><p>Periodo: ${escapeHtml(period)}</p><p>Fuente: Información operativa de planta</p><p>Reporte: ${escapeHtml(report.report_code || '—')}</p></header>
  <section class="kpis">
    <div class="kpi"><span>Pozos Corporativos</span><strong>${escapeHtml(format(summary.volumen_recibido_m3, ' m³'))}</strong></div>
    <div class="kpi"><span>Flujo actual</span><strong>${escapeHtml(format(summary.flujo_actual_lps, ' L/s'))}</strong></div>
    <div class="kpi"><span>Líneas activas</span><strong>${escapeHtml(count(summary.lineas_activas, summary.lineas_total))}</strong></div>
    <div class="kpi"><span>Flujos activos</span><strong>${escapeHtml(count(summary.flujos_activos, summary.flujos_total))}</strong></div>
    <div class="kpi"><span>UV encendidas</span><strong>${escapeHtml(count(summary.lamparas_uv_encendidas, summary.lamparas_uv_total))}</strong></div>
    <div class="kpi"><span>Comunicación</span><strong>${escapeHtml(summary.estado_comunicacion || '—')}</strong></div>
  </section>
  ${table('Pozos Corporativos', [
        { key: 'equipo', label: 'Elemento' },
        { key: 'flujo_lps', label: 'Flujo actual', suffix: ' L/s' },
        { key: 'totalizador_m3', label: 'Totalizador', suffix: ' m³' },
        { key: 'volumen_periodo_m3', label: 'Volumen periodo', suffix: ' m³' },
        { key: 'estado', label: 'Estado' },
        { key: 'ultima_actualizacion', label: 'Última actualización' },
    ], entryRows)}
  ${table('Líneas', [
        { key: 'equipo', label: 'Línea' },
        { key: 'flujo_lps', label: 'Flujo', suffix: ' L/s' },
        { key: 'totalizador_m3', label: 'Totalizador', suffix: ' m³' },
        { key: 'volumen_periodo_m3', label: 'Volumen periodo', suffix: ' m³' },
        { key: 'estado', label: 'Estado' },
        { key: 'ultima_actualizacion', label: 'Última actualización' },
    ], lineRows)}
  ${flowRows.length ? table('Flujos', [
        { key: 'equipo', label: 'Flujo' },
        { key: 'flujo_lps', label: 'Flujo actual', suffix: ' L/s' },
        { key: 'totalizador_m3', label: 'Totalizador', suffix: ' m³' },
        { key: 'volumen_periodo_m3', label: 'Volumen periodo', suffix: ' m³' },
        { key: 'estado', label: 'Estado' },
        { key: 'ultima_actualizacion', label: 'Última actualización' },
    ], flowRows) : ''}
  ${table('Niveles', [
        { key: 'elemento', label: 'Elemento' },
        { key: 'nivel_m', label: 'Nivel', suffix: ' m' },
        { key: 'porcentaje', label: 'Porcentaje', suffix: '%' },
        { key: 'nivel_minimo_m', label: 'Mínimo', suffix: ' m' },
        { key: 'nivel_maximo_m', label: 'Máximo', suffix: ' m' },
        { key: 'estado', label: 'Estado' },
        { key: 'ultima_actualizacion', label: 'Última actualización' },
    ], levelRows)}
  ${table('Lámparas UV', [
        { key: 'equipo', label: 'Lámpara' },
        { key: 'scada_id', label: 'ID' },
        { key: 'agel', label: 'Age' },
        { key: 'uvt', label: 'UVT', suffix: '%' },
        { key: 'power', label: 'Power', suffix: '%' },
        { key: 'flow', label: 'Flow', suffix: ' L/s' },
        { key: 'dose', label: 'Dosis', suffix: ' mJ/cm²' },
        { key: 'estado_operativo', label: 'State' },
        { key: 'status', label: 'Status', suffix: '%' },
    ], uvRows)}
  ${uvSummaryTable(uvSummary)}
  <div class="footer">Generado: ${escapeHtml(report.generated_at || '')}</div>
  </main></body></html>`;
}
export function exportDailyWaterReportHtml(report, logoUrl) {
    downloadBlob(buildDailyWaterReportHtml(report, logoUrl), `${reportFileBase(report)}.html`, 'text/html;charset=utf-8');
}
export function exportDailyWaterReportExcel(report) {
    const html = buildDailyWaterReportHtml(report, '');
    downloadBlob(html, `${reportFileBase(report)}.xls`, 'application/vnd.ms-excel;charset=utf-8');
}
export async function printDailyWaterReportPdf(report, logoUrl) {
    const html = buildDailyWaterReportHtml(report, logoUrl);
    const printWindow = window.open('', '_blank', 'noopener,noreferrer');
    if (!printWindow)
        throw new Error('El navegador bloqueó la ventana de impresión.');
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 300);
}
