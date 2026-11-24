import dotenv from 'dotenv';
dotenv.config({ quiet: true });
export default {
  HOST: process.env.HOST || 'localhost',
  PORT: Number(process.env.PORT || 3000),
  API_URL: process.env.API_URL || '/api/v1',
  CONNECTION_STRING: process.env.CONNECTION_STRING || 'mongodb://127.0.0.1:27017',
  DATABASE: process.env.DATABASE || 'db_opciones',
  DNS_SERVERS: process.env.DNS_SERVERS || '',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || '',
  AUTH_USERS_FILE: process.env.AUTH_USERS_FILE || './private/users.json',
  // En la nube (Render) no existe private/users.json: los usuarios pueden venir como JSON en una variable de entorno.
  AUTH_USERS_JSON: process.env.AUTH_USERS_JSON || '',
  SESSION_TTL_SECONDS: Number(process.env.SESSION_TTL_SECONDS || 3600),
  // Proxies de confianza delante del servidor (número de saltos, nunca true). 0: conexión directa; Render: 1.
  TRUST_PROXY: Number(process.env.TRUST_PROXY || 0),
  CORS_ORIGINS: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean),
};
