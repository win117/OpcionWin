// Mapa del mercado en vivo: un cuadro por empresa (tamaño = capitalización o dinero negociado; color = variación o compatibilidad).
// Al elegir una empresa se abre su ficha; al elegir un sector se amplía y se resume la selección.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { mercado } from '../../api/resources';
import { useSondeo } from '../../hooks/useSondeo';
import { disponerMapa } from '../../utils/treemap';
import { giroEs } from '../../utils/sic';
import { NOTA_PUNTAJE, ESTRATEGIA_LABELS } from '../../utils/constants';
import { ErrorMessage } from '../../components/States';
import { Termino } from '../../components/Termino';
import { fmtCompact, fmtFixed, fmtMoney, fmtNum, isNum } from '../../utils/format';
import FichaEmpresa from './FichaEmpresa';
import ResumenSector from './ResumenSector';

const COLORES = [
  { id: 'cambioPct', label: 'Hoy' },
  { id: 'cambio5d', label: '1 semana' },
  { id: 'cambio21d', label: '1 mes' },
  { id: 'LONG_CALL', label: 'Long Call', puntaje: true, termino: 'long_call' },
  { id: 'LONG_PUT', label: 'Long Put', puntaje: true, termino: 'long_put' },
  { id: 'IRON_CONDOR', label: 'Iron Condor', puntaje: true, termino: 'iron_condor' },
];
const TAMANOS = [{ id: 'capitalizacion', label: 'Capitalización' }, { id: 'dinero', label: 'Dinero negociado hoy' }];
const MS_ABIERTO = 10000, MS_CERRADO = 60000, MS_ERROR = 5000;
// El color pleno se alcanza en el primer escalón que cubre a 9 de cada 10 empresas: un día agitado no pinta todo igual.
const TOPES = [0.03, 0.05, 0.08, 0.12];
const PUNTAJES = [{ desde: 0, texto: 'Menos de 40, baja' }, { desde: 40, texto: '40 a 60, media' }, { desde: 60, texto: '60 a 80, buena' }, { desde: 80, texto: '80 o más, alta' }];
const MAX_MOVIL = 9; // empresas por sector en pantallas chicas

const valorDe = (item, modo) => (modo.puntaje ? item.puntajes?.[modo.id] ?? null : item[modo.id] ?? null);
const textoDe = (v, modo) => (!isNum(v) ? '—' : modo.puntaje ? fmtNum(v, 0) : (v > 0 ? '+' : '') + fmtFixed(v * 100, 2) + '%');
function topeDe(items, modo) {
  const v = items.map(i => Math.abs(valorDe(i, modo))).filter(isNum).sort((a, b) => a - b);
  return TOPES.find(t => t >= (v[Math.floor(v.length * 0.9)] ?? 0)) ?? TOPES.at(-1);
}
function colorDe(v, modo, tope) {
  if (!isNum(v)) return 'var(--mapa-nodata)';
  if (modo.puntaje) return `var(--mapa-p${PUNTAJES.filter(p => v >= p.desde).length || 1})`;
  return `color-mix(in oklab, var(${v >= 0 ? '--mapa-sube' : '--mapa-baja'}) ${Math.round(Math.min(1, Math.abs(v) / tope) * 100)}%, var(--mapa-cero))`;
}

const Cuadro = memo(function Cuadro({ simbolo, nombre, x, y, w, h, color, texto, elegido, enFoco }) {
  const fuente = Math.max(11, Math.min(34, (w - 6) / (simbolo.length * 0.78), h * 0.36));
  const conSimbolo = h > 15 && w - 3 >= simbolo.length * 7.6;
  const fuenteValor = Math.max(11, Math.min(15, fuente * 0.55));
  const conTexto = conSimbolo && h > (fuente + fuenteValor) * 1.2 && w - 4 > texto.length * fuenteValor * 0.56;
  return (
    <button type="button" tabIndex={enFoco ? 0 : -1} data-nav={'s:' + simbolo} data-s={simbolo} className={'mapa__cuadro' + (elegido ? ' is-elegido' : '')} aria-label={`${simbolo}, ${nombre}, ${texto}`}
      style={{ left: x, top: y, width: Math.max(0, w - 1), height: Math.max(0, h - 1), background: color }}>
      {conSimbolo && <span className="mapa__simbolo" style={{ fontSize: fuente }}>{simbolo}</span>}
      {conTexto && <span className="mapa__valor" style={{ fontSize: fuenteValor }}>{texto}</span>}
    </button>
  );
});

