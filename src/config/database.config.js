import mongoose from 'mongoose';
import dns from 'node:dns';
import config from './config';
let pending;
export async function connectMongo() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!pending) {
    if (config.DNS_SERVERS) dns.setServers(config.DNS_SERVERS.split(',').map(s => s.trim()).filter(Boolean));
    pending = mongoose.connect(config.CONNECTION_STRING, { dbName: config.DATABASE, serverSelectionTimeoutMS: 5000 })
      .then(() => mongoose.connection).finally(() => { pending = undefined; });
  }
  return pending;
}
export async function closeMongo() { await mongoose.disconnect(); }
export { mongoose };
