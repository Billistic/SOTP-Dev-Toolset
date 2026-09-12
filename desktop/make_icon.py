"""Generates icon.ico / icon.png (dark tile with a small node graph) so the build has an app icon without art assets."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
BG, BORDER, ACCENT, ORANGE, PURPLE, LINE = "#161616", "#3a3a3a", "#1f8fff", "#c47f1a", "#7b4fc1", "#8a8a8a"


def render(size: int) -> Image.Image:
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = s * 0.18
    d.rounded_rectangle((0, 0, s - 1, s - 1), radius=r, fill=BG, outline=BORDER, width=max(1, s // 64))
    # three nodes in a pipeline, one branching
    nodes = {"a": (0.27, 0.5, ACCENT), "b": (0.62, 0.30, ORANGE), "c": (0.62, 0.70, PURPLE)}
    w = max(2, int(s * 0.035))
    for src, dst in (("a", "b"), ("a", "c")):
        x1, y1, _ = nodes[src]
        x2, y2, _ = nodes[dst]
        d.line((x1 * s, y1 * s, x2 * s, y2 * s), fill=LINE, width=w)
    rad = s * 0.11
    for x, y, colour in nodes.values():
        d.rounded_rectangle((x * s - rad * 1.25, y * s - rad * 0.8, x * s + rad * 1.25, y * s + rad * 0.8),
                            radius=rad * 0.3, fill=colour)
    return img


def main() -> None:
    base = render(256)
    base.save(HERE / "icon.png")
    base.save(HERE / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("wrote", HERE / "icon.ico")


if __name__ == "__main__":
    main()
