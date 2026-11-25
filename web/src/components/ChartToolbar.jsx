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

const AYUDA = [
  ['Velas', 'Cada vela es un día (o semana o mes): el cuerpo va de la apertura al cierre y las mechas llegan al máximo y al mínimo. Verde, cerró arriba; roja, cerró abajo.'],
  ['SMA 20, 50 y 200', 'Precio promedio de los últimos 20, 50 o 200 cierres: tendencia de un mes, un trimestre y casi un año. Precio por encima, tendencia al alza.'],
  ['Bollinger', 'Promedio de 20 días más y menos dos desviaciones. Bandas anchas, mucha volatilidad; cerca de un borde, un precio extremo para lo reciente.'],
  ['Tendencia 20', 'La recta que mejor se ajusta a los últimos 20 cierres (punteada) y cómo ha ido cambiando (línea fina). Inclinada hacia arriba, sube.'],
  ['Volumen', 'Cuántas acciones se negociaron. Un movimiento con mucho volumen es más creíble.'],
  ['Soportes y resistencias', 'Precios donde rebotó varias veces: soporte abajo (frena caídas), resistencia arriba (frena subidas). «×3» son los toques.'],
  ['Compra/venta', 'Cruces de medias y del MACD. Avisan un cambio de tendencia; llegan tarde y fallan a menudo.'],
  ['Patrones de velas', 'Formas que algunos leen como giro o continuación. No cuentan en el puntaje; debajo se ve cuánto han acertado en esta empresa.'],
  ['RSI', 'De 0 a 100, la fuerza de las subidas frente a las bajadas en 14 días. Más de 70, subió muy rápido; menos de 30, cayó muy rápido.'],
  ['MACD', 'Diferencia entre un promedio rápido (12) y uno lento (26), y su señal (9). Barras positivas, la subida se acelera.'],
  ['Estocástico', 'Dónde cerró dentro del rango de 14 días: 100 es el máximo y 0 el mínimo.'],
];

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
      <details className="details ayuda-ind"><summary>¿Qué es cada indicador?</summary><dl>{AYUDA.map(([n, x]) => <div key={n}><dt>{n}</dt><dd>{x}</dd></div>)}</dl></details>
    </div>
  );
}
