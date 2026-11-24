// Búsqueda global por símbolo o nombre, con sugerencias (GET /activos/busqueda). Elegir una abre su análisis.
import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { activos } from '../api/resources';

const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;
const MAX = 8;

export function BuscadorTicker({ autoFocus = false, onListo }) {
  const [texto, setTexto] = useState('');
  const [res, setRes] = useState({ q: '', items: [], estado: 'vacio' }); // vacio | buscando | listo | error
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(-1);
  const [aviso, setAviso] = useState('');
  const vigente = useRef('');
  const caja = useRef(null);
  const input = useRef(null);
  const id = useId();
  const navigate = useNavigate();
  const q = texto.trim();

  useEffect(() => { if (autoFocus) input.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    vigente.current = q;
    if (!q) { setRes({ q: '', items: [], estado: 'vacio' }); return undefined; }
    const t = setTimeout(async () => {
      setRes(r => ({ ...r, estado: 'buscando' }));
      try {
        const items = (await activos.buscar(q, MAX))?.items || [];
        if (vigente.current === q) { setRes({ q, items, estado: 'listo' }); setActivo(-1); }
      } catch {
        if (vigente.current === q) setRes({ q, items: [], estado: 'error' });
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const ir = simbolo => {
    setTexto(''); setAbierto(false); setAviso('');
    input.current?.blur();
    onListo?.();
    navigate('/analisis/' + encodeURIComponent(simbolo));
  };

  // Enter: la sugerencia marcada o el símbolo exacto. Con texto inexacto se muestran las coincidencias para elegir (no se analiza a ciegas).
  // Sin servidor de búsqueda, el símbolo tal cual.
  const enviar = async e => {
    e.preventDefault();
    if (!q) return;
    if (activo >= 0 && res.items[activo]) { ir(res.items[activo].simbolo); return; }
    const simbolo = q.toUpperCase();
    let items = res.items, fallo = res.estado === 'error';
    if (res.q !== q) {
      try { items = (await activos.buscar(q, MAX))?.items || []; fallo = false; } catch { items = []; fallo = true; }
      if (vigente.current !== q) return;
    }
    const hallado = items.find(i => i.simbolo === simbolo) || (items.length === 1 ? items[0] : null);
    if (hallado) ir(hallado.simbolo);
    else if (items.length) { setRes({ q, items, estado: 'listo' }); setAbierto(true); setActivo(0); setAviso('Elige una de las coincidencias (flechas y Enter).'); }
    else if (fallo && TICKER.test(simbolo)) ir(simbolo);
    else setAviso(fallo ? 'La búsqueda no responde; escribe el símbolo exacto.' : `Ninguna empresa coincide con «${q}».`);
  };

  const onKey = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!res.items.length) return;
      e.preventDefault();
      setAbierto(true);
      const n = res.items.length, paso = e.key === 'ArrowDown' ? 1 : -1;
      setActivo(a => (a < 0 && paso < 0 ? n - 1 : (a + paso + n) % n));
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      if (abierto && q) { e.preventDefault(); setAbierto(false); setActivo(-1); } else onListo?.();
    }
  };

  const mostrar = abierto && q.length > 0;
  const mensaje = aviso || (res.estado === 'error' ? 'La búsqueda no responde. Escribe el símbolo y pulsa Enter.'
    : res.estado === 'listo' && !res.items.length ? `Ninguna empresa coincide con «${q}».`
    : res.q !== q && !res.items.length ? 'Buscando…' : '');
  return (
    <form className="busca" role="search" onSubmit={enviar} ref={caja}
      onBlur={e => { if (!caja.current?.contains(e.relatedTarget)) { setAbierto(false); setActivo(-1); } }}>
      <label htmlFor={id} className="sr-only">Buscar empresa por símbolo o nombre</label>
      <svg className="busca__lupa" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
      <input
        id={id} ref={input} type="search" value={texto} autoComplete="off" autoCorrect="off" spellCheck="false" maxLength={20} placeholder="Símbolo o nombre" enterKeyHint="search"
        role="combobox" aria-autocomplete="list" aria-expanded={mostrar && res.items.length > 0} aria-controls={id + '-l'} aria-activedescendant={activo >= 0 ? `${id}-${activo}` : undefined}
        onChange={e => { setTexto(e.target.value); setAbierto(true); setActivo(-1); setAviso(''); }} onFocus={() => setAbierto(true)} onKeyDown={onKey}
      />
      <div className="busca__panel" hidden={!mostrar}>
        <ul id={id + '-l'} role="listbox" aria-label="Empresas">
          {res.items.map((it, i) => (
            <li key={it.simbolo} id={`${id}-${i}`} role="option" aria-selected={i === activo} className={'busca__op' + (i === activo ? ' is-active' : '')}
              onPointerDown={e => e.preventDefault()} onClick={() => ir(it.simbolo)}>
              <strong>{it.simbolo}</strong>
              <span className="busca__nombre">{it.nombre || ''}</span>
              {it.opciones === false && <span className="muted small">sin opciones</span>}
            </li>
          ))}
        </ul>
        <p className="busca__msg muted small" role="status">{mensaje}</p>
      </div>
    </form>
  );
}
