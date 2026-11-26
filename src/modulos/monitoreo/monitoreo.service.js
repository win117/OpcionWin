// Servicio de monitoreo (openspec: monitoreo-servicio). Sin HTTP: recibe datos ya extraídos de cada solicitud.
// Reúne métricas Prometheus, analítica de uso, errores agrupados, log JSON y envío opcional a Sentry.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import boom from '@hapi/boom';
import { createRegistro } from './metricas';
import { createUso } from './uso';
import { createErrores } from './errores';
import { createSentry } from './sentry';

export function createMonitoreo({ integraciones, cola, token = '', sal = '', logJson = false, sentryDsn = '', fetch, escribirLog = l => console.log(l), ahora = () => new Date() } = {}) {
  const registro = createRegistro(), uso = createUso({ ahora }), errores = createErrores({ ahora });
  const salUsada = sal || randomBytes(16).toString('hex'); // sin MONITOREO_SAL: seudónimos estables mientras viva el proceso
  const sentry = createSentry({ dsn: sentryDsn, fetch });
  const retraso = monitorEventLoopDelay({ resolution: 20 }); retraso.enable();

  const solicitudes = registro.contador('http_solicitudes_total', 'Solicitudes HTTP atendidas por método, ruta (patrón) y código.');
  const duracion = registro.histograma('http_duracion_segundos', 'Duración de las solicitudes HTTP en segundos por método y ruta (patrón).');
  const capturados = registro.contador('errores_capturados_total', 'Errores 500 inesperados capturados, por ruta.');
  registro.calculado('proceso_memoria_bytes', 'Memoria del proceso por tipo (rss, heapUsed, heapTotal).', () => {
    const m = process.memoryUsage(); return ['rss', 'heapUsed', 'heapTotal'].map(tipo => ({ etiquetas: { tipo }, valor: m[tipo] }));
  });
  registro.calculado('proceso_cpu_segundos_total', 'Tiempo de CPU consumido por el proceso.', () => { const c = process.cpuUsage(); return [{ valor: (c.user + c.system) / 1e6 }]; });
  registro.calculado('proceso_encendido_segundos', 'Segundos desde que arrancó el proceso.', () => [{ valor: Math.round(process.uptime()) }]);
  registro.calculado('event_loop_retraso_p99_segundos', 'Percentil 99 del retraso del event loop (bloqueos del proceso).', () => [{ valor: retraso.percentile(99) / 1e9 }]);
  registro.calculado('circuito_abierto', 'Circuito del proveedor: 1 abierto o semiabierto, 0 cerrado.', () =>
    Object.entries(integraciones?.estado?.() || {}).map(([proveedor, p]) => ({ etiquetas: { proveedor }, valor: p.circuito && p.circuito.estado !== 'cerrado' ? 1 : 0 })));
  registro.calculado('cola_trabajos_en_curso', 'Trabajos 202 en espera o ejecutándose.', () => [{ valor: cola?.enCurso ? cola.enCurso() : 0 }]);
  registro.calculado('cola_aceptando', 'La cola acepta trabajos (1) o está drenando por apagado (0).', () => [{ valor: cola?.aceptando ? Number(cola.aceptando()) : 1 }]);

  const seudonimo = usuarioId => (usuarioId ? createHash('sha256').update(salUsada + String(usuarioId)).digest('hex').slice(0, 10) : null);
  const tokenBuf = token ? Buffer.from(token) : null;

  return {
    habilitado: Boolean(token),
    /** Endpoints de operación: 404 si no hay token configurado (no existen), 401 si el token no coincide. */
    autorizar(cabecera) {
      if (!tokenBuf) throw boom.notFound('Ruta no encontrada.');
      const recibido = Buffer.from(String(cabecera || '').replace(/^Bearer\s+/i, ''));
      if (recibido.length !== tokenBuf.length || !timingSafeEqual(recibido, tokenBuf)) throw boom.unauthorized('Token de monitoreo inválido.');
    },
    registrarSolicitud({ metodo, ruta, codigo, ms, usuarioId, requestId }) {
      const usuario = seudonimo(usuarioId);
      solicitudes.sumar({ metodo, ruta, codigo });
      duracion.observar({ metodo, ruta }, ms / 1000);
      uso.registrar({ metodo, ruta, codigo, ms, usuario });
      if (logJson) escribirLog(JSON.stringify({ ts: ahora().toISOString(), nivel: codigo >= 500 ? 'error' : codigo >= 400 ? 'aviso' : 'info', requestId, metodo, ruta, codigo, ms: Math.round(ms * 10) / 10, ...(usuario ? { usuario } : {}) }));
    },
    capturarError(error, { ruta, requestId } = {}) {
      const grupo = errores.capturar(error, { ruta, requestId });
      capturados.sumar({ ruta: grupo.ruta });
      sentry.enviar(grupo, { requestId }); // en segundo plano; nunca lanza
      return grupo;
    },
    metricas: () => registro.exportar(),
    uso: () => uso.resumen(),
    errores: () => ({ total: errores.total(), grupos: errores.lista(), sentry: sentry.activo }),
    seudonimo,
  };
}
