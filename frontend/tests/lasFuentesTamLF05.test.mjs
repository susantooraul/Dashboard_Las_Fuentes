import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const section = read('../src/pages/pozos/sections/FlujosSection.tsx');
const history = read('../src/pages/pozos/components/OperationalModuleHistoryPanel.tsx');
const page = read('../src/pages/PozosDashboardPage.jsx');
const css = read('../src/styles/pages/tam.css');
const config = read('../../backend/app/services/insurgentes_config.py');

assert.match(section, /if \(group === 'tam'\)/, 'LF-05 debe limitar la nueva jerarquía general a TAM');
assert.match(section, /className="lf-tam-page"/, 'falta scope visual general de TAM');
assert.match(section, />Operando</, 'falta KPI Operando');
assert.match(section, />\{generalVolumeLabel\(group\)\}</, 'falta KPI principal de consumo');
assert.match(section, />Flujo total</, 'falta KPI Flujo total');
assert.match(section, />Totalizador actual</, 'falta KPI Totalizador actual');

const tamStart = section.indexOf("if (group === 'tam')");
const tamEnd = section.indexOf('\n  return (', tamStart);
const tamView = section.slice(tamStart, tamEnd);

const cardsPos = tamView.indexOf('aria-label="Medidores operativos de TAM"');
const historyPos = tamView.indexOf('<OperationalModuleHistoryPanel');
const shiftsPos = tamView.indexOf('<ShiftCutsPanel module="flujos" group="tam"');
assert.ok(cardsPos > 0 && historyPos > cardsPos && shiftsPos > historyPos, 'orden esperado en TAM: cards -> histórico -> turnos');

assert.match(tamView, /lf-tam-card__primary/, 'faltan métricas primarias de TAM');
assert.match(tamView, /<span>Consumo hoy<\/span>/, 'Consumo hoy debe ser protagonista');
assert.match(tamView, /<span>Flujo actual<\/span>/, 'Flujo actual debe ser protagonista');
assert.match(tamView, /lf-tam-card__secondary/, 'faltan métricas secundarias de TAM');
assert.match(tamView, /<span>Totalizador actual<\/span>/, 'falta Totalizador actual secundario');
assert.match(tamView, /<span>Tiempo activo<\/span>/, 'falta Tiempo activo secundario');
assert.match(tamView, /<span>Encendidos<\/span>/, 'falta Encendidos secundario');
assert.doesNotMatch(tamView, /<span>Actividad<\/span>/, 'Actividad no debe ocupar una métrica adicional');
assert.doesNotMatch(tamView, /<span>Comunicación<\/span>/, 'Comunicación saludable no debe ocupar la card');
assert.doesNotMatch(tamView, /<span>Validación<\/span>/, 'Validación saludable no debe ocupar la card');
assert.doesNotMatch(tamView, /Medidor configurado/, 'la card no debe repetir un subtítulo obvio');
assert.match(tamView, /itemUpdateText\(flow\)/, 'debe conservarse la última lectura');

assert.match(tamView, /allowedElementIds=\{tamElementIds\}/, 'el histórico TAM debe filtrar sus propios elementos');
assert.match(tamView, /titleOverride="Histórico operativo · TAM"/, 'el histórico debe identificarse como TAM');
assert.match(history, /matchesAllowedElement/, 'el histórico compartido debe conservar filtro explícito');
assert.match(history, /String\(item\.sensor_id\)/, 'el filtro debe aceptar IDs físicos');
assert.match(history, /idOf\(item\)/, 'el filtro debe aceptar IDs operativos');

assert.match(page, /styles\/pages\/tam\.css/, 'tam.css debe estar importado por runtime');
assert.match(css, /\[data-section='tam'\] \.lf-tam-page/, 'CSS debe estar scoped a TAM');
assert.match(css, /theme-light \[data-section='tam'\]/, 'falta modo claro específico');
assert.match(css, /@media \(max-width: 720px\)/, 'falta responsive móvil');

for (const fragment of [
  '"start": "00:00", "end": "07:00"',
  '"start": "07:00", "end": "15:00"',
  '"start": "15:00", "end": "24:00"',
]) {
  assert.ok(config.includes(fragment), `turno provisional alterado: ${fragment}`);
}

console.log('LF-05 Jerarquía TAM: validación contractual dirigida OK');
