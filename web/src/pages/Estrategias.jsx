import { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { ResourceManager } from '../components/ResourceManager';
import { Badge } from '../components/Badge';
import { estrategias, listAll } from '../api/resources';
import { ESTRATEGIA_LABELS, ESTRATEGIA_OPTIONS, DISCLAIMER } from '../utils/constants';

export const EXPLICACIONES = {
  LONG_CALL: {
    sesgo: 'Alcista',
    patas: 'Compra de 1 call.',
    pago: 'Pérdida máxima limitada a la prima pagada. La ganancia potencial crece si el subyacente sube por encima de strike + prima (breakeven) antes o al vencimiento.',
    riesgos: 'Pierde valor con el paso del tiempo (theta) y con caídas de volatilidad implícita.',
  },
  LONG_PUT: {
    sesgo: 'Bajista',
    patas: 'Compra de 1 put.',
    pago: 'Pérdida máxima limitada a la prima pagada. Gana valor si el subyacente cae por debajo de strike − prima (breakeven); la ganancia está acotada porque el precio no baja de cero.',
    riesgos: 'Pierde valor con el tiempo (theta) y si la volatilidad implícita baja.',
  },
  IRON_CONDOR: {
    sesgo: 'Neutral / rango',
    patas: 'Compra put K1 < venta put K2 < venta call K3 < compra call K4, mismo vencimiento y cantidades iguales.',
    pago: 'Se recibe un crédito neto. La ganancia máxima es ese crédito si el subyacente queda entre K2 y K3 al vencimiento. La pérdida máxima es el ancho de un ala menos el crédito.',
    riesgos: 'Movimientos fuertes en cualquier dirección y aumentos de volatilidad implícita perjudican la posición.',
  },
};

const BASE = [
  { codigo: 'LONG_CALL', nombre: 'Long Call', descripcion: 'Compra de una opción call. Sesgo alcista con pérdida limitada a la prima.', activo: true },
  { codigo: 'LONG_PUT', nombre: 'Long Put', descripcion: 'Compra de una opción put. Sesgo bajista con pérdida limitada a la prima.', activo: true },
  { codigo: 'IRON_CONDOR', nombre: 'Iron Condor', descripcion: 'Cuatro patas con crédito neto. Sesgo neutral; ganancia y pérdida acotadas.', activo: true },
];

const FIELDS = [
  { name: 'codigo', label: 'Código', type: 'select', options: ESTRATEGIA_OPTIONS.map(o => ({ value: o.value, label: `${o.value} (${o.label})` })), required: true },
  { name: 'nombre', label: 'Nombre', required: true },
  { name: 'descripcion', label: 'Descripción', type: 'textarea', required: true },
  { name: 'activo', label: 'Activa', type: 'checkbox', default: true },
];

export default function Estrategias() {
  const [signal, setSignal] = useState(0);
  const [seed, setSeed] = useState({ busy: false, message: null, error: null });

  const crearBase = async () => {
    setSeed({ busy: true, message: null, error: null });
    try {
      const { items } = await listAll(estrategias);
      const existentes = new Set(items.map(e => e.codigo));
      const faltantes = BASE.filter(b => !existentes.has(b.codigo));
      if (!faltantes.length) {
        setSeed({ busy: false, message: 'El catálogo ya contiene las tres estrategias.', error: null });
        return;
      }
      const result = await estrategias.createMany(faltantes);
      setSeed({ busy: false, message: `Creadas ${result.exitosos} de ${result.total}.`, error: null });
      setSignal(s => s + 1);
    } catch (error) {
      setSeed({ busy: false, message: null, error });
    }
  };

  return (
    <>
      <PageHeader title="Estrategias" subtitle="Catálogo de estrategias soportadas" />
      <div className="grid grid--3">
        {Object.entries(EXPLICACIONES).map(([codigo, e]) => (
          <article key={codigo} className="card strategy-card">
            <header className="strategy-card__head">
              <h2>{ESTRATEGIA_LABELS[codigo]}</h2>
              <span className={'badge badge--' + (codigo === 'LONG_CALL' ? 'success' : codigo === 'LONG_PUT' ? 'danger' : 'info')}>{e.sesgo}</span>
            </header>
            <dl className="defs">
              <dt>Patas</dt><dd>{e.patas}</dd>
              <dt>Perfil de pago</dt><dd>{e.pago}</dd>
              <dt>Riesgos</dt><dd>{e.riesgos}</dd>
            </dl>
          </article>
        ))}
      </div>
      <p className="disclaimer">{DISCLAIMER}</p>
      {seed.message && <div className="alert alert--success" role="status">{seed.message}</div>}
      {seed.error && <div className="alert alert--danger" role="alert">{seed.error.message}</div>}
      <ResourceManager
        title="Catálogo"
        api={estrategias}
        fields={FIELDS}
        reloadSignal={signal}
        createLabel="Nueva estrategia"
        toolbar={() => (
          <button type="button" className="btn btn--sm" onClick={crearBase} disabled={seed.busy}>
            {seed.busy ? 'Creando…' : 'Crear catálogo base'}
          </button>
        )}
        columns={[
          { key: 'codigo', label: 'Código', render: r => <code>{r.codigo}</code> },
          { key: 'nombre', label: 'Nombre' },
          { key: 'descripcion', label: 'Descripción', className: 'col-wrap' },
          { key: 'activo', label: 'Activa', render: r => <Badge value={r.activo !== false} /> },
        ]}
      />
    </>
  );
}
