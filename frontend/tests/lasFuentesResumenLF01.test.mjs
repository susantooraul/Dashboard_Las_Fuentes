import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboard = readFileSync(new URL('../src/pages/pozos/sections/DashboardBaseSection.tsx', import.meta.url), 'utf8');
const history = readFileSync(new URL('../src/pages/pozos/components/OperationalModuleHistoryPanel.tsx', import.meta.url), 'utf8');
const alerts = readFileSync(new URL('../src/pages/pozos/components/OperationalAlertsPanel.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/PozosDashboardPage.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/pages/resumen.css', import.meta.url), 'utf8');
const config = readFileSync(new URL('../../backend/app/services/insurgentes_config.py', import.meta.url), 'utf8');

for (const key of ['pozos', 'tam', 'embotellado', 'cisterna']) {
  assert.match(dashboard, new RegExp(`key: '${key}'`), `falta proceso ${key}`);
}
assert.doesNotMatch(dashboard, /Accesos operativos/, 'Resumen no debe conservar Accesos operativos');
assert.match(dashboard, /OperationalModuleHistoryPanel/, 'falta histórico operativo');
assert.match(dashboard, /allowedElementIds=\{selectedHistoryIds\}/, 'el histórico debe filtrar los grupos de flujos');
assert.match(dashboard, /item\.sensor_id/, 'el filtro histórico debe derivarse de sensores reales');
assert.match(dashboard, /OperationalAlertsPanel subtitle="" hideWhenEmpty/, 'las alertas saludables deben ocultarse en Resumen');

assert.match(history, /allowedElementIds\?: string\[\]/, 'falta contrato de filtro del histórico compartido');
assert.match(history, /matchesAllowedElement\(element, allowedSet\)/, 'los elementos visibles deben filtrarse');
assert.match(history, /matchesAllowedElement\(row, allowedSet\)/, 'las filas históricas deben filtrarse');
assert.match(history, /String\(item\.sensor_id\)/, 'el filtro compartido debe aceptar sensor_id además del id operativo');
assert.match(history, /selectedIds/, 'las exportaciones deben conservar la selección visible');
assert.match(history, /exportableSensorIds/, 'Excel 5 min debe usar sensores visibles');

assert.match(alerts, /hideWhenEmpty\?: boolean/, 'falta modo de alertas condicionales');
assert.match(alerts, /if \(hideWhenEmpty && !alerts\.length && !error\) return null;/, 'el estado saludable no debe ocupar espacio');
assert.match(page, /styles\/pages\/resumen\.css/, 'resumen.css debe estar importado por runtime');
assert.match(css, /\[data-section='dashboard'\]/, 'los estilos nuevos deben estar scoped al Resumen');

for (const fragment of [
  '"start": "00:00", "end": "07:00"',
  '"start": "07:00", "end": "15:00"',
  '"start": "15:00", "end": "24:00"',
]) {
  assert.ok(config.includes(fragment), `turno provisional alterado: ${fragment}`);
}

console.log('LF-01 Resumen V2: validación contractual dirigida OK');
