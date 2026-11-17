# H. Integración y ejecución

App configura JSON (máximo 1 MB), CORS por lista de orígenes, identificador de solicitud, manejo de errores y Swagger. Index inicia el servidor y cierra MongoDB ordenadamente en SIGINT/SIGTERM. Importar app no inicia un servidor ni abre conexiones.

- GET /health: proceso disponible; no asegura conexión a bases.
- GET /api/v1/openapi.json: inventario ejecutable OpenAPI.
- /api/v1/api-docs: Swagger UI.
- npm.cmd run build y npm.cmd start: compilación y ejecución.
- npm.cmd run check:models: modelos.
- npm.cmd test: pruebas locales sin credenciales.
- npm.cmd run test:databases: comprobación real de ambas bases con registros temporales y limpieza.

El archivo .env no se versiona. Para uso público configurar CORS_ORIGINS, usar HTTPS y ejecutar una sola instancia si se conserva el registro de usuarios por archivo. El limitador de login es por proceso.

English: The application integrates routing, authentication, documentation, and error handling. The server starts independently from database connections and provides a health endpoint for checking process availability.

Palabras clave: Express, arranque, Swagger, despliegue, pruebas.
