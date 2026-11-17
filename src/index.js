import app from './app';
import config from './config/config';
import { closeMongo } from './config/database.config';
if(!Number.isSafeInteger(config.PORT)||config.PORT<1||config.PORT>65535) throw new Error('PORT inválido.');
const server=app.listen(config.PORT,config.HOST,()=>{
  console.log('API disponible en http://'+config.HOST+':'+config.PORT+config.API_URL);
});
server.on('error',error=>{console.error('No se pudo iniciar el servidor:',error.code);process.exitCode=1;});
let closing=false;
async function shutdown(){
  if(closing) return;
  closing=true;
  const timeout=setTimeout(()=>process.exit(1),10000);timeout.unref();
  server.close(async()=>{
    try{await closeMongo();clearTimeout(timeout);process.exitCode=0;}
    catch{process.exitCode=1;}
  });
}
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
