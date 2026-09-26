import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const section = read('../src/pages/pozos/sections/RevisionDiariaSection.tsx');
const page = read('../src/pages/PozosDashboardPage.jsx');
const css = read('../src/styles/pages/revision-diaria.css');
const config = read('../../backend/app/services/insurgentes_config.py');

assert.match(section, /className="lf-review-page"/, 'LF-08 debe tener raíz visual propia');
assert.match(section, /<h2>Revisión diaria<\/h2>/, 'debe conservar título principal');
assert.doesNotMatch(section, /section-eyebrow">REVISIÓN DIARIA/, 'no debe duplicar el título con eyebrow');
assert.doesNotMatch(section, /Estado operativo, volumen y cortes por turno/, 'debe eliminar copy explicativo redundante');

for (const label of ["pozos: 'Pozos'", "tam: 'TAM'", "embotellado: 'Embotellado'", "cisterna: 'Cisterna'"]) {
  assert.ok(section.includes(label), `falta proceso de revisión diaria: ${label}`);
}
assert.match(section, /aria-label="Volumen diario por proceso"/, 'los KPIs deben representar los 4 procesos');
assert.doesNotMatch(section, /label="Elementos con actividad"/, 'no debe conservar KPI global redundante de actividad');
assert.doesNotMatch(section, /label="Validación parcial"/, 'validación saludable no debe competir como KPI ejecutivo');

assert.match(section, /formatShiftDateTimeRange\(selectedDate, shift\.schedule\)/, 'cada turno debe mostrar fecha y rango horario exactos');
assert.match(section, /lf-review-shift-card__header/, 'turno debe tener cabecera compacta');
assert.match(section, /<StatusBadge type=\{shiftStatusType\(shift\.status\)\}>/, 'estado del turno debe mostrarse una sola vez mediante badge');
assert.doesNotMatch(section, /<strong>\{String\(shift\.status_label/, 'no debe duplicarse el estado del turno como texto y badge');
assert.doesNotMatch(section, /Turnos provisionales 00/, 'la UI no debe exponer copy técnico/provisional');

assert.match(section, /const previousDay = asRecord\(comparisonPayload\.previous_day\)/, 'comparativo debe leer fecha real del día anterior');
assert.match(section, /const previousWeek = asRecord\(comparisonPayload\.previous_week\)/, 'comparativo debe leer fecha real de semana anterior');
assert.match(section, /Día anterior · \{previousDateLabel\}/, 'encabezado día anterior debe mostrar fecha');
assert.match(section, /Semana anterior · \{previousWeekDateLabel\}/, 'encabezado semana anterior debe mostrar fecha');
assert.match(section, /Seleccionado · \{selectedDateLabel\}/, 'encabezado seleccionado debe mostrar fecha');

assert.match(section, /<th>Última actualización<\/th>/, 'Resumen de elementos debe incluir última actualización');
assert.match(section, /item\.updated \?\? item\.ultima_lectura \?\? item\.last_update \?\? dashboard\.last_update/, 'última actualización debe usar dato real disponible');
assert.match(section, /No se pudo actualizar la revisión\. Se conserva el último dato válido\./, 'error de refresco debe conservar último dato válido');
assert.match(section, /review\.error && review\.data/, 'advertencia recuperable debe distinguirse de error sin datos');

assert.match(page, /styles\/pages\/revision-diaria\.css/, 'revision-diaria.css debe estar importado por runtime');
assert.match(css, /\[data-section='revision'\] \.lf-review-page/, 'CSS debe estar scoped a Revisión diaria');
assert.match(css, /theme-light \[data-section='revision'\]/, 'debe existir modo claro específico');
assert.match(css, /@media \(max-width: 720px\)/, 'debe existir responsive móvil');

for (const fragment of [
  '"start": "00:00", "end": "07:00"',
  '"start": "07:00", "end": "15:00"',
  '"start": "15:00", "end": "24:00"',
]) {
  assert.ok(config.includes(fragment), `turno provisional alterado: ${fragment}`);
}

console.log('LF-08 Revisión diaria: validación contractual dirigida OK');
