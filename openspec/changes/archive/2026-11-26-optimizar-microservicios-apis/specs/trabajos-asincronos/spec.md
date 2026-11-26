# Spec Delta

## ADDED Requirements

### Requirement: Sin trabajos nuevos durante el apagado
Mientras el servicio se apaga (drenado), los endpoints que crean trabajos 202 SHALL responder 503 con `Retry-After` y
un mensaje en español, sin crear el registro. Los trabajos ya encolados MUST seguir hasta terminar o hasta que venza el
tiempo de drenado.

#### Scenario: Sincronización pedida durante un despliegue
- **WHEN** el servicio está drenando y llega `POST /api/v1/sincronizaciones/ejecuciones`
- **THEN** responde 503 con `Retry-After` y no se crea ninguna sincronización
