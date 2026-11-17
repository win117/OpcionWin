# D. Conexiones y selección de base

MongoDB utiliza CONNECTION_STRING, DATABASE y DNS_SERVERS existentes. Supabase utiliza SUPABASE_URL y SUPABASE_SECRET_KEY exclusivamente del servidor. La clave no se copia al navegador ni a la plantilla .env.example.

Los repositorios comparten list/get/create/replace/remove, incluyen propietario y control de revisión. La sesión conserva database; no se cambia una variable global para seleccionar base. MongoDB se conecta bajo demanda.

Se instaló database/schema.sql en el proyecto Opciones indicado por el usuario. Contiene 19 tablas PostgreSQL api_*, con columnas id, owner_id, revision y document JSONB. Los subdocumentos se conservan en JSONB. Es un diseño híbrido, no un esquema relacional normalizado. Los modelos y las referencias se validan en Express. RLS y permisos bloquean acceso público; solo el servidor opera mediante su clave y aplica el filtro de propietario.

Se prepararon los índices de MongoDB en las colecciones api_*. Ambas conexiones aprobaron pruebas HTTP reales con registros temporales que se eliminaron.

English: The database is selected when the user signs in and remains associated with that session. Both repositories expose the same operations, allowing the services to use MongoDB or PostgreSQL without changing their business logic.

Palabras clave: conexiones, sesión, MongoDB, Supabase, variables de entorno.
