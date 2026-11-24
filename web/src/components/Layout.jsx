import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { cargarEstadoMercado } from '../api/resources';
import { IntegrationStatus, useIntegraciones } from './IntegrationStatus';
import { BrokerSelector } from './BrokerSelector';
import { BuscadorTicker } from './BuscadorTicker';
import { MercadoEstado } from './MercadoEstado';

const NAV = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/analisis', label: 'Análisis' },
  { to: '/posiciones', label: 'Posiciones' },
  { to: '/ordenes', label: 'Órdenes' },
  { to: '/configuracion', label: 'Configuración' },
];
const MERCADO_REFRESH_MS = 60000;

export function Layout() {
  const { session, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const integraciones = useIntegraciones();
  const mercado = useAsync(cargarEstadoMercado, []);
  const recarga = useRef(mercado.reload);
  recarga.current = mercado.reload;

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') recarga.current(); }, MERCADO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app">
      <a href="#contenido" className="skip-link">Saltar al contenido</a>
      <header className="topnav">
        <div className="topnav__inner">
          <Link to="/" className="brand" aria-label="Opciones, ir al inicio">
            <span className="brand__logo" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="26" height="26"><rect width="32" height="32" rx="7" fill="currentColor" /><path d="M6 22l6-7 5 4 9-11" stroke="var(--surface)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <span className="brand__name">Opciones</span>
          </Link>
          <button type="button" className="btn btn--ghost btn--icon menu-toggle" aria-label={open ? 'Cerrar menú' : 'Abrir menú'} aria-expanded={open} aria-controls="menu-principal" onClick={() => setOpen(o => !o)}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={open ? 'M6 6l12 12M18 6L6 18' : 'M4 6h16M4 12h16M4 18h16'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <nav id="menu-principal" className={'topnav__nav' + (open ? ' is-open' : '')} aria-label="Navegación principal">
            <ul>
              {NAV.map(item => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end} className={({ isActive }) => 'topnav__link' + (isActive ? ' is-active' : '')}>{item.label}</NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="topnav__tools">
            <BuscadorTicker />
            <MercadoEstado estado={mercado} />
            <BrokerSelector />
            <span className="topbar__email" title={session?.usuarioId}>{session?.email || 'Usuario'}</span>
            <button type="button" className="btn btn--sm" onClick={onLogout}>Salir</button>
          </div>
        </div>
      </header>
      <main id="contenido" className="content" tabIndex={-1}>
        <Outlet context={{ integraciones, mercado }} />
      </main>
      <footer className="app-foot muted small">
        <span>Herramienta educativa. No es asesoría financiera.</span>
        <IntegrationStatus state={integraciones} compact />
        <span title="Base de datos de la sesión">{session?.baseDatos === 'supabase' ? 'Supabase' : 'MongoDB'}</span>
      </footer>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
