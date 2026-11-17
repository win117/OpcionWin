// Imprime private/users.json en una sola línea para pegarlo como valor de AUTH_USERS_JSON en Render.
// Contiene hashes scrypt (no contraseñas), pero trátalo como secreto: no lo subas a GitHub.
// Uso: npm run exportar:usuarios
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const archivo = process.env.AUTH_USERS_FILE || './private/users.json';
if (!fs.existsSync(archivo)) {
  console.error('No existe ' + archivo + '. Crea un usuario con scripts/create-user.ps1.');
  process.exit(1);
}
const usuarios = JSON.parse(fs.readFileSync(archivo, 'utf8'));
console.error(usuarios.length + ' usuario(s). Copia la línea siguiente como valor de AUTH_USERS_JSON:\n');
console.log(JSON.stringify(usuarios));
