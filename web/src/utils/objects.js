export function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/** Asigna en una ruta "a.b" (copiando objetos intermedios); undefined elimina la clave. */
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let target = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const current = target[keys[i]];
    if (current == null || typeof current !== 'object') {
      if (value === undefined) return obj;
      target[keys[i]] = {};
    } else {
      target[keys[i]] = { ...current };
    }
    target = target[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete target[last];
  else target[last] = value;
  return obj;
}

export function byId(items = []) {
  return new Map(items.map(item => [item._id, item]));
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function empresaLabel(empresa) {
  return empresa ? `${empresa.simbolo} · ${empresa.nombre}` : '';
}

export function contratoLabel(c) {
  if (!c) return '';
  const venc = c.vencimiento ? String(c.vencimiento).slice(0, 10) : '';
  return `${c.simbolo} · ${c.tipo === 'call' ? 'Call' : 'Put'} ${c.strike} · ${venc}`;
}

/** Métrica por nombre dentro de un arreglo [{nombre, valor}]. */
export function metrica(metricas = [], nombre) {
  return metricas.find(m => m.nombre === nombre)?.valor;
}
