// Plataforma HTTP: límites, proxy de confianza, cabeceras, caché, gzip, errores, sesiones y cliente HTTP (sin red externa).
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {once}=require('node:events');
const {gunzipSync}=require('node:zlib');
const {randomUUID,scryptSync}=require('node:crypto');
const {memoryFactory}=require('./helpers/memory.cjs');
const {createApp}=require('../dist/app');
const {createSessionService}=require('../dist/api/v1/services/sesiones.service');
const {createCrudService}=require('../dist/api/v1/services/crud.service');
const {createCola,usuarioActual}=require('../dist/jobs/cola');
const {createLimitador}=require('../dist/middlewares/limitador');
const {limiteOperaciones}=require('../dist/middlewares/limites.handler');
const {ocultarSecretos}=require('../dist/middlewares/errores.handler');
const {createHttp}=require('../dist/integrations/http');
const API=require('../dist/config/config').default.API_URL;
const password='valid-test-password', salt='s';
const passwordHash=scryptSync(password,salt,64).toString('hex');
const nuevoUsuario=extra=>({id:randomUUID(),email:'u@example.com',salt,passwordHash,...extra});

async function levantar(t,{usuarios=[nuevoUsuario()],...opciones}={}) {
  const factory=opciones.factory||memoryFactory(), auth=opciones.auth||createSessionService(factory,async()=>usuarios);
  const app=createApp({factory,auth,quiet:true,webDir:null,cola:createCola(),...opciones});
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const pedir=(metodo,ruta,body,headers={})=>fetch(base+API+ruta,{method:metodo,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const login=async(clave=password,ip,email='u@example.com')=>pedir('POST','/sesiones',{email,password:clave,baseDatos:'mongodb'},ip?{'X-Forwarded-For':ip}:{});
  const token=async()=>'Bearer '+(await (await login()).json()).data.token;
  return {base,pedir,login,token,factory,usuarios,puerto:server.address().port};
}
// fetch descomprime por su cuenta: para ver la respuesta tal cual se usa node:http.
const crudo=(puerto,ruta,headers={})=>new Promise((resolve,reject)=>http.get({port:puerto,host:'127.0.0.1',path:ruta,headers},res=>{
  const partes=[];res.on('data',p=>partes.push(p));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,cuerpo:Buffer.concat(partes)}));
}).on('error',reject));

test('Limitador: ventana, olvido y memoria acotada',()=>{
  let ahora=0; const l=createLimitador({max:2,ventanaMs:1000,capacidad:2,ahora:()=>ahora});
  assert.equal(l.sumar('a'),0); assert.equal(l.sumar('a'),0); assert.equal(l.sumar('a'),1);
  l.olvidar('a'); assert.equal(l.sumar('a'),0);
  l.sumar('b'); l.sumar('b'); assert.ok(l.sumar('b'));
  l.sumar('c'); // expulsa a la más antigua (a), no bloquea
  assert.ok(l.sumar('b')); ahora=1000; assert.equal(l.sumar('b'),0);
});
test('Login: sin proxy de confianza X-Forwarded-For no cambia la IP; con 1 salto se separan clientes',async t=>{
  const directo=await levantar(t);
  for(let i=0;i<10;i++) assert.equal((await directo.login('mala','10.0.0.'+i,'e'+i+'@x.com')).status,401);
  assert.equal((await directo.login('mala','10.0.0.99','z@x.com')).status,429);
  const proxy=await levantar(t,{trustProxy:1});
  for(let i=0;i<10;i++) assert.equal((await proxy.login('mala','1.1.1.1','e'+i+'@x.com')).status,401);
  // El cliente antepone una IP falsa: cuenta solo la que agregó el proxy (la última).
  const r=await proxy.login('mala','9.9.9.9, 1.1.1.1','z@x.com');
  assert.equal(r.status,429); assert.ok(Number(r.headers.get('retry-after'))>0);
  assert.equal((await proxy.login(password,'2.2.2.2')).status,200);
  for(const malo of [true,NaN,-1,1.5]) assert.throws(()=>createApp({quiet:true,webDir:null,trustProxy:malo}),/TRUST_PROXY/);
});
test('Login: límite por correo aunque cambie la IP; un acierto lo reinicia',async t=>{
  const s=await levantar(t,{trustProxy:1});
  let n=0; const ip=()=>'7.7.0.'+(n++);
  for(let i=0;i<9;i++) assert.equal((await s.login('mala',ip())).status,401);
  assert.equal((await s.login(password,ip())).status,200);
  for(let i=0;i<10;i++) assert.equal((await s.login('mala',ip())).status,401);
  assert.equal((await s.login(password,ip(),' U@Example.com ')).status,429);
  assert.equal((await s.login('mala',ip(),'otro@x.com')).status,401);
});
test('Accesos fallidos: la auditoría queda acotada por usuario',async()=>{
  const f=memoryFactory(), auth=createSessionService(f,async()=>[nuevoUsuario()]);
  for(let i=0;i<30;i++) await assert.rejects(auth.login({email:'x'+i+'@y.com',password:'z',baseDatos:'mongodb'}),e=>e.output.statusCode===401);
  assert.equal((await createCrudService('auditoria',f).list({userId:'anonimo',database:'mongodb'})).total,20);
});
test('authenticate: rechaza usuarios eliminados o desactivados con la sesión vigente',async t=>{
  const s=await levantar(t), Authorization=await s.token();
  assert.equal((await s.pedir('GET','/empresas',undefined,{Authorization})).status,200);
  s.usuarios[0].activo=false;
  assert.equal((await s.pedir('GET','/empresas',undefined,{Authorization})).status,401);
  delete s.usuarios[0].activo; assert.equal((await s.pedir('GET','/sesiones/actual',undefined,{Authorization})).status,200);
  s.usuarios.length=0;
  assert.equal((await s.pedir('GET','/empresas',undefined,{Authorization})).status,401);
});

