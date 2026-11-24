import { useState } from 'react';
import { SyncButton } from '../../components/SyncButton';
import { SourceLine, KeyValue } from '../../components/Source';
import { Termino } from '../../components/Termino';
import { Empty, ErrorMessage, Loading } from '../../components/States';
import { useAsync } from '../../hooks/useAsync';
import { listLatest, mercado } from '../../api/resources';
import { fmtMoney, isNum } from '../../utils/format';

function Quote({ bid, ask, ultimo }) {
  const spread = isNum(bid) && isNum(ask) ? ask - bid : null;
  return (
    <dl className="stats stats--row">
      <div><dt>Bid</dt><dd>{fmtMoney(bid)}</dd></div>
      <div><dt>Ask</dt><dd>{fmtMoney(ask)}</dd></div>
      <div><dt>Último</dt><dd>{fmtMoney(ultimo)}</dd></div>
      <div><dt><Termino id="spread">Spread</Termino></dt><dd>{fmtMoney(spread)}</dd></div>
    </dl>
  );
}

export default function CotizacionTab({ simbolo }) {
  const stored = useAsync(() => listLatest(p => mercado.cotizaciones(simbolo, p), {}, { dateOf: r => r.fuente?.fechaDato, limit: 1 }), [simbolo]);
  const [live, setLive] = useState({ busy: false, data: null, error: null });
  const latest = stored.data?.items?.[0];

  const consultar = async () => {
    setLive({ busy: true, data: null, error: null });
    try {
      setLive({ busy: false, data: await mercado.cotizacionEnVivo(simbolo), error: null });
    } catch (error) {
      setLive({ busy: false, data: null, error });
    }
  };

  const d = live.data;
  return (
    <div className="grid grid--2">
      <section className="stack">
        <div className="section-head">
          <h3>Última cotización almacenada</h3>
          <SyncButton recurso="cotizaciones" simbolos={[simbolo]} onDone={stored.reload} />
        </div>
        {stored.loading && !stored.data && <Loading />}
        <ErrorMessage error={stored.error} onRetry={stored.reload} />
        {stored.data && !latest && <Empty title="Sin cotizaciones almacenadas">Sincroniza para guardar una cotización.</Empty>}
        {latest && (
          <>
            <Quote bid={latest.bid} ask={latest.ask} ultimo={latest.ultimo} />
            <SourceLine fuente={latest.fuente} />
          </>
        )}
      </section>
      <section className="stack">
        <div className="section-head">
          <h3>Cotización en vivo</h3>
          <button type="button" className="btn btn--sm" onClick={consultar} disabled={live.busy}>{live.busy ? 'Consultando…' : 'Consultar proveedor'}</button>
        </div>
        <p className="muted small">Consulta directa al proveedor; no se guarda en la base.</p>
        <ErrorMessage error={live.error} />
        {d && (
          <>
            <Quote bid={d.bid} ask={d.ask} ultimo={d.ultimo ?? d.precio ?? d.ultimoPrecio} />
            {d.fuente ? <SourceLine fuente={d.fuente} /> : (
              <details className="details"><summary>Respuesta del proveedor</summary><KeyValue data={d} /></details>
            )}
          </>
        )}
        {!d && !live.error && !live.busy && <Empty title="Sin consulta" accion={<button type="button" className="btn btn--sm" onClick={consultar}>Consultar proveedor</button>} />}
      </section>
    </div>
  );
}
