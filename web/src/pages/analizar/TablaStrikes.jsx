// Comparación de strikes de una pata: recomendado, adecuados y, a petición, todos los demás. Elegir aquí cambia el panel.
import { useState } from 'react';
import { Badge } from '../../components/Badge';
import { Termino } from '../../components/Termino';
import { candidatosStrike, cotizacionFiable, mid, sinPrecios, SPREAD_AVISO, spreadPct } from '../../utils/estrategiasOrden';
import { fmtFixed, fmtPct, isNum } from '../../utils/format';

const VISIBLES = 5;

/** Posición del strike respecto al precio de la acción: ITM / ATM / OTM. */
function dinero(item, precio) {
  if (!isNum(precio) || !isNum(item?.strike)) return '—';
  if (Math.abs(item.strike - precio) / precio < 0.01) return 'ATM';
  return (item.tipo === 'call' ? item.strike < precio : item.strike > precio) ? 'ITM' : 'OTM';
}

function TablaStrikes({ rol, cands, elegido, precio, onElegir, nombreGrupo }) {
  const [todos, setTodos] = useState(false);
  const rango = new Map(cands.map((c, i) => [c.item.contratoId, i]));
  let visibles = todos ? cands : cands.slice(0, VISIBLES);
  if (!todos && elegido && !visibles.some(c => c.item.contratoId === elegido.contratoId)) {
    const c = cands.find(x => x.item.contratoId === elegido.contratoId);
    if (c) visibles = [...visibles, c];
  }
  visibles = [...visibles].sort((a, b) => a.item.strike - b.item.strike);
  return (
    <fieldset className="strikes">
      <legend id={nombreGrupo + '-t'}><Badge tone={rol.accion === 'sell' ? 'warning' : 'info'}>{rol.accion === 'sell' ? 'Vender' : 'Comprar'}</Badge> {rol.etiqueta.replace(/^(Comprar|Vender) /, '')}</legend>
      <p className="muted small strikes__ayuda">{rol.ayuda}</p>
      {cands.length > 0 && !cands[0].recomendable && <p className="small aviso-texto">{sinPrecios(cands.map(c => c.item)) ? 'Sin recomendación: este vencimiento todavía no tiene precios.' : 'Sin recomendación: ningún strike adecuado tiene cotización con spread de 25 % o menos.'}</p>}
      {!cands.length ? <p className="small aviso-texto">No hay strikes válidos para esta pata en el vencimiento elegido.</p> : (
        <div className="table-wrap">
          <table className="table table--dense" aria-labelledby={nombreGrupo + '-t'}>
            <thead><tr><th scope="col"><span className="sr-only">Elegir</span></th><th scope="col" className="num"><Termino id="strike">Strike</Termino></th><th scope="col"><Termino id="itm">Dinero</Termino></th><th scope="col" className="num"><Termino id="delta">Delta</Termino></th><th scope="col" className="num"><Termino id="prima">Prima</Termino></th><th scope="col" className="num"><Termino id="spread">Spread</Termino></th><th scope="col" className="num"><Termino id="iv">IV</Termino></th><th scope="col">Idoneidad</th></tr></thead>
            <tbody>
              {visibles.map(c => {
                const it = c.item;
                const pos = rango.get(it.contratoId);
                const sel = elegido?.contratoId === it.contratoId;
                const sp = spreadPct(it);
                const id = `${nombreGrupo}-${it.contratoId}`;
                return (
                  <tr key={it.contratoId} className={'strikes__fila' + (sel ? ' is-sel' : '')} onClick={() => onElegir(it)}>
                    <td><input type="radio" id={id} name={nombreGrupo} checked={sel} onChange={() => onElegir(it)} aria-label={`Strike ${fmtFixed(it.strike, 2)}${pos === 0 && c.recomendable ? ', recomendado' : ''}`} /></td>
                    <td className="num"><label htmlFor={id}><strong>{fmtFixed(it.strike, 2)}</strong></label></td>
                    <td>{dinero(it, precio)}</td>
                    <td className="num">{isNum(it.griegas?.delta) ? fmtFixed(it.griegas.delta, 2) : '—'}</td>
                    <td className="num">{isNum(mid(it)) ? <>{fmtFixed(mid(it), 2)}{!cotizacionFiable(it) && <abbr title="Último precio operado">*</abbr>}</> : '—'}</td>
                    <td className={'num' + (sp > SPREAD_AVISO ? ' aviso-texto' : '')}>{isNum(sp) ? fmtPct(sp, 0) : '—'}</td>
                    <td className="num">{isNum(it.volatilidadImplicita) ? fmtPct(it.volatilidadImplicita, 1) : '—'}</td>
                    <td className="strikes__idon" title={c.motivo}>
                      <span className="muted small">{c.idoneidad} </span>
                      {!c.recomendable ? null : pos === 0 ? <Badge tone="success">Recomendado</Badge> : pos < 3 ? <Badge tone="info">Adecuado</Badge> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {cands.length > VISIBLES && (
        <button type="button" className="btn btn--ghost btn--sm" aria-expanded={todos} onClick={() => setTodos(t => !t)}>
          {todos ? 'Mostrar solo los más adecuados' : `Ver los ${cands.length} strikes disponibles`}
        </button>
      )}
    </fieldset>
  );
}

export default function CompararStrikes({ pos }) {
  const { activa, chain, roles, sel, elegir } = pos;
  if (!activa || !chain || !roles.length) return null;
  return (
    <section className="card" aria-labelledby="comparar-titulo">
      <h2 id="comparar-titulo" tabIndex={-1}>Comparar strikes</h2>
      <p className="muted small">Idoneidad: ajuste a la estrategia 70 % y liquidez 30 %. Lo que elijas aquí cambia el panel.</p>
      <div className={'strikes-grid' + (roles.length > 1 ? ' strikes-grid--2' : '')}>
        {roles.map(r => (
          <TablaStrikes key={activa.codigo + r.clave} rol={r} nombreGrupo={`strike-${activa.codigo}-${r.clave}`} precio={chain.precioSubyacente}
            cands={candidatosStrike(r, chain.items, chain.precioSubyacente, sel)} elegido={sel[r.clave]} onElegir={it => elegir(r.clave, it)} />
        ))}
      </div>
    </section>
  );
}
