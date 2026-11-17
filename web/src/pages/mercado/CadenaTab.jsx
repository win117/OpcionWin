import { useMemo, useState } from 'react';
import { SyncButton } from '../../components/SyncButton';
import { SourceLine } from '../../components/Source';
import { Table } from '../../components/Table';
import { Field, Select } from '../../components/Field';
import { Empty, ErrorMessage } from '../../components/States';
import { useLookup } from '../../hooks/useLookup';
import { contratos, mercado } from '../../api/resources';
import { fmtFixed, fmtMoney, fmtPct, fmtDate } from '../../utils/format';

/** Normaliza la respuesta de la cadena: acepta arreglo, {items}, {contratos} y snapshot anidado. */
export function normalizeChain(data) {
  const list = Array.isArray(data) ? data : data?.items || data?.contratos || data?.cadena || [];
  return list.map((c, i) => {
    const snap = c.snapshot || c.datos || {};
    return {
      _id: c._id || c.contratoExternoId || c.simbolo || String(i),
      simbolo: c.simbolo || c.contratoExternoId,
      tipo: c.tipo,
      strike: c.strike,
      vencimiento: c.vencimiento,
      bid: c.bid ?? snap.bid,
      ask: c.ask ?? snap.ask,
      ultimo: c.ultimo ?? snap.ultimo,
      iv: c.volatilidadImplicita ?? snap.volatilidadImplicita,
      griegas: c.griegas || snap.griegas || {},
      fuente: c.fuente || snap.fuente,
    };
  }).sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0));
}

export default function CadenaTab({ empresa, simbolo }) {
  const stored = useLookup(contratos, { empresaId: empresa._id });
  const [tipo, setTipo] = useState('call');
  const [vencimiento, setVencimiento] = useState('');
  const [result, setResult] = useState({ busy: false, data: null, error: null });

  const vencimientos = useMemo(() => {
    const set = new Set(stored.items.map(c => String(c.vencimiento).slice(0, 10)));
    return [...set].sort();
  }, [stored.items]);

  const consultar = async event => {
    event?.preventDefault();
    setResult({ busy: true, data: null, error: null });
    try {
      const data = await mercado.cadena(simbolo, { vencimiento, tipo });
      setResult({ busy: false, data, error: null });
    } catch (error) {
      setResult({ busy: false, data: null, error });
    }
  };

  const rows = result.data ? normalizeChain(result.data) : [];
  const fuente = result.data?.fuente || rows.find(r => r.fuente)?.fuente;

  return (
    <div className="stack">
      <form className="toolbar" onSubmit={consultar}>
        <Field label="Tipo" className="field--inline">
          <Select value={tipo} onChange={setTipo} options={[{ value: 'call', label: 'Calls' }, { value: 'put', label: 'Puts' }]} />
        </Field>
        <Field label="Vencimiento" className="field--inline" help={vencimientos.length ? `${vencimientos.length} vencimientos con contratos almacenados` : 'Opcional; vacío = el proveedor decide'}>
          <input type="date" value={vencimiento} onChange={e => setVencimiento(e.target.value)} list="vencimientos-almacenados" />
        </Field>
        <datalist id="vencimientos-almacenados">{vencimientos.map(v => <option key={v} value={v} />)}</datalist>
        <button type="submit" className="btn btn--primary btn--sm" disabled={result.busy}>{result.busy ? 'Consultando…' : 'Consultar cadena'}</button>
        <div className="toolbar__spacer" />
        <SyncButton recurso="contratos" simbolos={[simbolo]} onDone={stored.reload} label="Sincronizar contratos" />
      </form>
      {vencimientos.length > 0 && (
        <div className="chips" aria-label="Vencimientos almacenados">
          {vencimientos.slice(0, 12).map(v => (
            <button key={v} type="button" className={'chip' + (v === vencimiento ? ' is-active' : '')} onClick={() => setVencimiento(v)}>{fmtDate(v)}</button>
          ))}
        </div>
      )}
      <ErrorMessage error={result.error} />
      {!result.data && !result.error && <Empty title="Sin consulta">Elige tipo y vencimiento, luego «Consultar cadena». Los datos provienen del proveedor (griegas indicativas).</Empty>}
      {result.data && (
        <>
          <Table
            dense
            rows={rows}
            emptyTitle="El proveedor no devolvió contratos para estos filtros"
            columns={[
              { key: 'strike', label: 'Strike', align: 'right', render: r => <strong>{fmtFixed(r.strike, 2)}</strong> },
              { key: 'vencimiento', label: 'Vencimiento', render: r => fmtDate(r.vencimiento) },
              { key: 'bid', label: 'Bid', align: 'right', render: r => fmtMoney(r.bid) },
              { key: 'ask', label: 'Ask', align: 'right', render: r => fmtMoney(r.ask) },
              { key: 'iv', label: 'IV', align: 'right', render: r => fmtPct(r.iv, 1) },
              { key: 'delta', label: 'Delta', align: 'right', render: r => fmtFixed(r.griegas.delta, 3) },
              { key: 'gamma', label: 'Gamma', align: 'right', render: r => fmtFixed(r.griegas.gamma, 4) },
              { key: 'theta', label: 'Theta', align: 'right', render: r => fmtFixed(r.griegas.theta, 4) },
              { key: 'vega', label: 'Vega', align: 'right', render: r => fmtFixed(r.griegas.vega, 4) },
            ]}
          />
          <SourceLine fuente={fuente} extra="griegas indicativas del proveedor" />
        </>
      )}
    </div>
  );
}
