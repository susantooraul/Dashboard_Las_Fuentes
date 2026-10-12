# LF-11 — Usuarios: identificador tradicional o correo electrónico

## Objetivo
Permitir que el acceso de un usuario de Las Fuentes pueda ser tanto el identificador tradicional existente como un correo electrónico, y permitir que un administrador convierta cuentas ya creadas a correo sin borrarlas ni perder contraseña, rol o historial.

## Cambios principales
- Se conserva el formato tradicional de usuario, por ejemplo `adriana_flores1`.
- Se agrega soporte para correo electrónico válido, por ejemplo `adriana.flores@empresa.com`.
- El límite del identificador sube a 254 caracteres cuando se usa correo.
- La validación del correo usa `email-validator`, dependencia ya presente en `backend/requirements.txt`.
- El login cambia su etiqueta visible a `Usuario o correo`.
- Crear usuario cambia su etiqueta visible a `Usuario o correo`.
- La columna del identificador en Usuarios ahora es editable.
- Un administrador puede cambiar una cuenta existente de `adriana_flores1` a `adriana.flores@empresa.com` y guardar la fila.
- El cambio conserva el mismo `user_id`, contraseña, rol, estado, auditoría e historial de accesos.
- Después del cambio, los nuevos inicios de sesión usan el identificador nuevo; el anterior deja de autenticar.
- La unicidad continúa siendo `COLLATE NOCASE`, por lo que dos correos que sólo cambian mayúsculas/minúsculas no pueden duplicarse.
- No se agrega una columna `email`: el correo funciona como valor del campo `username`, evitando una migración innecesaria de SQLite.
- No se requiere recrear `auth.sqlite3`; las cuentas existentes permanecen compatibles.
- No se modifican cookies, CSRF, roles, política de contraseña ni reglas de sesión.
- No se modifica SQL Server ni SCADA/BOS.
- No se modifica CSS ni `global.css`.

## Validación dirigida
- usuario tradicional aceptado: OK
- correo válido aceptado y normalizado: OK
- correo inválido rechazado: OK
- cuenta existente renombrada a correo: OK
- login con correo después del cambio: OK
- login con identificador anterior después del cambio: rechazado como corresponde
- duplicidad de correo sin distinguir mayúsculas/minúsculas: bloqueada
- runtime `authService.js -> authService.ts`: preservado
- UI Crear usuario / Login / tabla: `Usuario o correo`
- edición de identificador existente: habilitada
- backend compila: OK
- `global.css`: sin cambios
