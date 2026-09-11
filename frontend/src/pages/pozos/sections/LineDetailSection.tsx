import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, ArrowLeft, ClipboardCheck, Wrench } from 'lucide-react';
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchWaterDashboard } from '../../../services/waterService';
import { normalizeSqlLine } from '../normalizers';
import { buildLineTimeline } from '../chartBuilders';
import type { ChartDataPoint, DashboardData, FlexibleRecord } from '../types';
import ChartTooltip from '../components/ChartTooltip';
import PanelHeader from '../components/PanelHeader';
import StatusBadge from '../components/StatusBadge';
import SqlChartDateControls from '../components/SqlChartDateControls';
import ChartEmptyState from '../components/ChartEmptyState';
import ChartPeriodNote from '../components/ChartPeriodNote';
import useSqlChartDashboard from '../hooks/useSqlChartDashboard';
import { defaultTodayRange } from '../dateUtils';

const axisColor = '#b9e7ff';
const gridColor = 'rgba(56,189,248,0.14)';

interface LineDetailSectionProps {
  lineId?: string;
}

interface LineDetailItem extends FlexibleRecord {
  id: string;
  numero: number;
  name: string;
  nombre: string;
  ubicacion: string;
  status: string;
  statusType: string;
  estado_comunicacion: string;
  communicationType: string;
  flow: number;
  flujo_entrada: number;
  flujo_salida: number;
  totalizador_m3: number;
  updated: string;
  ultima_lectura: string;
  diagnosis: string;
  sensor_id?: string;
}

interface LineDetailProfile {
  diagnostic: {
    symptom: string;
    cause: string;
    priority: string;
  };
}

interface LineDetailResult {
  line: LineDetailItem;
  profile: LineDetailProfile;
}

interface LineTimelinePoint extends ChartDataPoint {
  time: string;
  flow: number;
  volumen: number;
  totalizador: number;
}

function errorMessage(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
}

