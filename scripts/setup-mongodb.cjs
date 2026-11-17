// Ejecutar explícitamente: npm run build && node scripts/setup-mongodb.cjs
(async () => {
  const { connectMongo, closeMongo } = require('../dist/config/database.config');
  const { resources } = require('../dist/repositories/resources');
  try {
    const connection = await connectMongo();
    for (const [name, { table, Model }] of Object.entries(resources)) {
      const collection = connection.db.collection(table);
      await collection.createIndex({ owner_id: 1, _id: 1 });
      for (const [keys, options] of Model.schema.indexes()) {
        if (!options.unique) continue;
        const index = { owner_id: 1 };
        for (const [key, value] of Object.entries(keys)) index['document.' + key] = value;
        await collection.createIndex(index, { unique: true });
      }
    }
    await connection.db.collection(resources.sesiones.table).createIndex({ 'document.expiraEn': 1 }, { expireAfterSeconds: 0 });
    console.log('Índices de los módulos nuevos preparados.');
  } finally { await closeMongo(); }
})().catch(() => { console.error('No se pudieron preparar los índices. Comprueba conexión y duplicados.'); process.exitCode = 1; });
