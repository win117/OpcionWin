// Orquestación del análisis (ADR-001/002): carga datos guardados → core puro → registro trazable.
import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { cores, confluencia, estrategias as estrategiasCore } from '../../../cores';
import { CORES, ESTRATEGIAS } from '../models/shared';
import { todos, obtener, crear, idDeterminista } from './registros';
import { iniciarTrabajo } from './trabajos.service';

const fecha = d => new Date(d).getTime();
const NOMBRES = {
  LONG_CALL: ['Long Call', 'Compra de un call: ganancia si el subyacente sube por encima del strike más la prima; pérdida máxima = prima pagada.'],
  LONG_PUT: ['Long Put', 'Compra de un put: ganancia si el subyacente baja por debajo del strike menos la prima; pérdida máxima = prima pagada.'],
  IRON_CONDOR: ['Iron Condor', 'Venta de un put spread y un call spread fuera del dinero con el mismo vencimiento: crédito neto, ganancia si el precio permanece en rango.'],
};

function metricasValidas(lista = []) {
  return lista.filter(m => m && m.nombre && Number.isFinite(m.valor))
    .map(m => ({ nombre: String(m.nombre), valor: m.valor, unidad: m.unidad || 'indice', ...(m.periodo ? { periodo: String(m.periodo) } : {}) }));
}
// iv_promedio calculada solo con contratos dentro del rango de días a vencimiento: se refleja en el periodo de la métrica.
export function etiquetarVencimiento(metricas, rango) {
  if (!rango) return metricas;
  const etiqueta = rango.min + '-' + (Number.isFinite(rango.max) ? rango.max : '') + 'd';
  return metricas.map(m => m.nombre === 'iv_promedio' ? { ...m, periodo: etiqueta } : m);
}
const DIA = 86400000;
const positivo = v => Number.isFinite(v) && v > 0;
/** Misma regla que la web: bid > 0 y ask >= bid. 0/0 o bid 0 es «sin cotización», no precio 0. */
export const cotizacionValida = s => positivo(s?.bid) && Number.isFinite(s?.ask) && s.ask >= s.bid;
/** Prima por acción: punto medio de una cotización válida; si no, último precio > 0; si no, undefined (falta el dato). */
export const primaDe = s => (cotizacionValida(s) ? (s.bid + s.ask) / 2 : positivo(s?.ultimo) ? s.ultimo : undefined);

// Antigüedad de los snapshots de opciones, en días naturales de Nueva York: 2, o 4 si en medio hay fin de semana o feriado.
// Los feriados de NYSE que no están aquí caen siempre junto a un fin de semana, que ya amplía el plazo.
export const DIAS_SNAPSHOT = 2;
export const DIAS_SNAPSHOT_CIERRE = 4;
const diaNY = d => Date.parse(new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }));
function sinMercado(dia) {
  const d = new Date(dia), sem = d.getUTCDay(), num = d.getUTCDate(), mes = d.getUTCMonth() + 1;
  if (sem === 0 || sem === 6) return true;
  return ['1-1', '6-19', '7-4', '12-25'].includes(mes + '-' + num) || (mes === 11 && sem === 4 && num >= 22 && num <= 28); // Acción de Gracias
}
export function snapshotVigente(fechaDato, ahora = new Date()) {
  const desde = diaNY(fechaDato), hasta = diaNY(ahora);
  if (!Number.isFinite(desde)) return false;
  const dias = Math.round((hasta - desde) / DIA);
  if (dias <= DIAS_SNAPSHOT) return true;
  if (dias > DIAS_SNAPSHOT_CIERRE) return false;
  for (let d = desde + DIA; d <= hasta; d += DIA) if (sinMercado(d)) return true;
  return false;
}
// Registro con el dato más reciente.
const masReciente = lista => lista.reduce((a, b) => (!a || fecha(b.fuente.fechaDato) > fecha(a.fuente.fechaDato) ? b : a), undefined);
const metrica = (registro, nombre) => registro.metricas?.find(m => m.nombre === nombre)?.valor;

function ultimaFuente(registros, tipo) {
  const conFuente = registros.filter(r => r.fuente?.fechaDato);
  if (!conFuente.length) return [];
  const ultima = conFuente.reduce((a, b) => fecha(a.fuente.fechaDato) >= fecha(b.fuente.fechaDato) ? a : b).fuente;
  return [{ proveedor: ultima.proveedor, fechaDato: ultima.fechaDato, ...(ultima.feed ? { feed: ultima.feed } : {}), referencia: tipo }];
}

