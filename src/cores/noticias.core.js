// Core noticias: sentimiento léxico propio con decaimiento exponencial por antigüedad.
// Entrada: noticias guardadas (Alpaca News API, proveedor Benzinga) con titulo, resumen y publicadaEn.
//
// Por noticia (título + resumen):
//   cada término del léxico aporta v (−2..+2) × intensidad (×1.5 intensificador / ×0.5 atenuador) y cambia de signo si
//   está dentro de la ventana de un negador. pos = Σ aportes positivos; neg = Σ |aportes negativos|.
//   polaridad p = (pos − neg)/(pos + neg) ∈ [−1, 1]  (solo si hay coincidencias; si no, la noticia no tiene polaridad)
//   fuerza f = min(1, (pos + neg)/FUERZA_REFERENCIA)   (una noticia con un solo término débil pesa menos)
// Agregado (solo noticias con polaridad):
//   peso_i = 0.5^(edad_i / vidaMedia) · f_i
//   sesgo = Σ peso_i p_i / Σ peso_i
//   confianza = (1 − e^(−Σ peso_i / SATURACION_PESO)) · consistencia,  consistencia = |Σ peso_i p_i| / Σ peso_i |p_i|
//   cobertura = noticias con polaridad / noticias analizadas
// Las noticias sin términos del léxico NO cuentan como neutras (antes diluían el promedio hacia 0): solo bajan la cobertura.
import { ATENUADORES, FACTOR_ATENUADOR, FACTOR_INTENSIFICADOR, INTENSIFICADORES, LEXICO, NEGADORES, VENTANA_INTENSIDAD, VENTANA_NEGACION } from './lexico.js';
import { clamp, DIA_MS, esNumero, finalizar, metrica, tiempo } from './util.js';

export const VERSION = 'noticias@1.1.0';
export const REQUIERE = ['noticias'];
export const SENALES = [
  { nombre: 'sentimiento_promedio', etiqueta: 'Sentimiento promedio', descripcion: 'Sentimiento léxico de los titulares con decaimiento exponencial por antigüedad.', pesoBase: 1 },
];

// ---- Constantes. vidaMediaDias y ventanaDias son variables por perfil (parametros); el resto son fijas.
// Vida media por defecto: 3 días (el efecto de una noticia en el precio se disipa en pocas sesiones; heurística).
export const VIDA_MEDIA_DIAS = 3;
// Ventana por defecto: 30 días (≈ un vencimiento mensual de opciones).
export const VENTANA_DIAS = 30;
// Polaridad mínima para contar una noticia como positiva/negativa en los conteos (solo descriptivo).
export const UMBRAL_POLARIDAD = 0.1;
// Suma léxica (pos + neg) que da fuerza 1: un término fuerte (±2) o dos moderados (±1).
export const FUERZA_REFERENCIA = 2;
// Peso efectivo que da 63 % de la confianza máxima (1 − e^−1): ≈ 2 noticias recientes y fuertes.
export const SATURACION_PESO = 2;

export const normalizarTexto = texto =>
  String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '');

export const tokenizar = texto => normalizarTexto(texto).match(/[a-z0-9]+/g) || [];

/**
 * Puntúa un texto. Devuelve { puntaje (= polaridad p, 0 sin coincidencias), positivo, negativo, coincidencias, fuerza }.
 * La negación dura VENTANA_NEGACION palabras tras el negador; la intensidad, VENTANA_INTENSIDAD palabras tras el modificador.
 */
export const puntuarTexto = texto => {
  let positivo = 0;
  let negativo = 0;
  let coincidencias = 0;
  let negacion = 0;
  let intensidad = { factor: 1, restante: 0 };
  for (const token of tokenizar(texto)) {
    if (NEGADORES.has(token)) { negacion = VENTANA_NEGACION; continue; }
    if (INTENSIFICADORES.has(token)) { intensidad = { factor: FACTOR_INTENSIFICADOR, restante: VENTANA_INTENSIDAD }; continue; }
    if (ATENUADORES.has(token)) { intensidad = { factor: FACTOR_ATENUADOR, restante: VENTANA_INTENSIDAD }; continue; }
    if (Object.prototype.hasOwnProperty.call(LEXICO, token)) {
      let v = LEXICO[token] * (intensidad.restante > 0 ? intensidad.factor : 1);
      if (negacion > 0) v = -v;
      if (v > 0) positivo += v; else negativo -= v;
      coincidencias++;
      intensidad = { factor: 1, restante: 0 }; // el modificador se consume en el primer término
    }
    if (negacion > 0) negacion--;
    if (intensidad.restante > 0) intensidad.restante--;
  }
  const total = positivo + negativo;
  return {
    puntaje: total > 0 ? (positivo - negativo) / total : 0,
    positivo, negativo, coincidencias,
    fuerza: Math.min(1, total / FUERZA_REFERENCIA),
  };
};

