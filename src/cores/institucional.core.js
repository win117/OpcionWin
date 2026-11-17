// Core institucional: cambio de tenencias 13F entre los dos cortes más recientes.
// 13F se publica hasta 45 días después del trimestre: describe posiciones pasadas, no flujo en tiempo real.
import { combinar, DIA_MS, esNumero, finalizar, metrica, tiempo } from './util.js';

export const VERSION = 'institucional@1.0.0';
export const REQUIERE = ['reportes'];

const DIAS_VIGENCIA = 135; // corte + 45 días de publicación + un trimestre

const agregar = reporte => {
  const mapa = new Map();
  for (const t of reporte.tenencias || []) {
    if (!t || !esNumero(t.acciones) || t.acciones < 0) continue;
    const id = String(t.identificadorInstitucion || t.institucion || '').trim();
    if (!id) continue;
    mapa.set(id, (mapa.get(id) || 0) + t.acciones);
  }
  return mapa;
};

export function evaluar(input = {}) {
  const ref = tiempo(input.fechaReferencia);
  // Solo reportes conocidos a la fecha de referencia (fechaPublicacion si existe, si no fechaCorte).
  const reportes = (Array.isArray(input.reportes) ? input.reportes : [])
    .filter(r => r && tiempo(r.fechaCorte) != null)
    .filter(r => ref == null || (tiempo(r.fechaPublicacion) ?? tiempo(r.fechaCorte)) <= ref)
    .sort((a, b) => tiempo(b.fechaCorte) - tiempo(a.fechaCorte));
  const motivos = ['Datos 13F: reportados hasta 45 días después del cierre de trimestre; reflejan posiciones pasadas.'];
  const datosFaltantes = [];
  const metricas = [];

  // Un corte por fecha: si hay varios reportes con la misma fechaCorte se combinan.
  const cortes = [];
  for (const r of reportes) {
    const t = tiempo(r.fechaCorte);
    const ultimo = cortes[cortes.length - 1];
    if (ultimo && ultimo.t === t) ultimo.reportes.push(r);
    else cortes.push({ t, fecha: r.fechaCorte, reportes: [r] });
  }
  const mapaCorte = c => {
    const m = new Map();
    for (const r of c.reportes) for (const [k, v] of agregar(r)) m.set(k, (m.get(k) || 0) + v);
    return m;
  };

  let sCambio = null;
  let sAmplitud = null;
  let factorVigencia = 1;
  if (cortes.length < 2) {
    datosFaltantes.push(cortes.length ? 'reportes<2' : 'reportes');
    motivos.push('Se requieren al menos dos cortes 13F para medir cambios.');
    if (cortes.length) metricas.push(metrica('instituciones_reportadas', mapaCorte(cortes[0]).size, 'conteo'));
  } else {
    const a = mapaCorte(cortes[0]);
    const b = mapaCorte(cortes[1]);
    const totalA = [...a.values()].reduce((x, y) => x + y, 0);
    const totalB = [...b.values()].reduce((x, y) => x + y, 0);
    let aumentan = 0, disminuyen = 0, nuevas = 0, salen = 0;
    for (const [id, acc] of a) {
      if (!b.has(id)) nuevas++;
      else if (acc > b.get(id)) aumentan++;
      else if (acc < b.get(id)) disminuyen++;
    }
    for (const id of b.keys()) if (!a.has(id)) salen++;
    const periodo = `${String(cortes[1].fecha).slice(0, 10)}→${String(cortes[0].fecha).slice(0, 10)}`;
    if (totalB > 0) {
      const pct = (totalA / totalB - 1) * 100;
      sCambio = Math.tanh(pct / 10);
      metricas.push(metrica('cambio_acciones_pct', pct, '%', periodo));
      motivos.push(`Acciones reportadas ${pct >= 0 ? 'aumentan' : 'disminuyen'} ${Math.abs(pct).toFixed(2)}% entre cortes.`);
    } else datosFaltantes.push('reportes.acciones_previas');
    const universo = new Set([...a.keys(), ...b.keys()]).size;
    if (universo > 0) sAmplitud = (aumentan + nuevas - disminuyen - salen) / universo;
    metricas.push(
      metrica('instituciones_aumentan', aumentan, 'conteo', periodo),
      metrica('instituciones_disminuyen', disminuyen, 'conteo', periodo),
      metrica('instituciones_nuevas', nuevas, 'conteo', periodo),
      metrica('instituciones_salen', salen, 'conteo', periodo),
      metrica('instituciones_reportadas', a.size, 'conteo', String(cortes[0].fecha).slice(0, 10)),
    );
    motivos.push(`${aumentan} instituciones aumentan, ${disminuyen} disminuyen, ${nuevas} nuevas y ${salen} salen (solo las instituciones sincronizadas).`);
  }

  if (cortes.length && ref != null) {
    const dias = (ref - cortes[0].t) / DIA_MS;
    metricas.push(metrica('dias_desde_corte', dias, 'dias'));
    if (dias > DIAS_VIGENCIA) {
      factorVigencia = 0.5;
      motivos.push(`Último corte con ${Math.round(dias)} días de antigüedad: confianza reducida.`);
    }
  }

  const c = combinar([
    { nombre: 'cambio_acciones_pct', valor: sCambio, peso: 1.5 },
    { nombre: 'amplitud_instituciones', valor: sAmplitud, peso: 1 },
  ]);
  return finalizar({ ...c, confianza: c.confianza * factorVigencia, metricas, motivos, datosFaltantes, reglas: input.reglas, core: 'institucional' });
}
