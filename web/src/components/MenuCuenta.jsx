// Menú de la cuenta: correo, broker (en pantallas chicas), tema, glosario y salir. Se cierra con Escape o al pulsar fuera.
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BrokerSelector } from './BrokerSelector';
import { TEMAS, aplicarTema, leerTema } from '../utils/tema';

export function MenuCuenta({ email, usuarioId, onSalir }) {
  const [abierto, setAbierto] = useState(false);
  const [tema, setTema] = useState(leerTema);
  const caja = useRef(null);
  const boton = useRef(null);
  const id = useId();
  const { pathname } = useLocation();

  useEffect(() => { setAbierto(false); }, [pathname]);
  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = e => { if (!caja.current?.contains(e.target)) setAbierto(false); };
    document.addEventListener('pointerdown', fuera);
    return () => document.removeEventListener('pointerdown', fuera);
  }, [abierto]);

  const onKey = e => {
    if (e.key !== 'Escape' || !abierto) return;
    e.stopPropagation();
    setAbierto(false);
    boton.current?.focus();
  };
  const alSalirFoco = e => { if (abierto && e.relatedTarget && !caja.current?.contains(e.relatedTarget)) setAbierto(false); };

  return (
    <div className="cuenta" ref={caja} onKeyDown={onKey} onBlur={alSalirFoco}>
      <button ref={boton} type="button" className="btn btn--ghost btn--icon cuenta__boton" aria-expanded={abierto} aria-controls={id} aria-label="Menú de la cuenta" onClick={() => setAbierto(a => !a)}>
        <svg className="cuenta__persona" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.6-3.8 3.4-6 7-6s6.4 2.2 7 6" /></svg>
        <svg className="cuenta__lineas" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <div id={id} className="cuenta__panel" hidden={!abierto}>
        <p className="cuenta__correo" title={usuarioId}>{email || 'Usuario'}</p>
        <div className="cuenta__broker"><span className="field__label">Broker para operar</span><BrokerSelector /></div>
        <fieldset className="cuenta__tema">
          <legend className="field__label">Tema</legend>
          <div className="seg">
            {TEMAS.map(t => (
              <button key={t.value} type="button" className={'seg__btn' + (tema === t.value ? ' is-active' : '')} aria-pressed={tema === t.value}
                onClick={() => { setTema(t.value); aplicarTema(t.value); }}>{t.label}</button>
            ))}
          </div>
        </fieldset>
        <Link className="cuenta__enlace" to="/glosario">Glosario</Link>
        <button type="button" className="btn btn--block" onClick={onSalir}>Salir</button>
      </div>
    </div>
  );
}
