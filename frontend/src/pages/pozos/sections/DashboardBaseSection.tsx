import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ChartEmptyState from '../components/ChartEmptyState';
import OperationalAlertsPanel from '../components/OperationalAlertsPanel';
import OperationalModuleHistoryPanel from '../components/OperationalModuleHistoryPanel';
import useSqlChartDashboard from '../hooks/useSqlChartDashboard';
import { asRecord, asRows, formatLocalDate, formatNumber, numberOrNull } from '../insurgentesUtils';
import type { FlexibleRecord } from '../types';

type SummaryScopeKey = 'pozos' | 'tam' | 'embotellado' | 'cisterna';

type SummaryProcess = {
  key: SummaryScopeKey;
  title: string;
  route: string;
  volumeLabel: string;
  items: FlexibleRecord[];
};

function isActive(item: FlexibleRecord): boolean {
  return item.active === true || String(item.status || '').toLowerCase().includes('activo');
}

function activityCount(items: FlexibleRecord[]): number {
  return items.filter(isActive).length;
}

function flowSummary(items: FlexibleRecord[]): { value: number; hasData: boolean } {
  const values = items
    .map((item) => numberOrNull(item.flow_lps ?? item.flow))
    .filter((value): value is number => value !== null);
  return { value: values.reduce((sum, value) => sum + value, 0), hasData: values.length > 0 };
}

function volumeSummary(items: FlexibleRecord[]): { value: number; hasData: boolean; included: number; total: number } {
  const values = items
    .filter((item) => String(item.period_status || '').toLowerCase() === 'valid')
    .map((item) => numberOrNull(item.period_m3 ?? item.period_delta_m3))
    .filter((value): value is number => value !== null);
  return {
    value: values.reduce((sum, value) => sum + value, 0),
    hasData: values.length > 0,
    included: values.length,
    total: items.length,
  };
}

function summaryDayLabel(dashboard: FlexibleRecord): string {
  const raw = String(asRecord(dashboard.date_range).start_date || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]} · 00:00 → última lectura` : 'Hoy · 00:00 → última lectura';
}

function historySensorIds(items: FlexibleRecord[]): string[] {
  return items
    .map((item) => numberOrNull(item.sensor_id))
    .filter((value): value is number => value !== null && Number.isInteger(value) && value > 0)
    .map(String);
}

function SummaryProcessCard({ process }: { process: SummaryProcess }) {
  const flow = flowSummary(process.items);
  const volume = volumeSummary(process.items);
  const active = activityCount(process.items);

  return (
    <Link className="las-fuentes-summary-process-card" to={process.route}>
      <div className="las-fuentes-summary-process-head">
        <span>{process.title}</span>
        <em>Abrir módulo →</em>
      </div>
      <div className="las-fuentes-summary-process-primary">
        <small>{process.volumeLabel}</small>
        <div>
          <strong>{volume.hasData ? formatNumber(volume.value) : '—'}</strong>
          <span>{volume.hasData ? 'm³' : ''}</span>
        </div>
      </div>
      <div className="las-fuentes-summary-process-secondary">
        <div>
          <small>Flujo actual</small>
          <strong>{flow.hasData ? `${formatNumber(flow.value)} L/s` : '—'}</strong>
        </div>
        <div>
          <small>Con actividad</small>
          <strong>{active}/{process.items.length}</strong>
        </div>
      </div>
      <div className="las-fuentes-summary-process-foot">
        <span>{volume.included}/{volume.total} con volumen válido</span>
      </div>
    </Link>
  );
}

function DashboardBaseSection() {
  const controller = useSqlChartDashboard('dashboard', undefined, {
    includeHistory: false,
    includePeriodDeltas: true,
  });
  const [historyScope, setHistoryScope] = useState<SummaryScopeKey>('pozos');
  const dashboard = asRecord(controller.dashboard);
  const wells = asRows(dashboard.wells || dashboard.pozos);
  const flows = asRows(dashboard.flows);
  const tam = flows.filter((item) => String(item.module_group || '') === 'tam');
  const bottling = flows.filter((item) => String(item.module_group || '') === 'embotellado');
  const cistern = flows.filter((item) => String(item.module_group || '') === 'cisterna');
  const periodLabel = summaryDayLabel(dashboard);

  const processes = useMemo<SummaryProcess[]>(() => [
    { key: 'pozos', title: 'Pozos', route: '/pozos/pozos', volumeLabel: 'Bombeado hoy', items: wells },
    { key: 'tam', title: 'TAM', route: '/pozos/tam', volumeLabel: 'Consumo hoy', items: tam },
    { key: 'embotellado', title: 'Embotellado', route: '/pozos/embotellado', volumeLabel: 'Consumo hoy', items: bottling },
    { key: 'cisterna', title: 'Cisterna', route: '/pozos/cisterna', volumeLabel: 'Salida hoy', items: cistern },
  ], [wells, tam, bottling, cistern]);

  const selectedProcess = processes.find((process) => process.key === historyScope) || processes[0];
  const selectedHistoryModule = selectedProcess.key === 'pozos' ? 'pozos' : 'flujos';
  const selectedHistoryIds = selectedProcess.key === 'pozos' ? undefined : historySensorIds(selectedProcess.items);

  return (
    <>
      <section className="insurgentes-hero panel fade-up insurgentes-summary-hero las-fuentes-summary-hero">
        <div className="insurgentes-summary-head">
          <div className="insurgentes-summary-copy">
            <span className="section-eyebrow">DASHBOARD ARCA · PLANTA LAS FUENTES</span>
            <h2>Resumen operativo de agua</h2>
          </div>
          <div className="insurgentes-hero-state">
            <span>Estado general</span>
            <strong>{controller.loading ? 'Actualizando información' : 'Información actualizada'}</strong>
            <small>Última actualización: {formatLocalDate(dashboard.last_update)}</small>
            <small>{periodLabel}</small>
          </div>
        </div>

        <div className="las-fuentes-summary-process-grid" aria-label="Procesos principales de Las Fuentes">
          {processes.map((process) => (
            <SummaryProcessCard process={process} key={process.key} />
          ))}
        </div>
      </section>

      <section className="las-fuentes-summary-history-shell">
        <div className="las-fuentes-summary-history-switch" role="group" aria-label="Proceso del histórico del resumen">
          {processes.map((process) => (
            <button
              key={process.key}
              type="button"
              className={historyScope === process.key ? 'active' : ''}
              onClick={() => setHistoryScope(process.key)}
            >
              {process.title}
            </button>
          ))}
        </div>
        <OperationalModuleHistoryPanel
          key={selectedProcess.key}
          initialModule={selectedHistoryModule}
          lockedModule={selectedHistoryModule}
          allowedElementIds={selectedHistoryIds}
          titleOverride={`Histórico operativo · ${selectedProcess.title}`}
        />
      </section>

      <OperationalAlertsPanel subtitle="" hideWhenEmpty />

      {controller.error ? <ChartEmptyState message="No se pudo actualizar el resumen actual. Se conserva la última información disponible cuando existe." /> : null}
    </>
  );
}

export default DashboardBaseSection;
