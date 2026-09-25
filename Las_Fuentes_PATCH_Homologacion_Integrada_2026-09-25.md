# Las Fuentes — Patch de Homologación Integrada

**Fecha:** 25/09/2026  
**Proyecto base:** Dashboard Las Fuentes  
**Referencia principal:** Dashboard Insurgentes + Guía Maestra de Homologación ARCA V3

## Objetivo

Este ZIP es una prueba de integración grande. Contiene **únicamente archivos nuevos o modificados**, conservando sus rutas internas para poder copiarlos directamente sobre el proyecto de Las Fuentes.

No incluye el proyecto completo ni dependencias como `node_modules`.

## Cambios principales incluidos

- Activación y adaptación de **Turnos**.
- Turnos provisionales:
  - Turno 1: `00:00 → 07:00`
  - Turno 2: `07:00 → 15:00`
  - Turno 3: `15:00 → 24:00`
- Activación y adaptación de **Revisión diaria**.
- Activación de **Reportes**.
- Reportes adaptados a los procesos reales de Las Fuentes:
  - Pozos
  - TAM
  - Embotellado
  - Cisterna
- Eliminación de agrupaciones visibles heredadas que no corresponden a Las Fuentes.
- Adaptación de:
  - Vista previa
  - PDF
  - Excel
  - HTML
  - Correo manual
  - Correo programado
- Comparativos con **fechas reales** en lugar de etiquetas ambiguas.
- Mejoras en históricos de detalle.
- Exportaciones de detalle:
  - PDF
  - Excel
  - Excel 5 min
- Mejoras en conciliación temporal.
- Mejor tratamiento de `0` válido frente a ausencia de datos.
- Mejoras de autenticación y sesión.
- Cambio propio de contraseña.
- Manejo más seguro de respuestas `401`.
- Limpieza de nombres visibles heredados de Insurgentes.
- Sincronización de pares `.js/.ts` y `.jsx/.tsx` cuando era necesario para evitar que Vite cargara una versión antigua.

## Criterio de adaptación

Insurgentes se utilizó como **referencia técnica**, no como plantilla física.

No se deben heredar automáticamente de Insurgentes:

- sensores;
- IDs;
- nombres operativos;
- Líneas;
- UV;
- Niveles;
- topología;
- reglas físicas;
- agregados específicos;
- periodos particulares de esa planta.

Las Fuentes conserva su propio contrato físico.

## Estructura de Reportes esperada

```text
REPORTES · LAS FUENTES

Periodo
[Desde] [Hasta]

[PDF] [Excel] [Vista HTML] [Enviar por correo]

Resumen
- Pozos
- TAM
- Embotellado
- Cisterna

Cortes por turno
- Turno 1 · 00:00–07:00
- Turno 2 · 07:00–15:00
- Turno 3 · 15:00–24:00

Comparativos
- Seleccionado · fechas reales
- Anterior · fechas reales
- Semana anterior · fechas reales

Detalle
- Pozos
- Medidores TAM
- Medidores de embotellado
- Medidor de cisterna
```

## Orden recomendado de pruebas

1. **Login y sesión**
   - iniciar sesión;
   - cambiar contraseña;
   - navegar entre módulos;
   - comprobar que un error operativo no provoque logout.

2. **Dashboard e históricos**
   - elegir un sensor conocido;
   - comparar un periodo conocido;
   - revisar que volumen, flujo y totalizador tengan sentido.

3. **Turnos**
   - revisar especialmente las fronteras:
     - `07:00`
     - `15:00`
   - comprobar un turno cerrado;
   - comprobar el turno actual;
   - comprobar un turno futuro.

4. **Revisión diaria**
   - Pozos;
   - TAM;
   - Embotellado;
   - Cisterna.

5. **Reportes**
   - Vista previa;
   - PDF;
   - Excel;
   - HTML.

   Confirmar que no aparezcan módulos propios de Insurgentes como Líneas, UV o Niveles.

6. **Correo**
   - envío manual;
   - PDF;
   - Excel;
   - Ambos;
   - programación de correo.

7. **Detalle individual**
   - cambiar Desde/Hasta;
   - probar agrupaciones;
   - probar PDF;
   - probar Excel;
   - probar Excel 5 min.

