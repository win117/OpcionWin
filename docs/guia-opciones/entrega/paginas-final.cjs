// Conclusión, glosario y referencias del documento completo (incisos A, B y C).
module.exports = (pag, h) => {
  const { texto, caja, flecha, svg, en } = h;

  pag('Conclusión • Resumen de los incisos A, B y C • Respuesta al problema planteado', `
<h2 class="centro">Conclusión</h2>
<p>El proyecto responde una pregunta concreta: <i>con los datos de hoy, ¿qué estrategia de opciones es más coherente con lo que dicen el precio, los estados financieros, los grandes inversionistas y las noticias?</i> Esta actividad mostró cómo se construye, se optimiza y se vigila un sistema de microservicios que la responde.</p>
<p><b>Inciso A.</b> La guía explicó desde cero qué es invertir, qué es una opción y cómo se valúa con Black-Scholes, y detalló las tres estrategias asignadas: <b>Long Call</b> y <b>Long Put</b> para movimientos claros, e <b>Iron Condor</b> para un precio en rango. También mostró cómo cada broker recibe la misma orden, cómo recorre el código cada petición, cómo opinan los cinco cores y cómo la interfaz se volvió una PWA instalable. Quedó además un límite honesto: el puntaje mide coherencia, no la probabilidad de ganar.</p>
<p><b>Inciso B.</b> Con el framework SDD OpenSpec, primero se documentaron 11 capacidades de la app y después cada cambio se acordó en una propuesta revisable antes de escribir código. La IA aplicó a todas las APIs técnicas que faltaban: circuit breaker por proveedor, readiness y drenado al apagar. Siguiendo la regla de la constitución, evaluó la estructura manual y propuso una estructura por dominio, más fácil de separar en microservicios. La evidencia distingue con claridad 68 grupos de rutas manuales de 4 APIs hechas con IA.</p>
<p><b>Inciso C.</b> Las APIs se comprobaron con 337 pruebas automáticas, una colección E2E de 49 aserciones, un contrato con la web, k6 (50 usuarios con p95 de 14 ms y un punto de quiebre identificado a 300) y OWASP ZAP (94 747 ataques autenticados sin un solo error 500). El monitoreo quedó listo para producción: métricas Prometheus, logs JSON, errores agrupados, analítica de uso y un monitor sintético cada 15 minutos.</p>
${svg(640, 100, '', [caja(5, 25, 175, 50, 'A) Contexto real|(guía de estrategias)', 'am', { fs: 10.5 }), caja(232, 25, 175, 50, 'B) Microservicios|optimizados con SDD', 'az', { fs: 10.5 }), caja(460, 25, 175, 50, 'C) Pruebas y|monitoreo', 've', { fs: 10.5 }),
    flecha(180, 50, 230, 50), flecha(407, 50, 458, 50)].join(''), 'Entender el negocio, construir y optimizar con especificaciones, y comprobar y vigilar.')}
${en('In conclusion, part A explained the business and the assigned strategies, part B used OpenSpec to specify and apply resilience techniques and a domain structure to every API, and part C proved with tests and monitoring that the microservices work and will warn us when they stop working.')}`);

  pag('Glosario • Términos clave en orden alfabético', `
<h2 class="centro">Glosario</h2>
<dl>
<dt>Circuit breaker (interruptor de circuito):</dt><dd>Mecanismo que deja de llamar a un servicio externo cuando falla varias veces seguidas y responde al instante con un error claro; tras una espera prueba con una sola solicitud si el servicio volvió.</dd>
<dt>Confluencia:</dt><dd>Combinación de los resultados de los cores en un solo puntaje por estrategia, que da más peso a los cores seguros y castiga el desacuerdo entre ellos.</dd>
<dt>Core:</dt><dd>Algoritmo del proyecto que analiza una clase de evidencia (tendencia, impulso, finanzas, fondos o noticias) y devuelve un sesgo de −1 a 1 con su confianza; es una función pura.</dd>
<dt>Delta (Δ):</dt><dd>Griega que indica cuánto cambia el precio de la opción cuando la acción sube un dólar; también expresa a cuántas acciones equivale un contrato.</dd>
<dt>Desarrollo guiado por especificaciones (SDD):</dt><dd>Forma de trabajo en la que primero se escriben y revisan los requisitos con escenarios verificables y después se programa contra ellos; OpenSpec es el framework usado.</dd>
<dt>Idempotencia:</dt><dd>Propiedad de una operación que produce el mismo efecto aunque se repita; en las órdenes se logra con una clave única que evita duplicados.</dd>
<dt>Iron Condor:</dt><dd>Estrategia neutral de cuatro patas que vende un put y un call fuera del dinero y compra alas más lejanas; cobra un crédito si el precio se queda dentro del rango.</dd>
<dt>Paper trading:</dt><dd>Operación en una cuenta simulada con precios reales y dinero ficticio; es el único modo permitido en el proyecto.</dd>
<dt>Percentil 95 (p95):</dt><dd>Tiempo de respuesta por debajo del cual queda el 95 % de las solicitudes; describe mejor que el promedio la experiencia de los usuarios más lentos.</dd>
<dt>Readiness:</dt><dd>Comprobación de que un servicio puede atender solicitudes (sus bases de datos responden y no se está apagando); se distingue de la liveness, que solo indica que el proceso está vivo.</dd>
</dl>
${en('This glossary defines the key terms of the three parts, from options concepts such as delta, Iron Condor and paper trading to engineering concepts such as circuit breaker, spec-driven development, readiness and the ninety-fifth percentile used to judge performance.')}`);

  pag('Referencias • Fuentes consultadas (formato APA 7.ª edición)', `
<h2 class="centro">Referencias</h2>
<div class="refs">
<p>Abramowitz, M., y Stegun, I. A. (1964). <i>Handbook of mathematical functions with formulas, graphs, and mathematical tables</i>. National Bureau of Standards.</p>
<p>Alpaca Markets. (s.f.). <i>Options trading and market data API reference</i>. https://docs.alpaca.markets/reference</p>
<p>Black, F., y Scholes, M. (1973). The pricing of options and corporate liabilities. <i>Journal of Political Economy, 81</i>(3), 637–654. https://doi.org/10.1086/260062</p>
<p>FINRA. (s.f.). <i>Rule 4210. Margin requirements</i>. https://www.finra.org/rules-guidance/rulebooks/finra-rules/4210</p>
<p>Fission AI. (2026). <i>OpenSpec: Spec-driven development for AI coding assistants</i> (Versión 2.2.0) [Software]. GitHub. https://github.com/Fission-AI/OpenSpec</p>
<p>Fowler, M. (2014, 6 de marzo). <i>CircuitBreaker</i>. martinfowler.com. https://martinfowler.com/bliki/CircuitBreaker.html</p>
<p>Grafana Labs. (s.f.). <i>Grafana k6 documentation</i>. https://grafana.com/docs/k6/latest/</p>
<p>Hull, J. C. (2022). <i>Options, futures, and other derivatives</i> (11.ª ed.). Pearson.</p>
<p>McMillan, L. G. (2012). <i>Options as a strategic investment</i> (5.ª ed.). Prentice Hall Press.</p>
<p>MDN Web Docs. (s.f.). <i>Progressive web apps</i>. Mozilla. https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps</p>
<p>Natenberg, S. (2015). <i>Option volatility and pricing</i> (2.ª ed.). McGraw-Hill Education.</p>
<p>Newman, S. (2021). <i>Building microservices: Designing fine-grained systems</i> (2.ª ed.). O’Reilly Media.</p>
</div>
${en('The first group of references supports the financial content and the web standards, and adds the sources of parts B and C: the OpenSpec framework, the circuit breaker pattern, the k6 load testing tool and a reference book on building microservices.')}`);

  pag('Referencias (continuación) • Fuentes de pruebas, seguridad y monitoreo', `
<h2 class="centro">Referencias (continuación)</h2>
<div class="refs">
<p>Options Clearing Corporation. (2022). <i>Characteristics and risks of standardized options</i>. https://www.theocc.com/company-information/documents-and-archives/options-disclosure-document</p>
<p>OWASP Foundation. (2023). <i>OWASP API security top 10: 2023</i>. https://owasp.org/API-Security/editions/2023/en/0x11-t10/</p>
<p>Pact Foundation. (s.f.). <i>Pact documentation: Consumer-driven contract testing</i>. https://docs.pact.io/</p>
<p>Postman. (s.f.). <i>Run collections from the command line with Newman</i>. https://learning.postman.com/docs/collections/using-newman-cli/command-line-integration-with-newman/</p>
<p>Prometheus Authors. (s.f.). <i>Exposition formats</i>. The Linux Foundation. https://prometheus.io/docs/instrumenting/exposition_formats/</p>
<p>Sentry. (s.f.). <i>Envelopes</i>. Sentry developer documentation. https://develop.sentry.dev/sdk/data-model/envelopes/</p>
<p>Tecnológico Nacional de México. (2025). <i>Programa de la asignatura Laboratorio de Servicios Web (DFD-2603)</i>. Instituto Tecnológico de Tepic.</p>
<p>U.S. Securities and Exchange Commission. (s.f.). <i>EDGAR application programming interfaces</i>. https://www.sec.gov/search-filings/edgar-application-programming-interfaces</p>
<p>Webull. (s.f.). <i>Webull OpenAPI documentation</i>. https://developer.webull.com/</p>
<p>Wilder, J. W. (1978). <i>New concepts in technical trading systems</i>. Trend Research.</p>
<p>ZAP Dev Team. (s.f.). <i>ZAP automation framework</i>. https://www.zaproxy.org/docs/automate/automation-framework/</p>
<p>Zod. (s.f.). <i>Zod documentation</i>. https://zod.dev/</p>
</div>
${en('The second group of references covers contract testing with Pact, end-to-end testing with Newman, the OWASP API security risks, the ZAP automation framework, the Prometheus metrics format and the Sentry event format, together with the official sources for options, markets and the course program.')}`);
};
