import { useEffect, useMemo, useState } from 'react';
import { KeyRound, RefreshCw, Save, ShieldCheck, UserPlus, UserX } from 'lucide-react';
import PanelHeader from './pozos/components/PanelHeader';
import { useNotifications } from './pozos/components/NotificationCenter';
import { createUser, listUsers, resetUserPassword, revokeUserSessions, updateUser } from '../services/authService';

const ROLE_LABELS = {
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Consulta',
};

function readableError(error) {
  return error?.response?.data?.detail || error?.message || 'No fue posible completar la operación.';
}

function localDate(value) {
  if (!value) return 'Sin acceso registrado';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Sin acceso registrado' : parsed.toLocaleString('es-MX');
}

export default function UsersPage() {
  const { notify } = useNotifications();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ username: '', display_name: '', password: '', role: 'viewer' });
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');

  const activeAdmins = useMemo(
    () => users.filter((user) => user.role === 'admin' && user.is_active).length,
    [users],
  );

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      setUsers(await listUsers());
    } catch (err) {
      const message = readableError(err);
      setError(message);
      notify({ type: 'error', title: 'No se pudieron cargar los usuarios', message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleCreate = async (event) => {
    event.preventDefault();
    try {
      setError('');
      await createUser({ ...form, is_active: true });
      setForm({ username: '', display_name: '', password: '', role: 'viewer' });
      notify({ type: 'success', title: 'Usuario creado', message: 'El nuevo acceso quedó disponible para Planta Las Fuentes.' });
      await load();
    } catch (err) {
      const message = readableError(err);
      setError(message);
      notify({ type: 'error', title: 'No se pudo crear el usuario', message });
    }
  };

  const editLocal = (id, changes) => {
    setUsers((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
  };

  const saveUser = async (user) => {
    try {
      setBusyId(user.id ?? null);
      setError('');
      await updateUser(user.id, {
        display_name: user.display_name || user.name || '',
        role: user.role,
      });
      notify({ type: 'success', title: 'Usuario actualizado', message: `${user.username} guardado correctamente.` });
      await load();
    } catch (err) {
      const message = readableError(err);
      setError(message);
      notify({ type: 'error', title: 'No se pudo actualizar el usuario', message });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (user) => {
    try {
      setBusyId(user.id ?? null);
      setError('');
      await updateUser(user.id, { is_active: !user.is_active });
      notify({
        type: 'success',
        title: user.is_active ? 'Usuario desactivado' : 'Usuario activado',
        message: `${user.username} fue actualizado.`,
      });
      await load();
    } catch (err) {
      const message = readableError(err);
      setError(message);
      notify({ type: 'error', title: 'No se pudo cambiar el estado', message });
    } finally {
      setBusyId(null);
    }
  };

  const submitPasswordReset = async (event) => {
    event.preventDefault();
    if (!resetTarget) return;
    try {
      setBusyId(resetTarget.id ?? null);
      setError('');
      await resetUserPassword(resetTarget.id, resetPasswordValue);
      notify({
        type: 'success',
        title: 'Contraseña actualizada',
        message: 'Las sesiones anteriores del usuario fueron revocadas.',
      });
      setResetTarget(null);
      setResetPasswordValue('');
    } catch (err) {
      const message = readableError(err);
      setError(message);
      notify({ type: 'error', title: 'No se pudo restablecer la contraseña', message });
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (user) => {
    if (!window.confirm(`¿Cerrar todas las sesiones de ${user.username}?`)) return;
    try {
      setBusyId(user.id ?? null);
      setError('');
      await revokeUserSessions(user.id);
      notify({ type: 'success', title: 'Sesiones revocadas', message: `${user.username} deberá iniciar sesión nuevamente.` });
    } catch (err) {
      const message = readableError(err);
      setError(message);
      notify({ type: 'error', title: 'No se pudieron revocar las sesiones', message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <section className="panel fade-up users-admin-header">
        <PanelHeader title="Usuarios" subtitle="Administración local de accesos para Planta Las Fuentes." />
        <p className="panel-subtitle">Las credenciales y sesiones se administran exclusivamente en este servidor. No se comparten con otras plantas.</p>
      </section>

      <section className="panel fade-up users-create-panel">
        <PanelHeader title="Crear usuario" subtitle="La contraseña debe tener al menos 10 caracteres, una letra y un número." />
        <form className="users-create-form" onSubmit={handleCreate}>
          <label><span>Usuario</span><input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} autoComplete="off" required /></label>
          <label><span>Nombre visible</span><input value={form.display_name} onChange={(event) => setForm((current) => ({ ...current, display_name: event.target.value }))} required /></label>
          <label><span>Contraseña inicial</span><input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} autoComplete="new-password" minLength={10} required /></label>
          <label><span>Rol</span><select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}><option value="viewer">Consulta</option><option value="operator">Operador</option><option value="admin">Administrador</option></select></label>
          <button type="submit" className="primary-action users-create-button"><UserPlus size={16} /> Crear usuario</button>
        </form>
        {error ? <div className="status-pill alert users-status" role="alert">{error}</div> : null}
      </section>

      {resetTarget ? (
        <div className="report-email-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && busyId !== resetTarget.id) { setResetTarget(null); setResetPasswordValue(''); } }}>
          <form className="report-email-card panel users-password-modal" role="dialog" aria-modal="true" aria-label="Restablecer contraseña" onSubmit={submitPasswordReset}>
            <div><h3>Restablecer contraseña</h3><p>Usuario: {resetTarget.username}</p></div>
            <label className="report-email-field"><span>Nueva contraseña</span><input type="password" value={resetPasswordValue} onChange={(event) => setResetPasswordValue(event.target.value)} autoComplete="new-password" minLength={10} required autoFocus /></label>
            <p className="panel-subtitle">Todas las sesiones existentes de este usuario serán revocadas.</p>
            <div className="report-email-actions"><button type="button" className="ghost-action" onClick={() => { setResetTarget(null); setResetPasswordValue(''); }} disabled={busyId === resetTarget.id}>Cancelar</button><button type="submit" className="primary-action" disabled={busyId === resetTarget.id}>Actualizar contraseña</button></div>
          </form>
        </div>
      ) : null}

      <section className="panel fade-up users-list-panel">
        <div className="users-list-heading"><PanelHeader title="Usuarios registrados" subtitle={`${users.length} usuarios · ${activeAdmins} administradores activos`} /><button type="button" className="ghost-action" onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Actualizar</button></div>
        <div className="users-table-wrap">
          <table className="users-table">
            <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Acciones</th></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={String(user.id)}>
                  <td><strong>{user.username}</strong></td>
                  <td><input className="users-inline-input" value={user.display_name || user.name || ''} onChange={(event) => editLocal(user.id, { display_name: event.target.value, name: event.target.value })} disabled={busyId === user.id} aria-label={`Nombre visible de ${user.username}`} /></td>
                  <td><select value={user.role} onChange={(event) => editLocal(user.id, { role: event.target.value })} disabled={busyId === user.id} aria-label={`Rol de ${user.username}`}><option value="admin">{ROLE_LABELS.admin}</option><option value="operator">{ROLE_LABELS.operator}</option><option value="viewer">{ROLE_LABELS.viewer}</option></select></td>
                  <td><span className={`status-pill ${user.is_active ? 'normal' : 'alert'}`}>{user.is_locked ? 'Bloqueado temporalmente' : user.is_active ? 'Activo' : 'Desactivado'}</span></td>
                  <td>{localDate(user.last_login_at)}</td>
                  <td><div className="users-row-actions"><button type="button" className="ghost-action" onClick={() => void saveUser(user)} disabled={busyId === user.id}><Save size={14} /> Guardar</button><button type="button" className="ghost-action" onClick={() => { setResetTarget(user); setResetPasswordValue(''); setError(''); }} disabled={busyId === user.id}><KeyRound size={14} /> Contraseña</button><button type="button" className="ghost-action" onClick={() => void revoke(user)} disabled={busyId === user.id}><ShieldCheck size={14} /> Cerrar sesiones</button><button type="button" className="ghost-action" onClick={() => void toggleActive(user)} disabled={busyId === user.id}><UserX size={14} /> {user.is_active ? 'Desactivar' : 'Activar'}</button></div></td>
                </tr>
              ))}
              {!loading && !users.length ? <tr><td colSpan={6}>No hay usuarios registrados.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
