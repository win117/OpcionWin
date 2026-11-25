// Backtest con PRECIOS REALES de opciones (contratos ya vencidos, Alpaca, desde 2024-02). Solo lectura.
// Para cada empresa y vencimiento mensual: entra ~37 días antes al último precio operado de cada contrato y se queda hasta vencer.
// Cada core se evalúa solo con lo conocido ese día (técnico, indicadores, fundamental, noticias; el 13F no se reconstruye).
// Uso: npm run build && node scripts/backtest/opciones.cjs CARPETA [empresas=60]   → CARPETA/opciones.jsonl y resumen en pantalla.
const P = process.cwd(); require(P + '/node_modules/dotenv').config({ quiet: true });
const fs = require('fs'); const { createIntegrations } = require(P + '/dist/integrations');
const { repository } = require(P + '/dist/repositories'); const { closeMongo } = require(P + '/dist/config/database.config');
const { combinarCores, evaluarCore, evaluarPrecio } = require(P + '/dist/api/v1/services/screener.service');
const { volatilidadImplicita } = require(P + '/dist/cores/blackscholes');
const DIR = process.argv[2], N = Number(process.argv[3] || 60), DIA = 864e5;
const K = { 'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID.trim(), 'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY.trim() };
const z = ms => new Promise(r => setTimeout(r, ms)), dia = t => new Date(t).toISOString().slice(0, 10);
let turno = 0;
async function trading(ruta) { // contratos vencidos (el adaptador de la app solo pide vigentes)
  for (let n = 0; ; n++) {
    const espera = turno - Date.now(); turno = Math.max(Date.now(), turno) + 420; if (espera > 0) await z(espera);
    const r = await fetch('https://paper-api.alpaca.markets' + ruta, { headers: K, signal: AbortSignal.timeout(20000) }).catch(() => null);
    if (r?.ok) return r.json();
    if (n >= 4) throw new Error('HTTP ' + (r?.status || 'red'));
    await z(2000 * (n + 1));
  }
}
const reintentar = async (fn, veces = 5) => { for (let n = 0; ; n++) { try { return await fn(); } catch (e) { if (n >= veces) throw e; await z(3000 * (n + 1)); } } };
const terceros = () => { const l = []; for (let y = 2024; y <= 2026; y++) for (let m = 0; m < 12; m++) { const d = new Date(Date.UTC(y, m, 1)); l.push(dia(Date.UTC(y, m, 1 + ((5 - d.getUTCDay() + 7) % 7) + 14))); } return l.filter(v => v >= '2024-03-28' && v < dia(Date.now() - DIA)); };
const media = l => l.reduce((a, b) => a + b, 0) / l.length;

