// Lectura direccional de cada core activo: Alcista / En rango / Bajista, con puntaje, confianza y motivos principales.
// El core Fundamental va primero y destacado: es la tesis de fondo sobre la que se elige la estrategia.
import { direccion, ScoreBar } from '../../components/Gauge';
import { Empty } from '../../components/States';
import { CORE_LABELS } from '../../utils/constants';
import { fmtDateTime, fmtPct, isNum } from '../../utils/format';
import { textoPuntaje } from '../../utils/estrategiasOrden';
import { metrica } from '../../utils/objects';

const ICONO = { up: '▲', down: '▼', flat: '◆', neutral: '·' };
const QUE_SIGNIFICA = {
  up: 'Favorece estrategias alcistas (Long Call).',
  down: 'Favorece estrategias bajistas (Long Put).',
  flat: 'Favorece estrategias de rango (Iron Condor).',
  neutral: 'Sin datos suficientes para una lectura.',
};

function TarjetaCore({ core, ev, destacado }) {
  const dir = direccion(ev?.puntaje);
  const confianza = metrica(ev?.metricas, 'confianza');
  const motivos = (ev?.motivos || []).slice(0, destacado ? 3 : 2);
  return (
    <li className={'lectura lectura--' + dir.tono + (destacado ? ' lectura--destacado' : '')}>
      <div className="lectura__head">
        <span className="lectura__core">{CORE_LABELS[core] || core}</span>
        <span className={'lectura__dir dir dir--' + dir.tono}><span aria-hidden="true">{ICONO[dir.tono]}</span> {ev ? dir.texto : 'Sin evaluar'}</span>
      </div>
      {ev ? (
        <>
          <ScoreBar value={ev.puntaje} label={`Puntaje direccional de ${CORE_LABELS[core]} (0 bajista, 50 en rango, 100 alcista)`} />
          <p className="muted small lectura__meta">
            {isNum(confianza) ? `Confianza ${fmtPct(confianza, 0)} · ` : ''}Cobertura {fmtPct(ev.cobertura, 0)} · {fmtDateTime(ev.finalizadaEn || ev.createdAt)}
          </p>
          <p className="small lectura__sig">{QUE_SIGNIFICA[dir.tono]}</p>
          {motivos.length > 0 && <ul className="list list--compact small">{motivos.map((m, i) => <li key={i}>{m}</li>)}</ul>}
          {ev.datosFaltantes?.length > 0 && <p className="small down">Faltan datos: {ev.datosFaltantes.join(', ')}</p>}
        </>
      ) : (
        <p className="muted small">Pulsa «Analizar» para evaluar este core.</p>
      )}
    </li>
  );
}

/** `evaluaciones` = { core → última evaluación completada }; `coresActivos` = cores con peso > 0 en la configuración. */
export default function LecturaCores({ evaluaciones, coresActivos }) {
  const orden = [...coresActivos].sort((a, b) => (a === 'fundamental' ? -1 : b === 'fundamental' ? 1 : 0));
  const conPuntaje = orden.map(c => evaluaciones?.[c]?.puntaje).filter(isNum);
  const media = conPuntaje.length ? conPuntaje.reduce((s, v) => s + v, 0) / conPuntaje.length : null;
  const global = direccion(media);
  return (
    <section className="card" aria-labelledby="lectura-titulo">
      <div className="card__header">
        <div>
          <h2 id="lectura-titulo">Lectura por core</h2>
          <p className="muted small">¿Va alcista, en rango o bajista? 0–40 bajista · 40–60 en rango · 60–100 alcista.</p>
        </div>
        {isNum(media) && (
          <p className="lectura__global">
            <span className="muted small">Promedio simple</span>
            <span className={'dir dir--' + global.tono}>{ICONO[global.tono]} {global.texto} · {textoPuntaje(media)}</span>
          </p>
        )}
      </div>
      {!orden.length
        ? <Empty title="Sin cores activos">Activa al menos un core en «Configurar cores».</Empty>
        : <ul className="lectura-grid">{orden.map(c => <TarjetaCore key={c} core={c} ev={evaluaciones?.[c]} destacado={c === 'fundamental'} />)}</ul>}
    </section>
  );
}
