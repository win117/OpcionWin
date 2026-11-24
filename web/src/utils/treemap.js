// Treemap "squarified" (Bruls, Huizing y van Wijk, 2000): reparte un rectángulo en cuadros de área proporcional a `valor`,
// procurando que cada cuadro sea lo más cuadrado posible. Puro: sin DOM.

function peorRazon(fila, lado, suma) {
  let max = 0, min = Infinity;
  for (const a of fila) { if (a > max) max = a; if (a < min) min = a; }
  return Math.max((lado * lado * max) / (suma * suma), (suma * suma) / (lado * lado * min));
}

/** items: [{ valor, ... }] → [{ item, x, y, w, h }] dentro de (x, y, w, h). Ignora valores no positivos. */
export function cuadricula(items, x, y, w, h) {
  const lista = items.filter(i => i.valor > 0).sort((a, b) => b.valor - a.valor);
  const total = lista.reduce((s, i) => s + i.valor, 0);
  const salida = [];
  if (!total || w <= 0 || h <= 0) return salida;
  const escala = (w * h) / total;
  let i = 0;
  while (i < lista.length) {
    const lado = Math.min(w, h);
    const fila = [];
    let suma = 0;
    while (i + fila.length < lista.length) {
      const area = lista[i + fila.length].valor * escala;
      if (fila.length && peorRazon([...fila, area], lado, suma + area) > peorRazon(fila, lado, suma)) break;
      fila.push(area);
      suma += area;
    }
    const grosor = suma / lado;
    let pos = 0;
    for (const area of fila) {
      const largo = area / grosor;
      salida.push(w >= h ? { item: lista[i], x, y: y + pos, w: grosor, h: largo } : { item: lista[i], x: x + pos, y, w: largo, h: grosor });
      pos += largo;
      i += 1;
    }
    if (w >= h) { x += grosor; w -= grosor; } else { y += grosor; h -= grosor; }
  }
  return salida;
}

const agrupar = (items, clave) => {
  const m = new Map();
  for (const i of items) { if (!m.has(i[clave])) m.set(i[clave], []); m.get(i[clave]).push(i); }
  return [...m].map(([nombre, lista]) => ({ nombre, lista, valor: lista.reduce((s, i) => s + i.valor, 0) }));
};

const TITULO_SECTOR = 20, TITULO_INDUSTRIA = 15, SEPARACION = 2;

/** Sector → industria → empresa. Devuelve { sectores, industrias, cuadros } con coordenadas absolutas. */
export function disponerMapa(items, ancho, alto) {
  const sectores = [], industrias = [], cuadros = [];
  for (const s of cuadricula(agrupar(items, 'sector'), 0, 0, ancho, alto)) {
    const sx = s.x + SEPARACION, sw = s.w - SEPARACION * 2, conTitulo = s.h > 46 && sw > 46;
    const sy = s.y + (conTitulo ? TITULO_SECTOR : SEPARACION), sh = s.h - (conTitulo ? TITULO_SECTOR : SEPARACION) - SEPARACION;
    if (conTitulo) sectores.push({ nombre: s.item.nombre, x: sx, y: s.y, w: sw });
    for (const g of cuadricula(agrupar(s.item.lista, 'industria'), sx, sy, sw, sh)) {
      const titulo = g.w > 92 && g.h > 58 && g.item.lista.length > 1;
      if (titulo) industrias.push({ nombre: g.item.nombre, x: g.x, y: g.y, w: g.w });
      const dy = titulo ? TITULO_INDUSTRIA : 0;
      for (const c of cuadricula(g.item.lista, g.x, g.y + dy, g.w, g.h - dy)) cuadros.push({ simbolo: c.item.simbolo, x: c.x, y: c.y, w: c.w, h: c.h });
    }
  }
  return { sectores, industrias, cuadros };
}
