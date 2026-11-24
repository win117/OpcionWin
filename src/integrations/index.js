// Punto de entrada de integraciones. Lee configuración del entorno del servidor;
// `estado()` nunca revela valores de credenciales.
import { createAlpacaClient } from './alpaca.client';
import { createSecClient } from './sec.client';
import { createWebullClient } from './webull.client';

export { IntegrationError } from './errors';
export { createAlpacaClient, createSecClient, createWebullClient };

const limpio = v => (typeof v === 'string' ? v.trim() : '');

export const createIntegrations = (env = process.env, fetch = globalThis.fetch) => {
  const feed = limpio(env.ALPACA_DATA_FEED) || 'iex';
  const alpaca = createAlpacaClient({ keyId: limpio(env.ALPACA_KEY_ID), secretKey: limpio(env.ALPACA_SECRET_KEY), feed, fetch });
  const sec = createSecClient({ userAgent: limpio(env.SEC_USER_AGENT), fetch });
  const webull = createWebullClient({ appKey: limpio(env.WEBULL_APP_KEY), appSecret: limpio(env.WEBULL_APP_SECRET), accountId: limpio(env.WEBULL_ACCOUNT_ID),
    entorno: limpio(env.WEBULL_ENTORNO) || 'paper', baseUrl: limpio(env.WEBULL_BASE_URL), accessToken: limpio(env.WEBULL_ACCESS_TOKEN), fetch });
  const estado = () => ({
    alpaca: { configurado: alpaca.configurado, feed, opcionesFeed: alpaca.opcionesFeed, entorno: 'paper' },
    sec: { configurado: sec.configurado },
    webull: { configurado: webull.configurado },
  });
  return { alpaca, sec, webull, estado };
};

export default createIntegrations;
