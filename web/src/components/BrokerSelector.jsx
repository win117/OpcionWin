import { useId } from 'react';
import { useBroker } from '../context/BrokerContext';

/** Selector del broker con el que se opera: «Alpaca paper». */
export function BrokerSelector() {
  const { broker, setBroker, disponibles, info, error, verificado } = useBroker();
  const id = useId();
  const nota = info?.mensaje || (error ? 'No se pudo consultar la disponibilidad de brokers; se asume el estado habitual.' : '');
  return (
    <div className="broker-sel" title={nota || undefined}>
      <svg className="broker-sel__icono" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 10h16M6 10v8m4-8v8m4-8v8m4-8v8M3 20h18M12 3l9 5H3z" /></svg>
      <label htmlFor={id} className="sr-only">Broker para operar</label>
      <select id={id} value={broker} onChange={e => setBroker(e.target.value)} aria-describedby={nota ? id + '-n' : undefined}>
        {disponibles.map(b => (
          <option key={b.codigo} value={b.codigo}>
            {b.nombre} {b.entornos?.[0] || 'paper'}{verificado && b.operativo === false ? ' (no operativo)' : ''}
          </option>
        ))}
      </select>
      {info?.operativo === false && <span className="broker-sel__aviso" aria-hidden="true">!</span>}
      {nota && <span id={id + '-n'} className="sr-only">{nota}</span>}
    </div>
  );
}