const solicitud=(originalUrl,userId='u1',method='POST')=>{const cierre=[];return {req:{method,originalUrl,context:{userId}},res:{on:(_e,f)=>cierre.push(f)},cerrar:()=>cierre.forEach(f=>f())};};
test('Operaciones costosas: límite por usuario; GET, CRUD y otros usuarios no cuentan',()=>{
  const limite=limiteOperaciones({max:3});
  const usar=(...a)=>{const s=solicitud(...a);limite(s.req,s.res);s.cerrar();};
  for(const u of ['/api/v1/sincronizaciones/ejecuciones','/api/v1/cores/tecnico/evaluaciones?x=1','/api/v1/ordenes/ticket/']) usar(u);
  assert.throws(()=>usar('/api/v1/selecciones/ejecuciones'),e=>e.output.statusCode===429&&Number(e.output.headers['Retry-After'])>0);
  usar('/api/v1/selecciones/ejecuciones','u2'); usar('/api/v1/evaluaciones','u1','GET'); usar('/api/v1/posiciones/1/cierre');
  const amplio=limiteOperaciones();
  for(let i=0;i<60;i++){const s=solicitud('/api/v1/confluencias/ejecuciones');amplio(s.req,s.res);s.cerrar();} // 4 análisis en un minuto
});
test('Cola: tope de trabajos por usuario con 429 claro y sin bloquear tickets',async()=>{
  const cola=createCola({concurrencia:1,maxPorUsuario:3}), limite=limiteOperaciones({cola});
  let soltar; const espera=new Promise(r=>{soltar=r;});
  usuarioActual.run('u1',()=>{cola.encolar('a',()=>espera);cola.encolar('b',async()=>{});});
  cola.encolar('interno',async()=>{}); // trabajos del servidor: sin dueño
  assert.equal(cola.pendientes('u1'),2);
  const s1=solicitud('/api/v1/selecciones/ejecuciones'); limite(s1.req,s1.res); // en vuelo
  const s2=solicitud('/api/v1/selecciones/ejecuciones');
  assert.throws(()=>limite(s2.req,s2.res),e=>e.output.statusCode===429&&/3 trabajos en espera/.test(e.message));
  const ticket=solicitud('/api/v1/ordenes/ticket'); limite(ticket.req,ticket.res);
  const otro=solicitud('/api/v1/selecciones/ejecuciones','u2'); limite(otro.req,otro.res);
  s1.cerrar(); limite(s2.req,s2.res); s2.cerrar();
  soltar(); await cola.vaciar(); assert.equal(cola.pendientes('u1'),0);
});
test('Cola por HTTP: el trabajo se atribuye al usuario y el exceso no crea registros',async t=>{
  const cola=createCola({concurrencia:1,maxPorUsuario:2}), s=await levantar(t,{cola}), Authorization=await s.token();
  let soltar; const espera=new Promise(r=>{soltar=r;}); cola.encolar('tapon',()=>espera);
  const crear=()=>s.pedir('POST','/sincronizaciones/ejecuciones',{recurso:'empresas',simbolos:[]},{Authorization});
  for(let i=0;i<2;i++) assert.equal((await crear()).status,202);
  assert.equal(cola.pendientes(s.usuarios[0].id),2);
  const r=await crear(); assert.equal(r.status,429); assert.match((await r.json()).message,/trabajos en espera/);
  assert.equal((await (await s.pedir('GET','/sincronizaciones',undefined,{Authorization})).json()).data.total,2);
  soltar(); await cola.vaciar();
  assert.equal((await crear()).status,202); await cola.vaciar();
});

