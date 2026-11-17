# Frontend web (React + Vite)

Interfaz en español para analizar Long Call, Long Put e Iron Condor con los cinco cores
(técnico, fundamental, institucional, indicadores, noticias) y la confluencia. Ver ADR-007.

## Uso

```powershell
cd web
npm.cmd install
npm.cmd run dev      # http://localhost:5173 con proxy /api y /health → http://localhost:3020
npm.cmd run build    # genera web/dist (Express la sirve en "/" en producción)
```

Para otro backend: `$env:VITE_API_TARGET = 'http://localhost:4000'; npm.cmd run dev`
(o un archivo `web/.env.local` con `VITE_API_TARGET=...`).

En producción, Express debe servir `web/dist` y devolver `index.html` para cualquier ruta
que no sea `/api` ni `/health` (las rutas del cliente son de `react-router`).

## Estructura

- `src/api/client.js`: fetch con token de `sessionStorage`, JSON y errores → `ApiError`; 401 cierra sesión.
- `src/api/resources.js`: CRUD por recurso (list/get/create/update con If-Match/remove/lote/subdocumentos),
  endpoints de acción y rutas de sondeo de trabajos.
- `src/hooks/useJob.js`: sondeo de trabajos 202 cada 1,5 s hasta `completada|fallida` (máx. 5 min).
- `src/components/`: Table, Modal, Field, SchemaForm, ResourceManager, SubdocEditor, Badge, JobStatus,
  SyncButton, Gauge, CandleChart (lightweight-charts), PayoffChart (SVG).
- `src/pages/`: Login, Panel, Empresas, Estrategias, Mercado (+ pestañas), Análisis, Selección,
  Perfiles, Configuraciones, Broker, Sincronizaciones, Auditoría.

## Notas

- Los listados del backend se ordenan por `_id` (UUID); para "lo más reciente" el cliente descarga
  las páginas (100 por página) y ordena por fecha.
- Nunca se inventan datos: cada vista muestra la fuente y fecha del dato o un estado "sin datos".
- Órdenes solo en Alpaca paper. El envío usa `Idempotency-Key` = `idempotencyKey` guardado en la orden.
- Sin `dangerouslySetInnerHTML`; no hay secretos en el cliente.
