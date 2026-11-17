import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Tabs } from '../components/Tabs';
import { Field, Select } from '../components/Field';
import { Empty, ErrorMessage, Loading } from '../components/States';
import { useLookup } from '../hooks/useLookup';
import { empresas } from '../api/resources';
import GraficoTab from './mercado/GraficoTab';
import CotizacionTab from './mercado/CotizacionTab';
import CadenaTab from './mercado/CadenaTab';
import FundamentalesTab from './mercado/FundamentalesTab';
import InstitucionalTab from './mercado/InstitucionalTab';
import NoticiasTab from './mercado/NoticiasTab';

const TABS = [
  { value: 'grafico', label: 'Gráfico', Component: GraficoTab },
  { value: 'cotizacion', label: 'Cotización', Component: CotizacionTab },
  { value: 'cadena', label: 'Cadena de opciones', Component: CadenaTab },
  { value: 'fundamentales', label: 'Fundamentales', Component: FundamentalesTab },
  { value: 'institucional', label: 'Institucional', Component: InstitucionalTab },
  { value: 'noticias', label: 'Noticias', Component: NoticiasTab },
];

export default function Mercado() {
  const { simbolo: raw } = useParams();
  const simbolo = raw ? raw.toUpperCase() : '';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(t => t.value === params.get('tab')) ? params.get('tab') : 'grafico';
  const lookup = useLookup(empresas);
  const empresa = lookup.items.find(e => e.simbolo === simbolo);
  const Active = TABS.find(t => t.value === tab).Component;

  const options = lookup.items
    .slice()
    .sort((a, b) => a.simbolo.localeCompare(b.simbolo))
    .map(e => ({ value: e.simbolo, label: `${e.simbolo} · ${e.nombre}${e.activo === false ? ' (inactiva)' : ''}` }));

  return (
    <>
      <PageHeader
        title={simbolo ? `Mercado · ${simbolo}` : 'Mercado'}
        subtitle={empresa ? `${empresa.nombre} · ${empresa.mercado}${empresa.sector ? ' · ' + empresa.sector : ''}` : 'Datos almacenados y consultas al proveedor'}
      />
      <section className="card card--tight">
        <div className="toolbar">
          <Field label="Empresa registrada" className="field--inline">
            <Select
              value={simbolo}
              onChange={v => navigate(v ? `/mercado/${encodeURIComponent(v)}?tab=${tab}` : '/mercado')}
              options={options}
              placeholder={lookup.loading ? 'Cargando…' : 'Selecciona una empresa'}
            />
          </Field>
        </div>
        {lookup.error && <ErrorMessage error={lookup.error} onRetry={lookup.reload} />}
      </section>

      {!simbolo && !lookup.loading && (
        <Empty title="Selecciona una empresa">Solo se consultan empresas registradas en tu catálogo.</Empty>
      )}
      {simbolo && lookup.loading && <Loading />}
      {simbolo && !lookup.loading && !empresa && !lookup.error && (
        <Empty title={`${simbolo} no está registrada`}>Regístrala en Empresas para consultar y sincronizar sus datos.</Empty>
      )}
      {empresa && (
        <section className="card">
          <Tabs tabs={TABS} value={tab} onChange={v => setParams({ tab: v }, { replace: true })} label="Datos de mercado" />
          <div role="tabpanel" className="tabpanel">
            <Active key={empresa._id + tab} empresa={empresa} simbolo={empresa.simbolo} />
          </div>
        </section>
      )}
    </>
  );
}
