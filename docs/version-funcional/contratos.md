# Contratos internos y de API — versión funcional

Fuente de verdad para quienes implementan cores, integraciones, servicios y frontend.
Cambiar un contrato = actualizar este archivo + registrar decisión en `docs/decisiones/`.

## 1. Contrato de un core (`src/cores/<core>.core.js`)

Funciones **puras y síncronas**: sin red, sin base de datos, sin `Date.now()` implícito
(la fecha de referencia llega en `input.fechaReferencia`). Mismo input → mismo output.

```js
export const VERSION = 'tecnico@1.0.0';           // core@semver; cambiar al modificar el algoritmo
export const REQUIERE = ['velas'];                // insumos que usa
export function evaluar(input) { return resultado; }
```

### Input
```js
{
  simbolo: 'AAPL',
  fechaReferencia: '2026-11-16T00:00:00.000Z',   // ISO; "hoy" del análisis
  velas: [ { fecha, apertura, maximo, minimo, cierre, volumen } ],   // orden ascendente por fecha
  fundamentales: [ { periodoInicio, periodoFin, forma?, metricas: [ { nombre, valor, unidad, periodo? } ] } ],
  reportes: [ { fechaCorte, fechaPublicacion, tenencias: [ { institucion, identificadorInstitucion, acciones, valorReportado, unidad } ] } ],
  noticias: [ { titulo, resumen?, publicadaEn, proveedor } ],
  opciones: [ { tipo:'call'|'put', strike, vencimiento, bid?, ask?, volatilidadImplicita?, griegas? } ], // opcional
  parametros: { periodos, intervalo, ... },        // parametrosSchema
  reglas: [ { criterio, operador, valorReferencia, valorSuperior?, peso, obligatoria, activo } ] // solo las del core
}
```
Todos los arreglos pueden venir vacíos. El core **nunca inventa** datos: si falta algo lo reporta.

### Resultado
```js
{
  sesgo: -1..1 | null,          // dirección: -1 bajista, 0 neutral, 1 alcista; null si sin datos suficientes
  confianza: 0..1,              // qué tan fuerte/consistente es la señal
  puntaje: 0..100 | null,       // = round(50 + 50*sesgo) tras aplicar reglas; null si sesgo null
  cobertura: 0..1,              // fracción de sub-señales que pudieron calcularse
  metricas: [ { nombre, valor, unidad, periodo? } ],  // nombre en snake_case; valor finito
  motivos: [ 'texto corto en español' ],
  datosFaltantes: [ 'velas<50', ... ],
  reglas: [ { criterio, cumplida: true|false|null, valor } ]  // evaluación de reglas del perfil
}
```
- `puntaje` en evaluaciones de core = **índice direccional** (0 bajista, 50 neutral, 100 alcista).
  La compatibilidad por estrategia la calcula la confluencia, no el core.
- Reglas (`src/cores/reglas.js`, compartido): `criterio` = nombre de una métrica. Operadores eq, ne, gt, gte, lt, lte, between.
  Regla `obligatoria` incumplida → `puntaje` se fuerza a 50 (neutral), `confianza`=0 y motivo explícito.
  Reglas no obligatorias: cada cumplida suma `peso` puntos hacia la dirección del sesgo, incumplida resta; resultado acotado a 0..100.
  Métrica inexistente → `cumplida:null`, se agrega a datosFaltantes.

### Separación de señales (no contar doble)
| Core | Familia de señales |
|---|---|
| indicadores | Osciladores de momentum y volatilidad: RSI, MACD (histograma), estocástico, Bollinger %B, ATR%, volatilidad histórica, IV vs HV si hay opciones |
| tecnico | Tendencia y estructura de precio: precio vs SMA50/SMA200, cruce de medias, pendiente (regresión), máximos/mínimos recientes, distancia a soporte/resistencia, volumen relativo |
| fundamental | Crecimiento de ingresos y utilidad, márgenes, deuda/capital, liquidez corriente, flujo operativo |
| institucional | Cambio de acciones reportadas entre los dos cortes 13F más recientes, # instituciones que aumentan vs disminuyen |
| noticias | Sentimiento léxico propio (finanzas, inglés/español) con decaimiento por antigüedad |

## 2. Confluencia (`src/cores/confluencia.core.js`)
```js
evaluar({ estrategia:'LONG_CALL'|'LONG_PUT'|'IRON_CONDOR', evaluaciones:[{core, sesgo, confianza, puntaje, cobertura}],
          ponderaciones:[{core,peso}], coresSeleccionados:[...], volatilidad?: { ivActual?, hv20?, ivRank? } })
→ { puntaje 0..100, cobertura 0..1, sesgoCombinado, motivos[], ponderacionesEfectivas:[{core,peso}] }
```
- Sesgo combinado = promedio ponderado por `peso × confianza` de cores con datos.
- LONG_CALL: 50+50·s. LONG_PUT: 50−50·s. IRON_CONDOR: 100·(1−|s|), ajustado ±15 por IV alta/baja relativa a HV.
- Cobertura = cores con resultado / cores seleccionados. Core desactivado ≠ evaluación negativa.

## 3. Estrategias / configuración (`src/cores/estrategias.core.js`)
```js
evaluarConfiguracion({ estrategia, componentes:[{tipo, strike, vencimiento, accion, cantidad, precio? }], precioSubyacente?, multiplicador=100 })
→ { valida, errores[], metricas:[ prima_neta, perdida_maxima, ganancia_maxima (null=ilimitada), breakevens..., delta_neta? ], motivos[] }
```
Reglas: LONG_CALL = 1 call buy. LONG_PUT = 1 put buy. IRON_CONDOR = 4 patas mismo vencimiento:
buy put K1 < sell put K2 < sell call K3 < buy call K4, cantidades iguales.

