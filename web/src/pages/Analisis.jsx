// Análisis de una empresa: cabecera con precio y acciones; debajo, el veredicto con los contratos para operar y la evidencia en pestañas.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ErrorMessage } from '../components/States';
import { Termino } from '../components/Termino';
import { useAsync } from '../hooks/useAsync';
import { useSondeo } from '../hooks/useSondeo';
import { useVelas } from '../hooks/useVelas';
import { activos, empresas, mercado } from '../api/resources';
import Buscador from './analizar/Buscador';
import { DetalleEmpresa } from './analizar/DetalleEmpresa';
import ConfigAnalisis, { useCatalogo } from './analizar/ConfigAnalisis';
import Evidencia from './analizar/Evidencia';
import PanelEstrategias from './analizar/PanelEstrategias';
import { usePosicion } from './analizar/usePosicion';
import { cargarDatosAnalisis } from '../components/BotonOperar';
import { CORE_LABELS, DISCLAIMER } from '../utils/constants';
import { isNum } from '../utils/format';
import { errorRangoDias, ejecutarFlujo, guardarConfig, leerConfig, pasosDatos, pasosIniciales, recursosNecesarios, resolverConfig, sincronizarDatos } from './analizar/flujo';

// Una vela diaria se fecha a las 00:00 de Nueva York: pasadas 30 h ya existe una más reciente (salvo fin de semana).
const HORAS_VIGENCIA = 30;
const ANCHO_DOS_COLUMNAS = '(min-width: 1180px)';
const FUERA = { fuera: true }; // la empresa no está en el universo del mapa

/** Ficha en vivo del universo; null mientras llega o si la empresa no está en él. */
function useFicha(simbolo) {
  const { data, loading } = useSondeo(
    () => (simbolo ? mercado.ficha(simbolo).catch(e => { if (e.status === 404 || e.status === 400) return FUERA; throw e; }) : FUERA),
    d => (!d ? 5000 : d.fuera ? 600000 : d.abierto ? 30000 : 120000), simbolo);
  return { ficha: data && !data.fuera ? data : null, cargando: loading };
}

const velasDeFicha = ficha => (ficha?.velas || [])
  .filter(v => [v.apertura, v.maximo, v.minimo, v.cierre].every(isNum) && Number.isFinite(Date.parse(v.fecha)))
  .map(v => ({ time: Math.floor(Date.parse(v.fecha) / 1000), open: v.apertura, high: v.maximo, low: v.minimo, close: v.cierre, volume: v.volumen || 0 }));

/** El símbolo no existe en el proveedor: se dice claro y se ofrece qué hacer. */
function Desconocido({ simbolo, parecidos, onReintentar }) {
  return (
    <section className="card desconocido">
      <h1>No encontramos «{simbolo}»</h1>
      <p>Comprueba que esté bien escrito. Solo se pueden analizar acciones y fondos que cotizan en Estados Unidos.</p>
      {parecidos.length > 0 && (
        <>
          <p className="muted small">¿Buscabas alguno de estos?</p>
          <ul className="desconocido__lista">{parecidos.map(a => <li key={a.simbolo}><Link to={'/analisis/' + encodeURIComponent(a.simbolo)}><strong>{a.simbolo}</strong> {a.nombre}</Link></li>)}</ul>
        </>
      )}
      <div className="row-actions"><Link className="btn btn--primary" to="/analisis">Buscar otra empresa</Link><button type="button" className="btn" onClick={onReintentar}>Reintentar</button></div>
    </section>
  );
}

