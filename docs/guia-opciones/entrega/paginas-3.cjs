// Inciso B: desarrollo guiado por especificaciones con OpenSpec (sección 6) y técnicas de microservicios con la
// evidencia de qué se hizo con IA y qué de forma manual (sección 7).
module.exports = (pag, h) => {
  const { texto, caja, flecha, linea, svg, en, tabla, ul, pasos, nota, codigo } = h;

  // ---------- 6.1 SDD ----------
  pag('B) 6. SDD con OpenSpec • ¿qué es el desarrollo guiado por especificaciones? • carpetas', `
<h2 class="sec"><mark class="y">B) Aplicar las técnicas para el desarrollo y optimización de microservicios para todas las APIs del proyecto final, usando el framework SDD OpenSpec</mark></h2>
<h2>6. Desarrollo guiado por especificaciones (SDD) con OpenSpec</h2>
<h3>6.1 ¿Qué es SDD?</h3>
<p>En el desarrollo tradicional la idea va directo al código y la documentación llega después, si llega. En el <b>desarrollo guiado por especificaciones</b> (<i>Spec-Driven Development</i>, SDD) primero se acuerda <b>qué</b> debe hacer el sistema, en requisitos que se pueden comprobar, y solo después se programa contra ellos. La ventaja es que una persona revisa el plan <b>antes</b> de que exista el código, cuando corregir es barato.</p>
${svg(640, 150, 'Tradicional frente a SDD', [
    texto(60, 40, 'Tradicional', { fs: 11, bold: true }), caja(120, 25, 90, 32, 'Idea', 'gr'), caja(390, 25, 90, 32, 'Código', 'az'), caja(530, 25, 105, 32, '(Documentación)', 'gr', { fs: 10 }),
    flecha(210, 41, 388, 41, 'directo'), flecha(480, 41, 528, 41),
    texto(60, 105, 'SDD', { fs: 11, bold: true }), caja(120, 90, 60, 32, 'Idea', 'gr'), caja(195, 90, 80, 32, 'Propuesta', 'am'), caja(290, 90, 60, 32, 'Specs', 'am'), caja(365, 90, 60, 32, 'Diseño', 'am'), caja(440, 90, 60, 32, 'Tareas', 'am'), caja(515, 90, 55, 32, 'Código', 'az'), caja(585, 90, 50, 32, 'Archivo', 've', { fs: 9.5 }),
    flecha(180, 106, 193, 106), flecha(275, 106, 288, 106), flecha(350, 106, 363, 106), flecha(425, 106, 438, 106), flecha(500, 106, 513, 106), flecha(570, 106, 583, 106),
    linea(195, 132, 500, 132, '#d79b00', 1.5, true), texto(347, 143, 'revisión humana ANTES de programar', { fs: 9.5, color: '#b45f06' }),
  ].join(''), 'En SDD el acuerdo sobre qué construir se escribe y se revisa antes del código.')}
<h3>6.2 OpenSpec y sus carpetas</h3>
<p><b>OpenSpec</b> es un framework SDD ligero: guarda todo en la carpeta <code>openspec/</code> del repositorio y le da a la IA (aquí, Claude Code) un flujo fijo de comandos.</p>
${tabla(['Carpeta', 'Qué contiene', 'Analogía'], [
    ['<code>openspec/specs/&lt;capacidad&gt;/spec.md</code>', 'Lo que el sistema <b>hace hoy</b>: requisitos con escenarios', 'El plano vigente de la casa'],
    ['<code>openspec/changes/&lt;cambio&gt;/</code>', 'Un cambio en curso: propuesta, specs <i>delta</i>, diseño y tareas', 'Una orden de remodelación'],
    ['<code>openspec/changes/archive/</code>', 'Cambios terminados, con fecha', 'El historial de remodelaciones'],
    ['<code>openspec/config.yaml</code>', 'La <b>constitución</b>: contexto y reglas que la IA lee antes de cada propuesta', 'El reglamento de la obra'],
  ], 'chica')}
${en('Spec-driven development writes down what the system must do before writing code, so a person can review the plan when changes are cheap. OpenSpec keeps the current specifications, the changes in progress, the archived changes and the project constitution inside the repository.')}`);

  // ---------- 6.2 Instalación y constitución ----------
  pag('6. Instalación de OpenSpec • constitución config.yaml • regla de estructura propia', `
<h3>6.3 Instalación paso a paso (sin romper la app)</h3>
${pasos(['Instalar OpenSpec de forma <b>global</b>, para no tocar <code>package.json</code> (Render instala con él): <code>npm i -g @fission-ai/openspec@2.2.0</code>.', 'Probar <code>init</code> en una carpeta vacía para ver qué crea: solo agrega <code>openspec/</code> y 7 comandos para la IA; no modifica nada existente.', 'Inicializar en español y para Claude Code: <code>openspec init --tools claude --language es --scope project</code>.', 'Escribir la constitución (<code>openspec/config.yaml</code>) y comprobarla con <code>openspec doctor</code>, que detectó un error de YAML y se corrigió.', 'Confirmar que la app sigue igual: <code>npm run verificar</code> pasó (lint, pruebas y compilación).'])}
<h3>6.4 La constitución: lo que la IA debe respetar</h3>
<p>La constitución describe el stack, las capas, las reglas que no se negocian (solo paper trading, credenciales por referencia, no es asesoría financiera) y la regla que pide la actividad: <b>si la estructura actual no es la óptima, la IA debe proponer la suya</b>.</p>
${codigo('openspec/config.yaml (extracto)', `## Estructura propuesta por la IA
Si al analizar un cambio la estructura actual no es la óptima, proponer en design.md
la estructura alternativa (con justificación, impacto y plan de migración) en lugar de
solo seguir la existente; la migración se hace como change separado y sin romper los
endpoints actuales (/api/v1).
rules:
  design:
    - Explicar a qué capa pertenece cada pieza (route, controller, service, ...).
    - Si la estructura actual no es óptima para el cambio, proponer la alternativa.
  tasks:
    - "Última tarea siempre: ejecutar npm run verificar y que pase."`)}
${nota('Por qué importa.', 'Sin esta regla, una IA tiende a imitar la estructura que encuentra. Con ella, cada diseño debe evaluar la estructura y justificar si la conserva o la cambia; en el caso de estudio (6.6) eso produjo la estructura por dominio.')}
${en('OpenSpec was installed globally so the project dependencies did not change, and every step was checked with the full verification. The constitution tells the AI the stack, the layers and the rules of the project, including the rule that asks it to propose its own structure when the current one is not optimal.')}`);

  // ---------- 6.3 Specs base y ciclo ----------
  pag('6. Specs base • 11 capacidades documentadas • ciclo propose, apply, archive', `
<h3>6.5 Documentar lo que ya existía y el ciclo de trabajo</h3>
<p>Antes del primer cambio se documentó la app tal como funcionaba: <b>11 capacidades con 73 requisitos</b>, sacados del código y de las pruebas que ya pasaban. Cuatro datos dudosos se verificaron contra el código; por ejemplo, el login responde 200 y no 201.</p>
${tabla(['Capacidad', 'Qué describe', 'Capacidad', 'Qué describe'], [
    ['sesiones-autenticacion', 'Login, token de 1 h, límites', 'brokers-paper', 'Contrato común, solo paper'],
    ['recursos-crud', 'CRUD común, ETag, lotes', 'ordenes-paper', 'Ticket, idempotencia, SSE'],
    ['trabajos-asincronos', '202 + consulta, cola', 'posiciones-cuenta', 'Resumen, cierre en grupo'],
    ['datos-mercado', 'Sincronización, tasa, 13F', 'universo-screener', 'Universo vivo y ranking'],
    ['cores-analisis', 'Los cinco cores puros', 'plataforma-seguridad', 'Capas, OpenAPI, cabeceras'],
    ['estrategias-seleccion', 'Confluencia, Black-Scholes', '', ''],
  ], 'mini')}
${svg(640, 175, 'El ciclo de un cambio en OpenSpec', [
    caja(5, 60, 105, 56, '/openspec-|propose', 'am', { fs: 10.5 }), caja(145, 60, 105, 56, 'Revisión|humana', 'os', { forma: 'hex', fs: 10.5 }), caja(285, 60, 105, 56, '/openspec-|apply-change', 'az', { fs: 10.5 }), caja(425, 60, 95, 56, '/openspec-|archive', 've', { fs: 10.5 }), caja(550, 50, 85, 76, 'openspec/|specs/|(docs. viva)', 'gr', { fs: 10, forma: 'cil' }),
    flecha(110, 88, 143, 88), flecha(250, 88, 283, 88), flecha(390, 88, 423, 88), flecha(520, 88, 548, 88),
    texto(57, 30, ['proposal, specs,', 'design, tasks'], { fs: 9.5, color: '#444' }), texto(337, 30, ['código + pruebas;', 'marca cada tarea [x]'], { fs: 9.5, color: '#444' }), texto(472, 30, ['funde los deltas'], { fs: 9.5, color: '#444' }),
    texto(197, 140, ['si hay ajustes:', '/openspec-update-change'], { fs: 9.5, color: '#444' }), texto(57, 140, ['no toca código'], { fs: 9.5, color: '#b45f06' }),
  ].join(''), 'Proponer, revisar, aplicar y archivar: el archivo convierte los cambios en documentación viva.')}
${ul(['Un cambio describe solo lo que cambia (<i>delta</i>): <code>## ADDED</code>, <code>## MODIFIED</code> (el bloque completo) o <code>## REMOVED</code>.', 'Cada requisito usa SHALL/MUST y trae al menos un escenario «cuando / entonces»; <code>openspec validate --strict</code> lo revisa.'])}
${en('Before changing anything, the existing behavior was documented as eleven capabilities with seventy-three requirements taken from the code and the passing tests. Every change then follows the same cycle: propose, review, apply and archive, and the archive merges the changes into the living specifications.')}`);

  // ---------- 6.4 Caso de estudio ----------
  pag('6. Caso de estudio • optimizar-microservicios-apis • investigación y propuesta', `
<h3>6.6 Caso de estudio paso a paso: <code>optimizar-microservicios-apis</code></h3>
<p><b>Paso 1. Investigar antes de proponer.</b> La IA revisó el código para no proponer lo que ya existía y encontró qué faltaba:</p>
${tabla(['Ya existía (manual)', 'Faltaba'], [
    ['Tiempo límite, reintentos con espera exponencial y limitador hacia los proveedores', '<b>Circuit breaker</b>: con un proveedor caído cada solicitud esperaba 15 s más reintentos'],
    ['ETag y respuesta 304, gzip, paginación, límites de ritmo', '<b>Readiness</b>: <code>/health</code> no sabe si las bases responden'],
    ['Trabajos 202, idempotencia y apagado ordenado', '<b>Drenado</b>: <code>cola.vaciar()</code> existía, pero el apagado no la usaba'],
  ], 'chica')}
<p><b>Paso 2. Proponer.</b> Con un solo comando la IA generó los cuatro artefactos del cambio:</p>
${codigo('Claude Code', `/openspec-propose optimizar-microservicios-apis: circuit breaker por proveedor,
readiness /health/listo, drenado de la cola al apagar; evaluar si la estructura
manual es óptima y, si no, proponer la propia. No romper /api/v1.`)}
${tabla(['Artefacto', 'Contenido'], [
    ['<code>proposal.md</code>', 'Por qué, qué cambia y qué queda <b>fuera</b> (migrar los módulos existentes, varias instancias)'],
    ['<code>specs/</code>', '2 capacidades nuevas (<code>resiliencia-proveedores</code>, <code>salud-servicio</code>, 10 requisitos) y 4 deltas'],
    ['<code>design.md</code>', '<b>Decisión 1: la estructura</b>, con alternativas descartadas (librería <code>opossum</code>, migrar todo, cambiar <code>/health</code>)'],
    ['<code>tasks.md</code>', '15 tareas en 7 grupos; cada una dice cómo se comprueba'],
  ], 'chica')}
<p><b>Paso 3.</b> La propuesta se validó con <code>openspec validate --strict</code> y se revisó <b>antes</b> de autorizar el código.</p>
${en('The case study shows the whole cycle. First the AI inspected the code to avoid proposing what already existed, and it found three missing techniques. Then a single command produced the proposal, the delta specs, the design with its rejected alternatives and fifteen verifiable tasks.')}`);

  // ---------- 6.5 Requisito → prueba ----------
  pag('6. De la especificación a la prueba • requisito • escenario • código de prueba', `
<h3>6.7 Del requisito a la prueba</h3>
<p>Cada escenario de una spec es un caso de prueba. Así se escribió el fallo rápido del circuito y así quedó su prueba automática:</p>
${codigo('openspec/specs/resiliencia-proveedores/spec.md', `### Requirement: Fallo rápido con el circuito abierto
Con el circuito abierto, toda solicitud a ese proveedor SHALL fallar sin contactar la
red con el código CIRCUITO_ABIERTO. La API MUST traducirlo a 503 con Retry-After ...

#### Scenario: Consulta con Alpaca caído
- WHEN el circuito de Alpaca está abierto y se pide GET /mercado/cotizaciones/AAPL/en-vivo
- THEN responde 503 en menos de 100 ms
- AND incluye Retry-After y un mensaje que menciona a Alpaca`)}
${codigo('tests/resiliencia.test.cjs (extracto)', `for (let i = 0; i < 5; i++) await assert.rejects(integraciones.alpaca.cotizacion('AAPL'));
const r = await s.pedir('/mercado/cotizaciones/AAPL/en-vivo');
assert.equal(r.status, 503);
assert.ok(Number(r.headers.get('retry-after')) >= 1);
assert.match(cuerpo.message, /^\\[alpaca\\] .*Reintenta en \\d+ s/);
assert.equal(llamadas, antes, 'no salió a la red');`)}
<p><b>Paso 4. Aplicar.</b> Las 15 tareas se hicieron en orden, y cada una se marcó <code>[x]</code> solo cuando su comprobación pasó. Durante la implementación hubo tres hallazgos, que se resolvieron sin cambiar el alcance:</p>
${ul(['La spec decía «sin búsqueda de envío incierto», pero <b>todo</b> reintento consulta antes al broker, que es una salvaguarda existente. El escenario se precisó a «no queda como envío incierto».', 'La ADR-021 ya existía, así que la nueva decisión es la ADR-022.', 'Una prueba se colgaba porque se conectaba a la base real. Desde entonces, las pruebas inyectan comprobaciones simuladas.'])}
<p><b>Paso 5. Archivar.</b> <code>openspec archive</code> fundió 12 requisitos nuevos y 2 modificados en las specs vivas, que pasaron de 11 a 14 capacidades válidas.</p>
${en('Each scenario in a specification becomes an automated test, so the specification and the code can be compared line by line. Tasks were only marked as done when their checks passed, and three findings during the implementation were documented and solved without changing the scope.')}`);

  // ---------- 7. Técnicas: circuit breaker ----------
  pag('B) 7. Técnicas aplicadas • circuit breaker por proveedor • estados • fallo rápido', `
<h2>7. Técnicas de microservicios aplicadas a todas las APIs</h2>
<h3>7.1 Circuit breaker por proveedor externo</h3>
<p>Un <b>circuit breaker</b> (interruptor) funciona como el de una casa: si un aparato falla una y otra vez, corta la corriente para proteger lo demás. Aquí, si Alpaca, la SEC, Webull o el Tesoro fallan 5 veces seguidas, el servidor deja de llamarlos durante 30 s y responde <b>al instante</b> con un error claro, en lugar de que cada solicitud espere 15 s y arrastre a las APIs que dependen de ellos.</p>
${svg(640, 205, 'Los tres estados del circuito (src/modulos/compartido/circuito.js)', [
    caja(20, 70, 150, 64, 'CERRADO|las solicitudes pasan', 've', { fs: 10.5 }), caja(245, 70, 150, 64, 'ABIERTO|503 inmediato +|Retry-After', 'ro', { fs: 10.5 }), caja(470, 70, 150, 64, 'SEMIABIERTO|pasa UNA prueba', 'am', { fs: 10.5 }),
    flecha(170, 90, 243, 90, '5 fallos seguidos', { dy: -9 }), flecha(470, 120, 397, 120, 'la prueba falla', { dy: 12 }),
    flecha(395, 90, 468, 90, 'pasan 30 s', { dy: -9 }), `<path d="M545,134 C545,190 95,190 95,136" fill="none" stroke="#44546a" stroke-width="1.4" marker-end="url(#mk)"/>`,
    texto(320, 182, 'la prueba funciona → se cierra', { fs: 9.5, color: '#444' }),
    texto(95, 45, ['cuentan: red, tiempo agotado y 5xx', 'NO cuentan: 4xx ni 429'], { fs: 9.5, color: '#444' }),
  ].join(''), 'El circuito se abre con fallos de disponibilidad y se recupera solo con una solicitud de prueba.')}
${tabla(['Comprobación real (código compilado, fallos de red reales)', 'Resultado'], [
    ['Solicitudes 1 a 5 a Alpaca inalcanzable', '502 en unos 40 ms cada una'],
    ['Solicitud 6', '<b>503 en 39 ms</b>, <code>Retry-After: 30</code>, sin salir a la red'],
    ['<code>GET /integraciones/estado</code>', '<code>alpaca.circuito = { estado: "abierto", reintentoEnSegundos: 30 }</code>'],
    ['Orden enviada con el broker caído', 'Queda pendiente y reintentable (<code>error_previo</code>), nunca como envío incierto'],
  ], 'chica')}
${en('A circuit breaker protects the system when an external provider keeps failing. After five availability failures in a row, requests fail immediately with a clear 503 response for thirty seconds, and then a single test request decides whether the circuit closes again. This was verified with real network failures.')}`);

  // ---------- 7.2 Readiness y drenado ----------
  pag('7. Readiness y drenado • /health frente a /health/listo • apagado sin perder trabajos', `
<h3>7.2 Liveness frente a readiness</h3>
${tabla(['', 'Liveness <code>GET /health</code>', 'Readiness <code>GET /health/listo</code> (nuevo)'], [
    ['Pregunta', '¿El proceso está vivo?', '¿Puede atender ahora?'],
    ['Revisa', 'Nada externo', 'MongoDB y Supabase (tope 2 s, caché 10 s), circuitos y cola'],
    ['Responde', 'Siempre 200 si el proceso responde', '200 <code>listo</code> o 503 <code>no_listo</code> con motivo'],
    ['Quién lo usa', 'Render (reinicia si falla)', 'Monitores de disponibilidad y orquestadores'],
    ['Proveedor caído', 'No le afecta', '<code>degradado: true</code>, pero sigue en 200'],
  ], 'chica')}
<p>Con las bases reales del proyecto respondió: <code>200 · listo · supabase ok · mongodb ok · degradado (Alpaca abierto)</code>; la segunda consulta salió de la caché en 1 ms.</p>
<h3>7.3 Drenado al apagar</h3>
<p>En cada despliegue, Render envía la señal SIGTERM. Antes, los trabajos 202 en curso se cortaban y quedaban «huérfanos» 15 minutos. Ahora el servicio deja de aceptar trabajos nuevos, espera a los que están en curso y luego cierra.</p>
${svg(640, 140, 'Línea de tiempo del apagado (src/modulos/salud/apagado.js)', [
    linea(20, 70, 620, 70, '#44546a', 2),
    caja(20, 30, 100, 30, 'SIGTERM', 'os', { fs: 10.5 }), caja(140, 30, 140, 30, 'cola deja de aceptar', 'na', { fs: 10 }), caja(300, 30, 160, 30, 'trabajo en curso termina', 've', { fs: 10 }), caja(480, 30, 140, 30, 'cierre (código 0)', 'az', { fs: 10 }),
    texto(70, 88, '0 ms', { fs: 9.5 }), texto(210, 88, 'inmediato', { fs: 9.5 }), texto(380, 88, '1 505 ms', { fs: 9.5 }), texto(550, 88, '1 515 ms', { fs: 9.5 }),
    texto(320, 118, 'mientras tanto: trabajo nuevo → 503 + Retry-After · /health/listo → no_listo (apagando)', { fs: 10, color: '#b45f06' }),
  ].join(''), 'Prueba real: el trabajo terminó antes del cierre; si tardara más de 8 s, se cierra igual.')}
${en('Liveness and readiness answer different questions: the first says the process is alive, the second says it can serve requests because a database answers. During shutdown the service stops accepting new jobs, lets the running ones finish and only then closes, so deployments no longer cut work in half.')}`);

  // ---------- 7.4 Evidencia IA vs manual ----------
  pag('7. Evidencia: APIs desarrolladas con IA y de forma manual • criterio • inventario', `
<h3>7.4 ¿Qué se desarrolló con IA y qué de forma manual?</h3>
${tabla(['Categoría', 'Qué incluye', 'Cómo se identifica'], [
    ['<b>Manual (sin SDD)</b>', 'Todo lo desarrollado antes de adoptar OpenSpec, dirigido por el equipo y sin especificaciones previas', 'Commits hasta <code>0734dd1</code>; código en <code>src/api/v1/</code>, <code>src/integrations/</code>, <code>src/cores/</code>'],
    ['<b>IA con OpenSpec (SDD)</b>', 'Lo que nació de un cambio de OpenSpec: propuesta → specs → diseño → tareas → código', '<code>openspec/changes/archive/</code> + código en <code>src/modulos/</code> + el commit de cada cambio'],
  ], 'chica')}
${tabla(['API / grupo', 'Endpoints', 'Origen', 'Qué hizo la IA con OpenSpec'], [
    ['Sesiones', '3', 'Manual', '—'],
    ['CRUD común (18 recursos)', '8 c/u', 'Manual', '—'],
    ['Análisis (cores, confluencia, selección, screener)', '9', 'Manual', '—'],
    ['Mercado <code>/mercado/*</code>', '23', 'Manual', '<b>Optimizada</b>: circuito ante Alpaca, SEC y Tesoro'],
    ['Datos de proveedores (estado, búsqueda, sincronizar)', '3', 'Manual', '<b>Optimizada</b>: estado con circuitos; 503 al drenar'],
    ['Operación paper (ticket, envío, cierres…)', '12', 'Manual', '<b>Optimizada</b>: circuito del broker; orden reintentable'],
    ['Trabajos 202 (ejecuciones y evaluaciones)', '5', 'Manual', '<b>Optimizada</b>: 503 + Retry-After al apagar'],
    ['<b>Readiness <code>/health/listo</code></b>', '1', '<b>IA (nueva)</b>', 'Creada completa en la estructura por dominio'],
    ['<b>Monitoreo <code>/metrics</code>, <code>/monitoreo/*</code></b>', '3', '<b>IA (nueva)</b>', 'Cambio <code>monitoreo-apis</code> (inciso C)'],
    ['PWA (manifest, service worker)', '—', '<b>IA</b>', 'Cambio <code>convertir-web-en-pwa</code>'],
  ], 'mini')}
<p><b>En resumen:</b> 68 grupos de rutas manuales (50 acciones + 18 CRUD) y <b>4 APIs nuevas</b> hechas con IA. La IA además <b>optimizó todas</b> las APIs que dependen de un proveedor o de la cola, <b>sin cambiar sus contratos</b>.</p>
${en('The evidence separates the manual work, everything built before OpenSpec without specifications, from the AI work, everything born from an OpenSpec change. Sixty-eight route groups are manual, four new APIs were built with AI, and the AI optimized every API that depends on an external provider or on the job queue.')}`);

  // ---------- 7.5 Técnicas y su origen ----------
  pag('7. Técnicas de microservicios y su origen • manual • IA con OpenSpec', `
<h3>7.5 Técnicas de microservicios del proyecto y su origen</h3>
${tabla(['Técnica', 'Para qué sirve', 'Dónde', 'Origen'], [
    ['Versionado de la API', 'Cambiar sin romper clientes', '<code>/api/v1</code>', 'Manual'],
    ['Una definición por ruta (Zod → OpenAPI)', 'Validar y documentar igual', '<code>api/v1/schemas/</code>', 'Manual'],
    ['Paginación y filtros tipados', 'Respuestas acotadas', '<code>crud.service.js</code>', 'Manual'],
    ['Concurrencia optimista (ETag, If-Match → 409) y 304', 'No pisar cambios; ahorrar red', '<code>crud.controller.js</code>', 'Manual'],
    ['Compresión gzip', 'Menos bytes', '<code>gzip.handler.js</code>', 'Manual'],
    ['Límites de ritmo (429 + Retry-After)', 'Proteger el servicio', '<code>limites.handler.js</code>', 'Manual'],
    ['Trabajos asíncronos (202)', 'No bloquear conexiones', '<code>jobs/cola.js</code>', 'Manual'],
    ['Idempotencia (Idempotency-Key)', 'No duplicar órdenes', '<code>broker.service.js</code>', 'Manual'],
    ['Tiempo límite, reintentos y limitador', 'Tolerar fallos breves', '<code>integrations/http.js</code>', 'Manual'],
    ['Apagado ordenado', 'Cerrar conexiones', '<code>src/index.js</code>', 'Manual'],
    ['<b>Circuit breaker</b>', 'Aislar proveedores caídos', '<code>modulos/compartido/circuito.js</code>', '<b>IA</b>'],
    ['<b>Readiness</b>', 'Saber si puede atender', '<code>modulos/salud/</code>', '<b>IA</b>'],
    ['<b>Drenado al apagar</b>', 'No perder trabajos', '<code>modulos/salud/apagado.js</code>', '<b>IA</b>'],
    ['<b>Módulos por dominio</b>', 'Separar en servicios', '<code>modulos/&lt;dominio&gt;/</code>', '<b>IA</b>'],
    ['<b>Observabilidad</b> (métricas, logs, errores)', 'Ver y avisar', '<code>modulos/monitoreo/</code>', '<b>IA</b>'],
  ], 'mini')}
${nota('Lectura.', 'La base manual ya resolvía bien la validación, la concurrencia y la protección contra abusos. Lo que aportó la IA con OpenSpec son las técnicas de <b>resiliencia y operación</b> que distinguen a un microservicio listo para producción: aislar dependencias, informar si puede atender, apagarse sin perder trabajo y dejarse observar.')}
${en('The manual base already covered validation, concurrency control, rate limits, asynchronous jobs and idempotency. The AI added the resilience and operation techniques of a production-ready microservice: isolating failing dependencies, reporting readiness, draining work on shutdown and exposing metrics, logs and errors.')}`);

  // ---------- 7.6 Estructura manual vs IA ----------
  pag('7. Estructura manual frente a estructura de la IA • capas técnicas • módulos por dominio', `
<h3>7.6 Diferencia en la estructura</h3>
<p>Al evaluar la estructura manual, la IA concluyó que funciona para un monolito por capas, pero que <b>no es óptima para microservicios</b>: una funcionalidad queda repartida por tipo técnico. Ejemplo real: el screener ocupa <b>7 archivos en 5 carpetas</b>, y su definición y su controlador viven en archivos de <i>otro</i> dominio.</p>
<div class="dos"><div>${codigo('Manual: por tipo técnico', `src/api/v1/
  schemas/analisis.schema.js   ← otro dominio
  controllers/analisis.controller.js ← otro
  routes/screener.routes.js
  routes/index.js        ← registrar aquí
  services/screener.service.js
  services/universo-vivo.service.js
  models/Screener.js`)}</div><div>${codigo('IA: por dominio (vertical slice)', `src/modulos/
  compartido/circuito.js   ← pieza pura
  salud/
    salud.schema.js       definición
    salud.routes.js       solo conecta
    salud.controller.js   HTTP ↔ servicio
    salud.service.js      reglas, sin req/res
    apagado.js            ciclo de vida
    index.js  ← única frontera (montarSalud)`)}</div></div>
${tabla(['Aspecto', 'Manual', 'IA con OpenSpec'], [
    ['Carpetas que toca una API nueva', '5 + registro en <code>routes/index.js</code>', '1 + una línea en <code>app.js</code>'],
    ['Archivos de otros dominios que se editan', 'Sí (screener → <code>analisis.*</code>)', 'No'],
    ['Frontera del dominio', 'Implícita', '<code>index.js</code> con dependencias inyectadas'],
    ['Extraerlo como microservicio', 'Cortar a través de todas las carpetas', 'Mover una carpeta'],
    ['Reglas de capas vigiladas por prueba', 'Sí, en <code>src/api/v1/</code>', 'Las mismas, extendidas a <code>src/modulos/</code>'],
  ], 'chica')}
<p>La migración de los módulos existentes quedó como cambio aparte (<code>migrar-a-modulos-por-dominio</code>), para no arriesgar lo que funciona. Así lo pide la constitución.</p>
${en('The AI evaluated the manual structure, organized by technical layers, and concluded that it scatters each feature across many folders. It proposed and implemented domain modules where everything about one domain lives together behind a single entry point, which makes it easy to extract that domain as its own microservice.')}`);

  // ---------- 7.7 Proceso y cambios ----------
  pag('7. Diferencia en el proceso • manual frente a SDD • cambios de OpenSpec por objetivo', `
<h3>7.7 Diferencia en el proceso</h3>
${tabla(['', 'Manual (sin SDD)', 'IA con OpenSpec'], [
    ['Punto de partida', 'Una idea o un error; se programa directo', 'Una propuesta con por qué, qué cambia y qué queda fuera'],
    ['Qué se acuerda antes del código', 'Nada formal (a veces una ADR después)', 'Requisitos con escenarios, diseño con alternativas y tareas verificables'],
    ['Revisión humana', 'Sobre el código terminado', 'Sobre la propuesta, <b>antes</b> de programar'],
    ['Pruebas', 'Se escriben junto al código', 'Salen de los escenarios de la spec'],
    ['Cierre', 'Commit', 'Archivo: las specs vivas se actualizan solas'],
    ['Reglas del proyecto', 'En las ADR y en la memoria del equipo', 'En <code>config.yaml</code>, que la IA lee siempre'],
  ], 'chica')}
<h3>7.8 Cambios de OpenSpec del proyecto</h3>
${tabla(['Cambio', 'Para qué', 'Resultado'], [
    ['Specs base', 'Documentar lo existente', '11 capacidades, 73 requisitos'],
    ['<code>convertir-web-en-pwa</code>', 'PWA instalable (inciso A, punto 5)', '9 requisitos, 20 tareas, archivado'],
    ['<code>optimizar-microservicios-apis</code>', 'Inciso B', '12 requisitos nuevos + 2 modificados, 15 tareas, +23 pruebas'],
    ['<code>monitoreo-apis</code>', 'Inciso C (monitoreo)', '9 requisitos, 10 tareas, +12 pruebas'],
  ], 'chica')}
${svg(640, 110, '', [
    caja(5, 35, 120, 46, '11 capacidades|(base)', 'gr', { fs: 10 }), caja(165, 35, 120, 46, '+ PWA', 'mo'), caja(325, 35, 120, 46, '+ resiliencia|y salud', 'az', { fs: 10 }), caja(485, 35, 150, 46, '15 capacidades|vivas y válidas', 've', { fs: 10, bold: true }),
    flecha(125, 58, 163, 58), flecha(285, 58, 323, 58), flecha(445, 58, 483, 58, '+ monitoreo', { dy: -12 }),
  ].join(''), 'Cada cambio archivado amplió la documentación viva: de 11 a 15 capacidades.')}
${en('The difference is not only in the folders but in the process: with OpenSpec the agreement comes first, a person reviews it before any code exists, the tests come from the scenarios and archiving keeps the documentation up to date. Three changes took the living specifications from eleven to fifteen capabilities.')}`);
};
