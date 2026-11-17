// Trabajos huérfanos (ADR-003), días a vencimiento, auditoría y sesiones.
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,scryptSync}=require('node:crypto');
const {memoryFactory}=require('./helpers/memory.cjs');
const {crear}=require('../dist/api/v1/services/registros');
const {createCrudService}=require('../dist/api/v1/services/crud.service');
const {TIEMPO_MAX_TRABAJO_MS,ERROR_TRABAJO_INTERRUMPIDO}=require('../dist/api/v1/services/trabajos-huerfanos.service');
const {registrarEvento,auditado,enmascararEmail}=require('../dist/api/v1/services/auditoria.service');
const {createSessionService}=require('../dist/api/v1/services/sesiones.service');
const {createAnalisis}=require('../dist/api/v1/services/analisis.service');
const ctx={database:'mongodb',userId:randomUUID()};
const MIN=60000;

test('Trabajos huérfanos: se marcan fallidos al leer si superan 15 min y no están activos',async()=>{
  assert.equal(TIEMPO_MAX_TRABAJO_MS,15*MIN);
  const f=memoryFactory(), t0=Date.now();
  let ahora=new Date(t0); const activos=new Set();
  const service=createCrudService('sincronizaciones',f,{cola:{activo:id=>activos.has(id)},ahora:()=>ahora});
  const nuevo=estado=>crear('sincronizaciones',ctx,{recurso:'historicos',proveedor:'alpaca',simbolos:['TEST'],estado},f);
  const proc=await nuevo('procesando'), pend=await nuevo('pendiente'), activo=await nuevo('procesando'), listo=await nuevo('completada');
  activos.add(activo._id);
  ahora=new Date(t0+14*MIN);
  assert.equal((await service.get(ctx,proc._id)).estado,'procesando');
  ahora=new Date(t0+16*MIN);
  const leido=await service.get(ctx,proc._id);
  assert.equal(leido.estado,'fallida'); assert.equal(leido.error,ERROR_TRABAJO_INTERRUMPIDO); assert.ok(leido.finalizadaEn);
  const lista=(await service.list(ctx)).items, por=id=>lista.find(r=>r._id===id);
  assert.equal(por(pend._id).estado,'fallida');
  assert.equal(por(activo._id).estado,'procesando','activo en la cola del proceso');
  assert.equal(por(listo._id).estado,'completada');
  assert.equal((await f('sincronizaciones',ctx).get(proc._id)).document.estado,'fallida');
});

test('Trabajos huérfanos: modelos sin finalizadaEn y fallos de escritura no rompen la lectura',async()=>{
  const f=memoryFactory(), ahora=()=>new Date(Date.now()+20*MIN);
  const service=createCrudService('selecciones',f,{cola:{activo:()=>false},ahora});
  const e=await crear('empresas',ctx,{simbolo:'TEST',nombre:'E',mercado:'T'},f);
  const datos={modo:'empresa',empresaId:e._id,coresSeleccionados:['tecnico']};
  const sel=await crear('selecciones',ctx,{...datos,estado:'procesando'},f);
  assert.equal((await service.get(ctx,sel._id)).estado,'fallida');
  const s2=await crear('selecciones',ctx,{...datos,estado:'pendiente'},f);
  const roto=(n,c)=>({...f(n,c),replace:async()=>{throw new Error('db caída');}});
  const malo=createCrudService('selecciones',roto,{cola:{activo:()=>false},ahora});
  assert.equal((await malo.get(ctx,s2._id)).estado,'pendiente');
});

test('Auditoría: registrarEvento respeta el esquema y nunca lanza; auditado conserva resultado y error',async()=>{
  const f=memoryFactory();
  const ev=await registrarEvento({...ctx,requestId:'req-1'},{accion:'orden.ticket',recurso:'ordenes',recursoId:'abc',detalle:'ok'},f);
  assert.equal(ev.usuarioId,ctx.userId); assert.equal(ev.resultado,'exito'); assert.equal(ev.requestId,'req-1');
  assert.equal(await registrarEvento(ctx,{accion:'x',recurso:'y',resultado:'invalido'},f),null);
  assert.equal(await registrarEvento(null,{accion:'x',recurso:'y'},f),null);
  const roto=()=>({create:async()=>{throw new Error('caída');}});
  assert.equal(await registrarEvento(ctx,{accion:'x',recurso:'y'},roto),null);
  const r=await auditado(ctx,{accion:'a',recurso:'r',recursoId:x=>x.id},async()=>({id:'7'}),f);
  assert.equal(r.id,'7');
  await assert.rejects(auditado(ctx,{accion:'b',recurso:'r'},async()=>{throw new Error('boom');},f),/boom/);
  const items=(await createCrudService('auditoria',f).list(ctx)).items;
  assert.ok(items.some(i=>i.accion==='a'&&i.recursoId==='7'));
  assert.ok(items.some(i=>i.accion==='b'&&i.resultado==='error'));
  assert.equal(enmascararEmail('alice@dominio.com'),'a***@d***.com');
});

