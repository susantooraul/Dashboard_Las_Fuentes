import { Link } from 'react-router-dom';
import KpiCard from '../../../components/KpiCard';
import ChartEmptyState from '../components/ChartEmptyState';
import PanelHeader from '../components/PanelHeader';
import useSqlChartDashboard from '../hooks/useSqlChartDashboard';
import { asRecord, asRows, formatLocalDate, formatNumber, numberOrNull } from '../insurgentesUtils';
import type { FlexibleRecord } from '../types';

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

function volumeSummary(items: FlexibleRecord[]): { value: number; included: number; total: number } {
  const values = items
    .filter((item) => String(item.period_status || '').toLowerCase() === 'valid')
    .map((item) => numberOrNull(item.period_m3 ?? item.period_delta_m3))
    .filter((value): value is number => value !== null);
  return { value: values.reduce((sum, value) => sum + value, 0), included: values.length, total: items.length };
}

function summaryDayLabel(dashboard: FlexibleRecord): string {
  const raw = String(asRecord(dashboard.date_range).start_date || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]} · 00:00 → última lectura` : 'Hoy · 00:00 → última lectura';
}

function flowCard(label: string, items: FlexibleRecord[], accent: 'blue' | 'cyan' | 'green' = 'blue') {
  const summary = flowSummary(items);
  return (
    <KpiCard
      label={label}
      value={summary.hasData ? formatNumber(summary.value) : '—'}
      unit={summary.hasData ? 'L/s' : ''}
      trend={`${activityCount(items)}/${items.length} medidores con actividad`}
      accent={accent}
    />
  );
}

function DashboardBaseSection() {
  const controller = useSqlChartDashboard('dashboard', undefined, {
    includeHistory: false,
    includePeriodDeltas: true,
  });
  const dashboard = asRecord(controller.dashboard);
  const wells = asRows(dashboard.wells || dashboard.pozos);
  const flows = asRows(dashboard.flows);
  const tam = flows.filter((item) => String(item.module_group || '') === 'tam');
  const bottling = flows.filter((item) => String(item.module_group || '') === 'embotellado');
  const cistern = flows.filter((item) => String(item.module_group || '') === 'cisterna');
  const wellsFlow = flowSummary(wells);
  const wellsVolume = volumeSummary(wells);
  const periodLabel = summaryDayLabel(dashboard);

  const quickLinks = [
    { to: '/pozos/pozos', title: 'Pozos', items: wells, unit: 'pozos', detail: 'Pozo 1 a Pozo 5' },
    { to: '/pozos/tam', title: 'Medidores de TAM', items: tam, unit: 'medidores', detail: 'Salidas DEF, entradas PC, llegada de pozo y entrada TAM' },
    { to: '/pozos/cisterna', title: 'Medidor de cisterna', items: cistern, unit: 'medidor', detail: 'Salida de cisterna' },
    { to: '/pozos/embotellado', title: 'Medidores de embotellado', items: bottling, unit: 'medidores', detail: 'Entradas PC 1–3 y CIP' },
  ];

  return (
    <>
      <section className="insurgentes-hero panel fade-up insurgentes-summary-hero">
        <div className="insurgentes-summary-head">
          <div className="insurgentes-summary-copy">
            <span className="section-eyebrow">DASHBOARD ARCA · PLANTA LAS FUENTES</span>
            <h2>Resumen operativo de agua</h2>
            <p>Vista general de los medidores confirmados de pozos, TAM, cisterna y embotellado.</p>
          </div>
          <div className="insurgentes-hero-state">
            <span>Estado general</span>
            <strong>{controller.loading ? 'Actualizando información' : 'Información actualizada'}</strong>
            <small>Última actualización: {formatLocalDate(dashboard.last_update)}</small>
            <small>Volúmenes del resumen: {periodLabel}</small>
          </div>
        </div>

        <div className="cards-grid insurgentes-kpi-grid insurgentes-summary-kpis">
          <KpiCard
            label="Flujo actual · pozos"
            value={wellsFlow.hasData ? formatNumber(wellsFlow.value) : '—'}
            unit={wellsFlow.hasData ? 'L/s' : ''}
            trend={`${activityCount(wells)}/${wells.length} pozos con actividad`}
            accent="blue"
          />
          <KpiCard
            label="Volumen de pozos · hoy"
            value={wellsVolume.included ? formatNumber(wellsVolume.value) : '—'}
            unit={wellsVolume.included ? 'm³' : ''}
            trend={`${periodLabel} · ${wellsVolume.included}/${wellsVolume.total} con volumen válido`}
            accent="cyan"
          />
          {flowCard('Flujo actual · TAM', tam, 'blue')}
          {flowCard('Flujo actual · embotellado', bottling, 'green')}
          {flowCard('Flujo actual · salida de cisterna', cistern, 'cyan')}
        </div>
      </section>

      <section className="panel fade-up insurgentes-access-panel">
        <PanelHeader title="Accesos operativos" subtitle="Módulos y medidores confirmados para Planta Las Fuentes." />
        <div className="insurgentes-quick-grid">
          {quickLinks.map((item) => (
            <Link className="insurgentes-quick-card insurgentes-clickable-card" to={item.to} key={item.to}>
              <span className="insurgentes-quick-title">{item.title}</span>
              <div className="insurgentes-quick-value">
                <strong>{item.items.length}</strong>
                <small>{item.unit}</small>
              </div>
              <p>{item.detail}</p>
              <em>Abrir módulo →</em>
            </Link>
          ))}
        </div>
      </section>

      {controller.error ? <ChartEmptyState message="No se pudo actualizar el resumen actual. Se conservan los módulos disponibles." /> : null}
    </>
  );
}

export default DashboardBaseSection;
