import { resources } from '../repositories/resources';
import config from './config';
const ok={description:'Respuesta JSON',content:{'application/json':{schema:{type:'object',properties:{success:{type:'boolean'},message:{type:'string'},data:{}}}}}};
const body={required:true,content:{'application/json':{schema:{type:'object'}}}};
const id=name=>({name,in:'path',required:true,schema:{type:'string'}});
const operation=(summary,params=[],hasBody=false)=>({summary,security:[{bearerAuth:[]}],parameters:params,...(hasBody?{requestBody:body}:{}),responses:{200:ok,201:ok,400:{description:'Datos inválidos'},401:{description:'Sesión inválida'},404:{description:'No encontrado'},409:{description:'Conflicto'}}});
export function openapi() {
  const paths={
    '/sesiones':{post:{...operation('Iniciar sesión seleccionando la base',[],true),security:[],requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['email','password','baseDatos'],properties:{email:{type:'string'},password:{type:'string',format:'password'},baseDatos:{type:'string',enum:['mongodb','supabase']}}}}}}}},
    '/sesiones/actual':{get:operation('Consultar sesión'),delete:{...operation('Cerrar sesión'),responses:{204:{description:'Sesión revocada'},401:{description:'Sesión inválida'}}}},
  };
  const crud=(base,params=[],child=false)=>{
    paths[base]={get:operation('Consultar registros locales',params),post:operation('Crear registro local (no ejecuta brokers ni cores)',params,true)};
    paths[base+'/lote']={post:operation('Crear varios registros: {items:[]}',params,true),put:operation('Reemplazar varios: {items:[{id,datos}]}',params,true)};
    paths[base+'/eliminacion-lote']={post:operation('Eliminar varios: {ids:[]}',params,true)};
    const key=child?'childId':'id', item=base+'/{'+key+'}', p=[...params,id(key)];
    paths[item]={get:operation('Consultar registro',p),put:operation('Reemplazar campos editables',p,true),delete:operation('Eliminar registro local',p)};
  };
  for(const [name,{Model}] of Object.entries(resources)){
    if(name==='sesiones') continue;
    crud('/'+name);
    for(const [field,type] of Object.entries(Model.schema.paths)){
      if(!type.schema) continue;
      const base='/'+name+'/{id}/'+field, params=[id('id')];
      if(type.$isMongooseDocumentArray) crud(base,params,true);
      else paths[base]={get:operation('Consultar subdocumento',params),post:operation('Crear subdocumento',params,true),put:operation('Reemplazar subdocumento',params,true),delete:operation('Eliminar si el modelo lo permite',params)};
    }
  }
  for(const route of ['/mercado/empresas','/mercado/opciones','/mercado/noticias']) paths[route]={get:operation('Consultar datos almacenados')};
  for(const category of ['cotizaciones','historicos','fundamentales','institucional']) paths['/mercado/'+category+'/{simbolo}']={get:operation('Consultar datos almacenados por empresa',[id('simbolo')])};
  paths['/mercado/opciones/{id}']={get:operation('Consultar contrato almacenado',[id('id')])};
  paths['/mercado/opciones/{contratoId}/snapshot']={get:operation('Consultar snapshot almacenado',[id('contratoId')])};
  paths['/cores/{core}/evaluaciones']={get:operation('Consultar evaluaciones guardadas',[id('core')])};
  paths['/cores/{core}/evaluaciones/{id}']={get:operation('Consultar evaluación guardada',[id('core'),id('id')])};
  // Acciones de la versión funcional (docs/version-funcional/contratos.md §5).
  const job=(summary,params=[])=>({...operation(summary,params,true),responses:{202:{description:'Trabajo aceptado: consultar el registro hasta completada|fallida'},400:{description:'Datos inválidos'},401:{description:'Sesión inválida'}}});
  paths['/cores/{core}/evaluaciones'].post=job('Ejecutar el core sobre datos sincronizados: {empresaId, perfilId?, parametros?}',[id('core')]);
  paths['/integraciones/estado']={get:operation('Estado de configuración de proveedores (sin revelar claves)')};
  paths['/sincronizaciones/ejecuciones']={post:job('Sincronizar desde proveedor: {recurso, simbolos[], desde?, hasta?, conexionId?}')};
  paths['/selecciones/ejecuciones']={post:job('Ejecutar selección (empresa | estrategia | empresa_estrategia)')};
  paths['/confluencias/ejecuciones']={post:job('Combinar evaluaciones completadas para una estrategia')};
  paths['/configuraciones/{id}/evaluaciones']={post:job('Validar estructura y calcular payoff de la configuración',[id('id')])};
  paths['/estrategias/catalogo-base']={post:operation('Crear el catálogo LONG_CALL, LONG_PUT, IRON_CONDOR si falta')};
  paths['/mercado/cotizaciones/{simbolo}/en-vivo']={get:operation('Cotización directa del proveedor (no se guarda)',[id('simbolo')])};
  paths['/cores/catalogo']={get:operation('Catálogo de cores: {items:[{core,version,requiere[],senales:[{nombre,etiqueta,descripcion,pesoBase}]}]}; las señales se eligen con parametros.indicadores')};
  paths['/activos/busqueda']={get:operation('Busca activos negociables de Alpaca (?q=1-20 caracteres&limit=1-50, def. 20): {items:[{simbolo,nombre,mercado,opciones,registrada,empresaId?}],total}; lista en caché 12 h',[{name:'q',in:'query',required:true,schema:{type:'string',minLength:1,maxLength:20}},{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:50}}])};
  paths['/mercado/opciones/resumen/{simbolo}']={get:operation('Contratos guardados con snapshot almacenado (IV y griegas) de un vencimiento (?vencimiento=AAAA-MM-DD, def. el más cercano); no llama al proveedor',[id('simbolo'),{name:'vencimiento',in:'query',schema:{type:'string',format:'date'}}])};
  paths['/selecciones/ejecuciones'].post=job('Ejecutar selección (empresa | estrategia | empresa_estrategia); admite ponderaciones:[{core,peso>=0}] y filtros.indicadores (señales por core)');
  paths['/mercado/opciones/cadena/{simbolo}']={get:operation('Cadena de opciones con IV y griegas del proveedor (?vencimiento&tipo)',[id('simbolo')])};
  const key={name:'Idempotency-Key',in:'header',required:true,schema:{type:'string'}};
  paths['/ordenes/{id}/envio']={post:{...operation('Enviar orden a Alpaca PAPER (idempotente)',[id('id'),key]),responses:{200:ok,400:{description:'Falta Idempotency-Key'},403:{description:'Entorno no paper'},409:{description:'Key distinta o estado inválido'}}}};
  paths['/ordenes/{id}/cancelacion']={post:operation('Cancelar orden (local o en Alpaca paper)',[id('id')])};
  paths['/conexiones-broker/{id}/verificacion']={post:operation('Verificar cuenta paper y activar conexión',[id('id')])};
  paths['/broker/paper/conexion']={post:{...operation('Asegura (idempotente) broker alpaca + conexión paper env:ALPACA y la verifica: {conexion:{_id,alias,estado}, cuenta:{estado,efectivo,poderCompra,patrimonio,nivelOpciones,...}}'),responses:{200:ok,503:{description:'Sin credenciales Alpaca en el servidor'}}}};
  paths['/broker/paper/resumen']={get:operation('Resumen paper en vivo: {conexionId, cuenta|null, error?, posiciones:[{posicionId|null,contratoId|null,simbolo,subyacente,tipo,strike,vencimiento,lado,cantidad,precioPromedio,precioActual,valorMercado,pl,plPct(%)}], ordenes:[últimas 15]}')};
  paths['/ordenes/ticket']={post:{...operation('Ticket en un paso (paper): crea Configuracion + Orden y la envía. Body {empresaId, estrategiaCodigo?, nombre?, tipo, precioLimite? (positivo), credito? (crédito neto multi-pata; Alpaca recibe limit_price negativo), vigencia?, cantidad 1-100, componentes[1-4]:[{contratoId, accion, intencion?, proporcion?}]}. Respuesta {orden, configuracion}',[key],true),responses:{201:{description:'Creada y enviada'},200:{description:'Idempotency-Key ya usada: devuelve la orden existente'},400:{description:'Datos inválidos'},503:{description:'Sin credenciales Alpaca'}}}};
  paths['/posiciones/{id}/cierre']={post:{...operation('Cierra una posición abierta paper con orden de cierre: body {tipo, precioLimite?}. long→sell_to_close, short→buy_to_close. Respuesta {orden}',[id('id'),key],true),responses:{201:{description:'Orden de cierre enviada'},200:{description:'Idempotency-Key ya usada'},409:{description:'Posición no abierta'}}}};
  return {openapi:'3.0.3',info:{title:'Plataforma de análisis de opciones',version:'2.0.0',description:'CRUD dual MongoDB/PostgreSQL + sincronización con Alpaca/SEC, cinco cores, confluencia, selección y órdenes en Alpaca paper.'},servers:[{url:config.API_URL}],components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',description:'Token opaco devuelto por POST /sesiones'}}},paths};
}
