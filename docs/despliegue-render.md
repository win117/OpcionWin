# Despliegue en Render

Un solo **Web Service** de Node sirve la API (`/api/v1`) y la interfaz React (`web/dist`) en la misma URL con HTTPS.
La configuración está en [`render.yaml`](../render.yaml) (Blueprint). **Los secretos no están en Git**: se capturan en el panel de Render.

## 1. Requisitos previos (una sola vez)

1. Código en GitHub (rama `version-funcional` o `main`). El `.env`, `private/` y `backups/` están en `.gitignore` y nunca se suben.
2. **MongoDB Atlas → Network Access → Add IP Address → `0.0.0.0/0`** (Allow access from anywhere).
   Render (plan gratuito) no tiene IP de salida fija; la protección queda en el usuario/contraseña de Atlas.
   Si no usarás MongoDB en la nube, inicia sesión con Supabase y omite este paso.
3. Exporta tus usuarios de la app (en tu PC, carpeta del proyecto):
   ```powershell
   npm.cmd run exportar:usuarios
   ```
   Copia la línea JSON que imprime (hashes scrypt, no contraseñas; trátala como secreto).

## 2. Crear el servicio

1. https://dashboard.render.com → **New → Blueprint** → conecta tu cuenta de GitHub y elige el repositorio `OpcionWin`
   y la rama (`version-funcional` o `main`).
2. Render lee `render.yaml` y pide los valores marcados `sync: false`. Pega los mismos de tu `.env`:

| Variable | Valor |
|---|---|
| `CONNECTION_STRING` | cadena `mongodb+srv://…` de Atlas |
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SECRET_KEY` | clave secreta de Supabase (`sb_secret_…`) |
| `ALPACA_KEY_ID` / `ALPACA_SECRET_KEY` | claves **Trading API paper** (empiezan con `PK`) |
| `WEBULL_APP_KEY` / `WEBULL_APP_SECRET` / `WEBULL_ACCOUNT_ID` | opcionales: App del **sandbox** de Webull y su cuenta de pruebas. Sin ellas, Webull aparece como no configurado |
| `SEC_USER_AGENT` | `AppRESTOpciones tu-correo` |
| `AUTH_USERS_JSON` | la línea del paso 1.3 |

3. **Apply**. Render ejecuta:
   `npm ci --include=dev && npm run build && npm --prefix web ci --include=dev && npm --prefix web run build` y luego `npm start`.
   El chequeo de salud es `GET /health`. Al terminar te da una URL `https://apprestopciones-XXXX.onrender.com`.

Variables fijas que ya pone el Blueprint: `HOST=0.0.0.0`, `NODE_VERSION=22`, `API_URL=/api/v1`, `SESSION_TTL_SECONDS=3600`,
`ALPACA_DATA_FEED=iex`, `DATABASE=db_opciones`, `TRUST_PROXY=1`, `WEBULL_ENTORNO=paper` (único permitido). `PORT` lo asigna Render automáticamente.

### `TRUST_PROXY`

Número de proxies de confianza delante del servidor (entero de 0 a 10; nunca `true`, porque cualquiera podría falsear su IP con
`X-Forwarded-For`). En local es 0. En Render es 1: sin él todos los usuarios comparten la IP del proxy y, con ella, el límite de
accesos; además no se emite `Strict-Transport-Security`. Si Render interpone más saltos, súbelo hasta que el límite por IP separe a
dos clientes distintos (10 intentos por minuto y dirección); un valor demasiado alto permitiría falsear la IP.

### Índices de MongoDB

El servidor crea los índices (únicos y TTL de sesiones) en el primer acceso a cada colección, en segundo plano. Si hay duplicados
previos lo avisa en el log (`[mongodb] No se pudo crear un índice…`) y sigue funcionando sin ese índice. `npm run setup:mongodb`
crea los mismos índices de forma explícita. En Supabase los crea `database/schema.sql`.

## 3. Comprobar

- `https://<tu-url>/health` → `{"status":"ok"}` (o similar, 200).
- `https://<tu-url>/` → pantalla de inicio de sesión; entra con tu usuario y elige Supabase o MongoDB.
- Los indicadores Alpaca / SEC del encabezado deben estar en verde.

## 4. Actualizar

Cada `git push` a la rama conectada vuelve a desplegar (`autoDeploy: true`).
Agregar usuarios: crea el usuario en local (`scripts/create-user.ps1`), vuelve a ejecutar `npm.cmd run exportar:usuarios`
y reemplaza `AUTH_USERS_JSON` en Render → Environment (se redepliega solo).

## Limitaciones del plan gratuito (y cómo afectan a esta app)

| Comportamiento | Efecto | Opción |
|---|---|---|
| El servicio se duerme tras ~15 min sin tráfico | La primera visita tarda ~30–60 s en despertar | Plan Starter (siempre activo) |
| Reinicios / redeploys | La **cola de trabajos es en memoria**: un análisis o sincronización en curso se pierde (su registro queda «procesando»); basta relanzarlo | Ejecutar trabajos cortos; a futuro, cola persistente |
| Las sesiones viven en la base de datos | Sobreviven a reinicios | — |
| Sin disco persistente | No se escriben archivos locales; todo va a MongoDB/Supabase | — |

## Límites y retención

- Inicio de sesión: 10 intentos/min por IP y 10 fallidos cada 15 min por correo. Operaciones costosas (`/ejecuciones`, `/evaluaciones`,
  `/ticket`): 120 por minuto y usuario; hasta 60 trabajos en espera por usuario. Al superarlos se responde 429 con `Retry-After`.
- Al iniciar sesión (una vez al día por usuario) se borran auditoría, sincronizaciones y cotizaciones de más de 90 días, o por encima de
  5 000, 2 000 y 10 000 registros. Nunca órdenes, posiciones ni análisis. Se auditan hasta 20 accesos fallidos por hora y usuario.

## Seguridad

- Nunca subas `.env`, `private/users.json` ni `backups/*.zip` (contienen claves y hashes). El repositorio es **público**.
- Si alguna clave llegara a publicarse: regénerala de inmediato (Supabase → Settings → API; Atlas → Database Access; Alpaca → API Keys).
- Las órdenes siguen limitadas a **Alpaca paper** (ADR-005): la URL de trading está fija y las conexiones `live` se rechazan.
