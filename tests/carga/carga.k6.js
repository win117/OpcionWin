// Pruebas de carga y estrés con k6 (inciso C). Se ejecuta contra el servidor de pruebas (base en memoria, sin proveedores):
//   npm run test:carga                 → MODO=carga  (50 usuarios virtuales sostenidos)
//   MODO=estres npm run test:carga     → sube hasta 300 usuarios virtuales para encontrar el punto de quiebre
//   MODO=humo  npm run test:carga      → 1 usuario, 10 iteraciones (verifica que el guion funciona)
// Umbrales (fallan la prueba si no se cumplen): errores < 1 %, p95 < 300 ms en carga, checks > 99 %.
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3040';
const API = BASE + '/api/v1';
const MODO = __ENV.MODO || 'carga';
const listar = new Trend('lat_listar_empresas', true);
const leer = new Trend('lat_leer_empresa', true);

const ESCENARIOS = {
  humo: { executor: 'shared-iterations', vus: 1, iterations: 10 },
  carga: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '20s', target: 50 }, { duration: '60s', target: 50 }, { duration: '10s', target: 0 }] },
  estres: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '20s', target: 50 }, { duration: '20s', target: 150 }, { duration: '20s', target: 300 }, { duration: '30s', target: 300 }, { duration: '10s', target: 0 }] },
};

export const options = {
  scenarios: { [MODO]: ESCENARIOS[MODO] },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    http_req_duration: [MODO === 'estres' ? 'p(95)<1500' : 'p(95)<300'],
    lat_listar_empresas: ['p(95)<400'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// Una sola sesión para todos los usuarios virtuales: el login tiene límite de 10 intentos por minuto (protección intencional).
export function setup() {
  const r = http.post(API + '/sesiones', JSON.stringify({ email: __ENV.EMAIL || 'prueba@local', password: __ENV.PASSWORD || 'clave-de-pruebas', baseDatos: 'mongodb' }), { headers: { 'Content-Type': 'application/json' } });
  check(r, { 'login 200': x => x.status === 200 });
  const token = r.json('data.token');
  const auth = { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } };
  http.post(API + '/estrategias/catalogo-base', null, auth);
  const ids = [];
  for (let i = 0; i < 20; i++) ids.push(http.post(API + '/empresas', JSON.stringify({ simbolo: 'K6' + i, nombre: 'Carga ' + i, mercado: 'NASDAQ' }), auth).json('data._id'));
  return { token, ids };
}

export default function ({ token, ids }) {
  const auth = { headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } };
  group('lectura (80 %)', () => {
    let r = http.get(API + '/empresas?page=1&limit=20', auth);
    listar.add(r.timings.duration);
    check(r, { 'listar 200': x => x.status === 200, 'listar paginado': x => x.json('data.total') >= 20 });
    r = http.get(API + '/empresas/' + ids[Math.floor(Math.random() * ids.length)], auth);
    leer.add(r.timings.duration);
    check(r, { 'leer 200': x => x.status === 200 });
    check(http.get(API + '/estrategias', auth), { 'estrategias 200': x => x.status === 200 });
    check(http.get(API + '/cores/catalogo', auth), { 'catálogo 200': x => x.status === 200 });
  });
  if (Math.random() < 0.2) group('escritura (20 %)', () => {
    const r = http.post(API + '/empresas', JSON.stringify({ simbolo: 'W' + __VU + '-' + __ITER, nombre: 'Escritura', mercado: 'NYSE' }), auth);
    check(r, { 'crear 201': x => x.status === 201 });
  });
  check(http.get(BASE + '/health/listo'), { 'readiness 200': x => x.status === 200 });
  sleep(0.5);
}
