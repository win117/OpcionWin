import { Field, Select } from './Field';
import { empresaLabel } from '../utils/objects';
import { ESTRATEGIA_LABELS } from '../utils/constants';

export const empresaOptions = items => items.map(e => ({ value: e._id, label: empresaLabel(e) + (e.activo === false ? ' (inactiva)' : '') }));
export const estrategiaOptions = items => items.map(e => ({ value: e._id, label: `${ESTRATEGIA_LABELS[e.codigo] || e.codigo} · ${e.nombre}` }));
export const perfilOptions = items => items.map(p => ({ value: p._id, label: `${p.nombre} (v${p.version ?? 1})` + (p.activo === false ? ' (inactivo)' : '') }));

/** Select de una lista cargada con useLookup; muestra carga/error. */
export function LookupSelect({ label, lookup, toOptions, value, onChange, placeholder = 'Selecciona…', required, help }) {
  const helpText = lookup.error ? 'No se pudo cargar: ' + lookup.error.message : lookup.loading ? 'Cargando…' : !lookup.items.length ? 'No hay registros; créalos primero.' : help;
  return (
    <Field label={label} required={required} help={helpText}>
      <Select value={value} onChange={onChange} options={toOptions(lookup.items)} placeholder={placeholder} disabled={lookup.loading} />
    </Field>
  );
}
