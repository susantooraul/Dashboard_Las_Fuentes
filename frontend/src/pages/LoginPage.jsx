import { useState } from 'react';
import { Lock, User as UserIcon } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import { login } from '../services/authService';
export default function LoginPage({ onSuccess }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const handleSubmit = async (event) => {
        event.preventDefault();
        try {
            setLoading(true);
            setError('');
            const data = await login(username, password);
            onSuccess(data.user);
        }
        catch (err) {
            setError(err.response?.data?.detail || 'No fue posible iniciar sesión');
        }
        finally {
            setLoading(false);
        }
    };
    return (<div className="login-shell">
      <div className="login-backdrop"/>
      <div className="login-card panel fade-up">
        <div className="login-brand">
          <div className="login-brand-frame">
            <div className="login-brand-glow"/>
            <div className="login-brand-inner">
              <BrandLogo className="brand-logo login-logo"/>
            </div>
          </div>

          <div className="login-brand-copy">
            <span className="login-brand-eyebrow">CONTROL HIDRICO</span>
            <h1 className="login-brand-plant">PLANTA LAS FUENTES</h1>
            <p className="login-brand-caption">Monitoreo Hidrico y operacion en tiempo real</p>
          </div>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field-label">Usuario</label>
          <div className="field-wrap"><UserIcon size={16}/><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Usuario"/></div>
          <label className="field-label">Contraseña</label>
          <div className="field-wrap"><Lock size={16}/><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña"/></div>
          {error ? <div className="login-error">{error}</div> : null}
          <button className="login-button" disabled={loading}>{loading ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <div className="login-hint">Usa las credenciales asignadas para esta planta.</div>
      </div>
    </div>);
}
