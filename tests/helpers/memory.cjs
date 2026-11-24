const boom = require('@hapi/boom');
const { resources, CAMPOS_BUSQUEDA, filtroPurga } = require('../../dist/repositories/resources');
function memoryFactory() {
  const stores = new Map();
  return (name, ctx) => {
    const key = [ctx.database,ctx.userId,name].join(':');
    if (!stores.has(key)) stores.set(key,new Map());
    const store = stores.get(key);
    const clone = v => v ? structuredClone(v) : v;
    const unique = (doc, except) => {
      for (const [keys, options] of resources[name].Model.schema.indexes()) {
        if (!options.unique) continue;
        if ([...store.values()].some(r => r._id !== except && Object.keys(keys).every(k => r.document[k] === doc[k]))) throw boom.conflict('Duplicado');
      }
    };
    const coincidentes = ({filtro,busqueda}) => {
      const f=Object.entries(filtro||{});
      return [...store.values()].filter(r=>f.every(([k,v])=>String(r.document[k])===v)
        && (!busqueda || CAMPOS_BUSQUEDA.some(k=>String(r.document[k]||'').toLowerCase().includes(busqueda.toLowerCase()))));
    };
    const creado = r => new Date(r.document.createdAt||0).getTime()||0;
    const apunta = (valor,[s,...resto],id) => s===undefined ? valor===id
      : (s.arreglo ? valor?.[s.campo]||[] : [valor?.[s.campo]]).some(v=>apunta(v,resto,id));
    return {
      async list({offset=0,limit=50,filtro,busqueda,orden}={}) {
        const filas=coincidentes({filtro,busqueda});
        if(orden==='recientes') filas.sort((a,b)=>creado(b)-creado(a)||String(a._id).localeCompare(String(b._id)));
        return filas.slice(offset,offset+limit).map(clone);
      },
      async count({filtro,busqueda}={}) { return coincidentes({filtro,busqueda}).length; },
      async referenciado(rutas,id,excepto) {
        return [...store.values()].some(r=>r._id!==excepto && rutas.some(ruta=>apunta(r.document,ruta,id)));
      },
      async purgar({antesDe,filtro}) {
        const f=filtroPurga(name,filtro);
        for(const r of [...store.values()]) if(f.every(([k,v])=>r.document[k]===v) && new Date(r.document.createdAt)<antesDe) store.delete(r._id);
      },
      async get(id) { return clone(store.get(id)); },
      async create(doc) {
        if (store.has(doc._id)) throw boom.conflict();
        unique(doc);
        const row={_id:doc._id,owner_id:ctx.userId,document:clone(doc),revision:1};
        store.set(doc._id,row); return clone(row);
      },
      async replace(id,doc,revision) {
        if (!store.has(id)||store.get(id).revision!==revision) throw boom.conflict();
        unique(doc,id);
        const row={_id:id,owner_id:ctx.userId,document:clone(doc),revision:revision+1};
        store.set(id,row); return clone(row);
      },
      async upsertMany(docs) {
        for(const doc of docs){const prev=store.get(doc._id);unique(doc,doc._id);store.set(doc._id,{_id:doc._id,owner_id:ctx.userId,document:clone(doc),revision:(prev?.revision||0)+1});}
        return docs.length;
      },
      async remove(id,revision) {
        if (!store.has(id)||store.get(id).revision!==revision) throw boom.conflict();
        store.delete(id);
      },
    };
  };
}
module.exports={memoryFactory};
