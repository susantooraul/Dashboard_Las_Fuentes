# LF-05 — Jerarquía general de TAM

## Alcance

- Reorganiza la vista general de TAM con la jerarquía visual ya homologada en Pozos.
- Ordena la pantalla como cards operativas → histórico → turnos.
- Reduce la cabecera a cuatro KPIs de lectura rápida.
- Simplifica las cards a consumo/flujo como métricas principales y totalizador/tiempo activo/encendidos como secundarias.
- Elimina de la vista general estados saludables redundantes como Actividad, Comunicación y Validación.
- Integra el histórico global de TAM filtrando únicamente sus medidores reales.
- Refuerza el filtro compartido del histórico para aceptar tanto ID operativo como sensor_id, preservando también el filtrado usado en Resumen.
- Agrega `styles/pages/tam.css` con scope exclusivo de TAM, claro/oscuro y responsive.
- No modifica backend, SQL, BOS/SCADA, sensores, factores ni matemática hidráulica.
- Conserva los turnos provisionales 00:00–07:00, 07:00–15:00 y 15:00–24:00.
