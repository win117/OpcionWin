// Uso: establecer BOOTSTRAP_PASSWORD y ejecutar node scripts/create-user.cjs correo
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, scryptSync } = require('node:crypto');
require('dotenv').config({ quiet: true });
const email = (process.argv[2] || '').trim().toLowerCase();
const password = process.env.BOOTSTRAP_PASSWORD;
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !password || password.length < 12) {
  console.error('Indica correo y BOOTSTRAP_PASSWORD de al menos 12 caracteres. No se imprime ni se guarda la contraseña.');
  process.exit(1);
}
const file = path.resolve(process.env.AUTH_USERS_FILE || './private/users.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
const users = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
if (users.some(u => u.email === email)) { console.error('El usuario ya existe.'); process.exit(1); }
const salt = randomBytes(16).toString('hex');
users.push({ id: randomUUID(), email, salt, passwordHash: scryptSync(password, salt, 64).toString('hex'), activo: true });
fs.writeFileSync(file, JSON.stringify(users, null, 2), { mode: 0o600 });
console.log('Usuario creado. Puedes iniciar sesión eligiendo mongodb o supabase.');
