# datos-mercado

## Purpose
Traer de los proveedores los datos que necesitan los cores y la pantalla (empresas, velas, cotizaciones, contratos de
opciones con IV y griegas, noticias, fundamentales, tenencias 13F, tasa libre de riesgo y eventos corporativos),
guardarlos en la base de la sesión y servirlos. Alpaca es la fuente de mercado; SEC EDGAR da fundamentales y 13F; el
Tesoro de EE. UU. da la tasa (ADR-004).
Implementación: `routes/integraciones.routes.js`, `routes/mercado.routes.js`, `services/sincronizacion.service.js`,
`services/cadena.service.js`, `services/tasa.service.js`, `services/eventos.service.js`,
`src/integrations/{alpaca,sec,tesoro}.client.js`.

## Requirements

### Requirement: Sincronización por recurso
`POST /sincronizaciones/ejecuciones` SHALL aceptar `recurso` (`empresas`, `historicos`, `cotizaciones`, `contratos`,
`noticias`, `fundamentales`, `institucional`, `posiciones` u `ordenes`), hasta 25 `simbolos`, un rango opcional
`desde`/`hasta` y, para contratos, `diasVencimientoMin`/`diasVencimientoMax`. `posiciones` y `ordenes` MUST exigir
`conexionId`. Se ejecuta como trabajo asíncrono (ver trabajos-asincronos).

#### Scenario: Contratos en un rango de vencimientos
- **WHEN** se sincronizan contratos de AAPL con `diasVencimientoMin: 20` y `diasVencimientoMax: 60`
- **THEN** se guardan solo los contratos que vencen dentro de ese rango

### Requirement: Estado de los proveedores sin revelar claves
`GET /integraciones/estado` SHALL indicar qué proveedores están configurados (Alpaca, Webull, SEC, Tesoro) y MUST NOT
incluir ningún valor de credencial.

#### Scenario: Alpaca sin claves
- **WHEN** faltan `ALPACA_KEY_ID` o `ALPACA_SECRET_KEY`
- **THEN** el estado de Alpaca es `configurado: false` y no se hace ninguna solicitud de red

### Requirement: Búsqueda de activos tolerante
`GET /activos/busqueda` SHALL buscar empresas por símbolo o nombre tolerando errores de escritura, ordenar las grandes
primero y guardar el catálogo en caché 12 horas.

#### Scenario: Nombre mal escrito
- **WHEN** se busca «Mircosoft»
- **THEN** MSFT aparece entre los primeros resultados

### Requirement: Consultas de datos guardados y en vivo
El sistema SHALL distinguir las lecturas de datos guardados (`/mercado/historicos/:simbolo`,
`/mercado/cotizaciones/:simbolo`, `/mercado/opciones`, `/mercado/fundamentales/:simbolo`,
`/mercado/institucional/:simbolo`, `/mercado/noticias`) de las consultas directas al proveedor que no se guardan
(`/mercado/cotizaciones/:simbolo/en-vivo`, `/mercado/opciones/cotizaciones` con hasta 100 contratos OCC,
`/mercado/mapa/:simbolo`).

#### Scenario: Cotización en vivo
- **WHEN** se pide `GET /mercado/cotizaciones/AAPL/en-vivo`
- **THEN** se devuelve la cotización del proveedor y no se crea ningún registro

### Requirement: Cadena de opciones por vencimiento
El sistema SHALL listar todas las fechas de vencimiento de una empresa (`/mercado/opciones/vencimientos/:simbolo`),
devolver la cadena con IV y griegas (`GET /mercado/opciones/cadena/:simbolo`) y permitir traer y guardar un vencimiento
completo (`POST /mercado/opciones/cadena/:simbolo`). El resumen MUST excluir los vencidos y elegir el vencimiento vigente
más cercano. Si la empresa no está registrada o el vencimiento no tiene contratos, MUST responder 404.

#### Scenario: Pedir un vencimiento concreto
- **WHEN** se hace `POST /mercado/opciones/cadena/TSLA` con un vencimiento existente
- **THEN** los contratos se guardan y se devuelven con bid, ask, IV, griegas e interés abierto

### Requirement: Precios fiables fuera de horario
Con el mercado cerrado, la sincronización SHALL conservar la cotización de la última sesión y actualizar solo el último
precio. Una cotización previa a la apertura con spread desmedido, un último precio viejo, `0/0` o un bid de 0 MUST
tratarse como dato faltante y no como precio 0.

#### Scenario: Sincronizar en domingo
- **WHEN** se sincronizan cotizaciones con el mercado cerrado
- **THEN** se mantiene el bid/ask del cierre del viernes

### Requirement: Tasa libre de riesgo y eventos corporativos
`GET /mercado/tasa` SHALL devolver la curva de las letras del Tesoro (fila más reciente, o el mes anterior si aún no hay
filas) e interpolar la tasa para un plazo dado con la misma regla en el servidor y en la web. Si el Tesoro falla, MUST
conservar la última tasa vigente. `GET /mercado/eventos/:simbolo` SHALL devolver los dividendos, las divisiones y el
próximo reporte estimado (mismo trimestre + 364 días); sin historial MUST NOT inventar una fecha.

#### Scenario: Tesoro caído
- **WHEN** el sitio del Tesoro no responde
- **THEN** `GET /mercado/tasa` devuelve la última tasa guardada en memoria

### Requirement: Uso justo de los proveedores
El cliente de Alpaca SHALL respetar como máximo 180 solicitudes por minuto con ráfaga inicial, y dar prioridad a las
operaciones. El cliente SEC MUST enviar un `User-Agent` con contacto y espaciar las solicitudes. Un 429 del proveedor
SHALL reintentarse con espera. Un error del proveedor MUST normalizarse sin filtrar secretos, y un tiempo agotado se
reporta como `RED`.

#### Scenario: SEC sin User-Agent
- **WHEN** no está configurado el `User-Agent` de SEC
- **THEN** el cliente falla antes de hacer cualquier solicitud

### Requirement: Tenencias institucionales 13F
El sistema SHALL descubrir instituciones en la SEC, agrupar las tenencias por corte, CUSIP y nombre, procesar tablas
enormes por trozos y comparar solo trimestres completos. Si un fondo falla, los demás MUST seguir. Si fallan todos, el
error MUST informarse. Ningún CIK MUST quedar escrito en el código.

#### Scenario: Trimestre a medio presentar
- **WHEN** el último trimestre aún no tiene todos los reportes
- **THEN** no se compara contra el anterior
