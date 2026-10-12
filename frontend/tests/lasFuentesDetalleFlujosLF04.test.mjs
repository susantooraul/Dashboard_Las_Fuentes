import assert from 'node:assert/strict';
import fs from 'node:fs';
import { summarizeDetailHistory } from '../src/pages/pozos/detailHistorySummary.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const flujos = read('../src/pages/pozos/sections/FlujosSection.tsx');
const page = read('../src/pages/PozosDashboardPage.jsx');
const hero = read('../src/pages/pozos/components/OperationalDetailHero.tsx');
const history = read('../src/pages/pozos/components/AdvancedElementHistoryPanel.tsx');
const metric = read('../src/pages/pozos/components/DetailHistoryPeriodMetric.tsx');

// El resumen del rango conserva la matemática conciliada ya usada por Pozos.
const summary = summarizeDetailHistory([
  { flow_avg_lps: 3, flow_samples: 10, samples: 10, volume_m3: 2 },
  { flow_avg_lps: 9, flow_samples: 20, samples: 20, volume_m3: 5 },
  { flow_avg_lps: 0, flow_samples: 10, samples: 10, volume_m3: 0 },
]);
assert.equal(summary.flowAverageLps, 5.25);
assert.equal(summary.volumeM3, 7);

// TAM, Embotellado y Cisterna comparten FlujosSection sin mezclar sus grupos.
assert.match(page, /group="tam"[\s\S]*?basePath="\/pozos\/tam"/);
assert.match(page, /group="embotellado"[\s\S]*?basePath="\/pozos\/embotellado"/);
assert.match(page, /group="cisterna"[\s\S]*?basePath="\/pozos\/cisterna"/);
assert.match(flujos, /String\(item\.module_group \|\| ''\) === group/);

// El detalle conecta el KPI dinámico con el mismo histórico visible.
assert.match(flujos, /useState<DetailHistoryPeriodSummary \| null>/);
assert.match(flujos, /onPeriodSummaryChange=\{setDetailPeriodSummary\}/);
assert.match(flujos, /label: 'Periodo seleccionado'/);
assert.match(flujos, /<DetailHistoryPeriodMetric/);
assert.match(flujos, /volumeLabel=\{detailVolumeLabel\(group\)\}/);
assert.match(flujos, /group === 'cisterna' \? 'Volumen de salida' : 'Volumen consumido'/);

// Hero compacto y nomenclatura inequívoca.
const heroStart = flujos.indexOf('<OperationalDetailHero');
const heroEnd = flujos.indexOf('</OperationalDetailHero>');
const detailHero = flujos.slice(heroStart, heroEnd);
assert.match(detailHero, /label: 'Totalizador apertura'/);
assert.match(detailHero, /label: 'Totalizador actual'/);
assert.match(detailHero, /label: 'Flujo actual'/);
assert.match(detailHero, /label: 'Tiempo activo'/);
assert.match(detailHero, /label: 'Encendidos'/);
assert.match(detailHero, /label: 'Última lectura'/);
assert.doesNotMatch(detailHero, /label: 'Comunicación'/);
assert.doesNotMatch(detailHero, /label: 'Actividad'/);
assert.doesNotMatch(detailHero, /label: 'Validación'/);

// Se elimina el bloque redundante Estado del intervalo del detalle de los tres grupos.
assert.doesNotMatch(flujos, /DetailPeriodStatus/);
assert.doesNotMatch(flujos, /Estado del intervalo/);

// Volver sigue siendo contextual y separado del navegador anterior/siguiente.
assert.match(hero, /className="operational-detail-back-row"/);
assert.match(flujos, /backTo=\{basePath\}/);
assert.match(flujos, /<DetailElementNavigator items=\{allFlows\}[\s\S]*?basePath=\{basePath\}/);

// Exportaciones y carga del periodo se conservan en el histórico compartido.
assert.match(history, /metric: 'detail'/);
assert.match(history, /detailVolumeDisplay: volumeDisplay/);
assert.match(history, /<FiveMinuteExcelExportButton/);
assert.match(metric, /Calculando…/);
assert.match(metric, /Flujo promedio/);

// Turnos continúan después del histórico del elemento y conservan el grupo.
const historyIndex = flujos.indexOf('<AdvancedElementHistoryPanel');
const shiftsIndex = flujos.indexOf('<ShiftCutsPanel module="flujos" group={group} elementId=');
assert.ok(historyIndex >= 0 && shiftsIndex > historyIndex, 'turnos debe mantenerse después del histórico de detalle');

console.log('lasFuentesDetalleFlujosLF04 tests OK');
