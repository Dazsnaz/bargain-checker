"""Draws the extension icons: a price tag with a tick. Run: python3 scripts/make_icons.py"""
from PIL import Image, ImageDraw

def icon(size):
    s = size * 4  # draw large, then shrink for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    green = (26, 127, 55, 255)
    m = s * 0.06
    # tag body: rounded rectangle with a pointed left end
    d.polygon([(m, s / 2), (s * 0.32, m + s * 0.08), (s - m, m + s * 0.08),
               (s - m, s - m - s * 0.08), (s * 0.32, s - m - s * 0.08)], fill=green)
    r = s * 0.07
    d.ellipse([s * 0.22 - r, s / 2 - r, s * 0.22 + r, s / 2 + r], fill=(255, 255, 255, 255))
    w = max(2, int(s * 0.09))
    d.line([(s * 0.42, s * 0.52), (s * 0.56, s * 0.66), (s * 0.82, s * 0.34)], fill=(255, 255, 255, 255), width=w, joint="curve")
    return img.resize((size, size), Image.LANCZOS)

for size in (16, 48, 128):
    icon(size).save(f"src/icons/icon{size}.png")
