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

const err=(codigo,status,mensaje)=>Object.assign(new Error(mensaje),{name:'IntegrationError',proveedor:'alpaca',codigo,status,mensaje});
const viva=(c,lado,cantidad,extra={})=>({posicionExternaId:'ext-'+c.simbolo,simbolo:c.simbolo,lado,cantidad,precioPromedio:2,precioActual:2.5,valorMercado:null,...extra});

function fake(){
  const enviadas=[];
  const f={enviadas,vivas:[],sinCredenciales:false,remota:{estado:'cancelada'},enBroker:new Map(),busquedas:[],canceladas:[],
    estado:()=>({alpaca:{configurado:true}}),
    alpaca:{
      cuenta:async()=>{if(f.sinCredenciales){const e=new Error('x');e.name='IntegrationError';e.proveedor='alpaca';e.codigo='SIN_CREDENCIALES';e.mensaje='Faltan credenciales.';throw e;}return{cuentaExternaId:'PA1',estado:'ACTIVE',efectivo:1000,poderCompra:2000,patrimonio:1500,nivelOpciones:3};},
      enviarOrden:async o=>{enviadas.push(o);return{ordenExternaId:'ext-'+enviadas.length,estado:'aceptada',estadoProveedor:'accepted'};},
      consultarOrden:async()=>f.remota,cancelarOrden:async id=>{f.canceladas.push(id);},
      consultarPorClientOrderId:async clave=>{f.busquedas.push(clave);if(!f.enBroker.has(clave))throw err('NO_ENCONTRADO',404,'order not found');return f.enBroker.get(clave);},
      posiciones:async()=>f.vivas,
    },
  };
  f.alpaca.configurado=true;
  f.enviadasWebull=[]; f.vivasWebull=[];
  f.webull={configurado:true,
    cuenta:async()=>({cuentaExternaId:'WB1',estado:'ACTIVE',efectivo:500,poderCompra:900,patrimonio:700,nivelOpciones:null}),
    enviarOrden:async o=>{f.enviadasWebull.push(o);return{ordenExternaId:'wb-'+f.enviadasWebull.length,estado:'enviada',estadoProveedor:'SUBMITTED_REQUEST'};},
    consultarOrden:async()=>({estado:'cancelada',estadoProveedor:'CANCELLED'}),cancelarOrden:async()=>undefined,
    consultarPorClientOrderId:async()=>{throw err('NO_ENCONTRADO',404,'x');},
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
    const j=await r.json(); assert.ok([].concat(status).includes(r.status),r.status+' '+method+' '+path+' → '+JSON.stringify(j)); return j.data;
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
  return {call,integraciones,contratos,emp,k,factory,ctx:{userId,database:'mongodb'},cerrar:()=>server.close()};
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
    await post({...ok,componentes:[pata(e.contratos.c100,'buy',{proporcion:11})]});
    await post({...ok,cantidad:101});
    await post({...ok,credito:'si'});
    await post({...ok,componentes:[pata(e.contratos.c100,'buy'),pata(e.contratos.c110,'sell')]}); // 2 patas sin estrategiaCodigo
    await post({...ok,componentes:[pata(e.contratos.c100,'buy',{intencion:'sell_to_open'})]});
    await e.call('POST','/ordenes/ticket',ok,400,{'Idempotency-Key':'corta'});
    assert.equal(e.integraciones.enviadas.length,0); assert.equal((await e.call('GET','/ordenes')).total,0);
    assert.equal((await post({...ok,credito:true},201)).orden.credito,false); // crédito en una pata: se ignora
    assert.equal(e.integraciones.enviadas[0].credito,undefined);
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
  assert.equal(construirCuerpoOrden({clientOrderId:'k',tipo:'market',cantidad:1,credito:true,componentes:legs}).limit_price,undefined); // market de crédito: sin precio
  assert.throws(()=>construirCuerpoOrden({...base,precioLimite:-1,credito:true}),x=>x.codigo==='VALIDACION');
  assert.throws(()=>construirCuerpoOrden({...base,precioLimite:0}),x=>x.codigo==='VALIDACION');
});

