import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BellRing, Settings2, TriangleAlert, X } from 'lucide-react';
import DataTable from '../components/DataTable';
import KpiCard from '../components/KpiCard';
import { getCircuitGroupsForSection, getCircuitsForTransformer } from '../data/circuits';
import { fetchDashboard } from '../services/dashboardService';
import { downloadReport, sendReportByEmail } from '../services/exportService';
import { defaultAlertSettings, getAlertSettings, saveAlertSettings } from '../services/alertService';

const transformerSections = new Set(['transformador1', 'transformador2', 'transformador3', 'transformador4', 'transformador5']);
const lineSections = new Set(['linea1', 'linea2', 'linea3']);
const redPalette = ['#e9082c', '#c40323', '#a0021c', '#8a3d26', '#ff6b81', '#ff9078', '#f6c2cb', '#7b1e2b', '#b15a3c'];
const mutedRedPalette = ['#f04a62', '#d52b4b', '#b71d36', '#8a3d26', '#e47d93', '#f39c8c', '#f7d1d7', '#7b1e2b', '#b15a3c'];

const DEFAULT_FILTER_PRESET = 'last30';

const quickRangeOptions = [
  { key: 'today', label: 'Hoy' },
  { key: 'yesterday', label: 'Ayer' },
  { key: 'thisWeek', label: 'Esta semana' },
  { key: 'thisMonth', label: 'Este mes' },
  { key: 'last7', label: 'Últimos 7 días' },
  { key: 'last30', label: 'Últimos 30 días' },
];

function toDateValue(date) {
  return date.toISOString().slice(0, 10);
}

function getQuickRange(key, referenceDate = new Date()) {
  const now = new Date(referenceDate);
  const end = new Date(now);
  const start = new Date(now);
  if (key === 'yesterday') {
    start.setDate(now.getDate() - 1);
    end.setDate(now.getDate() - 1);
  } else if (key === 'thisWeek') {
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(now.getDate() - diff);
  } else if (key === 'thisMonth') {
    start.setDate(1);
  } else if (key === 'last7') {
    start.setDate(now.getDate() - 6);
  } else if (key === 'last30') {
    start.setDate(now.getDate() - 29);
  }
  return { startDate: toDateValue(start), endDate: toDateValue(end), preset: key };
}

function formatRangeText(startDate, endDate) {
  if (!startDate && !endDate) return 'Periodo completo';
  const start = startDate || endDate;
  const end = endDate || startDate;
  return `${start} - ${end} (hora central)`;
}

