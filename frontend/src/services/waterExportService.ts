type ExportRow = Record<string, string>;

interface ExportTable {
  title: string;
  headers: string[];
  rows: ExportRow[];
}

interface ExportChart {
  title: string;
  svg: string;
}

interface ExportCard {
  label: string;
  value: string;
  unit: string;
  note: string;
}

interface ExportDateRange {
  startDate?: string;
  endDate?: string;
}

interface ExportContext {
  title?: string;
  dateRange?: ExportDateRange;
  [key: string]: unknown;
}

interface DomReport {
  title: string;
  section: string;
  generated: string;
  range: string;
  cloneHtml: string;
  tables: ExportTable[];
  charts: ExportChart[];
  css: string;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function slugify(value: unknown): string {
  return String(value || 'reporte-arca')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'reporte-arca';
}

function downloadBlob(content: Blob | BlobPart, filename: string, type: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function getCssText(): string {
  if (typeof document === 'undefined') return '';
  const chunks: string[] = [];
  Array.from(document.styleSheets).forEach((sheet) => {
    try {
      Array.from(sheet.cssRules || []).forEach((rule) => chunks.push(rule.cssText));
    } catch (_) {
      // Ignorar hojas externas sin permiso CORS.
    }
  });
  return chunks.join('\n');
}

function getExportRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('[data-export-root]') || document.querySelector('.pozos-page') || document.body;
}

function normalizeClone(node: Element): HTMLElement {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('button, input, select').forEach((el) => {
    if (el.tagName === 'INPUT') {
      const input = el as HTMLInputElement;
      const span = document.createElement('span');
      span.className = 'export-form-value';
      span.textContent = input.value || input.placeholder || '—';
      input.replaceWith(span);
      return;
    }
    if (el.tagName === 'SELECT') {
      const select = el as HTMLSelectElement;
      const span = document.createElement('span');
      span.className = 'export-form-value';
      span.textContent = select.selectedOptions?.[0]?.textContent || select.value || '—';
      select.replaceWith(span);
      return;
    }
    el.remove();
  });
  clone.querySelectorAll('[aria-hidden="true"]').forEach((el) => el.remove());
  return clone;
}

function getVisibleTables(): ExportTable[] {
  const root = getExportRoot();
  if (!root) return [];
  return Array.from(root.querySelectorAll('table')).filter((table) => {
    const rect = table.getBoundingClientRect();
    const style = window.getComputedStyle(table);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }).map((table, index) => {
    const title = table.closest('.panel')?.querySelector('.panel-title, h2, h3')?.textContent?.trim() || `Tabla ${index + 1}`;
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => (th.textContent || '').replace(/\s+/g, ' ').trim());
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim());
      const row: ExportRow = {};
      cells.forEach((cell, cellIndex) => { row[headers[cellIndex] || `Columna ${cellIndex + 1}`] = cell || '—'; });
      return row;
    });
    return { title, headers, rows };
  }).filter((table) => table.rows.length);
}

function getVisibleCharts(): ExportChart[] {
  const root = getExportRoot();
  if (!root) return [];
  return Array.from(root.querySelectorAll('.recharts-wrapper svg, svg.recharts-surface')).filter((svg) => {
    const rect = svg.getBoundingClientRect();
    return rect.width > 40 && rect.height > 40;
  }).map((svg, index) => {
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const panel = svg.closest('.panel');
    const title = panel?.querySelector('.panel-title, h2, h3')?.textContent?.trim() || `Gráfica ${index + 1}`;
    return { title, svg: clone.outerHTML };
  });
}

