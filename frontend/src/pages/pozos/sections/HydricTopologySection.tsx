import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  Activity,
  Droplets,
  Factory,
  FlaskConical,
  Gauge,
  GitBranch,
  Lightbulb,
  Lock,
  Maximize2,
  Minimize2,
  Move,
  RefreshCw,
  RotateCcw,
  Save,
  Unlock,
  Waves,
} from 'lucide-react';
import KpiCard from '../../../components/KpiCard';
import useSqlChartDashboard from '../hooks/useSqlChartDashboard';
import { asRecord, asRows, formatLocalDate, formatNumber } from '../insurgentesUtils';
import { currentTotalizerValue, flowValue } from '../operationalPresentation';
import type { FlexibleRecord } from '../types';
import '../../../styles/insurgentesTopology.css';

type NodeKind = 'source' | 'process' | 'storage' | 'distribution' | 'production' | 'uv' | 'reuse' | 'return';
type NodePosition = { x: number; y: number };
type DiagramPositions = Record<string, NodePosition>;
type ZonePositions = Record<string, NodePosition>;
type StoredDiagramLayout = { nodes?: DiagramPositions; zones?: ZonePositions };
type LiveKey =
  | 'pozo1' | 'pozo2' | 'pozo3' | 'pozo4' | 'pozo5'
  | 'linea1' | 'linea2' | 'linea3' | 'linea4' | 'linea5' | 'linea6' | 'linea7'
  | 'aguaRecuperada' | 'aguaTratadaTotal';

type DiagramNodeDefinition = {
  id: string;
  title: string;
  subtitle: string;
  kind: NodeKind;
  liveKey?: LiveKey;
  note?: string;
};

type DiagramEdgeDefinition = {
  id: string;
  source: string;
  target: string;
  tone?: 'water' | 'production' | 'reuse';
  dashed?: boolean;
};

const STORAGE_KEY = 'arca-las-fuentes-hydric-topology-prototype-v1';
const NODE_HALF_WIDTH = 94;
const NODE_HALF_HEIGHT = 51;

const DEFAULT_ZONE_POSITIONS: ZonePositions = {
  source: { x: 0.018, y: 0.018 },
  treatment: { x: 0.205, y: 0.018 },
  production: { x: 0.555, y: 0.018 },
  reuse: { x: 0.865, y: 0.018 },
};

const ZONE_LABELS = [
  { id: 'source', label: 'AGUA CRUDA / POZOS', className: 'hydric-proto-zone-source' },
  { id: 'treatment', label: 'TRATAMIENTOS / DISTRIBUCIÓN', className: 'hydric-proto-zone-treatment' },
  { id: 'production', label: 'LÍNEAS / PRODUCCIÓN', className: 'hydric-proto-zone-production' },
  { id: 'reuse', label: 'RECUPERACIÓN / REÚSO', className: 'hydric-proto-zone-reuse' },
] as const;

const DEFAULT_POSITIONS: DiagramPositions = {
  'pozo-1': { x: 0.018, y: 0.075 },
  'pozo-2': { x: 0.018, y: 0.225 },
  'pozo-3': { x: 0.018, y: 0.375 },
  'pozo-4': { x: 0.018, y: 0.525 },
  'pozo-5': { x: 0.018, y: 0.675 },
  'pozo-6': { x: 0.018, y: 0.825 },

  'agua-dura': { x: 0.145, y: 0.075 },
  'arena-cruda': { x: 0.145, y: 0.225 },
  'carbon-activado': { x: 0.145, y: 0.375 },
  'desmin-ionica': { x: 0.145, y: 0.525 },
  'desgasificacion': { x: 0.145, y: 0.675 },
  'desincrustacion': { x: 0.145, y: 0.825 },

  'cisterna-suave': { x: 0.265, y: 0.075 },
  'recuperacion-sensores': { x: 0.265, y: 0.225 },
  'agua-recuperacion-infers': { x: 0.265, y: 0.375 },
  'carf-filtrada': { x: 0.265, y: 0.525 },
  'car-recuperada': { x: 0.265, y: 0.675 },
  'tanque-pulmon': { x: 0.265, y: 0.825 },

  'envasadoras-caldera': { x: 0.385, y: 0.075 },
  'filtro-bolsa-clorada': { x: 0.385, y: 0.225 },
  'carbon-3': { x: 0.385, y: 0.375 },
  'cartuchos-3': { x: 0.385, y: 0.525 },
  'uv-agua-tratada': { x: 0.385, y: 0.675 },
  'agua-tratada-total': { x: 0.385, y: 0.825 },

  'buffer': { x: 0.485, y: 0.075 },
  'linea-1': { x: 0.485, y: 0.205 },
  'linea-2': { x: 0.485, y: 0.325 },
  'linea-3': { x: 0.485, y: 0.445 },
  'linea-4': { x: 0.485, y: 0.565 },
  'linea-5': { x: 0.485, y: 0.685 },
  'linea-6': { x: 0.485, y: 0.805 },
  'linea-7': { x: 0.485, y: 0.925 },

  'filtro-l1': { x: 0.625, y: 0.075 },
  'filtro-l2': { x: 0.625, y: 0.205 },
  'filtro-l3': { x: 0.625, y: 0.335 },
  'filtro-l4': { x: 0.625, y: 0.465 },
  'filtro-l5': { x: 0.625, y: 0.595 },
  'filtro-l6': { x: 0.625, y: 0.725 },
  'placa-l7': { x: 0.625, y: 0.855 },

  'uv-l1': { x: 0.745, y: 0.075 },
  'uv-l2': { x: 0.745, y: 0.205 },
  'uv-l3': { x: 0.745, y: 0.335 },
  'uv-l4': { x: 0.745, y: 0.465 },
  'uv-l5': { x: 0.745, y: 0.595 },
  'uv-l6': { x: 0.745, y: 0.725 },
  'retorno-lineas': { x: 0.745, y: 0.855 },

  'pulidor-1': { x: 0.865, y: 0.075 },
  'pulidor-02-a': { x: 0.865, y: 0.225 },
  'buffer-47': { x: 0.865, y: 0.375 },
  'pulidor-02-b': { x: 0.865, y: 0.525 },
  'uv-reuso': { x: 0.865, y: 0.675 },
  'agua-recuperada': { x: 0.865, y: 0.835 },
};

