"""Composite QA for strip-body-parts.py — the only view that proves the pass.

A garment cut looks fine on its own long after it has stopped working on the
rig; what matters is whether the app's own arms and legs come through where the
model's used to be, in the app's own skin, at the app's own proportions. This
lays the stripped art over body.png exactly the way CharacterRig does and
renders before/after pairs.

    python scripts/strip-qa-composite.py            # a spread of outfits
    python scripts/strip-qa-composite.py o12t,o3b   # named items
"""

import importlib.util
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "sbp", os.path.join(HERE, "strip-body-parts.py"))
sbp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sbp)

BODY_W, BODY_H = sbp.BODY_W, sbp.BODY_H


def place(canvas, art, layout):
    ih, iw = art.shape[:2]
    w = layout["w"] * BODY_W
    h = w * (ih / iw)
    left = BODY_W / 2 - w / 2 + layout.get("dx", 0) * BODY_W
    top = layout["top"] * BODY_H
    im = Image.fromarray(art).resize((max(1, round(w)), max(1, round(h))),
                                     Image.LANCZOS)
    canvas.alpha_composite(im, (round(left), round(top)))


def render(item_ids, items, src_dir):
    body = Image.open(os.path.join(sbp.CHAR, "body", "body.png")).convert("RGBA")
    canvas = Image.new("RGBA", (BODY_W, BODY_H), (0, 0, 0, 0))
    canvas.alpha_composite(body)
    order = {"onepiece": 0, "bottom": 1, "top": 2, "footwear": 3}
    for it in sorted((items[i] for i in item_ids), key=lambda i: order[i["fit"]]):
        layout = dict(sbp.BASE_LAYOUT[it["fit"]])
        layout.update(it["layout"])
        art = np.array(Image.open(os.path.join(src_dir, it["rel"])).convert("RGBA"))
        place(canvas, art, layout)
    flat = Image.new("RGBA", canvas.size, (255, 255, 255, 255))
    flat.alpha_composite(canvas)
    return flat.convert("RGB")


def main():
    items = {i["id"]: i for i in sbp.catalogue()}
    if len(sys.argv) > 1:
        outfits = [sys.argv[1].split(",")]
    else:
        outfits = [["o4t", "o0b", "o0f"], ["o12t", "o12b", "o12f"],
                   ["o35t", "o16b", "o16f"], ["o49t", "o42b", "o42f"],
                   ["o9t", "o9b", "o9f"], ["o82t", "o82b", "o82f"],
                   ["o61o", "o61f"], ["o30t", "o30b", "o30f"]]
    # The body is 248x640, so a cell has to be tall — squeezing the render into
    # a square one just crops the legs off, which is where half the defects are.
    cw, ch = 170, 460
    sheet = Image.new("RGB", (cw * len(outfits), ch * 2 + 40), (206, 211, 221))
    dr = ImageDraw.Draw(sheet)
    for col, ids in enumerate(outfits):
        ids = [i for i in ids if i in items]
        for row, (tag, d) in enumerate((("before", sbp.SRC), ("after", sbp.CHAR))):
            im = render(ids, items, d)
            im.thumbnail((cw - 12, ch - 24))
            y = row * (ch + 20)
            sheet.paste(im, (col * cw + 6, y + 20))
            dr.text((col * cw + 4, y + 4),
                    "%s %s" % (tag, "+".join(ids)), fill=(20, 20, 20))
    os.makedirs(sbp.QA, exist_ok=True)
    out = os.path.join(sbp.QA, "composite.png")
    sheet.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main()
