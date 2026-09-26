import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, LoaderCircle } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ChartEmptyState from './ChartEmptyState';
import ChartTooltip from './ChartTooltip';
import PanelHeader from './PanelHeader';
import SqlChartDateControls from './SqlChartDateControls';
import useSqlChartDashboard from '../hooks/useSqlChartDashboard';
import useWaterModuleHistory from '../hooks/useWaterModuleHistory';
import { asRecord, asRows, chartLabel, numberOrNull } from '../insurgentesUtils';
import type { FlexibleRecord, WaterModuleHistorySeries } from '../types';
import { downloadFiveMinuteModuleHistoryExcel, validateFiveMinuteExportRange, type FiveMinuteExportModule } from '../../../services/waterFiveMinuteExportService';
import { downloadWaterModuleHistoryPdf, type ModuleHistoryExportMetric, type ModuleHistoryExportModule } from '../../../services/waterModuleHistoryExportService';

type ModuleKey = 'pozos' | 'lineas' | 'flujos' | 'niveles' | 'uv';
type MetricKey = 'flow' | 'totalizer' | 'both' | 'level' | 'uv_horometer' | 'uv_flow';
type TotalizerDisplay = 'delta' | 'absolute';

interface SeriesConfig {
  key: string;
  name: string;
  color: string;
  yAxisId?: 'left' | 'right';
  strokeDasharray?: string;
}

const axisColor = '#b9e7ff';
const gridColor = 'rgba(56,189,248,0.14)';
const colors = ['#38bdf8', '#fbbf24', '#34d399', '#c084fc', '#fb7185', '#f97316', '#60a5fa', '#22d3ee', '#a3e635', '#e879f9'];

const MODULES: Record<ModuleKey, {
  title: string;
  subtitle: string;
  elementsField: string;
  historyField: string;
  empty: string;
  metrics: MetricKey[];
}> = {
  pozos: {
    title: 'Pozos',
    subtitle: 'Flujo y totalizador de los pozos operativos confirmados.',
    elementsField: 'wells',
    historyField: 'well_flow_history',
    empty: 'Sin histórico de pozos para el periodo seleccionado.',
    metrics: ['flow', 'totalizer', 'both'],
  },
  lineas: {
    title: 'Líneas',
    subtitle: 'Flujo y totalizador de líneas operativas confirmadas.',
    elementsField: 'production_lines',
    historyField: 'production_line_history',
    empty: 'Sin histórico de líneas para el periodo seleccionado.',
    metrics: ['flow', 'totalizer', 'both'],
  },
  flujos: {
    title: 'Flujos',
    subtitle: 'Flujo y totalizador de los flujos configurados.',
    elementsField: 'flows',
    historyField: 'flow_history',
    empty: 'Sin histórico de flujos para el periodo seleccionado.',
    metrics: ['flow', 'totalizer', 'both'],
  },
  niveles: {
    title: 'Niveles',
    subtitle: 'Altura de niveles/cisternas en metros.',
    elementsField: 'tank_inputs',
    historyField: 'tank_level_history',
    empty: 'Sin histórico de niveles para el periodo seleccionado.',
    metrics: ['level'],
  },
  uv: {
    title: 'Lámparas UV',
    subtitle: 'Horómetros por lámpara y flujo compartido del sistema UV.',
    elementsField: 'uv_lamps',
    historyField: 'uv_history',
    empty: 'Sin histórico UV para el periodo seleccionado.',
    metrics: ['uv_horometer', 'uv_flow'],
  },
};

function idOf(item: FlexibleRecord): string {
  return String(item.id || item.sensor_id || item.column || item.state_field || item.name || '');
}

function nameOf(item: FlexibleRecord): string {
  return String(item.name || item.nombre || item.id || 'Elemento');
}

function seriesKey(prefix: string, id: string): string {
  return `${prefix}_${id.replace(/[^a-zA-Z0-9_]+/g, '_')}`;
}

