import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { ResourceManager } from '../components/ResourceManager';
import { SubdocEditor } from '../components/SubdocEditor';
import { Badge } from '../components/Badge';
import { ErrorMessage, Loading } from '../components/States';
import { useAsync } from '../hooks/useAsync';
import { perfiles } from '../api/resources';
import { CORE_LABELS, CORE_OPTIONS, OPERADORES } from '../utils/constants';
import { fmtDateTime, fmtNum } from '../utils/format';

export const PARAM_FIELDS = [
  { name: 'parametros.periodos', label: 'Periodos (velas)', type: 'number', min: 1, step: 1, placeholder: '120' },
  { name: 'parametros.intervalo', label: 'Intervalo', placeholder: '1Day' },
  { name: 'parametros.diasVencimientoMin', label: 'Días a vencimiento mín.', type: 'number', min: 0, step: 1, placeholder: '0' },
  { name: 'parametros.diasVencimientoMax', label: 'Días a vencimiento máx.', type: 'number', min: 0, step: 1, placeholder: '60' },
];

const FIELDS = [
  { name: 'nombre', label: 'Nombre', required: true },
  { name: 'activo', label: 'Activo', type: 'checkbox', default: true },
  { name: 'descripcion', label: 'Descripción', type: 'textarea' },
  { name: 'coresSeleccionados', label: 'Cores', type: 'checkboxes', options: CORE_OPTIONS, required: true, default: CORE_OPTIONS.map(o => o.value), help: 'Cada regla del perfil debe pertenecer a un core seleccionado.' },
  ...PARAM_FIELDS,
];

const validateParams = values => {
  const min = values['parametros.diasVencimientoMin'], max = values['parametros.diasVencimientoMax'];
  if (min !== '' && max !== '' && Number(min) > Number(max)) return 'El mínimo de días a vencimiento no puede superar el máximo.';
  return null;
};

export default function Perfiles() {
  return (
    <>
      <PageHeader title="Perfiles de análisis" subtitle="Cores, parámetros y reglas que se aplican al evaluar" />
      <ResourceManager
        api={perfiles}
        fields={FIELDS}
        createLabel="Nuevo perfil"
        extraValidate={validateParams}
        columns={[
          { key: 'nombre', label: 'Nombre', render: r => <Link to={`/configuracion/perfiles/${r._id}`}><strong>{r.nombre}</strong></Link> },
          { key: 'cores', label: 'Cores', className: 'col-wrap', render: r => r.coresSeleccionados?.map(c => CORE_LABELS[c]).join(', ') },
          { key: 'reglas', label: 'Reglas', align: 'right', render: r => r.reglas?.length ?? 0 },
          { key: 'version', label: 'Versión', align: 'right', render: r => r.version ?? 1 },
          { key: 'activo', label: 'Activo', render: r => <Badge value={r.activo !== false} /> },
        ]}
        rowActions={row => <Link className="btn btn--sm" to={`/configuracion/perfiles/${row._id}`}>Reglas</Link>}
      />
    </>
  );
}

export function PerfilDetalle() {
  const { id } = useParams();
  const perfil = useAsync(() => perfiles.get(id), [id]);
  const reglasApi = useMemo(() => perfiles.child(id, 'reglas'), [id]);
  const p = perfil.data;
  const coreOptions = CORE_OPTIONS.filter(o => p?.coresSeleccionados?.includes(o.value));

  const fields = [
    { name: 'core', label: 'Core', type: 'select', options: coreOptions, required: true },
    { name: 'criterio', label: 'Criterio (métrica)', required: true, placeholder: 'rsi_14', help: 'Nombre de una métrica que produce el core (snake_case).' },
    { name: 'operador', label: 'Operador', type: 'select', options: OPERADORES, required: true },
    { name: 'valorReferencia', label: 'Valor de referencia', type: 'number', required: true },
    { name: 'valorSuperior', label: 'Valor superior', type: 'number', required: true, show: v => v.operador === 'between', help: 'Límite superior del rango (≥ referencia).' },
    { name: 'peso', label: 'Peso', type: 'number', min: 0, required: true, default: '1', help: 'Puntos que suma o resta al puntaje.' },
    { name: 'obligatoria', label: 'Obligatoria (si no se cumple, el puntaje queda neutral)', type: 'checkbox', default: false },
    { name: 'activo', label: 'Activa', type: 'checkbox', default: true },
  ];
  const validate = values => (values.operador === 'between' && Number(values.valorSuperior) < Number(values.valorReferencia) ? 'El valor superior debe ser mayor o igual al de referencia.' : null);

  return (
    <>
      <PageHeader
        title={p ? `Perfil · ${p.nombre}` : 'Perfil de análisis'}
        subtitle={p ? `Versión ${p.version ?? 1} · actualizado ${fmtDateTime(p.updatedAt)}` : null}
        actions={<Link className="btn btn--sm" to="/configuracion/perfiles">Volver</Link>}
      />
      {perfil.loading && !p && <Loading />}
      <ErrorMessage error={perfil.error} onRetry={perfil.reload} />
      {p && (
        <>
          <section className="card">
            <dl className="defs defs--grid">
              <div><dt>Cores</dt><dd>{p.coresSeleccionados?.map(c => CORE_LABELS[c]).join(', ')}</dd></div>
              <div><dt>Periodos</dt><dd>{p.parametros?.periodos ?? '—'}</dd></div>
              <div><dt>Intervalo</dt><dd>{p.parametros?.intervalo || '—'}</dd></div>
              <div><dt>Días a vencimiento</dt><dd>{p.parametros?.diasVencimientoMin ?? '—'} – {p.parametros?.diasVencimientoMax ?? '—'}</dd></div>
              {p.descripcion && <div className="span-all"><dt>Descripción</dt><dd>{p.descripcion}</dd></div>}
            </dl>
            <p className="muted small">Cada cambio en las reglas incrementa la versión del perfil. Las evaluaciones guardan una copia de las reglas aplicadas.</p>
          </section>
          <SubdocEditor
            title="Reglas"
            api={reglasApi}
            fields={fields}
            extraValidate={validate}
            onChanged={perfil.reload}
            createLabel="Nueva regla"
            columns={[
              { key: 'core', label: 'Core', render: r => CORE_LABELS[r.core] || r.core },
              { key: 'criterio', label: 'Criterio', render: r => <code>{r.criterio}</code> },
              { key: 'operador', label: 'Condición', render: r => r.operador === 'between' ? `entre ${fmtNum(r.valorReferencia, 4)} y ${fmtNum(r.valorSuperior, 4)}` : `${OPERADORES.find(o => o.value === r.operador)?.label || r.operador} ${fmtNum(r.valorReferencia, 4)}` },
              { key: 'peso', label: 'Peso', align: 'right', render: r => fmtNum(r.peso, 2) },
              { key: 'obligatoria', label: 'Obligatoria', render: r => <Badge value={Boolean(r.obligatoria)} /> },
              { key: 'activo', label: 'Activa', render: r => <Badge value={r.activo !== false} /> },
            ]}
          />
        </>
      )}
    </>
  );
}
