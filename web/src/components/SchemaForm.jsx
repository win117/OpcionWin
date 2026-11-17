import { useState } from 'react';
import { Field, Checkbox, CheckboxGroup, Select } from './Field';
import { getPath, setPath } from '../utils/objects';
import { editable } from '../api/resources';

/*
 * Formulario declarativo. Cada campo:
 * { name: 'a.b', label, type: text|number|select|checkbox|checkboxes|date|textarea,
 *   options, required, help, placeholder, min, max, step, pattern, maxLength,
 *   show(values, record), disabled(values, record), default, uppercase }
 */

function toFormValue(field, raw) {
  if (field.type === 'checkbox') return raw == null ? Boolean(field.default) : Boolean(raw);
  if (field.type === 'checkboxes') return Array.isArray(raw) ? raw : field.default || [];
  if (raw == null) return field.default ?? '';
  if (field.type === 'date') return String(raw).slice(0, 10);
  return String(raw);
}

function fromFormValue(field, value) {
  switch (field.type) {
    case 'checkbox': return Boolean(value);
    case 'checkboxes': return value;
    case 'number': return value === '' || value == null ? undefined : Number(value);
    case 'date': return value ? new Date(value + 'T00:00:00.000Z').toISOString() : undefined;
    default: {
      const text = typeof value === 'string' ? value.trim() : value;
      if (text === '' || text == null) return undefined;
      return field.uppercase ? String(text).toUpperCase() : text;
    }
  }
}

export function initialValues(fields, record) {
  const values = {};
  for (const field of fields) values[field.name] = toFormValue(field, record ? getPath(record, field.name) : undefined);
  return values;
}

/** Construye el cuerpo: parte de la representación editable del registro y aplica el formulario. */
export function buildPayload(fields, values, record) {
  const payload = record ? structuredClone(editable(record)) : {};
  for (const field of fields) {
    if (field.readOnly) continue;
    const visible = field.show ? field.show(values, record) : true;
    setPath(payload, field.name, visible ? fromFormValue(field, values[field.name]) : undefined);
  }
  return payload;
}

export function FieldControl({ field, value, onChange, values, record }) {
  const disabled = typeof field.disabled === 'function' ? field.disabled(values, record) : field.disabled;
  const options = typeof field.options === 'function' ? field.options(values, record) : field.options || [];
  if (field.type === 'checkbox') {
    return <Checkbox label={field.label} checked={value} onChange={onChange} disabled={disabled} help={field.help} />;
  }
  if (field.type === 'checkboxes') {
    return <CheckboxGroup legend={field.label} options={options} value={value} onChange={onChange} help={field.help} required={field.required} columns={options.length > 4} />;
  }
  let control;
  if (field.type === 'select') {
    control = <Select value={value} onChange={onChange} options={options} placeholder={field.placeholder ?? 'Selecciona…'} disabled={disabled} />;
  } else if (field.type === 'textarea') {
    control = <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} maxLength={field.maxLength || 2000} disabled={disabled} placeholder={field.placeholder} />;
  } else {
    control = (
      <input
        type={field.type || 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        min={field.min}
        max={field.max}
        step={field.step ?? (field.type === 'number' ? 'any' : undefined)}
        pattern={field.pattern}
        maxLength={field.maxLength}
        placeholder={field.placeholder}
        disabled={disabled}
        inputMode={field.inputMode}
        autoComplete="off"
      />
    );
  }
  return <Field label={field.label} help={field.help} required={field.required}>{control}</Field>;
}

export function SchemaForm({ fields, record, onSubmit, onCancel, submitLabel = 'Guardar', extraValidate }) {
  const [values, setValues] = useState(() => initialValues(fields, record));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const set = name => value => setValues(v => ({ ...v, [name]: value }));

  const submit = async event => {
    event.preventDefault();
    setError(null);
    for (const field of fields) {
      const visible = field.show ? field.show(values, record) : true;
      if (visible && field.type === 'checkboxes' && field.required && !values[field.name]?.length) {
        setError(new Error(`Selecciona al menos una opción en «${field.label}».`));
        return;
      }
    }
    const problem = extraValidate?.(values, record);
    if (problem) { setError(new Error(problem)); return; }
    setBusy(true);
    try {
      await onSubmit(buildPayload(fields, values, record), values);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-grid" onSubmit={submit} noValidate={false}>
      {fields.map(field => {
        const visible = field.show ? field.show(values, record) : true;
        if (!visible) return null;
        return (
          <div key={field.name} className={field.wide || ['checkboxes', 'textarea'].includes(field.type) ? 'span-2' : ''}>
            <FieldControl field={field} value={values[field.name]} onChange={set(field.name)} values={values} record={record} />
          </div>
        );
      })}
      {error && <div className="span-2 alert alert--danger" role="alert">{error.message || String(error)}</div>}
      <div className="span-2 form-actions">
        {onCancel && <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancelar</button>}
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Guardando…' : submitLabel}</button>
      </div>
    </form>
  );
}
