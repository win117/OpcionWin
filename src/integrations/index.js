// Punto de entrada de integraciones. Lee configuración del entorno del servidor;
// `estado()` nunca revela valores de credenciales.
import { createAlpacaClient } from './alpaca.client';
import { createSecClient } from './sec.client';
import { createWebullClient } from './webull.client';
import { createIbkrClient } from './ibkr.client';
import { exigirContratoBroker } from './contrato-broker';
import { createTesoroClient } from './tesoro.client';

export { IntegrationError } from './errors';
export { createAlpacaClient, createSecClient, createWebullClient, createIbkrClient, createTesoroClient };

const limpio = v => (typeof v === 'string' ? v.trim() : '');

export const createIntegrations = (env = process.env, fetch = globalThis.fetch) => {
  const feed = limpio(env.ALPACA_DATA_FEED) || 'iex';
  const alpaca = exigirContratoBroker(createAlpacaClient({ keyId: limpio(env.ALPACA_KEY_ID), secretKey: limpio(env.ALPACA_SECRET_KEY), feed, fetch }));
  const sec = createSecClient({ userAgent: limpio(env.SEC_USER_AGENT), fetch });
  const webull = exigirContratoBroker(createWebullClient({ appKey: limpio(env.WEBULL_APP_KEY), appSecret: limpio(env.WEBULL_APP_SECRET), accountId: limpio(env.WEBULL_ACCOUNT_ID),
    entorno: limpio(env.WEBULL_ENTORNO) || 'paper', baseUrl: limpio(env.WEBULL_BASE_URL), accessToken: limpio(env.WEBULL_ACCESS_TOKEN), fetch }));
  const ibkr = exigirContratoBroker(createIbkrClient({ gatewayUrl: env.IBKR_GATEWAY_URL, accountId: env.IBKR_ACCOUNT_ID }));
  const tesoro = createTesoroClient({ fetch });
  const estado = () => ({
    alpaca: { configurado: alpaca.configurado, feed, opcionesFeed: alpaca.opcionesFeed, entorno: 'paper' },
    sec: { configurado: sec.configurado },
    webull: { configurado: webull.configurado },
    ibkr: { configurado: ibkr.configurado },
    tesoro: { configurado: tesoro.configurado },
  });
  return { alpaca, sec, webull, ibkr, tesoro, estado };
};

export default createIntegrations;
