import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const section = readFileSync(new URL('../src/pages/pozos/sections/PozosSection.tsx', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/pages/PozosDashboardPage.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/pages/pozos.css', import.meta.url), 'utf8');
const config = readFileSync(new URL('../../backend/app/services/insurgentes_config.py', import.meta.url), 'utf8');

assert.match(section, /className="lf-pozos-page"/, 'falta scope visual de la vista general de Pozos');
assert.match(section, />Operando</, 'falta KPI Operando');
assert.match(section, />Bombeado hoy</, 'falta KPI Bombeado hoy');
assert.match(section, />Flujo total</, 'falta KPI Flujo total');
assert.match(section, />Totalizador actual</, 'falta KPI Totalizador actual');

const cardsPos = section.indexOf('aria-label="Pozos operativos"');
const historyPos = section.lastIndexOf('<OperationalModuleHistoryPanel initialModule="pozos" lockedModule="pozos" />');
const shiftsPos = section.lastIndexOf('<ShiftCutsPanel module="pozos" />');
assert.ok(cardsPos > 0 && historyPos > cardsPos && shiftsPos > historyPos, 'orden esperado: cards -> histórico -> turnos');

const generalView = section.slice(section.indexOf('const totalCurrent ='), section.lastIndexOf('export default'));
assert.doesNotMatch(generalView, /<span>Actividad<\/span>/, 'Actividad no debe ocupar un KPI de card general');
assert.doesNotMatch(generalView, /<span>Comunicación<\/span>/, 'Comunicación saludable no debe ocupar un KPI de card general');
assert.doesNotMatch(generalView, /<span>Validación<\/span>/, 'Validación saludable no debe ocupar un KPI de card general');
assert.doesNotMatch(generalView, /Pozo operativo/, 'la card no debe repetir un subtítulo obvio');
assert.match(generalView, /lf-pozos-card__primary/, 'faltan métricas primarias de card');
assert.match(generalView, /lf-pozos-card__secondary/, 'faltan métricas secundarias de card');
assert.match(generalView, /itemUpdateText\(well\)/, 'debe conservarse la última lectura en el footer');

assert.match(page, /styles\/pages\/pozos\.css/, 'pozos.css debe estar importado por runtime');
assert.match(css, /\[data-section='pozos'\] \.lf-pozos-page/, 'los estilos deben estar scoped a Pozos');
assert.match(css, /theme-light \[data-section='pozos'\]/, 'falta tratamiento de modo claro');
assert.match(css, /@media \(max-width: 720px\)/, 'falta tratamiento móvil');

for (const fragment of [
  '"start": "00:00", "end": "07:00"',
  '"start": "07:00", "end": "15:00"',
  '"start": "15:00", "end": "24:00"',
]) {
  assert.ok(config.includes(fragment), `turno provisional alterado: ${fragment}`);
}

console.log('LF-02 Jerarquía Pozos: validación contractual dirigida OK');