const NODE_DEFINITIONS: DiagramNodeDefinition[] = [
  { id: 'pozo-1', title: 'Pozo 1', subtitle: 'Fuente medida', kind: 'source', liveKey: 'pozo1' },
  { id: 'pozo-2', title: 'Pozo 2', subtitle: 'Fuente medida', kind: 'source', liveKey: 'pozo2' },
  { id: 'pozo-3', title: 'Pozo 3', subtitle: 'Fuente medida', kind: 'source', liveKey: 'pozo3' },
  { id: 'pozo-4', title: 'Pozo 4', subtitle: 'Fuente medida', kind: 'source', liveKey: 'pozo4' },
  { id: 'pozo-5', title: 'Pozo 5', subtitle: 'Fuente medida', kind: 'source', liveKey: 'pozo5' },
  { id: 'pozo-6', title: 'Pozo 6', subtitle: 'Fuente del plano base', kind: 'source', note: 'Sin medición vinculada' },

  { id: 'agua-dura', title: 'Almacenamiento de Agua Dura', subtitle: 'Tanque / almacenamiento', kind: 'storage', note: 'Sin nivel confirmado' },
  { id: 'arena-cruda', title: 'Filtración por Arena', subtitle: 'Tratamiento', kind: 'process', note: '4 filtros en serie · sin medición' },
  { id: 'carbon-activado', title: 'Filtración Carbón Activado', subtitle: 'Tratamiento', kind: 'process', note: '4 filtros en serie · sin medición' },
  { id: 'desmin-ionica', title: 'Desmineralización Iónica', subtitle: 'Tratamiento', kind: 'process', note: '2 desmineralizadores · sin medición' },
  { id: 'desgasificacion', title: 'Desgasificación en Torre', subtitle: 'Tratamiento', kind: 'process', note: 'Con anillos · sin medición' },
  { id: 'desincrustacion', title: 'Desincrustación Iónica', subtitle: 'Tratamiento', kind: 'process', note: '2 equipos · sin medición' },

  { id: 'cisterna-suave', title: 'Cisterna Agua Suave', subtitle: 'Almacenamiento', kind: 'storage', note: 'Sin nivel confirmado' },
  { id: 'recuperacion-sensores', title: 'Recuperación sensores', subtitle: 'Intermedio conceptual', kind: 'distribution', note: 'Sin instrumentación vinculada' },
  { id: 'agua-recuperacion-infers', title: 'Agua recuperación infers', subtitle: 'Intermedio conceptual', kind: 'distribution', note: 'Sin instrumentación vinculada' },
  { id: 'carf-filtrada', title: 'CARF · Agua Recuperada Filtrada', subtitle: 'Tratamiento / almacenamiento', kind: 'storage', note: 'Referencia del plano base' },
  { id: 'car-recuperada', title: 'CAR · Agua Recuperada', subtitle: 'Tratamiento / almacenamiento', kind: 'storage', note: 'Referencia del plano base' },
  { id: 'tanque-pulmon', title: 'Tanque Pulmón', subtitle: 'Almacenamiento', kind: 'storage', note: 'Sin nivel confirmado' },

  { id: 'envasadoras-caldera', title: 'Envasadoras / Caldera / Condensadores', subtitle: 'Proceso conceptual', kind: 'process', note: 'Sin medición vinculada' },
  { id: 'filtro-bolsa-clorada', title: 'Filtro Bolsa · Agua Tratada Clorada', subtitle: 'Tratamiento', kind: 'process', note: 'Sin medición vinculada' },
  { id: 'carbon-3', title: 'Filtración Carbón Activado', subtitle: 'Tratamiento', kind: 'process', note: '3 filtros de carbón' },
  { id: 'cartuchos-3', title: 'Filtración Cartuchos Pulidores', subtitle: 'Tratamiento', kind: 'process', note: '3 en serie · sin medición' },
  { id: 'uv-agua-tratada', title: 'Tratamiento UV · Agua Tratada', subtitle: 'Desinfección', kind: 'uv', note: 'Nodo conceptual del plano' },
  { id: 'agua-tratada-total', title: 'Agua Tratada Total', subtitle: 'Flujo medido del dashboard', kind: 'distribution', liveKey: 'aguaTratadaTotal' },

  { id: 'buffer', title: 'Tanque Buffer', subtitle: 'Almacenamiento', kind: 'storage', note: 'Sin nivel confirmado' },
  { id: 'linea-1', title: 'Línea 1', subtitle: 'Producción medida', kind: 'production', liveKey: 'linea1' },
  { id: 'linea-2', title: 'Línea 2', subtitle: 'Producción medida', kind: 'production', liveKey: 'linea2' },
  { id: 'linea-3', title: 'Línea 3', subtitle: 'Producción medida', kind: 'production', liveKey: 'linea3' },
  { id: 'linea-4', title: 'Línea 4', subtitle: 'Producción medida', kind: 'production', liveKey: 'linea4' },
  { id: 'linea-5', title: 'Línea 5', subtitle: 'Producción medida', kind: 'production', liveKey: 'linea5' },
  { id: 'linea-6', title: 'Línea 6', subtitle: 'Producción medida', kind: 'production', liveKey: 'linea6' },
  { id: 'linea-7', title: 'Línea 7', subtitle: 'Producción medida', kind: 'production', liveKey: 'linea7' },

  { id: 'filtro-l1', title: 'Filtración por Alúmina', subtitle: 'Tratamiento de Línea 1', kind: 'process', note: '2 filtros en serie · sin medición' },
  { id: 'filtro-l2', title: 'Filtración por Arena', subtitle: 'Tratamiento de Línea 2', kind: 'process', note: 'Sin medición vinculada' },
  { id: 'filtro-l3', title: 'Filtración por Arena', subtitle: 'Tratamiento de Línea 3', kind: 'process', note: 'Sin medición vinculada' },
  { id: 'filtro-l4', title: 'Filtración bolsa 10 μm', subtitle: 'Tratamiento de Línea 4', kind: 'process', note: 'Sin medición vinculada' },
  { id: 'filtro-l5', title: 'Filtración bolsa 5 μm', subtitle: 'Tratamiento de Línea 5', kind: 'process', note: 'Sin medición vinculada' },
  { id: 'filtro-l6', title: 'Filtración bolsa 1 μm', subtitle: 'Tratamiento de Línea 6', kind: 'process', note: 'Sin medición vinculada' },
  { id: 'placa-l7', title: 'Placa diversora', subtitle: 'Intermedio de Línea 7', kind: 'distribution', note: 'Sin medición vinculada' },

  { id: 'uv-l1', title: 'Desinfección UV', subtitle: 'Ruta Línea 1', kind: 'uv', note: 'Sin sensor confirmado para este nodo' },
  { id: 'uv-l2', title: 'Desinfección UV', subtitle: 'Ruta Línea 2', kind: 'uv', note: 'Sin sensor confirmado para este nodo' },
  { id: 'uv-l3', title: 'Desinfección UV', subtitle: 'Ruta Línea 3', kind: 'uv', note: 'Sin sensor confirmado para este nodo' },
  { id: 'uv-l4', title: 'Desinfección UV', subtitle: 'Ruta Línea 4', kind: 'uv', note: 'Sin sensor confirmado para este nodo' },
  { id: 'uv-l5', title: 'Desinfección UV', subtitle: 'Ruta Línea 5', kind: 'uv', note: 'Sin sensor confirmado para este nodo' },
  { id: 'uv-l6', title: 'Desinfección UV', subtitle: 'Ruta Línea 6', kind: 'uv', note: 'Sin sensor confirmado para este nodo' },
  { id: 'retorno-lineas', title: 'Retorno agua recuperada de líneas', subtitle: 'Retorno conceptual', kind: 'return', note: 'Ruta del plano base · por revisar' },

  { id: 'pulidor-1', title: 'Filtración Cartuchos Pulidores 1 μm', subtitle: 'Recuperación / reúso', kind: 'reuse', note: 'Sin medición vinculada' },
  { id: 'pulidor-02-a', title: 'Filtración Cartuchos Pulidores 0.2 μm', subtitle: 'Recuperación / reúso', kind: 'reuse', note: 'Sin medición vinculada' },
  { id: 'buffer-47', title: 'Tanque Buffer 47 m³', subtitle: 'Recuperación / reúso', kind: 'reuse', note: 'Sin nivel confirmado' },
  { id: 'pulidor-02-b', title: 'Filtración Cartuchos Pulidores 0.2 μm', subtitle: 'Recuperación / reúso', kind: 'reuse', note: 'Sin medición vinculada' },
  { id: 'uv-reuso', title: 'Desinfección UV', subtitle: 'Recuperación / reúso', kind: 'reuse', note: 'Sin sensor confirmado para este nodo' },
  { id: 'agua-recuperada', title: 'Agua Recuperada', subtitle: 'Flujo medido del dashboard', kind: 'reuse', liveKey: 'aguaRecuperada' },
];