test('cierre: long → sell_to_close, short → buy_to_close con cantidad en vivo; idempotente; solo abiertas',async()=>{
  const e=await entorno();
  try{
    const {c100,p90}=e.contratos;
    e.integraciones.vivas=[viva(c100,'long',2),viva(p90,'short',2)];
    const [larga,corta]=(await e.call('GET','/broker/paper/resumen')).posiciones.map(p=>p.posicionId);
    e.integraciones.vivas[0].cantidad=3; // cambió en el broker después de sincronizar
    const key=e.k();
    const r=await e.call('POST','/posiciones/'+larga+'/cierre',{tipo:'limit',precioLimite:1.5},201,{'Idempotency-Key':key});
    assert.equal(r.orden.estado,'aceptada'); assert.equal(r.orden.cantidad,3);
    let env=e.integraciones.enviadas.at(-1);
    assert.equal(env.componentes[0].accion,'sell'); assert.equal(env.componentes[0].intencion,'sell_to_close'); assert.equal(env.clientOrderId,key);
    const rep=await e.call('POST','/posiciones/'+larga+'/cierre',{tipo:'limit',precioLimite:1.5},200,{'Idempotency-Key':key});
    assert.equal(rep.orden._id,r.orden._id); assert.equal(e.integraciones.enviadas.length,1);
    await e.call('POST','/posiciones/'+larga+'/cierre',{tipo:'limit',precioLimite:1.6},409,{'Idempotency-Key':key}); // misma clave, otro precio
    await e.call('POST','/posiciones/'+corta+'/cierre',{tipo:'limit',precioLimite:1.5},201,{'Idempotency-Key':e.k()});
    env=e.integraciones.enviadas.at(-1);
    assert.equal(env.componentes[0].intencion,'buy_to_close'); assert.equal(env.cantidad,2);
    assert.ok((await e.call('GET','/configuraciones')).items.some(c=>c.nombre.startsWith('Cierre TEST')));
    await e.call('POST','/posiciones/'+larga+'/cierre',{tipo:'limit'},400,{'Idempotency-Key':e.k()}); // limit sin precio
    e.integraciones.vivas=[]; // ya no está en el broker
    await e.call('POST','/posiciones/'+corta+'/cierre',{tipo:'limit',precioLimite:1},409,{'Idempotency-Key':e.k()});
    assert.equal((await e.call('GET','/posiciones/'+corta)).estado,'cerrada');
    e.integraciones.alpaca.posiciones=async()=>{throw err('PROVEEDOR',null,'formato');};
    await e.call('POST','/posiciones/'+larga+'/cierre',{tipo:'market'},502,{'Idempotency-Key':e.k()}); // sin datos vivos no se cierra
    assert.equal(e.integraciones.enviadas.length,2);
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
    assert.deepEqual(d.items.map(i=>i.codigo),['alpaca','webull','ibkr']);
    assert.equal(d.items[2].operativo,false); assert.match(d.items[2].mensaje,/IBKR_GATEWAY_URL/);
    assert.ok(d.items.slice(0,2).every(i=>i.configurado&&i.operativo&&i.entornos.length===1&&i.entornos[0]==='paper'));
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
    assert.match(r.orden.eventos.at(-1).mensaje,/^Webull paper/);
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
    assert.equal((await e.call('POST','/ordenes/'+r.orden._id+'/actualizacion')).estado,'cancelada');
    const rs=await e.call('GET','/broker/paper/resumen?broker=webull');
    assert.equal(rs.conexionId,w.conexion._id); assert.equal(rs.cuenta.poderCompra,900); assert.equal(rs.posiciones.length,1); assert.equal(rs.ordenes.length,1);
    assert.ok(rs.posiciones[0].posicionId); assert.equal((await e.call('GET','/posiciones?conexionId='+w.conexion._id)).total,1);
    assert.equal((await e.call('GET','/broker/paper/resumen')).posiciones.length,0); // alpaca sigue vacío
    // cancelación y cierre
    const r4=await e.call('POST','/ordenes/ticket',body,201,{'Idempotency-Key':e.k()});
    const c=await e.call('POST','/ordenes/'+r4.orden._id+'/cancelacion'); assert.equal(c.estado,'cancelada');
    const pos=(await e.call('GET','/posiciones?conexionId='+w.conexion._id)).items[0];
    const cr=await e.call('POST','/posiciones/'+pos._id+'/cierre',{tipo:'market'},201,{'Idempotency-Key':e.k()});
    assert.equal(cr.orden.conexionId,w.conexion._id); assert.equal(e.integraciones.enviadasWebull.at(-1).componentes[0].intencion,'sell_to_close');
    assert.equal(e.integraciones.enviadas.length,0);
    e.integraciones.webull.configurado=false;
    const d2=await e.call('GET','/brokers/disponibles'); const wb=d2.items.find(i=>i.codigo==='webull');
    assert.equal(wb.configurado,false); assert.equal(wb.operativo,false); assert.ok(wb.mensaje);
  } finally{e.cerrar();}
});