(async () => {
  const { alpaca, sec } = createIntegrations(process.env);
  const filas = (await repository('screener', { userId: 'sistema-universo', database: 'mongodb' }).list({ offset: 0, limit: 500 })).map(x => x.document); await closeMongo();
  const emp = filas.filter(f => f.capitalizacion && f.cik).sort((a, b) => b.capitalizacion - a.capitalizacion).slice(0, N);
  const simbolos = emp.map(e => e.simbolo), rango = { desde: '2022-06-01T00:00:00Z', hasta: dia(Date.now() - DIA) + 'T00:00:00Z', feed: 'sip' }, velas = {}, crudas = {};
  for (let i = 0; i < simbolos.length; i += 20) { Object.assign(velas, await alpaca.velasLote(simbolos.slice(i, i + 20), rango)); Object.assign(crudas, await alpaca.velasLote(simbolos.slice(i, i + 20), { ...rango, ajuste: 'raw' })); }
  const fund = {}; for (const e of emp) fund[e.simbolo] = await sec.fundamentales(e.cik, { maxPeriodos: 60 }).catch(() => []);
  const vencs = terceros(); console.log('empresas', emp.length, 'vencimientos', vencs.length, vencs[0], vencs.at(-1));
  const out = fs.createWriteStream(DIR + '/opciones.jsonl'), obs = [], por = { sinVela: 0, division: 0, sinContratos: 0, sinPrecio: 0 };
  for (const venc of vencs) {
    const casos = [];
    for (const s of simbolos) {
      const v = velas[s], c = crudas[s]; if (!v || !c) continue;
      const entrada = Date.parse(venc) - 37 * DIA, i = v.findIndex(x => Date.parse(x.fecha.slice(0, 10)) >= entrada), hoy = v[i]?.fecha.slice(0, 10);
      const fin = v.filter(x => x.fecha.slice(0, 10) <= venc).at(-1), ci = c.find(x => x.fecha.slice(0, 10) === hoy), cf = c.filter(x => x.fecha.slice(0, 10) <= venc).at(-1);
      if (i < 260 || !fin || !ci || !cf || Date.parse(venc) - Date.parse(fin.fecha.slice(0, 10)) > 4 * DIA) { por.sinVela++; continue; }
      if (Math.abs(ci.cierre / v[i].cierre / (cf.cierre / fin.cierre) - 1) > 0.02) { por.division++; continue; } // división de por medio: strikes ajustados
      const S = ci.cierre;
      let l; try { l = (await trading(`/v2/options/contracts?underlying_symbols=${s}&status=inactive&expiration_date=${venc}&strike_price_gte=${(S * 0.75).toFixed(2)}&strike_price_lte=${(S * 1.25).toFixed(2)}&limit=1000`)).option_contracts || []; l = l.filter(x => /^[A-Z]{1,5}\d{6}[CP]\d{8}$/.test(x.symbol)); } catch { l = []; }
      if (l.length < 10) { por.sinContratos++; continue; }
      const win = v.slice(Math.max(0, i - 274), i + 1), t = hoy + 'T21:00:00.000Z';
      casos.push({ s, hoy, S, Sf: cf.cierre, t, win, l: l.filter(x => Math.abs(Number(x.strike_price) / S - 1) < 0.2) });
    }
    // Solo se usan contratos que se negociaron ese día: de ahí se eligen los strikes.
    const barras = {};
    for (const hoy of new Set(casos.map(c => c.hoy))) {
      const lista = casos.filter(c => c.hoy === hoy).flatMap(c => c.l.map(x => x.symbol));
      for (let i = 0; i < lista.length; i += 100) Object.assign(barras, await reintentar(() => alpaca.velasOpciones(lista.slice(i, i + 100), { desde: hoy + 'T00:00:00Z', hasta: hoy + 'T23:59:59Z' })));
    }
    for (const c of casos) {
      const px0 = tp => new Map(c.l.filter(x => x.type === tp && barras[x.symbol]?.[0]?.cierre > 0).map(x => [Number(x.strike_price), barras[x.symbol][0].cierre]));
      const C = px0('call'), Q = px0('put'), S = c.S, cerca = (ls, x) => ls.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a), ls[0]);
      const comunes = [...C.keys()].filter(k => Q.has(k)), precio = evaluarPrecio({ simbolo: c.s, velas: c.win, opciones: [], fechaReferencia: c.t });
      c.precio = precio; c.hv = precio.hv20;
      const atm = cerca(comunes, S);
      if (!(c.hv > 0) || !atm || Math.abs(atm / S - 1) > 0.03) { por.sinPrecio++; continue; }
      const T = 37 / 365, iv = media([volatilidadImplicita({ tipo: 'call', precio: C.get(atm), S, K: atm, T }), volatilidadImplicita({ tipo: 'put', precio: Q.get(atm), S, K: atm, T })].filter(x => x > 0));
      // Cóndor: vendidas a ±0.84 σ implícita (≈ delta 0.20) y alas al menos 2 % más lejos.
      const sd = S * iv * Math.sqrt(T), cs = cerca([...C.keys()].filter(k => k > S), S + 0.84 * sd), ps = cerca([...Q.keys()].filter(k => k < S), S - 0.84 * sd);
      const cl = [...C.keys()].filter(k => k >= cs + 0.02 * S).sort((a, b) => a - b)[0], pl = [...Q.keys()].filter(k => k <= ps - 0.02 * S).sort((a, b) => b - a)[0];
      const credito = C.get(cs) + Q.get(ps) - C.get(cl) - Q.get(pl), ancho = Math.max(cl - cs, ps - pl);
      const conCondor = credito > 0 && credito < ancho && ancho <= 0.08 * S && Math.abs(cs - S - 0.84 * sd) < 0.5 * sd && Math.abs(S - 0.84 * sd - ps) < 0.5 * sd;
      const int = (tp, k) => Math.max(0, tp === 'call' ? c.Sf - k : k - c.Sf);
      const ev = { ...(c.precio.evaluaciones || c.precio) };
      const fp = fund[c.s].filter(p => p.fuente?.fechaDato && Date.parse(p.fuente.fechaDato) <= Date.parse(c.t)).slice(0, 12);
      const evaluaciones = { tecnico: ev.tecnico, indicadores: ev.indicadores }; if (fp.length) evaluaciones.fundamental = evaluarCore('fundamental', { fundamentales: fp }, c.t);
      const not = await alpaca.noticias({ simbolos: [c.s], desde: dia(Date.parse(c.t) - 14 * DIA) + 'T00:00:00Z', hasta: c.t, limite: 50 }).catch(() => []);
      if (not.length) evaluaciones.noticias = evaluarCore('noticias', { noticias: not }, c.t);
      const { puntajes } = combinarCores(evaluaciones, { ivActual: iv > 0 ? iv : undefined, hv20: c.hv });
      const condor = conCondor ? credito - int('call', cs) + int('call', cl) - int('put', ps) + int('put', pl) : null;
      const f = { s: c.s, d: c.hoy, venc, iv, hv: c.hv, puntajes, r: { LONG_CALL: int('call', atm) / C.get(atm) - 1, LONG_PUT: int('put', atm) / Q.get(atm) - 1, IRON_CONDOR: conCondor ? condor / (ancho - credito) : null }, creditoAncho: conCondor ? credito / ancho : null };
      obs.push(f); out.write(JSON.stringify(f) + '\n');
    }
    console.log(venc, 'casos', casos.length, 'acumulado', obs.length);
  }
  out.end(); console.log('descartes', JSON.stringify(por));
  // Resumen. El error se calcula entre vencimientos: las empresas de un mismo mes se mueven juntas y no son independientes.
  const porFecha = (lista, fn) => { const g = new Map(); for (const o of lista) g.set(o.venc, [...(g.get(o.venc) || []), o]); return [...g.values()].map(fn).filter(Number.isFinite); };
  const est = l => { const m = media(l), se = Math.sqrt(l.reduce((a, x) => a + (x - m) ** 2, 0) / (l.length - 1) / l.length); return `${(m * 100).toFixed(1)} % (±${(1.96 * se * 100).toFixed(1)})`; };
  const corr = (x, y) => { const a = media(x), b = media(y), c = x.reduce((s, v, i) => s + (v - a) * (y[i] - b), 0); return c / Math.sqrt(x.reduce((s, v) => s + (v - a) ** 2, 0) * y.reduce((s, v) => s + (v - b) ** 2, 0)); };
  const rangos = l => { const o = l.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]), r = []; o.forEach(([, i], k) => { r[i] = k; }); return r; };
  for (const e of ['LONG_CALL', 'LONG_PUT', 'IRON_CONDOR']) {
    const con = obs.filter(o => Number.isFinite(o.puntajes[e]) && Number.isFinite(o.r[e])), alto = con.filter(o => o.puntajes[e] >= 60), bajo = con.filter(o => o.puntajes[e] < 40);
    const ic = porFecha(con, g => (g.length > 8 ? corr(rangos(g.map(o => o.puntajes[e])), rangos(g.map(o => o.r[e]))) : NaN)), icM = media(ic), icT = icM / (Math.sqrt(ic.reduce((a, x) => a + (x - icM) ** 2, 0) / (ic.length - 1)) / Math.sqrt(ic.length));
    const prom = l => est(porFecha(l, g => media(g.map(o => o.r[e]))));
    console.log(`${e}: siempre ${prom(con)} | gana ${(media(con.map(o => +(o.r[e] > 0))) * 100).toFixed(0)} % | puntaje ≥60: ${prom(alto)} n=${alto.length} | <40: ${bajo.length ? prom(bajo) : '-'} n=${bajo.length} | correlación puntaje-resultado ${icM.toFixed(3)} (t=${icT.toFixed(2)}, ${ic.length} meses)`);
  }
  const mejor = obs.map(o => { const [e, p] = Object.entries(o.puntajes).filter(([, x]) => Number.isFinite(x)).sort((a, b) => b[1] - a[1])[0] || []; return e && p >= 60 && Number.isFinite(o.r[e]) ? { ...o, r1: o.r[e], e } : null; }).filter(Boolean);
  console.log('mejor estrategia con puntaje ≥60:', est(porFecha(mejor, g => media(g.map(o => o.r1)))), 'n=' + mejor.length, JSON.stringify(mejor.reduce((a, o) => ({ ...a, [o.e]: (a[o.e] || 0) + 1 }), {})));
  console.log('IV/HV20: mediana', [...obs].map(o => o.iv / o.hv).filter(Number.isFinite).sort((a, b) => a - b)[obs.length >> 1]?.toFixed(2), '| cóndor con IV/HV>1.2:', est(porFecha(obs.filter(o => o.iv / o.hv > 1.2), g => media(g.map(o => o.r.IRON_CONDOR).filter(Number.isFinite)))), '| resto:', est(porFecha(obs.filter(o => !(o.iv / o.hv > 1.2)), g => media(g.map(o => o.r.IRON_CONDOR).filter(Number.isFinite)))));
  process.exit();
})().catch(e => { console.error(e); process.exit(1); });
