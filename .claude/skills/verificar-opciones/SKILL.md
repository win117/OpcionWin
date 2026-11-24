---
name: verificar-opciones
description: Cómo comprobar un cambio en AppRESTOpciones (API Express, cores, integraciones Alpaca/SEC/Webull y frontend React) antes de darlo por terminado. Usar al modificar código de este proyecto.
---

# Verificar un cambio

1. **Pruebas sin red:** `npm test` (compila con Babel y corre todo). Un archivo de prueba nuevo se agrega a la lista del script `test` en `package.json`.
2. **Frontend:** `npm --prefix web run build`. `web/dist` es lo que sirve el servidor.
3. **Datos reales** (crean un usuario temporal y lo borran; no cortarlos con `timeout`, porque se saltan la limpieza):
   - `node scripts/smoke-real.cjs mongodb|supabase MSFT` — sincronización, cores y selección.
   - `node scripts/smoke-screener.cjs mongodb|supabase 10` — estado de mercado y screener.
   - `node scripts/smoke-ticket.cjs mongodb alpaca|webull` — envía y cancela una orden **paper**. Webull solo acepta de 9:30 a 16:00 ET.
4. **Interfaz:** recorrerla en un navegador real (skill `webapp-testing`; Playwright con `channel='chrome'`) en escritorio, móvil (390 px), claro y oscuro.
5. Reiniciar el servidor: `npm start` carga `dist` una sola vez.

# Reglas del proyecto

- **Solo paper.** El mercado real está bloqueado en código (ADR-005) y así se queda.
- **Ningún dato de empresas escrito en el código:** símbolos, sectores, acciones y precios se obtienen de Alpaca o la SEC.
- Los cores son puros: sin red, sin base de datos, sin reloj propio (`fechaReferencia` entra como dato).
- Alpaca permite 200 solicitudes/min: preferir los endpoints por lotes y no silenciar errores `LIMITE` (usar `conReintento`).
- Validar cifras sospechosas con una fuente distinta, no con otro endpoint de la misma.
- Nunca subir `.env`, `private/` ni `backups/`: el repositorio es público. Revisar los commits contra los valores de `.env` antes de `git push`, y pedir permiso para subir.
- Respaldo antes y después de un cambio grande: `npm run backup -- etiqueta`. Anotar en `docs/version-funcional/plan.md`; las decisiones, en `docs/decisiones/README.md`.
