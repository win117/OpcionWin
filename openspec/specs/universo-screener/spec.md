# universo-screener

## Purpose
Mantener vivo un universo de empresas con opciones (catálogo, cotizaciones, capitalización, sector e IV) y, a partir de
lo ya calculado, ofrecer el tablero «Mercado hoy», el mapa, los movimientos y un ranking de empresas por estrategia, sin
llamar al proveedor en cada consulta.
Implementación: `services/universo-vivo.service.js`, `services/catalogo-universo.service.js`,
`services/screener.service.js`, `services/mercado-estado.service.js`, `services/mercado-reloj.service.js`.

## Requirements

### Requirement: Catálogo del universo desde los proveedores
El catálogo SHALL construirse con los datos de los proveedores (sin listas de empresas escritas en el código), exigir
que la empresa tenga opciones y descartar las extranjeras y las dadas de baja. La capitalización con errores de unidades
MUST descartarse, y el sector se deduce del código SIC.

#### Scenario: Empresa sin opciones
- **WHEN** un activo listado no tiene contratos de opciones
- **THEN** no entra al universo

### Requirement: Evaluación continua de los cinco cores
El universo SHALL evaluar los cinco cores de todas sus empresas, cada core a su propio ritmo, y reutilizar lo guardado
tras un reinicio. Si un proveedor falla, los demás cores MUST seguir y el fallo debe avisarse.

#### Scenario: Reinicio del servidor
- **WHEN** el servidor arranca con datos guardados y el proveedor caído
- **THEN** la fase del universo es «lista» y el ranking está disponible al instante

### Requirement: Recuperación ante catálogo caído
Si el catálogo no se puede obtener, el sistema SHALL reintentar con espera creciente de 1 a 30 minutos, mostrar el error
y recuperarse solo cuando el proveedor vuelva.

#### Scenario: Proveedor caído
- **WHEN** el catálogo falla tres veces seguidas
- **THEN** los reintentos se espacian cada vez más, sin pasar de 30 minutos

### Requirement: Estado y panorama del mercado
`GET /mercado/estado` SHALL devolver el reloj del mercado (abierto o cerrado, próxima apertura y cierre) y los índices de
referencia (configurables con `INDICES_REFERENCIA`; SPY, QQQ, DIA e IWM por defecto) con nombre, precio y variación, y
MUST usar caché. `GET /mercado/panorama` SHALL dar el cambio contra el cierre previo, y el error de un símbolo MUST NOT
afectar a los demás.

#### Scenario: Índice sin nombre en Alpaca
- **WHEN** Alpaca no da el nombre de un índice configurado
- **THEN** se muestra su símbolo

### Requirement: Mapa y movimientos desde memoria
`GET /mercado/mapa` y `GET /mercado/movimientos` (alzas, bajas y volumen inusual) SHALL responder desde memoria, sin
consultar al proveedor. Ante varias solicitudes simultáneas, el mapa MUST actualizarse una sola vez, y si el proveedor
falla MUST devolver el último valor.

#### Scenario: Solicitudes simultáneas
- **WHEN** llegan 10 solicitudes de mapa a la vez con la caché vencida
- **THEN** se hace una sola actualización

### Requirement: Ranking por estrategia
`GET /screener/ranking` SHALL ordenar las empresas del universo por compatibilidad con LONG_CALL, LONG_PUT o IRON_CONDOR
leyendo solo lo ya calculado. Los empates MUST resolverse por el factor principal, no por orden alfabético.

#### Scenario: Tendencia alcista
- **WHEN** una empresa tiene una tendencia alcista clara
- **THEN** obtiene mejor posición para LONG_CALL que para LONG_PUT
