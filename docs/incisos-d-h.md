# Entrega de incisos D, E, F, G y H

## Resultado

Se implementó la administración CRUD de los registros del proyecto en MongoDB y Supabase/PostgreSQL, con selección de base al iniciar sesión. Las solicitudes usan la base y el propietario almacenados en su sesión.

| Inciso | Archivos principales | Resultado |
|---|---|---|
| D | src/config/, src/repositories/, database/schema.sql | Dos adaptadores de persistencia, configuración privada y esquema SQL instalado |
| E | src/api/v1/services/ | CRUD individual, por lote y de subdocumentos; validación completa y control de revisión |
| F | src/api/v1/controllers/, src/middlewares/auth.handler.js | Respuestas JSON, estados HTTP y contexto autenticado |
| G | src/api/v1/routes/ | Rutas de los recursos y sus campos anidados |
| H | src/app.js, src/index.js, src/config/openapi.js | Arranque, Swagger, manejo de errores y cierre del servidor |

Los servicios compartidos evitan duplicar la misma lógica en todos los módulos. Cada módulo conserva archivos propios de servicio, controlador y ruta.

## Respaldos anteriores a cada etapa

Todos están en backups/ y contienen código, configuración, documentación y scripts de la etapa anterior. No incluyen nuevamente node_modules ni los collages; las dependencias quedan reproducibles mediante package-lock.json y el respaldo completo anterior al inciso B se conserva.

- D: estado-antes-inciso-d-20261116-070203.zip
- E: estado-antes-inciso-e-20261116-071634.zip (incluye actualización del proyecto Supabase indicado; también se conserva el primer respaldo E).
- F: estado-antes-inciso-f-20261116-072047.zip
- G: estado-antes-inciso-g-20261116-072142.zip
- H: estado-antes-inciso-h-20261116-072238.zip

Se verificó que cada archivo ZIP pudiera abrirse y contuviera package.json. Son respaldos privados porque incluyen .env.

## Pruebas realizadas

- Compilación: 123 archivos.
- npm.cmd test: 39 pruebas aprobadas, 0 fallidas.
- HTTP real MongoDB: 34 solicitudes aprobadas, incluyendo login, elección de base, CRUD, lotes, componentes, reglas, parámetros y logout.
- HTTP real Supabase: las mismas 34 solicitudes aprobadas.
- Los registros temporales de ambas pruebas fueron eliminados.
- SQL directo en Supabase: inserción, consulta, actualización y eliminación en transacción revertida.
- Arranque del index compilado: servidor inicia y /health responde 200.
- OpenAPI: 137 rutas documentadas y 278 operaciones.

La prueba real de MongoDB necesitó ejecutarse fuera del entorno restringido del agente. La conexión del sistema no debe diagnosticarse como fallida basándose solo en el timeout del sandbox.

## Base SQL

Proyecto indicado por el usuario: Opciones (pyajzgbdaswkjbincmci).
Se crearon 19 tablas api_* y sus índices. Las tablas usan id, owner_id, revision y document JSONB. Los subdocumentos permanecen en JSONB. La validación del contenido se realiza con los mismos modelos de Express utilizados para MongoDB.

Las 19 tablas tienen RLS habilitado y permisos de PUBLIC, anon y authenticated revocados. El backend opera con su clave secreta y filtra propietario. El asesor de Supabase informa RLS sin políticas; es intencional en este diseño exclusivamente servidor: no se habilita acceso directo al navegador. Referencia: [RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

La clave del servidor se guardó en .env y se retiró de .env.example. No está incluida en esta documentación.

## Cómo probar con tu usuario

1. Crear un usuario desde PowerShell:
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/create-user.ps1
2. Iniciar npm.cmd run dev.
3. Abrir http://localhost:3020/api/v1/api-docs (o el puerto de tu .env).
4. POST /sesiones con email, password y baseDatos: mongodb o supabase.
5. Copiar data.token en Authorize de Swagger.
6. Probar /empresas, /estrategias y las demás rutas, o usar request/flujo-crud.http.
7. DELETE /sesiones/actual para cerrar la sesión.

Los usuarios de prueba fueron temporales y no sirven como cuentas de acceso. No se dejó una contraseña predeterminada.

## Alcance respecto del inciso A

Esta entrega implementa los CRUD solicitados en D–H para administrar datos. El inventario inicial de A también contemplaba acciones del producto final que no son CRUD:

- consultas y sincronización efectiva con proveedores;
- ejecución de los cinco algoritmos de análisis;
- selección y confluencia calculadas;
- envío, modificación, cancelación y cierre de operaciones en brokers.

Esas acciones no están implementadas por guardar registros en sus colecciones. Las rutas actuales lo indican como registros locales; no se simulan ejecuciones externas. El tema 3 debe implementar esos procesos y actualizar el contrato de las rutas de acciones. Los archivos de cores e integrations se conservan como espacios de trabajo pendientes.

## Evidencias sugeridas

D: configuración sin mostrar valores secretos, tablas api_* de Supabase y archivos de los repositorios.
E: crud.service.js, servicios de componentes/reglas y resultados de lotes.
F: crud.controller.js y sesiones.controller.js.
G: índice de rutas y Swagger.
H: consola de npm.cmd test, resultados de pruebas reales y respuesta /health.

Cada documento inciso-d.md a inciso-h.md incluye su párrafo en inglés y palabras clave.
