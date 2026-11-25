// Black-Scholes-Merton para opciones europeas (funciones puras). Se usa para verificar de forma independiente
// las griegas e IV indicativas de Alpaca y para la probabilidad de ganancia al vencimiento (estrategias.core).
//
// Convenciones: S = precio del subyacente, K = strike, T = años hasta el vencimiento (días naturales / 365),
// r = tasa libre de riesgo continua anual, q = rendimiento por dividendo continuo anual, sigma = volatilidad anual (fracción).
//   d1 = [ln(S/K) + (r − q + σ²/2)·T] / (σ·√T) ;  d2 = d1 − σ·√T
//   call = S·e^(−qT)·N(d1) − K·e^(−rT)·N(d2) ;  put = K·e^(−rT)·N(−d2) − S·e^(−qT)·N(−d1)
// Las opciones de acciones de EE. UU. son americanas: para calls sin dividendos el valor coincide con el europeo;
// para puts (y calls con dividendos) Black-Scholes es una aproximación (subestima levemente el ejercicio anticipado).
export const VERSION = 'blackscholes@1.1.0';

// r y q los pasa quien llama (curva del Tesoro y dividendos obtenidos por el servidor; ver tasa.js). Sin dato se usa 0: no se supone ninguno.
// Días por año para T: convención de días naturales (la usada por la mayoría de proveedores de griegas).
export const DIAS_ANIO = 365;
// Límites de búsqueda de la volatilidad implícita (fracción anual): 0.01 % a 500 %.
export const IV_MIN = 1e-4;
export const IV_MAX = 5;
// Tolerancia en precio y máximo de iteraciones de la bisección de IV.
export const IV_TOLERANCIA = 1e-6;
export const IV_ITERACIONES = 200;

const finito = v => typeof v === 'number' && Number.isFinite(v);

/** Densidad normal estándar φ(x). */
export const pdf = x => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

// Coeficientes de Abramowitz & Stegun 26.2.17 (Zelen y Severo, 1964); error absoluto < 7.5e-8.
const P = 0.2316419;
const B = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429];
/** Distribución normal estándar acumulada N(x) por A&S 26.2.17. */
export const cdf = x => {
  if (!finito(x)) return x > 0 ? 1 : 0;
  const ax = Math.abs(x);
  const t = 1 / (1 + P * ax);
  const poli = t * (B[0] + t * (B[1] + t * (B[2] + t * (B[3] + t * B[4]))));
  const cola = pdf(ax) * poli; // = 1 − N(|x|)
  return x >= 0 ? 1 - cola : cola;
};

const valido = ({ S, K, T, sigma }) => finito(S) && finito(K) && finito(T) && finito(sigma) && S > 0 && K > 0 && T > 0 && sigma > 0;

/** d1 y d2; null si los parámetros no son válidos (S, K, T, σ > 0). */
export const d1d2 = ({ S, K, T, r = 0, q = 0, sigma }) => {
  if (!valido({ S, K, T, sigma }) || !finito(r) || !finito(q)) return null;
  const raiz = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / raiz;
  return { d1, d2: d1 - raiz };
};

/**
 * Precio y griegas de una opción europea.
 * - delta: ∂V/∂S (call e^(−qT)N(d1); put e^(−qT)(N(d1) − 1)).
 * - gamma: e^(−qT)φ(d1)/(Sσ√T).
 * - theta: por día natural (∂V/∂t anual / 365); negativa = pérdida de valor por paso del tiempo.
 * - vega: por 1 punto de volatilidad (∂V/∂σ / 100).
 * - rho: por 1 punto porcentual de tasa (∂V/∂r / 100).
 * - probabilidadITM: probabilidad neutral al riesgo de terminar dentro del dinero = N(d2) (call) o N(−d2) (put).
 */
export const opcion = ({ tipo, S, K, T, r = 0, q = 0, sigma }) => {
  const d = d1d2({ S, K, T, r, q, sigma });
  if (!d || !['call', 'put'].includes(tipo)) return null;
  const { d1, d2 } = d;
  const dq = Math.exp(-q * T);
  const dr = Math.exp(-r * T);
  const raizT = Math.sqrt(T);
  const esCall = tipo === 'call';
  const precio = esCall ? S * dq * cdf(d1) - K * dr * cdf(d2) : K * dr * cdf(-d2) - S * dq * cdf(-d1);
  const delta = esCall ? dq * cdf(d1) : dq * (cdf(d1) - 1);
  const gamma = (dq * pdf(d1)) / (S * sigma * raizT);
  const vegaAnual = S * dq * pdf(d1) * raizT;
  const comun = -(S * dq * pdf(d1) * sigma) / (2 * raizT);
  const thetaAnual = esCall
    ? comun - r * K * dr * cdf(d2) + q * S * dq * cdf(d1)
    : comun + r * K * dr * cdf(-d2) - q * S * dq * cdf(-d1);
  const rhoAnual = esCall ? K * T * dr * cdf(d2) : -K * T * dr * cdf(-d2);
  return {
    precio, delta, gamma, theta: thetaAnual / DIAS_ANIO, vega: vegaAnual / 100, rho: rhoAnual / 100,
    d1, d2, probabilidadITM: esCall ? cdf(d2) : cdf(-d2),
  };
};

export const precio = args => opcion(args)?.precio ?? null;

/**
 * Probabilidad neutral al riesgo de que S_T > X al vencimiento bajo el modelo lognormal de Black-Scholes: N(d2(X)).
 * Es la "probabilidad de terminar ITM" de un call de strike X. No es una probabilidad del mundo real (no incluye prima de riesgo).
 */
export const probabilidadSobre = ({ S, X, T, r = 0, q = 0, sigma }) => {
  if (finito(X) && X <= 0) return 1;
  const d = d1d2({ S, K: X, T, r, q, sigma });
  return d ? cdf(d.d2) : null;
};

/**
 * Volatilidad implícita por bisección sobre [IV_MIN, IV_MAX] (el precio BS es monótono creciente en σ).
 * null si el precio está fuera de los límites sin arbitraje o no converge.
 */
export const volatilidadImplicita = ({ tipo, precio: objetivo, S, K, T, r = 0, q = 0 }) => {
  if (!finito(objetivo) || objetivo <= 0 || !valido({ S, K, T, sigma: 1 })) return null;
  const f = s => opcion({ tipo, S, K, T, r, q, sigma: s })?.precio;
  let bajo = IV_MIN;
  let alto = IV_MAX;
  const pBajo = f(bajo);
  const pAlto = f(alto);
  if (pBajo == null || pAlto == null || objetivo < pBajo - IV_TOLERANCIA || objetivo > pAlto + IV_TOLERANCIA) return null;
  for (let i = 0; i < IV_ITERACIONES; i++) {
    const medio = (bajo + alto) / 2;
    const p = f(medio);
    if (Math.abs(p - objetivo) < IV_TOLERANCIA) return medio;
    if (p < objetivo) bajo = medio; else alto = medio;
  }
  return (bajo + alto) / 2;
};