export default function Analisis() {
  const { simbolo: param } = useParams();
  const simbolo = (param || '').toUpperCase();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const estrategiaInicial = search.get('estrategia') || undefined;
  const [config, setConfig] = useState(leerConfig);
  const { catalogo } = useCatalogo();
  const [proceso, setProceso] = useState(null); // único trabajo en marcha o el último: { tipo, titulo, pasos }
  const [error, setError] = useState(null);
  const [parecidos, setParecidos] = useState(null); // símbolo desconocido: sugerencias
  const [corriendo, setCorriendo] = useState(false);
  const [version, setVersion] = useState(0);
  const [cfgAbierta, setCfgAbierta] = useState(false);
  const [tab, setTab] = useState('grafica');
  const activo = useRef(simbolo);     // símbolo vigente: las tareas de otro símbolo se ignoran
  const lanzados = useRef(new Set()); // símbolos con sincronización automática ya lanzada
  const enfocar = useRef(null);       // al terminar el análisis, el foco va al veredicto: { previo: datos de antes }
  const datosRef = useRef(null);
  const configRef = useRef(config);
  const catalogoRef = useRef(catalogo);

  activo.current = simbolo;
  configRef.current = config;
  catalogoRef.current = catalogo;
  useEffect(() => { guardarConfig(config); }, [config]);
  useEffect(() => {
    setProceso(null); setError(null); setParecidos(null); setCorriendo(false); setTab('grafica');
    enfocar.current = null;
  }, [simbolo]);
  useEffect(() => () => { activo.current = null; }, []);

  const { ficha } = useFicha(simbolo);
  const registro = useAsync(async () => ({ simbolo, empresa: simbolo ? (await empresas.list({ simbolo, limit: 1 })).items[0] || null : undefined }), [simbolo, version], { enabled: !!simbolo });
  const resuelta = registro.data?.simbolo === simbolo;
  const empresa = resuelta ? registro.data.empresa : undefined; // undefined = cargando, null = sin registrar
  const guardadas = useVelas(empresa ? simbolo : '', version);
  const propias = guardadas.simbolo === simbolo ? guardadas.diarias : [];
  const enVivo = useMemo(() => velasDeFicha(ficha), [ficha?.velas]); // eslint-disable-line react-hooks/exhaustive-deps
  const velas = propias.length ? { ...guardadas, diarias: propias } : { ...guardadas, diarias: ficha?.simbolo === simbolo ? enVivo : [], loading: guardadas.loading || empresa === undefined || (empresa === null && !ficha && corriendo) };
  const datos = useAsync(async () => ({ simbolo, ...await cargarDatosAnalisis(empresa) }), [empresa?._id, version], { enabled: !!empresa });
  const misDatos = datos.data?.simbolo === simbolo ? datos.data : undefined;
  datosRef.current = misDatos;
  const pos = usePosicion({ simbolo, datos: misDatos, config, version, estrategiaInicial });
  const { irAMejor } = pos;

  const vigente = sym => activo.current === sym;
  const resuelto = useMemo(() => resolverConfig(config, catalogo), [config, catalogo]);

  const terminar = sym => { if (vigente(sym)) { setCorriendo(false); setVersion(v => v + 1); } };
  // Cambia los pasos del trabajo en marcha (acepta un valor o una función, como setState).
  const ponerPasos = sym => p => { if (vigente(sym)) setProceso(x => ({ ...x, pasos: typeof p === 'function' ? p(x.pasos) : p })); };
  const fallar = async (sym, e) => {
    if (!vigente(sym)) return;
    // ¿El símbolo no existe o solo falló la descarga? El buscador del proveedor lo aclara.
    const r = await activos.buscar(sym, 10).catch(() => null);
    if (!vigente(sym)) return;
    if (r && !(r.items || []).some(i => i.simbolo === sym)) setParecidos((r.items || []).slice(0, 5));
    else setError(e);
  };

  // Actualizar datos / empresa nueva: registra la empresa y trae velas + cotización (para la gráfica) y lo que piden los factores activos.
  const traerDatos = useCallback(async (sym, nueva = false) => {
    const cfg = configRef.current;
    const r = resolverConfig(cfg, catalogoRef.current);
    const recursos = recursosNecesarios(r.cores, catalogoRef.current, { institucional: cfg.institucional, contratos: cfg.contratos, base: true });
    setError(null); setParecidos(null); setCorriendo(true);
    setProceso({ tipo: 'datos', titulo: nueva ? 'Trayendo datos' : 'Actualizando datos', pasos: pasosDatos(recursos) });
    try { await sincronizarDatos(sym, { recursos, diasMin: cfg.diasMin, diasMax: cfg.diasMax }, ponerPasos(sym), () => !vigente(sym)); }
    catch (e) { await fallar(sym, e); }
    finally { terminar(sym); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!simbolo || empresa !== null || lanzados.current.has(simbolo)) return;
    lanzados.current.add(simbolo);
    traerDatos(simbolo, true);
  }, [simbolo, empresa, traerDatos]);

  // Empresa ya registrada con datos de otro día: se actualizan solos, una vez por visita.
  useEffect(() => {
    if (!simbolo || !empresa || !guardadas.cargado || guardadas.simbolo !== simbolo || lanzados.current.has(simbolo)) return;
    lanzados.current.add(simbolo);
    const ultima = guardadas.diarias.at(-1)?.time;
    if (!ultima || Date.now() / 1000 - ultima > HORAS_VIGENCIA * 3600) traerDatos(simbolo);
  }, [simbolo, empresa, guardadas.cargado, guardadas.simbolo, guardadas.diarias, traerDatos]);

  const analizar = useCallback(async () => {
    const sym = activo.current;
    const cfg = configRef.current;
    const r = resolverConfig(cfg, catalogoRef.current);
    setError(null); setCorriendo(true);
    setProceso({ tipo: 'analisis', titulo: 'Análisis', pasos: pasosIniciales({ sincronizar: cfg.sincronizar, recursos: r.recursos, cores: r.cores }) });
    try {
      const fin = await ejecutarFlujo(sym, { sincronizar: cfg.sincronizar, diasMin: cfg.diasMin, diasMax: cfg.diasMax, ...r }, ponerPasos(sym), () => !vigente(sym));
      if (vigente(sym)) {
        setCfgAbierta(false);
        if (fin?.estado === 'completada') { enfocar.current = { previo: datosRef.current }; irAMejor(); }
      }
    } catch (e) { if (vigente(sym)) setError(e); }
    finally { terminar(sym); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Al terminar, el veredicto queda a la vista y con el foco (para teclado y lectores de pantalla).
  useEffect(() => {
    if (!enfocar.current || !misDatos?.seleccion || misDatos === enfocar.current.previo) return;
    enfocar.current = null;
    const h = document.getElementById('veredicto-titulo');
    if (!h) return;
    const dosColumnas = window.matchMedia(ANCHO_DOS_COLUMNAS).matches;
    h.closest('.panel')?.scrollTo?.(0, 0);
    (dosColumnas ? h : h.closest('section')).scrollIntoView({ block: dosColumnas ? 'nearest' : 'start' });
    h.focus({ preventScroll: true });
  }, [misDatos]);

  const compararStrikes = () => {
    setTab('cadena');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const h = document.getElementById('comparar-titulo');
      h?.scrollIntoView({ block: 'start' });
      h?.focus({ preventScroll: true });
    }));
  };

  const hayCores = resuelto.cores.length > 0;
  const errDias = errorRangoDias(config);

  if (!simbolo) {
    return (
      <>
        <PageHeader title="Análisis" subtitle="Busca una empresa para ver si alguna estrategia de opciones encaja con ella, y por qué." />
        <Buscador seleccionado="" version={0} onSelect={s => navigate('/analisis/' + encodeURIComponent(s))} />
        <p className="disclaimer">{DISCLAIMER}</p>
      </>
    );
  }

  if (parecidos && !empresa && !corriendo) return <div className="analisis analisis--vacio"><Desconocido simbolo={simbolo} parecidos={parecidos} onReintentar={() => traerDatos(simbolo, true)} /></div>;

  // Hasta saber si hay análisis guardado no se dibuja lo que va debajo: así nada cambia de sitio.
  const listo = empresa === null || Boolean(misDatos) || Boolean(datos.error) || Boolean(registro.error);
  const acciones = (
    <>
      <button type="button" className="btn btn--primary" onClick={analizar} disabled={!empresa || corriendo || !hayCores || Boolean(errDias)}>{corriendo && proceso?.tipo === 'analisis' ? 'Analizando…' : 'Analizar'}</button>
      <button type="button" className="btn" aria-expanded={cfgAbierta} aria-controls="cfg-detalle" onClick={() => setCfgAbierta(a => !a)}>{cfgAbierta ? 'Ocultar configuración' : 'Configurar'}</button>
      <button type="button" className="btn" onClick={() => traerDatos(simbolo)} disabled={corriendo || empresa === undefined}>{empresa === null ? 'Traer datos' : 'Actualizar datos'}</button>
    </>
  );

  return (
    <div className="analisis">
      <DetalleEmpresa key={simbolo} empresa={empresa} simbolo={simbolo} velas={velas.diarias} ficha={ficha} version={version} corriendo={corriendo} proceso={proceso} acciones={acciones} />
      {error && <ErrorMessage error={error} title="No se pudo completar" />}
      {registro.error && !resuelta && <ErrorMessage error={registro.error} onRetry={registro.reload} title={'No se pudo cargar ' + simbolo} />}
      {(!hayCores || errDias) && <p className="field__error" role="alert">{errDias ? errDias + ' Corrígelo en «Configurar».' : 'Elige en «Configurar» al menos un factor con peso mayor que 0.'}</p>}
      <section id="cfg-detalle" className="card" hidden={!cfgAbierta} aria-label="Configuración del análisis">
        <p className="muted small">Se usan {resuelto.cores.length} <Termino id="core">factores</Termino>: {resuelto.cores.map(c => CORE_LABELS[c]).join(', ') || 'ninguno'}.</p>
        <ConfigAnalisis embebido config={config} onChange={setConfig} catalogo={catalogo} corriendo={corriendo} onAnalizar={analizar} />
      </section>
      <div className="analisis__cols">
        <aside className="panel" aria-label="Veredicto y contratos">
          <PanelEstrategias empresa={empresa} datos={misDatos} cargando={!listo} error={datos.error} onReload={datos.reload} pos={pos} config={config} trabajo={corriendo ? proceso?.tipo : null} onComparar={compararStrikes} />
        </aside>
        {listo && <Evidencia tab={tab} onTab={setTab} empresa={empresa} simbolo={simbolo} velas={velas} datos={misDatos} pos={pos} config={config} coresActivos={resuelto.cores} version={version} onCambio={() => setVersion(v => v + 1)} />}
      </div>
      <p className="disclaimer">{DISCLAIMER}</p>
    </div>
  );
}
