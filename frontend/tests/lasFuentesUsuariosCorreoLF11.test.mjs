import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const users = read('../src/pages/UsersPage.jsx');
const login = read('../src/pages/LoginPage.tsx');
const authService = read('../src/services/authService.ts');
const authShim = read('../src/services/authService.js');

assert.match(login, /Usuario o correo/, 'Login debe indicar que acepta usuario o correo');
assert.match(login, /placeholder="Usuario o correo"/, 'Login debe mantener un input mixto y no type=email');

assert.match(users, /<span>Usuario o correo<\/span>/, 'Alta de usuario debe aceptar ambos formatos');
assert.match(users, /<th>Usuario o correo<\/th>/, 'Tabla debe nombrar correctamente el identificador');
assert.match(users, /username: user\.username \|\| ''/, 'Guardar fila debe enviar el identificador editable');
assert.match(users, /editLocal\(user\.id, \{ username: event\.target\.value \}\)/, 'Usuario existente debe poder cambiar su identificador');
assert.match(users, /maxLength=\{254\}/, 'UI debe permitir longitud suficiente para correo');

assert.match(authService, /export interface UpdateUserPayload \{[\s\S]*username\?: string;/, 'PATCH de usuario debe aceptar username');
assert.equal(authShim.trim(), "export * from './authService.ts';", 'Runtime JS debe seguir delegando al TS canonico');

console.log('LF-11 Usuarios: usuario tradicional + correo y edición de identificador OK');
