# LF-01 — Resumen V2

## Alcance

- Reconstrucción del Resumen como pantalla ejecutiva de Las Fuentes.
- Cuatro bloques de proceso: Pozos, TAM, Embotellado y Cisterna.
- Cada proceso prioriza volumen del día y flujo actual, con actividad y cobertura como información secundaria.
- Eliminación del bloque redundante `Accesos operativos`; las cuatro tarjetas de proceso son ahora accesos contextuales.
- Histórico operativo integrado en Resumen con selector Pozos / TAM / Embotellado / Cisterna.
- TAM, Embotellado y Cisterna filtran el histórico de Flujos por los sensores reales de su grupo.
- PDF, Excel visible y Excel 5 min conservan la selección filtrada porque reutilizan `selectedIds`/sensor IDs del panel compartido.
- Alertas operativas al final del Resumen; si no existen alertas ni error, el bloque saludable no ocupa espacio.
- Nuevo `styles/pages/resumen.css`; `global.css` no se modifica.

## Fuera de alcance

- No se cambió backend, SQL Server, BOS/SCADA, sensores, factores ni matemática hidráulica.
- No se modificaron turnos provisionales 00:00–07:00 / 07:00–15:00 / 15:00–24:00.
- No se modificaron las pantallas internas de Pozos, TAM, Cisterna o Embotellado; se atenderán en incrementales posteriores.
