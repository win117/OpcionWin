# F. Controladores

Los controladores leen req.params, req.query, req.body y req.context. El contexto proviene exclusivamente de la sesión autenticada. Delegan en servicios y devuelven success/message/data.

GET y PUT devuelven 200; POST individual devuelve 201; lotes devuelven 200 con resultados por elemento; logout devuelve 204. Los errores pasan al middleware central. If-Match permite enviar la revisión obtenida en ETag para evitar modificaciones sobre una versión antigua.

Los controladores de subdocumentos conservan el identificador del padre y validan el documento completo mediante el servicio. La lógica compartida vive en crud.controller.js y cada módulo tiene su archivo de entrada.

English: Controllers translate HTTP requests into service calls and return consistent JSON responses. Authentication provides the user and database context, while errors are forwarded to centralized middleware.

Palabras clave: controlador, request, response, estado HTTP, sesión.