// --- Envío incierto, rechazos y claves reutilizadas
const ticketDe=e=>({empresaId:e.emp._id,tipo:'limit',precioLimite:2.5,cantidad:2,componentes:[pata(e.contratos.c100,'buy')]});
const ordenDe=async(e,key)=>(await e.call('GET','/ordenes')).items.find(o=>o.idempotencyKey===key);

test('reintento tras un envío incierto: adopta la orden del broker o la reenvía si no existe',async()=>{
  const e=await entorno();
  try{
    const {integraciones:f}=e, body=ticketDe(e), enviar=f.alpaca.enviarOrden;
    const post=(key,status,b=body)=>e.call('POST','/ordenes/ticket',b,status,{'Idempotency-Key':key});
    // 1) llegó, pero se perdió la respuesta
    const k1=e.k();
    f.alpaca.enviarOrden=async()=>{throw err('RED',null,'Tiempo de espera agotado');};
    await post(k1,502);
    assert.equal((await ordenDe(e,k1)).estado,'pendiente'); assert.equal((await ordenDe(e,k1)).eventos.at(-1).tipo,'error_envio');
    f.enBroker.set(k1,{ordenExternaId:'viva-1',estado:'aceptada',estadoProveedor:'new',cantidadEjecutada:0});
    f.alpaca.enviarOrden=enviar;
    const r1=await post(k1,200);
    assert.equal(r1.orden.ordenExternaId,'viva-1'); assert.equal(r1.orden.estado,'aceptada'); assert.equal(f.enviadas.length,0);
    // 2) no llegó: se reenvía con la misma clave
    const k2=e.k();
    f.alpaca.enviarOrden=async()=>{throw err('PROVEEDOR',503,'no disponible');};
    await post(k2,502);
    f.alpaca.enviarOrden=enviar;
    const r2=await post(k2,200);
    assert.equal(r2.orden.estado,'aceptada'); assert.equal(f.enviadas.length,1); assert.equal(f.enviadas[0].clientOrderId,k2);
    await post(k2,200); assert.equal(f.enviadas.length,1);
    // 3) si no se puede consultar al broker, no se reenvía
    const k3=e.k();
    f.alpaca.enviarOrden=async()=>{throw err('RED',null,'x');};
    await post(k3,502);
    f.alpaca.enviarOrden=enviar;
    const buscar=f.alpaca.consultarPorClientOrderId;
    f.alpaca.consultarPorClientOrderId=async()=>{throw err('RED',null,'x');};
    await post(k3,502); assert.equal(f.enviadas.length,1); assert.equal((await ordenDe(e,k3)).estado,'pendiente');
    f.alpaca.consultarPorClientOrderId=buscar;
    // 4) clave duplicada según el broker → la orden sí existía
    const k4=e.k();
    f.enBroker.set(k4,{ordenExternaId:'viva-4',estado:'aceptada'});
    f.alpaca.enviarOrden=async()=>{throw err('PROVEEDOR',422,'client_order_id must be unique');};
    assert.equal((await post(k4,201)).orden.ordenExternaId,'viva-4');
    // 5) otra solicitud con la misma clave
    await post(k4,409,{...body,cantidad:3});
    await post(k4,409,{...body,broker:'webull'});
  } finally{e.cerrar();}
});

