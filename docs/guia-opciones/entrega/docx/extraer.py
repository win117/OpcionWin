"""Extrae de entrega.html la estructura de cada hoja (bloques y formato) a JSON y los diagramas a PNG."""
import json, pathlib, sys
from playwright.sync_api import sync_playwright

html = pathlib.Path(sys.argv[1]).resolve()
out = pathlib.Path(sys.argv[2]); (out / 'img').mkdir(parents=True, exist_ok=True)

JS = r"""
() => {
  let nImg = 0;
  const runs = (nodo, est = {}) => {
    const r = [];
    const walk = (n, e) => {
      if (n.nodeType === 3) { const t = n.textContent.replace(/\s+/g, ' '); if (t) r.push({ t, ...e }); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase(), e2 = { ...e };
      if (tag === 'br') { r.push({ br: true }); return; }
      if (['b', 'strong', 'th', 'dt'].includes(tag)) e2.b = true;
      if (['i', 'em'].includes(tag)) e2.i = true;
      if (tag === 'code') e2.code = true;
      if (tag === 'sub') e2.sub = true;
      if (tag === 'sup') e2.sup = true;
      if (tag === 'mark') e2.hl = n.className;
      if (tag === 'span' && n.parentElement?.classList.contains('en')) { e2.hl = 'en'; e2.i = true; }
      for (const c of n.childNodes) walk(c, e2);
    };
    walk(nodo, est);
    if (r.length && r[0].t) r[0].t = r[0].t.replace(/^\s+/, '');
    if (r.length && r[r.length - 1].t) r[r.length - 1].t = r[r.length - 1].t.replace(/\s+$/, '');
    return r.filter(x => x.br || x.t);
  };
  const imagen = el => { const id = 'i' + (++nImg); el.setAttribute('data-img', id); const b = el.getBoundingClientRect(); return { t: 'img', id, w: Math.round(b.width), h: Math.round(b.height) }; };
  const bloque = el => {
    const tag = el.tagName.toLowerCase(), cls = el.className || '';
    if (/^h[2-4]$/.test(tag)) return [{ t: 'h', nivel: +tag[1], cls, runs: runs(el) }];
    if (tag === 'p') return [{ t: 'p', cls, runs: runs(el) }];
    if (tag === 'ul' || tag === 'ol') return [{ t: 'lista', orden: tag === 'ol', items: [...el.children].map(li => runs(li)) }];
    if (tag === 'table') {
      const filas = [...el.rows].map(tr => [...tr.cells].map(c => ({ th: c.tagName === 'TH', runs: runs(c) })));
      const anchos = [...el.rows[0].cells].map(c => c.getBoundingClientRect().width);
      return [{ t: 'tabla', filas, anchos, cls }];
    }
    if (tag === 'figure') {
      const out = [imagen(el.querySelector('svg'))];
      const cap = el.querySelector('figcaption'); if (cap) out.push({ t: 'p', cls: 'cap', runs: runs(cap) });
      return out;
    }
    if (tag === 'svg' || cls.includes('dos') || cls.includes('logos')) return [imagen(el)];
    if (cls.includes('nota')) return [{ t: 'p', cls: 'nota', runs: runs(el) }];
    if (cls.includes('cod')) return [{ t: 'code', titulo: el.querySelector('.arch').textContent, texto: el.querySelector('pre').textContent }];
    if (cls.includes('idx')) { const s = el.querySelectorAll('span'); return [{ t: 'idx', sub: cls.includes('sub'), texto: s[0].textContent, pag: s[2].textContent }]; }
    if (cls.includes('portada')) return [...el.children].map(c => c.tagName === 'BR' ? { t: 'p', cls: 'centro', runs: [] } : { t: 'p', cls: 'portada', runs: runs(c) });
    if (cls.includes('refs')) return [...el.children].map(c => ({ t: 'p', cls: 'ref', runs: runs(c) }));
    if (tag === 'dl') { const o = []; const k = [...el.children]; for (let i = 0; i < k.length; i += 2) o.push({ t: 'p', cls: 'glosa', runs: [...runs(k[i], { b: true, dt: true }), { t: ' ' }, ...runs(k[i + 1])] }); return o; }
    if (tag === 'br') return [];
    return [{ t: 'p', cls: '', runs: runs(el) }];
  };
  return [...document.querySelectorAll('.page')].map(s => ({
    encabezado: s.querySelector('.hdr > div').textContent,
    bloques: [...s.querySelector('.cuerpo').children].flatMap(bloque),
  }));
}
"""

with sync_playwright() as p:
    nav = p.chromium.launch(channel='msedge')
    pg = nav.new_page(viewport={'width': 816, 'height': 1056}, device_scale_factor=2.5)
    pg.goto(html.as_uri()); pg.wait_for_load_state('networkidle')
    paginas = pg.evaluate(JS)
    for el in pg.query_selector_all('[data-img]'):
        el.screenshot(path=str(out / 'img' / (el.get_attribute('data-img') + '.png')), omit_background=False)
    nav.close()
(out / 'paginas.json').write_text(json.dumps(paginas, ensure_ascii=False), encoding='utf-8')
print(len(paginas), 'hojas,', sum(1 for pg_ in paginas for b in pg_['bloques'] if b['t'] == 'img'), 'imágenes')
