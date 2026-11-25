// Lectura direccional de cada core activo: Alcista / En rango / Bajista, con puntaje, confianza y motivos principales.
// El core Fundamental va primero y destacado: es la tesis de fondo sobre la que se elige la estrategia.
import { direccion, ScoreBar } from '../../components/Gauge';
import { Empty } from '../../components/States';
import { Termino } from '../../components/Termino';
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

/** Por qué un core activo no tiene lectura. */
function sinLectura(core, analizados) {
  if (!analizados) return 'Pulsa «Analizar» para evaluar este core.';
  return 'No entró en el último análisis. Vuelve a analizar para incluirlo.';
}

function TarjetaCore({ core, ev, destacado, analizados }) {
  const dir = direccion(ev?.puntaje);
  const confianza = metrica(ev?.metricas, 'confianza');
  const motivos = (ev?.motivos || []).slice(0, destacado ? 3 : 2);
  return (
    <li className={'lectura lectura--' + dir.tono + (destacado ? ' lectura--destacado' : '')}>
      <div className="lectura__head">
        <span className="lectura__core">{CORE_LABELS[core] || core}</span>
        <span className={'lectura__dir dir dir--' + dir.tono}><span aria-hidden="true">{ICONO[dir.tono]}</span> {ev ? (isNum(ev.puntaje) ? dir.texto : 'Sin datos, no opina') : 'Sin evaluar'}</span>
      </div>
      {ev ? (
        <>
          <ScoreBar value={ev.puntaje} label={`Puntaje direccional de ${CORE_LABELS[core]} (0 bajista, 50 en rango, 100 alcista)`} />
          <p className="muted small lectura__meta">
            {isNum(confianza) && <><Termino id="confianza">Confianza</Termino> {fmtPct(confianza, 0)}, </>}<Termino id="cobertura">cobertura</Termino> {fmtPct(ev.cobertura, 0)}, {fmtDateTime(ev.finalizadaEn || ev.createdAt)}
          </p>
          <p className="small lectura__sig">{QUE_SIGNIFICA[dir.tono]}</p>
          {motivos.length > 0 && <ul className="list list--compact small">{motivos.map((m, i) => <li key={i}>{m}</li>)}</ul>}
          {ev.datosFaltantes?.length > 0 && <p className="small aviso-texto">Faltan datos: {ev.datosFaltantes.join(', ')}</p>}
        </>
      ) : (
        <p className="muted small">{sinLectura(core, analizados)}</p>
      )}
    </li>
  );
}

/** `evaluaciones` = { core → última evaluación completada }; `coresActivos` = con peso > 0; `analizados` = los del último análisis (undefined si no hay). */
export default function LecturaCores({ evaluaciones, coresActivos, analizados }) {
  const orden = [...coresActivos].sort((a, b) => (a === 'fundamental' ? -1 : b === 'fundamental' ? 1 : 0));
  const conPuntaje = orden.map(c => evaluaciones?.[c]?.puntaje).filter(isNum);
  const media = conPuntaje.length ? conPuntaje.reduce((s, v) => s + v, 0) / conPuntaje.length : null;
  const global = direccion(media);
  return (
    <section className="card" aria-labelledby="lectura-titulo">
      <div className="card__header">
        <div>
          <h2 id="lectura-titulo">Lectura por <Termino id="core">core</Termino></h2>
          <p className="muted small">De 0 a 40 bajista, de 40 a 60 en rango y de 60 a 100 alcista.</p>
        </div>
        {isNum(media) && (
          <p className="lectura__global">
            <span className="muted small">Promedio simple</span>
            <span className={'dir dir--' + global.tono}>{ICONO[global.tono]} {global.texto}, {textoPuntaje(media)}</span>
          </p>
        )}
      </div>
      {!orden.length
        ? <Empty title="Sin cores activos">Activa al menos uno en «Configurar».</Empty>
        : <ul className="lectura-grid">{orden.map(c => <TarjetaCore key={c} core={c} ev={evaluaciones?.[c]} destacado={c === 'fundamental'} analizados={analizados} />)}</ul>}
    </section>
  );
}
