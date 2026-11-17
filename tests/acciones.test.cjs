// Flujo funcional completo por HTTP con repositorio en memoria y proveedores simulados (sin red).
const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {randomUUID,scryptSync}=require('node:crypto');
const {memoryFactory}=require('./helpers/memory.cjs');
const {createSessionService}=require('../dist/api/v1/services/sesiones.service');
const {createApp}=require('../dist/app');
const {createCola}=require('../dist/jobs/cola');
const prefix=require('../dist/config/config').default.API_URL;

const DIA=86400000, BASE=Date.UTC(2025,0,2);
function velas(n=260){ // tendencia alcista determinista con oscilación
  return Array.from({length:n},(_,i)=>{const c=100+i*0.5+Math.sin(i/3)*2;return{fecha:new Date(BASE+i*DIA).toISOString(),apertura:c-0.5,maximo:c+1.5,minimo:c-1.5,cierre:c,volumen:1e6+i*1000};});
}
function errorProveedor(codigo){const e=new Error('x');e.name='IntegrationError';e.proveedor='alpaca';e.codigo=codigo;e.mensaje='Faltan credenciales de Alpaca.';return e;}
function fakeIntegraciones(){
  const venc=new Date(Date.now()+30*DIA).toISOString().slice(0,10);
  const occ='TEST'+venc.slice(2).replace(/-/g,'')+'C00120000';
  const enviadas=[];
  return {enviadas,occ,
    estado:()=>({alpaca:{configurado:true,feed:'iex'},sec:{configurado:true},webull:{configurado:false}}),
    alpaca:{feed:'iex',
      buscarActivo:async s=>({simbolo:s,nombre:'Test Corp',mercado:'NASDAQ',activo:true}),
      velas:async()=>velas(),
      cotizacion:async s=>{if(s==='NOKEY') throw errorProveedor('SIN_CREDENCIALES');return{bid:229,ask:229.2,ultimo:229.1,fechaDato:new Date().toISOString(),feed:'iex'};},
      contratos:async()=>[{contratoExternoId:occ,simbolo:occ,tipo:'call',strike:120,vencimiento:venc,multiplicador:100}],
      snapshotsOpciones:async()=>[{contratoExternoId:occ,bid:2.4,ask:2.6,ultimo:2.5,volatilidadImplicita:0.3,griegas:{delta:0.55,gamma:0.03,theta:-0.05,vega:0.12,rho:0.02},fechaDato:new Date().toISOString()}],
      noticias:async()=>[{noticiaExternaId:'1',titulo:'Test Corp beats estimates, record growth and strong upgrade',resumen:'Profit surges',url:'https://example.com/1',publicadaEn:new Date().toISOString(),simbolos:['TEST'],proveedor:'alpaca'},
                         {noticiaExternaId:'2',titulo:'Test Corp faces lawsuit',url:'https://example.com/2',publicadaEn:new Date(Date.now()-2*DIA).toISOString(),simbolos:['TEST'],proveedor:'alpaca'}],
      cuenta:async()=>({cuentaExternaId:'PA123',estatus:'ACTIVE'}),
      enviarOrden:async o=>{enviadas.push(o);return{ordenExternaId:'ext-1',estado:'aceptada',estadoProveedor:'accepted'};},
      consultarOrden:async()=>({ordenExternaId:'ext-1',estado:'cancelada',estadoProveedor:'canceled'}),
      cancelarOrden:async()=>undefined,
      posiciones:async()=>[{posicionExternaId:occ,simbolo:occ,lado:'long',cantidad:1,precioPromedio:2.5},{posicionExternaId:'AAPL',simbolo:'AAPL',lado:'long',cantidad:5,precioPromedio:200}],
    },
    filers13F:[{cik:'1',nombre:'Fondo A'}],
    sec:{
      cikDeSimbolo:async s=>({cik:'0000000001',nombre:'Test Corp',simbolo:s}),
      fundamentales:async()=>[2023,2024].map(y=>({periodoInicio:y+'-01-01',periodoFin:y+'-12-31',forma:'10-K',fuente:{proveedor:'sec',fechaDato:(y+1)+'-02-15',referencia:'acc-'+y},
        metricas:[['ingresos',y===2024?120e9:100e9],['utilidad_neta',y===2024?24e9:18e9],['activos',300e9],['pasivos',150e9],['capital',150e9],['activo_circulante',80e9],['pasivo_circulante',50e9],['flujo_operativo',30e9],['eps_diluido',y===2024?6:5]].map(([nombre,valor])=>({nombre,valor,unidad:nombre==='eps_diluido'?'USD/accion':'USD',periodo:'FY'+y}))})),
      tenencias13F:async({filers})=>{assert.equal(filers.length,1);return ['2025-06-30','2025-09-30'].map((c,i)=>({fechaCorte:c,fechaPublicacion:i?'2025-11-14':'2025-08-14',fuente:{proveedor:'sec',fechaDato:i?'2025-11-14':'2025-08-14'},
        tenencias:[{institucion:'Fondo A',identificadorInstitucion:'1',acciones:1000+i*200,valorReportado:1e5,unidad:'USD'},{institucion:'Fondo B',identificadorInstitucion:'2',acciones:500+i*50,valorReportado:5e4,unidad:'USD'}]}));},
    },
  };
}

