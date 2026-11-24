// Operación paper en un paso (ADR-011): conexión, resumen, ticket, cierre. Alpaca simulado, repositorio en memoria.
const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {randomUUID,scryptSync}=require('node:crypto');
const {memoryFactory}=require('./helpers/memory.cjs');
const {createSessionService}=require('../dist/api/v1/services/sesiones.service');
const {createApp}=require('../dist/app');
const {createCola}=require('../dist/jobs/cola');
const {construirCuerpoOrden}=require('../dist/integrations/alpaca.client');
const prefix=require('../dist/config/config').default.API_URL;

const DIA=86400000;
const venc=new Date(Date.now()+30*DIA).toISOString().slice(0,10);
const occ=(t,k)=>'TEST'+venc.slice(2).replace(/-/g,'')+t+String(k*1000).padStart(8,'0');

function fake(){
  const enviadas=[];
  const f={enviadas,vivas:[],sinCredenciales:false,
    estado:()=>({alpaca:{configurado:true}}),
    alpaca:{
      cuenta:async()=>{if(f.sinCredenciales){const e=new Error('x');e.name='IntegrationError';e.proveedor='alpaca';e.codigo='SIN_CREDENCIALES';e.mensaje='Faltan credenciales.';throw e;}return{cuentaExternaId:'PA1',estado:'ACTIVE',efectivo:1000,poderCompra:2000,patrimonio:1500,nivelOpciones:3};},
      enviarOrden:async o=>{enviadas.push(o);return{ordenExternaId:'ext-'+enviadas.length,estado:'aceptada',estadoProveedor:'accepted'};},
      consultarOrden:async()=>({estado:'cancelada'}),cancelarOrden:async()=>undefined,
      posiciones:async()=>f.vivas,
    },
  };
  f.alpaca.configurado=true;
  f.enviadasWebull=[]; f.vivasWebull=[];
  f.webull={configurado:true,
    cuenta:async()=>({cuentaExternaId:'WB1',estado:'ACTIVE',efectivo:500,poderCompra:900,patrimonio:700,nivelOpciones:null}),
    enviarOrden:async o=>{f.enviadasWebull.push(o);return{ordenExternaId:'wb-'+f.enviadasWebull.length,estado:'enviada',estadoProveedor:'SUBMITTED_REQUEST'};},
    consultarOrden:async()=>({estado:'cancelada',estadoProveedor:'CANCELLED'}),cancelarOrden:async()=>undefined,
    posiciones:async()=>f.vivasWebull,
  };
  return f;
}

async function entorno(){
  const factory=memoryFactory(), integraciones=fake();
  const userId=randomUUID(), password='Test-'+randomUUID(), salt=randomUUID();
  const user={id:userId,email:'t@example.com',salt,passwordHash:scryptSync(password,salt,64).toString('hex')};
  const app=createApp({factory,auth:createSessionService(factory,async()=>[user]),integraciones,cola:createCola(),quiet:true,webDir:null});
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port+prefix;
  let token;
  const call=async(method,path,body,status=200,headers={})=>{
    const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const j=await r.json(); assert.equal(r.status,status,method+' '+path+' → '+JSON.stringify(j)); return j.data;
  };
  token=(await call('POST','/sesiones',{email:user.email,password,baseDatos:'mongodb'})).token;
  const emp=await call('POST','/empresas',{simbolo:'TEST',nombre:'Test Corp',mercado:'NASDAQ'},201);
  const otra=await call('POST','/empresas',{simbolo:'OTRO',nombre:'Otra',mercado:'NASDAQ'},201);
  const contratos={};
  const mk=async(clave,tipo,strike,empresa=emp)=>{
    const s=occ(tipo==='call'?'C':'P',strike)+(empresa===emp?'':'X');
    contratos[clave]=await call('POST','/contratos',{proveedor:'alpaca',contratoExternoId:s,empresaId:empresa._id,simbolo:s,tipo,strike,vencimiento:venc,multiplicador:100},201);
  };
  await mk('c100','call',100); await mk('p90','put',90); await mk('p85','put',85); await mk('c110','call',110); await mk('c115','call',115); await mk('ajeno','call',100,otra);
  const k=()=>'key-'+randomUUID();
  return {call,integraciones,contratos,emp,k,cerrar:()=>server.close()};
}
const pata=(c,accion,extra={})=>({contratoId:c._id,accion,...extra});

