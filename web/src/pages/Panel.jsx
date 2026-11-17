import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { IntegrationStatus } from '../components/IntegrationStatus';
import { Badge } from '../components/Badge';
import { Table } from '../components/Table';
import { Loading, ErrorMessage } from '../components/States';
import { useAsync } from '../hooks/useAsync';
import { useLookup } from '../hooks/useLookup';
import { empresas, configuraciones, evaluaciones, sincronizaciones, listLatest } from '../api/resources';
import { CORE_LABELS, DISCLAIMER } from '../utils/constants';
import { fmtDateTime, fmtInt, fmtNum, fmtPct } from '../utils/format';

function Count({ label, state, to }) {
  return (
    <Link to={to} className="stat-card">
      <span className="stat-card__label">{label}</span>
      <span className="stat-card__value">
        {state.loading ? '…' : state.error ? '—' : fmtInt(state.data?.total ?? 0)}
      </span>
      {state.error && <span className="field__error">{state.error.message}</span>}
    </Link>
  );
}

function AnalizarRapido({ empresas: lista }) {
  const [texto, setTexto] = useState('');
  const navigate = useNavigate();
  const submit = e => {
    e.preventDefault();
    const sym = texto.trim().toUpperCase();
    if (sym) navigate('/analizar?q=' + encodeURIComponent(sym));
  };
  return (
    <section className="card">
      <div className="card__header">
        <div>
          <h2>Buscar empresa</h2>
          <p className="muted">Busca por símbolo o nombre, revisa sus datos y analízala con los cores que elijas.</p>
        </div>
      </div>
      <form className="search" onSubmit={submit}>
        <label className="sr-only" htmlFor="panel-simbolo">Símbolo</label>
        <input id="panel-simbolo" className="search__input" value={texto} onChange={e => setTexto(e.target.value.toUpperCase())} placeholder="AAPL, MSFT, NVDA…" autoComplete="off" />
        <button type="submit" className="btn btn--primary" disabled={!texto.trim()}>Buscar</button>
      </form>
      {lista.length > 0 && (
        <div className="chips" aria-label="Empresas registradas">
          <span className="muted small">Empresas registradas:</span>
          {lista.map(e => <Link key={e._id} to={'/analizar/' + e.simbolo} className="chip">{e.simbolo}</Link>)}
        </div>
      )}
    </section>
  );
}

const QUICK = [
  { to: '/empresas', label: 'Registrar empresa', text: 'Alta de símbolos y CIK para fundamentales.' },
  { to: '/mercado', label: 'Ver mercado', text: 'Velas, cotización, cadena de opciones y sincronización.' },
  { to: '/analisis', label: 'Evaluar cores', text: 'Técnico, fundamental, institucional, indicadores y noticias.' },
  { to: '/seleccion', label: 'Selección y confluencia', text: 'Combina cores y ordena compatibilidad por estrategia.' },
  { to: '/configuraciones', label: 'Configurar estrategia', text: 'Patas, métricas y gráfico de pago.' },
  { to: '/broker', label: 'Órdenes paper', text: 'Envía órdenes a Alpaca paper (sin dinero real).' },
];

export default function Panel() {
  const { integraciones } = useOutletContext();
  const cEmpresas = useAsync(() => empresas.list({ limit: 100 }), []);
  const cConfig = useAsync(() => configuraciones.list({ limit: 1 }), []);
  const cEval = useAsync(() => evaluaciones.list({ limit: 1 }), []);
  const recientes = useAsync(() => listLatest(evaluaciones, {}, { limit: 8, maxPages: 10 }), []);
  const syncs = useAsync(() => listLatest(sincronizaciones, {}, { limit: 5, maxPages: 10 }), []);
  const empresasLookup = useLookup(empresas);

  return (
    <>
      <PageHeader title="Resumen" subtitle="Resumen de tu espacio de análisis" />
      <AnalizarRapido empresas={cEmpresas.data?.items || []} />
      <div className="grid grid--stats">
        <Count label="Empresas" state={cEmpresas} to="/empresas" />
        <Count label="Configuraciones" state={cConfig} to="/configuraciones" />
        <Count label="Evaluaciones" state={cEval} to="/analisis" />
        <div className="stat-card">
          <span className="stat-card__label">Integraciones</span>
          <IntegrationStatus state={integraciones} />
          <button type="button" className="btn btn--sm btn--ghost" onClick={integraciones.reload}>Reconsultar</button>
        </div>
      </div>

      <section className="card">
        <h2>Acciones rápidas</h2>
        <div className="grid grid--quick">
          {QUICK.map(q => (
            <Link key={q.to} to={q.to} className="quick">
              <strong>{q.label}</strong>
              <span className="muted">{q.text}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid--2">
        <section className="card">
          <h2>Evaluaciones recientes</h2>
          {recientes.loading && !recientes.data ? <Loading /> : (
            <Table
              dense
              error={recientes.error}
              onRetry={recientes.reload}
              rows={recientes.data?.items || []}
              emptyText="Ejecuta una evaluación desde Análisis."
              columns={[
                { key: 'core', label: 'Core', render: r => CORE_LABELS[r.core] || r.core },
                { key: 'empresa', label: 'Empresa', render: r => empresasLookup.byId.get(r.empresaId)?.simbolo || (r.core === 'configuracion' ? 'Configuración' : '—') },
                { key: 'puntaje', label: 'Puntaje', align: 'right', render: r => fmtNum(r.puntaje, 0) },
                { key: 'cobertura', label: 'Cobertura', align: 'right', render: r => fmtPct(r.cobertura) },
                { key: 'estado', label: 'Estado', render: r => <Badge value={r.estado} /> },
                { key: 'fecha', label: 'Fecha', render: r => fmtDateTime(r.createdAt) },
              ]}
            />
          )}
        </section>
        <section className="card">
          <h2>Últimas sincronizaciones</h2>
          {syncs.loading && !syncs.data ? <Loading /> : syncs.error ? <ErrorMessage error={syncs.error} onRetry={syncs.reload} /> : (
            <Table
              dense
              rows={syncs.data?.items || []}
              emptyText="Aún no hay sincronizaciones."
              columns={[
                { key: 'recurso', label: 'Recurso' },
                { key: 'simbolos', label: 'Símbolos', render: r => r.simbolos?.join(', ') || '—' },
                { key: 'estado', label: 'Estado', render: r => <Badge value={r.estado} /> },
                { key: 'fecha', label: 'Fecha', render: r => fmtDateTime(r.createdAt) },
              ]}
            />
          )}
        </section>
      </div>
      <p className="disclaimer">{DISCLAIMER}</p>
    </>
  );
}
