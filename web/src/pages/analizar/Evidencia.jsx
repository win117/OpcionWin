// Evidencia del análisis en pestañas. Son consultas de lo guardado: abrirlas no sincroniza nada.
import { Tabs } from '../../components/Tabs';
import { Empty } from '../../components/States';
import FundamentalesTab from '../mercado/FundamentalesTab';
import InstitucionalTab from '../mercado/InstitucionalTab';
import NoticiasTab from '../mercado/NoticiasTab';
import AnalisisTecnico from './AnalisisTecnico';
import Desglose from './Desglose';
import LecturaCores from './LecturaCores';
import CadenaOpciones from './CadenaOpciones';
import CompararStrikes from './TablaStrikes';

export const TABS = [
  { value: 'grafica', label: 'Gráfica' },
  { value: 'factores', label: 'Factores' },
  { value: 'cadena', label: 'Cadena' },
  { value: 'fundamentales', label: 'Fundamentales' },
  { value: 'noticias', label: 'Noticias' },
];

export default function Evidencia({ tab, onTab, empresa, simbolo, mercado, vivo, velas, datos, pos, config, coresActivos, version, onCambio }) {
  const pendiente = <section className="card"><Empty title="Aún no disponible">Aparece cuando terminen de llegar los datos de {simbolo}.</Empty></section>;
  return (
    <div className="evidencia">
      <Tabs tabs={TABS} value={tab} onChange={onTab} label="Evidencia del análisis" />
      <div role="tabpanel" aria-label={TABS.find(t => t.value === tab).label} className="evidencia__panel stack">
        {tab === 'grafica' && <AnalisisTecnico simbolo={simbolo} mercado={mercado} vivo={vivo} registrada={Boolean(empresa)} velas={velas} coresActivos={coresActivos} evalIndicadores={datos?.evaluaciones?.indicadores} onCambio={onCambio} />}
        {tab === 'factores' && (datos ? (
          <>
            <LecturaCores evaluaciones={datos.evaluaciones} coresActivos={coresActivos} analizados={datos.seleccion?.coresSeleccionados} />
            {pos.activa && <Desglose fila={pos.activa} datos={datos} detalle={pos.detalle} config={config} />}
          </>
        ) : pendiente)}
        {tab === 'cadena' && (empresa ? (
          <>
            <CompararStrikes pos={pos} />
            <section className="card" aria-labelledby="cadena-titulo"><h2 id="cadena-titulo">Cadena de opciones</h2><CadenaOpciones key={simbolo + version} vencimiento={pos.chain?.vencimiento || ''} simbolo={simbolo} empresa={empresa} vivo={vivo} /></section>
          </>
        ) : pendiente)}
        {tab === 'fundamentales' && (empresa ? (
          <>
            <section className="card" aria-labelledby="fund-titulo"><h2 id="fund-titulo">Resultados de la empresa</h2><FundamentalesTab empresa={empresa} simbolo={simbolo} /></section>
            <section className="card" aria-labelledby="inst-titulo"><h2 id="inst-titulo">Instituciones (13F)</h2><InstitucionalTab empresa={empresa} simbolo={simbolo} /></section>
          </>
        ) : pendiente)}
        {tab === 'noticias' && (empresa ? <section className="card" aria-labelledby="not-titulo"><h2 id="not-titulo">Noticias</h2><NoticiasTab empresa={empresa} simbolo={simbolo} /></section> : pendiente)}
      </div>
    </div>
  );
}
