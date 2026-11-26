# estrategias-seleccion

## Purpose
Convertir las opiniones de los cores en una recomendación por estrategia (confluencia), ordenar estrategias o empresas
por compatibilidad (selección) y validar y medir una estructura concreta de opciones (configuración): pérdida y ganancia
máximas, breakevens y probabilidad con Black-Scholes. Estrategias asignadas: LONG_CALL, LONG_PUT e IRON_CONDOR.
Implementación: `src/cores/{confluencia.core,estrategias.core,blackscholes}.js`, `services/confluencias.service.js`,
`services/selecciones.service.js`, `services/analisis.service.js`, `services/estrategias.service.js`.

## Requirements

### Requirement: Catálogo base de estrategias
`POST /estrategias/catalogo-base` SHALL crear LONG_CALL, LONG_PUT e IRON_CONDOR si faltan. Las llamadas simultáneas MUST
NOT duplicarlas ni fallar, y los ids existentes se respetan.

#### Scenario: Llamada repetida
- **WHEN** se llama dos veces al mismo tiempo
- **THEN** existen exactamente tres estrategias

### Requirement: Confluencia por estrategia
`POST /confluencias/ejecuciones` SHALL combinar evaluaciones ya completadas para una estrategia (trabajo asíncrono). Para
LONG_CALL y LONG_PUT MUST usar el promedio ponderado por peso × confianza. Para IRON_CONDOR MUST favorecer la neutralidad
media y la ausencia de dispersión, con ajuste por IV/HV (ADR-012). Sin resultados, el puntaje es 50 con cobertura 0; una
estrategia inválida es un error.

#### Scenario: Cores contradictorios no favorecen al Iron Condor
- **WHEN** unos cores son muy alcistas y otros muy bajistas (dispersión alta)
- **THEN** el Iron Condor no obtiene un puntaje alto

#### Scenario: Cores neutrales unánimes
- **WHEN** todos los cores dan sesgo cercano a 0
- **THEN** el Iron Condor obtiene el mejor puntaje

### Requirement: Selección por compatibilidad
`POST /selecciones/ejecuciones` SHALL combinar los cores elegidos (al menos uno) en modo `empresa`, `estrategia` o
`empresa_estrategia` y ordenar los candidatos por compatibilidad, aplicando los pesos del perfil de análisis. Un core
sin datos MUST NOT contar como voto.

#### Scenario: Un core sin datos
- **WHEN** el core institucional no tiene datos
- **THEN** la selección se calcula con los cuatro restantes y lo indica

### Requirement: Validación de la estructura
El sistema SHALL validar las patas de cada estrategia: el tipo (call/put), la acción (compra/venta), el número de patas
y el orden de strikes `K1 < K2 < K3 < K4` del Iron Condor. Una configuración inválida o vencida MUST quedar con
`configuracion_valida = 0` y sin montos.

#### Scenario: Strikes cruzados
- **WHEN** un Iron Condor tiene el put vendido por encima del call vendido
- **THEN** la validación falla con un mensaje que lo explica

### Requirement: Riesgo y probabilidad de la configuración
`POST /configuraciones/:id/evaluaciones` SHALL calcular la pérdida y la ganancia máximas (ganancia ilimitada en
LONG_CALL), los breakevens, la delta neta si hay griegas y la probabilidad de ganancia con Black-Scholes, usando la tasa
del Tesoro y el dividendo. El cálculo MUST dar lo mismo en el servidor y en el ticket web. Sin precios MUST NOT calcular
montos, y un dato faltante se usa como 0 avisándolo.

#### Scenario: Iron Condor de crédito
- **WHEN** se evalúa un Iron Condor con alas de 10 y crédito de 2.97
- **THEN** la pérdida máxima es (10 − 2.97) × 100 = 703 USD y la ganancia máxima es 297 USD

#### Scenario: Valores de libro de Black-Scholes
- **WHEN** S = K = 100, T = 1, r = 5 % y σ = 20 %
- **THEN** el precio del call coincide con el valor de referencia del libro

### Requirement: No es asesoría financiera
Ningún puntaje, ranking ni selección SHALL presentarse como probabilidad de ganar ni como recomendación de inversión. La
única probabilidad que se muestra es la teórica de Black-Scholes de una configuración concreta.

#### Scenario: Puntaje en la interfaz
- **WHEN** la web muestra el puntaje 0–100 de una estrategia
- **THEN** lo acompaña con la nota «Mide qué tan alineados están hoy los cores; no es la probabilidad de ganar.»
- **AND** el pie de la app indica «Herramienta educativa. No es asesoría financiera.»
