import boom from '@hapi/boom';
import * as models from '../api/v1/models';
export const resources = {
  'empresas': { Model: models.Empresa, table: 'api_empresas' },
  'estrategias': { Model: models.Estrategia, table: 'api_estrategias' },
  'configuraciones': { Model: models.Configuracion, table: 'api_configuraciones' },
  'perfiles-analisis': { Model: models.PerfilAnalisis, table: 'api_perfiles_analisis' },
  'brokers': { Model: models.Broker, table: 'api_brokers' },
  'conexiones-broker': { Model: models.ConexionBroker, table: 'api_conexiones_broker' },
  'sesiones': { Model: models.Sesion, table: 'api_sesiones' },
  'contratos': { Model: models.ContratoOpcion, table: 'api_contratos' },
  'datos-mercado': { Model: models.DatoMercado, table: 'api_datos_mercado' },
  'fundamentales': { Model: models.Fundamental, table: 'api_fundamentales' },
  'institucional': { Model: models.ReporteInstitucional, table: 'api_institucional' },
  'noticias': { Model: models.Noticia, table: 'api_noticias' },
  'evaluaciones': { Model: models.Evaluacion, table: 'api_evaluaciones' },
  'selecciones': { Model: models.Seleccion, table: 'api_selecciones' },
  'confluencias': { Model: models.Confluencia, table: 'api_confluencias' },
  'ordenes': { Model: models.Orden, table: 'api_ordenes' },
  'posiciones': { Model: models.Posicion, table: 'api_posiciones' },
  'sincronizaciones': { Model: models.Sincronizacion, table: 'api_sincronizaciones' },
  'screener': { Model: models.Screener, table: 'api_screener' },
  'auditoria': { Model: models.EventoAuditoria, table: 'api_auditoria' },
};
// Filtros de igualdad de repositorio: solo claves alfanuméricas y valores string.
export function filtroSeguro(filtro) {
  if (!filtro) return [];
  return Object.entries(filtro).map(([k, v]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(k) || typeof v !== 'string') throw boom.badRequest('Filtro inválido.');
    return [k, v];
  });
}
// Filtro con los valores convertidos al tipo del esquema: [[campo, valor]]. null: ningún registro puede coincidir.
export function condiciones(name, filtro) {
  const salida = [];
  for (const [campo, texto] of filtroSeguro(filtro)) {
    const tipo = resource(name).Model.schema.path(campo);
    let valor = texto;
    if (tipo?.schema || texto.includes('\0')) return null; // subdocumentos: no hay igualdad de texto posible
    if (tipo?.instance === 'Number') { valor = Number(texto); if (String(valor) !== texto || !Number.isFinite(valor)) return null; }
    else if (tipo?.instance === 'Boolean') { if (!['true', 'false'].includes(texto)) return null; valor = texto === 'true'; }
    else if (tipo?.instance === 'Date') { valor = new Date(texto); if (Number.isNaN(valor.getTime())) return null; }
    else if (tipo?.instance === 'Array') valor = texto ? texto.split(',') : [];
    salida.push([campo, valor]);
  }
  return salida;
}
// Búsqueda de texto: subcadena sin distinguir mayúsculas, como expresión regular escapada.
export const CAMPOS_BUSQUEDA = ['nombre', 'simbolo', 'titulo', 'descripcion'];
export function patronBusqueda(texto) {
  if (typeof texto !== 'string' || texto.length > 200 || texto.includes('\0')) throw boom.badRequest('Búsqueda inválida (máximo 200 caracteres).');
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Los identificadores llegan en rutas y cuerpos: solo texto, nunca objetos con operadores.
export function idSeguro(id) {
  if (typeof id !== 'string' || !id) throw boom.badRequest('Identificador inválido.');
  return id;
}
// Referencias guardadas como arreglo de identificadores (el esquema no las declara con ref).
export const REFERENCIAS_ARREGLO = { confluencias: { evaluacionesIds: 'evaluaciones' }, selecciones: { empresasCandidatas: 'empresas' } };
// Rutas del recurso `name` que apuntan a `destino`: listas de segmentos { campo, arreglo }.
export function rutasReferencia(name, destino) {
  const modelo = resource(destino).Model.modelName;
  const visitar = (schema, base) => Object.entries(schema.paths).flatMap(([campo, tipo]) => {
    if (tipo.options.ref === modelo) return [[...base, { campo, arreglo: false }]];
    return tipo.schema ? visitar(tipo.schema, [...base, { campo, arreglo: Boolean(tipo.$isMongooseDocumentArray) }]) : [];
  });
  return [...visitar(resource(name).Model.schema, []),
    ...Object.entries(REFERENCIAS_ARREGLO[name] || {}).filter(([, d]) => d === destino).map(([campo]) => [{ campo, arreglo: true }])];
}
// Único borrado masivo permitido (retención): nunca órdenes, posiciones ni análisis.
export function filtroPurga(name, filtro) {
  if (['auditoria', 'sincronizaciones'].includes(name) && !filtro) return [];
  if (name === 'datos-mercado' && filtro?.tipo === 'cotizacion' && Object.keys(filtro).length === 1) return [['tipo', 'cotizacion']];
  throw new Error('Purga no permitida: ' + name);
}
export function resource(name) {
  if (!Object.hasOwn(resources, name)) throw new Error('Recurso interno desconocido');
  return resources[name];
}
