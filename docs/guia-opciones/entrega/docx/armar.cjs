// Arma el .docx a partir de paginas.json + imágenes (una sección por hoja del PDF).
const fs = require('fs'), path = require('path');
const d = require('docx');
const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, BorderStyle,
  Header, Footer, PageNumber, TabStopType, LevelFormat, HeadingLevel, SectionType } = d;

const [, , dir, salida] = process.argv;
const paginas = JSON.parse(fs.readFileSync(path.join(dir, 'paginas.json'), 'utf8'));
const FECHA = '26/11/2026';
const PIE = 'Laboratorio de servicios web · Unidad 3 · Dr. Francisco Ibarra Carlos · ISC · Instituto Tecnológico de Tepic';
const ANCHO = 9504; // 6.6 in en DXA
const FONT = 'Times New Roman', MONO = 'Consolas';
const AZUL = '1F3864';

const HL = { y: 'yellow', g: 'green', en: 'cyan' };
function corridas(runs, base = {}) {
  return runs.map(r => {
    if (r.br) return new TextRun({ break: 1 });
    const o = { text: r.t, font: r.code ? MONO : FONT, bold: r.b || base.bold, italics: r.i || base.italics, size: r.code ? (base.size ? base.size - 2 : 20) : base.size,
      color: base.color, subScript: r.sub, superScript: r.sup };
    if (r.hl === 'o') o.shading = { type: ShadingType.CLEAR, color: 'auto', fill: 'FF9900' };
    else if (HL[r.hl]) o.highlight = HL[r.hl];
    else if (r.code) o.shading = { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' };
    return new TextRun(o);
  });
}

let instancia = 0;
const borde = { style: BorderStyle.SINGLE, size: 4, color: 'A9D08E' };
const bordes = { top: borde, bottom: borde, left: borde, right: borde };

function bloque(b) {
  const esp = { after: 160, line: 300 };
  switch (b.t) {
    case 'h': {
      const tam = b.nivel === 2 ? 31 : b.nivel === 3 ? 26 : 24;
      return [new Paragraph({ heading: b.nivel === 2 ? HeadingLevel.HEADING_1 : b.nivel === 3 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        alignment: b.cls.includes('centro') ? AlignmentType.CENTER : undefined, spacing: { before: b.nivel === 3 ? 240 : 80, after: 140 }, keepNext: true,
        children: corridas(b.runs, { size: tam, bold: b.nivel !== 2, color: '000000' }) })];
    }
    case 'p': {
      const c = b.cls || '';
      if (c === 'cap') return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: corridas(b.runs, { size: 20, italics: true, color: '444444' }) })];
      if (c === 'portada' || c === 'centro') return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: corridas(b.runs, { size: 26 }) })];
      if (c.includes('formula')) return [new Paragraph({ alignment: AlignmentType.CENTER, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F2F2' }, spacing: { before: 120, after: 200, line: 300 }, children: corridas(b.runs, { size: 23 }) })];
      if (c === 'nota') return [new Paragraph({ alignment: AlignmentType.JUSTIFIED, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF5FC' }, border: { left: { style: BorderStyle.SINGLE, size: 24, color: '2E75B6', space: 6 } }, indent: { left: 120 }, spacing: { before: 120, after: 200, line: 290 }, children: corridas(b.runs, { size: 23 }) })];
      if (c === 'ref') return [new Paragraph({ indent: { left: 720, hanging: 720 }, spacing: { after: 140 }, children: corridas(b.runs, { size: 23 }) })];
      if (c === 'glosa') return [new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 180, line: 300 }, children: corridas(b.runs, { size: 24 }) })];
      if (c.includes('inciso')) return [new Paragraph({ indent: { left: 360 }, spacing: esp, children: corridas(b.runs, { size: 24 }) })];
      if (c.includes('en')) return [new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { before: 240, after: 160, line: 300 }, children: corridas(b.runs, { size: 24 }) })];
      return [new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: esp, children: corridas(b.runs, { size: 24 }) })];
    }
    case 'lista': {
      instancia += 1;
      return b.items.map(it => new Paragraph({ numbering: { reference: b.orden ? 'pasos' : 'vinetas', level: 0, instance: b.orden ? instancia : 0 }, spacing: { after: 80, line: 290 }, children: corridas(it, { size: 24 }) }));
    }
    case 'tabla': {
      const tot = b.anchos.reduce((a, x) => a + x, 0);
      const cols = b.anchos.map(x => Math.round((x / tot) * ANCHO)); cols[cols.length - 1] += ANCHO - cols.reduce((a, x) => a + x, 0);
      const tam = b.cls.includes('mini') ? 19 : b.cls.includes('chica') ? 20 : 21;
      return [new Table({ width: { size: ANCHO, type: WidthType.DXA }, columnWidths: cols,
        rows: b.filas.map((f, i) => new TableRow({ tableHeader: i === 0 && f.every(c => c.th), children: f.map((c, j) => new TableCell({ width: { size: cols[j] || cols[cols.length - 1], type: WidthType.DXA }, borders: bordes,
          shading: c.th ? { type: ShadingType.CLEAR, color: 'auto', fill: 'C6E0B4' } : (i % 2 === 0 ? { type: ShadingType.CLEAR, color: 'auto', fill: 'F2F8EE' } : undefined), margins: { top: 50, bottom: 50, left: 100, right: 100 },
          children: [new Paragraph({ children: corridas(c.runs, { size: tam }) })] })) })) }),
        new Paragraph({ spacing: { after: 120 }, children: [] })];
    }
    case 'code': {
      const lineas = b.texto.replace(/\n$/, '').split('\n');
      return [new Paragraph({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: '24292F' }, spacing: { before: 120, after: 0 }, children: [new TextRun({ text: b.titulo, font: MONO, size: 17, color: 'FFFFFF' })] }),
        ...lineas.map((l, i) => new Paragraph({ shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F6F8FA' }, spacing: { after: i === lineas.length - 1 ? 200 : 0, line: 250 }, children: [new TextRun({ text: l.replace(/ /g, ' ') || ' ', font: MONO, size: 16 })] }))];
    }
    case 'img': {
      let w = b.w, h = b.h; if (w > 634) { h = h * 634 / w; w = 634; }
      return [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 60 }, children: [new ImageRun({ type: 'png', data: fs.readFileSync(path.join(dir, 'img', b.id + '.png')), transformation: { width: Math.round(w), height: Math.round(h) } })] })];
    }
    case 'idx':
      return [new Paragraph({ indent: { left: b.sub ? 400 : 0 }, spacing: { after: 140 }, tabStops: [{ type: TabStopType.RIGHT, position: ANCHO, leader: 'dot' }], children: [new TextRun({ text: b.texto, font: FONT, size: 24 }), new TextRun({ text: '\t' + b.pag, font: FONT, size: 24 })] })];
    default: return [];
  }
}

