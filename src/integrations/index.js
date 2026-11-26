// Punto de entrada de integraciones. Lee configuración del entorno del servidor;
// `estado()` nunca revela valores de credenciales.
import { createAlpacaClient } from './alpaca.client';
import { createSecClient } from './sec.client';
import { createWebullClient } from './webull.client';
import { exigirContratoBroker } from './contrato-broker';
import { createTesoroClient } from './tesoro.client';

export { IntegrationError } from './errors';
export { createAlpacaClient, createSecClient, createWebullClient, createTesoroClient };

const limpio = v => (typeof v === 'string' ? v.trim() : '');

export const createIntegrations = (env = process.env, fetch = globalThis.fetch) => {
  const feed = limpio(env.ALPACA_DATA_FEED) || 'iex';
  const alpaca = exigirContratoBroker(createAlpacaClient({ keyId: limpio(env.ALPACA_KEY_ID), secretKey: limpio(env.ALPACA_SECRET_KEY), feed, fetch }));
  const sec = createSecClient({ userAgent: limpio(env.SEC_USER_AGENT), fetch });
  const webull = exigirContratoBroker(createWebullClient({ appKey: limpio(env.WEBULL_APP_KEY), appSecret: limpio(env.WEBULL_APP_SECRET), accountId: limpio(env.WEBULL_ACCOUNT_ID),
    entorno: limpio(env.WEBULL_ENTORNO) || 'paper', baseUrl: limpio(env.WEBULL_BASE_URL), accessToken: limpio(env.WEBULL_ACCESS_TOKEN), fetch }));
  const tesoro = createTesoroClient({ fetch });
  // `circuito`: estado del circuit breaker de cada proveedor (openspec: resiliencia-proveedores); nunca incluye credenciales.
  const estado = () => ({
    alpaca: { configurado: alpaca.configurado, feed, opcionesFeed: alpaca.opcionesFeed, entorno: 'paper', circuito: alpaca.circuito() },
    sec: { configurado: sec.configurado, circuito: sec.circuito() },
    webull: { configurado: webull.configurado, circuito: webull.circuito() },
    tesoro: { configurado: tesoro.configurado, circuito: tesoro.circuito() },
  });
  return { alpaca, sec, webull, tesoro, estado };
};

export default createIntegrations;