export function createAnalisis({ cola, factory = repository }) {
  async function insumos(ctx, empresa, requiere, parametros = {}) {
    const input = { simbolo: empresa.simbolo, velas: [], fundamentales: [], reportes: [], noticias: [], opciones: [] };
    const fuentes = [], faltantes = [];
    let rangoVencimiento;
    const necesita = k => requiere.some(r => r.replace(/\?$/, '') === k); // 'x?' = insumo opcional
    if (necesita('velas')) {
      const intervalo = parametros.intervalo || '1Day';
      const velas = (await todos('datos-mercado', ctx, { empresaId: empresa._id, tipo: 'vela' }, factory))
        .filter(v => (v.intervalo || '1Day') === intervalo).sort((a, b) => fecha(a.fuente.fechaDato) - fecha(b.fuente.fechaDato));
      input.velas = velas.map(v => ({ fecha: new Date(v.fuente.fechaDato).toISOString(), apertura: v.apertura, maximo: v.maximo, minimo: v.minimo, cierre: v.cierre, volumen: v.volumen }));
      fuentes.push(...ultimaFuente(velas, 'velas'));
    }
    if (necesita('fundamentales')) {
      const f = await todos('fundamentales', ctx, { empresaId: empresa._id }, factory);
      input.fundamentales = f.map(({ periodoInicio, periodoFin, forma, metricas }) => ({ periodoInicio, periodoFin, forma, metricas }));
      fuentes.push(...ultimaFuente(f, 'fundamentales'));
    }
    if (necesita('reportes')) {
      const r = await todos('institucional', ctx, { empresaId: empresa._id }, factory);
      input.reportes = r.map(({ fechaCorte, fechaPublicacion, tenencias }) => ({ fechaCorte, fechaPublicacion, tenencias }));
      fuentes.push(...ultimaFuente(r, 'institucional'));
    }
    if (necesita('noticias')) {
      const n = (await todos('noticias', ctx, undefined, factory)).filter(x => x.simbolos?.includes(empresa.simbolo));
      input.noticias = n.map(({ titulo, resumen, publicadaEn, proveedor }) => ({ titulo, resumen, publicadaEn, proveedor }));
      if (n.length) fuentes.push({ proveedor: n[0].proveedor, fechaDato: n.reduce((a, b) => fecha(a.publicadaEn) >= fecha(b.publicadaEn) ? a : b).publicadaEn, referencia: 'noticias' });
    }
    if (necesita('opciones')) {
      const contratos = new Map((await todos('contratos', ctx, { empresaId: empresa._id }, factory)).map(c => [c._id, c]));
      const ultimos = new Map();
      for (const s of await todos('datos-mercado', ctx, { empresaId: empresa._id, tipo: 'snapshot_opcion' }, factory)) {
        const prev = ultimos.get(s.contratoId);
        if (!prev || fecha(s.fuente.fechaDato) > fecha(prev.fuente.fechaDato)) ultimos.set(s.contratoId, s);
      }
      // Cerca del dinero (±5 % del último cierre): la IV de contratos muy ITM/OTM distorsiona el promedio.
      const cierre = input.velas.at(-1)?.cierre;
      const cerca = c => !Number.isFinite(cierre) || Math.abs(c.strike / cierre - 1) <= 0.05;
      // Días a vencimiento mín/máx (parametros): solo cuando se proveen; sin ellos se conserva el comportamiento anterior.
      const min = Number.isFinite(parametros.diasVencimientoMin) ? parametros.diasVencimientoMin : undefined;
      const max = Number.isFinite(parametros.diasVencimientoMax) ? parametros.diasVencimientoMax : undefined;
      if (min !== undefined || max !== undefined) rangoVencimiento = { min: min ?? 0, max: max ?? Infinity };
      const hoy = new Date().setUTCHours(0, 0, 0, 0);
      const enRango = c => !rangoVencimiento || (d => d >= rangoVencimiento.min && d <= rangoVencimiento.max)((fecha(c.vencimiento) - hoy) / 86400000);
      const candidatos = [...ultimos.values()].filter(s => {
        const c = contratos.get(s.contratoId);
        return c && cerca(c) && enRango(c) && fecha(c.vencimiento) >= hoy;
      });
      const vigentes = candidatos.filter(s => snapshotVigente(s.fuente.fechaDato));
      if (vigentes.length < candidatos.length) {
        faltantes.push(`opciones: ${candidatos.length - vigentes.length} de ${candidatos.length} cotizaciones ignoradas por antiguas (más de ${DIAS_SNAPSHOT} días; ${DIAS_SNAPSHOT_CIERRE} si hubo fin de semana o feriado)`);
      }
      input.opciones = vigentes.map(s => {
        const c = contratos.get(s.contratoId);
        return { tipo: c.tipo, strike: c.strike, vencimiento: c.vencimiento, ...(cotizacionValida(s) ? { bid: s.bid, ask: s.ask } : {}), volatilidadImplicita: s.volatilidadImplicita, griegas: s.griegas };
      });
      fuentes.push(...ultimaFuente(vigentes, 'opciones'));
    }
    return { input, fuentes, faltantes, rangoVencimiento };
  }

  // Ejecuta un core y devuelve datos + cambios listos para la Evaluacion.
  async function calcular(ctx, core, empresa, perfil, parametrosExtra = {}) {
    const modulo = cores[core];
    const parametros = { ...(perfil?.parametros || {}), ...parametrosExtra };
    const reglas = (perfil?.reglas || []).filter(r => r.core === core && r.activo !== false);
    const datos = { core, empresaId: empresa._id, ...(perfil ? { perfilId: perfil._id } : {}), versionAlgoritmo: modulo.VERSION, parametros, reglasAplicadas: reglas };
    const { input, fuentes, faltantes, rangoVencimiento } = await insumos(ctx, empresa, modulo.REQUIERE || [], parametros);
    const r = modulo.evaluar({ ...input, fechaReferencia: new Date().toISOString(), parametros, reglas });
    const cambios = {
      ...(r.puntaje != null ? { puntaje: r.puntaje } : {}), cobertura: r.cobertura ?? 0,
      metricas: etiquetarVencimiento(metricasValidas(r.metricas), rangoVencimiento), motivos: (r.motivos || []).map(String).slice(0, 50),
      datosFaltantes: [...faltantes, ...(r.datosFaltantes || [])].map(String).slice(0, 50), fuentes,
    };
    return { datos, cambios };
  }

  async function asegurarEstrategias(ctx) {
    const existentes = await todos('estrategias', ctx, undefined, factory);
    const mapa = new Map(existentes.map(e => [e.codigo, e]));
    for (const codigo of ESTRATEGIAS) if (!mapa.has(codigo)) {
      // _id determinista: dos solicitudes simultáneas no crean duplicados; la que pierde lee el registro de la otra.
      try {
        mapa.set(codigo, await crear('estrategias', ctx, { _id: idDeterminista(ctx.userId, 'estrategia', codigo), codigo, nombre: NOMBRES[codigo][0], descripcion: NOMBRES[codigo][1], activo: true }, factory));
      } catch (error) {
        const [creada] = boom.isBoom(error) && error.output.statusCode === 409 ? await todos('estrategias', ctx, { codigo }, factory) : [];
        if (!creada) throw error;
        mapa.set(codigo, creada);
      }
    }
    return mapa;
  }

  function combinar(estrategia, evaluaciones, coresSeleccionados, ponderaciones) {
    const indicadores = evaluaciones.find(e => e.core === 'indicadores');
    const volatilidad = indicadores ? { ivActual: metrica(indicadores, 'iv_promedio'), hv20: metrica(indicadores, 'hv_20') } : undefined;
    return confluencia.evaluar({
      estrategia,
      evaluaciones: evaluaciones.map(e => ({ core: e.core, sesgo: metrica(e, 'sesgo') ?? null, confianza: metrica(e, 'confianza') ?? 0, puntaje: e.puntaje ?? null, cobertura: e.cobertura ?? 0 })),
      ponderaciones: ponderaciones?.length ? ponderaciones : coresSeleccionados.map(core => ({ core, peso: 1 })),
      coresSeleccionados, volatilidad,
    });
  }
  const datosConfluencia = (r, coresSeleccionados) => ({
    versionAlgoritmo: confluencia.VERSION, cobertura: r.cobertura ?? 0, motivos: (r.motivos || []).map(String).slice(0, 50),
    ...(r.puntaje != null && r.sesgoCombinado != null ? { puntaje: r.puntaje } : {}),
    ponderaciones: (r.ponderacionesEfectivas || []).filter(p => coresSeleccionados.includes(p.core) && Number.isFinite(p.peso)),
  });

  return {
    asegurarEstrategias,
    async ejecutarCore(ctx, core, body = {}) {
      if (!CORES.includes(core)) throw boom.notFound('Core desconocido.');
      const empresa = await obtener('empresas', ctx, body.empresaId, factory);
      const perfil = body.perfilId ? await obtener('perfiles-analisis', ctx, body.perfilId, factory) : null;
      const previo = await calcularDatosIniciales(core, empresa, perfil, body.parametros);
      return iniciarTrabajo({ name: 'evaluaciones', ctx, factory, cola, datos: previo,
        ejecutar: async () => (await calcular(ctx, core, empresa, perfil, body.parametros)).cambios });
    },

    async ejecutarConfluencia(ctx, body = {}) {
      const estrategia = await obtener('estrategias', ctx, body.estrategiaId, factory);
      await obtener('empresas', ctx, body.empresaId, factory);
      const datos = { empresaId: body.empresaId, estrategiaId: body.estrategiaId, evaluacionesIds: body.evaluacionesIds,
        coresSeleccionados: body.coresSeleccionados, versionAlgoritmo: confluencia.VERSION, ponderaciones: body.ponderaciones || [] };
      return iniciarTrabajo({ name: 'confluencias', ctx, factory, cola, datos, ejecutar: async () => {
        const evaluaciones = [];
        for (const id of body.evaluacionesIds) {
          const e = await obtener('evaluaciones', ctx, id, factory);
          if (e.empresaId !== body.empresaId) throw boom.badRequest('La evaluación ' + id + ' pertenece a otra empresa.');
          if (e.estado !== 'completada') throw boom.badRequest('La evaluación ' + id + ' no está completada.');
          if (body.coresSeleccionados.includes(e.core)) evaluaciones.push(e);
        }
        return datosConfluencia(combinar(estrategia.codigo, evaluaciones, body.coresSeleccionados, body.ponderaciones), body.coresSeleccionados);
      } });
    },

    async ejecutarSeleccion(ctx, body = {}) {
      const perfil = body.perfilId ? await obtener('perfiles-analisis', ctx, body.perfilId, factory) : null;
      const campos = ['modo', 'empresaId', 'estrategiaId', 'empresasCandidatas', 'estrategiasCandidatas', 'coresSeleccionados', 'perfilId', 'filtros', 'ponderaciones'];
      const datos = Object.fromEntries(campos.filter(k => body[k] !== undefined).map(k => [k, body[k]]));
      return iniciarTrabajo({ name: 'selecciones', ctx, factory, cola, datos, ejecutar: async registro => {
        const catalogo = await asegurarEstrategias(ctx);
        const porId = new Map([...catalogo.values()].map(e => [e._id, e]));
        let codigos = registro.estrategiasCandidatas?.length ? registro.estrategiasCandidatas : ESTRATEGIAS;
        if (registro.modo !== 'empresa') {
          const e = porId.get(registro.estrategiaId) || await obtener('estrategias', ctx, registro.estrategiaId, factory);
          codigos = [e.codigo];
        }
        let empresas;
        if (registro.modo === 'estrategia') {
          empresas = registro.empresasCandidatas?.length
            ? await Promise.all(registro.empresasCandidatas.map(id => obtener('empresas', ctx, id, factory)))
            : (await todos('empresas', ctx, undefined, factory)).filter(e => e.activo !== false).slice(0, 25);
        } else empresas = [await obtener('empresas', ctx, registro.empresaId, factory)];

        const resultados = [];
        for (const empresa of empresas) {
          const evaluaciones = [];
          for (const core of registro.coresSeleccionados) {
            const { datos, cambios } = await calcular(ctx, core, empresa, perfil, registro.filtros || {});
            evaluaciones.push(await crear('evaluaciones', ctx, { ...datos, ...cambios, estado: 'completada', finalizadaEn: new Date() }, factory));
          }
          for (const codigo of codigos) {
            const estrategia = catalogo.get(codigo);
            const r = combinar(codigo, evaluaciones, registro.coresSeleccionados, registro.ponderaciones);
            const conf = await crear('confluencias', ctx, { empresaId: empresa._id, estrategiaId: estrategia._id,
              evaluacionesIds: evaluaciones.map(e => e._id), coresSeleccionados: registro.coresSeleccionados, estado: 'completada',
              ...datosConfluencia(r, registro.coresSeleccionados) }, factory);
            resultados.push({ empresaId: empresa._id, estrategiaId: estrategia._id, confluenciaId: conf._id,
              puntaje: r.sesgoCombinado == null ? 0 : r.puntaje, cobertura: r.sesgoCombinado == null ? 0 : (r.cobertura ?? 0),
              motivos: (r.sesgoCombinado == null ? ['Sin datos suficientes para calcular compatibilidad.'] : []).concat((r.motivos || []).map(String)).slice(0, 8) });
          }
        }
        resultados.sort((a, b) => b.puntaje - a.puntaje || b.cobertura - a.cobertura);
        return { resultados };
      } });
    },

    async evaluarConfiguracion(ctx, id, body = {}) {
      const config = await obtener('configuraciones', ctx, id, factory);
      const estrategia = await obtener('estrategias', ctx, config.estrategiaId, factory);
      const datos = { core: 'configuracion', configuracionId: config._id, empresaId: config.empresaId, versionAlgoritmo: estrategiasCore.VERSION, parametros: config.parametros || {} };
      return iniciarTrabajo({ name: 'evaluaciones', ctx, factory, cola, datos, ejecutar: async () => {
        const ahora = new Date();
        const snaps = await todos('datos-mercado', ctx, { empresaId: config.empresaId, tipo: 'snapshot_opcion' }, factory);
        const fuentes = [], componentes = [], faltantes = [], vencidos = [];
        for (const c of config.componentes || []) {
          const contrato = await obtener('contratos', ctx, c.contratoId, factory);
          const ultimo = masReciente(snaps.filter(x => x.contratoId === contrato._id));
          const s = ultimo && snapshotVigente(ultimo.fuente.fechaDato, ahora) ? ultimo : undefined;
          const precio = primaDe(s);
          if (precio === undefined) faltantes.push((ultimo && !s ? 'cotización vigente de ' : 'precio de ') + contrato.simbolo);
          if (fecha(contrato.vencimiento) < diaNY(ahora)) vencidos.push(contrato.simbolo);
          if (s) fuentes.push(...ultimaFuente([s], contrato.contratoExternoId));
          componentes.push({ tipo: contrato.tipo, strike: contrato.strike, vencimiento: contrato.vencimiento, accion: c.accion,
            cantidad: c.cantidad * (c.proporcion || 1), multiplicador: contrato.multiplicador || 100, ...(precio !== undefined ? { precio } : {}),
            // IV y griegas indicativas del snapshot: Black-Scholes (estrategias.core) las verifica y calcula la probabilidad de ganancia.
            ...(Number.isFinite(s?.volatilidadImplicita) ? { volatilidadImplicita: s.volatilidadImplicita } : {}), ...(s?.griegas ? { griegas: s.griegas } : {}) });
        }
        // Subyacente: la misma regla que el resumen de opciones (última cotización; si no hay, cierre de la última vela del intervalo).
        let precioSubyacente = Number.isFinite(body.precioSubyacente) ? body.precioSubyacente : undefined;
        if (precioSubyacente === undefined) {
          const cot = masReciente((await todos('datos-mercado', ctx, { empresaId: config.empresaId, tipo: 'cotizacion' }, factory)).filter(q => positivo(q.ultimo)));
          const intervalo = config.parametros?.intervalo || '1Day';
          const vela = cot ? null : masReciente((await todos('datos-mercado', ctx, { empresaId: config.empresaId, tipo: 'vela' }, factory)).filter(v => (v.intervalo || '1Day') === intervalo));
          precioSubyacente = cot?.ultimo ?? vela?.cierre;
        }
        const r = estrategiasCore.evaluarConfiguracion({ estrategia: estrategia.codigo, componentes, precioSubyacente, fechaReferencia: ahora.toISOString() });
        const errores = [...(r.errores || []), ...vencidos.map(x => `El contrato ${x} ya venció.`)];
        const conPrecio = componentes.filter(c => c.precio !== undefined).length;
        // Una estructura inválida o vencida nunca se reporta como completa: sin montos, cobertura 0 y configuracion_valida = 0.
        return { metricas: [...metricasValidas(errores.length ? [] : r.metricas), { nombre: 'configuracion_valida', valor: errores.length ? 0 : 1, unidad: 'indicador' }],
          motivos: [...errores, ...(r.motivos || [])].map(String).slice(0, 50),
          cobertura: componentes.length && !errores.length ? conPrecio / componentes.length : 0,
          datosFaltantes: faltantes, fuentes };
      } });
    },
  };
}

// Datos guardados al crear la evaluación (antes de calcular), para que el registro sea trazable desde el inicio.
async function calcularDatosIniciales(core, empresa, perfil, parametrosExtra = {}) {
  return { core, empresaId: empresa._id, ...(perfil ? { perfilId: perfil._id } : {}), versionAlgoritmo: cores[core].VERSION,
    parametros: { ...(perfil?.parametros || {}), ...parametrosExtra },
    reglasAplicadas: (perfil?.reglas || []).filter(r => r.core === core && r.activo !== false) };
}
