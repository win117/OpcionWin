# Guía de la T3-Actividad 2 (incisos A, B y C)

Equipo 9 · Laboratorio de Servicios Web · Tema 3: Desarrollo de microservicios.

## Contenido

| Archivo | Inciso | Tema |
|---|---|---|
| `01-introduccion-a-inversiones.md` | A | Inversión, mercado, marco regulatorio y ético |
| `02-inversion-con-opciones.md` | A | Opciones, Black-Scholes, griegas, Long Call, Long Put, Iron Condor |
| `03-operativa-brokers.md` | A | Alpaca y Webull: cuentas, permisos y órdenes por estrategia |
| `04-desarrollo-apis-cores.md` | A | Estructura del código, uso de las APIs y los cinco cores |
| `05-desarrollo-pwa.md` | A | La interfaz web como PWA instalable |
| `06-tutorial-openspec-sdd.md` | B | Tutorial de OpenSpec (SDD) con el caso de estudio real |
| `07-ia-vs-manual.md` | B | Evidencia: APIs con IA frente a manuales y técnicas de microservicios |
| `08-pruebas-y-monitoreo.md` | C | Cada tipo de prueba y de monitoreo, con resultados y configuración |
| `entrega/` | A+B+C | Documento con el formato de la rúbrica (PDF y .docx) y su generador |

## Regenerar el documento de entrega

Requisitos: Node 22+, Python 3 con Playwright y Microsoft Edge.

```bash
node docs/guia-opciones/entrega/construir.cjs          # → entrega/entrega.html (76 hojas)
python docs/guia-opciones/entrega/pdf.py               # → PDF; avisa si alguna hoja no cabe

# .docx editable (Word / Google Docs), una sección por hoja con su encabezado y pie:
npm --prefix docs/guia-opciones/entrega/docx install   # una sola vez (librería docx 9.5.1, solo para esto)
python docs/guia-opciones/entrega/docx/extraer.py docs/guia-opciones/entrega/entrega.html docs/guia-opciones/entrega/docx/out
node docs/guia-opciones/entrega/docx/armar.cjs docs/guia-opciones/entrega/docx/out docs/guia-opciones/entrega/LSW_G5B_6pm_T3_Act2_E9_CASTELLANOS_MACHUCA_EDWIN_URIEL.docx
python docs/guia-opciones/entrega/docx/limpiar.py docs/guia-opciones/entrega/LSW_G5B_6pm_T3_Act2_E9_CASTELLANOS_MACHUCA_EDWIN_URIEL.docx
```

Para editarlo en Google Docs: subir el .docx a Drive → clic derecho → *Abrir con → Documentos de Google*.

## Qué queda fuera de la versión final

Estas piezas existen o existieron durante el desarrollo, pero no forman parte de la versión final. Se documentan aquí
y quedan fuera del repositorio (`.gitignore`) o del alcance.

| Qué | Por qué queda fuera | Cómo recuperarlo |
|---|---|---|
| PDF y .docx de **solo el inciso A** | Los reemplaza el documento completo A+B+C | Regenerar con el generador (versión del commit `6305012`) |
| `entrega/entrega.html` | Archivo intermedio que se genera con `construir.cjs` | `node docs/guia-opciones/entrega/construir.cjs` |
| Copias de skills en `.agents/skills/` (`frontend-design`, `verificar-opciones`, `webapp-testing`) | Duplican las de `.claude/skills/`, que son las que se usan | Copiar desde `.claude/skills/` |
| `.vscode/` y archivos `*.code-workspace` | Configuración personal del editor | — |
| Reportes de pruebas (`output/pruebas/`: Newman, k6, ZAP) | Se generan en cada ejecución; sus resultados están en la guía 08 | `npm run test:e2e`, `test:carga`, `test:seguridad` |
| Binarios de **OWASP ZAP 2.17.0** y **k6 2.4.0** | Herramientas externas; no se versionan | Descargarlos (zaproxy.org, github.com/grafana/k6) y usar `ZAP_HOME` y el `PATH` |
| **Interactive Brokers** | Retirado del proyecto (sin cuenta configurada) | Etiqueta git `respaldo-ibkr` |
| Migrar los módulos existentes a `src/modulos/<dominio>/` | Fuera del alcance para no arriesgar lo que funciona (ADR-022) | Cambio sugerido de OpenSpec `migrar-a-modulos-por-dominio` |
| Trazas distribuidas (OpenTelemetry), notificaciones push, varias instancias | Fuera del alcance de los cambios `monitoreo-apis`, `convertir-web-en-pwa` y `optimizar-microservicios-apis` | Ver «Fuera del alcance» en cada `proposal.md` archivado |
| Cuentas de Grafana Cloud, UptimeRobot y Sentry | Las crea el equipo; el código ya expone lo que necesitan | Guía 08, sección 8.6 |