const EDGES: DiagramEdgeDefinition[] = [
  { id: 'p1-dura', source: 'pozo-1', target: 'agua-dura' },
  { id: 'p2-dura', source: 'pozo-2', target: 'agua-dura' },
  { id: 'p3-dura', source: 'pozo-3', target: 'agua-dura' },
  { id: 'dura-arena', source: 'agua-dura', target: 'arena-cruda' },
  { id: 'arena-carbon', source: 'arena-cruda', target: 'carbon-activado' },
  { id: 'carbon-desmin', source: 'carbon-activado', target: 'desmin-ionica' },
  { id: 'desmin-desgas', source: 'desmin-ionica', target: 'desgasificacion' },
  { id: 'desgas-desinc', source: 'desgasificacion', target: 'desincrustacion' },
  { id: 'desinc-pulmon', source: 'desincrustacion', target: 'tanque-pulmon' },

  { id: 'p4-buffer', source: 'pozo-4', target: 'buffer', dashed: true },
  { id: 'p5-cisterna', source: 'pozo-5', target: 'cisterna-suave', dashed: true },
  { id: 'p6-recovery', source: 'pozo-6', target: 'recuperacion-sensores', dashed: true },

  { id: 'cisterna-env', source: 'cisterna-suave', target: 'envasadoras-caldera' },
  { id: 'cisterna-rec', source: 'cisterna-suave', target: 'recuperacion-sensores' },
  { id: 'rec-infers', source: 'recuperacion-sensores', target: 'agua-recuperacion-infers' },
  { id: 'infers-carf', source: 'agua-recuperacion-infers', target: 'carf-filtrada' },
  { id: 'carf-car', source: 'carf-filtrada', target: 'car-recuperada' },
  { id: 'car-bolsa', source: 'car-recuperada', target: 'filtro-bolsa-clorada' },
  { id: 'pulmon-carbon3', source: 'tanque-pulmon', target: 'carbon-3' },
  { id: 'carbon3-cart', source: 'carbon-3', target: 'cartuchos-3' },
  { id: 'cart-uv', source: 'cartuchos-3', target: 'uv-agua-tratada' },
  { id: 'bolsa-total', source: 'filtro-bolsa-clorada', target: 'agua-tratada-total' },
  { id: 'uv-total', source: 'uv-agua-tratada', target: 'agua-tratada-total' },
  { id: 'total-buffer', source: 'agua-tratada-total', target: 'buffer' },

  { id: 'buffer-l1', source: 'buffer', target: 'linea-1', tone: 'production' },
  { id: 'buffer-l2', source: 'buffer', target: 'linea-2', tone: 'production' },
  { id: 'buffer-l3', source: 'buffer', target: 'linea-3', tone: 'production' },
  { id: 'buffer-l4', source: 'buffer', target: 'linea-4', tone: 'production' },
  { id: 'buffer-l5', source: 'buffer', target: 'linea-5', tone: 'production' },
  { id: 'buffer-l6', source: 'buffer', target: 'linea-6', tone: 'production' },
  { id: 'buffer-l7', source: 'buffer', target: 'linea-7', tone: 'production' },

  { id: 'l1-filter', source: 'linea-1', target: 'filtro-l1', tone: 'production' },
  { id: 'l2-filter', source: 'linea-2', target: 'filtro-l2', tone: 'production' },
  { id: 'l3-filter', source: 'linea-3', target: 'filtro-l3', tone: 'production' },
  { id: 'l4-filter', source: 'linea-4', target: 'filtro-l4', tone: 'production' },
  { id: 'l5-filter', source: 'linea-5', target: 'filtro-l5', tone: 'production' },
  { id: 'l6-filter', source: 'linea-6', target: 'filtro-l6', tone: 'production' },
  { id: 'l7-placa', source: 'linea-7', target: 'placa-l7', tone: 'production' },

  { id: 'f1-uv', source: 'filtro-l1', target: 'uv-l1', tone: 'production' },
  { id: 'f2-uv', source: 'filtro-l2', target: 'uv-l2', tone: 'production' },
  { id: 'f3-uv', source: 'filtro-l3', target: 'uv-l3', tone: 'production' },
  { id: 'f4-uv', source: 'filtro-l4', target: 'uv-l4', tone: 'production' },
  { id: 'f5-uv', source: 'filtro-l5', target: 'uv-l5', tone: 'production' },
  { id: 'f6-uv', source: 'filtro-l6', target: 'uv-l6', tone: 'production' },
  { id: 'placa-return', source: 'placa-l7', target: 'retorno-lineas', tone: 'production', dashed: true },

  { id: 'uv1-pulidor1', source: 'uv-l1', target: 'pulidor-1', tone: 'reuse' },
  { id: 'uv2-pulidor02a', source: 'uv-l2', target: 'pulidor-02-a', tone: 'reuse' },
  { id: 'uv3-buffer47', source: 'uv-l3', target: 'buffer-47', tone: 'reuse' },
  { id: 'uv4-pulidor02b', source: 'uv-l4', target: 'pulidor-02-b', tone: 'reuse' },
  { id: 'uv5-uvreuse', source: 'uv-l5', target: 'uv-reuso', tone: 'reuse' },
  { id: 'uv6-rec', source: 'uv-l6', target: 'agua-recuperada', tone: 'reuse', dashed: true },
  { id: 'pul1-rec', source: 'pulidor-1', target: 'agua-recuperada', tone: 'reuse' },
  { id: 'pul02a-rec', source: 'pulidor-02-a', target: 'agua-recuperada', tone: 'reuse' },
  { id: 'buf47-rec', source: 'buffer-47', target: 'agua-recuperada', tone: 'reuse' },
  { id: 'pul02b-rec', source: 'pulidor-02-b', target: 'agua-recuperada', tone: 'reuse' },
  { id: 'uvreuse-rec', source: 'uv-reuso', target: 'agua-recuperada', tone: 'reuse' },
  { id: 'rec-return', source: 'agua-recuperada', target: 'retorno-lineas', tone: 'reuse', dashed: true },
  { id: 'return-recovery', source: 'retorno-lineas', target: 'recuperacion-sensores', tone: 'reuse', dashed: true },
];

