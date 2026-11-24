// Sincronización proveedores → base seleccionada en la sesión (ADR-001, ADR-004).
// Cada recurso hace "upsert" con _id determinista: repetir una sincronización no duplica datos.
import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { adaptadorDe, createBroker, ESTADOS_TERMINALES } from './broker.service';
import { idDeterminista, todos, guardar, guardarLote, obtener, parchar } from './registros';

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

const RETRASO_SIP_MS = 16 * 60000;

export function createSincronizador({ integraciones, factory = repository }) {
  const { alpaca, sec } = integraciones;
  const cikDe = async simbolo => (await sec.cikDeSimbolo(simbolo))?.cik; // SEC devuelve {cik, nombre, simbolo}

  const porSimbolo = {
    async empresas(ctx, simbolo) {
      const activo = await alpaca.buscarActivo(simbolo);
      let cik, nombreSec;
      try { ({ cik, nombre: nombreSec } = await sec.cikDeSimbolo(simbolo)); } catch { cik = undefined; } // SEC opcional
      const existentes = await todos('empresas', ctx, { simbolo: activo.simbolo }, factory);
      const previo = existentes[0];
      // Nombre SEC ('Apple Inc.') coincide mejor con tablas 13F que 'Apple Inc. Common Stock'.
      const datos = { simbolo: activo.simbolo, nombre: nombreSec || activo.nombre, mercado: activo.mercado, activo: true,
        ...(previo?.sector ? { sector: previo.sector } : {}), ...(cik || previo?.cik ? { cik: cik || previo.cik } : {}) };
      await guardar('empresas', ctx, previo?._id || idDeterminista(ctx.userId, 'empresa', activo.simbolo, activo.mercado), datos, factory);
      return 1;
    },
    async historicos(ctx, simbolo, datos) {
      const empresa = await empresaPorSimbolo(ctx, simbolo, factory);
      const { desde, hasta } = rango(datos, 420); // ~290 sesiones: SMA200 + rango 52 semanas
      const intervalo = '1Day';
      // Consolidado de todas las bolsas (desde 2016; el plan gratuito lo da con 15 min de retraso). Si no está disponible, IEX (desde 2020).
      const pedir = (feed, hastaMs) => alpaca.velas(empresa.simbolo, { intervalo, desde: iso(desde), hasta: iso(hastaMs), limite: 10000, feed }).then(velas => ({ velas, feed }));
      const { velas, feed } = await pedir('sip', Math.min(new Date(hasta).getTime(), Date.now() - RETRASO_SIP_MS)).catch(e => {
        if (e?.codigo === 'LIMITE' || e?.codigo === 'RED') throw e;
        return pedir(alpaca.feed || 'iex', hasta);
      });
      return guardarLote('datos-mercado', ctx, velas.map(v => ({ id: idDeterminista(empresa._id, 'vela', intervalo, iso(v.fecha)), datos: {
        empresaId: empresa._id, tipo: 'vela', intervalo,
        apertura: v.apertura, maximo: v.maximo, minimo: v.minimo, cierre: v.cierre, volumen: v.volumen,
        fuente: { proveedor: 'alpaca', fechaDato: v.fecha, feed },
      } })), factory);
    },
    async cotizaciones(ctx, simbolo) {
      const empresa = await empresaPorSimbolo(ctx, simbolo, factory);
      const q = { ...await alpaca.cotizacion(empresa.simbolo) };
      // IEX fuera de horario puede venir cruzada (ask < bid): se descarta bid/ask y se conserva el último precio.
      if (q.bid != null && q.ask != null && q.ask < q.bid) { delete q.bid; delete q.ask; }
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
      // Solo strikes cercanos al precio (±25 %) para acotar volumen (cientos, no miles, de contratos).
      const q = await alpaca.cotizacion(empresa.simbolo).catch(() => null);
      const precio = q?.ultimo ?? (q?.bid != null && q?.ask != null ? (q.bid + q.ask) / 2 : undefined);
      const rangoStrike = Number.isFinite(precio) ? { strikeMin: Math.floor(precio * 0.75), strikeMax: Math.ceil(precio * 1.25) } : {};
      const filtros = { ...rangoStrike, vencimientoDesde: iso(hoy + min * DIA).slice(0, 10), vencimientoHasta: iso(hoy + max * DIA).slice(0, 10) };
      const lista = await alpaca.contratos({ subyacente: empresa.simbolo, ...filtros });
      const ids = new Map(lista.map(c => [c.contratoExternoId, idDeterminista(ctx.userId, 'contrato', 'alpaca', c.contratoExternoId)]));
      await guardarLote('contratos', ctx, lista.map(c => ({ id: ids.get(c.contratoExternoId), datos: {
        proveedor: 'alpaca', contratoExternoId: c.contratoExternoId, empresaId: empresa._id,
        simbolo: c.contratoExternoId, tipo: c.tipo, strike: c.strike, vencimiento: c.vencimiento,
        multiplicador: c.multiplicador || 100, activo: true } })), factory);
      // Snapshot (cotización, IV y griegas indicativas): uno vigente por contrato, se sobrescribe (evita crecimiento ilimitado).
      const snaps = lista.length ? await alpaca.snapshotsOpciones(empresa.simbolo, filtros) : [];
      await guardarLote('datos-mercado', ctx, snaps.filter(s => ids.has(s.contratoExternoId) && s.fechaDato).map(s => {
        const contratoId = ids.get(s.contratoExternoId);
        const bid = s.bid, ask = s.ask != null && bid != null && s.ask < bid ? undefined : s.ask;
        return { id: idDeterminista(contratoId, 'snapshot'), datos: {
          empresaId: empresa._id, contratoId, tipo: 'snapshot_opcion',
          ...(bid != null ? { bid } : {}), ...(ask != null ? { ask } : {}), ...(s.ultimo != null ? { ultimo: s.ultimo } : {}),
          ...(s.volatilidadImplicita != null ? { volatilidadImplicita: s.volatilidadImplicita } : {}),
          ...(s.griegas ? { griegas: s.griegas } : {}),
          fuente: { proveedor: 'alpaca', fechaDato: s.fechaDato, feed: 'indicative', referencia: s.contratoExternoId } } };
      }), factory);
      return lista.length;
    },
    async noticias(ctx, simbolo, datos) {
      const { desde, hasta } = rango(datos, 14);
      const lista = await alpaca.noticias({ simbolos: [String(simbolo).toUpperCase()], desde: iso(desde), hasta: iso(hasta), limite: 50 });
      return guardarLote('noticias', ctx, lista.filter(n => n.titulo && /^https?:\/\//.test(n.url || '')).map(n => ({
        id: idDeterminista(ctx.userId, 'noticia', n.proveedor || 'alpaca', n.noticiaExternaId), datos: {
          proveedor: n.proveedor || 'alpaca', noticiaExternaId: String(n.noticiaExternaId), titulo: n.titulo.slice(0, 2000),
          ...(n.resumen ? { resumen: n.resumen.slice(0, 2000) } : {}), url: n.url, publicadaEn: n.publicadaEn,
          simbolos: n.simbolos || [], idioma: 'en' } })), factory);
    },
    async fundamentales(ctx, simbolo) {
      const empresa = await empresaPorSimbolo(ctx, simbolo, factory);
      const cik = empresa.cik || await cikDe(empresa.simbolo);
      if (!empresa.cik && cik) await parchar('empresas', ctx, empresa._id, { cik }, factory);
      const periodos = await sec.fundamentales(cik);
      return guardarLote('fundamentales', ctx, periodos.map(p => ({
        id: idDeterminista(empresa._id, 'fund', iso(p.periodoInicio), iso(p.periodoFin), p.forma || ''), datos: {
          empresaId: empresa._id, fuente: p.fuente, periodoInicio: p.periodoInicio, periodoFin: p.periodoFin,
          ...(p.forma ? { forma: p.forma } : {}), metricas: p.metricas } })), factory);
    },
    async institucional(ctx, simbolo) {
      const empresa = await empresaPorSimbolo(ctx, simbolo, factory);
      // Las instituciones se descubren en la SEC; `filers13F` solo permite fijar un panel (p. ej. en pruebas).
      const reportes = await sec.tenencias13F({ filers: integraciones.filers13F, nombreEmisor: empresa.nombre, cortes: 2 });
      for (const r of reportes) {
        await guardar('institucional', ctx, idDeterminista(empresa._id, '13f', iso(r.fechaCorte)), {
          empresaId: empresa._id,
          // Lo que no se pudo leer queda escrito junto a los datos guardados.
          fuente: r.datosFaltantes?.length ? { ...r.fuente, referencia: `Datos faltantes: ${r.datosFaltantes.join('; ')} | ${r.fuente.referencia || ''}`.slice(0, 2000) } : r.fuente,
          fechaCorte: r.fechaCorte, fechaPublicacion: r.fechaPublicacion, tenencias: r.tenencias,
        }, factory);
      }
      return reportes.length;
    },
  };

  // Adaptador de trading según el broker de la conexión (alpaca | webull).
  const adaptadorConexion = async (ctx, conexion) => adaptadorDe(integraciones, (await obtener('brokers', ctx, conexion.brokerId, factory)).codigo);

  const broker = createBroker({ integraciones, factory });
  const porConexion = {
    async posiciones(ctx, conexion, conteo) {
      const lista = await (await adaptadorConexion(ctx, conexion)).posiciones();
      let n = 0;
      const vigentes = new Set();
      for (const p of lista) {
        if (p.cantidad === 0) continue; // ya sin contratos: se cierra abajo
        const [contrato] = await todos('contratos', ctx, { contratoExternoId: p.simbolo }, factory);
        if (!contrato) { conteo.fallidos++; continue; } // posición sin contrato sincronizado (p. ej. acciones)
        const id = idDeterminista(conexion._id, 'pos', p.posicionExternaId || p.simbolo);
        vigentes.add(id);
        await guardar('posiciones', ctx, id, {
          conexionId: conexion._id, posicionExternaId: p.posicionExternaId || p.simbolo, contratoId: contrato._id,
          ...(p.lado ? { lado: p.lado } : {}), ...(p.cantidad != null ? { cantidad: Math.abs(p.cantidad) } : {}),
          ...(p.precioPromedio != null ? { precioPromedio: Math.abs(p.precioPromedio) } : {}), ...(p.grupoId ? { grupoId: p.grupoId } : {}),
          cerrable: p.cerrable !== false && Boolean(p.lado) && p.cantidad != null, actualizadaEn: new Date(), estado: 'abierta',
        }, factory);
        n++;
      }
      // Abiertas localmente que el broker ya no reporta → cerradas (se conserva la última cantidad y precio promedio).
      for (const p of await todos('posiciones', ctx, { conexionId: conexion._id, estado: 'abierta' }, factory)) {
        if (vigentes.has(p._id)) continue;
        await parchar('posiciones', ctx, p._id, { estado: 'cerrada', actualizadaEn: new Date() }, factory);
        n++;
      }
      return n;
    },
    async ordenes(ctx, conexion, conteo) {
      const vigentes = (await todos('ordenes', ctx, { conexionId: conexion._id }, factory))
        .filter(o => !ESTADOS_TERMINALES.includes(o.estado) && (o.ordenExternaId || o.eventos?.length));
      let n = 0;
      for (const o of vigentes) {
        try { await broker.actualizar(ctx, o._id); n++; }
        catch { conteo.fallidos++; } // una orden con error no detiene a las demás
      }
      return n;
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
