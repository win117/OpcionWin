import { useEffect, useId, useRef } from 'react';
import { centrarEn } from '../utils/desplazar';

/** Pestañas accesibles (role=tablist, flechas izquierda/derecha). */
export function Tabs({ tabs, value, onChange, label = 'Secciones' }) {
  const id = useId();
  const refs = useRef({});
  const lista = useRef(null);
  // En pantallas chicas la fila se desplaza: la pestaña activa siempre queda a la vista.
  useEffect(() => { centrarEn(lista.current, refs.current[value]); }, [value]);
  const onKey = (event, index) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    onChange(tabs[next].value);
    refs.current[tabs[next].value]?.focus();
  };
  return (
    <div ref={lista} className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.value}
          ref={el => { refs.current[tab.value] = el; }}
          id={`${id}-${tab.value}`}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          tabIndex={value === tab.value ? 0 : -1}
          className={'tab' + (value === tab.value ? ' is-active' : '')}
          onClick={() => onChange(tab.value)}
          onKeyDown={e => onKey(e, index)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
