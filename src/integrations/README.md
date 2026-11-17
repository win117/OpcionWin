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
| `institucionales.js` | `FILERS_13F`: lista por defecto de filers 13F (CIK verificados) |
| `webull.client.js` | Pendiente: todos los métodos lanzan `NO_IMPLEMENTADO` |
| `index.js` | `createIntegrations(env, fetch)` → `{ alpaca, sec, webull, filers13F, estado() }` |

Variables: `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `ALPACA_DATA_FEED` (`iex` por defecto), `SEC_USER_AGENT`.

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

## Limitaciones
- Feed IEX gratuito: volumen y precios parciales (no consolidados). Griegas/IV de opciones `indicative`.
- Fundamentales: se usan los `frame` de SEC (CY####Q#, CY####) para deduplicar; los acumulados YTD sin frame
  (p. ej. flujo operativo de Q2/Q3) no aparecen. `fechaDato` es la fecha de presentación del hecho elegido por SEC,
  que puede ser un comparativo posterior.
- 13F: solo `13F-HR` de `filings.recent` (sin enmiendas `13F-HR/A`); se excluyen filas `PRN` y opciones (`putCall`).
  Sin CUSIP, la coincidencia es por nombre normalizado (puede fallar con abreviaturas de EDGAR, p. ej. "ALPHABET INC" vs
  "Alphabet Inc." funciona, "MICROSOFT CORP" vs "Microsoft Corporation" funciona, pero nombres abreviados distintos no).
  Retraso de hasta 45 días tras el trimestre. Tablas grandes (BlackRock ~23 MB) se descargan completas.
- Vanguard Group (CIK 102909) presenta 13F-NT desde 2026; sus tenencias están en Vanguard Capital Management y
  Vanguard Portfolio Management. BlackRock presenta como CIK 2012383.
