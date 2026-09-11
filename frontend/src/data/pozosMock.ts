type NullableNumber = number | null;

export interface MockKpi {
  label: string;
  value: string | number;
  unit: string;
  trend: string;
  accent?: string;
}

export interface WellStatusSummaryItem {
  name: string;
  status: string;
  statusType: string;
  flow: number;
  amps: number;
  efficiency: number;
  diagnosis: string;
  updated: string;
}

export interface ProductionEnergyPoint {
  hour: string;
  agua: number;
  energia: number;
}

export interface InspectionPriorityItem {
  title: string;
  type: string;
  detail: string;
  priority: string;
}

export interface TankSummaryItem {
  name: string;
  level: number;
  volume: number;
  capacity: number;
  status: string;
}

export interface PozosHourlyFlowPoint {
  hour: string;
  entrada: number;
  tratada: number;
  suave: number;
  cruda: number;
}

export interface NameValuePoint {
  name: string;
  value: number;
}

export interface TankDetailItem {
  name: string;
  shortName: string;
  type: string;
  metros: number;
  m3: number;
  capacidad: number;
  llenado: number;
  tendencia: string;
  estado: string;
  statusType: string;
  riesgo: string;
}

export interface TankLevelTrendPoint {
  hour: string;
  tratadaNorte: number;
  suaveProceso: number;
  crudaReserva: number;
  recuperada: number;
}

export interface TankAlertItem {
  tank: string;
  type: string;
  detail: string;
  priority: string;
  statusType: string;
}

export interface DayWaterPoint {
  day: string;
  filtros: number;
  tratada: number;
}

export interface DayConsumptionPoint {
  day: string;
  consumo: number;
}

export interface MonthlyAveragePoint {
  month: string;
  entrada: number;
  tratada: number;
  cruda: number;
  suave: number;
}

export interface WaterBalanceDailySummary {
  produced: number;
  output: number;
  status: string;
  note: string;
  peakVariation: string;
  peakNote: string;
  recommendation: string;
  recommendationNote: string;
}

export interface WaterBalanceByTypeItem {
  type: string;
  tag: string;
  producida: number;
  salida: number;
  producedPct: number;
  outputPct: number;
  status: string;
  statusType: string;
  note: string;
}

export interface WaterBalanceTrendPoint {
  hour: string;
  producida: number;
  salida: number;
  diferencia: number;
  cruda: number;
  recuperada: number;
  suave: number;
}

export interface ReportCardItem {
  title: string;
  description: string;
  status: string;
}

export interface ConcessionItem {
  name: string;
  volumen: string;
  vigencia: string;
  status: string;
}

export interface ConcessionSummary {
  authorized: number;
  used: number;
  remaining: number;
  usedPct: number;
  period: string;
  validity: string;
  cutoff: string;
  status: string;
}

export interface ConcessionProjection {
  trend: string;
  trendNote: string;
  projectedUsed: number;
  projectedRemaining: number;
  projectedPct: number;
  recommendation: string;
}

export interface ConcessionHistoryPoint {
  month: string;
  consumo: number;
  acumulado: number;
  proyeccion: number;
}

export interface ConcessionAlertItem {
  title: string;
  detail: string;
  priority: string;
  level: string;
}

export interface WellOperationalStatusItem {
  id: string;
  numero: number;
  name: string;
  nombre: string;
  ubicacion: string;
  estado_operativo: string;
  apagado_manual: boolean;
  status: string;
  statusType: string;
  estado_comunicacion: string;
  communicationType: string;
  kwh: NullableNumber;
  totalizador_m3: NullableNumber;
  flujo_entrada: NullableNumber;
  flujo_salida: NullableNumber;
  flow: NullableNumber;
  dailyKwh: NullableNumber;
  amps: NullableNumber;
  efficiency: NullableNumber;
  loadFactor: NullableNumber;
  ampFlowRatio: NullableNumber;
  diagnosis: string;
  ultima_lectura: string;
  updated: string;
}

export interface DailyReviewPriorityItem {
  type: string;
  target: string;
  description: string;
  metric: string;
  owner: string;
  priority: string;
  level: string;
}

export interface DailyReviewRankingItem {
  name: string;
  score: number;
  reason: string;
  action: string;
}

export interface DailyReviewDiagnosticItem {
  well: string;
  symptom: string;
  cause: string;
  action: string;
  priority: string;
  level: string;
}

export interface ChecklistItem {
  title: string;
  detail: string;
}

export interface WellDetailProfile {
  nominalAmps: number;
  pumpType: string;
  line: string;
  tank: string;
  averageEfficiency: number;
  loadFactorTarget: string;
  symptom: string;
  cause: string;
  priority: string;
}

export interface WellDetailProfileWithDiagnostic extends WellDetailProfile {
  diagnostic: {
    symptom: string;
    cause: string;
    priority: string;
  };
}

export interface WellTimelinePoint {
  time: string;
  flow: NullableNumber;
  amps: NullableNumber;
  efficiency: NullableNumber;
  loadFactor: NullableNumber;
}

export interface UvOperationalSummary {
  currentFlow: number;
  lastUpdate: string;
  communication: string;
  communicationType: string;
  inferredState: string;
  inferredStateType: string;
  uvPoint: string;
  line: string;
  tank: string;
  note: string;
}

export interface UvFlowTrendPoint {
  hour: string;
  flow: number;
  state: string;
}

export interface UvOperationalLogPoint extends UvFlowTrendPoint {
  communication: string;
  lastReading: string;
  reference: string;
}

export interface UvAssociatedContextItem {
  label: string;
  value: string;
  detail: string;
}