test('ensure conexión: idempotente y sin duplicados; sin credenciales → 503',async()=>{
  const e=await entorno();
  try{
    const a=await e.call('POST','/broker/paper/conexion');
    assert.equal(a.conexion.alias,'Alpaca paper'); assert.equal(a.conexion.estado,'activa'); assert.equal(a.cuenta.efectivo,1000); assert.equal(a.cuenta.nivelOpciones,3);
    const b=await e.call('POST','/broker/paper/conexion');
    assert.equal(b.conexion._id,a.conexion._id);
    assert.equal((await e.call('GET','/conexiones-broker')).total,1);
    assert.equal((await e.call('GET','/brokers')).total,1);
    e.integraciones.sinCredenciales=true;
    await e.call('POST','/broker/paper/conexion',undefined,503);
  } finally{e.cerrar();}
});

test('ticket: crea configuración + orden, envía con client_order_id = key y es idempotente',async()=>{
  const e=await entorno();
  try{
    const key=e.k();
    const body={empresaId:e.emp._id,tipo:'limit',precioLimite:2.5,cantidad:2,componentes:[pata(e.contratos.c100,'buy')]};
    await e.call('POST','/ordenes/ticket',body,400); // sin Idempotency-Key
    const r=await e.call('POST','/ordenes/ticket',body,201,{'Idempotency-Key':key});
    assert.equal(r.orden.estado,'aceptada'); assert.equal(r.orden.idempotencyKey,key); assert.equal(r.orden.componentes[0].intencion,'buy_to_open');
    assert.equal(r.configuracion.estado,'validada'); assert.match(r.configuracion.nombre,/^LONG_CALL TEST \d{4}-\d\d-\d\d$/);
    assert.equal(e.integraciones.enviadas.length,1); assert.equal(e.integraciones.enviadas[0].clientOrderId,key);
    const r2=await e.call('POST','/ordenes/ticket',body,200,{'Idempotency-Key':key});
    assert.equal(r2.orden._id,r.orden._id); assert.equal(e.integraciones.enviadas.length,1);
    assert.equal((await e.call('GET','/ordenes')).total,1); assert.equal((await e.call('GET','/configuraciones')).total,1);
    // Estrategia automática: put comprado → LONG_PUT
    const r3=await e.call('POST','/ordenes/ticket',{...body,componentes:[pata(e.contratos.p90,'buy')]},201,{'Idempotency-Key':e.k()});
    const estr=await e.call('GET','/estrategias/'+r3.configuracion.estrategiaId);
    assert.equal(estr.codigo,'LONG_PUT');
  } finally{e.cerrar();}
});

test('ticket: validaciones',async()=>{
  const e=await entorno();
  try{
    const ok={empresaId:e.emp._id,tipo:'limit',precioLimite:1,cantidad:1,componentes:[pata(e.contratos.c100,'buy')]};
    const post=(b,s=400)=>e.call('POST','/ordenes/ticket',b,s,{'Idempotency-Key':e.k()});
    await post({...ok,componentes:[pata(e.contratos.ajeno,'buy')]});
    await post({...ok,componentes:['c100','p90','p85','c110','c115'].map(c=>pata(e.contratos[c],'buy'))});
    await post({...ok,precioLimite:undefined});
    await post({...ok,tipo:'market'});
    await post({...ok,cantidad:101});
    await post({...ok,credito:true}); // crédito en una pata
    await post({...ok,componentes:[pata(e.contratos.c100,'buy'),pata(e.contratos.c110,'sell')]}); // 2 patas sin estrategiaCodigo
    await post({...ok,componentes:[pata(e.contratos.c100,'buy',{intencion:'sell_to_open'})]});
    await e.call('POST','/ordenes/ticket',ok,400,{'Idempotency-Key':'corta'});
    assert.equal(e.integraciones.enviadas.length,0); assert.equal((await e.call('GET','/ordenes')).total,0);
  } finally{e.cerrar();}
});

