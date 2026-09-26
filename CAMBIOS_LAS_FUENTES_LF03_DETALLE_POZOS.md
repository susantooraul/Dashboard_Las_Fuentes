# LF-03 — Detalle de Pozos: hero compacto + KPI dinámico del rango + limpieza de estado

## Alcance

Homologa el detalle individual de Pozos sin cambiar backend, SQL, SCADA ni la matemática hidráulica. El histórico compartido existente se conecta al hero para mostrar el resumen del mismo rango visible y se elimina información repetida.

## Cambios principales

- `← Volver` queda separado del navegador anterior/siguiente y anclado a la esquina superior izquierda del hero compartido.
- El hero de Pozo elimina KPIs redundantes de `Actividad` y `Comunicación`.
- Se renombra `Total día anterior` a `Totalizador apertura`, acorde con el dato que realmente entrega `totalizerStartText`.
- Se incorpora `Periodo seleccionado` con:
  - flujo promedio del rango;
  - volumen bombeado del rango;
  - intervalo explícito;
  - estado `Calculando…` durante una consulta nueva.
- `AdvancedElementHistoryPanel` publica su resumen mediante `onPeriodSummaryChange`.
- Se elimina por completo el bloque visual `Estado del intervalo` del detalle de Pozos.
- Se conservan PDF, Excel, Excel 5 min, modo Por intervalo / Acumulado progresivo y cortes por turno.
- No se modifica `global.css` ni se agregan reglas CSS nuevas: Las Fuentes ya contenía los estilos compartidos de `operational-detail-back-row` y `detail-period-kpi-content`.

## No se modifica

- backend;
- SQL Server;
- BOS/SCADA;
- sensores/IDs/factores;
- conciliación de volumen;
- cortes por turno;
- histórico compartido;
- exportaciones existentes;
- vista general de Pozos homologada en LF-02.
