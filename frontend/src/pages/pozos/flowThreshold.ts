/** LF16. Evaluacion optativa, por intervalo, sobre la serie historica actual. */
import type { WaterHistoryPoint } from './types';

export type FlowThresholdDirection = 'below' | 'above' | 'both';
export type FlowThresholdBasis = 'extreme' | 'average';
export type FlowThresholdStatus = 'No revisado' | 'Sin lectura' | 'Bajo umbral' | 'Sobre umbral' | 'Fuera de rango' | 'Dentro de rango';

export interface FlowThresholdOptions {
  enabled: boolean;
  direction: FlowThresholdDirection;
  basis: FlowThresholdBasis;
  minValue: string;
  maxValue: string;
}
export interface FlowThresholdConfig {
  enabled: boolean;
  direction: FlowThresholdDirection;
  basis: FlowThresholdBasis;
  minValue: number | null;
  maxValue: number | null;
}

function numeric(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeThreshold(options: FlowThresholdOptions): { config: FlowThresholdConfig; error: string } {
  const config: FlowThresholdConfig = {
    enabled: options.enabled,
    direction: options.direction,
    basis: options.basis,
    minValue: numeric(options.minValue),
    maxValue: numeric(options.maxValue),
  };
  if (!options.enabled) return { config, error: '' };
  const needMin = options.direction !== 'above';
  const needMax = options.direction !== 'below';
  if (needMin && config.minValue === null) return { config, error: 'Indica el umbral mínimo en L/s.' };
  if (needMax && config.maxValue === null) return { config, error: 'Indica el umbral máximo en L/s.' };
  if ((needMin && config.minValue! < 0) || (needMax && config.maxValue! < 0)) {
    return { config, error: 'Los límites deben ser mayores o iguales a cero.' };
  }
  if (needMin && needMax && config.minValue! > config.maxValue!) {
    return { config, error: 'El mínimo no puede superar al máximo.' };
  }
  return { config, error: '' };
}

export function evaluateThreshold(point: WaterHistoryPoint, config: FlowThresholdConfig): FlowThresholdStatus {
  if (!config.enabled) return 'No revisado';
  const samples = numeric(point.samples);
  if (samples === null || samples <= 0) return 'Sin lectura';
  const average = numeric(point.flow_avg_lps);
  const low = config.basis === 'average' ? average : (numeric(point.flow_min_lps) ?? average);
  const high = config.basis === 'average' ? average : (numeric(point.flow_max_lps) ?? average);
  const needLow = config.direction !== 'above';
  const needHigh = config.direction !== 'below';
  if ((needLow && low === null) || (needHigh && high === null)) return 'Sin lectura';
  const below = needLow && low! < config.minValue!;
  const above = needHigh && high! > config.maxValue!;
  if (below && above) return 'Fuera de rango';
  if (below) return 'Bajo umbral';
  if (above) return 'Sobre umbral';
  return 'Dentro de rango';
}

export const thresholdIsIncident = (status: FlowThresholdStatus) =>
  status === 'Bajo umbral' || status === 'Sobre umbral' || status === 'Fuera de rango';

export function summarizeThreshold(points: WaterHistoryPoint[], config: FlowThresholdConfig) {
  const results = points.map((point) => ({ point, status: evaluateThreshold(point, config) }));
  return {
    results,
    total: results.length,
    breached: results.filter(({ status }) => thresholdIsIncident(status)).length,
    below: results.filter(({ status }) => status === 'Bajo umbral' || status === 'Fuera de rango').length,
    above: results.filter(({ status }) => status === 'Sobre umbral' || status === 'Fuera de rango').length,
    within: results.filter(({ status }) => status === 'Dentro de rango').length,
    noReading: results.filter(({ status }) => status === 'Sin lectura').length,
  };
}
