// Botón «Operar»: arma las patas de la estrategia con la cadena actual y abre el ticket de orden paper.
import { useState } from 'react';
import TicketOrden from './TicketOrden';
import { ErrorMessage } from './States';
import { estrategias, evaluaciones, mercado, selecciones } from '../api/resources';
import { CORES, ESTRATEGIA_LABELS } from '../utils/constants';
import { leerConfig } from '../pages/analizar/flujo';
import { construirPatas, contextoAnalisis, elegirVencimiento } from '../utils/estrategiasOrden';

/** Carga selección completada más reciente, catálogo de estrategias y últimas evaluaciones por core. */
export async function cargarDatosAnalisis(empresa) {
  const [sel, est, evs] = await Promise.all([
    selecciones.list({ empresaId: empresa._id, modo: 'empresa', estado: 'completada', limit: 1 }).catch(() => ({ items: [] })),
    estrategias.list({ limit: 100 }).catch(() => ({ items: [] })),
    Promise.all(CORES.map(core => evaluaciones.list({ empresaId: empresa._id, core, estado: 'completada', limit: 1 }).then(r => [core, r.items?.[0]]).catch(() => [core, null]))),
  ]);
  return { seleccion: sel.items?.[0], estrategiasById: new Map((est.items || []).map(e => [e._id, e])), evaluaciones: Object.fromEntries(evs) };
}

/** Cadena del primer vencimiento con ≥ diasMin días (y ≤ diasMax si es posible), si no el más cercano. */
export async function cargarCadena(simbolo, { diasMin = 7, diasMax = null } = {}) {
  let d = await mercado.opcionesResumen(simbolo, {});
  const venc = elegirVencimiento(d.vencimientos || (d.vencimiento ? [d.vencimiento] : []), new Date(), diasMin, diasMax);
  if (venc && venc !== d.vencimiento) d = await mercado.opcionesResumen(simbolo, { vencimiento: venc });
  return d;
}

/**
 * Props: empresa, estrategiaCodigo (si falta se usa la mejor clasificada, o LONG_CALL sin selección),
 * datos (opcional, ya cargados: { seleccion, estrategiasById, evaluaciones }), label, className.
 */
export default function BotonOperar({ empresa, estrategiaCodigo, datos, label, className = 'btn btn--primary', disabled, diasMin, diasMax }) {
  const [estado, setEstado] = useState({ busy: false, error: null, ticket: null });

  const abrir = async () => {
    setEstado({ busy: true, error: null, ticket: null });
    const cfg = leerConfig(); // rango de días de la configuración de análisis (localStorage)
    const rango = { diasMin: diasMin ?? cfg.diasMin, diasMax: diasMax ?? cfg.diasMax };
    try {
      const [d, chain] = await Promise.all([datos ? Promise.resolve(datos) : cargarDatosAnalisis(empresa), cargarCadena(empresa.simbolo, rango)]);
      let codigo = estrategiaCodigo;
      if (!codigo) codigo = contextoAnalisis(d, null).topCodigo || 'LONG_CALL';
      const { legs, error } = construirPatas(codigo, chain.items || [], chain.precioSubyacente);
      if (error) throw new Error(error);
      setEstado({ busy: false, error: null, ticket: { legs, chain, codigo, analisis: contextoAnalisis(d, codigo) } });
    } catch (error) {
      setEstado({ busy: false, error, ticket: null });
    }
  };
  const t = estado.ticket;
  return (
    <>
      <button type="button" className={className} onClick={abrir} disabled={disabled || estado.busy} aria-busy={estado.busy}>
        {estado.busy ? 'Preparando…' : label || (estrategiaCodigo ? 'Operar ' + (ESTRATEGIA_LABELS[estrategiaCodigo] || estrategiaCodigo) : 'Operar')}
      </button>
      {estado.error && <ErrorMessage error={estado.error} title="No se pudo preparar la orden" />}
      {t && (
        <TicketOrden
          open empresa={empresa} chain={t.chain} legs={t.legs} estrategiaCodigo={t.codigo} analisis={t.analisis}
          onClose={() => setEstado({ busy: false, error: null, ticket: null })}
        />
      )}
    </>
  );
}
