import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const src = path.join(frontend, 'src');

const runtimePairs = [
  ['components/BrandLogo.tsx', 'components/BrandLogo.jsx', "export { default } from './BrandLogo.tsx';"],
  ['components/Header.tsx', 'components/Header.jsx', "export { default } from './Header.tsx';"],
  ['components/KpiCard.tsx', 'components/KpiCard.jsx', "export { default } from './KpiCard.tsx';"],
  ['components/Sidebar.tsx', 'components/Sidebar.jsx', "export { default } from './Sidebar.tsx';"],
  ['pages/LoginPage.tsx', 'pages/LoginPage.jsx', "export { default } from './LoginPage.tsx';"],
  ['services/api.ts', 'services/api.js', "export { default } from './api.ts';\nexport * from './api.ts';"],
  ['services/authService.ts', 'services/authService.js', "export * from './authService.ts';"],
  ['services/waterReportService.ts', 'services/waterReportService.js', "export * from './waterReportService.ts';"],
  ['services/waterService.ts', 'services/waterService.js', "export * from './waterService.ts';"],
];

for (const [canonical, shim, expectedShim] of runtimePairs) {
  const canonicalPath = path.join(src, canonical);
  const shimPath = path.join(src, shim);
  assert.ok(fs.existsSync(canonicalPath), `Falta implementacion canonica ${canonical}`);
  assert.ok(fs.existsSync(shimPath), `Falta shim de compatibilidad ${shim}`);
  assert.equal(fs.readFileSync(shimPath, 'utf8').trim(), expectedShim, `${shim} contiene logica duplicada`);
}

assert.ok(fs.existsSync(path.join(frontend, 'vite.config.ts')), 'Falta vite.config.ts');
assert.equal(
  fs.readFileSync(path.join(frontend, 'vite.config.js'), 'utf8').trim(),
  "export { default } from './vite.config.ts';",
  'vite.config.js debe delegar completamente a vite.config.ts',
);

const extensions = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'];
const importPattern = /(?:import\s+(?:[^'\"]*?\s+from\s+)?|export\s+[^'\"]*?\s+from\s+)[\'\"]([^\'\"]+)[\'\"]|import\([\'\"]([^\'\"]+)[\'\"]\)/g;

function resolveLocal(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  if (path.extname(base) && fs.existsSync(base)) return base;
  for (const extension of extensions) {
    const candidate = `${base}${extension}`;
    if (fs.existsSync(candidate)) return candidate;
  }
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const extension of extensions) {
      const candidate = path.join(base, `index${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`Import local sin resolver: ${specifier} desde ${path.relative(src, fromFile)}`);
}

const start = path.join(src, 'main.jsx');
const seen = new Set();
const pending = [start];
while (pending.length) {
  const file = pending.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  if (!/\.(?:m?js|[cm]?ts|jsx|tsx)$/.test(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] || match[2];
    const resolved = resolveLocal(file, specifier);
    if (resolved && resolved.startsWith(src) && !seen.has(resolved)) pending.push(resolved);
  }
}

const reachableRelative = new Set([...seen].map((file) => path.relative(src, file).replaceAll('\\', '/')));
for (const [canonical, shim] of runtimePairs) {
  assert.ok(reachableRelative.has(shim), `${shim} no forma parte del grafo real resuelto por Vite`);
  assert.ok(reachableRelative.has(canonical), `${shim} no redirige al canonico ${canonical}`);
}


const canonicalStemSet = new Set(runtimePairs.map(([canonical]) => canonical.replace(/\.(?:tsx|ts)$/, '')));
const duplicateLegacyStems = [];
const candidates = new Map();
for (const entry of fs.readdirSync(src, { recursive: true })) {
  const absolute = path.join(src, entry);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
  const extension = path.extname(entry);
  if (!['.js', '.jsx', '.ts', '.tsx'].includes(extension)) continue;
  const stem = entry.slice(0, -extension.length).replaceAll('\\', '/');
  const values = candidates.get(stem) || [];
  values.push(extension);
  candidates.set(stem, values);
}
for (const [stem, values] of candidates) {
  const hasPair = (values.includes('.js') && values.includes('.ts')) || (values.includes('.jsx') && values.includes('.tsx'));
  if (!hasPair || canonicalStemSet.has(stem)) continue;
  duplicateLegacyStems.push(stem);
  const reachableForStem = [...reachableRelative].filter((rel) => rel.startsWith(`${stem}.`));
  assert.deepEqual(reachableForStem, [], `Par legacy ${stem} entro al runtime activo: ${reachableForStem.join(', ')}`);
}

const header = fs.readFileSync(path.join(src, 'components/Header.tsx'), 'utf8');
assert.ok(!header.includes('user-chip'), 'Header canonico introdujo controles duplicados de usuario');
assert.ok(!header.includes('LogOut'), 'Header canonico introdujo logout duplicado');
assert.ok(header.includes('HeaderExportFormat'), 'Header canonico debe conservar el tipo usado por codigo TS legado');

const water = fs.readFileSync(path.join(src, 'services/waterService.ts'), 'utf8');
assert.ok(water.includes('fetchWaterHistory(options: WaterHistoryRequestOptions = {} as WaterHistoryRequestOptions)'), 'fetchWaterHistory debe conservar el fallback runtime del JS anterior');
assert.ok(water.includes('fetchWaterModuleHistory(options: WaterModuleHistoryRequestOptions = {} as WaterModuleHistoryRequestOptions)'), 'fetchWaterModuleHistory debe conservar el fallback runtime del JS anterior');

console.log(`LF-10 OK: ${reachableRelative.size} archivos alcanzables; 9 shims delegan a TS/TSX y ${duplicateLegacyStems.length} pares legacy quedan fuera del runtime activo.`);
