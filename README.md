# AppRESTOpciones

Plataforma para analizar opciones (Long Call, Long Put e Iron Condor): API REST en Express, cinco cores de análisis, frontend en React y operación simulada en Alpaca y Webull. **Solo paper**: el entorno real está bloqueado en el código.

## Cómo está hecho

```
web/            React: pantallas, componentes y una sola puerta a la API (web/src/api)
src/app.js      Express: middlewares, rutas, página compilada y errores
src/api/v1/
  routes/       verbo + dirección → controlador (CRUD común o registrar())
  schemas/      cada ruta que no es CRUD, descrita una vez con Zod: valida y documenta
  controllers/  HTTP ↔ servicio
  services/     reglas
  models/       qué datos son válidos (Mongoose, sin guardar)
src/repositories/  MongoDB o Supabase, con las mismas funciones; siempre por propietario
src/cores/         cálculos puros: técnico, fundamental, institucional, indicadores, noticias, confluencia
src/integrations/  Alpaca, SEC, Tesoro de EE. UU. y Webull; contrato-broker.js define qué debe tener un broker
src/jobs/          cola de trabajos (respuestas 202)
```

`tests/estructura.test.cjs` vigila estas reglas: si una ruta no está documentada, un servicio usa HTTP o un core usa internet, la prueba falla.

## Puesta en marcha

1. Node 22 o superior. `npm ci` y `npm --prefix web ci`.
2. Copiar `.env.example` a `.env` y llenar las claves (paper).
3. Supabase: ejecutar `database/schema.sql`. MongoDB: `npm run setup:mongodb` (índices).
4. Crear un usuario: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/create-user.ps1`.
5. `npm run build:all` y `npm start`.

Documentación de la API: `/api/v1/api-docs` (Swagger) y `/api/v1/openapi.json`. Estado del proceso: `/health`.

## Comprobaciones

- `npm run verificar`: ESLint, pruebas y compilación de la página. Es lo mismo que ejecuta GitHub Actions en cada subida.
- `npm run test:databases`: prueba real en ambas bases con datos temporales.
- `scripts/smoke-*.cjs`: pruebas reales en paper, con el mercado abierto. No se cortan a la mitad.
- `scripts/backtest/`: comprobaciones históricas, solo lectura.

## De dónde salen los datos

Nada de empresas está escrito en el código.

- **Alpaca:** precios, opciones, noticias, dividendos anunciados, divisiones, interés abierto y precios históricos de contratos.
- **SEC:** universo, fundamentales, 13F y fechas de reportes de resultados (la próxima es una estimación).
- **Tesoro de EE. UU.:** tasa libre de riesgo, a diario.
- **TradingView:** solo una gráfica para mirar, en un marco aislado; no alimenta ningún cálculo.

## Límites

- El puntaje mide qué tan alineados están los factores; no es la probabilidad de ganar (ver ADR-014 y ADR-020).
- Webull acepta órdenes de opciones de 9:30 a 16:00 de Nueva York, y las de varias patas solo con límite.
- Los avisos de órdenes en vivo son de Alpaca; con Webull el servidor pregunta cada 3 segundos.
- La cola, el universo y los seguimientos viven en la memoria del proceso: un solo servidor.
- Los lotes devuelven resultado por elemento y no son una transacción.
- Usuarios creados por consola; no hay registro público.

Las decisiones están en [docs/decisiones](docs/decisiones/README.md) y el avance en [docs/version-funcional/plan.md](docs/version-funcional/plan.md). `backups/` y `private/` contienen secretos locales: no se suben a Git.
