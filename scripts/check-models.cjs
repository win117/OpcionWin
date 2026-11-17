const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const models = require('../dist/api/v1/models');
const valid = async (name, data) => {
  const doc = new models[name](data);
  await doc.validate();
  return doc;
};
const invalid = async (name, data) => {
  await assert.rejects(async () => { await new models[name](data).validate(); });
};
const fuente = { proveedor: 'ejemplo', fechaDato: '2026-11-01' };
const componente = { contratoId: 'contrato-1', accion: 'buy', cantidad: 1, proporcion: 1 };
const regla = { core: 'tecnico', criterio: 'tendencia', operador: 'gte', valorReferencia: 0, peso: 1 };
const examples = {
  Empresa: { simbolo: 'aapl', nombre: 'Empresa ejemplo', mercado: 'NASDAQ' },
  Estrategia: { codigo: 'LONG_CALL', nombre: 'Long Call', descripcion: 'Catálogo' },
  Configuracion: { usuarioId: 'u1', empresaId: 'e1', estrategiaId: 's1', nombre: 'Borrador', componentes: [componente] },
  PerfilAnalisis: { usuarioId: 'u1', nombre: 'Perfil', coresSeleccionados: ['tecnico'], reglas: [regla] },
  Broker: { codigo: 'alpaca', nombre: 'Alpaca' },
  ConexionBroker: { usuarioId: 'u1', brokerId: 'b1', alias: 'Demo', entorno: 'paper', credencialRef: 'vault/ref' },
  Sesion: { usuarioId: 'u1', baseDatos: 'mongodb', tokenHash: 'hash-no-token-real', expiraEn: new Date(Date.now() + 3600000) },
  ContratoOpcion: { proveedor: 'ejemplo', contratoExternoId: 'c1', empresaId: 'e1', simbolo: 'CONTRATO', tipo: 'call', strike: 100, vencimiento: '2027-01-15' },
  DatoMercado: { empresaId: 'e1', tipo: 'vela', fuente, intervalo: '1Day', apertura: 10, maximo: 12, minimo: 9, cierre: 11, volumen: 100 },
  Fundamental: { empresaId: 'e1', fuente, periodoInicio: '2026-01-01', periodoFin: '2026-03-31', metricas: [{ nombre: 'ingresos', valor: 1000, unidad: 'USD' }] },
  ReporteInstitucional: { empresaId: 'e1', fuente, fechaCorte: '2026-03-31', fechaPublicacion: '2026-05-10', tenencias: [{ institucion: 'Institución ejemplo', identificadorInstitucion: 'i1', acciones: 10, valorReportado: 1000, unidad: 'USD' }] },
  Noticia: { proveedor: 'ejemplo', noticiaExternaId: 'n1', titulo: 'Ejemplo', url: 'https://example.com/noticia', publicadaEn: '2026-11-01' },
  Evaluacion: { usuarioId: 'u1', core: 'tecnico', empresaId: 'e1', versionAlgoritmo: '1' },
  Seleccion: { usuarioId: 'u1', modo: 'empresa', empresaId: 'e1', coresSeleccionados: ['tecnico'] },
  Confluencia: { usuarioId: 'u1', empresaId: 'e1', estrategiaId: 's1', evaluacionesIds: ['ev1'], coresSeleccionados: ['tecnico'], versionAlgoritmo: '1' },
  Orden: { usuarioId: 'u1', conexionId: 'cn1', configuracionId: 'cf1', idempotencyKey: 'clave1', tipo: 'limit', vigencia: 'day', cantidad: 1, precioLimite: -1.25, componentes: [{ contratoId: 'c1', simbolo: 'CONTRATO', accion: 'sell', intencion: 'sell_to_open', proporcion: 1 }] },
  Posicion: { usuarioId: 'u1', conexionId: 'cn1', posicionExternaId: 'p1', contratoId: 'c1', lado: 'long', cantidad: 1, precioPromedio: 1.5, actualizadaEn: '2026-11-01' },
  Sincronizacion: { usuarioId: 'u1', proveedor: 'ejemplo', recurso: 'historicos' },
  EventoAuditoria: { usuarioId: 'u1', accion: 'consulta', recurso: 'empresas', resultado: 'exito', requestId: 'req1' },
};
for (const [name, example] of Object.entries(examples)) {
  test(name + ': documento válido sin persistencia', async () => {
    const doc = await valid(name, example);
    assert.equal(typeof doc._id, 'string');
    assert.equal(models[name].schema.options.autoCreate, false);
    assert.equal(models[name].schema.options.autoIndex, false);
    assert.equal(mongoose.connection.readyState, 0);
  });
}
test('Rechaza campos desconocidos y empresa sin nombre', async () => {
  await invalid('Empresa', { ...examples.Empresa, campoInventado: true });
  await invalid('Empresa', { simbolo: 'TEST', mercado: 'NASDAQ' });
  assert.equal((await valid('Empresa', examples.Empresa)).simbolo, 'AAPL');
});
test('Estrategias restringidas al alcance asignado', async () => {
  await invalid('Estrategia', { ...examples.Estrategia, codigo: 'OTRA' });
});
test('Componentes: cantidades enteras positivas e identificadores únicos', async () => {
  for (const cantidad of [0, -1, 1.5, Infinity]) await invalid('Configuracion', { ...examples.Configuracion, componentes: [{ ...componente, cantidad }] });
  await invalid('Configuracion', { ...examples.Configuracion, componentes: [{ ...componente, _id: 'x' }, { ...componente, _id: 'x' }] });
  const doc = await valid('Configuracion', { ...examples.Configuracion, componentes: [componente, componente] });
  assert.notEqual(doc.componentes[0]._id, doc.componentes[1]._id);
});
test('Perfil: cores requeridos, sin duplicados, reglas coherentes y rangos válidos', async () => {
  for (const coresSeleccionados of [[], ['tecnico', 'tecnico'], ['inexistente']]) await invalid('PerfilAnalisis', { ...examples.PerfilAnalisis, coresSeleccionados });
  await invalid('PerfilAnalisis', { ...examples.PerfilAnalisis, reglas: [{ ...regla, core: 'noticias' }] });
  await invalid('PerfilAnalisis', { ...examples.PerfilAnalisis, reglas: [{ ...regla, operador: 'between', valorReferencia: 10, valorSuperior: 2 }] });
  await invalid('PerfilAnalisis', { ...examples.PerfilAnalisis, parametros: { diasVencimientoMin: 90, diasVencimientoMax: 30 } });
});
test('Datos de mercado: OHLC, spread, contrato y griegas', async () => {
  await invalid('DatoMercado', { ...examples.DatoMercado, maximo: 5 });
  await invalid('DatoMercado', { ...examples.DatoMercado, apertura: undefined });
  await invalid('DatoMercado', { empresaId: 'e1', tipo: 'cotizacion', fuente, bid: 5, ask: 4 });
  await invalid('DatoMercado', { empresaId: 'e1', tipo: 'snapshot_opcion', fuente });
  await invalid('DatoMercado', { empresaId: 'e1', tipo: 'snapshot_opcion', contratoId: 'c1', fuente, griegas: { delta: 2 } });
});
test('Evaluaciones y selecciones requieren contexto correcto', async () => {
  await invalid('Evaluacion', { ...examples.Evaluacion, empresaId: undefined });
  await invalid('Evaluacion', { ...examples.Evaluacion, puntaje: 101 });
  await invalid('Seleccion', { ...examples.Seleccion, modo: 'empresa_estrategia' });
  await valid('Seleccion', { ...examples.Seleccion, modo: 'empresa_estrategia', estrategiaId: 's1' });
  await valid('Seleccion', { usuarioId: 'u1', modo: 'estrategia', estrategiaId: 's1', coresSeleccionados: ['noticias'] });
  await invalid('Confluencia', { ...examples.Confluencia, evaluacionesIds: [] });
  await invalid('Confluencia', { ...examples.Confluencia, ponderaciones: [{ core: 'noticias', peso: 1 }] });
});
test('Orden: crédito permitido, precio requerido e intención coherente', async () => {
  await valid('Orden', examples.Orden);
  await invalid('Orden', { ...examples.Orden, precioLimite: undefined });
  await invalid('Orden', { ...examples.Orden, tipo: 'market' });
  await invalid('Orden', { ...examples.Orden, componentes: [] });
  await invalid('Orden', { ...examples.Orden, componentes: Array(5).fill(examples.Orden.componentes[0]) });
  await invalid('Orden', { ...examples.Orden, componentes: [{ ...examples.Orden.componentes[0], accion: 'buy' }] });
});
test('Sesiones: expiración y ocultamiento de referencias privadas', async () => {
  await invalid('Sesion', { ...examples.Sesion, expiraEn: '2000-01-01' });
  const session = await valid('Sesion', examples.Sesion);
  const connection = await valid('ConexionBroker', examples.ConexionBroker);
  assert.ok(!JSON.stringify(session).includes('hash-no-token-real'));
  assert.ok(!JSON.stringify(connection).includes('vault/ref'));
  assert.equal(session.toObject().tokenHash, undefined);
});
test('Fechas y cantidades de reportes', async () => {
  await invalid('Fundamental', { ...examples.Fundamental, periodoInicio: '2027-01-01' });
  await invalid('ReporteInstitucional', { ...examples.ReporteInstitucional, fechaPublicacion: '2020-01-01' });
  await invalid('Sincronizacion', { ...examples.Sincronizacion, desde: '2027-01-01', hasta: '2026-01-01' });
});
test('Índices declarados sin construirlos en base de datos', () => {
  assert.ok(models.Empresa.schema.indexes().some(([keys, options]) => keys.simbolo && options.unique));
  assert.ok(models.Orden.schema.indexes().some(([keys, options]) => keys.idempotencyKey && options.unique));
  assert.ok(models.Sesion.schema.indexes().some(([keys, options]) => keys.expiraEn && options.expireAfterSeconds === 0));
});
