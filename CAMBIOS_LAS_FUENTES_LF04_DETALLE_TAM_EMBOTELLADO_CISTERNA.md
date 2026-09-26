# LF-04 — Detalle TAM, Embotellado y Cisterna

## Alcance

Homologa las vistas de detalle que comparten `FlujosSection` con el patrón ya aplicado a Pozos en LF-03, conservando la separación física por `module_group` y sin modificar backend, SQL, SCADA ni matemática hidráulica.

## Cambios

- Se conecta `DetailHistoryPeriodMetric` al histórico visible de cada medidor.
- El KPI `Periodo seleccionado` reutiliza `onPeriodSummaryChange` del `AdvancedElementHistoryPanel`.
- TAM y Embotellado usan la nomenclatura `Volumen consumido`.
- Cisterna usa la nomenclatura `Volumen de salida`.
- El hero de detalle queda con:
  - Totalizador apertura.
  - Volumen consumido / Volumen de salida.
  - Totalizador actual.
  - Flujo actual.
  - Tiempo activo.
  - Encendidos.
  - Periodo seleccionado.
  - Última lectura.
- Se retira `Comunicación` como KPI saludable permanente del hero.
- Se elimina el bloque redundante `Estado del intervalo`.
- `← Volver` conserva el `basePath` real de TAM, Embotellado o Cisterna.
- Anterior/siguiente conserva únicamente los elementos del grupo actual.
- Histórico, PDF, Excel, Excel 5 min, Por intervalo y Acumulado progresivo conservan su contrato.
- Turnos permanecen después del histórico y continúan filtrados por grupo.
- No se modifican las cards generales de TAM/Embotellado/Cisterna; su jerarquía se deja para los incrementales específicos de módulo.

## CSS

No se agregó ni modificó CSS. Se reutilizan los estilos compartidos activados en LF-03. `global.css` conserva el mismo hash.

## Validación dirigida

- LF-01: OK.
- LF-02: OK.
- LF-03: OK.
- `lasFuentesDetalleFlujosLF04.test.mjs`: OK.
- TAM/Embotellado/Cisterna conservan `module_group`: OK.
- KPI dinámico del periodo conectado: OK.
- Volumen consumido para TAM/Embotellado: OK.
- Volumen de salida para Cisterna: OK.
- Estado del intervalo eliminado: OK.
- Volver contextual preservado: OK.
- Turnos posteriores al histórico: OK.
- PDF/Excel/Excel 5 min preservados: OK.
- Transpilación dirigida TypeScript/TSX: OK.
- `global.css`: hash `20e7d791d839d4eb2d1876237cba16da963963a901c582e9f22feb49e9276efe`.
- No se ejecutaron suites completas.