function formatMetric(value) {
  if (typeof value === 'number') return value.toLocaleString('es-MX', { maximumFractionDigits: 2 });
  return value;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const context = payload[0]?.payload || {};
  const displayLabel = context.fullLabel || context.displayName || context.name || label;
  return (
    <div className="chart-tooltip solid-tooltip">
      {displayLabel ? <div className="chart-tooltip-label">{displayLabel}</div> : null}
      {context.description ? <div className="chart-tooltip-copy">{context.description}</div> : null}
      <div className="chart-tooltip-list">
        {payload.map((entry) => (
          <div className="chart-tooltip-row" key={`${entry.dataKey || entry.name}-${entry.value}`}>
            <span className="chart-tooltip-dot" style={{ background: entry.color || entry.fill || '#fff' }} />
            <span className="chart-tooltip-name">{entry.name || entry.dataKey}</span>
            <span className="chart-tooltip-value">{formatMetric(entry.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildStableDemoSchedule(item, groupTitle) {
  const seed = Array.from(`${item.code || ''}-${item.name || ''}-${groupTitle || ''}`)
    .reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
  const startHour = 6 + (seed % 4);
  const startMinute = seed % 3 === 0 ? 30 : 0;
  const durationHours = 9 + (seed % 3);
  const stopHour = Math.min(23, startHour + durationHours);
  const stopMinute = startMinute === 30 ? 0 : 30;
  const startTime = `${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`;
  const stopTime = `${String(stopHour).padStart(2, '0')}:${String(stopMinute).padStart(2, '0')}`;
  return {
    startTime,
    stopTime,
    scheduleLabel: `${startTime} - ${stopTime}`,
  };
}

function flattenCircuits(groups) {
  return groups.flatMap((group) => group.circuits.map((item) => {
    const schedule = item.startTime && item.stopTime
      ? {
          startTime: item.startTime,
          stopTime: item.stopTime,
          scheduleLabel: item.scheduleLabel || `${item.startTime} - ${item.stopTime}`,
        }
      : buildStableDemoSchedule(item, group.title);

    return {
      groupKey: group.key,
      groupTitle: group.title,
      code: item.code,
      name: item.name,
      fullLabel: item.name,
      displayName: item.name,
      description: item.description,
      shortName: item.name.length > 18 ? `${item.name.slice(0, 18)}…` : item.name,
      kw: item.kw,
      kwh: item.kwh,
      transformer: item.transformer,
      transformerKey: item.transformerKey,
      capacityKw: item.capacityKw,
      utilizationPct: item.utilizationPct,
      ...schedule,
    };
  }));
}

function normalizeCircuitKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildTransformerCircuitChartData(circuits, systemsData = []) {
  if (!circuits.length) return [];

  const totalsByName = new Map(
    (systemsData || []).map((item) => ([
      normalizeCircuitKey(item.name),
      {
        kw: Number(item.kw || item.value || 0),
        kwh: Number(item.kwh || item.value || 0),
      },
    ])),
  );

  return circuits.map((circuit) => {
    const matched = totalsByName.get(normalizeCircuitKey(circuit.name));
    if (!matched) return circuit;
    return {
      ...circuit,
      kw: matched.kw || circuit.kw,
      kwh: matched.kwh || circuit.kwh,
    };
  });
}

function evaluateAlerts(payload, settings) {
  if (!payload) return [];
  const latest = payload.table_data?.[payload.table_data.length - 1];
  const maxCurrent = Math.max(0, ...payload.table_data.map((row) => row.current || 0));
  const maxKw = Math.max(0, ...payload.table_data.map((row) => row.kw || 0));
  const list = [];

  if (latest && latest.voltage < settings.voltageMinV) {
    list.push({ level: 'critical', title: 'Voltaje bajo', message: `${payload.title} registró ${latest.voltage.toFixed(2)} V, por debajo del mínimo configurado (${settings.voltageMinV} V).` });
  }
  if (latest && latest.voltage > settings.voltageMaxV) {
    list.push({ level: 'critical', title: 'Voltaje alto', message: `${payload.title} registró ${latest.voltage.toFixed(2)} V, por arriba del máximo configurado (${settings.voltageMaxV} V).` });
  }
  if (maxCurrent > settings.currentMaxA) {
    list.push({ level: 'warning', title: 'Corriente alta', message: `${payload.title} alcanzó ${maxCurrent.toFixed(2)} A y superó el umbral de ${settings.currentMaxA} A.` });
  }
  if (maxKw > settings.demandMaxKw) {
    list.push({ level: 'warning', title: 'Demanda alta', message: `${payload.title} llegó a ${maxKw.toFixed(2)} kW y excedió el umbral de ${settings.demandMaxKw} kW.` });
  }
  if (latest && String(latest.status || '').toUpperCase() !== 'NORMAL') {
    list.push({ level: 'critical', title: 'Estado no normal', message: `${payload.title} reporta estado ${String(latest.status).toUpperCase()}.` });
  }
  return list;
}

function HeroPanel({ title, subtitle, updatedAt, blue = false }) {
  return (
    <section className={`hero-panel panel fade-up ${blue ? 'hero-blue' : ''}`}>
      <div>
        <div className="eyebrow">Sistema de energía industrial</div>
        <div className="hero-title">{title}</div>
        <div className="hero-subtitle">{subtitle}</div>
      </div>
      <div className="hero-stats">
        <div className="hero-chip">Actualizado {new Date(updatedAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</div>
      </div>
    </section>
  );
}

function AlertPopup({ alert, onClose }) {
  if (!alert) return null;
  return (
    <div className="alert-modal fade-up">
      <div className={`alert-modal-card ${alert.level}`}>
        <div className="alert-modal-head">
          <div className="alert-modal-icon">{alert.level === 'critical' ? <TriangleAlert size={18} /> : <BellRing size={18} />}</div>
          <div>
            <div className="alert-modal-title">{alert.title}</div>
            <div className="alert-modal-copy">{alert.message}</div>
          </div>
          <button className="alert-close" onClick={onClose}><X size={16} /></button>
        </div>
      </div>
    </div>
  );
}


function DateFilterBar({ values, draft, onDraftChange, onApply, onReset, disabled = false }) {
  return (
    <section className="panel filters-panel fade-up">
      <div className="filters-row">
        <div>
          <div className="panel-title small">Consulta por fechas</div>
          <div className="panel-subtitle">Aplica el rango a KPIs, gráficas, tablas y exportaciones.</div>
        </div>
        <div className="filters-inline">
          <select value={draft.preset || ''} onChange={(e) => onDraftChange('preset', e.target.value)} disabled={disabled}>
            <option value="">Personalizado</option>
            {quickRangeOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <input type="date" value={draft.startDate || ''} onChange={(e) => onDraftChange('startDate', e.target.value)} disabled={disabled} />
          <input type="date" value={draft.endDate || ''} onChange={(e) => onDraftChange('endDate', e.target.value)} disabled={disabled} />
          <button className="header-button primary" onClick={onApply} disabled={disabled}>Aplicar</button>
          <button className="header-button" onClick={onReset} disabled={disabled}>Limpiar</button>
        </div>
      </div>
      <div className="filters-summary">Rango activo: <strong>{formatRangeText(values.startDate, values.endDate)}</strong></div>
    </section>
  );
}

function AlertSettingsPage({ payload, settings, onSave, alerts }) {
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <>
      <section className="panel panel-spacious fade-up alert-settings-panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Configuración de alertas</div>
            <div className="panel-subtitle">Define umbrales visibles en modal, banners y futuras notificaciones.</div>
          </div>
          <button className="header-button primary" onClick={() => onSave(form)}><Settings2 size={15} /> Guardar umbrales</button>
        </div>
        <div className="alert-form-grid">
          <label className="alert-field">
            <span>Corriente máxima (A)</span>
            <input type="number" value={form.currentMaxA} onChange={(e) => update('currentMaxA', Number(e.target.value))} />
          </label>
          <label className="alert-field">
            <span>Voltaje mínimo (V)</span>
            <input type="number" value={form.voltageMinV} onChange={(e) => update('voltageMinV', Number(e.target.value))} />
          </label>
          <label className="alert-field">
            <span>Voltaje máximo (V)</span>
            <input type="number" value={form.voltageMaxV} onChange={(e) => update('voltageMaxV', Number(e.target.value))} />
          </label>
          <label className="alert-field">
            <span>Demanda máxima (kW)</span>
            <input type="number" value={form.demandMaxKw} onChange={(e) => update('demandMaxKw', Number(e.target.value))} />
          </label>
        </div>
      </section>
      <section className="cards-grid stagger-grid">
        {(payload?.cards || []).map((card, index) => <KpiCard key={card.label} {...card} style={{ animationDelay: `${index * 70}ms` }} />)}
      </section>
      <section className="panel panel-spacious fade-up">
        <div className="panel-header">
          <div>
            <div className="panel-title">Alertas activas</div>
            <div className="panel-subtitle">Visualización sugerida en modal o pop-up llamativo dentro del tablero.</div>
          </div>
        </div>
        <div className="alerts-list">
          {alerts.length ? alerts.map((item, index) => (
            <div className={`alert-list-item ${item.level}`} key={`${item.title}-${index}`}>
              <div className="alert-list-icon">{item.level === 'critical' ? <TriangleAlert size={16} /> : <BellRing size={16} />}</div>
              <div>
                <div className="alert-list-title">{item.title}</div>
                <div className="alert-list-copy">{item.message}</div>
              </div>
            </div>
          )) : <div className="empty-state">No hay alertas activas con la configuración actual.</div>}
        </div>
      </section>
    </>
  );
}

function CircuitGroupCard({ group }) {
  return (
    <div className="circuit-card panel fade-up compact full-width-card">
      <div className="circuit-card-head">
        <div>
          <div className="circuit-card-title">{group.title}</div>
          <div className="circuit-card-subtitle">{group.summary}</div>
        </div>
        <div className={`transformer-badge ${group.tone}`}>{group.circuits.length} circuitos</div>
      </div>
      <div className="circuit-table-wrap wide-fit">
        <table className="circuit-table executive-table fit-table">
          <thead>
            <tr>
              <th>Circuito</th>
              <th>Referencia</th>
              <th>Amperaje</th>
              <th>Descripción</th>
              <th className="metric-head metric-kw">kW</th>
              <th className="metric-head metric-kwh">kWh</th>
            </tr>
          </thead>
          <tbody>
            {group.circuits.map((item) => (
              <tr key={`${group.key}-${item.code}-${item.description}`}>
                <td className="circuit-primary-cell">
                  <div className="circuit-name-main">{item.name}</div>
                  <div className="circuit-name-code">{item.code}</div>
                </td>
                <td>{item.code}</td>
                <td>{item.amps}</td>
                <td>{item.description}</td>
                <td className="metric-cell metric-kw"><span>{item.kw.toFixed(2)}</span></td>
                <td className="metric-cell metric-kwh"><span>{item.kwh.toFixed(2)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CircuitGrid({ groups, title, subtitle }) {
  if (!groups.length) return null;
  return (
    <section className="panel panel-spacious fade-up">
      <div className="panel-header">
        <div>
          <div className="panel-title">{title}</div>
          <div className="panel-subtitle">{subtitle}</div>
        </div>
      </div>
      <div className="circuit-grid single-column">{groups.map((group) => <CircuitGroupCard key={group.key} group={group} />)}</div>
    </section>
  );
}

function CircuitMetricChart({ data, title, subtitle, metricKey, metricLabel, colors }) {
  if (!data.length) return null;
  return (
    <div className="panel chart-panel fade-up horizontal-chart-panel">
      <div className="panel-header compact">
        <div>
          <div className="panel-title">{title}</div>
          <div className="panel-subtitle">{subtitle}</div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(360, data.length * 28)}>
        <BarChart data={data} layout="vertical" margin={{ top: 10, right: 18, left: 24, bottom: 10 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" stroke="#c5d0e5" />
          <YAxis type="category" dataKey="shortName" width={180} stroke="#c5d0e5" tick={{ fontSize: 11 }} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
          <Bar dataKey={metricKey} name={metricLabel} radius={[0, 12, 12, 0]} activeBar={false}>
            {data.map((item, index) => <Cell key={`${item.name}-${metricKey}`} fill={colors[index % colors.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DistributionPanel({ section, payload, sectionGroups }) {
  const sectionCircuits = useMemo(() => flattenCircuits(sectionGroups), [sectionGroups]);
  const isDashboard = section === 'dashboard';
  const chartData = isDashboard
    ? payload.systems_data.map((item) => ({ ...item, fullLabel: item.name, displayName: item.name }))
    : sectionCircuits.map((item) => ({
        name: item.name,
        value: item.kwh,
        fullLabel: item.name,
        displayName: item.name,
        description: `${item.code} · ${item.description}`,
      }));

  if (!chartData.length) return <div className="panel chart-panel fade-up"><div className="empty-state">No hay circuitos asociados para mostrar.</div></div>;

  return (
    <div className="panel chart-panel fade-up">
      <div className="panel-header compact">
        <div>
          <div className="panel-title">{isDashboard ? 'Distribución por Sistema' : 'Distribución por Circuito'}</div>
          <div className="panel-subtitle">{isDashboard ? '% del consumo total' : 'Circuitos de la agrupación por consumo kWh'}</div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <PieChart>
          <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={74} outerRadius={122} paddingAngle={2}>
            {chartData.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={redPalette[index % redPalette.length]} />)}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function buildTransformerCharts(rows) {
  return rows.map((row) => {
    const ts = new Date(row.timestamp);
    const voltage = Number(row.voltage || 0);
    const current = Number(row.current || 0);
    const kw = Number(row.kw || 0);
    const kva = current && voltage ? (Math.sqrt(3) * voltage * current) / 1000 : 0;
    return {
      hour: ts.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }),
      vAB: Number(voltage.toFixed(2)),
      vBC: Number(voltage.toFixed(2)),
      vCA: Number(voltage.toFixed(2)),
      iA: Number(current.toFixed(2)),
      iB: Number(current.toFixed(2)),
      iC: Number(current.toFixed(2)),
      kw: Number(kw.toFixed(2)),
      kva: Number(kva.toFixed(2)),
    };
  });
}

function buildSubstationCharts(rows) {
  const recent = rows.slice(-36);
  const base = recent.length ? recent : rows;
  const series = base.map((row, index) => {
    const ts = new Date(row.timestamp);
    const voltage = row.voltage || 480;
    const current = row.current || 0;
    const kw = row.kw || 0;
    return {
      hour: ts.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }),
      demand: Number((kw * 1.7).toFixed(2)),
      vAB: Number((voltage + 1.4 + Math.sin(index / 4) * 0.8).toFixed(2)),
      vBC: Number((voltage - 0.8 + Math.cos(index / 5) * 0.8).toFixed(2)),
      vCA: Number((voltage + 0.4 + Math.sin(index / 6) * 0.7).toFixed(2)),
      iA: Number((current + 12 + Math.sin(index / 3) * 8).toFixed(2)),
      iB: Number((current + 4 + Math.cos(index / 4) * 7).toFixed(2)),
      iC: Number((current + 7 + Math.sin(index / 5) * 8).toFixed(2)),
      kw: Number((kw * 1.3).toFixed(2)),
    };
  });
  const monthly = [
    { month: 'ene.', value: 402000 },
    { month: 'feb.', value: 366000 },
    { month: 'mar.', value: 522000 },
    { month: 'abr.', value: 76000 },
  ];
  const daily = Array.from({ length: 31 }, (_, index) => ({
    day: String(index + 1).padStart(2, '0'),
    last: Math.round(18000 + Math.sin(index / 2) * 2000 + (index % 7 === 0 ? 4000 : 0)),
    current: index < 6 ? Math.round(5000 + Math.cos(index) * 1500 + (index === 1 ? 14000 : 0)) : 0,
  }));
  return { series, monthly, daily };
}


function OperationSchedulePanel({ circuits, title, subtitle }) {
  if (!circuits.length) return null;
  return (
    <section className="panel panel-spacious fade-up">
      <div className="panel-header">
        <div>
          <div className="panel-title">{title}</div>
          <div className="panel-subtitle">{subtitle}</div>
        </div>
      </div>
      <div className="schedule-grid">
        {circuits.map((item) => (
          <div className="schedule-card" key={`${item.code}-${item.name}`}>
            <div>
              <div className="schedule-title">{item.name}</div>
              <div className="schedule-copy">{item.code} · {item.transformer || item.groupTitle || 'Circuito asociado'}</div>
            </div>
            <div className="schedule-times">
              <div><span>Arranque</span><strong>{item.startTime || '--:--'}</strong></div>
              <div><span>Paro</span><strong>{item.stopTime || '--:--'}</strong></div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CircuitSimpleList({ circuits, title, subtitle }) {
  if (!circuits.length) return null;
  return (
    <section className="panel panel-spacious fade-up">
      <div className="panel-header">
        <div>
          <div className="panel-title">{title}</div>
          <div className="panel-subtitle">{subtitle}</div>
        </div>
      </div>
      <div className="simple-chip-list">
        {circuits.map((item) => (
          <div className="simple-chip" key={`${item.code}-${item.name}`}>
            <strong>{item.name}</strong>
            <span>{item.code}</span>
          </div>
        ))}
      </div>
    </section>
  );
}


function SubstationView({ payload, rangeText }) {
  const charts = useMemo(() => buildSubstationCharts(payload.table_data), [payload.table_data]);
  return (
    <>
      <section className="cards-grid stagger-grid blue-cards">{payload.cards.map((card, index) => <KpiCard key={card.label} {...card} style={{ animationDelay: `${index * 70}ms` }} />)}</section>
      <section className="panel chart-panel fade-up blue-panel">
        <div className="panel-header compact"><div><div className="panel-title">Consumo Total Mensual</div><div className="panel-subtitle">{rangeText}</div></div></div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={charts.monthly}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
            <XAxis dataKey="month" stroke="#f3cad3" />
            <YAxis stroke="#f3cad3" />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
            <Bar dataKey="value" name="ARCA ZAPOPAN (kWh)" fill="#c40323" radius={[6, 6, 0, 0]} activeBar={false} />
          </BarChart>
        </ResponsiveContainer>
      </section>
      <section className="triple-grid">
        <div className="panel chart-panel fade-up blue-panel"><div className="panel-header compact"><div><div className="panel-title">Voltaje</div><div className="panel-subtitle">{rangeText}</div></div></div><ResponsiveContainer width="100%" height={290}><LineChart data={charts.series}><CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" /><XAxis dataKey="hour" stroke="#f3cad3" /><YAxis stroke="#f3cad3" /><Tooltip content={<ChartTooltip />} /><Legend /><Line dataKey="vAB" name="Voltage A-B (V)" stroke="#f04a62" dot={false} strokeWidth={2.2} /><Line dataKey="vBC" name="Voltage B-C (V)" stroke="#d18a49" dot={false} strokeWidth={2.2} /><Line dataKey="vCA" name="Voltage C-A (V)" stroke="#f6c2cb" dot={false} strokeWidth={2.2} /></LineChart></ResponsiveContainer></div>
        <div className="panel chart-panel fade-up blue-panel"><div className="panel-header compact"><div><div className="panel-title">Corriente</div><div className="panel-subtitle">{rangeText}</div></div></div><ResponsiveContainer width="100%" height={290}><LineChart data={charts.series}><CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" /><XAxis dataKey="hour" stroke="#f3cad3" /><YAxis stroke="#f3cad3" /><Tooltip content={<ChartTooltip />} /><Legend /><Line dataKey="iA" name="Current A Mean (A)" stroke="#f04a62" dot={false} strokeWidth={2.2} /><Line dataKey="iB" name="Current B Mean (A)" stroke="#d18a49" dot={false} strokeWidth={2.2} /><Line dataKey="iC" name="Current C Mean (A)" stroke="#f6c2cb" dot={false} strokeWidth={2.2} /></LineChart></ResponsiveContainer></div>
        <div className="panel chart-panel fade-up blue-panel"><div className="panel-header compact"><div><div className="panel-title">Potencia Activa</div><div className="panel-subtitle">{rangeText}</div></div></div><ResponsiveContainer width="100%" height={290}><LineChart data={charts.series}><CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" /><XAxis dataKey="hour" stroke="#f3cad3" /><YAxis stroke="#f3cad3" /><Tooltip content={<ChartTooltip />} /><Line dataKey="kw" name="Real Power (kW)" stroke="#e9082c" dot={false} strokeWidth={2.4} /></LineChart></ResponsiveContainer></div>
      </section>
      <section className="panel chart-panel fade-up blue-panel">
        <div className="panel-header compact"><div><div className="panel-title">Demanda Total</div><div className="panel-subtitle">{rangeText}</div></div></div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={charts.series}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
            <XAxis dataKey="hour" stroke="#f3cad3" /><YAxis stroke="#f3cad3" />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
            <Bar dataKey="demand" name="kW total (kW)" fill="#a0021c" radius={[4, 4, 0, 0]} activeBar={false} />
          </BarChart>
        </ResponsiveContainer>
      </section>
      <section className="panel chart-panel fade-up blue-panel">
        <div className="panel-header compact"><div><div className="panel-title">Consumo Total Diario</div><div className="panel-subtitle">{rangeText}</div></div></div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={charts.daily}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
            <XAxis dataKey="day" stroke="#f3cad3" /><YAxis stroke="#f3cad3" />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
            <Legend />
            <Bar dataKey="last" name="Último mes" fill="#f6c2cb" radius={[3, 3, 0, 0]} activeBar={false} />
            <Bar dataKey="current" name="Este mes" fill="#e9082c" radius={[3, 3, 0, 0]} activeBar={false} />
          </BarChart>
        </ResponsiveContainer>
      </section>
      <DataTable rows={payload.table_data} />
    </>
  );
}

function TransformerDetailView({ payload, section, rangeText }) {
  const charts = useMemo(() => buildTransformerCharts(payload.table_data), [payload.table_data]);
  const transformerGroups = useMemo(() => getCircuitsForTransformer(section), [section]);
  const transformerCircuits = useMemo(() => flattenCircuits(transformerGroups), [transformerGroups]);
  const circuitChartData = useMemo(
    () => buildTransformerCircuitChartData(transformerCircuits, payload.systems_data),
    [payload.systems_data, transformerCircuits],
  );
  const transformerCapacities = {
    transformador1: 1000,
    transformador2: 800,
    transformador3: 800,
    transformador4: 800,
    transformador5: 800,
  };
  const kvaCapacity = transformerCapacities[section] || 800;
  const latestKvaReading = [...charts].reverse().find((row) => Number.isFinite(row.kva));
  const currentTransformerKva = latestKvaReading?.kva ?? 0;
  const summaryCards = [
    ...payload.cards,
    {
      label: 'Carga actual del transformador',
      value: currentTransformerKva.toLocaleString('es-MX', { maximumFractionDigits: 2 }),
      unit: 'kVA',
      trend: 'Valor actual',
      accent: 'crimson',
    },
  ];

  return (
    <>
      <section className="cards-grid stagger-grid">{summaryCards.map((card, index) => <KpiCard key={`${card.label}-${index}`} {...card} style={{ animationDelay: `${index * 80}ms` }} />)}</section>
      <section className="panel chart-panel fade-up blue-panel">
        <div className="panel-header compact"><div><div className="panel-title">Capacidad de Transformador</div><div className="panel-subtitle">{rangeText}</div></div></div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={charts}>
            <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
            <XAxis dataKey="hour" stroke="#f3cad3" /><YAxis stroke="#f3cad3" domain={[0, kvaCapacity]} ticks={[0, kvaCapacity * 0.25, kvaCapacity * 0.5, kvaCapacity * 0.75, kvaCapacity]} tickFormatter={(value) => String(Math.round(Number(value || 0)))} width={48} />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine y={kvaCapacity} stroke="#ff4d4d" strokeWidth={2} label={{ value: '100%', fill: '#ff4d4d', position: 'insideTopLeft' }} />
            <ReferenceLine y={kvaCapacity * 0.85} stroke="#f8d34e" strokeWidth={2} label={{ value: '85%', fill: '#f8d34e', position: 'insideTopLeft' }} />
            <Line dataKey="kva" name={`${payload.title} Apparent Power (kVA)`} stroke="#e9082c" dot={false} strokeWidth={2.6} />
          </LineChart>
        </ResponsiveContainer>
      </section>
      <section className="triple-grid">
        <div className="panel chart-panel fade-up blue-panel"><div className="panel-header compact"><div><div className="panel-title">Voltaje</div><div className="panel-subtitle">{rangeText}</div></div></div><ResponsiveContainer width="100%" height={290}><LineChart data={charts}><CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" /><XAxis dataKey="hour" stroke="#f3cad3" /><YAxis stroke="#f3cad3" /><Tooltip content={<ChartTooltip />} /><Legend /><Line dataKey="vAB" name="Voltage A-B (V)" stroke="#f04a62" dot={false} strokeWidth={2.2} /><Line dataKey="vBC" name="Voltage B-C (V)" stroke="#d18a49" dot={false} strokeWidth={2.2} /><Line dataKey="vCA" name="Voltage C-A (V)" stroke="#f6c2cb" dot={false} strokeWidth={2.2} /></LineChart></ResponsiveContainer></div>
        <div className="panel chart-panel fade-up blue-panel"><div className="panel-header compact"><div><div className="panel-title">Corriente</div><div className="panel-subtitle">{rangeText}</div></div></div><ResponsiveContainer width="100%" height={290}><LineChart data={charts}><CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" /><XAxis dataKey="hour" stroke="#f3cad3" /><YAxis stroke="#f3cad3" /><Tooltip content={<ChartTooltip />} /><Legend /><Line dataKey="iA" name="Current A Mean (A)" stroke="#f04a62" dot={false} strokeWidth={2.2} /><Line dataKey="iB" name="Current B Mean (A)" stroke="#d18a49" dot={false} strokeWidth={2.2} /><Line dataKey="iC" name="Current C Mean (A)" stroke="#f6c2cb" dot={false} strokeWidth={2.2} /></LineChart></ResponsiveContainer></div>
        <div className="panel chart-panel fade-up blue-panel"><div className="panel-header compact"><div><div className="panel-title">Potencia Activa</div><div className="panel-subtitle">{rangeText}</div></div></div><ResponsiveContainer width="100%" height={290}><LineChart data={charts}><CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" /><XAxis dataKey="hour" stroke="#f3cad3" /><YAxis stroke="#f3cad3" /><Tooltip content={<ChartTooltip />} /><Line dataKey="kw" name="Real Power (kW)" stroke="#e9082c" dot={false} strokeWidth={2.4} /></LineChart></ResponsiveContainer></div>
      </section>
      <CircuitSimpleList circuits={transformerCircuits} title="Circuitos asociados" subtitle="Lista rápida de circuitos vinculados al transformador" />
      <OperationSchedulePanel circuits={transformerCircuits} title="Horas de arranque y paro" subtitle="Datos simulados por circuito para la demo" />
      <section className="stack-grid">
        <CircuitMetricChart data={circuitChartData} title="Potencia por Circuito" subtitle="Comparativo de kW por circuito" metricKey="kw" metricLabel="kW" colors={redPalette} />
        <CircuitMetricChart data={circuitChartData} title="Consumo por Circuito" subtitle="Comparativo de kWh por circuito" metricKey="kwh" metricLabel="kWh" colors={mutedRedPalette} />
      </section>
      <CircuitGrid groups={transformerGroups} title="Circuitos asociados al transformador" subtitle="Nombres y mediciones demo vinculadas al transformador" />
      <DataTable rows={payload.table_data} showVoltage />
    </>
  );
}

function GeneralView({ payload, section }) {
  const sectionGroups = getCircuitGroupsForSection(section);
  const circuitChartData = useMemo(() => flattenCircuits(sectionGroups), [sectionGroups]);
  const showSectionCharts = section !== 'dashboard' && sectionGroups.length > 0;
  const showLineSchedules = lineSections.has(section);

  return (
    <>
      {(section === 'dashboard' || section === 'linea1') && <section className="alert-banner fade-up">Línea 1 — Tensión fuera de rango nominal (±5%). Verificar acometida.</section>}
      <section className="cards-grid stagger-grid">{payload.cards.map((card, index) => <KpiCard key={card.label} {...card} style={{ animationDelay: `${index * 70}ms` }} />)}</section>
      <section className="content-grid">
        <div className="panel chart-panel fade-up">
          <div className="panel-header compact"><div><div className="panel-title">Demanda por Hora — Día Actual</div><div className="panel-subtitle">kW total y por línea</div></div></div>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={payload.hourly_data}><defs><linearGradient id="hourRed" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#e9082c" stopOpacity={0.24} /><stop offset="95%" stopColor="#e9082c" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" /><XAxis dataKey="hour" stroke="#73809a" /><YAxis stroke="#73809a" /><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="total" name="Total" stroke="#e9082c" fill="url(#hourRed)" strokeWidth={3} /><Line type="monotone" dataKey="l1" name="L1" stroke="#c40323" strokeWidth={2.2} dot={false} /><Line type="monotone" dataKey="l2" name="L2" stroke="#a0021c" strokeWidth={2.2} dot={false} /><Line type="monotone" dataKey="l3" name="L3" stroke="#8a3d26" strokeWidth={2.2} dot={false} /></AreaChart>
          </ResponsiveContainer>
        </div>
        <DistributionPanel section={section} payload={payload} sectionGroups={sectionGroups} />
      </section>
      {showLineSchedules ? <OperationSchedulePanel circuits={circuitChartData} title="Horas de arranque y paro" subtitle="Datos simulados por circuito para la línea seleccionada" /> : null}
      {showSectionCharts ? (
        <section className="stack-grid">
          <CircuitMetricChart data={circuitChartData} title="Potencia por Circuito" subtitle="Comparativo ejecutivo de kW por circuito" metricKey="kw" metricLabel="kW" colors={redPalette} />
          <CircuitMetricChart data={circuitChartData} title="Consumo por Circuito" subtitle="Comparativo ejecutivo de kWh por circuito" metricKey="kwh" metricLabel="kWh" colors={mutedRedPalette} />
        </section>
      ) : null}
      <CircuitGrid groups={section === 'dashboard' ? [] : sectionGroups} title={`Circuitos de ${payload.title}`} subtitle="Circuitos reales asociados a la agrupación seleccionada" />
      <DataTable rows={payload.table_data} />
    </>
  );
}

export default function DashboardPage({ plantId, section, setHeaderMeta }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const [filters, setFilters] = useState(() => getQuickRange(DEFAULT_FILTER_PRESET));
  const [draftFilters, setDraftFilters] = useState(() => getQuickRange(DEFAULT_FILTER_PRESET));
  const [alertSettings, setAlertSettings] = useState(getAlertSettings());
  const [activeAlert, setActiveAlert] = useState(null);

  useEffect(() => {
    if (section === 'alertas') {
      setHeaderMeta({
        title: 'Alertas',
        subtitle: 'Configuración de umbrales y visualización',
        onExport: () => {},
        onEmail: () => {},
      });
      setLoading(false);
      setError('');
      return;
    }

    const load = async () => {
      try {
        setLoading(true);
        const data = await fetchDashboard(plantId, section, filters);
        setPayload(data);
        setHeaderMeta({
          title: data.title,
          subtitle: data.subtitle,
          onExport: async (format) => {
            try {
              await downloadReport(plantId, section, format, filters);
              const label = format === 'excel' ? 'XLSX' : format.toUpperCase();
              setMessage(`Reporte ${label} generado correctamente.`);
            } catch (exportError) {
              console.error(exportError);
              setMessage('No fue posible generar el archivo solicitado. Revisa dependencias del backend.');
            }
          },
          onEmail: async () => {
            const response = await sendReportByEmail({ to: 'ia@rsrc.com.mx', plant_id: plantId, section, format: 'pdf', subject: `Reporte ${data.title}`, message: `Adjunto reporte automático de ${data.title}` });
            setMessage(response.message);
          },
        });
        setError('');
        const alerts = evaluateAlerts(data, getAlertSettings());
        setActiveAlert(getAlertSettings().enablePopup ? alerts[0] || null : null);
      } catch (err) {
        console.error(err);
        setError('No fue posible cargar la información del dashboard.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [plantId, section, setHeaderMeta, filters]);

  const sectionAlerts = useMemo(() => evaluateAlerts(payload, alertSettings), [payload, alertSettings]);

  const handleSaveAlerts = (next) => {
    const saved = saveAlertSettings(next);
    setAlertSettings(saved);
    setMessage('Configuración de alertas actualizada.');
  };


  const handleDraftChange = (key, value) => {
    if (key === 'preset') {
      if (!value) {
        setDraftFilters((current) => ({ ...current, preset: '' }));
        return;
      }
      setDraftFilters(getQuickRange(value, referenceDate));
      return;
    }
    setDraftFilters((current) => ({ ...current, [key]: value, preset: '' }));
  };

  const handleApplyFilters = () => {
    setFilters({
      startDate: draftFilters.startDate || '',
      endDate: draftFilters.endDate || '',
      preset: draftFilters.preset || '',
    });
    setMessage('Consulta actualizada según el rango seleccionado.');
  };

  const handleResetFilters = () => {
    const reset = getQuickRange(DEFAULT_FILTER_PRESET, referenceDate);
    setDraftFilters(reset);
    setFilters(reset);
    setMessage('Se restableció el rango de fechas al preset recomendado para la demo.');
  };

  const rangeText = formatRangeText(filters.startDate, filters.endDate);

  if (loading) return <div className="empty-state">Cargando dashboard...</div>;
  if (error) return <div className="empty-state error">{error}</div>;

  if (section === 'alertas') {
    return (
      <div className="page-grid">
        {message && <section className="success-banner fade-up">{message}</section>}
        <DateFilterBar values={filters} draft={draftFilters} onDraftChange={handleDraftChange} onApply={handleApplyFilters} onReset={handleResetFilters} disabled />
        <AlertSettingsPage payload={payload} settings={alertSettings} onSave={handleSaveAlerts} alerts={sectionAlerts} />
      </div>
    );
  }

  if (!payload) return null;

  return (
    <div className="page-grid">
      {message && <section className="success-banner fade-up">{message}</section>}
      <AlertPopup alert={activeAlert} onClose={() => setActiveAlert(null)} />
      <DateFilterBar values={filters} draft={draftFilters} onDraftChange={handleDraftChange} onApply={handleApplyFilters} onReset={handleResetFilters} />
      {section === 'subestacion' ? <SubstationView payload={payload} rangeText={rangeText} /> : transformerSections.has(section) ? <TransformerDetailView payload={payload} section={section} rangeText={rangeText} /> : <GeneralView payload={payload} section={section} />}
    </div>
  );
}
