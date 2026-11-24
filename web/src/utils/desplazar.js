/** Desplaza en horizontal una fila con scroll para dejar `hijo` centrado, sin mover la página. */
export function centrarEn(fila, hijo) {
  if (!fila || !hijo || fila.scrollWidth <= fila.clientWidth) return;
  const a = fila.getBoundingClientRect(), b = hijo.getBoundingClientRect();
  fila.scrollLeft += b.left - a.left - (a.width - b.width) / 2;
}
