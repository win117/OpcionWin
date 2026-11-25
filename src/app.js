import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import boom from '@hapi/boom';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import swaggerUi from 'swagger-ui-express';
import config from './config/config';
import routeAPI from './api/v1/routes';
import { openapi } from './config/openapi';
import { colaGlobal } from './jobs/cola';
import { limiteOperaciones } from './middlewares/limites.handler';
import { cabecerasSeguridad } from './middlewares/cabeceras.handler';
import { comprimir, assetsComprimidos } from './middlewares/gzip.handler';
import { registrarError } from './middlewares/errores.handler';
export function createApp(options = {}) {
  if (!Number.isSafeInteger(config.SESSION_TTL_SECONDS) || config.SESSION_TTL_SECONDS < 60 || config.SESSION_TTL_SECONDS > 86400) throw new Error('SESSION_TTL_SECONDS debe estar entre 60 y 86400.');
  const saltos=options.trustProxy ?? config.TRUST_PROXY;
  if (!Number.isSafeInteger(saltos) || saltos < 0 || saltos > 10) throw new Error('TRUST_PROXY debe ser el número de proxies de confianza (0 a 10).');
  const app=express();
  app.disable('x-powered-by');
  app.set('trust proxy',saltos); // req.ip y req.secure: solo se creen los últimos `saltos` de X-Forwarded-*
  app.locals.limiteOperaciones=limiteOperaciones({cola:options.cola ?? colaGlobal}); // lo aplica authenticate
  app.set('port',config.PORT);
  app.use(cors({origin:config.CORS_ORIGINS.length ? config.CORS_ORIGINS : false, exposedHeaders:['ETag','X-Request-Id']}));
  app.use((req,res,next)=>{ req.requestId=randomUUID();res.set('X-Request-Id',req.requestId);next(); });
  app.use(cabecerasSeguridad);
  if (!options.quiet) app.use(morgan('dev'));
  app.use(comprimir);
  app.use(express.json({limit:'1mb'}));
  app.use(express.urlencoded({extended:false,limit:'1mb'}));
  app.get('/health',(_req,res)=>res.json({status:'ok'}));
  app.get(config.API_URL,(_req,res)=>res.json({success:true,message:'RESTful API de opciones',docs:config.API_URL+'/api-docs'}));
  app.get(config.API_URL+'/openapi.json',(_req,res)=>res.json(openapi()));
  app.use(config.API_URL+'/api-docs',swaggerUi.serve,swaggerUi.setup(openapi(),{swaggerOptions:{docExpansion:'none'}}));
  routeAPI(app,options);
  // Frontend compilado (ADR-007): web/dist en la raíz del proyecto, con respaldo SPA.
  const web = options.webDir ?? path.resolve(__dirname, '..', 'web', 'dist');
  if (web && existsSync(path.join(web, 'index.html'))) {
    // /assets: nombres con hash, caché de un año. index.html: siempre se revalida para tomar el despliegue nuevo.
    const assets = path.join(web, 'assets');
    app.use('/assets', assetsComprimidos(assets), express.static(assets, { index: false, maxAge: '1y', immutable: true }));
    app.use(express.static(web, { index: false, maxAge: '1h', setHeaders: (res, archivo) => { if (archivo.endsWith('.html')) res.set('Cache-Control', 'no-cache'); } }));
    app.get(/^\/(?!api\/|health$|assets\/).*/, (_req, res) => res.sendFile('index.html', { root: web, cacheControl: false, headers: { 'Cache-Control': 'no-cache' } }));
  }
  app.use((_req,_res,next)=>next(boom.notFound('Ruta no encontrada.')));
  app.use((error,req,res,next)=>{
    if(res.headersSent) return next(error);
    let handled=error;
    if(error.type==='entity.parse.failed') handled=boom.badRequest('El cuerpo debe contener JSON válido.');
    else if(error.type==='entity.too.large') handled=boom.entityTooLarge('El cuerpo supera 1 MB.');
    else if(['ValidationError','StrictModeError','CastError'].includes(error.name)) handled=boom.badRequest(error.message);
    else if(error.code===11000 || error.code==='23505') handled=boom.conflict('Registro duplicado.');
    else if(error.name==='IntegrationError') {
      const status={SIN_CREDENCIALES:503,LIMITE:429,NO_ENCONTRADO:404,NO_IMPLEMENTADO:501,VALIDACION:400,NO_PERMITIDO:403,PROVEEDOR:502,RED:502}[error.codigo]||502;
      handled=new boom.Boom('['+(error.proveedor||'proveedor')+'] '+(error.mensaje||'Error del proveedor externo.'),{statusCode:status});
    }
    else if(error.name==='URIError') handled=boom.badRequest('La URL está mal codificada.');
    // Errores 4xx de Express (body-parser, send): se conserva el código, sin su mensaje interno.
    else if(!boom.isBoom(error) && error.expose && error.statusCode>=400 && error.statusCode<500) handled=new boom.Boom(undefined,{statusCode:error.statusCode});
    if(!boom.isBoom(handled)){
      registrarError(error,{requestId:req.requestId,metodo:req.method,ruta:req.originalUrl.split('?')[0]});
      handled=boom.internal();
    }
    const {output}=handled;
    res.set(output.headers).status(output.statusCode).json({success:false,message:output.payload.message,error:output.payload.error,requestId:req.requestId});
  });
  return app;
}
export default createApp();
