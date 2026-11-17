const test=require('node:test');
const {memoryFactory}=require('./helpers/memory.cjs');
const {exercise}=require('./helpers/http-flow.cjs');
for(const database of ['mongodb','supabase']){
 test('HTTP completo con selección '+database+' (repositorio simulado)',async()=>{
   const factory=memoryFactory();factory.isMemory=true;
   await exercise(factory,database);
 });
}
