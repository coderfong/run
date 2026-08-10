"""Give every split shoe pair a per-foot placement in the catalogue.

Adds three fields to each footwear line:

  footL / footR   the split art (scripts/split-shoes-6.py)
  feet            { l: {w, dx, top, rot}, r: {...} } — one placement per shoe,
                  in exactly the units a Layer already uses, plus `rot` in
                  degrees.

`feet` is additive: CharacterRig draws the pair image exactly as before for any
item without it, so the four pairs that would not split and every older shoe in
the catalogue are untouched.

Defaults are measured off the body — the feet sit at x 30..109 and 137..217 of
the 248-wide frame, so each shoe is centred on its own foot and stood on the
sole line at y=635 rather than both being centred on the body's midline.
"""
import json
import os
import re

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SHOES = r"C:\Users\user\Desktop\run\frontend\assets\character\footwear"
CONFIG = r"C:\Users\user\Desktop\run\frontend\src\config\outfitItems.js"

BODY_W, BODY_H = 248, 640
SOLE_Y = 635.0
# foot centres and span, measured off body.png at y=615
FOOT = {"l": (69.5, 80), "r": (177.0, 81)}
EASE = 1.12          # a shoe is cut a little bigger than the foot in it


def main():
    split = set(json.load(open(os.path.join(HERE, "shoes6-split.json")))["split"])
    src = open(CONFIG, encoding="utf-8").read()
    lines = src.split("\n")
    touched = 0

    for i, line in enumerate(lines):
        m = re.search(r"img: require\('\.\./\.\./assets/character/footwear/(\w+)\.png'\)", line)
        if not m or m.group(1) not in split:
            continue
        stem = m.group(1)
        feet = {}
        for side in ("l", "r"):
            img = Image.open(os.path.join(SHOES, f"{stem}{side.upper()}.png"))
            cx, span = FOOT[side]
            w_px = span * EASE
            h_px = w_px * img.height / img.width
            feet[side] = {
                "w": round(w_px / BODY_W, 4),
                "dx": round((cx - BODY_W / 2) / BODY_W, 4),
                "top": round((SOLE_Y - h_px) / BODY_H, 4),
                "rot": 0,
            }
        js = ", ".join(
            "%s: { %s }" % (s, ", ".join(f"{k}: {v}" for k, v in feet[s].items()))
            for s in ("l", "r")
        )
        add = (f", footL: require('../../assets/character/footwear/{stem}L.png')"
               f", footR: require('../../assets/character/footwear/{stem}R.png')"
               f", feet: {{ {js} }}")
        # slot the new fields in right after the pair image, before `layout`
        lines[i] = line.replace(m.group(0), m.group(0) + add, 1)
        touched += 1

    open(CONFIG, "w", encoding="utf-8").write("\n".join(lines))
    print(f"{touched} footwear items given per-foot placement")


if __name__ == "__main__":
    main()
