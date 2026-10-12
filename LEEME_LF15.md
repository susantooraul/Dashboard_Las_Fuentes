# LF15 — Diseño global y reportes · Las Fuentes

## Aplicación
Paquete acumulativo LF14 + LF15. Aplicar sobre LF13 o LF14. Copiar las carpetas `frontend` y `backend` sobre el proyecto respetando las rutas. No es el proyecto completo ni incluye dependencias.

Compilar el frontend con las dependencias del equipo (`npm run build`). Reiniciar el backend si no se ha reiniciado automáticamente con reload: debe cargar las nuevas plantillas y descartar la caché de reportes de la versión anterior. Recargar el navegador.

Commit sugerido:
`style(las-fuentes): unifica interfaz y presentacion de reportes`

## Diseño compartido
- 70 botones del dashboard activo, incluido Entrar, usan DashboardButton. Variantes principal, secundaria, PDF rojo, Excel verde, peligro e icono. Eventos, submit, carga, disabled y refs conservados.
- LF14 incluido: encabezado lateral que no se comprime, textos contenidos y desplazamiento de navegación. Iconos de menú/sesión de 18 px y contenedores colapsados de 44 px centrados.
- Nuevo dashboardVisualSystem.css: superficies, títulos, KPIs, tablas, campos y modales coherentes con el diseño azul de LF13. No se usa zoom CSS.
- Alcance: Resumen, Pozos, TAM, Embotellado, Cisterna, detalles, Revisión diaria, Reportes, Usuarios, formularios de correo/contraseña e inicio de sesión. No se activan módulos deshabilitados.
- Tablas conservan todas sus columnas con desplazamiento horizontal; formularios y grupos de acciones se adaptan a pantallas pequeñas.
- Los modales de correo usan la paleta activa incluso cuando se renderizan mediante portal fuera del contenedor principal.
- global.css permanece intacto. Los cambios visuales se centralizan en los componentes/hojas nuevas.

## Exportaciones
- report_visual_theme.py centraliza presentación de tablas PDF, pies de página, estilos Excel y HTML.
- PDF diario: cabecera azul, KPIs legibles, tablas con encabezados oscuros y filas alternadas, anchos ajustados al área imprimible, texto largo envuelto y menos saltos forzados. La muestra pasó de 6 páginas a 4 conservando información.
- PDF de módulo/card e histórico completo: tablas con texto envuelto y pies paginados comunes.
- Excel diario y 5 min por sensor/módulo: títulos, encabezados, filas alternadas, ajuste de texto/altura, formato numérico conservado y configuración de impresión coherente.
- Excel histórico completo: mantiene Workbook(write_only=True) y la matriz por bloques; mejora encabezados, anchos, configuración de impresión y las hojas pequeñas de resumen/notas sin recorrer ni restilizar la matriz completa.
- HTML diario y exportaciones de vista/histórico del frontend: paleta corporativa y tablas compartidas. Las exportaciones históricas que ya eran HTML compatible con Excel `.xls` conservan ese formato; no se presentan como XLSX nativo.
- El correo utiliza las mismas plantillas del servidor: no se cambió el transporte ni se enviaron correos de prueba.

## Alcance técnico
Sí se modificaron archivos Python del backend, exclusivamente en funciones de presentación/exportación. No se modificaron SQL, endpoints, consultas, sensores, unidades, funciones de conciliación, cálculos, caché, autenticación, permisos ni programación de correo. App.jsx/UsersPage.jsx incluidos de LF14 cambian solo envolturas de botones e imports.

## Validación dirigida
- Sintaxis JSX/TSX/TS y CSS: OK. Compilación Python de los cinco archivos de presentación: OK.
- Comparación de frontend: modificaciones LF15 limitadas al botón de login, imports de estilo y cadenas CSS estáticas de exportación.
- Comparación AST backend: funciones ajenas a presentación intactas; archivos fuera del alcance sin cambios.
- Generadores reales con datos simulados, sin conexión BOS/SQL: PDF diario, módulo, detalle, histórico completo, sin filas y nombres largos.
- Cuatro exportaciones Excel comparadas antes/después celda a celda: mismo contenido y tipo de dato. HTML diario comparado sin el bloque CSS: mismo contenido.
- Inspección visual de páginas PDF y vistas renderizadas de hojas Excel: realizada. Las muestras son de diseño, no datos reales de la planta.
- Pruebas existentes LF09 Reportes, LF08 Revisión diaria y LF11 Usuarios/correo: OK.
- Renderizado aislado de menú, hero y navegación: OK; conserva ocho indicadores y los parámetros de navegación. La herramienta aislada usa React 19 de caché, no sustituye el build React 18 del proyecto.
- No se ejecutaron suites completas ni pruebas con correo o SQL.
- Build frontend pendiente: `vite: not found`. El navegador remoto bloqueó la dirección local de pruebas; no se afirma validación visual del dashboard conectado ni validación de producción.

## Revisión al aplicar
Revisar modo claro/oscuro, menú abierto/colapsado y móvil; navegar entre cards y detalles; comprobar selecciones del histórico y cada exportación. Verificar reportes con rangos habituales y datos reales. La función de cambio de contraseña y la administración de usuarios no cambiaron.

## Muestra
`Muestras/Muestra_PDF_datos_simulados.pdf`: salida de las plantillas nuevas. No contiene lecturas reales y no forma parte del despliegue.

## Archivos de código incluidos (27 rutas exactas)
- `backend/app/services/insurgentes_five_minute_export_service.py`
- `backend/app/services/insurgentes_full_history_export_service.py`
- `backend/app/services/insurgentes_module_history_export_service.py`
- `backend/app/services/report_visual_theme.py`
- `backend/app/services/water_daily_report_service.py`
- `frontend/src/App.jsx`
- `frontend/src/components/DashboardButton.tsx`
- `frontend/src/components/Header.tsx`
- `frontend/src/components/Sidebar.tsx`
- `frontend/src/main.jsx`
- `frontend/src/pages/LoginPage.tsx`
- `frontend/src/pages/UsersPage.jsx`
- `frontend/src/pages/pozos/components/AdvancedElementHistoryPanel.tsx`
- `frontend/src/pages/pozos/components/DateRangeControls.tsx`
- `frontend/src/pages/pozos/components/FiveMinuteExcelExportButton.tsx`
- `frontend/src/pages/pozos/components/NotificationCenter.tsx`
- `frontend/src/pages/pozos/components/OperationalModuleHistoryPanel.tsx`
- `frontend/src/pages/pozos/components/ShiftCutsPanel.tsx`
- `frontend/src/pages/pozos/sections/DashboardBaseSection.tsx`
- `frontend/src/pages/pozos/sections/ReportesSection.tsx`
- `frontend/src/pages/pozos/sections/RevisionDiariaSection.tsx`
- `frontend/src/services/reportVisualTheme.ts`
- `frontend/src/services/waterExportService.js`
- `frontend/src/services/waterExportService.ts`
- `frontend/src/styles/dashboardButtons.css`
- `frontend/src/styles/dashboardVisualSystem.css`
- `frontend/src/styles/lasFuentesUiRefresh.css`
