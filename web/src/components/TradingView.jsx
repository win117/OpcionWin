// Gráfica avanzada de TradingView. Va en un marco aislado (iframe): su código no puede leer la sesión ni los datos de la aplicación.
// Es solo para mirar: con retraso y sin relación con los factores, niveles y señales propios. La atribución es obligatoria (términos de TradingView).
import { useEffect, useMemo, useState } from 'react';

const ORIGEN = 'https://www.tradingview-widget.com';
// Bolsa según Alpaca → prefijo de TradingView (NYSE Arca y American comparten AMEX).
const BOLSAS = { NASDAQ: 'NASDAQ', NYSE: 'NYSE', ARCA: 'AMEX', AMEX: 'AMEX', NYSEARCA: 'AMEX', BATS: 'CBOE' };
export const simboloTradingView = (simbolo, mercado) => (BOLSAS[mercado] ? `${BOLSAS[mercado]}:${simbolo}` : simbolo);

const temaActual = () => document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function useTema() {
  const [tema, setTema] = useState(temaActual);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)'), alCambiar = () => setTema(temaActual());
    media.addEventListener?.('change', alCambiar);
    window.addEventListener('opciones:tema', alCambiar);
    return () => { media.removeEventListener?.('change', alCambiar); window.removeEventListener('opciones:tema', alCambiar); };
  }, []);
  return tema;
}

export default function TradingView({ simbolo, mercado, height = 520 }) {
  const tema = useTema(), tv = simboloTradingView(simbolo, mercado);
  const src = useMemo(() => {
    const config = { symbol: tv, interval: 'D', theme: tema, style: '1', locale: 'es', timezone: 'America/New_York', width: '100%', height: '100%', autosize: true,
      allow_symbol_change: false, hide_side_toolbar: window.innerWidth < 700, withdateranges: true, details: false, calendar: false, save_image: false, studies: ['STD;SMA', 'STD;RSI'], support_host: 'https://www.tradingview.com' };
    return `${ORIGEN}/embed-widget/advanced-chart/?locale=es#${encodeURIComponent(JSON.stringify(config))}`;
  }, [tv, tema]);
  return (
    <div className="tv">
      <iframe key={src} title={`Gráfica de ${simbolo} en TradingView`} src={src} style={{ height }} loading="lazy" allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms" />
      <p className="muted small">
        <a href={`https://www.tradingview.com/symbols/${tv.replace(':', '-')}/`} target="_blank" rel="noopener nofollow noreferrer">Gráfica de {simbolo}</a> por TradingView, con precios retrasados. No usa los factores ni los niveles de esta aplicación. Al verla, TradingView recibe el símbolo y tu dirección IP.
      </p>
    </div>
  );
}
