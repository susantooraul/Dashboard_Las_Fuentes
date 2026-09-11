/**
 * Umbrales preventivos provisionales para niveles/cisternas.
 *
 * Se mantienen centralizados para poder sustituirlos fácilmente cuando
 * Planta Las Fuentes confirme sus límites operativos definitivos.
 */
export const LEVEL_ALERT_THRESHOLDS = Object.freeze({
  criticalLowPct: 15,
  warningLowPct: 25,
  warningHighPct: 90,
  criticalHighPct: 95,
});

export function classifyLevelAlert(fillPct) {
  const value = Number(fillPct);
  if (!Number.isFinite(value)) return null;

  if (value <= LEVEL_ALERT_THRESHOLDS.criticalLowPct) {
    return {
      key: 'critical-low',
      severity: 'critical',
      label: 'Nivel muy bajo',
      risk: 'Reserva crítica. Priorizar recuperación del nivel.',
    };
  }
  if (value <= LEVEL_ALERT_THRESHOLDS.warningLowPct) {
    return {
      key: 'warning-low',
      severity: 'warning',
      label: 'Nivel bajo',
      risk: 'Nivel preventivo bajo. Monitorear consumo y recuperación.',
    };
  }
  if (value >= LEVEL_ALERT_THRESHOLDS.criticalHighPct) {
    return {
      key: 'critical-high',
      severity: 'critical',
      label: 'Nivel muy alto',
      risk: 'Nivel próximo al límite superior. Revisar operación de inmediato.',
    };
  }
  if (value >= LEVEL_ALERT_THRESHOLDS.warningHighPct) {
    return {
      key: 'warning-high',
      severity: 'warning',
      label: 'Nivel alto',
      risk: 'Nivel preventivo alto. Monitorear llenado y consumo.',
    };
  }
  return null;
}