test('ticket: iron condor de crédito → mleg de 4 patas y limit_price negativo en Alpaca',async()=>{
  const e=await entorno();
  try{
    const c=e.contratos;
    const r=await e.call('POST','/ordenes/ticket',{empresaId:e.emp._id,tipo:'limit',precioLimite:1.2,credito:true,cantidad:1,componentes:[pata(c.p85,'buy'),pata(c.p90,'sell'),pata(c.c110,'sell'),pata(c.c115,'buy')]},201,{'Idempotency-Key':e.k()});
    assert.equal(r.orden.precioLimite,1.2); assert.equal(r.orden.credito,true);
    assert.match(r.configuracion.nombre,/^IRON_CONDOR TEST/); assert.equal(r.configuracion.componentes.length,4);
    const cuerpo=construirCuerpoOrden(e.integraciones.enviadas[0]);
    assert.equal(cuerpo.order_class,'mleg'); assert.equal(cuerpo.legs.length,4); assert.equal(cuerpo.limit_price,'-1.2'); assert.equal(cuerpo.qty,'1');
    assert.deepEqual(cuerpo.legs.map(l=>l.position_intent),['buy_to_open','sell_to_open','sell_to_open','buy_to_open']);
  } finally{e.cerrar();}
});

test('construirCuerpoOrden: convención crédito/débito',()=>{
  const legs=[{simbolo:'A',accion:'buy'},{simbolo:'B',accion:'sell'}];
  const base={clientOrderId:'k1',tipo:'limit',cantidad:1,componentes:legs};
  assert.equal(construirCuerpoOrden({...base,precioLimite:0.5}).limit_price,'0.5');           // débito: positivo
  assert.equal(construirCuerpoOrden({...base,precioLimite:0.5,credito:true}).limit_price,'-0.5'); // crédito: negativo
  assert.equal(construirCuerpoOrden({...base,precioLimite:1.234,credito:true}).limit_price,'-1.23'); // 2 decimales si >= 1
  assert.equal(construirCuerpoOrden({...base,precioLimite:0.12345}).limit_price,'0.1235');
  const una={...base,componentes:[legs[0]],precioLimite:2};
  assert.equal(construirCuerpoOrden(una).limit_price,'2'); assert.equal(construirCuerpoOrden(una).order_class,undefined);
  assert.throws(()=>construirCuerpoOrden({...una,credito:true}),x=>x.codigo==='VALIDACION');
  assert.throws(()=>construirCuerpoOrden({clientOrderId:'k',tipo:'market',cantidad:1,credito:true,componentes:legs}),x=>x.codigo==='VALIDACION');
  assert.throws(()=>construirCuerpoOrden({...base,precioLimite:-1,credito:true}),x=>x.codigo==='VALIDACION');
  assert.throws(()=>construirCuerpoOrden({...base,precioLimite:0}),x=>x.codigo==='VALIDACION');
});

