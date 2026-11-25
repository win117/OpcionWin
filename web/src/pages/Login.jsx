import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Field } from '../components/Field';
import Logo from '../components/Logo';

// Ganancia o pérdida al vencimiento de cada estrategia: puntos [x, y] en un lienzo de 200×90 con el cero en y = 50.
const ESTRATEGIAS = [
  { nombre: 'Long Call', idea: 'Ganas si sube', puntos: [[0, 68], [95, 68], [190, 8]] },
  { nombre: 'Long Put', idea: 'Ganas si baja', puntos: [[10, 8], [105, 68], [200, 68]] },
  { nombre: 'Iron Condor', idea: 'Ganas si se queda en rango', puntos: [[0, 76], [35, 76], [68, 26], [132, 26], [165, 76], [200, 76]] },
];
const CERO = 50;
function Pago({ nombre, idea, puntos, i }) {
  const linea = puntos.map(([x, y], k) => (k ? 'L' : 'M') + x + ' ' + y).join('');
  const area = `${linea}L${puntos.at(-1)[0]} ${CERO}L${puntos[0][0]} ${CERO}Z`;
  return (
    <figure className="pago" style={{ '--i': i }}>
      <figcaption><strong>{nombre}</strong><span>{idea}</span></figcaption>
      <svg viewBox="0 0 200 90" preserveAspectRatio="none">
        <defs><clipPath id={'gana' + i}><rect width="200" height={CERO} /></clipPath><clipPath id={'pierde' + i}><rect y={CERO} width="200" height="40" /></clipPath></defs>
        <path className="pago__gana" d={area} clipPath={`url(#gana${i})`} /><path className="pago__pierde" d={area} clipPath={`url(#pierde${i})`} />
        <line className="pago__cero" x1="0" x2="200" y1={CERO} y2={CERO} />
        <path className="pago__linea" d={linea} />
      </svg>
    </figure>
  );
}

export default function Login() {
  const { session, login, expired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '', baseDatos: 'mongodb' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { document.title = 'Iniciar sesión | WinOpciones'; }, []);

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
      <aside className="login__arte" aria-hidden="true">
        <div className="login__marca"><Logo size={44} /><span>WinOpciones</span></div>
        <p className="login__lema">Tres estrategias, cinco cores de análisis, una decisión tuya.</p>
        <div className="login__estrategias">{ESTRATEGIAS.map((e, i) => <Pago key={e.nombre} {...e} i={i} />)}</div>
      </aside>
      <form className="login__card" onSubmit={submit}>
        <div className="login__movil"><Logo size={40} /><span>WinOpciones</span></div>
        <div>
          <h1>Iniciar sesión</h1>
          <p className="muted">Análisis de Long Call, Long Put e Iron Condor en cuenta simulada.</p>
        </div>
        {expired && <div className="alert alert--warning" role="status">Tu sesión expiró o fue revocada. Vuelve a iniciar sesión.</div>}
        <Field label="Correo electrónico" required>
          <input type="email" autoComplete="username" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label="Contraseña" required>
          <input type="password" autoComplete="current-password" value={form.password} onChange={set('password')} required />
        </Field>
        <Field label="Dónde guardar tus datos" help="Lo que guardes en uno no aparece en el otro.">
          <select value={form.baseDatos} onChange={set('baseDatos')}>
            <option value="mongodb">MongoDB</option>
            <option value="supabase">Supabase</option>
          </select>
        </Field>
        {error && <div className="alert alert--danger" role="alert">{error.message}</div>}
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        <p className="muted small">Por seguridad, la sesión se cierra al cerrar esta pestaña.</p>
      </form>
    </div>
  );
}