test('Inyección de operadores: los ids de un lote deben ser texto',async t=>{
  const s=await levantar(t), Authorization=await s.token();
  const e=(await (await s.pedir('POST','/empresas',{simbolo:'A',nombre:'A',mercado:'T'},{Authorization})).json()).data;
  const r=(await (await s.pedir('POST','/empresas/eliminacion-lote',{ids:[{$ne:null},['x'],e._id]},{Authorization})).json()).data;
  assert.deepEqual(r.results.map(x=>x.status),[400,400,200]);
  const u=(await (await s.pedir('PUT','/empresas/lote',{items:[{id:{$gt:''},datos:{}}]},{Authorization})).json()).data;
  assert.equal(u.results[0].status,400);
  const c=(await (await s.pedir('POST','/configuraciones/x/componentes/eliminacion-lote',{ids:[{$ne:null}]},{Authorization})).json()).data;
  assert.equal(c.results[0].status,400);
});

test('Cabeceras de seguridad y HSTS solo detrás de https',async t=>{
  const s=await levantar(t,{trustProxy:1});
  const r=await fetch(s.base+'/health');
  assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  assert.equal(r.headers.get('x-frame-options'),'DENY');
  assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  const csp=r.headers.get('content-security-policy');
  for(const d of ["script-src 'self';","style-src 'self' 'unsafe-inline'","connect-src 'self'","frame-ancestors 'none'"]) assert.ok(csp.includes(d),d);
  assert.equal(r.headers.get('strict-transport-security'),null);
  assert.ok((await fetch(s.base+'/health',{headers:{'X-Forwarded-Proto':'https'}})).headers.get('strict-transport-security'));
  const docs=await fetch(s.base+API+'/api-docs/'); // swagger-ui: ningún script en línea que la CSP bloquee
  assert.equal(docs.status,200); assert.doesNotMatch(await docs.text(),/<script(?![^>]*\bsrc=)[^>]*>\s*\S/);
});
test('Errores: URI mal formada 400; inesperado 500 registrado sin secretos ni cuerpo',async t=>{
  process.env.PRUEBA_SECRET='valor-super-secreto';
  t.after(()=>{delete process.env.PRUEBA_SECRET;});
  const f=memoryFactory();
  const factory=(n,c)=>n==='noticias'?{count:async()=>{throw new TypeError('falló con valor-super-secreto en mongodb://u:clave@host/db');}}:f(n,c);
  const s=await levantar(t,{factory}), Authorization=await s.token();
  const mal=await s.pedir('GET','/empresas/%E0%A4%A',undefined,{Authorization});
  assert.equal(mal.status,400); assert.match((await mal.json()).message,/URL/);
  const registros=[], original=console.error; console.error=(...a)=>registros.push(a.join(' '));
  try {
    const r=await s.pedir('GET','/noticias?titulo=consulta-privada',undefined,{Authorization});
    assert.equal(r.status,500); const cuerpo=await r.json();
    assert.doesNotMatch(JSON.stringify(cuerpo),/falló|secreto/);
    assert.equal(registros.length,1);
    assert.ok(registros[0].includes(cuerpo.requestId)&&registros[0].includes('TypeError')&&/\n\s+at /.test(registros[0]));
    assert.doesNotMatch(registros[0],/super-secreto|u:clave|consulta-privada|Bearer/);
    assert.equal((await s.pedir('GET','/empresas/no-existe',undefined,{Authorization})).status,404);
    const charset=await s.pedir('POST','/sesiones',{},{'Content-Type':'application/json; charset=raro'});
    assert.equal(charset.status,415);
    assert.equal(registros.length,1,'los errores esperados no se registran');
  } finally { console.error=original; }
  assert.equal(ocultarSecretos('abc',{X_KEY:''}),'abc');
});
test('Archivos web: assets inmutables, index sin caché y gzip opcional',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'web-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const js='console.log("hola");'.repeat(200);
  fs.mkdirSync(path.join(dir,'assets')); fs.writeFileSync(path.join(dir,'assets','index-abc.js'),js);
  fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><title>x</title>'); fs.writeFileSync(path.join(dir,'robots.txt'),'x');
  const s=await levantar(t,{webDir:dir});
  const gz=await crudo(s.puerto,'/assets/index-abc.js',{'Accept-Encoding':'gzip, br'});
  assert.equal(gz.headers['content-encoding'],'gzip'); assert.equal(gunzipSync(gz.cuerpo).toString(),js);
  assert.match(gz.headers['content-type'],/javascript/);
  const plano=await crudo(s.puerto,'/assets/index-abc.js');
  assert.equal(plano.headers['content-encoding'],undefined); assert.equal(plano.cuerpo.toString(),js);
  for(const r of [gz,plano]) { assert.match(r.headers['cache-control'],/max-age=31536000.*immutable/); assert.match(r.headers.vary,/Accept-Encoding/i); }
  const parcial=await crudo(s.puerto,'/assets/index-abc.js',{'Accept-Encoding':'gzip',Range:'bytes=0-6'});
  assert.equal(parcial.status,206); assert.equal(parcial.cuerpo.toString(),'console');
  assert.equal((await crudo(s.puerto,'/assets/index-abc.js',{'Accept-Encoding':'gzip','If-None-Match':gz.headers.etag})).status,304);
  for(const r of ['/','/index.html','/mercado/mapa']) { const x=await crudo(s.puerto,r); assert.equal(x.status,200); assert.equal(x.headers['cache-control'],'no-cache',r); }
  assert.match((await crudo(s.puerto,'/robots.txt')).headers['cache-control'],/max-age=3600/);
  for(const r of ['/assets/no-existe.js','/assets/..%2f..%2fpackage.json','/assets/%E0%A4%A']) { const x=await crudo(s.puerto,r,{'Accept-Encoding':'gzip'}); assert.ok([400,403,404].includes(x.status),r+' '+x.status); assert.doesNotMatch(x.headers['cache-control']||'',/immutable/); }
});
test('PWA: sw.js siempre revalidado y manifest con su tipo; la CSP no cambia',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'web-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'index.html'),'<!doctype html><title>x</title>');
  fs.writeFileSync(path.join(dir,'sw.js'),'self.addEventListener("fetch",()=>{});');
  fs.writeFileSync(path.join(dir,'manifest.webmanifest'),'{"name":"WinOpciones"}');
  const s=await levantar(t,{webDir:dir});
  const sw=await crudo(s.puerto,'/sw.js');
  assert.equal(sw.status,200); assert.equal(sw.headers['cache-control'],'no-cache'); assert.match(sw.headers['content-type'],/javascript/);
  assert.equal(sw.cuerpo.toString(),'self.addEventListener("fetch",()=>{});','no es el index.html de respaldo');
  const m=await crudo(s.puerto,'/manifest.webmanifest');
  assert.equal(m.status,200); assert.match(m.headers['content-type'],/^application\/manifest\+json/);
  assert.match(m.headers['content-security-policy'],/default-src 'self'.*script-src 'self'/);
});
test('JSON: gzip solo si el cliente lo acepta y supera 1 KB; conserva ETag de revisión',async t=>{
  const s=await levantar(t), Authorization=await s.token();
  const spec=await crudo(s.puerto,API+'/openapi.json',{'Accept-Encoding':'gzip'});
  assert.equal(spec.headers['content-encoding'],'gzip'); assert.ok(JSON.parse(gunzipSync(spec.cuerpo)).paths);
  assert.match(spec.headers['content-type'],/application\/json; charset=utf-8/);
  const plano=await crudo(s.puerto,API+'/openapi.json');
  assert.equal(plano.headers['content-encoding'],undefined); assert.ok(JSON.parse(plano.cuerpo).paths); assert.match(plano.headers.vary,/Accept-Encoding/);
  assert.equal((await crudo(s.puerto,API+'/openapi.json',{'Accept-Encoding':'gzip;q=0'})).headers['content-encoding'],undefined);
  assert.equal((await crudo(s.puerto,'/health',{'Accept-Encoding':'gzip'})).headers['content-encoding'],undefined);
  const e=(await (await s.pedir('POST','/estrategias',{codigo:'LONG_CALL',nombre:'ñandú',descripcion:'é'.repeat(1500)},{Authorization})).json()).data;
  const r=await crudo(s.puerto,API+'/estrategias/'+e._id,{Authorization,'Accept-Encoding':'gzip'});
  assert.equal(r.headers['content-encoding'],'gzip'); assert.equal(r.headers.etag,'"1"');
  assert.equal(JSON.parse(gunzipSync(r.cuerpo)).data.nombre,'ñandú');
});

