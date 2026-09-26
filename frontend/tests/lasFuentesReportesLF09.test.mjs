import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const section = read('../src/pages/pozos/sections/ReportesSection.tsx');
const page = read('../src/pages/PozosDashboardPage.jsx');
const css = read('../src/styles/reportes.css');

assert.match(section, /formatExplicitDateTimeRange/, 'LF-09 debe usar intervalo explícito');
assert.match(section, /const reportIntervalLabel = formatExplicitDateTimeRange/, 'debe existir etiqueta exacta del intervalo');
assert.match(section, /const reportStatus = `Periodo: \$\{reportIntervalLabel\}`/, 'control de periodo debe mostrar intervalo exacto');

for (const label of ["label: 'Pozos'", "label: 'TAM'", "label: 'Embotellado'", "label: 'Cisterna'"]) {
  assert.ok(section.includes(label), `falta KPI de proceso ${label}`);
}
assert.doesNotMatch(section, /label: 'Calidad del periodo'/, 'calidad no debe competir como quinto KPI ejecutivo');
assert.match(section, /countRowsWithActivity\(tamRows\)/, 'TAM debe mostrar actividad real y no sólo cantidad configurada');
assert.match(section, /countRowsWithActivity\(bottlingRows\)/, 'Embotellado debe mostrar actividad real');
assert.match(section, /countRowsWithActivity\(cisternRows\)/, 'Cisterna debe mostrar actividad real');

assert.match(section, /report-schedule-panel report-schedule-compact/, 'correo programado debe usar vista compacta');
assert.match(section, /Nueva programación/, 'debe existir acción explícita para crear programación');
assert.match(section, /scheduleModalOpen && createPortal/, 'crear-editar programación debe abrir modal');
assert.match(section, /report-schedule-modal-card/, 'modal de programación debe usar tarjeta específica');
assert.match(section, /scheduleTimeSummary\(schedule\)/, 'lista debe mostrar horario exacto configurado');
assert.doesNotMatch(section, /<h2>Programar correo<\/h2>/, 'no debe dejar formulario de programación siempre abierto');
assert.match(section, /El bloque 00:00–12:00 debe enviarse después de su cierre/, '12 h debe validar cierre del primer bloque');

assert.match(section, /className="panel report-history-support-panel"/, 'histórico completo debe ser acción separada');
assert.match(section, /PDF histórico completo/, 'debe conservar PDF histórico completo');
assert.match(section, /Excel histórico completo/, 'debe conservar Excel histórico completo');
assert.match(section, /PDF, Excel, HTML y correo usan exactamente el periodo seleccionado/, 'acciones diarias deben indicar el alcance correcto');

assert.match(section, /<h2>Vista previa<\/h2>/, 'preview debe usar título compacto');
assert.match(section, /Las Fuentes · \{reportIntervalLabel\}/, 'preview debe mostrar intervalo exacto');
assert.doesNotMatch(section, /Turnos provisionales 00:00/, 'Reportes no debe exponer el carácter provisional de los turnos');
assert.match(section, /Cortes del intervalo \$\{reportIntervalLabel\}/, 'cortes deben mostrar intervalo explícito');
assert.match(section, /`Volumen · \$\{reportIntervalLabel\}`/, 'tablas deben etiquetar volumen con el intervalo');
assert.match(section, /'Totalizador al cierre'/, 'tabla debe usar nomenclatura inequívoca de totalizador');
assert.match(section, /title="TAM"/, 'preview debe respetar proceso TAM');
assert.match(section, /title="Embotellado"/, 'preview debe respetar proceso Embotellado');
assert.match(section, /title="Cisterna"/, 'preview debe respetar proceso Cisterna');

for (const fragment of [
  'downloadDailyWaterReportPdf(activeFilters)',
  'downloadDailyWaterReportExcel(activeFilters)',
  'openDailyWaterReportHtml(activeFilters)',
  '...activeFilters',
]) {
  assert.ok(section.includes(fragment), `exportación/correo debe conservar filtros activos: ${fragment}`);
}

assert.match(page, /styles\/reportes\.css/, 'reportes.css debe seguir cargado por runtime');
assert.match(css, /report-schedule-compact/, 'CSS modular debe soportar scheduler compacto');
assert.match(css, /report-schedule-modal-card/, 'CSS modular debe soportar modal de programación');
assert.match(css, /report-history-support-panel/, 'CSS modular debe soportar histórico separado');

console.log('LF-09 Reportes: validación contractual dirigida OK');
