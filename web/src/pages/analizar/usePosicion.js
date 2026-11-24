// Estrategia, vencimiento y strikes elegidos, con sus cifras. Lo comparten el panel del veredicto y las pestañas de evidencia.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cargarCadena, cargarConfluencia } from '../../components/BotonOperar';
import { useAsync } from '../../hooks/useAsync';
import { useBroker } from '../../context/BrokerContext';
import { mercado, operacion } from '../../api/resources';
import { filasEstrategia, movimientoEsperado } from '../../utils/analisis';
import {
  analyzePayoff, antiguedadCotizacion, candidatosStrike, costoSpread, diasHasta, intencionPara, ivATM, liquidez, mid, netoMid, perfilRiesgo, reconstruirPatas, redondearPrecio,
  rolesEstrategia, seleccionRecomendada, signoNeto, validarSeleccion,
} from '../../utils/estrategiasOrden';
import { isNum } from '../../utils/format';

/** Strikes iniciales: los recomendados o, si solo cambió el vencimiento, los más cercanos a los que ya estaban elegidos. */
function strikesIniciales(clave, codigo, chain, roles, previa) {
  const items = chain.items || [], precio = chain.precioSubyacente;
  const recomendada = { clave, sel: seleccionRecomendada(codigo, items, precio) };
  const mismaEstrategia = previa.clave && previa.clave.split('|').slice(0, 2).join() === clave.split('|').slice(0, 2).join();
  if (!mismaEstrategia || !roles.every(r => previa.sel[r.clave])) return recomendada;
  const r = reconstruirPatas(codigo, roles.map(x => ({ accion: x.accion, item: previa.sel[x.clave] })), items, precio);
  if (r.error) return { ...recomendada, aviso: r.error };
  return { clave, sel: Object.fromEntries(roles.map((x, i) => [x.clave, items.find(it => it.contratoId === r.legs[i].contratoId)])), aviso: r.aviso };
}

/** Cifras de la posición con los strikes elegidos; { error } o { invalidos } si no se puede armar. */
function cifras(codigo, chain, roles, sel) {
  const items = chain.items || [], precio = chain.precioSubyacente;
  if (!roles.length) return { error: 'Estrategia sin armado automático: ' + codigo + '.' };
  if (!items.some(i => i.contratoId && isNum(i.strike))) return { error: 'No hay contratos disponibles en un vencimiento vigente.' };
  if (!isNum(precio)) return { error: 'No hay precio de la acción para armar la estrategia.' };
  const invalidos = validarSeleccion(codigo, sel);
  if (invalidos.length) return { invalidos };
  const patas = roles.map(r => ({ accion: r.accion, intencion: intencionPara(r.accion), contratoId: sel[r.clave].contratoId, item: sel[r.clave] }));
  const neto = netoMid(patas);
  const credito = signoNeto(patas, neto) === 'credito';
  const precioNeto = isNum(neto) ? redondearPrecio(neto) : null;
  const dias = diasHasta(chain.vencimiento);
  return {
    patas, credito, precioNeto, dias,
    riesgo: isNum(precioNeto) ? perfilRiesgo(patas, precioNeto, credito, 1) : null,
    payoff: analyzePayoff(patas.map(p => ({ tipo: p.item.tipo, strike: p.item.strike, accion: p.accion, cantidad: 1, multiplicador: 100, prima: mid(p.item) }))),
    movimiento: movimientoEsperado(precio, ivATM(items, precio), dias),
    liq: liquidez(patas), costo: costoSpread(patas), edad: antiguedadCotizacion(patas),
  };
}

