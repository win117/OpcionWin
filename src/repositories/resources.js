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
  'auditoria': { Model: models.EventoAuditoria, table: 'api_auditoria' },
};
export function resource(name) {
  if (!Object.hasOwn(resources, name)) throw new Error('Recurso interno desconocido');
  return resources[name];
}
