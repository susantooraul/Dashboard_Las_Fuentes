import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Mail } from 'lucide-react';
import {
  downloadDailyWaterReportExcel,
  downloadDailyWaterReportPdf,
  downloadFullWaterHistoryExcel,
  downloadFullWaterHistoryPdf,
  getDailyWaterReport,
  openDailyWaterReportHtml,
  sendDailyWaterReportEmail,
  getReportEmailSchedules,
  createReportEmailSchedule,
  updateReportEmailSchedule,
  deleteReportEmailSchedule,
  runReportEmailScheduleNow,
  type DailyWaterReportAttachmentFormat,
  type ReportEmailSchedule,
  type ReportEmailSchedulePeriodMode,
} from '../../../services/waterReportService';
import { defaultTodayRange, formatDateRangeStatus } from '../dateUtils';
import type { DateRange } from '../types';
import DateRangeControls from '../components/DateRangeControls';
import ReportPreviewTable from '../components/ReportPreviewTable';
import { useNotifications } from '../components/NotificationCenter';
import { formatMinutes as formatActiveMinutes } from '../operationalPresentation';

type ReportExportFormat = 'pdf' | 'excel' | 'html' | 'history-excel' | 'history-pdf';
type NumericValue = number | string | null | undefined;

interface SummaryData {
  volumen_recibido_m3?: NumericValue;
  flujo_actual_lps?: NumericValue;
  volumen_pozos_m3?: NumericValue;
  pozos_activos?: NumericValue;
  pozos_total?: NumericValue;
  volumen_lineas_m3?: NumericValue;
  volumen_flujos_m3?: NumericValue;
  lineas_activas?: NumericValue;
  lineas_total?: NumericValue;
  flujos_activos?: NumericValue;
  flujos_total?: NumericValue;
  niveles_actualizados?: NumericValue;
  niveles_total?: NumericValue;
  lamparas_uv_encendidas?: NumericValue;
  lamparas_uv_total?: NumericValue;
  comunicacion_actualizada?: NumericValue;
  comunicacion_total?: NumericValue;
  validacion_parcial?: NumericValue;
  calidad_periodo?: string;
  estado_comunicacion?: string;
  ultima_actualizacion?: string;
}

interface EntryRow {
  equipo?: string;
  elemento?: string;
  flujo_lps?: NumericValue;
  totalizador_m3?: NumericValue;
  volumen_periodo_m3?: NumericValue;
  volumen_display?: NumericValue;
  actividad?: string;
  tiempo_activo_min?: NumericValue;
  active_minutes?: NumericValue;
  encendidos_periodo?: NumericValue;
  start_count?: NumericValue;
  validacion?: string;
  estado?: string;
  comunicacion?: string;
  ultima_actualizacion?: string;
}

interface LevelRow {
  elemento?: string;
  nivel_m?: NumericValue;
  porcentaje?: NumericValue;
  nivel_minimo_m?: NumericValue;
  nivel_maximo_m?: NumericValue;
  estado?: string;
  comunicacion?: string;
  validacion?: string;
  ultima_actualizacion?: string;
}

interface UvRow {
  equipo?: string;
  scada_id?: string;
  agel?: NumericValue;
  uvt?: NumericValue;
  power?: NumericValue;
  flow?: NumericValue;
  dose?: NumericValue;
  ignition?: NumericValue;
  estado_operativo?: string;
  status?: NumericValue;
  comunicacion?: string;
  validacion?: string;
  ultima_actualizacion?: string;
}

interface UvSummary {
  uvt?: NumericValue;
  potencia?: NumericValue;
  flujo?: NumericValue;
  dosis?: NumericValue;
  comunicacion?: string;
  ultima_actualizacion?: string;
}

interface ReportRows<T> {
  rows?: T[];
}

interface ShiftRow {
  turno?: string;
  horario?: string;
  entrada?: NumericValue;
  pozos?: NumericValue;
  lineas?: NumericValue;
  flujos?: NumericValue;
  estado?: string;
}

interface DailyWaterReport {
  title?: string;
  plant?: string;
  date?: string;
  start_date?: string;
  end_date?: string;
  period_label?: string;
  report_code?: string;
  generated_at?: string;
  is_partial?: boolean;
  summary?: SummaryData;
  notes?: string[];
  water_entry?: ReportRows<EntryRow>;
  wells?: ReportRows<EntryRow>;
  lines?: ReportRows<EntryRow>;
  flows?: ReportRows<EntryRow>;
  levels?: ReportRows<LevelRow>;
  uv?: ReportRows<UvRow> & { summary?: UvSummary };
  shifts?: { rows?: ShiftRow[] };
}

