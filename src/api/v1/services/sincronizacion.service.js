// Sincronización proveedores → base seleccionada en la sesión (ADR-001, ADR-004).
// Cada recurso hace "upsert" con _id determinista: repetir una sincronización no duplica datos.
import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { idDeterminista, todos, guardar, obtener, parchar } from './registros';

const DIA = 86400000;
const iso = d => new Date(d).toISOString();

export async function empresaPorSimbolo(ctx, simbolo, factory = repository) {
  const [empresa] = await todos('empresas', ctx, { simbolo: String(simbolo).toUpperCase() }, factory);
  if (!empresa) throw boom.badRequest('Empresa no registrada: ' + simbolo + '. Sincroniza el recurso "empresas" o créala.');
  return empresa;
}

function rango(datos, diasAtras) {
  const hasta = datos.hasta ? new Date(datos.hasta) : new Date();
  const desde = datos.desde ? new Date(datos.desde) : new Date(hasta.getTime() - diasAtras * DIA);
  return { desde, hasta };
}

export function createSincronizador({ integraciones, factory = repository }) {
  const { alpaca, sec } = integraciones;
  const cikDe = async simbolo => (await sec.cikDeSimbolo(simbolo))?.cik; // SEC devuelve {cik, nombre, simbolo}

  const porSimbolo = {
    async empresas(ctx, simbolo) {
      const activo = await alpaca.buscarActivo(simbolo);
      let cik;
      try { cik = await cikDe(simbolo); } catch { cik = undefined; } // SEC opcional
      const existentes = await todos('empresas', ctx, { simbolo: activo.simbolo }, factory);
      const previo = existentes[0];
      const datos = { simbolo: activo.simbolo, nombre: activo.nombre, mercado: activo.mercado, activo: true,
        ...(previo?.sector ? { sector: previo.sector } : {}), ...(cik || previo?.cik ? { cik: cik || previo.cik } : {}) };
      await guardar('empresas', ctx, previo?._id || idDeterminista(ctx.userId, 'empresa', activo.simbolo, activo.mercado), datos, factory);
      return 1;
    },
    async historicos(ctx, simbolo, datos) {
      const empresa = await empresaPorSimbolo(ctx, simbolo, factory);
      const { desde, hasta } = rango(datos, 420); // ~290 sesiones: SMA200 + rango 52 semanas
      const intervalo = '1Day';
      const velas = await alpaca.velas(empresa.simbolo, { intervalo, desde: iso(desde), hasta: iso(hasta) });
      let n = 0;
      for (const v of velas) {
        await guardar('datos-mercado', ctx, idDeterminista(empresa._id, 'vela', intervalo, iso(v.fecha)), {
          empresaId: empresa._id, tipo: 'vela', intervalo,
          apertura: v.apertura, maximo: v.maximo, minimo: v.minimo, cierre: v.cierre, volumen: v.volumen,
          fuente: { proveedor: 'alpaca', fechaDato: v.fecha, feed: alpaca.feed || 'iex' },
        }, factory);
        n++;
      }
      return n;
    },
    async cotizaciones(ctx, simbolo) {
      const empresa = await empresaPorSimbolo(ctx, simbolo, factory);
      const q = await alpaca.cotizacion(empresa.simbolo);
      await guardar('datos-mercado', ctx, idDeterminista(empresa._id, 'cotizacion', iso(q.fechaDato)), {
        empresaId: empresa._id, tipo: 'cotizacion',
        ...(q.bid != null ? { bid: q.bid } : {}), ...(q.ask != null ? { ask: q.ask } : {}), ...(q.ultimo != null ? { ultimo: q.ultimo } : {}),
        fuente: { proveedor: 'alpaca', fechaDato: q.fechaDato, feed: q.feed || alpaca.feed || 'iex' },
      }, factory);
      return 1;
    },
    async contratos(ctx, simbolo, datos) {
      const empresa = await empresaPorSimbolo(ctx, simbolo, factory);
      const hoy = Date.now();
      const min = Number(datos.diasVencimientoMin ?? 7), max = Number(datos.diasVencimientoMax ?? 60);
      const lista = await alpaca.contratos({ subyacente: empresa.simbolo,
        vencimientoDesde: iso(hoy + min * DIA).slice(0, 10), vencimientoHasta: iso(hoy + max * DIA).slice(0, 10) });
      const ids = new Map();
      for (const c of lista) {
        const id = idDeterminista(ctx.userId, 'contrato', 'alpaca', c.contratoExternoId);
        await guardar('contratos', ctx, id, { proveedor: 'alpaca', contratoExternoId: c.contratoExternoId, empresaId: empresa._id,
          simbolo: c.simbolo || c.contratoExternoId, tipo: c.tipo, strike: c.strike, vencimiento: c.vencimiento,
          multiplicador: c.multiplicador || 100, activo: true }, factory);
        ids.set(c.contratoExternoId, id);
      }
      // Snapshot (cotización, IV y griegas indicativas) de los contratos sincronizados.
      const snaps = lista.length ? await alpaca.snapshotsOpciones(empresa.simbolo) : [];
      for (const s of snaps) {
        const contratoId = ids.get(s.contratoExternoId);
        if (!contratoId || !s.fechaDato) continue;
        const bid = s.bid, ask = s.ask != null && bid != null && s.ask < bid ? undefined : s.ask;
        await guardar('datos-mercado', ctx, idDeterminista(contratoId, 'snapshot', iso(s.fechaDato)), {
          empresaId: empresa._id, contratoId, tipo: 'snapshot_opcion',
          ...(bid != null ? { bid } : {}), ...(ask != null ? { ask } : {}), ...(s.ultimo != null ? { ultimo: s.ultimo } : {}),
          ...(s.volatilidadImplicita != null ? { volatilidadImplicita: s.volatilidadImplicita } : {}),
          ...(s.griegas ? { griegas: s.griegas } : {}),
          fuente: { proveedor: 'alpaca', fechaDato: s.fechaDato, feed: 'indicative', referencia: s.contratoExternoId },
        }, factory);
      }
      return lista.length;
    },
    async noticias(ctx, simbolo, datos) {
      const { desde, hasta } = rango(datos, 14);
      const lista = await alpaca.noticias({ simbolos: [String(simbolo).toUpperCase()], desde: iso(desde), hasta: iso(hasta), limite: 50 });
      for (const n of lista) {
        await guardar('noticias', ctx, idDeterminista(ctx.userId, 'noticia', n.proveedor || 'alpaca', n.noticiaExternaId), {
          proveedor: n.proveedor || 'alpaca', noticiaExternaId: String(n.noticiaExternaId), titulo: n.titulo.slice(0, 2000),
          ...(n.resumen ? { resumen: n.resumen.slice(0, 2000) } : {}), url: n.url, publicadaEn: n.publicadaEn,
          simbolos: n.simbolos || [], idioma: 'en',
        }, factory);
      }
      return lista.length;
    },
    async fundamentales(ctx, simbolo) {
      const empresa = await empresaPorSimbolo(ctx, simbolo, factory);
      const cik = empresa.cik || await cikDe(empresa.simbolo);
      if (!empresa.cik && cik) await parchar('empresas', ctx, empresa._id, { cik }, factory);
      const periodos = await sec.fundamentales(cik);
      for (const p of periodos) {
        await guardar('fundamentales', ctx, idDeterminista(empresa._id, 'fund', iso(p.periodoInicio), iso(p.periodoFin), p.forma || ''), {
          empresaId: empresa._id, fuente: p.fuente, periodoInicio: p.periodoInicio, periodoFin: p.periodoFin,
          ...(p.forma ? { forma: p.forma } : {}), metricas: p.metricas,
        }, factory);
      }
      return periodos.length;
    },
    async institucional(ctx, simbolo) {
      const empresa = await empresaPorSimbolo(ctx, simbolo, factory);
      const reportes = await sec.tenencias13F({ filers: integraciones.filers13F, nombreEmisor: empresa.nombre, cortes: 2 });
      for (const r of reportes) {
        await guardar('institucional', ctx, idDeterminista(empresa._id, '13f', iso(r.fechaCorte)), {
          empresaId: empresa._id, fuente: r.fuente, fechaCorte: r.fechaCorte, fechaPublicacion: r.fechaPublicacion, tenencias: r.tenencias,
        }, factory);
      }
      return reportes.length;
    },
  };

  const porConexion = {
    async posiciones(ctx, conexion, conteo) {
      const lista = await alpaca.posiciones();
      let n = 0;
      for (const p of lista) {
        const [contrato] = await todos('contratos', ctx, { contratoExternoId: p.simbolo }, factory);
        if (!contrato) { conteo.fallidos++; continue; } // posición sin contrato sincronizado (p. ej. acciones)
        await guardar('posiciones', ctx, idDeterminista(conexion._id, 'pos', p.posicionExternaId || p.simbolo), {
          conexionId: conexion._id, posicionExternaId: p.posicionExternaId || p.simbolo, contratoId: contrato._id,
          lado: p.lado, cantidad: Math.abs(p.cantidad), precioPromedio: Math.abs(p.precioPromedio), actualizadaEn: new Date(), estado: 'abierta',
        }, factory);
        n++;
      }
      return n;
    },
    async ordenes(ctx, conexion) {
      const ordenes = (await todos('ordenes', ctx, { conexionId: conexion._id }, factory)).filter(o => o.ordenExternaId);
      for (const o of ordenes) {
        const remoto = await alpaca.consultarOrden(o.ordenExternaId);
        if (remoto.estado !== o.estado) await parchar('ordenes', ctx, o._id, d => ({ ...d, estado: remoto.estado,
          eventos: [...(d.eventos || []), { tipo: 'sincronizacion', mensaje: 'Estado del broker: ' + remoto.estado }] }), factory);
      }
      return ordenes.length;
    },
  };

  return {
    recursos: [...Object.keys(porSimbolo), ...Object.keys(porConexion)],
    async ejecutar(ctx, registro) {
      const conteo = { procesados: 0, fallidos: 0 };
      const errores = [];
      if (porConexion[registro.recurso]) {
        const conexion = await obtener('conexiones-broker', ctx, registro.conexionId, factory);
        conteo.procesados += await porConexion[registro.recurso](ctx, conexion, conteo);
      } else {
        if (!registro.simbolos?.length) throw boom.badRequest('Indica al menos un símbolo.');
        for (const simbolo of registro.simbolos) {
          try { conteo.procesados += await porSimbolo[registro.recurso](ctx, simbolo, registro); }
          catch (error) {
            conteo.fallidos++;
            errores.push(simbolo + ': ' + (error?.mensaje || error?.output?.payload?.message || 'error'));
            if (registro.simbolos.length === 1) throw error;
          }
        }
      }
      return { procesados: conteo.procesados, fallidos: conteo.fallidos, ...(errores.length ? { error: errores.join(' | ').slice(0, 1900) } : {}) };
    },
  };
}