test('Auditoría de sesiones: login, fallo enmascarado (sin contraseña), logout y purga de expiradas',async()=>{
  const f=memoryFactory(), salt='s', password='valid-test-password';
  const user={id:randomUUID(),email:'alice@dominio.com',salt,passwordHash:scryptSync(password,salt,64).toString('hex')};
  const auth=createSessionService(f,async()=>[user]);
  const c={userId:user.id,database:'mongodb'};
  const viejo=randomUUID();
  await f('sesiones',c).create({_id:viejo,usuarioId:user.id,baseDatos:'mongodb',tokenHash:'h',expiraEn:new Date(Date.now()-1000),createdAt:new Date(),updatedAt:new Date()});
  await assert.rejects(auth.login({email:user.email,password:'mala-clave',baseDatos:'mongodb'}),e=>e.output.statusCode===401);
  const login=await auth.login({email:user.email,password,baseDatos:'mongodb'});
  assert.equal(await f('sesiones',c).get(viejo),undefined,'expirada purgada');
  await auth.logout(await auth.authenticate(login.token));
  const items=(await createCrudService('auditoria',f).list(c)).items;
  const fallo=items.find(i=>i.accion==='login'&&i.resultado==='error');
  assert.ok(fallo.descripcion.includes('a***@d***.com'));
  assert.ok(!JSON.stringify(items).includes('mala-clave')); assert.ok(!JSON.stringify(items).includes(user.email));
  assert.ok(items.some(i=>i.accion==='login'&&i.resultado==='exito'));
  assert.ok(items.some(i=>i.accion==='logout'));
  await assert.rejects(auth.login({email:'x@y.com',password:'z',baseDatos:'mongodb'}));
  assert.equal((await createCrudService('auditoria',f).list({userId:'anonimo',database:'mongodb'})).total,1);
});

test('Días a vencimiento mín/máx filtran los contratos del core indicadores (IV promedio)',async()=>{
  const f=memoryFactory(), DIA=86400000;
  const empresa=await crear('empresas',ctx,{simbolo:'TEST',nombre:'E',mercado:'T'},f);
  const base=Date.UTC(2025,0,2);
  for(let i=0;i<60;i++){const c=100+Math.sin(i/3);await crear('datos-mercado',ctx,{empresaId:empresa._id,tipo:'vela',intervalo:'1Day',apertura:c,maximo:c+1,minimo:c-1,cierre:c,volumen:1e6,fuente:{proveedor:'alpaca',fechaDato:new Date(base+i*DIA)}},f);}
  const opcion=async(dias,iv)=>{
    const c=await crear('contratos',ctx,{proveedor:'alpaca',contratoExternoId:'C'+dias,empresaId:empresa._id,simbolo:'T'+dias,tipo:'call',strike:100,vencimiento:new Date(Date.now()+dias*DIA)},f);
    await crear('datos-mercado',ctx,{empresaId:empresa._id,contratoId:c._id,tipo:'snapshot_opcion',bid:1,ask:1.2,volatilidadImplicita:iv,fuente:{proveedor:'alpaca',fechaDato:new Date()}},f);
  };
  await opcion(10,0.2); await opcion(30,0.4); await opcion(200,0.9);
  const correr=async parametros=>{
    const tareas=[], cola={encolar:(id,t)=>tareas.push(t()),activo:()=>false};
    const ev=await createAnalisis({cola,factory:f}).ejecutarCore(ctx,'indicadores',{empresaId:empresa._id,parametros});
    await Promise.all(tareas);
    return createCrudService('evaluaciones',f).get(ctx,ev._id);
  };
  const iv=e=>e.metricas.find(m=>m.nombre==='iv_promedio');
  const sin=await correr(undefined);
  assert.ok(Math.abs(iv(sin).valor-0.5)<1e-9,'sin parámetros: todos los contratos'); assert.equal(iv(sin).periodo,undefined);
  const corto=await correr({diasVencimientoMin:20,diasVencimientoMax:60});
  assert.ok(Math.abs(iv(corto).valor-0.4)<1e-9); assert.equal(iv(corto).periodo,'20-60d');
  const largo=await correr({diasVencimientoMin:0,diasVencimientoMax:15});
  assert.ok(Math.abs(iv(largo).valor-0.2)<1e-9);
});
