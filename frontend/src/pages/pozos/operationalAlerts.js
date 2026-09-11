import { classifyLevelAlert } from './levelAlertThresholds.js';

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function asRecord(value) {
  return value && typeof value === 'object' ? value : {};
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeId(value) {
  return String(value ?? '').trim();
}

function isPresent(value) {
  return value !== null && value !== undefined && value !== '';
}

function firstPresent(...values) {
  return values.find(isPresent);
}

function safeName(item, fallback) {
  return String(firstPresent(item.name, item.nombre, item.label, item.id, fallback));
}

function safeId(item, fallback) {
  return normalizeId(firstPresent(item.id, item.sensor_id, item.column, item.state_field, item.name, item.nombre, fallback));
}

function hasOperationalReading(item, fields) {
  if (isPresent(item.updated) || isPresent(item.ultima_lectura) || isPresent(item.last_update)) return true;
  return fields.some((field) => isPresent(item[field]));
}

function routeFor(module, id) {
  if (!id) return module === 'entrada' ? '/pozos/entrada' : `/pozos/${module}`;
  if (module === 'entrada') return '/pozos/entrada';
  return `/pozos/${module}/${encodeURIComponent(id)}`;
}

function explicitSeverity(item) {
  const fields = [
    item.statusType,
    item.communicationType,
    item.period_status_type,
    item.severity,
    item.alert_level,
    item.stateType,
  ].map(normalizeText).join(' ');
  const labels = [
    item.status,
    item.estado_comunicacion,
    item.communication,
    item.period_note,
    item.period_status,
    item.state,
    item.message,
  ].map(normalizeText).join(' ');
  const merged = `${fields} ${labels}`;

  if (merged.includes('critical') || merged.includes('crítica') || merged.includes('critica') || merged.includes('error') || merged.includes('offline')) return 'critical';
  if ((merged.includes('parcial') || merged.includes('partial')) && !merged.includes('sin lectura') && !merged.includes('no disponible')) return '';
  if (merged.includes('warning') || merged.includes('warn') || merged.includes('revisar') || merged.includes('atención') || merged.includes('atencion') || merged.includes('alerta')) return 'warning';
  return '';
}

function hasCommunicationFailure(item) {
  const merged = [item.communicationType, item.estado_comunicacion, item.communication, item.statusType, item.status]
    .map(normalizeText)
    .join(' ');
  if (!merged) return false;
  return (
    merged.includes('sin comunicación') ||
    merged.includes('sin comunicacion') ||
    merged.includes('comunicación caída') ||
    merged.includes('comunicacion caida') ||
    merged.includes('comunicacion perdida') ||
    merged.includes('comunicación perdida') ||
    merged.includes('offline') ||
    merged.includes('desconect') ||
    merged.includes('no comunica') ||
    merged.includes('communication_error') ||
    merged.includes('communication error')
  );
}

function hasStaleReading(item) {
  const merged = [item.communicationType, item.estado_comunicacion, item.communication, item.statusType, item.status, item.period_note]
    .map(normalizeText)
    .join(' ');
  return merged.includes('atrasad') || merged.includes('no reciente') || merged.includes('desactualizad') || merged.includes('stale');
}

function hasExplicitNoReading(item) {
  const merged = [item.status, item.statusType, item.estado_comunicacion, item.communication, item.communicationType, item.state]
    .map(normalizeText)
    .join(' ');
  return (
    merged.includes('sin lectura') ||
    merged.includes('lectura no disponible') ||
    merged.includes('no disponible') ||
    merged.includes('sin datos') ||
    merged.includes('no data') ||
    merged.includes('missing reading')
  );
}

function createAlert({ module, moduleLabel, item, fallbackId, fallbackName, condition, severity, title, message, route }) {
  const id = safeId(item, fallbackId);
  const name = safeName(item, fallbackName);
  return {
    id: `${module}:${id || 'module'}:${condition}`,
    module,
    moduleLabel,
    elementId: id,
    elementName: name,
    condition,
    severity,
    title,
    message,
    route: route || routeFor(module, id),
    timestamp: firstPresent(item.updated, item.ultima_lectura, item.last_update, new Date().toISOString()),
  };
}

function evaluateItem({ module, moduleLabel, item, fallbackId, fallbackName, readingFields }) {
  const alerts = [];
  const id = safeId(item, fallbackId);
  const name = safeName(item, fallbackName);
  const hasReading = hasOperationalReading(item, readingFields);

  if (hasCommunicationFailure(item)) {
    alerts.push(createAlert({
      module,
      moduleLabel,
      item,
      fallbackId,
      fallbackName,
      condition: 'communication-down',
      severity: 'critical',
      title: 'Sin comunicación',
      message: `${name} no reporta comunicación operativa normal.`,
    }));
  }

  if (!hasReading || hasExplicitNoReading(item)) {
    alerts.push(createAlert({
      module,
      moduleLabel,
      item,
      fallbackId,
      fallbackName,
      condition: 'no-current-reading',
      severity: 'warning',
      title: 'Lectura no disponible',
      message: `${name} no cuenta con lectura actual disponible.`,
    }));
  }

  if (hasStaleReading(item)) {
    alerts.push(createAlert({
      module,
      moduleLabel,
      item,
      fallbackId,
      fallbackName,
      condition: 'stale-reading',
      severity: 'warning',
      title: 'Lectura no reciente',
      message: `${name} requiere revisión de actualización de lectura.`,
    }));
  }

  const severity = explicitSeverity(item);
  if (severity && !alerts.some((alert) => alert.condition === 'communication-down' || alert.condition === 'no-current-reading')) {
    alerts.push(createAlert({
      module,
      moduleLabel,
      item,
      fallbackId,
      fallbackName,
      condition: 'explicit-status',
      severity,
      title: severity === 'critical' ? 'Estado crítico' : 'Estado en revisión',
      message: `${name} reporta un estado operativo que requiere atención.`,
    }));
  }

  return alerts.filter((alert, index, list) => list.findIndex((candidate) => candidate.id === alert.id) === index && id !== '');
}

export function evaluateOperationalAlerts(dashboardInput) {
  const dashboard = asRecord(dashboardInput);
  const alerts = [];
  const entry = asRecord(dashboard.water_entry);
  const wells = asArray(dashboard.wells || dashboard.pozos);
  const lines = asArray(dashboard.production_lines);
  const flows = asArray(dashboard.flows);
  const levels = asArray(dashboard.tank_inputs);
  const lamps = asArray(dashboard.uv_lamps);

  if (Object.keys(entry).length && entry.visible !== false) {
    alerts.push(...evaluateItem({
      module: 'entrada',
      moduleLabel: 'Pozos Corporativos',
      item: entry,
      fallbackId: 'llegada-pozos',
      fallbackName: 'Pozos Corporativos',
      readingFields: ['flow_lps', 'period_m3', 'totalizador_m3'],
    }));
  }

  wells.forEach((item, index) => alerts.push(...evaluateItem({
    module: 'pozos',
    moduleLabel: 'Pozos',
    item: asRecord(item),
    fallbackId: `pozo-${index + 1}`,
    fallbackName: `Pozo ${index + 1}`,
    readingFields: ['flow_lps', 'period_m3', 'totalizador_m3'],
  })));

  lines.forEach((item, index) => alerts.push(...evaluateItem({
    module: 'lineas',
    moduleLabel: 'Líneas',
    item: asRecord(item),
    fallbackId: `linea-${index + 1}`,
    fallbackName: `Línea ${index + 1}`,
    readingFields: ['flow_lps', 'period_m3', 'totalizador_m3'],
  })));

  flows.forEach((item, index) => {
    const flow = asRecord(item);
    const group = ['tam', 'embotellado', 'cisterna'].includes(String(flow.module_group))
      ? String(flow.module_group)
      : 'tam';
    const groupLabel = {
      tam: 'Medidores de TAM',
      embotellado: 'Medidores de embotellado',
      cisterna: 'Medidor de cisterna',
    }[group];
    alerts.push(...evaluateItem({
      module: group,
      moduleLabel: groupLabel,
      item: flow,
      fallbackId: `flujo-${index + 1}`,
      fallbackName: `Flujo ${index + 1}`,
      readingFields: ['flow_lps', 'period_m3', 'totalizador_m3'],
    }));
  });

  levels.forEach((item, index) => {
    const level = asRecord(item);
    const fallbackId = `nivel-${index + 1}`;
    const fallbackName = `Nivel ${index + 1}`;
    const baseAlerts = evaluateItem({
      module: 'niveles',
      moduleLabel: 'Niveles',
      item: level,
      fallbackId,
      fallbackName,
      readingFields: ['level_m', 'fill_pct'],
    });
    alerts.push(...baseAlerts);

    const hasBlockingAlert = baseAlerts.some((alert) => (
      alert.condition === 'communication-down'
      || alert.condition === 'no-current-reading'
      || alert.condition === 'explicit-status'
    ));
    if (hasBlockingAlert) return;

    const fillPct = Number(firstPresent(level.fill_pct, level.level_pct, level.pct, level.value_pct));
    const threshold = classifyLevelAlert(fillPct);
    if (!threshold) return;

    const name = safeName(level, fallbackName);
    alerts.push(createAlert({
      module: 'niveles',
      moduleLabel: 'Niveles',
      item: level,
      fallbackId,
      fallbackName,
      condition: `level-${threshold.key}`,
      severity: threshold.severity,
      title: threshold.label,
      message: `${name} está en ${fillPct.toFixed(1)} %. ${threshold.risk}`,
    }));
  });

  lamps.forEach((item, index) => alerts.push(...evaluateItem({
    module: 'uv',
    moduleLabel: 'Lámparas UV',
    item: asRecord(item),
    fallbackId: `uv-${index + 1}`,
    fallbackName: `Lámpara UV ${index + 1}`,
    readingFields: ['state_code', 'agel', 'status_reading'],
  })));

  const severityOrder = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3) || String(a.moduleLabel).localeCompare(String(b.moduleLabel)) || String(a.elementName).localeCompare(String(b.elementName)));
}

export function diffNewAlertIds(previousIds, currentAlerts) {
  const previous = previousIds instanceof Set ? previousIds : new Set(previousIds || []);
  return currentAlerts.filter((alert) => !previous.has(alert.id)).map((alert) => alert.id);
}

export function activeAlertIdSet(alerts) {
  return new Set((alerts || []).map((alert) => alert.id));
}
