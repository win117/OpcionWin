import { Suspense, useEffect, useRef, useState } from 'react';
import { Loading } from './States';
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { cargarEstadoMercado } from '../api/resources';
import { IntegrationStatus, useIntegraciones } from './IntegrationStatus';
import { BrokerSelector } from './BrokerSelector';
import { BuscadorTicker } from './BuscadorTicker';
import Logo from './Logo';
import { MenuCuenta } from './MenuCuenta';
import { MercadoEstado } from './MercadoEstado';
import { AvisosPwa } from './AvisosPwa';
import { tituloDeRuta } from '../utils/constants';

// `icono`: trazo de 24×24, solo se ve en la barra inferior.
const NAV = [
  { to: '/', label: 'Inicio', end: true, icono: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z' },
  { to: '/analisis', label: 'Análisis', icono: 'M4 19h16M7 16V9m5 7V5m5 11v-5' },
  { to: '/posiciones', label: 'Posiciones', icono: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16' },
  { to: '/ordenes', label: 'Órdenes', icono: 'M7 4h10v16H7zM10 9h4m-4 4h4' },
  { to: '/configuracion', label: 'Configuración', icono: 'M4 7h10m4 0h2M4 17h2m4 0h10M14 4.5v5M6 14.5v5' },
];
const MERCADO_REFRESH_MS = 60000;
const ESPERA_H1_MS = 5000;

/** Título del documento, scroll arriba y foco en el h1 al cambiar de página (si el h1 llega después, se espera a que aparezca). */
function useNavegacion() {
  const { pathname } = useLocation();
  const tipo = useNavigationType();
  const anterior = useRef(pathname);
  useEffect(() => {
    document.title = `${tituloDeRuta(pathname)} | WinOpciones`;
    if (anterior.current === pathname) return undefined;
    anterior.current = pathname;
    if (tipo !== 'POP') window.scrollTo(0, 0);
    const main = document.getElementById('contenido');
    const enfocar = () => {
      const h1 = main?.querySelector('h1');
      if (!h1) return false;
      h1.tabIndex = -1;
      h1.focus({ preventScroll: true });
      return true;
    };
    if (enfocar()) return undefined;
    main?.focus({ preventScroll: true });
    const obs = new MutationObserver(() => {
      // Si la persona ya movió el foco, no se lo quitamos.
      const quieto = document.activeElement === main || document.activeElement === document.body;
      if (!quieto || enfocar()) obs.disconnect();
    });
    obs.observe(main, { childList: true, subtree: true });
    const t = setTimeout(() => obs.disconnect(), ESPERA_H1_MS);
    return () => { obs.disconnect(); clearTimeout(t); };
  }, [pathname, tipo]);
}

export function Layout() {
  const { session, logout } = useAuth();
  const [buscando, setBuscando] = useState(false); // búsqueda sobre la cabecera, en pantallas chicas
  const lupa = useRef(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const integraciones = useIntegraciones();
  const mercado = useAsync(cargarEstadoMercado, []);
  const recarga = useRef(mercado.reload);
  recarga.current = mercado.reload;
  useNavegacion();

  useEffect(() => { setBuscando(false); }, [pathname]);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') recarga.current(); }, MERCADO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };
  const cerrarBusqueda = () => { setBuscando(false); lupa.current?.focus(); };

  return (
    <div className="app">
      <a href="#contenido" className="skip-link">Saltar al contenido</a>
      <header className="topnav">
        <div className="topnav__inner">
          <Link to="/" className="brand" aria-label="WinOpciones, ir al inicio">
            <Logo size={32} />
            <span className="brand__name">WinOpciones</span>
          </Link>
          <nav className="topnav__nav" aria-label="Navegación principal">
            <ul>
              {NAV.map(item => (
                <li key={item.to}>
                  <NavLink to={item.to} end={item.end} className={({ isActive }) => 'topnav__link' + (isActive ? ' is-active' : '')}>
                    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={item.icono} /></svg>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div className="topnav__tools">
            <BuscadorTicker />
            <button ref={lupa} type="button" className="btn btn--ghost btn--icon topnav__lupa" aria-label="Buscar empresa" aria-expanded={buscando} onClick={() => setBuscando(true)}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
            </button>
            <MercadoEstado estado={mercado} />
            <BrokerSelector />
            <MenuCuenta email={session?.email} usuarioId={session?.usuarioId} onSalir={onLogout} />
          </div>
          {buscando && (
            <div className="topnav__busca">
              <BuscadorTicker autoFocus onListo={cerrarBusqueda} />
              <button type="button" className="btn btn--ghost btn--icon" aria-label="Cerrar búsqueda" onClick={cerrarBusqueda}>×</button>
            </div>
          )}
        </div>
      </header>
      <AvisosPwa />
      <main id="contenido" className="content" tabIndex={-1}>
        <Suspense fallback={<Loading text="Cargando…" />}><Outlet context={{ integraciones, mercado }} /></Suspense>
      </main>
      <footer className="app-foot muted small">
        <span>Herramienta educativa. No es asesoría financiera.</span>
        <IntegrationStatus state={integraciones} compact />
        <span>Tus datos se guardan en {session?.baseDatos === 'supabase' ? 'Supabase' : 'MongoDB'}</span>
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
