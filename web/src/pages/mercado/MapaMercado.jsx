// Mapa del mercado en vivo: un cuadro por empresa (tamaño = capitalización o dinero negociado; color = variación o compatibilidad).
// Al elegir una empresa se abre su ficha; al elegir un sector se amplía y se resume la selección.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mercado } from '../../api/resources';
import { useSondeo } from '../../hooks/useSondeo';
import { disponerMapa } from '../../utils/treemap';
import { ESTRATEGIA_LABELS } from '../../utils/constants';
import { ErrorMessage, Notice } from '../../components/States';
import { fmtCompact, fmtFixed, fmtMoney, fmtNum, isNum } from '../../utils/format';
import FichaEmpresa from './FichaEmpresa';
import ResumenSector from './ResumenSector';

const COLORES = [
  { id: 'cambioPct', label: 'Hoy', tope: 0.03 },
  { id: 'cambio5d', label: '1 semana', tope: 0.08 },
  { id: 'cambio21d', label: '1 mes', tope: 0.15 },
  { id: 'LONG_CALL', label: 'Long Call', puntaje: true },
  { id: 'LONG_PUT', label: 'Long Put', puntaje: true },
  { id: 'IRON_CONDOR', label: 'Iron Condor', puntaje: true },
];
const TAMANOS = [{ id: 'capitalizacion', label: 'Capitalización' }, { id: 'dinero', label: 'Dinero negociado hoy' }];
const MS_ABIERTO = 10000, MS_CERRADO = 60000, MS_ERROR = 5000;

const valorDe = (item, modo) => (modo.puntaje ? item.puntajes?.[modo.id] ?? null : item[modo.id] ?? null);
const textoDe = (v, modo) => (!isNum(v) ? '—' : modo.puntaje ? fmtNum(v, 0) : (v > 0 ? '+' : '') + fmtFixed(v * 100, 2) + '%');
function colorDe(v, modo) {
  if (!isNum(v)) return 'var(--mapa-nodata)';
  if (modo.puntaje) return `var(--mapa-p${v < 40 ? 1 : v < 60 ? 2 : v < 80 ? 3 : 4})`;
  const k = Math.round(Math.min(1, Math.abs(v) / modo.tope) * 100);
  return `color-mix(in oklab, var(${v >= 0 ? '--mapa-sube' : '--mapa-baja'}) ${k}%, var(--mapa-cero))`;
}

const Cuadro = memo(function Cuadro({ simbolo, x, y, w, h, color, texto, elegido }) {
  const fuente = Math.max(9, Math.min(34, (w - 6) / (simbolo.length * 0.68), h * 0.36));
  const conSimbolo = w > 26 && h > 14 && (w - 4) / (simbolo.length * 0.62) >= 9;
  const conTexto = conSimbolo && h > fuente * 2.35 && w > 46;
  return (
    <button type="button" tabIndex={-1} data-s={simbolo} className={'mapa__cuadro' + (elegido ? ' is-elegido' : '')} aria-label={`${simbolo} ${texto}`}
      style={{ left: x, top: y, width: Math.max(0, w - 1), height: Math.max(0, h - 1), background: color }}>
      {conSimbolo && <span className="mapa__simbolo" style={{ fontSize: fuente }}>{simbolo}</span>}
      {conTexto && <span className="mapa__valor" style={{ fontSize: Math.max(9, Math.min(15, fuente * 0.55)) }}>{texto}</span>}
    </button>
  );
});

function Leyenda({ modo }) {
  if (modo.puntaje) return <div className="mapa__leyenda mapa__leyenda--puntaje" aria-label="Escala de compatibilidad"><span>30</span><i /><span>95+</span></div>;
  const t = modo.tope * 100;
  return <div className="mapa__leyenda" aria-label="Escala de variación"><span>−{t}%</span><i /><span>+{t}%</span></div>;
}

