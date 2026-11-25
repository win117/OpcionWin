// Avisos de órdenes de Alpaca PAPER en vivo (WebSocket trade_updates). Una sola conexión para todos: se abre con el primer suscriptor y
// se cierra un rato después del último. Si se corta, se reintenta con espera creciente; quien consulta puede ver si está `activo()`.
// Documentación: https://docs.alpaca.markets/docs/websocket-streaming
export const ALPACA_PAPER_STREAM = 'wss://paper-api.alpaca.markets/stream';
const OCIO_MS = 60000, ESPERA_MAX_MS = 60000;

export function createFlujoOrdenes({ keyId, secretKey, normalizar, WebSocket = globalThis.WebSocket, setTimeout: temporizar = setTimeout, clearTimeout: cancelar = clearTimeout } = {}) {
  const suscriptores = new Set();
  let ws = null, listo = false, fallos = 0, reintento = null, ocio = null;

  const cerrar = () => {
    cancelar(reintento); cancelar(ocio); reintento = null; ocio = null; listo = false;
    const anterior = ws;
    ws = null;
    try { anterior?.close(); } catch { /* ya cerrado */ }
  };
  const programar = () => {
    if (!suscriptores.size || reintento) return;
    fallos += 1;
    reintento = temporizar(() => { reintento = null; abrir(); }, Math.min(ESPERA_MAX_MS, 1000 * 2 ** Math.min(fallos, 6)));
    reintento?.unref?.();
  };
  async function recibir(propio, datos) {
    let m;
    try { m = JSON.parse(typeof datos === 'string' ? datos : datos?.text ? await datos.text() : Buffer.from(datos).toString('utf8')); } catch { return; } // los marcos llegan en binario
    if (propio !== ws) return;
    if (m.stream === 'authorization') {
      if (m.data?.status !== 'authorized') { fallos = 6; propio.close(); return; }
      propio.send(JSON.stringify({ action: 'listen', data: { streams: ['trade_updates'] } }));
    } else if (m.stream === 'listening') {
      listo = (m.data?.streams || []).includes('trade_updates');
      if (listo) fallos = 0;
    } else if (m.stream === 'trade_updates' && m.data?.order) {
      let orden;
      try { orden = normalizar(m.data.order); } catch { return; }
      for (const fn of [...suscriptores]) { try { fn({ evento: m.data.event, orden }); } catch { /* un suscriptor no afecta a los demás */ } }
    }
  }
  function abrir() {
    if (ws || !WebSocket || !keyId || !secretKey) return;
    let propio;
    try { propio = new WebSocket(ALPACA_PAPER_STREAM); } catch { programar(); return; }
    ws = propio;
    propio.binaryType = 'arraybuffer';
    propio.onopen = () => propio.send(JSON.stringify({ action: 'auth', key: keyId, secret: secretKey }));
    propio.onmessage = e => { recibir(propio, e.data); };
    propio.onerror = () => { /* siempre le sigue onclose */ };
    propio.onclose = () => { if (propio !== ws) return; ws = null; listo = false; programar(); };
  }
  return {
    activo: () => listo,
    suscribir(fn) {
      cancelar(ocio); ocio = null;
      suscriptores.add(fn);
      abrir();
      return () => {
        suscriptores.delete(fn);
        if (suscriptores.size || ocio) return;
        ocio = temporizar(() => { ocio = null; if (!suscriptores.size) cerrar(); }, OCIO_MS);
        ocio?.unref?.();
      };
    },
    cerrar() { suscriptores.clear(); cerrar(); },
  };
}
