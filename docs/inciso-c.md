# C. Clases modelo del proyecto final

## Descripción de la actividad

Se definieron las entidades del proyecto de análisis de opciones mediante esquemas y modelos Mongoose. Los modelos establecen campos obligatorios, tipos, valores permitidos, relaciones declaradas e índices previstos. Los subdocumentos permiten representar los componentes de una configuración y las reglas de un perfil.

Una entidad puede ser compartida por varias APIs. No se crea una clase diferente para GET, POST, PUT y DELETE. Las operaciones individuales y por lote utilizarán los mismos modelos.

## Modelos por módulo

| Módulo | Modelo / colección | Información principal |
|---|---|---|
| Empresas | Empresa / empresas | Símbolo, nombre, mercado, sector, CIK y estado |
| Estrategias | Estrategia / estrategias | Código LONG_CALL, LONG_PUT o IRON_CONDOR, nombre y descripción |
| Configuraciones | Configuracion / configuraciones | Propietario, empresa, estrategia, parámetros y componentes |
| Perfiles de análisis | PerfilAnalisis / perfiles_analisis | Propietario, cores seleccionados, parámetros, reglas y versión |
| Brokers | Broker / brokers | Código, nombre, entornos y activación |
| Conexiones con brokers | ConexionBroker / conexiones_broker | Propietario, broker, entorno, cuenta externa y referencia privada de credenciales |
| Sesiones | Sesion / sesiones | Usuario, base seleccionada, hash del token, expiración y revocación |
| Mercado: contratos | ContratoOpcion / contratos_opciones | Identificador del proveedor, empresa, tipo, strike, vencimiento y multiplicador |
| Mercado: precios | DatoMercado / datos_mercado | Cotización, vela o snapshot, fuente, fecha, volumen, IV y griegas |
| Mercado: fundamentales | Fundamental / fundamentales | Periodo reportado, fuente y métricas con unidades |
| Mercado: institucional | ReporteInstitucional / reportes_institucionales | Corte, publicación y tenencias reportadas |
| Mercado: noticias | Noticia / noticias | Proveedor, identificador, título, URL, publicación y símbolos |
| Cores y evaluación de configuraciones | Evaluacion / evaluaciones | Contexto, versión del algoritmo, parámetros, reglas aplicadas, fuentes, métricas, motivos y cobertura |
| Selecciones | Seleccion / selecciones | Modo empresa/estrategia/ambas, candidatos, filtros y resultados |
| Confluencia | Confluencia / confluencias | Evaluaciones, cores seleccionados, ponderaciones, puntaje y motivos |
| Órdenes | Orden / ordenes | Conexión, configuración, idempotencia, tipo, precio, componentes y eventos |
| Posiciones | Posicion / posiciones | Contrato, conexión, lado, cantidad, precio promedio y fecha |
| Sincronizaciones | Sincronizacion / sincronizaciones | Recurso, proveedor, periodo, estado y conteos |
| Auditoría | EventoAuditoria / eventos_auditoria | Actor, acción, recurso, resultado, request y fecha |

Los brokers se crean inactivos por defecto: declarar su nombre no confirma que una cuenta tenga permisos ni que la integración esté disponible.

## Subdocumentos

- Componente.js: contrato, acción buy/sell, cantidad y proporción. Integrado en Configuracion.
- ReglaAnalisis.js: core, criterio numérico, operador, umbral, peso y obligatoriedad. Integrado en PerfilAnalisis.
- shared.js: esquemas reutilizables de fuentes, griegas, parámetros, métricas, tenencias, resultados, ponderaciones, componentes de órdenes y eventos.
- Cada subdocumento administrable tiene identificador propio. Componentes y reglas no generan colecciones separadas.
- Las evaluaciones disponen de reglasAplicadas para conservar una copia de las reglas utilizadas; copiarla y evitar cambios retrospectivos será responsabilidad del servicio.

## Convenciones y validaciones

