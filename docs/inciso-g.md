# G. Rutas

Prefijo: API_URL (por defecto /api/v1). POST /sesiones recibe email, password y baseDatos. Devuelve token opaco; todas las rutas nuevas requieren Authorization: Bearer <token>. GET y DELETE /sesiones/actual consultan y revocan la sesión.

Cada recurso persistente (excepto sesiones) dispone de:

| Método | Ruta | Contenido |
|---|---|---|
| GET | /recurso | page, limit, search y filtros exactos de campos |
| GET | /recurso/:id | Registro individual |
| POST | /recurso | Objeto sin campos del servidor |
| POST | /recurso/lote | {items:[objetos]} |
| PUT | /recurso/:id | Representación completa editable; If-Match opcional |
| PUT | /recurso/lote | {items:[{id,datos,revision?}]} |
| DELETE | /recurso/:id | Sin body |
| POST | /recurso/eliminacion-lote | {ids:[identificadores]} |

Los subdocumentos arreglo tienen el mismo patrón debajo de /recurso/:id/campo, usando /:childId para un elemento. Los objetos simples admiten GET/POST/PUT/DELETE en /recurso/:id/campo; las restricciones del modelo pueden impedir eliminar un campo obligatorio.

Los GET de /mercado consultan datos previamente guardados. /cores/:core/evaluaciones permite consultar registros de evaluación. No inicia algoritmos ni hace consultas externas. El POST de /ordenes administra un registro local, sin enviar operaciones al broker.


English: Routes map each HTTP method to its controller. Batch paths are registered before identifier paths, and nested resources retain the identifier of their parent document.

Palabras clave: rutas, endpoints, HTTP, autenticación, subdocumentos.