test('cierre: long → sell_to_close, short → buy_to_close; idempotente; solo abiertas',async()=>{
  const e=await entorno();
  try{
    const conexion=(await e.call('POST','/broker/paper/conexion')).conexion;
    const datosPos=(c,lado,cantidad,estado='abierta')=>({conexionId:conexion._id,posicionExternaId:'ext-'+c.simbolo,contratoId:c._id,lado,cantidad,precioPromedio:2,actualizadaEn:new Date().toISOString(),estado});
    const larga=await e.call('POST','/posiciones',datosPos(e.contratos.c100,'long',3),201), corta=await e.call('POST','/posiciones',datosPos(e.contratos.p90,'short',2),201);
    const key=e.k();
    const r=await e.call('POST','/posiciones/'+larga._id+'/cierre',{tipo:'limit',precioLimite:1.5},201,{'Idempotency-Key':key});
    assert.equal(r.orden.estado,'aceptada'); assert.equal(r.orden.cantidad,3);
    let env=e.integraciones.enviadas.at(-1);
    assert.equal(env.componentes[0].accion,'sell'); assert.equal(env.componentes[0].intencion,'sell_to_close'); assert.equal(env.clientOrderId,key);
    const rep=await e.call('POST','/posiciones/'+larga._id+'/cierre',{tipo:'limit',precioLimite:1.5},200,{'Idempotency-Key':key});
    assert.equal(rep.orden._id,r.orden._id); assert.equal(e.integraciones.enviadas.length,1);
    await e.call('POST','/posiciones/'+corta._id+'/cierre',{tipo:'limit',precioLimite:1.5},201,{'Idempotency-Key':e.k()});
    env=e.integraciones.enviadas.at(-1);
    assert.equal(env.componentes[0].intencion,'buy_to_close'); assert.equal(env.cantidad,2);
    assert.ok((await e.call('GET','/configuraciones')).items.some(c=>c.nombre.startsWith('Cierre TEST')));
    await e.call('POST','/posiciones/'+larga._id+'/cierre',{tipo:'limit'},400,{'Idempotency-Key':e.k()}); // limit sin precio
    await e.call('PUT','/posiciones/'+corta._id,datosPos(e.contratos.p90,'short',2,'cerrada'),200);
    await e.call('POST','/posiciones/'+corta._id+'/cierre',{tipo:'limit',precioLimite:1},409,{'Idempotency-Key':e.k()});
  } finally{e.cerrar();}
});

test('resumen: une posiciones vivas con contratos/posiciones guardados y lista órdenes',async()=>{
  const e=await entorno();
  try{
    const conexion=(await e.call('POST','/broker/paper/conexion')).conexion;
    e.integraciones.vivas=[
      {posicionExternaId:'a1',simbolo:e.contratos.c100.simbolo,lado:'long',cantidad:2,precioPromedio:2,precioActual:3,valorMercado:600,plNoRealizado:200,plPctNoRealizado:0.5},
      {posicionExternaId:'a2',simbolo:'ZZZZ261125P00050000',lado:'short',cantidad:1,precioPromedio:1,precioActual:0.5,valorMercado:-50},
    ];
    await e.call('POST','/ordenes/ticket',{empresaId:e.emp._id,tipo:'limit',precioLimite:1,cantidad:1,componentes:[pata(e.contratos.c100,'buy')]},201,{'Idempotency-Key':e.k()});
    const r=await e.call('GET','/broker/paper/resumen');
    assert.equal(r.conexionId,conexion._id); assert.equal(r.cuenta.poderCompra,2000);
    assert.equal(r.posiciones.length,2);
    const p=r.posiciones[0];
    assert.equal(p.contratoId,e.contratos.c100._id); assert.ok(p.posicionId); assert.equal(p.subyacente,'TEST'); assert.equal(p.tipo,'call'); assert.equal(p.strike,100);
    assert.equal(p.pl,200); assert.equal(p.plPct,50);
    const q=r.posiciones[1];
    assert.equal(q.contratoId,null); assert.equal(q.posicionId,null); assert.equal(q.subyacente,'ZZZZ'); assert.equal(q.tipo,'put'); assert.equal(q.strike,50);
    assert.equal(q.pl,50); assert.equal(q.plPct,50);
    assert.equal(r.ordenes.length,1); assert.equal(r.ordenes[0].estado,'aceptada'); assert.ok(r.ordenes[0].eventos.length<=3);
    e.integraciones.sinCredenciales=true;
    const sin=await e.call('GET','/broker/paper/resumen');
    assert.equal(sin.cuenta,null); assert.ok(sin.error);
  } finally{e.cerrar();}
});