export const resumenKpis: MockKpi[] = [
  {
    label: 'Volumen bombeado hoy',
    value: '7,842',
    unit: 'm³',
    trend: '+4.8% vs promedio operativo · corte 14:30',
    accent: 'red',
  },
  {
    label: 'Consumo total hoy',
    value: '12,460',
    unit: 'kWh',
    trend: 'Carga acumulada de bombas principales',
    accent: 'crimson',
  },
  {
    label: 'Eficiencia global',
    value: '1.59',
    unit: 'kWh/m³',
    trend: 'Meta diaria 1.55 kWh/m³',
    accent: 'wine',
  },
  {
    label: 'Concesión usada',
    value: '68.4',
    unit: '%',
    trend: 'Uso acumulado del periodo autorizado',
    accent: 'brown',
  },
  {
    label: 'Pozos activos',
    value: '8 / 10',
    unit: 'operando',
    trend: '1 en reserva · 1 detenido por inspección',
    accent: 'red',
  },
  {
    label: 'Alertas activas',
    value: '5',
    unit: 'prioridades',
    trend: '2 críticas · 3 preventivas',
    accent: 'crimson',
  },
];

export const wellsStatusSummary: WellStatusSummaryItem[] = [
  {
    name: 'Pozo Norte 01',
    status: 'Operando',
    statusType: 'normal',
    flow: 62.4,
    amps: 78,
    efficiency: 1.48,
    diagnosis: 'Dentro de rango',
    updated: '14:28',
  },
  {
    name: 'Pozo Norte 02',
    status: 'Operando',
    statusType: 'normal',
    flow: 58.1,
    amps: 74,
    efficiency: 1.52,
    diagnosis: 'Carga estable',
    updated: '14:27',
  },
  {
    name: 'Pozo Sur 01',
    status: 'Revisar',
    statusType: 'warning',
    flow: 44.8,
    amps: 82,
    efficiency: 1.83,
    diagnosis: 'kWh/m³ elevado',
    updated: '14:26',
  },
  {
    name: 'Pozo Sur 02',
    status: 'Operando',
    statusType: 'normal',
    flow: 51.6,
    amps: 69,
    efficiency: 1.41,
    diagnosis: 'Buen rendimiento',
    updated: '14:29',
  },
  {
    name: 'Pozo Reserva 01',
    status: 'Reserva',
    statusType: 'idle',
    flow: 0,
    amps: 0,
    efficiency: 0,
    diagnosis: 'Disponible para arranque',
    updated: '13:55',
  },
  {
    name: 'Pozo Oriente 01',
    status: 'Alerta',
    statusType: 'alert',
    flow: 36.2,
    amps: 88,
    efficiency: 2.04,
    diagnosis: 'Flujo bajo con amperaje alto',
    updated: '14:25',
  },
];

export const productionEnergyToday: ProductionEnergyPoint[] = [
  { hour: '00:00', agua: 342, energia: 520 },
  { hour: '03:00', agua: 368, energia: 548 },
  { hour: '06:00', agua: 418, energia: 642 },
  { hour: '09:00', agua: 524, energia: 828 },
  { hour: '12:00', agua: 596, energia: 948 },
  { hour: '15:00', agua: 566, energia: 904 },
  { hour: '18:00', agua: 498, energia: 792 },
  { hour: '21:00', agua: 430, energia: 668 },
];

export const inspectionPriorities: InspectionPriorityItem[] = [
  {
    title: 'Pozo Oriente 01',
    type: 'Desviación de kWh/m³',
    detail: '2.04 kWh/m³ contra meta 1.55. Revisar bomba y válvula de descarga.',
    priority: 'Crítica',
  },
  {
    title: 'Pozo Sur 01',
    type: 'Flujo anómalo',
    detail: 'Caída de 12% en flujo con amperaje arriba del promedio.',
    priority: 'Alta',
  },
  {
    title: 'Tanque tratada norte',
    type: 'Tanque bajo',
    detail: 'Nivel al 42%. Programar recuperación antes del pico vespertino.',
    priority: 'Media',
  },
  {
    title: 'Concesión pozo norte',
    type: 'Concesión alta',
    detail: 'Uso mensual estimado al 87% si se mantiene el ritmo actual.',
    priority: 'Preventiva',
  },
];

export const tankSummary: TankSummaryItem[] = [
  { name: 'Tratada norte', level: 42, volume: 176, capacity: 420, status: 'Bajo' },
  { name: 'Suave proceso', level: 71, volume: 214, capacity: 300, status: 'Normal' },
  { name: 'Cruda reserva', level: 74, volume: 289, capacity: 390, status: 'Normal' },
  { name: 'Recuperada', level: 63, volume: 126, capacity: 200, status: 'Normal' },
];

export const waterBalanceMini: MockKpi[] = [
  { label: 'Agua cruda', value: 1860, unit: 'm³', trend: '+3.2% vs ayer' },
  { label: 'Agua recuperada', value: 428, unit: 'm³', trend: '18.6% del volumen tratado' },
  { label: 'Agua suave', value: 965, unit: 'm³', trend: 'Demanda estable' },
];

export const pozosKpis: MockKpi[] = [
  {
    label: 'Entrada total de agua',
    value: '1,248',
    unit: 'm³/día',
    trend: 'Promedio de ingreso consolidado por pozo en las últimas 24 h',
    accent: 'red',
  },
  {
    label: 'Agua tratada disponible',
    value: '812',
    unit: 'm³/día',
    trend: 'Producción neta posterior a filtración y tratamiento',
    accent: 'crimson',
  },
  {
    label: 'Concesiones activas',
    value: '3',
    unit: 'vigentes',
    trend: '1.25 Mm³/año autorizados · vigencia 2025–2027',
    accent: 'wine',
  },
  {
    label: 'Balance entradas / salidas',
    value: '+6.4',
    unit: '%',
    trend: 'Margen positivo del día entre agua de entrada y suministro total',
    accent: 'brown',
  },
];

