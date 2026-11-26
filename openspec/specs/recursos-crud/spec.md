# recursos-crud

## Purpose
Ofrecer un CRUD común y uniforme para todos los recursos del dominio (empresas, estrategias, configuraciones,
perfiles-analisis, brokers, conexiones-broker, contratos, datos-mercado, fundamentales, institucional, noticias,
evaluaciones, selecciones, confluencias, ordenes, posiciones, sincronizaciones, auditoria), con aislamiento por usuario,
control de versiones y lotes. Un recurso nuevo solo declara su modelo; las rutas salen del modelo.
Implementación: `routes/crud.routes.js` (`moduleRouter`), `controllers/crud.controller.js`, `services/crud.service.js`,
`services/nested.service.js`, `src/repositories/`.

## Requirements

### Requirement: Rutas generadas a partir del modelo
Para cada recurso el sistema SHALL montar `GET /`, `POST /`, `GET /:id`, `PUT /:id`, `DELETE /:id`, `POST /lote`,
`PUT /lote` y `POST /eliminacion-lote`, y MUST generar automáticamente rutas para sus subdocumentos
(`/:id/<campo>` para objetos y `/:id/<campo>/:childId` para arreglos de subdocumentos).

#### Scenario: Subdocumento de arreglo
- **WHEN** un modelo tiene un arreglo de subdocumentos `componentes`
- **THEN** existen `GET/POST /:id/componentes` y `GET/PUT/DELETE /:id/componentes/:childId`

### Requirement: Validación con Zod y mensajes en español
El sistema SHALL validar cuerpo, parámetros y consulta contra el esquema del recurso antes del controlador, responder
400 con mensajes en español que nombran el campo y entregar los tipos ya convertidos (números, fechas).

#### Scenario: Campo con tipo incorrecto
- **WHEN** se envía `cantidad: "abc"` donde se espera un número
- **THEN** responde 400 con un mensaje que menciona `cantidad`

### Requirement: Aislamiento por usuario y base de datos
Cada registro SHALL pertenecer al usuario y a la base de la sesión. El sistema MUST impedir leer, cambiar o borrar
registros de otro usuario y MUST ignorar los campos protegidos (`_id`, `id`, `usuarioId`, `createdAt`, `updatedAt`,
`_revision`, `owner_id`) que envíe el cliente, para que no pueda falsificar al dueño.

#### Scenario: Registro de otro usuario
- **WHEN** el usuario B pide `GET /empresas/:id` de un registro del usuario A
- **THEN** responde 404

### Requirement: Paginación, filtros y búsqueda
`GET /` SHALL aceptar `page` (≥ 1), `limit` (1–100, 50 por defecto), `search` y filtros por los campos del modelo, y
devolver `{ items, page, limit, total }` ordenado de lo más reciente a lo más antiguo. Los identificadores MUST ser texto
(sin operadores de consulta) para evitar inyección.

#### Scenario: Límite fuera de rango
- **WHEN** se pide `?limit=500`
- **THEN** responde 400 «Paginación inválida.»

#### Scenario: Más de 10 000 registros
- **WHEN** un recurso tiene más de 10 000 registros
- **THEN** se listan y filtran por páginas sin error

### Requirement: Concurrencia optimista con revisiones
Cada respuesta de un registro SHALL incluir `_revision` y la cabecera `ETag`. `PUT /:id` reemplaza el documento y, si
llega `If-Match` con una revisión distinta de la guardada, MUST responder 409 «Versión desactualizada.»

#### Scenario: Dos ediciones simultáneas
- **WHEN** dos clientes leen la revisión 3 y ambos envían `PUT` con `If-Match: "3"`
- **THEN** el primero tiene éxito y el segundo recibe 409

### Requirement: Integridad referencial al borrar
El sistema SHALL responder 409 «El registro está referenciado…» al intentar borrar un registro del que dependen otros
(por ejemplo, evaluaciones usadas por una confluencia).

#### Scenario: Borrar evaluación usada
- **WHEN** se borra una evaluación referenciada por una confluencia
- **THEN** responde 409 y la evaluación se conserva

### Requirement: Operaciones en lote con éxito parcial
Los lotes SHALL aceptar de 1 a 100 elementos, procesarlos de forma independiente y devolver
`{ success, total, exitosos, fallidos, results[] }`, con el estado y el mensaje de cada elemento.

#### Scenario: Un elemento inválido
- **WHEN** se crea un lote de 3 empresas donde una es inválida
- **THEN** se guardan 2, la respuesta indica `fallidos: 1` y el índice del elemento que falló

### Requirement: Recursos de solo lectura
`auditoria` y `posiciones`, así como los subrecursos `ordenes/:id/eventos` y `ordenes/:id/componentes`, SHALL aceptar
solo GET/HEAD y responder 405 a cualquier escritura. Las órdenes MUST NOT aceptar del cliente los campos que asigna el
servidor, ni borrarse mientras siguen vivas en el broker. Solo se editan componentes de una configuración en estado
`borrador`.

#### Scenario: Escribir en auditoría
- **WHEN** se envía `POST /auditoria`
- **THEN** responde 405 «Registro de solo lectura.»

### Requirement: Persistencia dual intercambiable
El sistema SHALL implementar el mismo contrato de repositorio para MongoDB y para Supabase (filtros tipados, búsqueda
escapada, orden, conteo, referencias y purga), de modo que los servicios no conozcan la base concreta.

#### Scenario: Misma consulta en ambas bases
- **WHEN** se filtra por un campo numérico en MongoDB y en Supabase
- **THEN** ambas devuelven los mismos registros y el mismo `total`

### Requirement: Retención de datos voluminosos
El sistema SHALL conservar 90 días (o los últimos N registros) de auditoría, sincronizaciones y cotizaciones, y MUST NOT
purgar ningún otro recurso.

#### Scenario: Purga de cotizaciones viejas
- **WHEN** existen cotizaciones de hace 120 días
- **THEN** se purgan y las de los últimos 90 días se conservan
