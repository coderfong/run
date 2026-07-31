"""Second wrap-around split pass: crown and headset.

Both are rings worn AROUND the head, but were drawn as complete objects — so
the far side of the band painted over the skull instead of disappearing behind
it. Splitting them lets the rig draw the back half pre-body.

Run from frontend/:  python scripts/split-layers-2.py
"""

import os
import numpy as np
from PIL import Image
from scipy import ndimage

FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CH = os.path.join(FE, "assets", "character")
FEATHER = 5

# (folder, stem, n_variants, seam as a fraction of height)
#   above the seam -> behind the head, below -> in front
SPECS = [
    ("headwear", "hat7", 0, 0.46),    # crown: band arc behind the skull
    ("accessory", "acc21", 0, 0.34),  # headset: headband over the top
]


def split(path, back_path, seam_frac):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).copy()
    h = a.shape[0]
    seam = int(h * seam_frac)
    yy = np.arange(h)
    ramp = np.clip((seam + FEATHER / 2 - yy) / FEATHER, 0, 1)  # 1 above seam
    back = a.copy()
    back[..., 3] = (a[..., 3] * ramp[:, None]).astype(np.uint8)
    front = a.copy()
    front[..., 3] = (a[..., 3] * (1 - ramp[:, None])).astype(np.uint8)
    Image.fromarray(back, "RGBA").save(back_path, optimize=True)
    Image.fromarray(front, "RGBA").save(path, optimize=True)


for folder, stem, nvar, seam in SPECS:
    names = [f"{stem}.png"] + [f"{stem}_{i}.png" for i in range(nvar)]
    made = 0
    for name in names:
        p = os.path.join(CH, folder, name)
        if not os.path.exists(p):
            continue
        base, ext = os.path.splitext(name)
        if "_" in base and base.rsplit("_", 1)[1].isdigit():
            b, i = base.rsplit("_", 1)
            back = f"{b}b_{i}{ext}"
        else:
            back = f"{base}b{ext}"
        split(p, os.path.join(CH, folder, back), seam)
        made += 1
    print(f"split {stem} ({made} file(s))")
print("done")