const total = paginas.length;
const secciones = paginas.map((pg, i) => ({
  properties: { type: SectionType.NEXT_PAGE, page: { size: { width: 12240, height: 15840 }, margin: { top: 1300, bottom: 1100, left: 1368, right: 1368, header: 560, footer: 500 } } },
  headers: { default: new Header({ children: [
    new Paragraph({ children: [new TextRun({ text: pg.encabezado, font: FONT, size: 22 })] }),
    new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: ANCHO }], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF', space: 2 } },
      children: [new TextRun({ text: FECHA + '\t', font: FONT, size: 22 }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 22 }), new TextRun({ text: ' de ', font: FONT, size: 22 }), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 22 })] }),
  ] }) },
  footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF', space: 2 } }, children: [new TextRun({ text: PIE, font: FONT, size: 21 })] })] }) },
  children: pg.bloques.flatMap(bloque),
}));

const doc = new Document({
  creator: 'Equipo 9', title: 'T3-Actividad 2 · Incisos A, B y C',
  styles: {
    default: { document: { run: { font: FONT, size: 24 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 31 }, paragraph: { spacing: { before: 80, after: 140 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 26, bold: true, color: '000000' }, paragraph: { spacing: { before: 240, after: 140 }, keepNext: true, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 24, bold: true }, paragraph: { spacing: { before: 160, after: 100 }, keepNext: true, outlineLevel: 2 } },
    ],
  },
  numbering: { config: [
    { reference: 'vinetas', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 280 } } } }] },
    { reference: 'pasos', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 320 } }, run: { bold: true, color: AZUL } } }] },
  ] },
  sections: secciones,
});
Packer.toBuffer(doc).then(buf => { fs.writeFileSync(salida, buf); console.log('OK', salida, total, 'secciones', (buf.length / 1048576).toFixed(1) + ' MB'); });
