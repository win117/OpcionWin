// Prueba opt-in real: inserta datos de un usuario temporal UUID y los elimina.
const {exercise}=require('../tests/helpers/http-flow.cjs');
const {repository}=require('../dist/repositories');
const {closeMongo}=require('../dist/config/database.config');
(async()=>{
 try{
  const selected=process.argv.slice(2);
  const databases=selected.length?selected:['mongodb','supabase'];
  if(databases.some(d=>!['mongodb','supabase'].includes(d))) throw new Error('Base de prueba inválida.');
  for(const database of databases){
   const count=await exercise(repository,database);
   console.log(database+': OK, '+count+' solicitudes HTTP, datos temporales eliminados.');
  }
 } finally {await closeMongo();}
})().catch(error=>{
 console.error('Prueba real falló:',error.message);
 process.exitCode=1;
});
