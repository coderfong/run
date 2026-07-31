"""Split wrap-around cosmetics into front + back layers.

The generated art shows the complete object (the visor's rear band, the
medal's full neck loop, the scarf's top rim, the cape incl. clasp). Worn on
the avatar, the far-side part must be occluded by the head/body — so each
asset becomes two same-size canvases: <id>b.png (back, rendered BEFORE the
body) and the original file rewritten to hold only the front part. Identical
canvas dims keep the two layers pixel-registered under the same layout.

A short alpha feather at the seam avoids a hard cut line.
"""
import os
import numpy as np
from PIL import Image

CH = r"C:\Users\user\Desktop\run\frontend\assets\character"
FEATHER = 5  # px blend band at the seam

# (folder, base, n_variants (0 = single file), seam fraction of height,
#  back_is: 'above' -> pixels above seam go to the back layer;
#           'below' -> pixels below seam go to the back layer (cape fabric))
SPECS = [
    ("headwear", "hat5", 10, 0.40, "above"),   # sweatband: rear band arc
    ("headwear", "hat11", 10, 0.42, "above"),  # visor: rear band
    ("accessory", "acc5", 0, 0.18, "above"),   # scarf: top rim tucks behind neck
    ("accessory", "acc6", 0, 0.16, "below"),   # cape: fabric behind, clasp in front
    ("accessory", "acc7", 0, 0.39, "above"),   # gold medal: ribbon loop behind
    ("accessory", "acc8", 0, 0.34, "above"),   # champion medal: ribbon behind
]

def split(path, back_path, seam_frac, back_is):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).copy()
    h = a.shape[0]
    seam = int(h * seam_frac)
    # weight ramp: 1 = back layer keeps pixel, 0 = front layer keeps pixel
    yy = np.arange(h)
    ramp = np.clip((seam + FEATHER / 2 - yy) / FEATHER, 0, 1)  # 1 above seam
    if back_is == "below":
        ramp = 1 - ramp
    back = a.copy()
    back[..., 3] = (a[..., 3] * ramp[:, None]).astype(np.uint8)
    front = a.copy()
    front[..., 3] = (a[..., 3] * (1 - ramp[:, None])).astype(np.uint8)
    Image.fromarray(back, "RGBA").save(back_path, optimize=True)
    Image.fromarray(front, "RGBA").save(path, optimize=True)

for folder, base, nvar, seam, back_is in SPECS:
    names = [f"{base}.png"] + [f"{base}_{i}.png" for i in range(nvar)]
    for name in names:
        p = os.path.join(CH, folder, name)
        if not os.path.exists(p):
            continue
        stem, ext = os.path.splitext(name)
        if "_" in stem and stem.rsplit("_", 1)[1].isdigit():
            b, i = stem.rsplit("_", 1)
            back_name = f"{b}b_{i}{ext}"
        else:
            back_name = f"{stem}b{ext}"
        split(p, os.path.join(CH, folder, back_name), seam, back_is)
    print("split", base, f"({len(names)} files)")
print("done")
