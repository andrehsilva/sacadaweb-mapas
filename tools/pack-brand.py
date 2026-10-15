# -*- coding: utf-8 -*-
"""SacadaWeb - Mapas :: empacota os ativos de marca.

Entradas (masters renderizados de build/brand.html, fonte de verdade do desenho):
  build/icon-master.png    ladrilho azul 512x512 (Outfit 800 + JetBrains Mono)
  build/lockup-master.png  lockup "SacadaWeb - Mapas" sobre branco

Saidas:
  build/icon.png                        master 512 (RGBA, cantos transparentes)
  build/icon.ico                        icone Windows multi-tamanho
  resources/icon.png                    icone usado pela janela (256)
  resources/app/resources/icon.png      idem, dentro da arvore do app
  build/lockup.png                      lockup reduzido (usado no PDF)
  resources/app/out/renderer/assets/brand.js
                                        data URL do lockup para os exports

Uso: python tools/pack-brand.py
"""
from __future__ import annotations

import base64
import io
import os
import struct

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
APP_ASSETS = os.path.join(ROOT, "resources", "app", "out", "renderer", "assets")

ICON_SIZES = [16, 24, 32, 48, 64, 128, 256]
ICON_RADIUS = 112  # raio do ladrilho no master de 512
ICON_SMALL_MAX = 48  # abaixo disso o ladrilho usa o marca curta ("SW")
LOCKUP_HEIGHT = 80  # altura final do lockup embutido (7 mm a ~290 dpi)


def load_master(name: str) -> Image.Image:
    return Image.open(os.path.join(BUILD, name)).convert("RGBA")


def master_icon(name: str = "icon-master.png") -> Image.Image:
    """Cantos transparentes: a mascara vem da geometria (quadrado arredondado)."""
    src = load_master(name)
    size = src.width
    scale = size / 512
    radius = round(ICON_RADIUS * scale)
    big = 4
    mask = Image.new("L", (size * big, size * big), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size * big - 1, size * big - 1), radius=radius * big, fill=255
    )
    mask = mask.resize((size, size), Image.LANCZOS)
    src.putalpha(mask)
    return src.resize((512, 512), Image.LANCZOS)


def png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def write_ico(path: str, frames: list[Image.Image], sizes: list[int]) -> None:
    payloads = [png_bytes(f) for f in frames]
    out = io.BytesIO()
    out.write(struct.pack("<HHH", 0, 1, len(frames)))
    offset = 6 + 16 * len(frames)
    for frame, data in zip(frames, payloads):
        dim = lambda value: value if value < 256 else 0  # noqa: E731  (0 = 256)
        out.write(struct.pack("<BBBBHHII", dim(frame.width), dim(frame.height), 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    for data in payloads:
        out.write(data)
    with open(path, "wb") as handle:
        handle.write(out.getvalue())


def trim(img: Image.Image) -> Image.Image:
    """Recorta a margem branca do master do lockup."""
    mask = img.convert("L").point(lambda value: 0 if value >= 245 else 255)
    return img.crop(mask.getbbox())


def lockup_asset() -> bytes:
    crop = trim(load_master("lockup-master.png"))
    width = round(crop.width * LOCKUP_HEIGHT / crop.height)
    small = crop.resize((width, LOCKUP_HEIGHT), Image.LANCZOS)
    plain, paletted = png_bytes(small), png_bytes(small.convert("P", palette=Image.ADAPTIVE, colors=64))
    return paletted if len(paletted) < len(plain) else plain


def main() -> None:
    icon = master_icon("icon-master.png")
    small = master_icon("icon-small-master.png")
    icon.save(os.path.join(BUILD, "icon.png"))
    frames = [(small if size <= ICON_SMALL_MAX else icon).resize((size, size), Image.LANCZOS) for size in ICON_SIZES]
    write_ico(os.path.join(BUILD, "icon.ico"), frames, ICON_SIZES)
    icon_256 = icon.resize((256, 256), Image.LANCZOS)
    for target in (os.path.join(ROOT, "resources", "icon.png"), os.path.join(ROOT, "resources", "app", "resources", "icon.png")):
        icon_256.save(target)

    lockup = lockup_asset()
    with open(os.path.join(BUILD, "lockup.png"), "wb") as handle:
        handle.write(lockup)

    data_url = "data:image/png;base64," + base64.b64encode(lockup).decode("ascii")
    brand_js = (
        "/* SacadaWeb - Mapas :: lockup da marca usado nos exports (PDF/HTML).\n"
        "   Gerado por tools/pack-brand.py a partir de build/lockup-master.png.\n"
        "   O data URL vai embutido porque a janela de impressao do PDF nao carrega as fontes do app. */\n"
        f'globalThis.SACADAWEB_LOGO = "{data_url}";\n'
    )
    with open(os.path.join(APP_ASSETS, "brand.js"), "w", encoding="utf-8") as handle:
        handle.write(brand_js)

    print("icon.png/icon.ico/icon 256:", len(png_bytes(icon)), "e", os.path.getsize(os.path.join(BUILD, "icon.ico")), "bytes")
    print("icon.ico bytes:", os.path.getsize(os.path.join(BUILD, "icon.ico")))
    print("lockup.png:", len(lockup), "bytes; brand.js:", len(brand_js), "bytes")


if __name__ == "__main__":
    main()