function loadLayout(): { nodes: DiagramPositions; zones: ZonePositions } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredDiagramLayout;
      return {
        nodes: { ...DEFAULT_POSITIONS, ...(parsed.nodes || {}) },
        zones: { ...DEFAULT_ZONE_POSITIONS, ...(parsed.zones || {}) },
      };
    }
  } catch {
    // El prototipo puede funcionar sin persistencia local.
  }
  return { nodes: DEFAULT_POSITIONS, zones: DEFAULT_ZONE_POSITIONS };
}

function normalizedText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function searchableItemText(item: FlexibleRecord): string {
  return normalizedText([
    item.name,
    item.nombre,
    item.label,
    item.title,
    item.id,
    item.identity,
    item.operational_key,
  ].filter(Boolean).join(' '));
}

function findByAliases(items: FlexibleRecord[], aliases: string[]): FlexibleRecord | null {
  const normalizedAliases = aliases.map(normalizedText);
  return items.find((item) => {
    const haystack = searchableItemText(item);
    return normalizedAliases.some((alias) => haystack === alias || haystack.includes(alias));
  }) || null;
}

function formatFlow(item: FlexibleRecord | null): string {
  if (!item) return 'Sin lectura vinculada';
  const value = flowValue(item);
  const unit = String(item.flow_unit || 'L/s');
  return value === null ? 'Sin lectura actual' : `${formatNumber(value)} ${unit}`;
}

