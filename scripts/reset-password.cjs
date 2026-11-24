// Cambia la contraseña de un usuario existente conservando su id (y con él, todos sus datos).
// Uso: establecer BOOTSTRAP_PASSWORD y ejecutar node scripts/reset-password.cjs correo
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, scryptSync } = require('node:crypto');
require('dotenv').config({ quiet: true });
const email = (process.argv[2] || '').trim().toLowerCase();
const password = process.env.BOOTSTRAP_PASSWORD;
if (!email || !password || password.length < 12) {
  console.error('Indica correo y BOOTSTRAP_PASSWORD de al menos 12 caracteres. No se imprime ni se guarda la contraseña.');
  process.exit(1);
}
const file = path.resolve(process.env.AUTH_USERS_FILE || './private/users.json');
const users = JSON.parse(fs.readFileSync(file, 'utf8'));
const user = users.find(u => u.email === email);
if (!user) { console.error('No existe un usuario con ese correo.'); process.exit(1); }
user.salt = randomBytes(16).toString('hex');
user.passwordHash = scryptSync(password, user.salt, 64).toString('hex');
fs.copyFileSync(file, file + '.anterior');
fs.writeFileSync(file, JSON.stringify(users, null, 2), { mode: 0o600 });
console.log('Contraseña actualizada. Si usas Render, vuelve a copiar AUTH_USERS_JSON (npm run exportar:usuarios).');
