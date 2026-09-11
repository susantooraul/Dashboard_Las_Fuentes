import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchWaterDashboard } from "../../../services/waterService";
import { getDailyWaterReport } from "../../../services/waterReportService";
import { normalizeSqlWell } from "../normalizers";
import { buildWellTimeline } from "../chartBuilders";
import type { DashboardData, FlexibleRecord } from "../types";
import ChartTooltip from "../components/ChartTooltip";
import ChartPeriodNote from "../components/ChartPeriodNote";
import ChartEmptyState from "../components/ChartEmptyState";
import PanelHeader from "../components/PanelHeader";
import SqlChartDateControls from "../components/SqlChartDateControls";
import StatusBadge from "../components/StatusBadge";
import useSqlChartDashboard from "../hooks/useSqlChartDashboard";
import { defaultTodayRange } from "../dateUtils";

const axisColor = "#b9e7ff";
const gridColor = "rgba(56,189,248,0.14)";

interface WellDetailSectionProps {
  wellId?: string;
  backPath?: string;
  backLabel?: string;
}

interface WellDetailItem extends FlexibleRecord {
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
  flow_status?: string;
  flujo_entrada_status?: string;
  flujo_salida_status?: string;
  totalizador_m3: number;
  kwh: number;
  dailyKwh: number | null;
  amps: number | null;
  efficiency: number | null;
  loadFactor: number | null;
  updated: string;
  ultima_lectura: string;
  diagnosis: string;
  period_m3?: number;
  period_delta_m3?: number;
  bombeado_hoy_m3?: number | null;
  bombeado_hoy_status?: string;
  bombeado_hoy_note?: string;
  period_kwh?: number;
  entry_m3?: number;
  kwh_por_m3?: number | null;
}

interface WellDetailProfile {
  diagnostic: {
    symptom: string;
    cause: string;
    priority: string;
  };
  averageEfficiency: number | null;
  loadFactorTarget: string;
  nominalAmps: number | null;
  pumpType: string;
  line: string;
  tank: string;
}

interface WellTimelinePoint extends FlexibleRecord {
  time: string;
  flow: number;
  energia?: number;
  amps?: number | null;
  efficiency?: number | null;
  loadFactor?: number | null;
  flowAvg?: number;
}

type NumericValue = number | string | null | undefined;

interface DailyWaterReportEntryRow extends FlexibleRecord {
  equipo?: string;
  ubicacion?: string;
  numero?: NumericValue;
  pozo?: NumericValue;
  well_id?: NumericValue;
  id?: NumericValue;
  suministro_m3?: NumericValue;
  kwh?: NumericValue;
}

interface DailyWaterReport {
  water_entry?: {
    rows?: DailyWaterReportEntryRow[];
  };
}

interface WellDetailResult {
  well: WellDetailItem;
  profile: WellDetailProfile;
  timeline: WellTimelinePoint[];
}