test('dos tickets simultáneos con la misma clave crean una sola orden',async()=>{
  const e=await entorno();
  try{
    const key=e.k(), f=e.integraciones;
    f.alpaca.enviarOrden=async o=>{
      if(f.enBroker.has(o.clientOrderId)) throw err('PROVEEDOR',422,'client_order_id must be unique');
      const r={ordenExternaId:'unica',estado:'aceptada'}; f.enBroker.set(o.clientOrderId,r); await new Promise(x=>setTimeout(x,20)); return r;
    };
    const rs=await Promise.all([1,2].map(()=>e.call('POST','/ordenes/ticket',ticketDe(e),[200,201],{'Idempotency-Key':key})));
    assert.ok(rs.every(r=>r.orden.ordenExternaId==='unica'));
    assert.equal((await e.call('GET','/ordenes')).total,1);
  } finally{e.cerrar();}
});

test('rechazo definitivo (4xx) → rechazada; credenciales o límite → sigue pendiente y se puede reintentar',async()=>{
  const e=await entorno();
  try{
    const f=e.integraciones, enviar=f.alpaca.enviarOrden;
    const post=(key,status)=>e.call('POST','/ordenes/ticket',ticketDe(e),status,{'Idempotency-Key':key});
    for(const error of [err('PROVEEDOR',403,'insufficient buying power'),err('PROVEEDOR',422,'x'),err('VALIDACION',null,'estrategia')]){
      const key=e.k(); f.alpaca.enviarOrden=async()=>{throw error;};
      await post(key,error.codigo==='VALIDACION'?400:502);
      const o=await ordenDe(e,key); assert.equal(o.estado,'rechazada'); assert.equal(o.eventos.at(-1).mensaje,error.mensaje);
      f.alpaca.enviarOrden=enviar;
      assert.equal((await post(key,200)).orden.estado,'rechazada'); // no se reenvía
    }
    assert.equal(f.enviadas.length,0);
    const key=e.k(); f.alpaca.enviarOrden=async()=>{throw err('LIMITE',429,'x');};
    await post(key,429); assert.equal((await ordenDe(e,key)).estado,'pendiente');
    f.alpaca.enviarOrden=enviar;
    assert.equal((await post(key,200)).orden.estado,'aceptada');
  } finally{e.cerrar();}
});

test('cancelar una orden sin id externo consulta antes al broker',async()=>{
  const e=await entorno();
  try{
    const f=e.integraciones, buscar=f.alpaca.consultarPorClientOrderId;
    const incierta=async()=>{const key=e.k(); f.alpaca.enviarOrden=async()=>{throw err('RED',null,'x');}; await e.call('POST','/ordenes/ticket',ticketDe(e),502,{'Idempotency-Key':key}); return ordenDe(e,key);};
    const cancelar=(o,status=200)=>e.call('POST','/ordenes/'+o._id+'/cancelacion',undefined,status);
    const viva=await incierta();
    f.enBroker.set(viva.idempotencyKey,{ordenExternaId:'x-1',estado:'aceptada'});
    assert.equal((await cancelar(viva)).estado,'cancelada'); assert.deepEqual(f.canceladas,['x-1']); // se canceló en el broker
    const llena=await incierta();
    f.enBroker.set(llena.idempotencyKey,{ordenExternaId:'x-2',estado:'ejecutada',cantidadEjecutada:2,precioPromedioEjecucion:2.4});
    const l=await cancelar(llena); assert.equal(l.estado,'ejecutada'); assert.equal(l.precioPromedioEjecucion,2.4); assert.equal(f.canceladas.length,1);
    const dudosa=await incierta();
    f.alpaca.consultarPorClientOrderId=async()=>{throw err('RED',null,'x');};
    await cancelar(dudosa,502); assert.equal((await ordenDe(e,dudosa.idempotencyKey)).estado,'pendiente');
    f.alpaca.consultarPorClientOrderId=buscar;
    assert.equal((await cancelar(dudosa)).estado,'cancelada'); assert.equal(f.canceladas.length,1);
  } finally{e.cerrar();}
});