function tableToHtml(table?: ExportTable): string {
  if (!table?.rows?.length) return '<p class="empty">Sin datos tabulares visibles.</p>';
  const headers = table.headers?.length ? table.headers : Object.keys(table.rows[0] || {});
  return `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${table.rows.map((row) => `<tr>${headers.map((h) => `<td>${escapeHtml(row[h] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}


function extractPdfCards(html = ''): ExportCard[] {
  if (typeof document === 'undefined' || !html) return [];
  const template = document.createElement('template');
  template.innerHTML = html;
  const selectors = [
    '.kpi-card',
    '.summary-item',
    '.water-balance-hero-grid article',
    '.water-balance-summary-stack article',
    '.water-type-card',
    '.tanque-card',
    '.concession-projection-stack article',
    '.concession-contract-list article',
    '.uv-context-list article',
    '.priority-item',
  ];
  const nodes = Array.from(template.content.querySelectorAll(selectors.join(',')));
  const seen = new Set<string>();
  return nodes.map((node) => {
    const label = node.querySelector('.kpi-label, .summary-label, span, .water-type-head span, .tanque-card-head span')?.textContent?.replace(/\s+/g, ' ').trim();
    const value = node.querySelector('.kpi-value, .summary-value, strong, .water-type-foot strong, .tanque-level-copy strong')?.textContent?.replace(/\s+/g, ' ').trim();
    const unit = node.querySelector('.kpi-unit, .summary-unit, small')?.textContent?.replace(/\s+/g, ' ').trim();
    const note = node.querySelector('.kpi-trend, .summary-trend, p, .water-type-foot p')?.textContent?.replace(/\s+/g, ' ').trim();
    const fallbackText = node.textContent?.replace(/\s+/g, ' ').trim();
    const normalized = [label, value, unit, note, fallbackText].filter(Boolean).join('|');
    if (!normalized || seen.has(normalized)) return null;
    seen.add(normalized);
    return {
      label: label || 'Indicador',
      value: value || fallbackText || '—',
      unit: unit || '',
      note: note || '',
    };
  }).filter((card): card is ExportCard => Boolean(card)).slice(0, 12);
}

function buildPdfHtml(report: DomReport): string {
  const cards = extractPdfCards(report.cloneHtml);
  const primaryCards = cards.slice(0, 8);
  const secondaryCards = cards.slice(8);
  const charts = report.charts || [];
  const tables = report.tables || [];
  const pageTitle = escapeHtml(report.title);
  const generated = escapeHtml(report.generated);
  const range = escapeHtml(report.range);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${pageTitle}</title>
  <style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #ffffff; color: #172033; font-family: Inter, Arial, sans-serif; font-size: 10.5px; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .pdf-report { width: 100%; }
    .pdf-header { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: start; padding-bottom: 9px; margin-bottom: 10px; border-bottom: 3px solid #0ea5e9; }
    .pdf-eyebrow { margin: 0 0 4px; color: #0369a1; font-size: 8.5px; font-weight: 900; letter-spacing: .16em; text-transform: uppercase; }
    .pdf-header h1 { margin: 0; font-size: 20px; line-height: 1.05; color: #0f172a; letter-spacing: -.03em; }
    .pdf-meta { text-align: right; color: #475569; font-size: 8.5px; line-height: 1.45; }
    .pdf-meta strong { display: block; color: #0f172a; font-size: 9px; }
    .pdf-section { margin: 10px 0 0; break-inside: avoid; page-break-inside: avoid; }
    .pdf-section.allow-break { break-inside: auto; page-break-inside: auto; }
    .pdf-section h2 { margin: 0 0 7px; color: #0f172a; font-size: 12.5px; line-height: 1.15; }
    .pdf-card-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; }
    .pdf-card { min-height: 52px; padding: 8px 9px; border: 1px solid #d7e6f2; border-left: 3px solid #0ea5e9; border-radius: 7px; background: #f8fbff; break-inside: avoid; page-break-inside: avoid; }
    .pdf-card-label { color: #0369a1; font-size: 7.5px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
    .pdf-card-value { margin-top: 4px; color: #111827; font-size: 14px; font-weight: 900; line-height: 1.05; }
    .pdf-card-unit { color: #475569; font-size: 8px; font-weight: 700; margin-left: 2px; }
    .pdf-card-note { margin-top: 4px; color: #64748b; font-size: 7.8px; line-height: 1.25; }
    .pdf-chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; align-items: start; }
    .pdf-chart { padding: 8px; border: 1px solid #d7e6f2; border-radius: 8px; background: #ffffff; break-inside: avoid; page-break-inside: avoid; overflow: hidden; }
    .pdf-chart.full { grid-column: 1 / -1; }
    .pdf-chart h3 { margin: 0 0 5px; color: #111827; font-size: 11px; line-height: 1.15; }
    .pdf-chart svg { width: 100% !important; height: auto !important; max-height: 235px !important; display: block; overflow: visible; }
    .pdf-chart.full svg { max-height: 270px !important; }
    .pdf-table-block { margin-top: 8px; break-inside: avoid; page-break-inside: avoid; }
    .pdf-table-block h3 { margin: 0 0 5px; color: #111827; font-size: 11px; }
    .pdf-table-wrap { border: 1px solid #d7e6f2; border-radius: 8px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 5px 6px; border-bottom: 1px solid #e5edf5; text-align: left; vertical-align: top; font-size: 8.3px; line-height: 1.25; }
    th { color: #075985; background: #eaf7ff; font-size: 7.5px; text-transform: uppercase; letter-spacing: .08em; }
    tr:last-child td { border-bottom: 0; }
    .pdf-note { margin: 8px 0 0; padding: 7px 9px; border-radius: 7px; background: #f1f5f9; color: #475569; font-size: 8.5px; line-height: 1.35; }
    .pdf-footer { margin-top: 10px; padding-top: 6px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 7.5px; display: flex; justify-content: space-between; gap: 10px; }
    @media print {
      .pdf-section, .pdf-card, .pdf-chart, .pdf-table-block { break-inside: avoid; page-break-inside: avoid; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
    }
  </style>
</head>
<body>
  <main class="pdf-report">
    <header class="pdf-header">
      <div>
        <p class="pdf-eyebrow">Reporte de control hídrico</p>
        <h1>${pageTitle}</h1>
      </div>
      <div class="pdf-meta"><strong>Generado</strong>${generated}<br/><strong>Rango</strong>${range}</div>
    </header>

    ${primaryCards.length ? `<section class="pdf-section"><h2>Resumen ejecutivo</h2><div class="pdf-card-grid">${primaryCards.map((card) => `<article class="pdf-card"><div class="pdf-card-label">${escapeHtml(card.label)}</div><div class="pdf-card-value">${escapeHtml(card.value)}${card.unit ? `<span class="pdf-card-unit">${escapeHtml(card.unit)}</span>` : ''}</div>${card.note ? `<div class="pdf-card-note">${escapeHtml(card.note)}</div>` : ''}</article>`).join('')}</div></section>` : ''}

    ${charts.length ? `<section class="pdf-section allow-break"><h2>Gráficas principales</h2><div class="pdf-chart-grid">${charts.map((chart, index) => `<article class="pdf-chart ${index === 0 ? 'full' : ''}"><h3>${escapeHtml(chart.title)}</h3>${chart.svg}</article>`).join('')}</div></section>` : ''}

    ${tables.length ? `<section class="pdf-section allow-break"><h2>Tablas operativas</h2>${tables.map((table) => `<article class="pdf-table-block"><h3>${escapeHtml(table.title)}</h3><div class="pdf-table-wrap">${tableToHtml(table)}</div></article>`).join('')}</section>` : ''}

    ${secondaryCards.length ? `<section class="pdf-section"><h2>Información complementaria</h2><div class="pdf-card-grid">${secondaryCards.map((card) => `<article class="pdf-card"><div class="pdf-card-label">${escapeHtml(card.label)}</div><div class="pdf-card-value">${escapeHtml(card.value)}${card.unit ? `<span class="pdf-card-unit">${escapeHtml(card.unit)}</span>` : ''}</div>${card.note ? `<div class="pdf-card-note">${escapeHtml(card.note)}</div>` : ''}</article>`).join('')}</div></section>` : ''}

    ${!primaryCards.length && !charts.length && !tables.length ? '<p class="pdf-note">No se encontraron datos visibles suficientes para construir el reporte impreso.</p>' : ''}

    <footer class="pdf-footer"><span>Sistema ARCA · Dashboard hídrico</span><span>${pageTitle}</span></footer>
  </main>
</body>
</html>`;
}


function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function absoluteUrl(src: string): string {
  try {
    return new URL(src, window.location.href).href;
  } catch (_) {
    return src;
  }
}

function sanitizeCssForCanvas(cssText = ''): string {
  // Los recursos externos dentro de un SVG/foreignObject pueden contaminar el canvas.
  // Para la exportación de imagen dejamos estilos inline, pero quitamos url(...) externos
  // que no sean data/blob. Los logos/imagenes del DOM se embeben aparte como data URI.
  return String(cssText).replace(/url\((['"]?)(?!data:|blob:)(.*?)\1\)/gi, 'none');
}

async function inlineImagesForCanvas(html: string): Promise<string> {
  if (typeof document === 'undefined') return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  const images = Array.from(template.content.querySelectorAll('img'));

  await Promise.all(images.map(async (img) => {
    const rawSrc = img.getAttribute('src');
    if (!rawSrc || rawSrc.startsWith('data:') || rawSrc.startsWith('blob:')) return;

    const src = absoluteUrl(rawSrc);
    try {
      const response = await fetch(src, { credentials: 'same-origin', cache: 'force-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      img.setAttribute('src', dataUrl);
    } catch (error) {
      console.warn('[waterExportService] Imagen omitida en exportación PNG para evitar canvas tainted:', src, error);
      const alt = img.getAttribute('alt') || 'Imagen no disponible en exportación';
      const placeholder = document.createElement('span');
      placeholder.className = img.getAttribute('class') || 'export-image-placeholder';
      placeholder.textContent = alt;
      placeholder.setAttribute('style', 'display:inline-flex;align-items:center;justify-content:center;min-width:120px;min-height:42px;border:1px solid rgba(125,211,252,.28);border-radius:12px;color:#b9e7ff;background:rgba(7,27,45,.72);font:12px Inter,Arial,sans-serif;padding:8px 10px;');
      img.replaceWith(placeholder);
    }
  }));

  return template.innerHTML;
}

function buildDomReport(section: string, context: ExportContext = {}): DomReport {
  const root = getExportRoot();
  const generated = new Date().toLocaleString('es-MX');
  const title = context.title || document.querySelector('h1, .page-title, .panel-title')?.textContent?.trim() || 'Reporte ARCA';
  const clone = root ? normalizeClone(root) : document.createElement('div');
  const tables = getVisibleTables();
  const charts = getVisibleCharts();
  const css = getCssText();
  const range = context.dateRange?.startDate || context.dateRange?.endDate
    ? `${context.dateRange.startDate || 'inicio'} → ${context.dateRange.endDate || 'último'}`
    : 'Último registro disponible';
  return { title, section, generated, range, cloneHtml: clone.outerHTML, tables, charts, css };
}

function buildHtml(report: DomReport): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(report.title)}</title>
  <style>
    ${report.css}
    body{margin:0;background:#06111f;color:#eef8ff;font-family:Inter,Arial,sans-serif;}
    .export-shell{padding:24px;max-width:1800px;margin:0 auto;}
    .export-hero{border:1px solid rgba(125,211,252,.20);border-radius:20px;background:#071b2d;padding:18px 22px;margin-bottom:18px;}
    .export-hero h1{margin:0 0 6px;font-size:28px}.export-hero p{margin:0;color:#b9e7ff}.export-section-title{margin:24px 0 12px;color:#eafaff;font-size:20px}
    .export-dom [data-export-root]{display:block}.export-dom{overflow:visible}.export-dom .page-grid{gap:16px}.export-dom .panel{break-inside:avoid;}
    .export-chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px;margin-top:12px}.export-chart{background:#071b2d;border:1px solid rgba(125,211,252,.18);border-radius:16px;padding:14px;overflow:auto}.export-chart svg{max-width:100%;height:auto;display:block;background:#071b2d;border-radius:12px}
    .export-table{background:#071b2d;border:1px solid rgba(125,211,252,.18);border-radius:16px;padding:14px;margin:14px 0;overflow:auto}.export-table table{width:100%;border-collapse:collapse}.export-table th,.export-table td{padding:10px;border-bottom:1px solid rgba(125,211,252,.18);text-align:left}.export-table th{color:#7dd3fc;text-transform:uppercase;font-size:11px;letter-spacing:.08em}.export-table td{color:#eef8ff;font-size:12px}.empty{color:#b9e7ff}
    @media print{body{background:white;color:#111}.export-shell{padding:0}.export-hero,.export-chart,.export-table{break-inside:avoid;box-shadow:none}.sidebar,.main-header,.date-range-panel button{display:none!important}}
  </style>
</head>
<body>
  <main class="export-shell">
    <section class="export-hero"><h1>${escapeHtml(report.title)}</h1><p>Generado: ${escapeHtml(report.generated)} · Rango: ${escapeHtml(report.range)}</p></section>
    <section class="export-dom">${report.cloneHtml}</section>
    <h2 class="export-section-title">Gráficas visibles</h2>
    <section class="export-chart-grid">${report.charts.length ? report.charts.map((chart) => `<article class="export-chart"><h3>${escapeHtml(chart.title)}</h3>${chart.svg}</article>`).join('') : '<p class="empty">No se detectaron gráficas visibles en esta vista.</p>'}</section>
    <h2 class="export-section-title">Tablas visibles</h2>
    ${report.tables.length ? report.tables.map((table) => `<section class="export-table"><h3>${escapeHtml(table.title)}</h3>${tableToHtml(table)}</section>`).join('') : '<p class="empty">No se detectaron tablas visibles en esta vista.</p>'}
  </main>
</body>
</html>`;
}

function exportHtml(report: DomReport): void {
  downloadBlob(buildHtml(report), `${slugify(report.title)}.html`, 'text/html;charset=utf-8');
}

function exportExcel(report: DomReport): void {
  const chartsHtml = report.charts.map((chart) => `<h2>${escapeHtml(chart.title)}</h2>${chart.svg}`).join('');
  const tablesHtml = report.tables.map((table) => `<h2>${escapeHtml(table.title)}</h2>${tableToHtml(table)}`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse}th,td{border:1px solid #8db5c8;padding:6px}th{background:#dff3ff}svg{max-width:900px;height:auto}</style></head><body><h1>${escapeHtml(report.title)}</h1><p>Generado: ${escapeHtml(report.generated)} · Rango: ${escapeHtml(report.range)}</p><h2>Gráficas</h2>${chartsHtml || 'Sin gráficas visibles'}<h2>Tablas</h2>${tablesHtml || 'Sin tablas visibles'}</body></html>`;
  downloadBlob(html, `${slugify(report.title)}.xls`, 'application/vnd.ms-excel;charset=utf-8');
}

function exportPdf(report: DomReport): void {
  const html = buildPdfHtml(report);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  let printStarted = false;
  let cleanedUp = false;

  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.src = url;
  document.body.appendChild(iframe);

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    setTimeout(() => {
      URL.revokeObjectURL(url);
      iframe.remove();
    }, 1200);
  };

  iframe.onload = () => {
    if (printStarted) return;
    printStarted = true;

    const printWindow = iframe.contentWindow;
    if (!printWindow) {
      cleanup();
      return;
    }

    const handleAfterPrint = () => {
      printWindow.removeEventListener('afterprint', handleAfterPrint);
      cleanup();
    };

    printWindow.addEventListener('afterprint', handleAfterPrint);

    setTimeout(() => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch (error) {
        printWindow.removeEventListener('afterprint', handleAfterPrint);
        cleanup();
        console.error('No se pudo abrir la impresión PDF:', error);
      }
    }, 250);
  };
}

async function exportImage(report: DomReport): Promise<void> {
  const width = Math.max(1400, Math.min(window.innerWidth || 1400, 2200));
  const height = Math.max(900, Math.min((getExportRoot()?.scrollHeight || 1200) + 340, 5200));
  const safeCss = sanitizeCssForCanvas(report.css);
  const safeCloneHtml = await inlineImagesForCanvas(report.cloneHtml);
  const chartsMarkup = report.charts.length
    ? report.charts.map((chart) => `<article class="export-chart"><h3>${escapeHtml(chart.title)}</h3>${chart.svg}</article>`).join('')
    : '<p class="empty">No se detectaron gráficas visibles.</p>';
  const tablesMarkup = report.tables.length
    ? report.tables.map((table) => `<section class="export-table"><h3>${escapeHtml(table.title)}</h3>${tableToHtml(table)}</section>`).join('')
    : '<p class="empty">No se detectaron tablas visibles.</p>';
  const markup = `
    <div xmlns="http://www.w3.org/1999/xhtml" class="export-shell-image">
      <style><![CDATA[
        ${safeCss}
        body{margin:0}.export-shell-image{box-sizing:border-box;width:${width}px;min-height:${height}px;padding:24px;background:#06111f;color:#eef8ff;font-family:Inter,Arial,sans-serif;}
        .export-hero{border:1px solid rgba(125,211,252,.20);border-radius:20px;background:#071b2d;padding:18px 22px;margin-bottom:18px}.export-hero h1{margin:0 0 6px;font-size:28px}.export-hero p{margin:0;color:#b9e7ff}
        .export-chart-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:12px}.export-chart,.export-table{background:#071b2d;border:1px solid rgba(125,211,252,.18);border-radius:16px;padding:14px;margin:14px 0;overflow:hidden}.export-chart svg{max-width:100%;height:auto;display:block}.export-table table{width:100%;border-collapse:collapse}.export-table th,.export-table td{padding:8px;border-bottom:1px solid rgba(125,211,252,.18);text-align:left;font-size:12px}.export-table th{color:#7dd3fc}.export-section-title{margin:24px 0 12px;color:#eafaff;font-size:20px}
      ]]></style>
      <section class="export-hero"><h1>${escapeHtml(report.title)}</h1><p>Generado: ${escapeHtml(report.generated)} · Rango: ${escapeHtml(report.range)}</p></section>
      <section>${safeCloneHtml}</section>
      <h2 class="export-section-title">Gráficas visibles</h2><section class="export-chart-grid">${chartsMarkup}</section>
      <h2 class="export-section-title">Tablas visibles</h2>${tablesMarkup}
    </div>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    try {
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((png) => {
        if (png) {
          downloadBlob(png, `${slugify(report.title)}.png`, 'image/png');
        } else {
          downloadBlob(svg, `${slugify(report.title)}.svg`, 'image/svg+xml;charset=utf-8');
        }
      }, 'image/png');
    } catch (error) {
      URL.revokeObjectURL(url);
      console.warn('[waterExportService] No se pudo generar PNG; se descarga SVG seguro.', error);
      downloadBlob(svg, `${slugify(report.title)}.svg`, 'image/svg+xml;charset=utf-8');
    }
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    downloadBlob(svg, `${slugify(report.title)}.svg`, 'image/svg+xml;charset=utf-8');
  };
  img.src = url;
}

export const downloadWaterReport = async (section: string, format: string, context: ExportContext = {}): Promise<void> => {
  const report = buildDomReport(section, context);
  if (format === 'excel') return exportExcel(report);
  if (format === 'html') return exportHtml(report);
  if (format === 'pdf') return exportPdf(report);
  if (format === 'png' || format === 'jpg') return exportImage(report);
  return exportHtml(report);
};
