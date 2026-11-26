# sesiones-autenticacion

## Purpose
Controlar quién usa la API y contra qué base de datos trabaja. El usuario inicia sesión eligiendo la base (MongoDB o
Supabase), recibe un token Bearer de vida limitada y todas las rutas de `/api/v1` (salvo `/sesiones`) lo exigen.
Implementación: `src/api/v1/routes/sesiones.routes.js`, `services/sesiones.service.js`, `middlewares/auth.handler.js`,
`middlewares/limites.handler.js`.

## Requirements

### Requirement: Inicio de sesión con elección de base de datos
El sistema SHALL aceptar `POST /api/v1/sesiones` con correo, contraseña y base de datos (`mongodb` o `supabase`) y
devolver `{ token, tokenType: "Bearer", usuarioId, baseDatos, expiraEn }`. La sesión MUST guardar solo el hash del token
y caducar a los `SESSION_TTL_SECONDS` segundos (3600 por defecto).

#### Scenario: Credenciales válidas
- **WHEN** un usuario registrado envía su correo, su contraseña correcta y `baseDatos: "mongodb"`
- **THEN** recibe 200 (con `Cache-Control: no-store`) con un token Bearer y `expiraEn` una hora después
- **AND** las siguientes solicitudes con ese token trabajan sobre MongoDB

#### Scenario: Credenciales inválidas
- **WHEN** la contraseña no coincide o el usuario no existe
- **THEN** responde 401 «Credenciales inválidas» sin revelar cuál de los dos datos falló

### Requirement: Usuarios configurados en el servidor
El sistema SHALL leer los usuarios de la variable `AUTH_USERS_JSON` o, si no existe, del archivo de usuarios, y MUST
validar su formato al arrancar. Las contraseñas MUST guardarse con scrypt; nunca en texto plano.

#### Scenario: Variable con prioridad
- **WHEN** existen tanto `AUTH_USERS_JSON` como el archivo de usuarios
- **THEN** se usan los usuarios de la variable

### Requirement: Rutas protegidas con token
Toda ruta de `/api/v1` excepto `POST /sesiones` SHALL exigir `Authorization: Bearer <token>`. El sistema MUST rechazar
con 401 un token alterado, expirado, revocado, de otra base de datos o de un usuario eliminado o desactivado.

#### Scenario: Token alterado
- **WHEN** se envía un token con un carácter cambiado
- **THEN** responde 401 «Sesión inválida o expirada.»

#### Scenario: Usuario desactivado con sesión vigente
- **WHEN** un administrador desactiva a un usuario cuya sesión aún no expira
- **THEN** la siguiente solicitud de ese usuario responde 401

### Requirement: Consulta y cierre de la sesión
El sistema SHALL ofrecer `GET /sesiones/actual` (usuario, base y expiración) y `DELETE /sesiones/actual`, que revoca el
token de inmediato.

#### Scenario: Cerrar sesión
- **WHEN** el usuario llama a `DELETE /sesiones/actual`
- **THEN** responde 204
- **AND** el mismo token responde 401 en cualquier solicitud posterior

### Requirement: Límite de intentos de inicio de sesión
El sistema SHALL limitar los intentos a 10 por minuto por IP y 10 cada 15 minutos por correo, aunque cambie la IP, y
responder 429 al excederlos. Un inicio exitoso MUST reiniciar el contador del correo. Un cuerpo inválido también cuenta
como intento. Sin proxy de confianza configurado, `X-Forwarded-For` MUST ignorarse.

#### Scenario: Fuerza bruta desde varias IP
- **WHEN** se hacen 11 intentos fallidos contra el mismo correo desde IP distintas en 15 minutos
- **THEN** el intento 11 responde 429 «Demasiados intentos»

### Requirement: Auditoría de accesos
El sistema SHALL registrar en auditoría el inicio, el fallo (con el correo enmascarado y nunca la contraseña) y el cierre
de sesión. Los fallos auditados MUST estar acotados (20 por hora por usuario) y las sesiones expiradas MUST purgarse.

#### Scenario: Fallo de inicio de sesión
- **WHEN** falla un intento de inicio de sesión
- **THEN** la auditoría guarda el evento sin la contraseña
