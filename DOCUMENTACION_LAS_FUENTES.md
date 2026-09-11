# Contrato operativo — Planta Las Fuentes

## Inventario confirmado

| Módulo | Posición BOS | Sensor ID | Nombre visible |
|---|---:|---:|---|
| Pozos | `POZO_FLOW_OUT[0]` | 1001 | Pozo 1 |
| Pozos | `POZO_FLOW_OUT[1]` | 1051 | Pozo 2 |
| Pozos | `POZO_FLOW_OUT[2]` | 1101 | Pozo 3 |
| Pozos | `POZO_FLOW_OUT[3]` | 1151 | Pozo 4 |
| Pozos | `POZO_FLOW_OUT[4]` | 1201 | Pozo 5 |
| TAM | `TANQUE_FLOW_IN[8]` | 3018 | Salida DEF 1 |
| TAM | `TANQUE_FLOW_IN[3]` | 3008 | Salida DEF 2 |
| TAM | `TANQUE_FLOW_IN[0]` | 3002 | Salida DEF 3 |
| TAM | `TANQUE_FLOW_IN[1]` | 3004 | Salida DEF 4 |
| TAM | `TANQUE_FLOW_IN[2]` | 3006 | Salida DEF 5 |
| TAM | `TANQUE_FLOW_IN[6]` | 3014 | Entrada PC 4 |
| TAM | `TANQUE_FLOW_IN[5]` | 3012 | Entrada PC 5 |
| TAM | `TANQUE_FLOW_IN[4]` | 3010 | Entrada PC 6 |
| TAM | `TANQUE_FLOW_IN[9]` | 3020 | Llegada Pozo 5 |
| TAM | `TANQUE_FLOW_IN[12]` | 3022 | Entrada TAM |
| Embotellado | `TANQUE_FLOW_IN[13]` | 3028 | Entrada PC 1 |
| Embotellado | `TANQUE_FLOW_IN[14]` | 3030 | Entrada PC 2 |
| Embotellado | `TANQUE_FLOW_IN[15]` | 3032 | Entrada PC 3 |
| Embotellado | `TANQUE_FLOW_IN[16]` | 3034 | CIP |
| Cisterna | `TANQUE_FLOW_IN[17]` | 3036 | Salida de cisterna |

## Exclusiones conscientes

- `TANQUE_FLOW_IN[7]` / sensor 3016 continúa en la captura SQL, pero no aparece en el dashboard porque no tiene nombre funcional confirmado.
- Los IDs 3024 y 3026 no se asignan a ningún elemento.
- La referencia técnica duplicada del Pozo 1 no aparece como medidor maestro.
- Líneas, Niveles, UV, Diagrama hídrico, Revisión diaria, Reportes y turnos permanecen deshabilitados.

## Contrato temporal

- Zona operativa: `America/Mexico_City`.
- Los 20 sensores visibles de `iot.readings_minute` se interpretan como UTC y se convierten a la hora local de Planta.
- Las fechas de validez hidráulica siguen pendientes de auditoría; la fecha del primer registro no se usa como sinónimo de dato confiable.
- Cero de flujo es una lectura válida sin actividad.
- No se inventan factores, capacidades, topología ni horarios de turno.

## Navegación

1. Dashboard.
2. Pozos.
3. Medidores de TAM.
4. Medidor de cisterna.
5. Medidores de embotellado.

## Validación de instalación

```powershell
cd backend
python -m compileall -q app

cd ..\frontend
npm install
npm run build
```

Después de iniciar el sistema, comprobar una tarjeta y su histórico individual en cada grupo.
