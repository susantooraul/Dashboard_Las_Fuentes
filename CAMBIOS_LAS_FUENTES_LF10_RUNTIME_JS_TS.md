# LF-10 — Consolidación del runtime JS/TS

## Objetivo
Eliminar la divergencia entre el archivo que Vite ejecuta y el archivo que TypeScript analiza en el runtime activo de Las Fuentes.

## Estrategia
Los archivos TypeScript/TSX quedan como implementación canónica. Los pares JS/JSX que Vite prioriza por resolución de extensión permanecen únicamente como shims mínimos de compatibilidad que reexportan el canónico. Así un ZIP incremental puede aplicarse sin depender de borrar archivos existentes.

## Runtime consolidado
- components/BrandLogo.tsx <- BrandLogo.jsx shim
- components/Header.tsx <- Header.jsx shim
- components/KpiCard.tsx <- KpiCard.jsx shim
- components/Sidebar.tsx <- Sidebar.jsx shim
- pages/LoginPage.tsx <- LoginPage.jsx shim
- services/api.ts <- api.js shim
- services/authService.ts <- authService.js shim
- services/waterReportService.ts <- waterReportService.js shim
- services/waterService.ts <- waterService.js shim
- vite.config.ts <- vite.config.js shim

## Compatibilidad preservada
- Header.tsx conserva exactamente el comportamiento visible del Header.jsx que estaba en producción; no incorpora un segundo control de usuario/logout.
- waterService.ts conserva los fallbacks `options = {}` de los históricos que existían en el JS activo.
- Los imports actuales de App.jsx no cambian y continúan funcionando.
- Los 21 pares JS/TS legacy restantes quedan fuera del grafo alcanzable desde main.jsx; no se eliminaron a ciegas.

## Alcance no modificado
- backend
- SQL Server
- SCADA/BOS
- cálculos hidráulicos
- polling
- reportes
- SMTP
- CSS/global.css

## Validación
- LF-01 a LF-09: OK
- LF-10 runtime graph: OK
- 9 shims -> 9 canónicos TS/TSX: OK
- 21 pares legacy fuera del runtime activo: OK
- transpilación dirigida de 9 canónicos: OK
- transpilación dirigida de shims y vite.config.js: OK
- global.css hash sin cambios: OK
