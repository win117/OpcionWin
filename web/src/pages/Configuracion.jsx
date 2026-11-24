// Configuración: secciones (rutas anidadas) en tres grupos. En escritorio, columna lateral; en pantallas chicas, grupo + fila deslizable.
import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { CONFIG_GRUPOS } from '../utils/constants';
import { centrarEn } from '../utils/desplazar';

export default function Configuracion() {
  const { pathname } = useLocation();
  const actual = pathname.split('/')[2];
  const grupo = CONFIG_GRUPOS.find(g => g.secciones.some(s => s.to === actual)) || CONFIG_GRUPOS[0];
  const nav = useRef(null);

  useEffect(() => {
    const activo = nav.current?.querySelector('.subnav__link.is-active');
    centrarEn(activo?.closest('ul'), activo);
  }, [actual]);

  return (
    <div className="cfg">
      <nav ref={nav} className="cfg__nav" aria-label="Secciones de configuración">
        <div className="cfg__grupos">
          {CONFIG_GRUPOS.map(g => (
            <Link key={g.nombre} to={g.secciones[0].to} className={'cfg__grupo-op' + (g === grupo ? ' is-active' : '')} aria-current={g === grupo ? 'true' : undefined}>{g.nombre}</Link>
          ))}
        </div>
        {CONFIG_GRUPOS.map(g => (
          <section key={g.nombre} className={'cfg__grupo' + (g === grupo ? ' is-active' : '')} aria-label={g.nombre}>
            <p className="cfg__nombre">{g.nombre}</p>
            <p className="cfg__desc">{g.descripcion}</p>
            <ul>
              {g.secciones.map(s => (
                <li key={s.to}><NavLink to={s.to} title={s.descripcion} className={({ isActive }) => 'subnav__link' + (isActive ? ' is-active' : '')}>{s.label}</NavLink></li>
              ))}
            </ul>
          </section>
        ))}
        <Link className="cfg__glosario" to="/glosario">Glosario de términos</Link>
      </nav>
      <div className="cfg__cuerpo stack"><Outlet /></div>
    </div>
  );
}
