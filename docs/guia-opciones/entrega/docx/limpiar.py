"""Deja el .docx listo para Word y Google Drive: quita las entradas de carpeta del ZIP y el elemento w:highlightCs
(no admitido por el esquema de Office). Uso: python docs/guia-opciones/entrega/docx/limpiar.py <archivo.docx>"""
import io
import re
import sys
import zipfile

ruta = sys.argv[1]
with zipfile.ZipFile(ruta) as origen:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as destino:
        for info in origen.infolist():
            if info.filename.endswith('/'):
                continue
            datos = origen.read(info.filename)
            if info.filename.endswith('.xml'):
                datos = re.sub(rb'<w:highlightCs [^>]*/>', b'', datos)
            destino.writestr(info.filename, datos)
with open(ruta, 'wb') as f:
    f.write(buffer.getvalue())
print('limpio:', ruta)