test('Flujo funcional: sincronizar → cores → confluencia → selección → configuración → orden paper',async()=>{
  const factory=memoryFactory(), cola=createCola(), integraciones=fakeIntegraciones();
  const userId=randomUUID(), password='Test-'+randomUUID(), salt=randomUUID();
  const user={id:userId,email:'t@example.com',salt,passwordHash:scryptSync(password,salt,64).toString('hex')};
  const app=createApp({factory,auth:createSessionService(factory,async()=>[user]),integraciones,cola,quiet:true,webDir:null});
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port+prefix;
  let token;
  const call=async(method,path,body,status=200,headers={})=>{
    const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const j=await r.json(); assert.equal(r.status,status,method+' '+path+' → '+JSON.stringify(j)); return j.data;
  };
  const job=async(path,listPath)=>{await cola.vaciar();return call('GET',listPath+'/'+path);};
  try{
    token=(await call('POST','/sesiones',{email:user.email,password,baseDatos:'mongodb'})).token;
    assert.equal((await call('GET','/integraciones/estado')).alpaca.configurado,true);

    // Sincronización
    await call('POST','/sincronizaciones/ejecuciones',{recurso:'nada',simbolos:['TEST']},400);
    await call('POST','/sincronizaciones/ejecuciones',{recurso:'historicos',simbolos:['bad symbol!']},400);
    for(const recurso of ['empresas','historicos','noticias','fundamentales','institucional','contratos','cotizaciones']){
      const s=await call('POST','/sincronizaciones/ejecuciones',{recurso,simbolos:['TEST']},202);
      assert.equal(s.estado,'pendiente');
      const fin=await job(s._id,'/sincronizaciones');
      assert.equal(fin.estado,'completada',recurso+': '+fin.error);
      assert.ok(fin.procesados>0,recurso);
    }
    // Repetir no duplica (upsert determinista)
    await call('POST','/sincronizaciones/ejecuciones',{recurso:'historicos',simbolos:['TEST']},202); await cola.vaciar();
    const hist=await call('GET','/mercado/historicos/TEST?limit=1000');
    assert.equal(hist.total,260);
    assert.ok(new Date(hist.items[0].fuente.fechaDato)<new Date(hist.items[259].fuente.fechaDato));
    const empresa=(await call('GET','/empresas')).items[0];
    assert.equal(empresa.cik,'0000000001');

    // Cores
    const evals={};
    for(const core of ['tecnico','indicadores','fundamental','institucional','noticias']){
      const e=await call('POST','/cores/'+core+'/evaluaciones',{empresaId:empresa._id},202);
      const fin=await job(e._id,'/cores/'+core+'/evaluaciones');
      assert.equal(fin.estado,'completada',core+': '+fin.error);
      assert.ok(fin.versionAlgoritmo.startsWith(core+'@'));
      assert.ok(fin.metricas.length>0,core);
      assert.ok(fin.fuentes.length>0,core+' fuentes');
      evals[core]=fin;
    }
    assert.ok(evals.tecnico.puntaje>50,'tendencia alcista → técnico > 50');
    await call('POST','/cores/magia/evaluaciones',{empresaId:empresa._id},404);

    // Confluencia
    const catalogo=await call('POST','/estrategias/catalogo-base');
    assert.equal(catalogo.length,3);
    const call_=catalogo.find(e=>e.codigo==='LONG_CALL');
    const cf=await call('POST','/confluencias/ejecuciones',{empresaId:empresa._id,estrategiaId:call_._id,evaluacionesIds:Object.values(evals).map(e=>e._id),coresSeleccionados:Object.keys(evals)},202);
    const cfin=await job(cf._id,'/confluencias');
    assert.equal(cfin.estado,'completada',cfin.error);
    assert.ok(cfin.puntaje>=0&&cfin.puntaje<=100);

    // Selección modo empresa → 3 estrategias ordenadas
    const sel=await call('POST','/selecciones/ejecuciones',{modo:'empresa',empresaId:empresa._id,coresSeleccionados:['tecnico','indicadores','noticias']},202);
    const sfin=await job(sel._id,'/selecciones');
    assert.equal(sfin.estado,'completada',sfin.error);
    assert.equal(sfin.resultados.length,3);
    assert.ok(sfin.resultados[0].puntaje>=sfin.resultados[2].puntaje);
    const sel2=await call('POST','/selecciones/ejecuciones',{modo:'estrategia',estrategiaId:call_._id,coresSeleccionados:['tecnico']},202);
    assert.equal((await job(sel2._id,'/selecciones')).resultados.length,1);

    // Configuración con contrato sincronizado + evaluación de payoff
    const contrato=(await call('GET','/contratos')).items[0];
    assert.equal(contrato.contratoExternoId,integraciones.occ);
    const conf=await call('POST','/configuraciones',{nombre:'LC',empresaId:empresa._id,estrategiaId:call_._id,componentes:[{contratoId:contrato._id,accion:'buy',cantidad:1}]},201);
    const ce=await call('POST','/configuraciones/'+conf._id+'/evaluaciones',{},202);
    const cefin=await job(ce._id,'/evaluaciones');
    assert.equal(cefin.estado,'completada',cefin.error);
    assert.equal(cefin.core,'configuracion');
    assert.ok(cefin.metricas.some(m=>m.nombre==='perdida_maxima'),JSON.stringify(cefin.metricas));
    assert.equal(cefin.cobertura,1);

    // Broker paper
    const broker=await call('POST','/brokers',{codigo:'alpaca',nombre:'Alpaca',activo:true,entornos:['paper']},201);
    const conexion=await call('POST','/conexiones-broker',{brokerId:broker._id,alias:'Paper',entorno:'paper',credencialRef:'env:ALPACA'},201);
    assert.equal(conexion.credencialRef,undefined,'credencialRef nunca se devuelve');
    const v=await call('POST','/conexiones-broker/'+conexion._id+'/verificacion');
    assert.equal(v.conexion.estado,'activa');
    const key=randomUUID();
    const orden=await call('POST','/ordenes',{conexionId:conexion._id,configuracionId:conf._id,idempotencyKey:key,tipo:'limit',vigencia:'day',cantidad:1,precioLimite:2.5,
      componentes:[{contratoId:contrato._id,simbolo:contrato.simbolo,accion:'buy',intencion:'buy_to_open',proporcion:1}]},201);
    await call('POST','/ordenes/'+orden._id+'/envio',undefined,400);
    await call('POST','/ordenes/'+orden._id+'/envio',undefined,409,{'Idempotency-Key':randomUUID()});
    const enviada=await call('POST','/ordenes/'+orden._id+'/envio',undefined,200,{'Idempotency-Key':key});
    assert.equal(enviada.estado,'aceptada'); assert.equal(enviada.ordenExternaId,'ext-1');
    await call('POST','/ordenes/'+orden._id+'/envio',undefined,200,{'Idempotency-Key':key});
    assert.equal(integraciones.enviadas.length,1,'reintento idempotente no reenvía');
    assert.equal(integraciones.enviadas[0].clientOrderId,key);
    assert.equal(integraciones.enviadas[0].componentes[0].simbolo,integraciones.occ);
    assert.equal((await call('POST','/ordenes/'+orden._id+'/cancelacion')).estado,'cancelada');

    // live bloqueado
    const live=await call('POST','/conexiones-broker',{brokerId:broker._id,alias:'Live',entorno:'live'},201);
    await call('POST','/conexiones-broker/'+live._id+'/verificacion',undefined,403);

    // Posiciones: la de opciones se guarda, la de acciones sin contrato cuenta como fallida
    const sp=await call('POST','/sincronizaciones/ejecuciones',{recurso:'posiciones',conexionId:conexion._id},202);
    const spf=await job(sp._id,'/sincronizaciones');
    assert.equal(spf.procesados,1); assert.equal(spf.fallidos,1);

    // Errores del proveedor → HTTP
    await call('GET','/mercado/cotizaciones/NOKEY/en-vivo',undefined,503);
    assert.equal((await call('GET','/mercado/opciones/cadena/TEST')).items[0].griegas.delta,0.55);
  } finally { server.close(); }
});