// --- Actualización y sincronización de órdenes
test('actualización y sincronización: solo órdenes vivas, ejecución parcial y fallos por orden',async()=>{
  const e=await entorno();
  try{
    const f=e.integraciones, consultas=[];
    const crear=()=>e.call('POST','/ordenes/ticket',ticketDe(e),201,{'Idempotency-Key':e.k()}).then(r=>r.orden);
    const [a,b]=[await crear(),await crear()];
    f.alpaca.consultarOrden=async id=>{consultas.push(id);return{estado:'parcial',cantidadEjecutada:1,precioPromedioEjecucion:2.4};};
    const u=await e.call('POST','/ordenes/'+a._id+'/actualizacion');
    assert.equal(u._id,a._id); assert.equal(u.estado,'parcial'); assert.equal(u.cantidadEjecutada,1); assert.equal(u.precioPromedioEjecucion,2.4); assert.deepEqual(consultas,[a.ordenExternaId]);
    const eventos=u.eventos.length;
    assert.equal((await e.call('POST','/ordenes/'+a._id+'/actualizacion')).eventos.length,eventos); // sin cambios no agrega eventos
    f.alpaca.consultarOrden=async()=>({estado:'parcial',cantidadEjecutada:2,precioPromedioEjecucion:2.45});
    assert.equal((await e.call('POST','/ordenes/'+a._id+'/actualizacion')).cantidadEjecutada,2); // mismo estado, otra ejecución
    const resumen=(await e.call('GET','/broker/paper/resumen')).ordenes.find(o=>o._id===a._id);
    assert.equal(resumen.cantidadEjecutada,2); assert.equal(resumen.precioPromedioEjecucion,2.45);
    f.alpaca.consultarOrden=async id=>{consultas.push(id);if(id===a.ordenExternaId)throw err('PROVEEDOR',500,'x');return{estado:'ejecutada',cantidadEjecutada:2,precioPromedioEjecucion:2.5};};
    const {createSincronizador}=require('../dist/api/v1/services/sincronizacion.service');
    const sync=()=>createSincronizador({integraciones:f,factory:e.factory}).ejecutar(e.ctx,{recurso:'ordenes',conexionId:a.conexionId});
    assert.deepEqual(await sync(),{procesados:1,fallidos:1});
    assert.equal((await e.call('GET','/ordenes/'+b._id)).estado,'ejecutada');
    consultas.length=0; await sync(); assert.deepEqual(consultas,[a.ordenExternaId]); // b ya es terminal
    await e.call('POST','/ordenes/'+b._id+'/actualizacion'); assert.deepEqual(consultas,[a.ordenExternaId]);
    await e.call('POST','/ordenes/nada/actualizacion',undefined,400);
  } finally{e.cerrar();}
});

test('actualización de una orden pendiente de envío incierto la recupera del broker',async()=>{
  const e=await entorno();
  try{
    const f=e.integraciones, key=e.k();
    f.alpaca.enviarOrden=async()=>{throw err('RED',null,'x');};
    await e.call('POST','/ordenes/ticket',ticketDe(e),502,{'Idempotency-Key':key});
    const o=await ordenDe(e,key);
    assert.equal((await e.call('POST','/ordenes/'+o._id+'/actualizacion')).estado,'pendiente');
    f.enBroker.set(key,{ordenExternaId:'x-9',estado:'aceptada'});
    assert.equal((await e.call('POST','/ordenes/'+o._id+'/actualizacion')).ordenExternaId,'x-9');
  } finally{e.cerrar();}
});

