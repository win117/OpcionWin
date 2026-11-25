# Operar con Interactive Brokers (paper)

Interactive Brokers no da una clave como Alpaca: se usa un programa suyo, el **Client Portal Gateway**, que corre en tu computadora. Tú inicias sesión en él y la
aplicación solo le habla a ese programa; nunca ve tu usuario ni tu contraseña.

1. En tu cuenta de IBKR activa la cuenta simulada (*Settings → Paper Trading Account*). Su número empieza con `DU`. Necesitas tener aprobada una cuenta normal.
2. Instala Java 8 o superior y descarga el Client Portal Gateway desde la página de IBKR (Web API / Client Portal API).
3. En la carpeta del gateway ejecuta `bin\\run.bat root\\conf.yaml` y deja la ventana abierta.
4. Abre `https://localhost:5000` (el aviso de certificado es normal: es tu propia computadora) e inicia sesión con tu usuario **de paper**.
5. En `.env` pon `IBKR_GATEWAY_URL=https://localhost:5000` (si tienes varias cuentas, también `IBKR_ACCOUNT_ID=DU...`) y reinicia el servidor.
6. En la cabecera elige **Interactive Brokers paper**.

Límites: la sesión del gateway caduca (hay que volver a entrar, al menos una vez al día); en Render no está disponible porque el gateway vive en tu computadora; las
cuentas reales (`U...`) están bloqueadas (ADR-005). Los precios y el análisis siguen viniendo de Alpaca; IBKR solo recibe las órdenes.