export function usePosicion({ simbolo, datos, config, version, estrategiaInicial }) {
  const { broker, bloqueado } = useBroker();
  const [tab, setTab] = useState(estrategiaInicial || null);
  const [venc, setVenc] = useState('');
  const [strikes, setStrikes] = useState({ clave: null, sel: {} });
  useEffect(() => { setTab(estrategiaInicial || null); setVenc(''); }, [simbolo, estrategiaInicial]);

  const filas = useMemo(() => filasEstrategia(datos), [datos]);
  const activa = filas.find(f => f.codigo === tab) || filas[0] || null;
  const codigo = activa?.codigo;

  // La cadena se etiqueta con la estrategia que la pidió: al cambiar de estrategia o empresa no se arma nada con el vencimiento de la anterior.
  const cargada = useAsync(() => (venc ? mercado.opcionesResumen(simbolo, { vencimiento: venc }) : cargarCadena(simbolo, { diasMin: config.diasMin, diasMax: config.diasMax, codigo })).then(d => ({ codigo, simbolo, d })),
    [simbolo, version, venc, codigo, config.diasMin, config.diasMax], { enabled: Boolean(activa) });
  const chain = cargada.data?.codigo === codigo && cargada.data?.simbolo === simbolo ? cargada.data.d : null;
  const confluencia = useAsync(() => cargarConfluencia(activa.confluenciaId, datos.seleccion?.ponderaciones), [activa?.confluenciaId], { enabled: Boolean(activa?.confluenciaId) });
  const detalle = confluencia.data?.conf._id === activa?.confluenciaId ? confluencia.data : null;
  // Efectivo de la cuenta simulada, para decir cuánto pesa la pérdida máxima. Si no está disponible, simplemente no se muestra.
  const cuenta = useAsync(() => operacion.asegurarConexion(broker).then(r => r?.cuenta || null).catch(() => null), [broker], { enabled: Boolean(activa) && !bloqueado });

  const roles = useMemo(() => rolesEstrategia(codigo), [codigo]);
  const clave = chain ? `${simbolo}|${codigo}|${chain.vencimiento}` : null;
  let actual = strikes;
  if (clave && strikes.clave !== clave) {
    actual = strikesIniciales(clave, codigo, chain, roles, strikes);
    setStrikes(actual);
  }
  const items = useMemo(() => chain?.items || [], [chain]);
  // Tras actualizar la cadena se usan las cotizaciones nuevas del mismo contrato, no las guardadas al elegir.
  const sel = useMemo(() => Object.fromEntries(Object.entries(actual.sel).map(([k, it]) => [k, items.find(i => i.contratoId === it?.contratoId)])), [actual.sel, items]);
  const recomendada = useMemo(() => (chain ? seleccionRecomendada(codigo, items, chain.precioSubyacente) : {}), [chain, codigo, items]);
  const esRecomendada = roles.every(r => sel[r.clave]?.contratoId === recomendada[r.clave]?.contratoId);
  const op = useMemo(() => (chain ? cifras(codigo, chain, roles, sel) : null), [chain, codigo, roles, sel]);

  // Al cambiar una pata vendida, su ala protectora se reajusta si queda del lado incorrecto.
  const elegir = useCallback((rol, item) => setStrikes(prev => {
    const next = { ...prev.sel, [rol]: item };
    for (const r of roles) {
      if (r.ala?.de !== rol) continue;
      const ala = next[r.clave];
      const valida = ala && (r.ala.dir < 0 ? ala.strike < item.strike : ala.strike > item.strike);
      if (!valida) next[r.clave] = candidatosStrike(r, items, chain?.precioSubyacente, next)[0]?.item;
    }
    return { ...prev, sel: next, aviso: null };
  }), [roles, items, chain]);
  const restablecer = () => setStrikes(prev => ({ ...prev, sel: recomendada, aviso: null }));

  const efectivo = cuenta.data?.efectivo;
  const maxPerdida = op?.riesgo?.maxPerdida;
  return {
    filas, activa, mejor: filas[0] || null, elegirEstrategia: setTab, irAMejor: () => setTab(null),
    chain, cargando: cargada.loading, error: chain ? null : cargada.error, recargar: cargada.reload, cambiarVencimiento: setVenc,
    detalle, roles, sel, elegir, restablecer, esRecomendada, aviso: actual.aviso, op,
    pctEfectivo: isNum(maxPerdida) && efectivo > 0 ? maxPerdida / efectivo : null,
  };
}
