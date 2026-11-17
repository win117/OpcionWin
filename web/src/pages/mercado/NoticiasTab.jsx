import { SyncButton } from '../../components/SyncButton';
import { Empty, ErrorMessage, Loading, Notice } from '../../components/States';
import { useAsync } from '../../hooks/useAsync';
import { listLatest, noticias } from '../../api/resources';
import { fmtDateTime } from '../../utils/format';

const safeUrl = url => (typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null);

export default function NoticiasTab({ simbolo }) {
  // El filtro exacto del CRUD no sirve para arreglos con varios símbolos: se filtra en el cliente.
  const state = useAsync(async () => {
    const all = await listLatest(noticias, {}, { dateOf: r => r.publicadaEn, maxPages: 10 });
    return { ...all, items: all.items.filter(n => (n.simbolos || []).map(s => s.toUpperCase()).includes(simbolo)).slice(0, 50) };
  }, [simbolo]);
  const items = state.data?.items || [];

  return (
    <div className="stack">
      <div className="toolbar">
        <SyncButton recurso="noticias" simbolos={[simbolo]} onDone={state.reload} label="Sincronizar noticias" />
      </div>
      <Notice>El sentimiento de estas noticias lo calcula el core «Noticias» en la sección Análisis.</Notice>
      {state.loading && !state.data && <Loading />}
      <ErrorMessage error={state.error} onRetry={state.reload} />
      {state.data && !items.length && <Empty title={`Sin noticias almacenadas para ${simbolo}`}>Sincroniza para obtener noticias recientes.</Empty>}
      <ul className="news">
        {items.map(n => {
          const url = safeUrl(n.url);
          return (
            <li key={n._id} className="news__item">
              <h4>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{n.titulo}</a> : n.titulo}</h4>
              {n.resumen && <p>{n.resumen}</p>}
              <p className="source">
                {n.proveedor} · publicada {fmtDateTime(n.publicadaEn)}
                {n.idioma && <> · {n.idioma}</>}
                {n.simbolos?.length > 1 && <> · {n.simbolos.join(', ')}</>}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