function getMetricLabel(metric: MetricKey): string {
  if (metric === 'flow') return 'Flujo';
  if (metric === 'totalizer') return 'Totalizador';
  if (metric === 'both') return 'Ambos';
  if (metric === 'level') return 'Nivel';
  if (metric === 'uv_horometer') return 'Horómetros';
  return 'Flujo UV';
}


function escapeExcelHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function slugifyExcel(value: unknown): string {
  return String(value || 'historico')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'historico';
}

function downloadVisibleHistoryExcel(
  moduleTitle: string,
  metric: MetricKey,
  startDate: string,
  endDate: string,
  aggregationLabel: string,
  chartRows: FlexibleRecord[],
  series: SeriesConfig[],
) {
  if (!chartRows.length || !series.length) return;
  const headers = ['Intervalo', ...series.map((item) => item.name)];
  const rows = chartRows.map((row) => [
    row.label || row.bucket || row.timestamp || '',
    ...series.map((item) => row[item.key] ?? ''),
  ]);
  const table = `
    <table border="1">
      <tr>${headers.map((header) => `<th>${escapeExcelHtml(header)}</th>`).join('')}</tr>
      ${rows.map((row) => `<tr>${row.map((value) => `<td>${escapeExcelHtml(value)}</td>`).join('')}</tr>`).join('')}
    </table>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <h2>ARCA Las Fuentes — Histórico operativo por módulo</h2>
    <p><strong>Módulo:</strong> ${escapeExcelHtml(moduleTitle)}</p>
    <p><strong>Métrica:</strong> ${escapeExcelHtml(getMetricLabel(metric))}</p>
    <p><strong>Rango:</strong> ${escapeExcelHtml(startDate)} a ${escapeExcelHtml(endDate)}</p>
    <p><strong>Agrupación:</strong> ${escapeExcelHtml(aggregationLabel)}</p>
    ${table}
  </body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ARCA_Las_Fuentes_${slugifyExcel(moduleTitle)}_${slugifyExcel(getMetricLabel(metric))}_${startDate}_${endDate}.xls`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function aggregationLabelFromRows(rows: FlexibleRecord[]): string {
  const raw = String(rows.find((row) => row.aggregation)?.aggregation || '').toLowerCase();
  if (raw === 'quarter_hour') return '15 minutos';
  if (raw === 'daily') return 'Día';
  if (raw === 'minute') return 'Minuto';
  return 'Hora';
}

function fiveMinuteModule(moduleKey: ModuleKey): FiveMinuteExportModule | null {
  if (moduleKey === 'pozos') return 'well';
  if (moduleKey === 'lineas') return 'line';
  if (moduleKey === 'flujos') return 'flow';
  return null;
}

function commonHistoryModule(moduleKey: ModuleKey): FiveMinuteExportModule | null {
  return fiveMinuteModule(moduleKey);
}

function commonHistoryElements(series: WaterModuleHistorySeries[]): FlexibleRecord[] {
  return series.map((item) => ({
    id: item.operational_key || (item.sensor_id === null ? item.name : String(item.sensor_id)),
    sensor_id: item.sensor_id,
    name: item.name,
    source_status: item.source_status,
    flow_unit: item.flow_unit,
    unit_status: item.unit_status,
  }));
}

function commonHistoryRows(series: WaterModuleHistorySeries[]): FlexibleRecord[] {
  return series.flatMap((item) => item.points.map((point) => ({
    id: item.operational_key || (item.sensor_id === null ? item.name : String(item.sensor_id)),
    sensor_id: item.sensor_id,
    name: item.name,
    bucket: point.bucket_start,
    timestamp: point.bucket_start,
    aggregation: point.aggregation,
    flow_lps: point.flow_avg_lps,
    totalizador_m3: point.effective_totalizer_close_m3 ?? point.totalizer_close_m3,
    volume_m3: point.volume_m3,
    volume_reliable: point.volume_reliable,
    quality_status: point.quality_status,
    quality_label: point.quality_label,
    samples: point.samples,
  })));
}

function buildLineFlowChart(
  rows: FlexibleRecord[],
  elements: FlexibleRecord[],
  selectedIds: Set<string>,
  metric: MetricKey,
  totalizerDisplay: TotalizerDisplay,
) {
  const elementMap = new Map(elements.map((element) => [idOf(element), nameOf(element)]));
  const points = new Map<string, FlexibleRecord>();
  const series: SeriesConfig[] = [];
  const totalizerBases = new Map<string, number>();

  if (metric === 'totalizer' || metric === 'both') {
    [...rows]
      .sort((left, right) => String(left.bucket || left.timestamp || '').localeCompare(String(right.bucket || right.timestamp || '')))
      .forEach((row) => {
        const id = idOf(row);
        if (!selectedIds.has(id) || totalizerBases.has(id)) return;
        const value = numberOrNull(row.totalizador_m3);
        if (value !== null) totalizerBases.set(id, value);
      });
  }

  elements.forEach((element, index) => {
    const id = idOf(element);
    if (!selectedIds.has(id)) return;
    const name = nameOf(element);
    if (metric === 'flow' || metric === 'both') {
      series.push({ key: seriesKey('flow', id), name: `${name} · Flujo`, color: colors[index % colors.length], yAxisId: 'left' });
    }
    if (metric === 'totalizer' || metric === 'both') {
      const deltaMode = totalizerDisplay === 'delta';
      series.push({
        key: seriesKey(deltaMode ? 'total_delta' : 'total', id),
        name: `${name} · ${deltaMode ? 'Variación totalizador' : 'Totalizador'}`,
        color: colors[index % colors.length],
        yAxisId: metric === 'both' ? 'right' : 'left',
        strokeDasharray: metric === 'both' ? '7 5' : undefined,
      });
    }
  });

  rows.forEach((row) => {
    const id = idOf(row);
    if (!selectedIds.has(id)) return;
    const bucket = String(row.bucket || row.timestamp || '');
    if (!bucket || !elementMap.has(id)) return;
    const point = points.get(bucket) || { bucket, label: chartLabel(bucket) };
    if (metric === 'flow' || metric === 'both') {
      point[seriesKey('flow', id)] = numberOrNull(row.flow_lps);
    }
    if (metric === 'totalizer' || metric === 'both') {
      const observed = numberOrNull(row.totalizador_m3);
      const base = totalizerBases.get(id);
      if (totalizerDisplay === 'delta') {
        point[seriesKey('total_delta', id)] = observed !== null && base !== undefined ? observed - base : null;
      } else {
        point[seriesKey('total', id)] = observed;
      }
    }
    points.set(bucket, point);
  });
  return { chartRows: Array.from(points.values()).sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))), series };
}