## 4. Adaptadores (`src/integrations/*.client.js`)
Fábricas con dependencias inyectables (`fetch`, credenciales, reloj) para pruebas sin red.
Errores normalizados: `IntegrationError { proveedor, status, codigo: 'SIN_CREDENCIALES'|'LIMITE'|'NO_ENCONTRADO'|'PROVEEDOR'|'RED', mensaje }`.
Ninguna credencial aparece en mensajes de error ni logs.

### Alpaca (`createAlpacaClient({ keyId, secretKey, feed, fetch })`)
Datos: `buscarActivo(simbolo)`, `velas(simbolo,{intervalo,desde,hasta,limite})`, `cotizacion(simbolo)`,
`contratos({subyacente,vencimientoDesde,vencimientoHasta,tipo,strikeMin,strikeMax})`, `snapshotsOpciones(subyacente|simbolos)`, `noticias({simbolos,desde,hasta,limite})`.
Trading (**solo paper**, URL fija `https://paper-api.alpaca.markets`): `cuenta()`, `enviarOrden(orden)`, `consultarOrden(id)`, `cancelarOrden(id)`, `posiciones()`.
Salida ya normalizada a los nombres de los modelos (fecha, apertura, maximo, …; strike, vencimiento, griegas{delta,gamma,theta,vega,rho}).

### SEC (`createSecClient({ userAgent, fetch, esperaMs })`)
`cikDeSimbolo(simbolo)`, `fundamentales(cik)` → periodos con métricas normalizadas
(ingresos, utilidad_neta, activos, pasivos, capital, activo_circulante, pasivo_circulante, flujo_operativo, eps_diluido),
`tenencias13F({ filers:[cik], nombreEmisor, cusip? })` → reportes por corte. ≤10 req/s, User-Agent obligatorio.

## 5. Endpoints nuevos (acciones, además del CRUD existente)
Todos bajo `/api/v1`, con `Authorization: Bearer`. Trabajos asíncronos responden **202** con el registro en estado `pendiente`;
el cliente consulta `GET` hasta `completada|fallida`.

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| GET | /integraciones/estado | — | 200 `{alpaca:{configurado}, sec:{configurado}, webull:{configurado:false}}` |
| POST | /sincronizaciones/ejecuciones | `{recurso, simbolos[], desde?, hasta?, conexionId?}` | 202 Sincronizacion |
| POST | /cores/:core/evaluaciones | `{empresaId, perfilId?, parametros?}` | 202 Evaluacion |
| POST | /selecciones/ejecuciones | campos de Seleccion (incl. `ponderaciones?: [{core, peso>=0}]`, `filtros.indicadores?`) | 202 Seleccion |
| GET | /cores/catalogo | — | 200 `{items:[{core, version, requiere[], senales:[{nombre, etiqueta, descripcion, pesoBase}]}]}` |
| GET | /activos/busqueda | `?q` (1–20 car.) `&limit` (1–50, def. 20) | 200 `{items:[{simbolo, nombre, mercado, opciones, registrada, empresaId?}], total}`; solo negociables; orden: símbolo exacto, prefijo, nombre; lista de Alpaca en caché 12 h por proceso |
| GET | /mercado/opciones/resumen/:simbolo | `?vencimiento=AAAA-MM-DD` (def. el más cercano) | 200 `{empresa:{_id,simbolo,nombre}, precioSubyacente, vencimientos[], vencimiento, items:[{contratoId, simbolo, tipo, strike, vencimiento, bid, ask, ultimo, volatilidadImplicita, griegas, fechaDato}], total}`; solo datos guardados (404 si la empresa no está registrada) |
| POST | /confluencias/ejecuciones | `{empresaId, estrategiaId, evaluacionesIds[], coresSeleccionados[], ponderaciones?}` | 202 Confluencia |
| POST | /configuraciones/:id/evaluaciones | `{precioSubyacente?}` | 202 Evaluacion (core `configuracion`) |
| GET | /mercado/cotizaciones/:simbolo/en-vivo | — | 200 cotización del proveedor (no se guarda) |
| GET | /mercado/opciones/cadena/:simbolo | `?vencimiento&tipo` | 200 contratos + snapshot (proveedor) |
| POST | /ordenes/:id/envio | header `Idempotency-Key` | 200 Orden (estado del broker) |
| POST | /ordenes/:id/cancelacion | — | 200 Orden |
| POST | /conexiones-broker/:id/verificacion | — | 200 estado de cuenta paper |

`griegas` (indicativas de Alpaca, pueden ser `null` por clave): `delta`, `gamma`, `theta`, `vega`, `rho`.
Selección de señales: cada core exporta `SENALES = [{nombre, etiqueta, descripcion, pesoBase}]`; si `parametros.indicadores` (o `filtros.indicadores` en selecciones) contiene alguna señal del core, solo esas entran en `combinar` y se añade el motivo «Señales usadas: … (selección del usuario)»; si no contiene ninguna, se usan todas. Las métricas se reportan siempre.

`recurso` de sincronización: empresas, contratos, cotizaciones, historicos, fundamentales, institucional, noticias, ordenes, posiciones.
Formato de respuesta igual al existente: `{ success, message, data }`; listas `{ items, page, limit, total }`.