// --- Cierre de estructuras
test('cierre-grupo: una orden multi-pata con intenciones de cierre, cantidades vivas y bloqueo de cierres duplicados',async()=>{
  const e=await entorno();
  try{
    const f=e.integraciones, c=e.contratos;
    f.vivas=[viva(c.p85,'long',2,{grupoId:'G'}),viva(c.p90,'short',2,{grupoId:'G'}),viva(c.c110,'short',2),viva(c.c115,'long',2)];
    const ps=(await e.call('GET','/broker/paper/resumen')).posiciones;
    assert.equal(ps[0].grupoId,'G'); assert.ok(ps.every(p=>p.cerrable));
    const ids=ps.map(p=>p.posicionId);
    const post=(body,status,key=e.k())=>e.call('POST','/posiciones/cierre-grupo',body,status,{'Idempotency-Key':key});
    const base={posicionIds:ids,tipo:'limit',precioLimite:0.6,credito:false};
    await e.call('POST','/posiciones/cierre-grupo',base,400);
    for(const posicionIds of [undefined,[ids[0]],[ids[0],ids[0]],[...ids,'otra'],[1,2]]) await post({...base,posicionIds},400);
    await post({...base,precioLimite:undefined},400); await post({...base,posicionIds:[ids[0],'nada']},400);
    f.vivas.forEach(v=>{v.cantidad=3;});
    const key=e.k(), r=await post(base,201,key);
    const env=f.enviadas.at(-1);
    assert.equal(env.cantidad,3); assert.ok(env.componentes.every(x=>x.proporcion===1));
    assert.deepEqual(env.componentes.map(x=>x.intencion),['sell_to_close','buy_to_close','buy_to_close','sell_to_close']);
    assert.equal(construirCuerpoOrden(env).limit_price,'0.6');
    assert.equal((await post(base,200,key)).orden._id,r.orden._id); await post({...base,credito:true},409,key);
    // cierre en curso: ni el grupo ni una pata suelta
    f.remota={estado:'aceptada'};
    await post(base,409);
    await e.call('POST','/posiciones/'+ids[0]+'/cierre',{tipo:'market'},409,{'Idempotency-Key':e.k()});
    f.remota={estado:'cancelada'}; // en el broker ya terminó aunque la copia local diga aceptada
    f.vivas[0].cantidad=4; f.vivas[1].cantidad=2;
    await post({posicionIds:ids.slice(0,2),tipo:'market',credito:true},201);
    const dos=f.enviadas.at(-1); assert.equal(dos.cantidad,2); assert.deepEqual(dos.componentes.map(x=>x.proporcion),[2,1]); assert.equal(dos.credito,true);
    assert.equal(construirCuerpoOrden(dos).limit_price,undefined);
    const n=f.enviadas.length;
    f.vivas[2].cantidad=23; f.vivas[3].cantidad=1; await post({...base,posicionIds:ids.slice(2)},400); // proporción > 10
    f.vivas.pop(); await post({...base,posicionIds:ids.slice(2)},409); // una pata ya no está
    assert.equal(f.enviadas.length,n);
  } finally{e.cerrar();}
});

test('una orden viva en el broker enviada desde otro sitio se avisa e impide duplicar el cierre',async()=>{
  const e=await entorno();
  try{
    const f=e.integraciones, c=e.contratos; f.vivas=[viva(c.c100,'long',1)];
    const abierta=(accion,intencion,estado='aceptada',ordenExternaId='ajena')=>({ordenExternaId,estado,componentes:[{simbolo:c.c100.simbolo,accion,intencion}]});
    let lista=[abierta('sell',null)]; f.alpaca.ordenesAbiertas=async()=>lista;
    const r=await e.call('GET','/broker/paper/resumen'), id=r.posiciones[0].posicionId;
    assert.deepEqual(r.ordenesExternas,[{ordenExternaId:'ajena',estado:'aceptada',componentes:[{simbolo:c.c100.simbolo,accion:'sell'}]}]);
    const cerrar=status=>e.call('POST','/posiciones/'+id+'/cierre',{tipo:'market'},status,{'Idempotency-Key':e.k()});
    await cerrar(409); lista=[abierta('sell','sell_to_close')]; await cerrar(409); assert.equal(f.enviadas.length,0);
    lista=[abierta('buy','buy_to_open'),abierta('sell','sell_to_open'),abierta('sell',null,'cancelada')]; // ninguna cierra esta posición
    const o=(await cerrar(201)).orden; assert.equal(f.enviadas.length,1);
    f.remota={estado:'cancelada'}; lista=[abierta('sell',null,'aceptada',o.ordenExternaId)]; // la propia no es ajena aunque el broker tarde en retirarla
    await cerrar(201); assert.equal((await e.call('GET','/broker/paper/resumen')).ordenesExternas.length,0);
    f.alpaca.ordenesAbiertas=async()=>{throw new Error('caído');}; assert.deepEqual((await e.call('GET','/broker/paper/resumen')).ordenesExternas,[]);
  } finally{e.cerrar();}
});

