// Portada, índice, introducción y secciones 1 (inversiones) y 2 (opciones).
module.exports = (pag, h) => {
  const { texto, caja, flecha, linea, svg, figura, payoff, velas, en, tabla, ul, pasos, nota } = h;

  // ---------- Portada ----------
  pag('Portada • Datos generales • Guía de estrategias con opciones', `
<div class="logos"><img src="img/tecnm.png" class="tecnm"><img src="img/itt.png" class="itt"></div>
<div class="portada">
<p>Tecnológico Nacional de México</p><p>Instituto Tecnológico de Tepic</p><p>Ingeniería en Sistemas Computacionales</p><br>
<p>Laboratorio de servicios web</p><p>Tema 3. Desarrollo de Microservicios.</p>
<p>T3-Actividad 2. Desarrollar, implementar y optimizar microservicios en el proyecto.</p>
<p><b>Incisos A, B y C</b><br>A) Guía paso a paso de las estrategias asignadas (Long Call, Long Put e Iron Condor)<br>B) Microservicios optimizados con SDD (OpenSpec) · C) Pruebas y monitoreo de las APIs</p><br>
<p>Equipo 9 - Integrantes:</p><p>- Castellanos Machuca Edwin Uriel - 20400714</p>
<p>Docente: Dr. Francisco Ibarra Carlos</p><p>Grupo: 5B</p><p>Fecha de entrega: 26 noviembre 2026</p>
</div>`);

  // ---------- Índice ----------
  pag('Palabras clave: Índice · Guía · Mapa de secciones', '<h2 class="centro">Índice</h2><div id="indice"></div>', { indice: true });

  // ---------- Introducción ----------
  pag('Introducción • Descripción de la actividad • Objetivo de la unidad • Propósito', `
<h2 class="centro">Introducción</h2>
<p><b>Descripción de la actividad</b>: <mark class="g">desarrollar, implementar y optimizar los microservicios del proyecto final AppRESTOpciones, una plataforma de estrategias de inversión con opciones en la bolsa de EE. UU. La actividad pide tres cosas: una guía paso a paso de las estrategias asignadas al equipo, la aplicación de técnicas de desarrollo y optimización de microservicios usando un framework de desarrollo guiado por especificaciones (OpenSpec), y las pruebas y el monitoreo de las APIs.</mark></p>
<p><b>Objetivo de la unidad al que abona la actividad</b>: <mark class="o">«Diseña y aplica microservicios a contextos reales» (competencia específica del Tema 3).</mark></p>
<p><b>¿Cómo abona esta actividad al objetivo?</b> El objetivo pide aplicar microservicios a un <i>contexto real</i>, y no se puede diseñar bien un servicio sin entender el negocio que atiende. Cada inciso aporta una parte de esa competencia:</p>
${ul(['<b>A) Diseñar con contexto</b>: la guía explica el negocio (qué es una opción, cómo se arma cada estrategia, cómo la recibe un broker y qué calcula cada servicio), y con eso se justifica por qué existe cada API y qué límites tiene, por ejemplo la idempotencia de las órdenes.',
    '<b>B) Aplicar y optimizar</b>: con el framework SDD OpenSpec se especificaron y aplicaron técnicas de microservicios a todas las APIs (circuit breaker, readiness, drenado al apagar) y la IA propuso una estructura por dominio, más fácil de separar en servicios.',
    '<b>C) Comprobar en condiciones reales</b>: pruebas unitarias, de integración, de contrato, E2E, de carga, de estrés y de seguridad, más el monitoreo (métricas, logs, errores, uso y monitoreo sintético), demuestran que los servicios funcionan y avisan cuando dejan de hacerlo.'])}
<p><b>Propósito.</b> Que cualquier persona, aun sin conocimientos previos de bolsa ni de microservicios, entienda cómo funcionan las estrategias asignadas, cómo se optimizaron las APIs con OpenSpec y cómo se prueban y vigilan.</p>
${en('This activity asks us to develop, optimize, test and monitor the microservices of our final project. Part A explains the options strategies and the business context, part B applies microservice techniques with the OpenSpec framework, and part C proves with tests and monitoring that the services work in real conditions.')}`);

  pag('Introducción • Objetivos • Incisos de la actividad A, B y C • Mapa de la guía', `
<p><b>Objetivos de este documento</b></p>
${pasos(['Explicar desde cero los conceptos de inversión, el mercado de valores y el marco regulatorio y ético del proyecto.', 'Explicar qué es una opción, cómo se valúa (Black-Scholes y griegas) y detallar las estrategias asignadas: Long Call, Long Put e Iron Condor.', 'Mostrar cómo se opera cada estrategia en los brokers que usa el proyecto (Alpaca y Webull).', 'Explicar a fondo la estructura del código, cómo se usan las APIs y cómo funcionan los cinco cores, la confluencia y los modos de selección.', 'Describir el desarrollo de la aplicación web progresiva (PWA).', '<b>B) y C)</b> Optimizar las APIs con OpenSpec (comparando IA y manual), y probarlas y monitorearlas.'])}
<p><b>Subdivisiones principales: los incisos de la actividad</b></p>
<p class="inciso"><mark class="y">A) Generar una guía paso a paso de las estrategias que le fueron asignadas a cada equipo</mark> (desarrollado en este documento, puntos 1 a 5 del mapa de la guía).</p>
<p class="inciso"><mark class="y">B) Aplicar las técnicas para el desarrollo y optimización de microservicios para todas las APIs del proyecto final, usando el framework SDD OpenSpec.</mark> (sección B de este documento)</p>
<p class="inciso"><mark class="y">C) Realizar las pruebas y monitoreo de los microservicios de las APIs.</mark> (sección C de este documento)</p>
${svg(640, 230, 'Mapa del inciso A', [
    caja(5, 95, 125, 55, 'Lector sin|conocimientos|previos', 'os', { forma: 'hex', fs: 10.5 }),
    caja(175, 22, 165, 34, '1. Inversiones', 'am'), caja(175, 66, 165, 34, '2. Opciones', 'am'), caja(175, 110, 165, 34, '3. Brokers', 've'),
    caja(175, 154, 165, 34, '4. Estructura, APIs y cores', 'az'), caja(175, 196, 165, 30, '5. PWA (interfaz)', 'mo'),
    caja(395, 95, 120, 55, 'Entiende el|contexto real', 'na'), caja(545, 80, 90, 85, 'Base para|B) OpenSpec|y|C) pruebas', 'gr', { fs: 10 }),
    flecha(130, 112, 173, 39), flecha(130, 118, 173, 83), flecha(130, 123, 173, 127), flecha(130, 128, 173, 171), flecha(130, 134, 173, 211),
    flecha(340, 39, 393, 110), flecha(340, 83, 393, 116), flecha(340, 127, 393, 122), flecha(340, 171, 393, 128), flecha(340, 211, 393, 134),
    flecha(515, 122, 543, 122),
  ].join(''), 'Las cinco secciones del inciso A llevan del concepto básico al contexto que usan los incisos B y C, desarrollados después en este documento.')}
${en('The activity has three parts. Part A is a guide to the assigned strategies, part B applies microservice optimization techniques with the OpenSpec framework, and part C covers testing and monitoring. This document develops the three parts in order, from basic investment ideas to the tests and the monitoring of the APIs.')}`);

  // ---------- Sección 1 ----------
  pag('A) 1. Introducción a inversiones • ¿qué es invertir? • riesgo y rendimiento', `
<h2 class="sec"><mark class="y">A) Generar una guía paso a paso de las estrategias asignadas</mark></h2>
<h2>1. Introducción a Inversiones</h2>
<h3>1.1 ¿Qué es invertir?</h3>
<p><b>Invertir</b> es entregar dinero hoy con la expectativa de recibir más en el futuro. La diferencia entre lo que se recibe y lo que se entregó es el <b>rendimiento</b>. El precio de esa expectativa es el <b>riesgo</b>: la posibilidad de recibir menos de lo esperado, o incluso perder lo invertido.</p>
${nota('Ejemplo cotidiano.', 'Si prestas 1 000 pesos a un amigo y te devuelve 1 100 en un año, tu rendimiento fue de 10 %. El riesgo es que no te pague. Si en lugar de prestarle compras una parte de su negocio, ganarás más si el negocio crece, pero podrías perder si quiebra: más rendimiento esperado, más riesgo.')}
<p>Toda decisión de inversión responde tres preguntas:</p>
${tabla(['Pregunta', 'Concepto', 'Cómo se mide en el proyecto'], [
    ['¿Cuánto espero ganar?', 'Rendimiento', 'Ganancia máxima y probabilidad de ganancia de cada estrategia'],
    ['¿Cuánto puedo perder?', 'Riesgo', 'Pérdida máxima y volatilidad del precio'],
    ['¿Cuándo recupero mi dinero?', 'Liquidez y horizonte', 'Días al vencimiento de la opción y spread bid/ask'],
  ])}
${svg(640, 150, 'La relación entre rendimiento y riesgo', [
    caja(10, 55, 120, 50, 'Dinero hoy|1 000 USD', 've'), caja(200, 40, 150, 80, 'Inversión|(tiempo + incertidumbre)', 'am'),
    caja(430, 25, 200, 40, 'Escenario bueno: 1 200 USD', 've'), caja(430, 95, 200, 40, 'Escenario malo: 800 USD', 'ro'),
    flecha(130, 80, 198, 80, 'se entrega'), flecha(350, 70, 428, 45, 'rendimiento'), flecha(350, 90, 428, 115, 'riesgo', { dy: 10 }),
  ].join(''), 'Invertir es aceptar un rango de resultados posibles a cambio de un rendimiento esperado.')}
${en('Investing means giving money today in exchange for the expectation of receiving more in the future. The extra money is the return, and the possibility of receiving less is the risk. Every investment decision balances how much we expect to gain, how much we can lose and when we can get the money back.')}`);

  pag('1. Tipos de inversión • renta fija • acciones • ETF • derivados • opciones', `
<h3>1.2 Tipos de inversión</h3>
<p>Los instrumentos financieros se agrupan según <b>qué se compra realmente</b>. El proyecto trabaja con <b>opciones</b>, que son derivados, pero usa los otros tipos como referencia:</p>
${tabla(['Tipo', 'Qué compras', 'Riesgo', 'Ejemplo', 'Uso en el proyecto'], [
    ['Renta fija', 'Un préstamo a un gobierno o empresa, que te paga intereses', 'Bajo', 'Letra del Tesoro de EE. UU. a 3 meses', 'Su tasa es la «tasa libre de riesgo» de Black-Scholes'],
    ['Renta variable (acciones)', 'Una parte de una empresa', 'Medio–alto', '1 acción de Apple (AAPL)', 'Es el <b>subyacente</b>: el activo del que depende la opción'],
    ['Fondos y ETF', 'Una canasta de muchas acciones que cotiza como una sola', 'Medio', 'SPY (500 empresas más grandes de EE. UU.)', 'Tablero «Mercado hoy»: SPY, QQQ, DIA, IWM'],
    ['Derivados: <b>opciones</b>', 'Un <b>contrato</b> que da el derecho de comprar (call) o vender (put) una acción a un precio fijo', 'Alto (apalancado)', 'Call de AAPL con precio pactado 230', '<b>Es lo que analiza y opera el proyecto</b>'],
    ['Derivados: futuros', 'Un contrato con la <i>obligación</i> de comprar o vender en una fecha', 'Alto', 'Futuro del petróleo', 'No se usa'],
    ['Divisas y materias primas', 'Monedas, oro, petróleo', 'Variable', 'USD/MXN', 'No se usa'],
  ], 'chica')}
${nota('¿Qué es un derivado?', 'Es un contrato cuyo valor «se deriva» de otro activo. Una opción sobre AAPL vale más o menos según suba o baje la acción de AAPL, aunque el contrato en sí no es la acción.')}
${svg(640, 128, 'Escalera de riesgo: dónde trabaja el proyecto', [
    caja(5, 60, 115, 50, 'Renta fija|T-Bills · CETES', 've'), caja(135, 60, 115, 50, 'ETF|SPY · QQQ', 'az'),
    caja(265, 60, 115, 50, 'Acciones|AAPL · TSLA', 'am'), caja(395, 52, 125, 66, 'OPCIONES|calls y puts|(derivados)', 'na', { bold: true }),
    caja(535, 60, 100, 50, 'Futuros|apalancado', 'ro'),
    flecha(120, 85, 133, 85), flecha(250, 85, 263, 85), flecha(380, 85, 393, 85), flecha(520, 85, 533, 85),
    texto(457, 35, '▼ AppRESTOpciones', { fs: 10.5, color: '#b85450', bold: true }),
  ].join(''), 'Las opciones se ubican en el extremo de mayor riesgo, por eso el proyecto solo opera con dinero simulado.')}
${en('Investments are grouped by what we actually buy: debt, part of a company, a basket of stocks or a contract. Options are derivatives, contracts whose value depends on a stock. They are the main subject of our project, while bonds, stocks and funds are used as references and inputs.')}`);

  pag('1. Mercado de valores • acción • bolsa • broker • ticker • horario', `
<h3>1.3 ¿Cómo funciona el mercado de valores?</h3>
<p>Una <b>acción</b> es una pequeña parte de una empresa. Las empresas venden acciones para conseguir dinero, y después esas acciones se compran y venden entre inversionistas en una <b>bolsa de valores</b> (NYSE o Nasdaq en EE. UU.). Un inversionista no entra directamente a la bolsa: lo hace a través de un <b>broker</b> (casa de bolsa), que recibe la orden y la lleva al mercado.</p>
${svg(640, 150, 'Recorrido de una orden de compra', [
    caja(5, 50, 110, 50, 'Inversionista|«compra 1 AAPL»', 'mo'), caja(160, 50, 110, 50, 'Broker|Alpaca · Webull', 'am'),
    caja(315, 45, 130, 60, 'Bolsa|NYSE · Nasdaq|(y mercados de opciones)', 'os', { forma: 'hex', fs: 10 }), caja(490, 50, 145, 50, 'Vendedor|alguien que vende', 'ro'),
    flecha(115, 75, 158, 75, 'orden'), flecha(270, 75, 313, 75, 'envía'), flecha(445, 75, 488, 75, 'encuentra'),
    texto(320, 130, 'El precio se forma por el encuentro entre compradores y vendedores', { fs: 11, color: '#444' }),
  ].join(''), 'El broker es el intermediario obligatorio entre el inversionista y la bolsa.')}
${tabla(['Concepto', 'Qué significa', 'Ejemplo'], [
    ['Ticker o símbolo', 'Código corto que identifica a la empresa', 'AAPL = Apple, TSLA = Tesla, MSFT = Microsoft'],
    ['Precio', 'Último precio al que se hizo una operación', 'AAPL a 230 USD'],
    ['Volumen', 'Cuántas acciones se negociaron en un periodo', '1.2 millones de acciones en un día'],
    ['Horario', 'La bolsa de EE. UU. abre de 9:30 a 16:00 hora de Nueva York, de lunes a viernes', 'La app consulta <code>GET /mercado/estado</code> y no envía órdenes con el mercado cerrado'],
    ['Long / Short', 'Comprar esperando que suba / vender esperando que baje', 'Long en AAPL: ganas si AAPL sube'],
    ['Paper trading', 'Operar en una cuenta simulada: precios reales, dinero ficticio', 'Todas las órdenes del proyecto'],
  ], 'chica')}
${en('A share is a small part of a company, and shares are traded on stock exchanges such as the NYSE and Nasdaq. Investors cannot access the exchange directly, so they send orders through a broker. Each company is identified by a ticker, and the regular market session runs from 9:30 to 16:00 in New York.')}`);

  pag('1. Vela OHLCV • gráfica de precios • bid • ask • spread', `
<h3>1.4 Cómo se lee una gráfica de precios: la vela OHLCV</h3>
<p>Como el precio cambia cada segundo, para analizarlo se resume cada día en una <b>vela</b> con cinco datos: <b>O</b>pen (apertura), <b>H</b>igh (máximo), <b>L</b>ow (mínimo), <b>C</b>lose (cierre) y <b>V</b>olume (volumen). Si el cierre es mayor que la apertura la vela es <b>verde</b> (el día subió); si es menor, <b>roja</b>.</p>
<div class="dos">
<div>${svg(300, 170, 'Partes de una vela', [
    linea(80, 30, 80, 150, '#38761d', 2), `<rect x="62" y="50" width="36" height="70" fill="#93c47d" stroke="#38761d"/>`,
    texto(150, 30, 'H = 103 (máximo)', { anchor: 'start', fs: 10 }), texto(150, 50, 'C = 102 (cierre)', { anchor: 'start', fs: 10 }),
    texto(150, 120, 'O = 100 (apertura)', { anchor: 'start', fs: 10 }), texto(150, 150, 'L = 99 (mínimo)', { anchor: 'start', fs: 10 }),
    flecha(148, 30, 84, 30), flecha(148, 50, 100, 50), flecha(148, 120, 100, 120), flecha(148, 150, 84, 150),
  ].join(''), 'Vela verde: cerró arriba de su apertura.')}</div>
<div>${svg(300, 170, '', velas([[100, 103, 99, 102], [102, 104, 100, 101], [101, 102, 97, 98], [98, 101, 97, 100], [100, 105, 99, 104], [104, 106, 102, 103], [103, 104, 99, 100], [100, 103, 99, 102]], 300, 160, 'Ocho días de precio'), 'Una serie de velas muestra la tendencia.')}</div>
</div>
<p>En el proyecto, cada vela se guarda en el recurso <code>datos-mercado</code> con <code>tipo: 'vela'</code>; la obtiene el servicio de sincronización desde Alpaca.</p>
${en('A daily candle summarizes four prices and the volume of one trading day. Green candles closed higher than they opened and red candles closed lower. A sequence of candles shows the trend of the price, and our project stores every daily candle it downloads from Alpaca.')}`);

  pag('1. Bid • ask • spread • mid • liquidez • perfil del inversionista', `
<h3>1.5 Bid, ask y spread: el costo de entrar y salir</h3>
<p>En cada momento hay dos precios: el <b>bid</b> (lo máximo que alguien está dispuesto a pagar) y el <b>ask</b> (lo mínimo por lo que alguien está dispuesto a vender). La diferencia es el <b>spread</b>, y es un costo: si compras al ask y vendes de inmediato al bid, pierdes el spread. El punto medio se llama <b>mid</b>.</p>
${svg(640, 95, '', [
    linea(40, 50, 600, 50, '#888', 2), caja(140, 30, 90, 40, 'Bid 5.80|(compran)', 've', { fs: 10 }), caja(275, 30, 90, 40, 'Mid 6.275', 'gr', { fs: 10 }), caja(410, 30, 90, 40, 'Ask 6.75|(venden)', 'ro', { fs: 10 }),
    texto(320, 85, 'Spread = 6.75 − 5.80 = 0.95 por acción  →  95 USD por contrato de opciones', { fs: 10.5, color: '#444' }),
  ].join(''), 'El ticket de la app avisa si el spread de una pata supera el 10 % del mid en una orden a mercado.')}
<h3>1.6 Liquidez: ¿qué tan fácil es comprar o vender?</h3>
<p>Un activo es <b>líquido</b> cuando hay muchos compradores y vendedores, y por eso su spread es pequeño. Las acciones grandes (AAPL, MSFT) son muy líquidas; muchas opciones no lo son, sobre todo las de strikes lejanos o vencimientos largos. Por eso el proyecto revisa dos datos de cada contrato:</p>
${tabla(['Dato', 'Qué indica', 'Uso en el proyecto'], [['Volumen del día', 'Cuántos contratos se negociaron hoy', 'Un contrato sin operaciones no se propone para operar'], ['Interés abierto', 'Cuántos contratos siguen abiertos en el mercado', 'Se guarda con cada contrato y se muestra como aviso'], ['Spread / mid', 'Qué tan caro es entrar y salir', 'Con spread mayor a 25 % no se fija precio; con más de 10 % en orden a mercado se avisa']], 'chica')}
<h3>1.7 Perfil del inversionista</h3>
${tabla(['Perfil', 'Tolerancia a pérdidas', 'Estrategia asignada que le conviene'], [['Conservador', 'Baja', 'Ninguna de compra pura; quizá Iron Condor con alas estrechas'], ['Moderado', 'Media', 'Iron Condor: pérdida máxima conocida desde el inicio'], ['Agresivo', 'Alta', 'Long Call o Long Put: pierden la prima a menudo, pero ganan mucho cuando aciertan']], 'chica')}
${en('At any moment there is a bid price and an ask price, and their difference, the spread, is a real cost of trading. Liquid assets have many buyers and sellers and small spreads, while many option contracts are illiquid. That is why our project checks volume, open interest and spread before proposing an order.')}`);

  pag('1. Rendimiento • volatilidad paso a paso • √252 • calma vs agitación', `
<h3>1.8 Rendimiento y volatilidad, paso a paso</h3>
<p>La <b>volatilidad</b> mide qué tanto «salta» el precio. Es el concepto más importante para las opciones, porque una opción vale más cuando el precio puede moverse mucho. Se calcula así:</p>
${pasos(['Calcular el <b>rendimiento logarítmico</b> de cada día: <code>r = ln(cierre de hoy / cierre de ayer)</code>. Se usan logaritmos porque se pueden sumar día con día.', 'Calcular la <b>desviación estándar</b> de esos rendimientos (qué tan dispersos están respecto a su promedio): σ diaria.', '<b>Anualizar</b>: multiplicar por √252, porque un año tiene unas 252 sesiones y las varianzas de días independientes se suman.'])}
${tabla(['Día', 'Cierre', 'Rendimiento log', 'Cálculo'], [['1', '100', '—', '—'], ['2', '102', '+0.0198', 'ln(102/100)'], ['3', '99', '−0.0299', 'ln(99/102)'], ['4', '101', '+0.0200', 'ln(101/99)'], ['5', '104', '+0.0293', 'ln(104/101)'], ['6', '103', '−0.0097', 'ln(103/104)']], 'chica')}
<p>Desviación estándar = <b>0.0248</b> diaria → 0.0248 × √252 = 0.0248 × 15.87 = <b>0.394</b>, es decir, <b>39.4 % anual</b>. El proyecto obtiene exactamente el mismo número con la función <code>util.volatilidadHistorica</code> del core de indicadores.</p>
<div class="dos">
<div>${svg(300, 130, '', [`<polyline points="20,70 50,66 80,72 110,68 140,71 170,67 200,70 230,68 260,71 290,69" fill="none" stroke="#2e75b6" stroke-width="2.2"/>`, texto(150, 15, 'Volatilidad baja (≈ 10 %)', { fs: 11, bold: true, color: '#1f3864' }), texto(150, 115, 'movimientos pequeños', { fs: 10, color: '#555' })].join(''), 'Precio tranquilo: opciones baratas.')}</div>
<div>${svg(300, 130, '', [`<polyline points="20,70 50,35 80,95 110,40 140,100 170,30 200,90 230,45 260,100 290,50" fill="none" stroke="#c00000" stroke-width="2.2"/>`, texto(150, 15, 'Volatilidad alta (≈ 60 %)', { fs: 11, bold: true, color: '#1f3864' }), texto(150, 115, 'saltos grandes', { fs: 10, color: '#555' })].join(''), 'Precio agitado: opciones caras.')}</div>
</div>
${en('Volatility measures how much a price moves, and it is the most important input for options. We compute it with logarithmic returns, take their standard deviation and multiply by the square root of 252 trading days. Our example gives 39.4 percent per year, the same value the indicators core returns.')}`);

  pag('1. Marco regulatorio • SEC • FINRA • OCC • CNBV • datos personales', `
<h3>1.9 Marco regulatorio</h3>
<p>Los mercados financieros están regulados para proteger a los inversionistas. Estas son las instituciones y normas que tocan al proyecto:</p>
${tabla(['Organismo o norma', 'Qué regula', 'Relación con el proyecto'], [
    ['<b>SEC</b> (Securities and Exchange Commission, EE. UU.)', 'El mercado de valores. Obliga a las empresas a publicar sus estados financieros (10-K anual, 10-Q trimestral) y a los grandes gestores a declarar sus posiciones (13F)', 'Es la fuente de los cores fundamental e institucional. Exige identificarse con un User-Agent con contacto y no hacer más de 10 solicitudes por segundo'],
    ['<b>FINRA</b> (EE. UU.)', 'A los brokers. Define niveles de aprobación para operar opciones', 'Para un Iron Condor se necesita nivel 3 en Alpaca'],
    ['<b>OCC</b> (Options Clearing Corporation)', 'Garantiza y liquida los contratos de opciones; define su símbolo', 'El proyecto lee y arma símbolos como TSLA261201P00352500'],
    ['Regla FINRA 4210 «Pattern Day Trader»', 'Cuentas con menos de 25 000 USD que hacen 4 o más operaciones intradía en 5 días', 'Solo aplica a cuentas reales; el proyecto usa cuentas simuladas'],
    ['<b>CNBV</b> (México)', 'El mercado de valores mexicano', 'Un residente en México que opera en EE. UU. lo hace mediante un broker extranjero'],
    ['<b>LFPDPPP</b> (México)', 'Protección de datos personales', 'Las contraseñas se guardan con scrypt y los tokens con hash; las credenciales nunca llegan al navegador'],
  ], 'chica')}
${svg(640, 125, 'Cadena de control', [
    caja(10, 40, 125, 50, 'Reguladores|SEC · FINRA · OCC', 'os', { forma: 'hex', fs: 10 }), caja(180, 40, 120, 50, 'Broker|nivel de opciones', 'am'),
    caja(345, 40, 135, 50, 'AppRESTOpciones|solo cuentas paper', 'az', { fs: 10.5 }), caja(525, 40, 110, 50, 'Usuario|decide él', 've'),
    flecha(135, 65, 178, 65, 'reglas'), flecha(300, 65, 343, 65, 'permisos'), flecha(480, 65, 523, 65, 'avisos'),
  ].join(''), 'Cada capa limita a la siguiente; ninguna orden del proyecto llega a una cuenta real.')}
${en('Financial markets are regulated to protect investors. In the United States, the SEC supervises the stock market and publishes the company reports we use, FINRA supervises brokers and their options approval levels, and the OCC clears every option contract. In Mexico, the CNBV and the personal data law also apply.')}`);

  pag('1. Marco ético del proyecto • solo paper • transparencia • ADR-020', `
<h3>1.10 Marco ético del proyecto</h3>
<p>El proyecto es <b>académico</b>. Por eso tiene reglas éticas que no son solo recomendaciones: están escritas en el código y en el registro de decisiones técnicas (ADR) del repositorio.</p>
${tabla(['Regla', 'Cómo la cumple el código'], [
    ['<b>Solo dinero simulado</b> (ADR-005)', 'La dirección de trading de Alpaca está fija a <code>paper-api.alpaca.markets</code>; cualquier otra lanza el error <code>NO_PERMITIDO</code>. Webull solo acepta su entorno de pruebas (sandbox)'],
    ['<b>No es asesoría financiera</b>', 'El puntaje 0–100 mide qué tan coherentes son los datos con una estrategia; la interfaz repite que <b>no es la probabilidad de ganar</b>'],
    ['<b>Honestidad con los resultados</b> (ADR-020)', 'Se hizo una prueba histórica con 2 856 casos reales (100 empresas, 30 vencimientos de 2024 a 2026). Ningún puntaje anticipó la ganancia, y se documentó en lugar de esconderlo'],
    ['<b>No inventar datos</b>', 'Si falta un dato, el core lo declara en <code>datosFaltantes</code> y baja su cobertura'],
    ['<b>Sin ventaja del futuro</b>', 'Los cores descartan cualquier dato posterior a la fecha de análisis (<code>fechaReferencia</code>)'],
    ['<b>Credenciales protegidas</b> (ADR-006)', 'Las claves de los brokers viven solo en variables del servidor; el navegador nunca las ve'],
    ['<b>Uso justo de proveedores</b>', 'Alpaca: máximo 180 solicitudes por minuto; SEC: al menos 120 ms entre solicitudes'],
  ], 'chica')}
${svg(640, 150, 'Resultado de la prueba histórica (ADR-020)', [
    texto(110, 35, 'Long Call', { bold: true }), `<rect x="60" y="48" width="100" height="18" fill="#eee" stroke="#999"/><rect x="60" y="48" width="38" height="18" fill="#93c47d"/>`, texto(110, 80, 'gana 38 % de las veces', { fs: 10 }),
    texto(320, 35, 'Long Put', { bold: true }), `<rect x="270" y="48" width="100" height="18" fill="#eee" stroke="#999"/><rect x="270" y="48" width="29" height="18" fill="#93c47d"/>`, texto(320, 80, 'gana 29 % de las veces', { fs: 10 }),
    texto(530, 35, 'Iron Condor', { bold: true }), `<rect x="480" y="48" width="100" height="18" fill="#eee" stroke="#999"/><rect x="480" y="48" width="67" height="18" fill="#93c47d"/>`, texto(530, 80, 'gana 67 % de las veces', { fs: 10 }),
    texto(320, 120, 'Ganar seguido no significa ganar dinero: el tamaño de cada ganancia y pérdida también cuenta.', { fs: 10.5, color: '#b85450' }),
  ].join(''), 'Porcentaje de veces que cada estrategia terminó con ganancia en la prueba con precios reales.')}
${en('The project follows strict ethical rules written in the code. Orders only go to simulated accounts, scores are never presented as the probability of profit, and missing data is declared instead of invented. A historical test with real prices showed that no score predicted the result, and we documented it honestly.')}`);

  // ---------- Sección 2 ----------
  pag('2. Inversión con opciones • ¿qué es una opción? • call • put', `
<h2>2. Inversión con Opciones</h2>
<h3>2.1 ¿Qué es una opción?</h3>
<p>Una <b>opción</b> es un contrato que da el <b>derecho, pero no la obligación</b>, de comprar o vender una acción a un precio fijo (llamado <b>strike</b> o precio de ejercicio) hasta una fecha límite (el <b>vencimiento</b>). Por ese derecho se paga un precio llamado <b>prima</b>.</p>
<div class="dos">
<div>${nota('Call = «vale de compra».', 'Imagina que pagas 500 pesos por apartar una casa a 1 millón durante 3 meses. Si en ese tiempo la casa sube a 1.2 millones, ejerces tu derecho, la compras a 1 millón y ganas. Si baja, no la compras y solo pierdes los 500 del apartado. Eso es un <b>call</b>: ganas si el precio <b>sube</b>.')}</div>
<div>${nota('Put = «seguro».', 'Ahora imagina que tienes un auto y pagas un seguro que te garantiza venderlo en 100 mil aunque se dañe. Si el auto pierde valor, el seguro te protege. Eso es un <b>put</b>: el derecho a <b>vender</b> a un precio fijo, y ganas si el precio <b>baja</b>.')}</div>
</div>
${svg(640, 200, 'Call y put frente al precio de la acción', [
    caja(245, 15, 150, 40, 'Precio de la acción|hoy: 100 USD', 'gr', { fs: 10.5 }),
    caja(40, 95, 230, 44, 'CALL con strike 100|derecho a COMPRAR a 100', 've', { fs: 10.5 }), caja(370, 95, 230, 44, 'PUT con strike 100|derecho a VENDER a 100', 'ro', { fs: 10.5 }),
    flecha(280, 55, 160, 93, 'si sube a 120'), flecha(360, 55, 485, 93, 'si baja a 80'),
    caja(40, 155, 230, 38, 'Compro a 100 lo que vale 120:|gano 20 por acción', 'am', { fs: 10 }), caja(370, 155, 230, 38, 'Vendo a 100 lo que vale 80:|gano 20 por acción', 'am', { fs: 10 }),
    flecha(155, 139, 155, 153), flecha(485, 139, 485, 153),
  ].join(''), 'El call gana cuando la acción sube por encima del strike; el put, cuando baja por debajo.')}
${en('An option is a contract that gives the right, but not the obligation, to buy or sell a stock at a fixed price before a certain date. A call is like a reservation to buy, and it gains when the price rises. A put works like insurance that lets you sell, and it gains when the price falls.')}`);

  pag('2. Elementos de un contrato • strike • prima • vencimiento • multiplicador • símbolo OCC', `
<h3>2.2 Elementos de un contrato de opciones</h3>
${tabla(['Elemento', 'Qué es', 'Ejemplo'], [
    ['Subyacente', 'La acción sobre la que se hace el contrato', 'TSLA'],
    ['Tipo', 'Call (comprar) o put (vender)', 'Put'],
    ['Strike (K)', 'Precio fijo al que se puede comprar o vender', '352.50 USD'],
    ['Vencimiento', 'Último día en que el contrato vale; el código lo toma a las 16:00 de Nueva York', '1 de diciembre de 2026'],
    ['Prima', 'Precio de la opción, expresado <b>por acción</b>', '3.97 USD'],
    ['Multiplicador', 'Un contrato cubre <b>100 acciones</b>, así que el costo real es prima × 100', '3.97 × 100 = 397 USD'],
  ], 'chica')}
<p><b>El símbolo OCC</b> junta todo en un solo texto. El proyecto lo lee con la función <code>parsearOcc</code> y lo usa para enviar órdenes a los brokers:</p>
${svg(640, 150, 'Cómo leer TSLA261201P00352500', [
    caja(40, 30, 90, 40, 'TSLA', 'az', { bold: true, fs: 13 }), caja(140, 30, 110, 40, '261201', 'am', { bold: true, fs: 13 }), caja(260, 30, 50, 40, 'P', 'ro', { bold: true, fs: 13 }), caja(320, 30, 150, 40, '00352500', 've', { bold: true, fs: 13 }),
    texto(85, 95, 'subyacente|Tesla', { fs: 10 }), texto(195, 95, 'AAMMDD|1-dic-2026', { fs: 10 }), texto(285, 95, 'P = put|C = call', { fs: 10 }), texto(395, 95, 'strike × 1000|= 352.50', { fs: 10 }),
    flecha(85, 72, 85, 82), flecha(195, 72, 195, 82), flecha(285, 72, 285, 82), flecha(395, 72, 395, 82),
    caja(500, 30, 135, 80, 'Un put de Tesla|que vence el 1-dic-2026|con strike 352.50', 'gr', { fs: 10 }), flecha(470, 50, 498, 60),
  ].join(''), 'Cada parte del símbolo OCC tiene un significado fijo.')}
<h3>2.3 Valor intrínseco, valor extrínseco y «dinero»</h3>
<p>La prima tiene dos partes. El <b>valor intrínseco</b> es lo que ganarías si ejercieras hoy: en un call, <code>máx(0, S − K)</code>; en un put, <code>máx(0, K − S)</code>, donde S es el precio de la acción. El <b>valor extrínseco</b> es el resto de la prima: lo que se paga por el tiempo que falta y por la posibilidad de que el precio se mueva.</p>
${en('Every option contract has an underlying stock, a type, a strike price, an expiration date and a premium. One contract covers one hundred shares, so the real cost is the premium times one hundred. The OCC symbol puts all this information in one code, and our project reads and builds these symbols to send orders.')}`);

  pag('2. ITM • ATM • OTM • tabla de primas • ¿cómo leer un diagrama de pago?', `
<p>Según la relación entre el precio S y el strike K, una opción está:</p>
${svg(640, 120, 'Calls con la acción a 100 USD', [
    linea(30, 60, 610, 60, '#888', 2), ...[90, 95, 100, 105, 110].map((k, i) => texto(90 + i * 115, 78, 'K ' + k, { fs: 10 })),
    `<rect x="40" y="25" width="215" height="25" fill="#d5e8d4" stroke="#82b366"/>`, texto(147, 37, 'ITM: dentro del dinero (S > K)', { fs: 10 }),
    `<rect x="265" y="25" width="110" height="25" fill="#fff2cc" stroke="#d6b656"/>`, texto(320, 37, 'ATM: S ≈ K', { fs: 10 }),
    `<rect x="385" y="25" width="225" height="25" fill="#f8cecc" stroke="#b85450"/>`, texto(497, 37, 'OTM: fuera del dinero (S < K)', { fs: 10 }),
    texto(320, 105, 'En los puts es al revés: un put con K 110 está dentro del dinero.', { fs: 10, color: '#555' }),
  ].join(''), 'ITM tiene valor intrínseco; OTM solo tiene valor de tiempo.')}
${tabla(['Strike K', 'Prima del call', 'Intrínseco', 'Extrínseco', 'Estado del call', 'Prima del put', 'Estado del put'], [
    ['90', '10.696', '10', '0.696', 'ITM', '0.401', 'OTM'], ['95', '6.645', '5', '1.645', 'ITM', '1.333', 'OTM'], ['100', '3.591', '0', '3.591', '<b>ATM</b>', '3.263', '<b>ATM</b>'],
    ['105', '1.662', '0', '1.662', 'OTM', '6.317', 'ITM'], ['110', '0.655', '0', '0.655', 'OTM', '10.294', 'ITM'],
  ], 'chica')}
<p class="cap">Primas calculadas con Black-Scholes: S = 100, 30 días, volatilidad 30 %, tasa 4 %. El valor extrínseco es máximo en ATM.</p>
<h3>2.4 ¿Cómo se lee un diagrama de pago (payoff)?</h3>
<p>Un <b>diagrama de pago</b> responde: «si al vencimiento la acción vale X, ¿cuánto gano o pierdo?». El eje horizontal es el precio de la acción al vencer; el vertical, la ganancia (zona verde) o pérdida (zona roja) en dólares. El punto donde la línea cruza el cero se llama <b>breakeven</b> (punto de equilibrio). Las fórmulas por acción son:</p>
${ul(['Long Call: <code>máx(0, S − K) − prima</code>', 'Long Put: <code>máx(0, K − S) − prima</code>', 'En dólares se multiplica por 100 y por el número de contratos (función <code>payoff</code> de <code>estrategias.core.js</code>).'])}
${en('An option is in the money when it already has intrinsic value, at the money when the stock price is close to the strike, and out of the money when it only has time value. A payoff diagram shows the profit or loss at expiration for every possible stock price, and the breakeven is where the line crosses zero.')}`);

  pag('2. Black-Scholes • intuición • fórmula • ejemplo paso a paso • paridad put-call', `
<h3>2.5 ¿Cuánto debe costar una opción? El modelo Black-Scholes</h3>
<p><b>Intuición.</b> El precio justo de una opción es lo que se espera que pague al vencimiento, traído a valor de hoy. Para estimarlo, el modelo supone que el precio de la acción se mueve al azar con cierta volatilidad σ. Entre más volatilidad y más tiempo, más probable es que la opción termine con valor, y por eso cuesta más.</p>
${svg(640, 115, 'Las cinco entradas del modelo', [
    caja(5, 10, 115, 30, 'S: precio acción', 'am', { fs: 10 }), caja(5, 45, 115, 30, 'K: strike', 'am', { fs: 10 }), caja(5, 80, 115, 30, 'T: tiempo (años)', 'am', { fs: 10 }),
    caja(135, 25, 120, 30, 'σ: volatilidad', 'am', { fs: 10 }), caja(135, 65, 120, 30, 'r: tasa sin riesgo', 'am', { fs: 10 }),
    caja(300, 35, 140, 46, 'Black-Scholes|blackscholes.js', 'os', { forma: 'hex', fs: 10 }),
    caja(485, 15, 150, 36, 'Precio teórico', 've', { fs: 10.5 }), caja(485, 62, 150, 36, 'Griegas (sensibilidades)', 'az', { fs: 10.5 }),
    flecha(120, 25, 298, 50), flecha(120, 60, 298, 56), flecha(120, 95, 298, 64), flecha(255, 40, 298, 52), flecha(255, 80, 298, 62), flecha(440, 52, 483, 33), flecha(440, 64, 483, 80),
  ].join(''), 'El modelo convierte cinco datos en un precio y en sus sensibilidades.')}
<p class="formula">d1 = [ln(S/K) + (r + σ²/2)·T] / (σ·√T) &nbsp;&nbsp;&nbsp; d2 = d1 − σ·√T<br>Call = S·N(d1) − K·e<sup>−rT</sup>·N(d2) &nbsp;&nbsp;&nbsp; Put = K·e<sup>−rT</sup>·N(−d2) − S·N(−d1)</p>
<p><code>N(x)</code> es la probabilidad de que una variable normal estándar sea menor que x (la «campana de Gauss»). <b>Ejemplo de libro, paso a paso:</b></p>
${pasos(['Datos: S = 100, K = 100, T = 1 año, r = 5 %, σ = 20 %.', 'd1 = (ln(1) + (0.05 + 0.02)·1) / 0.20 = <b>0.35</b>; d2 = 0.35 − 0.20 = <b>0.15</b>.', 'N(0.35) = 0.6368 y N(0.15) = 0.5596 (aproximación de Abramowitz y Stegun, error menor a 0.000000075).', 'Call = 100·0.6368 − 100·e<sup>−0.05</sup>·0.5596 = <b>10.4506</b>; Put = <b>5.5735</b>.', 'Comprobar con la <b>paridad put-call</b>: C − P = S − K·e<sup>−rT</sup> → 4.8771 = 4.8771 ✔. Si no se cumpliera, la fórmula tendría un error.'])}
<p>Estos mismos valores los verifica la prueba automática <code>tests/cores.test.cjs</code>. La tasa r se obtiene a diario de las letras del Tesoro de EE. UU. (<code>tesoro.client.js</code>).</p>
${en('The Black-Scholes model estimates the fair price of an option from five inputs: stock price, strike, time, volatility and the risk-free rate. Following the textbook example step by step, our code obtains a call price of 10.4506 and a put price of 5.5735, and it verifies the result with put-call parity.')}`);

  pag('2. Las griegas • delta • gamma • theta • vega • rho • ejemplo', `
<h3>2.6 Las griegas: cómo reacciona el precio de una opción</h3>
<p>Las <b>griegas</b> dicen cuánto cambia el precio de la opción cuando cambia una de sus entradas. Son las herramientas para medir el riesgo de una posición.</p>
${tabla(['Griega', 'Pregunta que responde', 'Ejemplo (call ATM, S = K = 100, 30 días, σ 30 %)', 'Lectura'], [
    ['<b>Delta Δ</b>', 'Si la acción sube 1 USD, ¿cuánto sube la opción?', 'Δ = 0.53', 'El contrato se comporta como 53 acciones'],
    ['<b>Gamma Γ</b>', '¿Cuánto cambia la delta si la acción sube 1 USD?', 'Γ = 0.046', 'La delta pasa de 0.53 a ≈ 0.58'],
    ['<b>Theta Θ</b>', '¿Cuánto valor pierde la opción cada día que pasa?', 'Θ = −0.062 por día', 'Pierde 6.2 USD diarios por contrato'],
    ['<b>Vega ν</b>', 'Si la volatilidad sube 1 punto, ¿cuánto sube la opción?', 'ν = 0.114', 'Gana 11.4 USD por contrato'],
    ['<b>Rho ρ</b>', 'Si la tasa sube 1 punto, ¿cuánto cambia?', 'ρ = 0.041', 'Poco relevante en plazos cortos'],
  ], 'chica')}
<p><b>Comprobación.</b> Si la acción pasa de 100 a 101, el precio del call sube de 3.5911 a 4.1464, es decir <b>+0.5553</b>, casi igual a la delta (0.53) más la mitad de la gamma (0.023). Así se confirma que las griegas describen bien al modelo.</p>
${svg(640, 175, 'Theta: el tiempo «derrite» el valor de una opción', [
    linea(60, 145, 600, 145) + linea(60, 25, 60, 145),
    `<path d="M70,40 C250,48 400,70 480,100 S570,140 590,143" fill="none" stroke="#c00000" stroke-width="2.6"/>`,
    texto(330, 162, 'días al vencimiento: 60 → 0', { fs: 10, color: '#555' }), texto(30, 85, 'valor|de|tiempo', { fs: 10, color: '#555' }),
    texto(470, 60, 'la caída se acelera|en los últimos 30 días', { fs: 10, color: '#c00000' }),
  ].join(''), 'Theta negativa perjudica a quien compra opciones (Long Call y Long Put) y beneficia a quien las vende (Iron Condor).')}
${en('The Greeks measure how the option price reacts to each input. Delta shows the change for a one dollar move in the stock, gamma shows how delta changes, theta shows the value lost every day, and vega shows the effect of volatility. Theta hurts option buyers and helps option sellers.')}`);

  pag('2. Volatilidad implícita vs histórica • IV • HV • débito y crédito', `
<h3>2.7 Volatilidad implícita (IV) y volatilidad histórica (HV)</h3>
<p>La <b>volatilidad histórica (HV)</b> mira hacia atrás: cuánto se movió realmente la acción (sección 1.8). La <b>volatilidad implícita (IV)</b> mira hacia adelante: es la volatilidad que hay que poner en Black-Scholes para obtener el precio que el mercado está cobrando hoy. Se calcula «al revés», probando valores de σ hasta que el modelo da la prima del mercado (el proyecto usa el método de bisección entre 0.0001 y 5).</p>
${svg(640, 125, '', [
    caja(10, 40, 150, 46, 'Prima de mercado|10.4506', 'am'), caja(215, 30, 190, 66, 'Probar σ = 10 %, 30 %, 20 %…|hasta que Black-Scholes|dé 10.4506', 'os', { forma: 'hex', fs: 10 }),
    caja(460, 40, 170, 46, 'IV = 20 %', 've', { bold: true }), flecha(160, 63, 213, 63), flecha(405, 63, 458, 63),
  ].join(''), 'La volatilidad implícita se obtiene invirtiendo el modelo.')}
${tabla(['Si…', 'Significa', 'Conviene'], [['IV > HV', 'El mercado cobra más movimiento del que se ha visto: opciones «caras»', '<b>Vender</b> opciones (Iron Condor)'], ['IV < HV', 'Opciones «baratas»', '<b>Comprar</b> opciones (Long Call, Long Put)']], 'chica')}
<h3>2.8 Débito y crédito</h3>
<p>Una estrategia es de <b>débito</b> si al abrirla <i>pagas</i> (compras más de lo que vendes), y de <b>crédito</b> si al abrirla <i>cobras</i> (vendes más de lo que compras). Long Call y Long Put son débitos; el Iron Condor es un crédito. En el código, <code>prima_neta &gt; 0</code> significa crédito; en Alpaca, en cambio, un crédito se envía como <b>precio negativo</b>.</p>
${svg(640, 100, '', [
    caja(20, 25, 260, 50, 'DÉBITO: pagas al abrir|Long Call: −360 USD', 'ro', { fs: 11 }), caja(360, 25, 260, 50, 'CRÉDITO: cobras al abrir|Iron Condor: +180 USD', 've', { fs: 11 }),
  ].join(''), 'El signo de la prima neta indica si la estrategia es de débito o de crédito.')}
${en('Historical volatility looks back at how much the stock moved, while implied volatility looks forward and is obtained by inverting the Black-Scholes model. When implied volatility is higher than historical volatility, options are expensive and selling them is attractive. Strategies that pay at the start are debits, and those that collect money are credits.')}`);

  pag('2. Estrategias asignadas • Long Call • vista alcista • paso a paso', `
<h3>2.9 Estrategia asignada 1: Long Call (vista alcista)</h3>
<p><b>Idea.</b> Comprar un call. Se usa cuando se espera que la acción <b>suba bastante</b> antes del vencimiento. Se paga la prima (débito) y eso es lo máximo que se puede perder.</p>
${tabla(['Elemento', 'Valor', 'Ejemplo (K = 100, prima 3.60)'], [['Patas', '1: comprar un call (<code>buy_to_open</code>)', '1 call con strike 100'], ['Costo', 'prima × 100', '360 USD'], ['Pérdida máxima', 'la prima pagada', '360 USD si la acción termina en 100 o menos'], ['Ganancia máxima', 'ilimitada', 'Con la acción en 120 gana 1 640 USD'], ['Breakeven', 'K + prima', '103.60'], ['Griegas', 'Δ positiva, Θ negativa, vega positiva', 'El tiempo juega en contra']], 'chica')}
<div class="dos"><div>${payoff('Long Call K = 100, prima 3.60', s => (Math.max(0, s - 100) - 3.6) * 100, 80, 120, -400, 1700, [{ x: 100, t: 'K 100' }, { x: 103.6, t: '103.6' }], '#2e75b6')}</div>
<div>${tabla(['Acción al vencer', 'Resultado'], [['80', '−360'], ['100', '−360'], ['103.60', '0'], ['110', '+640'], ['120', '+1 640']], 'chica')}</div></div>
${figura('Pérdida limitada a la prima; ganancia que crece mientras más suba la acción.')}
<p><b>Paso a paso:</b></p>
${pasos(['Confirmar la dirección con los cores: el sesgo combinado debe ser <b>alcista</b>.', 'Elegir el vencimiento: la app propone el más cercano dentro del rango configurado (7 a 60 días por defecto).', 'Elegir el strike más cercano al precio actual (ATM), como hace la función <code>construirPatas</code>.', 'Revisar prima, spread y breakeven; aceptar que la pérdida máxima es lo que se paga.', 'Enviar una orden <b>límite</b> al precio medio (mid).', 'Salir antes del vencimiento (<code>sell_to_close</code>) si se alcanza la meta o el límite de pérdida.'])}
${en('A Long Call buys one call option when we expect the stock to rise strongly. The premium is the maximum loss, while the potential profit has no limit. The breakeven is the strike plus the premium, so the stock must rise above that level before expiration for the trade to make money.')}`);

  pag('2. Estrategias asignadas • Long Put • vista bajista • paso a paso', `
<h3>2.10 Estrategia asignada 2: Long Put (vista bajista)</h3>
<p><b>Idea.</b> Comprar un put. Se usa cuando se espera que la acción <b>baje bastante</b>. También sirve como seguro de una acción que ya se tiene. Es un débito.</p>
${tabla(['Elemento', 'Valor', 'Ejemplo (K = 100, prima 3.00)'], [['Patas', '1: comprar un put (<code>buy_to_open</code>)', '1 put con strike 100'], ['Costo', 'prima × 100', '300 USD'], ['Pérdida máxima', 'la prima pagada', '300 USD si la acción termina en 100 o más'], ['Ganancia máxima', '(K − prima) × 100, si la acción llega a 0', '9 700 USD'], ['Breakeven', 'K − prima', '97'], ['Griegas', 'Δ negativa, Θ negativa, vega positiva', '—']], 'chica')}
<div class="dos"><div>${payoff('Long Put K = 100, prima 3.00', s => (Math.max(0, 100 - s) - 3) * 100, 80, 120, -400, 1700, [{ x: 97, t: '97' }, { x: 100, t: 'K 100' }], '#c00000')}</div>
<div>${tabla(['Acción al vencer', 'Resultado'], [['80', '+1 700'], ['90', '+700'], ['97', '0'], ['100', '−300'], ['120', '−300']], 'chica')}</div></div>
${figura('El Long Put es el espejo del Long Call: gana cuando la acción cae por debajo de 97.')}
<p><b>Paso a paso:</b> es igual al del Long Call, con dos cambios: (1) el sesgo combinado de los cores debe ser <b>bajista</b>, y (2) se compra el <b>put</b> con strike más cercano al precio. La salida es <code>sell_to_close</code>.</p>
${svg(640, 125, 'Flujo para abrir y cerrar un Long Call o un Long Put', [
    caja(5, 40, 120, 50, 'Cores: sesgo|alcista o bajista', 'am', { fs: 10.5 }), caja(150, 40, 105, 50, 'Vencimiento|7–60 días', 'az', { fs: 10.5 }),
    caja(280, 40, 110, 50, 'Strike ATM|call o put', 've', { fs: 10.5 }), caja(415, 40, 100, 50, 'Orden límite|al mid', 'na', { fs: 10.5 }), caja(540, 40, 95, 50, 'Salida|sell_to_close', 'ro', { fs: 10 }),
    flecha(125, 65, 148, 65), flecha(255, 65, 278, 65), flecha(390, 65, 413, 65), flecha(515, 65, 538, 65),
  ].join(''), 'Las dos estrategias direccionales siguen el mismo flujo.')}
${en('A Long Put buys one put option when we expect the stock to fall. Like the Long Call, the maximum loss is the premium, and the breakeven is the strike minus the premium. It is the mirror image of the Long Call, and it can also protect a stock position as insurance.')}`);

  pag('2. Estrategias asignadas • Iron Condor • cuatro patas • crédito • alas', `
<h3>2.11 Estrategia asignada 3: Iron Condor (vista neutral)</h3>
<p><b>Idea.</b> Apostar a que la acción se queda <b>quieta dentro de un rango</b>. Se <b>venden</b> un put y un call fuera del dinero (se cobra prima) y se <b>compran</b> un put y un call todavía más lejanos, llamados <b>alas</b>, que limitan la pérdida si el precio se escapa del rango. Es un crédito.</p>
${svg(640, 150, 'Las cuatro patas sobre la línea de precios (mismo vencimiento)', [
    linea(30, 75, 610, 75, '#888', 2),
    caja(45, 25, 105, 36, 'COMPRA put|K1 = 90 (ala)', 've', { fs: 10 }), caja(175, 25, 105, 36, 'VENDE put|K2 = 95', 'ro', { fs: 10 }),
    caja(355, 25, 105, 36, 'VENDE call|K3 = 105', 'ro', { fs: 10 }), caja(485, 25, 105, 36, 'COMPRA call|K4 = 110 (ala)', 've', { fs: 10 }),
    `<rect x="228" y="85" width="180" height="26" fill="#d5e8d4" stroke="#82b366"/>`, texto(318, 98, 'zona de ganancia máxima', { fs: 10 }),
    texto(318, 70, 'precio hoy ≈ 100', { fs: 10, color: '#555' }), texto(318, 130, 'K1 < K2 < K3 < K4', { fs: 11, bold: true, color: '#1f3864' }),
  ].join(''), 'Las patas vendidas cobran el crédito; las alas compradas ponen un tope a la pérdida.')}
${tabla(['Elemento', 'Fórmula', 'Ejemplo 90/95/105/110 (primas 0.60/1.50/1.40/0.50)'], [
    ['Crédito c', 'prima(K2) + prima(K3) − prima(K1) − prima(K4)', '1.50 + 1.40 − 0.60 − 0.50 = 1.80'],
    ['Ganancia máxima', 'c × 100, si K2 ≤ S ≤ K3 al vencer', '180 USD'],
    ['Ancho de alas', 'máx(K2 − K1, K4 − K3)', '5'],
    ['Pérdida máxima', '(ancho − c) × 100', '(5 − 1.80) × 100 = 320 USD'],
    ['Breakevens', 'K2 − c y K3 + c', '93.20 y 106.80'],
    ['Griegas', 'Δ ≈ 0, Θ positiva, vega negativa', 'El tiempo ayuda; la volatilidad estorba'],
  ], 'chica')}
${en('An Iron Condor sells an out-of-the-money put and an out-of-the-money call, and buys two cheaper options further away as wings. It collects a credit and keeps all of it if the stock stays between the short strikes at expiration, while the wings limit the maximum loss.')}`);

  pag('2. Iron Condor • diagrama de pago • paso a paso en la app • caso real TSLA', `
${payoff('Iron Condor 90/95/105/110 con crédito 1.80', s => (Math.max(0, 90 - s) - Math.max(0, 95 - s) - Math.max(0, s - 105) + Math.max(0, s - 110) + 1.8) * 100, 80, 120, -400, 300, [{ x: 90, t: 'K1' }, { x: 93.2, t: '93.2' }, { x: 95, t: 'K2' }, { x: 105, t: 'K3' }, { x: 106.8, t: '106.8' }, { x: 110, t: 'K4' }], '#7030a0', 640, 200)}
${figura('Ganancia plana de 180 USD entre 95 y 105; pérdida acotada a 320 USD fuera de las alas.')}
<p><b>Paso a paso (así lo arma la app en <code>web/src/utils/estrategiasOrden.js</code>):</b></p>
${pasos(['Elegir un vencimiento de 30 a 45 días: el desgaste por tiempo (theta) ya es apreciable y el riesgo por saltos bruscos (gamma) todavía es moderado.', 'Elegir las patas vendidas: el put y el call con <b>delta más cercana a 0.20</b>. Una delta de 0.20 equivale aproximadamente a 20 % de probabilidad de terminar dentro del dinero.', 'Elegir las alas: del lado exterior, el strike que esté a ≈ <b>2.5 % del precio</b> de la pata vendida.', 'Calcular el crédito neto al precio medio y redondearlo (a 0.01 si es menor que 3; a 0.05 si es mayor).', 'Enviar una orden <b>multi-pata límite a crédito</b> y vigilarla hasta que se ejecute.'])}
${nota('Caso real (TSLA, precio 380.15).', 'Vender put 352.50 (3.97), comprar put 342.50 (2.39), vender call 407.50 (2.90), comprar call 417.50 (1.51). Crédito = 3.97 + 2.90 − 2.39 − 1.51 = <b>2.97</b>. Ganancia máxima 297 USD, pérdida máxima (10 − 2.97) × 100 = <b>703 USD</b>, breakevens 349.53 y 410.47.')}
<p><b>Probabilidad de ganancia</b> (calculada con Black-Scholes): Long Call 34 %, Long Put 37 %, Iron Condor 58 % en el ejemplo de la guía. El Iron Condor gana más seguido pero poco; los Long ganan menos seguido pero mucho.</p>
${en('Our application builds the Iron Condor automatically: it chooses an expiration about one month away, sells the put and call with a delta near 0.20, places the wings about 2.5 percent further out and sends one multi-leg limit order for the net credit. The real Tesla example shows the full calculation.')}`);

  pag('2. Catálogo completo de estrategias • spreads • butterfly • straddle • collar • wheel', `
<h3>2.12 Catálogo completo de estrategias</h3>
<p>Además de las tres asignadas, existen muchas combinaciones. Todas se arman con calls y puts comprados (+) o vendidos (−). Se resumen para saber cuándo conviene cada una:</p>
${tabla(['Estrategia', 'Patas', 'Expectativa', 'D/C', 'Pérdida máxima'], [
    ['<b>Long Call</b> ★', '+C', 'Subida fuerte', 'Débito', 'Prima'],
    ['<b>Long Put</b> ★', '+P', 'Bajada fuerte', 'Débito', 'Prima'],
    ['<b>Iron Condor</b> ★', '+P −P −C +C', 'Rango lateral', 'Crédito', 'Ancho − crédito'],
    ['Bull Call / Bear Put Spread', '+C −C / +P −P', 'Subida / bajada moderada', 'Débito', 'Débito pagado'],
    ['Bull Put / Bear Call Spread', '−P +P / −C +C', 'Subida / bajada moderada', 'Crédito', 'Ancho − crédito'],
    ['Iron Butterfly', 'Como Iron Condor, con las cortas en el mismo strike', 'Precio casi fijo', 'Crédito', 'Ancho − crédito'],
    ['Butterfly', '+1 −2 +1 del mismo tipo', 'Precio en un punto', 'Débito', 'Débito'],
    ['Condor', '+1 −1 −1 +1 del mismo tipo', 'Rango', 'Débito', 'Débito'],
    ['Long Straddle / Strangle', '+C +P', 'Movimiento grande sin dirección', 'Débito', 'Primas'],
    ['Short Straddle / Strangle', '−C −P', 'Calma total', 'Crédito', '<b>Ilimitada</b>'],
    ['Calendar / Diagonal', 'Vender plazo corto, comprar plazo largo', 'Neutral o suave', 'Débito', 'Débito'],
    ['Protective Put', '+100 acciones +P', 'Proteger acciones', 'Débito', 'Acotada'],
    ['Collar', '+acciones +P −C', 'Proteger con costo ≈ 0', '≈ 0', 'Acotada'],
    ['Covered Straddle / Strangle', '+acciones −C −P', 'Ingreso extra', 'Crédito', 'Alta'],
    ['Wheel', 'Vender put; si te asignan, vender calls cubiertos', 'Ingreso repetido', 'Crédito', 'Alta'],
  ], 'mini')}
<p>★ Estrategias asignadas al equipo e implementadas en el código: <code>ESTRATEGIAS = ['LONG_CALL', 'LONG_PUT', 'IRON_CONDOR']</code>. El adaptador de Webull ya reconoce otras estructuras (verticales, straddles, butterflies, condors), lo que facilitaría agregarlas después.</p>
${en('The complete catalog combines bought and sold calls and puts in many ways. Strategies are grouped by market view: bullish, bearish, neutral and volatile, plus hedging and income strategies such as the collar and the wheel. Our team implemented the three assigned strategies, marked with a star.')}`);

  pag('2. Selección por régimen de volatilidad • IV/HV • árbol de decisión • ajuste ±15', `
<h3>2.13 Selección de estrategia por régimen de volatilidad</h3>
<p>Para elegir una estrategia se combinan dos preguntas: <b>¿hacia dónde se moverá el precio?</b> (la responden los cores, sección 4) y <b>¿las opciones están caras o baratas?</b> (la responde la relación IV/HV).</p>
${pasos(['Medir la volatilidad histórica de 20 días, <b>HV20</b> (core de indicadores).', 'Medir la volatilidad implícita <b>IV</b>: promedio de los contratos con strike a ±5 % del precio, no vencidos y con IV entre 0 y 500 %.', 'Calcular <b>IV/HV20</b> y ubicar el régimen en la tabla.', 'Combinar con la dirección: alcista → Long Call; bajista → Long Put; neutral con IV alta → Iron Condor.'])}
${tabla(['IV / HV20', 'Lectura', 'Estrategias favorecidas', 'Ajuste que el proyecto suma al Iron Condor'], [['menor a 0.9', 'Opciones baratas', 'Comprar: Long Call, Long Put', '−7.5 a −15 puntos'], ['0.9 a 1.1', 'Normal', 'Cualquiera según la dirección', '≈ 0'], ['mayor a 1.1', 'Opciones caras', 'Vender prima: Iron Condor', '+7.5 a +15 puntos']], 'chica')}
<p class="formula">ajuste = limitar((IV/HV20 − 1) / 0.2, entre −1 y 1) × 15 &nbsp;&nbsp;(<code>confluencia.core.js</code>)</p>
<p>Ejemplo: IV = 0.25 y HV20 = 0.2267 → IV/HV = 1.10 → ajuste de <b>+7.7</b> puntos al Iron Condor. El tope de ±15 sirve para desempatar sin superar a la dirección.</p>
${svg(640, 185, 'Árbol de decisión', [
    caja(245, 22, 150, 36, 'Sesgo de los cores', 'os', { forma: 'hex' }),
    caja(15, 95, 160, 36, 'Alcista (sesgo > 0.1)', 've', { fs: 10.5 }), caja(240, 95, 160, 36, 'Neutral', 'mo'), caja(465, 95, 160, 36, 'Bajista (sesgo < −0.1)', 'ro', { fs: 10.5 }),
    caja(15, 145, 160, 32, 'Long Call', 'am', { bold: true }), caja(465, 145, 160, 32, 'Long Put', 'am', { bold: true }),
    caja(205, 145, 110, 32, 'IV/HV alta:|Iron Condor', 'am', { fs: 9.5 }), caja(325, 145, 110, 32, 'IV/HV baja:|mejor esperar', 'gr', { fs: 9.5 }),
    flecha(270, 58, 95, 93), flecha(320, 58, 320, 93), flecha(370, 58, 545, 93), flecha(95, 131, 95, 143), flecha(545, 131, 545, 143), flecha(290, 131, 260, 143), flecha(350, 131, 380, 143),
  ].join(''), 'La dirección elige entre Long Call y Long Put; la volatilidad decide si conviene vender prima.')}
${en('To choose a strategy we combine two questions: where the price will move and whether options are expensive. The ratio between implied and historical volatility answers the second question. When it is high, our confluence engine adds up to fifteen points to the Iron Condor, because selling premium becomes more attractive.')}`);
};
