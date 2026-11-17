# B. Estructura base del proyecto final

## Propósito

Se reutiliza la aplicación Express construida durante el tema 1. La organización por modelos, servicios, controladores y rutas permite incorporar los módulos del proyecto de opciones.

## Respaldo anterior a cualquier cambio

Archivo: `backups/estado-antes-inciso-b-20261116-063743.zip`.
Contiene 9,952 archivos (73,563,129 bytes), incluyendo código, .env, solicitudes, dependencias, compilados e imágenes.
Se comprobó el número de entradas y la coincidencia SHA-256 de 16 archivos de código, configuración y solicitudes.
No compartir este respaldo: contiene configuración privada. Para restaurar, descomprimir en una carpeta separada y revisar antes de reemplazar la aplicación actual.

## Estructura preparada

```text
src/
  index.js                      Arranque existente
  app.js                        Aplicación Express existente
  config/                       Configuración y conexión actual
  middlewares/                  Auxiliares existentes
  api/v1/
    models/                     Modelos de las entidades del proyecto
    services/                   Lógica de cada módulo (pendiente)
    controllers/                Request/response de cada módulo (pendiente)
    routes/                     Routers registrados; operaciones pendientes
  cores/                        Cinco análisis y motor de confluencia
  integrations/                 Adaptadores Alpaca, Webull y SEC
  repositories/
    mongodb/                    Acceso a documentos (pendiente)
    supabase/                   Acceso a tablas (pendiente)
request/                        Solicitudes de ejemplo
scripts/                        Comprobación local de la estructura
docs/                           Evidencia técnica del inciso B
```

## Módulos

Se prepararon routers, controladores y servicios para sesiones, empresas, estrategias, configuraciones, perfiles de análisis, mercado, cores, selecciones, confluencias, brokers, conexiones con brokers, órdenes, posiciones, sincronizaciones y auditoría.

Componentes se integra debajo de `/configuraciones/:id/componentes`; reglas se integra debajo de `/perfiles-analisis/:id/reglas`. Los routers secundarios conservan el parámetro del padre mediante `mergeParams`.

Todos dependen del prefijo `API_URL`, por defecto `/api/v1`. Los routers nuevos están registrados, pero no contienen endpoints funcionales: devuelven 404 hasta implementar las operaciones. No se registraron modelos vacíos de Mongoose ni tablas vacías.

## Configuración

- Se conserva Express, lectura de JSON, CORS, Morgan y el manejo central de errores.
- Se corrige la respuesta a JSON mal formado para devolver 400 en lugar de 500.
- Babel se configura explícitamente para producir CommonJS, acorde con package.json.
- El índice de rutas utiliza exportación predeterminada, coherente con su importación.
- .env.example documenta la configuración existente sin copiar secretos.
- .gitignore excluye .env, respaldos, dependencias y archivos generados.
- La conexión actual a MongoDB se conserva. La segunda conexión y la selección por sesión pertenecen al inciso D.
- No se instalaron dependencias ni se configuraron cuentas de proveedores.

## Alcance y pendientes

| Inciso | Estado |
|---|---|
| B | Estructura base y registro de módulos preparados |
| C | Definir modelos, validaciones, relaciones e índices |
| D | Configurar bases de datos y selección por sesión |
| E | Implementar servicios y acceso a datos |
| F | Implementar controladores |
| G | Definir endpoints individuales, múltiples y de subrecursos |
| H | Revisar integración final y despliegue |

Los archivos nuevos que contienen `export {};` son bases explícitamente pendientes, no funcionalidades terminadas. La auditoría y los datos de brokers no deben recibir automáticamente un CRUD genérico.

La estructura actual es una aplicación Express organizada por capas con un solo arranque. No constituye por sí sola un conjunto de microservicios desplegables de manera independiente.

## Evidencias sugeridas

Verificación realizada: `npm.cmd run check:structure` terminó con código 0. Babel compiló 83 archivos. Se comprobó carga de módulos, registro de rutas, respuesta 200 de la raíz, 404 de módulos pendientes y 400 ante JSON mal formado. No se probó conectividad real ni se modificaron bases de datos.

1. Respaldo creado antes de los cambios.
2. Explorador de VS Code con nuevas carpetas y módulos.
3. Índice de rutas mostrando su registro.
4. Configuración de Babel y scripts de package.json.
5. Salida de `npm.cmd run check:structure`.

No incluir capturas de valores del .env.

## Párrafo en inglés

The existing Express application provides the foundation for the final project APIs. The new structure separates routes, controllers, services, analysis cores, and external integrations. This stage prepares the application for later implementation.

## Palabras clave

Estructura base · Express · Módulos · Configuración · Rutas · Separación de responsabilidades

Collage sugerido: Express → rutas y controladores → servicios → cores, integraciones y acceso a datos.

