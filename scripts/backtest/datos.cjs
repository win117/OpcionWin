// Backtest, paso 1: evaluaciones punto en el tiempo (técnico, indicadores, fundamental) y resultado posterior. Solo lectura.
const P = process.cwd(); require(P + '/node_modules/dotenv').config({ quiet: true });
const fs = require('fs'); const { createIntegrations } = require(P + '/dist/integrations'); const { cores } = require(P + '/dist/cores');
const { repository } = require(P + '/dist/repositories'); const { closeMongo } = require(P + '/dist/config/database.config');
const DIR = process.argv[2], H = 25; // 25 sesiones ≈ 36 días
(async () => {
  const { alpaca, sec } = createIntegrations(process.env);
  const filas = (await repository('screener', { userId: 'sistema-universo', database: 'mongodb' }).list({ offset: 0, limit: 500 })).map(x => x.document); await closeMongo();
  const emp = filas.map(f => ({ s: f.simbolo, cik: f.cik })); console.log('empresas', emp.length);
  const velas = {}; for (let i = 0; i < emp.length; i += 20) Object.assign(velas, await alpaca.velasLote(emp.slice(i, i + 20).map(e => e.s), { desde: '2016-01-01T00:00:00Z', hasta: new Date(Date.now() - 16 * 6e4).toISOString(), feed: 'sip' }));
  console.log('con velas', Object.keys(velas).length);
  const fund = {}; let n = 0;
  if (process.argv[3] === 'fund') for (const e of emp) { if (fund[e.cik]) continue; try { fund[e.cik] = await sec.fundamentales(e.cik, { maxPeriodos: 200 }); } catch { fund[e.cik] = []; } if (++n % 100 === 0) console.log('fundamentales', n); }
  // Fin de mes 2018-01 … con H sesiones por delante.
  const ref = velas.SPY || velas.AAPL, fechas = ref.map(v => v.fecha.slice(0, 10)), meses = [];
  for (let i = 300; i < fechas.length - H; i++) if (fechas[i].slice(0, 7) !== fechas[i + 1].slice(0, 7) && fechas[i] >= '2018-01') meses.push(fechas[i]);
  console.log('fechas', meses.length, meses[0], meses.at(-1));
  const out = fs.createWriteStream(DIR + '/bt.jsonl'); let filasN = 0;
  for (const e of emp) {
    const v = velas[e.s]; if (!v || v.length < 320) continue;
    const idx = new Map(v.map((x, i) => [x.fecha.slice(0, 10), i]));
    for (const d of meses) {
      const i = idx.get(d); if (i == null || i < 260 || i + H >= v.length) continue;
      const win = v.slice(i - 274 < 0 ? 0 : i - 274, i + 1), t = new Date(Date.parse(v[i].fecha) + 20 * 36e5).toISOString();
      const inp = { simbolo: e.s, fechaReferencia: t, velas: win, opciones: [], parametros: {}, reglas: [] };
      const T = cores.tecnico.evaluar(inp), I = cores.indicadores.evaluar(inp);
      const fp = (fund[e.cik] || []).filter(p => p.fuente?.fechaDato && Date.parse(p.fuente.fechaDato) <= Date.parse(t)).slice(0, 12); // solo lo ya publicado
      const F = fp.length ? cores.fundamental.evaluar({ fundamentales: fp, fechaReferencia: t, parametros: {}, reglas: [] }) : null;
      const hv = I.metricas.find(m => m.nombre === 'hv_20')?.valor; if (!(hv > 0)) continue;
      const r = x => (x && Number.isFinite(x.sesgo) ? [x.sesgo, x.confianza] : null);
      out.write(JSON.stringify({ s: e.s, d, hv, hv60: I.metricas.find(m => m.nombre === 'hv_60')?.valor ?? null, ret: v[i + H].cierre / v[i].cierre - 1, T: r(T), I: r(I), F: r(F) }) + '\n'); filasN++;
    }
  }
  out.end(() => { console.log('observaciones', filasN); process.exit(); });
})();
