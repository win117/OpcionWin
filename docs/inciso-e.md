# E. Servicios

Los servicios CRUD validan documentos completos con los modelos del inciso C, inyectan el usuario de la sesión, comprueban referencias y usan el repositorio elegido al iniciar sesión. PUT reemplaza campos editables; no es PATCH. Las fechas e identificadores los controla el servidor.

Se incluyen operaciones individuales y por lote (1–100 elementos). Los lotes no son atómicos: devuelven resultado por elemento. Las referencias se verifican antes de escribir; esa comprobación entre documentos no equivale a una transacción distribuida. El control revision evita sobrescribir ediciones concurrentes del mismo documento.

Subdocumentos: componentes, reglas, métricas, fuentes, griegas, tenencias, resultados, ponderaciones y eventos. Se valida el padre completo. El borrado de subdocumentos obligatorios puede ser rechazado por el modelo. Los componentes se editan solamente en configuraciones borrador.

Autenticación propia del servidor mediante hashes scrypt en un archivo privado, aprovisionados por CLI. No usa contraseñas por defecto ni acepta usuarioId del cliente. El token opaco se almacena como hash en la base seleccionada; logout lo revoca. La selección no se toma de headers arbitrarios posteriores al login.

Alcance: CRUD de registros de la aplicación. Guardar una orden local no compra opciones, guardar una evaluación no ejecuta un core, ni crear una sincronización inicia un proceso externo. Los algoritmos y adaptadores del tema 3 siguen separados. No se ofrecen resultados ficticios de brokers o análisis.

English: Services validate complete documents and enforce ownership before accessing the selected database. Batch operations report individual outcomes, while nested resources are validated together with their parent documents.

Palabras clave: servicios, CRUD, validación, lotes, referencias, propietario.
