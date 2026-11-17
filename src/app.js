import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import boom from '@hapi/boom';
import { randomUUID } from 'node:crypto';
import swaggerUi from 'swagger-ui-express';
import config from './config/config';
import routeAPI from './api/v1/routes';
import { openapi } from './config/openapi';
export function createApp(options = {}) {
  if (!Number.isSafeInteger(config.SESSION_TTL_SECONDS) || config.SESSION_TTL_SECONDS < 60 || config.SESSION_TTL_SECONDS > 86400) throw new Error('SESSION_TTL_SECONDS debe estar entre 60 y 86400.');
  const app=express();
  app.disable('x-powered-by');
  app.set('port',config.PORT);
  app.use(cors({origin:config.CORS_ORIGINS.length ? config.CORS_ORIGINS : false, exposedHeaders:['ETag','X-Request-Id']}));
  app.use((req,res,next)=>{ req.requestId=randomUUID();res.set('X-Request-Id',req.requestId);next(); });
  if (!options.quiet) app.use(morgan('dev'));
  app.use(express.json({limit:'1mb'}));
  app.use(express.urlencoded({extended:false,limit:'1mb'}));
  app.get('/health',(_req,res)=>res.json({status:'ok'}));
  app.get(config.API_URL,(_req,res)=>res.json({success:true,message:'RESTful API de opciones',docs:config.API_URL+'/api-docs'}));
  app.get(config.API_URL+'/openapi.json',(_req,res)=>res.json(openapi()));
  app.use(config.API_URL+'/api-docs',swaggerUi.serve,swaggerUi.setup(openapi()));
  routeAPI(app,options);
  app.use((_req,_res,next)=>next(boom.notFound('Ruta no encontrada.')));
  app.use((error,req,res,next)=>{
    if(res.headersSent) return next(error);
    let handled=error;
    if(error.type==='entity.parse.failed') handled=boom.badRequest('El cuerpo debe contener JSON válido.');
    else if(error.type==='entity.too.large') handled=boom.entityTooLarge('El cuerpo supera 1 MB.');
    else if(['ValidationError','StrictModeError','CastError'].includes(error.name)) handled=boom.badRequest(error.message);
    else if(error.code===11000 || error.code==='23505') handled=boom.conflict('Registro duplicado.');
    if(!boom.isBoom(handled)) handled=boom.internal();
    const {output}=handled;
    res.set(output.headers).status(output.statusCode).json({success:false,message:output.payload.message,error:output.payload.error,requestId:req.requestId});
  });
  return app;
}
export default createApp();
