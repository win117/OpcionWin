# APIs REST del proyecto de opciones

Backend Express para los CRUD del proyecto Long Call, Long Put e Iron Condor.

## Implementado

- Modelos con validación completa y subdocumentos.
- Persistencia intercambiable por sesión: MongoDB o Supabase/PostgreSQL.
- Sesiones opacas revocables, contraseñas con hash scrypt y datos separados por usuario.
- GET/POST/PUT/DELETE individuales, lotes y subdocumentos.
- Control de revisión para evitar actualizaciones perdidas del mismo registro.
- OpenAPI, Swagger UI, límites de body y errores JSON.

**Alcance de esta entrega:** administración de registros. No se han implementado los algoritmos de los cinco cores ni el envío, modificación o cancelación de operaciones reales en brokers. POST /ordenes crea un registro local. POST /evaluaciones y /sincronizaciones guarda registros; no ejecuta trabajos. Los GET de mercado consultan datos almacenados. Los adaptadores externos del tema 3 siguen pendientes.

## Preparación

1. Conservar .env existente. Consultar .env.example para variables nuevas.
2. Configurar SUPABASE_URL y SUPABASE_SECRET_KEY en el servidor.
3. database/schema.sql prepara las 19 tablas PostgreSQL api_* con JSONB, control de versión y acceso exclusivo del servidor. Ya se aplicó en el proyecto Opciones indicado por el usuario.
4. Ejecutar npm.cmd run setup:mongodb para índices de las colecciones api_*.
5. Crear un usuario local:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/create-user.ps1
   El correo y contraseña se solicitan interactivamente; solo se guarda el hash.
6. Ejecutar npm.cmd run dev, o npm.cmd run build seguido de npm.cmd start.

El esquema SQL conserva los subdocumentos como JSONB, no como tablas hijas normalizadas. Las reglas del modelo y las referencias se validan en Express. La clave de Supabase solo se usa en el servidor; no hay acceso directo de clientes a las tablas.

## Uso

POST /api/v1/sesiones:
{"email":"tu-correo","password":"tu-contrasena","baseDatos":"mongodb"}

También acepta baseDatos: "supabase". Utilizar el token recibido como Authorization: Bearer <token>.
GET /sesiones/actual consulta la base elegida; DELETE /sesiones/actual revoca el token.
Para cambiar de base iniciar otra sesión. Los datos no se copian automáticamente entre bases.

Swagger: /api/v1/api-docs
OpenAPI: /api/v1/openapi.json
Disponibilidad del proceso: /health

Ver request/proyecto-final.http y request/flujo-crud.http.

## Pruebas

- npm.cmd test: modelos, servicios y HTTP con repositorios simulados.
- npm.cmd run check:structure: flujo HTTP aislado.
- npm.cmd run test:databases: prueba real en ambas bases. Crea un usuario temporal en memoria y registros de prueba con propietario UUID exclusivo; los elimina al terminar. No hace operaciones con brokers.

## Límites actuales

- Usuarios aprovisionados por CLI; no registro público, recuperación de contraseña ni integración con Supabase Auth.
- Control de acceso por propietario; no roles de equipo ni catálogo compartido.
- Búsqueda local paginada con tope de 10,000 registros por recurso/usuario; optimizar consultas en base antes de escalar.
- Lotes con resultados por elemento, sin transacción de todo el lote.
- Las comprobaciones de referencias entre documentos no son transacciones distribuidas.
- Tokens expirados se rechazan siempre. MongoDB puede limpiarlos por TTL una vez instalado su índice; en SQL debe programarse limpieza posterior.
- Configurar CORS_ORIGINS y HTTPS para clientes externos.

## Evidencia

docs/inciso-b.md y docs/inciso-c.md conservan la descripción de esas etapas.
docs/inciso-d.md a docs/inciso-h.md describen la implementación actual.
backups/ contiene una copia del código/configuración anterior a cada inciso. Incluyen secretos locales: no compartirlos ni subirlos a Git.