function formatNumber(value: unknown, decimals = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return Number(value).toLocaleString('es-MX', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function getLineDetail(lineId: string | undefined, sqlDashboard: DashboardData | null): LineDetailResult {
  const lines = (sqlDashboard?.production_lines?.map(normalizeSqlLine) || []) as LineDetailItem[];
  const line = lines.find((item) => item.id === lineId) || lines[0] || {
    id: lineId || 'linea-1',
    numero: 1,
    name: 'Sin datos disponibles',
    nombre: 'Sin datos disponibles',
    ubicacion: 'Líneas de producción',
    status: 'Sin datos',
    statusType: 'idle',
    estado_comunicacion: 'Sin datos',
    communicationType: 'communication',
    flow: 0,
    flujo_entrada: 0,
    flujo_salida: 0,
    totalizador_m3: 0,
    updated: 'Sin datos',
    ultima_lectura: 'Sin datos',
    diagnosis: 'No hay registros disponibles para esta línea.',
  };
  return {
    line,
    profile: {
      diagnostic: {
        symptom: line.flow > 0 ? 'Flujo instantáneo disponible.' : 'Sin flujo instantáneo en la última lectura.',
        cause: 'Lectura actual de planta.',
        priority: line.flow > 0 ? 'Baja' : 'Revisar si aplica',
      },
    },
  };
}

export default function LineDetailSection({ lineId }: LineDetailSectionProps) {
  const navigate = useNavigate();
  const [sqlDashboard, setSqlDashboard] = useState<DashboardData | null>(null);
  const [sqlError, setSqlError] = useState('');
  const detailChart = useSqlChartDashboard('lineas', defaultTodayRange, {
    includeHistory: true,
    includeEnergyWater: false,
  });

  useEffect(() => {
    let mounted = true;
    fetchWaterDashboard('dashboard', { include_history: false, include_energy_water: false })
      .then((data) => { if (mounted) setSqlDashboard(data as DashboardData); })
      .catch((error) => { if (mounted) setSqlError(errorMessage(error) || 'No se pudo leer la fuente de monitoreo'); });
    return () => { mounted = false; };
  }, []);

  const { line, profile } = getLineDetail(lineId, sqlDashboard);
  const timeline = buildLineTimeline((detailChart.dashboard as DashboardData | null) || sqlDashboard, line) as LineTimelinePoint[];
  const historicalRows = timeline.slice(-8).reverse();
  const timelineMessage = detailChart.loading
    ? 'Cargando histórico de la línea seleccionada desde BOS...'
    : detailChart.error || 'Sin histórico real de línea para este rango.';

  return (
    <>
      <section className={`well-detail-hero panel fade-up ${line.statusType}`}>
        <div className="well-detail-main-head">
          <button type="button" className="back-inline-button" onClick={() => navigate('/pozos/lineas')}>
            <ArrowLeft size={16} /> Volver a Líneas
          </button>
          
          <div className="well-detail-title-row">
            <h2>{line.name}</h2>
            <StatusBadge type={line.statusType}>{line.status}</StatusBadge>
          </div>
          <p>{line.diagnosis || sqlError || 'Lectura actual de planta.'}</p>
        </div>
        <div className="well-detail-hero-metrics">
          <article>
            <span>Última actualización</span>
            <strong>{line.updated}</strong>
          </article>
          <article>
            <span>Flujo actual</span>
            <strong>{formatNumber(line.flow)} <small>L/s</small></strong>
          </article>
          <article>
            <span>Totalizador</span>
            <strong>{formatNumber(line.totalizador_m3, 0)} <small>m³</small></strong>
          </article>
          <article>
            <span>Sensor</span>
            <strong>{line.sensor_id || '—'}</strong>
          </article>
        </div>
      </section>

      <section className="content-grid well-detail-grid-main">
        <div className="panel chart-panel fade-up well-detail-flow-chart">
          <PanelHeader
            title="Flujo de línea"
            subtitle="Histórico filtrable de la línea seleccionada."
          />
          <SqlChartDateControls controller={detailChart} title="Fechas de la gráfica" />
          <ChartPeriodNote range={detailChart.range} source="Un día: flujo promedio por hora · varios días: flujo promedio por día" />
          {timeline.length ? (
            <ResponsiveContainer width="100%" height={430}>
              <ComposedChart data={timeline} margin={{ top: 10, right: 18, bottom: 8, left: 4 }}>
                <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                <XAxis dataKey="time" stroke={axisColor} />
                <YAxis yAxisId="flow" stroke={axisColor} />
                <YAxis yAxisId="total" orientation="right" stroke="#a855f7" />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'transparent' }} />
                <Legend />
                <Line yAxisId="flow" type="monotone" dataKey="flow" name="Flujo (L/s)" stroke="#14b8ff" strokeWidth={2.8} dot={{ r: 3 }} connectNulls={false} />
                <Line yAxisId="total" type="monotone" dataKey="volumen" name="Volumen del periodo (m³)" stroke="#a855f7" strokeWidth={2.6} dot={{ r: 3 }} connectNulls={false} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <ChartEmptyState message={timelineMessage} />}
        </div>

        <div className="panel summary-panel fade-up well-diagnostic-panel">
          <PanelHeader title="Diagnóstico sugerido" subtitle="Lectura rápida para operación" />
          <div className="diagnostic-stack">
            <article>
              <div className="diagnostic-icon"><Activity size={16} /></div>
              <div>
                <span>Síntoma</span>
                <strong>{profile.diagnostic?.symptom}</strong>
              </div>
            </article>
            <article>
              <div className="diagnostic-icon"><Wrench size={16} /></div>
              <div>
                <span>Posible causa</span>
                <strong>{profile.diagnostic?.cause}</strong>
              </div>
            </article>
            <article>
              <div className="diagnostic-icon"><ClipboardCheck size={16} /></div>
              <div>
                <span>Prioridad de revisión</span>
                <strong>{profile.diagnostic?.priority}</strong>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="panel table-wrapper fade-up well-history-panel">
        <PanelHeader title="Histórico corto" subtitle="Flujo y totalizador de la línea seleccionada" />
        <div className="pozos-table-scroll">
          <table className="pozos-operacion-table well-history-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Flujo</th>
                <th>Volumen periodo</th>
                <th>Totalizador</th>
              </tr>
            </thead>
            <tbody>
              {historicalRows.length ? historicalRows.map((row) => (
                <tr key={`${row.time}-${row.totalizador}`}>
                  <td>{row.time}</td>
                  <td>{formatNumber(row.flow)} L/s</td>
                  <td>{formatNumber(row.volumen, 2)} m³</td>
                  <td>{formatNumber(row.totalizador, 0)} m³</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4}>{timelineMessage}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
