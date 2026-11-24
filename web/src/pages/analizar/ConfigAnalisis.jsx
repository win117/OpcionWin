// «Configurar análisis»: cores, pesos, señales (catálogo) y opciones de sincronización.
import { useState } from 'react';
import { Termino } from '../../components/Termino';
import { useAsync } from '../../hooks/useAsync';
import { cores as coresApi } from '../../api/resources';
import { errorRangoDias, resolverConfig } from './flujo';
import { CORES, CORE_LABELS, CORE_DESCRIPCION, RECURSO_LABELS } from '../../utils/constants';

/** Catálogo de señales; si falla, devuelve null y la UI oculta la selección de señales. */
export function useCatalogo() {
  const s = useAsync(async () => {
    try { return (await coresApi.catalogo())?.items || null; } catch { return null; }
  }, []);
  return { catalogo: s.data, loading: s.loading };
}

export default function ConfigAnalisis({ config, onChange, catalogo, corriendo, onAnalizar, embebido = false }) {
  const [abiertos, setAbiertos] = useState({});
  const setCore = (core, cambios) => onChange({ ...config, cores: { ...config.cores, [core]: { ...config.cores[core], ...cambios } } });
  const setExcl = (core, lista) => onChange({ ...config, excluidas: { ...config.excluidas, [core]: lista } });
  const seleccionados = CORES.filter(c => config.cores[c].on && config.cores[c].peso > 0);
  let totalM = 0; let marcadasM = 0;
  for (const core of seleccionados) {
    const senales = catalogo?.find(x => x.core === core)?.senales || [];
    const ex = new Set(config.excluidas[core] || []);
    totalM += senales.length; marcadasM += senales.filter(s => !ex.has(s.nombre)).length;
  }
  const errDias = errorRangoDias(config);
  const setDias = (k, v) => onChange({ ...config, [k]: v === '' ? NaN : Number(v) });
  const valDias = v => (Number.isFinite(v) ? v : '');
  const { recursos } = resolverConfig(config, catalogo);
  const resumen = `${seleccionados.length} ${seleccionados.length === 1 ? 'factor' : 'factores'}` + (totalM ? `, ${marcadasM} de ${totalM} métricas` : '');

  return (
    <section className={(embebido ? '' : 'card ') + 'cfg-card'} aria-label="Configurar análisis">
      <p className="muted small">Elige los <Termino id="core">factores</Termino>, su peso (0–5) y las métricas. Al analizar solo se traen los datos que piden los factores activos, y no se repite lo traído en los últimos 10 minutos.</p>
      <ul className="cfg-cores">
        {CORES.map(core => {
          const c = config.cores[core];
          const info = catalogo?.find(x => x.core === core);
          const senales = info?.senales || [];
          const ex = new Set(config.excluidas[core] || []);
          const marcadas = senales.filter(s => !ex.has(s.nombre)).length;
          const abierto = abiertos[core] && c.on && senales.length > 0;
          return (
            <li key={core} className="cfg-core">
              <div className="cfg-core__row">
                <label className="check cfg-core__name">
                  <input type="checkbox" checked={c.on} onChange={e => setCore(core, { on: e.target.checked })} disabled={corriendo} />
                  <span><strong>{CORE_LABELS[core]}</strong> <small className="muted">{CORE_DESCRIPCION[core]}</small></span>
                </label>
                <label className="cfg-peso">
                  <span className="muted small">Peso</span>
                  <input type="number" min="0" max="5" step="0.5" inputMode="decimal" value={c.peso} disabled={!c.on || corriendo}
                    aria-label={'Peso del factor ' + CORE_LABELS[core]}
                    onChange={e => setCore(core, { peso: Math.min(5, Math.max(0, Number(e.target.value) || 0)) })} />
                </label>
                {c.on && senales.length > 0 && (
                  <button type="button" className="btn btn--sm btn--ghost" aria-expanded={!!abierto} onClick={() => setAbiertos(a => ({ ...a, [core]: !a[core] }))}>
                    Métricas {marcadas}/{senales.length} {abierto ? '▲' : '▼'}
                  </button>
                )}
              </div>
              {abierto && (
                <div className="cfg-senales">
                  <div className="cfg-senales__acciones">
                    <button type="button" className="btn btn--sm" onClick={() => setExcl(core, [])} disabled={corriendo}>Todas</button>
                    <button type="button" className="btn btn--sm" onClick={() => setExcl(core, senales.map(s => s.nombre))} disabled={corriendo}>Ninguna</button>
                    {info.requiere?.length > 0 && <span className="muted small">Requiere: {info.requiere.join(', ')}</span>}
                  </div>
                  <ul className="cfg-senales__lista">
                    {senales.map(s => (
                      <li key={s.nombre}>
                        <label className="check">
                          <input type="checkbox" checked={!ex.has(s.nombre)} disabled={corriendo}
                            onChange={e => setExcl(core, e.target.checked ? [...ex].filter(n => n !== s.nombre) : [...ex, s.nombre])} />
                          <span>{s.etiqueta || s.nombre} {s.descripcion && <small className="muted">{s.descripcion}</small>}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="cfg-opciones">
        <label className="check"><input type="checkbox" checked={config.sincronizar} onChange={e => onChange({ ...config, sincronizar: e.target.checked })} disabled={corriendo} /><span>Sincronizar datos antes de analizar</span></label>
        <label className="check"><input type="checkbox" checked={config.institucional} onChange={e => onChange({ ...config, institucional: e.target.checked })} disabled={corriendo || !config.sincronizar || !config.cores.institucional.on} /><span>Descargar 13F institucional <small className="muted">(lento: 1–3 min; requiere el factor Institucional)</small></span></label>
        <label className="check"><input type="checkbox" checked={config.contratos} onChange={e => onChange({ ...config, contratos: e.target.checked })} disabled={corriendo || !config.sincronizar} /><span>Traer contratos de opciones <small className="muted">(strikes, vencimientos y griegas de las estrategias sugeridas)</small></span></label>
        {config.sincronizar && <p className="muted small" aria-live="polite">Se sincronizará: empresa{recursos.length ? ', ' + recursos.map(r => RECURSO_LABELS[r].toLowerCase()).join(', ') : ''}.</p>}
      </div>
      <fieldset className="cfg-dias" disabled={corriendo}>
        <legend className="field__label">Rango de <Termino id="vencimiento">vencimientos</Termino> (días)</legend>
        <div className="cfg-dias__campos">
          <label className="cfg-peso"><span className="muted small">Días a vencimiento mín.</span>
            <input type="number" min="0" max="730" step="1" inputMode="numeric" value={valDias(config.diasMin)} aria-describedby="cfg-dias-ayuda" aria-invalid={errDias ? true : undefined} onChange={e => setDias('diasMin', e.target.value)} /></label>
          <label className="cfg-peso"><span className="muted small">máx.</span>
            <input type="number" min="0" max="730" step="1" inputMode="numeric" value={valDias(config.diasMax)} aria-label="Días a vencimiento máx." aria-describedby="cfg-dias-ayuda" aria-invalid={errDias ? true : undefined} onChange={e => setDias('diasMax', e.target.value)} /></label>
        </div>
        <small id="cfg-dias-ayuda" className="field__help">Rango de vencimientos de opciones que se descargan y entre los que se elige para operar. Iron Condor suele usarse con 30–45 días.</small>
        {errDias && <small className="field__error" role="alert">{errDias}</small>}
      </fieldset>
      <div className="cfg-accion">
        <p className="cfg-resumen" aria-live="polite">{resumen}</p>
        {!embebido && <button type="button" className="btn btn--primary btn--lg" onClick={onAnalizar} disabled={corriendo || !seleccionados.length || Boolean(errDias)}>
          {corriendo ? 'Analizando…' : 'Analizar'}
        </button>}
        {!embebido && !seleccionados.length && <span className="muted small">Elige al menos un factor con peso mayor que 0.</span>}
      </div>
    </section>
  );
}
