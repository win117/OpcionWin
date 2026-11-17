const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,scryptSync}=require('node:crypto');
const {memoryFactory}=require('./helpers/memory.cjs');
const {createCrudService,createChildService,batch}=require('../dist/api/v1/services/crud.service');
const {createNestedService}=require('../dist/api/v1/services/nested.service');
const {createSessionService}=require('../dist/api/v1/services/sesiones.service');
const ctx={database:'mongodb',userId:randomUUID()};
const empresa={simbolo:'TEST',nombre:'Empresa',mercado:'TEST'};
test('CRUD: aislamiento por usuario y base, reemplazo PUT y conflictos',async()=>{
 const factory=memoryFactory(), service=createCrudService('empresas',factory);
 const row=await service.create(ctx,empresa);
 assert.equal((await service.list(ctx)).total,1);
 for(const other of [{...ctx,database:'supabase'},{...ctx,userId:randomUUID()}]) await assert.rejects(service.get(other,row._id),e=>e.output.statusCode===404);
 await assert.rejects(service.update(ctx,row._id,{nombre:'Cambio'}),e=>e.output.statusCode===400);
 const updated=await service.update(ctx,row._id,{...empresa,nombre:'Cambio'},1);
 assert.equal(updated._revision,2);
 await assert.rejects(service.update(ctx,row._id,empresa,1),e=>e.output.statusCode===409);
 await service.remove(ctx,row._id);
 assert.equal((await service.list(ctx)).total,0);
});
test('No permite falsificar dueño ni claves Mongo',async()=>{
 const service=createCrudService('empresas',memoryFactory());
 for(const bad of [{...empresa,usuarioId:'otro'},{...empresa,$set:{}},{...empresa,'a.b':2}]) await assert.rejects(service.create(ctx,bad),e=>e.output.statusCode===400);
});
test('Lotes reportan éxito parcial y límite',async()=>{
 const service=createCrudService('empresas',memoryFactory());
 const result=await batch([empresa,empresa,{}],item=>service.create(ctx,item));
 assert.equal(result.exitosos,1);assert.equal(result.fallidos,2);
 await assert.rejects(batch([],()=>{}));
 await assert.rejects(batch(Array(101).fill(empresa),()=>{}));
});
test('Referencias en arreglos: confluencia valida evaluaciones y bloquea borrado',async()=>{
 const f=memoryFactory();
 const e=await createCrudService('empresas',f).create(ctx,empresa);
 const s=await createCrudService('estrategias',f).create(ctx,{codigo:'LONG_CALL',nombre:'Call',descripcion:'Prueba'});
 const evaluations=createCrudService('evaluaciones',f);
 const ev=await evaluations.create(ctx,{core:'tecnico',empresaId:e._id,versionAlgoritmo:'1'});
 const service=createCrudService('confluencias',f);
 const body={empresaId:e._id,estrategiaId:s._id,coresSeleccionados:['tecnico'],versionAlgoritmo:'1'};
 await assert.rejects(service.create(ctx,{...body,evaluacionesIds:['inexistente']}),e=>e.output.statusCode===400);
 const result=await service.create(ctx,{...body,evaluacionesIds:[ev._id]});
 await assert.rejects(evaluations.remove(ctx,ev._id),e=>e.output.statusCode===409);
 await service.remove(ctx,result._id);
 await evaluations.remove(ctx,ev._id);
});
test('Referencias y subdocumentos: CRUD completo, borrador e IDs estables',async()=>{
 const f=memoryFactory();
 const e=await createCrudService('empresas',f).create(ctx,empresa);
 const s=await createCrudService('estrategias',f).create(ctx,{codigo:'LONG_CALL',nombre:'Call',descripcion:'Ejemplo'});
 const contracts=createCrudService('contratos',f);
 const contract=await contracts.create(ctx,{proveedor:'test',contratoExternoId:'x',empresaId:e._id,simbolo:'TEST_CALL',tipo:'call',strike:100,vencimiento:'2030-01-01'});
 const configs=createCrudService('configuraciones',f);
 await assert.rejects(configs.create(ctx,{nombre:'Mal',empresaId:'inexistente',estrategiaId:s._id}));
 const config=await configs.create(ctx,{nombre:'Prueba',empresaId:e._id,estrategiaId:s._id});
 const children=createChildService('configuraciones','componentes',f);
 const part=await children.create(ctx,config._id,{contratoId:contract._id,accion:'buy',cantidad:1,proporcion:1});
 assert.ok(part._id);
 assert.equal((await children.get(ctx,config._id,part._id)).cantidad,1);
 await children.update(ctx,config._id,part._id,{contratoId:contract._id,accion:'buy',cantidad:2,proporcion:1});
 assert.equal((await children.list(ctx,config._id))[0].cantidad,2);
 await assert.rejects(createCrudService('empresas',f).remove(ctx,e._id),e=>e.output.statusCode===409);
 await children.remove(ctx,config._id,part._id);
 assert.equal((await children.list(ctx,config._id)).length,0);
 await configs.update(ctx,config._id,{nombre:'Validada',empresaId:e._id,estrategiaId:s._id,estado:'validada'});
 await assert.rejects(children.create(ctx,config._id,{contratoId:contract._id,accion:'buy',cantidad:1,proporcion:1}),e=>e.output.statusCode===409);
});
test('Subdocumentos simples: validar padre al cambiar parámetros',async()=>{
 const f=memoryFactory(), profiles=createCrudService('perfiles-analisis',f);
 const profile=await profiles.create(ctx,{nombre:'Perfil',coresSeleccionados:['tecnico']});
 const nested=createNestedService('perfiles-analisis','parametros',f);
 await assert.rejects(nested.update(ctx,profile._id,{diasVencimientoMin:90,diasVencimientoMax:30}));
 const value=await nested.update(ctx,profile._id,{diasVencimientoMin:10,diasVencimientoMax:20});
 assert.equal(value.diasVencimientoMin,10);
});
test('Sesión selecciona base, rechaza credenciales/token alterado y revoca',async()=>{
 const factory=memoryFactory();
 const salt='salt-for-test', password='valid-test-password';
 const user={id:randomUUID(),email:'test@example.com',salt,passwordHash:scryptSync(password,salt,64).toString('hex')};
 const auth=createSessionService(factory,async()=>[user]);
 await assert.rejects(auth.login({email:user.email,password:'bad',baseDatos:'mongodb'}),e=>e.output.statusCode===401);
 for(const database of ['mongodb','supabase']){
   const login=await auth.login({email:user.email,password,baseDatos:database});
   const context=await auth.authenticate(login.token);
   assert.equal(context.database,database);
   await assert.rejects(auth.authenticate(login.token.replace(database,database==='mongodb'?'supabase':'mongodb')));
   await auth.logout(context);
   await assert.rejects(auth.authenticate(login.token),e=>e.output.statusCode===401);
 }
});