test('broker webull: disponibles, conexión, ticket, resumen, cancelación y cierre usan el adaptador de Webull',async()=>{
  const e=await entorno();
  try{
    const d=await e.call('GET','/brokers/disponibles');
    assert.deepEqual(d.items.map(i=>i.codigo),['alpaca','webull']);
    assert.ok(d.items.every(i=>i.configurado&&i.operativo&&i.entornos.length===1&&i.entornos[0]==='paper'));
    await e.call('POST','/broker/paper/conexion',{broker:'otro'},400);
    const a=await e.call('POST','/broker/paper/conexion');
    const w=await e.call('POST','/broker/paper/conexion',{broker:'webull'});
    assert.equal(w.conexion.alias,'Webull paper'); assert.equal(w.cuenta.efectivo,500); assert.notEqual(w.conexion._id,a.conexion._id);
    assert.equal((await e.call('POST','/broker/paper/conexion',{broker:'webull'})).conexion._id,w.conexion._id);
    assert.equal((await e.call('GET','/brokers')).total,2);
    const key=e.k();
    const body={broker:'webull',empresaId:e.emp._id,tipo:'limit',precioLimite:2.5,cantidad:1,componentes:[pata(e.contratos.c100,'buy')]};
    const r=await e.call('POST','/ordenes/ticket',body,201,{'Idempotency-Key':key});
    assert.equal(r.orden.conexionId,w.conexion._id); assert.equal(r.orden.ordenExternaId,'wb-1'); assert.equal(r.orden.estado,'enviada');
    assert.match(r.orden.eventos[0].mensaje,/^Webull paper/);
    assert.equal(e.integraciones.enviadasWebull.length,1); assert.equal(e.integraciones.enviadas.length,0);
    assert.equal(e.integraciones.enviadasWebull[0].componentes[0].simbolo,e.contratos.c100.contratoExternoId);
    const rep=await e.call('POST','/ordenes/ticket',body,200,{'Idempotency-Key':key});
    assert.equal(rep.orden._id,r.orden._id);
    await e.call('POST','/ordenes/ticket',{...body,broker:'x'},400,{'Idempotency-Key':e.k()});
    // filtro por conexión
    assert.equal((await e.call('GET','/ordenes?conexionId='+w.conexion._id)).total,1);
    assert.equal((await e.call('GET','/ordenes?conexionId='+a.conexion._id)).total,0);
    // resumen por broker
    e.integraciones.vivasWebull=[{posicionExternaId:'w1',simbolo:e.contratos.c100.simbolo,lado:'long',cantidad:1,precioPromedio:2,precioActual:3,valorMercado:300}];
    const rs=await e.call('GET','/broker/paper/resumen?broker=webull');
    assert.equal(rs.conexionId,w.conexion._id); assert.equal(rs.cuenta.poderCompra,900); assert.equal(rs.posiciones.length,1); assert.equal(rs.ordenes.length,1);
    assert.ok(rs.posiciones[0].posicionId); assert.equal((await e.call('GET','/posiciones?conexionId='+w.conexion._id)).total,1);
    assert.equal((await e.call('GET','/broker/paper/resumen')).posiciones.length,0); // alpaca sigue vacío
    // cancelación y cierre
    const c=await e.call('POST','/ordenes/'+r.orden._id+'/cancelacion'); assert.equal(c.estado,'cancelada');
    const pos=(await e.call('GET','/posiciones?conexionId='+w.conexion._id)).items[0];
    const cr=await e.call('POST','/posiciones/'+pos._id+'/cierre',{tipo:'market'},201,{'Idempotency-Key':e.k()});
    assert.equal(cr.orden.conexionId,w.conexion._id); assert.equal(e.integraciones.enviadasWebull.at(-1).componentes[0].intencion,'sell_to_close');
    assert.equal(e.integraciones.enviadas.length,0);
    e.integraciones.webull.configurado=false;
    const d2=await e.call('GET','/brokers/disponibles'); const wb=d2.items.find(i=>i.codigo==='webull');
    assert.equal(wb.configurado,false); assert.equal(wb.operativo,false); assert.ok(wb.mensaje);
  } finally{e.cerrar();}
});
