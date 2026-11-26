# Spec Delta

## ADDED Requirements

### Requirement: Datos de operación sin secretos ni datos personales
Las métricas, los logs estructurados, los errores agrupados y la analítica SHALL identificar al usuario solo por un
seudónimo (hash recortado y con sal del servidor) y MUST NOT contener tokens, contraseñas, cuerpos, consultas, correos
ni valores de variables secretas.

#### Scenario: Analítica sin identidad real
- **WHEN** un usuario con correo `ana@local` usa la API y se pide `/monitoreo/uso`
- **THEN** la respuesta no contiene `ana@local` ni su id real, solo un seudónimo estable
