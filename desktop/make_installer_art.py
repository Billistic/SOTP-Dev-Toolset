"""
Renders the installer's wizard bitmaps from the emblem: the tall left-hand panel of the
welcome / finish pages (one file per Inno-supported size, picked by DPI) and the small
banner image of the inner pages.  Inno wants 24-bit BMPs.  Uses headless Edge for the
SVG like make_icon.py, Pillow for the composition; a drawn placeholder if Edge is missing.
"""
from __future__ import annotations

import re
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
EMBLEM = HERE / "brand" / "emblem.svg"
OUT = HERE / "installer"
BUILD = HERE / "build"
EDGE = [Path(p) for p in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                          r"C:\Program Files\Microsoft\Edge\Application\msedge.exe")]
FONTS = Path(r"C:\Windows\Fonts")
# sizes Inno Setup 6 picks from for WizardImageFile / WizardSmallImageFile (100% .. 200% DPI)
LARGE = [(164, 314), (192, 386), (246, 459), (273, 556), (328, 604)]
SMALL = [55, 64, 83, 92, 110]
BG_TOP, BG_BOTTOM, FG, MUTED, ACCENT = (30, 30, 30), (15, 15, 15), (242, 242, 242), (138, 138, 138), (59, 142, 224)


def emblem(size: int) -> Image.Image:
    """The emblem in off-white on a transparent square, rasterised by Edge."""
    edge = next((p for p in EDGE if p.exists()), None)
    if edge is None or not EMBLEM.exists():
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(img).ellipse((size * 0.06, size * 0.06, size * 0.94, size * 0.94), outline=FG, width=max(2, size // 22))
        return img
    BUILD.mkdir(exist_ok=True)
    svg = EMBLEM.read_text(encoding="utf-8").replace('fill="black"', 'fill="#f2f2f2"')
    svg = re.sub(r'width="\d+" height="\d+"', f'width="{size}" height="{size}"', svg, count=1)
    html = BUILD / "emblem-art.html"
    html.write_text(f"<!doctype html><html><head><style>html,body{{margin:0;background:transparent}}</style></head><body>{svg}</body></html>", encoding="utf-8")
    png = BUILD / f"emblem-{size}.png"
    png.unlink(missing_ok=True)
    subprocess.run([str(edge), "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
                    f"--window-size={size},{size}", f"--screenshot={png}", html.as_uri()], capture_output=True, timeout=60)
    for _ in range(40):
        if png.exists() and png.stat().st_size > 0:
            return Image.open(png).convert("RGBA")
        time.sleep(0.1)
    raise RuntimeError("Edge did not produce the emblem raster")


def font(name: str, px: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype(str(FONTS / name), px)
    except OSError:
        return ImageFont.load_default()


def gradient(w: int, h: int) -> Image.Image:
    img = Image.new("RGB", (w, h), BG_BOTTOM)
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        px_row = tuple(int(BG_TOP[i] * (1 - t) + BG_BOTTOM[i] * t) for i in range(3))
        for x in range(w):
            px[x, y] = px_row
    return img


def glow(w: int, h: int, cx: int, cy: int, r: int) -> Image.Image:
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse((cx - r, cy - r, cx + r, cy + r), fill=(ACCENT[0], ACCENT[1], ACCENT[2], 70))
    return layer.filter(ImageFilter.GaussianBlur(r * 0.6))


def large(w: int, h: int, art: Image.Image, version: str) -> Image.Image:
    scale = w / 164
    img = gradient(w, h).convert("RGBA")
    e = int(88 * scale)
    cx, cy = w // 2, int(h * 0.36)
    img.alpha_composite(glow(w, h, cx, cy, int(e * 0.75)))
    img.alpha_composite(art.resize((e, e), Image.LANCZOS), (cx - e // 2, cy - e // 2))
    d = ImageDraw.Draw(img)
    f_small = font("segoeui.ttf", max(9, int(9.5 * scale)))
    f_big = font("segoeuisl.ttf", max(14, int(20 * scale)))
    f_mono = font("consola.ttf", max(8, int(8.5 * scale)))
    y = cy + e // 2 + int(22 * scale)
    _tracked(d, "SINS OF THE PROPHETS", (w // 2, y), f_small, MUTED, spacing=int(2.2 * scale))
    y += int(20 * scale)
    tw = d.textlength("Dev Env", font=f_big)
    d.text(((w - tw) / 2, y), "Dev Env", font=f_big, fill=FG)
    # accent rule + version at the foot
    d.rectangle((int(18 * scale), h - int(34 * scale), int(18 * scale) + int(28 * scale), h - int(33 * scale)), fill=ACCENT)
    d.text((int(18 * scale), h - int(26 * scale)), f"v{version}", font=f_mono, fill=MUTED)
    return img.convert("RGB")


def _tracked(d: ImageDraw.ImageDraw, text: str, centre: tuple[int, int], f, fill, spacing: int) -> None:
    widths = [d.textlength(ch, font=f) for ch in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x = centre[0] - total / 2
    for ch, cw in zip(text, widths):
        d.text((x, centre[1]), ch, font=f, fill=fill)
        x += cw + spacing


def small(s: int, art: Image.Image) -> Image.Image:
    img = Image.new("RGBA", (s, s), BG_BOTTOM + (255,))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.2), fill=(22, 22, 22), outline=(61, 61, 61), width=max(1, s // 40))
    e = int(s * 0.66)
    img.alpha_composite(art.resize((e, e), Image.LANCZOS), ((s - e) // 2, (s - e) // 2))
    return img.convert("RGB")


def main() -> None:
    sys.path.insert(0, str(HERE.parent / "backend"))
    try:
        from app.version import __version__ as version
    except Exception:
        version = "2.0"
    OUT.mkdir(exist_ok=True)
    art = emblem(512)
    for w, h in LARGE:
        large(w, h, art, version).save(OUT / f"wizard-{w}x{h}.bmp")
    for s in SMALL:
        small(s, art).save(OUT / f"small-{s}.bmp")
    print("wrote", len(LARGE) + len(SMALL), "bitmaps to", OUT)


if __name__ == "__main__":
    main()
