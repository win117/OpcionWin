import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;

/** Buscador de ticker de la barra superior: Enter abre el análisis de ese símbolo. */
export function BuscadorTicker() {
  const [texto, setTexto] = useState('');
  const [invalido, setInvalido] = useState(false);
  const navigate = useNavigate();
  const enviar = e => {
    e.preventDefault();
    const sym = texto.trim().toUpperCase();
    if (!TICKER.test(sym)) { setInvalido(true); return; }
    setInvalido(false); setTexto('');
    navigate('/analisis/' + encodeURIComponent(sym));
  };
  return (
    <form className="ticker-search" role="search" onSubmit={enviar}>
      <label htmlFor="ticker-top" className="sr-only">Buscar ticker</label>
      <input
        id="ticker-top" type="search" value={texto} autoComplete="off" maxLength={10} placeholder="Ticker (AAPL)"
        aria-invalid={invalido || undefined} aria-describedby={invalido ? 'ticker-top-err' : undefined}
        onChange={e => { setTexto(e.target.value.toUpperCase()); setInvalido(false); }}
      />
      <button type="submit" className="btn btn--sm" disabled={!texto.trim()}>Analizar</button>
      {invalido && <span id="ticker-top-err" className="ticker-search__err" role="alert">Símbolo no válido</span>}
    </form>
  );
}
