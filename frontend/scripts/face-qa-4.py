"""Composite the new faces onto the head, using the rig's own Layer math.

Also draws the reference anchors as thin guides (brow line, eye line, head
box) so the placement can be checked against the reference head rather than
just "looks about right".
"""
import json
import os
import sys
from PIL import Image, ImageDraw

SCRATCH = os.path.dirname(os.path.abspath(__file__))
CH = r"C:\Users\user\Desktop\run\frontend\assets\character"
QA = os.path.join(SCRATCH, "qa4")
os.makedirs(QA, exist_ok=True)

BODY_W, BODY_H = 248, 640
HEADROOM = 0.14 * BODY_H
HEAD_TOP, HEAD_H, HEAD_W = 9, 196, 160

spec = json.load(open(os.path.join(SCRATCH, "faces4.json")))
LAYOUT = spec["layout"]
GUIDES = "--guides" in sys.argv


def place(canvas, img, layout, off):
    w = layout["w"] * BODY_W
    h = w * img.height / img.width
    top = (layout["cy"] * BODY_H - h / 2) if layout.get("cy") is not None \
        else layout["top"] * BODY_H
    left = BODY_W / 2 - w / 2 + layout.get("dx", 0) * BODY_W
    canvas.alpha_composite(
        img.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS),
        (round(left) + off[0], round(top + HEADROOM) + off[1]))


def head(face_png, glasses=None):
    pad = 26
    c = Image.new("RGBA", (BODY_W + 2 * pad, round(HEAD_H + HEADROOM) + 90),
                  (250, 250, 250, 255))
    body = Image.open(os.path.join(CH, "body", "body.png")).convert("RGBA") \
        .resize((BODY_W, BODY_H), Image.LANCZOS)
    c.alpha_composite(body, (pad, round(HEADROOM)))
    place(c, Image.open(face_png).convert("RGBA"), LAYOUT, (pad, 0))
    if glasses:
        place(c, Image.open(glasses).convert("RGBA"),
              {"w": 0.42, "cy": spec["glasses_cy"]}, (pad, 0))
    if GUIDES:
        d = ImageDraw.Draw(c)
        y0 = HEADROOM
        for frac, col in ((0.34, (255, 60, 60, 255)), (0.46, (60, 120, 255, 255)),
                          (0.73, (40, 170, 90, 255))):
            y = y0 + HEAD_TOP + frac * HEAD_H
            d.line([(pad, y), (pad + BODY_W, y)], fill=col, width=1)
        x0 = pad + BODY_W / 2 - 0.59 * HEAD_W / 2
        d.line([(x0, y0), (x0, y0 + HEAD_H)], fill=(255, 60, 60, 255), width=1)
        d.line([(x0 + 0.59 * HEAD_W, y0), (x0 + 0.59 * HEAD_W, y0 + HEAD_H)],
               fill=(255, 60, 60, 255), width=1)
    return c


def main():
    faces = spec["faces"]
    g = os.path.join(CH, "glasses", "specs4_1.png")
    glasses = g if "--glasses" in sys.argv and os.path.exists(g) else None
    cols, cw, chh = 7, 220, 250
    rows = (len(faces) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cw, rows * chh), (235, 235, 238))
    d = ImageDraw.Draw(sheet)
    for i, f in enumerate(faces):
        av = head(os.path.join(CH, "face", f["stem"] + ".png"), glasses)
        av.thumbnail((cw - 10, chh - 26), Image.LANCZOS)
        sheet.paste(av, ((i % cols) * cw + (cw - av.width) // 2,
                         (i // cols) * chh + 20), av)
        d.text(((i % cols) * cw + 6, (i // cols) * chh + 5),
               f"{f['idx']} {f['stem']}", fill=(20, 20, 20))
    name = "faces-guides.png" if GUIDES else (
        "faces-glasses.png" if glasses else "faces.png")
    sheet.save(os.path.join(QA, name))
    print("wrote", os.path.join(QA, name))


if __name__ == "__main__":
    main()