## Validaciones realizadas antes de empaquetar

- Compilación sintáctica del backend Python.
- Revisión estática de archivos JS/TS/TSX modificados.
- Revisión de imports relativos.
- Comprobación de integridad del ZIP.

## Validaciones pendientes en el entorno real

Estas pruebas deben realizarse dentro del proyecto instalado porque el ZIP fuente no contiene todas las dependencias del entorno:

- `npm build`;
- ejecución real con SQL Server;
- datos BOS reales;
- generación completa de reportes con datos reales;
- SMTP real;
- correo programado;
- comportamiento en HTTPS / túnel;
- pruebas visuales completas en modo claro y oscuro.

## Estrategia recomendada para aplicar el patch

Antes de copiar los archivos:

```text
1. Crear commit limpio.
2. Aplicar el contenido del ZIP sobre el proyecto.
3. Instalar/usar las dependencias actuales del proyecto.
4. Ejecutar backend.
5. Ejecutar frontend.
6. Probar en el orden indicado arriba.
```

Si la prueba grande introduce una regresión:

```text
git reset / revert al commit anterior
```

y después dividir los cambios en incrementales pequeños.

## Archivos contenidos en el ZIP

Total: **47 archivos**

- `backend/app/api/routes/auth.py`
- `backend/app/api/routes/water.py`
- `backend/app/auth/middleware.py`
- `backend/app/auth/service.py`
- `backend/app/schemas/auth.py`
- `backend/app/schemas/export.py`
- `backend/app/services/insurgentes_config.py`
- `backend/app/services/insurgentes_history_service.py`
- `backend/app/services/insurgentes_module_history_export_service.py`
- `backend/app/services/insurgentes_reconciliation_service.py`
- `backend/app/services/insurgentes_service.py`
- `backend/app/services/report_email_scheduler_service.py`
- `backend/app/services/water_daily_report_service.py`
- `frontend/src/App.jsx`
- `frontend/src/config/plantCapabilities.ts`
- `frontend/src/pages/LoginPage.jsx`
- `frontend/src/pages/LoginPage.tsx`
- `frontend/src/pages/PozosDashboardPage.jsx`
- `frontend/src/pages/pozos/components/AdvancedElementHistoryPanel.tsx`
- `frontend/src/pages/pozos/components/DateRangeControls.tsx`
- `frontend/src/pages/pozos/components/DetailHistoryPeriodMetric.tsx`
- `frontend/src/pages/pozos/components/DetailPeriodStatus.tsx`
- `frontend/src/pages/pozos/components/OperationalModuleHistoryPanel.tsx`
- `frontend/src/pages/pozos/components/ShiftCutsPanel.tsx`
- `frontend/src/pages/pozos/components/SqlChartDateControls.tsx`
- `frontend/src/pages/pozos/components/WaterHistoryChart.tsx`
- `frontend/src/pages/pozos/components/WaterHistoryTooltip.tsx`
- `frontend/src/pages/pozos/dateUtils.ts`
- `frontend/src/pages/pozos/detailHistorySummary.js`
- `frontend/src/pages/pozos/detailHistoryVolume.js`
- `frontend/src/pages/pozos/hooks/useWaterHistory.ts`
- `frontend/src/pages/pozos/sections/FlujosSection.tsx`
- `frontend/src/pages/pozos/sections/PozosSection.tsx`
- `frontend/src/pages/pozos/sections/ReportesSection.tsx`
- `frontend/src/pages/pozos/sections/RevisionDiariaSection.tsx`
- `frontend/src/services/api.js`
- `frontend/src/services/api.ts`
- `frontend/src/services/authService.js`
- `frontend/src/services/authService.ts`
- `frontend/src/services/dailyWaterReportExportService.js`
- `frontend/src/services/dailyWaterReportExportService.ts`
- `frontend/src/services/waterModuleHistoryExportService.ts`
- `frontend/src/services/waterReportService.js`
- `frontend/src/services/waterReportService.ts`
- `frontend/src/styles/insurgentesVisualPolish.css`
- `frontend/src/styles/reportes.css`
- `frontend/src/styles/sessionPassword.css`
