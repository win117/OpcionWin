# Tasks

## 0. Punto de partida

- [x] 0.1 Confirmar que `npm run verificar` pasa antes de tocar código y anotar el número de pruebas

## 1. Estructura por dominio vigilada

- [x] 1.1 Extender `tests/estructura.test.cjs` para recorrer `src/modulos/*/`: rutas sin servicios ni repositorios ni verbos sueltos, servicios sin `req`/`res`/express, controladores sin base ni `fetch`, y cada `*.routes.js` con su `*.schema.js`, `*.controller.js` y `*.service.js`; `compartido/` solo admite módulos puros (sin express, `fetch`, `process.env`). Verificar que pasa con `src/modulos/` vacío y que falla con un módulo de prueba que rompe una regla (comprobado temporalmente y borrado)

## 2. Circuit breaker

- [x] 2.1 Crear `src/modulos/compartido/circuito.js` (`createCircuito({ umbral, esperaMs, ahora })` con `permitir`, `exito`, `fallo`, `estado`) y `tests/resiliencia.test.cjs` con los escenarios de la spec: abre a los 5 fallos, un éxito reinicia la cuenta, semiabierto deja pasar una sola prueba, cierra con éxito y reabre con fallo; verificar con `npm test`
- [x] 2.2 Agregar el código `CIRCUITO_ABIERTO` (con `reintentoEnMs`) a `src/integrations/errors.js` e integrar el circuito en `src/integrations/http.js`: consulta antes de cada solicitud, cuenta como fallo solo `RED` o 5xx final, no cuenta 4xx/429; exponer `circuito()` en cada cliente; ampliar `tests/resiliencia.test.cjs` con un `fetch` simulado (abre tras 5 caídas, el siguiente falla sin llamar a `fetch`, 404 no abre)
- [x] 2.3 Mapear `CIRCUITO_ABIERTO` a 503 con `Retry-After` en `src/app.js` y verificar con una prueba HTTP que la respuesta llega en menos de 100 ms, con `Retry-After` y mensaje que nombra al proveedor
- [x] 2.4 `src/integrations/index.js → estado()`: agregar `circuito` a cada proveedor sin quitar campos; verificar con la prueba existente «Integraciones: estado sin revelar valores» y una nueva aserción del circuito abierto
- [x] 2.5 `broker.service.js → clasificarErrorEnvio`: `CIRCUITO_ABIERTO` → `error_previo`; `sincronizacion.service.js`: relanzarlo como `RED`; agregar a `tests/operacion.test.cjs` el escenario «ticket con circuito abierto queda pendiente sin búsqueda de envío incierto»

## 3. Readiness (módulo `salud`)

- [x] 3.1 Crear `src/modulos/salud/` (`salud.schema.js`, `salud.routes.js`, `salud.controller.js`, `salud.service.js`, `index.js` con `montar(app, deps)`): comprobación de MongoDB y Supabase con tope de 2 s, caché de 10 s con una sola comprobación en vuelo, `sin_configurar` si faltan variables, circuitos `degradado`, cola; 200 `listo` / 503 `no_listo` con `motivo`
- [x] 3.2 Montar el módulo en `src/app.js` para `GET /health/listo` sin tocar `/health`; crear `tests/salud.test.cjs` con dependencias inyectadas: listo, ninguna base (503), circuito abierto (200 + degradado), 20 solicitudes → una sola comprobación, sin secretos en la respuesta, `/health` sigue 200 con la base caída; verificar que la prueba de estructura recorre el módulo

## 4. Drenado al apagar

- [x] 4.1 `src/jobs/cola.js`: `drenar()` y `aceptando()`; `limiteOperaciones`: 503 con `Retry-After` en rutas que encolan mientras no acepta, sin crear registro; probar en `tests/plataforma.test.cjs` (cola drenando → 503 y sin registro; trabajo en curso termina y `vaciar()` resuelve)
- [x] 4.2 `src/index.js → shutdown()`: `cola.drenar()` y esperar `vaciar()` hasta 8 s antes de `server.close`; `/health/listo` responde 503 `apagando` durante el drenado; verificar con `tests/start.test.cjs` (o una prueba nueva que arranca `dist/index.js`, envía SIGTERM y comprueba la salida ordenada)

## 5. Documentación y evidencia

- [x] 5.1 Agregar ADR-022 (la 021 ya existía) «Módulos por dominio y resiliencia» a `docs/decisiones/README.md` (contexto, decisión, alternativas, consecuencias) y verificar que la tabla del índice la lista
- [x] 5.2 Crear `docs/guia-opciones/07-ia-vs-manual.md` con la evidencia del inciso B: inventario de APIs clasificadas (manual sin SDD / IA con OpenSpec), comparación de estructuras con un ejemplo de código de cada una y las técnicas de microservicios con su origen; verificar que cada ruta y archivo citado existe

## 6. Verificación integral

- [x] 6.1 Probar a mano con el servidor compilado: circuito de un proveedor apuntado a un host inexistente → 5 fallos y luego 503 inmediato con `Retry-After`; `/health/listo` con la base real; SIGTERM con una sincronización en curso
- [x] 6.2 Ejecutar `npm run verificar` y que pase completo (lint + pruebas + build de la web)

## Workflow follow-up

- Revisar con el usuario, hacer commit y push con su autorización.
- Archivar el cambio con `/openspec-archive-change`.
