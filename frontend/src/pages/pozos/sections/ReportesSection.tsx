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
import { defaultTodayRange, formatExplicitDateTimeRange } from '../dateUtils';
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
  volumen_tam_m3?: NumericValue;
  volumen_embotellado_m3?: NumericValue;
  volumen_cisterna_m3?: NumericValue;
  tam_total?: NumericValue;
  embotellado_total?: NumericValue;
  cisterna_total?: NumericValue;
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
  module_group?: string;
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
  tam?: NumericValue;
  embotellado?: NumericValue;
  cisterna?: NumericValue;
  estado?: string;
}

interface ComparisonRow {
  module?: string;
  elemento?: string;
  seleccionado?: NumericValue;
  hoy?: NumericValue;
  ayer?: NumericValue;
  semana_anterior?: NumericValue;
  esta_semana?: NumericValue;
  semana_pasada?: NumericValue;
  hace_dos_semanas?: NumericValue;
  un_mes_antes?: NumericValue;
  dos_meses_antes?: NumericValue;
  tres_meses_antes?: NumericValue;
}

interface ComparisonSection {
  rows?: ComparisonRow[];
  headers?: Record<string, string>;
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
  flow_groups?: { tam?: ReportRows<EntryRow>; embotellado?: ReportRows<EntryRow>; cisterna?: ReportRows<EntryRow> };
  levels?: ReportRows<LevelRow>;
  uv?: ReportRows<UvRow> & { summary?: UvSummary };
  shifts?: { rows?: ShiftRow[] };
  comparative?: ComparisonSection;
  historical_comparative?: ComparisonSection;
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
  const [scheduleTime1, setScheduleTime1] = useState('06:30');
  const [scheduleTime2, setScheduleTime2] = useState('07:00');
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
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
      setReportError(getRequestErrorMessage(error, 'No fue posible cargar la vista previa del reporte.'));
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
    if (!scheduleModalOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !scheduleSaving) setScheduleModalOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [scheduleModalOpen, scheduleSaving]);

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

  const reportEmailDateLabel = formatExplicitDateTimeRange(reportRange, { aggregation: 'minute', useLastUpdateWhenCurrent: false });
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
    setScheduleTime1('06:30');
    setScheduleTime2('07:00');
    setScheduleError('');
  };

  const openNewSchedule = () => {
    resetScheduleForm();
    setScheduleModalOpen(true);
  };

  const closeScheduleModal = () => {
    if (scheduleSaving) return;
    setScheduleModalOpen(false);
    setScheduleError('');
  };

  const changeSchedulePeriodMode = (mode: ReportEmailSchedulePeriodMode) => {
    setSchedulePeriodMode(mode);
    if (mode === 'fixed_12h_blocks') {
      setScheduleTime1((current) => current >= '12:00' ? current : '19:00');
      setScheduleTime2((current) => current || '07:00');
    } else {
      setScheduleTime1((current) => current < '12:00' ? current : '06:30');
    }
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
    setScheduleTime1(schedule.send_time_local || (schedule.period_mode === 'fixed_12h_blocks' ? '19:00' : '06:30'));
    setScheduleTime2(schedule.send_time_local_2 || '07:00');
    setScheduleError('');
    setScheduleModalOpen(true);
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
    if (!/^\d{2}:\d{2}$/.test(scheduleTime1)) {
      setScheduleError('Selecciona una hora de envío válida.');
      return;
    }
    if (schedulePeriodMode === 'fixed_12h_blocks') {
      if (scheduleTime1 < '12:00') {
        setScheduleError('El bloque 00:00–12:00 debe enviarse después de su cierre.');
        return;
      }
      if (!/^\d{2}:\d{2}$/.test(scheduleTime2)) {
        setScheduleError('Selecciona la hora de envío del bloque 12:00–24:00.');
        return;
      }
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
        send_time_local: scheduleTime1,
        send_time_local_2: schedulePeriodMode === 'fixed_12h_blocks' ? scheduleTime2 : null,
      };
      const editing = Boolean(scheduleEditingId);
      if (scheduleEditingId) await updateReportEmailSchedule(scheduleEditingId, payload);
      else await createReportEmailSchedule(payload);
      await loadEmailSchedules();
      resetScheduleForm();
      setScheduleModalOpen(false);
      notify({ type: 'success', title: editing ? 'Programación actualizada' : 'Programación guardada', message: 'La hora de entrega quedó guardada sin cambiar el periodo hidráulico del reporte.' });
    } catch (error) {
      console.error('No fue posible guardar la programación', error);
      setScheduleError(getRequestErrorMessage(error, 'No fue posible guardar la programación.'));
    } finally {
      setScheduleSaving(false);
    }
  };

  const scheduleTimeSummary = (schedule: ReportEmailSchedule) => {
    if (schedule.period_mode === 'fixed_12h_blocks') {
      return `00:00–12:00 → ${schedule.send_time_local || '—'} · 12:00–24:00 → ${schedule.send_time_local_2 || '—'}`;
    }
    return `Envío diario: ${schedule.send_time_local || '—'}`;
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
  const wellRows = dailyReport?.wells?.rows || [];
  const flowRows = dailyReport?.flows?.rows || [];
  const tamRows = dailyReport?.flow_groups?.tam?.rows || flowRows.filter((item) => item.module_group === 'tam');
  const bottlingRows = dailyReport?.flow_groups?.embotellado?.rows || flowRows.filter((item) => item.module_group === 'embotellado');
  const cisternRows = dailyReport?.flow_groups?.cisterna?.rows || flowRows.filter((item) => item.module_group === 'cisterna');
  const shiftRows = dailyReport?.shifts?.rows || [];
  const comparativeRows = dailyReport?.comparative?.rows || [];
  const comparativeHeaders = dailyReport?.comparative?.headers || {};
  const historicalComparisonRows = dailyReport?.historical_comparative?.rows || [];
  const historicalComparisonHeaders = dailyReport?.historical_comparative?.headers || {};
  const reportIntervalLabel = formatExplicitDateTimeRange(reportRange, { aggregation: 'minute', lastUpdate: summary.ultima_actualizacion || dailyReport?.generated_at });
  const reportStatus = `Periodo: ${reportIntervalLabel}`;

  const kpiCards = [
    { label: 'Pozos', value: formatMeasurement(summary.volumen_pozos_m3, 'm³'), caption: `${formatCount(summary.pozos_activos, summary.pozos_total)} con actividad` },
    { label: 'TAM', value: formatMeasurement(summary.volumen_tam_m3, 'm³'), caption: `${countRowsWithActivity(tamRows)}/${tamRows.length} con actividad` },
    { label: 'Embotellado', value: formatMeasurement(summary.volumen_embotellado_m3, 'm³'), caption: `${countRowsWithActivity(bottlingRows)}/${bottlingRows.length} con actividad` },
    { label: 'Cisterna', value: formatMeasurement(summary.volumen_cisterna_m3, 'm³'), caption: `${countRowsWithActivity(cisternRows)}/${cisternRows.length} con actividad` },
  ];

  return (
    <section className="reportes-page fade-up">
      <div className="panel report-hero-panel report-hero-modern">
        <div>
          <h1 className="report-main-title">Reportes</h1>
          <p className="report-main-subtitle">Control hídrico · Planta Las Fuentes</p>
          
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
            
          </div>
          {refreshing && <span className="status-pill report-status-pill">Actualizando...</span>}
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
            <span className={`report-action-feedback${exportingFormat ? ' is-active' : ''}`} role="status" aria-live="polite">
              {exportingFormat === 'pdf' && 'Generando el PDF. Espera a que inicie la descarga.'}
              {exportingFormat === 'excel' && 'Generando el Excel. Espera a que inicie la descarga.'}
              {exportingFormat === 'html' && 'Preparando la vista HTML. Se abrirá en una pestaña nueva.'}
              {!exportingFormat && 'PDF, Excel, HTML y correo usan exactamente el periodo seleccionado.'}
            </span>
          </div>
        </div>
      </div>


      {canEmail && (
        <div className="panel report-schedule-panel report-schedule-compact">
          <div className="report-schedule-toolbar">
            <div>
              <h2>Correo programado</h2>
            </div>
            <div className="report-schedule-toolbar-actions">
              <span className="report-schedule-count">{emailSchedules.filter((item) => item.enabled).length} activas</span>
              <button type="button" className="ghost-action report-action-button report-schedule-new" onClick={openNewSchedule}>
                <Mail size={16} /> Nueva programación
              </button>
            </div>
          </div>
          {scheduleLoading && <span className="status-pill report-status-pill">Actualizando...</span>}
          <div className="report-schedule-list report-schedule-list-compact">
            {!scheduleLoading && emailSchedules.length === 0 && (
              <div className="report-schedule-empty">
                <div className="report-card-icon"><Mail size={18} /></div>
                <div>
                  <strong>Aún no hay programaciones guardadas</strong>
                  <p>Crea la primera programación y elige su hora exacta de entrega.</p>
                </div>
              </div>
            )}
            {emailSchedules.map((schedule) => (
              <article className="report-schedule-item report-schedule-item-compact" key={schedule.id}>
                <div className="report-schedule-item-main">
                  <div className="report-schedule-item-title">
                    <strong>{schedule.name}</strong>
                    <span className={`report-schedule-state ${schedule.enabled ? 'is-enabled' : 'is-paused'}`}>{schedule.enabled ? 'Activa' : 'Pausada'}</span>
                  </div>
                  <p>{schedule.period_mode === 'fixed_12h_blocks' ? '12 h · bloques 00–12 / 12–24' : '24 h · día anterior completo'} · {schedule.formats.map((item) => item.toUpperCase()).join(' + ')} · {schedule.recipients.length} destinatario{schedule.recipients.length === 1 ? '' : 's'}</p>
                  <strong className="report-schedule-time-summary">Horario configurado: {scheduleTimeSummary(schedule).replace('Envío diario: ', '')}</strong>
                  <small>{schedule.enabled ? `Próximo envío: ${formatLocalDate(schedule.next_run_at)}` : 'La programación está pausada.'}</small>
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
        </div>
      )}

      <div className="panel report-history-support-panel">
        <div>
          <h2>Histórico completo</h2>
          <p>Soporte integral desde el primer registro disponible.</p>
        </div>
        <div className="report-history-support-actions">
          <button
            type="button"
            className={`ghost-action report-action-button report-export-pdf${exportingFormat === 'history-pdf' ? ' is-loading' : ''}`}
            onClick={() => void exportReport('history-pdf')}
            disabled={Boolean(exportingFormat)}
            aria-busy={exportingFormat === 'history-pdf'}
          >
            {exportingFormat === 'history-pdf' && <span className="report-action-spinner" aria-hidden="true" />}
            {exportingFormat === 'history-pdf' ? 'Generando histórico...' : 'PDF histórico completo'}
          </button>
          <button
            type="button"
            className={`ghost-action report-action-button report-export-excel${exportingFormat === 'history-excel' ? ' is-loading' : ''}`}
            onClick={() => void exportReport('history-excel')}
            disabled={Boolean(exportingFormat)}
            aria-busy={exportingFormat === 'history-excel'}
          >
            {exportingFormat === 'history-excel' && <span className="report-action-spinner" aria-hidden="true" />}
            {exportingFormat === 'history-excel' ? 'Generando histórico...' : 'Excel histórico completo'}
          </button>
        </div>
        {(exportingFormat === 'history-excel' || exportingFormat === 'history-pdf') && (
          <small className="report-history-support-status">
            {exportingFormat === 'history-excel' && 'Generando todo el histórico disponible. Puede tardar varios minutos.'}
            {exportingFormat === 'history-pdf' && 'Generando el PDF histórico completo.'}
          </small>
        )}
      </div>

      {canEmail && scheduleModalOpen && createPortal(
        <div
          className="report-email-modal report-schedule-modal"
          role="dialog"
          aria-modal="true"
          aria-label={scheduleEditingId ? 'Editar programación de correo' : 'Nueva programación de correo'}
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeScheduleModal(); }}
        >
          <form className="report-email-card panel report-schedule-modal-card" onSubmit={(event) => { event.preventDefault(); void saveSchedule(); }}>
            <div className="report-email-head report-schedule-modal-head">
              <div className="report-card-icon"><Mail size={18} /></div>
              <div>
                <h3>{scheduleEditingId ? 'Editar programación' : 'Nueva programación'}</h3>
              </div>
              <span className={`report-schedule-state ${scheduleEnabled ? 'is-enabled' : 'is-paused'}`}>{scheduleEnabled ? 'Activa' : 'Pausada'}</span>
            </div>

            <div className="report-schedule-form report-schedule-modal-form">
              <label className="report-email-field"><span>Nombre</span><input type="text" value={scheduleName} onChange={(event) => setScheduleName(event.target.value)} /></label>

              <fieldset className="report-schedule-period-selector">
                <legend>Periodo del reporte</legend>
                <label className={`report-schedule-period-option${schedulePeriodMode === 'previous_calendar_day_24h' ? ' is-selected' : ''}`}>
                  <input type="radio" name="schedule-period" value="previous_calendar_day_24h" checked={schedulePeriodMode === 'previous_calendar_day_24h'} onChange={() => changeSchedulePeriodMode('previous_calendar_day_24h')} />
                  <span><strong>24 h</strong><small>Día calendario anterior completo</small></span>
                </label>
                <label className={`report-schedule-period-option${schedulePeriodMode === 'fixed_12h_blocks' ? ' is-selected' : ''}`}>
                  <input type="radio" name="schedule-period" value="fixed_12h_blocks" checked={schedulePeriodMode === 'fixed_12h_blocks'} onChange={() => changeSchedulePeriodMode('fixed_12h_blocks')} />
                  <span><strong>12 h</strong><small>Dos bloques diarios: 00–12 y 12–24</small></span>
                </label>
              </fieldset>

              {schedulePeriodMode === 'previous_calendar_day_24h' ? (
                <label className="report-email-field report-schedule-time-field">
                  <span>Hora de envío diaria</span>
                  <input type="time" value={scheduleTime1} onChange={(event) => setScheduleTime1(event.target.value)} required />
                </label>
              ) : (
                <div className="report-schedule-two-times">
                  <label className="report-email-field report-schedule-time-field">
                    <span>Entrega del bloque 00:00–12:00</span>
                    <input type="time" min="12:00" value={scheduleTime1} onChange={(event) => setScheduleTime1(event.target.value)} required />
                  </label>
                  <label className="report-email-field report-schedule-time-field">
                    <span>Entrega del bloque 12:00–24:00</span>
                    <input type="time" value={scheduleTime2} onChange={(event) => setScheduleTime2(event.target.value)} required />
                  </label>
                </div>
              )}

              <label className="report-email-field">
                <span>Destinatarios</span>
                <input type="text" value={scheduleRecipients} onChange={(event) => setScheduleRecipients(event.target.value)} placeholder="correo@empresa.com, operacion@empresa.com" />
              </label>

              <div className="report-format-selector report-schedule-options" aria-label="Formatos programados">
                <strong>Adjuntos y estado</strong>
                <label><input type="checkbox" checked={scheduleFormats.includes('pdf')} onChange={() => toggleScheduleFormat('pdf')} /> PDF</label>
                <label><input type="checkbox" checked={scheduleFormats.includes('excel')} onChange={() => toggleScheduleFormat('excel')} /> Excel</label>
                <label className="report-schedule-enabled"><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} /> Programación activa</label>
              </div>

              {scheduleError && <div className="status-pill alert report-status-pill">{scheduleError}</div>}
              <div className="report-email-actions report-schedule-save-actions">
                <button type="button" className="ghost-action report-action-button" onClick={closeScheduleModal} disabled={scheduleSaving}>Cancelar</button>
                <button type="submit" className="primary-action report-action-button" disabled={scheduleSaving}>
                  {scheduleSaving && <span className="report-action-spinner" aria-hidden="true" />}
                  {scheduleSaving ? 'Guardando...' : scheduleEditingId ? 'Guardar cambios' : 'Guardar programación'}
                </button>
              </div>
            </div>
          </form>
        </div>,
        document.body,
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
                <p>Selecciona PDF, Excel o ambos para el intervalo {reportEmailDateLabel}.</p>
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

      <article className="panel report-preview-dashboard">
        <div className="report-preview-head">
          <div>
            <h2>Vista previa</h2>
            <p>Las Fuentes · {reportIntervalLabel}</p>
          </div>
          <div className="report-preview-code">
            <span>{dailyReport?.report_code || '—'}</span>
            {refreshing && <small>Actualizando...</small>}
          </div>
        </div>

        {reportLoading && <div className="status-pill report-status-pill">Cargando vista previa...</div>}
        {reportError && <div className="status-pill alert report-status-pill">{reportError}</div>}

        <ReportPreviewTable
          title="Cortes por turno"
          subtitle={`Cortes del intervalo ${reportIntervalLabel}.`}
          headers={['Turno', 'Horario', 'Pozos', 'TAM', 'Embotellado', 'Cisterna', 'Estado']}
          rows={shiftRows.map((item) => [item.turno, item.horario, formatMaybeMeasurement(item.pozos, 'm³'), formatMaybeMeasurement(item.tam, 'm³'), formatMaybeMeasurement(item.embotellado, 'm³'), formatMaybeMeasurement(item.cisterna, 'm³'), item.estado])}
        />
        <ReportPreviewTable
          title="Comparativo del periodo"
          headers={[
            'Módulo', 'Elemento',
            comparativeHeaders.seleccionado || 'Seleccionado',
            comparativeHeaders.ayer || 'Anterior',
            comparativeHeaders.semana_anterior || 'Semana anterior',
            comparativeHeaders.esta_semana || 'Esta semana',
          ]}
          rows={comparativeRows.map((item) => [
            item.module, item.elemento,
            formatMaybeMeasurement(item.hoy ?? item.seleccionado, 'm³'),
            formatMaybeMeasurement(item.ayer, 'm³'),
            formatMaybeMeasurement(item.semana_anterior, 'm³'),
            formatMaybeMeasurement(item.esta_semana, 'm³'),
          ])}
        />
        {historicalComparisonRows.length ? (
          <ReportPreviewTable
            title="Comparativo histórico"
            headers={[
              'Módulo', 'Elemento',
              historicalComparisonHeaders.semana_pasada || 'Semana pasada',
              historicalComparisonHeaders.hace_dos_semanas || 'Hace dos semanas',
              historicalComparisonHeaders.un_mes_antes || 'Un mes antes',
              historicalComparisonHeaders.dos_meses_antes || 'Dos meses antes',
              historicalComparisonHeaders.tres_meses_antes || 'Tres meses antes',
            ]}
            rows={historicalComparisonRows.map((item) => [
              item.module, item.elemento,
              formatMaybeMeasurement(item.semana_pasada, 'm³'),
              formatMaybeMeasurement(item.hace_dos_semanas, 'm³'),
              formatMaybeMeasurement(item.un_mes_antes, 'm³'),
              formatMaybeMeasurement(item.dos_meses_antes, 'm³'),
              formatMaybeMeasurement(item.tres_meses_antes, 'm³'),
            ])}
          />
        ) : null}
        <ReportPreviewTable title="Pozos" headers={['Pozo', 'Flujo actual', `Volumen · ${reportIntervalLabel}`, 'Totalizador al cierre', 'Actividad', 'Tiempo activo', 'Encendidos', 'Comunicación', 'Validación', 'Última actualización']} rows={wellRows.map((item) => [item.equipo, formatMeasurement(item.flujo_lps, 'L/s'), formatMaybeMeasurement(item.volumen_display ?? item.volumen_periodo_m3, 'm³'), formatMeasurement(item.totalizador_m3, 'm³'), item.actividad, formatActiveMinutes(item.tiempo_activo_min ?? item.active_minutes), formatInteger(item.encendidos_periodo ?? item.start_count), item.comunicacion, item.validacion, item.ultima_actualizacion])} />
        <ReportPreviewTable title="TAM" headers={['Medidor', 'Flujo actual', `Volumen · ${reportIntervalLabel}`, 'Totalizador al cierre', 'Actividad', 'Comunicación', 'Validación']} rows={tamRows.map((item) => [item.equipo, formatMeasurement(item.flujo_lps, 'L/s'), formatMaybeMeasurement(item.volumen_display ?? item.volumen_periodo_m3, 'm³'), formatMeasurement(item.totalizador_m3, 'm³'), item.actividad, item.comunicacion, item.validacion])} />
        <ReportPreviewTable title="Embotellado" headers={['Medidor', 'Flujo actual', `Volumen · ${reportIntervalLabel}`, 'Totalizador al cierre', 'Actividad', 'Comunicación', 'Validación']} rows={bottlingRows.map((item) => [item.equipo, formatMeasurement(item.flujo_lps, 'L/s'), formatMaybeMeasurement(item.volumen_display ?? item.volumen_periodo_m3, 'm³'), formatMeasurement(item.totalizador_m3, 'm³'), item.actividad, item.comunicacion, item.validacion])} />
        <ReportPreviewTable title="Cisterna" headers={['Medidor', 'Flujo actual', `Volumen · ${reportIntervalLabel}`, 'Totalizador al cierre', 'Actividad', 'Comunicación', 'Validación']} rows={cisternRows.map((item) => [item.equipo, formatMeasurement(item.flujo_lps, 'L/s'), formatMaybeMeasurement(item.volumen_display ?? item.volumen_periodo_m3, 'm³'), formatMeasurement(item.totalizador_m3, 'm³'), item.actividad, item.comunicacion, item.validacion])} />
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

function countRowsWithActivity(rows: EntryRow[]): number {
  return rows.filter((row) => String(row.actividad || '').toLowerCase() === 'con actividad').length;
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
