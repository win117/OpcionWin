// Ayudantes para dibujar diagramas SVG y bloques HTML del documento de entrega.
const C = {
  am: ['#fff2cc', '#d6b656'], ve: ['#d5e8d4', '#82b366'], az: ['#dae8fc', '#6c8ebf'], na: ['#ffe6cc', '#d79b00'],
  ro: ['#f8cecc', '#b85450'], mo: ['#e1d5e7', '#9673a6'], os: ['#1f3864', '#1f3864'], gr: ['#f5f5f5', '#666666'],
};
let nSvg = 0;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function texto(x, y, lineas, { fs = 11, color = '#222', bold = false, anchor = 'middle', italic = false } = {}) {
  const ls = Array.isArray(lineas) ? lineas : String(lineas).split('|');
  const y0 = y - ((ls.length - 1) * fs * 1.18) / 2;
  return ls.map((l, i) => `<text x="${x}" y="${y0 + i * fs * 1.18}" font-size="${fs}" fill="${color}" text-anchor="${anchor}" dominant-baseline="middle" font-family="Arial"${bold ? ' font-weight="bold"' : ''}${italic ? ' font-style="italic"' : ''}>${esc(l)}</text>`).join('');
}
function caja(x, y, w, h, t, col = 'az', { fs = 11, forma = 'rect', bold = false } = {}) {
  const [f, s] = C[col]; const tc = col === 'os' ? '#fff' : '#222';
  let fig;
  if (forma === 'hex') { const d = 14; fig = `<polygon points="${x + d},${y} ${x + w - d},${y} ${x + w},${y + h / 2} ${x + w - d},${y + h} ${x + d},${y + h} ${x},${y + h / 2}" fill="${f}" stroke="${s}" stroke-width="1.5"/>`; }
  else if (forma === 'cil') { fig = `<path d="M${x},${y + 6} v${h - 12} a${w / 2},6 0 0,0 ${w},0 v${-(h - 12)} a${w / 2},6 0 0,0 ${-w},0 a${w / 2},6 0 0,0 ${w},0" fill="${f}" stroke="${s}" stroke-width="1.5"/>`; }
  else if (forma === 'elip') { fig = `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${f}" stroke="${s}" stroke-width="1.5"/>`; }
  else fig = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" fill="${f}" stroke="${s}" stroke-width="1.5"/>`;
  return fig + texto(x + w / 2, y + h / 2 + (forma === 'cil' ? 3 : 0), t, { fs, color: tc, bold });
}
function flecha(x1, y1, x2, y2, etiqueta = '', { punteada = false, fs = 9.5, dx = 0, dy = -7 } = {}) {
  const l = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#44546a" stroke-width="1.4" marker-end="url(#mk)"${punteada ? ' stroke-dasharray="5,4"' : ''}/>`;
  return l + (etiqueta ? texto((x1 + x2) / 2 + dx, (y1 + y2) / 2 + dy, etiqueta, { fs, color: '#444' }) : '');
}
const linea = (x1, y1, x2, y2, color = '#555', ancho = 1.2, punteada = false) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${ancho}"${punteada ? ' stroke-dasharray="4,3"' : ''}/>`;

