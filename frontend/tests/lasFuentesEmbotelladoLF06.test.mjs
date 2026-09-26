import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const section = read('../src/pages/pozos/sections/FlujosSection.tsx');
const history = read('../src/pages/pozos/components/OperationalModuleHistoryPanel.tsx');
const page = read('../src/pages/PozosDashboardPage.jsx');
const css = read('../src/styles/pages/embotellado.css');
const config = read('../../backend/app/services/insurgentes_config.py');

assert.match(section, /if \(group === 'embotellado'\)/, 'LF-06 debe limitar la nueva jerarquía general a Embotellado');
assert.match(section, /className="lf-embotellado-page"/, 'falta scope visual general de Embotellado');
assert.match(section, />Operando</, 'falta KPI Operando');
assert.match(section, />\{generalVolumeLabel\(group\)\}</, 'falta KPI principal de consumo');
assert.match(section, />Flujo total</, 'falta KPI Flujo total');
assert.match(section, />Totalizador actual</, 'falta KPI Totalizador actual');

const start = section.indexOf("if (group === 'embotellado')");
const end = section.indexOf('\n  return (', start);
const view = section.slice(start, end);

const cardsPos = view.indexOf('aria-label="Medidores operativos de Embotellado"');
const historyPos = view.indexOf('<OperationalModuleHistoryPanel');
const shiftsPos = view.indexOf('<ShiftCutsPanel module="flujos" group="embotellado"');
assert.ok(cardsPos > 0 && historyPos > cardsPos && shiftsPos > historyPos, 'orden esperado en Embotellado: cards -> histórico -> turnos');

assert.match(view, /lf-embotellado-card__primary/, 'faltan métricas primarias de Embotellado');
assert.match(view, /<span>Consumo hoy<\/span>/, 'Consumo hoy debe ser protagonista');
assert.match(view, /<span>Flujo actual<\/span>/, 'Flujo actual debe ser protagonista');
assert.match(view, /lf-embotellado-card__secondary/, 'faltan métricas secundarias de Embotellado');
assert.match(view, /<span>Totalizador actual<\/span>/, 'falta Totalizador actual secundario');
assert.match(view, /<span>Tiempo activo<\/span>/, 'falta Tiempo activo secundario');
assert.match(view, /<span>Encendidos<\/span>/, 'falta Encendidos secundario');
assert.doesNotMatch(view, /<span>Actividad<\/span>/, 'Actividad no debe ocupar una métrica adicional');
assert.doesNotMatch(view, /<span>Comunicación<\/span>/, 'Comunicación saludable no debe ocupar la card');
assert.doesNotMatch(view, /<span>Validación<\/span>/, 'Validación saludable no debe ocupar la card');
assert.doesNotMatch(view, /Medidor configurado/, 'la card no debe repetir un subtítulo obvio');
assert.match(view, /itemUpdateText\(flow\)/, 'debe conservarse la última lectura');

assert.match(view, /allowedElementIds=\{embotelladoElementIds\}/, 'el histórico Embotellado debe filtrar sus propios elementos');
assert.match(view, /titleOverride="Histórico operativo · Embotellado"/, 'el histórico debe identificarse como Embotellado');
assert.match(history, /matchesAllowedElement/, 'el histórico compartido debe conservar filtro explícito');
assert.match(history, /String\(item\.sensor_id\)/, 'el filtro debe aceptar IDs físicos');
assert.match(history, /idOf\(item\)/, 'el filtro debe aceptar IDs operativos');

for (const fragment of [
  '("entrada-pc-1", "Entrada PC 1", 3028, 13)',
  '("entrada-pc-2", "Entrada PC 2", 3030, 14)',
  '("entrada-pc-3", "Entrada PC 3", 3032, 15)',
  '("cip", "CIP", 3034, 16)',
]) {
  assert.ok(config.includes(fragment), `falta medidor confirmado de Embotellado: ${fragment}`);
}

assert.match(section, /const allFlows = asRows\(dashboard\.flows\)\.filter\(\(item\) => String\(item\.module_group \|\| ''\) === group\)/, 'cada vista debe partir del filtro por module_group');
assert.match(view, /const embotelladoElementIds = allFlows\.map\(idOf\)\.filter\(Boolean\)/, 'el histórico debe derivar IDs únicamente del grupo Embotellado ya filtrado');
assert.ok(config.includes('\"id\": \"salida-cisterna\"') && config.includes('\"sensor_id\": 3036'), 'Cisterna debe seguir existiendo como elemento separado');

assert.match(page, /styles\/pages\/embotellado\.css/, 'embotellado.css debe estar importado por runtime');
assert.match(css, /\[data-section='embotellado'\] \.lf-embotellado-page/, 'CSS debe estar scoped a Embotellado');
assert.match(css, /theme-light \[data-section='embotellado'\]/, 'falta modo claro específico');
assert.match(css, /@media \(max-width: 720px\)/, 'falta responsive móvil');

for (const fragment of [
  '"start": "00:00", "end": "07:00"',
  '"start": "07:00", "end": "15:00"',
  '"start": "15:00", "end": "24:00"',
]) {
  assert.ok(config.includes(fragment), `turno provisional alterado: ${fragment}`);
}

console.log('LF-06 Jerarquía Embotellado: validación contractual dirigida OK');
