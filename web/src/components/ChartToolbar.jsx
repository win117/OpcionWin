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

const SOBRE_PRECIO = [['sma20', 'SMA 20'], ['sma50', 'SMA 50'], ['sma200', 'SMA 200'], ['bollinger', 'Bollinger'], ['tendencia', 'Tendencia 20'], ['volumen', 'Volumen']];
const CAPAS = [['niveles', 'Soportes y resistencias'], ['senales', 'Compra/venta'], ['patrones', 'Patrones de velas']];
const PANELES = [['rsi', 'RSI'], ['macd', 'MACD'], ['estocastico', 'Estocástico']];

/** Opciones de visualización. `opts`: { rango, intervalo, tipo, capas: { id: bool } }. `bloqueadas`: capas que no aplican ahora y por qué. */
export function ChartToolbar({ opts, onChange, bloqueadas = {} }) {
  const set = cambios => onChange({ ...opts, ...cambios });
  const grupo = (label, lista) => (
    <div className="seg" role="group" aria-label={label}>
      {lista.map(([id, texto]) => {
        const activo = Boolean(opts.capas[id]) && !bloqueadas[id];
        return <button key={id} type="button" className={'seg__btn seg__btn--solo' + (activo ? ' is-active' : '')} aria-pressed={activo} disabled={Boolean(bloqueadas[id])} title={bloqueadas[id]} onClick={() => set({ capas: { ...opts.capas, [id]: !opts.capas[id] } })}>{texto}</button>;
      })}
    </div>
  );
  return (
    <div className="chart-toolbar">
      <Grupo label="Rango" opciones={RANGOS} value={opts.rango} onChange={rango => set({ rango })} />
      <Grupo label="Intervalo" opciones={INTERVALOS} value={opts.intervalo} onChange={intervalo => set({ intervalo })} />
      <Grupo label="Tipo de gráfico" opciones={[{ value: 'velas', label: 'Velas' }, { value: 'linea', label: 'Línea' }]} value={opts.tipo} onChange={tipo => set({ tipo })} />
      {grupo('Sobre el precio', SOBRE_PRECIO)}
      {grupo('Señales', CAPAS)}
      {grupo('Paneles', PANELES)}
    </div>
  );
}