export const pozosHourlyFlow: PozosHourlyFlowPoint[] = [
  { hour: '00:00', entrada: 42, tratada: 28, suave: 9, cruda: 5 },
  { hour: '04:00', entrada: 45, tratada: 29, suave: 10, cruda: 6 },
  { hour: '08:00', entrada: 56, tratada: 36, suave: 12, cruda: 8 },
  { hour: '12:00', entrada: 61, tratada: 39, suave: 14, cruda: 8 },
  { hour: '16:00', entrada: 58, tratada: 37, suave: 13, cruda: 8 },
  { hour: '20:00', entrada: 50, tratada: 31, suave: 11, cruda: 8 },
];

export const pozosBreakdown: NameValuePoint[] = [
  { name: 'Pozo 1', value: 418 },
  { name: 'Pozo 2', value: 392 },
  { name: 'Pozo 3', value: 438 },
];

export const tanques: TankDetailItem[] = [
  {
    name: 'Tanque tratada norte',
    shortName: 'Tratada N.',
    type: 'Agua tratada',
    metros: 4.2,
    m3: 176,
    capacidad: 420,
    llenado: 42,
    tendencia: '-8% en 2 h',
    estado: 'Nivel bajo',
    statusType: 'warning',
    riesgo: 'Recuperar antes del pico vespertino',
  },
  {
    name: 'Tanque suave proceso',
    shortName: 'Suave',
    type: 'Agua suave',
    metros: 5.9,
    m3: 214,
    capacidad: 300,
    llenado: 71,
    tendencia: '+2% en 2 h',
    estado: 'Normal',
    statusType: 'normal',
    riesgo: 'Sin riesgo operativo',
  },
  {
    name: 'Tanque cruda reserva',
    shortName: 'Cruda',
    type: 'Agua cruda',
    metros: 6.8,
    m3: 289,
    capacidad: 390,
    llenado: 74,
    tendencia: 'Estable',
    estado: 'Normal',
    statusType: 'normal',
    riesgo: 'Reserva adecuada',
  },
  {
    name: 'Tanque recuperada',
    shortName: 'Recuperada',
    type: 'Agua recuperada',
    metros: 3.1,
    m3: 126,
    capacidad: 200,
    llenado: 63,
    tendencia: '-4% en 2 h',
    estado: 'Revisar',
    statusType: 'warning',
    riesgo: 'Validar recuperación y demanda',
  },
];

export const tankLevelTrend: TankLevelTrendPoint[] = [
  { hour: '08:00', tratadaNorte: 58, suaveProceso: 68, crudaReserva: 76, recuperada: 72 },
  { hour: '09:00', tratadaNorte: 55, suaveProceso: 69, crudaReserva: 75, recuperada: 70 },
  { hour: '10:00', tratadaNorte: 52, suaveProceso: 70, crudaReserva: 75, recuperada: 68 },
  { hour: '11:00', tratadaNorte: 48, suaveProceso: 71, crudaReserva: 74, recuperada: 66 },
  { hour: '12:00', tratadaNorte: 46, suaveProceso: 72, crudaReserva: 74, recuperada: 65 },
  { hour: '13:00', tratadaNorte: 44, suaveProceso: 72, crudaReserva: 74, recuperada: 64 },
  { hour: '14:00', tratadaNorte: 42, suaveProceso: 71, crudaReserva: 74, recuperada: 63 },
];

export const tankAlerts: TankAlertItem[] = [
  {
    tank: 'Tanque tratada norte',
    type: 'Nivel bajo',
    detail: 'Nivel al 42%. Requiere recuperación antes de la demanda de la tarde.',
    priority: 'Alta',
    statusType: 'warning',
  },
  {
    tank: 'Tanque recuperada',
    type: 'Comportamiento anormal',
    detail: 'Caída sostenida durante las últimas horas. Validar recuperación y línea asociada.',
    priority: 'Media',
    statusType: 'warning',
  },
  {
    tank: 'Tanque cruda reserva',
    type: 'Reserva estable',
    detail: 'Nivel de respaldo dentro de rango. Mantener monitoreo por operación nocturna.',
    priority: 'Baja',
    statusType: 'normal',
  },
];

export const filtrosVsTratada: DayWaterPoint[] = [
  { day: 'Lun', filtros: 182, tratada: 174 },
  { day: 'Mar', filtros: 191, tratada: 186 },
  { day: 'Mié', filtros: 187, tratada: 181 },
  { day: 'Jue', filtros: 194, tratada: 188 },
  { day: 'Vie', filtros: 199, tratada: 192 },
  { day: 'Sáb', filtros: 183, tratada: 176 },
  { day: 'Dom', filtros: 176, tratada: 171 },
];

export const cipHourly: DayConsumptionPoint[] = [
  { day: 'Lun', consumo: 12.4 },
  { day: 'Mar', consumo: 13.2 },
  { day: 'Mié', consumo: 11.8 },
  { day: 'Jue', consumo: 14.1 },
  { day: 'Vie', consumo: 13.5 },
  { day: 'Sáb', consumo: 10.7 },
  { day: 'Dom', consumo: 9.9 },
];

export const monthlyAverages: MonthlyAveragePoint[] = [
  { month: 'Ene', entrada: 1180, tratada: 760, cruda: 245, suave: 175 },
  { month: 'Feb', entrada: 1210, tratada: 778, cruda: 252, suave: 180 },
  { month: 'Mar', entrada: 1248, tratada: 812, cruda: 257, suave: 179 },
  { month: 'Abr', entrada: 1233, tratada: 801, cruda: 251, suave: 181 },
  { month: 'May', entrada: 1261, tratada: 823, cruda: 259, suave: 179 },
  { month: 'Jun', entrada: 1276, tratada: 838, cruda: 261, suave: 177 },
];

