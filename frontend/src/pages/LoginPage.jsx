import { useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import { getSetupStatus, login } from '../services/authService';

export default function LoginPage({ onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [setupMessage, setSetupMessage] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    getSetupStatus()
      .then((result) => {
        if (active && !result.configured) {
          setSetupMessage('No hay un administrador configurado. Cree el primer administrador desde la consola del servidor.');
        }
      })
      .catch(() => {
        if (active) setError('No fue posible comprobar el estado de autenticación del servidor.');
      });
    return () => { active = false; };
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    try {
      setLoading(true);
      setError('');
      const data = await login(username, password);
      onSuccess(data.user);
    } catch (err) {
      setError(err?.response?.data?.detail || 'No fue posible iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-backdrop" />
      <div className="login-card panel fade-up">
        <div className="login-brand">
          <div className="login-brand-frame">
            <div className="login-brand-glow" />
            <div className="login-brand-inner"><BrandLogo className="brand-logo login-logo" /></div>
          </div>
          <div className="login-brand-copy">
            <span className="login-brand-eyebrow">CONTROL HÍDRICO</span>
            <h1 className="login-brand-plant">PLANTA LAS FUENTES</h1>
            <p className="login-brand-caption">Monitoreo hídrico y operación en tiempo real</p>
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="login-username">Usuario</label>
          <div className="field-wrap">
            <User size={16} />
            <input id="login-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" disabled={loading} required />
          </div>
          <label className="field-label" htmlFor="login-password">Contraseña</label>
          <div className="field-wrap login-password-wrap">
            <Lock size={16} />
            <input id="login-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" disabled={loading} required />
            <button type="button" className="login-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} disabled={loading}>
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {setupMessage ? <div className="login-info" role="status">{setupMessage}</div> : null}
          {error ? <div className="login-error" role="alert">{error}</div> : null}
          <button className="login-button" type="submit" disabled={loading || Boolean(setupMessage)}>{loading ? 'Iniciando sesión…' : 'Entrar al sistema'}</button>
        </form>
      </div>
    </div>
  );
}
