const assert=require('node:assert/strict');
const {once}=require('node:events');
const {randomUUID,scryptSync}=require('node:crypto');
const {createSessionService}=require('../../dist/api/v1/services/sesiones.service');
const {createApp}=require('../../dist/app');
const {resources}=require('../../dist/repositories/resources');
async function exercise(factory,database){
 const userId=randomUUID(), password='Test-'+randomUUID(), salt=randomUUID();
 const user={id:userId,email:'test-'+userId+'@example.com',salt,passwordHash:scryptSync(password,salt,64).toString('hex')};
 const auth=createSessionService(factory,async()=>[user]);
 const app=createApp({factory,auth,quiet:true});
 const server=app.listen(0,'127.0.0.1');
 await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port;
 const prefix=require('../../dist/config/config').default.API_URL;
 let token, requests=0;
 const call=async(method,path,body,status=200,extra={})=>{
   requests++;
   const response=await fetch(base+prefix+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
   const result=response.status===204?null:await response.json();
   assert.equal(response.status,status,method+' '+path+': '+JSON.stringify(result));
   return result?.data;
 };
 try{
  assert.equal((await fetch(base+'/health')).status,200);
  const spec=await (await fetch(base+prefix+'/openapi.json')).json();
  assert.ok(spec.paths['/configuraciones/{id}/componentes/{childId}']);
  await call('GET','/empresas',undefined,401);
  const login=await call('POST','/sesiones',{email:user.email,password,baseDatos:database});
  token=login.token;
  assert.equal((await call('GET','/sesiones/actual')).baseDatos,database);
  const company={simbolo:'TEST',nombre:'Empresa temporal',mercado:'TEST'};
  const e=await call('POST','/empresas',company,201);
  assert.equal((await call('GET','/empresas/'+e._id)).nombre,company.nombre);
  const otherContext={database:database==='mongodb'?'supabase':'mongodb',userId};
  // La prueba en memoria puede consultar la otra base sin conexión externa.
  if(factory.isMemory) assert.equal((await factory('empresas',otherContext).list()).length,0);
  const changed=await call('PUT','/empresas/'+e._id,{...company,nombre:'Modificada'},200,{'If-Match':'"1"'});
  assert.equal(changed._revision,2);
  await call('PUT','/empresas/'+e._id,company,409,{'If-Match':'"1"'});
  await call('PUT','/empresas/'+e._id,{nombre:'Faltan campos'},400);
  const b=await call('POST','/empresas/lote',{items:[{...company,simbolo:'OTRA'},{}]});
  assert.equal(b.exitosos,1);assert.equal(b.fallidos,1);
  const edited=await call('PUT','/empresas/lote',{items:[{id:b.results[0].data._id,datos:{...company,simbolo:'OTRA',nombre:'Lote'}}]});
  assert.equal(edited.exitosos,1);
  const removed=await call('POST','/empresas/eliminacion-lote',{ids:[b.results[0].data._id]});
  assert.equal(removed.exitosos,1);
  const strategy=await call('POST','/estrategias',{codigo:'LONG_CALL',nombre:'Call',descripcion:'Temporal'},201);
  const contract=await call('POST','/contratos',{proveedor:'test',contratoExternoId:'test',empresaId:e._id,simbolo:'TEST_CALL',tipo:'call',strike:100,vencimiento:'2030-01-01'},201);
  const config=await call('POST','/configuraciones',{nombre:'Prueba',empresaId:e._id,estrategiaId:strategy._id},201);
  const nested='/configuraciones/'+config._id+'/componentes';
  const value={contratoId:contract._id,accion:'buy',cantidad:1,proporcion:1};
  const child=await call('POST',nested,value,201);
  assert.ok(child._id);
  assert.equal((await call('GET',nested+'/'+child._id)).cantidad,1);
  await call('PUT',nested+'/'+child._id,{...value,cantidad:2});
  const children=await call('POST',nested+'/lote',{items:[value,value]});
  assert.equal(children.exitosos,2);
  const childUpdate=await call('PUT',nested+'/lote',{items:children.results.map(r=>({id:r.data._id,datos:{...value,cantidad:3}}))});
  assert.equal(childUpdate.exitosos,2);
  await call('POST',nested+'/eliminacion-lote',{ids:children.results.map(r=>r.data._id)});
  await call('DELETE',nested+'/'+child._id);
  assert.deepEqual(await call('GET',nested),[]);
  await call('DELETE','/configuraciones/'+config._id);
  await call('DELETE','/contratos/'+contract._id);
  await call('DELETE','/estrategias/'+strategy._id);
  await call('DELETE','/empresas/'+e._id);
  const profile=await call('POST','/perfiles-analisis',{nombre:'Temporal',coresSeleccionados:['tecnico']},201);
  const rules='/perfiles-analisis/'+profile._id+'/reglas';
  const rule=await call('POST',rules,{core:'tecnico',criterio:'tendencia',operador:'gte',valorReferencia:0,peso:1},201);
  await call('GET',rules+'/'+rule._id);
  await call('DELETE',rules+'/'+rule._id);
  const params=await call('PUT','/perfiles-analisis/'+profile._id+'/parametros',{diasVencimientoMin:10,diasVencimientoMax:30});
  assert.equal(params.diasVencimientoMin,10);
  await call('DELETE','/perfiles-analisis/'+profile._id);
  await call('DELETE','/sesiones/actual',undefined,204);
  await call('GET','/empresas',undefined,401);
  return requests;
 } finally {
   server.closeAllConnections();
   await new Promise(resolve=>server.close(resolve));
   // Solo registros del usuario temporal de esta ejecución.
   for(const name of Object.keys(resources)){
     const repo=factory(name,{database,userId});
     const rows=await repo.list({limit:500});
     for(const row of rows) await repo.remove(row._id,row.revision);
   }
 }
}
module.exports={exercise};