export const waterBalanceDailySummary: WaterBalanceDailySummary = {
  produced: 7842,
  output: 7496,
  status: 'Balance positivo controlado',
  note: 'La producción supera la salida del día y mantiene margen para recuperación de tanques.',
  peakVariation: '+72 m³ a las 12:00',
  peakNote: 'Mayor diferencia entre producción y salida durante el pico de bombeo.',
  recommendation: 'Mantener monitoreo',
  recommendationNote: 'No se detecta pérdida crítica; revisar tendencia si la diferencia cae por debajo de 2%.',
};

export const waterBalanceKpis: MockKpi[] = [
  { label: 'Agua producida', value: '7,842', unit: 'm³', trend: 'Suma del bombeo y recuperación acumulada del día', accent: 'red' },
  { label: 'Agua enviada', value: '7,496', unit: 'm³', trend: 'Salida total hacia proceso y distribución interna', accent: 'crimson' },
  { label: 'Diferencia neta', value: '+346', unit: 'm³', trend: '+4.4% contra producción del día', accent: 'wine' },
  { label: 'Variación vs ayer', value: '+2.1', unit: '%', trend: 'Balance ligeramente superior al turno anterior', accent: 'brown' },
];

export const waterBalanceByType: WaterBalanceByTypeItem[] = [
  { type: 'Agua cruda', tag: 'Entrada primaria', producida: 4210, salida: 4046, producedPct: 100, outputPct: 96, status: 'Normal', statusType: 'normal', note: 'Diferencia esperada por reserva en tanque cruda y estabilización de línea.' },
  { type: 'Agua recuperada', tag: 'Recuperación', producida: 1186, salida: 1048, producedPct: 100, outputPct: 88, status: 'Revisar', statusType: 'warning', note: 'Margen positivo alto; validar acumulación temporal o lectura de salida.' },
  { type: 'Agua suave', tag: 'Proceso', producida: 2446, salida: 2402, producedPct: 100, outputPct: 98, status: 'Estable', statusType: 'normal', note: 'Salida alineada con producción y demanda del área de proceso.' },
];

export const waterBalanceTrend: WaterBalanceTrendPoint[] = [
  { hour: '00:00', producida: 712, salida: 684, diferencia: 28, cruda: 386, recuperada: 104, suave: 222 },
  { hour: '03:00', producida: 748, salida: 715, diferencia: 33, cruda: 402, recuperada: 112, suave: 234 },
  { hour: '06:00', producida: 826, salida: 792, diferencia: 34, cruda: 446, recuperada: 126, suave: 254 },
  { hour: '09:00', producida: 1038, salida: 982, diferencia: 56, cruda: 558, recuperada: 154, suave: 326 },
  { hour: '12:00', producida: 1184, salida: 1112, diferencia: 72, cruda: 628, recuperada: 176, suave: 380 },
  { hour: '15:00', producida: 1096, salida: 1058, diferencia: 38, cruda: 586, recuperada: 162, suave: 348 },
  { hour: '18:00', producida: 974, salida: 945, diferencia: 29, cruda: 518, recuperada: 148, suave: 308 },
  { hour: '21:00', producida: 870, salida: 848, diferencia: 22, cruda: 456, recuperada: 132, suave: 282 },
];


export const reportCards: ReportCardItem[] = [
  {
    title: 'Resumen diario de agua',
    description: 'Base preparada para exportar entradas, salidas, tanques y balance del día.',
    status: 'Listo para exportación posterior',
  },
  {
    title: 'Promedios mensuales',
    description: 'Estructura preparada para consolidar comparativos mensuales por tipo de agua.',
    status: 'Demo configurado',
  },
  {
    title: 'Lámparas UV',
    description: 'Monitoreo operativo basado en flujo asociado al paso UV.',
    status: 'Operativo por flujo',
  },
];

export const concesiones: ConcessionItem[] = [
  { name: 'Concesión pozo norte', volumen: '420,000 m³/año', vigencia: 'ene 2025 - dic 2027', status: 'Activa' },
  { name: 'Concesión pozo sur', volumen: '380,000 m³/año', vigencia: 'mar 2025 - feb 2027', status: 'Activa' },
  { name: 'Concesión pozo respaldo', volumen: '450,000 m³/año', vigencia: 'jul 2025 - jun 2027', status: 'Activa' },
];


export const concessionSummary: ConcessionSummary = {
  authorized: 1250000,
  used: 856400,
  remaining: 393600,
  usedPct: 68.5,
  period: 'Ene 2025 - Dic 2025',
  validity: 'Vigente hasta dic 2025 · fuente mock',
  cutoff: 'Corte operativo 14:30',
  status: 'Uso dentro de margen preventivo',
};

export const concessionProjection: ConcessionProjection = {
  trend: 'Ritmo 4.2% arriba del promedio',
  trendNote: 'El consumo de los últimos 14 días está ligeramente acelerado por mayor operación de pozos norte.',
  projectedUsed: 1138000,
  projectedRemaining: 112000,
  projectedPct: 91.0,
  recommendation: 'Mantener seguimiento semanal y redistribuir producción si el ritmo supera 93%.',
};

