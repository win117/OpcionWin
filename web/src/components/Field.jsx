import { Children, cloneElement, isValidElement, useId } from 'react';

/** Etiqueta + control + ayuda + error, enlazados con id/aria-describedby. */
export function Field({ label, help, error, required, children, className = '' }) {
  const id = useId();
  const helpId = help ? id + '-help' : undefined;
  const errorId = error ? id + '-error' : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  const child = Children.only(children);
  const control = isValidElement(child)
    ? cloneElement(child, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, required: child.props.required ?? required })
    : child;
  return (
    <div className={'field ' + className}>
      <label htmlFor={id} className="field__label">
        {label}{required && <span className="field__req" aria-hidden="true"> *</span>}
      </label>
      {control}
      {help && <small id={helpId} className="field__help">{help}</small>}
      {error && <small id={errorId} className="field__error">{error}</small>}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, disabled, help }) {
  const id = useId();
  return (
    <div className="check">
      <input id={id} type="checkbox" checked={Boolean(checked)} onChange={e => onChange(e.target.checked)} disabled={disabled} />
      <label htmlFor={id}>{label}</label>
      {help && <small className="field__help">{help}</small>}
    </div>
  );
}

/** Grupo de casillas para arreglos de valores. */
export function CheckboxGroup({ legend, options, value = [], onChange, help, required, columns }) {
  const toggle = (v, on) => onChange(on ? [...value, v] : value.filter(x => x !== v));
  return (
    <fieldset className="field fieldset">
      <legend className="field__label">{legend}{required && <span className="field__req" aria-hidden="true"> *</span>}</legend>
      <div className={'check-group' + (columns ? ' check-group--cols' : '')}>
        {options.map(opt => (
          <Checkbox
            key={opt.value}
            label={opt.label}
            checked={value.includes(opt.value)}
            disabled={opt.disabled}
            onChange={on => toggle(opt.value, on)}
          />
        ))}
      </div>
      {help && <small className="field__help">{help}</small>}
    </fieldset>
  );
}

export function Select({ value, onChange, options, placeholder, ...rest }) {
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(opt => (
        <option key={opt.value} value={opt.value} disabled={opt.disabled}>{opt.label}</option>
      ))}
    </select>
  );
}
