import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Field } from '../components/Field';

export default function Login() {
  const { session, login, expired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '', baseDatos: 'mongodb' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (session?.token) return <Navigate to={location.state?.from || '/'} replace />;

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }));

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login({ email: form.email.trim(), password: form.password, baseDatos: form.baseDatos });
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login__card card" onSubmit={submit}>
        <div className="brand brand--center">
          <span className="brand__logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="36" height="36"><rect width="32" height="32" rx="7" fill="currentColor" /><path d="M6 22l6-7 5 4 9-11" stroke="var(--surface)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        </div>
        <h1>Iniciar sesión</h1>
        <p className="muted">Análisis de Long Call, Long Put e Iron Condor.</p>
        {expired && <div className="alert alert--warning" role="status">Tu sesión expiró o fue revocada. Vuelve a iniciar sesión.</div>}
        <Field label="Correo electrónico" required>
          <input type="email" autoComplete="username" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label="Contraseña" required>
          <input type="password" autoComplete="current-password" value={form.password} onChange={set('password')} required />
        </Field>
        <Field label="Base de datos" help="Los datos no se copian entre bases; cada sesión trabaja con la elegida.">
          <select value={form.baseDatos} onChange={set('baseDatos')}>
            <option value="mongodb">MongoDB</option>
            <option value="supabase">Supabase (PostgreSQL)</option>
          </select>
        </Field>
        {error && <div className="alert alert--danger" role="alert">{error.message}</div>}
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        <p className="muted small">El token se guarda solo en esta pestaña (sessionStorage) y se pierde al cerrarla.</p>
      </form>
    </div>
  );
}
