import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { IntegrationStatus, useIntegraciones } from './IntegrationStatus';

const NAV = [
  { to: '/', label: 'Panel', end: true },
  { to: '/analizar', label: 'Analizar símbolo' },
  { group: 'Catálogos' },
  { to: '/empresas', label: 'Empresas' },
  { to: '/estrategias', label: 'Estrategias' },
  { group: 'Análisis' },
  { to: '/mercado', label: 'Mercado' },
  { to: '/analisis', label: 'Análisis (cores)' },
  { to: '/seleccion', label: 'Confluencia y selección' },
  { to: '/perfiles', label: 'Perfiles de análisis' },
  { to: '/configuraciones', label: 'Configuraciones' },
  { group: 'Operación' },
  { to: '/broker', label: 'Broker (paper)' },
  { to: '/sincronizaciones', label: 'Sincronizaciones' },
  { to: '/auditoria', label: 'Auditoría' },
];

export function Layout() {
  const { session, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const integraciones = useIntegraciones();

  useEffect(() => { setOpen(false); }, [location.pathname]);

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className={'app' + (open ? ' nav-open' : '')}>
      <a href="#contenido" className="skip-link">Saltar al contenido</a>
      <aside className="sidebar" aria-label="Navegación principal">
        <div className="brand">
          <span className="brand__logo" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28"><rect width="32" height="32" rx="7" fill="currentColor" /><path d="M6 22l6-7 5 4 9-11" stroke="var(--surface)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span className="brand__name">Opciones<small>Análisis de estrategias</small></span>
        </div>
        <nav>
          <ul className="nav">
            {NAV.map((item, i) => item.group
              ? <li key={'g' + i} className="nav__group">{item.group}</li>
              : (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end} className={({ isActive }) => 'nav__link' + (isActive ? ' is-active' : '')}>{item.label}</NavLink>
                </li>
              ))}
          </ul>
        </nav>
        <p className="sidebar__foot muted">Herramienta educativa. No es asesoría financiera.</p>
      </aside>
      <button type="button" className="scrim" aria-label="Cerrar menú" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button type="button" className="btn btn--ghost btn--icon menu-toggle" aria-label="Abrir menú" aria-expanded={open} onClick={() => setOpen(o => !o)}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <IntegrationStatus state={integraciones} compact />
          <div className="topbar__spacer" />
          <div className="topbar__user">
            <span className="topbar__email" title={session?.usuarioId}>{session?.email || 'Usuario'}</span>
            <span className="badge badge--info" title="Base de datos de la sesión">{session?.baseDatos === 'supabase' ? 'Supabase' : 'MongoDB'}</span>
          </div>
          <button type="button" className="btn btn--sm" onClick={onLogout}>Cerrar sesión</button>
        </header>
        <main id="contenido" className="content" tabIndex={-1}>
          <Outlet context={{ integraciones }} />
        </main>
      </div>
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
