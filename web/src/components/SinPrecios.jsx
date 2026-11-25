// Vencimiento que existe pero todavía no tiene precios, con el atajo al más cercano que sí los tiene.
import { Notice } from './States';
import { diasHasta, sinPrecios, vencimientosConPrecio, vencimientosVigentes } from '../utils/estrategiasOrden';
import { fmtDate } from '../utils/format';

/** Texto de un vencimiento en los selectores; avisa si aún no tiene precios. */
export const etiquetaVencimiento = (v, detalle = []) => `${fmtDate(v)}, ${diasHasta(v)} días${detalle.some(d => d.vencimiento === v && d.conPrecio === 0) ? ', sin precios' : ''}`;

export default function SinPrecios({ chain, onCambiar }) {
  if (!chain?.vencimiento || !sinPrecios(chain.items)) return null;
  const otros = vencimientosConPrecio(vencimientosVigentes(chain.vencimientos), chain.detalleVencimientos).filter(v => v !== chain.vencimiento);
  const actual = diasHasta(chain.vencimiento);
  const cercano = otros.reduce((a, b) => (a == null || Math.abs(diasHasta(b) - actual) < Math.abs(diasHasta(a) - actual) ? b : a), null);
  return (
    <Notice tone="warning" title="Este vencimiento todavía no tiene precios.">
      {cercano
        ? <>Suele pasar cuando se acaba de listar: no hay un último precio que mostrar porque nadie lo ha negociado. {onCambiar && <button type="button" className="enlace" onClick={() => onCambiar(cercano)}>Ver el {fmtDate(cercano)}, que sí tiene</button>}</>
        : 'Ningún vencimiento guardado tiene precios. Sincroniza los contratos.'}
    </Notice>
  );
}
