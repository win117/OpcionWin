// Ejecutar explícitamente: npm run build && node scripts/setup-mongodb.cjs
(async () => {
  const { connectMongo, closeMongo } = require('../dist/config/database.config');
  const { resources } = require('../dist/repositories/resources');
  const { indicesDe } = require('../dist/repositories/mongodb/indices');
  try {
    const connection = await connectMongo();
    for (const [name, { table }] of Object.entries(resources)) {
      const collection = connection.db.collection(table);
      for (const [claves, opciones] of indicesDe(name)) await collection.createIndex(claves, opciones);
    }
    console.log('Índices de los módulos nuevos preparados.');
  } finally { await closeMongo(); }
})().catch(() => { console.error('No se pudieron preparar los índices. Comprueba conexión y duplicados.'); process.exitCode = 1; });
