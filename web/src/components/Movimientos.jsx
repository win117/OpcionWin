// «Movimientos de hoy»: alzas, bajas y volumen inusual del universo. Se actualiza solo cada minuto.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorMessage } from './States';
import { useSondeo } from '../hooks/useSondeo';
import { mercado } from '../api/resources';
import { fmtFixed, fmtHoraCorta, fmtInt, fmtMoney, fmtPct, isNum } from '../utils/format';

const FILAS = 5;
const LISTAS = [
  { clave: 'alzas', titulo: 'Suben más', vacio: 'Ninguna empresa sube por ahora.' },
  { clave: 'bajas', titulo: 'Bajan más', vacio: 'Ninguna empresa baja por ahora.' },
  { clave: 'volumenInusual', titulo: 'Volumen inusual', vacio: 'Sin datos de volumen todavía.' },
];

function Cambio({ valor }) {
  if (!isNum(valor)) return <span className="muted">—</span>;
  return <span className={'inicio-change ' + (valor >= 0 ? 'up' : 'down')}>{valor >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(valor), 2)}</span>;
}

function Lista({ titulo, vacio, items, cargando, volumen, activa }) {
  return (
    <article className={'mov__lista' + (activa ? ' is-active' : '')}>
      <h3>{titulo}</h3>
      {!cargando && !items.length ? <p className="muted small">{vacio}</p> : (
        <ol>
          {(cargando ? Array.from({ length: FILAS }) : items.slice(0, FILAS)).map((i, n) => (
            <li key={i?.simbolo || n}>
              {i ? (
                <Link className="mov__fila" to={'/analisis/' + encodeURIComponent(i.simbolo)}>
                  <strong>{i.simbolo}</strong>
                  <span className="mov__nombre">{i.nombre}</span>
                  <span className="mov__px">{volumen && isNum(i.volumenRelativo) ? `${fmtFixed(i.volumenRelativo, 1)}× lo normal` : fmtMoney(i.precio)}</span>
                  <Cambio valor={i.cambioPct} />
                </Link>
              ) : <span className="mov__fila"><span className="skel" /></span>}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

export default function Movimientos() {
  const { data: d, error, loading } = useSondeo(() => mercado.movimientos(), () => 60000);
  const [lista, setLista] = useState('alzas'); // en pantallas chicas se ve una lista a la vez
  const nota = !d ? '' : [d.abierto === false ? 'Última sesión' : null, d.total ? `${fmtInt(d.total)} empresas` : null,
    d.actualizadoEn ? `actualizado ${fmtHoraCorta(d.actualizadoEn)}` : null, d.desactualizado ? 'pendiente de actualizar' : null].filter(Boolean).join(', ');
  return (
    <section className="inicio-sec" aria-labelledby="mov-titulo">
      <div className="inicio-sec__head">
        <h2 id="mov-titulo">Movimientos de hoy</h2>
        <span className="muted small">{nota}</span>
      </div>
      {error && !d && <ErrorMessage error={error} title="No se pudieron cargar los movimientos; se reintenta solo" />}
      <div className="card mov">
        <div className="seg mov__selector" role="group" aria-label="Lista de movimientos">
          {LISTAS.map(l => <button key={l.clave} type="button" className={'seg__btn' + (l.clave === lista ? ' is-active' : '')} aria-pressed={l.clave === lista} onClick={() => setLista(l.clave)}>{l.titulo}</button>)}
        </div>
        <div className="mov__listas">
          {LISTAS.map(l => <Lista key={l.clave} {...l} items={d?.[l.clave] || []} cargando={loading || (!d && Boolean(error))} volumen={l.clave === 'volumenInusual'} activa={l.clave === lista} />)}
        </div>
      </div>
    </section>
  );
}
