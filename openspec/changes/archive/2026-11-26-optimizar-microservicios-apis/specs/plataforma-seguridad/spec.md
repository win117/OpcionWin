# Spec Delta

## ADDED Requirements

### Requirement: Módulos por dominio vigilados
El código nuevo MAY organizarse en módulos por dominio en `src/modulos/<dominio>/`, con un archivo por capa
(`*.schema.js`, `*.routes.js`, `*.controller.js`, `*.service.js`). Esos módulos MUST cumplir las mismas reglas de capas
que `src/api/v1/` y la prueba automática de estructura MUST vigilarlos igual.

#### Scenario: Servicio de un módulo que conoce HTTP
- **WHEN** un archivo `src/modulos/<dominio>/*.service.js` usa `req` o `res` de Express
- **THEN** `tests/estructura.test.cjs` falla

#### Scenario: Ruta de un módulo con lógica
- **WHEN** un archivo `src/modulos/<dominio>/*.routes.js` importa un servicio o un repositorio
- **THEN** `tests/estructura.test.cjs` falla

#### Scenario: Módulo incompleto
- **WHEN** un módulo tiene `*.routes.js` pero le falta su `*.schema.js`, `*.controller.js` o `*.service.js`
- **THEN** `tests/estructura.test.cjs` falla
