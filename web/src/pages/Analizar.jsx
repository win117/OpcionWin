// Espacio de trabajo «Buscar y analizar»: búsqueda a la izquierda, datos + configuración a la derecha.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ErrorMessage, Loading } from '../components/States';
import { useAsync } from '../hooks/useAsync';
import { empresas } from '../api/resources';
import Buscador from './analizar/Buscador';
import DetalleEmpresa from './analizar/DetalleEmpresa';
import ConfigAnalisis, { useCatalogo } from './analizar/ConfigAnalisis';
import Inicio from './analizar/Inicio';
import Progreso from './analizar/Progreso';
import { ejecutarFlujo, guardarConfig, leerConfig, pasosDatos, pasosIniciales, resolverConfig, sincronizarDatos } from './analizar/flujo';
import { DISCLAIMER } from '../utils/constants';

export default function Analizar() {
  const { simbolo: param } = useParams();
  const simbolo = (param || '').toUpperCase();
  const navigate = useNavigate();
  const location = useLocation();
  const [search] = useSearchParams();
  const q = search.get('q') || '';
  const [config, setConfig] = useState(leerConfig);
  const { catalogo } = useCatalogo();
  const [tab, setTab] = useState('grafico');
  const [pasos, setPasos] = useState(null);
  const [pasosSync, setPasosSync] = useState(null);
  const [error, setError] = useState(null);
  const [corriendo, setCorriendo] = useState(false);
  const [version, setVersion] = useState(0);
  const activo = useRef(simbolo);     // símbolo vigente: las tareas de otro símbolo se ignoran
  const lanzados = useRef(new Set()); // símbolos con sincronización automática ya lanzada
  const detalle = useRef(null);

  activo.current = simbolo;
  useEffect(() => { guardarConfig(config); }, [config]);
  useEffect(() => {
    setPasos(null); setPasosSync(null); setError(null); setCorriendo(false); setTab('grafico');
    if (simbolo && window.matchMedia('(max-width: 959px)').matches) detalle.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [simbolo]);
  useEffect(() => () => { activo.current = null; }, []);

  const registro = useAsync(async () => (simbolo ? (await empresas.list({ simbolo, limit: 1 })).items[0] || null : undefined), [simbolo, version], { enabled: !!simbolo });
  const empresa = registro.data;

  const vigente = sym => activo.current === sym;

  const traerDatos = useCallback(async sym => {
    setError(null); setCorriendo(true);
    setPasosSync(pasosDatos(false));
    const set = p => { if (vigente(sym)) setPasosSync(p); };
    try { await sincronizarDatos(sym, { institucional: false }, set, () => !vigente(sym)); }
    catch (e) { if (vigente(sym)) setError(e); }
    finally { if (vigente(sym)) { setCorriendo(false); setVersion(v => v + 1); } }
  }, []);

  // Empresa sin registrar: sincroniza automáticamente, una sola vez por símbolo.
  useEffect(() => {
    if (!simbolo || registro.loading || registro.data !== null || lanzados.current.has(simbolo)) return;
    lanzados.current.add(simbolo);
    traerDatos(simbolo);
  }, [simbolo, registro.loading, registro.data, traerDatos]);

  const analizar = useCallback(async (sym, cfg, cat) => {
    const r = resolverConfig(cfg, cat);
    setError(null); setCorriendo(true);
    const set = p => { if (vigente(sym)) setPasos(p); };
    setPasos(pasosIniciales({ sincronizar: cfg.sincronizar, institucional: cfg.institucional, cores: r.cores }));
    try {
      await ejecutarFlujo(sym, { sincronizar: cfg.sincronizar, institucional: cfg.institucional, ...r }, set, () => !vigente(sym));
      if (vigente(sym)) setTab('analisis');
    } catch (e) { if (vigente(sym)) setError(e); }
    finally { if (vigente(sym)) { setCorriendo(false); setVersion(v => v + 1); } }
  }, []);

  const seleccionar = s => navigate({ pathname: '/analizar/' + encodeURIComponent(s), search: location.search });

  return (
    <>
      <PageHeader title="Buscar y analizar" subtitle="Busca una empresa → haz clic para ver sus datos → elige cores y métricas → pulsa Analizar." />
      <div className="workspace">
        <aside className="workspace__side">
          <Buscador seleccionado={simbolo} version={version} inicial={q} onSelect={seleccionar} />
        </aside>
        <div className="workspace__main stack" ref={detalle}>
          {error && <ErrorMessage error={error} title="La operación no pudo completarse" />}
          {!simbolo && <Inicio />}
          {simbolo && registro.loading && !registro.data && empresa === undefined && <Loading text={'Cargando ' + simbolo + '…'} />}
          {simbolo && registro.error && empresa === undefined && <ErrorMessage error={registro.error} onRetry={registro.reload} />}
          {simbolo && empresa === null && (
            <>
              <section className="card">
                <h2 className="ticker">{simbolo}</h2>
                <p className="muted small">Empresa nueva: se están trayendo sus datos reales (empresa, velas, cotización, noticias, fundamentales y contratos).</p>
              </section>
              {pasosSync && <Progreso pasos={pasosSync} titulo="Trayendo datos" />}
              {!corriendo && error && <div><button type="button" className="btn btn--primary" onClick={() => traerDatos(simbolo)}>Reintentar</button></div>}
            </>
          )}
          {simbolo && empresa && (
            <>
              <DetalleEmpresa
                empresa={empresa} simbolo={simbolo} version={version} tab={tab} onTab={setTab} corriendo={corriendo}
                pasosDatos={pasosSync} onActualizar={() => traerDatos(simbolo)}
              />
              <ConfigAnalisis config={config} onChange={setConfig} catalogo={catalogo} corriendo={corriendo} onAnalizar={() => analizar(simbolo, config, catalogo)} />
              {pasos && <Progreso pasos={pasos} />}
            </>
          )}
          <p className="disclaimer">{DISCLAIMER}</p>
        </div>
      </div>
    </>
  );
}
