import { INTERVALOS, RANGOS } from '../utils/velas';

function Grupo({ label, opciones, value, onChange }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {opciones.map(o => (
        <button key={o.value} type="button" className={'seg__btn' + (o.value === value ? ' is-active' : '')} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function Toggle({ label, activo, onChange }) {
  return (
    <button type="button" className={'seg__btn seg__btn--solo' + (activo ? ' is-active' : '')} aria-pressed={activo} onClick={() => onChange(!activo)}>{label}</button>
  );
}

/** Opciones de visualización del gráfico. `opts`: { rango, intervalo, tipo, sma:{20,50,200}, volumen }. */
export function ChartToolbar({ opts, onChange }) {
  const set = cambios => onChange({ ...opts, ...cambios });
  return (
    <div className="chart-toolbar">
      <Grupo label="Rango" opciones={RANGOS} value={opts.rango} onChange={rango => set({ rango })} />
      <Grupo label="Intervalo" opciones={INTERVALOS} value={opts.intervalo} onChange={intervalo => set({ intervalo })} />
      <Grupo label="Tipo de gráfico" opciones={[{ value: 'velas', label: 'Velas' }, { value: 'linea', label: 'Línea' }]} value={opts.tipo} onChange={tipo => set({ tipo })} />
      <div className="seg" role="group" aria-label="Indicadores">
        {[20, 50, 200].map(n => <Toggle key={n} label={'SMA ' + n} activo={!!opts.sma[n]} onChange={v => set({ sma: { ...opts.sma, [n]: v } })} />)}
        <Toggle label="Volumen" activo={opts.volumen} onChange={volumen => set({ volumen })} />
      </div>
    </div>
  );
}