- Identificadores nuevos: cadenas UUID generadas localmente.
- Fechas de creación y actualización automáticas mediante timestamps.
- Campos desconocidos rechazados con strict: 'throw'.
- Cores seleccionados no vacíos, válidos y sin duplicados.
- Cantidades de componentes: enteros positivos; sin identificadores duplicados dentro del padre.
- Parámetros: rangos de fechas y vencimientos coherentes.
- Reglas: criterios numéricos y operadores eq, ne, gt, gte, lt, lte o between. Las reglas de texto/categóricas no están incluidas en esta versión.
- Velas: apertura, máximo, mínimo, cierre, volumen e intervalo obligatorios; extremos coherentes.
- Reportes institucionales: publicación posterior o igual al corte. No representan flujo institucional en tiempo real.
- Órdenes: entre uno y cuatro componentes, intención coherente con buy/sell y precio obligatorio para limit. El precio puede ser negativo para representar crédito según el contrato del adaptador.
- Secretos: se almacena referencia a credenciales, no claves de brokers; los hashes y referencias privadas se excluyen de la serialización ordinaria.
- Puntajes y cobertura: rangos 0–100 y 0–1, respectivamente.

## Persistencia y alcance

Los modelos implementados son Mongoose para MongoDB. No crean tablas SQL. La correspondencia de entidades para la implementación SQL será la misma; componentes y reglas deberán mapearse explícitamente como tablas relacionadas o estructuras JSON validadas. La elección y creación del esquema SQL, el cliente de Supabase y la selección por sesión siguen pendientes de la configuración y repositorios posteriores. No se debe usar un modelo Mongoose como si fuera un cliente SQL.

autoCreate y autoIndex están desactivados en estos modelos: importarlos no crea colecciones ni índices. Los índices únicos y el índice de expiración de sesiones están declarados; deberán provisionarse y probarse contra la base en la etapa de integración. unique es un índice, no una validación local de duplicados.

Las referencias no verifican por sí mismas la existencia ni la pertenencia al usuario de otros documentos. Los servicios deberán comprobarlo. Tampoco el esquema sustituye autenticación, autorización, revocación efectiva de tokens ni idempotencia del broker.

Los servicios deberán cargar y validar el documento completo antes de aplicar cambios que afecten reglas entre campos o subdocumentos. Los validadores de actualizaciones parciales no equivalen a document.validate(). No se ha implementado el CRUD en este inciso.

Queda para los servicios verificar que los contratos y sus strikes, vencimientos e intenciones formen correctamente Long Call, Long Put o Iron Condor, consultar permisos de cuenta y normalizar el contrato de cada broker. Las cantidades y los precios aquí son representaciones numéricas; para cálculos y conciliación monetaria se deberá fijar precisión y redondeo, sin confiar en aritmética binaria para dinero.

No hay modelo de contraseñas: usuarioId identifica al usuario que posteriormente proveerá el mecanismo de autenticación.

## Respaldo y pruebas

Antes de cambiar los modelos se creó un respaldo del código y documentos:
backups/estado-antes-inciso-c-20261116-064950.zip.
El respaldo completo anterior al inciso B también se conserva.

Comando:
```sh
npm.cmd run check:models
```

Resultado: 29 pruebas aprobadas y 94 archivos compilados. Las pruebas verifican documentos válidos, errores de validación, subdocumentos, reglas cruzadas, privacidad de serialización e índices declarados. No se abrieron conexiones ni se escribieron registros.

## Evidencias para la tarea

1. Explorador con los modelos del proyecto.
2. Empresa.js y Estrategia.js: campos obligatorios y catálogo.
3. Configuracion.js y Componente.js: arreglo de subdocumentos.
4. PerfilAnalisis.js y ReglaAnalisis.js: reglas y validaciones.
5. Resultado de npm.cmd run check:models.

## English paragraph

The data models define the structure and validation rules of the application entities. Configurations contain option components, while analysis profiles contain rules for the selected cores. Local validation tests verify these structures before the services and database integrations are implemented.

## Palabras clave

Modelos de datos · Mongoose · Entidades · Validaciones · Subdocumentos · Relaciones

Collage sugerido: entidades → modelos → validación → documentos con subdocumentos → persistencia.

## Referencias técnicas

- https://mongoosejs.com/docs/validation.html
- https://mongoosejs.com/docs/subdocs.html