export const concessionHistory: ConcessionHistoryPoint[] = [
  { month: 'Ene', consumo: 92500, acumulado: 92500, proyeccion: 92500 },
  { month: 'Feb', consumo: 88400, acumulado: 180900, proyeccion: 181000 },
  { month: 'Mar', consumo: 96300, acumulado: 277200, proyeccion: 274000 },
  { month: 'Abr', consumo: 101600, acumulado: 378800, proyeccion: 369000 },
  { month: 'May', consumo: 107900, acumulado: 486700, proyeccion: 466000 },
  { month: 'Jun', consumo: 113200, acumulado: 599900, proyeccion: 568000 },
  { month: 'Jul', consumo: 124800, acumulado: 724700, proyeccion: 674000 },
  { month: 'Ago', consumo: 131700, acumulado: 856400, proyeccion: 788000 },
  { month: 'Sep', consumo: 0, acumulado: 856400, proyeccion: 902000 },
  { month: 'Oct', consumo: 0, acumulado: 856400, proyeccion: 1016000 },
  { month: 'Nov', consumo: 0, acumulado: 856400, proyeccion: 1122000 },
  { month: 'Dic', consumo: 0, acumulado: 856400, proyeccion: 1138000 },
];

export const concessionAlerts: ConcessionAlertItem[] = [
  {
    title: 'Consumo acelerado',
    detail: 'La proyección de cierre alcanza 91.0% del volumen autorizado si se mantiene el ritmo actual.',
    priority: 'Preventiva',
    level: 'warning',
  },
  {
    title: 'Pozo Norte con mayor aporte',
    detail: 'El 42% del volumen reciente proviene de concesiones norte; revisar balance con pozos sur.',
    priority: 'Media',
    level: 'normal',
  },
  {
    title: 'Umbral de excedente',
    detail: 'No hay excedente actual, pero se recomienda alerta temprana al superar 90% proyectado.',
    priority: 'Alta',
    level: 'alert',
  },
];

export const wellsOperationalStatus: WellOperationalStatusItem[] = [
  {
    id: 'pozo-01', numero: 1, name: 'Pozo 01', nombre: 'Pozo 01', ubicacion: 'Norte · Línea A',
    estado_operativo: 'encendido', apagado_manual: false, status: 'Encendido', statusType: 'normal',
    estado_comunicacion: 'En línea', communicationType: 'online', kwh: 2260, totalizador_m3: 152480,
    flujo_entrada: 62.4, flujo_salida: 60.8, flow: 62.4, dailyKwh: 2260, amps: 78, efficiency: 1.48,
    loadFactor: 82, ampFlowRatio: 1.25, diagnosis: 'Operación estable dentro de meta', ultima_lectura: '14:28', updated: '14:28',
  },
  {
    id: 'pozo-02', numero: 2, name: 'Pozo 02', nombre: 'Pozo 02', ubicacion: 'Norte · Línea A',
    estado_operativo: 'encendido', apagado_manual: false, status: 'Encendido', statusType: 'normal',
    estado_comunicacion: 'En línea', communicationType: 'online', kwh: 2120, totalizador_m3: 148930,
    flujo_entrada: 58.1, flujo_salida: 56.9, flow: 58.1, dailyKwh: 2120, amps: 74, efficiency: 1.52,
    loadFactor: 79, ampFlowRatio: 1.27, diagnosis: 'Carga estable', ultima_lectura: '14:27', updated: '14:27',
  },
  {
    id: 'pozo-03', numero: 3, name: 'Pozo 03', nombre: 'Pozo 03', ubicacion: 'Sur · Línea B',
    estado_operativo: 'encendido', apagado_manual: false, status: 'Encendido · revisar', statusType: 'warning',
    estado_comunicacion: 'En línea', communicationType: 'online', kwh: 1980, totalizador_m3: 137640,
    flujo_entrada: 44.8, flujo_salida: 42.9, flow: 44.8, dailyKwh: 1980, amps: 82, efficiency: 1.83,
    loadFactor: 91, ampFlowRatio: 1.83, diagnosis: 'kWh/m³ elevado; revisar bomba', ultima_lectura: '14:26', updated: '14:26',
  },
  {
    id: 'pozo-04', numero: 4, name: 'Pozo 04', nombre: 'Pozo 04', ubicacion: 'Centro · Línea C',
    estado_operativo: 'encendido', apagado_manual: false, status: 'Encendido', statusType: 'normal',
    estado_comunicacion: 'En línea', communicationType: 'online', kwh: 1748, totalizador_m3: 129820,
    flujo_entrada: 51.6, flujo_salida: 50.7, flow: 51.6, dailyKwh: 1748, amps: 69, efficiency: 1.41,
    loadFactor: 76, ampFlowRatio: 1.34, diagnosis: 'Buen rendimiento', ultima_lectura: '14:29', updated: '14:29',
  },
  {
    id: 'pozo-05', numero: 5, name: 'Pozo 05', nombre: 'Pozo 05', ubicacion: 'Reserva · Línea R',
    estado_operativo: 'apagado', apagado_manual: true, status: 'Apagado manual', statusType: 'idle',
    estado_comunicacion: 'En línea', communicationType: 'online', kwh: 0, totalizador_m3: 114205,
    flujo_entrada: 0, flujo_salida: 0, flow: 0, dailyKwh: 0, amps: 0, efficiency: null,
    loadFactor: 0, ampFlowRatio: null, diagnosis: 'Detenido por operación; no es falla de comunicación', ultima_lectura: '13:55', updated: '13:55',
  },
  {
    id: 'pozo-06', numero: 6, name: 'Pozo 06', nombre: 'Pozo 06', ubicacion: 'Oriente · Línea D',
    estado_operativo: 'encendido', apagado_manual: false, status: 'Encendido · crítico', statusType: 'critical',
    estado_comunicacion: 'En línea', communicationType: 'online', kwh: 2075, totalizador_m3: 121995,
    flujo_entrada: 36.2, flujo_salida: 34.6, flow: 36.2, dailyKwh: 2075, amps: 88, efficiency: 2.04,
    loadFactor: 96, ampFlowRatio: 2.43, diagnosis: 'Flujo bajo con amperaje alto', ultima_lectura: '14:25', updated: '14:25',
  },
  {
    id: 'pozo-07', numero: 7, name: 'Pozo 07', nombre: 'Pozo 07', ubicacion: 'Norte · Línea B',
    estado_operativo: 'encendido', apagado_manual: false, status: 'Encendido', statusType: 'normal',
    estado_comunicacion: 'En línea', communicationType: 'online', kwh: 1810, totalizador_m3: 116380,
    flujo_entrada: 49.9, flujo_salida: 48.7, flow: 49.9, dailyKwh: 1810, amps: 71, efficiency: 1.5,
    loadFactor: 77, ampFlowRatio: 1.42, diagnosis: 'Operando sin desviaciones', ultima_lectura: '14:24', updated: '14:24',
  },
  {
    id: 'pozo-08', numero: 8, name: 'Pozo 08', nombre: 'Pozo 08', ubicacion: 'Sur · Línea A',
    estado_operativo: 'inactivo', apagado_manual: false, status: 'Inactivo', statusType: 'inactive',
    estado_comunicacion: 'En línea', communicationType: 'online', kwh: 0, totalizador_m3: 108760,
    flujo_entrada: 0, flujo_salida: 0, flow: 0, dailyKwh: 0, amps: 0, efficiency: null,
    loadFactor: 0, ampFlowRatio: null, diagnosis: 'Fuera de operación por condición contractual o física; no tratar como apagado normal', ultima_lectura: '12:40', updated: '12:40',
  },
  {
    id: 'pozo-09', numero: 9, name: 'Pozo 09', nombre: 'Pozo 09', ubicacion: 'Reserva · Línea R',
    estado_operativo: 'sin_comunicacion', apagado_manual: false, status: 'Sin comunicación', statusType: 'communication',
    estado_comunicacion: 'Timeout 38 min', communicationType: 'offline', kwh: null, totalizador_m3: null,
    flujo_entrada: null, flujo_salida: null, flow: null, dailyKwh: null, amps: null, efficiency: null,
    loadFactor: null, ampFlowRatio: null, diagnosis: 'Sin lectura reciente del PLC; validar red o tag', ultima_lectura: '13:52', updated: '13:52',
  },
  {
    id: 'pozo-10', numero: 10, name: 'Pozo 10', nombre: 'Pozo 10', ubicacion: 'Norte · Línea B',
    estado_operativo: 'encendido', apagado_manual: false, status: 'Encendido', statusType: 'normal',
    estado_comunicacion: 'En línea', communicationType: 'online', kwh: 1942, totalizador_m3: 132470,
    flujo_entrada: 54.7, flujo_salida: 53.4, flow: 54.7, dailyKwh: 1942, amps: 73, efficiency: 1.49,
    loadFactor: 81, ampFlowRatio: 1.33, diagnosis: 'Producción estable', ultima_lectura: '14:30', updated: '14:30',
  },
];
export const dailyReviewSummary: MockKpi[] = [
  { label: 'Prioridades abiertas', value: '6', unit: '', trend: '3 altas y 1 crítica pendientes', accent: 'red' },
  { label: 'Pozos con desvío >10%', value: '3', unit: '', trend: 'Pozo 03, 06 y 08', accent: 'orange' },
  { label: 'kWh/m³ alto', value: '2', unit: '', trend: 'Eficiencia fuera de meta', accent: 'crimson' },
  { label: 'Tanques críticos', value: '1', unit: '', trend: 'Nivel bajo en recuperada', accent: 'cyan' },
  { label: 'Riesgo concesión', value: 'Medio', unit: '', trend: 'Uso acumulado 68.4%', accent: 'wine' },
  { label: 'Reporte diario', value: 'Listo', unit: '', trend: 'Pendiente de validación de turno', accent: 'blue' },
];

