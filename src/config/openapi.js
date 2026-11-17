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
  return {openapi:'3.0.3',info:{title:'Proyecto de opciones - CRUD',version:'1.0.0',description:'CRUD dual MongoDB/PostgreSQL. Los registros de órdenes, análisis y sincronización son locales; no realizan operaciones externas.'},servers:[{url:config.API_URL}],components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',description:'Token opaco devuelto por POST /sesiones'}}},paths};
}