const respuesta=(texto,status=200)=>({ok:status<300,status,headers:new Headers(),text:texto});
test('Cliente HTTP: el límite cubre el cuerpo y sus fallos son RED',async()=>{
  const nuevo=(text,o)=>createHttp({proveedor:'x',timeoutMs:15,esperar:async()=>{},fetch:async()=>respuesta(text),...o});
  const red=e=>e.name==='IntegrationError'&&e.codigo==='RED';
  const colgado=()=>new Promise(()=>{});
  await assert.rejects(nuevo(colgado).request({url:'http://x'}),e=>red(e)&&/agotado/.test(e.mensaje));
  await assert.rejects(nuevo(async()=>{throw new TypeError('terminated');}).request({url:'http://x'}),e=>red(e)&&!/terminated/.test(e.mensaje));
  const lento=()=>new Promise(r=>setTimeout(r,90,'<xml/>'));
  await assert.rejects(nuevo(lento).request({url:'http://x',respuesta:'text',timeoutCuerpoMs:20}),red);
  assert.equal(await nuevo(lento,{timeoutMs:200}).request({url:'http://x',respuesta:'text'}),'<xml/>','el texto dispone de más tiempo');
  assert.equal(await nuevo(lento).request({url:'http://x',respuesta:'text',timeoutMs:500}),'<xml/>','límite por solicitud');
  // La señal de aborto llega al fetch para liberar la conexión.
  let senal; await assert.rejects(createHttp({proveedor:'x',timeoutMs:10,fetch:async(_u,o)=>{senal=o.signal;return respuesta(colgado);}}).request({url:'http://x'}),red);
  assert.equal(senal.aborted,true);
  // Error del proveedor con cuerpo ilegible: conserva su código.
  const caido=createHttp({proveedor:'x',timeoutMs:10,fetch:async()=>respuesta(async()=>{throw new Error('x');},404)});
  await assert.rejects(caido.request({url:'http://x'}),e=>e.codigo==='NO_ENCONTRADO');
  assert.equal(await createHttp({proveedor:'x',fetch:async()=>respuesta(async()=>'',204)}).request({url:'http://x'}),null);
});

test('CSP: solo se permite el marco de TradingView y ningún script ajeno',()=>{
  const {cabecerasSeguridad}=require('../dist/middlewares/cabeceras.handler');
  let h; cabecerasSeguridad({secure:false},{set:x=>{h=x;}},()=>{});
  const csp=Object.fromEntries(h['Content-Security-Policy'].split('; ').map(d=>[d.split(' ')[0],d.split(' ').slice(1).join(' ')]));
  assert.equal(csp['script-src'],"'self'"); assert.equal(csp['connect-src'],"'self'"); assert.equal(csp['frame-ancestors'],"'none'");
  assert.ok(csp['frame-src'].split(' ').every(x=>/^https:\/\/(www\.tradingview-widget|s\.tradingview)\.com$/.test(x)));
});
