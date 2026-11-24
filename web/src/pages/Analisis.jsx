// Análisis de una empresa: cabecera → configuración de cores (plegable) → Analizar → gráfica técnica, confluencia,
// indicadores y estrategias sugeridas con contratos y botón para operar con el broker elegido.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ErrorMessage, Loading } from '../components/States';
import { useAsync } from '../hooks/useAsync';
import { useVelas } from '../hooks/useVelas';
import { empresas } from '../api/resources';
import Buscador from './analizar/Buscador';
import { DetalleEmpresa, DatosEmpresa } from './analizar/DetalleEmpresa';
import ConfigAnalisis, { useCatalogo } from './analizar/ConfigAnalisis';
import AnalisisTecnico from './analizar/AnalisisTecnico';
import PanelEstrategias from './analizar/PanelEstrategias';
import LecturaCores from './analizar/LecturaCores';
import Progreso from './analizar/Progreso';
import { cargarDatosAnalisis } from '../components/BotonOperar';
import { DISCLAIMER } from '../utils/constants';
import { errorRangoDias, ejecutarFlujo, guardarConfig, leerConfig, pasosDatos, pasosIniciales, recursosNecesarios, resolverConfig, sincronizarDatos } from './analizar/flujo';

export default function Analisis() {
  const { simbolo: param } = useParams();
  const simbolo = (param || '').toUpperCase();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const estrategiaInicial = search.get('estrategia') || undefined;
  const [config, setConfig] = useState(leerConfig);
  const { catalogo } = useCatalogo();
  const [pasos, setPasos] = useState(null);
  const [pasosSync, setPasosSync] = useState(null);
  const [error, setError] = useState(null);
  const [corriendo, setCorriendo] = useState(false);
  const [version, setVersion] = useState(0);
  const [cfgAbierta, setCfgAbierta] = useState(false);
  const activo = useRef(simbolo);     // símbolo vigente: las tareas de otro símbolo se ignoran
  const lanzados = useRef(new Set()); // símbolos con sincronización automática ya lanzada
  const configRef = useRef(config);
  const catalogoRef = useRef(catalogo);

  activo.current = simbolo;
  configRef.current = config;
  catalogoRef.current = catalogo;
  useEffect(() => { guardarConfig(config); }, [config]);
  useEffect(() => {
    setPasos(null); setPasosSync(null); setError(null); setCorriendo(false);
  }, [simbolo]);
  useEffect(() => () => { activo.current = null; }, []);

  const registro = useAsync(async () => (simbolo ? (await empresas.list({ simbolo, limit: 1 })).items[0] || null : undefined), [simbolo, version], { enabled: !!simbolo });
  const empresa = registro.data;
  const velas = useVelas(empresa ? simbolo : '', version);
  const datos = useAsync(() => cargarDatosAnalisis(empresa), [empresa?._id, version], { enabled: !!empresa });

  const vigente = sym => activo.current === sym;
  const resuelto = useMemo(() => resolverConfig(config, catalogo), [config, catalogo]);

  // Actualizar datos / empresa nueva: registra la empresa y trae velas + cotización (para la gráfica) y lo que piden los cores activos.
  const traerDatos = useCallback(async sym => {
    const cfg = configRef.current;
    const r = resolverConfig(cfg, catalogoRef.current);
    const recursos = recursosNecesarios(r.cores, catalogoRef.current, { institucional: cfg.institucional, contratos: cfg.contratos, base: true });
    setError(null); setCorriendo(true);
    setPasosSync(pasosDatos(recursos));
    const set = p => { if (vigente(sym)) setPasosSync(p); };
    try { await sincronizarDatos(sym, { recursos, diasMin: cfg.diasMin, diasMax: cfg.diasMax }, set, () => !vigente(sym)); }
    catch (e) { if (vigente(sym)) setError(e); }
    finally { if (vigente(sym)) { setCorriendo(false); setVersion(v => v + 1); } }
  }, []);

  useEffect(() => {
    if (!simbolo || registro.loading || registro.data !== null || lanzados.current.has(simbolo)) return;
    lanzados.current.add(simbolo);
    traerDatos(simbolo);
  }, [simbolo, registro.loading, registro.data, traerDatos]);

  const analizar = useCallback(async () => {
    const sym = activo.current;
    const cfg = configRef.current;
    const r = resolverConfig(cfg, catalogoRef.current);
    setError(null); setCorriendo(true);
    const set = p => { if (vigente(sym)) setPasos(p); };
    setPasos(pasosIniciales({ sincronizar: cfg.sincronizar, recursos: r.recursos, cores: r.cores }));
    try {
      await ejecutarFlujo(sym, { sincronizar: cfg.sincronizar, diasMin: cfg.diasMin, diasMax: cfg.diasMax, ...r }, set, () => !vigente(sym));
      if (vigente(sym)) setCfgAbierta(false);
    } catch (e) { if (vigente(sym)) setError(e); }
    finally { if (vigente(sym)) { setCorriendo(false); setVersion(v => v + 1); } }
  }, []);

  const hayCores = resuelto.cores.length > 0;
  const resumenCfg = `${resuelto.cores.length} ${resuelto.cores.length === 1 ? 'core' : 'cores'}: ${resuelto.cores.join(', ') || 'ninguno'}`;

  if (!simbolo) {
    return (
      <>
        <PageHeader title="Análisis" subtitle="Busca una empresa para ver su gráfica técnica, indicadores y las estrategias sugeridas." />
        <Buscador seleccionado="" version={0} onSelect={s => navigate('/analisis/' + encodeURIComponent(s))} />
        <p className="disclaimer">{DISCLAIMER}</p>
      </>
    );
  }

  return (
    <div className="stack">
      {error && <ErrorMessage error={error} title="La operación no pudo completarse" />}
      {registro.loading && registro.data === undefined && <Loading text={'Cargando ' + simbolo + '…'} />}
      {registro.error && registro.data === undefined && <ErrorMessage error={registro.error} onRetry={registro.reload} />}
      {empresa === null && (
        <>
          <PageHeader title={simbolo} subtitle="Empresa nueva: se están trayendo sus datos reales." />
          {pasosSync && <Progreso pasos={pasosSync} titulo="Trayendo datos" />}
          {!corriendo && error && <div><button type="button" className="btn btn--primary" onClick={() => traerDatos(simbolo)}>Reintentar</button></div>}
        </>
      )}
      {empresa && (
        <>
          <DetalleEmpresa empresa={empresa} simbolo={simbolo} velas={velas.diarias} version={version} corriendo={corriendo} pasosDatos={pasosSync} onActualizar={() => traerDatos(simbolo)} />

          <section className="card cfg-bar" aria-label="Configuración y ejecución del análisis">
            <div className="cfg-bar__head">
              <div>
                <h2>Análisis</h2>
                <p className="muted small" aria-live="polite">{resumenCfg}</p>
              </div>
              <div className="cfg-bar__acciones">
                <button type="button" className="btn" aria-expanded={cfgAbierta} aria-controls="cfg-detalle" onClick={() => setCfgAbierta(a => !a)}>{cfgAbierta ? 'Ocultar configuración' : 'Configurar cores'}</button>
                <button type="button" className="btn btn--primary btn--lg" onClick={analizar} disabled={corriendo || !hayCores || Boolean(errorRangoDias(config))}>{corriendo ? 'Analizando…' : 'Analizar'}</button>
              </div>
            </div>
            {!hayCores && <p className="muted small">Selecciona al menos un core con peso mayor que 0.</p>}
            {errorRangoDias(config) && <p className="field__error" role="alert">{errorRangoDias(config)} Corrígelo en «Configurar cores».</p>}
            <div id="cfg-detalle" hidden={!cfgAbierta}>
              <ConfigAnalisis embebido config={config} onChange={setConfig} catalogo={catalogo} corriendo={corriendo} onAnalizar={analizar} />
            </div>
          </section>
          {pasos && <Progreso pasos={pasos} />}

          <AnalisisTecnico simbolo={simbolo} velas={velas} coresActivos={resuelto.cores} evalIndicadores={datos.data?.evaluaciones?.indicadores} onCambio={() => setVersion(v => v + 1)} />
          {datos.data && <LecturaCores evaluaciones={datos.data.evaluaciones} coresActivos={resuelto.cores} />}
          <PanelEstrategias empresa={empresa} simbolo={simbolo} datos={datos.data} cargando={datos.loading} error={datos.error} onReload={datos.reload} config={config} version={version} estrategiaInicial={estrategiaInicial} />
          <DatosEmpresa empresa={empresa} simbolo={simbolo} />
        </>
      )}
      <p className="disclaimer">{DISCLAIMER}</p>
    </div>
  );
}