export const dailyReviewPriorities: DailyReviewPriorityItem[] = [
  { type: 'kWh/m³ alto', target: 'Pozo 06', description: 'Eficiencia 2.04 kWh/m³ con flujo por debajo del promedio. Requiere inspección prioritaria.', metric: '+25.9% vs referencia', owner: 'Mantenimiento eléctrico / hidráulico', priority: 'Crítica', level: 'critical' },
  { type: 'Flujo anómalo', target: 'Pozo 03', description: 'Flujo 12% menor que su media operativa con consumo estable.', metric: '43.2 m³/h', owner: 'Operación pozos', priority: 'Alta', level: 'warning' },
  { type: 'Factor de carga', target: 'Pozo 08', description: 'Factor de carga por arriba de banda objetivo; revisar presión de descarga y válvulas.', metric: '86%', owner: 'Mantenimiento mecánico', priority: 'Alta', level: 'warning' },
  { type: 'Tanque bajo', target: 'Tanque recuperada', description: 'Reserva operativa en zona baja con tendencia descendente durante la tarde.', metric: '34%', owner: 'Operación planta', priority: 'Alta', level: 'warning' },
  { type: 'Sin datos', target: 'Pozo 09', description: 'Sin lectura reciente desde PLC o fuente de datos. Validar comunicación antes del cierre.', metric: 'Última lectura: —', owner: 'Automatización', priority: 'Media', level: 'nodata' },
  { type: 'Concesión alta', target: 'Concesión anual', description: 'Consumo acumulado arriba de la curva ideal del periodo; conviene vigilar tendencia semanal.', metric: '68.4% usado', owner: 'Administración / operación', priority: 'Media', level: 'normal' },
];