test('posición sin lado determinable: se muestra y se guarda como no cerrable',async()=>{
  const e=await entorno();
  try{
    const f=e.integraciones, c=e.contratos;
    f.vivas=[viva(c.c100,null,1,{precioPromedio:null,precioActual:null,grupoId:'G',cerrable:false}),viva(c.c110,'short',1,{grupoId:'G'})];
    const r=await e.call('GET','/broker/paper/resumen'), [p,q]=r.posiciones;
    assert.equal(r.avisoSincronizacion,undefined);
    assert.equal(p.cerrable,false); assert.equal(p.lado,null); assert.equal(p.pl,null); assert.ok(p.posicionId); assert.equal(q.cerrable,true);
    await e.call('POST','/posiciones/'+p.posicionId+'/cierre',{tipo:'market'},409,{'Idempotency-Key':e.k()});
    await e.call('POST','/posiciones/cierre-grupo',{posicionIds:[p.posicionId,q.posicionId],tipo:'market'},409,{'Idempotency-Key':e.k()});
    assert.equal(f.enviadas.length,0);
  } finally{e.cerrar();}
});

test('resumen: avisa si falla la sincronización y solo consulta los contratos de las posiciones vivas',async()=>{
  const e=await entorno();
  try{
    const f=e.integraciones; f.vivas=[viva(e.contratos.c100,'long',1)];
    const filtros=[];
    const factory=(name,ctx)=>{const r=e.factory(name,ctx);return name==='contratos'?{...r,list:o=>{filtros.push(o.filtro);return r.list(o);}}:name==='posiciones'?{...r,create:async()=>{throw new Error('base caída');}}:r;};
    const {createOperacion}=require('../dist/api/v1/services/operacion.service');
    const r=await createOperacion({integraciones:f,factory,cola:createCola()}).resumen(e.ctx);
    assert.match(r.avisoSincronizacion,/No se pudieron guardar/); assert.equal(r.posiciones.length,1); assert.equal(r.posiciones[0].contratoId,e.contratos.c100._id);
    assert.ok(filtros.length&&filtros.every(x=>x.contratoExternoId===e.contratos.c100.simbolo));
    await e.call('GET','/broker/paper/resumen'); // guarda la posición
    f.alpaca.posiciones=async()=>{throw err('PROVEEDOR',null,'formato no reconocido');};
    const caido=await e.call('GET','/broker/paper/resumen');
    assert.match(caido.avisoSincronizacion,/formato no reconocido/); assert.equal(caido.posicionesDisponibles,false); assert.equal(caido.cuenta.efectivo,1000);
    assert.equal((await e.call('GET','/posiciones')).items[0].estado,'abierta'); // un fallo no cierra lo guardado
  } finally{e.cerrar();}
});

