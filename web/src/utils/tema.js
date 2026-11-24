// Tema de la interfaz: automático (el del sistema), claro u oscuro. Se aplica al importar, antes del primer dibujo.
const CLAVE = 'opciones.tema.v1';
export const TEMA_EVENT = 'opciones:tema';
export const TEMAS = [{ value: 'auto', label: 'Automático' }, { value: 'claro', label: 'Claro' }, { value: 'oscuro', label: 'Oscuro' }];

export function leerTema() {
  try { const t = localStorage.getItem(CLAVE); return TEMAS.some(x => x.value === t) ? t : 'auto'; } catch { return 'auto'; }
}

function pintar(tema) {
  const raiz = document.documentElement;
  if (tema === 'auto') delete raiz.dataset.theme;
  else raiz.dataset.theme = tema === 'oscuro' ? 'dark' : 'light';
}

export function aplicarTema(tema) {
  pintar(tema);
  try { localStorage.setItem(CLAVE, tema); } catch { /* sin almacenamiento: vale para esta visita */ }
  window.dispatchEvent(new CustomEvent(TEMA_EVENT, { detail: tema }));
}

pintar(leerTema());
