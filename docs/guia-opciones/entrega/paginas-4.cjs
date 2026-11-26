// Inciso C: pruebas de las APIs (sección 8) y monitoreo (sección 9), con los resultados reales obtenidos.
module.exports = (pag, h) => {
  const { texto, caja, flecha, linea, svg, en, tabla, ul, pasos, nota, codigo } = h;

  // ---------- 8.1 Estrategia de pruebas ----------
  pag('C) 8. Pruebas de las APIs • pirámide de pruebas • servidor de pruebas determinista', `
<h2 class="sec"><mark class="y">C) Realizar las pruebas y monitoreo de los microservicios de las APIs</mark></h2>
<h2>8. Pruebas de las APIs</h2>
<h3>8.1 La estrategia: muchas pruebas pequeñas y pocas grandes</h3>
<p>Las pruebas se organizan como una <b>pirámide</b>. En la base hay muchas pruebas rápidas de piezas aisladas; arriba, pocas pruebas lentas que recorren el sistema completo o lo someten a carga y ataques. Todas se ejecutan con un comando y las rápidas, en cada subida a GitHub.</p>
${svg(640, 215, 'Pirámide de pruebas del proyecto', [
    `<polygon points="320,22 470,190 170,190" fill="none" stroke="#bbb"/>`,
    caja(265, 28, 110, 30, 'Carga · ZAP', 'ro', { fs: 10 }), caja(245, 64, 150, 30, 'E2E (Newman) · smoke', 'na', { fs: 10 }), caja(225, 100, 190, 30, 'Contrato · seguridad OWASP', 'am', { fs: 10 }),
    caja(200, 136, 240, 30, 'Integración (API + base + proveedores)', 'az', { fs: 10 }), caja(175, 172, 290, 28, 'Unitarias (cores, circuito, métricas…)', 've', { fs: 10 }),
    texto(560, 43, 'k6 y ZAP: bajo demanda', { fs: 9.5, color: '#444' }), texto(560, 79, '26 pasos · en cada push', { fs: 9.5, color: '#444' }), texto(560, 115, '12 interacciones · 7 OWASP', { fs: 9.5, color: '#444' }),
    texto(560, 151, 'flujos completos', { fs: 9.5, color: '#444' }), texto(560, 186, '337 pruebas en total', { fs: 9.5, color: '#444', bold: true }),
    texto(80, 43, 'lentas, pocas', { fs: 9.5, color: '#b45f06' }), texto(80, 186, 'rápidas, muchas', { fs: 9.5, color: '#38761d' }),
  ].join(''), 'Cuanto más arriba, más lenta y más completa es la prueba.')}
<h3>8.2 El servidor de pruebas</h3>
<p>Las pruebas grandes corren contra <code>scripts/servidor-pruebas.cjs</code>. Es la <b>app compilada real</b>, pero con una base de datos en memoria, un usuario fijo y proveedores sin credenciales, para no tocar las bases reales ni gastar cuota de Alpaca. El lanzador <code>con-servidor-pruebas.cjs</code> lo levanta, ejecuta la herramienta y lo apaga. Si el puerto ya está ocupado, falla en lugar de usar otro servidor sin avisar: esa protección se agregó después de que un servidor olvidado contaminó una prueba de carga.</p>
${en('Tests are organized as a pyramid: many fast unit tests at the base and a few slow end-to-end, load and security tests at the top. The big tests run against a deterministic test server, the real compiled application with an in-memory database, so they never touch the real data.')}`);

  // ---------- 8.2 Tipos de prueba ----------
  pag('8. Tipos de prueba • herramienta • comando • resultado obtenido', `
<h3>8.3 Cada tipo de prueba que pide la actividad</h3>
${tabla(['Tipo', 'Qué comprueba', 'Herramienta y archivo', 'Comando', 'Resultado'], [
    ['<b>Unitarias</b>', 'Lógica aislada con dobles de prueba', '<code>node:test</code>: cores, circuito, métricas, PWA…', '<code>npm test</code>', '✔'],
    ['<b>Integración</b>', 'API + base + servicios externos simulados', '<code>http</code>, <code>acciones</code>, <code>operacion</code>, <code>repositorios</code>, <code>salud</code>', '<code>npm test</code>', '✔ MongoDB y Supabase'],
    ['<b>Contrato</b> (tipo Pact)', 'La API cumple lo que espera la web', '<code>tests/contrato/web-api.contrato.json</code>', '<code>npm test</code>', '✔ 12/12'],
    ['<b>Funcionales / E2E</b>', 'Flujo completo como un cliente real', 'Postman + <b>Newman</b>', '<code>npm run test:e2e</code>', '✔ 49/49'],
    ['<b>Carga y estrés</b>', 'Volumen y concurrencia', '<b>k6</b> 2.4.0, <code>tests/carga/carga.k6.js</code>', '<code>npm run test:carga</code>', '✔ carga · quiebre a 300'],
    ['<b>Seguridad</b>', 'Vulnerabilidades, inyección, autenticación', '<b>OWASP ZAP</b> 2.17.0 + OWASP API Top 10', '<code>npm run test:seguridad</code>', '✔ sin riesgos reales'],
    ['<b>Smoke</b>', 'Lo esencial tras desplegar', '<code>scripts/smoke-despliegue.cjs</code>', '<code>npm run smoke:despliegue</code>', '✔ 7/7'],
    ['<b>Regresión</b>', 'Que un cambio no rompa lo existente', 'GitHub Actions (<code>pruebas.yml</code>)', 'en cada push', '✔ bloquea Render'],
  ], 'mini')}
${tabla(['Archivo', 'Pruebas', 'Archivo', 'Pruebas', 'Archivo', 'Pruebas'], [
    ['cores', '43', 'plataforma', '17', 'salud', '9'],
    ['integrations', '25', 'universo-vivo', '16', 'estructura', '8'],
    ['estrategias-orden', '25', 'monitoreo', '12', 'seguridad', '7'],
    ['operacion', '20', 'resiliencia', '11', 'pwa · contrato', '4 · 3'],
    ['webull', '17', 'repositorios', '12', 'otros 13 archivos', '96'],
  ], 'mini')}
<p><b>Resultado de <code>npm run verificar</code></b>: <b>337 pruebas aprobadas y 0 fallidas</b>. Una prueba más se salta en Windows, porque la señal SIGTERM solo se puede enviar en Linux; esa corre en GitHub Actions. ESLint no reporta nada y la web compila.</p>
${en('Every kind of test requested by the activity is covered: unit, integration, contract, functional end-to-end, load and stress, security, smoke and regression. The full verification passes with three hundred thirty-seven tests and no failures, and continuous integration blocks any deployment that breaks them.')}`);

  // ---------- 8.3 Contrato y E2E ----------
  pag('8. Pruebas de contrato y E2E • consumidor • proveedor • colección de Postman', `
<h3>8.4 Pruebas de contrato dirigidas por el consumidor</h3>
<p>Una prueba de contrato verifica que el <b>proveedor</b> (la API) entregue lo que el <b>consumidor</b> (la web) necesita. Si alguien cambia un campo que la web usa, la prueba falla antes de publicar.</p>
${svg(640, 120, '', [
    caja(5, 35, 135, 52, 'Consumidor|web/src (React)', 'mo', { fs: 10 }), caja(180, 35, 160, 52, 'web-api.contrato.json|12 interacciones', 'am', { fs: 10 }),
    caja(380, 35, 120, 52, 'Verificador|contrato.test.cjs', 'az', { fs: 10 }), caja(540, 35, 95, 52, 'Proveedor|API real', 'os', { fs: 10, forma: 'hex' }),
    flecha(140, 61, 178, 61, 'declara'), flecha(340, 61, 378, 61, 'lee'), flecha(500, 61, 538, 61, 'ejecuta'),
    texto(320, 108, 'comparadores: uuid · iso-date · oneOf · regex · cadaElemento · ausente', { fs: 9.5, color: '#444' }),
  ].join(''), 'El consumidor declara lo que necesita; el verificador lo comprueba contra la API real.')}
${codigo('tests/contrato/web-api.contrato.json (una interacción)', `{ "descripcion": "lanzar un trabajo largo responde 202 con id y estado",
  "usadoEn": "web/src/hooks/useJob.js",
  "solicitud": { "metodo": "POST", "ruta": "/sincronizaciones/ejecuciones", "sesion": true,
                 "cuerpo": { "recurso": "empresas", "simbolos": [] } },
  "respuesta": { "status": 202, "cuerpo": { "data": { "_id": "uuid",
                 "estado": { "oneOf": ["pendiente", "procesando", "completada", "fallida"] } } } } }`)}
<h3>8.5 Pruebas E2E con Postman y Newman</h3>
${tabla(['Grupo de la colección', 'Qué recorre'], [
    ['1. Plataforma', 'Liveness y readiness (con circuitos, sin caché)'],
    ['2. Sesión', 'Login inválido 400, sin token 401, login, sesión actual'],
    ['3. CRUD', 'Crear 201 + ETag · 400 · paginación · <b>304 condicional</b> · If-Match 200 · versión vieja <b>409</b> · 405'],
    ['4. Análisis', 'Catálogo de estrategias y cores, sincronización <b>202</b> y consulta del trabajo'],
    ['5. Resiliencia', 'Circuitos en el estado; proveedor sin credenciales → 503 claro y sin secretos'],
    ['6. Cierre', 'Borrar → 404, logout 204, token revocado 401'],
  ], 'chica')}
<p><b>Resultado:</b> 26 solicitudes, <b>49 de 49 aserciones</b>, con 5 ms de respuesta promedio. La colección se importa en Postman y también corre en GitHub Actions.</p>
${en('Contract tests let the web declare exactly which fields it needs, and the provider is checked against those twelve interactions. The end-to-end collection walks through six groups of a real client session, including conditional requests, optimistic locking and the resilience responses, and all forty-nine assertions pass.')}`);

  // ---------- 8.4 Carga y estrés ----------
  const barra = (x, valor, max, etiqueta, col) => {
    const alto = Math.max(3, (valor / max) * 120);
    return caja(x, 160 - alto, 90, alto, '', col) + texto(x + 45, 160 - alto - 10, etiqueta, { fs: 10.5, bold: true });
  };
  pag('8. Carga y estrés con k6 • usuarios virtuales • percentil 95 • punto de quiebre', `
<h3>8.6 Carga y estrés con k6</h3>
<p>k6 simula usuarios virtuales que repiten un recorrido: 80 % lectura (listar, leer, estrategias, catálogo de cores), 20 % escritura y consulta de readiness, con medio segundo de pausa. Todos comparten una sesión, porque el login permite 10 intentos por minuto (una protección intencional). Cada prueba tiene <b>umbrales</b>: si no se cumplen, falla.</p>
${tabla(['Prueba', 'Usuarios', 'Solicitudes', 'Por seg.', 'p95', 'p99', 'Errores', 'Umbrales'], [
    ['Humo', '1', '74', '15', '1.8 ms', '10.3 ms', '0 %', '✔'],
    ['<b>Carga</b>', '50 (1 min)', '37 632', '417', '<b>14.3 ms</b>', '33.1 ms', '<b>0 %</b>', '✔ todos'],
    ['<b>Estrés</b>', 'hasta 300', '105 380', '1 052', '303.4 ms', '472.2 ms', '<b>0 %</b>', '✗ listar p95 = 400.3 ms'],
  ], 'chica')}
${svg(640, 200, 'Percentil 95 de la latencia según la concurrencia', [
    linea(60, 160, 600, 160, '#888'), barra(110, 1.8, 400, '1.8 ms', 've'), barra(275, 14.3, 400, '14.3 ms', 've'), barra(440, 400.3, 400, '400 ms (listar)', 'ro'),
    texto(155, 176, '1 usuario', { fs: 10 }), texto(320, 176, '50 usuarios', { fs: 10 }), texto(485, 176, '300 usuarios', { fs: 10 }),
    linea(60, 40, 600, 40, '#b85450', 1, true), texto(66, 32, 'umbral de listar: 400 ms', { fs: 9.5, color: '#b85450', anchor: 'start' }),
  ].join(''), 'Con 50 usuarios la API está holgada; con 300 no falla, pero la latencia sube unas 20 veces.')}
${nota('Lectura de los resultados.', 'Con 50 usuarios simultáneos la API responde el 95 % de las solicitudes en menos de 15 ms y sin un solo error. A 300 usuarios sigue sin errores (1 052 solicitudes por segundo), pero el listado paginado cruza su umbral de 400 ms: ese es el <b>punto de quiebre</b> de un solo proceso de Node. Si hiciera falta, la salida es correr más instancias detrás del balanceador de Render (ADR-003 y ADR-022) y dejar de contar el total en cada página.')}
${en('The load test with fifty virtual users finished with no errors and a ninety-fifth percentile of fourteen milliseconds. The stress test up to three hundred users still had no errors, but the listing endpoint crossed its four hundred millisecond threshold, which marks the breaking point of a single Node process.')}`);

  // ---------- 8.5 Seguridad: OWASP ----------
  pag('8. Pruebas de seguridad • OWASP API Security Top 10 • autorización • inyección', `
<h3>8.7 Seguridad: pruebas propias según el OWASP API Security Top 10</h3>
<p>OWASP publica los diez riesgos más comunes de las API. Un escáner automático no conoce las reglas del negocio (quién es dueño de qué), así que esas se prueban a mano en <code>tests/seguridad.test.cjs</code>:</p>
${tabla(['Riesgo OWASP (2023)', 'Qué se intenta', 'Respuesta de la API'], [
    ['API1 Autorización por objeto (BOLA)', 'Que Beto lea, cambie o borre una empresa de Ana', '404 y no aparece en su lista'],
    ['API2 Autenticación', 'Sin token, token alterado, <code>Basic</code>, token revocado; 11 logins fallidos', '401; fuerza bruta → <b>429</b> + Retry-After'],
    ['API3 Autorización por propiedad', 'Enviar <code>usuarioId</code>, <code>_revision</code> u <code>owner_id</code>', '400 «Campo no editable»; nunca se exponen hashes ni credenciales'],
    ['API4 Consumo de recursos', 'Cuerpo de 1.1 MB, <code>limit=500</code>, lote de 101', '413 y 400'],
    ['Inyección (NoSQL)', '<code>?simbolo[$ne]=x</code>, id <code>{"$ne":null}</code>, <code>../</code>, búsqueda <code>.*</code>', 'No actúan como operadores; la búsqueda escapa expresiones regulares'],
    ['API8 Configuración', 'Origen ajeno, error de JSON', 'CORS cerrado, <code>nosniff</code>, CSP, <code>DENY</code>, sin pila ni <code>X-Powered-By</code>'],
    ['API9 Inventario', 'Rutas y métodos no previstos', '404 / 405'],
  ], 'chica')}
${svg(640, 110, '', [
    caja(5, 30, 130, 50, 'Atacante|(prueba)', 'ro', { fs: 10.5 }), caja(185, 20, 130, 30, 'auth → 401', 'am', { fs: 10 }), caja(185, 58, 130, 30, 'dueño → 404', 'am', { fs: 10 }),
    caja(355, 20, 130, 30, 'validación → 400', 'am', { fs: 10 }), caja(355, 58, 130, 30, 'límites → 429/413', 'am', { fs: 10 }), caja(525, 30, 110, 50, 'Datos|protegidos', 've', { fs: 10.5 }),
    flecha(135, 50, 183, 35), flecha(135, 60, 183, 73), flecha(315, 35, 353, 35), flecha(315, 73, 353, 73), flecha(485, 35, 523, 50), flecha(485, 73, 523, 62),
  ].join(''), 'Cada intento choca con una capa distinta antes de llegar a los datos.')}
${en('Business rules such as who owns each record cannot be discovered by an automatic scanner, so they are tested directly following the OWASP API Security Top 10. Object and property authorization, authentication, resource limits, injection, configuration and inventory are all checked, and all seven tests pass.')}`);

  // ---------- 8.6 ZAP ----------
  pag('8. OWASP ZAP • escaneo dinámico autenticado • triage de alertas', `
<h3>8.8 Escaneo dinámico con OWASP ZAP</h3>
<p>ZAP importó las <b>299 URL</b> de la documentación OpenAPI y las atacó de forma pasiva y activa <b>con sesión iniciada</b>. Envió <b>94 747 solicitudes maliciosas</b> (inyecciones, cabeceras raras, cuerpos malformados) y <b>ninguna produjo un error 500</b>.</p>
${svg(640, 150, 'Cómo respondió la API a 94 747 ataques', [
    caja(5, 30, 300, 26, '400 · validación de entradas · 57 926', 've', { fs: 10 }), caja(5, 62, 140, 26, '404 · 27 411', 'az', { fs: 10 }),
    caja(5, 94, 60, 26, '429', 'am', { fs: 10 }), caja(70, 94, 40, 26, '503', 'na', { fs: 9 }), caja(115, 94, 40, 26, '200', 'gr', { fs: 9 }),
    texto(330, 43, 'entradas malformadas rechazadas antes de tocar los datos', { fs: 10, anchor: 'start' }), texto(160, 75, 'ids inventados o de otro usuario', { fs: 10, anchor: 'start' }),
    texto(160, 107, '8 214 frenadas por el límite de operaciones · 163 proveedores sin credenciales · 1 009 válidas', { fs: 10, anchor: 'start' }),
    caja(5, 126, 630, 20, 'errores 500 (fallas del servidor): 0', 'os', { fs: 10, bold: true }),
  ].join(''), 'El reparto de respuestas muestra que cada capa de defensa hizo su trabajo.')}
${tabla(['Alerta de ZAP', 'Riesgo', 'Análisis', 'Decisión'], [
    ['Spring4Shell (CVE-2022-22965)', 'Alto', '<b>Falso positivo</b>: es una falla de Java/Spring y esta API es Node.js. El 400 que ZAP interpretó es la validación: «Campo no editable: class.module.classLoader…»', 'Marcada como falso positivo en el plan, con su justificación'],
    ['XSS persistente en respuesta JSON', 'Bajo', 'La auditoría devuelve tal cual un id intentado con <code>&lt;script&gt;</code>, pero es JSON con <code>nosniff</code> y React escapa el texto; la web no usa <code>dangerouslySetInnerHTML</code>', 'Riesgo aceptado y documentado'],
    ['User Agent Fuzzer', 'Informativo', 'Respuesta distinta según el navegador en la conexión al broker sin credenciales', 'Sin acción'],
  ], 'mini')}
${nota('Lección del primer intento.', 'El primer escaneo parecía limpio, pero el 48 % de las respuestas eran 401: <b>no estaba autenticado</b>. Una regla guardada en la configuración de ZAP enviaba un token literal. Se corrigió con la autenticación oficial de ZAP, una configuración nueva en cada escaneo y la exclusión de <code>/sesiones</code>, porque el escaneo probaría <code>DELETE /sesiones/actual</code> y revocaría su propio token.')}
${en('The ZAP scan imported every documented route and sent almost ninety-five thousand malicious requests while logged in, and none caused a server error. The only high alert was a false positive for a Java vulnerability, and the low alert was analyzed and accepted. A first unauthenticated run was detected and corrected.')}`);

  // ---------- 8.7 Smoke y regresión ----------
  pag('8. Smoke post-despliegue y regresión • integración continua • GitHub Actions', `
<h3>8.9 Smoke test después de desplegar</h3>
<p>Un <b>smoke test</b> es una revisión rápida de que lo esencial funciona justo después de publicar. <code>npm run smoke:despliegue -- https://&lt;app&gt;.onrender.com</code> comprueba:</p>
${tabla(['Comprobación', 'Resultado en local'], [
    ['Liveness <code>/health</code> (tolera hasta 90 s de arranque en frío de Render)', 'OK · 49 ms'],
    ['Readiness <code>/health/listo</code> con el estado de cada base', 'OK · memoria=ok'],
    ['La web (SPA) se entrega en <code>/</code>', 'OK'],
    ['PWA: manifest con su tipo y <code>sw.js</code> sin caché', 'OK'],
    ['OpenAPI publicada', 'OK · 167 rutas'],
    ['Autenticación activa (sin token → 401)', 'OK'],
    ['Cabeceras de seguridad', 'OK'],
    ['(Con <code>SMOKE_EMAIL</code>) login, integraciones con circuitos y logout', 'Opcional'],
  ], 'chica')}
<h3>8.10 Regresión en cada subida</h3>
${svg(640, 130, 'GitHub Actions (pruebas.yml): nada se publica si algo falla', [
    caja(5, 45, 80, 44, 'push', 'gr'), caja(105, 45, 85, 44, 'lint', 'am'), caja(210, 45, 105, 44, '337 pruebas', 'az', { fs: 10.5 }), caja(335, 45, 85, 44, 'build web', 've', { fs: 10.5 }),
    caja(440, 45, 80, 44, 'E2E|Newman', 'na', { fs: 10 }), caja(540, 45, 95, 44, 'Render|publica', 'os', { forma: 'hex', fs: 10 }),
    flecha(85, 67, 103, 67), flecha(190, 67, 208, 67), flecha(315, 67, 333, 67), flecha(420, 67, 438, 67), flecha(520, 67, 538, 67),
    texto(320, 112, 'además: npm audit de vulnerabilidades altas en lo que se publica', { fs: 9.5, color: '#444' }),
  ].join(''), 'Cada cambio repite todas las pruebas automáticas; Render solo publica si pasan.')}
${en('The smoke test checks in seconds that the published application is alive, ready, secure and serving the web app, and it tolerates the cold start of the free hosting plan. Regression is guaranteed by continuous integration, which repeats lint, every automated test, the build and the end-to-end collection on each push.')}`);

  // ---------- 9.1 Monitoreo: arquitectura ----------
  pag('C) 9. Monitoreo de las APIs • arquitectura • qué se mide y dónde se ve', `
<h2>9. Monitoreo de las APIs</h2>
<p>Las pruebas dicen si la API funciona <b>hoy</b>; el monitoreo avisa cuando deja de funcionar <b>mañana</b>, en producción. Se implementó con OpenSpec (cambio <code>monitoreo-apis</code>) en el módulo <code>src/modulos/monitoreo/</code>, sin dependencias nuevas y con formatos estándar que se conectan a servicios gratuitos.</p>
${svg(640, 292, 'Arquitectura del monitoreo', ['<g transform="translate(0,26)">',
    caja(230, 105, 180, 64, 'API en Render|(módulo monitoreo)', 'os', { fs: 11, forma: 'hex' }),
    caja(5, 15, 150, 40, '/health · /health/listo', 've', { fs: 10 }), caja(5, 210, 150, 40, 'GitHub Actions|cada 15 min', 'gr', { fs: 10 }),
    caja(245, 10, 150, 40, '/metrics (Prometheus)', 'az', { fs: 10 }), caja(485, 10, 150, 40, 'Grafana Cloud|tableros + alertas', 'az', { fs: 10 }),
    caja(485, 80, 150, 40, 'Logs JSON →|logs de Render', 'am', { fs: 10 }), caja(485, 150, 150, 40, 'Errores agrupados →|Sentry', 'ro', { fs: 10 }),
    caja(485, 215, 150, 40, '/monitoreo/uso|analítica', 'mo', { fs: 10 }), caja(5, 115, 150, 44, 'UptimeRobot|cada 5 min', 've', { fs: 10 }),
    flecha(80, 115, 80, 57, 'consulta', { dx: 26 }), flecha(155, 230, 260, 172, 'smoke', { dy: 6 }), flecha(320, 105, 320, 52), flecha(395, 30, 483, 30, 'lee cada 60 s'),
    flecha(410, 125, 483, 100), flecha(410, 150, 483, 170), flecha(395, 168, 483, 232), flecha(155, 137, 228, 137, 'HTTP'),
    texto(320, 205, 'Server-Timing en cada respuesta', { fs: 9.5, color: '#444' }), '</g>',
  ].join(''), 'La API expone su estado en formatos estándar; servicios externos gratuitos lo leen y avisan.')}
<h3>9.1 Los tres pilares de la observabilidad</h3>
${tabla(['Pilar', 'Responde', 'En el proyecto'], [
    ['<b>Métricas</b>', '¿Cuánto? ¿Qué tan rápido? ¿Cuántos errores?', 'Contadores e histogramas en <code>/metrics</code>, leídos por Grafana cada minuto'],
    ['<b>Logs</b>', '¿Qué pasó exactamente en esta solicitud?', 'Una línea JSON por solicitud, con su <code>requestId</code> (el mismo que recibe el cliente en la respuesta)'],
    ['<b>Errores y trazas</b>', '¿Dónde y con qué frecuencia falla?', 'Errores agrupados por huella y <code>Server-Timing</code>; las trazas distribuidas quedan fuera de alcance'],
  ], 'chica')}
${en('Tests tell us the API works today, while monitoring warns us when it stops working in production. The monitoring module exposes health checks, Prometheus metrics, structured logs, grouped errors and usage analytics, and free external services read them to draw dashboards and send alerts.')}`);

  // ---------- 9.2 Siete necesidades ----------
  pag('9. Monitoreo • siete necesidades • implementación • privacidad de los datos', `
<h3>9.2 Cada necesidad de monitoreo y cómo se cubre</h3>
${tabla(['Necesidad', 'Implementación en el proyecto', 'Dónde se ve'], [
    ['<b>Health checks / uptime</b>', '<code>/health</code> (vivo) y <code>/health/listo</code> (bases, circuitos y cola)', 'UptimeRobot'],
    ['<b>APM</b> (latencia, cuellos de botella)', 'Histograma <code>http_duracion_segundos</code> por ruta, <code>Server-Timing</code> en cada respuesta, retraso del event loop', 'Grafana; DevTools del navegador'],
    ['<b>Logging centralizado</b>', '<code>LOG_FORMATO=json</code>: una línea JSON por solicitud (fecha, requestId, ruta, código, ms, usuario seudonimizado)', 'Logs de Render (reenviables a Loki o Better Stack)'],
    ['<b>Error tracking</b>', 'Errores 500 agrupados por huella en <code>/monitoreo/errores</code>; envío opcional a Sentry, sin SDK', '<code>/monitoreo/errores</code>, Sentry'],
    ['<b>Métricas / alertas</b>', '<code>/metrics</code>: solicitudes, duración, errores, memoria, CPU, event loop, circuitos y cola', 'Grafana Cloud'],
    ['<b>Synthetic monitoring</b>', 'Flujo <code>monitoreo-sintetico.yml</code>: el smoke cada 15 min contra la URL publicada', 'GitHub Actions (correo si falla)'],
    ['<b>Rate limiting / analítica</b>', 'Límites existentes + <code>/monitoreo/uso</code>: solicitudes, p50/p95 y rechazos 429/503 por endpoint y usuario', '<code>/monitoreo/uso</code>, Grafana'],
  ], 'chica')}
<h3>9.3 Privacidad y protección</h3>
${ul(['<code>/metrics</code> y <code>/monitoreo/*</code> exigen <code>Authorization: Bearer &lt;MONITOREO_TOKEN&gt;</code>, comparado en tiempo constante. Sin token configurado <b>no existen</b> (404).',
    'Las rutas se etiquetan por <b>patrón</b> (<code>/api/v1/empresas/:id</code>), nunca con ids reales. Así no se filtran datos ni se crea una serie por registro.',
    'El usuario aparece solo como un <b>seudónimo</b>: un hash con sal de 10 caracteres. Logs, métricas y analítica nunca llevan tokens, consultas, cuerpos ni correos, y hay pruebas que lo comprueban.'])}
${en('Each monitoring need of the activity has a concrete implementation: health checks, latency histograms, JSON logs, grouped errors with optional Sentry, Prometheus metrics, synthetic checks every fifteen minutes and usage analytics. Operational endpoints require a separate token, and users only appear as pseudonyms.')}`);

  // ---------- 9.3 Métricas en la práctica ----------
  pag('9. Métricas en la práctica • /metrics • analítica de uso • alertas sugeridas', `
<h3>9.4 Lo que ve un sistema de monitoreo (datos reales tras tráfico de k6)</h3>
${codigo('GET /metrics (extracto)', `http_solicitudes_total{codigo="200",metodo="GET",ruta="/api/v1/empresas"} 10
http_solicitudes_total{codigo="200",metodo="GET",ruta="/api/v1/empresas/:id"} 10
http_duracion_segundos_bucket{le="0.005",metodo="GET",ruta="/api/v1/empresas"} 10
proceso_memoria_bytes{tipo="rss"} 129605632
event_loop_retraso_p99_segundos 0.032604159
circuito_abierto{proveedor="alpaca"} 0
cola_trabajos_en_curso 0
cola_aceptando 1`)}
${tabla(['GET /monitoreo/uso', 'Solicitudes', 'p50', 'p95'], [
    ['POST /api/v1/empresas', '23', '0.5 ms', '0.9 ms'], ['GET /api/v1/empresas', '10', '0.9 ms', '1.8 ms'], ['GET /api/v1/empresas/:id', '10', '0.4 ms', '0.6 ms'],
  ], 'mini')}
<h3>9.5 Paneles y alertas sugeridos en Grafana</h3>
${tabla(['Panel o alerta', 'Consulta (PromQL)', 'Condición de alerta'], [
    ['Solicitudes por segundo', '<code>sum(rate(http_solicitudes_total[5m]))</code>', '—'],
    ['Tasa de error 5xx', '<code>sum(rate(http_solicitudes_total{codigo=~"5.."}[5m])) / sum(rate(http_solicitudes_total[5m]))</code>', '&gt; 5 % durante 5 min'],
    ['Latencia p95 por ruta', '<code>histogram_quantile(0.95, sum by (le, ruta) (rate(http_duracion_segundos_bucket[5m])))</code>', '&gt; 500 ms durante 5 min'],
    ['Proveedor caído', '<code>circuito_abierto</code>', '= 1 durante 2 min'],
    ['Servicio apagándose', '<code>cola_aceptando</code>', '= 0 durante 2 min'],
  ], 'mini')}
${en('After real traffic, the metrics endpoint reports requests and latency per route pattern, memory, event loop delay, circuit states and queue status, and the usage endpoint shows the busiest endpoints with their percentiles. Suggested Grafana alerts fire on high error rates, slow responses, open circuits or a draining service.')}`);

  // ---------- 9.4 Conectar servicios ----------
  pag('9. Conectar los servicios gratuitos • Render • GitHub • UptimeRobot • Grafana • Sentry', `
<h3>9.6 Activarlo en producción, paso a paso</h3>
${pasos(['<b>Render</b> (<i>Environment</i>): definir <code>MONITOREO_TOKEN</code> (largo y aleatorio) y <code>LOG_FORMATO=json</code>; después de crear Sentry, <code>SENTRY_DSN</code>.',
    '<b>GitHub</b> (<i>Settings → Secrets and variables → Actions</i>): variable <code>URL_PRODUCCION</code> con la dirección de Render y, si se quiere probar una sesión real, los secretos <code>SMOKE_EMAIL</code> y <code>SMOKE_PASSWORD</code>. Ejecutar una vez a mano <i>Monitoreo sintético → Run workflow</i>.',
    '<b>UptimeRobot</b> (gratis): un monitor HTTP a <code>/health</code> cada 5 min y otro de palabra clave «listo» en <code>/health/listo</code>, con alerta por correo.',
    '<b>Grafana Cloud</b> (gratis): <i>Connections → Metrics Endpoint</i> con la URL <code>/metrics</code> y autenticación <i>Bearer</i> con el token; crear los paneles y alertas de la sección 9.5.',
    '<b>Sentry</b> (gratis): proyecto Node.js, copiar su DSN a <code>SENTRY_DSN</code> y provocar un error de prueba para verlo agrupado.'])}
${svg(640, 115, '', [
    caja(5, 35, 115, 46, 'Variables|en Render', 'os', { fs: 10 }), caja(140, 35, 115, 46, 'Variable|en GitHub', 'gr', { fs: 10 }), caja(275, 35, 115, 46, 'UptimeRobot', 've', { fs: 10 }), caja(410, 35, 105, 46, 'Grafana|Cloud', 'az', { fs: 10 }), caja(535, 35, 100, 46, 'Sentry|(opcional)', 'ro', { fs: 10 }),
    flecha(120, 58, 138, 58), flecha(255, 58, 273, 58), flecha(390, 58, 408, 58), flecha(515, 58, 533, 58),
  ].join(''), 'Orden recomendado para activar el monitoreo.')}
${nota('Plan gratuito de Render.', 'El servicio se duerme tras 15 minutos sin tráfico. El monitor sintético cada 15 minutos lo mantiene despierto y además mide el arranque en frío; el smoke tolera hasta 90 s en la primera solicitud.')}
${tabla(['Comprobación local del monitoreo', 'Resultado'], [['Sin token / token incorrecto / sesión de usuario como token', '404 / 401 / 401'], ['Patrón de ruta en errores (Express deshace la ruta)', 'Corregido: se captura al coincidir la ruta'], ['Tres 500 iguales con ids distintos', 'Un grupo, conteo 3; Sentry caído no afecta'], ['Pruebas del módulo', '12/12']], 'mini')}
${en('Production monitoring is activated in five steps: environment variables in Render, a repository variable for the synthetic check, two UptimeRobot monitors, a Grafana Cloud metrics endpoint with its alerts and, optionally, Sentry. All the pieces were verified locally before deployment.')}`);
};