function Leyenda({ modo, tope }) {
  if (modo.puntaje) {
    return (
      <ul className="mapa__leyenda mapa__leyenda--puntaje" aria-label="Escala de compatibilidad">
        {PUNTAJES.map((p, i) => <li key={p.desde}><i style={{ '--c': `var(--mapa-p${i + 1})` }} />{p.texto}</li>)}
      </ul>
    );
  }
  const t = Math.round(tope * 100);
  return <div className="mapa__leyenda" aria-label="Escala de variación" title="El color pleno se ajusta al movimiento del día: 9 de cada 10 empresas quedan dentro de la escala."><span>−{t}% o menos</span><i /><span>+{t}% o más</span></div>;
}

/** Antigüedad del dato. Si la última actualización falló, avisa aquí mismo sin mover la página. */
function Hace({ fecha, abierto, falla }) {
  const [, tic] = useState(0);
  useEffect(() => { const id = setInterval(() => tic(n => n + 1), 1000); return () => clearInterval(id); }, []);
  if (!fecha) return <span className="mapa__hace" />;
  const s = Math.max(0, Math.round((Date.now() - new Date(fecha).getTime()) / 1000));
  const hace = s < 90 ? s + ' s' : Math.round(s / 60) + ' min';
  if (falla) return <span className="small mapa__hace mapa__hace--aviso" role="status">No se pudo actualizar. Datos de hace {hace}</span>;
  return <span className="muted small mapa__hace"><span className={'dot ' + (abierto ? 'dot--ok' : 'dot--neutral')} aria-hidden="true" />{abierto ? 'En vivo' : 'Último cierre'}, actualizado hace {hace}</span>;
}

