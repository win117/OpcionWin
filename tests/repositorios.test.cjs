// Consultas que llegan a MongoDB y Supabase (sin red), índices, retención y listados sin cargar tablas completas.
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {memoryFactory}=require('./helpers/memory.cjs');
const {mongoRepository}=require('../dist/repositories/mongodb/repository');
const {indicesDe,asegurarIndices}=require('../dist/repositories/mongodb/indices');
const {supabaseRepository,fetchTotal}=require('../dist/repositories/supabase/repository');
const {createSupabaseTransport}=require('../dist/config/supabase.config');
const {resources,rutasReferencia,condiciones}=require('../dist/repositories/resources');
const {createRetencion,RETENCION}=require('../dist/repositories/retencion');
const {createCrudService}=require('../dist/api/v1/services/crud.service');
const {crear}=require('../dist/api/v1/services/registros');
const {createAnalisis}=require('../dist/api/v1/services/analisis.service');
const ctx={database:'mongodb',userId:randomUUID()};
const DIA=86400000;

// Colección de MongoDB simulada: guarda cada llamada y devuelve `salida`.
function coleccion(salida={}) {
  const llamadas=[];
  const c={llamadas,
    find(q){const paso={op:'find',q};llamadas.push(paso);const cur={sort:s=>(paso.sort=s,cur),skip:s=>(paso.skip=s,cur),limit:l=>(paso.limit=l,cur),toArray:async()=>salida.find||[]};return cur;},
    findOne:async(q,o)=>{llamadas.push({op:'findOne',q,o});return salida.findOne??null;},
    countDocuments:async q=>{llamadas.push({op:'count',q});return salida.count??0;},
    deleteMany:async q=>{llamadas.push({op:'deleteMany',q});},
    deleteOne:async q=>{llamadas.push({op:'deleteOne',q});return {deletedCount:1};},
    createIndex:async()=>{}};
  return c;
}
const mongo=(name,c)=>mongoRepository(name,'dueño',async()=>({db:{collection:()=>c}}));