export const dailyReviewRanking: DailyReviewRankingItem[] = [
  { name: 'Pozo 06', score: 94, reason: 'kWh/m³ alto + flujo bajo', action: 'Inspección inmediata' },
  { name: 'Pozo 03', score: 82, reason: 'Desvío de flujo >10%', action: 'Revisar hidráulica' },
  { name: 'Pozo 08', score: 77, reason: 'Factor de carga fuera de rango', action: 'Revisar válvulas/carga' },
  { name: 'Tanque recuperada', score: 74, reason: 'Nivel bajo con tendencia descendente', action: 'Ajustar bombeo' },
  { name: 'Pozo 09', score: 68, reason: 'Sin lectura reciente', action: 'Validar comunicación' },
  { name: 'Concesión', score: 61, reason: 'Curva acumulada acelerada', action: 'Monitoreo semanal' },
];

export const dailyReviewDiagnostics: DailyReviewDiagnosticItem[] = [
  { well: 'Pozo 03', symptom: 'Flujo 12% menor al promedio con consumo diario estable.', cause: 'Posible restricción en descarga, válvula parcialmente cerrada o desgaste inicial de impulsor.', action: 'Comparar presión de línea y revisar tendencia de amperaje en el turno.', priority: 'Alta', level: 'warning' },
  { well: 'Pozo 06', symptom: 'kWh/m³ crítico y amperaje elevado para el flujo reportado.', cause: 'Posible obstrucción, cavitación, problema de bomba o lectura de flujo subestimada.', action: 'Paro programado corto para inspección si la desviación se mantiene.', priority: 'Crítica', level: 'critical' },
  { well: 'Pozo 08', symptom: 'Factor de carga en banda alta y relación A/m³/h elevada.', cause: 'Carga hidráulica superior a lo normal o válvula de descarga fuera de posición.', action: 'Validar posición de válvulas y comparar contra presión del manifold.', priority: 'Alta', level: 'warning' },
  { well: 'Pozo 09', symptom: 'Sin datos de flujo, amperaje o consumo reciente.', cause: 'Tag sin comunicación, PLC sin lectura o fuente temporal incompleta.', action: 'Revisar comunicación antes de usarlo en reportes diarios.', priority: 'Media', level: 'nodata' },
  { well: 'Pozo 10', symptom: 'Producción estable con consumo dentro de meta.', cause: 'Operación normal dentro de banda esperada.', action: 'Sin acción correctiva; mantener monitoreo rutinario.', priority: 'Baja', level: 'normal' },
];

export const dailyReviewExportChecklist: ChecklistItem[] = [
  { title: 'Resumen de prioridades', detail: 'Incluye ranking, severidad y responsable sugerido para el turno.' },
  { title: 'Diagnóstico por pozo', detail: 'Síntoma, causa probable y acción inicial para mantenimiento.' },
  { title: 'Indicadores diarios', detail: 'Volumen, kWh, kWh/m³, concesión y estado de tanques.' },
  { title: 'Notas de validación', detail: 'Marcar pozos sin datos o mediciones que requieran confirmación manual.' },
];

const detailProfilesByWell: Record<string, WellDetailProfile> = {
  'pozo-01': { nominalAmps: 85, pumpType: 'Sumergible vertical 75 HP', line: 'Línea Norte A', tank: 'Tanque cruda reserva', averageEfficiency: 1.55, loadFactorTarget: '75-88%', symptom: 'Sin desviaciones relevantes en las últimas 6 horas.', cause: 'Operación estable; presión y amperaje dentro de banda esperada.', priority: 'Baja' },
  'pozo-02': { nominalAmps: 82, pumpType: 'Sumergible vertical 75 HP', line: 'Línea Norte A', tank: 'Tanque tratada norte', averageEfficiency: 1.57, loadFactorTarget: '74-86%', symptom: 'Carga estable con ligera variación horaria.', cause: 'Demanda normal del sistema de distribución.', priority: 'Baja' },
  'pozo-03': { nominalAmps: 84, pumpType: 'Sumergible vertical 90 HP', line: 'Línea Sur B', tank: 'Tanque tratada norte', averageEfficiency: 1.6, loadFactorTarget: '76-88%', symptom: 'Eficiencia energética arriba de meta y flujo 12% menor al promedio.', cause: 'Posible restricción en descarga, desgaste de impulsor o válvula parcialmente cerrada.', priority: 'Alta' },
  'pozo-04': { nominalAmps: 78, pumpType: 'Sumergible vertical 60 HP', line: 'Línea Centro', tank: 'Tanque suave proceso', averageEfficiency: 1.52, loadFactorTarget: '70-82%', symptom: 'Rendimiento superior al promedio de referencia.', cause: 'Condición hidráulica favorable y baja restricción de línea.', priority: 'Baja' },
  'pozo-05': { nominalAmps: 76, pumpType: 'Sumergible vertical 60 HP', line: 'Línea Reserva', tank: 'Tanque cruda reserva', averageEfficiency: 1.58, loadFactorTarget: '70-84%', symptom: 'Pozo detenido sin consumo ni flujo actual.', cause: 'Reserva operativa; disponible para arranque programado.', priority: 'Media' },
  'pozo-06': { nominalAmps: 86, pumpType: 'Sumergible vertical 90 HP', line: 'Línea Oriente', tank: 'Tanque cruda reserva', averageEfficiency: 1.62, loadFactorTarget: '76-90%', symptom: 'Flujo bajo con amperaje alto y kWh/m3 crítico.', cause: 'Posible obstrucción, desgaste de bomba, cavitación o problema de válvula.', priority: 'Crítica' },
  'pozo-07': { nominalAmps: 80, pumpType: 'Sumergible vertical 75 HP', line: 'Línea Norte B', tank: 'Tanque suave proceso', averageEfficiency: 1.54, loadFactorTarget: '72-84%', symptom: 'Operación normal con variación leve de demanda.', cause: 'Condición esperada por distribución horaria.', priority: 'Baja' },
  'pozo-08': { nominalAmps: 83, pumpType: 'Sumergible vertical 75 HP', line: 'Línea Sur A', tank: 'Tanque recuperada', averageEfficiency: 1.56, loadFactorTarget: '73-86%', symptom: 'Factor de carga fuera de rango y relación A/m3/h elevada.', cause: 'Revisar presión de línea, operación de válvula y condición eléctrica del motor.', priority: 'Alta' },
  'pozo-09': { nominalAmps: 79, pumpType: 'Sumergible vertical 60 HP', line: 'Línea Reserva', tank: 'Tanque cruda reserva', averageEfficiency: 1.55, loadFactorTarget: '70-84%', symptom: 'Sin lectura reciente desde PLC o fuente de datos.', cause: 'Validar comunicación, tag de flujo, tag de amperaje y última lectura registrada.', priority: 'Alta' },
  'pozo-10': { nominalAmps: 82, pumpType: 'Sumergible vertical 75 HP', line: 'Línea Norte B', tank: 'Tanque tratada norte', averageEfficiency: 1.55, loadFactorTarget: '73-86%', symptom: 'Producción estable con consumo en meta.', cause: 'Condición normal de operación.', priority: 'Baja' },
};

