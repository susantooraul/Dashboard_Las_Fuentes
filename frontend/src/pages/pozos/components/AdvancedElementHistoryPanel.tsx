import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, LoaderCircle } from 'lucide-react';
import ChartEmptyState from './ChartEmptyState';
import FiveMinuteExcelExportButton from './FiveMinuteExcelExportButton';
import PanelHeader from './PanelHeader';
import SqlChartDateControls from './SqlChartDateControls';
import WaterHistoryChart from './WaterHistoryChart';
import type { DetailVolumeDisplay } from './WaterHistoryChart';
import useWaterHistory from '../hooks/useWaterHistory';
import { formatNumber } from '../insurgentesUtils';
import { formatExplicitDateTimeRange, periodTitle } from '../dateUtils';
import { summarizeDetailHistory } from '../detailHistorySummary';
import { buildProgressiveVolume } from '../detailHistoryVolume';
import { downloadWaterModuleHistoryPdf } from '../../../services/waterModuleHistoryExportService';
import type { WaterHistoryPoint } from '../types';

interface AdvancedElementHistoryPanelProps {
  module: 'well' | 'line' | 'flow';
  sensorId: number;
  title: string;
  subtitle?: string;
  sourceLabel?: string; // compatibilidad con las secciones heredadas; no se muestra como ayuda redundante
  shortHistorySubtitle?: string;
  onPeriodSummaryChange?: (summary: DetailHistoryPeriodSummary) => void;
}

export interface DetailHistoryPeriodSummary {
  sensorId: number;
  loading: boolean;
  intervalLabel: string;
  flowAverageLps: number | null;
  volumeM3: number | null;
  partialGaps: boolean;
  error: string;
}

function dateTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function historyQuality(point: WaterHistoryPoint): string {
  const explicitLabel = String(point.quality_label || '').trim();
  if (explicitLabel) return explicitLabel;

  const quality = String(point.quality_status || '').toLowerCase();
  if (quality === 'validated') return 'Validado';
  if (quality === 'valid_zero') return 'Cero válido';
  if (quality === 'partial') return 'Validación parcial';
  if (quality === 'review') return 'En revisión';
  if (quality === 'no_data') return 'Sin datos';

  const status = String(point.data_status || point.status || '').toLowerCase();
  if (status === 'operational' || status === 'validated') return 'Validado';
  if (status === 'zero_consumption') return 'Cero válido';
  if (status === 'partial') return 'Validación parcial';
  if (status === 'totalizer_retained' || status === 'invalid_totalizer') return 'En revisión';
  if (status === 'no_data') return 'Sin datos';
  return status || 'Sin datos';
}

function totalizerClose(point: WaterHistoryPoint): number | null {
  const value = point.effective_totalizer_close_m3 ?? point.totalizer_close_m3;
  return value === null || value === undefined ? null : Number(value);
}


function escapeExcelHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function slugifyExport(value: unknown): string {
  return String(value || 'elemento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'elemento';
}

function exportModuleLabel(module: 'well' | 'line' | 'flow'): string {
  if (module === 'well') return 'Pozo';
  if (module === 'line') return 'Línea';
  return 'Flujo';
}

function downloadDetailHistoryExcel({
  module,
  title,
  sensorId,
  startDate,
  endDate,
  aggregation,
  points,
  volumeDisplay,
}: {
  module: 'well' | 'line' | 'flow';
  title: string;
  sensorId: number;
  startDate: string;
  endDate: string;
  aggregation: string;
  points: WaterHistoryPoint[];
  volumeDisplay: DetailVolumeDisplay;
}) {
  const progressive = buildProgressiveVolume(points);
  const volumeHeader = volumeDisplay === 'cumulative' ? 'Volumen acumulado progresivo (m³)' : 'Volumen del intervalo (m³)';
  const rows = progressive.map(({ point, intervalVolume, cumulativeVolume }) => [
    dateTimeLabel(String(point.bucket_start || '')),
    point.flow_avg_lps ?? '',
    volumeDisplay === 'cumulative' ? cumulativeVolume ?? '' : intervalVolume ?? '',
    totalizerClose(point) ?? '',
    historyQuality(point),
  ]);
  const headers = ['Intervalo', 'Flujo promedio (L/s)', volumeHeader, 'Totalizador al cierre (m³)', 'Calidad'];
  const table = `
    <table border="1">
      <tr>${headers.map((header) => `<th>${escapeExcelHtml(header)}</th>`).join('')}</tr>
      ${rows.map((row) => `<tr>${row.map((value) => `<td>${escapeExcelHtml(value)}</td>`).join('')}</tr>`).join('')}
    </table>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <h2>ARCA Las Fuentes — Histórico de detalle</h2>
    <p><strong>Elemento:</strong> ${escapeExcelHtml(title)}</p>
    <p><strong>Módulo:</strong> ${escapeExcelHtml(exportModuleLabel(module))}</p>
    <p><strong>Sensor:</strong> ${escapeExcelHtml(sensorId)}</p>
    <p><strong>Periodo:</strong> ${escapeExcelHtml(startDate)} a ${escapeExcelHtml(endDate)}</p>
    <p><strong>Agrupación:</strong> ${escapeExcelHtml(periodTitle(aggregation))}</p>
    <p><strong>Volumen:</strong> ${escapeExcelHtml(volumeDisplay === 'cumulative' ? 'Acumulado progresivo' : 'Por intervalo')}</p>
    ${table}
  </body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ARCA_Las_Fuentes_${slugifyExport(title)}_${startDate}_${endDate}_${aggregation}.xls`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export default function AdvancedElementHistoryPanel({
  module,
  sensorId,
  title,
  subtitle,
  shortHistorySubtitle,
  onPeriodSummaryChange,
}: AdvancedElementHistoryPanelProps) {
  const controller = useWaterHistory({ module, sensorId });
  const [volumeDisplay, setVolumeDisplay] = useState<DetailVolumeDisplay>('interval');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState(false);
  const points = controller.data?.points || [];
  const elementName = String(controller.data?.name || title);
  const historicalRows = points.filter((point) => Number(point.samples || 0) > 0).slice(-8).reverse();
  const hasData = points.some((point) => Number(point.samples || 0) > 0);
  const periodSummary = useMemo(() => summarizeDetailHistory(points), [points]);
  const lastSample = useMemo(() => {
    const timestamps = points
      .map((point) => String(point.last_sample_ts || '').trim())
      .filter(Boolean)
      .sort();
    return (timestamps.length ? timestamps[timestamps.length - 1] : undefined);
  }, [points]);
  const intervalLabel = formatExplicitDateTimeRange(controller.range, {
    aggregation: controller.aggregation,
    lastUpdate: lastSample,
  });


  const exportCurrentExcel = () => {
    const startDate = String(controller.range.startDate || '');
    const endDate = String(controller.range.endDate || '');
    if (!startDate || !endDate || !points.length) return;
    setExportError(false);
    setExportMessage('');
    downloadDetailHistoryExcel({
      module,
      title: elementName,
      sensorId,
      startDate,
      endDate,
      aggregation: controller.aggregation,
      points,
      volumeDisplay,
    });
    setExportMessage('Excel de la agrupación actual generado.');
  };

  const exportCurrentPdf = async () => {
    const startDate = String(controller.range.startDate || '');
    const endDate = String(controller.range.endDate || '');
    if (!startDate || !endDate || !points.length) return;
    setPdfLoading(true);
    setExportError(false);
    setExportMessage('');
    try {
      await downloadWaterModuleHistoryPdf({
        module,
        startDate,
        endDate,
        aggregation: controller.aggregation,
        metric: 'detail',
        detailVolumeDisplay: volumeDisplay,
        selectedIds: [String(sensorId)],
      });
      setExportMessage('PDF de la agrupación actual generado.');
    } catch (error) {
      setExportError(true);
      setExportMessage(error instanceof Error ? error.message : 'No fue posible generar el PDF del detalle.');
    } finally {
      setPdfLoading(false);
    }
  };

  useEffect(() => {
    onPeriodSummaryChange?.({
      sensorId,
      loading: controller.loading,
      intervalLabel,
      flowAverageLps: controller.loading ? null : periodSummary.flowAverageLps,
      volumeM3: controller.loading ? null : periodSummary.volumeM3,
      partialGaps: Boolean(controller.data?.partial_gaps),
      error: controller.loading ? '' : controller.error,
    });
  }, [
    controller.data?.partial_gaps,
    controller.error,
    controller.loading,
    intervalLabel,
    onPeriodSummaryChange,
    periodSummary.flowAverageLps,
    periodSummary.volumeM3,
    sensorId,
  ]);

  return (
    <>
      <section className="panel chart-panel fade-up detail-history-panel advanced-history-panel">
        <PanelHeader title={title} subtitle={subtitle} />
        <SqlChartDateControls
          controller={controller}
          title="Rango de fechas"
          showHeader={false}
          showMeta={false}
          showStatus={false}
          extraAction={(
            <div className="insurgentes-history-export-actions detail-history-export-actions">
              <button
                type="button"
                className="module-history-pdf-button"
                onClick={() => void exportCurrentPdf()}
                disabled={pdfLoading || !points.length}
                title="Exportar este elemento respetando el rango, agrupación y modo de volumen actuales"
              >
                {pdfLoading ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : <FileText size={17} aria-hidden="true" />}
                <span>{pdfLoading ? 'Generando...' : 'PDF'}</span>
              </button>
              <button
                type="button"
                className="five-minute-excel-button"
                onClick={exportCurrentExcel}
                disabled={!points.length}
                title="Exportar este elemento con la agrupación visible actualmente"
              >
                <FileSpreadsheet size={17} aria-hidden="true" />
                <span>Excel</span>
              </button>
              <FiveMinuteExcelExportButton
                module={module}
                sensorId={sensorId}
                range={controller.range}
              />
            </div>
          )}
        />
        {exportMessage ? <div className={`insurgentes-history-export-message${exportError ? ' is-error' : ''}`}>{exportMessage}</div> : null}
        <div className="insurgentes-history-totalizer-control" aria-label="Modo de visualización del volumen">
          <span>Volumen</span>
          <div className="insurgentes-history-control-group" role="group">
            <button
              type="button"
              className={volumeDisplay === 'interval' ? 'active' : ''}
              onClick={() => setVolumeDisplay('interval')}
              title="Muestra el volumen conciliado de cada intervalo de agrupación."
            >
              Por intervalo
            </button>
            <button
              type="button"
              className={volumeDisplay === 'cumulative' ? 'active' : ''}
              onClick={() => setVolumeDisplay('cumulative')}
              title="Acumula progresivamente los volúmenes válidos dentro del periodo seleccionado."
            >
              Acumulado progresivo
            </button>
          </div>
        </div>
        {hasData ? (
          <WaterHistoryChart
            points={points}
            aggregation={controller.aggregation}
            flowUnit={controller.data?.flow_unit || 'L/s'}
            height={430}
            detailVolumeDisplay={volumeDisplay}
          />
        ) : (
          <ChartEmptyState message={controller.loading ? 'Cargando histórico...' : controller.error || 'Sin histórico válido para el periodo seleccionado.'} />
        )}
      </section>

      <section className="panel table-wrapper fade-up well-history-panel advanced-history-table-panel">
        <PanelHeader title="Histórico corto" subtitle={shortHistorySubtitle} />
        <div className="pozos-table-scroll">
          <table className="pozos-operacion-table well-history-table advanced-history-table">
            <thead>
              <tr>
                <th>Intervalo</th>
                <th>Flujo promedio</th>
                <th>Volumen validado</th>
                <th>Totalizador cierre</th>
                <th>Calidad</th>
              </tr>
            </thead>
            <tbody>
              {historicalRows.length ? historicalRows.map((point) => {
                const close = totalizerClose(point);
                return (
                  <tr key={`${point.sensor_id}-${point.bucket_start}`}>
                    <td>{dateTimeLabel(point.bucket_start)}</td>
                    <td>{point.flow_avg_lps === null ? '—' : `${formatNumber(point.flow_avg_lps)} ${point.flow_unit || 'L/s'}`}</td>
                    <td>{point.volume_m3 === null ? '—' : `${formatNumber(point.volume_m3)} m³`}</td>
                    <td>{close === null ? '—' : `${formatNumber(close)} m³`}</td>
                    <td>{historyQuality(point)}</td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={5}>{controller.loading ? 'Cargando histórico...' : controller.error || 'Sin registros para este periodo.'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
