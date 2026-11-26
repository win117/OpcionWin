# Spec Delta

## MODIFIED Requirements

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
