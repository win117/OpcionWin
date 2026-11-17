// Core noticias: sentimiento léxico propio con decaimiento exponencial por antigüedad.
import { LEXICO, NEGADORES, VENTANA_NEGACION } from './lexico.js';
import { clamp, DIA_MS, esNumero, finalizar, metrica, tiempo } from './util.js';

export const VERSION = 'noticias@1.0.1';
export const REQUIERE = ['noticias'];
export const SENALES = [
  { nombre: 'sentimiento_promedio', etiqueta: 'Sentimiento promedio', descripcion: 'Sentimiento léxico de los titulares con decaimiento exponencial por antigüedad.', pesoBase: 1 },
];

const UMBRAL_POLARIDAD = 0.1;

export const normalizarTexto = texto =>
  String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '');

export const tokenizar = texto => normalizarTexto(texto).match(/[a-z0-9]+/g) || [];

/** Puntaje de un texto en −1..1: suma léxica con negación (ventana de 3 palabras), comprimida con tanh(suma/2). */
export const puntuarTexto = texto => {
  let suma = 0;
  let coincidencias = 0;
  let negacion = 0;
  for (const token of tokenizar(texto)) {
    if (NEGADORES.has(token)) {
      negacion = VENTANA_NEGACION;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(LEXICO, token)) {
      suma += negacion > 0 ? -LEXICO[token] : LEXICO[token];
      coincidencias++;
    }
    if (negacion > 0) negacion--;
  }
  return { puntaje: Math.tanh(suma / 2), coincidencias };
};

export function evaluar(input = {}) {
  const parametros = input.parametros || {};
  const vidaMedia = esNumero(parametros.vidaMediaDias) && parametros.vidaMediaDias > 0 ? parametros.vidaMediaDias : 3;
  const ventana = esNumero(parametros.ventanaDias) && parametros.ventanaDias > 0 ? parametros.ventanaDias : 30;
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
    const { puntaje, coincidencias } = puntuarTexto(`${n.titulo} ${n.resumen || ''}`);
    const edad = ref == null ? 0 : (ref - t) / DIA_MS;
    analizadas.push({ puntaje, coincidencias, peso: 0.5 ** (edad / vidaMedia) });
  }

  let sesgo = null;
  let confianza = 0;
  if (!analizadas.length) {
    datosFaltantes.push('noticias');
    motivos.push(`Sin noticias en los últimos ${ventana} días.`);
  } else {
    const sumaPeso = analizadas.reduce((a, x) => a + x.peso, 0);
    const suma = analizadas.reduce((a, x) => a + x.peso * x.puntaje, 0);
    const sumaAbs = analizadas.reduce((a, x) => a + x.peso * Math.abs(x.puntaje), 0);
    sesgo = sumaPeso > 0 ? clamp(suma / sumaPeso) : 0;
    const positivas = analizadas.filter(x => x.puntaje > UMBRAL_POLARIDAD).length;
    const negativas = analizadas.filter(x => x.puntaje < -UMBRAL_POLARIDAD).length;
    const consistencia = sumaAbs > 0 ? Math.abs(suma) / sumaAbs : 0;
    // Más peso efectivo (noticias recientes) y más acuerdo → más confianza.
    confianza = (1 - Math.exp(-sumaPeso / 2)) * consistencia;
    metricas.push(
      metrica('sentimiento_promedio', sesgo, 'indice', `${ventana}d`),
      metrica('noticias_positivas', positivas, 'conteo', `${ventana}d`),
      metrica('noticias_negativas', negativas, 'conteo', `${ventana}d`),
      metrica('noticias_analizadas', analizadas.length, 'conteo', `${ventana}d`),
      metrica('peso_efectivo', sumaPeso, 'noticias', `vida media ${vidaMedia}d`),
    );
    motivos.push(`${analizadas.length} noticias analizadas: ${positivas} positivas, ${negativas} negativas; sentimiento ponderado ${sesgo.toFixed(2)} (vida media ${vidaMedia} días).`);
    if (analizadas.every(x => x.coincidencias === 0)) motivos.push('Ninguna noticia contiene términos del léxico: sentimiento neutral.');
  }

  return finalizar({ sesgo, confianza, cobertura: analizadas.length ? 1 : 0, metricas, motivos, datosFaltantes, reglas: input.reglas, core: 'noticias' });
}
