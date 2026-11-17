// Búsqueda de activos (GET /activos/busqueda) con respaldo local sobre las empresas registradas.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../../components/Badge';
import { Empty, Loading, Notice } from '../../components/States';
import { useAsync } from '../../hooks/useAsync';
import { activos, empresas } from '../../api/resources';

const aItem = e => ({ simbolo: e.simbolo, nombre: e.nombre, mercado: e.mercado, registrada: true, empresaId: e._id });

export default function Buscador({ seleccionado, onSelect, version }) {
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const lista = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const registradas = useAsync(() => empresas.list({ limit: 100 }), [version]);
  const locales = useMemo(() => (registradas.data?.items || []).map(aItem), [registradas.data]);

  const remoto = useAsync(async () => {
    try {
      const r = await activos.buscar(q, 20);
      return { items: r?.items || [], total: r?.total ?? r?.items?.length ?? 0, fallback: false };
    } catch {
      return { items: [], total: 0, fallback: true };
    }
  }, [q, version], { enabled: q.length > 0 });

  let items; let aviso = null; let cargando = false;
  if (!q) {
    items = locales; cargando = registradas.loading && !registradas.data;
  } else if (remoto.data?.fallback) {
    const n = q.toLowerCase();
    items = locales.filter(e => e.simbolo.toLowerCase().includes(n) || (e.nombre || '').toLowerCase().includes(n));
    aviso = 'La búsqueda global no está disponible; se filtran solo las empresas registradas.';
  } else {
    items = remoto.data?.items || []; cargando = remoto.loading && !remoto.data;
  }

  const botones = () => [...(lista.current?.querySelectorAll('button.resultado') || [])];
  const onKeyLista = e => {
    if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const b = botones(); const i = b.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') b[Math.min(b.length - 1, i + 1)]?.focus();
    else if (i <= 0) input.current?.focus(); else b[i - 1].focus();
  };
  const onKeyInput = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); botones()[0]?.focus(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const sym = texto.trim().toUpperCase();
      const hit = items.find(i => i.simbolo === sym) || (items.length === 1 ? items[0] : null);
      if (hit) onSelect(hit.simbolo);
      else if (/^[A-Z][A-Z0-9.]{0,9}$/.test(sym)) onSelect(sym);
    }
  };

  return (
    <section className="card buscador" aria-label="Búsqueda de empresas">
      <div className="card__header"><h2>Buscar empresa</h2></div>
      <label className="sr-only" htmlFor="buscar-activo">Buscar por símbolo o nombre</label>
      <input
        id="buscar-activo" ref={input} type="search" className="buscador__input" value={texto} autoComplete="off"
        placeholder="Símbolo o nombre (AAPL, Tesla…)" onChange={e => setTexto(e.target.value)} onKeyDown={onKeyInput}
        aria-controls="resultados-busqueda"
      />
      {aviso && <Notice tone="warning">{aviso}</Notice>}
      <p className="muted small">{q ? 'Resultados' : 'Empresas registradas'}{items.length ? ` (${items.length})` : ''}</p>
      {cargando && <Loading text="Buscando…" />}
      {!cargando && !items.length && <Empty title={q ? 'Sin resultados' : 'Sin empresas registradas'}>{q ? 'Prueba con otro símbolo o nombre. Con Enter abres el símbolo escrito.' : 'Busca un símbolo para empezar.'}</Empty>}
      {items.length > 0 && (
        <ul id="resultados-busqueda" className="resultados" ref={lista} onKeyDown={onKeyLista}>
          {items.map(it => (
            <li key={it.simbolo + (it.mercado || '')}>
              <button type="button" className={'resultado' + (it.simbolo === seleccionado ? ' is-active' : '')} aria-current={it.simbolo === seleccionado ? 'true' : undefined} onClick={() => onSelect(it.simbolo)}>
                <span className="resultado__sym">{it.simbolo}</span>
                <span className="resultado__name">{it.nombre || '—'}{it.mercado ? <small className="muted"> · {it.mercado}</small> : null}</span>
                <span className="resultado__badges">
                  {it.registrada && <Badge tone="success">Analizada</Badge>}
                  {it.opciones && <Badge tone="info">Opciones</Badge>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