function formatTotalizer(item: FlexibleRecord | null): string {
  if (!item) return 'Sin totalizador vinculado';
  const value = currentTotalizerValue(item);
  return value === null ? 'Sin totalizador actual' : `Totalizador · ${formatNumber(value)} m³`;
}

function nodeIcon(kind: NodeKind) {
  if (kind === 'source') return <Droplets size={20} />;
  if (kind === 'process') return <FlaskConical size={20} />;
  if (kind === 'storage') return <Gauge size={20} />;
  if (kind === 'distribution') return <GitBranch size={20} />;
  if (kind === 'uv') return <Lightbulb size={20} />;
  if (kind === 'reuse' || kind === 'return') return <RefreshCw size={20} />;
  return <Factory size={20} />;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function HydricTopologySection() {
  const controller = useSqlChartDashboard('dashboard', undefined, {
    includeHistory: false,
    includePeriodDeltas: true,
    polling: true,
  });
  const initialLayoutRef = useRef(loadLayout());
  const [editing, setEditing] = useState(false);
  const [positions, setPositions] = useState<DiagramPositions>(initialLayoutRef.current.nodes);
  const [zonePositions, setZonePositions] = useState<ZonePositions>(initialLayoutRef.current.zones);
  const [savedNotice, setSavedNotice] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 2240, height: 1180 });
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number } | null>(null);
  const zoneDragRef = useRef<{ id: string; pointerId: number } | null>(null);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === panelRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const dashboard = asRecord(controller.dashboard);
  const wells = asRows(dashboard.wells || dashboard.pozos);
  const lines = asRows(dashboard.production_lines);
  const flows = asRows(dashboard.flows);

  const liveMap = useMemo<Record<LiveKey, FlexibleRecord | null>>(() => ({
    pozo1: findByAliases(wells, ['Pozo 1']),
    pozo2: findByAliases(wells, ['Pozo 2']),
    pozo3: findByAliases(wells, ['Pozo 3']),
    pozo4: findByAliases(wells, ['Pozo 4']),
    pozo5: findByAliases(wells, ['Pozo 5']),
    linea1: findByAliases(lines, ['Linea 1', 'Línea 1']),
    linea2: findByAliases(lines, ['Linea 2', 'Línea 2']),
    linea3: findByAliases(lines, ['Linea 3', 'Línea 3']),
    linea4: findByAliases(lines, ['Linea 4', 'Línea 4']),
    linea5: findByAliases(lines, ['Linea 5', 'Línea 5']),
    linea6: findByAliases(lines, ['Linea 6', 'Línea 6']),
    linea7: findByAliases(lines, ['Linea 7', 'Línea 7']),
    aguaRecuperada: findByAliases(flows, ['Agua Recuperada']),
    aguaTratadaTotal: findByAliases(flows, ['Agua Tratada Total']),
  }), [wells, lines, flows]);

  const monitoredNodes = NODE_DEFINITIONS.filter((node) => node.liveKey).length;
  const availableNodes = NODE_DEFINITIONS.filter((node) => node.liveKey && liveMap[node.liveKey] && flowValue(liveMap[node.liveKey]) !== null).length;
  const conceptualNodes = NODE_DEFINITIONS.length - monitoredNodes;
  const latestUpdate = dashboard.last_update || dashboard.updated_at || dashboard.generated_at;

  const saveLayout = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes: positions, zones: zonePositions }));
      setSavedNotice('Diseño de prueba guardado en este navegador.');
    } catch {
      setSavedNotice('No fue posible guardar el diseño local.');
    }
    window.setTimeout(() => setSavedNotice(''), 2400);
  };

  const resetLayout = () => {
    setPositions(DEFAULT_POSITIONS);
    setZonePositions(DEFAULT_ZONE_POSITIONS);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* persistencia opcional */ }
    setSavedNotice('Diseño restablecido a la propuesta inicial.');
    window.setTimeout(() => setSavedNotice(''), 2200);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (!editing) return;
    dragRef.current = { id, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (!editing || dragRef.current?.id !== id || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const nextX = clamp((event.clientX - rect.left - NODE_HALF_WIDTH) / Math.max(rect.width, 1), 0.005, 0.91);
    const nextY = clamp((event.clientY - rect.top - NODE_HALF_HEIGHT) / Math.max(rect.height, 1), 0.045, 0.91);
    setPositions((previous) => ({ ...previous, [id]: { x: nextX, y: nextY } }));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (dragRef.current?.id !== id) return;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
    dragRef.current = null;
  };

  const onZonePointerDown = (event: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (!editing) return;
    zoneDragRef.current = { id, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  };

  const onZonePointerMove = (event: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (!editing || zoneDragRef.current?.id !== id || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    setZonePositions((previous) => ({
      ...previous,
      [id]: {
        x: clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0.005, 0.89),
        y: clamp((event.clientY - rect.top) / Math.max(rect.height, 1), 0.005, 0.92),
      },
    }));
  };

  const onZonePointerUp = (event: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (zoneDragRef.current?.id !== id) return;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
    zoneDragRef.current = null;
  };

  const toggleFullscreen = async () => {
    if (!panelRef.current) return;
    try {
      if (document.fullscreenElement === panelRef.current) await document.exitFullscreen();
      else await panelRef.current.requestFullscreen();
    } catch {
      setSavedNotice('El navegador no permitió abrir pantalla completa.');
      window.setTimeout(() => setSavedNotice(''), 2200);
    }
  };

  const anchor = (id: string) => {
    const pos = positions[id] || DEFAULT_POSITIONS[id] || { x: 0.5, y: 0.5 };
    return {
      x: pos.x * canvasSize.width + NODE_HALF_WIDTH,
      y: pos.y * canvasSize.height + NODE_HALF_HEIGHT,
    };
  };

  const edgePath = (sourceId: string, targetId: string) => {
    const source = anchor(sourceId);
    const target = anchor(targetId);
    const direction = target.x >= source.x ? 1 : -1;
    const elbow = source.x + direction * Math.max(36, Math.abs(target.x - source.x) * 0.48);
    return `M ${source.x} ${source.y} H ${elbow} V ${target.y} H ${target.x}`;
  };

  return (
    <div className="hydric-proto-page">
      <section className="panel fade-up hydric-proto-hero">
        <div className="hydric-proto-hero-head">
          <div>
            <span className="section-eyebrow">PROTOTIPO · PLANTA LAS FUENTES</span>
            <h2>Diagrama hídrico editable</h2>
            <p>Prueba funcional basada en el diagrama existente. La topología es conceptual; sólo los nodos vinculados muestran datos reales del dashboard.</p>
          </div>
          <div className="hydric-proto-live-status">
            <span className={`hydric-proto-live-dot ${controller.error ? 'error' : 'ok'}`} />
            <div>
              <span>{controller.refreshing ? 'Actualizando...' : controller.error ? 'Lecturas parciales' : 'Datos actuales'}</span>
              <strong>{formatLocalDate(latestUpdate)}</strong>
            </div>
          </div>
        </div>

        <div className="cards-grid hydric-proto-kpis">
          <KpiCard label="Nodos del prototipo" value={String(NODE_DEFINITIONS.length)} unit="nodos" trend="Incluye procesos sin instrumentación" accent="blue" />
          <KpiCard label="Puntos vinculados" value={String(monitoredNodes)} unit="nodos" trend="Sólo contratos actuales confirmados" accent="cyan" />
          <KpiCard label="Con lectura de flujo" value={`${availableNodes}/${monitoredNodes}`} unit="puntos" trend="Lectura actual disponible" accent="green" />
          <KpiCard label="Nodos conceptuales" value={String(conceptualNodes)} unit="nodos" trend="No se presentan como cero" accent="blue" />
        </div>
      </section>

      <section className={`panel fade-up hydric-proto-editor-panel ${isFullscreen ? 'is-fullscreen' : ''}`} ref={panelRef}>
        <div className="hydric-proto-toolbar">
          <div>
            <h3>Topología hídrica editable</h3>
            <p>{editing ? 'Modo edición: arrastra nodos y encabezados. El guardado de esta prueba es sólo local.' : 'Modo vista: los nodos están bloqueados para evitar cambios accidentales.'}</p>
          </div>
          <div className="hydric-proto-toolbar-actions">
            <div className="hydric-proto-mode-switch" role="group" aria-label="Modo del diagrama">
              <button type="button" className={!editing ? 'active' : ''} onClick={() => setEditing(false)}><Lock size={16} /> Vista</button>
              <button type="button" className={editing ? 'active' : ''} onClick={() => setEditing(true)}><Unlock size={16} /> Edición</button>
            </div>
            <button type="button" onClick={saveLayout} disabled={!editing}><Save size={16} /> Guardar diseño</button>
            <button type="button" onClick={resetLayout}><RotateCcw size={16} /> Restablecer</button>
            <button type="button" onClick={() => { setPositions(DEFAULT_POSITIONS); setZonePositions(DEFAULT_ZONE_POSITIONS); }} disabled={!editing}><Move size={16} /> Auto layout</button>
            <button type="button" onClick={() => void toggleFullscreen()}>{isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />} {isFullscreen ? 'Salir' : 'Pantalla completa'}</button>
          </div>
        </div>

        <div className="hydric-proto-caution">
          <Activity size={17} />
          <span><strong>Prueba V1:</strong> Pozo 6 permanece como elemento del plano sin sensor vinculado; SOSA 50% no se coloca hasta confirmar su ubicación física. Las conexiones son base visual para revisión, no un balance oficial.</span>
        </div>
        {savedNotice ? <div className="hydric-proto-save-notice" role="status">{savedNotice}</div> : null}
        {controller.error ? <div className="hydric-proto-data-warning">No fue posible actualizar todas las lecturas actuales. El diagrama conceptual sigue disponible.</div> : null}

        <div className="hydric-proto-scroll-shell">
          <div className={`hydric-proto-canvas ${editing ? 'is-editing' : ''}`} ref={canvasRef}>
            {ZONE_LABELS.map((zone) => {
              const pos = zonePositions[zone.id] || DEFAULT_ZONE_POSITIONS[zone.id];
              return (
                <div
                  key={zone.id}
                  className={`hydric-proto-zone-label ${zone.className} ${editing ? 'is-draggable' : ''}`}
                  style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
                  onPointerDown={(event) => onZonePointerDown(event, zone.id)}
                  onPointerMove={(event) => onZonePointerMove(event, zone.id)}
                  onPointerUp={(event) => onZonePointerUp(event, zone.id)}
                  onPointerCancel={(event) => onZonePointerUp(event, zone.id)}
                >
                  {zone.label}
                  {editing ? <Move size={12} /> : null}
                </div>
              );
            })}

            <svg className="hydric-proto-connections" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`} preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <marker id="hydric-proto-arrow-water" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill="#1aa7e8" /></marker>
                <marker id="hydric-proto-arrow-production" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill="#18b98a" /></marker>
                <marker id="hydric-proto-arrow-reuse" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L8,4 L0,8 z" fill="#a855d4" /></marker>
              </defs>
              {EDGES.map((edge) => (
                <path
                  key={edge.id}
                  d={edgePath(edge.source, edge.target)}
                  className={`hydric-proto-edge hydric-proto-edge-${edge.tone || 'water'} ${edge.dashed ? 'is-dashed' : ''}`}
                  markerEnd={`url(#hydric-proto-arrow-${edge.tone || 'water'})`}
                />
              ))}
            </svg>

            {NODE_DEFINITIONS.map((node) => {
              const pos = positions[node.id] || DEFAULT_POSITIONS[node.id];
              const liveItem = node.liveKey ? liveMap[node.liveKey] : null;
              const measured = Boolean(node.liveKey);
              return (
                <div
                  key={node.id}
                  className={`hydric-proto-node hydric-proto-node-${node.kind} ${measured ? 'is-monitored' : 'is-conceptual'} ${editing ? 'is-draggable' : ''}`}
                  style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
                  onPointerDown={(event) => onPointerDown(event, node.id)}
                  onPointerMove={(event) => onPointerMove(event, node.id)}
                  onPointerUp={(event) => onPointerUp(event, node.id)}
                  onPointerCancel={(event) => onPointerUp(event, node.id)}
                >
                  <div className="hydric-proto-node-icon">{nodeIcon(node.kind)}</div>
                  <div className="hydric-proto-node-copy">
                    <span>{node.subtitle}</span>
                    <strong title={node.title}>{node.title}</strong>
                    {measured ? (
                      <>
                        <small className="hydric-proto-node-flow">{formatFlow(liveItem)}</small>
                        <small className="hydric-proto-node-totalizer">{formatTotalizer(liveItem)}</small>
                      </>
                    ) : (
                      <small className="hydric-proto-node-note">{node.note || 'Sin instrumentación vinculada'}</small>
                    )}
                  </div>
                  {editing ? <Move size={14} className="hydric-proto-drag-handle" /> : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="hydric-proto-footer">
          <div className="hydric-proto-legend">
            <strong>Leyenda</strong>
            <span><i className="hydric-proto-legend-line water" /> Flujo conceptual de agua</span>
            <span><i className="hydric-proto-legend-line production" /> Producción / distribución</span>
            <span><i className="hydric-proto-legend-line reuse" /> Recuperación / reúso</span>
            <span><i className="hydric-proto-legend-node measured" /> Medición real vinculada</span>
            <span><i className="hydric-proto-legend-node conceptual" /> Nodo sin instrumentación confirmada</span>
          </div>
          <div className="hydric-proto-stats">
            <span><small>Nodos</small><strong>{NODE_DEFINITIONS.length}</strong></span>
            <span><small>Conexiones</small><strong>{EDGES.length}</strong></span>
            <span><small>Monitoreados</small><strong>{monitoredNodes}</strong></span>
            <span><small>Con lectura</small><strong>{availableNodes}</strong></span>
          </div>
          <div className="hydric-proto-note">
            <Waves size={18} />
            <span>Prototipo local para validar distribución visual y topología antes de persistir el diseño en backend.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