function Tabla({ items, modo, elegido, onElegir }) {
  const [orden, setOrden] = useState({ campo: 'capitalizacion', asc: false });
  const filas = useMemo(() => {
    const v = i => (orden.campo === 'color' ? valorDe(i, modo) : i[orden.campo]);
    return [...items].sort((a, b) => {
      const x = v(a), y = v(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return (orden.asc ? c : -c) || b.capitalizacion - a.capitalizacion;
    });
  }, [items, orden, modo]);
  const th = (campo, texto, num) => (
    <th scope="col" className={num ? 'num' : undefined} aria-sort={orden.campo === campo ? (orden.asc ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="mapa__th" onClick={() => setOrden(o => ({ campo, asc: o.campo === campo ? !o.asc : campo === 'simbolo' || campo === 'sector' }))}>{texto}{orden.campo === campo ? (orden.asc ? ' ▲' : ' ▼') : ''}</button>
    </th>
  );
  return (
    <div className="table-wrap mapa__tabla">
      <table className="table table--dense">
        <thead><tr>{th('simbolo', 'Empresa')}{th('sector', 'Sector')}{th('precio', 'Precio', true)}{th('cambioPct', 'Hoy', true)}{th('capitalizacion', 'Capitalización (USD)', true)}{modo.id !== 'cambioPct' && th('color', modo.label, true)}</tr></thead>
        <tbody>
          {filas.map(i => (
            <tr key={i.simbolo} className={i.simbolo === elegido ? 'is-elegido' : undefined}>
              <th scope="row"><button type="button" className="mapa__th" data-fila={i.simbolo} onClick={() => onElegir(i.simbolo, `[data-fila="${i.simbolo}"]`)}><strong>{i.simbolo}</strong> <span className="muted small">{i.nombre}</span></button></th>
              <td className="muted">{i.sector}</td>
              <td className="num">{fmtMoney(i.precio)}</td>
              <td className={'num ' + (i.cambioPct >= 0 ? 'up' : 'down')}>{textoDe(i.cambioPct, COLORES[0])}</td>
              <td className="num">{fmtCompact(i.capitalizacion)}</td>
              {modo.id !== 'cambioPct' && <td className="num">{textoDe(valorDe(i, modo), modo)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Elemento más cercano a `desde` en la dirección de la flecha. */
function vecino(todos, desde, tecla) {
  const a = desde.getBoundingClientRect(), horizontal = tecla === 'ArrowLeft' || tecla === 'ArrowRight';
  let mejor = null, menor = Infinity;
  for (const el of todos) {
    if (el === desde) continue;
    const b = el.getBoundingClientRect();
    const avance = tecla === 'ArrowRight' ? b.left - a.right : tecla === 'ArrowLeft' ? a.left - b.right : tecla === 'ArrowDown' ? b.top - a.bottom : a.top - b.bottom;
    if (avance < -2) continue;
    const desvio = horizontal ? Math.max(0, b.top - a.bottom, a.top - b.bottom) + Math.abs((b.top + b.bottom - a.top - a.bottom) / 2) * 0.2
      : Math.max(0, b.left - a.right, a.left - b.right) + Math.abs((b.left + b.right - a.left - a.right) / 2) * 0.2;
    const d = Math.max(0, avance) + desvio * 3;
    if (d < menor) { menor = d; mejor = el; }
  }
  return mejor;
}

export default function MapaMercado() {
  const { data, error, loading } = useSondeo(() => mercado.mapa(), d => (!d ? MS_ERROR : d.abierto ? MS_ABIERTO : MS_CERRADO));
  const [modoId, setModoId] = useState('cambioPct');
  const [tamano, setTamano] = useState('capitalizacion');
  const [vista, setVista] = useState('mapa');
  const [sector, setSector] = useState(null);
  const [elegido, setElegido] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [medida, setMedida] = useState({ ancho: 0, ventana: 900 });
  const [tip, setTip] = useState(null);
  const [foco, setFoco] = useState(null); // cuadro con la parada de tabulación
  const raiz = useRef(null);
  const lienzo = useRef(null);
  const panel = useRef(null);
  const origen = useRef({ ficha: null, sector: null }); // selector desde el que se abrió cada panel
  const pendiente = useRef(null); // a dónde llevar el foco tras el próximo dibujo
  const modo = COLORES.find(c => c.id === modoId);
  const { ancho } = medida;

  const items = useMemo(() => data?.items || [], [data]);
  const porSimbolo = useMemo(() => new Map(items.map(i => [i.simbolo, i])), [items]);
  const visibles = useMemo(() => (sector ? items.filter(i => i.sector === sector) : items), [items, sector]);
  const sectores = useMemo(() => [...new Set(items.map(i => i.sector))].sort((a, b) => a.localeCompare(b)), [items]);
  const tope = useMemo(() => (modo.puntaje ? null : topeDe(items, modo)), [items, modo]);

  useLayoutEffect(() => {
    const el = lienzo.current;
    if (!el) return undefined;
    const medir = () => setMedida({ ancho: el.clientWidth, ventana: window.innerHeight });
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    medir();
    return () => ro.disconnect();
  }, [vista]);
  useEffect(() => { if (sector && items.length && !sectores.includes(sector)) setSector(null); }, [sector, sectores, items.length]);

  const movil = ancho > 0 && ancho < 640;
  const base = Math.max(520, Math.min(780, medida.ventana - 270));
  const alto = movil ? Math.round(ancho * (sector ? 1.6 : 2.5)) : elegido || sector ? Math.max(740, base) : base;
  // La disposición solo cambia con el conjunto de empresas, el tamaño o el sector: un precio nuevo recolorea sin mover los cuadros.
  const firma = useMemo(() => visibles.map(i => i.simbolo + i.sector + i.industria).join('|'), [visibles]);
  const visiblesRef = useRef(visibles);
  visiblesRef.current = visibles;
  const disposicion = useMemo(() => {
    if (!ancho) return { sectores: [], industrias: [], cuadros: [] };
    const conValor = visiblesRef.current.map(i => ({ simbolo: i.simbolo, sector: i.sector, industria: i.industria, valor: tamano === 'dinero' ? (i.precio || 0) * (i.volumen || 0) : i.capitalizacion || 0 }));
    return disponerMapa(conValor, ancho, alto, { maximoPorSector: movil && !sector ? MAX_MOVIL : Infinity });
  }, [firma, ancho, alto, tamano, movil, sector]);
  const focoVigente = useMemo(() => {
    const claves = new Set([...disposicion.cuadros.map(c => (c.resto ? 'r:' + c.sector : 's:' + c.simbolo)), ...disposicion.sectores.map(s => 'c:' + s.nombre)]);
    const primero = disposicion.cuadros.find(c => !c.resto);
    return claves.has(foco) ? foco : primero ? 's:' + primero.simbolo : null;
  }, [disposicion, foco]);

  // Foco tras abrir o cerrar un panel: al título del panel, o de vuelta al cuadro o fila que lo abrió.
  useEffect(() => {
    const destino = pendiente.current;
    if (!destino) return;
    pendiente.current = null;
    if (destino === 'panel') { panel.current?.querySelector('h3')?.focus({ preventScroll: true }); return; }
    (raiz.current?.querySelector(destino) || lienzo.current?.querySelector('[data-nav][tabindex="0"]') || raiz.current?.querySelector('.mapa__op[aria-pressed="true"]'))?.focus();
  }, [elegido, sector]);

  const elegir = useCallback((s, desde) => {
    origen.current.ficha = desde || null;
    pendiente.current = 'panel';
    setElegido(s);
    setTip(null);
    if (window.matchMedia('(max-width: 1179px)').matches) requestAnimationFrame(() => panel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }, []);
  const ampliar = (s, desde) => {
    if (s === sector) return;
    origen.current.sector = desde;
    pendiente.current = 'panel';
    setSector(s);
    setElegido(null);
    setTip(null);
  };
  const cerrar = () => {
    if (elegido) { pendiente.current = origen.current.ficha || '[data-nav][tabindex="0"]'; setElegido(null); }
    else if (sector) { pendiente.current = origen.current.sector || '[data-nav][tabindex="0"]'; setSector(null); }
  };

  const alPulsar = e => {
    const el = e.target.closest('[data-nav]');
    if (!el) return;
    const clave = el.dataset.nav, nombre = clave.slice(2), selector = `[data-nav="${CSS.escape(clave)}"]`;
    setFoco(clave);
    if (clave.startsWith('s:')) elegir(nombre, selector);
    else if (clave.startsWith('r:') && sector) setVista('tabla'); // ya ampliado: el resto se ve en la tabla
    else ampliar(nombre, selector);
  };
  const alMover = e => {
    const c = e.target.closest('[data-s]');
    if (!c || e.pointerType === 'touch') { setTip(null); return; }
    const r = lienzo.current.getBoundingClientRect();
    setTip({ simbolo: c.dataset.s, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const alEnfocar = e => {
    const el = e.target.closest('[data-nav]');
    if (!el) return;
    setFoco(el.dataset.nav);
    if (!el.matches(':focus-visible')) return;
    setTip(el.dataset.s ? { simbolo: el.dataset.s, x: el.offsetLeft + el.offsetWidth - 14, y: el.offsetTop } : null);
  };
  const alTeclear = e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || !e.target.closest('[data-nav]')) return;
    e.preventDefault();
    vecino(lienzo.current.querySelectorAll('[data-nav]'), e.target, e.key)?.focus();
  };
  const alEscape = e => {
    if (e.key !== 'Escape' || !(elegido || sector)) return;
    e.preventDefault();
    cerrar();
  };
  const buscar = e => {
    e.preventDefault();
    const q = busqueda.trim().toUpperCase();
    if (!q) return;
    const hallado = porSimbolo.get(q) || items.find(i => i.simbolo.startsWith(q)) || items.find(i => i.nombre.toUpperCase().includes(q));
    if (hallado) { setSector(null); elegir(hallado.simbolo, '#mapa-buscar'); setBusqueda(''); } else setBusqueda(q);
  };
  const sinResultado = busqueda.trim().length > 1 && !items.some(i => i.simbolo.startsWith(busqueda.trim().toUpperCase()) || i.nombre.toUpperCase().includes(busqueda.trim().toUpperCase()));
  const t = tip && porSimbolo.get(tip.simbolo);
  const conPanel = Boolean(elegido || sector);
  const falla = Boolean(data && (error || data.desactualizado));

  return (
    <section ref={raiz} className="inicio-sec" aria-label="Mapa del mercado" onKeyDown={alEscape}>
      <div className="inicio-sec__head mapa__head">
        <h2>{sector || 'Mapa del mercado'}</h2>
        <Hace fecha={data?.actualizadoEn} abierto={data?.abierto} falla={falla} />
      </div>
      <div className="mapa__barra">
        <div className="mapa__grupo mapa__grupo--color" role="group" aria-label="Color según">
          {COLORES.map(c => <button key={c.id} type="button" className="mapa__op" aria-pressed={c.id === modoId} onClick={() => setModoId(c.id)}>{c.label}</button>)}
        </div>
        <label className="mapa__campo"><span className="sr-only">Sector</span>
          <select value={sector || ''} onChange={e => { origen.current.sector = '.mapa__campo select'; setSector(e.target.value || null); setElegido(null); }}>
            <option value="">Todos los sectores</option>
            {sectores.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="mapa__campo"><span className="sr-only">Tamaño de los cuadros</span>
          <select value={tamano} onChange={e => setTamano(e.target.value)}>{TAMANOS.map(x => <option key={x.id} value={x.id}>Tamaño: {x.label}</option>)}</select>
        </label>
        <form className="mapa__buscar" role="search" onSubmit={buscar}>
          <label htmlFor="mapa-buscar" className="sr-only">Ubicar una empresa en el mapa</label>
          <input id="mapa-buscar" type="search" placeholder="Ubicar en el mapa" value={busqueda} onChange={e => setBusqueda(e.target.value)} aria-describedby={sinResultado ? 'mapa-sin' : undefined} />
        </form>
        <div className="mapa__grupo" role="group" aria-label="Vista">
          <button type="button" className="mapa__op" aria-pressed={vista === 'mapa'} onClick={() => setVista('mapa')}>Mapa</button>
          <button type="button" className="mapa__op" aria-pressed={vista === 'tabla'} onClick={() => setVista('tabla')}>Tabla</button>
        </div>
      </div>
      {sinResultado && <p id="mapa-sin" className="muted small">«{busqueda.trim()}» no está en el mapa. Búscala en la barra superior: ahí están todas las empresas.</p>}
      {error && !data && <ErrorMessage error={error} title="No se pudo cargar el mapa; se reintenta solo" />}

      <div className={'mapa' + (conPanel ? ' mapa--panel' : '')}>
        {vista === 'tabla' && data ? <Tabla items={visibles} modo={modo} elegido={elegido} onElegir={elegir} /> : (
          <div className="mapa__col">
            <p id="mapa-ayuda" className="sr-only">Muévete entre empresas con las flechas, Enter abre la ficha y Escape la cierra. La vista Tabla ofrece los mismos datos.</p>
            <div ref={lienzo} className="mapa__lienzo" role="group" aria-label="Empresas por sector" aria-describedby="mapa-ayuda" style={{ height: alto }}
              onClick={alPulsar} onKeyDown={alTeclear} onFocus={alEnfocar} onBlur={() => setTip(null)} onPointerMove={alMover} onPointerLeave={() => setTip(null)}>
              {loading && <div className="mapa__carga" role="status">Trayendo el mercado de Alpaca y la SEC…</div>}
              {disposicion.sectores.map(s => (
                <button key={s.nombre} type="button" className="mapa__sector" tabIndex={focoVigente === 'c:' + s.nombre ? 0 : -1} data-nav={'c:' + s.nombre} style={{ left: s.x, top: s.y, width: s.w }} title={sector ? undefined : 'Ampliar ' + s.nombre}>{s.nombre}</button>
              ))}
              {disposicion.industrias.map(g => <span key={g.nombre + g.x + g.y} className="mapa__industria" style={{ left: g.x, top: g.y, width: g.w }}>{giroEs(g.nombre)}</span>)}
              {disposicion.cuadros.map(c => {
                if (c.resto) {
                  const texto = `${c.resto} empresas más de ${c.sector}: ${sector ? 'ver en la tabla' : 'ampliar el sector'}`;
                  return <button key={'r:' + c.sector} type="button" tabIndex={focoVigente === 'r:' + c.sector ? 0 : -1} data-nav={'r:' + c.sector} className="mapa__cuadro mapa__cuadro--resto" aria-label={texto} title={texto} style={{ left: c.x, top: c.y, width: c.w - 1, height: c.h - 1 }}>+{c.resto}</button>;
                }
                const i = porSimbolo.get(c.simbolo), v = i ? valorDe(i, modo) : null;
                return <Cuadro key={c.simbolo} {...c} nombre={i?.nombre || ''} color={colorDe(v, modo, tope)} texto={textoDe(v, modo)} elegido={c.simbolo === elegido} enFoco={focoVigente === 's:' + c.simbolo} />;
              })}
              {t && (
                <div className="mapa__tip" role="presentation" style={{ left: Math.max(0, Math.min(tip.x + 14, ancho - 250)), top: tip.y > alto - 150 ? tip.y - 132 : tip.y + 14 }}>
                  <strong>{t.simbolo}</strong> <span>{t.nombre}</span>
                  <div className="mapa__tip-val">{fmtMoney(t.precio)} <span className={t.cambioPct >= 0 ? 'up' : 'down'}>{textoDe(t.cambioPct, COLORES[0])}</span></div>
                  <div className="muted small">{giroEs(t.industria)}</div>
                  <div className="muted small">Capitalización USD {fmtCompact(t.capitalizacion)}{modo.puntaje && `, ${ESTRATEGIA_LABELS[modo.id]} ${textoDe(valorDe(t, modo), modo)} de 100`}</div>
                </div>
              )}
            </div>
            <div className="mapa__pie">
              {modo.puntaje && <span className="small">{NOTA_PUNTAJE}</span>}
              <Leyenda modo={modo} tope={tope} />
              {modo.termino && <Termino id={modo.termino}>¿Qué es {modo.label}?</Termino>}
              <span className="muted small">{data ? `${data.total} empresas con opciones, por capitalización aproximada. Los cuadros +N agrupan a las demás y no están a escala. Precio en vivo de IEX; cierre y volumen consolidados.` : ''}</span>
            </div>
          </div>
        )}
        {conPanel && (
          <aside ref={panel} className="mapa__panel" aria-label={elegido ? 'Ficha de ' + elegido : 'Resumen de ' + sector}>
            {elegido
              ? <FichaEmpresa key={elegido} simbolo={elegido} vivo={porSimbolo.get(elegido)} onCerrar={cerrar} />
              : <ResumenSector sector={sector} items={visibles} modo={modo} onElegir={elegir} onCerrar={cerrar} />}
          </aside>
        )}
      </div>
    </section>
  );
}
