# Plan — versión funcional

Base: inventario de APIs (inciso A, T2-Actividad 2) y entregas B–H (CRUD en MongoDB/Supabase ya funcionando, 39 pruebas).
Objetivo: que la plataforma **analice** (5 cores + confluencia + selección), **obtenga datos reales** (Alpaca, SEC) y **opere en paper** (Alpaca), con interfaz web.

## Etapas
| # | Etapa | Responsable | Estado |
|---|---|---|---|
| 0 | Respaldo, rama, ADRs, contratos | principal | Hecho |
| 1 | Cores puros + reglas + estrategias + confluencia, con pruebas | agente cores | Hecho (32 pruebas) |
| 2 | Adaptadores Alpaca y SEC con pruebas sin red | agente integraciones | Hecho (19 pruebas; SEC verificado en vivo) |
| 3 | Frontend React + Vite | agente frontend | Hecho (11 páginas, build OK) |
| 4 | Orquestación: cola de trabajos, sincronización, ejecución de cores, selección, confluencia | principal | Hecho (prueba E2E) |
| 5 | Órdenes paper: envío, cancelación, posiciones | principal | Hecho (falta prueba con claves reales) |
| 6 | Integración Express ↔ web/dist, OpenAPI actualizado | principal | Hecho |
| 7 | Verificación real con claves (usuario) y documentación final | principal + usuario | Pendiente |

## Requisitos del usuario para verificar en vivo
1. Completar en `.env`: `SEC_USER_AGENT="AppRESTOpciones tu-correo"`, `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY` (cuenta paper).
2. Crear usuario: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/create-user.ps1` (no existe `private/users.json` todavía).

## Flujo funcional objetivo
Login → registrar empresa (o importarla desde Alpaca) → sincronizar históricos/noticias/fundamentales/13F/opciones →
ejecutar cores → confluencia por estrategia → selección (3 modos) → configuración con contratos reales → evaluación de configuración (payoff) → orden paper → posiciones.

## Bitácora
- 2026-11-16: Etapa 0. Respaldo `backups/00-antes-version-funcional-*.zip`. Rama `version-funcional`.
  SEC_USER_AGENT queda vacío en .env: lo completa el usuario (política de privacidad impide escribir el correo desde el agente).
- 2026-11-16: Etapas 1, 2, 4 y 5. 91 pruebas aprobadas (39 previas + 32 cores + 19 integraciones + 1 flujo E2E).
  Respaldo `backups/01-backend-funcional-*.zip`.

- 2026-11-16: Etapas 3 y 6. Express sirve `web/dist` con respaldo SPA (excepto /api, /health, /assets).
  Listas CRUD ordenadas por `createdAt` descendente (antes por UUID aleatorio). Verificación de conexión devuelve objeto plano.
  Claves Alpaca del usuario devuelven 401: empiezan con `CK` (Broker API), se requieren claves Trading API paper (`PK`).
  Respaldo `backups/02-frontend-integrado-*.zip`.

## Cómo ejecutar
- Desarrollo: `npm.cmd run dev` (API :PORT) y en otra terminal `npm.cmd run dev:web` (Vite con proxy).
- Producción local: `npm.cmd run build:all` y `npm.cmd start` → interfaz en `http://HOST:PORT/`, Swagger en `/api/v1/api-docs`.

## Desviaciones aceptadas respecto a contratos.md
- `sec.cikDeSimbolo` devuelve `{cik, nombre, simbolo}`; `tenencias13F` requiere `filers` (se usa `integraciones.filers13F`, 9 instituciones verificadas en EDGAR).
- Códigos de error extra: VALIDACION, NO_PERMITIDO, NO_IMPLEMENTADO (mapeados a HTTP en app.js).
- Confluencia sin datos: `puntaje 50` y `sesgoCombinado null`; el orquestador lo guarda sin puntaje y en selección como cobertura 0.
- `ganancia_maxima` ilimitada (null) se omite de métricas guardadas (deben ser finitas); se explica en motivos.
- `puntaje` con 2 decimales; tras reglas `sesgo = (puntaje-50)/50`.

## Abierto a debate
- `deuda_capital` usa pasivos totales (SEC no aporta deuda financiera separada).
- Ajuste IV ±15 del Iron Condor heurístico (ADR-002).
- 13F por nombre de emisor puede fallar; agregar campo CUSIP a Empresa mejoraría la coincidencia.
- Tablas 13F grandes (BlackRock ~23 MB) hacen lenta la sincronización institucional.
