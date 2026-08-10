"""Composite every wave-4 hat onto the head and montage the result.

Mirrors CharacterRig's Layer math and z-order (body, head plate, face, hair,
headwear) so what shows here is what the app draws. Each hat is shown over four
hairstyles chosen to break it if it can be broken:

  bald        the piece alone — does the cut still carry head lines?
  bob         an everyday style — does hair show where it should?
  long        a style wider than the skull — does it read as worn UNDER?
  afro        `bulky` — this is the one the hideHair / hidesBulky call is for.

  python headwear-qa-4.py            every installed piece
  python headwear-qa-4.py 0 20       a slice, by manifest order
"""
import json
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
CH = r"C:\Users\user\Desktop\run\frontend\assets\character"
QA = os.path.join(HERE, "qa-headwear4")

BODY_W, BODY_H = 248, 640
HEADROOM = 0.14 * BODY_H
HAIR_LIFT = -0.02              # CharacterRig.js
MARGIN = 40
CROP_H = 300                   # head and shoulders is all this QA needs

LAYOUT = {
    "face": dict(w=0.3735, top=0.1283),
    "hair": dict(w=0.92, top=-0.025),
    "headwear": dict(w=0.85, top=-0.07),
    "top": dict(w=0.9718, top=0.3169),
}

# name, file, layout, bulky
HAIRS = [
    ("bald", None, {}, False),
    ("bob", "hairX5.png", dict(w=1.042, top=-0.0151, dx=-0.0603), False),
    ("long", "hairX28.png", dict(w=1.45, top=-0.0586, dx=-0.0327), False),
    ("afro", "hairX24.png", dict(w=1.381, top=-0.0587, dx=-0.0145), True),
]


def art(folder, f):
    return Image.open(os.path.join(CH, folder, f)).convert("RGBA")


def place(canvas, img, slot, layout):
    spec = {**LAYOUT[slot], **(layout or {})}
    w = spec["w"] * BODY_W
    h = w * img.height / img.width
    top = spec["top"] * BODY_H
    if slot == "hair":
        top += HAIR_LIFT * BODY_H
    left = BODY_W / 2 - w / 2 + spec.get("dx", 0) * BODY_W
    canvas.alpha_composite(
        img.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS),
        (round(left) + MARGIN, round(top + HEADROOM)))


def avatar(item, hair):
    name, hfile, hlay, bulky = hair
    canvas = Image.new("RGBA", (BODY_W + 2 * MARGIN, CROP_H), (250, 250, 250, 255))
    canvas.alpha_composite(art("body", "body.png"), (MARGIN, round(HEADROOM)))
    canvas.alpha_composite(art("body", "head.png"), (MARGIN, round(HEADROOM)))
    place(canvas, art("face", "faceN9.png"), "face", {})
    hide = item["hair"] == "hide" or (item["hair"] == "bulky" and bulky)
    if hfile and not hide:
        place(canvas, art("hair", hfile), "hair", hlay)
    place(canvas, art("headwear", item["stem"] + ".png"), "headwear", item["layout"])
    return canvas.convert("RGB")


def main():
    items = json.load(open(os.path.join(HERE, "installed-headwear4.json")))
    if len(sys.argv) == 3:
        items = items[int(sys.argv[1]):int(sys.argv[2])]
    os.makedirs(QA, exist_ok=True)
    cw = BODY_W + 2 * MARGIN
    per_row = 3                              # items per montage row
    rows = (len(items) + per_row - 1) // per_row
    tile_w = cw * len(HAIRS)
    sheet = Image.new("RGB", (tile_w * per_row, (CROP_H + 20) * rows), (235, 238, 242))
    d = ImageDraw.Draw(sheet)
    for i, it in enumerate(items):
        r, c = divmod(i, per_row)
        for j, hair in enumerate(HAIRS):
            sheet.paste(avatar(it, hair), (c * tile_w + j * cw, r * (CROP_H + 20)))
        d.text((c * tile_w + 6, r * (CROP_H + 20) + CROP_H + 4),
               f"{it['id']}  ({it['stem']}, {it['hair'] or 'open'})", fill=(20, 20, 20))
    out = os.path.join(QA, "worn.png")
    sheet.save(out)
    print("wrote", out, sheet.size)


if __name__ == "__main__":
    main()
