"""Shorten the shorts that were drawn as three-quarter trousers.

The slot's reference (`bottom3`) renders 126px tall. These four came in at
183-209px, which put their hems near the ankles — they read as cropped
trousers rather than shorts, and clashed with every top.

Target aspect 0.95 (h/w) renders ~146px: knee-length, clearly shorts, still
distinct from the short reference. Squashing the art keeps the leg WIDTH
correct; narrowing the layout instead would make them skinny as well as long.

Run from frontend/:  python scripts/fix-shorts.py
"""

import os
from PIL import Image

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = os.path.join(FE, "assets", "character", "outfit")
TARGET = 0.95            # height / width

TARGETS = {
    "bottom11": "flame shorts",
    "bottom13": "khaki shorts",
    "bottom15": "cargo shorts",
    "bottom19": "denim shorts",
}

for stem, name in TARGETS.items():
    done = 0
    for suf in [""] + [f"_{i}" for i in range(10)]:
        p = os.path.join(CH, f"{stem}{suf}.png")
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert("RGBA")
        w, h = im.size
        nh = max(1, round(w * TARGET))
        if abs(nh - h) < 3:
            continue
        im.resize((w, nh), Image.LANCZOS).save(p, optimize=True)
        done += 1
    print(f"{stem:10s} {name:14s} -> {done} file(s)")
print("done")
