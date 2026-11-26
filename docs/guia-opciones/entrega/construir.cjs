// Genera el documento de entrega (T3-Actividad 2, incisos A, B y C) con el formato de la rúbrica.
// Uso: node docs/guia-opciones/entrega/construir.cjs  → entrega.html ; después: python docs/guia-opciones/entrega/pdf.py
const fs = require('fs');
const path = require('path');
const h = require('./ayudantes.cjs');

const FECHA = '26/11/2026';
const PIE = 'Laboratorio de servicios web · Unidad 3 · Dr. Francisco Ibarra Carlos · ISC · Instituto Tecnológico de Tepic';

const paginas = [];
const pag = (encabezado, html, opciones = {}) => paginas.push({ encabezado, html, ...opciones });
require('./paginas-1.cjs')(pag, h);
require('./paginas-2.cjs')(pag, h);
require('./paginas-3.cjs')(pag, h);   // inciso B (secciones 6 y 7)
require('./paginas-4.cjs')(pag, h);   // inciso C (secciones 8 y 9)
require('./paginas-final.cjs')(pag, h);

// Índice: primera hoja cuyo encabezado empieza con cada prefijo
const ENTRADAS = [['Introducción', 'Introducción'], ['A) Guía paso a paso de las estrategias asignadas', 'A) 1.'], ['1. Introducción a Inversiones', 'A) 1.'], ['2. Inversión con Opciones', '2.'],
  ['3. Operativa de estrategias en los brokers', '3.'], ['4. Desarrollo de APIs con los cores (algoritmos/cerebro)', '4.'], ['5. Desarrollo de la PWA', '5.'],
  ['B) Microservicios optimizados con SDD (OpenSpec)', 'B) 6.'], ['6. Desarrollo guiado por especificaciones con OpenSpec', 'B) 6.'], ['7. Técnicas de microservicios y evidencia IA frente a manual', 'B) 7.'],
  ['C) Pruebas y monitoreo de las APIs', 'C) 8.'], ['8. Pruebas de las APIs', 'C) 8.'], ['9. Monitoreo de las APIs', 'C) 9.'],
  ['Conclusión', 'Conclusión'], ['Glosario', 'Glosario'], ['Referencias', 'Referencias']];
const SUB = new Set([2, 3, 4, 5, 6, 8, 9, 11, 12]); // entradas con sangría (secciones dentro de cada inciso)
const indiceHtml = ENTRADAS.map(([t, pref], i) => {
  const n = paginas.findIndex(p => p.encabezado.startsWith(pref)) + 1;
  if (!n) throw new Error('Sin página para ' + t);
  return `<div class="idx${SUB.has(i) ? ' sub' : ''}"><span>${t}</span><span class="dots"></span><span>${n}</span></div>`;
}).join('');
const total = paginas.length;

const css = `
@page { size: 8.5in 11in; margin: 0 }
* { box-sizing: border-box }
body { margin: 0; font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #111; background: #fff }
.page { width: 8.5in; height: 11in; padding: 0.55in 0.95in 0.45in; display: flex; flex-direction: column; page-break-after: always; overflow: hidden }
.hdr { font-size: 11pt; margin-bottom: 14px; border-bottom: 1px solid #bfbfbf; padding-bottom: 4px }
.hdr .r { display: flex; justify-content: space-between }
.cuerpo { flex: 1; overflow: hidden }
.ftr { text-align: center; font-size: 10.5pt; margin-top: 8px; border-top: 1px solid #bfbfbf; padding-top: 4px }
h2 { font-size: 15.5pt; font-weight: normal; margin: 2px 0 12px } h2.centro { text-align: center } h2.sec { font-size: 13pt; margin-bottom: 10px }
h3 { font-size: 13pt; margin: 16px 0 8px; color: #000 } h4 { font-size: 12pt; margin: 10px 0 5px }
p { margin: 0 0 10px; text-align: justify; line-height: 1.42 }
mark.g { background: #00ff00 } mark.o { background: #ff9900 } mark.y { background: #ffff00 }
p.inciso { margin: 0 0 10px 18px }
.en { margin-top: 14px } .en span { background: #00ffff; font-style: italic; -webkit-box-decoration-break: clone; box-decoration-break: clone }
table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 10.5pt; line-height: 1.3 }
table.chica { font-size: 10pt } table.mini { font-size: 9.5pt } table.mini td, table.mini th { padding: 2.5px 6px }
th, td { border: 1px solid #a9d08e; padding: 4px 7px; text-align: left; vertical-align: top }
th { background: #c6e0b4 } tr:nth-child(even) td { background: #f2f8ee }
ul, ol { margin: 4px 0 10px; padding-left: 24px } li { margin: 4px 0; line-height: 1.38 }
ol.pasos li::marker { font-weight: bold; color: #1f3864 }
code { font-family: Consolas, monospace; font-size: 10pt; background: #f2f2f2; padding: 0 3px; border-radius: 2px }
.cod { margin: 8px 0 12px; border: 1px solid #d0d7de; border-radius: 5px; overflow: hidden }
.cod .arch { background: #24292f; color: #fff; font-family: Consolas, monospace; font-size: 8.8pt; padding: 3px 8px }
.cod pre { font-family: Consolas, monospace; font-size: 8.6pt; line-height: 1.35; background: #f6f8fa; margin: 0; padding: 6px 9px; white-space: pre-wrap }
.formula { text-align: center; font-family: Cambria, 'Times New Roman', serif; background: #f2f2f2; padding: 7px; border-radius: 5px; margin: 10px 0 12px }
.nota { background: #eef5fc; border-left: 4px solid #2e75b6; padding: 7px 11px; margin: 10px 0 12px; line-height: 1.4; text-align: justify; font-size: 11.5pt }
figure { margin: 12px 0 10px; text-align: center } figcaption, .cap { font-size: 10pt; font-style: italic; color: #444; text-align: center; margin: 3px 0 10px }
.dos { display: flex; gap: 18px; align-items: flex-start } .dos > div { flex: 1 }
.logos { display: flex; justify-content: space-between; align-items: center; margin: 30px 0 40px } .tecnm { height: 110px } .itt { height: 130px }
.portada p { text-align: center; margin: 10px 0; font-size: 13pt }
.idx { display: flex; font-size: 12pt; margin: 9px 0 } .idx.sub { padding-left: 22px } .idx .dots { flex: 1; border-bottom: 1px dotted #444; margin: 0 4px 5px }
dl { text-align: justify; line-height: 1.42 } dl dt { font-weight: bold; color: #000; display: inline; margin-right: 4px } dl dd { display: inline; margin: 0 } dl dd::after { content: ''; display: block; margin-bottom: 9px }
.refs p { padding-left: 0.5in; text-indent: -0.5in; text-align: left; font-size: 11.5pt; margin-bottom: 8px }
`;
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>T3-Actividad 2 · Incisos A, B y C</title><style>${css}</style></head><body>
${paginas.map((p, i) => `<section class="page" data-n="${i + 1}"><div class="hdr"><div>${p.encabezado}</div><div class="r"><span>${FECHA}</span><span>${i + 1} de ${total}</span></div></div>
<div class="cuerpo">${p.indice ? p.html.replace('<div id="indice"></div>', indiceHtml) : p.html}</div><div class="ftr">${PIE}</div></section>`).join('\n')}
</body></html>`;
fs.writeFileSync(path.join(__dirname, 'entrega.html'), html);
console.log(`Páginas: ${total}`);
