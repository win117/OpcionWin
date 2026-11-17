// Espacio de trabajo maestro–detalle: búsqueda a la izquierda, detalle + configuración a la derecha.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Empty, ErrorMessage } from '../components/States';
import Buscador from './analizar/Buscador';
import DetalleEmpresa from './analizar/DetalleEmpresa';
import ConfigAnalisis, { useCatalogo } from './analizar/ConfigAnalisis';
import Progreso from './analizar/Progreso';
import { ejecutarFlujo, guardarConfig, leerConfig, pasosDatos, pasosIniciales, resolverConfig, sincronizarDatos } from './analizar/flujo';
import { DISCLAIMER } from '../utils/constants';

export default function Analizar() {
  const { simbolo: param } = useParams();
  const simbolo = (param || '').toUpperCase();
  const navigate = useNavigate();
  const location = useLocation();
  const [config, setConfig] = useState(leerConfig);
  const { catalogo } = useCatalogo();
  const [tab, setTab] = useState('grafico');
  const [pasos, setPasos] = useState(null);
  const [pasosSync, setPasosSync] = useState(null);
  const [error, setError] = useState(null);
  const [corriendo, setCorriendo] = useState(false);
  const [version, setVersion] = useState(0);
  const cancel = useRef(false);
  const ejecutarRef = useRef(null);

  useEffect(() => { guardarConfig(config); }, [config]);
  useEffect(() => { setPasos(null); setPasosSync(null); setError(null); setTab('grafico'); }, [simbolo]);
  useEffect(() => () => { cancel.current = true; }, []);

  const analizar = useCallback(async (sym, cfg, cat) => {
    cancel.current = false;
    const r = resolverConfig(cfg, cat);
    setError(null); setCorriendo(true);
    setPasos(pasosIniciales({ sincronizar: cfg.sincronizar, institucional: cfg.institucional, cores: r.cores }));
    try {
      await ejecutarFlujo(sym, { sincronizar: cfg.sincronizar, institucional: cfg.institucional, ...r }, setPasos, () => cancel.current);
      if (!cancel.current) setTab('analisis');
    } catch (e) { if (!cancel.current) setError(e); }
    finally { if (!cancel.current) { setCorriendo(false); setVersion(v => v + 1); } }
  }, []);
  ejecutarRef.current = () => analizar(simbolo, config, catalogo);

  const traerDatos = useCallback(async () => {
    cancel.current = false;
    setError(null); setCorriendo(true);
    setPasosSync(pasosDatos(false));
    try { await sincronizarDatos(simbolo, { institucional: false }, setPasosSync, () => cancel.current); }
    catch (e) { if (!cancel.current) setError(e); }
    finally { if (!cancel.current) { setCorriendo(false); setVersion(v => v + 1); } }
  }, [simbolo]);

  // Llegada desde el Panel con state.ejecutar: corre el flujo con la configuración guardada.
  useEffect(() => {
    if (simbolo && location.state?.ejecutar) {
      navigate(location.pathname, { replace: true, state: null });
      analizar(simbolo, { ...config, institucional: location.state.institucional ?? config.institucional }, catalogo);
    }
  }, [simbolo]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title={simbolo ? 'Análisis · ' + simbolo : 'Analizar'} subtitle="Busca una empresa, revisa sus datos y analízala con los cores que elijas" />
      <div className="workspace">
        <aside className="workspace__side">
          <Buscador seleccionado={simbolo} version={version} onSelect={s => navigate('/analizar/' + encodeURIComponent(s))} />
        </aside>
        <div className="workspace__main stack">
          {error && <ErrorMessage error={error} title="La operación no pudo completarse" />}
          {!simbolo && <Empty title="Selecciona una empresa">Busca un símbolo a la izquierda para ver su gráfico, opciones y griegas, y configurar el análisis.</Empty>}
          {simbolo && (
            <>
              <DetalleEmpresa
                simbolo={simbolo} version={version} tab={tab} onTab={setTab} corriendo={corriendo}
                pasosDatos={pasosSync} onTraerDatos={traerDatos}
              />
              <ConfigAnalisis config={config} onChange={setConfig} catalogo={catalogo} corriendo={corriendo} onAnalizar={() => ejecutarRef.current()} />
              {pasos && <Progreso pasos={pasos} />}
            </>
          )}
          <p className="disclaimer">{DISCLAIMER}</p>
        </div>
      </div>
    </>
  );
}