function Hace({ fecha, abierto }) {
  const [, tic] = useState(0);
  useEffect(() => { const id = setInterval(() => tic(n => n + 1), 1000); return () => clearInterval(id); }, []);
  if (!fecha) return null;
  const s = Math.max(0, Math.round((Date.now() - new Date(fecha).getTime()) / 1000));
  return <span className="muted small mapa__hace"><span className={'dot ' + (abierto ? 'dot--ok' : 'dot--neutral')} aria-hidden="true" />{abierto ? 'En vivo' : 'Último cierre'}, actualizado hace {s < 90 ? s + ' s' : Math.round(s / 60) + ' min'}</span>;
}

function Tabla({ items, modo, elegido, onElegir }) {
  const [orden, setOrden] = useState({ campo: 'capitalizacion', asc: false });
  const filas = useMemo(() => {
    const v = i => (orden.campo === 'simbolo' ? i.simbolo : orden.campo === 'color' ? valorDe(i, modo) : i[orden.campo]);
    return [...items].sort((a, b) => {
      const x = v(a), y = v(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return orden.asc ? c : -c;
    });
  }, [items, orden, modo]);
  const Th = ({ campo, children, num }) => (
    <th scope="col" className={num ? 'num' : undefined} aria-sort={orden.campo === campo ? (orden.asc ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="mapa__th" onClick={() => setOrden(o => ({ campo, asc: o.campo === campo ? !o.asc : campo === 'simbolo' }))}>{children}{orden.campo === campo ? (orden.asc ? ' ▲' : ' ▼') : ''}</button>
    </th>
  );
  return (
    <div className="table-wrap mapa__tabla">
      <table className="table table--dense">
        <thead><tr><Th campo="simbolo">Empresa</Th><th scope="col">Sector</th><Th campo="precio" num>Precio</Th><Th campo="cambioPct" num>Hoy</Th><Th campo="capitalizacion" num>Capitalización</Th>{modo.id !== 'cambioPct' && <Th campo="color" num>{modo.label}</Th>}</tr></thead>
        <tbody>
          {filas.map(i => (
            <tr key={i.simbolo} className={i.simbolo === elegido ? 'is-elegido' : undefined}>
              <th scope="row"><button type="button" className="mapa__th" onClick={() => onElegir(i.simbolo)}><strong>{i.simbolo}</strong> <span className="muted small">{i.nombre}</span></button></th>
              <td className="muted small">{i.sector}</td>
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

export default function MapaMercado() {
  const { data, error, loading } = useSondeo(() => mercado.mapa(), d => (!d ? MS_ERROR : d.abierto ? MS_ABIERTO : MS_CERRADO));
  const [modoId, setModoId] = useState('cambioPct');
  const [tamano, setTamano] = useState('capitalizacion');
  const [vista, setVista] = useState('mapa');
  const [sector, setSector] = useState(null);
  const [elegido, setElegido] = useState(null);
  const [busqueda, setBusqueda] = useState('');
  const [ancho, setAncho] = useState(0);
  const [tip, setTip] = useState(null);
  const lienzo = useRef(null);
  const panel = useRef(null);
  const modo = COLORES.find(c => c.id === modoId);

  const items = useMemo(() => data?.items || [], [data]);
  const porSimbolo = useMemo(() => new Map(items.map(i => [i.simbolo, i])), [items]);
  const visibles = useMemo(() => (sector ? items.filter(i => i.sector === sector) : items), [items, sector]);
  const sectores = useMemo(() => [...new Set(items.map(i => i.sector))].sort((a, b) => a.localeCompare(b)), [items]);

  useEffect(() => {
    const el = lienzo.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setAncho(el.clientWidth));
    ro.observe(el);
    setAncho(el.clientWidth);
    return () => ro.disconnect();
  }, [vista, loading]);
  useEffect(() => { if (sector && items.length && !sectores.includes(sector)) setSector(null); }, [sector, sectores, items.length]);

  const alto = ancho < 640 ? Math.max(560, Math.round(ancho * 1.7)) : Math.max(elegido || sector ? 740 : 480, Math.min(760, Math.round(ancho * 0.56)));
  // La disposición solo cambia con el conjunto de empresas, el tamaño o el sector: un precio nuevo recolorea sin mover los cuadros.
  const firma = useMemo(() => visibles.map(i => i.simbolo + i.sector + i.industria).join('|'), [visibles]);
  const visiblesRef = useRef(visibles);
  visiblesRef.current = visibles;
  const disposicion = useMemo(() => {
    if (!ancho) return { sectores: [], industrias: [], cuadros: [] };
    const conValor = visiblesRef.current.map(i => ({ simbolo: i.simbolo, sector: i.sector, industria: i.industria, valor: tamano === 'dinero' ? (i.precio || 0) * (i.volumen || 0) : i.capitalizacion || 0 }));
    return disponerMapa(conValor, ancho, alto);
  }, [firma, ancho, alto, tamano]);

  const elegir = useCallback(s => {
    setElegido(s);
    setTip(null);
    if (window.matchMedia('(max-width: 1179px)').matches) requestAnimationFrame(() => panel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }, []);
  const alPulsar = e => {
    const c = e.target.closest('[data-s]');
    if (c) { elegir(c.dataset.s); return; }
    const t = e.target.closest('[data-sector]');
    if (t) { setSector(t.dataset.sector); setElegido(null); }
  };
  const alMover = e => {
    const c = e.target.closest('[data-s]');
    if (!c || e.pointerType === 'touch') { setTip(null); return; }
    const r = lienzo.current.getBoundingClientRect();
    setTip({ simbolo: c.dataset.s, x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const buscar = e => {
    e.preventDefault();
    const q = busqueda.trim().toUpperCase();
    if (!q) return;
    const hallado = porSimbolo.get(q) || items.find(i => i.simbolo.startsWith(q)) || items.find(i => i.nombre.toUpperCase().includes(q));
    if (hallado) { setSector(null); elegir(hallado.simbolo); setBusqueda(''); } else setBusqueda(q);
  };
  const sinResultado = busqueda.trim().length > 1 && !items.some(i => i.simbolo.startsWith(busqueda.trim().toUpperCase()) || i.nombre.toUpperCase().includes(busqueda.trim().toUpperCase()));
  const t = tip && porSimbolo.get(tip.simbolo);
  const conPanel = Boolean(elegido || sector);

  return (
    <section className="inicio-sec" aria-label="Mapa del mercado">
      <div className="inicio-sec__head mapa__head">
        <h2>{sector || 'Mapa del mercado'}</h2>
        <Hace fecha={data?.actualizadoEn} abierto={data?.abierto} />
      </div>
      <div className="mapa__barra">
        <div className="mapa__grupo" role="group" aria-label="Color según">
          {COLORES.map(c => <button key={c.id} type="button" className="mapa__op" aria-pressed={c.id === modoId} onClick={() => setModoId(c.id)}>{c.label}</button>)}
        </div>
        <label className="mapa__campo"><span className="sr-only">Sector</span>
          <select value={sector || ''} onChange={e => { setSector(e.target.value || null); setElegido(null); }}>
            <option value="">Todos los sectores</option>
            {sectores.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="mapa__campo"><span className="sr-only">Tamaño de los cuadros</span>
          <select value={tamano} onChange={e => setTamano(e.target.value)}>{TAMANOS.map(x => <option key={x.id} value={x.id}>Tamaño: {x.label}</option>)}</select>
        </label>
        <form className="mapa__buscar" role="search" onSubmit={buscar}>
          <label htmlFor="mapa-buscar" className="sr-only">Buscar empresa en el mapa</label>
          <input id="mapa-buscar" type="search" placeholder="Buscar empresa" value={busqueda} onChange={e => setBusqueda(e.target.value)} aria-describedby={sinResultado ? 'mapa-sin' : undefined} />
        </form>
        <div className="mapa__grupo" role="group" aria-label="Vista">
          <button type="button" className="mapa__op" aria-pressed={vista === 'mapa'} onClick={() => setVista('mapa')}>Mapa</button>
          <button type="button" className="mapa__op" aria-pressed={vista === 'tabla'} onClick={() => setVista('tabla')}>Tabla</button>
        </div>
      </div>
      {sinResultado && <p id="mapa-sin" className="muted small">«{busqueda.trim()}» no está en el mapa. Búscala en «Analizar» de la barra superior: ahí están todas las empresas.</p>}
      {data?.desactualizado && <Notice tone="warning">El proveedor no respondió; se muestran los últimos valores conocidos.</Notice>}
      {error && !data && <ErrorMessage error={error} title="No se pudo cargar el mapa; se reintenta solo" />}

      <div className={'mapa' + (conPanel ? ' mapa--panel' : '')}>
        {vista === 'tabla' && data ? <Tabla items={visibles} modo={modo} elegido={elegido} onElegir={elegir} /> : (
          <div className="mapa__col">
            <div ref={lienzo} className="mapa__lienzo" style={{ height: alto }} onClick={alPulsar} onPointerMove={alMover} onPointerLeave={() => setTip(null)}>
              {loading && <div className="mapa__carga" role="status">Trayendo el mercado de Alpaca y la SEC…</div>}
              {disposicion.sectores.map(s => (
                <button key={s.nombre} type="button" className="mapa__sector" data-sector={s.nombre} style={{ left: s.x, top: s.y, width: s.w }} title={sector ? undefined : 'Ampliar ' + s.nombre}>{s.nombre}</button>
              ))}
              {disposicion.industrias.map(g => <span key={g.nombre + g.x + g.y} className="mapa__industria" style={{ left: g.x, top: g.y, width: g.w }}>{g.nombre}</span>)}
              {disposicion.cuadros.map(c => {
                const i = porSimbolo.get(c.simbolo), v = i ? valorDe(i, modo) : null;
                return <Cuadro key={c.simbolo} {...c} color={colorDe(v, modo)} texto={textoDe(v, modo)} elegido={c.simbolo === elegido} />;
              })}
              {t && (
                <div className="mapa__tip" role="presentation" style={{ left: Math.min(tip.x + 14, Math.max(0, ancho - 250)), top: tip.y > alto - 150 ? tip.y - 132 : tip.y + 14 }}>
                  <strong>{t.simbolo}</strong> <span>{t.nombre}</span>
                  <div className="mapa__tip-val">{fmtMoney(t.precio)} <span className={t.cambioPct >= 0 ? 'up' : 'down'}>{textoDe(t.cambioPct, COLORES[0])}</span></div>
                  <div className="muted small">{t.industria}</div>
                  <div className="muted small">Capitalización {fmtCompact(t.capitalizacion)}{modo.puntaje && `, ${ESTRATEGIA_LABELS[modo.id]} ${textoDe(valorDe(t, modo), modo)}/100`}</div>
                </div>
              )}
            </div>
            <div className="mapa__pie">
              <Leyenda modo={modo} />
              <span className="muted small">{data ? `${data.total} empresas con opciones, por capitalización aproximada. Precio en vivo de IEX; cierre y volumen consolidados.` : ''}</span>
            </div>
          </div>
        )}
        {conPanel && (
          <aside ref={panel} className="mapa__panel" aria-label={elegido ? 'Ficha de ' + elegido : 'Resumen de ' + sector}>
            {elegido
              ? <FichaEmpresa key={elegido} simbolo={elegido} vivo={porSimbolo.get(elegido)} onCerrar={() => setElegido(null)} />
              : <ResumenSector sector={sector} items={visibles} modo={modo} onElegir={elegir} onCerrar={() => setSector(null)} />}
          </aside>
        )}
      </div>
      <p className="sr-only">La vista Tabla ofrece los mismos datos para usar con teclado.</p>
    </section>
  );
}