export function evaluar(input = {}) {
  const parametros = input.parametros || {};
  const vidaMedia = esNumero(parametros.vidaMediaDias) && parametros.vidaMediaDias > 0 ? parametros.vidaMediaDias : VIDA_MEDIA_DIAS;
  const ventana = esNumero(parametros.ventanaDias) && parametros.ventanaDias > 0 ? parametros.ventanaDias : VENTANA_DIAS;
  const ref = tiempo(input.fechaReferencia);
  const motivos = [];
  const datosFaltantes = [];
  const metricas = [];
  if (ref == null) {
    datosFaltantes.push('fechaReferencia');
    motivos.push('Sin fecha de referencia: no se aplica decaimiento por antigüedad (peso uniforme).');
  }

  const vistos = new Set();
  const analizadas = [];
  for (const n of Array.isArray(input.noticias) ? input.noticias : []) {
    if (!n || !n.titulo) continue;
    const t = tiempo(n.publicadaEn);
    if (ref != null) {
      if (t == null || t > ref) continue; // sin fecha o posterior a la referencia
      if ((ref - t) / DIA_MS > ventana) continue;
    }
    const clave = tokenizar(n.titulo).join(' ');
    if (!clave || vistos.has(clave)) continue; // titulares duplicados entre proveedores
    vistos.add(clave);
    const r = puntuarTexto(`${n.titulo} ${n.resumen || ''}`);
    const edad = ref == null ? 0 : (ref - t) / DIA_MS;
    analizadas.push({ ...r, decaimiento: 0.5 ** (edad / vidaMedia) });
  }

  let sesgo = null;
  let confianza = 0;
  let cobertura = 0;
  const polares = analizadas.filter(x => x.coincidencias > 0 && x.positivo + x.negativo > 0);
  if (!analizadas.length) {
    datosFaltantes.push('noticias');
    motivos.push(`Sin noticias en los últimos ${ventana} días.`);
  } else if (!polares.length) {
    datosFaltantes.push('noticias.terminos_lexico');
    motivos.push(`${analizadas.length} noticias analizadas, ninguna con términos del léxico: sin sentimiento medible.`);
    metricas.push(metrica('noticias_analizadas', analizadas.length, 'conteo', `${ventana}d`));
  } else {
    const pesos = polares.map(x => x.decaimiento * x.fuerza);
    const sumaPeso = pesos.reduce((a, w) => a + w, 0);
    const suma = polares.reduce((a, x, i) => a + pesos[i] * x.puntaje, 0);
    const sumaAbs = polares.reduce((a, x, i) => a + pesos[i] * Math.abs(x.puntaje), 0);
    sesgo = sumaPeso > 0 ? clamp(suma / sumaPeso) : 0;
    cobertura = polares.length / analizadas.length;
    const positivas = polares.filter(x => x.puntaje > UMBRAL_POLARIDAD).length;
    const negativas = polares.filter(x => x.puntaje < -UMBRAL_POLARIDAD).length;
    const consistencia = sumaAbs > 0 ? Math.abs(suma) / sumaAbs : 0;
    confianza = (1 - Math.exp(-sumaPeso / SATURACION_PESO)) * consistencia;
    const sinPeso = polares.reduce((a, x) => a + x.puntaje, 0) / polares.length;
    metricas.push(
      metrica('sentimiento_promedio', sesgo, 'indice', `${ventana}d`),
      metrica('sentimiento_sin_decaimiento', sinPeso, 'indice', `${ventana}d`),
      metrica('noticias_positivas', positivas, 'conteo', `${ventana}d`),
      metrica('noticias_negativas', negativas, 'conteo', `${ventana}d`),
      metrica('noticias_con_terminos', polares.length, 'conteo', `${ventana}d`),
      metrica('noticias_analizadas', analizadas.length, 'conteo', `${ventana}d`),
      metrica('consistencia_noticias', consistencia, 'fraccion', `${ventana}d`),
      metrica('peso_efectivo', sumaPeso, 'noticias', `vida media ${vidaMedia}d`),
    );
    motivos.push(`${analizadas.length} noticias analizadas (${polares.length} con términos del léxico): ${positivas} positivas, ${negativas} negativas; sentimiento ponderado ${sesgo.toFixed(2)} (sin decaimiento ${sinPeso.toFixed(2)}, vida media ${vidaMedia} días).`);
    if (Math.abs(sesgo - sinPeso) > 0.3) motivos.push('Las noticias más recientes pesan más (decaimiento exponencial): el sentimiento reciente difiere del promedio del periodo.');
  }

  return finalizar({ sesgo, confianza, cobertura, metricas, motivos, datosFaltantes, reglas: input.reglas, core: 'noticias' });
}
