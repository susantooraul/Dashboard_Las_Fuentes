import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const section = read('../src/pages/pozos/sections/FlujosSection.tsx');
const history = read('../src/pages/pozos/components/OperationalModuleHistoryPanel.tsx');
const page = read('../src/pages/PozosDashboardPage.jsx');
const css = read('../src/styles/pages/cisterna.css');
const config = read('../../backend/app/services/insurgentes_config.py');

assert.match(section, /if \(group === 'cisterna'\)/, 'LF-07 debe limitar la nueva jerarquía general a Cisterna');
assert.match(section, /className="lf-cisterna-page"/, 'falta scope visual general de Cisterna');
assert.match(section, />Operando</, 'falta KPI Operando');
assert.match(section, />\{generalVolumeLabel\(group\)\}</, 'falta KPI principal de salida');
assert.match(section, />Flujo actual</, 'falta KPI Flujo actual');
assert.match(section, />Totalizador actual</, 'falta KPI Totalizador actual');

const start = section.lastIndexOf("if (group === 'cisterna')");
const end = section.indexOf('\n  return <ChartEmptyState', start);
const view = section.slice(start, end);

const cardsPos = view.indexOf('aria-label="Medidor operativo de Cisterna"');
const historyPos = view.indexOf('<OperationalModuleHistoryPanel');
const shiftsPos = view.indexOf('<ShiftCutsPanel module="flujos" group="cisterna"');
assert.ok(cardsPos > 0 && historyPos > cardsPos && shiftsPos > historyPos, 'orden esperado en Cisterna: card -> histórico -> turnos');

assert.match(view, /lf-cisterna-card__primary/, 'faltan métricas primarias de Cisterna');
assert.match(view, /<span>Salida hoy<\/span>/, 'Salida hoy debe ser protagonista');
assert.match(view, /<span>Flujo actual<\/span>/, 'Flujo actual debe ser protagonista');
assert.match(view, /lf-cisterna-card__secondary/, 'faltan métricas secundarias de Cisterna');
assert.match(view, /<span>Totalizador actual<\/span>/, 'falta Totalizador actual secundario');
assert.match(view, /<span>Tiempo activo<\/span>/, 'falta Tiempo activo secundario');
assert.match(view, /<span>Encendidos<\/span>/, 'falta Encendidos secundario');
assert.doesNotMatch(view, /<span>Actividad<\/span>/, 'Actividad no debe ocupar una métrica adicional');
assert.doesNotMatch(view, /<span>Comunicación<\/span>/, 'Comunicación saludable no debe ocupar la card');
assert.doesNotMatch(view, /<span>Validación<\/span>/, 'Validación saludable no debe ocupar la card');
assert.doesNotMatch(view, /Medidor configurado/, 'la card no debe repetir un subtítulo obvio');
assert.match(view, /itemUpdateText\(flow\)/, 'debe conservarse la última lectura');

assert.match(view, /allowedElementIds=\{cisternaElementIds\}/, 'el histórico Cisterna debe filtrar su propio elemento');
assert.match(view, /titleOverride="Histórico operativo · Cisterna"/, 'el histórico debe identificarse como Cisterna');
assert.match(history, /matchesAllowedElement/, 'el histórico compartido debe conservar filtro explícito');
assert.match(history, /String\(item\.sensor_id\)/, 'el filtro debe aceptar ID físico');
assert.match(history, /idOf\(item\)/, 'el filtro debe aceptar ID operativo');

assert.ok(config.includes('"id": "salida-cisterna"'), 'falta id operativo salida-cisterna');
assert.ok(config.includes('"name": "Salida de cisterna"'), 'falta nombre físico de Cisterna');
assert.ok(config.includes('"sensor_id": 3036'), 'Cisterna debe conservar sensor 3036');
assert.ok(config.includes('"module_group": "cisterna"'), '3036 debe permanecer en module_group cisterna');
assert.match(section, /const allFlows = asRows\(dashboard\.flows\)\.filter\(\(item\) => String\(item\.module_group \|\| ''\) === group\)/, 'cada vista debe partir del filtro por module_group');
assert.match(view, /const cisternaElementIds = allFlows\.map\(idOf\)\.filter\(Boolean\)/, 'el histórico debe derivar IDs únicamente del grupo Cisterna ya filtrado');

assert.match(page, /styles\/pages\/cisterna\.css/, 'cisterna.css debe estar importado por runtime');
assert.match(css, /\[data-section='cisterna'\] \.lf-cisterna-page/, 'CSS debe estar scoped a Cisterna');
assert.match(css, /theme-light \[data-section='cisterna'\]/, 'falta modo claro específico');
assert.match(css, /@media \(max-width: 720px\)/, 'falta responsive móvil');

for (const fragment of [
  '"start": "00:00", "end": "07:00"',
  '"start": "07:00", "end": "15:00"',
  '"start": "15:00", "end": "24:00"',
]) {
  assert.ok(config.includes(fragment), `turno provisional alterado: ${fragment}`);
}

console.log('LF-07 Jerarquía Cisterna: validación contractual dirigida OK');
