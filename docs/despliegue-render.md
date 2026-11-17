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
| `SEC_USER_AGENT` | `AppRESTOpciones tu-correo` |
| `AUTH_USERS_JSON` | la línea del paso 1.3 |

3. **Apply**. Render ejecuta:
   `npm ci --include=dev && npm run build && npm --prefix web ci --include=dev && npm --prefix web run build` y luego `npm start`.
   El chequeo de salud es `GET /health`. Al terminar te da una URL `https://apprestopciones-XXXX.onrender.com`.

Variables fijas que ya pone el Blueprint: `HOST=0.0.0.0`, `NODE_VERSION=22`, `API_URL=/api/v1`, `SESSION_TTL_SECONDS=3600`,
`ALPACA_DATA_FEED=iex`, `DATABASE=db_opciones`. `PORT` lo asigna Render automáticamente.

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

## Seguridad

- Nunca subas `.env`, `private/users.json` ni `backups/*.zip` (contienen claves y hashes). El repositorio es **público**.
- Si alguna clave llegara a publicarse: regénerala de inmediato (Supabase → Settings → API; Atlas → Database Access; Alpaca → API Keys).
- Las órdenes siguen limitadas a **Alpaca paper** (ADR-005): la URL de trading está fija y las conexiones `live` se rechazan.
