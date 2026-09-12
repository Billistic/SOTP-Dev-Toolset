"""
Builds icon.ico / icon.png from the Sins of the Prophets emblem (desktop/brand/emblem.svg):
the black emblem inverted to off-white on a dark rounded tile.  Rasterised with headless
Edge (always present on Windows), then packed into a multi-size .ico with Pillow.
Falls back to a drawn placeholder when Edge is unavailable.
"""
from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
EMBLEM = HERE / "brand" / "emblem.svg"
BUILD = HERE / "build"
EDGE = [Path(p) for p in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                          r"C:\Program Files\Microsoft\Edge\Application\msedge.exe")]
SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def render_with_edge(size: int = 256) -> Image.Image | None:
    edge = next((p for p in EDGE if p.exists()), None)
    if edge is None or not EMBLEM.exists():
        return None
    BUILD.mkdir(exist_ok=True)
    svg = EMBLEM.read_text(encoding="utf-8").replace('fill="black"', 'fill="#f2f2f2"')
    svg = re.sub(r'width="\d+" height="\d+"', f'width="{int(size * 0.7)}" height="{int(size * 0.7)}"', svg, count=1)
    html = BUILD / "icon.html"
    html.write_text(f"""<!doctype html><html><head><style>
html,body{{margin:0;background:transparent}}
.tile{{width:{size}px;height:{size}px;border-radius:{int(size * 0.2)}px;background:linear-gradient(180deg,#232323 0%,#0f0f0f 100%);
box-sizing:border-box;border:{max(2, size // 64)}px solid #3d3d3d;display:grid;place-items:center}}
</style></head><body><div class="tile">{svg}</div></body></html>""", encoding="utf-8")
    png = BUILD / f"icon-{size}.png"
    png.unlink(missing_ok=True)
    subprocess.run([str(edge), "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
                    f"--window-size={size},{size}", f"--screenshot={png}", html.as_uri()], capture_output=True, timeout=60)
    for _ in range(40):   # edge returns before the file is flushed
        if png.exists() and png.stat().st_size > 0:
            return Image.open(png).convert("RGBA")
        time.sleep(0.1)
    return None


def placeholder(size: int = 256) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.2), fill="#161616", outline="#3d3d3d", width=4)
    d.ellipse((size * 0.22, size * 0.22, size * 0.78, size * 0.78), outline="#f2f2f2", width=int(size * 0.05))
    return img


def main() -> None:
    base = render_with_edge() or placeholder()
    base.save(HERE / "icon.png")
    base.save(HERE / "icon.ico", sizes=SIZES)
    print("wrote", HERE / "icon.ico")


if __name__ == "__main__":
    main()
