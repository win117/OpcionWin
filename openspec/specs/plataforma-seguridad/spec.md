# plataforma-seguridad

## Purpose
Reglas transversales del servidor: estructura por capas verificable, documentación OpenAPI, manejo de errores sin
filtrar secretos, cabeceras de seguridad, compresión, entrega de la web y auditoría.
Implementación: `src/app.js`, `src/middlewares/*`, `routes/registrar.js`, `services/auditoria.service.js`,
`scripts/check-structure.cjs`, `tests/estructura.test.cjs`, `tests/plataforma.test.cjs`.

## Requirements

### Requirement: Arquitectura por capas verificada
Las rutas SHALL solo conectar una definición de `schemas/` con su controlador (sin reglas de negocio, sin base de datos
y sin verbos fuera del CRUD común). Cada módulo CRUD MUST tener modelo, servicio, controlador y ruta, y usarlos. Una
prueba automática MUST fallar si se rompe alguna de estas reglas.

#### Scenario: Lógica en una ruta
- **WHEN** alguien agrega una consulta a la base dentro de un archivo `*.routes.js`
- **THEN** `tests/estructura.test.cjs` falla

### Requirement: Documentación OpenAPI completa
Cada definición SHALL estar montada en el servidor y aparecer en OpenAPI (Swagger UI), sin duplicados. Los recursos de
solo lectura MUST NOT prometer escritura, y la contraseña se marca como tal.

#### Scenario: Endpoint nuevo sin documentar
- **WHEN** se monta una ruta que no está en `schemas/`
- **THEN** la prueba de estructura falla

### Requirement: Errores uniformes y sin secretos
Los errores SHALL responder con el formato de Boom (`statusCode`, `error`, `message`). Una URI mal formada responde 400.
Un error inesperado responde 500 y se registra sin secretos ni cuerpo de la solicitud.

#### Scenario: Excepción inesperada
- **WHEN** un servicio lanza un error no controlado
- **THEN** el cliente recibe 500 genérico y la bitácora no contiene claves ni el cuerpo

### Requirement: Cabeceras de seguridad
El servidor SHALL enviar cabeceras de seguridad y una CSP que solo permite el marco de TradingView y ningún script
ajeno. HSTS MUST enviarse solo detrás de https.

#### Scenario: Petición por http local
- **WHEN** se consulta el servidor por http en desarrollo
- **THEN** la respuesta no incluye HSTS

### Requirement: Compresión y caché
Las respuestas JSON SHALL comprimirse con gzip solo si el cliente lo acepta y superan 1 KB, conservando el ETag. Los
archivos de la web compilada se sirven con caché inmutable, e `index.html` sin caché. El service worker (`/sw.js`)
MUST servirse con `Cache-Control: no-cache` y el manifest (`/manifest.webmanifest`) con el tipo
`application/manifest+json`.

#### Scenario: Respuesta pequeña
- **WHEN** la respuesta JSON pesa 300 bytes
- **THEN** se envía sin comprimir

#### Scenario: Service worker siempre revalidado
- **WHEN** el navegador pide `/sw.js`
- **THEN** la respuesta tiene `Cache-Control: no-cache` y un tipo JavaScript
- **AND** no se sirve el `index.html` de respaldo de la SPA

#### Scenario: Manifest con su tipo
- **WHEN** el navegador pide `/manifest.webmanifest`
- **THEN** responde 200 con `Content-Type: application/manifest+json`

### Requirement: Auditoría que nunca rompe
`registrarEvento` SHALL respetar el esquema de auditoría y MUST NOT lanzar errores. Una operación auditada conserva su
resultado o su error original aunque la auditoría falle.

#### Scenario: Base de auditoría caída
- **WHEN** falla la escritura en auditoría durante un ticket
- **THEN** el ticket responde con su resultado normal

### Requirement: Arranque y salud
El servidor compilado (`dist/index.js`) SHALL arrancar y responder `GET /health` con `{ status: "ok" }`. La SPA de React
se sirve desde el mismo origen en producción (ADR-007): toda ruta que no sea `/api/`, `/health` ni `/assets/` entrega
`index.html` sin caché.

#### Scenario: Arranque en Render
- **WHEN** se ejecuta `npm start` tras `npm run build:all`
- **THEN** `GET /health` responde 200 y `/` entrega la web
