# Spec Delta

## Purpose

Permitir instalar la web de AppRESTOpciones como aplicación (PWA) en teléfono y escritorio, con un service worker que
acelera la carga y muestra la app sin conexión sin guardar nunca datos de la API autenticada.

## ADDED Requirements

### Requirement: Manifest de la aplicación
La web SHALL publicar `/manifest.webmanifest`, enlazado desde `index.html`, con `name` «WinOpciones», `short_name`,
`start_url` y `scope` en `/`, `display: standalone`, `lang: es`, `theme_color` y `background_color`, e iconos PNG de
192×192 y 512×512 (al menos uno con `purpose: maskable`).

#### Scenario: Navegador evalúa la instalación
- **WHEN** un navegador compatible abre la app desplegada por https
- **THEN** detecta el manifest con nombre, iconos de 192 y 512 px y `display: standalone`
- **AND** ofrece instalar la app

#### Scenario: Iconos disponibles
- **WHEN** se piden las rutas de los iconos declaradas en el manifest
- **THEN** cada una responde 200 con una imagen PNG del tamaño declarado

### Requirement: Icono para iOS y color del tema
`index.html` SHALL declarar un `apple-touch-icon` de 180×180 y la meta `theme-color` con el mismo color que el manifest.

#### Scenario: Agregar a inicio en iPhone
- **WHEN** un usuario de Safari en iOS agrega la app a la pantalla de inicio
- **THEN** se usa el icono de 180×180 de la app y no una captura de la página

### Requirement: Registro solo en producción y contexto seguro
La web SHALL registrar el service worker con alcance `/` solo en la compilación de producción y solo si el navegador
lo soporta en un contexto seguro (https o localhost). En desarrollo MUST NOT registrarse.

#### Scenario: Servidor de desarrollo
- **WHEN** se ejecuta la web con `npm run dev:web`
- **THEN** no se registra ningún service worker

#### Scenario: Navegador sin soporte
- **WHEN** el navegador no tiene `serviceWorker`
- **THEN** la app funciona igual que hoy, sin errores en consola

### Requirement: La API y los flujos en vivo nunca se interceptan
El service worker MUST NOT responder ni guardar en caché ninguna solicitud a `/api/`, `/health`, la documentación de
la API, el seguimiento en vivo (`text/event-stream`), otro origen ni un método distinto de GET. Esas solicitudes van
directo a la red como si no hubiera service worker.

#### Scenario: Consulta autenticada
- **WHEN** la app pide `GET /api/v1/broker/paper/resumen` con su token
- **THEN** la respuesta viene de la red
- **AND** no queda ninguna copia en las cachés del service worker

#### Scenario: Orden enviada sin conexión
- **WHEN** se intenta `POST /api/v1/ordenes/ticket` sin red
- **THEN** la solicitud falla como falla hoy y la app muestra su error habitual, sin reintentos ocultos

#### Scenario: Seguimiento en vivo
- **WHEN** la app abre `GET /api/v1/ordenes/:id/seguimiento`
- **THEN** el flujo SSE llega sin pasar por el service worker

### Requirement: Precarga de la cáscara de la app
Al instalarse, el service worker SHALL precargar `index.html` y todos los archivos de `/assets/` de su misma
compilación, en una caché propia de esa versión. Los archivos de `/assets/` se responden desde esa caché y, si faltan,
desde la red.

#### Scenario: Segunda visita
- **WHEN** un usuario vuelve a abrir la app ya instalada
- **THEN** los archivos de `/assets/` se sirven desde la caché sin pedirlos a la red

### Requirement: Navegación con red primero y respaldo sin conexión
Las navegaciones del mismo origen (fuera de `/api/` y `/health`) SHALL resolverse primero con la red. Si la red falla,
MUST responder con el `index.html` precargado para que la SPA cargue.

#### Scenario: Recargar sin conexión
- **WHEN** un usuario sin red recarga `/analisis/AAPL`
- **THEN** la app carga desde la caché
- **AND** muestra el aviso de sin conexión

#### Scenario: Con red se ve la versión publicada
- **WHEN** hay red y se publicó una versión nueva del `index.html`
- **THEN** la navegación recibe el `index.html` nuevo y no el guardado

### Requirement: Limpieza de versiones anteriores
Al activarse una versión nueva, el service worker SHALL borrar las cachés de versiones anteriores que él creó, sin
tocar otras cachés ni el almacenamiento de la app (`sessionStorage`, `localStorage`).

#### Scenario: Despliegue nuevo
- **WHEN** se activa la versión B del service worker tras la versión A
- **THEN** la caché de la versión A ya no existe
- **AND** la sesión iniciada en la pestaña sigue vigente

### Requirement: Aviso de versión nueva
Cuando hay una versión nueva instalada y en espera, la web SHALL mostrar el aviso «Hay una versión nueva» con un botón
«Recargar». Al pulsarlo, la versión nueva MUST activarse y la página recargarse una sola vez. Si el usuario no lo
pulsa, la versión nueva se activa al cerrar todas las pestañas.

#### Scenario: Usuario acepta la actualización
- **WHEN** aparece el aviso y el usuario pulsa «Recargar»
- **THEN** la página se recarga una vez con la versión nueva

#### Scenario: Usuario a mitad de un ticket
- **WHEN** aparece el aviso mientras el usuario llena un ticket
- **THEN** la página no se recarga sola y el ticket conserva lo escrito

### Requirement: Aviso sin conexión
Mientras el navegador reporte estar sin conexión, la web SHALL mostrar un aviso visible de que no hay red y de que los
datos y las órdenes no están disponibles. El aviso MUST desaparecer al volver la conexión.

#### Scenario: Se pierde la red
- **WHEN** el dispositivo pierde la conexión con la app abierta
- **THEN** aparece el aviso de sin conexión
- **AND** desaparece cuando la conexión regresa
