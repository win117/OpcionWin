// Seguimiento de una orden por Server-Sent Events: la respuesta queda abierta y cada cambio se escribe como un evento.
import { handle } from './crud.controller';

const LATIDO_MS = 15000; // evita que un proxy cierre la conexión por silencio

export default seguimiento => ({
  orden: handle(async (req, res) => {
    const escribir = (evento, data) => { if (!res.writableEnded && !res.destroyed) res.write(`event: ${evento}\ndata: ${JSON.stringify(data)}\n\n`); };
    let latido = null, parar = () => {};
    const cerrar = () => { clearInterval(latido); parar(); };
    res.on('close', cerrar);
    const antes = []; // lo que ocurra antes de enviar las cabeceras
    let abierto = false;
    const emitir = (...a) => (abierto ? escribir(...a) : antes.push(a));
    const s = await seguimiento.seguir(req.context, req.params.id, {
      alCambio: (orden, extra) => emitir('orden', { orden, ...extra }),
      alTerminar: motivo => { emitir('fin', { motivo }); if (abierto) res.end(); },
    });
    parar = s.parar;
    if (res.destroyed) return cerrar();
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    abierto = true;
    escribir('orden', { orden: s.orden, enVivo: false });
    antes.forEach(a => escribir(...a));
    if (s.final) { escribir('fin', { motivo: 'final' }); return res.end(); }
    if (antes.some(a => a[0] === 'fin')) return res.end();
    latido = setInterval(() => { if (!res.writableEnded) res.write(': sigo aquí\n\n'); }, LATIDO_MS);
  }),
});
