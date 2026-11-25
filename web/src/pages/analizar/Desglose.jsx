// De dónde sale el puntaje de una estrategia: aporte de cada core más los ajustes; la columna «Puntos» suma el puntaje final.
import { ScoreBar } from '../../components/Gauge';
import { Termino } from '../../components/Termino';
import { CORE_LABELS, ESTRATEGIA_LABELS } from '../../utils/constants';
import { desglosePuntaje, direccion, textoPuntaje } from '../../utils/estrategiasOrden';
import { fmtPct, isNum } from '../../utils/format';

const pts = (v, signo = false) => (isNum(v) ? (signo && v > 0 ? '+' : '') + textoPuntaje(v) : '—');

export default function Desglose({ fila, datos, detalle, config }) {
  const cores = datos.seleccion?.coresSeleccionados || [];
  const condor = fila.codigo === 'IRON_CONDOR';
  const d = desglosePuntaje(fila.codigo, cores, detalle?.conf.ponderaciones, detalle?.evaluaciones || datos.evaluaciones, fila.puntaje, fila.motivos);
  const ajuste = (titulo, nota, valor) => (
    <tr className="desglose-ajuste"><th scope="row">{titulo}</th><td colSpan="3" className="muted small">{nota}</td><td className="num">{pts(valor, true)}</td><td /></tr>
  );
  return (
    <section className="card" aria-labelledby="desglose-titulo">
      <h2 id="desglose-titulo">De dónde sale el puntaje de {ESTRATEGIA_LABELS[fila.codigo] || fila.codigo}</h2>
      <div className="table-wrap">
        <table className="table table--dense">
          <caption className="sr-only">Aporte de cada core</caption>
          <thead><tr><th scope="col"><Termino id="core">Core</Termino></th><th scope="col">Lectura</th><th scope="col" className="num">Calificación</th><th scope="col" className="num">Importancia</th><th scope="col" className="num">Puntos</th><th scope="col"><span className="sr-only">Barra</span></th></tr></thead>
          <tbody>
            {d.filas.map(f => {
              const dir = direccion(f.ev?.puntaje);
              return (
                <tr key={f.core}>
                  <th scope="row">{CORE_LABELS[f.core]}</th>
                  <td>{f.ev ? <span className={'dir dir--' + dir.tono}>{dir.texto}</span> : <span className="muted">Sin evaluación</span>}</td>
                  <td className="num">{textoPuntaje(f.calif)}</td>
                  <td className="num">{isNum(f.peso) ? fmtPct(f.peso, 0) : '—'}</td>
                  <td className="num">{pts(f.puntos)}</td>
                  <td className="desglose-barra"><ScoreBar value={f.calif} label={'Calificación de ' + CORE_LABELS[f.core]} /></td>
                </tr>
              );
            })}
          </tbody>
          {d.subtotal != null && (
            <tfoot>
              <tr><th scope="row" colSpan="4">Suma de los cores</th><td className="num">{pts(d.subtotal)}</td><td /></tr>
              {condor
                ? ajuste(<Termino id="dispersion">Dispersión</Termino>, 'No se descuenta: el Iron Condor promedia la neutralidad de cada core.', 0)
                : ajuste(<Termino id="dispersion">Dispersión</Termino>, detalle?.est ? `Descuento por desacuerdo entre cores (dispersión ${detalle.est.dispersion.toFixed(2)}): acerca el puntaje a 50.` : 'Descuento por desacuerdo entre cores: acerca el puntaje a 50.', d.dispersion)}
              {ajuste('Ajuste IV/HV', condor ? (d.motivoIv ? `${d.motivoIv}; máximo ±15 puntos, sin pasar de 0–100.` : 'Sin datos de IV/HV.') : 'Solo aplica al Iron Condor.', condor ? d.ajusteIv : 0)}
              <tr className="desglose-total"><th scope="row" colSpan="4">Puntaje final</th><td className="num"><strong>{pts(d.final)}</strong></td><td /></tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="muted small">Calificación: qué tan favorable es la lectura del core para esta estrategia. Importancia: peso × <Termino id="confianza">confianza</Termino>. <Termino id="cobertura">Cobertura</Termino> de cores {fmtPct(fila.cobertura)}. Pesos configurados: {cores.map(c => `${CORE_LABELS[c]} ${config.cores[c]?.peso ?? 1}`).join(', ')}.</p>
      {fila.motivos?.length > 0 && <details className="details"><summary>Motivos del puntaje</summary><ul className="list list--compact">{fila.motivos.map((m, i) => <li key={i}>{m}</li>)}</ul></details>}
    </section>
  );
}