function formatNumber(value: NumericValue, decimals = 1): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(String(value).replace(",", "").trim());
  if (Number.isNaN(number)) return "—";
  return number.toLocaleString("es-MX", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function toNullableNumber(value: NumericValue): number | null {
  if (value === null || value === undefined || value === '') return null;
  const sanitized = String(value)
    .replace(/,/g, '')
    .replace(/[^0-9.-]/g, '')
    .trim();
  if (!sanitized) return null;
  const number = Number(sanitized);
  return Number.isNaN(number) ? null : number;
}

function bestPositiveNumber(candidates: unknown[]): number | null {
  const values = candidates
    .map((value) => toNullableNumber(value as NumericValue))
    .filter((value): value is number => value !== null);
  const positive = values.find((value) => value > 0);
  if (positive !== undefined) return positive;
  return values.length ? values[0] : null;
}

function totalizerCurrentValue(well: FlexibleRecord | null | undefined): number | null {
  if (!well) return null;
  return bestPositiveNumber([
    well.totalizador_actual_m3,
    well.last_totalizador_m3,
    well.totalizador_m3,
    well.last_flow_out_total_m3,
    well.last_flow_in_total_m3,
  ]);
}

function totalizerStartValue(well: FlexibleRecord | null | undefined): number | null {
  if (!well) return null;
  return bestPositiveNumber([
    well.totalizador_cierre_anterior_m3,
    well.totalizador_inicio_dia_m3,
    well.first_totalizador_m3,
    well.first_flow_out_total_m3,
    well.first_flow_in_total_m3,
  ]);
}

function pumpedTodayStatus(well: FlexibleRecord | null | undefined): string {
  return String(well?.bombeado_hoy_status || well?.water_status || '').trim().toLowerCase();
}

function pumpedTodayValue(well: FlexibleRecord | null | undefined, reportValue: number | null): number | null {
  if (reportValue !== null) return reportValue;
  const status = pumpedTodayStatus(well);
  if (status && status !== 'valid' && status !== 'ok') return null;
  return toNullableNumber((well?.bombeado_hoy_m3 ?? well?.period_m3 ?? well?.period_delta_m3 ?? well?.entry_m3) as NumericValue);
}

function pumpedTodayLabel(well: FlexibleRecord | null | undefined, value: number | null): string {
  if (pumpedTodayStatus(well) === 'invalid_delta') return 'Dato en revisión';
  return value === null ? '—' : formatNumber(value, 2);
}

function pumpedYesterdayStatus(well: FlexibleRecord | null | undefined): string {
  return String(well?.bombeado_ayer_status || '').trim().toLowerCase();
}

function pumpedYesterdayValue(well: FlexibleRecord | null | undefined): number | null {
  const status = pumpedYesterdayStatus(well);
  if (status && status !== 'valid' && status !== 'ok') return null;
  return toNullableNumber(well?.bombeado_ayer_m3 as NumericValue);
}

function pumpedYesterdayLabel(well: FlexibleRecord | null | undefined, value: number | null): string {
  const status = pumpedYesterdayStatus(well);
  if (status === 'invalid_delta') return 'Dato en revisión';
  return value === null ? 'Sin datos' : formatNumber(value, 2);
}

function flowStatus(well: FlexibleRecord | null | undefined): string {
  return String(well?.flow_status || well?.flujo_status || well?.flow_lps_status || '').trim().toLowerCase();
}

function flowLabel(well: FlexibleRecord | null | undefined): string {
  if (flowStatus(well) === 'invalid_flow') return 'Dato en revisión';
  return formatNumber((well?.flow ?? 0) as NumericValue);
}

function flowUnit(well: FlexibleRecord | null | undefined): string {
  return flowStatus(well) === 'invalid_flow' ? '' : 'L/s';
}

const ENERGY_HIDDEN_WELL_NUMBER = 10;

function operationalWellNumber(well: FlexibleRecord | null | undefined): number {
  if (!well) return 0;
  const direct = Number(well.numero ?? well.pozo ?? well.well_number ?? 0);
  if (Number.isFinite(direct) && direct > 0) return Math.trunc(direct);
  const match = String(well.id ?? well.nombre ?? well.name ?? '').match(/(\d+)/);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function isEnergyHiddenWellDetail(well: FlexibleRecord | null | undefined): boolean {
  return operationalWellNumber(well) === ENERGY_HIDDEN_WELL_NUMBER;
}

function displayWellDetailTitle(well: WellDetailItem): string {
  const number = operationalWellNumber(well);
  const primary = number ? `Pozo ${number}` : 'Pozo';
  const detail = String(well.ubicacion || well.nombre || well.name || '').trim();
  const cleanDetail = number
    ? detail.replace(new RegExp(`^Pozo\s*(?:#|No\.?|Num\.?|Núm\.?)?\s*0*${number}\s*[-–—:]?\s*`, 'i'), '').trim()
    : detail;
  if (!cleanDetail || cleanDetail.toLowerCase() === primary.toLowerCase()) return primary;
  return `${primary} - ${cleanDetail}`;
}

function buildWellEnergyRequestParams(well: FlexibleRecord): Record<string, number> {
  const params: Record<string, number> = {};
  const wellId = toNullableNumber((well.well_id ?? well.numero) as NumericValue);
  const energySensorId = toNullableNumber(well.energy_sensor_id as NumericValue);
  const waterSensorId = toNullableNumber((well.water_sensor_id ?? well.flow_out_sensor_id) as NumericValue);

  if (wellId) params.well_id = wellId;
  if (energySensorId) params.sensor_id_1 = energySensorId;
  if (waterSensorId) params.sensor_id_2 = waterSensorId;
  return params;
}

function hasSpecificWellEnergyFilter(params: Record<string, unknown>): boolean {
  return Boolean(params.well_id || params.sensor_id_1 || params.sensor_id_2);
}

function energyHistoryUnavailableMessage(
  hasSpecificFilter: boolean,
  dashboard: DashboardData | null,
  error = '',
): string {
  if (error) return error;
  if (!hasSpecificFilter) {
    return 'Sin sensores específicos de energía/agua para consultar este pozo.';
  }
  if (String(dashboard?.source_status || '').includes('error')) {
    return 'Sin conexión a la fuente de monitoreo para consultar el histórico.';
  }
  return 'Sin histórico real de agua y energía para este pozo en el rango seleccionado.';
}

function extractNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const direct = Number(String(value).replace(/[^0-9.-]/g, ''));
  if (!Number.isNaN(direct) && direct > 0) return direct;
  const match = String(value).match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function normalizeMatchText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findReportEntryForWell(
  report: DailyWaterReport | null,
  well: WellDetailItem,
): DailyWaterReportEntryRow | null {
  const rows = report?.water_entry?.rows || [];
  if (!rows.length) return null;

  const wellNumber = Number(well.numero || 0);
  const expectedEquipment = wellNumber
    ? normalizeMatchText(`Pozo #${wellNumber}`)
    : "";
  const wellLabels = [well.name, well.nombre, well.ubicacion]
    .map(normalizeMatchText)
    .filter(Boolean);

  return rows.find((row) => {
    const equipment = normalizeMatchText(row.equipo);
    const location = normalizeMatchText(row.ubicacion);
    const rowNumber = extractNumber(row.numero ?? row.pozo ?? row.well_id ?? row.id ?? row.equipo);

    if (wellNumber && rowNumber === wellNumber) return true;
    if (expectedEquipment && equipment === expectedEquipment) return true;

    return wellLabels.some((label) => (
      Boolean(label)
      && Boolean(location)
      && (location === label || location.includes(label) || label.includes(location))
    ));
  }) || null;
}

function getReportDailySupplyM3(reportEntry: DailyWaterReportEntryRow | null): number | null {
  // Debe coincidir con Reporte Diario > Entrada de Agua > Suministro m³.
  // No usar kWh, energía, totalizador acumulado ni última lectura como sustituto.
  return reportEntry ? toNullableNumber(reportEntry.suministro_m3) : null;
}

function reportParamsFromRange(range: FlexibleRecord): { date?: string; startDate?: string; endDate?: string } {
  const startDate = typeof range.startDate === 'string' ? range.startDate : undefined;
  const endDate = typeof range.endDate === 'string' ? range.endDate : undefined;
  if (startDate && endDate && startDate === endDate) return { date: startDate };
  return { startDate, endDate };
}

function getWellDetail(wellId: string | undefined, sqlDashboard: DashboardData | null): WellDetailResult {
  const sqlWells = (sqlDashboard?.wells?.map(normalizeSqlWell) || []) as WellDetailItem[];
  const well = sqlWells.find((item) => item.id === wellId) || sqlWells[0] || {
    id: wellId || 'pozo-1',
    numero: 1,
    name: 'Sin datos disponibles',
    nombre: 'Sin datos disponibles',
    ubicacion: 'ARCA',
    status: 'Sin datos',
    statusType: 'idle',
    estado_comunicacion: 'Sin datos',
    communicationType: 'communication',
    flow: 0,
    flujo_entrada: 0,
    flujo_salida: 0,
    totalizador_m3: 0,
    kwh: 0,
    dailyKwh: 0,
    amps: null,
    efficiency: null,
    loadFactor: null,
    updated: 'Sin datos',
    ultima_lectura: 'Sin datos',
    diagnosis: 'No hay registros disponibles para el rango seleccionado.',
  };
  const profile = {
    diagnostic: {
      symptom: well.flow > 0 ? 'Flujo instantáneo disponible.' : 'Sin flujo instantáneo en el último registro del rango.',
      cause: 'Lectura actual de planta.',
      priority: well.flow > 0 ? 'Baja' : 'Revisar si aplica',
    },
    averageEfficiency: null,
    loadFactorTarget: 'No disponible',
    nominalAmps: null,
    pumpType: 'No disponible',
    line: 'No disponible',
    tank: 'No disponible',
  };
  const timeline = [
    {
      time: well.ultima_lectura || well.updated || "Último registro",
      flow: well.flow || 0,
      amps: well.amps ?? null,
      efficiency: null,
      loadFactor: null,
    },
  ];
  return { well, profile, timeline };
}

export default function WellDetailSection({
  wellId,
  backPath = "/pozos/pozos",
  backLabel = "Volver a Pozos",
}: WellDetailSectionProps) {
  const navigate = useNavigate();
  const [sqlDashboard, setSqlDashboard] = useState<DashboardData | null>(null);
  const [sqlError, setSqlError] = useState("");
  const [dailyReport, setDailyReport] = useState<DailyWaterReport | null>(null);
  const [dailyReportError, setDailyReportError] = useState("");

  const previewDetail = getWellDetail(wellId, sqlDashboard);
  const detailRequestParams = useMemo(
    () => buildWellEnergyRequestParams(previewDetail.well),
    [
      previewDetail.well.well_id,
      previewDetail.well.numero,
      previewDetail.well.energy_sensor_id,
      previewDetail.well.water_sensor_id,
      previewDetail.well.flow_out_sensor_id,
      previewDetail.well.flow_in_sensor_id,
    ],
  );
  const hasDetailEnergyFilters =
    hasSpecificWellEnergyFilter(detailRequestParams);
  const previewHideEnergyFields = isEnergyHiddenWellDetail(previewDetail.well);
  const detailChart = useSqlChartDashboard("pozos", defaultTodayRange, {
    includeHistory: true,
    includeEnergyWater: hasDetailEnergyFilters && !previewHideEnergyFields,
    includePeriodDeltas: true,
    enabled: hasDetailEnergyFilters,
    params: detailRequestParams,
  });

  useEffect(() => {
    let mounted = true;
    fetchWaterDashboard('dashboard', {
      include_history: false,
      include_energy_water: false,
      include_period_deltas: true,
    })
      .then((data) => { if (mounted) setSqlDashboard(data as DashboardData); })
      .catch((error) => { if (mounted) setSqlError((error as { message?: string })?.message || 'No se pudo leer la fuente de monitoreo'); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    setDailyReportError("");
    getDailyWaterReport(reportParamsFromRange(detailChart.range))
      .then((report) => {
        if (mounted) setDailyReport(report as DailyWaterReport);
      })
      .catch((error) => {
        if (mounted) {
          setDailyReport(null);
          setDailyReportError(
            (error as { message?: string })?.message ||
              "No se pudo leer el reporte diario",
          );
        }
      });
    return () => {
      mounted = false;
    };
  }, [
    detailChart.range.startDate,
    detailChart.range.endDate,
    detailChart.range.refreshKey,
  ]);

  const dashboardForDetail = (detailChart.dashboard ||
    sqlDashboard) as DashboardData | null;
  const { well, profile } = getWellDetail(wellId, dashboardForDetail);
  const hideEnergyFields = isEnergyHiddenWellDetail(well);
  const wellDisplayTitle = displayWellDetailTitle(well);
  const reportEntry = findReportEntryForWell(dailyReport, well);
  const supplyM3 = getReportDailySupplyM3(reportEntry);
  const pumpedTodayM3 = pumpedTodayValue(well, supplyM3);
  const pumpedYesterdayM3 = pumpedYesterdayValue(well);
  const totalizerStartToday = totalizerStartValue(well);
  const totalizerCurrent = totalizerCurrentValue(well);
  const energyKwh = reportEntry ? toNullableNumber(reportEntry.kwh) : toNullableNumber(well.period_kwh);
  const timeline = buildWellTimeline(dashboardForDetail, wellId ? well : null) as WellTimelinePoint[];
  const efficiencyRows = timeline.filter((row) => {
    const value = Number(row.efficiency ?? 0);
    return Number.isFinite(value) && value > 0;
  });
  const hasEfficiencyData = !hideEnergyFields && efficiencyRows.length > 0;
  const latestEfficiencyRow = efficiencyRows.length ? efficiencyRows[efficiencyRows.length - 1] : null;
  const currentEfficiency = toNullableNumber((well.efficiency ?? latestEfficiencyRow?.efficiency) as NumericValue);
  const profileAverageEfficiency = toNullableNumber(profile.averageEfficiency as NumericValue);
  const periodAverageEfficiency =
    efficiencyRows.length >= 2
      ? efficiencyRows.reduce((sum, row) => sum + Number(row.efficiency || 0), 0) /
        efficiencyRows.length
      : null;
  const efficiencyReference =
    profileAverageEfficiency !== null ? profileAverageEfficiency : periodAverageEfficiency;
  const efficiencyReferenceLabel =
    profileAverageEfficiency !== null
      ? "Promedio referencia"
      : periodAverageEfficiency !== null
        ? "Promedio del periodo"
        : "Promedio referencia";
  const efficiencyGap =
    currentEfficiency !== null && efficiencyReference !== null
      ? currentEfficiency - efficiencyReference
      : null;
  const hasNominalAmps = !hideEnergyFields && profile.nominalAmps !== null;
  const historicalRows = timeline.slice(-5).reverse();
  const timelineMessage = detailChart.loading
    ? hideEnergyFields
      ? "Cargando histórico de agua para este pozo..."
      : "Cargando histórico de agua y energía para este pozo..."
    : hideEnergyFields
      ? detailChart.error ||
        "Sin histórico real de agua para este pozo en el rango seleccionado."
      : energyHistoryUnavailableMessage(
          hasDetailEnergyFilters,
          dashboardForDetail,
          detailChart.error,
        );

  return (
    <>
      <section className={`well-detail-hero panel fade-up ${well.statusType}`}>
        <div className="well-detail-main-head">
          <button
            type="button"
            className="back-inline-button"
            onClick={() => navigate(backPath)}
          >
            <ArrowLeft size={16} /> {backLabel}
          </button>
          
          <div className="well-detail-title-row">
            <h2>{wellDisplayTitle}</h2>
            <StatusBadge type={well.statusType}>{well.status}</StatusBadge>
          </div>
          <p>{well.diagnosis}</p>
        </div>
        <div className="well-detail-hero-metrics">
          <article>
            <span>Última actualización</span>
            <strong>{well.updated}</strong>
          </article>
          <article>
            <span>Flujo actual</span>
            <strong>
              {flowLabel(well)} <small>{flowUnit(well)}</small>
            </strong>
          </article>
          {!hideEnergyFields ? (
            <article>
              <span>Amperaje actual</span>
              <strong>
                {well.amps === null || well.amps === undefined
                  ? "—"
                  : formatNumber(well.amps, 2)}{" "}
                <small>
                  {well.amps === null || well.amps === undefined ? "" : "A"}
                </small>
              </strong>
            </article>
          ) : null}
          <article>
            <span>Bombeado hoy</span>
            <strong>
              {pumpedTodayLabel(well, pumpedTodayM3)}{" "}
              <small>{pumpedTodayM3 === null || pumpedTodayStatus(well) === 'invalid_delta' ? "" : "m³"}</small>
            </strong>
          </article>
          <article>
            <span>Agua bombeada ayer</span>
            <strong>
              {pumpedYesterdayLabel(well, pumpedYesterdayM3)}{" "}
              <small>{pumpedYesterdayM3 === null || pumpedYesterdayStatus(well) === 'invalid_delta' ? "" : "m³"}</small>
            </strong>
          </article>
          <article>
            <span>Totalizador Cierre Anterior</span>
            <strong>
              {totalizerStartToday === null ? "—" : formatNumber(totalizerStartToday, 2)}{" "}
              <small>{totalizerStartToday === null ? "" : "m³"}</small>
            </strong>
          </article>
          <article>
            <span>Totalizador actual</span>
            <strong>
              {totalizerCurrent === null ? "—" : formatNumber(totalizerCurrent, 2)}{" "}
              <small>{totalizerCurrent === null ? "" : "m³"}</small>
            </strong>
          </article>
          {!hideEnergyFields ? (
            <article>
              <span>Energía periodo</span>
              <strong>
                {energyKwh === null ? "—" : formatNumber(energyKwh, 2)}{" "}
                <small>{energyKwh === null ? "" : "kWh"}</small>
              </strong>
            </article>
          ) : null}
        </div>
      </section>

      <section className="content-grid well-detail-grid-main">
        <div className="panel chart-panel fade-up well-detail-flow-chart">
          <PanelHeader
            title="Agua y energía por periodo"
            subtitle="Histórico filtrable para este pozo"
          />
          <SqlChartDateControls controller={detailChart} />
          <ChartPeriodNote
            range={detailChart.range}
            source="Un día: puntos por hora · varios días: puntos por día"
          />
          {timeline.length ? (
            <ResponsiveContainer width="100%" height={430}>
              <ComposedChart
                data={timeline}
                margin={{ top: 10, right: 18, bottom: 8, left: 4 }}
              >
                <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                <XAxis dataKey="time" stroke={axisColor} />
                <YAxis yAxisId="flow" stroke={axisColor} />
                {!hideEnergyFields ? (
                  <YAxis yAxisId="amps" orientation="right" stroke="#f59e0b" />
                ) : null}
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ fill: "transparent" }}
                />
                <Legend />
                <Line
                  yAxisId="flow"
                  type="monotone"
                  dataKey="flow"
                  name="Agua bombeada (m³)"
                  stroke="#14b8ff"
                  strokeWidth={2.8}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
                {!hideEnergyFields ? (
                  <Line
                    yAxisId="amps"
                    type="monotone"
                    dataKey="energia"
                    name="Energía (kWh)"
                    stroke="#f59e0b"
                    strokeWidth={2.6}
                    dot={{ r: 3 }}
                    connectNulls={false}
                  />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ChartEmptyState message={timelineMessage} />
          )}
        </div>
      </section>

      <section className="content-grid well-detail-secondary-grid">
        {!hideEnergyFields ? (
          <div className="panel summary-panel fade-up">
            <PanelHeader
              title="Eficiencia energética"
              subtitle="kWh/m³ calculado solo con agua y energía válidas"
            />
            {hasEfficiencyData ? (
              <>
                <div className="well-efficiency-card">
                  <div>
                    <span>Actual</span>
                    <strong>
                      {currentEfficiency === null
                        ? "—"
                        : currentEfficiency.toFixed(2)}{" "}
                      <small>{currentEfficiency === null ? "" : "kWh/m³"}</small>
                    </strong>
                  </div>
                  <div>
                    <span>{efficiencyReferenceLabel}</span>
                    <strong>
                      {efficiencyReference === null
                        ? "No disponible"
                        : efficiencyReference.toFixed(2)}{" "}
                      <small>{efficiencyReference === null ? "" : "kWh/m³"}</small>
                    </strong>
                  </div>
                  <div
                    className={
                      efficiencyGap && efficiencyGap > 0.12
                        ? "efficiency-gap warning"
                        : "efficiency-gap"
                    }
                  >
                    <span>Diferencia</span>
                    <strong>
                      {efficiencyGap === null
                        ? "—"
                        : `${efficiencyGap > 0 ? "+" : ""}${efficiencyGap.toFixed(2)}`}
                    </strong>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={efficiencyRows}>
                    <CartesianGrid stroke={gridColor} strokeDasharray="3 3" />
                    <XAxis dataKey="time" stroke={axisColor} />
                    <YAxis stroke={axisColor} domain={[0, "auto"]} />
                    <Tooltip
                      content={<ChartTooltip />}
                      cursor={{ fill: "transparent" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="efficiency"
                      name="kWh/m³"
                      stroke="#38bdf8"
                      strokeWidth={2.4}
                      dot={false}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </>
            ) : (
              <ChartEmptyState message="Sin datos suficientes de energía para calcular eficiencia en este pozo." />
            )}
          </div>
        ) : null}

        {hasNominalAmps ? (
          <div className="panel summary-panel fade-up">
            <PanelHeader title="Datos eléctricos" subtitle="Información operativa disponible" />
            <div className="metadata-list">
              <div>
                <span>Amperaje nominal</span>
                <strong>{profile.nominalAmps} A</strong>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel table-wrapper fade-up well-history-panel">
        <PanelHeader title="Histórico corto" subtitle="Periodo filtrado desde la fuente disponible" />
        <div className="pozos-table-scroll">
          <table className="pozos-operacion-table well-history-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Agua periodo</th>
                {!hideEnergyFields ? <th>Energía periodo</th> : null}
                {!hideEnergyFields ? <th>Amperaje prom.</th> : null}
                {!hideEnergyFields ? <th>kWh/m³</th> : null}
                <th>Flujo promedio</th>
              </tr>
            </thead>
            <tbody>
              {historicalRows.length ? (
                historicalRows.map((row) => (
                  <tr key={row.time}>
                    <td>{row.time}</td>
                    <td>{formatNumber(row.flow, 2)} m³</td>
                    {!hideEnergyFields ? (
                      <td>{formatNumber(row.energia, 2)} kWh</td>
                    ) : null}
                    {!hideEnergyFields ? (
                      <td>
                        {row.amps === null || row.amps === undefined
                          ? "—"
                          : `${formatNumber(row.amps, 2)} A`}
                      </td>
                    ) : null}
                    {!hideEnergyFields ? (
                      <td>
                        {row.efficiency ? row.efficiency.toFixed(2) : "—"}
                      </td>
                    ) : null}
                    <td>
                      {row.flowAvg
                        ? `${formatNumber(row.flowAvg, 2)} L/s`
                        : "—"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={hideEnergyFields ? 3 : 6}>{timelineMessage}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