function buildLevelChart(rows: FlexibleRecord[], elements: FlexibleRecord[], selectedIds: Set<string>) {
  const points = new Map<string, FlexibleRecord>();
  const series: SeriesConfig[] = elements
    .filter((element) => selectedIds.has(idOf(element)))
    .map((element, index) => ({ key: seriesKey('level', idOf(element)), name: `${nameOf(element)} · Nivel`, color: colors[index % colors.length], yAxisId: 'left' as const }));
  rows.forEach((row) => {
    const id = idOf(row);
    if (!selectedIds.has(id)) return;
    const bucket = String(row.bucket || row.timestamp || '');
    if (!bucket) return;
    const point = points.get(bucket) || { bucket, label: chartLabel(bucket) };
    point[seriesKey('level', id)] = numberOrNull(row.level_m);
    points.set(bucket, point);
  });
  return { chartRows: Array.from(points.values()).sort((a, b) => String(a.bucket).localeCompare(String(b.bucket))), series };
}

function uvLampIndex(item: FlexibleRecord): 1 | 2 {
  const raw = String(item.agel_field || item.state_field || item.id || '').toLowerCase();
  return raw.includes('2') ? 2 : 1;
}

function buildUvChart(
  rows: FlexibleRecord[],
  elements: FlexibleRecord[],
  selectedIds: Set<string>,
  metric: MetricKey,
) {
  const selectedElements = elements.filter((element) => selectedIds.has(idOf(element)));
  const chartRows: FlexibleRecord[] = rows
    .map((row): FlexibleRecord => ({ ...row, label: chartLabel(row.bucket || row.timestamp) }))
    .sort((a, b) => String(a.bucket || a.timestamp).localeCompare(String(b.bucket || b.timestamp)));

  if (metric === 'uv_flow') {
    return {
      chartRows,
      series: selectedElements.length
        ? [{ key: 'flow', name: 'Flujo del sistema UV · Compartido', color: colors[0], yAxisId: 'left' as const }]
        : [],
    };
  }

  const series: SeriesConfig[] = selectedElements.map((element, index) => {
    const lampIndex = uvLampIndex(element);
    return {
      key: `lamp_${lampIndex}_age`,
      name: `${nameOf(element)} · Horómetro`,
      color: colors[index % colors.length],
      yAxisId: 'left' as const,
      strokeDasharray: lampIndex === 2 ? '8 5' : undefined,
    };
  });
  return { chartRows, series };
}

