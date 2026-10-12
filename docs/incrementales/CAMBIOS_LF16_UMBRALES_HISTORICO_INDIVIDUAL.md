# LF16 - Umbrales de flujo en el histórico individual (Planta Las Fuentes)

**Base de aplicación:** `Dashboard_Las_Fuentes-test.zip` entregado el 11/10/2026, con cambios acumulados hasta LF15. Este ZIP incremental contiene únicamente archivos nuevos o modificados: combinarlo con la base respetando las rutas.

**Referencia de comportamiento:** `GUIA_ARCA_UMBRALES_FLUJO_HISTORICO_J19(1).md` proporcionada por el usuario. Se implementa sobre los servicios y sensores existentes de Las Fuentes; no se importan sensores ni parámetros de Juárez.

## Alcance

- En la pantalla de detalle individual que abre un card (Pozos, TAM, Embotellado, Cisterna), el **Histórico del medidor** muestra un checkbox **Revisar umbrales de flujo**, inicialmente apagado.
- El operador elige sentido **Por debajo de / Por encima de / Ambos**; criterio **Mín/Máx / Promedio** y valores en **L/s**. Los parámetros no se guardan, no generan alarmas y no modifican los sensores.
- La gráfica conserva **flujo promedio (L/s)** y **volumen (m³)** y superpone las líneas horizontales activas en el **eje de flujo**. El tooltip muestra el estado de umbral de cada intervalo.
- Resumen: intervalos con incidencia, bajo mínimo, sobre máximo, dentro de rango y sin lectura. Se muestra tabla de incidencias con inicio/fin, flujo promedio/mín/máx y estado. La web limita la tabla a 200 incidencias visibles por rendimiento; PDF y Excel contienen todos los intervalos disponibles.
- Si la revisión está activa y válida, el botón PDF usa `/api/v1/water/history/detail/pdf` y Excel usa `/api/v1/water/history/detail/excel` (XLSX genuino), con **sensor_id entero**, mismo rango, agrupación y modo de volumen, además de los umbrales.
- El backend consulta **solo la serie individual histórica**, evalúa en memoria con la misma semántica que el navegador, y agrega al PDF gráfica, resumen y tabla completa con intervalos; al Excel diagnóstico, mínimos, máximos, calidad y estado resaltado. Las columnas conservan el volumen y totalizador existentes.
- Desactivado: el PDF previo sigue usando el exportador por módulo y el Excel previo sigue generándose como `.xls` HTML desde navegador. **Excel 5 min** permanece separado.
- No se añadieron controles al histórico general por módulo, Revisión diaria, ni al Resumen.

## Semántica de evaluación

- `below` compara `< mínimo`; `above` compara `> máximo`. Igual al límite **no** es incidencia.
- `extreme` compara `flow_min_lps` / `flow_max_lps` del **bucket**. `average` compara `flow_avg_lps` con uno o ambos límites. En `both/extreme` un bucket puede violar ambos; las cuentas de "bajo" y "sobre" pueden solaparse.
- `samples=0` o ausencia de flujo evaluable -> **Sin lectura**. `0 L/s` con muestras reales sigue siendo lectura **válida**.
- Los límites se validan por cliente y servidor; faltantes, negativos, NaN o mínimo mayor al máximo se rechazan. Los valores 1 y 15 L/s de la guía son solamente ejemplos, no límites oficiales.
- Las horas indicadas corresponden al **intervalo de agrupación** y **no** al minuto/segundo exacto de la incidencia.
- Los datos y cálculos de volumen, calidad, sensores y totalizadores **no se modifican**.

## Archivos incluidos

- `frontend/src/pages/pozos/flowThreshold.ts` (nuevo evaluador puro).
- `frontend/src/pages/pozos/components/AdvancedElementHistoryPanel.tsx` (UI, resumen, tabla y exportación optativa).
- `frontend/src/pages/pozos/components/WaterHistoryChart.tsx` (líneas horizontales en eje L/s).
- `frontend/src/pages/pozos/components/WaterHistoryTooltip.tsx` (estado por intervalo).
- `frontend/src/services/waterModuleHistoryExportService.ts` (servicio de PDF/XLSX individuales y errores HTTP).
- `frontend/src/styles/lasFuentesUiRefresh.css` (estilos acotados, claros/oscuros).
- `backend/app/services/las_fuentes_flow_threshold.py` (evaluador, PDF, Excel nuevos).
- `backend/app/api/routes/water.py` (dos endpoints adicionales, sin cambiar los actuales).
- `backend/tests/test_las_fuentes_flow_threshold_lf16.py` (nuevo).
- `frontend/tests/lasFuentesUmbralesLF16.test.mjs` (nuevo).
- `docs/incrementales/CAMBIOS_LF16_UMBRALES_HISTORICO_INDIVIDUAL.md` (este archivo).

## Validación realizada y pendiente

**Realizada en entorno aislado (sin consultas reales SQL Server):**
- `PYTHONPATH=backend pytest -q backend/tests/test_las_fuentes_flow_threshold_lf16.py` -> **6 passed**. Incluye clasificación, cero real, sin lectura, validación de límites, bytes `%PDF` y XLSX `PK`, diagnóstico coincidente y celdas resaltadas.
- `node --test frontend/tests/lasFuentesUmbralesLF16.test.mjs` -> **1 passed** con TypeScript global disponible en el entorno de prueba. Las dependencias normales del proyecto resuelven `typescript` tras `npm ci`.
- Transpilación de sintaxis (TS/TSX) de los cinco archivos frontend involucrados -> sin errores sintácticos.
- Batería frontend anterior -> **5 pasan / 6 fallan** antes y después; cinco exigen la tarjeta antigua "Encendidos", retirada previamente, y una prueba antigua de Vite. No son fallos introducidos por LF16.

**Pendiente en el entorno del usuario/planta:** compilación frontend `npm ci && npm run build` y `npm run typecheck`, porque el ZIP no incluye `node_modules` y la descarga de paquetes falló en el contenedor. Verificar permisos y sesión de los nuevos endpoints, contrastar PDF/XLSX con SQL Server de planta, pruebas de web en claro/oscuro y móviles.

## Validación dirigida en planta

1. Abrir un card real de pozo/TAM/embotellado/cisterna. Sin activar la casilla: gráfica, PDF, Excel y Excel 5 min deben seguir como antes.
2. Activar **Ambos** y **Mín/Máx**. Con valores de laboratorio conocidos para el sensor, comprobar que el número de intervalos fuera de rango corresponde a lecturas reales min/máx; comparar con **Promedio**.
3. Revisar intervalos con 0 L/s con muestras y buckets sin muestras; no deben confundirse.
4. Ver que las líneas están en el eje L/s y no modifican la escala ni el valor del volumen m³. Alternar **Por intervalo / Acumulado progresivo**.
5. Generar PDF y XLSX con umbral activo; revisar todos los intervalos, inicio y fin, calidad, marcas de incidencia y mismos totales/estados. En `.xlsx` las filas infractoras deben estar resaltadas.
6. Desactivar la casilla: no debe quedar ningún bloque de diagnóstico ni línea de umbral. Verificar que Resumen e Histórico por módulo no tengan la función.
7. Cambiar fechas y agrupación (1 min, 15 min, 1 h, 1 día); los buckets, conteos y exportaciones deben actualizarse. Probar también validaciones HTTP 422 y expiración de sesión 401.

**No se tocaron:** `.env`, SQL Server, mapeos BOS, turnos, reglas de calidad, volúmenes ni Excel 5 minutos.
