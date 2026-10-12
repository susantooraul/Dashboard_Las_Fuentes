# LF-06 — Jerarquía general de Embotellado

## Alcance

Homologa la vista general de Embotellado con el patrón ya aplicado a Pozos y TAM, manteniendo intactos backend, SQL/SCADA, sensores y matemática hidráulica.

## Cambios

- Cabecera ejecutiva reducida a Operando, Consumo hoy, Flujo total y Totalizador actual.
- Cards priorizan Consumo hoy + Flujo actual.
- Totalizador actual, Tiempo activo y Encendidos pasan a segundo nivel.
- Se eliminan de la card general Actividad, Comunicación, Validación y el subtítulo `Medidor configurado`.
- Se conserva el estado principal, última lectura y navegación al detalle.
- Orden de pantalla: cards -> histórico -> turnos.
- Histórico operativo propio de Embotellado mediante el componente compartido, limitado a sus cuatro puntos físicos confirmados:
  - 3028 — Entrada PC 1
  - 3030 — Entrada PC 2
  - 3032 — Entrada PC 3
  - 3034 — CIP
- PDF, Excel y Excel 5 min conservan la selección filtrada del histórico compartido.
- Turnos provisionales 00–07 / 07–15 / 15–24 preservados.
- Nuevo `frontend/src/styles/pages/embotellado.css`, scoped a `[data-section='embotellado']`.
- `global.css` no se modifica.

## No se modificó

- backend;
- SQL Server;
- BOS/SCADA;
- IDs/factores;
- matemática de volumen/flujo;
- TAM;
- vista general de Cisterna;
- detalle individual ya homologado en LF-04.
