// «Configurar análisis»: cores, pesos, señales (catálogo) y opciones de sincronización.
import { useState } from 'react';
import { useAsync } from '../../hooks/useAsync';
import { cores as coresApi } from '../../api/resources';
import { CORES, CORE_LABELS, CORE_DESCRIPCION } from '../../utils/constants';

/** Catálogo de señales; si falla, devuelve null y la UI oculta la selección de señales. */
export function useCatalogo() {
  const s = useAsync(async () => {
    try { return (await coresApi.catalogo())?.items || null; } catch { return null; }
  }, []);
  return { catalogo: s.data, loading: s.loading };
}

export default function ConfigAnalisis({ config, onChange, catalogo, corriendo, onAnalizar }) {
  const [abiertos, setAbiertos] = useState({});
  const setCore = (core, cambios) => onChange({ ...config, cores: { ...config.cores, [core]: { ...config.cores[core], ...cambios } } });
  const setExcl = (core, lista) => onChange({ ...config, excluidas: { ...config.excluidas, [core]: lista } });
  const seleccionados = CORES.filter(c => config.cores[c].on && config.cores[c].peso > 0);

  return (
    <section className="card" aria-labelledby="cfg-titulo">
      <div className="card__header">
        <div><h2 id="cfg-titulo">Configurar análisis</h2><p className="muted small">Elige los cores, su peso (0–5) y las señales que entran al cálculo.</p></div>
      </div>
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
                    aria-label={'Peso del core ' + CORE_LABELS[core]}
                    onChange={e => setCore(core, { peso: Math.min(5, Math.max(0, Number(e.target.value) || 0)) })} />
                </label>
                {c.on && senales.length > 0 && (
                  <button type="button" className="btn btn--sm btn--ghost" aria-expanded={!!abierto} onClick={() => setAbiertos(a => ({ ...a, [core]: !a[core] }))}>
                    Señales {marcadas}/{senales.length} {abierto ? '▲' : '▼'}
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
        <label className="check"><input type="checkbox" checked={config.institucional} onChange={e => onChange({ ...config, institucional: e.target.checked })} disabled={corriendo || !config.sincronizar} /><span>Incluir 13F institucional <small className="muted">(lento: 1–3 min)</small></span></label>
      </div>
      <div>
        <button type="button" className="btn btn--primary" onClick={onAnalizar} disabled={corriendo || !seleccionados.length}>
          {corriendo ? 'Analizando…' : 'Analizar con esta configuración'}
        </button>
        {!seleccionados.length && <span className="muted small"> Selecciona al menos un core con peso mayor que 0.</span>}
      </div>
    </section>
  );
}
