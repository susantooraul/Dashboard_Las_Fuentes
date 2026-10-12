import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');

// La prueba solo usa el evaluador puro. No depende de React ni de la BD.
const path = new URL('../src/pages/pozos/flowThreshold.ts', import.meta.url);
const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
  fileName: 'flowThreshold.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function('exports', compiled)(exports);
const { normalizeThreshold, evaluateThreshold, summarizeThreshold } = exports;
const point = { samples: 15, flow_avg_lps: 8, flow_min_lps: 0.5, flow_max_lps: 16.2 };
const missing = { samples: 0, flow_avg_lps: null, flow_min_lps: null, flow_max_lps: null };
const cfg = (basis, direction='both', minValue='1', maxValue='15') =>
  normalizeThreshold({ enabled: true, basis, direction, minValue, maxValue });

assert.equal(cfg('extreme').error, '');
assert.equal(evaluateThreshold(point, cfg('extreme').config), 'Fuera de rango');
assert.equal(evaluateThreshold(point, cfg('average').config), 'Dentro de rango');
assert.equal(evaluateThreshold(point, cfg('extreme', 'below', '0.5', '').config), 'Dentro de rango');
assert.equal(evaluateThreshold({ samples: 1, flow_avg_lps: 0, flow_min_lps: 0, flow_max_lps: 0 }, cfg('average').config), 'Bajo umbral');
assert.equal(evaluateThreshold(missing, cfg('extreme').config), 'Sin lectura');
assert.equal(cfg('extreme', 'both', '20', '1').error.includes('mínimo'), true);
assert.equal(cfg('extreme', 'below', '', '').error.includes('mínimo'), true);
assert.equal(cfg('average', 'above', '', '-1').error.includes('mayores'), true);
assert.deepEqual(
  Object.fromEntries(Object.entries(summarizeThreshold([point, missing], cfg('extreme').config)).filter(([key]) => key !== 'results')),
  { total: 2, breached: 1, below: 1, above: 1, within: 0, noReading: 1 },
);
console.log('LF16: evaluacion frontend y validacion de umbrales OK');