export const wellDetailProfiles = Object.fromEntries(
  wellsOperationalStatus.map((well) => {
    const profile = detailProfilesByWell[well.id] || detailProfilesByWell['pozo-01'];
    return [
      well.id,
      {
        ...profile,
        diagnostic: {
          symptom: profile.symptom,
          cause: profile.cause,
          priority: profile.priority,
        },
      },
    ];
  })
) as Record<string, WellDetailProfileWithDiagnostic>;

const timelineOffsets: number[] = [-4, -2, 1, 0, 2, -1, 0];
const timelineHours: string[] = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00'];

function buildWellTimeline(well: WellOperationalStatusItem): WellTimelinePoint[] {
  if (well.statusType === 'nodata' || well.statusType === 'communication') {
    return timelineHours.map((time) => ({ time, flow: null, amps: null, efficiency: null, loadFactor: null }));
  }

  if (well.statusType === 'idle' || well.statusType === 'inactive') {
    return timelineHours.map((time) => ({ time, flow: 0, amps: 0, efficiency: null, loadFactor: 0 }));
  }

  return timelineHours.map((time, index) => {
    const offset = timelineOffsets[index];
    const flow = Math.max(0, Number((well.flow + offset * 0.8).toFixed(1)));
    const amps = Math.max(0, Math.round(well.amps + offset));
    const efficiencyBase = well.efficiency || 0;
    const efficiency = Number((efficiencyBase + offset * 0.015).toFixed(2));
    const loadFactor = Math.min(100, Math.max(0, Math.round((well.loadFactor || 0) + offset)));
    return { time, flow, amps, efficiency, loadFactor };
  });
}

export const wellDetailTimeline = Object.fromEntries(
  wellsOperationalStatus.map((well) => [well.id, buildWellTimeline(well)])
) as Record<string, WellTimelinePoint[]>;


export const uvOperationalSummary: UvOperationalSummary = {
  currentFlow: 128.4,
  lastUpdate: '12:42',
  communication: 'Normal',
  communicationType: 'normal',
  inferredState: 'Con flujo',
  inferredStateType: 'normal',
  uvPoint: 'UV-01',
  line: 'Línea agua suave',
  tank: 'Tanque agua suave',
  note: 'Estado operativo inferido únicamente por flujo asociado al paso UV.',
};

export const uvFlowTrend: UvFlowTrendPoint[] = [
  { hour: '06:00', flow: 94.2, state: 'Con flujo' },
  { hour: '07:00', flow: 108.7, state: 'Con flujo' },
  { hour: '08:00', flow: 121.5, state: 'Con flujo' },
  { hour: '09:00', flow: 132.1, state: 'Con flujo' },
  { hour: '10:00', flow: 126.8, state: 'Con flujo' },
  { hour: '11:00', flow: 118.4, state: 'Con flujo' },
  { hour: '12:00', flow: 128.4, state: 'Con flujo' },
];

export const uvOperationalLog: UvOperationalLogPoint[] = [
  { hour: '06:00', flow: 94.2, state: 'Con flujo', communication: 'Normal', lastReading: '06:02', reference: 'Línea agua suave / Tanque suave' },
  { hour: '07:00', flow: 108.7, state: 'Con flujo', communication: 'Normal', lastReading: '07:01', reference: 'Línea agua suave / Tanque suave' },
  { hour: '08:00', flow: 121.5, state: 'Con flujo', communication: 'Normal', lastReading: '08:02', reference: 'Línea agua suave / Tanque suave' },
  { hour: '09:00', flow: 132.1, state: 'Con flujo', communication: 'Normal', lastReading: '09:01', reference: 'Línea agua suave / Tanque suave' },
  { hour: '10:00', flow: 126.8, state: 'Con flujo', communication: 'Normal', lastReading: '10:02', reference: 'Línea agua suave / Tanque suave' },
  { hour: '11:00', flow: 0, state: 'Sin flujo', communication: 'Normal', lastReading: '11:01', reference: 'Línea agua suave / Tanque suave' },
  { hour: '12:00', flow: 128.4, state: 'Con flujo', communication: 'Normal', lastReading: '12:42', reference: 'Línea agua suave / Tanque suave' },
];

export const uvAssociatedContext: UvAssociatedContextItem[] = [
  { label: 'Punto UV', value: 'UV-01', detail: 'Referencia operativa del paso UV' },
  { label: 'Línea asociada', value: 'Línea agua suave', detail: 'Flujo utilizado como señal de operación' },
  { label: 'Tanque asociado', value: 'Tanque agua suave', detail: 'Contexto aguas abajo del monitoreo' },
];
