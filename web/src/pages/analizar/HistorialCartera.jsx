// Valor diario de la cuenta simulada. Solo si el broker lo ofrece.
import { useState } from 'react';
import GraficaLinea from '../../components/GraficaLinea';
import { Spinner } from '../../components/States';
import { useAsync } from '../../hooks/useAsync';
import { operacion } from '../../api/resources';

const PERIODOS = [['1W', '1 semana'], ['1M', '1 mes'], ['3M', '3 meses'], ['1A', '1 año']];

export default function HistorialCartera({ broker, nombre }) {
  const [periodo, setPeriodo] = useState('1M');
  const { data: d, error, loading } = useAsync(() => operacion.historial(broker, periodo), [broker, periodo]);
  if (error) return <p className="muted small">Historial de la cuenta: no disponible ({error.message})</p>;
  if (d && !d.disponible) return <p className="muted small">{nombre} no ofrece el historial de la cuenta.</p>;
  return (
    <section className="historial-cartera" aria-labelledby="historial-titulo">
      <div className="section-head">
        <h3 id="historial-titulo">Valor de la cuenta</h3>
        <div className="mapa__grupo" role="group" aria-label="Periodo">
          {PERIODOS.map(([id, t]) => <button key={id} type="button" className="mapa__op" aria-pressed={id === periodo} onClick={() => setPeriodo(id)}>{t}</button>)}
        </div>
      </div>
      {!d ? <p className="muted small" role="status"><Spinner small /> Cargando historial…</p>
        : d.items.length < 2 ? <p className="muted small">Aún no hay suficientes días para dibujarlo.</p>
          : <div aria-busy={loading}><GraficaLinea puntos={d.items} height={180} etiqueta="Valor de la cuenta simulada" /></div>}
    </section>
  );
}
