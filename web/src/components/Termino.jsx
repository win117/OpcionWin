// Término del glosario: se explica al pasar el puntero, enfocar o tocar. <Termino id="delta">Delta</Termino>
// Usa un botón: no lo pongas dentro de otro botón, enlace o etiqueta de formulario.
import { useEffect, useId, useRef, useState } from 'react';
import { GLOSARIO } from '../utils/constants';

const ANCHO = 300, ESPACIO = 150;

export function Termino({ id, children }) {
  const t = GLOSARIO[id];
  const uid = useId();
  const ref = useRef(null);
  const fijo = useRef(false); // abierto por clic o toque: no se cierra al salir el puntero
  const [pos, setPos] = useState(null);
  const abierto = pos !== null;

  const abrir = () => {
    const r = ref.current.getBoundingClientRect();
    const ancho = Math.min(ANCHO, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left, window.innerWidth - ancho - 12));
    setPos(r.bottom + ESPACIO > window.innerHeight && r.top > ESPACIO ? { left, width: ancho, bottom: window.innerHeight - r.top } : { left, width: ancho, top: r.bottom });
  };
  const cerrar = () => { fijo.current = false; setPos(null); };

  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = e => { if (!ref.current?.parentElement.contains(e.target)) cerrar(); };
    window.addEventListener('scroll', cerrar, true);
    document.addEventListener('pointerdown', fuera);
    return () => { window.removeEventListener('scroll', cerrar, true); document.removeEventListener('pointerdown', fuera); };
  }, [abierto]);

  if (!t) return children;
  return (
    <span className="termino__caja"
      onPointerEnter={e => { if (e.pointerType === 'mouse' && !abierto) abrir(); }}
      onPointerLeave={e => { if (e.pointerType === 'mouse' && !fijo.current) cerrar(); }}>
      <button ref={ref} type="button" className="termino" aria-expanded={abierto} aria-describedby={abierto ? uid : undefined}
        onClick={() => { if (abierto && fijo.current) cerrar(); else { fijo.current = true; abrir(); } }}
        onFocus={() => { if (ref.current.matches(':focus-visible')) abrir(); }} onBlur={cerrar}
        onKeyDown={e => { if (e.key === 'Escape' && abierto) { e.preventDefault(); e.stopPropagation(); cerrar(); } }}>
        {children || t.nombre}
      </button>
      {abierto && (
        <span className="termino__globo" style={pos}>
          <span id={uid} role="tooltip" className="termino__texto"><strong>{t.nombre}</strong>{t.texto}</span>
        </span>
      )}
    </span>
  );
}
