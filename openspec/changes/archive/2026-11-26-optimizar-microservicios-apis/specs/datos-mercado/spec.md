# Spec Delta

## MODIFIED Requirements

### Requirement: Estado de los proveedores sin revelar claves
`GET /integraciones/estado` SHALL indicar qué proveedores están configurados (Alpaca, Webull, SEC, Tesoro) y MUST NOT
incluir ningún valor de credencial. Cada proveedor MUST incluir además `circuito` con su estado (`cerrado`, `abierto` o
`semiabierto`) y, si está abierto, los segundos que faltan para la prueba de recuperación.

#### Scenario: Alpaca sin claves
- **WHEN** faltan `ALPACA_KEY_ID` o `ALPACA_SECRET_KEY`
- **THEN** el estado de Alpaca es `configurado: false` y no se hace ninguna solicitud de red

#### Scenario: Circuito abierto visible
- **WHEN** el circuito de la SEC está abierto
- **THEN** el estado de la SEC incluye `circuito: { estado: "abierto", reintentoEnSegundos }`
- **AND** los campos que ya existían siguen presentes con los mismos valores
