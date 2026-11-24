# Integraciones externas

Adaptadores con dependencias inyectables (`fetch`, credenciales, reloj/espera) según
`docs/version-funcional/contratos.md` §4 y ADR-004/005/006. La integración no sustituye los
algoritmos de los cores. Las operaciones con brokers requieren validación y autorización explícita;
eliminar datos locales no cancela órdenes.

| Archivo | Contenido |
|---|---|
| `errors.js` | `IntegrationError { proveedor, status, codigo, mensaje }`, `redactar()` |
| `http.js` | fetch con tiempo límite (15 s), reintentos 429/5xx (máx. 2, exponencial o `Retry-After`), intervalo mínimo entre solicitudes |
| `alpaca.client.js` | Market Data + Trading **paper** (URL fija; live se rechaza con `NO_PERMITIDO`) |
| `sec.client.js` | `company_tickers`, `companyfacts`, `submissions` y tablas 13F |
| `institucionales.js` | Descubre en la SEC qué instituciones reportan un valor en 13F (ninguna está escrita en el código) |
| `webull.client.js` | Pendiente: todos los métodos lanzan `NO_IMPLEMENTADO` |
| `index.js` | `createIntegrations(env, fetch)` → `{ alpaca, sec, webull, estado() }` |

Variables: `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `ALPACA_DATA_FEED` (`iex` por defecto), `SEC_USER_AGENT`,
`INDICES_REFERENCIA` (opcional: ETF de la franja de índices, por defecto `SPY,QQQ,IWM,DIA`; es configuración, sus nombres y precios vienen de Alpaca).

Ritmo de Alpaca: la cuenta permite 200 solicitudes/min. El cliente usa un cubo de fichas (ráfaga de 30, una cada 400 ms: ≤180 por
minuto) y atiende primero órdenes, posiciones y cuenta.

## Códigos de error
`SIN_CREDENCIALES` (faltan claves o 401), `LIMITE` (429 tras reintentos), `NO_ENCONTRADO` (404),
`PROVEEDOR` (otros 4xx/5xx, 403, JSON inválido), `RED` (fallo de red o tiempo agotado).
Extensiones: `VALIDACION` (parámetros inválidos antes de llamar), `NO_PERMITIDO` (trading live),
`NO_IMPLEMENTADO` (Webull). Los mensajes se redactan: nunca contienen claves.
Un POST (orden) solo se reintenta ante 429; ante 5xx no, para no duplicar (además `client_order_id` es idempotente en Alpaca).

## Endpoints usados (documentación verificada 2026-11-16)
Alpaca (encabezados `APCA-API-KEY-ID` / `APCA-API-SECRET-KEY`; paginación `next_page_token` → `page_token`, máx. 20 páginas):
- `GET data /v2/stocks/bars` — https://docs.alpaca.markets/reference/stockbars
- `GET data /v2/stocks/snapshots` — https://docs.alpaca.markets/reference/stocksnapshots-1
- `GET data /v2/stocks/quotes/latest` (referencia de campos `bp/ap`) — https://docs.alpaca.markets/reference/stocklatestquotes-1
- `GET data /v1beta1/options/snapshots/{subyacente}` y `/v1beta1/options/snapshots?symbols=` con `feed=indicative` — https://docs.alpaca.markets/reference/optionchain
- `GET data /v1beta1/news` (máx. 50 por página) — https://docs.alpaca.markets/reference/news-3
- `GET paper /v2/options/contracts` — https://docs.alpaca.markets/reference/get-options-contracts
- `POST paper /v2/orders` (simple y `order_class: mleg` con `legs[{symbol, ratio_qty, side, position_intent}]`), `GET/DELETE /v2/orders/{id}` — https://docs.alpaca.markets/reference/postorder
- `GET paper /v2/positions` — https://docs.alpaca.markets/reference/getallopenpositions
- `GET paper /v2/account`, `GET paper /v2/assets/{simbolo}` — https://docs.alpaca.markets/reference

SEC EDGAR (User-Agent declarado obligatorio; ≤10 req/s, aquí ≥120 ms entre solicitudes):
- https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- https://www.sec.gov/os/accessing-edgar-data (acceso justo)
- `https://www.sec.gov/files/company_tickers.json` (en caché en memoria)
- `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json`
- `https://data.sec.gov/submissions/CIK##########.json` (`filings.recent`, forma `13F-HR`)
- `https://www.sec.gov/Archives/edgar/data/{cik}/{accession sin guiones}/index.json` → XML de la tabla de información
  (`infoTable`: `nameOfIssuer`, `cusip`, `value` en USD, `sshPrnamt`, `sshPrnamtType`, `putCall`).

Descubrimiento 13F (verificado 2026-11-23; `www.sec.gov` rechaza con 403 un User-Agent sin contacto):
- `https://efts.sec.gov/LATEST/search-index?q="CUSIP"&forms=13F-HR&ciks=…&dateRange=custom&startdt=…&enddt=…&from=…`: 100 por página,
  `_id` = `acceso:archivo` de la tabla, `period_ending`, `file_date`, `display_names`. Orden por relevancia; «&» se indexa como «amp»;
  admite `"A" OR "B"`; `from + 100 ≤ 10000`.
- `https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets`: enlaces `…form13f.zip` (~95 MB, el primero es el más reciente).
  Por rangos HTTP solo se leen `SUBMISSION.tsv` y `SUMMARYPAGE.tsv` (`TABLEVALUETOTAL`). Guía: https://www.sec.gov/files/form_13f_readme.pdf

## Limitaciones
- Feed IEX gratuito: volumen y precios parciales (no consolidados). Griegas/IV de opciones `indicative`.
- Fundamentales: se usan los `frame` de SEC (CY####Q#, CY####) para deduplicar; los acumulados YTD sin frame
  (p. ej. flujo operativo de Q2/Q3) no aparecen. `fechaDato` es la fecha de presentación del hecho elegido por SEC,
  que puede ser un comparativo posterior.
- 13F: solo `13F-HR` (sin enmiendas); se excluyen filas `PRN` y opciones (`putCall`). Retraso de hasta 45 días tras el trimestre:
  un corte con menos de la mitad de las presentaciones del anterior no se usa todavía.
- El panel institucional son hasta 12 de las 40 mayores instituciones que reportan el valor; no es el total de tenedores.
  Si la SEC no entrega el ranking, se leen las portadas (`primary_doc.xml`, `tableValueTotal`) de hasta 80 instituciones de tablas
  extensas y se anota en `datosFaltantes`.
- El CUSIP se deduce por nombre de emisor en tablas 13F pequeñas (palabras sin orden ni sufijos); un nombre muy abreviado puede no
  encontrarse. Las tablas (hasta ~23 MB) se leen por trozos y solo se guardan las filas del emisor.
