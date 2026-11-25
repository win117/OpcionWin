// Resumen de un sector elegido en el mapa: variación ponderada, cuántas suben y la lista completa de la selección.
import { useCallback, useMemo, useState } from 'react';
import { fmtCompact, fmtFixed, fmtMoney, isNum } from '../../utils/format';

const signo = v => (isNum(v) ? (v > 0 ? '+' : '') + fmtFixed(v * 100, 2) + '%' : '—');

export default function ResumenSector({ sector, items, modo, onElegir, onCerrar }) {
  const [todas, setTodas] = useState(false);
  const r = useMemo(() => {
    const con = items.filter(i => isNum(i.cambioPct) && i.capitalizacion > 0);
    const cap = con.reduce((s, i) => s + i.capitalizacion, 0);
    return { cap, cambio: cap ? con.reduce((s, i) => s + i.cambioPct * i.capitalizacion, 0) / cap : null, suben: con.filter(i => i.cambioPct > 0).length, bajan: con.filter(i => i.cambioPct < 0).length };
  }, [items]);
  const valor = useCallback(i => (modo.puntaje ? i.puntajes?.[modo.id] : i[modo.id]) ?? null, [modo]);
  const lista = useMemo(() => [...items].sort((a, b) => (valor(b) ?? -Infinity) - (valor(a) ?? -Infinity)), [items, valor]);
  const texto = v => (!isNum(v) ? '—' : modo.puntaje ? fmtFixed(v, 0) : signo(v));
  return (
    <div className="ficha">
      <div className="ficha__cab">
        <div><h3 tabIndex={-1}>{sector}</h3><p className="muted small">{items.length} empresas, USD {fmtCompact(r.cap)} de capitalización</p></div>
        <button type="button" className="btn btn--sm" onClick={onCerrar}>Ver todo el mercado</button>
      </div>
      <p className="ficha__precio"><strong className={r.cambio >= 0 ? 'up' : 'down'}>{signo(r.cambio)}</strong> <span className="muted small">hoy, ponderado por capitalización. {r.suben} suben y {r.bajan} bajan.</span></p>
      <h4>Ordenadas por: {modo.label}</h4>
      <ol className="ficha__lista">
        {(todas ? lista : lista.slice(0, 15)).map(i => (
          <li key={i.simbolo}>
            <button type="button" data-lista={i.simbolo} onClick={() => onElegir(i.simbolo, `[data-lista="${i.simbolo}"]`)}>
              <span className="ficha__lista-nombre"><strong>{i.simbolo}</strong> <span className="muted small">{i.nombre}</span></span>
              <span>{fmtMoney(i.precio)}</span>
              <span className={modo.puntaje ? undefined : valor(i) >= 0 ? 'up' : 'down'}>{texto(valor(i))}</span>
            </button>
          </li>
        ))}
      </ol>
      {lista.length > 15 && <button type="button" className="btn btn--sm" onClick={() => setTodas(t => !t)}>{todas ? 'Mostrar menos' : `Mostrar las ${lista.length}`}</button>}
    </div>
  );
}
