// Configuración: sub-pestañas (rutas anidadas) que agrupan los catálogos y las herramientas avanzadas.
import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: 'perfiles', label: 'Perfiles de análisis' },
  { to: 'estrategias', label: 'Estrategias' },
  { to: 'configuraciones', label: 'Configuraciones' },
  { to: 'empresas', label: 'Empresas' },
  { to: 'conexiones', label: 'Conexiones de broker' },
  { to: 'sincronizaciones', label: 'Sincronizaciones' },
  { to: 'auditoria', label: 'Auditoría' },
  { to: 'cores', label: 'Evaluar cores' },
  { to: 'seleccion', label: 'Selección' },
  { to: 'mercado', label: 'Mercado' },
];

export default function Configuracion() {
  return (
    <>
      <nav className="subnav" aria-label="Secciones de configuración">
        {TABS.map(t => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => 'subnav__link' + (isActive ? ' is-active' : '')}>{t.label}</NavLink>
        ))}
      </nav>
      <div className="stack"><Outlet /></div>
    </>
  );
}
