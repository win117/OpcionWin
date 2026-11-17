import { useEffect, useId, useRef } from 'react';

/** Diálogo modal accesible basado en <dialog> nativo (atrapa foco y cierra con Escape). */
export function Modal({ open, title, onClose, children, footer, size = 'md' }) {
  const ref = useRef(null);
  const titleId = useId();
  const returnFocus = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement;
      dialog.showModal();
      const first = dialog.querySelector('[autofocus], input:not([type=hidden]):not([disabled]), select, textarea, button:not(.modal__close)');
      first?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocus.current?.focus?.();
    }
  }, [open]);

  if (!open) return <dialog ref={ref} className="modal" aria-labelledby={titleId} />;

  return (
    <dialog
      ref={ref}
      className={'modal modal--' + size}
      aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onClose?.(); }}
      onClick={event => { if (event.target === ref.current) onClose?.(); }}
    >
      <div className="modal__panel">
        <header className="modal__header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn--ghost btn--icon modal__close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </dialog>
  );
}

export function ConfirmDialog({ open, title = 'Confirmar', message, confirmLabel = 'Confirmar', tone = 'danger', busy, error, onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className={'btn btn--' + tone} onClick={onConfirm} disabled={busy}>
            {busy ? 'Procesando…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack">
        <div>{message}</div>
        {error && <div className="alert alert--danger" role="alert">{error.message || String(error)}</div>}
      </div>
    </Modal>
  );
}