function ReportesSection({ currentUser }: { currentUser?: { role?: string } } = {}) {
  const canEmail = currentUser?.role === 'admin' || currentUser?.role === 'operator';
  const { notify } = useNotifications();
  const [dailyReport, setDailyReport] = useState<DailyWaterReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ReportExportFormat | null>(null);
  const [reportError, setReportError] = useState('');
  const [reportDraftRange, setReportDraftRange] = useState<DateRange>(defaultTodayRange);
  const [reportRange, setReportRange] = useState<DateRange>(defaultTodayRange);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailMessage, setEmailMessage] = useState('Se adjunta el Reporte Diario de Control Hídrico Las Fuentes generado desde el dashboard.');
  const [emailFormats, setEmailFormats] = useState<DailyWaterReportAttachmentFormat[]>(['pdf', 'excel']);
  const [emailSending, setEmailSending] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailSchedules, setEmailSchedules] = useState<ReportEmailSchedule[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleEditingId, setScheduleEditingId] = useState<string | null>(null);
  const [scheduleName, setScheduleName] = useState('Reporte diario Gerencia');
  const [schedulePeriodMode, setSchedulePeriodMode] = useState<ReportEmailSchedulePeriodMode>('previous_calendar_day_24h');
  const [scheduleRecipients, setScheduleRecipients] = useState('');
  const [scheduleFormats, setScheduleFormats] = useState<DailyWaterReportAttachmentFormat[]>(['pdf', 'excel']);
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleError, setScheduleError] = useState('');
  const latestPreviewRequestRef = useRef(0);
  const previewIntervalRef = useRef<number | null>(null);

  const activeFilters = useMemo(() => {
    const sameDay = Boolean(reportRange.startDate && reportRange.endDate && reportRange.startDate === reportRange.endDate);
    return sameDay ? { date: reportRange.startDate } : { startDate: reportRange.startDate, endDate: reportRange.endDate };
  }, [reportRange.startDate, reportRange.endDate]);

  const includesToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return Boolean(reportRange.startDate && reportRange.endDate && reportRange.startDate <= today && today <= reportRange.endDate);
  }, [reportRange.startDate, reportRange.endDate]);

  const loadDailyReport = async (silent = false, forceRefresh = false) => {
    const requestId = latestPreviewRequestRef.current + 1;
    latestPreviewRequestRef.current = requestId;
    if (silent) setRefreshing(true);
    else setReportLoading(true);
    setReportError('');
    try {
      const report = await getDailyWaterReport({ ...activeFilters, forceRefresh }) as DailyWaterReport;
      if (latestPreviewRequestRef.current !== requestId) return null;
      setDailyReport(report);
      return report;
    } catch (error) {
      if (latestPreviewRequestRef.current !== requestId) return null;
      console.error('No fue posible cargar el reporte diario de Las Fuentes', error);
      setReportError(getRequestErrorMessage(error, 'No fue posible cargar el preview ligero del reporte.'));
      return null;
    } finally {
      if (latestPreviewRequestRef.current === requestId) {
        setReportLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    void loadDailyReport(false, Boolean(reportRange.refreshKey));
    return () => {
      latestPreviewRequestRef.current += 1;
    };
  }, [reportRange.startDate, reportRange.endDate, reportRange.refreshKey]);

  useEffect(() => {
    if (!emailModalOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !emailSending) {
        setEmailModalOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [emailModalOpen, emailSending]);

  useEffect(() => {
    if (!includesToday || exportingFormat || emailSending) return undefined;

    const clearTimer = () => {
      if (previewIntervalRef.current !== null) {
        window.clearInterval(previewIntervalRef.current);
        previewIntervalRef.current = null;
      }
    };

    const refresh = () => {
      if (document.visibilityState === 'visible') void loadDailyReport(true, false);
    };

    const startTimer = () => {
      clearTimer();
      previewIntervalRef.current = window.setInterval(refresh, 60000);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        refresh();
        startTimer();
      } else {
        clearTimer();
      }
    };

    if (document.visibilityState === 'visible') startTimer();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [includesToday, reportRange.startDate, reportRange.endDate, exportingFormat, emailSending]);

  const applyReportRange = () => {
    setReportRange((previous) => ({ ...reportDraftRange, refreshKey: (previous.refreshKey || 0) + 1 }));
  };

  const resetReportRange = () => {
    const today = defaultTodayRange();
    setReportDraftRange(today);
    setReportRange((previous) => ({ ...today, refreshKey: (previous.refreshKey || 0) + 1 }));
  };

  const exportReport = async (format: ReportExportFormat) => {
    if (exportingFormat) return;
    setExportingFormat(format);
    try {
      if (format === 'pdf') {
        await downloadDailyWaterReportPdf(activeFilters);
        notify({ type: 'success', title: 'PDF generado', message: 'La descarga del reporte se inició correctamente.' });
      }
      if (format === 'excel') {
        await downloadDailyWaterReportExcel(activeFilters);
        notify({ type: 'success', title: 'Excel generado', message: 'La descarga del reporte se inició correctamente.' });
      }
      if (format === 'html') {
        await openDailyWaterReportHtml(activeFilters);
        notify({ type: 'success', title: 'Vista HTML preparada', message: 'La vista del reporte se abrió en una pestaña nueva.' });
      }
      if (format === 'history-excel') {
        await downloadFullWaterHistoryExcel();
        notify({ type: 'success', title: 'Histórico completo generado', message: 'Se inició la descarga del Excel técnico de soporte.' });
      }
      if (format === 'history-pdf') {
        await downloadFullWaterHistoryPdf();
        notify({ type: 'success', title: 'Histórico completo generado', message: 'Se inició la descarga del PDF integral desde el primer registro disponible.' });
      }
    } catch (error) {
      console.error('No fue posible exportar el reporte de Las Fuentes', error);
      notify({ type: 'error', title: 'No fue posible exportar el reporte', message: getRequestErrorMessage(error, 'Revisa la conexión con la fuente operativa.') });
    } finally {
      setExportingFormat(null);
    }
  };

  const reportEmailDateLabel = reportRange.startDate === reportRange.endDate ? reportRange.startDate : `${reportRange.startDate} a ${reportRange.endDate}`;
  const buildDefaultEmailSubject = () => `Reporte Diario de Control Hídrico Las Fuentes - ${reportEmailDateLabel}`;

  const openEmailModal = () => {
    if (!canEmail) {
      notify({ type: 'warning', title: 'Correo restringido', message: 'Tu rol no permite enviar reportes por correo.' });
      return;
    }
    setEmailError('');
    setEmailSubject(buildDefaultEmailSubject());
    setEmailMessage('Se adjunta el Reporte Diario de Control Hídrico Las Fuentes generado desde el dashboard.');
    setEmailFormats(['pdf', 'excel']);
    setEmailModalOpen(true);
  };

  const toggleEmailFormat = (format: DailyWaterReportAttachmentFormat) => {
    setEmailFormats((current) => current.includes(format) ? current.filter((item) => item !== format) : [...current, format]);
  };

  const formatSuccessText = () => {
    if (emailFormats.includes('pdf') && emailFormats.includes('excel')) return 'PDF y Excel enviados correctamente.';
    if (emailFormats.includes('excel')) return 'Excel enviado correctamente.';
    return 'PDF enviado correctamente.';
  };

  const sendReportEmail = async () => {
    if (!emailTo.trim()) {
      setEmailError('Captura el correo destinatario.');
      return;
    }
    if (!emailFormats.length) {
      setEmailError('Selecciona al menos PDF o Excel para adjuntar.');
      return;
    }
    setEmailSending(true);
    setEmailError('');
    try {
      await sendDailyWaterReportEmail({
        to: emailTo.trim(),
        cc: emailCc.replace(/;/g, ',').split(',').map((item) => item.trim()).filter(Boolean),
        subject: emailSubject.trim() || buildDefaultEmailSubject(),
        message: emailMessage.trim() || 'Se adjunta el Reporte Diario de Control Hídrico Las Fuentes generado desde el dashboard.',
        formats: emailFormats,
        ...activeFilters,
      });
      setEmailModalOpen(false);
      notify({ type: 'success', title: 'Correo enviado correctamente', message: formatSuccessText() });
    } catch (error) {
      console.error('No fue posible enviar el reporte por correo', error);
      setEmailError('No se pudo enviar el correo. Conservé los campos para que puedas intentarlo de nuevo.');
      notify({ type: 'error', title: 'No se pudo enviar el correo', message: getRequestErrorMessage(error, 'Revisa la configuración SMTP del servidor.') });
    } finally {
      setEmailSending(false);
    }
  };


  const loadEmailSchedules = async () => {
    if (!canEmail) return;
    setScheduleLoading(true);
    try {
      setEmailSchedules(await getReportEmailSchedules());
    } catch (error) {
      console.error('No fue posible cargar las programaciones de correo', error);
      setScheduleError(getRequestErrorMessage(error, 'No fue posible cargar las programaciones.'));
    } finally {
      setScheduleLoading(false);
    }
  };

  useEffect(() => {
    if (canEmail) void loadEmailSchedules();
  }, [canEmail]);

  const resetScheduleForm = () => {
    setScheduleEditingId(null);
    setScheduleName('Reporte diario Gerencia');
    setSchedulePeriodMode('previous_calendar_day_24h');
    setScheduleRecipients('');
    setScheduleFormats(['pdf', 'excel']);
    setScheduleEnabled(true);
    setScheduleError('');
  };

  const toggleScheduleFormat = (format: DailyWaterReportAttachmentFormat) => {
    setScheduleFormats((current) => current.includes(format) ? current.filter((item) => item !== format) : [...current, format]);
  };

  const editSchedule = (schedule: ReportEmailSchedule) => {
    setScheduleEditingId(schedule.id);
    setScheduleName(schedule.name);
    setSchedulePeriodMode(schedule.period_mode);
    setScheduleRecipients(schedule.recipients.join(', '));
    setScheduleFormats(schedule.formats?.length ? schedule.formats : ['pdf']);
    setScheduleEnabled(schedule.enabled);
    setScheduleError('');
  };

  const saveSchedule = async () => {
    const recipients = scheduleRecipients.replace(/;/g, ',').split(',').map((item) => item.trim()).filter(Boolean);
    if (!scheduleName.trim()) {
      setScheduleError('Captura un nombre para la programación.');
      return;
    }
    if (!recipients.length) {
      setScheduleError('Captura al menos un destinatario.');
      return;
    }
    if (!scheduleFormats.length) {
      setScheduleError('Selecciona al menos PDF o Excel.');
      return;
    }
    setScheduleSaving(true);
    setScheduleError('');
    try {
      const payload = {
        name: scheduleName.trim(),
        period_mode: schedulePeriodMode,
        formats: scheduleFormats,
        recipients,
        enabled: scheduleEnabled,
        send_delay_minutes: 10,
      };
      if (scheduleEditingId) await updateReportEmailSchedule(scheduleEditingId, payload);
      else await createReportEmailSchedule(payload);
      await loadEmailSchedules();
      resetScheduleForm();
      notify({ type: 'success', title: scheduleEditingId ? 'Programación actualizada' : 'Programación guardada', message: 'El backend conservará la programación aunque se reinicie.' });
    } catch (error) {
      console.error('No fue posible guardar la programación', error);
      setScheduleError(getRequestErrorMessage(error, 'No fue posible guardar la programación.'));
    } finally {
      setScheduleSaving(false);
    }
  };

  const toggleScheduleEnabled = async (schedule: ReportEmailSchedule) => {
    try {
      await updateReportEmailSchedule(schedule.id, { enabled: !schedule.enabled });
      await loadEmailSchedules();
      notify({ type: 'success', title: schedule.enabled ? 'Programación pausada' : 'Programación activada', message: schedule.name });
    } catch (error) {
      notify({ type: 'error', title: 'No se pudo actualizar la programación', message: getRequestErrorMessage(error, 'Intenta nuevamente.') });
    }
  };

  const removeSchedule = async (schedule: ReportEmailSchedule) => {
    if (!window.confirm(`¿Eliminar la programación "${schedule.name}"?`)) return;
    try {
      await deleteReportEmailSchedule(schedule.id);
      await loadEmailSchedules();
      if (scheduleEditingId === schedule.id) resetScheduleForm();
      notify({ type: 'success', title: 'Programación eliminada', message: schedule.name });
    } catch (error) {
      notify({ type: 'error', title: 'No se pudo eliminar la programación', message: getRequestErrorMessage(error, 'Intenta nuevamente.') });
    }
  };

  const runScheduleNow = async (schedule: ReportEmailSchedule) => {
    try {
      await runReportEmailScheduleNow(schedule.id);
      await loadEmailSchedules();
      notify({ type: 'success', title: 'Reporte programado enviado', message: 'Se ejecutó el último periodo cerrado disponible.' });
    } catch (error) {
      notify({ type: 'error', title: 'No se pudo ejecutar la programación', message: getRequestErrorMessage(error, 'El periodo puede haberse enviado ya o existir un error SMTP.') });
    }
  };

  const summary = dailyReport?.summary || {};
  const entryRows = dailyReport?.water_entry?.rows || [];
  const wellRows = dailyReport?.wells?.rows || [];
  const lineRows = dailyReport?.lines?.rows || [];
  const flowRows = dailyReport?.flows?.rows || [];
  const levelRows = dailyReport?.levels?.rows || [];
  const uvRows = dailyReport?.uv?.rows || [];
  const uvSummary = dailyReport?.uv?.summary || {};
  const shiftRows = dailyReport?.shifts?.rows || [];
  const reportStatus = `Reporte: ${formatDateRangeStatus(reportRange, 'Hoy')}`;

  const kpiCards = [
    { label: 'Pozos Corporativos', value: formatMeasurement(summary.volumen_recibido_m3, 'm³'), caption: 'Medición conjunta de entrada' },
    { label: 'Volumen de pozos', value: formatMeasurement(summary.volumen_pozos_m3, 'm³'), caption: `${formatCount(summary.pozos_activos, summary.pozos_total)} pozos con actividad` },
    { label: 'Volumen de líneas', value: formatMeasurement(summary.volumen_lineas_m3, 'm³'), caption: `${formatCount(summary.lineas_activas, summary.lineas_total)} con actividad` },
    { label: 'Volumen de flujos', value: formatMeasurement(summary.volumen_flujos_m3, 'm³'), caption: `${formatCount(summary.flujos_activos, summary.flujos_total)} con actividad` },
    { label: 'Niveles actualizados', value: formatCount(summary.niveles_actualizados, summary.niveles_total), caption: 'Lecturas de nivel disponibles' },
    { label: 'UV encendidas', value: formatCount(summary.lamparas_uv_encendidas, summary.lamparas_uv_total), caption: 'Estado operativo UV' },
    { label: 'Calidad del periodo', value: summary.calidad_periodo || 'Sin datos', caption: summary.calidad_periodo === 'Validado' ? 'Cobertura validada en módulos hídricos' : `${formatInteger(summary.validacion_parcial)} elementos requieren atención` },
  ];

  return (
    <section className="reportes-page fade-up">
      <div className="panel report-hero-panel report-hero-modern">
        <div>
          <span className="eyebrow">Centro de reportes</span>
          <h1 className="report-main-title">Reportes</h1>
          <p className="report-main-subtitle">Control hídrico · Planta Las Fuentes</p>
          <p className="panel-subtitle">Genera, consulta y envía reportes del periodo seleccionado. El preview es ligero; PDF, Excel, HTML y correo se generan bajo demanda.</p>
        </div>
        <div className="report-generated-card">
          <span>Última actualización</span>
          <strong>{formatLocalDate(summary.ultima_actualizacion || dailyReport?.generated_at)}</strong>
          <small>{includesToday ? 'Actualización automática cada 60 s' : 'Periodo histórico sin polling'}</small>
        </div>
      </div>

      <div className="panel report-controls-panel report-controls-modern">
        <div className="report-controls-head">
          <div>
            <h2>Periodo del reporte</h2>
            <p>Configura el periodo y genera el formato necesario.</p>
          </div>
          {refreshing && <span className="status-pill report-status-pill">Actualizando preview...</span>}
        </div>
        <div className="report-controls-grid">
          <DateRangeControls
            className="report-date-range-panel report-date-range-compact"
            title="Periodo"
            draftRange={reportDraftRange}
            activeRange={reportRange}
            onDraftChange={setReportDraftRange}
            onApply={applyReportRange}
            onReset={resetReportRange}
            status={reportStatus}
            showDateIcons
            showHeader={false}
          />
          <div className="report-actions-panel">
            <span className="eyebrow">Acciones</span>
            <div className="report-actions">
              <button
                type="button"
                className={`primary-action report-action-button report-export-pdf${exportingFormat === 'pdf' ? ' is-loading' : ''}`}
                onClick={() => void exportReport('pdf')}
                disabled={Boolean(exportingFormat)}
                aria-busy={exportingFormat === 'pdf'}
              >
                {exportingFormat === 'pdf' && <span className="report-action-spinner" aria-hidden="true" />}
                {exportingFormat === 'pdf' ? 'Generando PDF...' : 'Generar PDF'}
              </button>
              <button
                type="button"
                className={`ghost-action report-action-button report-export-excel${exportingFormat === 'excel' ? ' is-loading' : ''}`}
                onClick={() => void exportReport('excel')}
                disabled={Boolean(exportingFormat)}
                aria-busy={exportingFormat === 'excel'}
              >
                {exportingFormat === 'excel' && <span className="report-action-spinner" aria-hidden="true" />}
                {exportingFormat === 'excel' ? 'Generando Excel...' : 'Exportar Excel'}
              </button>
              <button
                type="button"
                className={`ghost-action report-action-button report-export-html${exportingFormat === 'html' ? ' is-loading' : ''}`}
                onClick={() => void exportReport('html')}
                disabled={Boolean(exportingFormat)}
                aria-busy={exportingFormat === 'html'}
              >
                {exportingFormat === 'html' && <span className="report-action-spinner" aria-hidden="true" />}
                {exportingFormat === 'html' ? 'Preparando HTML...' : 'Vista HTML'}
              </button>
              {canEmail ? <button type="button" className="ghost-action report-action-button" onClick={openEmailModal} disabled={Boolean(exportingFormat)}>Enviar por correo</button> : null}
            </div>
            <div className="report-support-actions">
              <span>Histórico integral · desde el primer registro</span>
              <button
                type="button"
                className={`ghost-action report-action-button report-export-excel${exportingFormat === 'history-excel' ? ' is-loading' : ''}`}
                onClick={() => void exportReport('history-excel')}
                disabled={Boolean(exportingFormat)}
                aria-busy={exportingFormat === 'history-excel'}
              >
                {exportingFormat === 'history-excel' && <span className="report-action-spinner" aria-hidden="true" />}
                {exportingFormat === 'history-excel' ? 'Generando histórico...' : 'Histórico completo Excel'}
              </button>
              <button
                type="button"
                className={`ghost-action report-action-button report-export-pdf${exportingFormat === 'history-pdf' ? ' is-loading' : ''}`}
                onClick={() => void exportReport('history-pdf')}
                disabled={Boolean(exportingFormat)}
                aria-busy={exportingFormat === 'history-pdf'}
              >
                {exportingFormat === 'history-pdf' && <span className="report-action-spinner" aria-hidden="true" />}
                {exportingFormat === 'history-pdf' ? 'Generando histórico...' : 'Histórico completo PDF'}
              </button>
            </div>
            <span className={`report-action-feedback${exportingFormat ? ' is-active' : ''}`} role="status" aria-live="polite">
              {exportingFormat === 'pdf' && 'Generando el PDF. Espera a que inicie la descarga.'}
              {exportingFormat === 'excel' && 'Generando el Excel. Espera a que inicie la descarga.'}
              {exportingFormat === 'html' && 'Preparando la vista HTML. Se abrirá en una pestaña nueva.'}
              {exportingFormat === 'history-excel' && 'Generando todo el histórico disponible desde el primer registro. Puede tardar varios minutos.'}
              {exportingFormat === 'history-pdf' && 'Generando el PDF integral de cobertura, huecos e incidencias por sensor/día.'}
              {!exportingFormat && 'PDF/Excel/HTML diarios usan el periodo seleccionado. El histórico completo siempre abarca desde el primer registro hasta hoy.'}
            </span>
          </div>
        </div>
      </div>


      {canEmail && (
        <div className="panel report-schedule-panel">
          <div className="report-controls-head">
            <div>
              <span className="eyebrow">Automatización</span>
              <h2>Programar correo</h2>
              <p>24 h envía el día calendario anterior. 12 h usa bloques fijos 00:00–12:00 y 12:00–24:00, diez minutos después del cierre.</p>
            </div>
            {scheduleLoading && <span className="status-pill report-status-pill">Actualizando...</span>}
          </div>
          <div className="report-schedule-grid">
            <section className="report-schedule-card report-schedule-config-card">
              <div className="report-schedule-card-head">
                <div>
                  <span className="eyebrow">Configuración</span>
                  <h3>{scheduleEditingId ? 'Editar programación' : 'Nueva programación'}</h3>
                  <p>Define periodo, destinatarios y archivos adjuntos. La configuración se conserva aunque el backend se reinicie.</p>
                </div>
                <span className={`report-schedule-state ${scheduleEnabled ? 'is-enabled' : 'is-paused'}`}>{scheduleEnabled ? 'Activa' : 'Pausada'}</span>
              </div>
              <div className="report-schedule-form">
                <label className="report-email-field"><span>Nombre</span><input type="text" value={scheduleName} onChange={(event) => setScheduleName(event.target.value)} /></label>
                <label className="report-email-field">
                  <span>Periodo</span>
                  <select value={schedulePeriodMode} onChange={(event) => setSchedulePeriodMode(event.target.value as ReportEmailSchedulePeriodMode)}>
                    <option value="previous_calendar_day_24h">24 h — día anterior completo</option>
                    <option value="fixed_12h_blocks">12 h — dos bloques fijos diarios</option>
                  </select>
                </label>
                <label className="report-email-field">
                  <span>Destinatarios</span>
                  <input type="text" value={scheduleRecipients} onChange={(event) => setScheduleRecipients(event.target.value)} placeholder="correo@empresa.com, operacion@empresa.com" />
                  <small className="report-field-hint">Puedes capturar varios correos separados por coma.</small>
                </label>
                <div className="report-format-selector report-schedule-options" aria-label="Formatos programados">
                  <strong>Adjuntos y estado</strong>
                  <label><input type="checkbox" checked={scheduleFormats.includes('pdf')} onChange={() => toggleScheduleFormat('pdf')} /> PDF</label>
                  <label><input type="checkbox" checked={scheduleFormats.includes('excel')} onChange={() => toggleScheduleFormat('excel')} /> Excel</label>
                  <label className="report-schedule-enabled"><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} /> Programación activa</label>
                </div>
                {scheduleError && <div className="status-pill alert report-status-pill">{scheduleError}</div>}
                <div className="report-email-actions report-schedule-save-actions">
                  {scheduleEditingId && <button type="button" className="ghost-action report-action-button" onClick={resetScheduleForm}>Cancelar edición</button>}
                  <button type="button" className="primary-action report-action-button" onClick={() => void saveSchedule()} disabled={scheduleSaving}>
                    {scheduleSaving && <span className="report-action-spinner" aria-hidden="true" />}
                    {scheduleSaving ? 'Guardando...' : scheduleEditingId ? 'Guardar cambios' : 'Guardar programación'}
                  </button>
                </div>
              </div>
            </section>

            <section className="report-schedule-card report-schedule-list-card">
              <div className="report-schedule-card-head">
                <div>
                  <span className="eyebrow">Guardadas</span>
                  <h3>Programaciones</h3>
                  <p>Consulta destinatarios, próximo envío y acciones disponibles.</p>
                </div>
                <span className="report-schedule-count">{emailSchedules.length}</span>
              </div>
              <div className="report-schedule-list">
                {!scheduleLoading && emailSchedules.length === 0 && (
                  <div className="report-schedule-empty">
                    <div className="report-card-icon"><Mail size={18} /></div>
                    <div>
                      <strong>Aún no hay programaciones guardadas</strong>
                      <p>Completa la configuración de la izquierda para crear el primer envío automático.</p>
                    </div>
                  </div>
                )}
                {emailSchedules.map((schedule) => (
                  <article className="report-schedule-item" key={schedule.id}>
                    <div className="report-schedule-item-main">
                      <div className="report-schedule-item-title">
                        <strong>{schedule.name}</strong>
                        <span className={`report-schedule-state ${schedule.enabled ? 'is-enabled' : 'is-paused'}`}>{schedule.enabled ? 'Activa' : 'Pausada'}</span>
                      </div>
                      <p>{schedule.period_mode === 'fixed_12h_blocks' ? '12 h · bloques 00–12 / 12–24' : '24 h · día anterior completo'} · {schedule.formats.map((item) => item.toUpperCase()).join(' + ')}</p>
                      <div className="report-schedule-recipients">
                        <span>Destinatarios</span>
                        <strong title={schedule.recipients.join(', ')}>{schedule.recipients.join(', ')}</strong>
                      </div>
                      <small>{schedule.enabled ? `Próximo envío: ${formatLocalDate(schedule.next_run_at)}` : 'La programación está pausada y no realizará envíos.'}</small>
                    </div>
                    <div className="report-schedule-actions">
                      <button type="button" className="ghost-action report-action-button" onClick={() => editSchedule(schedule)}>Editar</button>
                      <button type="button" className="ghost-action report-action-button" onClick={() => void toggleScheduleEnabled(schedule)}>{schedule.enabled ? 'Pausar' : 'Activar'}</button>
                      <button type="button" className="ghost-action report-action-button" onClick={() => void runScheduleNow(schedule)}>Enviar ahora</button>
                      <button type="button" className="ghost-action report-action-button report-schedule-delete" onClick={() => void removeSchedule(schedule)}>Eliminar</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {canEmail && emailModalOpen && createPortal(
        <div
          className="report-email-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Enviar reporte por correo"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !emailSending) {
              setEmailModalOpen(false);
            }
          }}
        >
          <form className="report-email-card panel" onSubmit={(event) => { event.preventDefault(); void sendReportEmail(); }}>
            <div className="report-email-head">
              <div className="report-card-icon"><Mail size={18} /></div>
              <div>
                <h3>Enviar Reporte Diario de Control Hídrico</h3>
                <p>Selecciona PDF, Excel o ambos para el periodo {reportEmailDateLabel}.</p>
              </div>
            </div>
            <div className="report-format-selector" aria-label="Formatos a adjuntar">
              <strong>Formatos a adjuntar</strong>
              <label><input type="checkbox" checked={emailFormats.includes('pdf')} onChange={() => toggleEmailFormat('pdf')} /> PDF</label>
              <label><input type="checkbox" checked={emailFormats.includes('excel')} onChange={() => toggleEmailFormat('excel')} /> Excel</label>
            </div>
            <label className="report-email-field"><span>Para</span><input type="email" value={emailTo} onChange={(event) => setEmailTo(event.target.value)} placeholder="correo@empresa.com" required /></label>
            <label className="report-email-field"><span>CC opcional</span><input type="text" value={emailCc} onChange={(event) => setEmailCc(event.target.value)} placeholder="correo1@empresa.com, correo2@empresa.com" /></label>
            <label className="report-email-field"><span>Asunto</span><input type="text" value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} /></label>
            <label className="report-email-field"><span>Mensaje</span><textarea value={emailMessage} onChange={(event) => setEmailMessage(event.target.value)} rows={4} /></label>
            {emailError && <div className="status-pill alert report-status-pill">{emailError}</div>}
            <div className="report-email-actions">
              <button type="button" className="ghost-action report-action-button" onClick={() => setEmailModalOpen(false)} disabled={emailSending}>Cancelar</button>
              <button type="submit" className="primary-action report-action-button" disabled={emailSending}>{emailSending ? 'Enviando...' : 'Enviar'}</button>
            </div>
          </form>
        </div>,
        document.body,
      )}

      <div className="report-kpi-grid">
        {kpiCards.map((card) => (
          <div className="report-kpi-card" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.caption}</small>
          </div>
        ))}
      </div>

      <div className="report-info-strip">
        No se calcula Total Operativo global ni Balance de Agua. La medición Pozos Corporativos se conserva separada de los pozos individuales para evitar doble conteo.
      </div>

      <article className="panel report-preview-dashboard">
        <div className="report-preview-head">
          <div>
            <span className="eyebrow">Vista previa ligera</span>
            <h2>Vista previa del reporte</h2>
            <p>Las Fuentes · Periodo {dailyReport?.period_label || dailyReport?.date || '—'}</p>
          </div>
          <div className="report-preview-code">
            <span>{dailyReport?.report_code || '—'}</span>
            <small>{refreshing ? 'Actualizando...' : 'No genera archivos hasta solicitarlos'}</small>
          </div>
        </div>

        {reportLoading && <div className="status-pill report-status-pill">Cargando preview ligero...</div>}
        {reportError && <div className="status-pill alert report-status-pill">{reportError}</div>}

        <ReportPreviewTable
          title="Cortes por turno"
          subtitle="Cortes administrativos con la misma respuesta del periodo."
          headers={['Turno', 'Horario', 'Pozos Corporativos', 'Pozos', 'Líneas', 'Flujos', 'Estado']}
          rows={shiftRows.map((item) => [item.turno, item.horario, formatMaybeMeasurement(item.entrada, 'm³'), formatMaybeMeasurement(item.pozos, 'm³'), formatMaybeMeasurement(item.lineas, 'm³'), formatMaybeMeasurement(item.flujos, 'm³'), item.estado])}
        />
        <ReportPreviewTable title="Pozos Corporativos" headers={['Elemento', 'Flujo actual', 'Volumen periodo', 'Totalizador', 'Actividad', 'Tiempo activo', 'Encendidos', 'Comunicación', 'Validación', 'Última actualización']} rows={entryRows.map((item) => [item.equipo, formatMeasurement(item.flujo_lps, 'L/s'), formatMaybeMeasurement(item.volumen_display ?? item.volumen_periodo_m3, 'm³'), formatMeasurement(item.totalizador_m3, 'm³'), item.actividad, formatActiveMinutes(item.tiempo_activo_min ?? item.active_minutes), formatInteger(item.encendidos_periodo ?? item.start_count), item.comunicacion, item.validacion, item.ultima_actualizacion])} />
        <ReportPreviewTable title="Pozos" headers={['Pozo', 'Flujo actual', 'Volumen periodo', 'Totalizador', 'Actividad', 'Tiempo activo', 'Encendidos', 'Comunicación', 'Validación', 'Última actualización']} rows={wellRows.map((item) => [item.equipo, formatMeasurement(item.flujo_lps, 'L/s'), formatMaybeMeasurement(item.volumen_display ?? item.volumen_periodo_m3, 'm³'), formatMeasurement(item.totalizador_m3, 'm³'), item.actividad, formatActiveMinutes(item.tiempo_activo_min ?? item.active_minutes), formatInteger(item.encendidos_periodo ?? item.start_count), item.comunicacion, item.validacion, item.ultima_actualizacion])} />
        <ReportPreviewTable title="Líneas" headers={['Línea', 'Flujo actual', 'Volumen periodo', 'Totalizador', 'Actividad', 'Tiempo activo', 'Encendidos', 'Comunicación', 'Validación', 'Última actualización']} rows={lineRows.map((item) => [item.equipo, formatMeasurement(item.flujo_lps, 'L/s'), formatMaybeMeasurement(item.volumen_display ?? item.volumen_periodo_m3, 'm³'), formatMeasurement(item.totalizador_m3, 'm³'), item.actividad, formatActiveMinutes(item.tiempo_activo_min ?? item.active_minutes), formatInteger(item.encendidos_periodo ?? item.start_count), item.comunicacion, item.validacion, item.ultima_actualizacion])} />
        {flowRows.length > 0 && <ReportPreviewTable title="Flujos" headers={['Flujo', 'Flujo actual', 'Volumen periodo', 'Totalizador', 'Actividad', 'Tiempo activo', 'Encendidos', 'Comunicación', 'Validación', 'Última actualización']} rows={flowRows.map((item) => [item.equipo, formatMeasurement(item.flujo_lps, 'L/s'), formatMaybeMeasurement(item.volumen_display ?? item.volumen_periodo_m3, 'm³'), formatMeasurement(item.totalizador_m3, 'm³'), item.actividad, formatActiveMinutes(item.tiempo_activo_min ?? item.active_minutes), formatInteger(item.encendidos_periodo ?? item.start_count), item.comunicacion, item.validacion, item.ultima_actualizacion])} />}
        <ReportPreviewTable title="Niveles" headers={['Elemento', 'Nivel', 'Porcentaje', 'Mínimo', 'Máximo', 'Estado', 'Comunicación', 'Última actualización']} rows={levelRows.map((item) => [item.elemento, formatMeasurement(item.nivel_m, 'm'), formatMeasurement(item.porcentaje, '%'), formatMeasurement(item.nivel_minimo_m, 'm'), formatMeasurement(item.nivel_maximo_m, 'm'), item.estado, item.comunicacion, item.ultima_actualizacion])} />
        <ReportPreviewTable title="Lámparas UV" headers={['Lámpara', 'ID', 'Age', 'UVT', 'Power', 'Flow', 'Dosis', 'Ignition', 'State', 'Status']} rows={uvRows.map((item) => [item.equipo, item.scada_id, formatInteger(item.agel), formatMeasurement(item.uvt, '%'), formatMeasurement(item.power, '%'), formatMeasurement(item.flow, 'm³/h'), formatMeasurement(item.dose, 'mJ/cm²'), formatInteger(item.ignition), item.estado_operativo, formatMeasurement(item.status, '%')])} />
        <ReportPreviewTable title="Lecturas generales del sistema UV" headers={['UVT', 'Potencia', 'Flujo', 'Dosis', 'Comunicación', 'Última actualización']} rows={[[formatNumber(uvSummary.uvt, 2), formatNumber(uvSummary.potencia, 2), formatNumber(uvSummary.flujo, 2), formatNumber(uvSummary.dosis, 2), uvSummary.comunicacion || '—', uvSummary.ultima_actualizacion || '—']]} />
      </article>
    </section>
  );
}

function formatLocalDate(value: unknown): string {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}

function formatNumber(value: unknown, decimals = 2): string {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—';
  return Number(value).toLocaleString('es-MX', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatInteger(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString('es-MX', { maximumFractionDigits: 0 }) : '—';
}

function formatMeasurement(value: unknown, unit: string): string {
  const number = formatNumber(value, 2);
  return number === '—' ? number : `${number} ${unit}`;
}

function formatMaybeMeasurement(value: unknown, unit: string): string {
  if (typeof value === 'string' && Number.isNaN(Number(value))) return value;
  return formatMeasurement(value, unit);
}

function formatCount(value: unknown, total: unknown): string {
  const current = Number(value);
  const maximum = Number(total);
  if (!Number.isFinite(current) || !Number.isFinite(maximum)) return '—';
  return `${current}/${maximum}`;
}

function getRequestErrorMessage(error: unknown, fallback: string): string {
  const maybeResponse = error as { response?: { data?: { detail?: string } } };
  return maybeResponse?.response?.data?.detail || fallback;
}

export default ReportesSection;