function chartDomain(rows: FlexibleRecord[], series: SeriesConfig[]): [number, number] | undefined {
  const values = rows.flatMap((row) => series.map((item) => numberOrNull(row[item.key])).filter((value): value is number => value !== null));
  if (!values.length) return undefined;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const pad = Math.max(span * 0.12, 1);
  return [Math.max(0, Math.floor((min - pad) * 10) / 10), Math.ceil((max + pad) * 10) / 10];
}

function pdfModuleFor(moduleKey: ModuleKey): ModuleHistoryExportModule {
  if (moduleKey === 'pozos') return 'well';
  if (moduleKey === 'lineas') return 'line';
  if (moduleKey === 'flujos') return 'flow';
  if (moduleKey === 'niveles') return 'level';
  return 'uv';
}

function pdfMetricFor(metric: MetricKey): ModuleHistoryExportMetric {
  return metric as ModuleHistoryExportMetric;
}

interface OperationalModuleHistoryPanelProps {
  initialModule?: ModuleKey;
  lockedModule?: ModuleKey;
  allowedElementIds?: string[];
  titleOverride?: string;
}

function OperationalModuleHistoryPanel({
  initialModule = 'pozos',
  lockedModule,
  allowedElementIds,
  titleOverride,
}: OperationalModuleHistoryPanelProps) {
  const [moduleKey, setModuleKey] = useState<ModuleKey>(lockedModule || initialModule);
  const [metric, setMetric] = useState<MetricKey>('flow');
  const [totalizerDisplay, setTotalizerDisplay] = useState<TotalizerDisplay>('delta');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [fiveMinuteLoading, setFiveMinuteLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState(false);
  const moduleConfig = MODULES[moduleKey];
  const hydraulicModule = commonHistoryModule(moduleKey);
  const commonController = useWaterModuleHistory({
    module: hydraulicModule || 'well',
    enabled: Boolean(hydraulicModule),
  });
  const legacyController = useSqlChartDashboard(moduleKey, undefined, {
    includeHistory: !hydraulicModule,
    includePeriodDeltas: false,
    enabled: !hydraulicModule,
  });
  const controller = hydraulicModule ? commonController : legacyController;
  const dashboard = asRecord(legacyController.dashboard);
  const commonSeries = hydraulicModule ? (commonController.data?.series || []) : [];
  const rawElements = hydraulicModule
    ? commonHistoryElements(commonSeries)
    : asRows(dashboard[moduleConfig.elementsField]);
  const rawHistory = hydraulicModule
    ? commonHistoryRows(commonSeries)
    : asRows(dashboard[moduleConfig.historyField]);
  const allowedSet = useMemo(
    () => allowedElementIds ? new Set(allowedElementIds.map(String)) : null,
    [allowedElementIds?.join('|')],
  );
  const elements = useMemo(
    () => allowedSet ? rawElements.filter((element) => allowedSet.has(idOf(element))) : rawElements,
    [rawElements, allowedSet],
  );
  const history = useMemo(
    () => allowedSet ? rawHistory.filter((row) => allowedSet.has(idOf(row))) : rawHistory,
    [rawHistory, allowedSet],
  );
  const elementIdsKey = elements.map(idOf).join('|');

  useEffect(() => {
    if (lockedModule && moduleKey !== lockedModule) setModuleKey(lockedModule);
  }, [lockedModule, moduleKey]);

  useEffect(() => {
    const nextMetric = moduleConfig.metrics.includes(metric) ? metric : moduleConfig.metrics[0];
    if (nextMetric !== metric) setMetric(nextMetric);
  }, [moduleKey, moduleConfig.metrics, metric]);

  useEffect(() => {
    setSelectedIds(elements.map(idOf).filter(Boolean));
  }, [moduleKey, elementIdsKey]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const hasSelectedHistoryData = hydraulicModule
    ? commonSeries.some((series) => {
      const id = String(series.operational_key || (series.sensor_id === null ? series.name : series.sensor_id));
      return selectedSet.has(id) && series.has_data;
    })
    : true;
  const effectiveTotalizerDisplay: TotalizerDisplay = metric === 'both' ? 'delta' : totalizerDisplay;
  const chart = useMemo(() => {
    if (moduleKey === 'niveles') return buildLevelChart(history, elements, selectedSet);
    if (moduleKey === 'uv') return buildUvChart(history, elements, selectedSet, metric);
    return buildLineFlowChart(history, elements, selectedSet, metric, effectiveTotalizerDisplay);
  }, [moduleKey, history, elements, selectedSet, metric, effectiveTotalizerDisplay]);
  const uvHorometerDomain = useMemo(
    () => moduleKey === 'uv' && metric === 'uv_horometer' ? chartDomain(chart.chartRows, chart.series) : undefined,
    [moduleKey, metric, chart.chartRows, chart.series],
  );

  const selectedElements = useMemo(
    () => elements.filter((element) => selectedSet.has(idOf(element))),
    [elements, selectedSet],
  );
  const exportableSensorIds = useMemo(
    () => selectedElements
      .map((element) => Number(element.sensor_id))
      .filter((sensorId) => Number.isInteger(sensorId) && sensorId > 0),
    [selectedElements],
  );
  const omittedFiveMinuteNames = useMemo(
    () => selectedElements
      .filter((element) => !(Number.isInteger(Number(element.sensor_id)) && Number(element.sensor_id) > 0))
      .map(nameOf),
    [selectedElements],
  );
  const fiveMinuteModuleKey = fiveMinuteModule(moduleKey);

  const exportVisibleExcel = () => {
    setExportError(false);
    setExportMessage('');
    downloadVisibleHistoryExcel(
      moduleConfig.title,
      metric,
      String(controller.range.startDate || ''),
      String(controller.range.endDate || ''),
      aggregationLabelFromRows(history),
      chart.chartRows,
      chart.series,
    );
    setExportMessage('Excel de la vista actual generado.');
  };

  const exportVisiblePdf = async () => {
    const startDate = String(controller.range.startDate || '');
    const endDate = String(controller.range.endDate || '');
    if (!startDate || !endDate) return;
    setPdfLoading(true);
    setExportError(false);
    setExportMessage('');
    try {
      await downloadWaterModuleHistoryPdf({
        module: pdfModuleFor(moduleKey),
        startDate,
        endDate,
        aggregation: hydraulicModule
          ? String(commonController.aggregation || 'quarter_hour')
          : String(dashboard.aggregation || 'hourly'),
        metric: pdfMetricFor(metric),
        totalizerDisplay: effectiveTotalizerDisplay,
        selectedIds,
      });
      setExportMessage('PDF de la vista histórica generado.');
    } catch (error) {
      setExportError(true);
      setExportMessage(error instanceof Error ? error.message : 'No fue posible generar el PDF del histórico.');
    } finally {
      setPdfLoading(false);
    }
  };

  const exportFiveMinuteExcel = async () => {
    if (!fiveMinuteModuleKey) return;
    const startDate = String(controller.range.startDate || '');
    const endDate = String(controller.range.endDate || '');
    const validation = validateFiveMinuteExportRange(startDate, endDate);
    if (validation) {
      setExportError(true);
      setExportMessage(validation);
      return;
    }
    if (!exportableSensorIds.length) {
      setExportError(true);
      setExportMessage('Los elementos seleccionados no tienen sensor de minuto exportable.');
      return;
    }
    setFiveMinuteLoading(true);
    setExportError(false);
    setExportMessage('');
    try {
      await downloadFiveMinuteModuleHistoryExcel({
        module: fiveMinuteModuleKey,
        sensorIds: exportableSensorIds,
        startDate,
        endDate,
      });
      const omitted = omittedFiveMinuteNames.length
        ? ` No se incluyó: ${omittedFiveMinuteNames.join(', ')} (sin sensor en iot.readings_minute).`
        : '';
      setExportMessage(`Excel 5 min generado para ${exportableSensorIds.length} elemento(s).${omitted}`);
    } catch (error) {
      setExportError(true);
      setExportMessage(error instanceof Error ? error.message : 'No fue posible exportar el Excel de 5 minutos.');
    } finally {
      setFiveMinuteLoading(false);
    }
  };

  const toggleElement = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const selectAll = () => setSelectedIds(elements.map(idOf).filter(Boolean));
  const clearAll = () => setSelectedIds([]);
  const selectUvLamps = (mode: 'both' | 'uv1' | 'uv2') => {
    if (mode === 'both') {
      selectAll();
      return;
    }
    const targetIndex = mode === 'uv2' ? 2 : 1;
    const target = elements.find((element) => uvLampIndex(element) === targetIndex);
    setSelectedIds(target ? [idOf(target)] : []);
  };
  const uvSelectionMode = moduleKey === 'uv'
    ? (selectedIds.length > 1 ? 'both' : (elements.find((element) => selectedIds.includes(idOf(element)) && uvLampIndex(element) === 2) ? 'uv2' : 'uv1'))
    : 'both';
  const hasBothAxes = metric === 'both' && (moduleKey === 'pozos' || moduleKey === 'lineas' || moduleKey === 'flujos');
  const hasRenderableChart = Boolean(elements.length && selectedIds.length && hasSelectedHistoryData && chart.chartRows.length);
  const cleanLockedHydraulicModule = lockedModule === 'pozos' || lockedModule === 'lineas' || lockedModule === 'flujos';

  return (
    <section className="panel chart-panel fade-up insurgentes-history-module-panel">
      <PanelHeader
        title={titleOverride || (lockedModule ? `Histórico de ${moduleConfig.title.toLowerCase()}` : 'Histórico operativo por módulo')}
        subtitle={lockedModule && !cleanLockedHydraulicModule
          ? `${moduleConfig.subtitle} Cero conserva lectura válida; los huecos permanecen como ausencia de registro.`
          : undefined}
      />

      <div className="insurgentes-history-controls">
        {!lockedModule ? (
          <div className="insurgentes-history-control-group" aria-label="Módulo histórico">
            {(Object.keys(MODULES) as ModuleKey[]).map((key) => (
              <button
                key={key}
                type="button"
                className={key === moduleKey ? 'active' : ''}
                onClick={() => setModuleKey(key)}
              >
                {MODULES[key].title}
              </button>
            ))}
          </div>
        ) : cleanLockedHydraulicModule ? null : <span className="insurgentes-history-locked-module">{moduleConfig.title}</span>}
        <div className="insurgentes-history-metric-actions">
          {moduleConfig.metrics.length > 1 ? (
            <div className="insurgentes-history-control-group" aria-label="Métrica histórica">
              {moduleConfig.metrics.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={option === metric ? 'active' : ''}
                  onClick={() => setMetric(option)}
                >
                  {getMetricLabel(option)}
                </button>
              ))}
            </div>
          ) : (
            <span className="insurgentes-history-fixed-metric">{getMetricLabel(moduleConfig.metrics[0])}</span>
          )}
          <div className="insurgentes-history-export-actions">
            {(hydraulicModule || moduleKey === 'niveles' || moduleKey === 'uv') ? (
              <button
                type="button"
                className="module-history-pdf-button"
                onClick={() => void exportVisiblePdf()}
                disabled={pdfLoading || !selectedIds.length || !chart.chartRows.length}
                title="Exportar la vista histórica actual a PDF"
              >
                {pdfLoading ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}
                <span>{pdfLoading ? 'Generando...' : 'PDF'}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="five-minute-excel-button"
              onClick={exportVisibleExcel}
              disabled={!selectedIds.length || !chart.chartRows.length}
              title="Exportar exactamente los datos visibles, módulo, métrica, rango y selección actuales"
            >
              <FileSpreadsheet size={17} aria-hidden="true" />
              <span>Excel</span>
            </button>
            {fiveMinuteModuleKey ? (
              <button
                type="button"
                className="five-minute-excel-button"
                onClick={() => void exportFiveMinuteExcel()}
                disabled={fiveMinuteLoading || !exportableSensorIds.length}
                title="Exportar los elementos seleccionados en intervalos reales de 5 minutos (máximo 3 días)"
              >
                {fiveMinuteLoading ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : <FileSpreadsheet size={17} aria-hidden="true" />}
                <span>{fiveMinuteLoading ? 'Generando...' : 'Excel 5 min'}</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {exportMessage ? <div className={`insurgentes-history-export-message${exportError ? ' is-error' : ''}`}>{exportMessage}</div> : null}

      <SqlChartDateControls
        controller={controller}
        title="Fechas del histórico"
        subtitle={cleanLockedHydraulicModule ? undefined : moduleConfig.subtitle}
        showMeta={Boolean(lockedModule) && !cleanLockedHydraulicModule}
        showStatus={Boolean(lockedModule) && !cleanLockedHydraulicModule}
      />

      {moduleKey === 'uv' && metric === 'uv_flow' ? (
        <div className="insurgentes-history-totalizer-note">
          El flujo es una lectura compartida del sistema UV. Seleccionar UV 1, UV 2 o ambas no crea series distintas porque SCADA entrega un único Flow para la máquina.
        </div>
      ) : null}

      {metric === 'totalizer' ? (
        <div className="insurgentes-history-totalizer-control" aria-label="Modo de visualización del totalizador">
          <span>Totalizador</span>
          <div className="insurgentes-history-control-group" role="group">
            <button
              type="button"
              className={totalizerDisplay === 'delta' ? 'active' : ''}
              onClick={() => setTotalizerDisplay('delta')}
              title="Resta la primera lectura válida del rango a cada lectura observada."
            >
              Variación del periodo
            </button>
            <button
              type="button"
              className={totalizerDisplay === 'absolute' ? 'active' : ''}
              onClick={() => setTotalizerDisplay('absolute')}
              title="Muestra el valor absoluto observado del totalizador."
            >
              Valor absoluto
            </button>
          </div>
        </div>
      ) : null}

      {metric === 'both' ? (
        <div className="insurgentes-history-totalizer-note">
          En modo Ambos, el totalizador se muestra como variación del periodo para conservar una escala visual útil.
        </div>
      ) : null}

      {moduleKey === 'uv' ? (
        <div className="insurgentes-series-toolbar">
          <div>
            <span>Lámparas visibles</span>
            <strong>{metric === 'uv_flow' ? 'Flow compartido del sistema UV' : 'Selecciona ambas o una sola lámpara'}</strong>
          </div>
          <div className="insurgentes-history-control-group" role="group" aria-label="Seleccionar lámpara UV histórica">
            <button type="button" className={uvSelectionMode === 'both' ? 'active' : ''} onClick={() => selectUvLamps('both')}>Ambas</button>
            <button type="button" className={uvSelectionMode === 'uv1' ? 'active' : ''} onClick={() => selectUvLamps('uv1')}>UV 1</button>
            <button type="button" className={uvSelectionMode === 'uv2' ? 'active' : ''} onClick={() => selectUvLamps('uv2')}>UV 2</button>
          </div>
        </div>
      ) : (
        <>
          <div className="insurgentes-series-toolbar">
            <div>
              <span>Elementos visibles · {moduleConfig.title}</span>
              <strong>{selectedIds.length}/{elements.length} seleccionados</strong>
            </div>
            <div className="insurgentes-series-actions">
              <button type="button" onClick={selectAll}>Seleccionar todos</button>
              <button type="button" onClick={clearAll}>Deseleccionar todos</button>
            </div>
          </div>

          {elements.length ? (
            <div className="insurgentes-series-chips">
              {elements.map((element) => {
                const id = idOf(element);
                const checked = selectedIds.includes(id);
                return (
                  <button key={id} type="button" className={checked ? 'active' : ''} onClick={() => toggleElement(id)}>
                    {checked ? '✓ ' : ''}{nameOf(element)}
                  </button>
                );
              })}
            </div>
          ) : null}
        </>
      )}

      {controller.error ? (
        <div className="insurgentes-history-export-message is-error">
          {hasRenderableChart
            ? 'No se pudo actualizar el histórico en este momento. Se conserva la última información válida.'
            : 'No se pudo cargar el histórico del módulo seleccionado.'}
        </div>
      ) : null}
      {!elements.length ? <ChartEmptyState message={controller.loading ? 'Cargando elementos...' : 'Sin elementos configurados para este módulo.'} /> : null}
      {elements.length && !selectedIds.length ? <ChartEmptyState message="Selecciona al menos un elemento para visualizar el histórico." /> : null}
      {hasRenderableChart ? (
        <ResponsiveContainer width="100%" height={390}>
          <LineChart data={chart.chartRows} margin={{ top: 20, right: hasBothAxes ? 38 : 24, bottom: 48, left: 12 }}>
            <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke={axisColor} minTickGap={30} />
            <YAxis yAxisId="left" stroke={axisColor} domain={uvHorometerDomain} allowDataOverflow={false} />
            {hasBothAxes ? <YAxis yAxisId="right" orientation="right" stroke="#fbbf24" /> : null}
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ paddingTop: 12 }} />
            {chart.series.map((item) => (
              <Line
                key={item.key}
                type="monotone"
                dataKey={item.key}
                name={item.name}
                stroke={item.color}
                strokeWidth={item.strokeDasharray ? 2.2 : 2.5}
                strokeDasharray={item.strokeDasharray}
                dot={false}
                connectNulls={false}
                yAxisId={item.yAxisId || 'left'}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : null}
      {!hasRenderableChart && elements.length && selectedIds.length && (!hasSelectedHistoryData || !chart.chartRows.length) ? (
        <ChartEmptyState message={controller.loading ? 'Cargando histórico...' : (controller.error ? 'No se pudo cargar el histórico del módulo seleccionado.' : moduleConfig.empty)} />
      ) : null}
    </section>
  );
}

export default OperationalModuleHistoryPanel;
