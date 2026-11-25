// Sigue una orden hasta su estado final y avisa de cada cambio. Con un broker que avisa en vivo (Alpaca) se reacciona al aviso y se
// consulta de vez en cuando por seguridad; con los demás (Webull) se consulta cada pocos segundos. Quien escucha no nota la diferencia.
import boom from '@hapi/boom';
import { repository } from '../../../repositories';
import { adaptadorDe, createBroker, ESTADOS_TERMINALES } from './broker.service';
import { obtener } from './registros';

export const CADA_MS = 3000, CADA_CON_AVISO_MS = 15000, DURACION_MAX_MS = 10 * 60000, MAX_POR_USUARIO = 6;

export function createSeguimiento({ integraciones, factory = repository, cadaMs = CADA_MS, cadaConAvisoMs = CADA_CON_AVISO_MS, duracionMaxMs = DURACION_MAX_MS } = {}) {
  const broker = createBroker({ integraciones, factory });
  const porUsuario = new Map(), activos = new Set();

  /** Devuelve { orden, parar }. alCambio(orden, { enVivo }) por cada cambio; alTerminar(motivo): 'final' | 'tiempo' | 'apagado'. */
  async function seguir(ctx, ordenId, { alCambio, alTerminar }) {
    // El lugar se aparta antes de cualquier espera: varias aperturas simultáneas no rebasan el tope.
    const abiertos = porUsuario.get(ctx.userId) || 0;
    if (abiertos >= MAX_POR_USUARIO) throw boom.tooManyRequests('Demasiadas órdenes en seguimiento a la vez.');
    porUsuario.set(ctx.userId, abiertos + 1);
    const liberar = () => {
      const n = (porUsuario.get(ctx.userId) || 1) - 1;
      if (n > 0) porUsuario.set(ctx.userId, n); else porUsuario.delete(ctx.userId);
    };
    let orden, adaptador;
    try {
      orden = await obtener('ordenes', ctx, ordenId, factory);
      const conexion = await obtener('conexiones-broker', ctx, orden.conexionId, factory);
      adaptador = adaptadorDe(integraciones, (await obtener('brokers', ctx, conexion.brokerId, factory)).codigo);
    } catch (error) { liberar(); throw error; }
    let vivo = true, reloj = null, consultando = false, pendiente = false, soltar = null;
    const enVivo = () => Boolean(adaptador.avisosActivos?.());
    const terminar = motivo => {
      if (!vivo) return;
      vivo = false;
      clearTimeout(reloj); clearTimeout(limite); soltar?.(); activos.delete(terminar);
      liberar();
      if (motivo) alTerminar?.(motivo);
    };
    const programar = () => { clearTimeout(reloj); if (vivo) reloj = setTimeout(consultar, enVivo() ? cadaConAvisoMs : cadaMs); };
    async function consultar() {
      if (!vivo) return;
      if (consultando) { pendiente = true; return; }
      consultando = true;
      try {
        const nueva = await broker.actualizar(ctx, ordenId);
        if (!vivo) return;
        if (nueva._revision !== orden._revision) { orden = nueva; alCambio(orden, { enVivo: enVivo() }); }
        if (ESTADOS_TERMINALES.includes(orden.estado)) return terminar('final');
      } catch { /* un fallo puntual del broker no corta el seguimiento */ } finally { consultando = false; }
      if (pendiente) { pendiente = false; consultar(); } else programar();
    }
    activos.add(terminar);
    const limite = setTimeout(() => terminar('tiempo'), duracionMaxMs);
    if (ESTADOS_TERMINALES.includes(orden.estado) && orden.estado !== 'ejecutada') { terminar(); return { orden, final: true, parar: () => {} }; }
    soltar = adaptador.suscribirOrdenes?.(({ orden: o }) => { if (o.ordenExternaId === orden.ordenExternaId || o.clientOrderId === orden.idempotencyKey) consultar(); });
    reloj = setTimeout(consultar, 0);
    return { orden, final: false, parar: () => terminar() };
  }
  return { seguir, cerrar: () => { for (const t of [...activos]) t('apagado'); }, total: () => activos.size };
}
