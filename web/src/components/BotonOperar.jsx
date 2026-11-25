// Botón «Operar»: arma las patas de la estrategia con la cadena actual y abre el ticket de orden simulada.
import { useRef, useState } from 'react';
import TicketOrden from './TicketOrden';
import { ErrorMessage } from './States';
import { confluencias, estrategias, evaluaciones, mercado, selecciones } from '../api/resources';
import { CORES, ESTRATEGIA_LABELS } from '../utils/constants';
import { leerConfig } from '../pages/analizar/flujo';
import { construirPatas, contextoAnalisis, elegirVencimiento, estadisticosConfluencia } from '../utils/estrategiasOrden';

/** Carga selección completada más reciente, catálogo de estrategias y últimas evaluaciones por core. */
export async function cargarDatosAnalisis(empresa) {
  const [sel, est, evs] = await Promise.all([
    selecciones.list({ empresaId: empresa._id, modo: 'empresa', estado: 'completada', limit: 1 }).catch(() => ({ items: [] })),
    estrategias.list({ limit: 100 }).catch(() => ({ items: [] })),
    Promise.all(CORES.map(core => evaluaciones.list({ empresaId: empresa._id, core, estado: 'completada', limit: 1 }).then(r => [core, r.items?.[0]]).catch(() => [core, null]))),
  ]);
  return { seleccion: sel.items?.[0], estrategiasById: new Map((est.items || []).map(e => [e._id, e])), evaluaciones: Object.fromEntries(evs) };
}

/** Confluencia guardada con SUS evaluaciones (no las últimas) y sus estadísticos: { conf, evaluaciones: { core → ev }, est }. */
export async function cargarConfluencia(confluenciaId, ponderaciones = []) {
  const conf = await confluencias.get(confluenciaId);
  const evs = await Promise.all((conf.evaluacionesIds || []).map(id => evaluaciones.get(id)));
  return { conf, evaluaciones: Object.fromEntries(evs.map(e => [e.core, e])), est: estadisticosConfluencia(evs, ponderaciones, conf.coresSeleccionados || []) };
}

/**
 * Cadena del vencimiento sugerido para la estrategia (30-45 días objetivo dentro de diasMin–diasMax). Nunca uno vencido:
 * si todos lo están devuelve la cadena sin contratos.
 */
export async function cargarCadena(simbolo, { diasMin = 7, diasMax = null, codigo = null } = {}) {
  const d = await mercado.opcionesResumen(simbolo, {});
  const venc = elegirVencimiento(d.vencimientos || (d.vencimiento ? [d.vencimiento] : []), new Date(), diasMin, diasMax, codigo, d.detalleVencimientos);
  if (!venc) return { ...d, vencimiento: null, items: [], total: 0 };
  return venc === d.vencimiento ? d : mercado.opcionesResumen(simbolo, { vencimiento: venc });
}

/**
 * Props: empresa, estrategiaCodigo (si falta se usa la mejor clasificada, o LONG_CALL sin selección),
 * datos (opcional, ya cargados: { seleccion, estrategiasById, evaluaciones }), label, className.
 * legs + chain (opcionales): patas ya elegidas por el usuario sobre esa cadena; si llegan, no se rearman.
 */
export default function BotonOperar({ empresa, estrategiaCodigo, datos, label, className = 'btn btn--primary', disabled, diasMin, diasMax, legs: legsElegidas, chain: chainElegida }) {
  const [estado, setEstado] = useState({ busy: false, error: null, ticket: null });
  const boton = useRef(null);

  const abrir = async () => {
    setEstado({ busy: true, error: null, ticket: null });
    const cfg = leerConfig(); // rango de días de la configuración de análisis (localStorage)
    const rango = { diasMin: diasMin ?? cfg.diasMin, diasMax: diasMax ?? cfg.diasMax };
    try {
      const elegidas = legsElegidas?.length && chainElegida;
      const d = datos || await cargarDatosAnalisis(empresa);
      const codigo = estrategiaCodigo || contextoAnalisis(d, null).topCodigo || 'LONG_CALL';
      const analisis = contextoAnalisis(d, codigo);
      const [chain, est] = await Promise.all([
        elegidas ? chainElegida : cargarCadena(empresa.simbolo, { ...rango, codigo }),
        analisis.confluenciaId ? cargarConfluencia(analisis.confluenciaId, d.seleccion?.ponderaciones).then(c => c.est).catch(() => null) : null,
      ]);
      const { legs, error } = elegidas ? { legs: legsElegidas } : construirPatas(codigo, chain.items || [], chain.precioSubyacente);
      if (error) throw new Error(error);
      setEstado({ busy: false, error: null, ticket: { legs, chain, codigo, analisis: { ...analisis, est } } });
    } catch (error) {
      setEstado({ busy: false, error, ticket: null });
    }
  };
  const t = estado.ticket;
  return (
    <>
      <button ref={boton} type="button" className={className} onClick={abrir} disabled={disabled || estado.busy} aria-busy={estado.busy}>
        {estado.busy ? 'Preparando…' : label || (estrategiaCodigo ? 'Operar ' + (ESTRATEGIA_LABELS[estrategiaCodigo] || estrategiaCodigo) : 'Operar')}
      </button>
      {estado.error && <ErrorMessage error={estado.error} title="No se pudo preparar la orden" />}
      {t && (
        <TicketOrden
          open empresa={empresa} chain={t.chain} legs={t.legs} estrategiaCodigo={t.codigo} analisis={t.analisis} abridor={boton.current}
          onClose={() => setEstado({ busy: false, error: null, ticket: null })}
        />
      )}
    </>
  );
}
