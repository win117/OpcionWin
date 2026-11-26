// Secciones 3 (brokers), 4 (estructura, APIs y cores), 5 (PWA), conclusión, glosario y referencias.
module.exports = (pag, h) => {
  const { texto, caja, flecha, linea, svg, en, tabla, ul, pasos, nota, codigo } = h;

  // ---------- Sección 3 ----------
  pag('3. Operativa en brokers • ¿qué es un broker? • tipos de cuenta • permisos • margen', `
<h2>3. Operativa de estrategias en los brokers</h2>
<h3>3.1 ¿Qué es un broker y qué se necesita para operar opciones?</h3>
<p>Un <b>broker</b> es la empresa autorizada que recibe las órdenes del inversionista y las lleva a la bolsa. El proyecto trabaja con dos: <b>Alpaca</b> (que además entrega los datos de mercado) y <b>Webull</b>. En ambos solo se usan <b>cuentas simuladas</b>.</p>
${tabla(['Concepto', 'Qué es', 'Por qué importa para las estrategias asignadas'], [
    ['Cuenta cash', 'Solo se opera con el dinero depositado', 'Alcanza para comprar calls y puts (Long Call, Long Put)'],
    ['Cuenta de margen', 'El broker retiene una garantía y permite operaciones con riesgo de pérdida mayor a lo pagado', 'Necesaria para vender opciones, como las patas cortas del Iron Condor'],
    ['Nivel de opciones', 'Permiso que da el broker según la experiencia del cliente', 'Nivel 2: comprar calls y puts. <b>Nivel 3: spreads como el Iron Condor</b>'],
    ['Poder de compra', 'Dinero disponible para nuevas órdenes', 'El ticket de la app lo compara con lo que la orden requiere'],
    ['Margen requerido', 'Garantía que el broker aparta', 'En un Iron Condor = pérdida máxima = (ancho − crédito) × 100'],
  ], 'chica')}
${svg(640, 150, '¿Qué permiso necesita cada estrategia?', [
    caja(10, 45, 160, 55, 'Long Call|Long Put', 've', { bold: true }), caja(240, 45, 160, 55, 'Nivel 2|cuenta cash', 'az'),
    caja(10, 105, 160, 40, 'Iron Condor', 'mo', { bold: true }), caja(240, 105, 160, 40, 'Nivel 3 + margen', 'na'),
    caja(470, 70, 160, 55, 'Cuenta simulada|(paper) del proyecto', 'os', { forma: 'hex', fs: 10 }),
    flecha(170, 72, 238, 72), flecha(170, 125, 238, 125), flecha(400, 72, 468, 90), flecha(400, 125, 468, 105),
  ].join(''), 'Las cuentas paper de Alpaca vienen con nivel 3, suficiente para las tres estrategias.')}
${en('A broker is the authorized company that receives orders and sends them to the exchange. To trade options, the account needs an options approval level: level two allows buying calls and puts, and level three allows spreads such as the Iron Condor, which also requires a margin account.')}`);

  pag('3. Tipos de orden • market • limit • day • gtc • multi-pata • position_intent • idempotencia', `
<h3>3.2 Tipos de orden y conceptos de operación</h3>
${tabla(['Concepto', 'Qué significa', 'En la app'], [
    ['<b>Market</b> (a mercado)', 'Se ejecuta ya, al mejor precio disponible; no controla el precio', 'Se permite, con aviso si el spread es grande'],
    ['<b>Limit</b> (límite)', 'Solo se ejecuta al precio indicado o mejor', '<b>Es el tipo por defecto</b>: en opciones los spreads son amplios'],
    ['<b>day</b> / <b>gtc</b>', 'La orden vale solo hoy / hasta que se cancele', 'Por defecto <code>day</code>'],
    ['<b>Orden simple</b>', 'Un solo contrato', 'Long Call y Long Put'],
    ['<b>Orden multi-pata</b>', 'Varios contratos que se ejecutan juntos, a un precio neto', 'Iron Condor (4 patas)'],
    ['<b>position_intent</b>', '<code>buy_to_open</code>, <code>sell_to_open</code> (abrir); <code>buy_to_close</code>, <code>sell_to_close</code> (cerrar)', 'Cada pata lo lleva'],
    ['<b>Idempotencia</b>', 'Una clave única por orden: repetir el envío no crea otra orden', 'Cabecera <code>Idempotency-Key</code> → <code>client_order_id</code>'],
  ], 'chica')}
${svg(640, 140, 'Market contra limit', [
    linea(40, 70, 600, 70, '#888', 2), caja(120, 50, 80, 40, 'Bid 5.80', 've', { fs: 10 }), caja(440, 50, 80, 40, 'Ask 6.75', 'ro', { fs: 10 }),
    texto(480, 30, 'MARKET compra aquí (6.75)', { fs: 10, color: '#b85450', bold: true }), flecha(480, 38, 480, 48),
    texto(320, 115, 'LIMIT a 6.27 (mid): espera a que alguien venda a ese precio', { fs: 10, color: '#38761d', bold: true }), flecha(320, 105, 320, 74),
  ].join(''), 'Con una orden límite al mid se evita pagar todo el spread.')}
${nota('¿Por qué importa la idempotencia?', 'Si la red falla justo después de que el broker aceptó la orden, el usuario no sabe si se envió y vuelve a intentarlo. Sin idempotencia se abrirían dos posiciones. Con la misma clave, el servidor reconoce la orden y devuelve la existente sin reenviarla.')}
${en('A market order executes immediately at the best available price, while a limit order only executes at the chosen price or better, so it is the default in our app. Multi-leg orders send several contracts together, and an idempotency key guarantees that a retry never creates a duplicate order.')}`);

  pag('3. Contrato común de broker • orden neutral • adaptadores Alpaca y Webull', `
<h3>3.3 El contrato común de broker en el código</h3>
<p>Cada broker pide las órdenes en un formato diferente. Para no repetir lógica, el servicio de operación arma una <b>orden neutral</b> (igual para todos) y un <b>adaptador</b> por broker la traduce. El archivo <code>src/integrations/contrato-broker.js</code> define qué métodos debe tener todo adaptador; si falta uno, <b>el servidor no arranca</b>.</p>
${codigo('src/integrations/contrato-broker.js (fragmento)', `export const METODOS_BROKER = {
  cuenta: 'Cuenta: { cuentaExternaId, estado, moneda, efectivo, poderCompra, patrimonio, entorno }',
  enviarOrden: 'Envía una orden neutral y devuelve { ordenExternaId, clientOrderId, estado, … }',
  consultarOrden: 'Orden por su identificador externo',
  consultarPorClientOrderId: 'Orden por la Idempotency-Key con la que se envió',
  cancelarOrden: 'Pide la cancelación y devuelve la orden',
  ordenesAbiertas: 'Órdenes vivas en el broker',
  posiciones: 'Posiciones vivas, una entrada por contrato',
};
export function exigirContratoBroker(adaptador) {
  const faltan = Object.keys(METODOS_BROKER).filter(m => typeof adaptador?.[m] !== 'function');
  if (faltan.length) throw new Error(\`El broker no cumple el contrato: falta \${faltan.join(', ')}.\`);
  if (adaptador.entorno !== 'paper') throw new Error('El broker no declara entorno paper.');
  return adaptador;
}`)}
${svg(640, 165, '', [
    caja(160, 10, 320, 50, 'operacion.service.js|orden neutral: {clientOrderId, tipo, cantidad, precioLimite,|credito, componentes: [{simbolo OCC, accion, intencion}]}', 'os', { fs: 9.5 }),
    caja(60, 105, 220, 52, 'alpaca.client.js|POST /v2/orders · order_class mleg|crédito = limit_price negativo', 've', { fs: 9.5 }),
    caja(360, 105, 220, 52, 'webull.client.js|option_strategy deducida de las patas|crédito = side SELL', 'na', { fs: 9.5 }),
    flecha(260, 60, 170, 103, 'traduce'), flecha(380, 60, 470, 103, 'traduce'),
  ].join(''), 'Un servicio y dos adaptadores que cumplen el mismo contrato.')}
${en('Each broker expects orders in a different format. Our order service builds one neutral order, and an adapter per broker translates it. A common broker contract lists the methods every adapter must have, and the server refuses to start if a method is missing or if the adapter is not in paper mode.')}`);

  pag('3. Alpaca • cuenta paper • claves PK • nivel 3 • cuerpos JSON por estrategia', `
<h3>3.4 Alpaca</h3>
<p><b>Cuenta y permisos, paso a paso:</b></p>
${pasos(['Registrarse en alpaca.markets: la cuenta <b>paper</b> se crea automáticamente con dinero ficticio.', 'En <i>Paper → API Keys</i> generar las claves. Deben empezar con <b>PK</b> (las que empiezan con CK son de otro producto y responden 401).', 'Verificar que la cuenta paper tenga <b>nivel de opciones 3</b>.', 'Copiar las claves al archivo <code>.env</code> del servidor: <code>ALPACA_KEY_ID</code>, <code>ALPACA_SECRET_KEY</code> y <code>ALPACA_DATA_FEED=iex</code>.'])}
<p>Alpaca también es el <b>proveedor de datos</b> del proyecto: velas, cadena de opciones con IV y griegas, noticias. El cliente respeta un máximo de 180 solicitudes por minuto.</p>
<p><b>Cómo se envía cada estrategia</b> (lo genera <code>construirCuerpoOrden</code> en <code>alpaca.client.js</code>):</p>
${codigo('Long Call (una pata; el Long Put es igual con un contrato P)', `{ "symbol": "AAPL261218C00230000", "qty": "1", "side": "buy",
  "type": "limit", "limit_price": "3.6", "time_in_force": "day",
  "client_order_id": "<Idempotency-Key>", "position_intent": "buy_to_open" }`)}
${codigo('Iron Condor (multi-pata: order_class mleg; limit_price NEGATIVO = crédito)', `{ "type": "limit", "time_in_force": "day", "client_order_id": "<Idempotency-Key>",
  "limit_price": "-2.97", "order_class": "mleg", "qty": "1", "legs": [
  { "symbol": "TSLA261201P00342500", "ratio_qty": "1", "side": "buy",  "position_intent": "buy_to_open" },
  { "symbol": "TSLA261201P00352500", "ratio_qty": "1", "side": "sell", "position_intent": "sell_to_open" },
  { "symbol": "TSLA261201C00407500", "ratio_qty": "1", "side": "sell", "position_intent": "sell_to_open" },
  { "symbol": "TSLA261201C00417500", "ratio_qty": "1", "side": "buy",  "position_intent": "buy_to_open" } ] }`)}
${en('Alpaca creates a paper account automatically and provides API keys that start with PK. It is also our market data provider. A Long Call or Long Put is sent as a single order with one symbol, and the Iron Condor uses the multi-leg order class, where a negative limit price means that we receive a credit.')}`);

  pag('3. Alpaca • estados de una orden • avisos en vivo • Webull OpenAPI', `
<p><b>Estados de una orden.</b> Alpaca responde con sus propios estados y la función <code>mapearEstadoOrden</code> los traduce a los del proyecto. Con Alpaca, los cambios llegan en vivo por WebSocket (<code>trade_updates</code>).</p>
${svg(640, 120, 'Ciclo de vida de una orden', [
    caja(5, 40, 90, 38, 'pendiente', 'gr'), caja(115, 40, 90, 38, 'enviada', 'az'), caja(225, 40, 90, 38, 'aceptada', 'am'), caja(335, 40, 80, 38, 'parcial', 'na'), caja(435, 40, 90, 38, 'ejecutada', 've'),
    caja(550, 10, 85, 28, 'cancelada', 'ro', { fs: 9.5 }), caja(550, 45, 85, 28, 'rechazada', 'ro', { fs: 9.5 }), caja(550, 80, 85, 28, 'expirada', 'ro', { fs: 9.5 }),
    flecha(95, 59, 113, 59), flecha(205, 59, 223, 59), flecha(315, 59, 333, 59), flecha(415, 59, 433, 59), flecha(315, 48, 548, 24, '', { punteada: true }),
    texto(270, 105, 'pending_new → enviada · new/accepted → aceptada · filled → ejecutada', { fs: 9.5, color: '#555' }),
  ].join(''), 'Estados terminales: ejecutada, cancelada, rechazada y expirada.')}
<h3>3.5 Webull</h3>
${pasos(['Solicitar acceso a <b>Webull OpenAPI</b> y obtener <code>AppKey</code> y <code>AppSecret</code> del entorno de pruebas (<code>api.sandbox.webull.com</code>).', 'Activar opciones en la cuenta de pruebas.', 'Guardar las credenciales en <code>.env</code> y elegir <b>Webull paper</b> en la cabecera de la app.'])}
<p>Cada solicitud se firma con HMAC-SHA1. Webull no entrega datos de mercado al proyecto (siguen viniendo de Alpaca). Diferencias importantes:</p>
${ul(['La estrategia se <b>deduce de las patas</b>: 2 tipos (put y call) y 4 strikes distintos → <code>IRON_CONDOR</code>.', 'Un crédito se envía con <code>side: "SELL"</code> y precio positivo.', 'Las órdenes de varias patas <b>solo se aceptan como límite</b>; a mercado responde «No matching options strategy found».', 'Acepta opciones de 9:30 a 16:00 de Nueva York; no tiene avisos en vivo, por eso el servidor consulta cada 3 segundos.'])}
${codigo('Iron Condor en Webull (fragmento generado por webull.client.js)', `{ "new_orders": [{ "client_order_id": "<clave ≤ 32>", "order_type": "LIMIT", "limit_price": "2.97",
   "time_in_force": "DAY", "instrument_type": "OPTION", "symbol": "TSLA",
   "option_strategy": "IRON_CONDOR", "side": "SELL", "quantity": "1", "legs": [ ...4 patas... ] }] }`)}
${en('Alpaca order states are translated into the states of our app, and changes arrive live through a WebSocket. Webull is used through its OpenAPI sandbox with signed requests. It deduces the strategy from the legs, expresses a credit as a sell order and only accepts multi-leg orders as limit orders.')}`);

  pag('3. Comparativa Alpaca vs Webull • generar órdenes desde la app paso a paso', `
<h3>3.6 Comparativa de brokers</h3>
${tabla(['', 'Alpaca', 'Webull'], [
    ['Acceso', 'Claves API que empiezan con PK', 'AppKey y AppSecret del sandbox'],
    ['Datos de mercado', '<b>Sí</b> (fuente principal del proyecto)', 'No'],
    ['Orden multi-pata', '<code>order_class: "mleg"</code>', '<code>option_strategy</code> deducida'],
    ['Cómo se expresa un crédito', '<code>limit_price</code> negativo', '<code>side: "SELL"</code> con precio positivo'],
    ['Multi-pata a mercado', 'Sí', '<b>No</b>, solo límite'],
    ['Idempotencia', '<code>client_order_id</code>', '<code>client_order_id</code> de hasta 32 caracteres'],
  ], 'chica')}
<h3>3.7 Paso a paso: generar una orden por estrategia desde la app</h3>
${pasos(['Abrir <b>Análisis</b> del símbolo y ver qué estrategia quedó mejor clasificada y sus avisos.', 'Pulsar <b>Operar</b>: la función <code>construirPatas</code> arma las patas (strike ATM para Long Call/Put; delta 0.20 y alas al 2.5 % para Iron Condor).', 'En el <b>ticket</b> revisar vencimiento, patas, cantidad (1 a 100), tipo límite, precio al mid, vigencia y broker.', 'Leer el riesgo: pérdida y ganancia máxima, breakevens y avisos (spread mayor a 10 %, poder de compra, análisis de más de 24 h, cores que se contradicen).', '<b>Revisar → Confirmar</b>: la página llama a <code>POST /api/v1/ordenes/ticket</code> con la cabecera <code>Idempotency-Key</code>.', 'Seguir la orden en vivo con <code>GET /ordenes/:id/seguimiento</code> (Server-Sent Events).', 'Cerrar con <code>POST /posiciones/:id/cierre</code> (long → sell_to_close; short → buy_to_close) o <code>POST /posiciones/cierre-grupo</code> para las 4 patas juntas.'])}
${svg(640, 162, 'Del análisis a la orden', [
    caja(5, 30, 105, 46, 'Análisis|(5 cores)', 'am'), caja(135, 30, 105, 46, 'Operar|construirPatas', 've', { fs: 10 }),
    caja(265, 30, 105, 46, 'Ticket|revisar riesgo', 'az'), caja(395, 30, 110, 46, 'POST /ordenes/|ticket + clave', 'os', { fs: 10 }), caja(530, 30, 105, 46, 'Broker paper|Alpaca · Webull', 'na', { fs: 10 }),
    flecha(110, 53, 133, 53), flecha(240, 53, 263, 53), flecha(370, 53, 393, 53), flecha(505, 53, 528, 53),
    caja(395, 108, 110, 46, '¿Misma clave?|devuelve la orden', 'ro', { fs: 10 }), flecha(450, 76, 450, 106, 'reintento', { dx: 30, dy: 0 }),
    caja(530, 108, 105, 46, 'Seguimiento|→ ejecutada', 've', { fs: 10 }), flecha(582, 76, 582, 106),
    caja(265, 108, 105, 46, 'Cierre|sell/buy_to_close', 'mo', { fs: 10 }), flecha(528, 131, 372, 131),
  ].join(''), 'La Idempotency-Key viaja como client_order_id: un reintento nunca duplica la orden.')}
${en('Both brokers receive the same neutral order, but they express multi-leg orders and credits differently. In the app, the Operate button builds the legs, the ticket shows the risk, and the confirmed order is sent with an idempotency key, followed live and finally closed with the opposite position intent.')}`);

  // ---------- Sección 4 ----------
  pag('4. APIs y cores • ¿qué es una API REST? • recurso • verbo • código • JSON', `
<h2>4. Desarrollo de APIs con los cores (algoritmos/cerebro)</h2>
<p>Esta sección explica, de lo general a lo particular, cómo está construido el servidor: qué es una API, cómo están organizadas las carpetas, qué pasa con una petición desde que llega hasta que se responde, cómo se usa la API y, al final, cómo funcionan los cinco cores que forman el «cerebro».</p>
<h3>4.1 ¿Qué es una API REST?</h3>
<p>Una <b>API</b> (interfaz de programación) es una puerta por la que un programa le pide algo a otro. En una API <b>REST</b>, cada cosa del sistema es un <b>recurso</b> con una dirección (URL), y se usa un <b>verbo HTTP</b> para indicar qué se quiere hacer. El servidor responde con un <b>código de estado</b> y datos en formato <b>JSON</b>.</p>
${tabla(['Verbo', 'Significado', 'Ejemplo en el proyecto'], [['GET', 'Leer', '<code>GET /api/v1/empresas</code> → lista de empresas'], ['POST', 'Crear o ejecutar una acción', '<code>POST /api/v1/ordenes/ticket</code> → crea y envía una orden'], ['PUT', 'Reemplazar', '<code>PUT /api/v1/perfiles-analisis/:id</code>'], ['DELETE', 'Borrar', '<code>DELETE /api/v1/sesiones/actual</code> → cerrar sesión']], 'chica')}
${tabla(['Código', 'Significado', 'Cuándo lo usa el proyecto'], [['200 / 201', 'Correcto / creado', 'Lecturas y altas'], ['<b>202</b>', 'Aceptado, en proceso', 'Trabajos largos: sincronizar, ejecutar cores, selección'], ['400', 'Petición inválida', 'El esquema Zod rechazó los datos'], ['401', 'Sin sesión', 'Falta el token o expiró'], ['404 / 409', 'No existe / conflicto', 'Registro ajeno o versión distinta'], ['429', 'Demasiadas solicitudes', 'Límite de intentos de login o de trabajos']], 'chica')}
${svg(640, 110, '', [
    caja(10, 30, 140, 50, 'Cliente|(navegador o curl)', 'mo'), caja(250, 25, 140, 60, 'API REST|/api/v1/...', 'os', { forma: 'hex' }), caja(490, 30, 140, 50, 'Respuesta JSON|+ código', 've'),
    flecha(150, 50, 248, 50, 'GET /empresas'), flecha(390, 55, 488, 55, '200 OK'),
  ].join(''), 'Una petición REST: verbo + dirección → código + JSON.')}
${en('An API is a door through which one program asks another for something. In a REST API every element is a resource with a URL, and an HTTP verb says what we want to do with it. The server answers with a status code and JSON data; our project uses status 202 for long tasks.')}`);

  pag('4. Estructura del proyecto • árbol de carpetas • responsabilidad de cada capa', `
<h3>4.2 Estructura de carpetas del proyecto</h3>
<p>El repositorio separa el servidor (<code>src/</code>) de la interfaz (<code>web/</code>). Dentro del servidor, cada carpeta tiene <b>una sola responsabilidad</b>:</p>
${codigo('Árbol del repositorio AppRESTOpciones', `AppRESTOpciones/
├── src/                      Servidor (Node.js + Express 5)
│   ├── index.js              Arranca el servidor y el universo de empresas
│   ├── app.js                Crea Express: middlewares, rutas, Swagger, página web y errores
│   ├── config/               Variables de entorno y generación de OpenAPI
│   ├── middlewares/          auth (token), validar (Zod), límites, cabeceras, gzip, errores
│   ├── api/v1/
│   │   ├── schemas/          Definición de cada ruta con Zod: valida y documenta
│   │   ├── routes/           Une verbo + dirección con su controlador (28 archivos)
│   │   ├── controllers/      Traducen HTTP ↔ servicio
│   │   ├── services/         Reglas del negocio y orquestación (38 archivos)
│   │   └── models/           Qué datos son válidos (esquemas Mongoose estrictos)
│   ├── cores/                Los 5 algoritmos + confluencia + Black-Scholes (funciones puras)
│   ├── integrations/         Alpaca, Webull, SEC, Tesoro de EE. UU.
│   ├── repositories/         MongoDB o Supabase con las mismas funciones
│   └── jobs/cola.js          Cola de trabajos en memoria (respuestas 202)
├── web/                      Interfaz React + Vite (sección 5)
├── tests/                    23 archivos de pruebas automáticas (287 pruebas)
├── database/schema.sql       Tablas de Supabase (PostgreSQL)
└── docs/                     Decisiones (ADR), guías y este documento`)}
${tabla(['Capa', 'Regla que debe cumplir', 'Quién lo vigila'], [
    ['routes', 'Solo conectan; no tienen lógica', '<code>tests/estructura.test.cjs</code>'],
    ['services', 'Tienen la lógica; nunca hablan HTTP directamente', 'idem'],
    ['cores', '<b>Funciones puras</b>: sin internet, sin base de datos, sin reloj, sin azar (ADR-001)', 'idem'],
    ['repositories', 'Toda consulta filtra por el dueño (<code>owner_id</code>)', '<code>tests/repositorios.test.cjs</code>'],
  ], 'chica')}
${en('The repository separates the server from the web interface. Inside the server, each folder has one responsibility: schemas describe routes, routes connect them, controllers translate HTTP, services hold the business rules, cores are pure algorithms, integrations talk to providers and repositories store the data. Automated tests check these rules.')}`);

  pag('4. Ciclo de vida de una petición • middlewares • autenticación • validación • respuesta', `
<h3>4.3 ¿Qué pasa cuando llega una petición? (ciclo de vida)</h3>
<p>Tomemos <code>POST /api/v1/selecciones/ejecuciones</code>. La petición atraviesa estas piezas en orden:</p>
${svg(640, 300, 'Recorrido de una petición dentro del servidor', [
    caja(10, 30, 140, 40, 'Petición HTTP|+ Bearer token', 'mo', { fs: 10 }),
    caja(185, 22, 200, 56, 'app.js: middlewares|X-Request-Id · cabeceras · gzip|JSON ≤ 1 MB', 'am', { fs: 9.5 }),
    caja(420, 22, 210, 56, 'auth.handler: authenticate|valida el token → req.context|{database, userId}', 'am', { fs: 9.5 }),
    caja(420, 105, 210, 50, 'registrar + validar (Zod)|datos limpios en req.datos', 'az', { fs: 9.5 }),
    caja(185, 105, 200, 50, 'controller|handle → servicio', 'az', { fs: 10 }),
    caja(10, 105, 140, 50, 'service|reglas de negocio', 'os', { forma: 'hex', fs: 10 }),
    caja(10, 195, 140, 44, 'cores|cálculo puro', 'na', { fs: 10 }), caja(185, 195, 200, 44, 'integrations|Alpaca · SEC · Webull', 'na', { fs: 10 }),
    caja(420, 190, 210, 54, 'repositories|MongoDB o Supabase|(siempre por dueño)', 've', { forma: 'cil', fs: 9.5 }),
    caja(185, 258, 260, 36, 'Respuesta {success, message, data}', 've', { fs: 10 }),
    flecha(150, 50, 183, 50), flecha(385, 50, 418, 50), flecha(525, 78, 525, 103), flecha(420, 130, 387, 130), flecha(185, 130, 152, 130),
    flecha(80, 155, 80, 193), flecha(130, 155, 280, 193), flecha(145, 150, 450, 190),
    flecha(80, 239, 183, 270, '', { punteada: true }),
    texto(540, 280, 'si algo falla: error con|código y requestId', { fs: 9.5, color: '#b85450' }),
  ].join(''), 'Cada pieza hace una sola cosa y pasa el resultado a la siguiente.')}
${pasos(['<b>app.js</b> asigna un identificador a la petición (<code>X-Request-Id</code>), agrega cabeceras de seguridad, comprime y lee el JSON (máximo 1 MB).', '<b>authenticate</b> lee el token Bearer, busca la sesión y deja en <code>req.context</code> la base de datos y el usuario. Sin token válido responde 401.', '<b>validar</b> revisa params, query, cabeceras y cuerpo con el esquema Zod de la ruta. Si algo no cuadra, responde 400 con el campo exacto.', 'El <b>controlador</b> llama al servicio; el <b>servicio</b> usa repositorios, integraciones y cores.', 'La respuesta siempre tiene la forma <code>{ success, message, data }</code>; los errores, <code>{ success: false, message, error, requestId }</code>.'])}
${en('Every request follows the same path. The application adds a request id and security headers, the authentication middleware validates the token, the Zod validator checks the input, the controller calls a service, and the service uses repositories, integrations and cores. Responses and errors always share the same JSON format.')}`);

  pag('4. Cómo se define una ruta • esquema Zod • registrar • controlador • código real', `
<h3>4.4 Cómo se define una ruta: del esquema al controlador</h3>
<p>Cada ruta que no es un CRUD simple se describe <b>una sola vez</b> con la librería Zod. De esa descripción salen dos cosas: la <b>validación</b> automática y la <b>documentación</b> en Swagger (ADR-017). Así nunca hay una ruta sin documentar.</p>
${codigo('1) src/api/v1/schemas/analisis.schema.js — la definición', `export const seleccionar = trabajo({
  metodo: 'post', ruta: '/selecciones/ejecuciones', grupo: 'Análisis',
  resumen: 'Combina los cores y ordena las estrategias (o las empresas) por compatibilidad.',
  body: z.looseObject({
    modo: z.enum(['empresa', 'estrategia', 'empresa_estrategia']),
    empresaId: id.nullish(), estrategiaId: id.nullish(),
    coresSeleccionados: z.array(core).min(1),
    ponderaciones: ponderaciones.optional() }) });   // trabajo() = responde 202`)}
${codigo('2) src/api/v1/routes/analisis.routes.js — la conexión', `export default deps => {
  const router = Router(), c = controller(deps);
  registrar(router, rutas.seleccionar, c.seleccionar);   // verbo + ruta + validar + controlador
  ...
};`)}
${codigo('3) src/api/v1/routes/registrar.js — el mecanismo', `export function registrar(router, definicion, ...manejadores) {
  router[definicion.metodo](definicion.ruta, validar(definicion), ...manejadores);
}`)}
${codigo('4) src/api/v1/controllers/analisis.controller.js — el controlador', `seleccionar: handle(async (req, res) => aceptar(res,
  await trabajo(req, 'selecciones', 'seleccion.crear',
    () => analisis.ejecutarSeleccion(req.context, input(req.datos.body))))),`)}
${en('Each special route is described once with Zod, and that description produces both the automatic validation and the Swagger documentation. The route file connects the definition to a controller through the register function, and the controller only calls the service and returns the answer, here with status 202.')}`);

  pag('4. CRUD genérico • 19 recursos • sesión y token • base de datos por usuario', `
<h3>4.5 Los CRUD genéricos</h3>
<p>Para los recursos simples (empresas, estrategias, perfiles, órdenes, etc.) no se escribe cada ruta a mano: la función <code>moduleRouter</code> genera automáticamente las ocho operaciones a partir del modelo, e incluso rutas para sus subdocumentos.</p>
${tabla(['Ruta generada', 'Operación'], [['<code>GET /recurso</code>', 'Listar (paginado, más recientes primero)'], ['<code>GET /recurso/:id</code>', 'Leer uno (devuelve <code>ETag</code> con la versión)'], ['<code>POST /recurso</code>', 'Crear'], ['<code>PUT /recurso/:id</code>', 'Reemplazar; con <code>If-Match</code> evita pisar cambios ajenos (409)'], ['<code>DELETE /recurso/:id</code>', 'Borrar'], ['<code>POST/PUT /recurso/lote</code>, <code>POST /recurso/eliminacion-lote</code>', 'Operaciones por lotes']], 'chica')}
<h3>4.6 Sesión, token y base de datos</h3>
<p>Al iniciar sesión el usuario elige <b>MongoDB o Supabase</b>. El servidor genera un token que lleva esa elección adentro, así cada petición sabe a qué base ir sin guardar nada en memoria. En la base solo se guarda el <b>hash</b> del token.</p>
${svg(640, 175, 'Del login a la base de datos correcta', [
    caja(5, 20, 150, 50, 'POST /sesiones|email · password|baseDatos', 'mo', { fs: 9.5 }), caja(195, 20, 170, 50, 'sesiones.service|scrypt + timingSafeEqual', 'am', { fs: 9.5 }),
    caja(405, 15, 230, 60, 'token = baseDatos.usuario.|sesion.aleatorio(64 hex)|se guarda solo sha256(token)', 'os', { fs: 9.5 }),
    flecha(155, 45, 193, 45), flecha(365, 45, 403, 45),
    caja(195, 110, 170, 52, 'repository(nombre, ctx)', 'az', { fs: 10 }),
    caja(420, 95, 210, 34, 'mongoRepository (colecciones api_*)', 've', { fs: 9.5 }), caja(420, 137, 210, 34, 'supabaseRepository (tablas api_*)', 've', { fs: 9.5 }),
    flecha(365, 126, 418, 112, 'mongodb'), flecha(365, 140, 418, 154, 'supabase', { dy: 8 }), flecha(280, 75, 280, 108, 'cada petición', { dx: 40, dy: 0 }),
  ].join(''), 'El token indica la base; el repositorio siempre filtra por el dueño.')}
${codigo('src/repositories/index.js', `export function repository(name, context) {
  if (!context?.userId) throw boom.unauthorized('Sesión requerida.');
  if (context.database === 'mongodb') return mongoRepository(name, context.userId);
  if (context.database === 'supabase') return supabaseRepository(name, context.userId);
}`)}
${en('Simple resources get eight CRUD operations generated automatically from their model. At login, the user chooses MongoDB or Supabase, and the token carries that choice, so each request goes to the right database. Only the hash of the token is stored, and every query is filtered by the owner.')}`);

  pag('4. Trabajos asíncronos • respuesta 202 • cola • pendiente → completada', `
<h3>4.7 Trabajos largos: respuesta 202 y cola</h3>
<p>Sincronizar datos o ejecutar los cores puede tardar segundos o minutos. Si el servidor esperara, la conexión se cortaría. Por eso esas rutas responden de inmediato con <b>202 Accepted</b> y un registro en estado <code>pendiente</code>; el trabajo se hace en una <b>cola</b> (dos a la vez) y el cliente consulta el registro hasta que termine (ADR-003).</p>
${svg(640, 165, '', [
    caja(5, 20, 125, 46, 'Cliente|POST …/ejecuciones', 'mo', { fs: 10 }), caja(170, 20, 150, 46, 'iniciarTrabajo|crea registro pendiente', 'am', { fs: 10 }), caja(360, 20, 120, 46, 'cola.js|(concurrencia 2)', 'os', { forma: 'hex', fs: 10 }),
    caja(510, 20, 125, 46, 'ejecutar()|cores, integraciones', 'na', { fs: 10 }),
    flecha(130, 43, 168, 43), flecha(320, 43, 358, 43, 'encolar'), flecha(480, 43, 508, 43),
    caja(5, 105, 125, 46, '202 + registro|{_id, pendiente}', 've', { fs: 10 }), flecha(235, 66, 90, 103, 'responde ya'),
    caja(170, 105, 465, 46, 'estado guardado: pendiente → procesando → completada  (o fallida con mensaje seguro)', 'gr', { fs: 10 }),
    flecha(572, 66, 572, 103), flecha(130, 128, 168, 128, 'GET /:id cada 1.5 s', { dy: -9 }),
  ].join(''), 'El cliente no espera: recibe el registro y lo consulta hasta que cambie de estado.')}
${codigo('src/api/v1/services/trabajos.service.js', `export async function iniciarTrabajo({ name, ctx, datos, ejecutar, cola }) {
  const registro = await crear(name, ctx, { ...datos, estado: 'pendiente' });
  cola.encolar(registro._id, async () => {
    try {
      await parchar(name, ctx, registro._id, { estado: 'procesando' });
      const cambios = await ejecutar(registro);
      await parchar(name, ctx, registro._id, { ...cambios, estado: 'completada' });
    } catch (error) {
      await parchar(name, ctx, registro._id, { estado: 'fallida', error: mensajeSeguro(error) });
    }
  });
  return registro;   // el controlador lo devuelve con 202
}`)}
<p>Si el servidor se reinicia, un trabajo que lleve más de 15 minutos sin avanzar se marca como <code>fallida</code> al consultarlo, para que la interfaz no espere para siempre.</p>
${en('Long tasks such as synchronizing data or running the cores answer immediately with status 202 and a pending record. A queue runs two jobs at a time and updates the record from pending to processing and then to completed or failed. The client simply polls the record until it reaches a final state.')}`);

  pag('4. Cómo usar la API paso a paso • Swagger • login • sincronizar • analizar', `
<h3>4.8 Cómo usar la API paso a paso</h3>
<p>La documentación interactiva está en <code>/api/v1/api-docs</code> (Swagger) y la especificación en <code>/api/v1/openapi.json</code>. El estado del proceso, en <code>/health</code>. Este es el flujo completo con <code>curl</code>:</p>
${codigo('Paso 1 · Iniciar sesión y obtener el token', `curl -X POST http://localhost:3000/api/v1/sesiones -H "Content-Type: application/json" \\
  -d '{"email":"alumno@ejemplo.com","password":"********","baseDatos":"mongodb"}'
# → { "success": true,
#     "data": { "token": "mongodb.<usuario>.<sesion>.<64 hex>", "tokenType": "Bearer" } }`)}
${codigo('Paso 2 · Traer datos de AAPL desde Alpaca y la SEC (trabajo 202)', `curl -X POST http://localhost:3000/api/v1/sincronizaciones/ejecuciones \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"recurso":"historicos","simbolos":["AAPL"]}'
# recursos: empresas, historicos, cotizaciones, contratos, noticias, fundamentales, institucional`)}
${codigo('Paso 3 · Ejecutar un core y consultar su resultado', `curl -X POST http://localhost:3000/api/v1/cores/tecnico/evaluaciones \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"empresaId":"<id de AAPL>"}'            # → 202 { _id, estado: "pendiente" }
curl http://localhost:3000/api/v1/cores/tecnico/evaluaciones/<_id> \\
  -H "Authorization: Bearer $TOKEN"             # repetir hasta estado "completada"`)}
${codigo('Paso 4 · Pedir la mejor estrategia para AAPL (modo empresa)', `curl -X POST http://localhost:3000/api/v1/selecciones/ejecuciones \\
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"modo":"empresa","empresaId":"<id>",
       "coresSeleccionados":["tecnico","indicadores","fundamental","institucional","noticias"]}'`)}
${codigo('Paso 5 · Enviar la orden (idempotente)', `curl -X POST http://localhost:3000/api/v1/ordenes/ticket \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Idempotency-Key: 7f9c1e2a-0001" -H "Content-Type: application/json" \\
  -d '{"empresaId":"<id>","tipo":"limit","precioLimite":3.6,"cantidad":1,
       "componentes":[{"contratoId":"<id del call>","accion":"buy","intencion":"buy_to_open"}]}'`)}
${en('The API can be explored in Swagger and used from any HTTP client. The complete flow is: log in to obtain a bearer token, synchronize the data of a symbol, run the cores, ask the selection service for the best strategy and finally send an idempotent order ticket to the paper broker.')}`);

  pag('4. Catálogo de endpoints • análisis • datos • mercado • operación', `
<h3>4.9 Catálogo de endpoints principales</h3>
${tabla(['Grupo', 'Método y ruta', 'Qué hace', 'Resp.'], [
    ['Sesiones', 'POST /sesiones · GET / DELETE /sesiones/actual', 'Login (público), sesión vigente, cerrar sesión', '200/204'],
    ['Datos', 'POST /sincronizaciones/ejecuciones', 'Trae datos de Alpaca, SEC o del broker', '202'],
    ['Datos', 'GET /activos/busqueda', 'Busca empresas por nombre o símbolo', '200'],
    ['Análisis', 'GET /cores/catalogo', 'Versión, insumos y señales de cada core', '200'],
    ['Análisis', 'POST /cores/:core/evaluaciones', 'Ejecuta un core', '202'],
    ['Análisis', 'POST /confluencias/ejecuciones', 'Combina evaluaciones para una estrategia', '202'],
    ['Análisis', 'POST /selecciones/ejecuciones', 'Los tres modos de selección', '202'],
    ['Análisis', 'POST /configuraciones/:id/evaluaciones', 'Pago, breakevens y Black-Scholes de una configuración', '202'],
    ['Análisis', 'GET /screener/ranking', 'Mejores empresas por estrategia (≈ 500 analizadas)', '200'],
    ['Mercado', 'GET /mercado/estado · /panorama · /tasa', 'Mercado abierto o cerrado, índices y tasa libre de riesgo', '200'],
    ['Mercado', 'GET /mercado/historicos/:simbolo', 'Velas guardadas', '200'],
    ['Mercado', 'GET /mercado/opciones/vencimientos/:simbolo · POST …/cadena/:simbolo', 'Vencimientos y cadena de opciones con IV y griegas', '200'],
    ['Operación', 'GET /brokers/disponibles · POST /broker/paper/conexion', 'Brokers y conexión paper', '200'],
    ['Operación', 'POST /ordenes/ticket', 'Crea y envía una orden (Idempotency-Key)', '200/201'],
    ['Operación', 'GET /ordenes/:id/seguimiento', 'Avisos en vivo (Server-Sent Events)', '200'],
    ['Operación', 'POST /ordenes/:id/cancelacion · /posiciones/:id/cierre · /posiciones/cierre-grupo', 'Cancelar y cerrar', '200'],
    ['CRUD', '/empresas, /estrategias, /perfiles-analisis, /ordenes, /posiciones…', 'Las 8 operaciones genéricas', '200/201'],
  ], 'chica')}
${en('The endpoints are grouped into sessions, data synchronization, analysis, market data, operations and generic CRUD resources. Analysis and synchronization endpoints return 202 because they run as jobs, while market and catalog endpoints answer directly. The full list with schemas is always available in Swagger.')}`);

  pag('4. Contrato de un core • función pura • señales • tanh • sesgo • confianza', `
<h3>4.10 El cerebro: el contrato común de un core</h3>
<p>Un <b>core</b> es un algoritmo que mira una clase de evidencia y responde una sola pregunta: <b>¿esta evidencia es alcista, bajista o neutral, y qué tan segura es?</b> Todos los cores exportan lo mismo:</p>
${tabla(['Export', 'Contenido'], [['<code>VERSION</code>', "'tecnico@1.1.0': se guarda en cada evaluación para saber con qué versión se calculó"], ['<code>REQUIERE</code>', "Los datos que necesita: 'velas', 'fundamentales', 'reportes', 'noticias', 'opciones?' (el ? = opcional)"], ['<code>SENALES</code>', 'Catálogo de señales con su peso base; se publica en <code>GET /cores/catalogo</code>'], ['<code>evaluar(input)</code>', 'Función pura → <code>{ sesgo, confianza, puntaje, cobertura, metricas, motivos, datosFaltantes }</code>']], 'chica')}
<p><b>Sesgo</b> va de −1 (bajista) a +1 (alcista). <b>Confianza</b> va de 0 a 1. <b>Puntaje</b> = 50 + 50 × sesgo (0 bajista, 50 neutral, 100 alcista).</p>
${svg(640, 135, 'Patrón de todos los cores', [
    caja(5, 40, 100, 50, 'Datos crudos|(hasta la fecha)', 'gr', { fs: 10 }), caja(130, 40, 100, 50, 'Métricas|%, razón', 'am', { fs: 10 }), caja(255, 40, 115, 50, 'Señales en|[−1, 1]|tanh · clamp', 'az', { fs: 10 }),
    caja(395, 40, 105, 50, 'combinar|con pesoBase', 'os', { forma: 'hex', fs: 10 }), caja(525, 40, 110, 50, 'sesgo · confianza|puntaje · motivos', 've', { fs: 9.5 }),
    flecha(105, 65, 128, 65), flecha(230, 65, 253, 65), flecha(370, 65, 393, 65), flecha(500, 65, 523, 65),
    texto(320, 115, 'Mismo dato de entrada = mismo resultado: se puede probar sin internet y repetir cualquier análisis', { fs: 10, color: '#555' }),
  ].join(''), 'Todos los cores siguen las mismas cinco etapas.')}
<p class="formula">sesgo = Σ peso·señal / Σ peso &nbsp;&nbsp; consistencia = |Σ peso·señal| / Σ peso·|señal|<br>confianza = cobertura × (½ consistencia + ½ intensidad)</p>
${nota('¿Por qué tanh?', 'La función tangente hiperbólica convierte cualquier número en un valor entre −1 y 1 de forma suave: un precio 5 % sobre su promedio da una señal de 0.76, y uno 50 % sobre su promedio no da 10 veces más, sino casi 1. Así ninguna métrica extrema domina.')}
${en('A core is an algorithm that answers one question about one kind of evidence: is it bullish, bearish or neutral, and how confident is it? Every core is a pure function that turns raw data into metrics, maps them to signals between minus one and one, and combines them into a bias, a confidence and a score.')}`);

  pag('4. Los cinco cores • técnico • indicadores • fundamental • institucional • noticias', `
<h3>4.11 Los cinco cores de elegibilidad</h3>
${tabla(['Core', 'Pregunta que responde', 'Datos', 'Señales principales (peso)'], [
    ['<b>Técnico</b>', '¿La acción está en tendencia alcista o bajista?', 'Velas (Alpaca)', 'Precio vs promedio de 50 días (1) y de 200 días (1.5), cruce 50/200 (1), pendiente de 20 días (1), posición en el rango de un año (0.75), volumen (0.5)'],
    ['<b>Indicadores</b>', '¿Qué dice el impulso (momentum) y qué tan volátil está?', 'Velas + opciones', 'RSI de 14 días (1), MACD 12/26/9 (1), estocástico (0.75), bandas de Bollinger (0.75). Además mide HV20, HV60, IV e IV/HV'],
    ['<b>Fundamental</b>', '¿La empresa crece, gana dinero y está sana?', 'Estados financieros (SEC)', 'Crecimiento de ingresos (1.5) y utilidad (1) contra el mismo periodo del año anterior, margen neto (1), deuda/capital (1), liquidez (0.75), flujo de efectivo (1)'],
    ['<b>Institucional</b>', '¿Los grandes fondos compran o venden?', 'Reportes 13F (SEC)', 'Cambio total de acciones entre los dos últimos reportes (1.5) y cuántas instituciones aumentan contra cuántas disminuyen (1)'],
    ['<b>Noticias</b>', '¿El ánimo de las noticias recientes es positivo?', 'Noticias (Alpaca)', 'Diccionario de palabras positivas y negativas, con negaciones e intensificadores; las noticias viejas pesan menos (vida media de 3 días)'],
  ], 'chica')}
${svg(640, 215, 'Cinco opiniones independientes sobre la misma empresa', [
    caja(5, 25, 115, 30, 'Velas', 'gr'), caja(5, 65, 115, 30, 'Opciones (IV)', 'gr'), caja(5, 105, 115, 30, 'Estados SEC', 'gr'), caja(5, 145, 115, 30, '13F', 'gr'), caja(5, 182, 115, 30, 'Noticias', 'gr'),
    caja(185, 25, 120, 30, 'Técnico', 'am'), caja(185, 65, 120, 30, 'Indicadores', 'am'), caja(185, 105, 120, 30, 'Fundamental', 'am'), caja(185, 145, 120, 30, 'Institucional', 'am'), caja(185, 182, 120, 30, 'Noticias', 'am'),
    flecha(120, 40, 183, 40), flecha(120, 45, 183, 75), flecha(120, 80, 183, 80), flecha(120, 120, 183, 120), flecha(120, 160, 183, 160), flecha(120, 197, 183, 197),
    caja(370, 90, 120, 55, 'sesgo ∈ [−1, 1]|confianza ∈ [0, 1]', 'az', { fs: 10 }),
    flecha(305, 40, 368, 105), flecha(305, 80, 368, 112), flecha(305, 120, 368, 118), flecha(305, 160, 368, 125), flecha(305, 197, 368, 132),
    caja(530, 90, 105, 55, 'Evaluación|guardada con|versión y fuentes', 've', { fs: 9.5 }), flecha(490, 117, 528, 117),
  ].join(''), 'Cada core lee solo los datos que declara en REQUIERE y guarda su evaluación.')}
${en('The five eligibility cores look at different evidence: the technical core studies the price trend, the indicators core studies momentum and volatility, the fundamental core reads financial statements, the institutional core reads large fund holdings and the news core measures sentiment. Each one stores a traceable evaluation.')}`);

  pag('4. Ejemplo de un core • técnico paso a paso • reglas del perfil', `
<h3>4.12 Ejemplo completo: el core técnico, paso a paso</h3>
<p>Datos de una serie de prueba: cierre 149.36, promedio de 50 días 154.36, promedio de 200 días 139.09, volumen 1.66 veces el normal en un día de baja.</p>
${tabla(['Señal', 'Métrica', 'Cálculo', 'Señal', 'Peso', 'peso × señal'], [
    ['Precio vs SMA50', '−3.24 %', 'tanh(−3.24 / 5)', '−0.571', '1', '−0.571'],
    ['Precio vs SMA200', '+7.38 %', 'tanh(7.38 / 10)', '+0.628', '1.5', '+0.942'],
    ['Cruce 50/200', '+10.98 %', 'limitar(10.98 / 5)', '+1.000', '1', '+1.000'],
    ['Pendiente 20 días', '−0.26 %/día', 'tanh(−0.26 / 0.5)', '−0.480', '1', '−0.480'],
    ['Rango de un año', '0.79', '2 × (0.79 − 0.5)', '+0.589', '0.75', '+0.442'],
    ['Volumen', '1.66×', '−(1.66 − 1)', '−0.664', '0.5', '−0.332'],
  ], 'chica')}
${pasos(['Suma de pesos = 5.75; suma de peso × señal = 1.0017.', '<b>Sesgo</b> = 1.0017 / 5.75 = <b>0.174</b> (levemente alcista).', 'Consistencia = 0.27 (las señales se contradicen) e intensidad = 0.66 → <b>confianza</b> = 1 × (0.5 × 0.27 + 0.5 × 0.66) = <b>0.46</b>.', '<b>Puntaje</b> = 50 + 50 × 0.174 = <b>58.7</b>.', 'Motivos que genera: «Precio bajo SMA50 (−3.24 %)», «SMA50 sobre SMA200 (10.98 %)», «Volumen 1.66× el promedio confirma la vela bajista».'])}
<p><b>Lectura:</b> la tendencia larga es alcista, pero el corto plazo es bajista; el core lo detecta y por eso su confianza es baja.</p>
<p><b>Reglas del perfil.</b> El usuario puede agregar reglas, por ejemplo «precio vs SMA200 mayor que 0, peso 5». Si se cumple, el puntaje sube 5 puntos en la dirección del sesgo (58.7 → 63.7). Si una regla <b>obligatoria</b> no se cumple, el resultado se fuerza a neutral (50) con confianza 0.</p>
${en('In this example the technical core receives six signals. The long-term trend is bullish, but the short-term signals are bearish, so the combined bias is only slightly positive and the confidence is low. Profile rules can then add or subtract points, or force a neutral result when a mandatory rule fails.')}`);

  pag('4. Motor de confluencia • consenso • desacuerdo • neutralidad • ejemplo', `
<h3>4.13 Motor de confluencia: de cinco opiniones a una recomendación</h3>
<p>La <b>confluencia</b> junta las opiniones de los cinco cores y calcula qué tan compatible es cada estrategia, de 0 a 100. Pasos:</p>
${pasos(['<b>Peso efectivo</b> de cada core: e = peso que da el usuario (0 a 5) × confianza del core. Un core inseguro casi no cuenta.', '<b>Consenso</b>: s̄ = promedio de los sesgos ponderado por e.', '<b>Desacuerdo</b>: D = desviación estándar ponderada de los sesgos; <b>acuerdo</b> A = 1 − D.', '<b>Neutralidad media</b>: N̄ = promedio ponderado de (1 − |sesgo|) de cada core.', '<b>Compatibilidad</b>: Long Call = 50 + 50·s̄·A; Long Put = 50 − 50·s̄·A; Iron Condor = 100·N̄ + ajuste por IV/HV (±15).'])}
${tabla(['Core', 'Sesgo', 'Confianza (= peso efectivo)', 'peso × sesgo'], [['Técnico', '+0.174', '0.461', '+0.080'], ['Indicadores', '−0.625', '0.813', '−0.508'], ['Fundamental', '+0.608', '0.804', '+0.488'], ['Institucional', '+0.152', '0.576', '+0.088'], ['Noticias', '+0.161', '0.098', '+0.016']], 'chica')}
<p>Resultado: s̄ = 0.060, D = 0.48, N̄ = 0.57, IV/HV = 1.10 → <b>Long Call 51.6 · Long Put 48.5 · Iron Condor 64.8</b>, con confianza 0.29. Como un core dice «muy alcista» y otro «muy bajista», la interfaz avisa: «Los cores se contradicen: la neutralidad puede ser desacuerdo, no rango lateral».</p>
${svg(640, 145, '¿Por qué promedio de neutralidades? (caso NVDA)', [
    caja(5, 35, 165, 80, 'Fundamental +1.0|Técnico −0.6|Indicadores −0.8|Noticias 0', 'gr', { fs: 10.5 }),
    caja(225, 25, 185, 42, 'Fórmula anterior: 100·(1 − |s̄|)|Iron Condor = 90 ✗', 'ro', { fs: 10 }), caja(225, 83, 185, 42, 'Fórmula actual: 100·N̄|Iron Condor = 40 ✔', 've', { fs: 10 }),
    caja(455, 50, 180, 50, 'Opiniones opuestas =|incertidumbre, no calma', 'os', { forma: 'hex', fs: 10 }),
    flecha(170, 65, 223, 46), flecha(170, 85, 223, 104), flecha(410, 104, 453, 80),
  ].join(''), 'Que los cores se cancelen no significa que el precio vaya a quedarse quieto.')}
${en('The confluence engine combines the five cores into a compatibility score for each strategy. Confident cores weigh more, and disagreement reduces the directional signal. The Iron Condor uses the average neutrality of each core, so strong opposite opinions are correctly read as uncertainty instead of a calm market.')}`);

  pag('4. Los 3 modos de selección estrategia↔empresa • screener • ejemplo de petición', `
<h3>4.14 Los tres modos de selección estrategia ↔ empresa</h3>
${tabla(['Modo', 'Pregunta que responde', 'Datos de entrada', 'Resultado'], [
    ['<b>empresa</b>', '«Tengo AAPL, ¿qué estrategia le conviene?»', '<code>empresaId</code>', 'Las 3 estrategias ordenadas'],
    ['<b>estrategia</b>', '«Quiero un Iron Condor, ¿en qué empresa?»', '<code>estrategiaId</code> (+ candidatas o las 25 primeras activas)', 'Empresas ordenadas'],
    ['<b>empresa_estrategia</b>', '«¿Qué tan compatible es un Iron Condor en TSLA?»', 'ambos', 'Un puntaje con sus motivos'],
  ], 'chica')}
${svg(640, 130, 'Algoritmo de ejecutarSeleccion (analisis.service.js)', [
    caja(5, 40, 110, 50, 'Modo +|universo', 'mo'), caja(145, 40, 125, 50, 'Por cada empresa:|recalcular cores', 'am', { fs: 10 }), caja(300, 40, 125, 50, 'Por cada estrategia:|confluencia', 'az', { fs: 10 }),
    caja(455, 40, 90, 50, 'Ordenar por|puntaje', 've', { fs: 10 }), caja(570, 40, 65, 50, 'Top N', 'os', { forma: 'hex' }),
    flecha(115, 65, 143, 65), flecha(270, 65, 298, 65), flecha(425, 65, 453, 65), flecha(545, 65, 568, 65),
    texto(320, 115, 'Empate: gana la de mayor cobertura (más cores con datos)', { fs: 10, color: '#555' }),
  ].join(''), 'Cada ejecución guarda nuevas evaluaciones y confluencias: todo queda trazable.')}
${h.codigo('Petición del modo «estrategia» con pesos personalizados', `POST /api/v1/selecciones/ejecuciones           → 202 (trabajo en cola)
{ "modo": "estrategia", "estrategiaId": "<id de IRON_CONDOR>",
  "coresSeleccionados": ["tecnico", "indicadores", "fundamental", "noticias"],
  "ponderaciones": [ { "core": "tecnico", "peso": 2 }, { "core": "noticias", "peso": 0.5 } ] }
GET /api/v1/selecciones/<id>                    → estado y resultados ordenados`)}
<p>El <b>screener</b> aplica la misma idea a unas 500 empresas: técnico e indicadores se calculan por lotes en segundos y los otros tres cores se completan en segundo plano (ADR-015). <code>GET /screener/ranking?estrategia=IRON_CONDOR&amp;limite=5</code> devuelve el Top 5 ya calculado.</p>
${en('The selection service answers three questions: which strategy fits a company, which company fits a strategy, and how compatible a specific pair is. For each company it recalculates the selected cores, runs the confluence for each strategy and sorts the results by score, breaking ties by coverage.')}`);

  pag('4. Integraciones • Alpaca • SEC • Tesoro • errores normalizados • agregar un core', `
<h3>4.15 Integraciones con proveedores externos</h3>
${tabla(['Archivo', 'Proveedor', 'Qué obtiene'], [
    ['<code>alpaca.client.js</code>', 'Alpaca', 'Velas, cotizaciones, contratos y cadena de opciones (IV y griegas), noticias, dividendos; envía órdenes paper'],
    ['<code>webull.client.js</code>', 'Webull', 'Cuenta, órdenes y posiciones en el sandbox'],
    ['<code>sec.client.js</code>', 'SEC EDGAR', 'Lista de empresas, estados financieros (XBRL), reportes 13F, fechas de resultados'],
    ['<code>tesoro.client.js</code>', 'Tesoro de EE. UU.', 'Tasa libre de riesgo diaria'],
    ['<code>http.js</code>', '—', 'Tiempo límite de 15 s, reintentos ante 429/5xx, ritmo mínimo entre solicitudes'],
  ], 'chica')}
<p>Todos los errores externos se convierten en un <code>IntegrationError</code> con un código fijo, y <code>app.js</code> lo traduce a un código HTTP: <code>SIN_CREDENCIALES</code> → 503, <code>LIMITE</code> → 429, <code>NO_ENCONTRADO</code> → 404, <code>NO_PERMITIDO</code> → 403, <code>PROVEEDOR</code>/<code>RED</code> → 502. Los mensajes nunca contienen claves.</p>
<h3>4.16 Paso a paso: agregar un core nuevo</h3>
${pasos(['Crear <code>src/cores/&lt;nombre&gt;.core.js</code> con <code>VERSION</code>, <code>REQUIERE</code>, <code>SENALES</code> y una función <code>evaluar()</code> pura.', 'Usar <code>util.combinar</code> y <code>util.finalizar</code> para respetar el contrato (sesgo, confianza, puntaje).', 'Registrarlo en <code>src/cores/index.js</code>; aparecerá solo en <code>GET /cores/catalogo</code>.', 'Si necesita un dato nuevo, agregarlo a <code>insumos()</code> en <code>analisis.service.js</code> y a la sincronización.', 'Escribir pruebas con valores calculados a mano en <code>tests/cores.test.cjs</code> (sin internet).', 'Ejecutar <code>npm run verificar</code>: ESLint, pruebas y compilación de la página.'])}
${en('Integrations isolate every external provider behind its own client. Errors are normalized into a single error type with fixed codes, which the application maps to HTTP status codes without leaking credentials. Adding a new core only requires a pure module, its registration, its data inputs and its tests.')}`);

  // ---------- Sección 5 ----------
  pag('5. Desarrollo de la PWA • ¿qué es una PWA? • estado del proyecto • estructura web/', `
<h2>5. Desarrollo de la PWA</h2>
<h3>5.1 ¿Qué es una PWA?</h3>
<p>Una <b>aplicación web progresiva (PWA)</b> es una página web que se puede <b>instalar</b> en el teléfono o la computadora como si fuera una app nativa, abre en su propia ventana y sigue funcionando aunque falle la red. Lo logra con dos piezas: un <b>manifiesto</b> (nombre, íconos y colores de la app) y un <b>service worker</b> (un programa que guarda en caché los archivos de la página).</p>
${tabla(['Requisito', 'Para qué sirve', 'Estado en el proyecto'], [['HTTPS', 'Seguridad; el service worker lo exige', '✔ Render publica con HTTPS'], ['Diseño adaptable', 'Funcionar en teléfono y escritorio', '✔ <code>styles.css</code>'], ['Aplicación de una sola página (SPA)', 'Navegar sin recargar', '✔ React Router'], ['<code>manifest.webmanifest</code>', 'Poder instalarla', '✔ <code>web/public/manifest.webmanifest</code> + íconos'], ['Service worker', 'Caché y modo sin conexión', '✔ <code>sw.js</code> generado en cada compilación (5.6)']], 'chica')}
${codigo('Estructura de web/src (interfaz React + Vite)', `web/src/
├── main.jsx, App.jsx     Arranque y rutas (React Router; RequireAuth protege todo menos /login)
├── api/client.js         Única puerta a la API: agrega el token y convierte errores
├── api/resources.js      Una función por operación (mercado, acciones, operación…)
├── context/              AuthContext (sesión) · BrokerContext (Alpaca o Webull)
├── hooks/                useAsync · useJob (trabajos 202) · useSondeo · useSeguimientoOrden (SSE)
├── pages/                Inicio, Análisis, Posiciones, Órdenes, Glosario, Configuración…
├── components/           TicketOrden, BotonOperar, CandleChart, PayoffChart, Gauge…
└── utils/                estrategiasOrden.js (armar patas), velas.js, indicadores.js, format.js`)}
${en('A progressive web app is a website that can be installed like a native app and keeps working offline. It needs HTTPS, a responsive design, a manifest and a service worker. Our React interface already meets the first requirements, and the source code is organized into API access, contexts, hooks, pages, components and utilities.')}`);

  pag('5. Modelo de datos • entidades • relaciones • control de versiones', `
<h3>5.2 Modelo de datos</h3>
<p>La interfaz muestra y edita estas entidades. Todas tienen un identificador único (UUID), fechas de creación y modificación, y pertenecen a un usuario. Se guardan igual en MongoDB y en Supabase: cada fila es <code>{ id, owner_id, document, revision }</code>, donde <code>revision</code> sirve para no pisar cambios de otra pestaña (409).</p>
${svg(640, 270, 'Entidades principales y sus relaciones', [
    caja(10, 45, 110, 36, 'Empresa', 'os'), caja(170, 25, 125, 30, 'DatoMercado', 'az'), caja(170, 62, 125, 30, 'ContratoOpcion', 'az'),
    caja(170, 99, 125, 30, 'Fundamental · 13F', 'az', { fs: 10 }), caja(170, 136, 125, 30, 'Noticia', 'az'),
    caja(345, 45, 115, 34, 'Evaluacion', 'am'), caja(345, 100, 115, 34, 'Confluencia', 'am'), caja(345, 155, 115, 34, 'Seleccion', 'am'),
    caja(505, 25, 130, 30, 'Estrategia', 've'), caja(505, 65, 130, 30, 'Configuracion', 've'), caja(505, 105, 130, 30, 'Orden', 'na'),
    caja(505, 145, 130, 30, 'ConexionBroker', 'na'), caja(505, 185, 130, 30, 'Posicion', 'na'),
    caja(10, 225, 345, 32, 'Además: Sesion · PerfilAnalisis · Sincronizacion · EventoAuditoria', 'gr', { fs: 10 }),
    flecha(120, 55, 168, 40, '1 a muchos', { fs: 8.5 }), flecha(120, 60, 168, 77), flecha(120, 66, 168, 114), flecha(120, 72, 168, 151),
    flecha(120, 52, 343, 60, '', { punteada: true }), flecha(402, 79, 402, 98), flecha(402, 134, 402, 153),
    flecha(570, 55, 570, 63), flecha(570, 95, 570, 103), flecha(570, 135, 570, 143), flecha(570, 175, 570, 183), flecha(460, 117, 503, 40),
  ].join(''), 'De la empresa salen sus datos y evaluaciones; de la estrategia, las configuraciones y órdenes.')}
${tabla(['Entidad', 'Campos que muestra la interfaz'], [['Empresa', 'símbolo, nombre, CIK, activo'], ['DatoMercado', 'velas OHLCV, bid/ask, IV y griegas de cada contrato'], ['Evaluacion', 'core, puntaje, sesgo, confianza, motivos, datos faltantes'], ['Confluencia / Seleccion', 'puntaje por estrategia, cobertura, pesos efectivos'], ['Orden / Posicion', 'tipo, precio, estado, eventos / lado, cantidad, precio promedio, ganancia o pérdida']], 'chica')}
${en('The data model links companies with their market data, contracts, financial statements and news. Each analysis creates evaluations, confluences and selections, while strategies lead to configurations, orders and positions. Every record has a unique id, an owner and a revision number that prevents overwriting changes.')}`);

  pag('5. Páginas de la aplicación • qué hace cada una • componentes clave', `
<h3>5.3 Páginas</h3>
${tabla(['Ruta', 'Página', 'Qué hace'], [
    ['/login', 'Inicio de sesión', 'Correo, contraseña y elección de base de datos (MongoDB o Supabase)'],
    ['/', 'Inicio', 'Mercado hoy (SPY, QQQ, DIA, IWM), mercado abierto o cerrado, Top 5 por estrategia, cartera simulada'],
    ['/analisis/:simbolo', 'Análisis', 'Buscador, gráfica de velas con promedios, cadena de opciones con griegas, fundamentales, 13F, noticias, lectura de los 5 cores y botón Operar'],
    ['/posiciones', 'Posiciones', 'Posiciones abiertas con ganancia o pérdida; cierre individual o del grupo'],
    ['/ordenes', 'Órdenes', 'Historial y seguimiento en vivo'],
    ['/glosario', 'Glosario', 'Términos de opciones e inversión'],
    ['/configuracion/*', 'Configuración', 'Perfiles, estrategias, configuraciones, empresas, conexiones de broker, sincronizaciones, auditoría, selección y mercado'],
  ], 'chica')}
${svg(640, 175, 'Navegación del usuario', [
    caja(5, 65, 95, 40, '/login', 'mo'), caja(140, 65, 95, 40, 'Inicio', 'az'), caja(275, 20, 130, 40, 'Análisis|/analisis/AAPL', 'am', { fs: 10 }),
    caja(275, 110, 130, 40, 'Configuración', 'gr'), caja(445, 20, 90, 40, 'Ticket', 'os', { forma: 'hex' }), caja(445, 110, 90, 40, 'Glosario', 'gr'),
    caja(560, 20, 75, 40, 'Órdenes', 've'), caja(560, 110, 75, 40, 'Posiciones', 've', { fs: 10 }),
    flecha(100, 85, 138, 85, 'token'), flecha(235, 78, 273, 45, 'buscar'), flecha(235, 92, 273, 125), flecha(405, 40, 443, 40, 'Operar'), flecha(535, 40, 558, 40),
    flecha(597, 60, 597, 108), flecha(405, 130, 443, 130),
  ].join(''), 'El camino principal: buscar, analizar, operar y vigilar.')}
<p><b>Componentes clave:</b> <code>TicketOrden</code> (editar → revisar → enviado), <code>BotonOperar</code> (arma las patas), <code>CandleChart</code> (velas con lightweight-charts), <code>PayoffChart</code> (diagrama de pago), <code>Gauge</code> (medidor de puntaje), <code>BrokerSelector</code> y <code>ResourceManager</code> + <code>SchemaForm</code> (CRUD genérico).</p>
${en('The application has a login page, a home dashboard, an analysis page per symbol, positions, orders, a glossary and a configuration area. The main path is to search a company, read the analysis, open the order ticket with the Operate button and then follow the order and the resulting positions.')}`);

  pag('5. Integración con la API • client.js • sesión • trabajos 202 • tiempo real', `
<h3>5.4 Integración con la API, paso a paso</h3>
${pasos(['<b>Una sola puerta.</b> Todas las páginas llaman a <code>request()</code> de <code>web/src/api/client.js</code>, que agrega <code>Authorization: Bearer &lt;token&gt;</code>, envía JSON y convierte las respuestas de error en un <code>ApiError</code> con el mensaje del servidor.', '<b>Sesión.</b> <code>AuthContext</code> guarda el token en <code>sessionStorage</code> (se borra al cerrar la pestaña). Si la API responde 401, la sesión se cierra y se regresa al login.', '<b>Funciones por recurso</b> en <code>api/resources.js</code>, para que ninguna página escriba direcciones a mano.', '<b>Trabajos 202.</b> El hook <code>useJob</code> consulta el registro hasta que esté «completada» o «fallida» y muestra el progreso.', '<b>Tiempo real.</b> <code>useSeguimientoOrden</code> lee Server-Sent Events con <code>fetch</code> (porque el token va en una cabecera); <code>useSondeo</code> actualiza cotizaciones cada 5 a 10 s solo con el mercado abierto.', '<b>Idempotencia.</b> El ticket genera un UUID al confirmar y lo reutiliza si el usuario pulsa «Reintentar envío».'])}
${svg(640, 135, 'Tres formas de respuesta que la interfaz maneja', [
    caja(5, 45, 105, 46, 'Página React', 'mo'), caja(140, 45, 115, 46, 'resources.js|request()', 'am', { fs: 10 }), caja(290, 40, 110, 56, 'Express|/api/v1', 'os', { forma: 'hex' }),
    caja(440, 8, 195, 34, '200: datos directos', 've', { fs: 10 }), caja(440, 50, 195, 34, '202: useJob consulta el trabajo', 'az', { fs: 10 }), caja(440, 92, 195, 34, 'SSE: avisos de la orden', 'na', { fs: 10 }),
    flecha(110, 68, 138, 68), flecha(255, 68, 288, 68, 'Bearer'), flecha(400, 60, 438, 25), flecha(400, 68, 438, 67), flecha(400, 76, 438, 109),
  ].join(''), 'La interfaz sabe esperar trabajos largos y escuchar avisos en vivo.')}
${en('Every page reaches the API through a single request function that adds the bearer token and turns errors into readable messages. A hook polls long jobs until they finish, another hook listens to live order events, and the order ticket reuses the same idempotency key whenever the user retries a failed submission.')}`);

  pag('5. Implementación paso a paso • manifest • service worker • despliegue', `
<h3>5.5 Implementación de la interfaz, paso a paso</h3>
${pasos(['Crear el proyecto: <code>npm create vite@latest web -- --template react</code> e instalar <code>react-router-dom</code> y <code>lightweight-charts</code>.', 'Definir las rutas en <code>App.jsx</code> y protegerlas con <code>RequireAuth</code>; <code>/login</code> queda pública.', 'Crear los contextos <code>AuthContext</code> y <code>BrokerContext</code>.', 'Construir páginas, componentes y utilidades puras (<code>estrategiasOrden.js</code>, <code>velas.js</code>, <code>indicadores.js</code>).', 'En desarrollo: <code>npm run dev</code> (API) y <code>npm run dev:web</code> (Vite, que redirige <code>/api</code> al servidor).', 'Compilar con <code>npm run build:all</code>; Express sirve <code>web/dist</code> y responde <code>index.html</code> a cualquier ruta que no sea <code>/api</code>, <code>/health</code> o <code>/assets</code>.'])}
<h3>5.6 PWA instalable (hecho con OpenSpec: <code>convertir-web-en-pwa</code>)</h3>
${pasos(['<b>Manifiesto e íconos</b>: <code>web/public/manifest.webmanifest</code> (nombre WinOpciones, <code>display: standalone</code>, color #3550b8) con íconos de 192, 512 y 512 <i>maskable</i>, y <code>apple-touch-icon</code> para iPhone.', '<b>Service worker</b> escrito a mano: precarga la cáscara (<code>index.html</code> + <code>/assets</code>), responde las páginas con <b>red primero</b> y la cáscara sin conexión, y <b>nunca</b> intercepta <code>/api</code>, <code>/health</code> ni el seguimiento en vivo.', '<b>Una versión por compilación</b>: un plugin de Vite genera <code>sw.js</code> con la lista de archivos y un hash; cada despliegue se detecta como versión nueva y borra la caché anterior.', '<b>Avisos</b>: «Hay una versión nueva · Recargar» (nunca recarga sola, para no perder un ticket) y «Sin conexión».', '<b>Comprobado en Edge</b>: instalable, la API no pasa por el service worker y sin red carga desde la caché.'])}
${svg(640, 120, '', [
    caja(5, 35, 120, 50, 'Navegador', 'mo'), caja(170, 30, 140, 60, 'Service worker', 'os', { forma: 'hex' }),
    caja(360, 10, 270, 40, 'index.html, /assets → caché (rápido, sin red)', 've', { fs: 10 }), caja(360, 70, 270, 40, '/api/... → siempre a la red (datos frescos)', 'na', { fs: 10 }),
    flecha(125, 60, 168, 60), flecha(310, 50, 358, 30), flecha(310, 70, 358, 90),
  ].join(''), 'El service worker separa lo que se puede guardar de lo que siempre debe ser fresco.')}
${en('The interface is built with Vite and React and served by Express. It is now an installable progressive web app: a manifest, icons and a service worker generated on every build cache the application shell, while API requests always go to the network because prices and orders must never be stale.')}`);

  pag('5. Pruebas de la interfaz y del proyecto • integración continua • verificación', `
<h3>5.7 Pruebas</h3>
${tabla(['Tipo', 'Archivo o herramienta', 'Qué comprueba'], [
    ['Unitarias de la interfaz', '<code>estrategias-orden</code>, <code>analisis-pagina</code>, <code>grafica-tecnica</code>, <code>graficas-busqueda</code> (.test.cjs)', 'Armado de patas, indicadores y gráficas'],
    ['Cores y Black-Scholes', '<code>cores.test.cjs</code>, <code>cinco-cores.test.cjs</code>', 'Valores de libro (10.4506 / 5.5735), caso NVDA, reglas'],
    ['Integraciones', '<code>integrations.test.cjs</code>, <code>webull.test.cjs</code>', 'Formato de órdenes, solo paper, errores sin secretos (con fetch simulado)'],
    ['Integración HTTP', '<code>http.test.cjs</code>, <code>acciones.test.cjs</code>', 'Flujo completo: sincronizar → cores → selección → orden'],
    ['Estructura', '<code>estructura.test.cjs</code>', 'Rutas documentadas y capas respetadas'],
    ['Compilación', '<code>npm --prefix web run build</code>', 'La página compila sin errores'],
    ['De extremo a extremo', 'Playwright', 'Login, análisis y ticket en un navegador real'],
    ['Integración continua', 'GitHub Actions (<code>pruebas.yml</code>)', '<code>npm run verificar</code> en cada subida; Render publica solo si pasa'],
  ], 'chica')}
<p>Estado actual: <b>337 pruebas aprobadas y 0 fallidas</b>, ESLint sin observaciones, la página compila y la colección E2E pasa. El inciso C detalla todos los tipos de prueba.</p>
${svg(640, 100, 'Cadena de verificación antes de publicar', [
    caja(5, 35, 130, 44, 'npm run lint', 'am'), caja(170, 35, 130, 44, 'npm test|(337 pruebas)', 'az', { fs: 10 }), caja(335, 35, 135, 44, 'compilar la página', 've'), caja(505, 35, 130, 44, 'Render publica|si todo pasa', 'os', { forma: 'hex', fs: 10 }),
    flecha(135, 57, 168, 57), flecha(300, 57, 333, 57), flecha(470, 57, 503, 57),
  ].join(''), 'Ningún cambio llega al servidor público sin pasar las tres comprobaciones.')}
${en('The project is tested at several levels: unit tests for interface utilities and cores, adapter tests with a simulated network, full HTTP flow tests, structure tests and the web build. Continuous integration runs everything on every push, and the public server is only updated when all checks pass.')}`);

};
