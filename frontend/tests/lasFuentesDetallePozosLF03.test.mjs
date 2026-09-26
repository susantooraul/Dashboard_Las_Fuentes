import assert from 'node:assert/strict';
import fs from 'node:fs';
import { summarizeDetailHistory } from '../src/pages/pozos/detailHistorySummary.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

const pozos = read('../src/pages/pozos/sections/PozosSection.tsx');
const hero = read('../src/pages/pozos/components/OperationalDetailHero.tsx');
const history = read('../src/pages/pozos/components/AdvancedElementHistoryPanel.tsx');
const metric = read('../src/pages/pozos/components/DetailHistoryPeriodMetric.tsx');
const css = read('../src/styles/insurgentesVisualPolish.css');

// El resumen del rango usa la misma semántica del histórico conciliado.
const summary = summarizeDetailHistory([
  { flow_avg_lps: 2, flow_samples: 10, samples: 10, volume_m3: 3 },
  { flow_avg_lps: 8, flow_samples: 30, samples: 30, volume_m3: 7 },
  { flow_avg_lps: 0, flow_samples: 10, samples: 10, volume_m3: 0 },
  { flow_avg_lps: null, flow_samples: 0, samples: 0, volume_m3: null },
]);
assert.equal(summary.flowAverageLps, 5.2);
assert.equal(summary.volumeM3, 10);

const empty = summarizeDetailHistory([{ flow_avg_lps: null, samples: 0, volume_m3: null }]);
assert.equal(empty.flowAverageLps, null);
assert.equal(empty.volumeM3, null);

// Pozos conecta el resumen dinámico del mismo panel histórico.
assert.match(pozos, /useState<DetailHistoryPeriodSummary \| null>/);
assert.match(pozos, /onPeriodSummaryChange=\{setDetailPeriodSummary\}/);
assert.match(pozos, /label: 'Periodo seleccionado'/);
assert.match(pozos, /volumeLabel="Volumen bombeado"/);
assert.match(pozos, /label: 'Totalizador apertura'/);
assert.match(pozos, /label: 'Volumen bombeado'/);
assert.match(pozos, /label: 'Flujo actual'/);
assert.match(pozos, /label: 'Tiempo activo'/);
assert.match(pozos, /label: 'Encendidos'/);
assert.match(pozos, /label: 'Última lectura'/);

// Se elimina el panel redundante y los KPIs de estado duplicados del hero de pozo.
assert.doesNotMatch(pozos, /DetailPeriodStatus/);
assert.doesNotMatch(pozos, /Estado del intervalo/);
const heroStart = pozos.indexOf('<OperationalDetailHero');
const heroEnd = pozos.indexOf('</OperationalDetailHero>');
const pozosHero = pozos.slice(heroStart, heroEnd);
assert.doesNotMatch(pozosHero, /label: 'Actividad'/);
assert.doesNotMatch(pozosHero, /label: 'Comunicación'/);
assert.doesNotMatch(pozosHero, /label: 'Validación'/);

// Volver se separa del navegador anterior/siguiente y queda en la esquina superior izquierda.
assert.match(hero, /<section className="panel operational-detail-hero fade-up">\s*<div className="operational-detail-back-row">[\s\S]*?<div className="operational-detail-main">/);
assert.match(css, /\.insurgentes-page \.operational-detail-back-row \{[\s\S]*?position: absolute;[\s\S]*?top: 14px;[\s\S]*?left: 14px;/);

// El histórico mantiene exportaciones y publica estado de carga/rango explícito.
assert.match(history, /onPeriodSummaryChange/);
assert.match(history, /metric: 'detail'/);
assert.match(history, /detailVolumeDisplay: volumeDisplay/);
assert.match(history, /<FiveMinuteExcelExportButton/);
assert.match(metric, /Calculando…/);
assert.match(metric, /Flujo promedio/);
assert.match(metric, /detail-period-kpi-range/);
assert.match(css, /\.insurgentes-page \.detail-period-kpi-content/);

// Los turnos siguen presentes después del histórico de detalle.
const detailHistoryIndex = pozos.indexOf('<AdvancedElementHistoryPanel');
const shiftsIndex = pozos.indexOf('<ShiftCutsPanel module="pozos" elementId=');
assert.ok(detailHistoryIndex >= 0 && shiftsIndex > detailHistoryIndex, 'turnos debe mantenerse después del histórico de detalle');

console.log('lasFuentesDetallePozosLF03 tests OK');
