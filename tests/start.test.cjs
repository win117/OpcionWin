const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {createServer}=require('node:net');
const {once}=require('node:events');
test('Index inicia servidor compilado y responde health', {timeout:15000}, async()=>{
 const probe=createServer().listen(0,'127.0.0.1');
 await once(probe,'listening');const port=probe.address().port;
 await new Promise(resolve=>probe.close(resolve));
 const child=spawn(process.execPath,['dist/index.js'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 let output='';
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Index no anunció el arranque')),10000);
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.once('exit',code=>{clearTimeout(timer);reject(new Error('Index salió antes de arrancar: '+code));});
   child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('API disponible')){clearTimeout(timer);resolve();}});
  });
  const response=await fetch('http://127.0.0.1:'+port+'/health');
  assert.equal(response.status,200);
  assert.equal((await response.json()).status,'ok');
 }finally{
  if(child.exitCode===null){const closed=once(child,'exit');child.kill();await closed;}
 }
});
