"""Genera los iconos PNG de la PWA a partir de los SVG de web/public/icons (se ejecuta una vez; los PNG se versionan).

Uso:  python scripts/generar-iconos-pwa.py
Requiere Playwright para Python con Microsoft Edge instalado (channel='msedge').
"""
import pathlib
import struct

from playwright.sync_api import sync_playwright

ICONOS = pathlib.Path(__file__).resolve().parent.parent / 'web' / 'public' / 'icons'

# (archivo de salida, SVG de origen, lado en px, fondo transparente)
SALIDAS = [
    ('icon-192.png', 'icon.svg', 192, True),
    ('icon-512.png', 'icon.svg', 512, True),
    # maskable: fondo a sangre y dibujo dentro de la zona segura (80 % central)
    ('icon-maskable-512.png', 'icon-maskable.svg', 512, False),
    # iOS pone negro lo transparente: se usa la versión a sangre; el sistema redondea las esquinas
    ('apple-touch-icon.png', 'icon-maskable.svg', 180, False),
]


def dimensiones(png: pathlib.Path) -> tuple[int, int]:
    datos = png.read_bytes()[:24]
    assert datos[:8] == b'\x89PNG\r\n\x1a\n', f'{png.name} no es PNG'
    return struct.unpack('>II', datos[16:24])


def main() -> None:
    with sync_playwright() as p:
        nav = p.chromium.launch(channel='msedge')
        for salida, origen, lado, transparente in SALIDAS:
            pagina = nav.new_page(viewport={'width': lado, 'height': lado}, device_scale_factor=1)
            svg = (ICONOS / origen).read_text(encoding='utf-8')
            pagina.set_content(
                '<html><body style="margin:0;background:transparent">'
                f'<div style="width:{lado}px;height:{lado}px">{svg.replace("<svg ", f"<svg width=\"{lado}\" height=\"{lado}\" ", 1)}</div>'
                '</body></html>'
            )
            pagina.locator('div').screenshot(path=str(ICONOS / salida), omit_background=transparente)
            pagina.close()
        nav.close()
    for salida, _, lado, _ in SALIDAS:
        ancho, alto = dimensiones(ICONOS / salida)
        assert (ancho, alto) == (lado, lado), f'{salida}: {ancho}x{alto}, se esperaba {lado}x{lado}'
        print(f'{salida}: {ancho}x{alto} OK')


if __name__ == '__main__':
    main()
