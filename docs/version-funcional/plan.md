# Plan — versión funcional

Base: inventario de APIs (inciso A, T2-Actividad 2) y entregas B–H (CRUD en MongoDB/Supabase ya funcionando, 39 pruebas).
Objetivo: que la plataforma **analice** (5 cores + confluencia + selección), **obtenga datos reales** (Alpaca, SEC) y **opere en paper** (Alpaca), con interfaz web.

## Etapas
| # | Etapa | Responsable | Estado |
|---|---|---|---|
| 0 | Respaldo, rama, ADRs, contratos | principal | Hecho |
| 1 | Cores puros + reglas + estrategias + confluencia, con pruebas | agente cores | En curso |
| 2 | Adaptadores Alpaca y SEC con pruebas sin red | agente integraciones | En curso |
| 3 | Frontend React + Vite | agente frontend | En curso |
| 4 | Orquestación: cola de trabajos, sincronización, ejecución de cores, selección, confluencia | principal | En curso |
| 5 | Órdenes paper: envío, cancelación, posiciones | principal | Pendiente |
| 6 | Integración Express ↔ web/dist, OpenAPI actualizado | principal | Pendiente |
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
