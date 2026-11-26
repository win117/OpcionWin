# cores-analisis

## Purpose
Evaluar una empresa desde cinco ángulos independientes (técnico, indicadores, fundamental, institucional y noticias)
con funciones puras y reproducibles que producen un sesgo direccional, una confianza y una cobertura de datos
(ADR-001 y ADR-002).
Implementación: `src/cores/*.core.js`, `src/cores/{util,reglas,lexico}.js`, `services/evaluaciones.service.js`,
`routes/analisis.routes.js` y `routes/cores.routes.js`.

## Requirements

### Requirement: Cores como funciones puras
Cada core SHALL exportar `VERSION`, `REQUIERE` y `evaluar(input) → resultado` sin entrada/salida (sin red ni base). Con
los mismos datos MUST dar el mismo resultado. Un servicio orquestador carga los datos, llama al core y guarda la
evaluación.

#### Scenario: Reproducibilidad
- **WHEN** se evalúa dos veces el core técnico con las mismas velas y la misma `fechaReferencia`
- **THEN** ambos resultados son idénticos

### Requirement: Resultado común de un core
Todo resultado SHALL incluir `sesgo` entre −1 y 1 (o `null` si no hay datos suficientes), `puntaje = 50 + 50·sesgo`,
`confianza`, `cobertura`, métricas, versión y `datosFaltantes`. El puntaje MUST interpretarse como índice direccional,
no como probabilidad de ganancia.

#### Scenario: Sin datos
- **WHEN** el core fundamental no tiene reportes de la empresa
- **THEN** devuelve `sesgo: null` y lista lo que falta en `datosFaltantes`

### Requirement: Sin sesgo de anticipación
Los cores MUST descartar cualquier dato posterior a `fechaReferencia`.

#### Scenario: Velas futuras
- **WHEN** las velas incluyen días posteriores a `fechaReferencia`
- **THEN** el resultado es el mismo que sin esas velas

### Requirement: Core técnico
El core técnico SHALL calcular tendencia con medias (SMA/EMA), pendiente, ATR y MACD, y dar sesgo positivo en tendencia
alcista y negativo en bajista. Con pocas velas MUST reducir la cobertura y declarar los datos faltantes.

#### Scenario: Tendencia bajista
- **WHEN** las velas forman máximos y mínimos decrecientes
- **THEN** `sesgo < 0`

### Requirement: Core de indicadores
El core de indicadores SHALL medir momentum y volatilidad (RSI de Wilder, Bollinger, volatilidad histórica HV20/HV60) y
comparar la IV promedio de las opciones contra la HV. La IV MUST usar solo contratos dentro del rango de días a
vencimiento y snapshots vigentes. Este core no aporta métricas de tendencia.

#### Scenario: IV mayor que HV
- **WHEN** la IV promedio supera claramente a la HV20
- **THEN** la métrica IV/HV refleja opciones caras

### Requirement: Core fundamental
El core fundamental SHALL comparar año contra año anterior o trimestre contra el mismo trimestre del año previo y
calcular razones financieras a partir de los reportes de la SEC.

#### Scenario: Ingresos crecientes
- **WHEN** los ingresos del último año superan a los del anterior
- **THEN** el sesgo fundamental es positivo

### Requirement: Core institucional
El core institucional SHALL comparar los dos cortes 13F más recientes. Con un solo corte o un reporte aún no publicado
MUST devolver sesgo nulo.

#### Scenario: Un solo corte
- **WHEN** solo existe un trimestre de tenencias
- **THEN** `sesgo: null`

### Requirement: Core de noticias
El core de noticias SHALL medir la polaridad con un léxico en inglés y español que maneja negación, con
`(pos − neg)/(pos + neg)` y decaimiento por antigüedad. Los titulares sin términos MUST NOT diluir el sentimiento.

#### Scenario: Negación
- **WHEN** un titular dice «no es una buena noticia»
- **THEN** cuenta como negativo

### Requirement: Reglas y señales configurables
El sistema SHALL publicar `GET /cores/catalogo` con la versión, los datos requeridos y las señales elegibles de cada
core. Una selección de señales propia filtra; una vacía o ajena usa todas. Las reglas no obligatorias suman o restan
peso. Una regla obligatoria incumplida MUST forzar sesgo neutral y confianza 0.

#### Scenario: Regla obligatoria incumplida
- **WHEN** un perfil exige `rsi < 70` y el RSI es 75
- **THEN** el core devuelve sesgo neutral y confianza 0

### Requirement: Ejecución y consulta de evaluaciones
`POST /cores/:core/evaluaciones` SHALL ejecutar el core sobre los datos sincronizados de `empresaId` como trabajo
asíncrono (202) y MUST responder 404 si el core no existe. `GET /cores/:core/evaluaciones` (paginado) y
`GET /cores/:core/evaluaciones/:id` devuelven lo guardado.

#### Scenario: Core desconocido
- **WHEN** se pide `POST /cores/astrologia/evaluaciones`
- **THEN** responde 404 «Core desconocido»