test('MongoDB: filtro tipado, búsqueda escapada, orden, conteo y alcance de dueño',async()=>{
  const c=coleccion({count:7}), repo=mongo('empresas',c);
  await repo.list({offset:50,limit:25,filtro:{activo:'true',simbolo:'A$B'},busqueda:'a.b*',orden:'recientes'});
  assert.equal(await repo.count({filtro:{activo:'true'}}),7);
  const [lista,conteo]=c.llamadas;
  assert.deepEqual(lista.q,{owner_id:'dueño','document.activo':{$eq:true},'document.simbolo':{$eq:'A$B'},
    $or:['nombre','simbolo','titulo','descripcion'].map(k=>({['document.'+k]:{$regex:'a\\.b\\*',$options:'i'}}))});
  assert.deepEqual(lista.sort,{'document.createdAt':-1,_id:1});
  assert.deepEqual([lista.skip,lista.limit],[50,25]);
  assert.deepEqual(conteo.q,{owner_id:'dueño','document.activo':{$eq:true}});
  // Un valor que no puede coincidir con el tipo no llega a la base.
  assert.deepEqual(await repo.list({filtro:{activo:'quizá'}}),[]);
  assert.equal(await repo.count({filtro:{activo:'quizá'}}),0);
  assert.equal(c.llamadas.length,2);
  await assert.rejects(repo.list({filtro:{'a.b':'x'}}),e=>e.output.statusCode===400);
  await assert.rejects(repo.list({filtro:{simbolo:{$ne:null}}}),e=>e.output.statusCode===400);
});
test('MongoDB: identificadores solo de texto (sin operadores) en get, replace, remove y referenciado',async()=>{
  const c=coleccion(), repo=mongo('empresas',c), malo={$ne:null}, es400=e=>e.output.statusCode===400;
  await assert.rejects(repo.get(malo),es400);
  await assert.rejects(repo.replace(malo,{},1),es400);
  await assert.rejects(repo.remove(malo,1),es400);
  await assert.rejects(repo.referenciado([[{campo:'empresaId'}]],malo),es400);
  assert.equal(c.llamadas.length,0);
});
test('MongoDB: referencias y purga consultan lo mínimo',async()=>{
  const c=coleccion({findOne:{_id:'1'}});
  assert.equal(await mongo('configuraciones',c).referenciado(rutasReferencia('configuraciones','contratos'),'c1','yo'),true);
  assert.deepEqual(c.llamadas[0].q,{owner_id:'dueño',_id:{$ne:'yo'},$or:[{'document.componentes.contratoId':'c1'}]});
  const antesDe=new Date();
  await mongo('datos-mercado',c).purgar({antesDe,filtro:{tipo:'cotizacion'}});
  assert.deepEqual(c.llamadas[1].q,{owner_id:'dueño','document.createdAt':{$lt:antesDe},'document.tipo':'cotizacion'});
  for(const [n,f] of [['ordenes'],['posiciones'],['evaluaciones'],['datos-mercado'],['datos-mercado',{tipo:'vela'}]]) await assert.rejects(mongo(n,c).purgar({antesDe,filtro:f}));
  assert.equal(c.llamadas.length,2);
});
test('Filtros tipados por esquema: número, fecha, arreglo y subdocumento',()=>{
  assert.deepEqual(condiciones('contratos',{strike:'100.5'}),[['strike',100.5]]);
  assert.equal(condiciones('contratos',{strike:'100x'}),null);
  assert.deepEqual(condiciones('noticias',{simbolos:'AAPL,MSFT'}),[['simbolos',['AAPL','MSFT']]]);
  assert.deepEqual(condiciones('noticias',{publicadaEn:'2026-01-01'}),[['publicadaEn',new Date('2026-01-01')]]);
  assert.equal(condiciones('datos-mercado',{fuente:'x'}),null);
  assert.equal(condiciones('empresas',{simbolo:'a\0b'}),null);
});
test('Rutas de referencia: mismas dependencias que revisaba el borrado completo',()=>{
  const de=destino=>Object.keys(resources).flatMap(n=>rutasReferencia(n,destino).map(r=>n+':'+r.map(s=>s.campo+(s.arreglo?'[]':'')).join('.'))).sort();
  assert.deepEqual(de('empresas'),['configuraciones:empresaId','confluencias:empresaId','contratos:empresaId','datos-mercado:empresaId','evaluaciones:empresaId',
    'fundamentales:empresaId','institucional:empresaId','selecciones:empresaId','selecciones:empresasCandidatas[]','selecciones:resultados[].empresaId'].sort());
  assert.deepEqual(de('contratos'),['configuraciones:componentes[].contratoId','datos-mercado:contratoId','ordenes:componentes[].contratoId','posiciones:contratoId'].sort());
  assert.deepEqual(de('evaluaciones'),['confluencias:evaluacionesIds[]']);
  assert.deepEqual(de('auditoria'),[]);
});

