// Core institucional: cambio de tenencias 13F entre los dos cortes más recientes.
// 13F se publica hasta 45 días después del trimestre: describe posiciones pasadas, no flujo en tiempo real.
// Entrada: reportes por corte (SEC EDGAR 13F-HR, information table; filers fijos en src/integrations/institucionales.js),
// con tenencias = acciones (sshPrnamt, tipo SH, sin opciones put/call) por institución.
// Panel balanceado: el cambio y la amplitud se miden solo con las instituciones presentes en AMBOS cortes. Una institución
// que falta en un corte puede no haber presentado aún su 13F (hasta 45 días) o no coincidir por nombre de emisor; contarla
// como salida/entrada sesgaría el resultado. Las nuevas/salen se informan como métricas pero no entran en la señal.
import { combinar, DIA_MS, esNumero, filtrarSenales, finalizar, metrica, tiempo } from './util.js';

export const VERSION = 'institucional@1.1.0';
export const REQUIERE = ['reportes'];
export const SENALES = [
  { nombre: 'cambio_acciones_pct', etiqueta: 'Cambio de acciones (%)', descripcion: 'Variación porcentual de las acciones en poder de instituciones entre cortes 13F.', pesoBase: 1.5 },
  { nombre: 'amplitud_instituciones', etiqueta: 'Amplitud institucional', descripcion: 'Balance entre instituciones que aumentan y las que disminuyen su posición.', pesoBase: 1 },
];

// ---- Constantes (fijas). pesoBase: heurística (el cambio agregado de acciones pesa más que la amplitud, que solo cuenta
// instituciones). No hay ajuste estadístico.
// Corte vigente: 45 días de plazo de publicación + un trimestre (90) = 135 días; más antiguo → confianza × 0.5.
export const DIAS_VIGENCIA = 135;
export const FACTOR_CONFIANZA_ANTIGUO = 0.5;
// Escala de tanh del cambio de acciones: ±10 % entre trimestres → ±0.76 (los grandes filers indexados rara vez mueven más).
export const ESCALA_CAMBIO_PCT = 10;
// Detección de split entre cortes (13F reporta acciones sin ajustar): si la mediana de acciones_nuevas/acciones_previas
// por institución está a ±5 % de un factor de split habitual, se ajusta el corte previo por ese factor.
export const FACTORES_SPLIT = [2, 3, 4, 5, 8, 10, 15, 20, 25, 30, 40, 50];
export const TOLERANCIA_SPLIT = 0.05;
// Mínimo de instituciones comunes para inferir un split (con 1–2 una compra real ×2 se confundiría con un split).
export const MIN_INSTITUCIONES_SPLIT = 3;

const mediana = xs => {
  const o = [...xs].sort((a, b) => a - b);
  const k = Math.floor(o.length / 2);
  return o.length % 2 ? o[k] : (o[k - 1] + o[k]) / 2;
};
/** Factor de split (≥ 2, o su inverso para un contrasplit) si la mediana de razones lo sugiere; 1 si no. */
export const detectarSplit = razones => {
  if (razones.length < MIN_INSTITUCIONES_SPLIT) return 1;
  const r = mediana(razones);
  for (const f of FACTORES_SPLIT) {
    if (Math.abs(r / f - 1) <= TOLERANCIA_SPLIT) return f;
    if (Math.abs(r * f - 1) <= TOLERANCIA_SPLIT) return 1 / f;
  }
  return 1;
};

// Suma acciones por institución dentro de un reporte (varias filas por gestor/clase).
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
    const comunes = [...a.keys()].filter(id => b.has(id));
    const nuevas = [...a.keys()].filter(id => !b.has(id)).length;
    const salen = [...b.keys()].filter(id => !a.has(id)).length;
    const periodo = `${String(cortes[1].fecha).slice(0, 10)}→${String(cortes[0].fecha).slice(0, 10)}`;
    // Split entre cortes: se reexpresa el corte previo en acciones posteriores al split.
    const factor = detectarSplit(comunes.filter(id => b.get(id) > 0).map(id => a.get(id) / b.get(id)));
    if (factor !== 1) motivos.push(`Posible split ${factor >= 1 ? `${factor}:1` : `1:${Math.round(1 / factor)}`} entre cortes: acciones previas ajustadas por ${factor >= 1 ? factor : `1/${Math.round(1 / factor)}`}.`);
    const previo = id => b.get(id) * factor;
    let aumentan = 0, disminuyen = 0;
    for (const id of comunes) {
      if (a.get(id) > previo(id)) aumentan++;
      else if (a.get(id) < previo(id)) disminuyen++;
    }
    const totalA = comunes.reduce((x, id) => x + a.get(id), 0);
    const totalB = comunes.reduce((x, id) => x + previo(id), 0);
    if (comunes.length && totalB > 0) {
      const pct = (totalA / totalB - 1) * 100;
      sCambio = Math.tanh(pct / ESCALA_CAMBIO_PCT);
      metricas.push(metrica('cambio_acciones_pct', pct, '%', periodo));
      motivos.push(`Acciones de las ${comunes.length} instituciones presentes en ambos cortes ${pct >= 0 ? 'aumentan' : 'disminuyen'} ${Math.abs(pct).toFixed(2)}%.`);
    } else datosFaltantes.push(comunes.length ? 'reportes.acciones_previas' : 'reportes.instituciones_comunes');
    // Amplitud = (aumentan − disminuyen) / instituciones comunes: −1 (todas venden) .. +1 (todas compran).
    if (comunes.length) {
      sAmplitud = (aumentan - disminuyen) / comunes.length;
      metricas.push(metrica('amplitud_instituciones', sAmplitud, 'indice', periodo));
    }
    if (nuevas || salen) motivos.push(`${nuevas} institución(es) solo en el corte reciente y ${salen} solo en el previo: no entran en la señal (pueden ser 13F aún no presentados o nombres de emisor distintos).`);
    metricas.push(
      metrica('instituciones_aumentan', aumentan, 'conteo', periodo),
      metrica('instituciones_disminuyen', disminuyen, 'conteo', periodo),
      metrica('instituciones_nuevas', nuevas, 'conteo', periodo),
      metrica('instituciones_salen', salen, 'conteo', periodo),
      metrica('instituciones_comunes', comunes.length, 'conteo', periodo),
      metrica('instituciones_reportadas', a.size, 'conteo', String(cortes[0].fecha).slice(0, 10)),
      factor !== 1 ? metrica('factor_split', factor, 'razon', periodo) : null,
    );
    motivos.push(`${aumentan} instituciones aumentan y ${disminuyen} disminuyen (solo las instituciones sincronizadas).`);
  }

  if (cortes.length && ref != null) {
    const dias = (ref - cortes[0].t) / DIA_MS;
    metricas.push(metrica('dias_desde_corte', dias, 'dias'));
    if (dias > DIAS_VIGENCIA) {
      factorVigencia = FACTOR_CONFIANZA_ANTIGUO;
      motivos.push(`Último corte con ${Math.round(dias)} días de antigüedad: confianza reducida.`);
    }
  }

  const valores = { cambio_acciones_pct: sCambio, amplitud_instituciones: sAmplitud };
  const { senales, motivo } = filtrarSenales(SENALES.map(s => ({ nombre: s.nombre, valor: valores[s.nombre], peso: s.pesoBase })), input.parametros);
  if (motivo) motivos.push(motivo);
  const c = combinar(senales);
  return finalizar({ ...c, confianza: c.confianza * factorVigencia, metricas, motivos, datosFaltantes, reglas: input.reglas, core: 'institucional' });
}
