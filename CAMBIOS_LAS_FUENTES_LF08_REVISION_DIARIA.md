# LF-08 — Revisión diaria: jerarquía, fechas explícitas y limpieza de estados

## Alcance

- Limpieza visual de Revisión diaria sin modificar backend ni matemática hidráulica.
- Se mantienen los cuatro procesos físicos de Las Fuentes: Pozos, TAM, Embotellado y Cisterna.
- Se mantienen los turnos provisionales 00:00–07:00, 07:00–15:00 y 15:00–24:00.

## Cambios principales

- Cabecera simplificada: se elimina eyebrow y texto explicativo redundante.
- KPIs reducidos a los cuatro volúmenes por proceso; actividad global y validación parcial dejan de competir como KPIs ejecutivos.
- Cortes por turno muestran fecha + hora exactas mediante el contrato temporal existente.
- El estado del turno aparece una sola vez mediante badge; se elimina la duplicación texto + badge.
- Se retira el texto visible sobre "turnos provisionales"; la condición provisional permanece documentada en el contrato/configuración.
- Comparativo de volúmenes muestra fecha real para seleccionado, día anterior y semana anterior.
- Resumen de elementos conserva Actividad, Comunicación y Validación porque la pantalla es de auditoría, y agrega Última actualización.
- Un fallo de refresco con datos previos conserva el último dato válido y muestra una advertencia compacta.
- Nuevo CSS modular `styles/pages/revision-diaria.css`; `global.css` no se modifica.