// Transporte real de Supabase con fetch simulado: comprueba la URL codificada que saldría por la red.
function supabase(name,{filas=[],contentRange='0-0/42'}={}) {
  const pedidos=[], ajustes={SUPABASE_URL:'https://x.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_x'};
  const fetcher=async(url,o)=>{pedidos.push({url,params:url.searchParams,...o});return new Response(JSON.stringify(filas),{status:200,headers:{'content-range':contentRange}});};
  const repo=supabaseRepository(name,'dueño',createSupabaseTransport(ajustes,fetcher),createSupabaseTransport(ajustes,async(url,o)=>{
    const original=globalThis.fetch; globalThis.fetch=fetcher;
    try { return await fetchTotal(url,o); } finally { globalThis.fetch=original; }
  }));
  return {repo,pedidos};
}
test('Supabase: filtros jsonb, orden, conteo por Content-Range y valores hostiles codificados',async()=>{
  const {repo,pedidos}=supabase('empresas');
  const hostil='A&owner_id=eq.otro,or=(x.eq.1)"\\';
  await repo.list({offset:100,limit:50,filtro:{simbolo:hostil,activo:'true'},busqueda:'a,b)"\\.*',orden:'recientes'});
  const p=pedidos[0].params;
  assert.deepEqual(p.getAll('owner_id'),['eq.dueño']);
  assert.equal(p.get('document->>simbolo'),'eq.'+hostil);
  assert.equal(p.get('document->>activo'),'eq.true');
  assert.equal(p.get('order'),'document->>createdAt.desc.nullslast,id.asc');
  assert.equal(p.get('offset')+'/'+p.get('limit'),'100/50');
  // Expresión regular escapada y, encima, comillas y barras escapadas para or=(...).
  const patron='"'+'a,b\\)"\\\\\\.\\*'.replace(/[\\"]/g,'\\$&')+'"';
  assert.equal(p.get('or'),'('+['nombre','simbolo','titulo','descripcion'].map(k=>'document->>'+k+'.imatch.'+patron).join(',')+')');
  assert.equal(await repo.count({filtro:{activo:'true'}}),42);
  assert.equal(pedidos[1].headers.Prefer,'count=exact');
  assert.equal(pedidos[1].params.get('limit'),'1');
  assert.equal(await repo.count({filtro:{activo:'quizá'}}),0);
  assert.equal(pedidos.length,2);
  const n=supabase('noticias');
  await n.repo.list({filtro:{simbolos:'AAPL,MSFT',publicadaEn:'2026-01-01'}});
  assert.equal(n.pedidos[0].params.get('document->>simbolos'),'eq.["AAPL", "MSFT"]');
  assert.equal(n.pedidos[0].params.get('document->>publicadaEn'),'eq.2026-01-01T00:00:00.000Z');
  await assert.rejects(supabase('empresas',{contentRange:'*/*'}).repo.count(),e=>e.output.statusCode===503);
});
test('Supabase: referencias por contención jsonb y purga acotada',async()=>{
  const {repo,pedidos}=supabase('selecciones',{filas:[{id:'1'}]});
  const id='x","y';
  assert.equal(await repo.referenciado(rutasReferencia('selecciones','empresas'),id,'yo'),true);
  const p=pedidos[0].params, citar=o=>'"'+JSON.stringify(o).replace(/[\\"]/g,'\\$&')+'"';
  assert.equal(p.get('or'),'('+[{empresaId:id},{resultados:[{empresaId:id}]},{empresasCandidatas:[id]}].map(o=>'document.cs.'+citar(o)).join(',')+')');
  assert.equal(p.get('owner_id'),'eq.dueño'); assert.equal(p.get('id'),'neq.yo'); assert.equal(p.get('limit'),'1');
  assert.equal(await supabase('selecciones').repo.referenciado(rutasReferencia('selecciones','empresas'),'z'),false);
  const a=supabase('auditoria'), antesDe=new Date('2026-01-01');
  await a.repo.purgar({antesDe});
  assert.equal(a.pedidos[0].method,'DELETE');
  assert.equal(a.pedidos[0].params.get('owner_id'),'eq.dueño');
  assert.equal(a.pedidos[0].params.get('document->>createdAt'),'lt.2026-01-01T00:00:00.000Z');
  await assert.rejects(supabase('ordenes').repo.purgar({antesDe}));
  await assert.rejects(repo.get({$ne:null}),e=>e.output.statusCode===400);
});

test('CRUD: más de 10 000 registros se listan, filtran y no impiden borrar',async()=>{
  const f=memoryFactory(), c=createCrudService('empresas',f);
  const e=await c.create(ctx,{simbolo:'UNO',nombre:'Con datos',mercado:'T'}), libre=await c.create(ctx,{simbolo:'DOS',nombre:'Libre',mercado:'T'});
  const base=Date.UTC(2026,0,1), datos=f('datos-mercado',ctx);
  await datos.upsertMany(Array.from({length:10050},(_,i)=>({_id:'d'+i,empresaId:e._id,tipo:i%2?'vela':'cotizacion',createdAt:new Date(base+i*1000)})));
  let pedidas=0;
  const contando=(n,x)=>{const r=f(n,x);return {...r,list:async o=>{const filas=await r.list(o);pedidas+=filas.length;return filas;}};};
  const pagina=await createCrudService('datos-mercado',contando).list(ctx,{page:'3',limit:'100',tipo:'vela'});
  assert.equal(pagina.total,5025); assert.equal(pagina.items.length,100); assert.equal(pedidas,100,'solo se trae la página');
  assert.equal(pagina.items[0]._id,'d'+(10049-400),'más recientes primero');
  const fuera=await createCrudService('datos-mercado',f).list(ctx,{page:String(Number.MAX_SAFE_INTEGER),limit:'100'});
  assert.deepEqual([fuera.items.length,fuera.total],[0,10050]);
  await assert.rejects(c.remove(ctx,e._id),x=>x.output.statusCode===409);
  assert.equal((await createCrudService('empresas',contando).remove(ctx,libre._id)).eliminado,true);
  assert.equal(pedidas,100,'borrar no lista tablas');
  assert.equal((await c.list(ctx,{search:'con DAT'})).total,1);
  assert.equal((await c.list(ctx,{search:'.*'})).total,0);
  assert.equal((await c.list(ctx,{activo:'true'})).total,1);
  await assert.rejects(c.list(ctx,{search:'x'.repeat(201)}),x=>x.output.statusCode===400);
  await assert.rejects(c.list(ctx,{tokenHash:'x'}),x=>x.output.statusCode===400);
});
test('CRUD: identificadores que no son texto se rechazan antes de la base',async()=>{
  const f=()=>{throw new Error('no debe llegar al repositorio');};
  const roto=()=>new Proxy({},{get:()=>f});
  const c=createCrudService('empresas',roto);
  for(const id of [{$ne:null},['a'],1,null,'']) {
    await assert.rejects(c.get(ctx,id),e=>e.output?.statusCode===400);
    await assert.rejects(c.remove(ctx,id),e=>e.output?.statusCode===400);
    await assert.rejects(c.update(ctx,id,{}),e=>e.output?.statusCode===400);
  }
});

test('Índices MongoDB: mismas definiciones que el script, una vez por colección y sin fallar',async()=>{
  assert.deepEqual(indicesDe('estrategias'),[[{owner_id:1,_id:1},{}],[{owner_id:1,'document.codigo':1},{unique:true}]]);
  assert.deepEqual(indicesDe('sesiones').at(-1),[{'document.expiraEn':1},{expireAfterSeconds:0}]);
  const creados=[], registro=new Map(), c={createIndex:async k=>{creados.push(k);}};
  await asegurarIndices(c,'estrategias',{ahora:0,registro});
  await asegurarIndices(c,'estrategias',{ahora:1e12,registro});
  assert.equal(creados.length,2);
  const avisos=[], warn=console.warn; console.warn=m=>avisos.push(m);
  try {
    const malo={createIndex:async()=>{throw Object.assign(new Error('E11000 valor privado'),{codeName:'DuplicateKey'});}};
    await asegurarIndices(malo,'empresas',{ahora:0,registro});
    assert.equal(avisos.length,2); assert.ok(avisos.every(a=>a.includes('DuplicateKey')&&!a.includes('privado')));
    await asegurarIndices(malo,'empresas',{ahora:1000,registro}); assert.equal(avisos.length,2,'no insiste en cada acceso');
    await asegurarIndices(malo,'empresas',{ahora:11*60000,registro}); assert.equal(avisos.length,4);
    // El repositorio responde aunque la creación del índice nunca termine.
    const lenta={...coleccion({find:[]}),createIndex:()=>new Promise(()=>{})};
    assert.deepEqual(await mongo('brokers',lenta).list(),[]);
  } finally { console.warn=warn; }
});

test('Retención: 90 días o los últimos N de auditoría, sincronizaciones y cotizaciones; nada más',async()=>{
  assert.deepEqual(RETENCION.map(r=>r.name+(r.filtro?':'+r.filtro.tipo:'')),['auditoria','sincronizaciones','datos-mercado:cotizacion']);
  const f=memoryFactory(), t=Date.now();
  const sembrar=async(name,extra,edades)=>f(name,ctx).upsertMany(edades.map(d=>({_id:randomUUID(),...extra,createdAt:new Date(t-d*DIA)})));
  await sembrar('auditoria',{},[0,1,2,3,100]);
  await sembrar('sincronizaciones',{},[1,91]);
  await sembrar('datos-mercado',{tipo:'cotizacion'},[1,200]);
  await sembrar('datos-mercado',{tipo:'vela'},[200]);
  await sembrar('datos-mercado',{tipo:'snapshot_opcion'},[200]);
  for(const n of ['ordenes','posiciones','evaluaciones','confluencias','selecciones']) await sembrar(n,n==='ordenes'?{idempotencyKey:n}:{},[400]);
  let llamadas=0; let ahora=t;
  const aplicar=createRetencion({factory:(n,c)=>{llamadas++;return f(n,c);},ahora:()=>ahora,reglas:RETENCION.map(r=>r.name==='auditoria'?{...r,max:3}:r)});
  await aplicar(ctx);
  const n=async(name,filtro)=>f(name,ctx).count({filtro});
  assert.equal(await n('auditoria'),3); assert.equal(await n('sincronizaciones'),1);
  assert.equal(await n('datos-mercado',{tipo:'cotizacion'}),1);
  assert.equal(await n('datos-mercado',{tipo:'vela'}),1); assert.equal(await n('datos-mercado',{tipo:'snapshot_opcion'}),1);
  for(const x of ['ordenes','posiciones','evaluaciones','confluencias','selecciones']) assert.equal(await n(x),1,x);
  const antes=llamadas; await aplicar(ctx); assert.equal(llamadas,antes,'una vez al día');
  ahora+=DIA; await aplicar(ctx); assert.ok(llamadas>antes);
  await createRetencion({factory:()=>{throw new Error('caída');}})(ctx); // nunca lanza
});

test('asegurarEstrategias: llamadas simultáneas no duplican ni fallan, y respeta ids aleatorios previos',async()=>{
  const f=memoryFactory(), analisis=createAnalisis({cola:{},factory:f});
  const previa=await crear('estrategias',ctx,{codigo:'LONG_PUT',nombre:'Mía',descripcion:'Previa'},f);
  const mapas=await Promise.all(Array.from({length:5},()=>analisis.asegurarEstrategias(ctx)));
  assert.equal(await f('estrategias',ctx).count(),3);
  for(const m of mapas) { assert.equal(m.size,3); assert.equal(m.get('LONG_PUT')._id,previa._id); assert.equal(m.get('LONG_CALL')._id,mapas[0].get('LONG_CALL')._id); }
  // Carrera con un registro de id aleatorio creado entre la lectura y la escritura.
  const g=memoryFactory(); let primera=true, ajena;
  const carrera=(n,c)=>{const r=g(n,c);return n!=='estrategias'?r:{...r,list:async o=>{
    const filas=await r.list(o);
    if(primera){primera=false;ajena=await crear('estrategias',c,{codigo:'LONG_CALL',nombre:'Otra',descripcion:'Simultánea'},g);}
    return filas;
  }};};
  const m=await createAnalisis({cola:{},factory:carrera}).asegurarEstrategias(ctx);
  assert.equal(m.get('LONG_CALL')._id,ajena._id); assert.equal(await g('estrategias',ctx).count(),3);
});
