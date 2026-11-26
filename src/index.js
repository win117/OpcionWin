import app from './app';
import config from './config/config';
import { closeMongo } from './config/database.config';
import { colaGlobal } from './jobs/cola';
import { crearApagado } from './modulos/salud';
if(!Number.isSafeInteger(config.PORT)||config.PORT<1||config.PORT>65535) throw new Error('PORT inválido.');
const server=app.listen(config.PORT,config.HOST,()=>{
  console.log('API disponible en http://'+config.HOST+':'+config.PORT+config.API_URL);
  app.locals.universo.iniciar(); // ranking y volatilidad del universo, en segundo plano
});
server.on('error',error=>{console.error('No se pudo iniciar el servidor:',error.code);process.exitCode=1;});
// Apagado ordenado con drenado de la cola (src/modulos/salud/apagado.js, openspec: salud-servicio).
const apagar=crearApagado({
  server, cola:colaGlobal, cerrarBase:closeMongo, avisar:m=>console.log(m),
  alApagar:[()=>app.locals.universo.detener(),()=>app.locals.cerrarConexiones()], // universo y seguimientos de órdenes abiertos
});
function shutdown(){ apagar().then(codigo=>{process.exitCode=codigo;}); }
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
