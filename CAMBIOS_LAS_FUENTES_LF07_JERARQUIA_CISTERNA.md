# LF-07 — Jerarquía general de Cisterna

- Vista general propia para `3036 — Salida de cisterna`.
- Orden: cabecera ejecutiva -> card operativa -> histórico -> turnos.
- Cabecera compacta: Operando, Salida hoy, Flujo actual y Totalizador actual.
- Card principal: Salida hoy + Flujo actual; secundarios: Totalizador actual, Tiempo activo y Encendidos.
- Se retiran de la card general Actividad, Comunicación, Validación y el subtítulo redundante `Medidor configurado`.
- Histórico común filtrado exclusivamente al grupo `cisterna` y, por contrato, al sensor 3036.
- PDF/Excel/Excel 5 min continúan respetando la selección del histórico compartido.
- Detalle individual conserva LF-04.
- Turnos provisionales conservados: 00:00–07:00, 07:00–15:00 y 15:00–24:00.
- Nuevo `frontend/src/styles/pages/cisterna.css`, scoped a `[data-section='cisterna']`.
- `global.css` no se modifica.
- Backend, SQL, BOS/SCADA y matemática hidráulica no se modifican.
