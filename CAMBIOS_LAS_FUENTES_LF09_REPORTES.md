# LF-09 — Reportes: intervalo explícito + correo programado compacto + preview limpio

## Alcance

Homologación visual/operativa de la pantalla de Reportes de Las Fuentes contra la Guía Maestra V3 y el patrón reciente de Insurgentes, sin cambiar la matemática hidráulica ni los servicios de exportación/correo.

## Cambios principales

- El periodo visible pasa a expresarse como intervalo explícito con fecha/hora mediante `formatExplicitDateTimeRange`.
- Para el día actual el cierre visible puede usar la última actualización real disponible; no se presenta un cierre futuro falso.
- Los KPIs ejecutivos quedan limitados a los cuatro procesos reales: Pozos, TAM, Embotellado y Cisterna.
- Se elimina `Calidad del periodo` como quinto KPI protagonista; calidad/validación continúa en las tablas donde sí aporta diagnóstico.
- TAM, Embotellado y Cisterna muestran elementos con actividad en vez de sólo cantidad configurada.
- PDF, Excel, HTML y correo permanecen ligados a los mismos `activeFilters`.
- Histórico completo se separa de las acciones del reporte diario en un panel propio.
- Correo programado pasa de formulario permanentemente abierto a lista compacta + modal Crear/Editar.
- La lista de programaciones muestra estado, modalidad, formatos, destinatarios, horario exacto y próximo envío.
- El modal conserva 24 h y 12 h; 12 h valida que el bloque 00:00–12:00 se programe después de su cierre.
- El horario de entrega no modifica el periodo hidráulico del reporte.
- Preview pasa a `Vista previa` y muestra el intervalo explícito.
- Se elimina el texto visible `Turnos provisionales...`; los turnos 00–07, 07–15 y 15–24 continúan sin cambio.
- Las tablas de Pozos/TAM/Embotellado/Cisterna usan `Volumen · <intervalo>` y `Totalizador al cierre`.
- Se conserva la estructura física separada de Pozos, TAM, Embotellado y Cisterna.
- Se reutiliza el CSS modular de `reportes.css`; no fue necesario modificar CSS.
- `global.css` no se modifica.
- Backend, SQL, SCADA y SMTP no se modifican.

## Validación dirigida

- LF-01 → LF-09: pruebas contractuales dirigidas OK.
- `ReportesSection.tsx`: transpilación TypeScript dirigida OK.
- `ReportPreviewTable.tsx`: transpilación TypeScript dirigida OK.
- `PozosDashboardPage.jsx`: transpilación dirigida OK.
- TypeScript usado: 5.8.3.
- `reportes.css`: 43 aperturas / 43 cierres.
- `global.css`: hash idéntico al original.
- `tsc --noEmit`: no completa por ausencia de `@types/node` y `vite/client` en el `node_modules` disponible del ZIP.
- No se ejecutaron suites completas.
