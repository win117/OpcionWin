const boom = require('@hapi/boom');
const { resources } = require('../../dist/repositories/resources');
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
    return {
      async list({offset=0,limit=50}={}) { return [...store.values()].slice(offset,offset+limit).map(clone); },
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
      async remove(id,revision) {
        if (!store.has(id)||store.get(id).revision!==revision) throw boom.conflict();
        store.delete(id);
      },
    };
  };
}
module.exports={memoryFactory};