// --- CRUD protegido y conexión única
test('CRUD: auditoría y posiciones de solo lectura; órdenes sin campos del servidor ni borrado en vivo',async()=>{
  const e=await entorno();
  try{
    for(const r of ['auditoria','posiciones']){
      await e.call('POST','/'+r,{},405); await e.call('POST','/'+r+'/lote',{items:[{}]},405); await e.call('PUT','/'+r+'/x',{},405);
      await e.call('DELETE','/'+r+'/x',undefined,405); await e.call('POST','/'+r+'/eliminacion-lote',{ids:['x']},405); await e.call('GET','/'+r);
    }
    const t=(await e.call('POST','/ordenes/ticket',ticketDe(e),201,{'Idempotency-Key':e.k()})).orden;
    const datos={conexionId:t.conexionId,configuracionId:t.configuracionId,tipo:'limit',vigencia:'day',cantidad:1,precioLimite:1,
      componentes:[{contratoId:e.contratos.c100._id,simbolo:e.contratos.c100.simbolo,accion:'buy',intencion:'buy_to_open',proporcion:1}]};
    for(const extra of [{estado:'ejecutada'},{ordenExternaId:'x'},{eventos:[]},{cantidadEjecutada:1},{huella:'x'},{idempotencyKey:'corta'}]) await e.call('POST','/ordenes',{...datos,...extra},400);
    await e.call('POST','/ordenes',{...datos,idempotencyKey:t.idempotencyKey},409);
    const lote=await e.call('POST','/ordenes/lote',{items:[{...datos,estado:'ejecutada'}]}); assert.equal(lote.fallidos,1);
    const o=await e.call('POST','/ordenes',datos,201);
    assert.equal(o.estado,'pendiente'); assert.ok(o.idempotencyKey);
    const {_id,_revision,usuarioId,createdAt,updatedAt,...editable}=o;
    const ed=await e.call('PUT','/ordenes/'+_id,{...editable,cantidad:2}); assert.equal(ed.cantidad,2); assert.equal(ed.idempotencyKey,o.idempotencyKey);
    for(const extra of [{estado:'ejecutada'},{ordenExternaId:'x'},{idempotencyKey:'otra-clave-1'},{eventos:[{tipo:'x'}]}]) await e.call('PUT','/ordenes/'+_id,{...editable,...extra},400);
    await e.call('PUT','/ordenes/'+t._id,datos,409); // ya enviada
    await e.call('POST','/ordenes/'+_id+'/eventos',{tipo:'x'},405); await e.call('POST','/ordenes/'+_id+'/componentes',datos.componentes[0],405); await e.call('GET','/ordenes/'+_id+'/eventos');
    await e.call('DELETE','/ordenes/'+_id,undefined,409); await e.call('DELETE','/ordenes/'+t._id,undefined,409);
    assert.equal((await e.call('POST','/ordenes/eliminacion-lote',{ids:[t._id]})).fallidos,1);
    await e.call('POST','/ordenes/'+_id+'/cancelacion'); await e.call('DELETE','/ordenes/'+_id);
  } finally{e.cerrar();}
});

test('conexión: peticiones simultáneas no duplican; respeta la existente y reemplaza la revocada',async()=>{
  const e=await entorno();
  try{
    const rs=await Promise.all([1,2,3].map(()=>e.call('POST','/broker/paper/conexion')));
    assert.equal(new Set(rs.map(r=>r.conexion._id)).size,1);
    assert.equal((await e.call('GET','/conexiones-broker')).total,1); assert.equal((await e.call('GET','/brokers')).total,1);
    const c=(await e.call('GET','/conexiones-broker')).items[0];
    await e.call('PUT','/conexiones-broker/'+c._id,{brokerId:c.brokerId,alias:c.alias,entorno:'paper',estado:'revocada'});
    const nueva=await e.call('POST','/broker/paper/conexion'); assert.notEqual(nueva.conexion._id,c._id);
    assert.equal((await e.call('POST','/broker/paper/conexion')).conexion._id,nueva.conexion._id);
    // una conexión previa con id aleatorio se reutiliza
    const b=await e.call('POST','/brokers',{codigo:'webull',nombre:'Webull',activo:true,entornos:['paper']},201);
    const previa=await e.call('POST','/conexiones-broker',{brokerId:b._id,alias:'Antigua',entorno:'paper',credencialRef:'env:WEBULL'},201);
    assert.equal((await e.call('POST','/broker/paper/conexion',{broker:'webull'})).conexion._id,previa._id);
  } finally{e.cerrar();}
});
