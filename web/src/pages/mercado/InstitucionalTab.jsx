import { SyncButton } from '../../components/SyncButton';
import { SourceLine } from '../../components/Source';
import { Table } from '../../components/Table';
import { Empty, ErrorMessage, Loading, Notice } from '../../components/States';
import { useAsync } from '../../hooks/useAsync';
import { listLatest, mercado } from '../../api/resources';
import { fmtDate, fmtInt, fmtMoney, fmtCompact, fmtSigned, isNum } from '../../utils/format';

const sum = (list, key) => list.reduce((s, t) => s + (Number.isFinite(t[key]) ? t[key] : 0), 0);

export default function InstitucionalTab({ simbolo }) {
  const state = useAsync(() => listLatest(p => mercado.institucional(simbolo, p), {}, { dateOf: r => r.fechaCorte }), [simbolo]);
  const reportes = state.data?.items || [];
  const [actual, anterior] = reportes;
  const previas = new Map((anterior?.tenencias || []).map(t => [t.identificadorInstitucion, t]));
  const rows = (actual?.tenencias || [])
    .map(t => {
      const prev = previas.get(t.identificadorInstitucion);
      return { ...t, cambio: anterior ? (prev ? t.acciones - prev.acciones : null) : undefined, nueva: Boolean(anterior && !prev) };
    })
    .sort((a, b) => b.acciones - a.acciones);
  const totalActual = actual ? sum(actual.tenencias || [], 'acciones') : null;
  const totalAnterior = anterior ? sum(anterior.tenencias || [], 'acciones') : null;
  const aumentan = rows.filter(r => r.cambio > 0 || r.nueva).length;
  const disminuyen = rows.filter(r => r.cambio < 0).length;

  return (
    <div className="stack">
      <div className="toolbar">
        <SyncButton recurso="institucional" simbolos={[simbolo]} onDone={state.reload} label="Sincronizar 13F" />
      </div>
      <Notice>Los formularios 13F se publican hasta 45 días después del cierre del trimestre: no son flujo en tiempo real.</Notice>
      {state.loading && !state.data && <Loading />}
      <ErrorMessage error={state.error} onRetry={state.reload} />
      {state.data && !actual && <Empty title="Sin reportes institucionales">Sincroniza para obtener las tenencias 13F.</Empty>}
      {actual && (
        <>
          <dl className="stats stats--row">
            <div><dt>Corte</dt><dd>{fmtDate(actual.fechaCorte)}</dd></div>
            <div><dt>Instituciones</dt><dd>{fmtInt(rows.length)}</dd></div>
            <div><dt>Acciones reportadas</dt><dd>{fmtCompact(totalActual)}</dd></div>
            <div><dt>Cambio vs corte previo</dt><dd>{isNum(totalAnterior) ? fmtCompact(totalActual - totalAnterior) : 'Sin corte previo'}</dd></div>
            {anterior && <div><dt>Aumentan / disminuyen</dt><dd>{aumentan} / {disminuyen}</dd></div>}
          </dl>
          <Table
            dense
            rows={rows}
            rowKey={r => r._id || r.identificadorInstitucion}
            emptyTitle="El reporte no contiene tenencias"
            columns={[
              { key: 'institucion', label: 'Institución' },
              { key: 'acciones', label: 'Acciones', align: 'right', render: r => fmtInt(r.acciones) },
              { key: 'valor', label: 'Valor reportado', align: 'right', render: r => r.unidad?.toUpperCase() === 'USD' ? fmtMoney(r.valorReportado, 0) : `${fmtInt(r.valorReportado)} ${r.unidad || ''}` },
              { key: 'cambio', label: 'Cambio (acciones)', align: 'right', render: r => r.nueva ? 'Nueva' : r.cambio === undefined ? '—' : r.cambio === null ? '—' : <span className={r.cambio > 0 ? 'up' : r.cambio < 0 ? 'down' : ''}>{fmtSigned(r.cambio, 0)}</span> },
            ]}
          />
          <SourceLine fuente={actual.fuente} extra={`corte ${fmtDate(actual.fechaCorte)} · publicado ${fmtDate(actual.fechaPublicacion)}`} />
          {anterior && <SourceLine fuente={anterior.fuente} extra={`corte previo ${fmtDate(anterior.fechaCorte)}`} />}
        </>
      )}
    </div>
  );
}
