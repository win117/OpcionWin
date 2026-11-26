"""Convierte entrega.html a PDF con Microsoft Edge (Playwright) y avisa si algún contenido no cabe en su hoja.
Uso: python docs/guia-opciones/entrega/pdf.py [carpeta_capturas]"""
import pathlib
import sys
from playwright.sync_api import sync_playwright

aqui = pathlib.Path(__file__).resolve().parent
html = aqui / 'entrega.html'
pdf = aqui / 'LSW_G5B_6pm_T3_Act2_E9_CASTELLANOS_MACHUCA_EDWIN_URIEL.pdf'  # documento completo A+B+C (el del inciso A solo se conserva)
capturas = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None

with sync_playwright() as p:
    nav = p.chromium.launch(channel='msedge')
    pagina = nav.new_page(viewport={'width': 816, 'height': 1056})
    pagina.goto(html.as_uri())
    pagina.wait_for_load_state('networkidle')
    desbordes = pagina.evaluate("""() => [...document.querySelectorAll('.page')].map((s, i) => {
        const c = s.querySelector('.cuerpo'); return [i + 1, c.scrollHeight - c.clientHeight]; }).filter(([, d]) => d > 1)""")
    for n, d in desbordes:
        print(f'Hoja {n}: sobran {d}px')
    if not desbordes:
        print('Todas las hojas caben.')
    pagina.pdf(path=str(pdf), width='8.5in', height='11in', print_background=True, prefer_css_page_size=True)
    if capturas:
        capturas.mkdir(parents=True, exist_ok=True)
        for i, s in enumerate(pagina.query_selector_all('.page'), 1):
            s.screenshot(path=str(capturas / f'p{i:02d}.png'))
    nav.close()
print(pdf)