let nFig = 0;
function svg(w, h, titulo, contenido, pie) {
  nSvg += 1; const id = `mk${nSvg}`;
  const cuerpo = contenido.replace(/url\(#mk\)/g, `url(#${id})`);
  if (pie) nFig += 1;
  return `<figure><svg viewBox="0 0 ${w} ${h}" width="100%" style="max-height:${h * 1.05}px"><defs><marker id="${id}" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="#44546a"/></marker></defs>`
    + (titulo ? texto(w / 2, 12, titulo, { fs: 14, bold: true, color: '#000' }) : '') + cuerpo + `</svg>${pie ? `<figcaption>Figura ${nFig}. ${pie}</figcaption>` : ''}</figure>`;
}
const figura = pie => { nFig += 1; return `<p class="cap">Figura ${nFig}. ${pie}</p>`; };

// Gráfica de pago al vencimiento (payoff)
function payoff(titulo, fn, xmin, xmax, ymin, ymax, marcas = [], color = '#2e75b6', w = 330, h = 185) {
  const L = 46, R = 10, T = 26, B = 28, pw = w - L - R, ph = h - T - B;
  const X = v => L + ((v - xmin) / (xmax - xmin)) * pw, Y = v => T + ((ymax - v) / (ymax - ymin)) * ph;
  const pts = []; for (let i = 0; i <= 240; i++) { const s = xmin + (i / 240) * (xmax - xmin); pts.push(`${X(s).toFixed(1)},${Y(fn(s)).toFixed(1)}`); }
  let g = `<rect x="${L}" y="${T}" width="${pw}" height="${Y(0) - T}" fill="#e2f0d9" opacity=".6"/><rect x="${L}" y="${Y(0)}" width="${pw}" height="${T + ph - Y(0)}" fill="#fbe5d6" opacity=".6"/>`;
  g += linea(L, Y(0), L + pw, Y(0)) + linea(L, T, L, T + ph);
  g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.6"/>`;
  for (const m of marcas) g += linea(X(m.x), T, X(m.x), T + ph, '#999', 1, true) + texto(X(m.x), T + ph + 11, m.t, { fs: 9 });
  g += texto(L - 4, Y(ymax) + 5, String(ymax), { fs: 9, anchor: 'end' }) + texto(L - 4, Y(0), '0', { fs: 9, anchor: 'end' }) + texto(L - 4, Y(ymin) - 5, String(ymin), { fs: 9, anchor: 'end' });
  g += texto(L + pw - 2, Y(0) - 9, 'precio al vencer →', { fs: 9, anchor: 'end', color: '#555' }) + texto(L + 6, T + 9, 'ganancia (USD)', { fs: 9, anchor: 'start', color: '#38761d' }) + texto(L + 6, T + ph - 9, 'pérdida (USD)', { fs: 9, anchor: 'start', color: '#b85450' });
  return `<svg viewBox="0 0 ${w} ${h}" width="100%">${texto(w / 2, 11, titulo, { fs: 12, bold: true, color: '#000' })}${g}</svg>`;
}

// Velas japonesas a partir de [apertura, máximo, mínimo, cierre]
function velas(datos, w = 300, h = 150, titulo = '') {
  const L = 30, T = 24, B = 14, ph = h - T - B, vals = datos.flat(), mx = Math.max(...vals), mn = Math.min(...vals);
  const Y = v => T + ((mx - v) / (mx - mn)) * ph, paso = (w - L - 10) / datos.length;
  let g = '';
  datos.forEach(([o, hi, lo, c], i) => {
    const x = L + i * paso + paso / 2, col = c >= o ? '#38761d' : '#b85450', rel = c >= o ? '#93c47d' : '#ea9999';
    g += linea(x, Y(hi), x, Y(lo), col, 1.5) + `<rect x="${x - paso * 0.3}" y="${Y(Math.max(o, c))}" width="${paso * 0.6}" height="${Math.max(1.5, Math.abs(Y(o) - Y(c)))}" fill="${rel}" stroke="${col}"/>`;
  });
  g += linea(L, T, L, T + ph) + texto(L - 4, T + 4, mx.toFixed(0), { fs: 9, anchor: 'end' }) + texto(L - 4, T + ph - 4, mn.toFixed(0), { fs: 9, anchor: 'end' });
  return (titulo ? texto(w / 2, 10, titulo, { fs: 12, bold: true, color: '#000' }) : '') + g;
}

// Bloques HTML
const en = t => `<p class="en"><span>${t}</span></p>`;
const tabla = (cab, filas, cls = '') => `<table class="${cls}"><thead><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${filas.map(f => `<tr>${f.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const ul = items => `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
const pasos = items => `<ol class="pasos">${items.map(i => `<li>${i}</li>`).join('')}</ol>`;
const nota = (titulo, html) => `<div class="nota"><b>${titulo}</b> ${html}</div>`;
const codigo = (archivo, src) => `<div class="cod"><div class="arch">${archivo}</div><pre>${esc(src)}</pre></div>`;

module.exports = { C, esc, texto, caja, flecha, linea, svg, figura, payoff, velas, en, tabla, ul, pasos, nota, codigo };
