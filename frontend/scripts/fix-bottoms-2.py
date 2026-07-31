"""Re-proportion the two over-long jeans.

ripped/light jeans render ~245px tall against a ~206px median for the slot,
so at a believable leg width they reach the ankles while everything else
stops mid-shin. Squashing the art (rather than narrowing the layout) keeps
the leg width right and only shortens the inseam.

Run from frontend/:  python scripts/fix-bottoms-2.py
"""

import os
from PIL import Image

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = os.path.join(FE, "assets", "character", "outfit")
TARGET_ASPECT = 512 / 306          # the bottom1 pants that already sit right

for base in ["bottom14", "bottom16"]:     # rippedjeans, lightjeans
    changed = 0
    for suf in [""] + [f"_{i}" for i in range(10)]:
        p = os.path.join(CH, f"{base}{suf}.png")
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert("RGBA")
        w, h = im.size
        nh = round(w * TARGET_ASPECT)
        if abs(nh - h) < 3:
            continue
        im.resize((w, nh), Image.LANCZOS).save(p, optimize=True)
        changed += 1
    print(f"{base}: {changed} file(s) -> aspect {TARGET_ASPECT:.2f}")
print("done")
